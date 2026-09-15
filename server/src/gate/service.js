import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { auditRecord } from '../audit/metadata.js'

export const GATE_LABEL = '平台返校身份核验'
const QR_PREFIX = 'HUFE-GATE-V1:'
const error = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode })
const hash = value => createHash('sha256').update(value).digest('hex')
const stamp = time => new Date(time).toISOString()
const clean = (value, max, required = false) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f<>]/.test(value) || (required && !value.trim())) throw error('字段内容或长度不正确', 'GATE_INPUT_INVALID')
  return value.trim()
}
const body = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw error('包含不支持的参数', 'GATE_INPUT_INVALID')
  return input
}
const blankState = () => ({ version: 1, grants: [], stations: [], passes: [], previews: [], records: [], checkRevisions: {} })
function ensure(state) {
  state.gate ||= blankState()
  for (const key of ['grants', 'stations', 'passes', 'previews', 'records']) state.gate[key] ||= []
  state.gate.checkRevisions ||= {}
  return state.gate
}
const gateState = state => state.gate || blankState()
const demo = account => account.localDevelopmentOnly === true || account.developmentSchoolIdentityFixture === true || account.isDemo === true || account.isMock === true || [account.accountSource, account.verificationSource].some(value => /^(?:local-development|demo|mock)(?:[-_:]|$)/i.test(String(value || '')))
function accountIn(state, id) {
  const account = state.accounts.find(row => row.id === id && row.status === 'active')
  if (!account) throw error('账号已停用或注销，请重新登录', 'ACCOUNT_INACTIVE', 401)
  if (account.mustChangePassword) throw error('首次登录必须先修改临时密码', 'PASSWORD_CHANGE_REQUIRED', 403)
  return account
}
function liveGrant(state, grant, visited = new Set()) {
  if (!grant || grant.status !== 'active' || visited.has(grant.id)) return false
  visited.add(grant.id)
  const account = state.accounts.find(row => row.id === grant.accountId && row.status === 'active' && !row.mustChangePassword)
  if (!account) return false
  if (!grant.parentGrantId) return true
  const parent = gateState(state).grants.find(row => row.id === grant.parentGrantId && row.role === 'manager' && row.accountId === grant.createdBy)
  return liveGrant(state, parent, visited)
}
function roleIn(state, id) {
  const account = accountIn(state, id)
  if (account.isAdmin === true && account.adminRole !== 'delegated_admin' && account.role !== 'delegated_admin') return { account, role: 'admin', grant: null }
  const grant = gateState(state).grants.find(row => row.accountId === id && liveGrant(state, row))
  return { account, role: grant?.role || 'none', grant }
}
function permit(state, id, roles) {
  const identity = roleIn(state, id)
  if (!roles.includes(identity.role)) throw error('没有返校核验操作权限', 'GATE_FORBIDDEN', 403)
  return identity
}
function eligible(state, id) {
  const account = accountIn(state, id)
  if (account.schoolIdentityVerified !== true || demo(account)) throw error('仅正式且已通过实名校验的有效账号可使用返校核验码', 'GATE_IDENTITY_REQUIRED', 403)
  const conflicts = state.identityConflicts || []
  if (conflicts.some(row => row.status === 'open' && (row.accountIds?.includes(id) || (account.schoolSubjectKey && row.schoolSubjectKey === account.schoolSubjectKey)))) throw error('学校身份存在待处理的重复账号，请先处理后再使用', 'GATE_IDENTITY_CONFLICT', 403)
  if (state.accounts.some(row => row.id !== id && row.status === 'active' && ['schoolSubjectKey', 'studentIdKey', 'idCardKey'].some(key => account[key] && account[key] === row[key]))) throw error('学校身份账号不唯一，请先处理后再使用', 'GATE_IDENTITY_CONFLICT', 403)
  return account
}
const personView = account => ({ name: account.name || '', department: account.department || '', personType: account.personType || '', studentIdMasked: account.studentIdMasked || '', alumniNo: account.alumniNo || '' })
const fingerprint = account => hash(JSON.stringify([account.id, account.schoolSubjectKey || '', account.studentIdKey || '', account.idCardKey || '', account.schoolIdentityVerified, account.verificationSource || '', personView(account)]))
const operatorView = account => ({ id: account.id, name: account.name || '', username: account.username || '', department: account.department || '' })
const stationView = station => ({ id: station.id, name: station.name, description: station.description || '', status: station.status, revision: station.revision })
const grantView = (state, grant, viewer) => ({ id: grant.id, accountId: grant.accountId, role: grant.role, status: grant.status, effective: liveGrant(state, grant), revision: grant.revision, person: operatorView(state.accounts.find(row => row.id === grant.accountId) || { id: grant.accountId, name: '已删除账号' }), createdAt: grant.createdAt, revokedAt: grant.revokedAt || null, canRevoke: viewer.role === 'admin' || (grant.role === 'guard' && grant.createdBy === viewer.account.id) })
function pagination(query = {}) {
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 20)
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw error('分页参数不正确', 'GATE_INPUT_INVALID')
  return { page, pageSize }
}
function pageOf(items, query) {
  const { page, pageSize } = pagination(query)
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
}

export class GateService {
  constructor(database, { passTtlSeconds = 10, clock = Date.now } = {}) {
    this.database = database
    if (passTtlSeconds !== 10) throw new Error('Gate rotating credentials use a fixed 10-second validity window')
    this.ttl = passTtlSeconds * 1000
    this.refreshInterval = 5000
    this.clock = clock
    this.issued = new Map()
    this.latest = new Map()
  }

  async init() {
    await this.database.transaction(state => { ensure(state).passes = [] })
    return this
  }

  me(id) {
    return this.database.read(state => {
      const viewer = roleIn(state, id)
      let canIssuePass = true
      try { eligible(state, id) } catch { canIssuePass = false }
      return { role: viewer.role, canScan: ['admin', 'manager', 'guard'].includes(viewer.role), canManage: ['admin', 'manager'].includes(viewer.role), canGrantManagers: viewer.role === 'admin', canIssuePass, label: GATE_LABEL, disclaimer: '现场核对人员与身份信息后，请明确确认放行或拒绝，核验结果将保留记录。' }
    })
  }

  people(id, query = {}) {
    return this.database.read(state => {
      permit(state, id, ['admin', 'manager'])
      const needle = clean(query.query || '', 80).toLowerCase()
      return pageOf(state.accounts.filter(row => row.status === 'active' && !row.isAdmin && !demo(row) && [row.name, row.username, row.department].some(value => String(value || '').toLowerCase().includes(needle))).map(operatorView), query)
    })
  }

  staff(id, query = {}) {
    return this.database.read(state => {
      const viewer = permit(state, id, ['admin', 'manager'])
      const rows = gateState(state).grants.filter(row => viewer.role === 'admin' || row.accountId === id || (row.role === 'guard' && row.createdBy === id)).slice().reverse()
      return pageOf(rows.map(row => grantView(state, row, viewer)), query)
    })
  }

  async grant(id, input, metadata = {}) {
    const value = body(input, ['accountId', 'role'])
    if (!['manager', 'guard'].includes(value.role)) throw error('请选择保卫负责人或保安角色', 'GATE_ROLE_INVALID')
    const targetId = clean(value.accountId, 100, true)
    return this.database.transaction(state => {
      const viewer = permit(state, id, ['admin', 'manager']), gate = ensure(state)
      if (value.role === 'manager' && viewer.role !== 'admin') throw error('只有全局管理员可授权保卫负责人', 'GATE_FORBIDDEN', 403)
      const target = state.accounts.find(row => row.id === targetId && row.status === 'active')
      if (!target || target.isAdmin || demo(target) || targetId === id) throw error('只能向其他正式有效的普通账号授予核验权限', 'GATE_STAFF_TARGET_INVALID')
      if (gate.grants.some(row => row.accountId === targetId && liveGrant(state, row))) throw error('该人员已有有效核验授权，请先撤销原授权', 'GATE_STAFF_EXISTS', 409)
      // Retire ineffective historical rows, without changing any account role.
      for (const row of gate.grants.filter(row => row.accountId === targetId && row.status === 'active')) { row.status = 'revoked'; row.revokedAt = stamp(this.clock()); row.revokedBy = id; row.revision++ }
      const grant = { id: randomUUID(), accountId: targetId, role: value.role, status: 'active', revision: 1, parentGrantId: viewer.role === 'manager' ? viewer.grant.id : '', createdBy: id, createdAt: stamp(this.clock()) }
      gate.grants.push(grant)
      state.auditLogs.unshift(auditRecord('gate.staff_granted', grant.id, { ...metadata, actor: id }, { accountId: targetId, role: value.role, parentGrantId: grant.parentGrantId }))
      return grantView(state, grant, viewer)
    })
  }

  async revoke(id, grantId, metadata = {}) {
    return this.database.transaction(state => {
      const viewer = permit(state, id, ['admin', 'manager']), gate = ensure(state)
      const grant = gate.grants.find(row => row.id === grantId)
      if (!grant) throw error('核验授权不存在', 'GATE_STAFF_NOT_FOUND', 404)
      if (viewer.role !== 'admin' && (grant.role !== 'guard' || grant.createdBy !== id)) throw error('只能撤销由本人授予的保安权限', 'GATE_FORBIDDEN', 403)
      if (grant.status === 'revoked') return grantView(state, grant, viewer)
      const pending = [grant.id], changed = new Set()
      while (pending.length) {
        const currentId = pending.shift()
        if (changed.has(currentId)) continue
        changed.add(currentId)
        const current = gate.grants.find(row => row.id === currentId)
        if (current?.status === 'active') { current.status = 'revoked'; current.revokedAt = stamp(this.clock()); current.revokedBy = id; current.revision++ }
        pending.push(...gate.grants.filter(row => row.parentGrantId === currentId && row.status === 'active').map(row => row.id))
      }
      state.auditLogs.unshift(auditRecord('gate.staff_revoked', grant.id, { ...metadata, actor: id }, { accountId: grant.accountId, affected: changed.size }))
      return grantView(state, grant, viewer)
    })
  }

  stations(id, query = {}) {
    return this.database.read(state => {
      const viewer = permit(state, id, ['admin', 'manager', 'guard'])
      return { items: gateState(state).stations.filter(row => row.status === 'active' || (viewer.role !== 'guard' && String(query.includeInactive) === 'true')).map(stationView) }
    })
  }

  async saveStation(id, input, stationId = '', metadata = {}) {
    const value = body(input, stationId ? ['name', 'description', 'status', 'expectedRevision'] : ['name', 'description'])
    if (!stationId && !Object.hasOwn(value, 'name')) throw error('请填写门岗名称', 'GATE_INPUT_INVALID')
    if (Object.hasOwn(value, 'status') && !['active', 'disabled'].includes(value.status)) throw error('门岗状态不正确', 'GATE_INPUT_INVALID')
    return this.database.transaction(state => {
      permit(state, id, ['admin', 'manager'])
      const gate = ensure(state), existing = stationId && gate.stations.find(row => row.id === stationId)
      if (stationId && !existing) throw error('门岗不存在', 'GATE_STATION_NOT_FOUND', 404)
      if (existing && (!Number.isInteger(value.expectedRevision) || value.expectedRevision !== existing.revision)) throw error('门岗信息已更新，请刷新后重试', 'GATE_REVISION_CONFLICT', 409)
      const name = Object.hasOwn(value, 'name') ? clean(value.name, 80, true) : existing.name
      const description = Object.hasOwn(value, 'description') ? clean(value.description, 300) : existing?.description || ''
      if (gate.stations.some(row => row.id !== stationId && row.name.normalize('NFKC').toLowerCase() === name.normalize('NFKC').toLowerCase())) throw error('门岗名称已存在', 'GATE_STATION_EXISTS', 409)
      const station = existing || { id: randomUUID(), createdAt: stamp(this.clock()), createdBy: id, revision: 0, status: 'active' }
      Object.assign(station, { name, description, status: value.status || station.status, revision: station.revision + 1, updatedAt: stamp(this.clock()), updatedBy: id })
      if (!existing) gate.stations.push(station)
      state.auditLogs.unshift(auditRecord('gate.station_updated', station.id, { ...metadata, actor: id }, { name, status: station.status, revision: station.revision }))
      return stationView(station)
    })
  }

  prune(gate, now) {
    // Only a short scan confirmation needs durability; 5-second display changes
    // must not rewrite the JSON account database or grow a persistent pass list.
    gate.previews = gate.previews.filter(row => Date.parse(row.expiresAt) > now - 60000)
  }

  pruneIssued(now) {
    for (const [key, pass] of this.issued) if (Date.parse(pass.expiresAt) <= now) this.issued.delete(key)
    for (const [id, pass] of this.latest) if (Date.parse(pass.expiresAt) <= now) this.latest.delete(id)
  }

  async issue(id) {
    return this.database.read(state => {
      const account = eligible(state, id), now = this.clock()
      this.pruneIssued(now)
      const current = this.latest.get(id)
      const output = pass => ({ qrPayload: QR_PREFIX + pass.token, expiresAt: pass.expiresAt, ttlSeconds: this.ttl / 1000, refreshIntervalSeconds: this.refreshInterval / 1000, label: GATE_LABEL })
      const checkRevision = gateState(state).checkRevisions?.[id] || 0
      if (current && current.checkRevision === checkRevision && current.identityFingerprint === fingerprint(account) && now - Date.parse(current.createdAt) < this.refreshInterval) return output(current)
      if (this.issued.size >= 50000) throw error('核验服务繁忙，请稍后刷新', 'GATE_BUSY', 503)
      if (current?.identityFingerprint !== fingerprint(account)) for (const [key, pass] of this.issued) if (pass.accountId === id) this.issued.delete(key)
      const token = randomBytes(32).toString('base64url')
      const pass = { id: randomUUID(), accountId: id, token, tokenHash: hash(token), identityFingerprint: fingerprint(account), checkRevision, createdAt: stamp(now), expiresAt: stamp(now + this.ttl) }
      this.issued.set(pass.tokenHash, pass); this.latest.set(id, pass)
      // A caller may request repeatedly after consumption. Keep at most two
      // display frames per person, in addition to independently stored previews.
      const own = [...this.issued.values()].filter(row => row.accountId === id)
      for (const old of own.slice(0, -2)) this.issued.delete(old.tokenHash)
      return output(pass)
    })
  }

  checkPass(state, pass, now) {
    if (!pass) throw error('核验码不存在或已过期，请出示当前动态码', 'GATE_PASS_INVALID', 410)
    if ((gateState(state).checkRevisions?.[pass.accountId] || 0) !== pass.checkRevision || gateState(state).records.some(row => row.passId === pass.id)) throw error('此核验码已使用，请重新生成', 'GATE_PASS_USED', 409)
    if (Date.parse(pass.expiresAt) <= now) throw error('核验码已过期，请重新生成', 'GATE_PASS_EXPIRED', 410)
    const person = eligible(state, pass.accountId)
    if (pass.identityFingerprint !== fingerprint(person)) throw error('身份资料已更新，请重新生成核验码', 'GATE_PASS_IDENTITY_CHANGED', 409)
    return person
  }

  async preview(id, input, metadata = {}) {
    const value = body(input, ['qrPayload', 'stationId'])
    const payload = clean(value.qrPayload, 100, true), stationId = clean(value.stationId, 100, true)
    if (!/^HUFE-GATE-V1:[A-Za-z0-9_-]{43}$/.test(payload)) throw error('不是有效的平台返校核验码', 'GATE_QR_INVALID')
    return this.database.transaction(state => {
      permit(state, id, ['admin', 'manager', 'guard'])
      const gate = ensure(state), now = this.clock()
      const station = gate.stations.find(row => row.id === stationId && row.status === 'active')
      if (!station) throw error('请选择有效门岗', 'GATE_STATION_INACTIVE', 409)
      const pass = this.issued.get(hash(payload.slice(QR_PREFIX.length)))
      const person = this.checkPass(state, pass, now)
      if (person.id === id) throw error('不能核验本人的二维码，请由其他核验人员办理', 'GATE_SELF_CHECK_FORBIDDEN', 403)
      const preview = { id: randomUUID(), passId: pass.id, accountId: pass.accountId, identityFingerprint: pass.identityFingerprint, checkRevision: pass.checkRevision, guardId: id, stationId, stationRevision: station.revision, expiresAt: stamp(now + 60000), createdAt: stamp(now) }
      this.prune(gate, now)
      // A fresh preview replaces only this operator's older preview of this pass.
      gate.previews = gate.previews.filter(row => !(row.passId === pass.id && row.guardId === id))
      gate.previews.push(preview)
      state.auditLogs.unshift(auditRecord('gate.pass_previewed', pass.id, { ...metadata, actor: id }, { accountId: person.id, stationId }))
      return { previewId: preview.id, expiresAt: preview.expiresAt, person: personView(person), station: stationView(station), label: GATE_LABEL }
    })
  }

  async confirm(id, input, metadata = {}) {
    const value = body(input, ['previewId', 'decision', 'reason'])
    if (!['allow', 'deny'].includes(value.decision)) throw error('请明确选择确认通过或拒绝', 'GATE_DECISION_INVALID')
    const previewId = clean(value.previewId, 100, true)
    const reason = clean(value.reason || '', 500, value.decision === 'deny') || '现场人工确认身份核验通过'
    return this.database.transaction(state => {
      const viewer = permit(state, id, ['admin', 'manager', 'guard']), gate = ensure(state), now = this.clock()
      const preview = gate.previews.find(row => row.id === previewId && row.guardId === id)
      if (!preview) throw error('核验预览不存在或不属于当前操作人员', 'GATE_PREVIEW_NOT_FOUND', 404)
      if (Date.parse(preview.expiresAt) <= now) throw error('核验预览已过期，请重新扫码', 'GATE_PREVIEW_EXPIRED', 410)
      const station = gate.stations.find(row => row.id === preview.stationId && row.status === 'active')
      if (!station) throw error('当前门岗已停用，不能确认核验', 'GATE_STATION_INACTIVE', 409)
      if (station.revision !== preview.stationRevision) throw error('门岗信息已更新，请重新扫码确认', 'GATE_STATION_CHANGED', 409)
      if (!preview.accountId || !preview.identityFingerprint) throw error('核验会话版本已更新，请重新扫码', 'GATE_PREVIEW_EXPIRED', 410)
      if ((gate.checkRevisions[preview.accountId] || 0) !== preview.checkRevision || gate.records.some(row => row.passId === preview.passId)) throw error('此核验会话对应的身份已完成核验，请重新扫码', 'GATE_PASS_USED', 409)
      const person = eligible(state, preview.accountId)
      if (preview.identityFingerprint !== fingerprint(person)) throw error('身份资料已更新，请重新扫码核验', 'GATE_PASS_IDENTITY_CHANGED', 409)
      if (person.id === id) throw error('不能核验本人的二维码，请由其他核验人员办理', 'GATE_SELF_CHECK_FORBIDDEN', 403)
      const record = { id: randomUUID(), passId: preview.passId, accountId: person.id, person: personView(person), operator: operatorView(viewer.account), operatorRole: viewer.role, station: stationView(station), decision: value.decision, reason, createdAt: stamp(now), label: GATE_LABEL, ...(metadata.trace ? { auditTrace: structuredClone(metadata.trace) } : {}) }
      gate.records.push(record)
      gate.checkRevisions[person.id] = (gate.checkRevisions[person.id] || 0) + 1
      state.auditLogs.unshift(auditRecord('gate.check_confirmed', record.id, { ...metadata, actor: id }, { accountId: person.id, stationId: station.id, stationName: station.name, decision: value.decision, reason }))
      return this.recordView(record, viewer)
    })
  }

  recordView(record, viewer) {
    const { passId, auditTrace, ...safe } = record
    return { ...safe, ...(['admin', 'manager'].includes(viewer.role) && auditTrace ? { auditTrace } : {}) }
  }

  records(id, query = {}) {
    return this.database.read(state => {
      const viewer = permit(state, id, ['admin', 'manager', 'guard'])
      const needle = clean(query.query || '', 80).toLowerCase()
      if (query.decision && !['allow', 'deny'].includes(query.decision)) throw error('核验结果筛选不正确', 'GATE_INPUT_INVALID')
      for (const key of ['startDate', 'endDate']) if (query[key]) {
        const raw = String(query[key])
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString().slice(0, 10) !== raw) throw error('记录日期格式不正确', 'GATE_INPUT_INVALID')
      }
      if (query.startDate && query.endDate && query.startDate > query.endDate) throw error('开始日期不能晚于结束日期', 'GATE_INPUT_INVALID')
      let rows = gateState(state).records.filter(row => (viewer.role !== 'guard' || row.operator.id === id) && (!query.stationId || row.station.id === query.stationId) && (!query.decision || row.decision === query.decision) && [row.person.name, row.operator.name, row.station.name, row.reason].some(value => String(value || '').toLowerCase().includes(needle)))
      for (const [key, predicate] of [['startDate', (date, edge) => date >= edge], ['endDate', (date, edge) => date <= edge]]) if (query[key]) {
        const raw = String(query[key])
        const edge = Date.parse(raw + (key === 'startDate' ? 'T00:00:00+08:00' : 'T23:59:59.999+08:00'))
        rows = rows.filter(row => predicate(Date.parse(row.createdAt), edge))
      }
      return pageOf(rows.slice().reverse().map(row => this.recordView(row, viewer)), query)
    })
  }
}
