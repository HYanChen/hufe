import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonDatabase } from '../src/storage/json-database.js'

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-atomic-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return new JsonDatabase(path.join(directory, 'data.json')).init()
}

test('写盘失败不改变内存，也不会由下一次事务意外提交', async (t) => {
  const db = await fixture(t)
  const persist = db.persist.bind(db)
  db.persist = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) }
  await assert.rejects(db.transaction((data) => { data.failed = true }), { code: 'ENOSPC' })
  assert.equal(db.read().failed, undefined)
  db.persist = persist
  await db.transaction((data) => { data.success = true })
  const disk = JSON.parse(await fs.readFile(db.file, 'utf8'))
  assert.equal(disk.failed, undefined)
  assert.equal(disk.success, true)
})

test('等待落盘期间不可读取未提交内容，后续事务按顺序执行', async (t) => {
  const db = await fixture(t)
  const persist = db.persist.bind(db)
  let release
  let started
  const blocked = new Promise((resolve) => { release = resolve })
  const writing = new Promise((resolve) => { started = resolve })
  db.persist = async (draft) => { started(); await blocked; return persist(draft) }
  const first = db.transaction((data) => { data.sequence = [1] })
  await writing
  const second = db.transaction((data) => { data.sequence.push(2) })
  assert.equal(db.read().sequence, undefined)
  release()
  await Promise.all([first, second])
  assert.deepEqual(db.read().sequence, [1, 2])
  assert.deepEqual(JSON.parse(await fs.readFile(db.file, 'utf8')).sequence, [1, 2])
})
