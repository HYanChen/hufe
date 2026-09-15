import { advanceArrayAppendHash, allocateRecordOrder, canonicalJson, canonicalSnapshotHash, createArrayAppendHash, decomposeSnapshot, MYSQL_STORE_SCHEMA_VERSION, reconstructSnapshot, sha256, snapshotSummary } from './mysql-snapshot.js'

export const MYSQL_NAMESPACES = Object.freeze(['application', 'chat', 'image-transfers', 'audit', 'regions', 'content'])
const MYSQL_PREFIXES = Object.freeze({ application: 'hufe_store', chat: 'hufe_chat_store', 'image-transfers': 'hufe_image_transfers_store', audit: 'hufe_audit_store', regions: 'hufe_regions_store', content: 'hufe_content_store' })

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS hufe_store_meta (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    schema_version INT UNSIGNED NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    layout JSON NOT NULL,
    snapshot_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    imported_at VARCHAR(32) NOT NULL,
    updated_at VARCHAR(32) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS hufe_store_collections (
    collection_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    collection_path TEXT NOT NULL,
    row_count BIGINT UNSIGNED NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS hufe_store_records (
    collection_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    record_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ordinal BIGINT NOT NULL,
    payload JSON NOT NULL,
    payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (collection_id, record_key),
    KEY collection_order (collection_id, ordinal),
    CONSTRAINT hufe_store_record_collection FOREIGN KEY (collection_id) REFERENCES hufe_store_collections(collection_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
]

export function mysqlStorageError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 503 })
}

function safeSqlError(error) {
  if (String(error?.code || '').startsWith('MYSQL_')) return error
  // Driver errors may contain SQL text and interpolated account/password data.
  // Do not attach the original driver error as a cause or copy its properties.
  return mysqlStorageError('MYSQL_STORAGE_UNAVAILABLE', 'MySQL 数据库操作失败，请检查数据库连接、容量和服务日志（不含业务数据）')
}

async function connect(options, factory) {
  try {
    const { namespace = 'application', ...connectionOptions } = options
    if (!Object.hasOwn(MYSQL_PREFIXES, namespace)) throw mysqlStorageError('MYSQL_NAMESPACE_INVALID', 'MySQL 数据集合命名空间无效')
    const create = factory || (await import('mysql2/promise')).createConnection
    // JSON columns must have an unambiguous wire representation: mysql2's
    // default decoded scalar "text" is otherwise indistinguishable from an
    // encoded JSON object string. Always decode encoded JSON ourselves once.
    const connection = await create({ ...connectionOptions, charset: 'utf8mb4', jsonStrings: true, multipleStatements: false, enableKeepAlive: true, connectTimeout: options.connectTimeout || 10000 })
    // A fatal socket error between awaited statements must reject subsequent
    // operations, not become an unhandled EventEmitter error in a backup CLI.
    connection.on?.('error', () => {})
    connection.hufeStorePrefix = MYSQL_PREFIXES[namespace]
    connection.hufeStoreNamespace = namespace
    return connection
  } catch (error) { throw safeSqlError(error) }
}

const query = (connection, sql, values = []) => connection.query({ sql: sql.replaceAll('hufe_store', connection.hufeStorePrefix || 'hufe_store'), timeout: 30000 }, values)
const jsonValue = value => typeof value === 'string' || Buffer.isBuffer(value) ? JSON.parse(String(value)) : value

export async function loadMysqlSnapshot(connection) {
  const [metas] = await query(connection, 'SELECT id, schema_version, revision, layout, snapshot_sha256 FROM hufe_store_meta ORDER BY id')
  if (!metas.length) throw mysqlStorageError('MYSQL_NOT_MIGRATED', 'MySQL 尚未导入业务数据，请先执行迁移并校验，系统不会自动创建空业务库')
  if (metas.length !== 1 || Number(metas[0].id) !== 1 || Number(metas[0].schema_version) !== MYSQL_STORE_SCHEMA_VERSION) throw mysqlStorageError('MYSQL_SCHEMA_MISMATCH', 'MySQL 数据库结构版本不兼容')
  if (!Number.isSafeInteger(Number(metas[0].revision)) || Number(metas[0].revision) < 0) throw mysqlStorageError('MYSQL_SNAPSHOT_CORRUPT', 'MySQL 数据库修订号无效')
  const [collectionRows] = await query(connection, 'SELECT collection_id, collection_path, row_count FROM hufe_store_collections')
  const [records] = await query(connection, 'SELECT collection_id, record_key, ordinal, payload, payload_sha256 FROM hufe_store_records ORDER BY collection_id, ordinal')
  const collections = new Map(collectionRows.map(row => [row.collection_id, { id: row.collection_id, path: row.collection_path, count: Number(row.row_count), rows: [] }]))
  for (const record of records) {
    const collection = collections.get(record.collection_id)
    if (!collection) throw mysqlStorageError('MYSQL_SNAPSHOT_CORRUPT', 'MySQL 数据库记录缺少所属集合')
    collection.rows.push({ key: record.record_key, ordinal: Number(record.ordinal), payload: canonicalJson(jsonValue(record.payload)), hash: record.payload_sha256 })
  }
  for (const collection of collections.values()) if (sha256(collection.path) !== collection.id || collection.rows.length !== collection.count) throw mysqlStorageError('MYSQL_SNAPSHOT_CORRUPT', 'MySQL 数据库集合校验失败')
  let data
  try { data = reconstructSnapshot(jsonValue(metas[0].layout), collections) } catch { throw mysqlStorageError('MYSQL_SNAPSHOT_CORRUPT', 'MySQL 数据库记录校验失败') }
  if (canonicalSnapshotHash(data) !== metas[0].snapshot_sha256) throw mysqlStorageError('MYSQL_SNAPSHOT_CORRUPT', 'MySQL 数据库快照完整性校验失败')
  return { data, revision: Number(metas[0].revision), hash: metas[0].snapshot_sha256, recordOrder: new Map([...collections].map(([id, collection]) => [id, new Map(collection.rows.map(row => [row.key, row.ordinal]))])) }
}

// A repeatable-read snapshot is safe for backup/verification while the sole app
// writer remains online. This path performs no DDL, no imports and no writes.
export async function readMysqlSnapshot(options, { connectionFactory } = {}) {
  const connection = await connect(options, connectionFactory)
  try {
    await query(connection, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await query(connection, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
    const result = await loadMysqlSnapshot(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback().catch(() => {})
    if (error?.code === 'ER_NO_SUCH_TABLE') throw mysqlStorageError('MYSQL_NOT_MIGRATED', 'MySQL 尚未导入业务数据')
    throw safeSqlError(error)
  } finally { await connection.end().catch(() => {}) }
}

export class MySqlDatabase {
  constructor(options, { connectionFactory, heartbeatMs = 15000 } = {}) {
    this.options = options
    this.connectionFactory = connectionFactory
    this.heartbeatMs = heartbeatMs
    this.queue = Promise.resolve()
    this.data = null
    this.connected = false
    this.closing = false
    this.revision = null
  }

  async acquire() {
    if (this.connection) throw mysqlStorageError('MYSQL_ALREADY_OPEN', '数据库连接已经打开')
    this.connection = await connect(this.options, this.connectionFactory)
    this.connection.on?.('error', () => { this.connected = false })
    this.connection.on?.('end', () => { this.connected = false })
    const [[identity]] = await query(this.connection, 'SELECT DATABASE() AS database_name, CONNECTION_ID() AS connection_id')
    if (!identity.database_name) throw mysqlStorageError('MYSQL_DATABASE_REQUIRED', '必须指定独立的 MySQL 业务数据库')
    this.connectionId = Number(identity.connection_id)
    this.lockName = `hufe-store:${sha256(`${identity.database_name}:${this.connection.hufeStoreNamespace}`).slice(0, 48)}`
    const [[lock]] = await query(this.connection, 'SELECT GET_LOCK(?, 0) AS acquired', [this.lockName])
    if (Number(lock.acquired) !== 1) throw mysqlStorageError('MYSQL_WRITER_ALREADY_RUNNING', '该数据库已有湖财人写入进程，请先停止旧 API；禁止多进程使用缓存数据库')
    this.connected = true
    this.lastHealthyAt = Date.now()
  }

  async init() {
    try {
      await this.acquire()
      const snapshot = await loadMysqlSnapshot(this.connection)
      this.data = snapshot.data
      this.revision = snapshot.revision
      this.recordOrder = snapshot.recordOrder
      this.rebuildAppendState()
      this.lastHealthyAt = Date.now()
      this.startHeartbeat()
      return this
    } catch (error) {
      await this.close()
      if (error?.code === 'ER_NO_SUCH_TABLE') throw mysqlStorageError('MYSQL_NOT_MIGRATED', 'MySQL 尚未导入业务数据，请先执行显式迁移，系统不会自动启动空库')
      throw safeSqlError(error)
    }
  }

  assertReady({ allowClosing = false } = {}) {
    if (!this.connected || (this.closing && !allowClosing) || !this.data || Date.now() - this.lastHealthyAt > Math.max(60000, this.heartbeatMs * 4)) throw mysqlStorageError('MYSQL_STORAGE_UNAVAILABLE', 'MySQL 连接不可用，已暂停读取和写入，请检查数据库后重启 API')
  }

  read(selector = value => value) {
    // In-flight business callbacks may perform reads while accepted writes drain.
    // Once the queue is drained close() marks the connection offline.
    this.assertReady({ allowClosing: true })
    return selector(structuredClone(this.data))
  }

  enqueue(action) {
    const task = this.queue.then(action, action)
    this.queue = task.catch(() => {})
    return task
  }

  async checkOwnership() {
    const [[row]] = await query(this.connection, 'SELECT IS_USED_LOCK(?) AS owner', [this.lockName])
    if (Number(row.owner) !== this.connectionId) throw mysqlStorageError('MYSQL_WRITER_LOCK_LOST', 'MySQL 单写入锁已丢失，必须重启 API')
    this.lastHealthyAt = Date.now()
  }

  startHeartbeat() {
    this.heartbeat = setInterval(() => { this.health().catch(() => {}) }, this.heartbeatMs)
    this.heartbeat.unref?.()
  }

  async health() {
    return this.enqueue(async () => {
      this.assertReady()
      try { await this.checkOwnership(); return { driver: 'mysql', ready: true, revision: this.revision } }
      catch (error) { this.connected = false; throw safeSqlError(error) }
    })
  }

  async writeDiff(before, after) {
    const recordOrder = new Map()
    for (const [id] of before.collections) if (!after.collections.has(id)) {
      await query(this.connection, 'DELETE FROM hufe_store_records WHERE collection_id = ?', [id])
      await query(this.connection, 'DELETE FROM hufe_store_collections WHERE collection_id = ?', [id])
    }
    const writes = []
    for (const [id, collection] of after.collections) {
      const old = before.collections.get(id)
      if (!old || old.rows.length !== collection.rows.length) await query(this.connection, 'INSERT INTO hufe_store_collections (collection_id, collection_path, row_count) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE collection_path = VALUES(collection_path), row_count = VALUES(row_count)', [id, collection.path, collection.rows.length])
      const oldRows = new Map(old?.rows.map(row => [row.key, row]) || [])
      const previousOrder = this.recordOrder?.get(id) || new Map()
      const nextOrder = allocateRecordOrder(collection.rows, previousOrder)
      recordOrder.set(id, nextOrder)
      const currentKeys = new Set(collection.rows.map(row => row.key))
      const removed = [...oldRows.keys()].filter(key => !currentKeys.has(key))
      for (let start = 0; start < removed.length; start += 100) {
        const keys = removed.slice(start, start + 100)
        await query(this.connection, `DELETE FROM hufe_store_records WHERE collection_id = ? AND record_key IN (${keys.map(() => '?').join(',')})`, [id, ...keys])
      }
      for (const row of collection.rows) {
        const previous = oldRows.get(row.key)
        if (!previous || previous.hash !== row.hash || previousOrder.get(row.key) !== nextOrder.get(row.key)) writes.push([id, row.key, nextOrder.get(row.key), row.payload, row.hash])
      }
    }
    for (let cursor = 0; cursor < writes.length;) {
      const batch = []
      let bytes = 0
      while (cursor < writes.length && batch.length < 100) {
        const row = writes[cursor]
        const size = Buffer.byteLength(row[3]) + 256
        if (batch.length && bytes + size > 512 * 1024) break
        batch.push(row); bytes += size; cursor++
      }
      await query(this.connection, `INSERT INTO hufe_store_records (collection_id, record_key, ordinal, payload, payload_sha256) VALUES ${batch.map(() => '(?, ?, ?, ?, ?)').join(',')} ON DUPLICATE KEY UPDATE ordinal = VALUES(ordinal), payload = VALUES(payload), payload_sha256 = VALUES(payload_sha256)`, batch.flat())
    }
    return recordOrder
  }

  rebuildAppendState() {
    this.appendState = null
    if ((this.options.namespace || 'application') !== 'audit' || !Array.isArray(this.data?.requests)) return
    const collectionId = sha256('/requests'), order = this.recordOrder?.get(collectionId)
    if (!order || order.size !== this.data.requests.length) throw mysqlStorageError('MYSQL_SNAPSHOT_CORRUPT', '审计集合顺序索引不一致')
    const ids = new Set()
    for (const item of this.data.requests) if (item && !Array.isArray(item) && ['string', 'number'].includes(typeof item.id)) ids.add(canonicalJson(item.id))
    let lastOrdinal = -1024
    for (const ordinal of order.values()) lastOrdinal = Math.max(lastOrdinal, ordinal)
    this.appendState = { collectionId, ids, lastOrdinal, hashState: createArrayAppendHash(this.data, 'requests') }
  }

  // The request-audit namespace is append-only in AuditService. Each accepted
  // event writes one row plus small counters; neither cloning nor hashing nor
  // SQL updates scan the historical requests array. Generic transactions remain
  // available for explicit maintenance and invalidate this incremental cache.
  async append(field, input) {
    this.assertReady()
    if ((this.options.namespace || 'application') !== 'audit' || field !== 'requests') throw mysqlStorageError('MYSQL_APPEND_UNSUPPORTED', '当前集合不支持增量追加')
    const entry = JSON.parse(JSON.stringify(input))
    if (!entry || Array.isArray(entry) || typeof entry !== 'object' || !['string', 'number'].includes(typeof entry.id)) throw mysqlStorageError('MYSQL_APPEND_ID_REQUIRED', '审计追加记录必须包含唯一编号')
    const naturalId = canonicalJson(entry.id), key = sha256(`id:${naturalId}`), payload = canonicalJson(entry), payloadHash = sha256(payload)
    return this.enqueue(async () => {
      this.assertReady({ allowClosing: true })
      if (!this.appendState) this.rebuildAppendState()
      const current = this.appendState
      if (!current) throw mysqlStorageError('MYSQL_APPEND_UNSUPPORTED', '审计集合不存在，禁止自动创建')
      const order = this.recordOrder.get(current.collectionId)
      if (current.ids.has(naturalId) || order.has(key)) throw mysqlStorageError('MYSQL_APPEND_DUPLICATE_ID', '审计记录编号已经存在，禁止重复写入')
      const ordinal = current.lastOrdinal + 1024
      if (!Number.isSafeInteger(ordinal)) throw mysqlStorageError('MYSQL_APPEND_ORDER_EXHAUSTED', '审计顺序键已达到安全上限，需维护后重试')
      const next = advanceArrayAppendHash(current.hashState, payload)
      let committed = false
      try {
        await this.checkOwnership()
        await this.connection.beginTransaction()
        const [[meta]] = await query(this.connection, 'SELECT revision FROM hufe_store_meta WHERE id = 1 FOR UPDATE')
        if (!meta || Number(meta.revision) !== this.revision) throw mysqlStorageError('MYSQL_REVISION_CONFLICT', '检测到数据库被其他写入方修改，请停止服务并核查')
        await query(this.connection, 'INSERT INTO hufe_store_records (collection_id, record_key, ordinal, payload, payload_sha256) VALUES (?, ?, ?, ?, ?)', [current.collectionId, key, ordinal, payload, payloadHash])
        const [updated] = await query(this.connection, 'UPDATE hufe_store_collections SET row_count = row_count + 1 WHERE collection_id = ? AND row_count = ?', [current.collectionId, current.hashState.count])
        if (Number(updated.affectedRows) !== 1) throw mysqlStorageError('MYSQL_SNAPSHOT_CORRUPT', '审计集合数量校验失败')
        await query(this.connection, 'UPDATE hufe_store_meta SET revision = ?, snapshot_sha256 = ?, updated_at = ? WHERE id = 1', [this.revision + 1, next.hash, new Date().toISOString()])
        await this.connection.commit()
        committed = true
        // Publish only after confirmed COMMIT. A failed/uncertain commit leaves
        // data and streaming hash unchanged and takes this writer offline.
        this.data.requests.push(entry)
        order.set(key, ordinal)
        current.ids.add(naturalId)
        current.lastOrdinal = ordinal
        current.hashState = next.state
        this.revision++
        this.lastHealthyAt = Date.now()
        return { revision: this.revision, count: next.state.count }
      } catch (error) {
        this.connected = false
        if (!committed) await this.connection.rollback().catch(() => {})
        throw safeSqlError(error)
      }
    })
  }

  async transaction(mutator) {
    this.assertReady()
    return this.enqueue(async () => {
      // Already accepted writes drain during graceful shutdown; new calls above
      // are rejected once closing begins. No accepted mutation is silently lost.
      this.assertReady({ allowClosing: true })
      // A mutator throwing a business validation error is not a SQL failure.
      const draft = structuredClone(this.data)
      const result = await mutator(draft)
      const before = decomposeSnapshot(this.data), after = decomposeSnapshot(draft)
      let committed = false
      try {
        await this.checkOwnership()
        await this.connection.beginTransaction()
        const [[meta]] = await query(this.connection, 'SELECT revision FROM hufe_store_meta WHERE id = 1 FOR UPDATE')
        if (!meta || Number(meta.revision) !== this.revision) throw mysqlStorageError('MYSQL_REVISION_CONFLICT', '检测到数据库被其他写入方修改，请停止服务并核查')
        const recordOrder = await this.writeDiff(before, after)
        await query(this.connection, 'UPDATE hufe_store_meta SET revision = ?, layout = ?, snapshot_sha256 = ?, updated_at = ? WHERE id = 1', [this.revision + 1, JSON.stringify(after.layout), after.hash, new Date().toISOString()])
        await this.connection.commit()
        committed = true
        this.data = after.data
        this.recordOrder = recordOrder
        this.appendState = null
        this.revision++
        this.lastHealthyAt = Date.now()
        return result
      } catch (error) {
        // A dropped COMMIT reply has an uncertain outcome. Never keep serving a
        // potentially stale authentication cache; restart reloads committed SQL.
        this.connected = false
        if (!committed) await this.connection.rollback().catch(() => {})
        throw safeSqlError(error)
      }
    })
  }

  async importSnapshot(input, { expectedSha256 } = {}) {
    const after = decomposeSnapshot(input)
    if (expectedSha256 && expectedSha256 !== after.hash) throw mysqlStorageError('MYSQL_IMPORT_HASH_MISMATCH', '源数据校验值不一致，迁移已取消')
    try {
      await this.acquire()
      for (const sql of SCHEMA) await query(this.connection, sql)
      await this.connection.beginTransaction()
      const [[counts]] = await query(this.connection, 'SELECT (SELECT COUNT(*) FROM hufe_store_meta) AS meta_count, (SELECT COUNT(*) FROM hufe_store_collections) AS collection_count, (SELECT COUNT(*) FROM hufe_store_records) AS record_count')
      if (Number(counts.meta_count) || Number(counts.collection_count) || Number(counts.record_count)) throw mysqlStorageError('MYSQL_IMPORT_TARGET_NOT_EMPTY', '目标 MySQL 数据库已经包含湖财人数据，禁止覆盖导入')
      const recordOrder = await this.writeDiff({ collections: new Map() }, after)
      const now = new Date().toISOString()
      await query(this.connection, 'INSERT INTO hufe_store_meta (id, schema_version, revision, layout, snapshot_sha256, imported_at, updated_at) VALUES (1, ?, 0, ?, ?, ?, ?)', [MYSQL_STORE_SCHEMA_VERSION, JSON.stringify(after.layout), after.hash, now, now])
      const check = await loadMysqlSnapshot(this.connection)
      if (check.hash !== after.hash) throw mysqlStorageError('MYSQL_IMPORT_HASH_MISMATCH', 'SQL 回读校验失败，迁移已回滚')
      await this.connection.commit()
      this.data = after.data
      this.recordOrder = recordOrder
      this.rebuildAppendState()
      this.revision = 0
      this.lastHealthyAt = Date.now()
      this.startHeartbeat()
      return snapshotSummary(check.data)
    } catch (error) {
      if (this.connection) await this.connection.rollback().catch(() => {})
      await this.close()
      throw safeSqlError(error)
    }
  }

  async close() {
    if (this.closing) return this.closePromise
    this.closing = true
    clearInterval(this.heartbeat)
    this.closePromise = (async () => {
      await this.queue
      this.connected = false
      if (!this.connection) return
      if (this.lockName) await query(this.connection, 'SELECT RELEASE_LOCK(?)', [this.lockName]).catch(() => {})
      await this.connection.end().catch(() => {})
      this.connection = null
    })()
    return this.closePromise
  }
}
