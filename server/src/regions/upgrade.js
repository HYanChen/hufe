import fs from 'node:fs/promises'
import path from 'node:path'
import { JsonDatabase } from '../storage/json-database.js'
import { RegionService } from './service.js'

// Offline migration: the caller must stop the API before applying, because its
// JSON database is held in memory. Preview never changes the database/catalog.
export async function mergeBundledRegions({ dataFile, apply = false }) {
  if (String(process.env.DATABASE_DRIVER || '').toLowerCase() === 'mysql') throw new Error('MySQL 模式禁止使用旧版 JSON 地区升级工具，请在后台地区库中导入，禁止修改迁移前的数据文件')
  if (!path.isAbsolute(dataFile || '')) throw new Error('请提供现有数据库的绝对路径')
  const stat = await fs.stat(dataFile)
  if (!stat.isFile()) throw new Error('数据库路径不是文件')
  const database = await new JsonDatabase(dataFile).init()
  const regions = await new RegionService(database, { dataFile }).init()
  const seed = JSON.parse(await fs.readFile(new URL('./seed.json', import.meta.url), 'utf8'))
  const actor = 'system:region-seed-upgrade'
  const preview = regions.preview({ id: actor }, {
    expectedRevision: regions.meta().revision,
    source: seed.source,
    sourceVersion: seed.sourceVersion,
    items: seed.items,
    mode: 'merge',
    conflictPolicy: 'preserve'
  })
  const { token, ...summary } = preview
  if (!preview.added && !preview.changed && !preview.disabled) return { ok: true, status: 'unchanged', ...summary }
  if (!apply) return { ok: true, status: 'preview', ...summary }
  const result = await regions.apply({ id: actor }, token, { actor, source: 'offline-deployment' }, () => {})
  return { ok: true, status: 'applied', ...result }
}
