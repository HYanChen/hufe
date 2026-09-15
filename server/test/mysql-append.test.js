import test from 'node:test'
import assert from 'node:assert/strict'
import { MySqlDatabase } from '../src/storage/mysql-database.js'
import { allocateRecordOrder, canonicalSnapshotHash, decomposeSnapshot, sha256 } from '../src/storage/mysql-snapshot.js'

test('万条审计追加不读取/序列化历史记录，SQL 数量和参数大小与历史条数无关', async () => {
  const requests = Array.from({ length: 12000 }, (_, index) => ({ id: `old-${index}`, details: { label: '原有请求' }, trace: { metadata: '历史'.repeat(200) } }))
  const data = { a: { keep: true }, requests, z: { future: '未知字段' } }
  const split = decomposeSnapshot(data), calls = []
  const db = new MySqlDatabase({ namespace: 'audit' })
  db.connected = true; db.lastHealthyAt = Date.now(); db.revision = 7; db.connectionId = 9; db.lockName = 'unit-test'
  db.data = split.data
  db.recordOrder = new Map([...split.collections].map(([id, collection]) => [id, allocateRecordOrder(collection.rows)]))
  db.connection = {
    query: async (options, parameters) => {
      calls.push({ sql: options.sql, parameters })
      if (options.sql.includes('IS_USED_LOCK')) return [[{ owner: 9 }]]
      if (options.sql.includes('SELECT revision')) return [[{ revision: 7 }]]
      return [{ affectedRows: 1 }]
    },
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, end: async () => {}
  }
  db.rebuildAppendState()
  const originalArray = db.data.requests
  // After one-time initialization, touching an old row or array iterator fails.
  // This detects full clones, map/reduce, full hashing and generic diff scans.
  db.data.requests = new Proxy(originalArray, {
    get(target, property, receiver) {
      if (property !== 'length' && property !== 'push') throw new Error(`追加不应读取历史数组属性: ${String(property)}`)
      return Reflect.get(target, property, receiver)
    }
  })
  const entry = { id: 'new-one', text: '新增消息😀' }
  await db.append('requests', entry)
  db.data.requests = originalArray
  assert.equal(calls.length, 5)
  assert.ok(JSON.stringify(calls).length < 2500)
  assert.equal(calls.filter(call => call.sql.startsWith('INSERT INTO')).length, 1)
  assert.equal(calls.filter(call => /UPDATE .*records/.test(call.sql)).length, 0)
  assert.equal(db.recordOrder.get(sha256('/requests')).size, 12001)
  assert.equal(db.data.requests.length, 12001)
  assert.equal(calls.at(-1).parameters[1], canonicalSnapshotHash(db.data))
  const queryCount = calls.length
  await assert.rejects(db.append('requests', entry), { code: 'MYSQL_APPEND_DUPLICATE_ID' })
  assert.equal(calls.length, queryCount)
  await db.close()
})
