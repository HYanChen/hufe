import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {prepareRelease} from '../scripts/prepare-baota-audit-release.mjs'
import release from '../scripts/baota-release.cjs'
import nginx from '../scripts/baota-nginx.cjs'
import checks from '../scripts/baota-preflight.cjs'
import {restoreWeb} from '../scripts/baota-restore-web.cjs'
import {checkOnline} from '../scripts/baota-online.cjs'

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-release-test-'))
  t.after(() => fs.rm(root, {recursive: true, force: true}))
  return root
}
async function put(root, name, value) {
  await fs.mkdir(path.dirname(path.join(root, name)), {recursive: true})
  await fs.writeFile(path.join(root, name), value)
}
async function packageFixture(t) {
  const root = await temporary(t)
  for (const name of ['dist/build/h5/index.html', 'dist/build/h5/assets/app.js', 'admin/dist/index.html', 'admin/dist/assets/app.js', 'server/src/index.js', 'server/src/regions/seed.json', 'server/src/cli/merge-region-seed.js', 'server/package.json', 'pnpm-lock.yaml', 'scripts/baota-update-audit.sh', 'server/data/ip-region/ip2region_v4.xdb', 'server/data/ip-region/ip2region_v6.xdb', 'server/data/ip-region/manifest.json', 'server/third-party/ip2region-LICENSE.txt', ...['set-runtime', 'verify-accounts', 'maintenance', 'activate', 'release', 'nginx', 'preflight', 'restore-web', 'online'].map(name => `scripts/baota-${name}.cjs`)]) await put(root, name, `fixture ${name}\n`)
  return root
}
test('unique release directories, complete tar and matching external SHA; never overwrite a reused stamp', async t => {
  const root = await packageFixture(t)
  const a = await prepareRelease({root}), b = await prepareRelease({root})
  assert.notEqual(a.stamp, b.stamp)
  assert.notEqual(a.archive, b.archive)
  assert.equal(release.verifyRelease(a.directory, a.stamp).files.length, a.files)
  const checksum = createHash('sha256').update(await fs.readFile(a.archive)).digest('hex')
  assert.equal(await fs.readFile(a.checksumFile, 'utf8'), `${checksum}  ${path.basename(a.archive)}\n`)
  const listed = execFileSync('tar', ['-tzf', a.archive], {encoding: 'utf8'})
  for (const name of ['release-manifest.json', 'server/data/.mountpoint', 'server/src/regions/seed.json', 'server/src/cli/merge-region-seed.js', 'online.cjs', 'nginx.cjs']) assert.ok(listed.includes(name), name)
  await assert.rejects(prepareRelease({root, stamp: a.stamp}), {code: 'EEXIST'})
  assert.equal(createHash('sha256').update(await fs.readFile(a.archive)).digest('hex'), checksum)
})
test('both JSON and MySQL releases include only the manifest-tracked persistent-data mount marker', async t => {
  const root = await packageFixture(t)
  await put(root, 'server/data/application-data.json', '{"private":"must never be packaged"}')
  for (const name of ['scripts/mysql-baota-update.sh', 'scripts/mysql-baota-preflight.cjs', 'scripts/mysql-baota-dependencies.cjs', 'scripts/mysql-baota-account-integrity.cjs', 'scripts/mysql-baota-provision.cjs', 'scripts/mysql-baota-provision.sh', 'scripts/mysql-baota-retry-database.cjs', 'scripts/mysql-baota-retry-database.sh', '.local-runtime/mysql/server-dependencies.tar.gz']) await put(root, name, `fixture ${name}\n`)
  for (const mysql of [false, true]) {
    const result = await prepareRelease({root, mysql})
    const manifest = release.verifyRelease(result.directory, result.stamp)
    assert(manifest.files.some(file => file.path === 'server/data/.mountpoint'))
    assert.deepEqual(await fs.readdir(path.join(result.directory, 'server/data')), ['.mountpoint'])
    const unpacked = path.join(root, `unpacked-${mysql}`)
    await fs.mkdir(unpacked)
    execFileSync('tar', ['-xzf', result.archive, '-C', unpacked])
    assert((await fs.stat(path.join(unpacked, 'server/data'))).isDirectory())
    assert.equal((await fs.stat(path.join(unpacked, 'server/data'))).mode & 0o777, 0o755)
    assert.equal((await fs.stat(path.join(unpacked, 'server/data/.mountpoint'))).mode & 0o777, 0o644)
    release.verifyRelease(unpacked, result.stamp)
    await fs.rm(path.join(unpacked, 'server/data/.mountpoint'))
    assert.throws(() => release.verifyRelease(unpacked, result.stamp), /inventory/)
  }
})
test('release verification rejects changed, extra, missing and private files', async t => {
  const root = await packageFixture(t), p = await prepareRelease({root})
  const file = path.join(p.directory, 'frontend/index.html'), original = await fs.readFile(file)
  await fs.writeFile(file, Buffer.alloc(original.length, 120))
  assert.throws(() => release.verifyRelease(p.directory, p.stamp), /SHA/)
  await fs.writeFile(file, original)
  await put(p.directory, 'stale.js', 'old build')
  assert.throws(() => release.verifyRelease(p.directory, p.stamp), /inventory/)
  await fs.rm(path.join(p.directory, 'stale.js'))
  await fs.rm(file)
  assert.throws(() => release.verifyRelease(p.directory, p.stamp), /inventory/)
  await fs.writeFile(file, original)
  await put(p.directory, 'server/.env', 'SECRET=not-real')
  assert.throws(() => release.verifyRelease(p.directory, p.stamp), /Private/)
})
test('packaging rejects symlinks and unsafe release stamps', async t => {
  const root = await packageFixture(t)
  await fs.symlink(path.join(root, 'server/package.json'), path.join(root, 'server/src/secret.js'))
  await assert.rejects(prepareRelease({root}), /symlinks/)
  for (const stamp of ['../previous', 'bad stamp', 'ab;echo1234', 'bad..stamp']) assert.throws(() => release.validateStamp(stamp))
})
const configuration = port => `client_max_body_size 12m;
location ^~ /api/ {
  proxy_pass http://127.0.0.1:${port};
  proxy_set_header Host hufe.pla.wiki;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
}
location = /health { proxy_pass http://127.0.0.1:${port}; }
location / { try_files $uri $uri/ /index.html; }`
test('repeat deployment switches either port, preserves forwarding, and does not duplicate API upload directives', () => {
  const first = nginx.activateConfig(configuration('8788'), '8788', '8787')
  const second = nginx.activateConfig(first, '8787', '8788')
  assert.equal((first.match(/proxy_pass http:\/\/127.0.0.1:8787;/g) || []).length, 2)
  assert.equal((second.match(/proxy_pass http:\/\/127.0.0.1:8788;/g) || []).length, 2)
  for (const text of ['client_max_body_size 20m;', 'proxy_request_buffering off;', 'proxy_buffering off;']) assert.equal(second.split(text).length, 2)
  assert.ok(second.includes('client_max_body_size 12m;'))
  for (const text of ['X-Forwarded-For $remote_addr', 'X-Real-IP $remote_addr', 'Host hufe.pla.wiki', 'X-Forwarded-Proto $scheme', 'try_files $uri $uri/ /index.html;']) assert.ok(second.includes(text))
  assert.throws(() => nginx.activateConfig(first, '8788', '8787'), /do not match/)
  assert.throws(() => nginx.activateConfig(first, '8787', '8787'), /distinct/)
})
test('maintenance rejects nested/repeated/unexpected config without silently changing other routes', () => {
  const original = configuration('8788'), gated = nginx.maintenanceConfig(original)
  assert.equal((gated.match(/return 503/g) || []).length, 1)
  assert.ok(gated.includes('location = /health { proxy_pass http://127.0.0.1:8788; }'))
  assert.throws(() => nginx.maintenanceConfig(gated), /existing maintenance/)
  assert.throws(() => nginx.activateConfig(gated, '8788', '8787'), /maintenance/)
  assert.throws(() => nginx.maintenanceConfig(original + '\nlocation ^~ /api/ {}'), /Expected one/)
})
const inspected = () => [{Name: '/hufe-api', State: {Running: true}, Mounts: [{Type: 'bind', Source: '/www/hufe-platform/releases/previous/server', Destination: '/app', RW: false}, {Type: 'bind', Source: '/www/hufe-platform/shared/data', Destination: '/app/data', RW: true}], NetworkSettings: {Ports: {'8787/tcp': [{HostIp: '127.0.0.1', HostPort: '8788'}]}, Networks: {bridge: {Gateway: '172.17.0.1'}}}}]
test('container preflight accepts current release but rejects public ports and mismatched data', () => {
  assert.equal(checks.inspectContainer(inspected()).port, '8788')
  const a = inspected(); a[0].Mounts[1].Source = '/www/other-site/data'
  assert.throws(() => checks.inspectContainer(a), /data mount/)
  const b = inspected(); b[0].NetworkSettings.Ports['8787/tcp'][0].HostIp = '0.0.0.0'
  assert.throws(() => checks.inspectContainer(b), /bindings/)
  const c = inspected(); c[0].Mounts[0].Source = '/tmp/unknown/server'
  assert.throws(() => checks.inspectContainer(c), /release mount/)
})
test('production paths and dependency declarations must match before service is stopped', () => {
  const config = {env: 'production', host: '0.0.0.0', port: 8787, publicBaseUrl: 'https://hufe.pla.wiki', dataFile: '/app/data/application-data.json', mediaDir: '/app/data/media', content: {cacheFile: '/app/data/content-cache.json'}}
  checks.assertProduction(config)
  for (const change of [{env: 'development'}, {dataFile: '/tmp/application-data.json'}, {mediaDir: '/app/data/../../tmp'}, {host: '127.0.0.1'}]) assert.throws(() => checks.assertProduction({...config, ...change}), /contract/)
  checks.checkDependencies({dependencies: {b: '^2', a: '^1'}}, {dependencies: {a: '^1', b: '^2'}})
  assert.throws(() => checks.checkDependencies({dependencies: {a: '^1'}}, {dependencies: {a: '^2'}}), /dependencies before deploying/)
})
test('rollback restores unhashed static assets and preserves BaoTa user.ini and old hashed files', async t => {
  const root = await temporary(t), backup = path.join(root, 'backup'), web = path.join(root, 'web')
  for (const [file, content] of [['index.html', 'old entry'], ['static/icon.png', 'old icon'], ['assets/old.js', 'old js'], ['.user.ini', 'old ini']]) await put(backup, file, content)
  for (const [file, content] of [['index.html', 'new entry'], ['static/icon.png', 'new icon'], ['assets/new.js', 'new js'], ['.user.ini', 'protected ini']]) await put(web, file, content)
  assert.equal(restoreWeb(backup, web), 3)
  assert.equal(await fs.readFile(path.join(web, 'static/icon.png'), 'utf8'), 'old icon')
  assert.equal(await fs.readFile(path.join(web, '.user.ini'), 'utf8'), 'protected ini')
  assert.equal(await fs.readFile(path.join(web, 'assets/old.js'), 'utf8'), 'old js')
  assert.equal(await fs.readFile(path.join(web, 'assets/new.js'), 'utf8'), 'new js')
})
test('online acceptance verifies API data, authorization boundaries and exact deployed asset bytes', async t => {
  const root = await temporary(t), responses = new Map()
  for (const [entry, dir] of [['/', 'frontend'], ['/admin/', 'admin']]) {
    const html = '<script type="module" src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">'
    for (const [name, value] of [['index.html', html], ['assets/app.js', 'const app=true'], ['assets/app.css', 'body{color:red}']]) await put(root, `${dir}/${name}`, value)
    responses.set(entry, html); responses.set(`${entry}assets/app.js`, 'const app=true'); responses.set(`${entry}assets/app.css`, 'body{color:red}')
  }
  for (const route of ['/health', '/api/v1/auth/registration/config', '/api/v1/regions', '/api/v1/business/bootstrap']) responses.set(route, JSON.stringify({code: 0, data: route === '/health' ? {status: 'ok'} : route === '/api/v1/regions' ? {items: []} : {}}))
  const mapUrl='/api/v1/maps/basemaps/changsha-v1/content', mapHeader=Buffer.alloc(127)
  mapHeader.write('PMTiles');mapHeader[7]=3
  responses.set('/api/v1/maps/public',JSON.stringify({code:0,data:{basemap:{url:mapUrl,sha256:'a'.repeat(64)},school:{coordinateSystem:'WGS84',longitude:112.9200854,latitude:28.208191}}}))
  responses.set('/api/v1/maps/network',JSON.stringify({code:0,data:{precision:'city',features:[]}}))
  responses.set(mapUrl,mapHeader)
  for(const asset of ['index.html','viewer.js','viewer.css','vendor/maplibre-gl.mjs','vendor/pmtiles.js','vendor/basemaps.js'])responses.set('/api/v1/maps/viewer/'+asset,'map fixture')
  const server = http.createServer((request, response) => {
    response.statusCode = request.url.startsWith('/api/v1/admin/') || ['/api/v1/gate/me','/api/v1/me/identity-card','/api/v1/auth/change-password'].includes(request.url) ? 401 : responses.has(request.url) ? 200 : 404
    if(request.url===mapUrl){assert.equal(request.headers.range,'bytes=0-126');response.statusCode=206;response.setHeader('content-range','bytes 0-126/1000')}
    response.end(responses.get(request.url) || '{}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {server.closeAllConnections(); server.close()})
  const base = `http://127.0.0.1:${server.address().port}`
  assert.deepEqual(await checkOnline({root, base}), {checkedAssets: 4})
  responses.set('/admin/assets/app.js', 'stale deployment')
  await assert.rejects(checkOnline({root, base}), /asset SHA mismatch/)
})
