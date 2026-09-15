import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeRegionImport } from '../src/regions/imports.js'
import { RegionService, validateRegions } from '../src/regions/service.js'
import { JsonDatabase } from '../src/storage/json-database.js'
import { mergeBundledRegions } from '../src/regions/upgrade.js'

test('pcas 省市区街道树规范化，直筒子市跳过重复区县，保留稳定地区代码', () => {
  const result = normalizeRegionImport([{ code: '44', name: '广东省', children: [{ code: '4419', name: '东莞市', children: [{ code: '441900', name: '东莞市', children: [{ code: '441900003', name: '东城街道' }] }] }] }])
  assert.equal(result.format, 'pcas')
  assert.equal(result.sourceNodes, 4)
  assert.equal(result.items.length, 4)
  assert.deepEqual(result.items.at(-1), { code: 'CN-441900003', parentCode: 'CN-4419', name: '东城街道', level: 'street', enabled: true })
  assert.equal(result.items.some(row => row.code === 'CN-441900'), false)
  assert.equal(validateRegions(result.items).length, 4)
  for (const input of [[], [{ code: '43', name: '湖南', children: {} }], [{ code: '43', name: '湖南', children: [{ code: '4401', name: '错误上级' }] }], [{ code: '4301', name: '缺省级' }], [{ code: '43', name: '湖南' }, { code: '43', name: '重复' }], [{ code: '43', name: '<script>' }]]) {
    assert.throws(() => normalizeRegionImport(input), error => error.code === 'REGION_INVALID')
  }
})

test('pcas 合并只补缺失，保留其他国家、现有名称及停用状态；确认后跨重启持久化', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-pcas-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const config = { dataFile: path.join(dir, 'data.json') }
  const db = await new JsonDatabase(config.dataFile).init()
  const regions = await new RegionService(db, config).init()
  const admin = { id: 'test-admin' }, guard = () => {}
  const oldCity = regions.current().byCode.get('CN-4301')
  const initial = regions.preview(admin, { expectedRevision: 0, source: '测试', sourceVersion: '1', mode: 'merge', items: [{ ...oldCity, enabled: false }] })
  await regions.apply(admin, initial.token, {}, guard)
  const originalCount = regions.stats().total
  const tree = [{ code: '43', name: '不能覆盖湖南省', children: [{ code: '4301', name: '不能覆盖长沙市' }, { code: '4399', name: '测试新增市', children: [{ code: '439901', name: '测试新增区', children: [{ code: '439901001', name: '测试新增街道' }] }] }] }]
  const input = { expectedRevision: 1, source: '用户文件', sourceVersion: '未提供截止日期', mode: 'merge', items: tree }
  const preview = regions.preview(admin, input)
  assert.equal(preview.format, 'pcas')
  assert.equal(preview.conflictPolicy, 'preserve')
  assert.equal(preview.added, 3)
  assert.equal(preview.changed, 0)
  assert.equal(preview.disabled, 0)
  assert.equal(preview.keptExisting, 3)
  assert.equal(regions.describe('CN-4399'), null)
  assert.throws(() => regions.preview(admin, { ...input, mode: 'replace' }), error => error.code === 'REGION_MERGE_REQUIRED')
  await regions.apply(admin, preview.token, {}, guard)
  const loaded = await new RegionService(db, config).init()
  assert.equal(loaded.stats().total, originalCount + 3)
  assert.equal(loaded.describe('CN-43').name, '湖南省')
  assert.equal(loaded.describe('CN-4301').name, oldCity.name)
  assert.equal(loaded.describe('CN-4301').available, false)
  assert.equal(loaded.describe('US').available, true)
  assert.equal(loaded.describe('CN-71').available, true)
  assert.deepEqual(loaded.describe('CN-439901001').path.map(row => row.code), ['CN', 'CN-43', 'CN-4399', 'CN-439901', 'CN-439901001'])
  assert.equal(loaded.selection({ regionCode: 'CN-439901001' }).city, '测试新增市')
  const repeated = loaded.preview(admin, { ...input, expectedRevision: 2 })
  assert.equal(repeated.added, 0)
  assert.equal(repeated.changed, 0)
  const flat = loaded.preview(admin, { ...input, expectedRevision: 2, items: normalizeRegionImport(tree).items, conflictPolicy: 'preserve' })
  assert.equal(flat.format, 'flat')
  assert.equal(flat.changed, 0)
  assert.equal(flat.added, 0)
})

test('发行种子纳入用户 pcas 新地区并保留各国及原有直筒子市街道', async () => {
  const seed = JSON.parse(await fs.readFile(new URL('../src/regions/seed.json', import.meta.url), 'utf8'))
  assert.equal(seed.supplement.sha256, '4cf5d4ce4e01e683b263158e1c229c646a68232b389a1b2c68136b4a00cea3ff')
  assert.equal(seed.supplement.conflictPolicy, 'preserve')
  assert.equal(validateRegions(seed.items).length, 53877)
  for (const code of ['US', 'GB', 'CN-71', 'CN-81', 'CN-82', 'CN-110106019', 'CN-110115403', 'CN-441900003']) assert.ok(seed.items.some(row => row.code === code), code)
  assert.equal(seed.items.find(row => row.code === 'CN-441900003').parentCode, 'CN-4419')
})

test('离线补种子兼容已有自定义库且仅添加；默认预览无写入、写后有审计、可重复执行', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-region-upgrade-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const dataFile = path.join(dir, 'data.json'), db = await new JsonDatabase(dataFile).init()
  const filename = 'catalog-00000000-0000-4000-8000-000000000001.json'
  const current = [
    { code: 'CN', parentCode: '', name: '中国', level: 'country', enabled: true },
    { code: 'US', parentCode: '', name: '保留管理员海外名称', level: 'country', enabled: false },
    { code: 'CN-43', parentCode: 'CN', name: '湖南省', level: 'province', enabled: true },
    { code: 'CN-4301', parentCode: 'CN-43', name: '保留管理员城市名称', level: 'city', enabled: false },
    { code: 'CUSTOM', parentCode: '', name: '保留自定义地区', level: 'country', enabled: true }
  ]
  await fs.mkdir(path.join(dir, 'region-catalogs'))
  await fs.writeFile(path.join(dir, 'region-catalogs', filename), JSON.stringify(current))
  await db.transaction(data => { data.regionCatalog = { revision: 1, filename, source: '管理员维护', sourceVersion: '旧版' }; data.accounts.push({ id: 'existing-user', privateData: 'unchanged' }) })
  const before = await fs.readFile(dataFile, 'utf8')
  const preview = await mergeBundledRegions({ dataFile })
  assert.equal(preview.status, 'preview')
  assert.equal(preview.added, 53873)
  assert.equal(await fs.readFile(dataFile, 'utf8'), before)
  const result = await mergeBundledRegions({ dataFile, apply: true })
  assert.equal(result.status, 'applied')
  assert.equal(result.total, 53878)
  const reloaded = await new JsonDatabase(dataFile).init(), regions = await new RegionService(reloaded, { dataFile }).init()
  assert.equal(regions.describe('US').name, '保留管理员海外名称')
  assert.equal(regions.describe('US').enabled, false)
  assert.equal(regions.describe('CN-4301').name, '保留管理员城市名称')
  assert.equal(regions.describe('CN-4301').enabled, false)
  assert.equal(regions.describe('CN-110106019').available, true)
  assert.equal(regions.describe('CUSTOM').available, true)
  assert.deepEqual(reloaded.read(data => data.accounts), [{ id: 'existing-user', privateData: 'unchanged' }])
  assert.equal(reloaded.read(data => data.auditLogs[0].action), 'regions.updated')
  assert.equal((await mergeBundledRegions({ dataFile, apply: true })).status, 'unchanged')
  const seedOnly = path.join(dir, 'seed-only.json')
  await new JsonDatabase(seedOnly).init()
  const seedBefore = await fs.readFile(seedOnly, 'utf8')
  assert.equal((await mergeBundledRegions({ dataFile: seedOnly, apply: true })).status, 'unchanged')
  assert.equal(await fs.readFile(seedOnly, 'utf8'), seedBefore)
  await assert.rejects(() => mergeBundledRegions({ dataFile: path.join(dir, 'missing.json'), apply: true }), { code: 'ENOENT' })
})
