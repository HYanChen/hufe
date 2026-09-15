import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { AuditService } from '../src/audit/service.js'
import { mergeBundledRegions } from '../src/regions/upgrade.js'

function memoryStore(initial) {
  let state = structuredClone(initial)
  return {
    closed: false,
    queue: Promise.resolve(),
    read(selector = value => value) { return selector(structuredClone(state)) },
    transaction(mutator) {
      const task = this.queue.then(async () => {
        const draft = structuredClone(state)
        const result = await mutator(draft)
        state = draft
        return result
      })
      this.queue = task.catch(() => {})
      return task
    },
    async close() { await this.queue; this.closed = true }
  }
}

async function auditFixture(t, requests = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-mysql-audit-unit-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const main = memoryStore({ accounts: [{ id: 'member', name: '成员姓名', username: 'member' }], auditLogs: [], business: { submissions: [] } })
  const sql = memoryStore({ requests })
  const config = { dataFile: path.join(root, 'application-data.json'), databaseDriver: 'mysql' }
  const service = new AuditService(main, config, { openStore: async (received, options) => {
    assert.equal(received, config)
    assert.deepEqual(options, { namespace: 'audit' })
    return sql
  } })
  await service.init()
  t.after(() => service.close())
  return { root, main, sql, service }
}

function request(route = '/api/v1/me', method = 'GET') {
  return {
    routeOptions: { url: route }, method, ip: '127.0.0.1', raw: { url: route, socket: { remoteAddress: '127.0.0.1' } },
    headers: { 'user-agent': 'Audit namespace test' }, user: { id: 'member', name: '成员姓名', username: 'member' },
    params: {}, log: { error() {} }
  }
}

test('MySQL 审计使用独立集合，迁移历史与新请求均可查询，不重新读取 JSONL 归档', async t => {
  const historic = { id: 'historical', requestId: 'historical', action: 'request.accessed', actor: 'member', createdAt: '2025-01-01T00:00:00.000Z', targetId: '', details: { label: '历史访问' }, trace: { route: '/api/v1/me' } }
  const { root, service, main, sql } = await auditFixture(t, [historic])
  const archiveDir = path.join(root, 'audit-requests')
  await fs.mkdir(archiveDir)
  const archive = path.join(archiveDir, '2025-01-01.jsonl')
  const archived = JSON.stringify({ ...historic, id: 'archive-only' }) + '\n'
  await fs.writeFile(archive, archived)
  const event = request('/api/v1/business/community-posts', 'POST')
  service.begin(event)
  await main.transaction(state => state.auditLogs.push({ id: 'business-event', requestId: event.auditTrace.requestId, action: 'business.community_post_published', actor: 'member', targetId: 'post', createdAt: event.auditTrace.startedAt, details: {} }))
  await service.capture(event, { statusCode: 201 })
  assert.equal(sql.read(state => state.requests.length), 2)
  assert.equal(main.read(state => Object.hasOwn(state, 'requests')), false)
  const rows = await service.list({ actor: 'member' })
  assert.equal(rows.total, 2)
  assert.ok(rows.items.some(row => row.id === 'historical'))
  const linked = rows.items.find(row => row.id === 'business-event')
  assert.equal(linked.trace.route, '/api/v1/business/community-posts')
  assert.equal(linked.trace.actorAccountId, 'member')
  assert.equal(rows.items.some(row => row.id === 'archive-only'), false)
  assert.equal(await fs.readFile(archive, 'utf8'), archived)
  assert.deepEqual(await fs.readdir(archiveDir), ['2025-01-01.jsonl'])
  await service.close()
  assert.equal(sql.closed, true)
  assert.equal(main.closed, false)
})

test('MySQL 审计写入失败明确降级，不能自动退回 JSONL', async t => {
  const { root, service, sql } = await auditFixture(t)
  sql.transaction = async () => { throw new Error('simulated SQL failure') }
  await service.capture(request(), { statusCode: 200 })
  assert.equal(service.status().healthy, false)
  assert.equal(service.status().failures, 1)
  assert.equal(sql.read(state => state.requests.length), 0)
  await assert.rejects(fs.access(path.join(root, 'audit-requests')), { code: 'ENOENT' })
})

test('MySQL 审计没有迁移 requests 集合时拒绝启动并关闭存储连接', async () => {
  const sql = memoryStore({})
  const service = new AuditService(memoryStore({}), { dataFile: '/unused/data.json', databaseDriver: 'mysql' }, { openStore: async () => sql })
  await assert.rejects(service.init(), { code: 'MYSQL_AUDIT_NOT_MIGRATED' })
  assert.equal(sql.closed, true)
})

test('旧 JSON 开发账号与同步 CLI 在 MySQL 模式下拒绝执行', () => {
  for (const filename of ['create-dev-admin.js', 'create-dev-user.js', 'create-dev-organization-manager.js', 'sync.js']) {
    const file = fileURLToPath(new URL(`../src/cli/${filename}`, import.meta.url))
    assert.throws(() => execFileSync(process.execPath, [file], { env: { ...process.env, DATABASE_DRIVER: 'mysql' }, stdio: 'pipe', encoding: 'utf8' }), error => {
      assert.match(error.stderr, /MySQL 模式/)
      return true
    })
  }
})

test('旧 JSON 地区升级在 MySQL 模式下拒绝读取或写入归档', async () => {
  const before = process.env.DATABASE_DRIVER
  process.env.DATABASE_DRIVER = 'mysql'
  try {
    await assert.rejects(mergeBundledRegions({ dataFile: '/nonexistent/legacy.json', apply: true }), /MySQL 模式禁止/)
  } finally {
    if (before === undefined) delete process.env.DATABASE_DRIVER
    else process.env.DATABASE_DRIVER = before
  }
})
