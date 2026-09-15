import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { acquireLocalOperationLock, parseActiveMysqlEnv, runLocalApp } from './local-app.mjs'
import { prepareMysqlSnapshots } from '../server/src/cli/prepare-mysql-snapshots.js'
import { MySqlDatabase, MYSQL_NAMESPACES, readMysqlSnapshot } from '../server/src/storage/mysql-database.js'
import { canonicalSnapshotHash } from '../server/src/storage/mysql-snapshot.js'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const runtime = path.join(root, '.local-runtime'), privateDir = path.join(runtime, 'mysql')
const requireServer = createRequire(path.join(root, 'server/package.json'))
export function validateLocalMysqlConfig(config) {
  if (!config || config.host !== '127.0.0.1' || config.port !== 13306 || config.database !== 'hufe_local' || config.user !== 'hufe_local' || !/^[A-Za-z0-9_-]{32,128}$/.test(config.password || '') || Object.keys(config).some(key => !['host','port','database','user','password'].includes(key))) throw new Error('仅允许迁移到专用本机 hufe_local MySQL 数据库')
  return config
}
const exists = file => fs.access(file).then(() => true, () => false)
async function readPrivateConfig(file) {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error('数据库配置必须为本人独占的普通文件')
  let config
  try { config = JSON.parse(await fs.readFile(file, 'utf8')) } catch { throw new Error('数据库配置格式无效，未输出其中内容') }
  return validateLocalMysqlConfig(config)
}
export function ownsApiRecord(record, command, groupId) {
  return Number.isSafeInteger(record?.pid) && record.pid > 1 && record.entry === path.join(root, 'server/src/index.js') && Number(groupId) === record.pid && String(command).includes(record.entry)
}
function liveOwnedApi(record) {
  if (!record?.pid) return false
  try {
    const command = execFileSync('ps', ['-p', String(record.pid), '-o', 'command='], { encoding: 'utf8' })
    const groupId = execFileSync('ps', ['-p', String(record.pid), '-o', 'pgid='], { encoding: 'utf8' }).trim()
    if (!ownsApiRecord(record, command, groupId)) throw new Error('本地 API 进程归属不符，拒绝停止该进程')
    return true
  } catch (error) { if (error.status === 1) return false; throw error }
}
const occupied = () => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port: 8787 })
  socket.once('connect', () => { socket.destroy(); resolve(true) }); socket.once('error', () => resolve(false))
  socket.setTimeout(1000, () => { socket.destroy(); resolve(false) })
})
export async function switchLocalMysql() {
  const lock = await acquireLocalOperationLock()
  let stopped = false, activated = false, backup
  try {
    const active = path.join(privateDir, 'active.env')
    if (await exists(active)) throw new Error('本地 MySQL 已激活；禁止重复导入旧 JSON')
    const config = await readPrivateConfig(path.join(privateDir, 'application.json'))
    const states = JSON.parse(await fs.readFile(path.join(runtime, 'processes.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error }))
    const frontendState = JSON.stringify({ frontend: states.frontend, admin: states.admin })
    const apiWasRunning = liveOwnedApi(states.api)
    if (!apiWasRunning && await occupied()) throw new Error('8787 端口不是已登记的本项目 API，拒绝继续')
    const { createConnection } = requireServer('mysql2/promise')
    let connection
    try {
      connection = await createConnection(config)
      const [[row]] = await connection.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ?', [config.database])
      if (Number(row.count)) throw new Error('目标 MySQL 业务库不是空库，禁止覆盖导入')
    } catch (error) { throw new Error(error.message === '目标 MySQL 业务库不是空库，禁止覆盖导入' ? error.message : '本地 MySQL 预检查失败，请检查专用数据库服务与配置') }
    finally { await connection?.end() }
    if (apiWasRunning) { stopped = true; await runLocalApp('stop-api', { lockOwner: process.pid }) }
    if (await occupied()) throw new Error('API 写入未完全停止，取消迁移')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    backup = path.join(runtime, 'backups', `mysql-cutover-${stamp}`)
    await fs.mkdir(backup, { recursive: true, mode: 0o700 })
    await fs.cp(path.join(root, 'server/data'), path.join(backup, 'data'), { recursive: true, errorOnExist: true, force: false })
    const serverEnv = path.join(root, 'server/.env')
    if (await exists(serverEnv)) await fs.writeFile(path.join(backup, 'server.env'), await fs.readFile(serverEnv), { mode: 0o600, flag: 'wx' })
    await fs.writeFile(path.join(backup, 'processes-before.json'), JSON.stringify(states), { mode: 0o600, flag: 'wx' })
    const sourceDir = path.join(backup, 'source-snapshots')
    await prepareMysqlSnapshots(path.join(backup, 'data'), sourceDir)
    const verified = []
    for (const namespace of MYSQL_NAMESPACES) {
      const source = JSON.parse(await fs.readFile(path.join(sourceDir, `${namespace}.json`), 'utf8'))
      const store = new MySqlDatabase({ ...config, namespace })
      try { await store.importSnapshot(source, { expectedSha256: canonicalSnapshotHash(source) }) } finally { await store.close() }
      const imported = await readMysqlSnapshot({ ...config, namespace })
      if (imported.hash !== canonicalSnapshotHash(source)) throw new Error(`${namespace} 全量数据校验失败，未切换服务`)
      verified.push({ namespace, sha256: imported.hash })
    }
    await fs.writeFile(path.join(backup, 'mysql-verified.json'), JSON.stringify({ verified, verifiedAt: new Date().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' })
    const environment = `DATABASE_DRIVER=mysql\nMYSQL_HOST=${config.host}\nMYSQL_PORT=${config.port}\nMYSQL_DATABASE=${config.database}\nMYSQL_USER=${config.user}\nMYSQL_PASSWORD=${config.password}\n`
    parseActiveMysqlEnv(environment)
    await fs.writeFile(active, environment, { mode: 0o600, flag: 'wx' })
    activated = true
    // From the moment the API can accept traffic, never automatically revert to
    // old JSON: new user writes may already exist even if a later check fails.
    await runLocalApp('start-api', { lockOwner: process.pid, skipBackup: true })
    const response = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(10000) })
    const health = await response.json()
    if (!response.ok || health.data?.database?.driver !== 'mysql') throw new Error('API 未确认使用 MySQL')
    const after = JSON.parse(await fs.readFile(path.join(runtime, 'processes.json'), 'utf8'))
    if (JSON.stringify({ frontend: after.frontend, admin: after.admin }) !== frontendState) throw new Error('前台或后台进程登记发生变化，请核查并发操作')
    console.log(JSON.stringify({ migrated: true, driver: 'mysql', namespaces: verified.length, backup, frontendAndAdminUntouched: true }))
    return { backup, verified }
  } catch (error) {
    if (!activated && stopped) await runLocalApp('start-api', { lockOwner: process.pid, skipBackup: true }).catch(() => { console.error('旧 API 自动恢复未通过，请检查本地 API 日志；数据备份仍保留') })
    if (activated) throw new Error(`MySQL 已激活，但后续验证未完成；为避免丢失新写入，未回退旧 JSON。请检查 API 日志。备份：${backup}`)
    throw error
  } finally { await fs.unlink(lock) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--apply') throw new Error('仅在已批准本地切换时运行：node scripts/mysql-local-switch.mjs --apply；本脚本会短暂停止本项目 API')
  await switchLocalMysql()
}
