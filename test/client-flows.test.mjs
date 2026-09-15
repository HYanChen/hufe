import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { loadAllPages } from '../utils/pagination.js'
import { isManualVerification, manualVerificationDescription } from '../utils/identityVerification.js'
import { normalizeOrganizationType, organizationTypes, organizationProfileSummary, organizationProfileDetails } from '../server/src/business/organization-categories.js'

async function component(file, overrides = {}) {
  const source = await fs.readFile(new URL(file === 'chapter-detail' ? '../components/ChapterPage.vue' : `../pages/${file}/index.vue`, import.meta.url), 'utf8')
  const script = source.split('<script>')[1].split('</script>')[0]
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
    .replace('export default', 'globalThis.options =')
  const events = new Map()
  const context = {
    BusinessDetailSheet: {}, BusinessRichText: {}, OrganizationAlbums: {}, appConfig: { localDevelopment: false },
    normalizeOrganizationType, organizationTypes, organizationProfileSummary, organizationProfileDetails,
    getUser: () => ({}), identityLabel: () => '学生', isManualVerification, manualVerificationDescription,
    uni: { $on: (event, handler) => events.set(event, handler), $off: (event) => events.delete(event), showModal() {}, showToast() {}, redirectTo() {} },
    isVerified: () => true, openPage() {}, markdownToPlainText: (text) => text,
    getMyInbox: async () => ({ items: [], total: 0, unread: 0 }),
    markInboxMessageRead: async () => ({ unreadCount: 0 }),
    ...overrides
  }
  vm.runInNewContext(script, context)
  const options = context.options
  const instance = { ...options.data() }
  for (const [name, fn] of Object.entries(options.methods)) instance[name] = fn.bind(instance)
  for (const [name, fn] of Object.entries(options.computed)) Object.defineProperty(instance, name, { get: () => fn.call(instance) })
  return { instance, options, context, events }
}

test('自动组织主页识别本人的加入编号，提供退出入口且说明不会自动加回', async () => {
  let modal; const removed = []
  const { instance: page } = await component('chapter-detail', {
    getAccessToken: () => 'token-a',
    getOrganizationHome: async () => ({ organization: { id: 'org', name: '同专业校友', automatic: true, ownMembershipId: 'membership-a' } }),
    getMyOrganizationMemberships: async () => ({ items: [] }), getMyManagedOrganizations: async () => ({ items: [] }),
    endOrganizationMembership: async (id, token) => removed.push({ id, token }),
    uni: { setNavigationBarTitle() {}, showModal: value => { modal = value }, showToast() {} }
  })
  page.organizationId = 'org'; page.sectionView = 'about'
  await page.loadHome()
  assert.equal(page.membership.id, 'membership-a'); assert.equal(page.membershipActive, true); assert.equal(page.membershipActionLabel, '退出组织'); assert.equal(page.membership.automatic, true)
  page.loadHome = async () => { page.membership = null }
  page.toggleMembership(); assert.match(modal.content, /不会自动将你加回/)
  await modal.success({ confirm: true })
  assert.deepEqual(removed, [{ id: 'membership-a', token: 'token-a' }]); assert.equal(page.membership, null)
})

test('退出组织确认期间换账号，不得取消新账号或旧账号加入记录', async () => {
  let token = 'token-a', modal, writes = 0
  const { instance: page } = await component('chapter-detail', { getAccessToken: () => token, endOrganizationMembership: async () => writes++, uni: { showModal: value => { modal = value } } })
  page.verified = true; page.organization = { name: '组织' }; page.membership = { id: 'membership-a', status: 'approved', automatic: true }
  page.toggleMembership(); token = 'token-b'; page.membership = { id: 'membership-b', status: 'approved' }
  await modal.success({ confirm: true })
  assert.equal(writes, 0)
})

test('互动/@我分类交由服务端筛选，提及消息保留动态详情链接', async () => {
  const queries = []
  const { instance: page } = await component('inbox', { getMyInbox: async query => { queries.push(query); return { items: [{ id: 'mention-1', kind: 'interaction', type: 'community.mention', title: '校友提到了你', target: '/pages/community-comments/index?id=post-1' }], total: 1, unread: 1 } } })
  page.verified = true; page.filter = 'interaction'; await page.load()
  assert.equal(queries[0].kind, 'interaction')
  assert.equal(page.filteredMessages.length, 1)
  assert.equal(page.messages[0].category, '湖财圈 · @提及')
  assert.equal(page.messages[0].target, '/pages/community-comments/index?id=post-1')
})

test('全部目录分页不会遗漏第101条，登录变化及重复页不会被当作成功', async () => {
  const records = Array.from({ length: 205 }, (_, id) => ({ id, name: `校友${id}` }))
  const result = await loadAllPages(async ({ page, pageSize }) => ({ page, pageSize, total: records.length, items: records.slice((page - 1) * pageSize, page * pageSize) }))
  assert.equal(result.items.length, 205)
  assert.equal(result.items[204].name, '校友204')
  await assert.rejects(() => loadAllPages(async () => ({ items: records.slice(0, 100), total: 500 })), /列表数据已变化/)
  await assert.rejects(() => loadAllPages(async () => ({}), {}, () => false), /登录状态已变化/)
})

test('目录默认绑定当前会话，翻页期间切换账号时丢弃整批结果', async () => {
  const source = (await fs.readFile(new URL('../utils/authPagination.js', import.meta.url), 'utf8')).replace(/^import .*$/gm, '').replace('export function loadAllPages', 'function loadAllPages')
  let token = 'first-account'
  const context = { getAccessToken: () => token, collectPages: loadAllPages }
  vm.runInNewContext(`${source}\nglobalThis.collect = loadAllPages`, context)
  await assert.rejects(() => context.collect(async () => {
    token = 'different-account'
    return { total: 101, pageSize: 100, items: Array.from({ length: 100 }, (_, id) => ({ id })) }
  }), /登录状态已变化/)
})

test('组织快捷入口分别打开专属页面，隐藏页不再请求或抢写标题', async () => {
  const paths = []
  const { instance: page } = await component('chapter-detail', { openPage: (path) => paths.push(path), getAccessToken: () => 'token' })
  page.organizationId = 'org-example'
  for (const section of ['about', 'contact', 'members', 'album', 'messages']) page.goSection(section)
  assert.deepEqual(paths, ['about', 'contact', 'members', 'album', 'messages'].map((section) => `/pages/chapter-${section}/index?id=org-example`))
  page.active = false
  await page.loadHome()
  assert.equal(page.loading, false)
  page.announcements = [{ id: 'private' }]; page.activities = [{ id: 'private' }]
  await page.syncAuth()
  assert.equal(page.announcements.length, 0)
  assert.equal(page.activities.length, 0)
})

test('组织分类覆盖同级同班同专业同兴趣，兼容旧类别并检索组织特征', async () => {
  const records = [
    { id: 'grade', name: '年级联络站', type: 'grade', grade: '2022级' },
    { id: 'class', name: '同窗会', type: '同班校友', className: '计算机1班' },
    { id: 'major', name: '专业联络站', type: 'major', major: '计算机科学与技术' },
    { id: 'interest', name: '兴趣联络站', type: '兴趣组织', interestTags: ['摄影', '篮球'] },
    { id: 'college', name: '学院联络站', type: '学院分会', college: '信息技术与管理学院' }
  ]
  const { instance: page } = await component('chapters', {
    getOrganizations: async () => ({ items: records, total: records.length }),
    getMyOrganizationMemberships: async () => ({ items: [{ resourceId: 'class', status: 'approved' }] })
  })
  await page.loadChapters()
  for (const [category, id] of [['同年级校友', 'grade'], ['同班校友', 'class'], ['同专业校友', 'major'], ['同兴趣校友', 'interest'], ['学院组织', 'college']]) {
    assert.ok(page.filters.includes(category))
    page.activeFilter = category
    assert.equal(page.filteredChapters[0].id, id)
    assert.equal(page.filteredChapters.length, 1)
  }
  page.activeFilter = '全部组织'
  for (const [keyword, id] of [['2022', 'grade'], ['1班', 'class'], ['科学', 'major'], ['摄影', 'interest'], ['管理学院', 'college']]) {
    page.keyword = keyword
    assert.equal(page.filteredChapters[0].id, id)
  }
  page.keyword = ''
  page.activeFilter = '我已加入'
  assert.equal(page.filteredChapters[0].id, 'class')
})

test('组织分类不会漏掉第一百条之后的组织，主页和工作台显示统一类型', async () => {
  const queries = []
  const records = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: '地方组织', type: '地方组织' }))
  const extra = { id: 'later', name: '摄影校友会', type: 'interest', interestTags: ['摄影'], joined: true }
  const { instance: page } = await component('chapters', {
    getOrganizations: async (query) => { queries.push(query); return { items: query.page === 1 ? records : [extra], total: 101 } },
    getMyOrganizationMemberships: async () => ({ items: [] })
  })
  await page.loadChapters()
  assert.equal(queries.length, 2)
  assert.equal(page.chapters.length, 101)
  page.activeFilter = '同兴趣校友'
  assert.equal(page.filteredChapters[0].id, 'later')
  assert.equal(page.joinedCount, 1)
  const { instance: detail } = await component('chapter-detail')
  detail.organization = extra
  assert.equal(detail.organizationType, '同兴趣校友')
  assert.equal(detail.profileDetails[0].value, '摄影')
  const { instance: manager } = await component('chapter-manager')
  manager.organization = extra
  assert.equal(manager.organizationType, '同兴趣校友')
})

test('组织成员支持连续分页和学院搜索，重置不保留旧名单', async () => {
  const queries = []
  const { instance: page } = await component('chapter-detail', {
    getAccessToken: () => 'test-token',
    getOrganizationMembers: async (id, query) => { queries.push(query); return { items: [{ id: `${query.query}-${query.page}`, name: '真实校友' }], total: 2 } }
  })
  page.organizationId = 'organization'
  await page.loadMembers(true)
  await page.loadMembers(false)
  assert.equal(page.members.length, 2)
  assert.equal(queries[1].page, 2)
  page.memberKeyword = ' 信息学院 '
  await page.loadMembers(true)
  assert.equal(queries.at(-1).query, '信息学院')
  assert.equal(queries.at(-1).page, 1)
  assert.equal(page.members.length, 1)
  assert.equal(page.members[0].id, '信息学院-1')
})

test('组织页面退出账号后清除名单和留言，旧请求及卸载后回调不会恢复私有数据', async () => {
  let token = 'old-token'
  let resolveMembers, resolveMessages
  const { instance: page, options, events } = await component('chapter-detail', {
    getAccessToken: () => token, isVerified: () => Boolean(token),
    getOrganizationMembers: () => new Promise((resolve) => { resolveMembers = resolve }),
    getOrganizationMessages: () => new Promise((resolve) => { resolveMessages = resolve })
  })
  page.loadHome = async () => {}
  page.chapterId = 'organization'; options.mounted.call(page)
  const pendingMembers = page.loadMembers(true)
  const pendingMessages = page.loadMessages(true)
  page.messageDraft = '旧账号草稿'
  token = ''
  await events.get('hufe-auth-changed')()
  resolveMembers({ items: [{ id: 'private-member' }], total: 1 })
  resolveMessages({ items: [{ id: 'private-message' }], total: 1 })
  await Promise.all([pendingMembers, pendingMessages])
  assert.equal(page.members.length, 0)
  assert.equal(page.messages.length, 0)
  assert.equal(page.messageDraft, '')
  assert.equal(page.verified, false)
  options.beforeUnmount.call(page)
  assert.equal(events.size, 0)
})

test('组织成员搜索并发时仅采用最后一次响应，服务端鉴权失败清空所有私有列表', async () => {
  const requests = []
  const { instance: page } = await component('chapter-detail', {
    getAccessToken: () => 'test-token',
    getOrganizationMembers: () => new Promise((resolve, reject) => requests.push({ resolve, reject }))
  })
  page.organizationId = 'organization'; page.verified = true
  const old = page.loadMembers(true)
  page.memberKeyword = '新查询'
  const latest = page.loadMembers(true)
  requests[1].resolve({ items: [{ id: 'new' }], total: 1 }); await latest
  requests[0].resolve({ items: [{ id: 'old' }], total: 1 }); await old
  assert.equal(page.members[0].id, 'new')
  page.messages = [{ id: 'private-message' }]
  const expired = page.loadMembers(true)
  requests[2].reject(Object.assign(new Error('认证已失效'), { statusCode: 403 }))
  await expired
  assert.equal(page.members.length, 0)
  assert.equal(page.messages.length, 0)
  assert.equal(page.verified, false)
})

test('同账号资料刷新保留留言草稿，切换账号才清除', async () => {
  let id = 'same-user'
  const { instance: page, options } = await component('chapter-detail', { getAccessToken: () => 'token', getUser: () => ({ id }) })
  page.loadHome = async () => {}
  page.chapterId = 'organization'; options.mounted.call(page)
  page.messageDraft = '尚未完成的留言'
  await page.syncAuth()
  assert.equal(page.messageDraft, '尚未完成的留言')
  id = 'another-user'
  await page.syncAuth()
  assert.equal(page.messageDraft, '')
})

test('提交组织留言遇到会话失效时清空成员、留言、草稿和权限', async () => {
  const { instance: page } = await component('chapter-detail', {
    getAccessToken: () => 'expired-token',
    createOrganizationMessage: async () => { throw Object.assign(new Error('请重新登录'), { statusCode: 401 }) }
  })
  page.verified = true; page.organizationId = 'organization'; page.messageDraft = '准备提交'
  page.members = [{ id: 'private-member' }]; page.messages = [{ id: 'private-message' }]; page.managed = true
  await page.postMessage()
  assert.equal(page.members.length, 0); assert.equal(page.messages.length, 0); assert.equal(page.messageDraft, '')
  assert.equal(page.verified, false); assert.equal(page.managed, false); assert.equal(page.messagePosting, false)
})

test('消息页冷启动认证事件恢复登录，卸载取消订阅', async () => {
  let verified = false
  let calls = 0
  const { instance: page, options, events } = await component('inbox', { isVerified: () => verified, getMyInbox: async () => { calls++; return { items: [], total: 0 } } })
  options.onLoad.call(page)
  options.onShow.call(page)
  assert.equal(calls, 0)
  verified = true
  await events.get('hufe-auth-changed')()
  assert.equal(calls, 1)
  assert.equal(page.verified, true)
  options.onUnload.call(page)
  assert.equal(events.size, 0)
})

test('人工确认正式账号展示已校验，不声称学校接口已同步', async () => {
  const user = { schoolIdentityVerified: true, verificationSource: 'platform-admin-confirmed', realName: '正式校友', personType: 'student' }
  assert.equal(isManualVerification(user), true)
  assert.equal(isManualVerification({ ...user, schoolIdentityVerified: false }), false)
  assert.equal(isManualVerification({ ...user, verificationSource: 'school-registration-check' }), false)
  const { instance: verify } = await component('verify')
  verify.user = user
  verify.username = '正式校友'
  verify.password = 'FormalAccount!2026'
  assert.equal(verify.canSubmit, true)
  assert.equal(verify.developmentVerifiedFixture, false)
  assert.match(verify.signedInDescription, /管理员人工确认/)
  const { instance: mine } = await component('mine')
  mine.user = user
  mine.verified = true
  mine.signedIn = true
  assert.equal(mine.identityBadge, '✓ 已通过校验')
  assert.match(mine.identityDescription, /管理员人工确认/)
  const { instance: card } = await component('card')
  card.user = user
  assert.match(card.verificationDescription, /管理员人工确认/)
  assert.doesNotMatch(card.verificationDescription, /模拟|学校官网/)
})

test('注册页动态读取后台启停状态，不依赖旧构建开关且不清除人工注册凭证', async () => {
  let state = { ready: false, message: '待管理员启用' }
  const { instance: page } = await component('register', { getRegistrationConfiguration: async () => state })
  page.phase = 'configuration_pending'
  await page.refreshRegistrationConfiguration()
  assert.equal(page.registrationReady, false)
  state = { ready: true }
  await page.refreshRegistrationConfiguration()
  assert.equal(page.registrationReady, true)
  assert.equal(page.phase, 'idle')
  page.phase = 'registration_verified'
  page.registrationToken = 'existing-manual-ticket'
  state = { ready: false, message: '已停用' }
  await page.refreshRegistrationConfiguration()
  assert.equal(page.registrationReady, false)
  assert.equal(page.phase, 'registration_verified')
  assert.equal(page.registrationToken, 'existing-manual-ticket')
})

test('学校配置变更或停用后，旧轮询事务和校验状态一起清理', async () => {
  const source = (await fs.readFile(new URL('../services/schoolAuth.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
    .replace(/export /g, '')
  for (const code of ['SCHOOL_AUTH_CONFIG_CHANGED', 'REGISTRATION_AUTH_NOT_READY']) {
    let pending = 0; let verification = 0
    const context = {
      readAuthState: () => ({ pendingSession: { sessionId: 'old', pollToken: 'poll' } }),
      request: async () => { throw Object.assign(new Error('changed'), { code }) },
      clearPendingSession: () => { pending++ }, clearRegistrationVerification: () => { verification++ }
    }
    vm.runInNewContext(source, context)
    context.currentPlatform = () => 'h5'
    await assert.rejects(context.resumeRegistrationVerification(), error => error.code === code)
    assert.equal(pending, 1)
    assert.equal(verification, 1)
  }
})

test('未读和分类交由服务端筛选，全部消息支持分页', async () => {
  const queries = []
  const { instance: page } = await component('inbox', { getMyInbox: async (query) => {
    queries.push(query)
    return { items: [{ id: `page-${query.page}` }], total: 2, unread: 1 }
  } })
  page.verified = true
  page.filter = 'unread'
  await page.load()
  assert.equal(queries.at(-1).unreadOnly, true)
  page.filter = 'progress'
  await page.load()
  assert.equal(queries.at(-1).kind, 'progress')
  await page.load(true)
  assert.equal(page.messages.length, 2)
  assert.equal(queries.at(-1).page, 2)
})

test('登出后，旧消息列表响应不可回填', async () => {
  let resolve
  let verified = true
  const { instance: page } = await component('inbox', { isVerified: () => verified, getMyInbox: () => new Promise((r) => { resolve = r }) })
  const pending = page.syncAuth()
  verified = false
  page.syncAuth()
  resolve({ items: [{ id: 'old-account-message' }], total: 1 })
  await pending
  assert.equal(page.messages.length, 0)
  assert.equal(page.selectedMessage, null)
})

test('单条已读双击只发送一次请求，采用服务端未读数', async () => {
  let resolve
  let calls = 0
  const { instance: page } = await component('inbox', { markInboxMessageRead: () => { calls++; return new Promise((r) => { resolve = r }) } })
  page.verified = true
  const item = { id: 'one', read: false }
  const first = page.openMessage(item)
  await page.openMessage(item)
  resolve({ unreadCount: 4 })
  await first
  assert.equal(calls, 1)
  assert.equal(page.unread, 4)
})

test('切换账号时旧消息详情不可重新打开', async () => {
  let resolve
  let entered
  const loading = new Promise((r) => { entered = r })
  const { instance: page } = await component('inbox', { getMyInbox: () => new Promise((r) => { resolve = r; entered() }) })
  page.verified = true
  page.filter = 'unread'
  const pending = page.openMessage({ id: 'old-account-message', read: false })
  await loading
  const oldResolve = resolve
  page.syncAuth()
  oldResolve({ items: [], total: 0 })
  await pending
  assert.equal(page.selectedMessage, null)
  resolve({ items: [], total: 0 })
})

for (const expiresAt of ['', 'not-a-date', '2020-01-01T00:00:00Z']) {
  test(`注册凭证无效时清除凭证和密码，保留人工申请恢复路径：${expiresAt || '缺失'}`, async () => {
    let cleared = 0
    const { instance: page } = await component('register', {
      readAuthState: () => ({}), readRegistrationVerification: () => ({ status: 'registration_verified', registrationToken: 'test-only', expiresAt }),
      clearRegistrationVerification: () => { cleared++ }
    })
    page.manualFlow = true
    page.password = 'ShouldClear!123'
    page.loadState()
    assert.equal(cleared, 1)
    assert.equal(page.phase, 'expired')
    assert.equal(page.registrationToken, '')
    assert.equal(page.password, '')
    assert.equal(page.formValid, false)
  })
}

test('提交时服务端判定凭证无效，可重新领取且不循环提交', async () => {
  let cleared = 0
  const { instance: page } = await component('register', {
    clearRegistrationVerification: () => { cleared++ },
    registerPlatformAccount: async () => { throw { code: 'REGISTRATION_TICKET_INVALID' } }
  })
  Object.assign(page, { username: 'valid_user', password: 'StrongTest!2026', confirmPassword: 'StrongTest!2026', registrationToken: 'test-only', registrationExpiresAt: new Date(Date.now() + 600000).toISOString(), phase: 'registration_verified' })
  await page.submitRegistration()
  assert.equal(cleared, 1)
  assert.equal(page.phase, 'expired')
  assert.equal(page.loading, false)
})
