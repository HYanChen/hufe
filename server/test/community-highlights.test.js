import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

const day = 86400000
const iso = (offset = 0) => new Date(Date.now() + offset * day).toISOString()
const announcement = (id, overrides = {}) => ({ id, title: id, summary: '摘要', content: '正文', category: '平台公告', audience: 'all', priority: 'normal', startAt: iso(-1), endAt: iso(1), targetType: 'none', target: '', carouselPlacement: 'pinned', status: 'published', revision: 1, createdAt: iso(), ...overrides })
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-highlights-'))
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  const contentService = { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status, home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, status }), get: async () => null }
  const app = await buildApp({ config: createConfig({ env: 'test', dataFile: path.join(dir, 'data.json'), mediaDir: path.join(dir, 'media'), dataHashSecret: 'highlights-test-only' }), logger: false, refreshContent: false, scheduleContent: false, contentService })
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }) })
  const users = {}, headers = {}
  for (const [name, personType] of [['admin', 'staff'], ['student', 'student'], ['alumni', 'alumni']]) {
    users[name] = await app.services.accounts.register({ schoolSubject: `highlights-${name}`, name, department: '测试学院', personType, isAdmin: name === 'admin', verificationSource: 'school-registration-check' }, { username: name, password: `Highlights-${name}!2026` })
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: name, password: `Highlights-${name}!2026` } })
    headers[name] = { authorization: `Bearer ${login.json().data.accessToken}` }
  }
  await app.services.database.transaction(state => { state.business.resources.announcements = []; state.business.resources['community-posts'] = [] })
  const get = (who = '') => app.inject({ url: '/api/v1/business/community-highlights', headers: headers[who] || {} })
  return { app, users, headers, get }
}

test('轮播按公告发布时间、受众和组织成员权限过滤，不泄漏内部字段', async t => {
  const { app, users, get } = await fixture(t)
  await app.services.database.transaction(data => {
    data.business.resources.announcements.push(
      announcement('public', { adminNote: 'secret', authorAccountId: 'secret' }), announcement('expired', { endAt: iso(-0.1) }),
      announcement('future', { startAt: iso(0.1) }), announcement('draft', { status: 'draft' }), announcement('offline', { status: 'offline' }),
      announcement('alumni-only', { audience: 'alumni' }), announcement('campus-only', { audience: 'campus' }),
      announcement('priority-not-pinned', { priority: 'urgent', carouselPlacement: 'none' }),
      announcement('organization', { organizationId: 'organization-one' }))
    data.business.resources.organizations.push({ id: 'organization-one', status: 'published', name: '组织' })
    data.business.submissions.push({ id: 'member', type: 'organization-membership', resourceId: 'organization-one', accountId: users.student.id, status: 'approved' })
  })
  const guest = await get()
  assert.equal(guest.headers['cache-control'], 'private, no-store')
  assert.deepEqual(guest.json().data.items.map(item => item.id), ['public'])
  assert.doesNotMatch(guest.body, /secret|adminNote|authorAccountId/)
  assert.deepEqual((await get('student')).json().data.items.map(item => item.id).sort(), ['campus-only', 'organization', 'public'])
  assert.deepEqual((await get('alumni')).json().data.items.map(item => item.id).sort(), ['alumni-only', 'public'])
  await app.services.database.transaction(data => { data.business.resources.organizations.find(item => item.id === 'organization-one').status = 'offline' })
  assert.equal((await get('student')).json().data.items.some(item => item.id === 'organization'), false)
})

test('后台置顶保存、取消、排序、非法值和修订冲突；下架后详情与轮播同步失效', async t => {
  const { app, headers, get } = await fixture(t)
  const { id, status, revision, createdAt, ...payload } = announcement('new')
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/business/announcements', headers: headers.admin, payload })
  assert.equal(created.statusCode, 201, created.body)
  const record = created.json().data, base = `/api/v1/admin/business/announcements/${record.id}`
  assert.equal(record.carouselPlacement, 'pinned')
  assert.equal((await get()).json().data.items.length, 0)
  const published = await app.inject({ method: 'POST', url: base + '/actions', headers: headers.admin, payload: { action: 'publish' } })
  assert.equal(published.statusCode, 200, published.body)
  assert.equal((await get()).json().data.items[0].id, record.id)
  await app.services.database.transaction(data => { data.business.resources.announcements.push(announcement('first', { sortOrder: -10 })) })
  assert.equal((await get()).json().data.items[0].id, 'first')
  const current = (await app.inject({ url: base, headers: headers.admin })).json().data
  const patch = payload => app.inject({ method: 'PATCH', url: base, headers: headers.admin, payload })
  assert.equal((await patch({ carouselPlacement: 'bad', expectedRevision: current.revision })).statusCode, 400)
  assert.equal((await patch({ carouselPlacement: 'none', expectedRevision: current.revision })).statusCode, 200)
  assert.equal((await patch({ carouselPlacement: 'pinned', expectedRevision: current.revision })).statusCode, 409)
  assert.equal((await get()).json().data.items.some(item => item.id === record.id), false)
  await app.inject({ method: 'POST', url: base + '/actions', headers: headers.admin, payload: { action: 'unpublish' } })
  assert.equal((await app.inject({ url: `/api/v1/business/announcements/${record.id}` })).statusCode, 404)
})

test('热帖按全量真实互动排序，零互动不补位，置顶去重', async t => {
  const { app, users, get } = await fixture(t)
  await app.services.database.transaction(data => {
    for (let i = 0; i < 15; i++) data.business.resources['community-posts'].push({ id: `post-${i}`, status: 'published', visibility: 'all', content: `内容 ${i}`, authorName: '作者', authorAccountId: users.student.id, createdAt: iso(-i), likeCount: i === 0 ? 999999 : 0 })
    data.business.resources['community-posts'].push({ id: 'hidden', status: 'published', visibility: 'alumni', content: '校友专属', createdAt: iso(), carouselPlacement: 'pinned' }, { id: 'too-old', status: 'published', visibility: 'all', content: '旧帖', createdAt: iso(-31) })
    data.business.reactions.push(...['post-14', 'post-14', 'post-13', 'too-old'].map((id, i) => ({ id: `like-${i}`, type: 'community-like', resourceId: id, accountId: `liker-${i}` })))
    data.business.submissions.push({ id: 'comment', type: 'community-comment', resourceId: 'post-12', accountId: users.student.id, status: 'published', payload: { content: '评论' } })
  })
  assert.equal((await get()).json().data.items.length, 0)
  const items = (await get('student')).json().data.items
  assert.deepEqual(items.map(item => item.id), ['post-12', 'post-14', 'post-13', 'too-old'])
  assert.ok(items.every(item=>item.placement==='hot'));assert.equal(items.some(item=>item.id==='post-0'),false)
  await app.services.database.transaction(data => {
    data.business.resources['community-posts'].find(item => item.id === 'post-14').carouselPlacement = 'pinned'
    data.business.submissions.find(item => item.id === 'comment').status = 'offline'
  })
  const refreshed = (await get('student')).json().data.items
  assert.equal(refreshed[0].id, 'post-14'); assert.equal(refreshed[0].placement, 'pinned')
  assert.equal(refreshed.filter(item => item.id === 'post-14').length, 1)
  assert.equal(refreshed[1].id, 'post-13')
  await app.services.database.transaction(data => {
    data.business.resources['community-posts'].find(item => item.id === 'post-14').carouselSortOrder = -100
  })
  const regularFeed = app.services.business.listPublic('community-posts', {}, users.student.id)
  assert.equal(regularFeed.items[0].id, 'post-0', '轮播排序不能改变普通动态的信息流顺序')
  await app.services.database.transaction(data => {
    data.business.resources['community-posts'].forEach(item => { item.carouselPlacement = 'pinned' })
  })
  const limited = (await get('student')).json().data.items
  assert.equal(limited.length, 6); assert.ok(limited.every(item => item.placement === 'pinned'), '超出置顶数量的内容不能降级混入热门')
})

test('普通实名用户和组织前台运营者不能自行设置校园墙置顶', async t => {
  const { app, users, headers, get } = await fixture(t)
  const posted = await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: headers.student, payload: { content: '试图置顶', carouselPlacement: 'pinned' } })
  assert.equal(posted.statusCode, 403)
  for (const operation of [() => app.services.business.createOrganizationContent('announcements', 'org', { carouselPlacement: 'pinned' }), () => app.services.business.updateOrganizationContent('announcements', 'org', 'notice', { carouselPlacement: 'pinned', expectedRevision: 1 })]) {
    await assert.rejects(operation, error => error.code === 'BUSINESS_FIELD_UNKNOWN')
  }
  const normal = await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: headers.student, payload: { content: '正常新帖', topic: '校园日常' } })
  assert.equal(normal.statusCode, 201, normal.body)
  const post = normal.json().data
  const base = `/api/v1/admin/business/community-posts/${post.id}`
  assert.equal((await app.inject({ method: 'PATCH', url: base, headers: headers.student, payload: { carouselPlacement: 'pinned', expectedRevision: post.revision } })).statusCode, 403)
  const updated = await app.inject({ method: 'PATCH', url: base, headers: headers.admin, payload: { carouselPlacement: 'pinned', carouselSortOrder: -1, expectedRevision: post.revision } })
  assert.equal(updated.statusCode, 200, updated.body)
  assert.equal((await get('student')).json().data.items[0].placement, 'pinned')
  await app.services.database.transaction(data => { data.accounts.find(item => item.id === users.student.id).schoolIdentityVerified = false })
  assert.equal((await get('student')).json().data.items.length, 0)
})
