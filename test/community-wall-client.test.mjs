import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { communityDraftKey, normalizeCommunityTopics, extractCommunityTopics, suggestedCommunityTopics } from '../server/src/business/community.js'

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function editor(overrides = {}) {
  const source = await fs.readFile(new URL('../pages/post-editor/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm, '').replace('export default', 'globalThis.options =')
  const storage = new Map(); const routes = []; const toasts = []
  const context = { communityDraftKey, normalizeCommunityTopics, extractCommunityTopics, suggestedCommunityTopics, setTimeout, clearTimeout,
    getAccessToken: () => 'token-a', getUser: () => ({ id: 'account-a', name: '甲校友' }), isVerified: () => true, isModuleEnabled: () => true,
    openPage: path => routes.push(path),
    uni: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), showToast: toast => toasts.push(toast), $on() {}, $off() {}, previewImage() {} },
    chooseImageFiles: async () => [], removeCommunityImage: async () => {}, loadCommunityImage: async id => ({ src: 'blob:' + id, dispose() {} }),
    searchCommunityPeople: async () => ({ items: [] }), publishCommunityPost: async () => ({ id: 'post-id' }), ...overrides }
  vm.runInNewContext(script, context)
  const options = context.options; const page = { ...options.data() }
  for (const [name, fn] of Object.entries(options.methods)) page[name] = fn.bind(page)
  for (const [name, fn] of Object.entries(options.computed)) Object.defineProperty(page, name, { get: () => fn.call(page) })
  return { page, context, storage, routes, toasts, options }
}

test('匿名草稿在重试与令牌刷新后保留，成功发布及跨账号隔离', async () => {
  let user = 'account-a'; let token = 'token-a'; let fail = true; const payloads = []
  const { page, storage } = await editor({
    getUser: () => ({ id: user }), getAccessToken: () => token,
    publishCommunityPost: async payload => { payloads.push(payload); if (fail) throw new Error('网络中断'); return { id: 'anonymous-post' } }
  })
  storage.set(communityDraftKey(user), { content: '匿名的草稿', anonymous: true })
  await page.syncAccount(); assert.equal(page.anonymous, true)
  await page.publish(); assert.equal(payloads[0].anonymous, true); assert.equal(page.anonymous, true); assert.equal(page.content, '匿名的草稿')
  token = 'token-a-renewed'; await page.syncAccount(); assert.equal(page.anonymous, true)
  user = 'account-b'; token = 'token-b'; await page.syncAccount(); assert.equal(page.anonymous, false)
  user = 'account-a'; token = 'token-a'; await page.syncAccount(); assert.equal(page.anonymous, true)
  fail = false; await page.publish(); assert.equal(payloads[1].anonymous, true)
  assert.equal(page.anonymous, false); assert.equal(page.content, ''); assert.equal(storage.has(communityDraftKey(user)), false)
})

test('旧草稿保持实名默认，匿名标志不会从非布尔值意外启用', async () => {
  for (const anonymous of [undefined, 'false', 'true', 1]) {
    const { page, storage } = await editor()
    storage.set(communityDraftKey('account-a'), { content: '旧草稿', anonymous })
    await page.syncAccount(); assert.equal(page.anonymous, false)
  }
})

test('关闭校园墙离页前保存本人草稿，只存图片 ID，不能继续发布', async () => {
  let enabled = true; let published = 0; let disposed = 0
  const { page, storage, options } = await editor({ isModuleEnabled: () => enabled, publishCommunityPost: async () => { published++; return { id: 'never' } } })
  await page.syncAccount()
  page.content = '关闭模块前的未提交内容'; page.anonymous = true; page.topics = ['校园生活']; page.visibilityIndex = 2
  page.mentions = [{ id: 'person-b', name: '乙校友', token: 'never-persist-this' }]
  page.images = [{ id: 'photo-a', src: 'blob:private', dispose: () => disposed++ }, { id: '', src: '/private/local-file' }]
  enabled = false
  assert.equal(page.canSubmit, false)
  await page.publish()
  assert.equal(published, 0)
  options.onUnload.call(page)
  assert.deepEqual(JSON.parse(JSON.stringify(storage.get(communityDraftKey('account-a')))), {
    anonymous: true, content: '关闭模块前的未提交内容', topics: ['校园生活'], visibilityIndex: 2,
    mentions: [{ id: 'person-b', name: '乙校友' }], images: [{ id: 'photo-a' }]
  })
  assert.equal(disposed, 1); assert.equal(page.content, ''); assert.equal(published, 0)
})

test('模块关闭草稿不得跨账号、失效会话或普通离页覆盖保存', async () => {
  for (const change of ['account', 'token', 'enabled']) {
    let user = 'account-a'; let token = 'token-a'; let enabled = false
    const { page, storage, options } = await editor({ getUser: () => ({ id: user }), getAccessToken: () => token, isModuleEnabled: () => enabled })
    await page.syncAccount(); page.content = '只属于 A 的新内容'
    storage.set(communityDraftKey('account-a'), { content: '已保存草稿' })
    if (change === 'account') user = 'account-b'
    if (change === 'token') token = 'other-session'
    if (change === 'enabled') enabled = true
    options.onUnload.call(page)
    assert.equal(storage.get(communityDraftKey('account-a')).content, '已保存草稿')
    assert.equal(storage.has(communityDraftKey('account-b')), false)
  }
})

test('模块关闭空草稿不覆盖历史草稿，存储失败仍释放临时资源并提示', async () => {
  const { page, context, storage, toasts, options } = await editor({ isModuleEnabled: () => false })
  await page.syncAccount()
  storage.set(communityDraftKey('account-a'), { content: '历史草稿' })
  assert.equal(page.preserveDraftForDisabledModule(), false)
  assert.equal(storage.get(communityDraftKey('account-a')).content, '历史草稿')
  let disposed = 0; page.content = '新的未提交内容'; page.images = [{ id: 'photo-a', dispose: () => disposed++ }]
  context.uni.setStorageSync = () => { throw new Error('Quota exceeded') }
  assert.doesNotThrow(() => options.onUnload.call(page))
  assert.equal(disposed, 1); assert.equal(page.content, '')
  assert.equal(toasts.at(-1).title, '本机存储不足，草稿保存失败')
})

test('草稿恢复按图片 ID 回写并锁定增删，不会出现图片错位', async () => {
  const first = deferred(); const loaded = []; const disposed = []
  const { page, storage } = await editor({ loadCommunityImage: id => { loaded.push(id); return id === 'photo-a' ? first.promise : Promise.resolve({ src: 'blob:' + id, dispose() {} }) } })
  storage.set(communityDraftKey('account-a'), { content: '草稿', images: [{ id: 'photo-a' }, { id: 'photo-b' }] })
  const restoring = page.syncAccount()
  assert.equal(page.restoring, true); assert.equal(page.busy, true); assert.equal(page.canSubmit, false)
  await page.removeImage(0)
  assert.equal(page.images.length, 2)
  // 即便外部状态删除了第一张，晚到的响应也不可绑定到下一张。
  page.images.splice(0, 1)
  first.resolve({ src: 'blob:photo-a', dispose: () => disposed.push('photo-a') })
  await restoring
  assert.deepEqual(loaded, ['photo-a', 'photo-b'])
  assert.deepEqual(disposed, ['photo-a'])
  assert.equal(page.images[0].id, 'photo-b'); assert.equal(page.images[0].src, 'blob:photo-b')
  assert.equal(page.restoring, false)
})

test('跨账号草稿、话题输入与受众隔离，同账号换令牌保留未保存输入', async () => {
  let user = 'account-a'; let token = 'token-a'
  const { page, storage } = await editor({ getUser: () => ({ id: user }), getAccessToken: () => token })
  await page.syncAccount(); page.content = 'A的草稿'; page.visibilityIndex = 2; page.topicInput = 'A的话题'; page.searched = true
  page.saveDraft()
  token = 'token-a-renewed'; await page.syncAccount()
  assert.equal(page.content, 'A的草稿'); assert.equal(page.visibilityIndex, 2)
  user = 'account-b'; token = 'token-b'; await page.syncAccount()
  assert.equal(page.content, ''); assert.equal(page.visibilityIndex, 0); assert.equal(page.topicInput, ''); assert.equal(page.searched, false)
  page.content = 'B的草稿'; page.saveDraft()
  assert.equal(storage.get(communityDraftKey('account-a')).content, 'A的草稿')
  assert.equal(storage.get(communityDraftKey('account-b')).content, 'B的草稿')
  user = 'account-a'; token = 'token-a'; await page.syncAccount()
  assert.equal(page.content, 'A的草稿'); assert.equal(page.visibilityIndex, 2)
})

test('跨账号晚到图片与搜索被丢弃，离开页面释放临时预览', async () => {
  const pendingImage = deferred(); const pendingSearch = deferred(); let user = 'account-a'; let token = 'token-a'; let disposed = 0
  const { page, storage, options } = await editor({ getUser: () => ({ id: user }), getAccessToken: () => token, loadCommunityImage: () => pendingImage.promise, searchCommunityPeople: () => pendingSearch.promise })
  storage.set(communityDraftKey('account-a'), { images: [{ id: 'photo-a' }] })
  const loading = page.syncAccount(); page.peopleQuery = '校友'; const searching = page.searchPeople()
  user = 'account-b'; token = 'token-b'; await page.syncAccount()
  pendingImage.resolve({ src: 'blob:private-a', dispose: () => disposed++ }); pendingSearch.resolve({ items: [{ id: 'private-user', name: '甲' }] })
  await Promise.all([loading, searching])
  assert.equal(page.images.length, 0); assert.equal(page.people.length, 0); assert.equal(disposed, 1); assert.equal(page.busy, false)
  page.images = [{ id: 'photo-b', dispose: () => disposed++ }]; options.onUnload.call(page)
  assert.equal(disposed, 2); assert.equal(page.images.length, 0)
})

test('图文发布使用真实图片 ID 与提及 ID，去重自建话题且成功后清草稿', async () => {
  const payloads = []; const { page, routes, storage } = await editor({ publishCommunityPost: async payload => { payloads.push(payload); return { id: 'post-123' } } })
  await page.syncAccount(); page.content = '校园晚霞 #散步 #摄影'; page.addTopic('#摄影#')
  page.images = [{ id: 'real-photo' }]; page.addMention({ id: 'real-person', name: '真实校友' }); page.addMention({ id: 'real-person', name: '重复选择' })
  page.saveDraft(); await page.publish()
  assert.equal(payloads.length, 1)
  const payload = JSON.parse(JSON.stringify(payloads[0]))
  assert.deepEqual(payload.mediaIds, ['real-photo']); assert.deepEqual(payload.mentionAccountIds, ['real-person']); assert.deepEqual(payload.topics, ['摄影', '散步'])
  assert.equal(payload.visibility, 'all'); assert.equal(storage.has(communityDraftKey('account-a')), false)
  assert.equal(routes[0], '/pages/community-comments/index?id=post-123'); assert.equal(page.content, '')
})

test('部分上传失败保留成功图片和文字，过期草稿可删除后继续发布', async () => {
  let uploaded = 0; const { page } = await editor({
    chooseImageFiles: async () => [{ localPath: 'local:a' }, { localPath: 'local:b' }],
    uploadCommunityImage: async () => { if (++uploaded === 2) throw new Error('网络中断'); return { id: 'uploaded-a' } },
    removeCommunityImage: async () => { throw Object.assign(new Error('过期图片已清理'), { statusCode: 404 }) }
  })
  await page.syncAccount(); page.content = '保留正文'; await page.addImages()
  assert.equal(page.images.length, 1); assert.equal(page.images[0].id, 'uploaded-a'); assert.equal(page.content, '保留正文'); assert.equal(page.busy, false); assert.equal(page.error, '网络中断')
  page.images.push({ id: 'expired', error: '图片已过期' }); assert.equal(page.canSubmit, false)
  await page.removeImage(1); assert.equal(page.images.length, 1); assert.equal(page.canSubmit, true)
})

test('失败发布保留草稿，话题/提及限制不会静默丢失内容', async () => {
  const { page, storage } = await editor({ publishCommunityPost: async () => { throw new Error('提及账号已不可用') } })
  await page.syncAccount(); page.content = '不要丢失'; page.saveDraft(); await page.publish()
  assert.equal(page.content, '不要丢失'); assert.equal(page.error, '提及账号已不可用'); assert.equal(page.submitting, false); assert.equal(storage.has(communityDraftKey('account-a')), true)
  for (let i = 0; i < 6; i++) page.addTopic('话题' + i)
  assert.equal(page.topics.length, 5); assert.match(page.error, /最多/)
  for (let i = 0; i < 11; i++) page.addMention({ id: 'person-' + i, name: '校友' + i })
  assert.equal(page.mentions.length, 10); assert.match(page.error, /最多/)
  assert.throws(() => normalizeCommunityTopics(['空 格']), /不含空格/)
})

test('校园墙点赞防重复请求，采用服务端计数且不重复加载全部图片', async () => {
  const source = await fs.readFile(new URL('../pages/community/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm, '').replace('export default', 'globalThis.options =')
  const pending = deferred(); let calls = 0; let token = 'token-a'; let reloads = 0
  const context = { PostCard: {}, CommunityHighlights: {}, suggestedCommunityTopics, isVerified: () => true, getAccessToken: () => token, toggleCommunityLike: () => { calls++; return pending.promise }, uni: { showToast() {} } }
  vm.runInNewContext(script, context)
  const page = { ...context.options.data(), loadPosts: () => { reloads++ } }
  page.posts = [{ id: 'post-a', liked: false, displayLikeCount: 0 }]
  const first = context.options.methods.like.call(page, 'post-a'); await context.options.methods.like.call(page, 'post-a')
  assert.equal(calls, 1); pending.resolve({ liked: true, likeCount: 12 }); await first
  assert.equal(page.posts[0].liked, true); assert.equal(page.posts[0].displayLikeCount, 12); assert.equal(reloads, 0)
  const old = context.options.methods.like.call(page, 'post-a'); token = 'token-b'; page.posts = [{ id: 'post-a', liked: false, displayLikeCount: 0 }]; await old
  assert.equal(page.posts[0].liked, false)
})
