const fs = require('node:fs')
const path = require('node:path')
const {isIP} = require('node:net')
function inspectContainer(rows, root = '/www/hufe-platform') {
  const c = rows[0]
  if (rows.length !== 1 || c.Name !== '/hufe-api' || !c.State?.Running) throw Error('Expected a running hufe-api container')
  const app = c.Mounts.filter(m => m.Destination === '/app'), data = c.Mounts.filter(m => m.Destination === '/app/data')
  if (app.length !== 1 || app[0].Type !== 'bind' || app[0].RW || path.dirname(path.dirname(app[0].Source)) !== `${root}/releases` || path.basename(app[0].Source) !== 'server') throw Error('Unexpected existing release mount')
  if (data.length !== 1 || data[0].Type !== 'bind' || !data[0].RW || data[0].Source !== `${root}/shared/data`) throw Error('Existing API data mount does not match the persistent production data directory')
  const ports = c.NetworkSettings?.Ports?.['8787/tcp']
  if (ports?.length !== 1 || ports[0].HostIp !== '127.0.0.1' || !['8787', '8788'].includes(ports[0].HostPort)) throw Error('Unexpected API port bindings')
  const networks = Object.values(c.NetworkSettings.Networks || {})
  if (networks.length !== 1 || isIP(networks[0].Gateway) !== 4) throw Error('Expected one IPv4 Docker bridge gateway')
  return {app: app[0].Source, port: ports[0].HostPort, gateway: networks[0].Gateway}
}
function checkDependencies(previous, current) {
  const stable = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))
  if (stable(previous.dependencies) !== stable(current.dependencies) || stable(previous.optionalDependencies) !== stable(current.optionalDependencies)) throw Error('Server dependency declarations changed; prepare matching Linux production dependencies before deploying')
}
function assertProduction(config) {
  if (config.env !== 'production' || config.host !== '0.0.0.0' || config.port !== 8787 || config.publicBaseUrl !== 'https://hufe.pla.wiki' || config.dataFile !== '/app/data/application-data.json' || !path.resolve(config.mediaDir).startsWith('/app/data/') || !path.resolve(config.content.cacheFile).startsWith('/app/data/')) throw Error('Production environment, public URL, listener or persistent data paths do not match the deployment contract')
}
module.exports = {inspectContainer, checkDependencies, assertProduction}
if (require.main === module) {
  if (process.argv[2] === 'container') {
    const result = inspectContainer(JSON.parse(fs.readFileSync(0, 'utf8')))
    console.log(`${result.app} ${result.port} ${result.gateway}`)
  } else if (process.argv[2] === 'dependencies') {
    checkDependencies(JSON.parse(fs.readFileSync('/old-package.json', 'utf8')), JSON.parse(fs.readFileSync('/release/server/package.json', 'utf8')))
    console.log('Existing Linux production dependency declarations match the release')
  } else throw Error('Expected container or dependencies preflight')
}
