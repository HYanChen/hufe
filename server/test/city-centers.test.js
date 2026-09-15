import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { CityCenterService } from '../src/regions/city-centers.js'
import { RegionService } from '../src/regions/service.js'
import { JsonDatabase } from '../src/storage/json-database.js'

test('离线真实城市坐标匹配行政区，长沙不会误定位同名镇街；缺失或重名不虚构中心', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-city-center-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const dataFile = path.join(dir, 'data.json'), database = await new JsonDatabase(dataFile).init()
  const regions = await new RegionService(database, { dataFile }).init()
  const cities = ['长沙', '长沙市', '深圳市', '北京市', '上海市', '不存在的统计城市', 'Springfield']
  const service = new CityCenterService({ directoryCityStats: () => ({ items: cities.map(city => ({ city, count: 1 })) }) }, regions)
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Offline coordinates must never use network') })
  for (const city of ['长沙', '长沙市']) {
    const result = await service.center(city)
    assert.equal(result.available, true)
    assert.equal(result.sourceUrl, 'https://www.geonames.org/1815577/')
    assert.ok(result.latitude > 28 && result.latitude < 29)
    assert.ok(result.longitude > 112 && result.longitude < 114)
    assert.equal(result.coordinateSystem, 'WGS84')
    assert.equal(result.precision, 'city')
  }
  for (const city of ['深圳市', '北京市', '上海市']) assert.equal((await service.center(city)).available, true, city)
  assert.equal((await service.center('不存在的统计城市')).reason, 'not_found')
  assert.equal((await service.center('Springfield')).reason, 'ambiguous')
  await assert.rejects(() => service.center('用户填写的私密街道100号'), error => error.code === 'CITY_NOT_PUBLIC')
})

test('城市中心接口只服务公开城市统计，公开范围撤销立即失效且输出不含个人资料', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-city-center-api-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const contentService = { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => ({}), home: () => ({}), list: () => ({ items: [] }) }
  const app = await buildApp({ config: createConfig({ env: 'test', dataFile: path.join(dir, 'data.json'), mediaDir: path.join(dir, 'media') }), logger: false, refreshContent: false, scheduleContent: false, contentService })
  t.after(() => app.close())
  await app.services.database.transaction(data => data.business.resources.directory.push({ id: 'private-person-id', name: '不应出现在地图中的名字', city: '长沙', status: 'visible', address: '私密地址', telephone: '私密电话' }, { id: 'hidden-person', city: '深圳市', status: 'hidden' }))
  const center = () => app.inject({ url: '/api/v1/business/directory/city-center?city=' + encodeURIComponent('长沙') })
  const result = await center()
  assert.equal(result.statusCode, 200, result.body)
  assert.equal(result.json().data.available, true)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.doesNotMatch(result.body, /private-person|私密|不应出现在地图中的名字|telephone|address/)
  assert.equal((await app.inject({ url: '/api/v1/business/directory/city-center?city=' + encodeURIComponent('深圳市') })).statusCode, 404)
  assert.equal((await app.inject({ url: '/api/v1/business/directory/city-center' })).statusCode, 400)
  await app.services.database.transaction(data => { data.business.resources.directory[0].status = 'hidden' })
  assert.equal((await center()).statusCode, 404)
})
