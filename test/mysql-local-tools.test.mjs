import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseActiveMysqlEnv } from '../scripts/local-app.mjs'
import { validateLocalMysqlConfig, ownsApiRecord } from '../scripts/mysql-local-switch.mjs'
import { isolatedServerLock, lockServerVersions } from '../scripts/mysql-build-dependencies.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const password = 'test-only-value-not-a-real-secret-123456'
const config = { host: '127.0.0.1', port: 13306, database: 'hufe_local', user: 'hufe_local', password }
const environment = `DATABASE_DRIVER=mysql\nMYSQL_HOST=127.0.0.1\nMYSQL_PORT=13306\nMYSQL_DATABASE=hufe_local\nMYSQL_USER=hufe_local\nMYSQL_PASSWORD=${password}\n`

test('MySQL本地工具导入无启动副作用，激活配置仅允许专用loopback数据库', () => {
  assert.equal(parseActiveMysqlEnv(environment).MYSQL_DATABASE, 'hufe_local')
  assert.equal(validateLocalMysqlConfig(config), config)
  for (const bad of [environment.replace('127.0.0.1','0.0.0.0'), environment.replace('hufe_local','production'), environment + 'NODE_ENV=production\n', environment + 'MYSQL_USER=another\n', environment.replace(password, 'short')]) assert.throws(() => parseActiveMysqlEnv(bad))
  for (const bad of [{ ...config, host: 'remote' }, { ...config, user: 'root' }, { ...config, database: 'hufe_mysql_qa_migration' }, { ...config, socketPath: '/tmp/mysql.sock' }]) assert.throws(() => validateLocalMysqlConfig(bad))
})

test('本地切换只接受本项目准确API入口和相同进程组，不能误停其他服务', () => {
  const entry = path.join(root, 'server/src/index.js'), record = { pid: 12345, entry }
  assert.equal(ownsApiRecord(record, `node ${entry}`, 12345), true)
  assert.equal(ownsApiRecord(record, `node ${entry}`, 12346), false)
  assert.equal(ownsApiRecord(record, 'node other-project/server.js', 12345), false)
  assert.equal(ownsApiRecord({ ...record, entry: path.join(root, 'admin/node_modules/vite/bin/vite.js') }, 'vite', 12345), false)
  assert.equal(ownsApiRecord({ ...record, pid: 1 }, `node ${entry}`, 1), false)
})

test('隔离依赖lock仅启用server importer，保留原固定版本和完整package snapshots', async () => {
  const original = await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8')
  const versions = lockServerVersions(original)
  assert.equal(versions.size, 10)
  const isolated = isolatedServerLock(original)
  assert.match(isolated, /importers:\n\n  \.:/)
  assert.doesNotMatch(isolated.slice(0, isolated.indexOf('\npackages:')), /  server:|  admin:|@dcloudio/)
  assert.equal(isolated.slice(isolated.indexOf('\npackages:')), original.slice(original.indexOf('\npackages:')))
  assert.equal(versions.get('mysql2'), '3.24.4')
})

test('本地切换先完整校验六库再激活，并且不调用全量stop/start', async () => {
  const source = await fs.readFile(path.join(root, 'scripts/mysql-local-switch.mjs'), 'utf8')
  assert.ok(source.indexOf('imported.hash !== canonicalSnapshotHash(source)') >= 0)
  assert.ok(source.indexOf('imported.hash !== canonicalSnapshotHash(source)') < source.indexOf('await fs.writeFile(active, environment'))
  assert.match(source, /runLocalApp\('stop-api'/)
  assert.match(source, /runLocalApp\('start-api'/)
  assert.doesNotMatch(source, /runLocalApp\('(?:stop|start)'/)
  assert.match(source, /if \(activated\) throw new Error/)
  assert.match(source, /process.argv\[2\] !== '--apply'/)
})
