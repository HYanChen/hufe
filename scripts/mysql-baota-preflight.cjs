const fs = require('node:fs')
const path = require('node:path')
const {isIP} = require('node:net')

const ROOT = '/www/hufe-platform'
const DATABASE_KEYS = ['DATABASE_DRIVER', 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD']

function parseEnv(content) {
  const values = {}
  for (const line of String(content).split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const match = /^([A-Z][A-Z0-9_]*)=([^\r\0]*)$/.exec(line)
    if (!match || Object.hasOwn(values, match[1])) throw Error('Invalid or duplicate database environment entry')
    values[match[1]] = match[2]
  }
  return values
}

function validateDatabaseEnv(content) {
  const values = parseEnv(content)
  if (Object.keys(values).some(key => !DATABASE_KEYS.includes(key)) || DATABASE_KEYS.some(key => !Object.hasOwn(values, key))) throw Error('Expected exactly the approved database environment entries')
  if (values.DATABASE_DRIVER !== 'mysql' || values.MYSQL_HOST !== 'hufe-mysql' || values.MYSQL_PORT !== '3306') throw Error('Database driver or private listener does not match deployment contract')
  if (!/^hufe_[A-Za-z0-9_]{1,48}$/.test(values.MYSQL_DATABASE)) throw Error('Dedicated hufe database name required')
  if (!/^hufe_[A-Za-z0-9_]{1,26}$/.test(values.MYSQL_USER)) throw Error('Dedicated non-root database account required')
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(values.MYSQL_PASSWORD)) throw Error('Expected a generated, Docker-env-safe database password')
  return values
}

function inspectMysqlContainer(rows, root = ROOT) {
  const c = rows?.[0]
  if (rows?.length !== 1 || c?.Name !== '/hufe-mysql' || !c.State?.Running) throw Error('Expected the running dedicated hufe-mysql container')
  if (c.HostConfig?.NetworkMode === 'host' || Object.values(c.HostConfig?.PortBindings || {}).some(value => value?.length) || Object.values(c.NetworkSettings?.Ports || {}).some(value => value?.length)) throw Error('MySQL must not publish a host database port')
  const networks = Object.keys(c.NetworkSettings?.Networks || {})
  if (networks.length !== 1 || networks[0] !== 'hufe-db') throw Error('MySQL must use only the private hufe-db network')
  const data = (c.Mounts || []).filter(m => m.Destination === '/var/lib/mysql')
  if (data.length !== 1 || data[0].Type !== 'bind' || !data[0].RW || data[0].Source !== `${root}/mysql/data`) throw Error('Unexpected MySQL persistent data mount')
  const secrets = (c.Mounts || []).filter(m => m.Destination === '/run/secrets')
  if (secrets.length !== 1 || secrets[0].Type !== 'bind' || secrets[0].RW || secrets[0].Source !== `${root}/mysql/secrets`) throw Error('Expected a read-only dedicated MySQL secrets mount')
  return true
}

function inspectMysqlNetwork(rows) {
  const n = rows?.[0]
  if (rows?.length !== 1 || n?.Name !== 'hufe-db' || n.Driver !== 'bridge' || n.Internal !== true) throw Error('Expected an internal dedicated hufe-db bridge network')
  return true
}

function assertLegacySource(rows) {
  const c = rows?.[0]
  if (rows?.length !== 1 || c?.Name !== '/hufe-api' || !c.State?.Running) throw Error('Expected the existing running hufe-api container')
  const driverEntries = (c.Config?.Env || []).filter(line => line.startsWith('DATABASE_DRIVER='))
  if (driverEntries.length > 1 || (driverEntries.length === 1 && driverEntries[0] !== 'DATABASE_DRIVER=json')) throw Error('This cutover accepts a JSON source only; never re-import stale JSON after MySQL activation')
  const env=Object.fromEntries((c.Config?.Env||[]).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)]}))
  for(const [key,file] of [['DATA_FILE','application-data.json'],['CONTENT_CACHE_FILE','content-cache.json'],['MEDIA_DIR','media']]) {
    if(env[key] && ![`/app/data/${file}`,`./data/${file}`,`data/${file}`].includes(env[key])) throw Error(`Custom ${key} requires an explicit reviewed migration source mapping`)
  }
  return true
}

function mergeRuntimeEnv(current, database, gateway) {
  const values = validateDatabaseEnv(database)
  if (isIP(gateway) !== 4) throw Error('A validated existing API bridge gateway is required')
  const before = parseEnv(current)
  if (before.DATABASE_DRIVER && before.DATABASE_DRIVER !== 'json') throw Error('Refusing to overwrite an already migrated runtime configuration')
  const overrides = {...values, TRUST_PROXY: 'true', TRUSTED_PROXY_CIDRS: `${gateway}/32,127.0.0.1/32,::1/128`, AUDIT_GEO_DIR: '/app/ip-region'}
  const lines = current.split('\n').filter(line => !/^(?:DATABASE_DRIVER|MYSQL_[A-Z0-9_]*|TRUST_PROXY|TRUSTED_PROXY_CIDRS|AUDIT_GEO_DIR)=/.test(line))
  return `${lines.join('\n').trimEnd()}\n${Object.entries(overrides).map(([key, value]) => `${key}=${value}`).join('\n')}\n`
}

function readPrivateEnv(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o077) !== 0) throw Error('Database environment must be a root-owned private regular file')
  const content = fs.readFileSync(file, 'utf8')
  validateDatabaseEnv(content)
  return content
}

module.exports = {parseEnv, validateDatabaseEnv, inspectMysqlContainer, inspectMysqlNetwork, assertLegacySource, mergeRuntimeEnv}
if (require.main === module) {
  const mode = process.argv[2]
  if (mode === 'container') inspectMysqlContainer(JSON.parse(fs.readFileSync(0, 'utf8')))
  else if (mode === 'network') inspectMysqlNetwork(JSON.parse(fs.readFileSync(0, 'utf8')))
  else if (mode === 'source') assertLegacySource(JSON.parse(fs.readFileSync(0, 'utf8')))
  else if (mode === 'database') readPrivateEnv('/mysql/application.env')
  else if (mode === 'runtime') {
    const file = '/shared/runtime.env'
    const next = mergeRuntimeEnv(fs.readFileSync(file, 'utf8'), readPrivateEnv('/mysql/application.env'), process.argv[3])
    const temporary = `${file}.${process.pid}.next`
    fs.writeFileSync(temporary, next, {flag: 'wx', mode: 0o600})
    fs.renameSync(temporary, file)
  } else if (mode === 'name') {
    process.stdout.write(validateDatabaseEnv(readPrivateEnv('/mysql/application.env')).MYSQL_DATABASE)
    process.exit(0)
  } else throw Error('Expected container, network, source, database, runtime, or name check')
  console.log(`MySQL deployment ${mode} check passed; no credentials displayed`)
}
