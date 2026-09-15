import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { deviceInfo, normalizeIp } from './metadata.js'
import { GeoLocator } from './geo-location.js'
import { openDatabase } from '../storage/database.js'
import { canonicalJson } from '../storage/mysql-snapshot.js'

const clean = (value, max = 120) => String(value || '').replace(/[\r\n\0]/g, '').slice(0, max)
const safeId = value => /^[a-zA-Z0-9_-]{1,120}$/.test(String(value || '')) ? String(value) : ''
const safeCode = value => /^[A-Z][A-Z0-9_]{0,99}$/.test(String(value || '')) ? String(value) : ''
const auditError = (code, message) => Object.assign(new Error(message), { code, statusCode: 503 })
const nouns = { 'community-posts': '湖财圈动态', comments: '评论', 'community-media': '校园墙图片', 'community-highlights': '校园墙轮播', submissions: '业务申请', applications: '申请与评论', organizations: '校友组织', albums: '组织相册', 'album-photos': '组织照片', photos: '照片', 'manual-verifications': '人工认证', 'manual-verification': '人工认证', 'school-auth-config': '学校认证配置', 'audit-logs': '操作追溯日志', accounts: '平台账号', inbox: '站内消息', announcements: '公告', jobs: '招聘', mentors: '导师', 'alumni-enterprises': '校友企业', directory: '校友名录', materials: '证明材料', media: '图片', dashboard: '后台概览', content: '官网资讯' }
function operationLabel(route, method, params = {}) {
  if (route.includes('/accounts/') && route.includes('/dossier')) {
    if (route.includes('/records/')) return ({GET:'查看学校内部人员档案记录',POST:'新增学校内部人员档案记录',PUT:'修改学校内部人员档案记录',DELETE:'归档学校内部人员档案记录'})[method] || '维护学校内部人员档案记录'
    if (route.endsWith('/student-number')) return '管理员按原因查看完整学工号'
    if (route.endsWith('/profile')) return '管理员维护人员补充档案'
    if (route.includes('/followups')) return method === 'POST' ? '管理员新增人员跟进记录' : method === 'PATCH' ? '管理员更新人员跟进状态' : '管理员查看人员跟进记录'
    return '管理员查看人员详情档案'
  }
  if (route.includes('/admin/modules')) return ['GET','HEAD'].includes(method) ? '查看系统模块启用配置' : '管理员启用或关闭业务模块'
  if(route.startsWith('/api/v1/gate/')){
    if(route.endsWith('/passes'))return '生成平台返校动态身份核验码'
    if(route.endsWith('/scans/preview'))return '保安扫码预览返校身份'
    if(route.endsWith('/scans/confirm'))return '保安确认返校核验结果'
    if(route.endsWith('/records'))return '查看返校身份核验记录'
    if(route.includes('/staff'))return ({GET:'查看保卫人员授权',POST:'授予保卫人员核验权限',DELETE:'撤销保卫人员核验权限'})[method]||'管理保卫人员授权'
    if(route.includes('/stations'))return ['GET','HEAD'].includes(method)?'查看返校核验门岗':'管理返校核验门岗'
    if(route.endsWith('/people'))return '查询待授权保卫人员'
    return '查看本人返校核验权限'
  }
  if(route.startsWith('/api/v1/admin/chat/')&&route.endsWith('/owner')&&method==='PUT')return '管理员指定学籍群群主'
  if(route.startsWith('/api/v1/chat/conversations/')&&route.endsWith('/dissolve')&&method==='POST')return '群主解散自建群聊'
  if(route.startsWith('/api/v1/chat/conversations/')&&route.endsWith('/leave')&&method==='POST')return '成员退出自建群聊'
  if(route.startsWith('/api/v1/admin/chat/'))return method==='PATCH'?(route.includes('/messages/')?'管理对话消息可见性':'停用或恢复对话'):route.includes('/files/')?'管理员申请读取聊天附件':route.includes('/messages')?'管理员查看聊天记录':'管理员查看全部会话'
  if(route.includes('/chat/')||route.includes('/chat-stickers')){
    const noun=route.includes('/messages')?'对话消息':route.includes('/stickers')||route.includes('chat-stickers')?'表情包':route.includes('/uploads')?'聊天附件上传':route.includes('/files')?'聊天附件':route.includes('/people')?'实名联系人':'私聊与群聊'
    return ({GET:'查看',HEAD:'查看',POST:'提交',PUT:'保存',PATCH:'更新',DELETE:'取消'})[method]+noun
  }
  if(route.includes('/sensitive-words'))return '管理敏感词库'
  if(route==='/api/v1/me/profile')return method==='GET'?'查看本人资料':'更新本人资料'
  if (route.endsWith('/auth/login')) return '平台账号登录'
  if (route.endsWith('/auth/logout')) return '退出平台账号'
  if (route.endsWith('/auth/register')) return '注册平台账号'
  if (route.endsWith('/auth/change-password')) return '修改账号密码'
  if (route.startsWith('/api/v1/admin/accounts/') && route.endsWith('/password')) return '全局管理员修改单个账号平台密码'
  if (route.startsWith('/api/v1/admin/accounts/') && route.endsWith('/manual-verification')) return '全局管理员完成人员人工实名校验'
  if (route === '/api/v1/admin/accounts/alumni-numbers/preview') return '预览所有已实名人员校友编号下发范围'
  if (route === '/api/v1/admin/accounts/alumni-numbers/apply') return '全局管理员批量下发校友编号'
  if (route.startsWith('/api/v1/admin/accounts/') && route.endsWith('/alumni-number')) return '全局管理员下发单个人员校友编号'
  if (route.startsWith('/api/v1/admin/business/giving-projects/') && route.endsWith('/certificate-template')) return '保存公益项目专属证书模板设计'
  if (/\/auth\/(registration|sso)\//.test(route)) return '学校实名校验流程'
  const parts = route.split('/').map(part => part.startsWith(':') ? params[part.slice(1)] : part)
  const noun = [...parts].reverse().find(part => Object.hasOwn(nouns, part))
  const verb = { GET: '查看', HEAD: '查看', POST: '提交操作：', PUT: '保存', PATCH: '更新', DELETE: '删除或撤回' }[method] || '访问'
  return `${verb}${noun ? nouns[noun] : '平台服务'}`
}

export class AuditService {
  constructor(database, config, { openStore = openDatabase } = {}) {
    this.database = database
    this.config = config
    this.openStore = openStore
    this.dir = path.join(path.dirname(config.dataFile), 'audit-requests')
    this.geo = new GeoLocator(config.auditGeoDir || path.join(path.dirname(config.dataFile), 'ip-region'))
    this.queue = Promise.resolve(); this.lastErrorAt = ''; this.lastSuccessAt = ''; this.failures = 0; this.damagedRecords = 0
    this.unavailable = false; this.recoveryPending = 0; this.recoveredRequests = 0; this.recoveryUncertainFailures = 0; this.lastRecoveryAt = ''
  }
  async init() {
    try {
      if (this.config.databaseDriver === 'mysql') {
        this.requestDatabase = await this.openStore(this.config, { namespace: 'audit' })
        if (!this.requestDatabase.read(state => Array.isArray(state.requests))) throw auditError('MYSQL_AUDIT_NOT_MIGRATED', 'MySQL 审计记录尚未完成迁移，请先校验审计数据')
        await this.recoverRequests()
      } else await fs.mkdir(this.dir, { recursive: true, mode: 0o700 })
      await this.geo.init()
    } catch (error) {
      this.unavailable = this.config.databaseDriver === 'mysql'
      await this.requestDatabase?.close?.()
      throw error
    }
    return this
  }
  markFailure() { this.lastErrorAt = new Date().toISOString(); this.failures++ }
  assertAvailable(request) {
    const route = String(request.routeOptions?.url || request.raw?.url || request.url || '').split('?')[0]
    if (this.config.databaseDriver !== 'mysql' || request.method === 'OPTIONS' || !route.startsWith('/api/v1/') || route === '/api/v1/health') return
    if (!this.unavailable) {
      try { this.requestDatabase?.assertReady?.() }
      catch { this.unavailable = true; this.markFailure() }
    }
    if (this.unavailable) {
      // onSend must not turn this rejection into another failed audit append.
      request.auditUnavailable = true
      throw auditError('AUDIT_STORAGE_UNAVAILABLE', '审计存储暂不可用，新的操作已暂停，请联系管理员恢复服务')
    }
  }
  async appendRequest(log) {
    if (this.requestDatabase.append) await this.requestDatabase.append('requests', log)
    else await this.requestDatabase.transaction(state => { state.requests.push(log) })
  }
  recoveryQueue(state) {
    if (state.auditRecoveryRequests === undefined) return []
    if (!Array.isArray(state.auditRecoveryRequests)) throw auditError('AUDIT_RECOVERY_INVALID', '审计恢复队列结构无效，已暂停启动')
    return state.auditRecoveryRequests
  }
  async persistRecovery(log, request) {
    try {
      const added = await this.database.transaction(state => {
        const queue = this.recoveryQueue(state), existing = queue.find(item => item.id === log.id)
        if (existing) {
          if (canonicalJson(existing.request) !== canonicalJson(log)) throw auditError('AUDIT_RECOVERY_CONFLICT', '审计恢复记录编号冲突')
          return false
        }
        if (state.auditRecoveryRequests === undefined) state.auditRecoveryRequests = queue
        queue.push({ id: log.id, request: log, queuedAt: new Date().toISOString() })
        return true
      })
      if (added) this.recoveryPending++
      request.log?.error?.({ requestId: log.id }, 'audit persistence failed; request saved in MySQL recovery queue; subsequent API operations blocked')
    } catch {
      this.recoveryUncertainFailures++
      // An acknowledgement failure does not prove either COMMIT was rolled
      // back. The audit row or recovery row may already be durable. Do not claim
      // success or irrecoverable loss; retain the requestId for manual checking.
      request.log?.error?.({ requestId: log.id }, 'audit persistence and MySQL recovery queue durability unknown; manual verification required; subsequent API operations blocked')
    }
  }
  async recoverRequests() {
    const pending = this.database.read(state => this.recoveryQueue(state))
    this.recoveryPending = pending.length
    if (!pending.length) return
    const ids = new Set()
    for (const item of pending) {
      if (!item || typeof item.id !== 'string' || !item.id || !item.request || item.request.id !== item.id || typeof item.request.action !== 'string' || !Number.isFinite(Date.parse(item.request.createdAt)) || ids.has(item.id)) throw auditError('AUDIT_RECOVERY_INVALID', '审计恢复队列记录无效，已暂停启动')
      ids.add(item.id)
    }
    const existing = new Map()
    this.requestDatabase.read(state => {
      for (const log of state.requests) if (ids.has(log.id)) {
        if (existing.has(log.id)) throw auditError('AUDIT_RECOVERY_CONFLICT', '审计恢复记录编号重复，已暂停启动')
        existing.set(log.id, log)
      }
    })
    for (const item of pending) {
      const saved = existing.get(item.id)
      if (saved && canonicalJson(saved) !== canonicalJson(item.request)) throw auditError('AUDIT_RECOVERY_CONFLICT', '已提交审计与恢复队列不一致，已暂停启动')
      if (!saved) await this.appendRequest(item.request)
      // COMMIT may have succeeded before a lost reply or before an interrupted
      // outbox delete. Restart compares the full identical event and never adds
      // it twice; a conflict preserves the outbox and prevents startup.
      await this.database.transaction(state => {
        const queue = this.recoveryQueue(state), current = queue.find(row => row.id === item.id)
        if (!current || canonicalJson(current.request) !== canonicalJson(item.request)) throw auditError('AUDIT_RECOVERY_CONFLICT', '审计恢复队列在恢复过程中发生变化，已暂停启动')
        state.auditRecoveryRequests = queue.filter(row => row.id !== item.id)
      })
      this.recoveryPending--; this.recoveredRequests++; this.lastRecoveryAt = new Date().toISOString()
    }
  }
  begin(request) {
    const ip = normalizeIp(request.ip), peerIp = normalizeIp(request.raw.socket.remoteAddress)
    const userAgent = clean(request.headers['user-agent'], 500)
    request.auditTrace = { requestId: randomUUID(), startedAt: new Date().toISOString(), ip, peerIp, ipSource: ip && peerIp && ip !== peerIp ? 'trusted-proxy' : 'socket', userAgent, device: deviceInfo(userAgent), location: this.geo.lookup(ip) }
  }
  async capture(request, reply) {
    const route = request.routeOptions?.url || (String(request.raw.url || '').startsWith('/api/v1/') ? '/api/v1/[unmatched]' : '')
    if (!route.startsWith('/api/v1/') || request.method === 'OPTIONS' || route === '/api/v1/health' || request.auditUnavailable) return
    if (!request.auditTrace) this.begin(request)
    const trace = request.auditTrace, user = request.user
    const result = [401,403,429].includes(reply.statusCode) ? 'blocked' : request.auditFailure || reply.statusCode >= 400 ? 'failure' : 'success'
    const targetIds = route.startsWith('/api/v1/auth/') ? [] : Object.entries(request.params || {}).filter(([key]) => /(?:^id$|Id$)/.test(key)).map(([, value]) => safeId(value)).concat((request.auditTargetIds||[]).map(safeId)).filter(Boolean)
    const log = { id: trace.requestId, requestId: trace.requestId, action: ['GET','HEAD'].includes(request.method) ? 'request.accessed' : 'request.changed', kind: ['GET','HEAD'].includes(request.method) ? 'access' : 'operation', targetId: targetIds.at(-1) || '', targetIds, actor: user?.id || 'visitor', createdAt: trace.startedAt, ip: trace.ip, userAgent: trace.userAgent, trace: { ...trace, ...(request.auditTicketScope?{authorizationSource:request.auditTicketScope}:{}), actorAccountId: user?.id || '', actorName: clean(user?.name), actorUsername: clean(user?.username), method: request.method, route, statusCode: reply.statusCode, result, errorCode: safeCode(request.auditFailure) || (reply.statusCode >= 400 ? `HTTP_${reply.statusCode}` : ''), durationMs: Math.max(0, Date.now() - Date.parse(trace.startedAt)) }, details: { label: operationLabel(route, request.method, request.params) } }
    const task = this.queue.then(async () => {
      if (this.requestDatabase) {
        if (this.unavailable) { await this.persistRecovery(log, request); return }
        try { await this.appendRequest(log); this.lastSuccessAt = new Date().toISOString() }
        catch {
          // Keep the already committed business response intact. Block new
          // requests immediately, and preserve this/in-flight events in the
          // independent main MySQL namespace, never in a JSON fallback.
          this.unavailable = true; this.markFailure()
          await this.persistRecovery(log, request)
        }
        return
      }
      const file = await fs.open(path.join(this.dir, `${log.createdAt.slice(0,10)}.jsonl`), 'a+', 0o600)
      try {
        const { size } = await file.stat()
        if (size) {
          const last = Buffer.alloc(1); await file.read(last, 0, 1, size - 1)
          // 保留中断写入的原件，并隔开残缺尾行，避免下一条完整记录被拼接污染。
          if (last[0] !== 10) await file.writeFile('\n')
        }
        await file.writeFile(JSON.stringify(log) + '\n', 'utf8')
      } finally { await file.close() }
      this.lastSuccessAt = new Date().toISOString()
    })
    this.queue = task.catch(() => {})
    try { await task } catch {
      this.markFailure()
      request.log.error({ requestId: log.requestId }, 'audit persistence failed')
    }
  }
  status() {
    const healthy = !this.unavailable && this.failures === 0 && this.damagedRecords === 0 && this.recoveryPending === 0 && this.recoveryUncertainFailures === 0
    return { healthy, degraded: !healthy, available: !this.unavailable, failures: this.failures, damagedRecords: this.damagedRecords, recoveryPending: this.recoveryPending, recoveredRequests: this.recoveredRequests, recoveryUncertainFailures: this.recoveryUncertainFailures, recoveryDurability: this.recoveryUncertainFailures ? 'unknown-manual-verification-required' : this.recoveryPending ? 'queued' : 'no-pending-recovery',
      // Deprecated compatibility alias: counts unconfirmed outcomes, NOT proven
      // permanent loss. Consumers should use recoveryUncertainFailures instead.
      unrecoverableFailures: this.recoveryUncertainFailures, lastRecoveryAt: this.lastRecoveryAt, lastErrorAt: this.lastErrorAt, lastSuccessAt: this.lastSuccessAt, location: this.geo.status() }
  }
  async close() { await this.queue; await this.requestDatabase?.close?.() }
  async list(query = {}) {
    await this.queue
    const page = Math.min(10000, Math.max(1, Math.trunc(Number(query.page) || 1))), pageSize = Math.min(100, Math.max(1, Math.trunc(Number(query.pageSize || query.limit) || 30)))
    const needle = clean(query.query, 200).trim().toLowerCase(), target = clean(query.targetId), requestId = clean(query.requestId), actor = clean(query.actor), action = clean(query.action), kind = clean(query.kind), result = clean(query.result)
    // 后台日期按学校所在地北京时间解释，不依赖容器的 UTC / 本机时区。
    const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? Date.parse(`${query.from}T00:00:00.000+08:00`) : NaN
    const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? Date.parse(`${query.to}T23:59:59.999+08:00`) : NaN
    const legacy = this.database.read(state => ({ logs: state.auditLogs, accounts: state.accounts.map(({id,name,username}) => ({id,name,username})), relations: (state.business?.submissions || []).map(({id,resourceId}) => ({id,resourceId})) }))
    const accounts = new Map(legacy.accounts.map(account => [account.id, account]))
    const relations = new Map(legacy.relations.map(item => [item.id,item.resourceId]))
    const byRequest = new Map()
    for (const log of legacy.logs) if (log.requestId) { if (!byRequest.has(log.requestId)) byRequest.set(log.requestId, []); byRequest.get(log.requestId).push(log) }
    const seen = new Set(), selected = [], actions = new Map(); let total = 0, damagedRecords = 0
    const accept = log => {
      const account = accounts.get(log.actor) || (['account.local_login','account.registered'].includes(log.action) ? accounts.get(log.targetId) : null)
      log = { ...log, kind: log.kind || 'operation', trace: { actorAccountId: account?.id || '', actorName: account?.name || '', actorUsername: account?.username || '', ...log.trace } }
      const key = `${log.action}::${log.details?.resource || ''}::${log.details?.type || ''}::${log.action.startsWith('request.') ? log.details?.label || '' : ''}`
      if (!actions.has(key)) actions.set(key, { key, action: log.action, details: log.details || {} })
      if (requestId && log.requestId !== requestId) return
      if (actor && log.actor !== actor && log.trace.actorAccountId !== actor) return
      if (action && key !== action) return
      if (kind && log.kind !== kind) return
      if (result && (log.trace.result || 'unknown') !== result) return
      if (target && ![log.targetId, relations.get(log.targetId), log.details?.resourceId, log.details?.organizationId, ...(log.targetIds || [])].includes(target)) return
      const date = Date.parse(log.createdAt)
      if (Number.isFinite(from) && date < from || Number.isFinite(to) && date > to) return
      if (needle && ![log.actor, log.targetId, log.requestId, log.ip, log.action, log.trace.actorName, log.trace.actorUsername, log.trace.location?.label, log.trace.device?.browser, log.details?.label].some(value => String(value || '').toLowerCase().includes(needle))) return
      total++; selected.push(log)
      if (selected.length > page * pageSize + 1000) { selected.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)); selected.length = page * pageSize }
    }
    const visitRequest = entry => {
      const linked = byRequest.get(entry.requestId)
      if (linked?.length) for (const event of linked) { seen.add(event.id); accept({ ...event, targetIds: entry.targetIds, trace: { ...event.trace, ...entry.trace } }) }
      else accept(entry)
    }
    if (this.requestDatabase) {
      // The explicit migration imports historical JSONL before cutover. After
      // cutover SQL is authoritative; archives are not re-read or double-counted.
      for (const entry of this.requestDatabase.read(state => state.requests)) visitRequest(entry)
    } else {
      const files = (await fs.readdir(this.dir)).filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort().reverse()
      for (const file of files) {
        const lines = createInterface({ input: createReadStream(path.join(this.dir, file)), crlfDelay: Infinity })
        for await (const line of lines) {
          if (!line.trim()) continue
          let entry
          try {
            entry = JSON.parse(line)
            if (!entry || typeof entry.id !== 'string' || typeof entry.action !== 'string' || typeof entry.createdAt !== 'string') throw new Error('invalid record')
          } catch { damagedRecords++; continue }
          visitRequest(entry)
        }
      }
    }
    for (const event of legacy.logs) if (!seen.has(event.id)) accept(event)
    this.damagedRecords = damagedRecords
    selected.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    return { items: selected.slice((page-1)*pageSize, page*pageSize), total, page, pageSize, actions: [...actions.values()], status: this.status() }
  }
}
