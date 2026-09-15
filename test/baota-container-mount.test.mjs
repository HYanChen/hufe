import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const exec = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
// Opt-in integration: cached Linux image only, isolated temporary files, no
// network and no existing account/database/service/container mutation.
test('Linux production extraction and read-only nested mounts permit uid1000 dependency imports and real API startup', { skip: process.env.HUFE_RUN_DOCKER_MOUNT_TEST !== '1', timeout: 240000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-container-mount-'))
  const app = path.join(temporary, 'server'), data = path.join(temporary, 'data')
  await fs.mkdir(app); await fs.mkdir(data, { mode: 0o777 }); await fs.chmod(data, 0o777)
  const container = `hufe-mount-regression-${randomUUID().slice(0, 8)}`
  const volume = `hufe-mount-permissions-${randomUUID().slice(0, 8)}`
  t.after(async () => {
    await exec('docker', ['rm', '-f', container]).catch(() => {})
    await exec('docker', ['volume', 'rm', volume]).catch(() => {})
    await fs.rm(temporary, { recursive: true, force: true })
  })
  await exec('docker', ['image', 'inspect', 'node:22-alpine'])
  // Production extracts with GNU tar on the Linux host, then executes Node on
  // Alpine. Use the cached Debian image for extraction, not macOS/BSD tar.
  await exec('docker', ['image', 'inspect', 'node:20-bookworm-slim'])
  const runtimeArgs = (appSource, dataSource) => ['run', '--rm', '--pull=never', '--name', container, '--read-only', '--network', 'none', '--user', '1000:1000', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', `${appSource}:/app:ro`, '-v', `${dataSource}:/app/data:rw`, '-w', '/app', 'node:22-alpine']
  // Reproduce the exact deployment failure before the target exists.
  await assert.rejects(exec('docker', [...runtimeArgs(app, data), 'node', '-e', 'process.exit(0)'], { timeout: 30000 }), error => /read-only file system|read only file system|error mounting/i.test(error.stderr || error.message))
  await exec('docker', ['rm', '-f', container]).catch(() => {})

  await fs.cp(path.join(root, 'server/src'), path.join(app, 'src'), { recursive: true })
  await fs.copyFile(path.join(root, 'server/package.json'), path.join(app, 'package.json'))
  await fs.mkdir(path.join(app, 'data'), { mode: 0o755 })
  await fs.writeFile(path.join(app, 'data/.mountpoint'), 'Reserved persistent data mount.\n', { mode: 0o644 })
  const archive = path.join(root, '.local-runtime/mysql/server-dependencies.tar.gz')
  const extractionCommand = 'tar -xzf server-dependencies.tar.gz --no-same-owner --no-same-permissions -C server'
  const script = await fs.readFile(path.join(root, 'scripts/mysql-baota-update.sh'), 'utf8')
  const extractionBlock = script.match(/\(\n  umask 022\n  tar -xzf server-dependencies\.tar\.gz --no-same-owner --no-same-permissions -C server\n\)/)?.[0]
  assert(extractionBlock, 'Run the exact scoped extraction block from the deployment script')
  await fs.copyFile(archive, path.join(temporary, 'server-dependencies.tar.gz'))
  // macOS shared directories can relax UID permission checks. Store extracted
  // files on a native Linux volume, then bind its real Linux path just as the
  // server binds a release directory. This is not pre-chmodded node_modules.
  await exec('docker', ['volume', 'create', volume])
  const inspected = JSON.parse((await exec('docker', ['volume', 'inspect', volume])).stdout)[0]
  assert.equal(inspected.Name, volume)
  const linuxRoot = inspected.Mountpoint
  assert(linuxRoot.startsWith('/var/lib/docker/volumes/'))
  await exec('docker', ['run', '--rm', '--pull=never', '--read-only', '--network', 'none', '-v', `${volume}:/release:rw`, '-v', `${temporary}:/source:ro`, 'node:20-bookworm-slim', 'sh', '-c', 'mkdir -p /release/denied/server /release/good/server /release/good/data\ncp -R /source/server/. /release/good/server/\ncp /source/server-dependencies.tar.gz /release/denied/server-dependencies.tar.gz\ncp /source/server-dependencies.tar.gz /release/good/server-dependencies.tar.gz\nchmod 0777 /release/good/data'], {timeout:60000})
  const extractArgs = subdir => ['run', '--rm', '--pull=never', '--read-only', '--network', 'none', '-v', `${volume}:/release:rw`, '-w', `/release/${subdir}`, 'node:20-bookworm-slim', 'sh', '-c']
  const deniedExtraction = await exec('docker', [...extractArgs('denied'), `umask 077\n${extractionCommand}\nstat -c '%a' server/node_modules server/node_modules/mysql2 server/node_modules/mysql2/package.json`], {timeout: 60000})
  assert.deepEqual(deniedExtraction.stdout.trim().split('\n'), ['700', '700', '600'])
  await assert.rejects(exec('docker', ['run', '--rm', '--pull=never', '--read-only', '--network', 'none', '--user', '1000:1000', '-v', `${linuxRoot}/denied/server:/app:ro`, '-w', '/app', 'node:22-alpine', 'node', '--input-type=module', '-e', 'import "mysql2/promise"'], {timeout:30000}), error => /ERR_MODULE_NOT_FOUND|EACCES/.test(error.stderr || error.message))
  // Start from a different, clean directory; do not chmod or reuse dependencies
  // produced by the failing command. The parent mask must remain 077 afterward.
  const extracted = await exec('docker', [...extractArgs('good'), `umask 077\n${extractionBlock}\ntest "$(umask)" = 0077\ntouch private-backup-permission-probe\nstat -c '%a' server/node_modules server/node_modules/mysql2 server/node_modules/mysql2/package.json private-backup-permission-probe`], {timeout:60000})
  assert.deepEqual(extracted.stdout.trim().split('\n'), ['755', '755', '644', '600'])
  const program = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import mysql from 'mysql2/promise';
    import {buildApp} from './src/app.js';
    import {createConfig} from './src/config.js';
    assert.equal(process.getuid(), 1000);
    assert.equal(typeof mysql.createConnection, 'function');
    await fs.writeFile('/app/data/mount-probe', 'isolated mount probe');
    await assert.rejects(fs.writeFile('/app/release-must-stay-readonly', 'blocked'), error => ['EROFS','EACCES'].includes(error.code));
    const config=createConfig({env:'test',databaseDriver:'json',host:'127.0.0.1',port:8787,dataFile:'/app/data/application-data.json',mediaDir:'/app/data/media',content:{cacheFile:'/app/data/content-cache.json'}});
    const app=await buildApp({config,logger:false,refreshContent:false,scheduleContent:false});
    try { await app.listen({host:'127.0.0.1',port:8787}); const response=await fetch('http://127.0.0.1:8787/health'); assert.equal(response.status,200); assert.equal((await response.json()).data.database.driver,'json'); console.log(JSON.stringify({startup:true,uid:process.getuid(),mysql2Import:true,appImport:true,scopedExtractionPermissions:true,privateFilesRemain600:true,releaseReadOnly:true,persistentDataWritable:true,isolatedFreshDatabase:true})); }
    finally { await app.close(); }
  `
  const result = await exec('docker', [...runtimeArgs(`${linuxRoot}/good/server`, `${linuxRoot}/good/data`), 'node', '--input-type=module', '-e', program], { timeout: 120000, maxBuffer: 1024 * 1024 })
  assert.match(result.stdout, /"startup":true/)
  await exec('docker', [...extractArgs('good'), 'test -f data/application-data.json\ntest "$(cat data/mount-probe)" = "isolated mount probe"'])
  console.log(result.stdout.trim())
})
