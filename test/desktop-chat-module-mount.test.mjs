import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { moduleEnabled, moduleForPage, moduleForResource, normalizeModuleFlags } from '../server/src/modules/catalog.js'

async function fixture(initialEnabled = true) {
  const moduleSource = await fs.readFile(new URL('../services/modules.js', import.meta.url), 'utf8')
  const context = { reactive: value => value, moduleEnabled, moduleForPage, moduleForResource, normalizeModuleFlags, request: async () => ({ flags: { chat: true }, revision: 1 }) }
  // Deliberately no reactive renderer: the independent root must receive an
  // explicit confirmed-config update even if a component computed cache does not.
  vm.runInNewContext(moduleSource.replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nglobalThis.moduleApi={applyModuleConfig,subscribeModuleConfig,isModuleEnabled}', context)
  const api = context.moduleApi
  api.applyModuleConfig({ flags: { chat: initialEnabled }, revision: 1 })
  const renders = [], elements = [], observer = { observe() {}, disconnect() { this.disconnected = true } }
  let mixin, rootUnmounts = 0
  const app = { mixin: value => { mixin = value }, unmount: () => { rootUnmounts++ } }
  const hostContext = { app: 'main-uni-app-context' }
  const mountSource = await fs.readFile(new URL('../utils/desktopChatMount.js', import.meta.url), 'utf8')
  const sandbox = {
    ...api, createVNode: component => ({ component }), DesktopChatDock: { name: 'DesktopChatDock' },
    render: (vnode, host) => { renders.push(vnode); host.vnode = vnode }, updateModuleTabs() {},
    window: { __hufeDesktopChatReady: true }, MutationObserver: function () { return observer },
    document: { createElement: () => ({ remove() { this.removed = true } }), body: { appendChild: node => elements.push(node) }, querySelectorAll: () => [] }
  }
  vm.runInNewContext(mountSource.replace(/^import .*$/gm, '').replace('export function installDesktopChat', 'globalThis.installDesktopChat=function'), sandbox)
  sandbox.installDesktopChat(app)
  return { api, app, mount: () => mixin.mounted.call({ $: { appContext: hostContext } }), renders, elements, observer, sandbox, hostContext, rootUnmounts: () => rootUnmounts }
}

test('独立桌面对话根冷启动读取关闭状态，不创建按钮、面板或轮询组件', async () => {
  const { mount, renders, elements, sandbox } = await fixture(false)
  mount()
  assert.equal(elements.length, 1)
  assert.equal(renders.length, 0)
  assert.equal(sandbox.window.__hufeDesktopChatReady, false)
})

test('模块确认更新直接卸载独立对话根，重新开启只挂载一次且共用原App上下文', async () => {
  const { api, mount, renders, elements, sandbox, hostContext } = await fixture()
  mount(); assert.equal(renders.length, 1); assert.equal(renders[0].appContext, hostContext)
  api.applyModuleConfig({ flags: { chat: false }, revision: 2 })
  assert.equal(renders.length, 2); assert.equal(renders.at(-1), null)
  assert.equal(elements[0].vnode, null); assert.equal(sandbox.window.__hufeDesktopChatReady, false)
  api.applyModuleConfig({ flags: { chat: false }, revision: 2 })
  assert.equal(renders.length, 2)
  assert.equal(api.applyModuleConfig({ flags: { chat: true }, revision: 1 }), false)
  assert.equal(renders.length, 2, '迟到旧配置不能恢复关闭入口')
  api.applyModuleConfig({ flags: { chat: true }, revision: 3 })
  assert.equal(renders.length, 3); assert.equal(renders[2].appContext, hostContext)
  api.applyModuleConfig({ flags: { chat: true }, revision: 4 })
  assert.equal(renders.length, 3, '重复确认开启不能重复创建轮询组件')
})

test('配置先于页面挂载到达时使用最新状态，应用卸载取消订阅并移除独立根', async () => {
  const { api, mount, app, renders, elements, observer, rootUnmounts } = await fixture()
  api.applyModuleConfig({ flags: { chat: false }, revision: 2 }); mount()
  assert.equal(renders.length, 0)
  api.applyModuleConfig({ flags: { chat: true }, revision: 3 }); assert.equal(renders.length, 1)
  app.unmount()
  assert.equal(renders.at(-1), null); assert.equal(elements[0].removed, true); assert.equal(observer.disconnected, true); assert.equal(rootUnmounts(), 1)
  const before = renders.length
  api.applyModuleConfig({ flags: { chat: false }, revision: 4 })
  api.applyModuleConfig({ flags: { chat: true }, revision: 5 })
  mount()
  assert.equal(renders.length, before); assert.equal(elements.length, 1)
})

test('模块订阅提供当前确认状态，取消订阅后不收到后续更改', async () => {
  const { api } = await fixture(false), seen = []
  const stop = api.subscribeModuleConfig(state => seen.push({ revision: state.revision, enabled: state.flags.chat }))
  api.applyModuleConfig({ flags: { chat: true }, revision: 2 })
  stop(); api.applyModuleConfig({ flags: { chat: false }, revision: 3 })
  assert.deepEqual(seen, [{ revision: 1, enabled: false }, { revision: 2, enabled: true }])
})
