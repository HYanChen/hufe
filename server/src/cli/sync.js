import 'dotenv/config'
import { createConfig } from '../config.js'
import { ContentService } from '../content/service.js'

if (String(process.env.DATABASE_DRIVER || '').toLowerCase() === 'mysql') throw new Error('MySQL 模式请通过后台官网同步页面运行同步，旧版独立同步工具不能修改迁移前的缓存文件')

const service = new ContentService(createConfig())
const snapshot = await service.init({ refresh: true })
console.log(JSON.stringify({
  ok: true,
  status: service.status(),
  preview: snapshot.items.slice(0, 5).map(({ id, category, title, publishedAt, sourceUrl, contentHash }) => ({ id, category, title, publishedAt, sourceUrl, contentHash }))
}, null, 2))
