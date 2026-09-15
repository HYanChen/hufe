import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import retry from '../scripts/mysql-baota-retry-database.cjs'
import preflight from '../scripts/mysql-baota-preflight.cjs'

const secret = 'test-placeholder-not-a-production-password-123456'
const sourceEnv = `# Preserve credentials exactly\nDATABASE_DRIVER=mysql\nMYSQL_HOST=hufe-mysql\nMYSQL_PORT=3306\nMYSQL_DATABASE=hufe_alumni\nMYSQL_USER=hufe_app\nMYSQL_PASSWORD=${secret}\n`
const runtime = 'NODE_ENV=production\nDATABASE_DRIVER=json\nPRESERVE_SETTING=keep\n'
const dump = '-- MySQL dump 10.13\n' + '-- isolated preserved source database fixture\n'.repeat(8)
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hufe-retry-database-'))
  const opts = { mysqlDir: path.join(root, 'mysql'), sharedDir: path.join(root, 'shared'), uid: process.getuid() }
  fs.mkdirSync(opts.mysqlDir, { mode: 0o700 }); fs.mkdirSync(opts.sharedDir, { mode: 0o700 })
  fs.mkdirSync(path.join(opts.mysqlDir, 'secrets'), { mode: 0o700 })
  fs.writeFileSync(path.join(opts.mysqlDir, 'application.env'), sourceEnv, { mode: 0o600 })
  fs.writeFileSync(path.join(opts.mysqlDir, 'container.env'), 'initial-container-environment-preserved', { mode: 0o600 })
  fs.writeFileSync(path.join(opts.sharedDir, 'runtime.env'), runtime, { mode: 0o600 })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { ...opts, backup: path.join(opts.mysqlDir, `retry-${retry.TARGET}`) }
}
function preserve(t) {
  const opts = fixture(t)
  retry.prepareRetry(opts)
  fs.writeFileSync(path.join(opts.backup, 'failed-source.sql.next'), dump, { mode: 0o600 })
  retry.sealBackup(opts)
  return opts
}

test('重试库名称已符合原preflight白名单，辅助脚本只允许指定原库、新库及原账号', () => {
  assert.equal(preflight.validateDatabaseEnv(sourceEnv.replace('MYSQL_DATABASE=hufe_alumni\n', `MYSQL_DATABASE=${retry.TARGET}\n`)).MYSQL_DATABASE, retry.TARGET)
  const target = retry.targetEnvironment(sourceEnv)
  assert.equal(target, sourceEnv.replace('MYSQL_DATABASE=hufe_alumni\n', `MYSQL_DATABASE=${retry.TARGET}\n`))
  assert.equal(retry.validateRetryEnv(target).MYSQL_PASSWORD, secret)
  for (const bad of [sourceEnv.replace('hufe_alumni', 'other_database'), sourceEnv.replace('hufe_alumni', 'hufe_unapproved'), sourceEnv.replace('hufe_app', 'hufe_other'), sourceEnv.replace('MYSQL_HOST=hufe-mysql', 'MYSQL_HOST=public-host'), sourceEnv + 'EXTRA_SECRET=bad\n']) assert.throws(() => retry.validateRetryEnv(bad))
})

test('备份原配置与失败库后只切application.env，重复已完成检查只读且不覆盖', t => {
  const opts = preserve(t)
  assert.equal(fs.readFileSync(path.join(opts.mysqlDir, 'application.env'), 'utf8'), sourceEnv)
  assert.equal(fs.readFileSync(path.join(opts.backup, 'application-before.env'), 'utf8'), sourceEnv)
  assert.equal(fs.readFileSync(path.join(opts.backup, 'runtime-before.env'), 'utf8'), runtime)
  assert.equal(fs.readFileSync(path.join(opts.backup, 'failed-source.sql'), 'utf8'), dump)
  retry.activateRetry(opts)
  const before = fs.statSync(path.join(opts.mysqlDir, 'application.env')).mtimeMs
  assert.equal(retry.retryStatus(opts), 'prepared')
  assert.equal(retry.retryStatus(opts), 'prepared')
  assert.equal(fs.statSync(path.join(opts.mysqlDir, 'application.env')).mtimeMs, before)
  assert.equal(fs.readFileSync(path.join(opts.sharedDir, 'runtime.env'), 'utf8'), runtime)
  assert.equal(fs.readFileSync(path.join(opts.mysqlDir, 'container.env'), 'utf8'), 'initial-container-environment-preserved')
  assert.equal(retry.validateRetryEnv(fs.readFileSync(path.join(opts.mysqlDir, 'application.env'), 'utf8')).MYSQL_PASSWORD, secret)
  for (const file of ['application-before.env', 'runtime-before.env', 'prepared.json', 'failed-source.sql', 'backup-verified.json', 'completed.json']) assert.equal(fs.statSync(path.join(opts.backup, file)).mode & 0o777, 0o600)
  assert.throws(() => retry.prepareRetry(opts))
  assert.throws(() => retry.activateRetry(opts))
})

test('未封存备份、已存在准备状态、当前配置被改变及备份校验失败均拒绝覆盖', t => {
  const opts = fixture(t)
  retry.prepareRetry(opts)
  assert.throws(() => retry.retryStatus(opts), /manual review/)
  assert.throws(() => retry.prepareRetry(opts))
  assert.throws(() => retry.activateRetry(opts))
  fs.writeFileSync(path.join(opts.backup, 'failed-source.sql.next'), dump, { mode: 0o600 })
  retry.sealBackup(opts)
  fs.writeFileSync(path.join(opts.mysqlDir, 'application.env'), sourceEnv.replace(secret, 'changed-but-still-valid-password-placeholder-123456'))
  assert.throws(() => retry.activateRetry(opts), /configuration changed/)
  fs.writeFileSync(path.join(opts.mysqlDir, 'application.env'), sourceEnv)
  fs.appendFileSync(path.join(opts.backup, 'failed-source.sql'), '-- tamper')
  assert.throws(() => retry.activateRetry(opts), /integrity/)
  assert.equal(fs.readFileSync(path.join(opts.mysqlDir, 'application.env'), 'utf8'), sourceEnv)
})

test('空备份、符号链接、公开可读配置与未证明完成的新库配置均拒绝', t => {
  const opts = fixture(t)
  fs.chmodSync(path.join(opts.mysqlDir, 'application.env'), 0o644)
  assert.throws(() => retry.retryStatus(opts), /private/)
  fs.chmodSync(path.join(opts.mysqlDir, 'application.env'), 0o600)
  retry.prepareRetry(opts)
  fs.writeFileSync(path.join(opts.backup, 'failed-source.sql.next'), '', { mode: 0o600 })
  assert.throws(() => retry.sealBackup(opts), /empty or invalid/)
  fs.unlinkSync(path.join(opts.backup, 'failed-source.sql.next'))
  fs.symlinkSync(path.join(opts.backup, 'application-before.env'), path.join(opts.backup, 'failed-source.sql.next'))
  assert.throws(() => retry.sealBackup(opts), /regular file/)
  fs.writeFileSync(path.join(opts.mysqlDir, 'application.env'), retry.targetEnvironment(sourceEnv))
  assert.throws(() => retry.retryStatus(opts))
})

test('生产辅助脚本保留主脚本空库检查，先封存再CREATE，不停服务不清库不改密码', () => {
  const shell = fs.readFileSync(new URL('../scripts/mysql-baota-retry-database.sh', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../scripts/mysql-baota-update.sh', import.meta.url), 'utf8')
  assert.match(shell, /flock -n 9/)
  assert.match(shell, /mysql-baota-preflight\.cjs source/)
  assert.match(shell, /\[ "\$STATE" = prepared \]/)
  assert.ok(shell.indexOf('helper seal-backup') < shell.indexOf('sql "CREATE DATABASE'))
  assert.ok(shell.indexOf('SELECT CURRENT_USER') < shell.indexOf('helper activate'))
  assert.match(shell, /GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON/)
  assert.match(shell, /TO 'hufe_app'@'%'/)
  assert.doesNotMatch(shell, /CREATE DATABASE IF NOT EXISTS|DROP DATABASE|DROP TABLE|TRUNCATE|ALTER USER|CREATE USER|IDENTIFIED BY|GRANT ALL|docker (?:stop|start|restart|rm)\b|MYSQL_PWD|--password/)
  assert.match(main, /information_schema\.tables WHERE table_schema='\$DB_NAME';"\)" = 0/)
})
