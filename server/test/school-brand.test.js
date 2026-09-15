import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { schoolBrand } from '../src/brand.js'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')

test('学校正式图稿本地内置，组合SVG保留PDF路径与原始字标JPEG且后台镜像一致',async()=>{
  const manifest=JSON.parse(await fs.readFile(path.join(root,'assets/brand-sources/manifest.json'),'utf8'))
  assert.equal(schoolBrand.englishName,'Hunan College of Finance and Economics')
  assert.equal(schoolBrand.shortEnglishName,'HUFE')
  for(const [type,info] of Object.entries(manifest.sources))assert.equal(sha(await fs.readFile(path.join(root,'assets/brand-sources',info.file))),info.sha256,type)
  for(const file of Object.values(manifest.output))assert.deepEqual(await fs.readFile(path.join(root,'static/brand',file)),await fs.readFile(path.join(root,'admin/public/static/brand',file)),file)
  const svg=await fs.readFile(path.join(root,'static/brand',manifest.output.logo),'utf8')
  const jpg=Buffer.from(svg.match(/data:image\/jpeg;base64,([^"']+)/)[1],'base64')
  assert.equal(sha(jpg),manifest.sources.wordmark.sha256)
  const crest=await fs.readFile(path.join(root,'static/brand',manifest.output.crest),'utf8')
  const originalPaths=crest.match(/<path\b[^>]*>/g),combinedPaths=svg.match(/<path\b[^>]*>/g)
  assert.ok(originalPaths.length>10);assert.deepEqual(combinedPaths,originalPaths)
  assert.doesNotMatch(svg,/<script|<foreignObject|(?:href|src)=["']https?:/i)
  assert.match(svg,/<rect[^>]+fill="#fff"/)
})

test('前后台显示使用本地品牌配置，英文全称更新但历史HUFE账号键不变',async()=>{
  const config=await fs.readFile(path.join(root,'config/index.js'),'utf8')
  assert.match(config,/officialLogoUrl: schoolBrand.logoUrl/)
  assert.match(config,/authStorageKey: 'hufe_alumni_auth_state'/)
  for(const file of ['admin/src/views/LoginView.vue','admin/src/views/ChangePasswordView.vue','admin/src/layouts/AdminLayout.vue']){
    const source=await fs.readFile(path.join(root,file),'utf8');assert.match(source,/schoolBrand/);assert.doesNotMatch(source,/hufe\.edu\.cn\/images\/logo\.png/)
  }
  assert.doesNotMatch(await fs.readFile(path.join(root,'pages/giving-certificate/index.vue'),'utf8'),/HUNAN UNIVERSITY OF FINANCE AND ECONOMICS/)
})
