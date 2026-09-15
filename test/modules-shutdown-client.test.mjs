import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function component(name, overrides = {}) {
  const source = await fs.readFile(new URL(`../pages/${name}/index.vue`, import.meta.url), 'utf8')
  const code = source.split('<script>')[1].split('</script>')[0].replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?\n/gm, '').replace('export default', 'globalThis.options =')
  const routes = []; const modals = []; const toasts = []
  const context = {
    appConfig: {}, BusinessDetailSheet: {}, BusinessRichText: {}, SecureMaterialPicker: {},
    isVerified: () => false, getServiceCatalog: async () => ({ items: [] }),
    markdownToPlainText: text => text || '', openPage: path => routes.push(path),
    uni: { showToast: value => toasts.push(value), showModal: value => modals.push(value) },
    ...overrides
  }
  vm.runInNewContext(code, context)
  const options = context.options
  const page = { ...options.data(), isModuleEnabled: () => true, isPageModuleEnabled: () => true, filterModuleEntries: rows => rows, ...overrides }
  for (const [name, fn] of Object.entries(options.methods || {})) page[name] = fn.bind(page)
  for (const [name, fn] of Object.entries(options.computed || {})) Object.defineProperty(page, name, { get: () => fn.call(page) })
  return { page, options, source, routes, modals, toasts }
}

test('服务模块关闭清除已打开说明和迟到目录，同时保留核心服务', async () => {
  let enabled = true; let catalogCalls = 0; const pending = deferred()
  const { page, options, routes } = await component('services', {
    isModuleEnabled: key => key !== 'services' || enabled,
    getServiceCatalog: () => { catalogCalls++; return pending.promise }
  })
  page.selectedService = { title: '待关闭服务', url: '/pages/service-apply/index?id=a' }
  page.remoteServices = [{ title: '旧服务', url: '/pages/service-apply/index?id=a' }]
  page.catalogError = '旧错误'
  const loading = page.load()
  enabled = false; options.watch.servicesEnabled.call(page, false)
  assert.equal(page.selectedService, null); assert.equal(page.remoteServices.length, 0); assert.equal(page.catalogError, '')
  pending.resolve({ items: [{ title: '晚到服务', url: '/pages/service-apply/index?id=a' }] }); await loading
  assert.equal(page.remoteServices.length, 0); assert.equal(page.loading, false)
  await page.load(); assert.equal(catalogCalls, 1)
  assert.ok(page.allServices.some(item => item.url === '/pages/card/index'))
  page.selectedService = { title: '旧弹层', url: '/pages/service-apply/index?id=a' }
  page.openSelectedService(); assert.equal(page.selectedService, null); assert.equal(routes.length, 0)
})

test('其他模块关闭后不保留指向它的服务弹层，实名核心入口可用', async () => {
  const { page, options, routes } = await component('services', { isPageModuleEnabled: path => path !== '/pages/jobs/index' })
  page.selectedService = { _core: true, title: '招聘', url: '/pages/jobs/index' }
  assert.equal(page.selectedServiceAvailable, false)
  options.watch.selectedServiceAvailable.call(page, page.selectedServiceAvailable)
  assert.equal(page.selectedService, null)
  page.selectedService = { _core: true, title: '实名', url: '/pages/verify/index' }
  page.openSelectedService(); assert.deepEqual(routes, ['/pages/verify/index'])
})

test('企业工作台关闭招聘后所有入口均不可请求，资料页继续可用', async () => {
  let calls = 0
  const { page, source, routes, modals } = await component('enterprise-owner', {
    isModuleEnabled: key => key !== 'jobs',
    getMyEnterpriseJobs: async () => { calls++; return { items: [] } },
    cancelMyEnterpriseJob: async () => { calls++ }
  })
  page.state = 'approved'; page.profileInitialSnapshot = page.profileSnapshot
  page.jobs = [{ id: 'job-a' }]; page.activeTab = 'jobs'
  page.showJobs(); page.openJobEditor(); page.openJobEditor({ id: 'job-a' }); page.cancelJob({ id: 'job-a' }); await page.loadJobs()
  assert.equal(page.activeTab, 'profile'); assert.equal(page.jobs.length, 0)
  assert.equal(calls, 0); assert.equal(routes.length, 0); assert.equal(modals.length, 0)
  assert.match(source, /v-if="jobsEnabled"[^>]*@tap="showJobs"/)
  assert.match(source, /<template v-if="activeTab === 'profile' \|\| !jobsEnabled">/)
})

test('招聘加载中关闭后丢弃迟到结果，重新启用可以重新加载', async () => {
  let enabled = true; const pending = deferred(); let calls = 0
  const { page, options } = await component('enterprise-owner', {
    isModuleEnabled: key => key !== 'jobs' || enabled,
    getMyEnterpriseJobs: () => ++calls === 1 ? pending.promise : Promise.resolve({ items: [{ id: 'new-job', status: 'PUBLISHED' }] })
  })
  page.state = 'approved'; page.profileInitialSnapshot = page.profileSnapshot
  const loading = page.loadJobs()
  assert.equal(page.jobsLoading, true)
  enabled = false; options.watch.jobsEnabled.call(page, false)
  pending.resolve({ items: [{ id: 'stale-job', status: 'PUBLISHED' }] }); await loading
  assert.equal(page.jobs.length, 0); assert.equal(page.jobsLoading, false); assert.equal(page.jobsLoaded, false)
  enabled = true; await page.loadJobs()
  assert.equal(page.jobs[0].id, 'new-job'); assert.equal(page.jobs[0].status, 'published'); assert.equal(page.jobsLoaded, true)
})

test('关闭招聘后不处理旧确认弹窗，也不显示迟到错误', async () => {
  let enabled = true; let cancelled = 0; const pending = deferred()
  const { page, options, modals } = await component('enterprise-owner', {
    isModuleEnabled: key => key !== 'jobs' || enabled,
    getMyEnterpriseJobs: () => pending.promise,
    cancelMyEnterpriseJob: async () => { cancelled++ }
  })
  page.state = 'approved'; page.profileInitialSnapshot = page.profileSnapshot
  page.cancelJob({ id: 'job-a', title: '岗位', status: 'published' })
  const loading = page.loadJobs()
  enabled = false; options.watch.jobsEnabled.call(page, false)
  await modals[0].success({ confirm: true })
  pending.reject(new Error('MODULE_DISABLED')); await loading
  assert.equal(cancelled, 0); assert.equal(modals.length, 1); assert.equal(page.jobsError, '')
})
