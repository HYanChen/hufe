const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { validateDatabaseEnv } = require('./mysql-baota-preflight.cjs')

// Historical workflow example only: this fictional target is not a live
// deployment configuration. Review the complete source/target/user restrictions
// for an authorized migration; this is not a general-purpose retry installer.
const SOURCE = 'hufe_alumni', TARGET = 'hufe_retry_example', USER = 'hufe_app'
const CLIENT = 'retry-hufe_retry_example.cnf'
const sha = value => createHash('sha256').update(value).digest('hex')
const options = value => ({ mysqlDir: '/mysql', sharedDir: '/shared', uid: 0, ...value })
const directory = opts => path.join(opts.mysqlDir, `retry-${TARGET}`)
function privateFile(file, uid) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077)) throw Error('Retry input must be a private owned regular file')
  return fs.readFileSync(file)
}
function privateDirectory(file, uid) {
  const stat = fs.lstatSync(file)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077)) throw Error('Retry directory must be private and owned')
}
function writeNew(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600)
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function json(file, uid) {
  try { return JSON.parse(privateFile(file, uid).toString('utf8')) } catch { throw Error('Invalid private retry preservation record') }
}
function validateRetryEnv(content) {
  const values = validateDatabaseEnv(String(content))
  if (![SOURCE, TARGET].includes(values.MYSQL_DATABASE) || values.MYSQL_USER !== USER) throw Error('Retry is restricted to the approved source, target and existing application user')
  return values
}
function targetEnvironment(content) {
  if (validateRetryEnv(content).MYSQL_DATABASE !== SOURCE) throw Error('Only the original source database configuration may be switched')
  const next = String(content).replace(/^MYSQL_DATABASE=hufe_alumni$/m, `MYSQL_DATABASE=${TARGET}`)
  if (validateRetryEnv(next).MYSQL_DATABASE !== TARGET) throw Error('Retry database configuration was not changed exactly once')
  return next
}
function verifyPreservation(opts, { sealed = true } = {}) {
  const dir = directory(opts)
  privateDirectory(dir, opts.uid)
  const manifest = json(path.join(dir, 'prepared.json'), opts.uid)
  if (manifest.version !== 1 || manifest.source !== SOURCE || manifest.target !== TARGET || manifest.user !== USER) throw Error('Retry preservation identity does not match')
  const original = privateFile(path.join(dir, 'application-before.env'), opts.uid).toString('utf8')
  if (validateRetryEnv(original).MYSQL_DATABASE !== SOURCE || sha(original) !== manifest.sourceEnvironmentSha256 || sha(targetEnvironment(original)) !== manifest.targetEnvironmentSha256 || sha(privateFile(path.join(dir, 'runtime-before.env'), opts.uid)) !== manifest.runtimeSha256) throw Error('Preserved configuration integrity check failed')
  if (sealed) {
    const backup = json(path.join(dir, 'backup-verified.json'), opts.uid)
    const dump = privateFile(path.join(dir, 'failed-source.sql'), opts.uid)
    if (backup.source !== SOURCE || backup.bytes !== dump.length || backup.sha256 !== sha(dump) || dump.length < 128) throw Error('Preserved failed database backup integrity check failed')
  }
  return { dir, manifest, original }
}
function retryStatus(value = {}) {
  const opts = options(value)
  privateDirectory(opts.mysqlDir, opts.uid)
  const current = privateFile(path.join(opts.mysqlDir, 'application.env'), opts.uid).toString('utf8')
  const state = validateRetryEnv(current)
  if (state.MYSQL_DATABASE === SOURCE) {
    if (fs.existsSync(directory(opts)) || fs.existsSync(path.join(opts.mysqlDir, 'secrets', CLIENT))) throw Error('Previous retry preservation exists; no overwrite or automatic cleanup, manual review required')
    return 'new'
  }
  const { dir, manifest } = verifyPreservation(opts)
  const completed = json(path.join(dir, 'completed.json'), opts.uid)
  if (completed.source !== SOURCE || completed.target !== TARGET || completed.targetEnvironmentSha256 !== manifest.targetEnvironmentSha256 || sha(current) !== manifest.targetEnvironmentSha256) throw Error('Retry activation is unconfirmed; manual review required')
  return 'prepared'
}
function prepareRetry(value = {}) {
  const opts = options(value)
  if (retryStatus(opts) !== 'new') throw Error('Retry already prepared; existing configuration must not be overwritten')
  privateDirectory(path.join(opts.mysqlDir, 'secrets'), opts.uid)
  const current = privateFile(path.join(opts.mysqlDir, 'application.env'), opts.uid).toString('utf8')
  const runtime = privateFile(path.join(opts.sharedDir, 'runtime.env'), opts.uid)
  const vars = validateRetryEnv(current), next = targetEnvironment(current), dir = directory(opts)
  fs.mkdirSync(dir, { mode: 0o700 })
  writeNew(path.join(dir, 'application-before.env'), current)
  writeNew(path.join(dir, 'runtime-before.env'), runtime)
  writeNew(path.join(dir, 'prepared.json'), JSON.stringify({ version: 1, source: SOURCE, target: TARGET, user: USER, preparedAt: new Date().toISOString(), sourceEnvironmentSha256: sha(current), targetEnvironmentSha256: sha(next), runtimeSha256: sha(runtime) }, null, 2))
  // Reuse the existing application password; never CREATE/ALTER USER or put a
  // password in argv, stdout, SQL or an environment flag. MySQL mounts this
  // private directory read-only; the extra client file remains a private backup.
  writeNew(path.join(opts.mysqlDir, 'secrets', CLIENT), `[client]\nuser=${USER}\npassword=${vars.MYSQL_PASSWORD}\nhost=127.0.0.1\nprotocol=tcp\n`)
  return { source: SOURCE, target: TARGET }
}
function sealBackup(value = {}) {
  const opts = options(value), { dir } = verifyPreservation(opts, { sealed: false })
  const partial = path.join(dir, 'failed-source.sql.next'), dump = privateFile(partial, opts.uid)
  if (dump.length < 128 || !dump.subarray(0, 256).toString('utf8').includes('MySQL dump')) throw Error('Failed database preservation dump is empty or invalid')
  if (fs.existsSync(path.join(dir, 'failed-source.sql')) || fs.existsSync(path.join(dir, 'backup-verified.json'))) throw Error('Existing failed database backup will not be overwritten')
  fs.renameSync(partial, path.join(dir, 'failed-source.sql'))
  writeNew(path.join(dir, 'backup-verified.json'), JSON.stringify({ source: SOURCE, bytes: dump.length, sha256: sha(dump), verifiedAt: new Date().toISOString() }, null, 2))
}
function activateRetry(value = {}) {
  const opts = options(value), { dir, manifest, original } = verifyPreservation(opts)
  const file = path.join(opts.mysqlDir, 'application.env'), current = privateFile(file, opts.uid).toString('utf8')
  if (current !== original || sha(current) !== manifest.sourceEnvironmentSha256 || fs.existsSync(path.join(dir, 'completed.json'))) throw Error('Current configuration changed; retry activation refused')
  const temporary = `${file}.retry-${TARGET}.next`
  writeNew(temporary, targetEnvironment(original))
  fs.renameSync(temporary, file)
  writeNew(path.join(dir, 'completed.json'), JSON.stringify({ source: SOURCE, target: TARGET, targetEnvironmentSha256: manifest.targetEnvironmentSha256, activatedAt: new Date().toISOString() }, null, 2))
  // The active API and shared/runtime.env remain untouched. update.sh performs
  // its normal empty-target check, freezes JSON, then merges this configuration.
  return { source: SOURCE, target: TARGET }
}

module.exports = { SOURCE, TARGET, USER, CLIENT, validateRetryEnv, targetEnvironment, retryStatus, prepareRetry, sealBackup, activateRetry }
if (require.main === module) {
  try {
    const mode = process.argv[2]
    if (process.argv.length !== 3) throw Error('Unexpected retry helper arguments')
    if (mode === 'status') process.stdout.write(retryStatus())
    else if (mode === 'prepare') { prepareRetry(); console.log('Retry configuration backup prepared; no credentials displayed') }
    else if (mode === 'seal-backup') { sealBackup(); console.log('Failed source database backup sealed and hashed') }
    else if (mode === 'activate') { activateRetry(); console.log(`Retry target configuration prepared: ${TARGET}; running API untouched`) }
    else throw Error('Expected status, prepare, seal-backup or activate')
  } catch {
    console.error('Retry helper refused or failed; existing databases/configuration backups retained; inspect retry preservation state without printing credentials')
    process.exitCode = 1
  }
}
