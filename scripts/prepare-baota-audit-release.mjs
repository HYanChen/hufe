import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import releaseTools from './baota-release.cjs'

export async function prepareRelease({root = path.resolve(fileURLToPath(new URL('..', import.meta.url))), mysql = false, stamp = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomUUID().slice(0, 8)}`} = {}) {
  releaseTools.validateStamp(stamp)
  const output = path.join(root, '.local-runtime')
  const target = path.join(output, stamp)
  await fs.mkdir(output, {recursive: true})
  // Never merge a build into a previously packaged release.
  await fs.mkdir(target)
  const copy = (from, to) => fs.cp(path.join(root, from), path.join(target, to), {
    recursive: true,
    filter: source => !/(?:^|\/)\.DS_Store$| \d+\.[^/]+$/.test(source)
  })
  for (const [source, destination] of [
    ['dist/build/h5', 'frontend'], ['admin/dist', 'admin'],
    ['server/src', 'server/src'], ['server/package.json', 'server/package.json'],
    ['pnpm-lock.yaml', 'pnpm-lock.yaml'],
    [mysql ? 'scripts/mysql-baota-update.sh' : 'scripts/baota-update-audit.sh', 'update.sh'],
    ...['set-runtime', 'verify-accounts', 'maintenance', 'activate', 'release', 'nginx', 'preflight', 'restore-web', 'online'].map(name => [`scripts/baota-${name}.cjs`, `${name}.cjs`])
  ]) await copy(source, destination)
  if (mysql) {
    for(const file of ['mysql-baota-preflight.cjs','mysql-baota-dependencies.cjs','mysql-baota-account-integrity.cjs','mysql-baota-provision.cjs','mysql-baota-provision.sh','mysql-baota-retry-database.cjs','mysql-baota-retry-database.sh']) await copy(`scripts/${file}`,file)
    await copy('.local-runtime/mysql/server-dependencies.tar.gz','server-dependencies.tar.gz')
  }
  for (const file of ['ip2region_v4.xdb', 'ip2region_v6.xdb', 'manifest.json']) await copy(`server/data/ip-region/${file}`, `server/ip-region/${file}`)
  await copy('server/third-party/ip2region-LICENSE.txt', 'server/ip-region/LICENSE.txt')
  // Docker cannot create a missing nested /app/data mount target inside the
  // read-only /app release bind. Keep the empty mount directory in the verified
  // archive without copying any workstation application data into the release.
  await fs.mkdir(path.join(target, 'server/data'), {recursive: true})
  await fs.writeFile(path.join(target, 'server/data/.mountpoint'), 'Reserved mount point for separately managed persistent data. No application data is packaged here.\n', {mode: 0o644, flag: 'wx'})
  for (const file of ['frontend/index.html', 'admin/index.html', 'server/src/index.js', 'server/src/regions/seed.json', 'server/src/cli/merge-region-seed.js']) {
    if (!(await fs.stat(path.join(target, file))).isFile()) throw Error(`Missing release entry: ${file}`)
  }
  const files = releaseTools.inventory(target)
  for (const entry of files) await fs.chmod(path.join(target, entry.path), 0o644)
  async function directoryModes(directory) {
    await fs.chmod(directory, 0o755)
    for (const item of await fs.readdir(directory, {withFileTypes: true})) if (item.isDirectory()) await directoryModes(path.join(directory, item.name))
  }
  await directoryModes(target)
  await fs.writeFile(path.join(target, 'release-manifest.json'), `${JSON.stringify({version: 1, stamp, createdAt: new Date().toISOString(), files}, null, 2)}\n`, {mode: 0o644, flag: 'wx'})
  releaseTools.verifyRelease(target, stamp)
  const archive = path.join(output, `hufe-${stamp}.tar.gz`)
  await (await fs.open(archive, 'wx', 0o600)).close()
  execFileSync('tar', ['-czf', archive, '-C', target, '.'], {env: {...process.env, COPYFILE_DISABLE: '1'}})
  const sha256 = createHash('sha256').update(await fs.readFile(archive)).digest('hex')
  await fs.writeFile(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`, {mode: 0o600, flag: 'wx'})
  return {stamp, directory: target, archive, checksumFile: `${archive}.sha256`, bytes: (await fs.stat(archive)).size, sha256, files: files.length}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await prepareRelease({stamp: process.env.HUFE_RELEASE_STAMP || undefined,mysql:process.env.HUFE_RELEASE_MYSQL==='1'}), null, 2))
}
