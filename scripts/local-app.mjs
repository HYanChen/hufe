import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = path.join(root, '.local-runtime')
const stateFile = path.join(runtime, 'processes.json')
const node = process.execPath
const definitions = [
  { name: 'api', port: 8787, url: 'http://127.0.0.1:8787/health', cwd: path.join(root, 'server'), entry: path.join(root, 'server/src/index.js'), args: [] },
  { name: 'frontend', port: 5173, url: 'http://localhost:5173/#/', cwd: root, entry: path.join(root, 'scripts/run-uni.mjs'), args: ['dev', 'h5', '--host', '127.0.0.1', '--port', '5173', '--strictPort'] },
  { name: 'admin', port: 4180, url: 'http://127.0.0.1:4180/#/login', cwd: path.join(root, 'admin'), entry: path.join(root, 'admin/node_modules/vite/bin/vite.js'), args: ['--host', '127.0.0.1', '--port', '4180', '--strictPort'] }
]
const baseEnv = {
  ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '8787',
  DATA_FILE: path.join(root, 'server/data/application-data.json'),
  CONTENT_CACHE_FILE: path.join(root, 'server/data/content-cache.json'),
  MEDIA_DIR: path.join(root, 'server/data/media'),
  PUBLIC_BASE_URL: 'http://localhost:8787', VITE_API_BASE_URL: 'http://localhost:8787',
  PATH: `${path.dirname(node)}:${process.env.PATH || ''}`
}
export function parseActiveMysqlEnv(content) {
  const allowed = ['DATABASE_DRIVER', 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD']
  const values = {}
  for (const line of String(content).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const match = /^([A-Z_]+)=([^\r\0]*)$/.exec(line)
    if (!match || !allowed.includes(match[1]) || Object.hasOwn(values, match[1])) throw new Error('本地 MySQL 激活配置格式无效')
    values[match[1]] = match[2]
  }
  if (Object.keys(values).length !== allowed.length || values.DATABASE_DRIVER !== 'mysql' || values.MYSQL_HOST !== '127.0.0.1' || values.MYSQL_PORT !== '13306' || values.MYSQL_DATABASE !== 'hufe_local' || values.MYSQL_USER !== 'hufe_local' || !/^[A-Za-z0-9_-]{32,128}$/.test(values.MYSQL_PASSWORD)) throw new Error('本地 MySQL 激活配置不符合专用本机数据库约定')
  return values
}
async function activeMysqlEnv() {
  const file = path.join(runtime, 'mysql', 'active.env')
  let stat
  try { stat = await fs.lstat(file) } catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('本地 MySQL 激活配置必须为本人独占的普通文件')
  return parseActiveMysqlEnv(await fs.readFile(file, 'utf8'))
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const exists = async (file) => fs.access(file).then(() => true, () => false)
async function readState() {
  try { return JSON.parse(await fs.readFile(stateFile, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}
async function writeState(records) {
  const temporary = `${stateFile}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, stateFile)
}
export async function acquireLocalOperationLock() {
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 })
  const file = path.join(runtime, 'operation.lock')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(file, 'wx', 0o600)
      await handle.writeFile(String(process.pid))
      await handle.close()
      return file
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const pid = Number(await fs.readFile(file, 'utf8'))
      if (!Number.isInteger(pid) || pid < 1) throw new Error('本地操作锁尚未就绪，请稍后重试。')
      try { process.kill(pid, 0) } catch (checkError) {
        if (checkError.code !== 'ESRCH') throw checkError
        await fs.unlink(file)
        continue
      }
      throw new Error('另一个本地启动或停止操作正在进行，请稍后重试。')
    }
  }
  throw new Error('无法取得本地操作锁。')
}
function owned(record) {
  if (!record?.pid || !record.entry?.startsWith(`${root}/`)) return false
  try { return execFileSync('ps', ['-p', String(record.pid), '-o', 'command='], { encoding: 'utf8' }).includes(record.entry) } catch { return false }
}
function occupied(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.setTimeout(1200, () => { socket.destroy(); resolve(false) })
  })
}
async function healthy(url) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); return response.ok } catch { return false }
}
async function stop(record) {
  if (!owned(record)) return
  process.kill(-record.pid, 'SIGTERM')
  for (let i = 0; i < 300 && owned(record); i += 1) await sleep(100)
  if (owned(record)) throw new Error(`进程 ${record.pid} 未能正常停止，请检查日志。`)
}
export async function runLocalApp(command = 'start', { lockOwner, skipBackup = false } = {}) {
await fs.mkdir(runtime, { recursive: true, mode: 0o700 })
const inheritedLock = lockOwner === process.pid && Number(await fs.readFile(path.join(runtime, 'operation.lock'), 'utf8').catch(() => '')) === process.pid
if (lockOwner && !inheritedLock) throw new Error('本地操作锁不属于当前调用进程')
const lock = command === 'status' || inheritedLock ? null : await acquireLocalOperationLock()
try {
const records = await readState()
if (command === 'stop' || command === 'stop-api') {
  for (const record of command === 'stop-api' ? [records.api] : Object.values(records)) await stop(record)
  if (command === 'stop-api') { delete records.api; await writeState(records) } else await writeState({})
  console.log(command === 'stop-api' ? '本项目本地 API 已停止，前台与管理后台保持原状。' : '本项目本地服务已停止。')
} else if (command === 'status') {
  for (const def of definitions) console.log(`${def.name}: ${owned(records[def.name]) && await healthy(def.url) ? '运行正常' : '未运行或异常'} ${def.url}`)
} else if (command === 'start' || command === 'start-api') {
  const databaseEnv = await activeMysqlEnv()
  const selected = command === 'start-api' ? definitions.filter(def => def.name === 'api') : definitions
  const started = []
  try {
    for (const def of selected) {
      if (owned(records[def.name]) && await healthy(def.url)) continue
      if (await occupied(def.port)) throw new Error(`${def.port} 端口已被其他进程占用；没有停止或覆盖该进程。`)
    }
    if (!(skipBackup && inheritedLock) && databaseEnv.DATABASE_DRIVER !== 'mysql' && !owned(records.api) && await exists(path.join(root, 'server/data/application-data.json'))) {
      const backup = path.join(runtime, 'backups', new Date().toISOString().replace(/[:.]/g, '-'))
      await fs.mkdir(backup, { recursive: true, mode: 0o700 })
      await fs.cp(path.join(root, 'server/data'), path.join(backup, 'data'), { recursive: true })
      console.log(`现有数据已备份：${backup}`)
    }
    for (const def of selected) {
      if (owned(records[def.name]) && await healthy(def.url)) continue
      const log = await fs.open(path.join(runtime, `${def.name}.log`), 'a', 0o600)
      const child = spawn(node, [def.entry, ...def.args], {
        cwd: def.cwd, detached: true, stdio: ['ignore', log.fd, log.fd],
        // Database credentials are injected only into the API process, never Vite.
        env: def.name === 'api' ? { ...baseEnv, ...databaseEnv } : def.name === 'admin' ? { ...baseEnv, VITE_API_BASE_URL: '/api/v1', HUFE_API_PROXY: 'http://127.0.0.1:8787' } : baseEnv
      })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      child.unref()
      await log.close()
      records[def.name] = { pid: child.pid, entry: def.entry, url: def.url }
      started.push(records[def.name])
      await writeState(records)
      let ready = false
      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (await healthy(def.url)) { ready = true; break }
        if (!owned(records[def.name])) break
        await sleep(500)
      }
      if (!ready) throw new Error(`${def.name} 启动失败，请查看 .local-runtime/${def.name}.log`)
      console.log(`${def.name} 已启动：${def.url}`)
    }
    console.log(command === 'start-api' ? '本地 API 已就绪，前台与管理后台保持原状。' : '本地三项服务均已就绪，仅监听本机。关闭此窗口不会停止服务。')
  } catch (error) {
    for (const record of started.reverse()) await stop(record).catch(() => {})
    throw error
  }
} else { throw new Error('使用 start、start-api、status、stop-api 或 stop') }
} finally { if (lock) await fs.unlink(lock) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runLocalApp(process.argv[2] || 'start')
