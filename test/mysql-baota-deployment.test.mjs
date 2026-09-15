import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import checks from '../scripts/mysql-baota-preflight.cjs'
import dependencies from '../scripts/mysql-baota-dependencies.cjs'
import {accountDigest} from '../scripts/mysql-baota-account-integrity.cjs'

const database = overrides => Object.entries({DATABASE_DRIVER: 'mysql', MYSQL_HOST: 'hufe-mysql', MYSQL_PORT: '3306', MYSQL_DATABASE: 'hufe_alumni', MYSQL_USER: 'hufe_app', MYSQL_PASSWORD: 'a'.repeat(48), ...overrides}).map(([k, v]) => `${k}=${v}`).join('\n')
const mysql = () => [{Name: '/hufe-mysql', State: {Running: true}, HostConfig: {NetworkMode: 'hufe-db', PortBindings: {}}, NetworkSettings: {Ports: {'3306/tcp': null}, Networks: {'hufe-db': {}}}, Mounts: [{Destination: '/var/lib/mysql', Type: 'bind', RW: true, Source: '/www/hufe-platform/mysql/data'}, {Destination: '/run/secrets', Type: 'bind', RW: false, Source: '/www/hufe-platform/mysql/secrets'}]}]

test('database cutover requires an isolated account and private endpoint', () => {
  assert.equal(checks.validateDatabaseEnv(database()).MYSQL_DATABASE, 'hufe_alumni')
  for (const change of [{MYSQL_HOST: 'public.example.com'}, {MYSQL_HOST: '127.0.0.1'}, {MYSQL_USER: 'root'}, {MYSQL_DATABASE: 'mysql'}, {MYSQL_DATABASE: 'hufe_;DROP'}, {MYSQL_PORT: '3307'}, {MYSQL_PASSWORD: 'short'}, {MYSQL_PASSWORD: `"${'a'.repeat(48)}"`}, {MYSQL_PASSWORD: 'a'.repeat(32) + '\nPASSWORD_OVERRIDE=true'}, {DATABASE_DRIVER: 'json'}, {UNAPPROVED: '1'}]) assert.throws(() => checks.validateDatabaseEnv(database(change)))
  assert.throws(() => checks.validateDatabaseEnv(database() + '\nMYSQL_DATABASE=hufe_other'), /duplicate/)
})

test('MySQL runtime is never published or connected to unrelated networks and storage', () => {
  assert.equal(checks.inspectMysqlContainer(mysql()), true)
  const port = mysql(); port[0].HostConfig.PortBindings = {'3306/tcp': [{HostIp: '127.0.0.1', HostPort: '3306'}]}
  assert.throws(() => checks.inspectMysqlContainer(port), /publish/)
  const network = mysql(); network[0].NetworkSettings.Networks.bridge = {}
  assert.throws(() => checks.inspectMysqlContainer(network), /only/)
  const mount = mysql(); mount[0].Mounts[0].Source = '/www/other/data'
  assert.throws(() => checks.inspectMysqlContainer(mount), /data mount/)
  const secrets = mysql(); secrets[0].Mounts[1].RW = true
  assert.throws(() => checks.inspectMysqlContainer(secrets), /read-only/)
  assert.equal(checks.inspectMysqlNetwork([{Name: 'hufe-db', Driver: 'bridge', Internal: true}]), true)
  assert.throws(() => checks.inspectMysqlNetwork([{Name: 'hufe-db', Driver: 'bridge', Internal: false}]), /internal/)
})

test('cutover refuses stale JSON when current service already uses MySQL', () => {
  const source = driver => [{Name: '/hufe-api', State: {Running: true}, Config: {Env: driver ? [`DATABASE_DRIVER=${driver}`] : []}}]
  assert.equal(checks.assertLegacySource(source()), true)
  assert.equal(checks.assertLegacySource(source('json')), true)
  assert.throws(() => checks.assertLegacySource(source('mysql')), /stale JSON/)
  assert.throws(() => checks.assertLegacySource(source('postgres')), /JSON source/)
  for (const [key, file] of [['DATA_FILE', 'application-data.json'], ['CONTENT_CACHE_FILE', 'content-cache.json'], ['MEDIA_DIR', 'media']]) {
    const expected = source('json'); expected[0].Config.Env.push(`${key}=/app/data/${file}`)
    assert.equal(checks.assertLegacySource(expected), true)
    const custom = source('json'); custom[0].Config.Env.push(`${key}=/app/data/custom/${file}`)
    assert.throws(() => checks.assertLegacySource(custom), /explicit reviewed migration source mapping/)
  }
})

test('runtime database change preserves application signing, encryption and external integration credentials', () => {
  const original = '# Production settings\nNODE_ENV=production\nDATA_HASH_SECRET=original-identity-key\nJWT_SECRET=original-signing-key\nSCHOOL_CLIENT_SECRET=keep=all=bytes\nDATABASE_DRIVER=json\nMYSQL_HOST=old\nTRUST_PROXY=false\n'
  const result = checks.mergeRuntimeEnv(original, database(), '172.17.0.1')
  for (const line of ['DATA_HASH_SECRET=original-identity-key', 'JWT_SECRET=original-signing-key', 'SCHOOL_CLIENT_SECRET=keep=all=bytes', 'NODE_ENV=production']) assert.ok(result.includes(`${line}\n`))
  assert.equal(result.match(/^DATABASE_DRIVER=mysql$/gm).length, 1)
  assert.equal(result.match(/^MYSQL_HOST=hufe-mysql$/gm).length, 1)
  assert.ok(result.includes('TRUSTED_PROXY_CIDRS=172.17.0.1/32,127.0.0.1/32,::1/128'))
  assert.throws(() => checks.mergeRuntimeEnv(result, database(), '172.17.0.1'), /already migrated/)
  assert.throws(() => checks.mergeRuntimeEnv(original, database(), 'localhost'), /gateway/)
})

test('dependency extraction rejects traversal, absolute paths, symlinks and unapproved files', () => {
  assert.equal(dependencies.validatePaths('node_modules/\nnode_modules/mysql2/package.json\nnode_modules/mysql2/index.js\n'), true)
  for (const extra of ['../../etc/passwd', '/etc/passwd', 'node_modules/../../outside', 'server/.env', 'node_modules/evil\\outside']) assert.throws(() => dependencies.validatePaths(`node_modules/mysql2/package.json\n${extra}\n`), /unsafe/)
  assert.throws(() => dependencies.validatePaths('node_modules/other/package.json\n'), /mysql2/)
  assert.equal(dependencies.validateTypes('drwxr-xr-x root/root 0 date node_modules/\n-rw-r--r-- root/root 3 date node_modules/mysql2/package.json\n'), true)
  for (const prefix of ['l', 'h', 'b', 'c', 'p']) assert.throws(() => dependencies.validateTypes(`${prefix}rwxrwxrwx root/root 0 date node_modules/link -> /etc\n`), /regular/)
})

test('account integrity compares every field independent of JSON object key order', () => {
  const source = {accounts: [{id: '1', passwordHash: 'existing-hash', roles: ['member'], profile: {major: '计算机', verified: true}}]}
  const reordered = {accounts: [{profile: {verified: true, major: '计算机'}, roles: ['member'], passwordHash: 'existing-hash', id: '1'}]}
  assert.equal(accountDigest(source), accountDigest(reordered))
  for (const field of ['passwordHash', 'id', 'roles', 'profile', 'credentialRevision']) {
    const changed = structuredClone(source)
    changed.accounts[0][field] = 'changed'
    assert.notEqual(accountDigest(source), accountDigest(changed))
  }
  assert.throws(() => accountDigest({}), /unavailable/)
})

test('cutover imports frozen production snapshots, verifies all stores and has a no-data-rollback commit boundary', async () => {
  const script = await fs.readFile(new URL('../scripts/mysql-baota-update.sh', import.meta.url), 'utf8')
  assert.match(script, /for namespace in application chat image-transfers audit regions content/)
  assert.ok(script.indexOf('docker stop -t 30 hufe-api') > 0)
  assert.ok(script.indexOf('docker stop -t 30 hufe-api') < script.indexOf('node src/cli/prepare-mysql-snapshots.js'))
  assert.ok(script.indexOf('node src/cli/prepare-mysql-snapshots.js') < script.indexOf('for action in import verify'))
  assert.ok(script.indexOf('for action in import verify') < script.indexOf('docker create --name hufe-api'))
  assert.ok(script.indexOf('mysql-baota-account-integrity.cjs verify') < script.indexOf('DONE=true'))
  assert.match(script, /if \[ "\$DONE" = true \]; then[\s\S]*?current MySQL data preserved[\s\S]*?exit "\$code"/)
  assert.doesNotMatch(script, /merge-region-seed|DROP DATABASE|docker (?:rm|volume rm).*hufe-mysql/)
  assert.match(script, /docker network connect hufe-db hufe-api/)
  assert.ok(script.indexOf('docker network connect hufe-db hufe-api') < script.indexOf('docker start hufe-api >/dev/null', script.indexOf('docker create --name hufe-api')))
  assert.match(script, /mysql-imported\.sql/)
  assert.ok(script.indexOf('test -f "$RELEASE/server/data/.mountpoint"') < script.indexOf('PHASE=ready'))
  assert.match(script.slice(0, script.indexOf('PHASE=ready')), /docker run --rm --network none --read-only --user 1000:1000[\s\S]*?-v "\$RELEASE\/server:\/app:ro" -v "\$ROOT\/shared\/data:\/app\/data:ro"/)
  assert.match(script, /set -Eeuo pipefail\numask 077/)
  assert.match(script, /\(\n  umask 022\n  tar -xzf server-dependencies\.tar\.gz --no-same-owner --no-same-permissions -C server\n\)/)
  assert.equal((script.match(/umask 022/g) || []).length, 1)
})

test('HTTP QA retains existing SQL by default and uses a separate browser-safe probe identity', async () => {
  const harness = await fs.readFile(new URL('../scripts/mysql-browser-qa.mjs', import.meta.url), 'utf8')
  const regression = await fs.readFile(new URL('../scripts/mysql-http-acceptance.mjs', import.meta.url), 'utf8')
  assert.match(harness, /if\(process\.env\.HUFE_QA_RESET_SQL==='1'\)/)
  assert.doesNotMatch(harness, /HUFE_QA_REUSE_SQL!=='1'/)
  assert.match(harness, /mysql_qa_http_admin/)
  assert.match(regression, /identity\.database, mysql\.database/)
  assert.match(regression, /before\.data\.requests\.length >= 10000/)
  assert.match(regression, /deepEqual\(after\.data\.requests\[i\], before\.data\.requests\[i\]/)
  assert.match(regression, /username: 'mysql_qa_http_admin'/)
  assert.doesNotMatch(regression, /DROP TABLE|mysql-full-acceptance|username: 'mysql_qa_admin'/)
})
