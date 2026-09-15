import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AuditService } from '../src/audit/service.js'

class MemorySql {
  constructor(data) { this.data = structuredClone(data); this.queue = Promise.resolve(); this.writes = 0; this.appends = 0; this.closed = false }
  read(selector = value => value) { return selector(structuredClone(this.data)) }
  transaction(mutator) {
    const task = this.queue.then(async () => {
      this.writes++
      if (this.failWrite) throw new Error('private driver SQL must not be logged')
      const draft = structuredClone(this.data), result = await mutator(draft)
      this.data = draft
      if (this.lostWriteReply) throw new Error('main COMMIT reply lost')
      return result
    })
    this.queue = task.catch(() => {})
    return task
  }
  async append(field, log) {
    this.appends++
    if (this.failAppend) throw new Error('private request details must not be logged')
    if (this.data[field].some(item => item.id === log.id)) throw new Error('duplicate')
    this.data[field].push(structuredClone(log))
    if (this.lostCommitReply) throw new Error('COMMIT reply lost')
  }
  assertReady() { if (this.offline) throw new Error('offline') }
  async close() { this.closed = true }
}

const event = (id = 'saved-request') => ({ id, requestId: id, action: 'request.changed', createdAt: '2026-09-16T00:00:00.000Z', trace: { route: '/api/v1/business/community-posts', statusCode: 201 }, details: { label: '提交动态' } })
const queued = log => ({ id: log.id, request: log, queuedAt: '2026-09-16T00:00:01.000Z' })
function request(id, logs = []) {
  return { method: 'POST', url: '/api/v1/business/community-posts', routeOptions: { url: '/api/v1/business/community-posts' }, raw: { url: '/api/v1/business/community-posts', socket: { remoteAddress: '127.0.0.1' } }, ip: '127.0.0.1', headers: {}, params: {}, user: { id: 'author', name: '测试人', username: 'test' }, auditTrace: { requestId: id, startedAt: '2026-09-16T00:00:00.000Z', ip: '127.0.0.1', userAgent: '', device: {}, location: {} }, log: { error: (...args) => logs.push(args) } }
}
async function fixture(t, { main = {}, audit = [] } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-audit-recovery-'))
  const database = new MemorySql(main), store = new MemorySql({ requests: audit })
  const config = { databaseDriver: 'mysql', dataFile: path.join(dir, 'application.json') }
  const open = () => new AuditService(database, config, { openStore: async () => store })
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }) })
  return { database, store, open, dir }
}

test('审计首次失败保留原业务响应，MySQL恢复队列持久化并阻止后续请求日志洪泛', async t => {
  const { database, store, open, dir } = await fixture(t)
  const service = await open().init(), logs = [], reply = { statusCode: 201, body: { id: 'already-committed-post' } }
  store.failAppend = true
  await service.capture(request('first', logs), reply)
  assert.deepEqual(reply, { statusCode: 201, body: { id: 'already-committed-post' } })
  assert.equal(database.data.auditRecoveryRequests.length, 1)
  assert.equal(database.data.auditRecoveryRequests[0].request.trace.statusCode, 201)
  assert.equal(service.status().degraded, true)
  assert.equal(service.status().available, false)
  assert.equal(service.status().recoveryPending, 1)
  assert.equal(service.status().unrecoverableFailures, 0)
  for (let index = 0; index < 30; index++) {
    const next = request(`blocked-${index}`, logs)
    assert.throws(() => service.assertAvailable(next), { code: 'AUDIT_STORAGE_UNAVAILABLE', statusCode: 503 })
    assert.equal(next.auditUnavailable, true)
    await service.capture(next, { statusCode: 503 })
  }
  assert.equal(store.appends, 1); assert.equal(database.writes, 1); assert.equal(logs.length, 1)
  assert.deepEqual(Object.keys(logs[0][0]), ['requestId'])
  assert.equal(JSON.stringify(logs).includes('private'), false)
  await assert.rejects(fs.stat(path.join(dir, 'audit-requests')), { code: 'ENOENT' })
  for (const next of [{ ...request('options'), method: 'OPTIONS' }, { ...request('health'), routeOptions: { url: '/health' } }, { ...request('api-health'), routeOptions: { url: '/api/v1/health' } }]) assert.doesNotThrow(() => service.assertAvailable(next))
  await service.close()
})

test('故障发生前已进入业务的并发请求也入恢复队列，不重复尝试失效审计连接', async t => {
  const { database, store, open } = await fixture(t), service = await open().init()
  const first = request('in-flight-one'), second = request('in-flight-two')
  service.assertAvailable(first); service.assertAvailable(second)
  store.failAppend = true
  await Promise.all([service.capture(first, { statusCode: 201 }), service.capture(second, { statusCode: 200 })])
  assert.equal(store.appends, 1)
  assert.deepEqual(database.data.auditRecoveryRequests.map(row => row.id), ['in-flight-one', 'in-flight-two'])
  assert.equal(service.status().recoveryPending, 2)
  await service.close()
})

test('重启补回失败审计并清除MySQL恢复队列，未知字段和值保留', async t => {
  const log = { ...event(), opaque: { future: [null, '未知😀'] } }
  const { database, store, open } = await fixture(t, { main: { auditRecoveryRequests: [queued(log)], keep: true } })
  const service = await open().init()
  assert.deepEqual(store.data.requests, [log])
  assert.deepEqual(database.data.auditRecoveryRequests, [])
  assert.equal(database.data.keep, true)
  assert.equal(service.status().healthy, true)
  assert.equal(service.status().recoveredRequests, 1)
  service.assertAvailable(request('after-recovery'))
  await service.close()
})

test('不确定COMMIT后相同记录已存在时只清恢复队列，不重复追加', async t => {
  const log = event()
  const { database, store, open } = await fixture(t, { main: { auditRecoveryRequests: [queued(log)] }, audit: [{ details: log.details, trace: log.trace, createdAt: log.createdAt, action: log.action, requestId: log.requestId, id: log.id }] })
  const service = await open().init()
  assert.equal(store.appends, 0)
  assert.equal(store.data.requests.length, 1)
  assert.deepEqual(database.data.auditRecoveryRequests, [])
  await service.close()
})

test('恢复途中COMMIT成功但应答丢失，保留恢复队列；再次启动幂等清理', async t => {
  const log = event(), { database, store, open } = await fixture(t, { main: { auditRecoveryRequests: [queued(log)] } })
  store.lostCommitReply = true
  await assert.rejects(open().init(), /COMMIT/)
  assert.equal(store.data.requests.length, 1)
  assert.equal(database.data.auditRecoveryRequests.length, 1)
  store.lostCommitReply = false
  const service = await open().init()
  assert.equal(store.appends, 1)
  assert.equal(store.data.requests.length, 1)
  assert.deepEqual(database.data.auditRecoveryRequests, [])
  await service.close()
})

test('恢复记录同ID内容冲突、重复或队列损坏时拒绝启动，原件不删除', async t => {
  const log = event()
  for (const variant of [
    { main: { auditRecoveryRequests: [queued(log)] }, audit: [{ ...log, action: 'different' }] },
    { main: { auditRecoveryRequests: [queued(log)] }, audit: [log, log] },
    { main: { auditRecoveryRequests: [queued(log), queued(log)] } },
    { main: { auditRecoveryRequests: 'damaged' } }
  ]) {
    const { database, store, open } = await fixture(t, variant), before = structuredClone(database.data)
    await assert.rejects(open().init(), error => ['AUDIT_RECOVERY_CONFLICT', 'AUDIT_RECOVERY_INVALID'].includes(error.code))
    assert.deepEqual(database.data, before)
    assert.equal(store.closed, true)
  }
})

test('主MySQL应答也失败时标记持久化未知，日志仅含requestId且不宣称永久丢失', async t => {
  const { database, store, open } = await fixture(t), service = await open().init(), logs = []
  store.failAppend = true; database.failWrite = true
  await service.capture(request('unrecoverable', logs), { statusCode: 201 })
  assert.equal(service.status().healthy, false)
  assert.equal(service.status().unrecoverableFailures, 1)
  assert.equal(service.status().recoveryUncertainFailures, 1)
  assert.equal(service.status().recoveryDurability, 'unknown-manual-verification-required')
  assert.equal(service.status().recoveryPending, 0)
  assert.equal(service.status().lastSuccessAt, '')
  assert.deepEqual(logs[0][0], { requestId: 'unrecoverable' })
  assert.match(logs[0][1], /durability unknown; manual verification required/)
  assert.doesNotMatch(logs[0][1], /not recoverable|irrecoverable/)
  assert.equal(JSON.stringify(logs).includes('private'), false)
  assert.throws(() => service.assertAvailable(request('next')), { code: 'AUDIT_STORAGE_UNAVAILABLE' })
  await service.close()
})

test('主库COMMIT已成功但应答丢失，重启可恢复；即使原审计也提交成功仍不重复记录', async t => {
  for (const auditWasCommitted of [false, true]) {
    const { database, store, open } = await fixture(t), logs = []
    let service = await open().init()
    store.failAppend = !auditWasCommitted
    store.lostCommitReply = auditWasCommitted
    database.lostWriteReply = true
    const id = `main-commit-uncertain-${auditWasCommitted}`
    await service.capture(request(id, logs), { statusCode: 201 })
    assert.equal(service.status().recoveryUncertainFailures, 1)
    assert.equal(service.status().recoveryDurability, 'unknown-manual-verification-required')
    assert.equal(service.status().recoveryPending, 0, '未收到提交确认时不能断言恢复队列已持久化')
    assert.equal(database.data.auditRecoveryRequests.length, 1, '模拟SQL实际上已提交恢复记录')
    assert.equal(store.data.requests.length, Number(auditWasCommitted))
    assert.match(logs[0][1], /durability unknown/)
    await service.close()
    store.failAppend = false; store.lostCommitReply = false; database.lostWriteReply = false
    service = await open().init()
    assert.equal(service.status().healthy, true)
    assert.equal(service.status().recoveredRequests, 1)
    assert.equal(service.status().recoveryUncertainFailures, 0)
    assert.deepEqual(database.data.auditRecoveryRequests, [])
    assert.equal(store.data.requests.length, 1)
    assert.equal(store.data.requests[0].id, id)
    await service.close()
  }
})

test('空闲审计连接已失效时守卫在业务开始前拒绝，JSON模式不改变原行为', async t => {
  const { store, open } = await fixture(t), service = await open().init()
  store.offline = true
  assert.throws(() => service.assertAvailable(request('offline')), { code: 'AUDIT_STORAGE_UNAVAILABLE' })
  assert.equal(service.status().failures, 1)
  await service.close()
  const json = new AuditService(new MemorySql({}), { databaseDriver: 'json', dataFile: '/unused/data.json' })
  json.unavailable = true
  assert.doesNotThrow(() => json.assertAvailable(request('json')))
})
