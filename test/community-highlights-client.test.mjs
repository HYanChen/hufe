import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function component(overrides = {}) {
  const source = await fs.readFile(new URL('../components/CommunityHighlights.vue', import.meta.url), 'utf8')
  const script = source.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm, '').replace('export default', 'globalThis.options =')
  const routes = [], toasts = []
  const context = { BusinessDetailSheet: {}, BusinessRichText: {}, getAccessToken: () => 'a', getCommunityHighlights: async () => ({ items: [] }), getBusinessDetail: async (_resource, id) => ({ id, title: '公告', content: '正文', target: '/pages/services/index' }), openPage: route => routes.push(route), uni: { $on() {}, $off() {}, showToast: value => toasts.push(value) }, ...overrides }
  vm.runInNewContext(script, context)
  const page = { ...context.options.data(), active: true }
  for (const [key, method] of Object.entries(context.options.methods)) page[key] = method.bind(page)
  return { page, options: context.options, routes, toasts }
}
test('轮播旧账号和已隐藏页面的延迟结果不回写', async () => {
  const late = deferred(); let token = 'a'
  const { page, options } = await component({ getAccessToken: () => token, getCommunityHighlights: () => late.promise })
  const loading = page.refresh(); token = 'b'; page.clear()
  late.resolve({ items: [{ id: 'private' }] }); await loading
  assert.equal(page.items.length, 0)
  page.items = [{ id: 'current' }]; page.selectedNotice = { id: 'notice' }
  options.watch.active.call(page, false)
  assert.equal(page.items.length, 0); assert.equal(page.selectedNotice, null)
})
test('轮播失败清空旧内容，前后切换循环且暂停自动播放', async () => {
  const { page } = await component({ getCommunityHighlights: async () => { throw new Error('网络中断') } })
  page.items = [{ id: 'one' }, { id: 'two' }]
  page.step(-1); assert.equal(page.current, 1); assert.equal(page.paused, true)
  page.step(1); assert.equal(page.current, 0)
  await page.refresh(); assert.equal(page.items.length, 0); assert.equal(page.error, '网络中断')
})
test('公告与帖子都先重查详情；公告跳转目标重查后打开', async () => {
  const reads = [], { page, routes } = await component({ getBusinessDetail: async (resource, id) => { reads.push(resource + ':' + id); return { id, target: '/pages/services/index' } } })
  await page.openItem({ kind: 'announcement', id: 'notice' }); assert.equal(page.selectedNotice.id, 'notice')
  await page.openNoticeTarget(); assert.equal(page.selectedNotice, null); assert.equal(routes[0], '/pages/services/index')
  await page.openItem({ kind: 'post', id: 'post' }); assert.equal(routes[1], '/pages/community-comments/index?id=post')
  assert.deepEqual(reads, ['announcements:notice', 'announcements:notice', 'community-posts:post'])
})
test('下架错误不导航，账号切换后迟到的详情不打开', async () => {
  const { page, routes, toasts } = await component({ getBusinessDetail: async () => { throw new Error('内容已下架') } })
  await page.openItem({ kind: 'post', id: 'removed' }); assert.equal(routes.length, 0); assert.equal(toasts[0].title, '内容已下架')
  const late = deferred(), other = await component({ getBusinessDetail: () => late.promise })
  const opening = other.page.openItem({ kind: 'announcement', id: 'private' }); other.page.clear()
  late.resolve({ id: 'private' }); await opening; assert.equal(other.page.selectedNotice, null)
})
