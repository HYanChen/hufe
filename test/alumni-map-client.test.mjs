import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { cityMapView, cityMapSourceUrl } from '../utils/cityMap.js'

const center = city => ({ city, available: true, precision: 'city', latitude: 28.19874, longitude: 112.97087, source: 'GeoNames', sourceUrl: 'https://www.geonames.org/1815577/' })
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function mapPage(overrides = {}) {
  const source = await fs.readFile(new URL('../pages/alumni-map/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm, '').replace('export default', 'globalThis.options =')
  const routes = []
  const context = { BusinessDetailSheet: {}, BusinessRichText: {}, cityMapView, cityMapSourceUrl,
    window:{location:{origin:'https://hufe.pla.wiki'},addEventListener(){},removeEventListener(){}},
    getDirectoryCityStats: async () => ({ items: [{ city: '长沙', count: 2 }], totalProfiles: 2, totalCities: 1, revision: 1 }),
    getDirectoryCityCenter: async city => center(city), openPage: path => routes.push(path), ...overrides }
  vm.runInNewContext(script, context)
  const options = context.options, page = options.data()
  for (const [name, method] of Object.entries(options.methods)) page[name] = method.bind(page)
  for (const [name, getter] of Object.entries(options.computed)) Object.defineProperty(page, name, { get: () => getter.call(page) })
  return { page, routes, options }
}

test('同城地图只用可信城市中心创建同源本地视图，不生成个人位置标记', () => {
  const view = cityMapView(center('长沙'))
  const url = new URL(view.embedUrl, 'https://hufe.pla.wiki')
  assert.equal(url.origin, 'https://hufe.pla.wiki')
  assert.equal(url.pathname, '/api/v1/maps/viewer/index.html')
  assert.equal(Number(url.searchParams.get('lon')),112.97087)
  assert.equal(Number(url.searchParams.get('lat')),28.19874)
  assert.equal(url.searchParams.has('marker'), false)
  assert.equal(cityMapSourceUrl(center('长沙')), 'https://www.geonames.org/1815577/')
  assert.equal(cityMapSourceUrl({ ...center('长沙'), sourceUrl: 'https://evil.example/1815577/' }), '')
  for (const value of [null, { ...center('长沙'), available: false }, { ...center('长沙'), latitude: NaN }, { ...center('长沙'), precision: 'street' }]) {
    assert.equal(cityMapView(value).located, false)
    assert.equal(new URL(cityMapView(value).embedUrl,'https://hufe.pla.wiki').search, '')
  }
})

test('城市列表保留全部统计，选择城市定位并保留同城校友入口', async () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ city: `城市${i}`, count: i + 1 }))
  const { page, routes } = await mapPage({ getDirectoryCityStats: async () => ({ items, totalProfiles: 78, totalCities: 12, revision: 5 }) })
  await page.load()
  assert.equal(page.cities.length, 12)
  assert.equal(page.activeCity.city, '城市11')
  assert.equal(page.mapView.located, false, '默认由地图服务定位学校，不自动把城市中心作为学校')
  const city = page.cities[4]
  await page.focusCity(city)
  assert.equal(page.cityCenter.city, city.city)
  page.selected = city
  page.openDirectory()
  assert.equal(routes[0], '/pages/directory/index?city=' + encodeURIComponent(city.city))
})

test('地图切换城市丢弃迟到坐标，缺失中心清空旧位置且保留统计', async () => {
  const pending = deferred()
  const { page } = await mapPage({ getDirectoryCityCenter: city => city === '长沙' ? pending.promise : Promise.resolve({ city, available: false, reason: 'ambiguous' }) })
  const old = page.focusCity({ city: '长沙', count: 2 })
  await page.focusCity({ city: '同名城市', count: 3 })
  pending.resolve(center('长沙')); await old
  assert.equal(page.activeCity.city, '同名城市')
  assert.equal(page.cityCenter, null)
  assert.equal(page.mapView.located, false)
  assert.match(page.centerError, /暂未取得同名城市/)
  assert.equal(page.locating, false)
})

test('地图离页后旧统计及坐标不回填，回来后可以重新加载', async () => {
  const stats = deferred(), location = deferred()
  const { page } = await mapPage({ getDirectoryCityStats: () => stats.promise, getDirectoryCityCenter: () => location.promise })
  const loading = page.load(), locating = page.focusCity({ city: '长沙', count: 2 })
  page.leavePage()
  stats.resolve({ items: [{ city: '长沙', count: 2 }] }); location.resolve(center('长沙'))
  await Promise.all([loading, locating])
  assert.equal(page.cities.length, 0)
  assert.equal(page.cityCenter, null)
  assert.equal(page.loading, false)
  assert.equal(page.locating, false)
  page.hidden = false
  await page.load()
  assert.equal(page.cities.length, 1)
  assert.equal(page.cityCenter, null)
})

test('回到学校取消迟到城市定位；区域点击只接受当前同源地图且只打开公开城市',async()=>{
  const pending=deferred(), {page}=await mapPage({getDirectoryCityCenter:()=>pending.promise})
  const city={city:'长沙',count:2};page.cities=[city]
  const task=page.focusCity(city);page.returnToSchool();pending.resolve(center('长沙'));await task
  assert.equal(page.cityCenter,null);assert.equal(page.activeCity,null);assert.equal(page.locating,false)
  const frameWindow={};page.$el={querySelector:()=>({contentWindow:frameWindow})}
  const event={origin:'https://hufe.pla.wiki',source:frameWindow,data:{type:'hufe-map-city-select',city:'长沙'}}
  page.mapMessage({...event,origin:'https://evil.example'});assert.equal(page.selected,null)
  page.mapMessage({...event,source:{}});assert.equal(page.selected,null)
  page.mapMessage({...event,data:{type:'hufe-map-city-select',city:'未公开地区'}});assert.equal(page.selected,null)
  page.mapMessage(event);assert.equal(page.selected,city)
  page.leavePage();page.mapMessage(event);assert.equal(page.selected,null)
})
