import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const base = path.join(root, '.local-runtime/mysql')
const sourceRoot = path.join(base, 'linux-frozen-server')
const nodeModules = path.join(sourceRoot, 'node_modules')
const sha = value => createHash('sha256').update(value).digest('hex')
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const exists = file => fs.access(file).then(() => true, () => false)
const safeName = name => /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)
export function lockServerVersions(lock) {
  const lines = String(lock).split('\n'), start = lines.findIndex(line => line === '  server:')
  if (start < 0) throw new Error('pnpm lock 缺少 server importer')
  const versions = new Map()
  let dependency = null, inDependencies = false
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith('    ')) break
    if (line === '    dependencies:') { inDependencies = true; continue }
    if (/^    \S/.test(line)) { inDependencies = false; continue }
    if (!inDependencies) continue
    const item = /^      (?:'([^']+)'|([^:]+)):$/.exec(line)
    if (item) { dependency = item[1] || item[2]; continue }
    const version = /^        version: (.+)$/.exec(line)
    if (version && dependency) versions.set(dependency, version[1].replace(/^['"]|['"]$/g, '').split('(')[0])
  }
  return versions
}
export function isolatedServerLock(lock) {
  const lines = String(lock).split('\n'), start = lines.findIndex(line => line === '  server:'), packages = lines.findIndex(line => line === 'packages:')
  if (start < 0 || packages < start) throw new Error('无法提取 server 锁定依赖')
  const body = []
  for (const line of lines.slice(start + 1, packages)) {
    if (line.trim() && !line.startsWith('    ')) break
    body.push(line)
  }
  const prefix = lines.slice(0, lines.findIndex(line => line === 'importers:')).join('\n')
  return `${prefix}\nimporters:\n\n  .:\n${body.join('\n')}\n${lines.slice(packages).join('\n')}`
}
async function resolvePackage(from, name) {
  if (!safeName(name)) throw new Error('不支持的依赖包名称')
  for (let cursor = from; cursor === sourceRoot || cursor.startsWith(`${sourceRoot}/`); cursor = path.dirname(cursor)) {
    const candidate = path.join(cursor, 'node_modules', name)
    if (await exists(path.join(candidate, 'package.json'))) {
      const real = await fs.realpath(candidate)
      if (!real.startsWith(`${nodeModules}/`)) throw new Error('依赖解析越出已部署的 node_modules，禁止读取工作区数据')
      return real
    }
  }
  return null
}
async function productionClosure(manifest) {
  const selected = new Map()
  const visit = async (from, name, optional = false) => {
    const directory = await resolvePackage(from, name)
    if (!directory) { if (optional) return; throw new Error(`生产依赖缺失：${name}`) }
    if (selected.has(directory)) return
    const pkg = await readJson(path.join(directory, 'package.json'))
    if (pkg.name !== name) throw new Error(`依赖包身份不匹配：${name}`)
    selected.set(directory, pkg)
    const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }
    for (const dependency of Object.keys(dependencies)) await visit(directory, dependency, Boolean(pkg.optionalDependencies?.[dependency] || pkg.peerDependenciesMeta?.[dependency]?.optional))
  }
  for (const name of Object.keys(manifest.dependencies || {})) await visit(sourceRoot, name)
  return selected
}
async function testedLocalVersions(manifest) {
  const seen = new Set(), versions = new Set()
  const visit = async (from, name, optional = false) => {
    let directory
    for (let cursor = from; cursor === root || cursor.startsWith(`${root}/`); cursor = path.dirname(cursor)) {
      const candidate = path.join(cursor, 'node_modules', name)
      if (await exists(path.join(candidate, 'package.json'))) { directory = await fs.realpath(candidate); break }
    }
    if (!directory) { if (optional) return; throw new Error(`本地运行依赖缺失：${name}`) }
    if (seen.has(directory)) return
    if (!directory.startsWith(`${root}/node_modules/`) && !directory.startsWith(`${root}/server/node_modules/`)) throw new Error('本地依赖越出项目目录')
    seen.add(directory)
    const pkg = await readJson(path.join(directory, 'package.json'))
    versions.add(`${pkg.name}@${pkg.version}`)
    for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) await visit(directory, dependency, Boolean(pkg.optionalDependencies?.[dependency] || pkg.peerDependenciesMeta?.[dependency]?.optional))
  }
  for (const name of Object.keys(manifest.dependencies)) await visit(path.join(root, 'server'), name)
  return versions
}
const excluded = name => name === 'node_modules' || name === '.bin' || name.startsWith('.') || /^(?:test|tests|examples?|benchmarks?|fixtures)$/i.test(name) || /^(?:id_rsa|id_ed25519|credentials)(?:\.|$)/i.test(name)
async function copyPackage(source, destination, packageRoot = source) {
  await fs.mkdir(destination, { recursive: true, mode: 0o755 })
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (excluded(entry.name)) continue
    const file = path.join(source, entry.name), target = path.join(destination, entry.name)
    let stat = await fs.lstat(file), actual = file
    if (stat.isSymbolicLink()) {
      actual = await fs.realpath(file)
      if (!actual.startsWith(`${packageRoot}/`)) throw new Error('包内链接越界，禁止打包')
      stat = await fs.stat(actual)
    }
    if (stat.isDirectory()) await copyPackage(actual, target, packageRoot)
    else if (stat.isFile()) { await fs.copyFile(actual, target); await fs.chmod(target, stat.mode & 0o111 ? 0o755 : 0o644) }
    else throw new Error('生产依赖中存在非普通文件')
  }
}
export async function buildMysqlDependencies() {
  const manifest = await readJson(path.join(root, 'server/package.json'))
  const lockText = await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'), pinned = lockServerVersions(lockText)
  for (const name of Object.keys(manifest.dependencies)) {
    if ((await readJson(path.join(root, 'server/node_modules', name, 'package.json'))).version !== pinned.get(name)) throw new Error(`本地已测试依赖与当前lock不符：${name}`)
  }
  await fs.mkdir(sourceRoot, { recursive: true })
  await fs.writeFile(path.join(sourceRoot, 'package.json'), JSON.stringify(manifest, null, 2))
  await fs.writeFile(path.join(sourceRoot, 'pnpm-lock.yaml'), isolatedServerLock(lockText))
  await fs.writeFile(path.join(sourceRoot, '.npmrc'), 'node-linker=hoisted\npackage-import-method=copy\n')
  execFileSync('docker', ['run','--rm','-v',`${sourceRoot}:/work`,'-w','/work','-e','COREPACK_ENABLE_DOWNLOAD_PROMPT=0','node:22-alpine','corepack','pnpm@10.12.4','install','--prod','--frozen-lockfile','--ignore-scripts'], { stdio: 'inherit', timeout: 300000 })
  if (JSON.stringify((await readJson(path.join(sourceRoot, 'package.json'))).dependencies) !== JSON.stringify(manifest.dependencies)) throw new Error('Linux deploy 清单已过期，请先重新执行 frozen-lockfile deploy')
  const closure = await productionClosure(manifest)
  const localVersions = await testedLocalVersions(manifest)
  for (const name of Object.keys(manifest.dependencies || {})) {
    const pkg = closure.get(await resolvePackage(sourceRoot, name))
    if (pkg.version !== pinned.get(name)) throw new Error(`生产依赖与当前 lock 版本不符：${name}`)
  }
  for (const pkg of closure.values()) {
    if (!lockText.includes(`  ${pkg.name}@${pkg.version}:`) && !lockText.includes(`  '${pkg.name}@${pkg.version}':`)) throw new Error(`传递依赖版本不在当前 lock 中：${pkg.name}`)
    if (!localVersions.has(`${pkg.name}@${pkg.version}`)) throw new Error(`Linux 传递依赖版本与本地已测试版本不同：${pkg.name}@${pkg.version}`)
  }
  const stage = await fs.mkdtemp(path.join(base, 'dependency-stage-')), output = await fs.mkdtemp(path.join(base, 'dependency-output-'))
  try {
    await fs.mkdir(path.join(stage, 'node_modules'))
    for (const [directory] of closure) await copyPackage(directory, path.join(stage, path.relative(sourceRoot, directory)))
    await fs.cp(path.join(root, 'server/src'), path.join(stage, 'src'), { recursive: true, filter: file => !path.basename(file).includes(' 2.') && path.basename(file) !== '.DS_Store' })
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest), { mode: 0o644 })
    const probe = `import fs from 'node:fs/promises';import {buildApp} from './src/app.js';import {createConfig} from './src/config.js';const dir=await fs.mkdtemp('/tmp/hufe-deps-');const config=createConfig({env:'test',databaseDriver:'json',dataFile:dir+'/application-data.json',mediaDir:dir+'/media',content:{cacheFile:dir+'/content.json'}});const app=await buildApp({config,logger:false,refreshContent:false,scheduleContent:false});try{const health=await app.inject('/health');if(health.statusCode!==200)throw Error('isolated buildApp health failed');await import('mysql2/promise');console.log('Linux Node22 imports + isolated buildApp health passed')}finally{await app.close();await fs.rm(dir,{recursive:true,force:true})}`
    const common = ['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','-v',`${stage}:/app:ro`,'-w','/app']
    execFileSync('docker', [...common, 'node:22-alpine', 'node','--input-type=module','-e',probe], { stdio: 'inherit', timeout: 120000 })
    execFileSync('docker', [...common,'-v',`${output}:/output`,'node:22-alpine','tar','-czf','/output/server-dependencies.tar.gz','node_modules'], { stdio: 'inherit', timeout: 120000 })
    const archive = path.join(output, 'server-dependencies.tar.gz')
    const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    const types = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    const { default: validate } = await import('./mysql-baota-dependencies.cjs')
    validate.validatePaths(listing); validate.validateTypes(types)
    if (listing.split('\n').some(name => /(?:^|\/)\.bin(?:\/|$)|(?:^|\/)\.env(?:\.|\/|$)|(?:^|\/)\.npmrc$/.test(name))) throw new Error('依赖包含不允许的隐藏配置或 .bin 链接')
    const final = path.join(base, 'server-dependencies.tar.gz')
    await fs.rename(archive, final)
    const report = { packageCount: closure.size, sourcePackageSha256: sha(await fs.readFile(path.join(root, 'server/package.json'))), lockSha256: sha(lockText), archiveSha256: sha(await fs.readFile(final)), bytes: (await fs.stat(final)).size, linuxBuildAppVerified: true, packages: [...closure].map(([directory,pkg]) => ({ name: pkg.name, version: pkg.version, location: path.relative(sourceRoot, directory) })) }
    await fs.writeFile(path.join(base, 'server-dependencies.manifest.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ file: final, packageCount: report.packageCount, bytes: report.bytes, sha256: report.archiveSha256, linuxBuildAppVerified: true }))
    return report
  } finally { await fs.rm(stage, { recursive: true, force: true }); await fs.rm(output, { recursive: true, force: true }) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildMysqlDependencies()
