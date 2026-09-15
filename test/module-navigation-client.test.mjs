import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { moduleEnabled, moduleForPage } from '../server/src/modules/catalog.js'

async function fixture({ hash = '#/pages/conversations/index', pages = [], h5 = true, loaded = false } = {}) {
  const state = { loaded, revision: 0, flags: { chat: false, community: false } }, subscriptions = [], listeners = new Map(), replacements = [], switches = [], interceptors = {}, toasts = []
  const window = { location: { hash, replace(value) { replacements.push(value); this.hash = value } }, addEventListener: (event, callback) => listeners.set(event, callback) }
  const context = {
    moduleState: state, isModuleEnabled: key => moduleEnabled(state.flags, key), isPageModuleEnabled: path => moduleEnabled(state.flags, moduleForPage(path)),
    getCurrentPages: () => pages, subscribeModuleConfig: callback => { subscriptions.push(callback); callback(state) }, refreshModuleConfig: async () => state,
    document: { querySelectorAll: () => [] }, window,
    uni: { addInterceptor: (name, value) => { interceptors[name] = value }, showToast: value => toasts.push(value), switchTab: value => { switches.push(value); value.complete?.() } }
  }
  const source = await fs.readFile(new URL('../utils/moduleNavigation.js', import.meta.url), 'utf8')
  const compiled = (h5 ? source : source.replace(/\s*\/\/ #ifdef H5[\s\S]*?\/\/ #endif/g, '')).replace(/^import .*$/gm, '').replace(/^export /gm, '')
  vm.runInNewContext(compiled + '\nglobalThis.nav={installModuleNavigation,guardModulePage}', context)
  return { state, subscriptions, listeners, replacements, switches, interceptors, toasts, window, nav: context.nav }
}

test('H5冷启动旧链接在页面栈尚未创建时由确认配置直接退回首页', async () => {
  const f = await fixture()
  f.nav.installModuleNavigation()
  assert.equal(f.replacements.length, 0, '配置尚未加载时不臆测关闭状态')
  f.state.loaded = true; f.state.revision = 1; f.subscriptions[0](f.state)
  assert.deepEqual(f.replacements, ['#/pages/home/index'])
  assert.equal(f.switches.length, 0, '不等待尚未就绪的uni页面栈')
  assert.equal(f.toasts.length, 1)
})

test('H5再次粘贴已关闭hash也被独立hashchange监听拦截，无残留重定向锁', async () => {
  const f = await fixture({ loaded: true })
  f.nav.installModuleNavigation()
  f.window.location.hash = '#/pages/chat/index?id=old-conversation'
  f.listeners.get('hashchange')()
  f.window.location.hash = '#/pages/post-editor/index'
  f.listeners.get('hashchange')()
  assert.equal(f.replacements.length, 3)
  assert.ok(f.replacements.every(value => value === '#/pages/home/index'))
  assert.equal(f.switches.length, 0)
})

test('重新开启后允许旧链接和正常导航，核心页面始终不被模块拦截', async () => {
  const f = await fixture({ loaded: true, hash: '#/pages/profile/index' })
  f.nav.installModuleNavigation()
  assert.equal(f.replacements.length, 0)
  assert.equal(f.interceptors.navigateTo.invoke({ url: '/pages/chat/index' }), false)
  f.state.flags.chat = true; f.state.revision = 2; f.subscriptions[0](f.state)
  f.window.location.hash = '#/pages/chat/index?id=real-conversation'; f.listeners.get('hashchange')()
  assert.equal(f.replacements.length, 0)
  assert.deepEqual(f.interceptors.navigateTo.invoke({ url: '/pages/chat/index' }), { url: '/pages/chat/index' })
})

test('原生端保留switchTab返回首页，不调用H5浏览器导航', async () => {
  const f = await fixture({ h5: false, loaded: true, pages: [{ route: 'pages/conversations/index' }] })
  f.nav.installModuleNavigation()
  assert.equal(f.switches.length, 1); assert.equal(f.switches[0].url, '/pages/home/index')
  assert.equal(f.replacements.length, 0)
})
