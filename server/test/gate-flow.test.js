import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { GateService } from '../src/gate/service.js'
import { JsonDatabase } from '../src/storage/json-database.js'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

const account = (id, extra = {}) => ({ id, username: `gate_${id}`, name: `核验测试${id}`, status: 'active', personType: 'alumni', department: '测试学院', schoolIdentityVerified: true, schoolSubjectKey: `gate-identity-${id}`, verificationSource: 'school-registration-check', studentIdMasked: '2022****01', studentIdDisplay: '不应公开的完整学号', passwordHash: '不应公开的密码哈希', idCardKey: `私有证件-${id}`, ...extra })
const accounts = () => [account('admin', { isAdmin: true }), account('manager', { schoolIdentityVerified: false, accountSource: 'admin_provisioned' }), account('guard1', { schoolIdentityVerified: false, accountSource: 'admin_provisioned' }), account('guard2', { schoolIdentityVerified: false }), account('otherManager', { schoolIdentityVerified: false }), account('alice'), account('bob'), account('outsider'), account('delegate', { adminRole: 'delegated_admin', adminPermissions: ['gate'] }), account('temp', { mustChangePassword: true }), account('demo', { localDevelopmentOnly: true }), account('inactive', { status: 'suspended' })]
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-gate-qa-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'data.json'), db = await new JsonDatabase(file).init()
  await db.transaction(state => { state.accounts = accounts() })
  let now = Date.parse('2026-09-12T02:00:00.000Z')
  const gate = await new GateService(db, { clock: () => now }).init()
  const manager = await gate.grant('admin', { accountId: 'manager', role: 'manager' })
  const guard1 = await gate.grant('manager', { accountId: 'guard1', role: 'guard' })
  const guard2 = await gate.grant('admin', { accountId: 'guard2', role: 'guard' })
  const station = await gate.saveStation('manager', { name: '南门核验岗', description: '现场人工核验，不自动操作门禁' })
  const issue = () => gate.issue('alice')
  const preview = async (who = 'guard1', qr = null) => gate.preview(who, { qrPayload: qr || (await issue()).qrPayload, stationId: station.id })
  const confirm = (who, previewId, decision = 'allow', reason = '现场人员确认') => gate.confirm(who, { previewId, decision, reason })
  return { dir, file, db, gate, manager, guard1, guard2, station, issue, preview, confirm, advance: value => { now += value } }
}

test('返校核验独立角色：非实名保安能授权但不获平台管理权，负责人限授保安并级联撤权', async t => {
  const f = await fixture(t), { gate } = f
  assert.equal(gate.me('guard1').role, 'guard')
  assert.equal(gate.me('guard1').canIssuePass, false)
  assert.equal(gate.me('manager').canGrantManagers, false)
  for (const id of ['outsider', 'delegate']) {
    assert.throws(() => gate.records(id), { code: 'GATE_FORBIDDEN' })
    await assert.rejects(() => gate.grant(id, { accountId: 'bob', role: 'guard' }), { code: 'GATE_FORBIDDEN' })
  }
  await assert.rejects(() => gate.grant('manager', { accountId: 'bob', role: 'manager' }), { code: 'GATE_FORBIDDEN' })
  for (const id of ['manager', 'admin', 'demo', 'inactive']) await assert.rejects(() => gate.grant('manager', { accountId: id, role: 'guard' }), { code: 'GATE_STAFF_TARGET_INVALID' })
  await assert.rejects(() => gate.revoke('manager', f.guard2.id), { code: 'GATE_FORBIDDEN' })
  assert.equal(gate.staff('manager').items.find(row => row.id === f.manager.id).canRevoke, false)
  assert.equal(gate.staff('manager').items.find(row => row.id === f.guard1.id).canRevoke, true)
  assert.equal(f.db.read(state => state.accounts.find(row => row.id === 'guard1').isAdmin), undefined)
  const preview = await f.preview()
  await gate.revoke('admin', f.manager.id)
  assert.equal(gate.me('manager').role, 'none')
  assert.equal(gate.me('guard1').role, 'none')
  assert.equal(gate.me('guard2').role, 'guard')
  await assert.rejects(() => f.confirm('guard1', preview.previewId), { code: 'GATE_FORBIDDEN' })
  assert.equal(f.db.read(state => state.gate.grants.find(row => row.id === f.guard1.id).status), 'revoked')
  assert.ok(gate.people('admin').items.every(row => !['admin', 'demo', 'inactive'].includes(row.id)))
  await f.db.transaction(state => { state.accounts.find(row => row.id === 'delegate').isAdmin = true })
  assert.equal(gate.me('delegate').role, 'none')
  await assert.rejects(() => gate.grant('delegate', { accountId: 'bob', role: 'manager' }), { code: 'GATE_FORBIDDEN' })
})

test('核验码每5秒轮换且仅10秒有效，不含身份明文，实名撤销/模拟/身份冲突均拦截', async t => {
  const f = await fixture(t), pass = await f.issue()
  assert.match(pass.qrPayload, /^HUFE-GATE-V1:[A-Za-z0-9_-]{43}$/)
  assert.equal(pass.ttlSeconds, 10)
  assert.equal(pass.refreshIntervalSeconds, 5)
  assert.equal(pass.label, '平台返校身份核验')
  assert.doesNotMatch(JSON.stringify(pass), /alice|测试|2022|schoolSubjectKey|idCard/)
  assert.ok(!(await fs.readFile(f.file, 'utf8')).includes(pass.qrPayload.slice('HUFE-GATE-V1:'.length)))
  for (const who of ['guard1', 'demo', 'inactive', 'temp']) await assert.rejects(() => f.gate.issue(who))
  assert.equal((await f.issue()).qrPayload, pass.qrPayload)
  f.advance(5000)
  assert.notEqual((await f.issue()).qrPayload, pass.qrPayload)
  await f.preview('guard1', pass.qrPayload)
  f.advance(5001)
  await assert.rejects(() => f.preview('guard1', pass.qrPayload), { code: 'GATE_PASS_EXPIRED' })
  const changed = await f.issue()
  await f.db.transaction(state => { state.accounts.find(row => row.id === 'alice').name = '学校更新了姓名' })
  await assert.rejects(() => f.preview('guard1', changed.qrPayload), { code: 'GATE_PASS_IDENTITY_CHANGED' })
  await f.db.transaction(state => state.identityConflicts.push({ status: 'open', accountIds: ['alice'] }))
  assert.equal(f.gate.me('alice').canIssuePass, false)
  await assert.rejects(() => f.issue(), { code: 'GATE_IDENTITY_CONFLICT' })
  await f.db.transaction(state => { state.accounts.find(row => row.id === 'bob').developmentSchoolIdentityFixture = true })
  await assert.rejects(() => f.gate.issue('bob'), { code: 'GATE_IDENTITY_REQUIRED' })
  await f.db.transaction(state => { state.identityConflicts = [] })
  const verifiedPreview = await f.preview()
  await f.db.transaction(state => { state.accounts.find(row => row.id === 'alice').studentIdKey = 'changed-with-identical-masked-suffix' })
  await assert.rejects(() => f.confirm('guard1', verifiedPreview.previewId), { code: 'GATE_PASS_IDENTITY_CHANGED' })
})

test('扫码预览不放行且只向有效保安显示最小身份，确认绑定当前保安而非只凭previewId', async t => {
  const f = await fixture(t), pass = await f.issue(), preview = await f.preview('guard1', pass.qrPayload)
  assert.equal(preview.person.name, '核验测试alice')
  assert.equal(preview.station.name, '南门核验岗')
  assert.doesNotMatch(JSON.stringify(preview), /passwordHash|studentIdDisplay|不应公开|idCardKey|schoolSubjectKey|accountId|phone|personalProfile/)
  assert.equal(f.gate.records('guard1').total, 0)
  assert.equal(f.db.read(state => state.gate.passes.length), 0)
  assert.equal(f.db.read(state => state.gate.previews.length), 1)
  await assert.rejects(() => f.preview('outsider', pass.qrPayload), { code: 'GATE_FORBIDDEN' })
  await assert.rejects(() => f.confirm('guard2', preview.previewId), { code: 'GATE_PREVIEW_NOT_FOUND' })
  await assert.rejects(() => f.gate.preview('guard1', { qrPayload: pass.qrPayload, stationId: f.station.id, person: { name: '伪造' } }), { code: 'GATE_INPUT_INVALID' })
  await assert.rejects(() => f.gate.preview('guard1', { qrPayload: 'not-a-platform-qr', stationId: f.station.id }), { code: 'GATE_QR_INVALID' })
  await assert.rejects(() => f.gate.preview('guard1', { qrPayload: pass.qrPayload, stationId: 'non-existent' }), { code: 'GATE_STATION_INACTIVE' })
  await f.db.transaction(state => { state.accounts.find(row => row.id === 'guard1').schoolIdentityVerified = true })
  const ownPass = await f.gate.issue('guard1')
  await assert.rejects(() => f.preview('guard1', ownPass.qrPayload), { code: 'GATE_SELF_CHECK_FORBIDDEN' })
  const peerPreview = await f.preview('guard2', ownPass.qrPayload)
  // A malformed historic preview cannot bypass the independent confirmation check.
  await f.db.transaction(state => { state.gate.previews.find(row => row.id === peerPreview.previewId).guardId = 'guard1' })
  await assert.rejects(() => f.confirm('guard1', peerPreview.previewId), { code: 'GATE_SELF_CHECK_FORBIDDEN' })
})

test('并发确认只有一次落账，拒绝同样消费凭证，所有重放被拦截', async t => {
  const f = await fixture(t), pass = await f.issue()
  const [one, two] = await Promise.all([f.preview('guard1', pass.qrPayload), f.preview('guard2', pass.qrPayload)])
  const result = await Promise.allSettled([f.confirm('guard1', one.previewId), f.confirm('guard2', two.previewId)])
  assert.equal(result.filter(row => row.status === 'fulfilled').length, 1)
  assert.equal(result.find(row => row.status === 'rejected').reason.code, 'GATE_PASS_USED')
  assert.equal(f.gate.records('admin').total, 1)
  await assert.rejects(() => f.confirm('guard1', one.previewId), { code: 'GATE_PASS_USED' })
  const denied = await f.preview()
  await assert.rejects(() => f.confirm('guard1', denied.previewId, 'deny', ''), { code: 'GATE_INPUT_INVALID' })
  assert.equal((await f.confirm('guard1', denied.previewId, 'deny', '证件与现场人员不符')).decision, 'deny')
  await assert.rejects(() => f.confirm('guard1', denied.previewId), { code: 'GATE_PASS_USED' })
})

test('确认实时复核学校实名、账号、门岗、授权和有效期，排队撤权不能被旧预览绕过', async t => {
  const f = await fixture(t)
  const expired = await f.preview()
  f.advance(61000)
  await assert.rejects(() => f.confirm('guard1', expired.previewId), { code: 'GATE_PREVIEW_EXPIRED' })
  const qr = await f.issue(); f.advance(121000)
  await assert.rejects(() => f.preview('guard1', qr.qrPayload), { code: 'GATE_PASS_EXPIRED' })
  const renamed = await f.preview()
  const station = await f.gate.saveStation('manager', { name: '南门现场岗', expectedRevision: 1 }, f.station.id)
  await assert.rejects(() => f.confirm('guard1', renamed.previewId), { code: 'GATE_STATION_CHANGED' })
  const inactive = await f.preview()
  await f.gate.saveStation('admin', { status: 'disabled', expectedRevision: station.revision }, f.station.id)
  await assert.rejects(() => f.confirm('guard1', inactive.previewId), { code: 'GATE_STATION_INACTIVE' })
  await f.gate.saveStation('admin', { status: 'active', expectedRevision: 3 }, f.station.id)
  for (const [field, value, code] of [['schoolIdentityVerified', false, 'GATE_IDENTITY_REQUIRED'], ['status', 'suspended', 'ACCOUNT_INACTIVE'], ['mustChangePassword', true, 'PASSWORD_CHANGE_REQUIRED']]) {
    const preview = await f.preview()
    const before = f.db.read(state => state.accounts.find(row => row.id === 'alice')[field])
    await f.db.transaction(state => { state.accounts.find(row => row.id === 'alice')[field] = value })
    await assert.rejects(() => f.confirm('guard1', preview.previewId), { code })
    await f.db.transaction(state => { state.accounts.find(row => row.id === 'alice')[field] = before })
  }
  const last = await f.preview()
  const revocation = f.gate.revoke('admin', f.manager.id)
  const lateConfirm = f.confirm('guard1', last.previewId)
  await revocation
  await assert.rejects(() => lateConfirm, { code: 'GATE_FORBIDDEN' })
  assert.equal(f.gate.records('admin').total, 0)
})

test('核验记录分页和筛选真实完整，保安只能看本人，保卫负责人可看审计来源但二维码不留明文', async t => {
  const f = await fixture(t)
  for (let index = 0; index < 23; index++) {
    const who = index % 2 ? 'guard2' : 'guard1', preview = await f.preview(who)
    await f.gate.confirm(who, { previewId: preview.previewId, decision: index % 2 ? 'deny' : 'allow', reason: '现场核验记录' + index }, { ip: '192.0.2.20', trace: { requestId: 'trace-' + index, ip: '192.0.2.20', location: { label: '测试网段', source: 'reserved' } } })
    f.advance(1000)
  }
  assert.equal(f.gate.records('guard1').total, 12)
  assert.equal(f.gate.records('guard2', { query: '核验测试guard1' }).total, 0)
  assert.equal(f.gate.records('manager').total, 23)
  assert.equal(f.gate.records('manager', { page: 2 }).items.length, 3)
  assert.equal(f.gate.records('manager', { decision: 'deny' }).total, 11)
  assert.equal(f.gate.records('admin', { startDate: '2026-09-12', endDate: '2026-09-12' }).total, 23)
  assert.equal(f.gate.records('admin', { endDate: '2026-09-11' }).total, 0)
  assert.ok(f.gate.records('manager').items[0].auditTrace.requestId)
  assert.equal(f.gate.records('guard1').items[0].auditTrace, undefined)
  assert.doesNotMatch(JSON.stringify(f.gate.records('admin')), /tokenHash|qrPayload|passId|passwordHash|idCardKey/)
  assert.throws(() => f.gate.records('outsider'), { code: 'GATE_FORBIDDEN' })
  assert.throws(() => f.gate.records('guard1', { pageSize: 200 }), { code: 'GATE_INPUT_INVALID' })
  assert.throws(() => f.gate.records('admin', { startDate: '2026-02-31' }), { code: 'GATE_INPUT_INVALID' })
  assert.throws(() => f.gate.records('admin', { startDate: '2026-09-12', endDate: '2026-09-11' }), { code: 'GATE_INPUT_INVALID' })
  assert.equal(f.db.read(state => state.auditLogs.filter(row => row.action === 'gate.check_confirmed').length), 23)
})

test('动态签发不写主库；预览和确认写盘失败不建立会话或消费核验码，重启保持消费结果', async t => {
  const f = await fixture(t), persist = f.db.persist.bind(f.db)
  const original = await fs.readFile(f.file, 'utf8')
  f.db.persist = async () => { throw new Error('simulated disk failure') }
  const pass = await f.issue()
  assert.equal(await fs.readFile(f.file, 'utf8'), original)
  await assert.rejects(() => f.preview('guard1', pass.qrPayload), /simulated disk failure/)
  assert.equal(f.db.read(state => state.gate.previews.length), 0)
  assert.equal(f.db.read(state => state.gate.passes.length), 0)
  f.db.persist = persist
  const preview = await f.preview()
  f.db.persist = async () => { throw new Error('simulated disk failure') }
  await assert.rejects(() => f.confirm('guard1', preview.previewId), /simulated disk failure/)
  assert.equal(f.gate.records('admin').total, 0)
  assert.equal(f.db.read(state => state.gate.checkRevisions.alice || 0), 0)
  f.db.persist = persist
  const record = await f.confirm('guard1', preview.previewId)
  const reloaded = await new JsonDatabase(f.file).init()
  const restarted = await new GateService(reloaded, { clock: f.gate.clock }).init()
  assert.equal(restarted.records('admin').items[0].id, record.id)
  await assert.rejects(() => restarted.confirm('guard1', { previewId: preview.previewId, decision: 'allow' }), { code: 'GATE_PASS_USED' })
})

test('真实路由遵循前台登录、禁缓存与限速，管理入口不扩大普通账号权限并记录中文审计', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-gate-api-'))
  const contentService = { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => ({}), home: () => ({}), list: () => ({ items: [] }) }
  const app = await buildApp({ config: createConfig({ env: 'test', dataFile: path.join(dir, 'data.json') }), logger: false, refreshContent: false, scheduleContent: false, contentService })
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }) })
  await app.services.database.transaction(state => { state.accounts = accounts() })
  const tokens = Object.fromEntries(accounts().map(row => [row.id, app.services.sessions.issueAccess(row).accessToken]))
  const call = (who, method, url, payload) => app.inject({ method, url: '/api/v1/gate' + url, headers: who ? { authorization: 'Bearer ' + tokens[who] } : {}, ...(payload === undefined ? {} : { payload }) })
  for (const who of [null, 'outsider', 'delegate', 'temp']) {
    const result = await call(who, 'GET', '/records')
    assert.equal(result.statusCode, who ? 403 : 401, result.body)
    assert.equal(result.headers['cache-control'], 'private, no-store')
  }
  assert.equal((await call('guard1', 'GET', '/me')).json().data.canScan, false)
  assert.equal((await call('admin', 'POST', '/staff', { accountId: 'manager', role: 'manager' })).statusCode, 200)
  assert.equal((await call('manager', 'POST', '/staff', { accountId: 'guard1', role: 'guard' })).statusCode, 200)
  const station = (await call('manager', 'POST', '/stations', { name: '测试门岗' })).json().data
  const pass = (await call('alice', 'POST', '/passes', {})).json().data
  const previewResponse = await call('guard1', 'POST', '/scans/preview', { qrPayload: pass.qrPayload, stationId: station.id })
  assert.equal(previewResponse.statusCode, 200, previewResponse.body)
  const record = await call('guard1', 'POST', '/scans/confirm', { previewId: previewResponse.json().data.previewId, decision: 'allow' })
  assert.equal(record.statusCode, 200, record.body)
  assert.equal((await call('guard1', 'GET', '/records')).json().data.total, 1)
  assert.equal((await call('outsider', 'GET', '/stations')).statusCode, 403)
  assert.equal((await call('guard1', 'POST', '/staff', { accountId: 'bob', role: 'guard' })).statusCode, 403)
  let limited = null
  for (let index = 0; index < 31; index++) limited = await call('bob', 'POST', '/passes', {})
  assert.equal(limited.statusCode, 429)
  const audit = await app.services.audit.list({ actor: 'guard1' })
  assert.ok(audit.items.some(row => row.action === 'gate.check_confirmed' && row.trace.route === '/api/v1/gate/scans/confirm'))
  assert.ok(audit.items.some(row => row.details.label === '查看返校身份核验记录'))
  assert.doesNotMatch(JSON.stringify(audit.items), new RegExp(pass.qrPayload.slice('HUFE-GATE-V1:'.length)))
})

test('5秒显示帧仅内存保留两帧，扫码后60秒确认不受刷新影响且跨帧并发同身份不能重复放行', async t => {
  const f = await fixture(t)
  let writes = 0
  const persist = f.db.persist.bind(f.db)
  f.db.persist = async state => { writes++; await persist(state) }
  for (let i = 0; i < 13; i++) {
    const code = await f.issue()
    assert.equal((await f.issue()).qrPayload, code.qrPayload)
    assert.ok(f.gate.issued.size <= 2)
    f.advance(5000)
  }
  assert.equal(writes, 0)
  const first = await f.issue(), firstPreview = await f.preview('guard1', first.qrPayload)
  assert.equal(Date.parse(firstPreview.expiresAt) - Date.parse(first.expiresAt), 50000)
  f.advance(5000)
  const second = await f.issue(), secondPreview = await f.preview('guard2', second.qrPayload)
  f.advance(11000)
  await assert.rejects(() => f.preview('guard1', first.qrPayload), { code: 'GATE_PASS_EXPIRED' })
  assert.equal((await f.confirm('guard1', firstPreview.previewId)).decision, 'allow')
  await assert.rejects(() => f.confirm('guard2', secondPreview.previewId), { code: 'GATE_PASS_USED' })
  assert.equal(f.gate.records('admin').total, 1)
  const latest = await f.preview()
  const reloaded = await new JsonDatabase(f.file).init(), restarted = await new GateService(reloaded, { clock: f.gate.clock }).init()
  assert.equal((await restarted.confirm('guard1', { previewId: latest.previewId, decision: 'deny', reason: '重复到访需再核对' })).decision, 'deny')
  assert.equal(restarted.records('admin').total, 2)
})
