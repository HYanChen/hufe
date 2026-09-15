import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MySqlDatabase, MYSQL_NAMESPACES, readMysqlSnapshot } from '../storage/mysql-database.js'
import { canonicalSnapshotHash, snapshotSummary } from '../storage/mysql-snapshot.js'

async function readSourceFile(filename) {
  let source
  try { source = await fs.readFile(filename, 'utf8') } catch { throw new Error('无法读取指定的数据快照文件，请检查路径和权限') }
  try { return JSON.parse(source) } catch { throw new Error('源文件不是有效 JSON；为保护隐私，错误信息不会包含原始内容') }
}

export function mysqlOptionsFromEnv(env = process.env) {
  if (!env.MYSQL_DATABASE || !env.MYSQL_USER || !env.MYSQL_PASSWORD) throw new Error('必须设置 MYSQL_DATABASE、MYSQL_USER 和 MYSQL_PASSWORD；密码不得放入命令行参数')
  const port = Number(env.MYSQL_PORT || 3306)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MYSQL_PORT 无效')
  return { host: env.MYSQL_HOST || '127.0.0.1', port, user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE, ...(env.MYSQL_SOCKET_PATH ? { socketPath: env.MYSQL_SOCKET_PATH } : {}) }
}

export async function runMysqlDataCli(argv = process.argv.slice(2), env = process.env) {
  const [action, ...flags] = argv
  const args = {}
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index], value = flags[index + 1]
    if (!['--file', '--namespace'].includes(flag) || !value || Object.hasOwn(args, flag)) throw new Error('无效或重复的迁移命令参数')
    args[flag] = value
  }
  const filename = args['--file'], namespace = args['--namespace'] || 'application'
  if (!['import', 'verify', 'export'].includes(action) || !filename || !MYSQL_NAMESPACES.includes(namespace)) throw new Error(`用法：node src/cli/mysql-data.js import|verify|export --file /绝对路径/data.json [--namespace ${MYSQL_NAMESPACES.join('|')}]（import 仅允许空库，export 禁止覆盖）`)
  if (!path.isAbsolute(filename)) throw new Error('数据文件路径必须是绝对路径')
  const options = { ...mysqlOptionsFromEnv(env), namespace }
  if (action === 'import') {
    const source = await readSourceFile(filename)
    const database = new MySqlDatabase(options)
    try {
      const result = await database.importSnapshot(source, { expectedSha256: canonicalSnapshotHash(source) })
      return { action, namespace, ...result, verified: true }
    } finally { await database.close() }
  }
  const snapshot = await readMysqlSnapshot(options)
  if (action === 'verify') {
    const source = await readSourceFile(filename)
    if (canonicalSnapshotHash(source) !== snapshot.hash) throw new Error('源 JSON 与 MySQL 的完整数据校验不一致，禁止继续切换')
    return { action, namespace, ...snapshotSummary(snapshot.data), revision: snapshot.revision, verified: true }
  }
  await fs.writeFile(filename, `${JSON.stringify(snapshot.data, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return { action, namespace, ...snapshotSummary(snapshot.data), revision: snapshot.revision, exported: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMysqlDataCli().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    // Only sanitized messages escape; never serialize driver errors or env.
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`)
    process.exitCode = 1
  })
}
