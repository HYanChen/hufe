import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MySqlDatabase, MYSQL_NAMESPACES, readMysqlSnapshot } from '../src/storage/mysql-database.js'
import { canonicalSnapshotHash } from '../src/storage/mysql-snapshot.js'
import { DossierService } from '../src/accounts/dossier.js'
import { AuditService } from '../src/audit/service.js'
import { runMysqlDataCli } from '../src/cli/mysql-data.js'

// This suite never runs against the application's MYSQL_* environment. A
// separately provisioned disposable database and explicit reset opt-in are required.
const enabled = Boolean(process.env.HUFE_MYSQL_TEST_CONFIG && process.env.HUFE_MYSQL_TEST_ALLOW_RESET === '1')

test('真实 MySQL：迁移、事务、单写入、只读备份、重启和三库隔离', { skip: !enabled }, async t => {
  const config = JSON.parse(await fs.readFile(process.env.HUFE_MYSQL_TEST_CONFIG, 'utf8'))
  assert.match(config.database, /^hufe_mysql_(qa|test)_/)
  const { createConnection } = await import('mysql2/promise')
  const admin = await createConnection(config)
  const prefixFor = namespace => ({ application: 'hufe_store', chat: 'hufe_chat_store', 'image-transfers': 'hufe_image_transfers_store', audit: 'hufe_audit_store', regions: 'hufe_regions_store', content: 'hufe_content_store' })[namespace]
  const reset = async namespace => {
    const prefix = prefixFor(namespace)
    for (const suffix of ['records', 'collections', 'meta']) await admin.query(`DROP TABLE IF EXISTS ${prefix}_${suffix}`)
  }
  for (const namespace of MYSQL_NAMESPACES) await reset(namespace)
  const source = { version: 1, accounts: [{ id: 'person', username: '测试账号', passwordHash: 'preserve-hash', credentials: { revision: 3, encrypted: '密文' }, city: '长沙😀' }], business: { resources: { posts: [{ id: 'one', body: '原始帖子' }], empty: [] } }, unknown: { opaque: [1, null, true, { future: 'field' }, '纯文本😀', '{"not":"an object"}', '[1,2]', 'null'] } }
  let db
  t.after(async () => { try { await db?.close(); for (const namespace of MYSQL_NAMESPACES) await reset(namespace) } finally { await admin.end() } })

  await t.test('未迁移禁止启动，迁移源值逐项保留，非空库拒绝覆盖', async () => {
    await assert.rejects(new MySqlDatabase(config).init(), { code: 'MYSQL_NOT_MIGRATED' })
    db = new MySqlDatabase(config)
    const result = await db.importSnapshot(source)
    assert.equal(result.sha256, canonicalSnapshotHash(source))
    assert.deepEqual(db.read(), source)
    assert.equal((await db.health()).ready, true)
    const [[row]] = await admin.query('SELECT COUNT(*) AS count FROM hufe_store_records')
    assert.equal(Number(row.count), 10)
    await db.close()
    await assert.rejects(new MySqlDatabase(config).importSnapshot({ accounts: [] }), { code: 'MYSQL_IMPORT_TARGET_NOT_EMPTY' })
    db = await new MySqlDatabase(config).init()
    assert.deepEqual(db.read(), source)
  })

  await t.test('单写入锁拒绝第二个 API，但只读导出和校验可在线使用', async () => {
    await assert.rejects(new MySqlDatabase(config).init(), { code: 'MYSQL_WRITER_ALREADY_RUNNING' })
    const snapshot = await readMysqlSnapshot(config)
    assert.deepEqual(snapshot.data, source)
    assert.equal(snapshot.hash, canonicalSnapshotHash(source))
  })

  await t.test('迁移CLI在线全量校验和0600导出可用，拒绝覆盖和不一致源文件', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-mysql-cli-'))
    try {
      const sourceFile = path.join(directory, 'source.json'), exportedFile = path.join(directory, 'exported.json')
      const env = { MYSQL_HOST: config.host, MYSQL_PORT: String(config.port), MYSQL_USER: config.user, MYSQL_PASSWORD: config.password, MYSQL_DATABASE: config.database }
      await fs.writeFile(sourceFile, JSON.stringify(source), { mode: 0o600 })
      assert.equal((await runMysqlDataCli(['verify', '--file', sourceFile, '--namespace', 'application'], env)).verified, true)
      assert.equal((await runMysqlDataCli(['export', '--file', exportedFile], env)).exported, true)
      assert.equal((await fs.stat(exportedFile)).mode & 0o777, 0o600)
      assert.deepEqual(JSON.parse(await fs.readFile(exportedFile, 'utf8')), source)
      await assert.rejects(runMysqlDataCli(['export', '--file', exportedFile], env), { code: 'EEXIST' })
      await fs.writeFile(sourceFile, JSON.stringify({ accounts: [] }))
      await assert.rejects(runMysqlDataCli(['verify', '--file', sourceFile], env), /完整数据校验不一致/)
      await fs.writeFile(sourceFile, '{"private":"must-not-log')
      await assert.rejects(runMysqlDataCli(['verify', '--file', sourceFile], env), error => !error.message.includes('must-not-log'))
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  await t.test('事务等待期间不发布草稿，业务异常无污染，多个事务串行', async () => {
    let release, started
    const ready = new Promise(resolve => { started = resolve })
    const first = db.transaction(async draft => { draft.sequence = [1]; started(); await new Promise(resolve => { release = resolve }) })
    await ready
    const second = db.transaction(draft => { draft.sequence.push(2) })
    assert.equal(db.read().sequence, undefined)
    release()
    await Promise.all([first, second])
    assert.deepEqual(db.read().sequence, [1, 2])
    await assert.rejects(db.transaction(draft => { draft.failed = true; throw Object.assign(new Error('业务规则不满足'), { code: 'BUSINESS_RULE' }) }), { code: 'BUSINESS_RULE' })
    assert.equal(db.read().failed, undefined)
    assert.equal((await readMysqlSnapshot(config)).data.failed, undefined)
  })

  await t.test('插入删除重排、空集合和未知字段都持久化，重启恢复完全一致', async () => {
    const [oldOrder] = await admin.query("SELECT r.record_key, r.ordinal FROM hufe_store_records r JOIN hufe_store_collections c USING (collection_id) WHERE c.collection_path = '/accounts'")
    await db.transaction(draft => {
      draft.accounts.unshift({ id: 'new', username: '新用户' })
      draft.accounts[1].passwordHash = 'changed-hash'
      delete draft.business
      draft.future = { records: [{ id: 'same', order: 1 }, { id: 'same', order: 2 }], empty: [] }
    })
    const [newOrder] = await admin.query("SELECT r.record_key, r.ordinal FROM hufe_store_records r JOIN hufe_store_collections c USING (collection_id) WHERE c.collection_path = '/accounts'")
    assert.equal(newOrder.find(row => row.record_key === oldOrder[0].record_key).ordinal, oldOrder[0].ordinal)
    const expected = db.read()
    await db.close()
    db = await new MySqlDatabase(config).init()
    assert.deepEqual(db.read(), expected)
    assert.deepEqual((await readMysqlSnapshot(config)).data, expected)
  })

  await t.test('聊天与图片传输各自命名空间并行运行，应用数据不混入', async () => {
    const chat = new MySqlDatabase({ ...config, namespace: 'chat' }), transfers = new MySqlDatabase({ ...config, namespace: 'image-transfers' })
    try {
      await chat.importSnapshot({ conversations: [{ id: 'room' }], messages: [{ id: 'message', body: '聊天保留' }] })
      await transfers.importSnapshot({ imageUploads: [{ id: 'image', status: 'bound' }] })
      await Promise.all([chat.transaction(draft => { draft.messages.push({ id: 'second' }) }), transfers.transaction(draft => { draft.imageUploads[0].status = 'complete' }), db.transaction(draft => { draft.applicationOnly = true })])
      assert.equal(db.read().conversations, undefined)
      assert.equal(chat.read().messages.length, 2)
      assert.equal(transfers.read().imageUploads[0].status, 'complete')
      assert.equal((await readMysqlSnapshot({ ...config, namespace: 'chat' })).data.messages.length, 2)
    } finally { await chat.close(); await transfers.close() }
  })

  await t.test('请求审计、区域历史目录和官网内容缓存也可独立迁移', async () => {
    const values = { audit: { requests: [{ id: 'request-1', ip: '192.0.2.1' }] }, regions: { catalogs: { 'catalog-old.json': [{ code: '4301', name: '长沙' }], 'catalog-current.json': [{ code: '4301', name: '长沙市' }] } }, content: { revision: 5, items: [{ id: 'notice', title: '官网公告' }] } }
    for (const [namespace, value] of Object.entries(values)) {
      const store = new MySqlDatabase({ ...config, namespace })
      try {
        await store.importSnapshot(value)
        assert.deepEqual((await readMysqlSnapshot({ ...config, namespace })).data, value)
        assert.equal(store.read().accounts, undefined)
      } finally { await store.close() }
    }
  })

  await t.test('审计增量追加的 SHA、重启、维护后重建、重复编号和失败回滚保持一致', async () => {
    const options = { ...config, namespace: 'audit' }
    let audit = await new MySqlDatabase(options).init()
    const expected = { z: { unknown: [null, '未知😀'] }, requests: [], a: { preserved: true } }
    try {
      await audit.transaction(state => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, structuredClone(expected)) })
      for (let index = 0; index < 8; index++) {
        const entry = { id: `append-${index}`, text: '中文😀𠀀\n\u0000', extra: { z: index, a: [false, null] } }
        await audit.append('requests', entry)
        expected.requests.push(entry)
        const snapshot = await readMysqlSnapshot(options)
        assert.deepEqual(snapshot.data, expected)
        assert.equal(snapshot.hash, canonicalSnapshotHash(expected))
        if (index === 3) { await audit.close(); audit = await new MySqlDatabase(options).init() }
      }
      await assert.rejects(audit.append('requests', { id: 'append-0' }), { code: 'MYSQL_APPEND_DUPLICATE_ID' })
      assert.equal((await audit.health()).ready, true, '重复编号为业务拒绝，不应让数据库掉线')
      await audit.transaction(state => { state.requests.shift(); state.requests[0].extra.changed = true; state.z.maintenance = '保留' })
      expected.requests.shift(); expected.requests[0].extra.changed = true; expected.z.maintenance = '保留'
      const afterMaintenance = { id: 'after-maintenance', text: '维护后新增' }
      await audit.append('requests', afterMaintenance); expected.requests.push(afterMaintenance)
      assert.deepEqual((await readMysqlSnapshot(options)).data, expected)

      const originalCommit = audit.connection.commit.bind(audit.connection), priorRevision = audit.revision
      const priorPrefix = audit.appendState.hashState.prefix.copy().update(audit.appendState.hashState.suffix).digest('hex')
      audit.connection.commit = async () => { throw Object.assign(new Error('driver SQL and private data must not escape'), { code: 'ECONNRESET' }) }
      await assert.rejects(audit.append('requests', { id: 'failed-commit' }), error => error.code === 'MYSQL_STORAGE_UNAVAILABLE' && !error.message.includes('private data'))
      assert.deepEqual(audit.data, expected)
      assert.equal(audit.revision, priorRevision)
      assert.equal(audit.appendState.hashState.prefix.copy().update(audit.appendState.hashState.suffix).digest('hex'), priorPrefix)
      assert.throws(() => audit.read(), { code: 'MYSQL_STORAGE_UNAVAILABLE' })
      audit.connection.commit = originalCommit
      await audit.close(); audit = await new MySqlDatabase(options).init()
      assert.deepEqual(audit.read(), expected)

      const commit = audit.connection.commit.bind(audit.connection)
      audit.connection.commit = async () => { await commit(); throw new Error('lost COMMIT reply') }
      await assert.rejects(audit.append('requests', { id: 'committed-but-reply-lost' }), { code: 'MYSQL_STORAGE_UNAVAILABLE' })
      assert.deepEqual(audit.data, expected, '不确定提交不得发布本地缓存')
      await audit.close(); audit = await new MySqlDatabase(options).init()
      expected.requests.push({ id: 'committed-but-reply-lost' })
      assert.deepEqual(audit.read(), expected, '重启以 MySQL 已提交数据为准')
      await audit.append('requests', { id: 'after-recovery' }); expected.requests.push({ id: 'after-recovery' })
      assert.deepEqual((await readMysqlSnapshot(options)).data, expected)
      const draining = [audit.append('requests', { id: 'drain-one' }), audit.append('requests', { id: 'drain-two' })]
      const closed = audit.close()
      await assert.rejects(audit.append('requests', { id: 'after-close' }), { code: 'MYSQL_STORAGE_UNAVAILABLE' })
      await Promise.all([...draining, closed])
      expected.requests.push({ id: 'drain-one' }, { id: 'drain-two' })
      audit = await new MySqlDatabase(options).init()
      assert.deepEqual((await readMysqlSnapshot(options)).data, expected, '正常关闭必须排空已接受的审计追加')
    } finally { await audit.close() }
  })

  await t.test('真实SQL审计不确定提交进入主库恢复队列，重启按完整记录幂等恢复', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-audit-sql-recovery-'))
    const options = { ...config, namespace: 'audit' }
    const create = () => new AuditService(db, { databaseDriver: 'mysql', dataFile: path.join(temp, 'data.json') }, { openStore: async () => new MySqlDatabase(options).init() })
    let service = await create().init()
    try {
      const commit = service.requestDatabase.connection.commit.bind(service.requestDatabase.connection)
      service.requestDatabase.connection.commit = async () => { await commit(); throw new Error('lost COMMIT reply') }
      const request = { method: 'POST', routeOptions: { url: '/api/v1/business/community-posts' }, params: {}, headers: {}, raw: { url: '/api/v1/business/community-posts' }, auditTrace: { requestId: 'sql-outbox-request', startedAt: new Date().toISOString(), ip: '127.0.0.1', userAgent: '' }, log: { error() {} } }
      await service.capture(request, { statusCode: 201 })
      assert.equal(service.status().recoveryPending, 1)
      assert.equal(service.status().available, false)
      assert.equal((await readMysqlSnapshot(config)).data.auditRecoveryRequests.length, 1)
      assert.equal((await readMysqlSnapshot(options)).data.requests.filter(row => row.id === 'sql-outbox-request').length, 1)
      await service.close()
      service = await create().init()
      assert.equal(service.status().healthy, true)
      assert.equal(service.status().recoveredRequests, 1)
      assert.deepEqual((await readMysqlSnapshot(config)).data.auditRecoveryRequests, [])
      assert.equal((await readMysqlSnapshot(options)).data.requests.filter(row => row.id === 'sql-outbox-request').length, 1)
    } finally { await service.close(); await fs.rm(temp, { recursive: true, force: true }) }
  })

  await t.test('SQL 写入失败不提交部分变更，连接异常后禁止读陈旧凭据', async () => {
    const before = db.read()
    const original = db.writeDiff.bind(db)
    db.writeDiff = async (old, next) => { await original(old, next); throw new Error('sensitive query password=must-not-log') }
    await assert.rejects(db.transaction(draft => { draft.accounts[0].passwordHash = 'failed-password' }), error => error.code === 'MYSQL_STORAGE_UNAVAILABLE' && !error.message.includes('must-not-log'))
    assert.throws(() => db.read(), { code: 'MYSQL_STORAGE_UNAVAILABLE' })
    await db.close()
    db = await new MySqlDatabase(config).init()
    assert.deepEqual(db.read(), before)
  })

  await t.test('人员内部CRM维护在真实MySQL中写入独立记录，重启后金额备注不计到账', async () => {
    const actor = { id: 'crm-admin', isAdmin: true, status: 'active', credentialRevision: 0 }
    await db.transaction(draft => { draft.accounts.push(actor); draft.auditLogs ||= [] })
    let service = new DossierService({ database: db, config: { dataHashSecret: 'isolated-mysql-crm-test' } })
    const added = await service.saveRecord(actor, 'person', 'giving', null, { revision: 0, title: '内部捐赠意向联络', amount: 50000, status: 'completed' })
    assert.equal(added.item.internal, true)
    const [[row]] = await admin.query("SELECT COUNT(*) AS count FROM hufe_store_records r JOIN hufe_store_collections c USING (collection_id) WHERE c.collection_path = '/accountDossierRecords'")
    assert.equal(Number(row.count), 1)
    await db.close()
    db = await new MySqlDatabase(config).init()
    service = new DossierService({ database: db, config: { dataHashSecret: 'isolated-mysql-crm-test' } })
    assert.equal(service.section(actor, 'person', 'giving').items[0].amount, 50000)
    assert.equal(service.get(actor, 'person').tabs.analysis.metrics.confirmedGivingAmount, 0)
    await service.archiveRecord(actor, 'person', 'giving', added.item.id, { revision: 1, reason: '已结束' })
    assert.equal(service.section(actor, 'person', 'giving').total, 0)
    assert.equal((await readMysqlSnapshot(config)).data.accountDossierRecords.length, 1)
  })

  await t.test('优雅关闭排空已接受事务，拒绝新的写入，重启后两次变更均保留', async () => {
    let release, started
    const ready = new Promise(resolve => { started = resolve })
    const first = db.transaction(async draft => { draft.drained = [1]; started(); await new Promise(resolve => { release = resolve }) })
    await ready
    const second = db.transaction(draft => { draft.drained.push(2) })
    const closing = db.close()
    await assert.rejects(db.transaction(draft => { draft.notAccepted = true }), { code: 'MYSQL_STORAGE_UNAVAILABLE' })
    release()
    await Promise.all([first, second, closing])
    db = await new MySqlDatabase(config).init()
    assert.deepEqual(db.read().drained, [1, 2])
    assert.equal(db.read().notAccepted, undefined)
  })

  await t.test('连接被断开时立即拒绝读取，释放单写入锁后可以重启', async () => {
    const before = db.read()
    await admin.query(`KILL CONNECTION ${Number(db.connectionId)}`)
    await new Promise(resolve => setTimeout(resolve, 30))
    await assert.rejects(db.health(), { code: 'MYSQL_STORAGE_UNAVAILABLE' })
    assert.throws(() => db.read(), { code: 'MYSQL_STORAGE_UNAVAILABLE' })
    await db.close()
    db = await new MySqlDatabase(config).init()
    assert.deepEqual(db.read(), before)
  })
})
