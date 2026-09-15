import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

async function component(page, overrides = {}) {
  const source = await fs.readFile(new URL(`../pages/${page}/index.vue`, import.meta.url), 'utf8')
  const code = source.split('<script>')[1].split('</script>')[0].replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?\n/gm, '').replace('export default', 'globalThis.options =')
  const sandbox = { EventCard:{}, appConfig:{}, ...overrides }
  vm.runInNewContext(code, sandbox)
  const o = sandbox.options, p = { ...o.data(), isModuleEnabled: () => true, ...overrides }
  for (const [key, fn] of Object.entries(o.methods || {})) p[key] = fn.bind(p)
  for (const [key, fn] of Object.entries(o.computed || {})) Object.defineProperty(p, key, { get: () => fn.call(p) })
  return p
}

test('首页统计隐藏已关闭的组织、活动和岗位模块', async () => {
  const p = await component('home', { isModuleEnabled: key => key === 'activities' })
  assert.deepEqual(Array.from(p.visibleStats, item => item.label), ['近期活动'])
})

test('生态页已关闭模块不发请求、不显示统计，也不产生失败警告', async () => {
  const calls = []
  const p = await component('ecosystem', {
    isModuleEnabled: key => key === 'maps',
    getAlumniEnterprises: async () => { throw new Error('不应请求关闭模块') },
    getCollaborationOpportunities: async () => { throw new Error('不应请求关闭模块') },
    getAlumniAcademy: async () => { throw new Error('不应请求关闭模块') },
    getDirectoryCityStats: async () => { calls.push('maps'); return { totalCities:3 } }
  })
  await p.loadMetrics()
  assert.deepEqual(calls, ['maps'])
  assert.equal(p.counts.cities, 3)
  assert.equal(p.metricsError, '')
  assert.deepEqual(Array.from(p.metrics, item => item.label), ['连接城市'])
})

test('生态页统计失败清空旧值而不伪报为0', async () => {
  const p = await component('ecosystem', {
    isModuleEnabled: key => key === 'maps',
    getDirectoryCityStats: async () => { throw new Error('断网') }
  })
  p.counts.cities = 10
  await p.loadMetrics()
  assert.equal(p.counts.cities, null)
  assert.ok(p.metricsError)
})
