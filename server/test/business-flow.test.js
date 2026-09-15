import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

const futureIso = (days = 30) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

function contentStub() {
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  return {
    init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status,
    home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, page: 1, pageSize: 12, status }),
    get: async () => null, refresh: async () => status
  }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-business-test-'))
  const config = createConfig({
    env: 'test', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'business-flow-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  await app.services.accounts.register({
    schoolSubject: 'business-admin', name: '业务管理员', personType: 'staff', department: '信息中心',
    verificationSource: 'school-registration-check', isAdmin: true
  }, { username: 'business_admin', password: 'StrongAdmin!2026' })
  await app.services.accounts.register({
    schoolSubject: 'business-user', name: '业务测试用户', personType: 'student', department: '财政金融学院',
    verificationSource: 'school-registration-check', isAdmin: false
  }, { username: 'business_user', password: 'StrongUser!2026' })

  const login = async (username, password) => (await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { username, password }
  })).json().data.accessToken
  return {
    app,
    adminToken: await login('business_admin', 'StrongAdmin!2026'),
    userToken: await login('business_user', 'StrongUser!2026')
  }
}

test('湖财圈可见范围覆盖匿名、列表、详情、首页及互动', async (t) => {
  const { app, adminToken, userToken } = await fixture(t)
  await app.services.accounts.register({ schoolSubject: 'visibility-alumni', name: '范围测试校友', personType: 'alumni', department: '信息学院', verificationSource: 'school-registration-check' }, { username: 'visibility_alumni', password: 'AlumniTest!2026' })
  const alumniToken = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'visibility_alumni', password: 'AlumniTest!2026' } })).json().data.accessToken
  const adminHeaders = { authorization: `Bearer ${adminToken}` }
  const student = { authorization: `Bearer ${userToken}` }
  const alumni = { authorization: `Bearer ${alumniToken}` }
  for (const visibility of ['all', 'alumni', 'campus']) {
    const post = (await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: student, payload: { content: '用于验证可见范围的测试动态内容。', topic: '校园记忆', visibility } })).json().data
    assert.ok(post.id)
    assert.equal(post.status, 'published')
    for (const [headers, allowed] of [[{}, false], [student, visibility !== 'alumni'], [alumni, visibility !== 'campus']]) {
      const list = (await app.inject({ method: 'GET', url: '/api/v1/business/community-posts', headers })).json().data
      assert.equal(list.items.some((item) => item.id === post.id), allowed, `${visibility} list`)
      const home = (await app.inject({ method: 'GET', url: '/api/v1/business/bootstrap', headers })).json().data
      assert.equal(JSON.stringify(home).includes(post.id), allowed, `${visibility} bootstrap`)
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/business/community-posts/${post.id}`, headers })).statusCode, allowed ? 200 : 404)
      if (headers.authorization) {
        assert.equal((await app.inject({ method: 'POST', url: `/api/v1/business/community-posts/${post.id}/like`, headers })).statusCode, allowed ? 200 : 404)
        const comment = await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers, payload: { type: 'community-comment', resourceId: post.id, payload: { content: '可见范围评论测试' } } })
        assert.equal(comment.statusCode, allowed ? 201 : 404)
      }
    }
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: student, payload: { content: '无效可见范围应被明确拒绝。', topic: '校园记忆', visibility: 'public' } })).statusCode, 400)
})

test('消息服务端筛选与分页不遗漏最早未读，已读操作幂等', async (t) => {
  const { app, userToken } = await fixture(t)
  const headers = { authorization: `Bearer ${userToken}` }
  await app.services.database.transaction((data) => {
    const account = data.accounts.find((item) => item.username === 'business_user')
    for (let i = 0; i < 101; i += 1) {
      data.business.notifications.push({ id: `page-test-${i}`, accountId: account.id, title: `消息 ${i}`, body: '测试分页', createdAt: new Date(2026, 0, 1, 0, i).toISOString() })
      if (i > 0) data.business.inboxReads.push({ id: `read-${i}`, accountId: account.id, inboxItemId: `notification:page-test-${i}`, readAt: new Date().toISOString() })
    }
  })
  const get = async (query) => (await app.inject({ method: 'GET', url: `/api/v1/business/me/inbox?${query}`, headers })).json().data
  const unread = await get('unreadOnly=true&pageSize=30')
  assert.equal(unread.total, 1)
  assert.equal(unread.items[0].id, 'notification:page-test-0')
  assert.equal((await get('kind=notice')).total, 0)
  const ids = new Set()
  for (let page = 1; page <= 4; page += 1) {
    const result = await get(`kind=progress&pageSize=30&page=${page}`)
    assert.equal(result.total, 101)
    result.items.forEach((item) => ids.add(item.id))
  }
  assert.equal(ids.size, 101)
  for (let i = 0; i < 2; i += 1) {
    const read = await app.inject({ method: 'PATCH', url: '/api/v1/business/me/inbox/notification%3Apage-test-0/read', headers, payload: {} })
    assert.equal(read.json().data.unreadCount, 0)
  }
})

test('后台创建、发布、修改和下架后，公开接口立即同步', async (t) => {
  const { app, adminToken } = await fixture(t)
  const adminHeaders = { authorization: `Bearer ${adminToken}` }

  const createdResponse = await app.inject({
    method: 'POST', url: '/api/v1/admin/business/activities', headers: adminHeaders,
    payload: { title: '前后台联调活动', category: '校友活动', organizer: '湖南财政经济学院', city: '长沙', venue: '厚生楼', startAt: futureIso(), quota: 30, description: '用于真实接口回归。' }
  })
  assert.equal(createdResponse.statusCode, 201)
  const created = createdResponse.json().data
  assert.equal(created.status, 'draft')

  const hidden = await app.inject({ method: 'GET', url: '/api/v1/business/activities' })
  assert.equal(hidden.statusCode, 200)
  assert.equal(hidden.json().data.total, 0)

  const published = await app.inject({
    method: 'POST', url: `/api/v1/admin/business/activities/${created.id}/actions`, headers: adminHeaders,
    payload: { action: 'publish' }
  })
  assert.equal(published.statusCode, 200)
  assert.equal(published.json().data.status, 'published')

  const visible = await app.inject({ method: 'GET', url: '/api/v1/business/activities' })
  assert.equal(visible.json().data.total, 1)
  assert.equal(visible.json().data.items[0].title, '前后台联调活动')

  const updated = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/activities/${created.id}`, headers: adminHeaders,
    payload: { title: '前后台联调活动（已更新）' }
  })
  assert.equal(updated.statusCode, 200)
  assert.equal(updated.json().data.revision, 3)
  const detail = await app.inject({ method: 'GET', url: `/api/v1/business/activities/${created.id}` })
  assert.equal(detail.json().data.title, '前后台联调活动（已更新）')

  await app.inject({
    method: 'POST', url: `/api/v1/admin/business/activities/${created.id}/actions`, headers: adminHeaders,
    payload: { action: 'unpublish', reason: '回归验证下架' }
  })
  const missing = await app.inject({ method: 'GET', url: `/api/v1/business/activities/${created.id}` })
  assert.equal(missing.statusCode, 404)
})

test('用户报名进入业务申请中心，管理员审核结果回到我的记录', async (t) => {
  const { app, adminToken, userToken } = await fixture(t)
  const adminHeaders = { authorization: `Bearer ${adminToken}` }
  const userHeaders = { authorization: `Bearer ${userToken}` }

  const activity = (await app.inject({
    method: 'POST', url: '/api/v1/admin/business/activities', headers: adminHeaders,
    payload: { title: '报名审核活动', category: '校友活动', organizer: '学校', venue: '厚生楼', startAt: futureIso(45), description: '用于报名审核回归。' }
  })).json().data
  await app.inject({ method: 'POST', url: `/api/v1/admin/business/activities/${activity.id}/actions`, headers: adminHeaders, payload: { action: 'publish' } })

  const submitted = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: userHeaders,
    payload: { type: 'event-registration', resourceId: activity.id, payload: { contact: '仅测试', note: '参加活动' } }
  })
  assert.equal(submitted.statusCode, 201)
  const application = submitted.json().data
  assert.equal(application.status, 'submitted')

  const duplicate = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: userHeaders,
    payload: { type: 'event-registration', resourceId: activity.id, payload: {} }
  })
  assert.equal(duplicate.statusCode, 409)

  const applications = await app.inject({ method: 'GET', url: '/api/v1/admin/business/applications', headers: adminHeaders })
  assert.equal(applications.statusCode, 200)
  const automaticallyJoined = app.services.database.read(state => state.business.submissions.filter(row => row.type === 'organization-membership' && row.automaticMembership === true).length)
  assert.equal(applications.json().data.total, 1 + automaticallyJoined)
  const eventApplications = applications.json().data.items.filter(row => row.submissionType === 'event-registration')
  assert.equal(eventApplications.length, 1)
  assert.equal(eventApplications[0].applicantName, '业务测试用户')
  assert.equal(eventApplications[0].id, application.id)
  assert.equal(applications.json().data.items.filter(row => row.submissionType === 'organization-membership' && row.status === 'approved').length, 1)

  const approved = await app.inject({
    method: 'POST', url: `/api/v1/admin/business/applications/${application.id}/actions`, headers: adminHeaders,
    payload: { action: 'approve' }
  })
  assert.equal(approved.statusCode, 200)
  assert.equal(approved.json().data.status, 'approved')

  const mine = await app.inject({ method: 'GET', url: '/api/v1/business/me/submissions?type=event-registration', headers: userHeaders })
  assert.equal(mine.statusCode, 200)
  assert.equal(mine.json().data.items[0].status, 'approved')
  const publicActivity = await app.inject({ method: 'GET', url: `/api/v1/business/activities/${activity.id}`, headers: userHeaders })
  assert.equal(publicActivity.json().data.registered, true)
  assert.equal(publicActivity.json().data.registrationCount, 1)
})

test('实名动态直接发布，后台下架联动列表、首页、详情、互动与作者通知', async (t) => {
  const { app, adminToken, userToken } = await fixture(t)
  const adminHeaders = { authorization: `Bearer ${adminToken}` }
  const userHeaders = { authorization: `Bearer ${userToken}` }
  const postResponse = await app.inject({
    method: 'POST', url: '/api/v1/business/community-posts', headers: userHeaders,
    payload: { topic: '校园记忆', content: '这是一条用于验证湖财圈直接发布闭环的测试动态。', location: '长沙', status: 'pending_review', authorName: '伪造作者' }
  })
  assert.equal(postResponse.statusCode, 201)
  const post = postResponse.json().data
  assert.equal(post.status, 'published')
  assert.ok(post.publishedAt)
  assert.notEqual(post.authorName, '伪造作者')
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/business/community-posts' })).json().data.total, 0)

  const publicPost = await app.inject({ method: 'GET', url: `/api/v1/business/community-posts/${post.id}`, headers: userHeaders })
  assert.equal(publicPost.statusCode, 200)
  assert.equal(publicPost.json().data.likeCount, 0)

  const liked = await app.inject({ method: 'POST', url: `/api/v1/business/community-posts/${post.id}/like`, headers: userHeaders })
  assert.equal(liked.json().data.liked, true)
  assert.equal(liked.json().data.likeCount, 1)
  const unliked = await app.inject({ method: 'POST', url: `/api/v1/business/community-posts/${post.id}/like`, headers: userHeaders })
  assert.equal(unliked.json().data.liked, false)
  const actionsUrl = `/api/v1/admin/business/community-posts/${post.id}/actions`
  for (const action of ['close', 'complete', 'start']) {
    assert.equal((await app.inject({ method: 'POST', url: actionsUrl, headers: adminHeaders, payload: { action } })).statusCode, 400)
  }
  assert.equal((await app.inject({ method: 'POST', url: actionsUrl, headers: userHeaders, payload: { action: 'unpublish', reason: '不能越权' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: actionsUrl, headers: adminHeaders, payload: { action: 'unpublish' } })).statusCode, 400)
  const offline = await app.inject({ method: 'POST', url: actionsUrl, headers: adminHeaders, payload: { action: 'unpublish', reason: '内容需修正', expectedRevision: post.revision } })
  assert.equal(offline.statusCode, 200, offline.body)
  assert.equal(offline.json().data.status, 'offline')
  assert.equal((await app.inject({ url: '/api/v1/business/community-posts', headers: userHeaders })).json().data.total, 0)
  assert.doesNotMatch((await app.inject({ url: '/api/v1/business/bootstrap', headers: userHeaders })).body, new RegExp(post.id))
  for (const suffix of ['', '/comments']) assert.equal((await app.inject({ url: `/api/v1/business/community-posts/${post.id}${suffix}`, headers: userHeaders })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/business/community-posts/${post.id}/like`, headers: userHeaders })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/business/community-posts/${post.id}/comments`, headers: userHeaders, payload: { content: '不能评论已下架内容' } })).statusCode, 404)
  const state = app.services.database.read((data) => data)
  assert.ok(state.auditLogs.some((item) => item.action === 'business.community_post_published'))
  assert.ok(state.auditLogs.some((item) => item.action === 'business.admin_unpublish'))
  assert.ok(state.business.notifications.some((item) => item.resourceId === post.id && item.body.includes('内容需修正')))
  assert.equal((await app.inject({ method: 'POST', url: actionsUrl, headers: adminHeaders, payload: { action: 'publish', expectedRevision: post.revision } })).statusCode, 409)
  assert.equal((await app.inject({ method: 'POST', url: actionsUrl, headers: adminHeaders, payload: { action: 'publish', expectedRevision: offline.json().data.revision } })).statusCode, 200)
  assert.equal((await app.inject({ url: `/api/v1/business/community-posts/${post.id}`, headers: userHeaders })).statusCode, 200)
})

test('普通用户不能访问后台业务接口，未知资源和缺失详情返回明确状态', async (t) => {
  const { app, userToken } = await fixture(t)
  const rejected = await app.inject({ method: 'GET', url: '/api/v1/admin/business/activities', headers: { authorization: `Bearer ${userToken}` } })
  assert.equal(rejected.statusCode, 403)
  const unknown = await app.inject({ method: 'GET', url: '/api/v1/business/not-a-resource' })
  assert.equal(unknown.statusCode, 404)
  assert.equal(unknown.json().code, 'BUSINESS_RESOURCE_NOT_FOUND')
  const missing = await app.inject({ method: 'GET', url: '/api/v1/business/activities/not-found' })
  assert.equal(missing.statusCode, 404)
})

test('后台正文只接受安全 Markdown，并按字段校验长度、网址和日期', async (t) => {
  const { app, adminToken } = await fixture(t)
  const headers = { authorization: `Bearer ${adminToken}` }
  const safeMarkdown = [
    '# 活动说明',
    '',
    '欢迎 **湖财人** 参加。',
    '',
    '- 请提前签到',
    '- 查看[学校官网](https://www.hufe.edu.cn/)',
    '',
    '![活动海报](/api/v1/media/123e4567-e89b-42d3-a456-426614174000.png)'
  ].join('\r\n')
  const created = await app.inject({
    method: 'POST', url: '/api/v1/admin/business/activities', headers,
    payload: {
      title: '安全 Markdown 活动', category: '校友活动', organizer: '湖南财政经济学院', venue: '厚生楼',
      startAt: '2026-10-01T09:00', endAt: '2026-10-01T12:00',
      description: safeMarkdown
    }
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().data.description.includes('\r'), false)
  assert.match(created.json().data.description, /\*\*湖财人\*\*/)

  const dangerousHtml = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/activities/${created.json().data.id}`, headers,
    payload: { description: '<img src=x onerror=alert(1)>正文' }
  })
  assert.equal(dangerousHtml.statusCode, 400)
  assert.equal(dangerousHtml.json().code, 'BUSINESS_MARKDOWN_UNSAFE')

  const dangerousLink = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/activities/${created.json().data.id}`, headers,
    payload: { description: '[点击查看](javascript:alert(1))' }
  })
  assert.equal(dangerousLink.statusCode, 400)
  assert.equal(dangerousLink.json().code, 'BUSINESS_MARKDOWN_UNSAFE')

  const tooLong = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/activities/${created.json().data.id}`, headers,
    payload: { description: '湖'.repeat(30_001) }
  })
  assert.equal(tooLong.statusCode, 400)
  assert.equal(tooLong.json().code, 'BUSINESS_FIELD_TOO_LONG')

  const invalidUrl = await app.inject({
    method: 'POST', url: '/api/v1/admin/business/service-catalog', headers,
    payload: { title: '危险链接服务', category: '校园服务', summary: '服务说明', externalUrl: 'javascript:alert(1)' }
  })
  assert.equal(invalidUrl.statusCode, 400)
  assert.equal(invalidUrl.json().code, 'BUSINESS_URL_INVALID')

  const invalidDate = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/activities/${created.json().data.id}`, headers,
    payload: { endAt: '2026-02-30T12:00' }
  })
  assert.equal(invalidDate.statusCode, 400)
  assert.equal(invalidDate.json().code, 'BUSINESS_DATE_INVALID')
})

test('后台编辑支持 expectedRevision 乐观锁并保持旧客户端兼容', async (t) => {
  const { app, adminToken } = await fixture(t)
  const headers = { authorization: `Bearer ${adminToken}` }
  const created = (await app.inject({
    method: 'POST', url: '/api/v1/admin/business/organizations', headers,
    payload: { name: '乐观锁测试组织', type: '学院组织', summary: '初始简介' }
  })).json().data

  const firstUpdate = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/organizations/${created.id}`, headers,
    payload: { expectedRevision: created.revision, summary: '第一位管理员更新后的简介' }
  })
  assert.equal(firstUpdate.statusCode, 200)
  assert.equal(firstUpdate.json().data.revision, created.revision + 1)
  assert.equal(Object.prototype.hasOwnProperty.call(firstUpdate.json().data, 'expectedRevision'), false)

  const staleUpdate = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/organizations/${created.id}`, headers,
    payload: { expectedRevision: created.revision, summary: '过期页面不应覆盖新内容' }
  })
  assert.equal(staleUpdate.statusCode, 409)
  assert.equal(staleUpdate.json().code, 'BUSINESS_REVISION_CONFLICT')
  const afterConflict = await app.inject({
    method: 'GET', url: `/api/v1/admin/business/organizations/${created.id}`, headers
  })
  assert.equal(afterConflict.json().data.summary, '第一位管理员更新后的简介')

  const legacyUpdate = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/organizations/${created.id}`, headers,
    payload: { summary: '未提交版本号的旧客户端仍可更新' }
  })
  assert.equal(legacyUpdate.statusCode, 200)
  assert.equal(legacyUpdate.json().data.summary, '未提交版本号的旧客户端仍可更新')
})
