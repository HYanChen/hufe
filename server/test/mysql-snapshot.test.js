import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceArrayAppendHash, allocateRecordOrder, canonicalJson, canonicalSnapshotHash, createArrayAppendHash, decomposeSnapshot, reconstructSnapshot, snapshotSummary } from '../src/storage/mysql-snapshot.js'
import { mysqlOptionsFromEnv, runMysqlDataCli } from '../src/cli/mysql-data.js'

test('MySQL 快照按业务集合拆行，保留未知属性、空集合、嵌套对象和账户凭据', () => {
  const source = JSON.parse('{"version":1,"accounts":[{"id":"人1","passwordHash":"immutable-hash","secret":{"encrypted":"密文","iv":"随机量"},"tags":["a","b"]}],"business":{"resources":{"community-posts":[{"id":"p1","body":"中文😀"}],"empty":[]},"setting":{"enabled":true,"missing":null}},"unknown":{"key/with~pointer":[],"__proto__":{"polluted":false}},"emptyObject":{},"number":1.25}')
  const split = decomposeSnapshot(source)
  assert.equal(split.collections.size, 4)
  assert.equal([...split.collections.values()].find(c => c.path === '/accounts').rows.length, 1)
  assert.deepEqual(reconstructSnapshot(split.layout, split.collections), source)
  assert.equal({}.polluted, undefined)
  assert.deepEqual(snapshotSummary(source), { sha256: canonicalSnapshotHash(source), collections: 4, records: 2, accounts: 1 })
})

test('MySQL 完整校验忽略对象属性顺序，但不会忽略数组顺序或任何数据值', () => {
  const left = { accounts: [{ b: 2, a: 1 }], settings: { x: true, y: null } }
  const right = { settings: { y: null, x: true }, accounts: [{ a: 1, b: 2 }] }
  assert.equal(canonicalSnapshotHash(left), canonicalSnapshotHash(right))
  assert.notEqual(canonicalSnapshotHash({ list: [1, 2] }), canonicalSnapshotHash({ list: [2, 1] }))
  assert.notEqual(canonicalSnapshotHash(left), canonicalSnapshotHash({ ...left, missing: null }))
})

test('MySQL 追加 SHA 与完整快照 SHA 完全一致，保留空数组、特殊字符和其他字段', () => {
  const states = [
    { requests: [] },
    { z: { tail: ['未知', null] }, requests: [], a: { earlier: true } },
    JSON.parse('{"__proto__":{"opaque":true},"z":{},"requests":[{"id":"existing","text":"换行\\n表情😀"}],"a":null}')
  ]
  for (const data of states) {
    let state = createArrayAppendHash(data, 'requests')
    assert.equal(state.prefix.copy().update(state.suffix).digest('hex'), canonicalSnapshotHash(data))
    for (let index = 0; index < 12; index++) {
      const entry = { z: ['😀', '\ud800', '\n\r\t\u0000', '中文𠀀'], id: `new-${index}`, a: { '': '"\\', value: index / 2 } }
      const before = state.prefix.copy().update(state.suffix).digest('hex')
      const next = advanceArrayAppendHash(state, canonicalJson(entry))
      assert.equal(state.prefix.copy().update(state.suffix).digest('hex'), before, '计算下一版本不得修改当前 SHA 状态')
      data.requests.push(entry)
      assert.equal(next.hash, canonicalSnapshotHash(data))
      assert.equal(next.state.count, data.requests.length)
      state = next.state
      if (index === 5) state = createArrayAppendHash(Object.fromEntries(Object.entries(data).reverse()), 'requests')
    }
  }
  assert.throws(() => createArrayAppendHash({ requests: null }, 'requests'))
})

test('MySQL 拆分支持重复 ID、无 ID、标量元素及对象中的同名路径', () => {
  const source = { rows: [{ id: 'same', a: 1 }, { id: 'same', a: 2 }, null, '字符串', 3, true, [1, 2], { id: 0 }], 'a/b': ['first'], a: { b: ['second'] } }
  const split = decomposeSnapshot(source)
  for (const collection of split.collections.values()) assert.equal(new Set(collection.rows.map(r => r.key)).size, collection.rows.length)
  assert.deepEqual(reconstructSnapshot(split.layout, split.collections), source)
})

test('MySQL 集合中的稳定 ID 不随排序或新记录前插而改变', () => {
  const before = decomposeSnapshot({ rows: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] })
  const after = decomposeSnapshot({ rows: [{ id: 'new' }, { id: 'b', name: '修改乙' }, { id: 'a', name: '甲' }] })
  const oldRows = [...before.collections.values()][0].rows, newRows = [...after.collections.values()][0].rows
  assert.equal(oldRows[0].key, newRows[2].key)
  assert.equal(oldRows[1].key, newRows[1].key)
})

test('MySQL 稀疏顺序键在前插、追加和中间插入时不更新原有记录', () => {
  const rows = keys => keys.map(key => ({ key }))
  const initial = allocateRecordOrder(rows(['a', 'b', 'c']))
  const prepended = allocateRecordOrder(rows(['new', 'a', 'b', 'c', 'last']), initial)
  for (const key of ['a', 'b', 'c']) assert.equal(prepended.get(key), initial.get(key))
  assert.ok(prepended.get('new') < prepended.get('a'))
  const middle = allocateRecordOrder(rows(['new', 'a', 'middle', 'b', 'c', 'last']), prepended)
  for (const key of prepended.keys()) assert.equal(middle.get(key), prepended.get(key))
  assert.ok(middle.get('a') < middle.get('middle') && middle.get('middle') < middle.get('b'))
  const reordered = allocateRecordOrder(rows(['c', 'b', 'a']), middle)
  assert.ok(reordered.get('c') < reordered.get('b') && reordered.get('b') < reordered.get('a'))
  assert.equal(allocateRecordOrder([]).size, 0)
})

test('MySQL 稀疏顺序键不足或超出安全整数时自动重排，不丢记录', () => {
  const rows = [{ key: 'a' }, { key: 'x' }, { key: 'b' }]
  const tight = allocateRecordOrder(rows, new Map([['a', 0], ['b', 1]]))
  assert.deepEqual([...tight.values()], [0, 1024, 2048])
  const edge = allocateRecordOrder([{ key: 'a' }, { key: 'next' }], new Map([['a', Number.MAX_SAFE_INTEGER]]))
  assert.deepEqual([...edge.values()], [0, 1024])
})

test('MySQL 还原拒绝丢失集合、重复引用、记录篡改和顺序损坏', () => {
  const source = { accounts: [{ id: 'a' }, { id: 'b' }] }
  for (const mutate of [
    split => split.collections.clear(),
    split => { const rows = [...split.collections.values()][0].rows; rows[0].payload = '{"id":"tampered"}' },
    split => { [...split.collections.values()][0].rows[0].ordinal = 9 },
    split => split.layout.entries.push(['extra', split.layout.entries[0][1]])
  ]) {
    const split = decomposeSnapshot(source)
    mutate(split)
    assert.throws(() => reconstructSnapshot(split.layout, split.collections))
  }
})

test('MySQL CLI 不接受空凭据、命令行密码、相对路径和未授权命名空间', async () => {
  assert.throws(() => mysqlOptionsFromEnv({}), /必须设置/)
  assert.throws(() => mysqlOptionsFromEnv({ MYSQL_DATABASE: 'test', MYSQL_USER: 'u', MYSQL_PASSWORD: 'never-log', MYSQL_PORT: 'no' }), /MYSQL_PORT/)
  await assert.rejects(runMysqlDataCli(['import', '--file', 'data.json']), /绝对路径/)
  await assert.rejects(runMysqlDataCli(['import', '--file', '/tmp/test', '--password', 'never-log']), /无效/)
  await assert.rejects(runMysqlDataCli(['import', '--file', '/tmp/test', '--namespace', 'another']), /用法/)
})
