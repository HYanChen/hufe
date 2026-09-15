const fs = require('node:fs')
const path = require('node:path')
const {createHash} = require('node:crypto')
async function checkOnline({base = 'https://hufe.pla.wiki', root = '/release'} = {}) {
  async function request(route, status = 200, headers = {}) {
    const response = await fetch(new URL(route, base), {signal: AbortSignal.timeout(12000), headers: {'cache-control': 'no-cache', ...headers}, redirect: 'error'})
    if (response.status !== status) throw Error(`Online ${route}: expected ${status}, got ${response.status}`)
    return response
  }
  for (const route of ['/health', '/api/v1/auth/registration/config', '/api/v1/regions', '/api/v1/business/bootstrap']) {
    const result = await (await request(route)).json()
    if (result.code !== 0 || !result.data || route === '/health' && result.data.status !== 'ok' || route === '/api/v1/regions' && !Array.isArray(result.data.items)) throw Error(`Invalid online API response: ${route}`)
  }
  for (const route of ['/api/v1/admin/audit-logs', '/api/v1/admin/regions', '/api/v1/admin/maps', '/api/v1/admin/enterprise-lookup', '/api/v1/admin/personnel/template', '/api/v1/gate/me', '/api/v1/me/identity-card']) await request(route, 401)
  // Probe new mutation routes without credentials. This verifies registration,
  // never changes an account, issues a number or creates a certificate.
  for (const route of [
    '/api/v1/admin/accounts/00000000-0000-4000-8000-000000000000/manual-verification',
    '/api/v1/admin/accounts/00000000-0000-4000-8000-000000000000/alumni-number',
    '/api/v1/admin/accounts/alumni-numbers/preview', '/api/v1/admin/accounts/alumni-numbers/apply',
    '/api/v1/admin/business/giving-projects/00000000-0000-4000-8000-000000000000/certificate-template',
    '/api/v1/auth/change-password'
  ]) {
    const response = await fetch(new URL(route, base), {method:'POST',body:'{}',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)})
    if(response.status!==401)throw Error(`Online protected mutation ${route}: expected 401, got ${response.status}`)
  }
  const maps = await (await request('/api/v1/maps/public')).json()
  const basemap = maps.data?.basemap
  if (maps.code !== 0 || !basemap || !/^\/api\/v1\/maps\/basemaps\/[a-z0-9-]+\/content$/.test(basemap.url) || !/^[a-f0-9]{64}$/.test(basemap.sha256)) throw Error('Invalid published local map configuration')
  if(maps.data.school?.coordinateSystem!=='WGS84'||!Number.isFinite(maps.data.school.longitude)||!Number.isFinite(maps.data.school.latitude))throw Error('School map centre is missing')
  const network=await(await request('/api/v1/maps/network')).json()
  if(network.code!==0||network.data?.precision!=='city'||!Array.isArray(network.data.features))throw Error('Public alumni area map is not available')
  const mapRange = await request(basemap.url, 206, {range:'bytes=0-126'})
  const header = Buffer.from(await mapRange.arrayBuffer())
  if (header.length !== 127 || header.subarray(0,7).toString() !== 'PMTiles' || header[7] !== 3 || !mapRange.headers.get('content-range')?.startsWith('bytes 0-126/')) throw Error('Local PMTiles byte range is not served correctly')
  for (const asset of ['index.html','viewer.js','viewer.css','vendor/maplibre-gl.mjs','vendor/pmtiles.js','vendor/basemaps.js']) await request('/api/v1/maps/viewer/'+asset)
  for (const route of ['/server/package.json', '/data/application-data.json', '/.env']) await request(route, 404)
  let checkedAssets = 0
  for (const [entry, directory] of [['/', 'frontend'], ['/admin/', 'admin']]) {
    const html = await (await request(entry)).text()
    if (html !== fs.readFileSync(path.join(root, directory, 'index.html'), 'utf8')) throw Error(`Online entrypoint does not match this release: ${entry}`)
    const links = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match => new URL(match[1], new URL(entry, base)))
    if (!links.some(url => url.pathname.endsWith('.js'))) throw Error(`No application script in ${entry}`)
    for (const url of links) {
      if (url.origin !== new URL(base).origin) throw Error('Unexpected external initial build asset')
      const relative = url.pathname.slice(entry.length)
      if (!relative || relative.includes('..') || relative.startsWith('/')) throw Error('Unexpected build asset path')
      const bytes = Buffer.from(await (await request(url.pathname + url.search)).arrayBuffer())
      const expected = fs.readFileSync(path.join(root, directory, relative))
      const sum = value => createHash('sha256').update(value).digest('hex')
      if (sum(bytes) !== sum(expected)) throw Error(`Online asset SHA mismatch: ${url.pathname}`)
      checkedAssets++
    }
  }
  return {checkedAssets}
}
module.exports = {checkOnline}
if (require.main === module) checkOnline().then(result => console.log(`Online API, authentication boundaries and ${result.checkedAssets} entry assets verified`)).catch(error => {console.error(error.message); process.exitCode = 1})
