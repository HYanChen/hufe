import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@vue/compiler-sfc'

const root = process.cwd()
const errors = []

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  } catch (error) {
    errors.push(`${file}: ${error.message}`)
    return null
  }
}

const packageJson = readJson('package.json')
const manifest = readJson('manifest.json')
const pagesJson = readJson('pages.json')
readJson('jsconfig.json')

if (manifest?.vueVersion !== '3') errors.push('manifest.json: vueVersion 必须为 3')
if (!packageJson?.scripts?.['build:h5']) errors.push('package.json: 缺少 build:h5')
if (!packageJson?.scripts?.['build:mp-weixin']) errors.push('package.json: 缺少 build:mp-weixin')

const routePaths = pagesJson?.pages?.map((page) => page.path) || []
for (const route of routePaths) {
  const vuePath = path.join(root, `${route}.vue`)
  if (!fs.existsSync(vuePath)) errors.push(`pages.json: 页面文件不存在 ${route}.vue`)
}

for (const tab of pagesJson?.tabBar?.list || []) {
  if (!routePaths.includes(tab.pagePath)) errors.push(`tabBar: 未注册页面 ${tab.pagePath}`)
  for (const iconKey of ['iconPath', 'selectedIconPath']) {
    const iconPath = path.join(root, tab[iconKey] || '')
    if (!tab[iconKey] || !fs.existsSync(iconPath)) errors.push(`tabBar: 图标不存在 ${tab[iconKey] || '(empty)'}`)
  }
}

const vueFiles = []
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'unpackage'].includes(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(fullPath)
    else if (entry.name.endsWith('.vue')) vueFiles.push(fullPath)
  }
}
walk(root)

for (const file of vueFiles) {
  const result = parse(fs.readFileSync(file, 'utf8'), { filename: file })
  for (const error of result.errors) errors.push(`${path.relative(root, file)}: ${String(error)}`)
}

if (errors.length) {
  console.error(`校验失败（${errors.length} 项）`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`校验通过：${routePaths.length} 个路由、${vueFiles.length} 个 Vue SFC、${pagesJson.tabBar.list.length} 个 tabBar 项。`)
