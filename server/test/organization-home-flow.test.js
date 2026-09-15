import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { normalizeAdminPayload } from '../src/business/service.js'

const futureIso = (days = 30) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
const pastIso = (days = 1) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

test('组织成员名单鉴权、真实审核状态、去重、隐私白名单与授权角色', async (t) => {
  const { app, accounts, login, rootHeaders } = await fixture(t)
  const organization = await createAndPublishOrganization(app, rootHeaders, '成员名单分会', { memberCount: 90 })
  const other = await createAndPublishOrganization(app, rootHeaders, '其他分会')
  const headers = { authorization: `Bearer ${(await login('reader')).accessToken}` }
  const url = `/api/v1/business/organizations/${organization.id}/members`
  assert.equal((await app.inject({ url })).statusCode, 401)
  const grant = await grantOrganization(app, rootHeaders, organization.id, accounts.manager.id)
  await app.services.database.transaction((state) => {
    const sample = (id, accountId, status, resourceId = organization.id) => ({
      id, accountId, status, resourceId, type: 'organization-membership', createdAt: '2026-01-01',
      actorSnapshot: { name: '不应读取历史快照', studentIdMasked: 'PRIVATE-STUDENT' },
      payload: { phone: 'PRIVATE-PHONE', identityNumber: 'PRIVATE-ID' }, adminNote: 'PRIVATE-NOTE'
    })
    state.business.submissions.push(
      sample('one', accounts.member.id, 'approved'), sample('duplicate', accounts.member.id, 'joined'),
      sample('manager', accounts.manager.id, 'active'), sample('root', accounts.root.id, 'approved'),
      sample('pending', accounts.pending.id, 'submitted'), sample('foreign', accounts.reader.id, 'approved', other.id),
      sample('missing-account', 'deleted-account', 'approved'), sample('cancelled', accounts.pending.id, 'cancelled')
    )
  })
  let response = await app.inject({ url, headers })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'private, no-store')
  assert.equal(response.json().data.total, 3)
  const rows = response.json().data.items
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['department','id','name','personType','role'])
  assert.equal(rows.find((item) => item.name === accounts.manager.name).role, 'manager')
  assert.equal(rows.find((item) => item.name === accounts.root.name).role, 'member')
  assert.doesNotMatch(response.body, /PRIVATE-|studentId|identityNumber|accountId|username|adminNote|actorSnapshot/)
  assert.equal((await app.inject({ url: `${url}?query=${encodeURIComponent('普通校友')}`, headers })).json().data.total, 1)
  assert.equal((await app.inject({ url: `${url}?query=${encodeURIComponent('财政金融学院')}`, headers })).json().data.total, 2)
  for (const query of ['page=1.5', 'page=0', 'page=Infinity', 'pageSize=101', 'pageSize=-1']) {
    assert.equal((await app.inject({ url: `${url}?${query}`, headers })).statusCode, 400, query)
  }
  await app.services.database.transaction((state) => {
    state.adminDelegations.find((item) => item.id === grant.json().data.id).expiresAt = pastIso()
    state.accounts.find((item) => item.id === accounts.member.id).status = 'suspended'
  })
  response = await app.inject({ url, headers })
  assert.equal(response.json().data.total, 2)
  assert.equal(response.json().data.items.find((item) => item.name === accounts.manager.name).role, 'member')
  await app.services.database.transaction((state) => {
    state.accounts.find((item) => item.id === accounts.manager.id).status = 'cancelled'
    state.business.submissions.find((item) => item.id === 'root').status = 'cancelled'
  })
  assert.equal((await app.inject({ url, headers })).json().data.total, 0)
  await app.services.database.transaction((state) => { state.accounts.find((item) => item.id === accounts.reader.id).schoolIdentityVerified = false })
  assert.equal((await app.inject({ url, headers })).statusCode, 403)
  await app.services.database.transaction((state) => { state.accounts.find((item) => item.id === accounts.reader.id).schoolIdentityVerified = true; state.business.resources.organizations.find((item) => item.id === organization.id).status = 'offline' })
  assert.equal((await app.inject({ url, headers })).statusCode, 404)
})

test('组织成员名单超过百人仍可完整分页，撤销父授权后管理员标记立即消失', async (t) => {
  const { app, accounts, rootHeaders, login } = await fixture(t)
  const organization = await createAndPublishOrganization(app, rootHeaders, '大型分会')
  const headers = { authorization: `Bearer ${(await login('reader')).accessToken}` }
  const grant = await grantOrganization(app, rootHeaders, organization.id, accounts.manager.id)
  await app.services.database.transaction((state) => {
    for (let i = 0; i < 105; i++) {
      const id = `roster-${String(i).padStart(3, '0')}`
      state.accounts.push({ id, name: `校友${i}`, department: '测试学院', status: 'active', schoolIdentityVerified: true })
      state.business.submissions.push({ id: `membership-${id}`, type: 'organization-membership', resourceId: organization.id, accountId: id, status: 'approved', createdAt: '2026-01-01' })
    }
    state.business.submissions.push({ id: 'manager-member', type: 'organization-membership', resourceId: organization.id, accountId: accounts.manager.id, status: 'approved', createdAt: '2026-01-02' })
    state.adminDelegations.push({ id: 'parent-grant', accountId: accounts.root.id, resource: 'organizations', resourceId: organization.id, status: 'revoked', permissions: ['read','update'] })
    state.adminDelegations.find((item) => item.id === grant.json().data.id).parentGrantIds = ['parent-grant']
  })
  const items = []
  for (let page = 1; page <= 9; page++) {
    const result = (await app.inject({ url: `/api/v1/business/organizations/${organization.id}/members?page=${page}&pageSize=12`, headers })).json().data
    assert.equal(result.total, 106)
    items.push(...result.items)
  }
  assert.equal(items.length, 106)
  assert.equal(new Set(items.map((item) => item.id)).size, 106)
  assert.equal(items.at(-1).role, 'member')
})

test('组织相册安全保存，实名留言直接发布、后台回复下架，禁止越权和私有材料泄漏', async (t) => {
  const { app, accounts, rootHeaders, login } = await fixture(t)
  const organization = await createAndPublishOrganization(app, rootHeaders, '留言分会', {
    coverUrl: 'https://example.com/cover.jpg', photoAlbumContent: '![相聚](https://example.com/photo.jpg)'
  })
  const other = await createAndPublishOrganization(app, rootHeaders, '其他留言分会')
  const memberHeaders = { authorization: `Bearer ${(await login('member')).accessToken}` }
  const readerHeaders = { authorization: `Bearer ${(await login('reader')).accessToken}` }
  const managerHeaders = { authorization: `Bearer ${(await login('manager')).accessToken}` }
  await grantOrganization(app, rootHeaders, organization.id, accounts.manager.id)
  const url = `/api/v1/business/organizations/${organization.id}/messages`
  const home = (await app.inject({ url: `/api/v1/business/organizations/${organization.id}/home` })).json().data
  assert.equal(home.organization.coverUrl, 'https://example.com/cover.jpg')
  assert.match(home.organization.photoAlbumContent, /相聚/)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/admin/business/organizations/${organization.id}`, headers: rootHeaders, payload: { photoAlbumContent: '![私有](javascript:alert)' } })).statusCode, 400)
  assert.equal((await app.inject({ url })).statusCode, 401)
  const posted = await app.inject({ method: 'POST', url, headers: memberHeaders, payload: { content: '好想回学校，与大家再相聚。', authorName: '伪造作者', status: 'approved', adminReply: '伪造回复', accountId: accounts.root.id } })
  assert.equal(posted.statusCode, 201)
  const id = posted.json().data.id
  assert.equal(posted.json().data.status, 'published')
  assert.deepEqual(posted.json().data.payload, { content: '好想回学校，与大家再相聚。' })
  assert.equal((await app.inject({ url, headers: memberHeaders })).json().data.items[0].authorName, accounts.member.name)
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 1)
  assert.equal((await app.inject({ method: 'POST', url, headers: memberHeaders, payload: { content: '字'.repeat(501) } })).statusCode, 400)
  const foreign = await app.inject({ method: 'POST', url: `/api/v1/business/organizations/${other.id}/messages`, headers: readerHeaders, payload: { content: '跨组织留言' } })
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/admin/business/applications/${foreign.json().data.id}/actions`, headers: managerHeaders, payload: { action: 'unpublish', reason: '跨组织无权下架' } })).statusCode, 403)
  const edited = await app.inject({ method: 'PATCH', url: `/api/v1/admin/business/applications/${id}`, headers: managerHeaders, payload: { adminReply: '欢迎回母校！', adminNote: 'PRIVATE-REVIEW-NOTE' } })
  assert.equal(edited.statusCode, 200)
  const result = await app.inject({ url, headers: readerHeaders })
  assert.equal(result.json().data.total, 1)
  assert.equal(result.json().data.items[0].reply, '欢迎回母校！')
  assert.doesNotMatch(result.body, /PRIVATE-|accountId|actorSnapshot|adminNote|username|伪造/)
  const actionUrl = `/api/v1/admin/business/applications/${id}/actions`
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: memberHeaders, payload: { action: 'unpublish', reason: '普通用户无权下架' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: managerHeaders, payload: { action: 'unpublish' } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: managerHeaders, payload: { action: 'unpublish', reason: '留言需要修正' } })).statusCode, 200)
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 0)
  assert.equal((await app.inject({ url, headers: memberHeaders })).json().data.total, 0)
  const notifications = app.services.database.read((state) => state.business.notifications)
  assert.ok(notifications.some((item) => item.accountId === accounts.member.id && item.type === 'submission.published' && !item.body.includes('处理流程')))
  assert.ok(notifications.some((item) => item.accountId === accounts.member.id && item.type === 'submission.unpublish' && item.body.includes('留言需要修正')))
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: managerHeaders, payload: { action: 'publish' } })).statusCode, 200)
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 1)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/business/me/submissions/${id}/cancel`, headers: readerHeaders })).statusCode, 404)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/business/me/submissions/${id}/cancel`, headers: memberHeaders })).statusCode, 200)
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 0)
  await app.services.database.transaction((state) => { state.business.resources.organizations.find((item) => item.id === organization.id).status = 'offline' })
  assert.equal((await app.inject({ url, headers: memberHeaders })).statusCode, 404)
})

test('独立联系页只向有效实名用户提供组织公开联系方式', async (t) => {
  const { app, accounts, rootHeaders, login } = await fixture(t)
  const org = await createAndPublishOrganization(app, rootHeaders, '联系页验收')
  const url = `/api/v1/business/organizations/${org.id}/contact`
  assert.equal((await app.inject({ url })).statusCode, 401)
  const home = await app.inject({ url: `/api/v1/business/organizations/${org.id}/home` })
  assert.doesNotMatch(home.body, /13800000000/)
  const headers = { authorization: `Bearer ${(await login('member')).accessToken}` }
  const response = await app.inject({ url, headers })
  assert.equal(response.headers['cache-control'], 'private, no-store')
  assert.deepEqual(response.json().data, { contactName: '内部联系人', contactMethod: '13800000000', city: '长沙市' })
  await app.services.database.transaction((state) => { state.accounts.find((item) => item.id === accounts.member.id).schoolIdentityVerified = false })
  assert.equal((await app.inject({ url, headers })).statusCode, 403)
})

test('湖财圈评论直接发布、后台下架回复、本人撤回及计数权限闭环', async (t) => {
  const { app, accounts, rootHeaders, login } = await fixture(t)
  const memberHeaders = { authorization: `Bearer ${(await login('member')).accessToken}` }
  const readerHeaders = { authorization: `Bearer ${(await login('reader')).accessToken}` }
  const postResult = await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: memberHeaders, payload: { content: '期待与大家重逢，分享校园回忆。', topic: '校园记忆' } })
  assert.equal(postResult.statusCode, 201)
  const post = postResult.json().data
  assert.equal(post.status, 'published')
  const url = `/api/v1/business/community-posts/${post.id}/comments`
  assert.equal((await app.inject({ url })).statusCode, 401)
  assert.equal((await app.inject({ method: 'POST', url, headers: memberHeaders, payload: { content: ' ' } })).statusCode, 400)
  const submitted = await app.inject({ method: 'POST', url, headers: memberHeaders, payload: { content: '欢迎大家！', authorName: '伪造', status: 'approved' } })
  assert.equal(submitted.statusCode, 201)
  const id = submitted.json().data.id
  assert.equal(submitted.json().data.status, 'published')
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 1)
  assert.equal((await app.inject({ url, headers: memberHeaders })).json().data.items[0].authorName, accounts.member.name)
  const adminList = await app.inject({ url: '/api/v1/admin/business/applications?submissionType=community-comment', headers: rootHeaders })
  assert.ok(adminList.json().data.items.some((item) => item.id === id))
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/admin/business/applications/${id}`, headers: rootHeaders, payload: { adminReply: '欢迎参与！', adminNote: 'PRIVATE-NOTE' } })).statusCode, 200)
  const published = await app.inject({ url, headers: readerHeaders })
  assert.equal(published.json().data.items[0].reply, '欢迎参与！')
  assert.doesNotMatch(published.body, /PRIVATE-|actorSnapshot|accountId|伪造/)
  assert.equal((await app.inject({ url: `/api/v1/business/community-posts/${post.id}`, headers: readerHeaders })).json().data.commentCount, 1)
  const actionUrl = `/api/v1/admin/business/applications/${id}/actions`
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: rootHeaders, payload: { action: 'unpublish', reason: '不当评论' } })).statusCode, 200)
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 0)
  assert.equal((await app.inject({ url: `/api/v1/business/community-posts/${post.id}`, headers: readerHeaders })).json().data.commentCount, 0)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: rootHeaders, payload: { action: 'complete' } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: rootHeaders, payload: { action: 'publish' } })).statusCode, 200)
  await app.services.database.transaction((state) => { state.business.submissions.find((item) => item.id === id).status = 'completed' })
  assert.equal((await app.inject({ url: `/api/v1/business/community-posts/${post.id}`, headers: readerHeaders })).json().data.commentCount, 1)
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 1)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: rootHeaders, payload: { action: 'unpublish', reason: '历史完成状态也可下架' } })).statusCode, 200)
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 0)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: rootHeaders, payload: { action: 'publish' } })).statusCode, 200)
  await app.services.database.transaction((state) => { state.accounts.find((item) => item.id === accounts.member.id).schoolIdentityVerified = false })
  assert.equal((await app.inject({ url: `/api/v1/business/community-posts/${post.id}`, headers: readerHeaders })).json().data.commentCount, 0)
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 0)
  await app.services.database.transaction((state) => { state.accounts.find((item) => item.id === accounts.member.id).schoolIdentityVerified = true; state.business.submissions.find((item) => item.id === id).status = 'approved' })
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/business/me/submissions/${id}/cancel`, headers: readerHeaders })).statusCode, 404)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/business/me/submissions/${id}/cancel`, headers: memberHeaders })).statusCode, 200)
  assert.equal((await app.inject({ url, headers: readerHeaders })).json().data.total, 0)
})

test('免审不绕过实名、审核申请、举报流程或管理权限', async (t) => {
  const { app, accounts, rootHeaders, login } = await fixture(t)
  const org = await createAndPublishOrganization(app, rootHeaders, '免审权限验收')
  const memberHeaders = { authorization: `Bearer ${(await login('member')).accessToken}` }
  const managerHeaders = { authorization: `Bearer ${(await login('manager')).accessToken}` }
  const grant = await grantOrganization(app, rootHeaders, org.id, accounts.manager.id, ['read', 'update'])
  assert.equal(grant.statusCode, 201)
  const payload = { content: '实名发言仍需要当前有效的实名账号。', topic: '校园记忆' }
  const post = (await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: memberHeaders, payload })).json().data
  const messageUrl = `/api/v1/business/organizations/${org.id}/messages`
  const message = (await app.inject({ method: 'POST', url: messageUrl, headers: memberHeaders, payload: { content: '组织中的正常发言' } })).json().data
  assert.equal(message.status, 'published')
  const actionUrl = `/api/v1/admin/business/applications/${message.id}/actions`
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: managerHeaders, payload: { action: 'unpublish', reason: '只有编辑权不能下架' } })).statusCode, 403)
  for (const [type, resourceId, expectedStatus] of [['organization-membership', org.id, 'submitted'], ['community-report', post.id, 'pending_review']]) {
    const result = await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: memberHeaders, payload: { type, resourceId, payload: { content: '仍需管理员处理' } } })
    assert.equal(result.statusCode, 201)
    assert.equal(result.json().data.status, expectedStatus)
    const resource = type === 'community-report' ? 'feedback' : 'applications'
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/admin/business/${resource}/${result.json().data.id}/actions`, headers: rootHeaders, payload: { action: 'publish' } })).statusCode, 400)
  }
  await app.services.database.transaction((state) => { state.accounts.find((item) => item.id === accounts.member.id).schoolIdentityVerified = false })
  for (const url of ['/api/v1/business/community-posts', messageUrl, `/api/v1/business/community-posts/${post.id}/comments`]) {
    assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 401)
    assert.equal((await app.inject({ method: 'POST', url, headers: memberHeaders, payload })).statusCode, 403)
  }
  await assert.rejects(app.services.business.createCommunityPost(accounts.member, payload), { code: 'SCHOOL_IDENTITY_REQUIRED' })
  await assert.rejects(app.services.business.createSubmission(accounts.member, { type: 'organization-message', resourceId: org.id, payload: { content: '旧身份快照不能绕过校验' } }), { code: 'SCHOOL_IDENTITY_REQUIRED' })
})

test('历史办理中发言可处理，历史下架驳回撤回记录不自动公开', async (t) => {
  const { app, accounts, rootHeaders, login } = await fixture(t)
  const org = await createAndPublishOrganization(app, rootHeaders, '历史发言兼容')
  const headers = { authorization: `Bearer ${(await login('reader')).accessToken}` }
  await app.services.database.transaction((state) => {
    for (const [id, status] of [['processing-approve', 'processing'], ['processing-reject', 'processing'], ['legacy-offline', 'offline'], ['legacy-rejected', 'rejected'], ['legacy-cancelled', 'cancelled']]) {
      state.business.submissions.push({ id, type: 'organization-message', accountId: accounts.member.id, resourceId: org.id, resourceType: 'organizations', status, payload: { content: '历史留言保持原状态' }, revision: 1, createdAt: '2026-01-01' })
    }
  })
  const url = `/api/v1/business/organizations/${org.id}/messages`
  assert.equal((await app.inject({ url, headers })).json().data.total, 0)
  for (const [id, action] of [['processing-approve', 'approve'], ['processing-reject', 'reject']]) {
    const result = await app.inject({ method: 'POST', url: `/api/v1/admin/business/applications/${id}/actions`, headers: rootHeaders, payload: { action, reason: '处理历史内容', expectedRevision: 1 } })
    assert.equal(result.statusCode, 200, result.body)
  }
  assert.equal((await app.inject({ url, headers })).json().data.total, 1)
  const states = app.services.database.read((state) => state.business.submissions.filter((item) => item.id.startsWith('legacy-')).map((item) => item.status))
  assert.deepEqual(states, ['offline', 'rejected', 'cancelled'])
})

test('组织类型别名不读取对象原型，历史自定义类型保持文本', () => {
  for (const type of ['constructor', '__proto__', 'toString', '其他校友组织']) {
    const payload = normalizeAdminPayload('organizations', { name: '自定义组织', type })
    assert.equal(payload.type, type)
    assert.equal(JSON.parse(JSON.stringify(payload)).type, type)
  }
})

function contentStub() {
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  return {
    init: async () => {},
    startScheduler() {},
    stopScheduler() {},
    status: () => status,
    home: () => ({ status, sections: {} }),
    list: () => ({ items: [], total: 0, page: 1, pageSize: 12, status }),
    get: async () => null,
    refresh: async () => status
  }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-organization-home-test-'))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    dataHashSecret: 'organization-home-flow-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const app = await buildApp({
    config,
    logger: false,
    refreshContent: false,
    scheduleContent: false,
    contentService: contentStub()
  })
  t.after(async () => {
    await app.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const users = [
    ['root', '平台超级管理员', true],
    ['manager', '组织一管理员', false],
    ['reader', '组织只读管理员', false],
    ['member', '普通校友', false],
    ['pending', '待审核校友', false]
  ]
  const accounts = {}
  for (const [username, name, isAdmin] of users) {
    accounts[username] = await app.services.accounts.register({
      schoolSubject: `organization-home-${username}`,
      name,
      personType: isAdmin ? 'staff' : 'alumni',
      department: isAdmin ? '信息中心' : '财政金融学院',
      verificationSource: 'school-registration-check',
      schoolIdentityVerified: true,
      isAdmin
    }, {
      username,
      password: `Strong-${username}-2026!`
    })
  }

  const login = async (username) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: `Strong-${username}-2026!` }
    })
    assert.equal(response.statusCode, 200)
    return response.json().data
  }
  const root = await login('root')
  return {
    app,
    accounts,
    login,
    rootHeaders: { authorization: `Bearer ${root.accessToken}` }
  }
}

async function createAndPublishOrganization(app, headers, name, extra = {}) {
  const createdResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/organizations',
    headers,
    payload: {
      name,
      type: '学院分会',
      city: '长沙',
      summary: `${name}公开主页`,
      contactName: '内部联系人',
      contactPhone: '13800000000',
      ...extra
    }
  })
  assert.equal(createdResponse.statusCode, 201)
  const organization = createdResponse.json().data
  const published = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/organizations/${organization.id}/actions`,
    headers,
    payload: { action: 'publish' }
  })
  assert.equal(published.statusCode, 200)
  return published.json().data
}

async function grantOrganization(app, headers, organizationId, accountId, permissions) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/organizations/${organizationId}/managers`,
    headers,
    payload: {
      accountId,
      ...(permissions === undefined ? {} : { permissions })
    }
  })
}

function activityPayload(title) {
  return {
    title,
    category: '校友活动',
    organizer: '财政金融学院分会',
    city: '长沙',
    venue: '厚生楼',
    startAt: futureIso(20),
    endAt: futureIso(21),
    registrationDeadline: futureIso(19),
    quota: 80,
    summary: '组织活动摘要',
    description: '组织管理员在前台发布的活动。'
  }
}

function announcementPayload(title) {
  return {
    title,
    category: '组织通知',
    audience: 'all',
    priority: 'normal',
    startAt: pastIso(),
    endAt: futureIso(10),
    targetType: 'none',
    summary: '组织通知摘要',
    content: '组织管理员在前台发布的通知正文。'
  }
}

test('同级同班同专业同兴趣组织可发布、筛选、编辑并在主页展示资料', async (t) => {
  const { app, rootHeaders } = await fixture(t)
  for (const type of ['同年级校友', '同班校友', '同专业校友', '同兴趣校友']) {
    const profile = { grade: '2022级', college: '信息技术与管理学院', major: '计算机科学与技术', className: '计算机1班', interestTags: ['摄影', '篮球'] }
    const organization = await createAndPublishOrganization(app, rootHeaders, `${type}联络站`, { type, ...profile })
    for (const prefix of ['/api/v1/business', '/api/v1/admin/business']) {
      const response = await app.inject({ method: 'GET', url: `${prefix}/organizations?type=${encodeURIComponent(type)}&query=${encodeURIComponent('摄影')}`, headers: rootHeaders })
      assert.equal(response.statusCode, 200)
      assert.deepEqual(response.json().data.items.map((item) => item.id), [organization.id])
    }
    const home = await app.inject({ method: 'GET', url: `/api/v1/business/organizations/${organization.id}/home` })
    assert.equal(home.statusCode, 200)
    for (const [field, value] of Object.entries(profile)) assert.deepEqual(home.json().data.organization[field], value)
    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/admin/business/organizations/${organization.id}`, headers: rootHeaders, payload: { grade: '2023级', expectedRevision: organization.revision } })
    assert.equal(patch.statusCode, 200)
    assert.equal(patch.json().data.grade, '2023级')
    const invalid = await app.inject({ method: 'PATCH', url: `/api/v1/admin/business/organizations/${organization.id}`, headers: rootHeaders, payload: { interestTags: ['字'.repeat(31)] } })
    assert.equal(invalid.statusCode, 400)
  }
})

test('历史组织分类在前后台及别名查询中一致，读取不会改写旧记录', async (t) => {
  const { app, rootHeaders } = await fixture(t)
  for (const [legacy, current] of [['学院分会', '学院组织'], ['兴趣组织', '同兴趣校友'], ['interest', '同兴趣校友'], ['cohort', '同年级校友']]) {
    const organization = await createAndPublishOrganization(app, rootHeaders, `旧分类-${legacy}`, { type: legacy })
    assert.equal(organization.type, current)
    await app.services.database.transaction((data) => {
      data.business.resources.organizations.find((item) => item.id === organization.id).type = legacy
    })
    for (const prefix of ['/api/v1/business', '/api/v1/admin/business']) {
      for (const value of [legacy, current]) {
        const response = await app.inject({ method: 'GET', url: `${prefix}/organizations?type=${encodeURIComponent(value)}`, headers: rootHeaders })
        assert.equal(response.statusCode, 200)
        const item = response.json().data.items.find((entry) => entry.id === organization.id)
        assert.equal(item.type, current)
      }
    }
    assert.equal(app.services.database.read((data) => data.business.resources.organizations.find((item) => item.id === organization.id).type), legacy)
  }
})

test('公开组织主页聚合公开事项，登录管理人可查看范围并原子发布活动和通知', async (t) => {
  const { app, accounts, login, rootHeaders } = await fixture(t)
  const organization = await createAndPublishOrganization(app, rootHeaders, '财政金融学院分会')

  const draft = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/activities',
    headers: rootHeaders,
    payload: { ...activityPayload('尚未发布的组织活动'), organizationId: organization.id }
  })
  assert.equal(draft.statusCode, 201)
  assert.equal(draft.json().data.status, 'draft')

  const grant = await grantOrganization(
    app,
    rootHeaders,
    organization.id,
    accounts.manager.id
  )
  assert.equal(grant.statusCode, 201)
  assert.deepEqual(grant.json().data.permissions, ['read', 'update', 'moderate', 'manage_members'])

  const manager = await login('manager')
  const managerHeaders = { authorization: `Bearer ${manager.accessToken}` }

  const anonymousHome = await app.inject({
    method: 'GET',
    url: `/api/v1/business/organizations/${organization.id}/home`
  })
  assert.equal(anonymousHome.statusCode, 200)
  assert.equal(anonymousHome.json().data.organization.id, organization.id)
  assert.equal(anonymousHome.json().data.organization.contactPhone, undefined)
  assert.equal(anonymousHome.json().data.capabilities, undefined)
  assert.equal(anonymousHome.json().data.activities.length, 0)

  const managedList = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/managed-organizations',
    headers: managerHeaders
  })
  assert.equal(managedList.statusCode, 200)
  assert.equal(managedList.json().data.total, 1)
  assert.equal(managedList.json().data.items[0].id, organization.id)
  assert.equal(managedList.json().data.items[0].capabilities.update, true)
  assert.equal(managedList.json().data.items[0].capabilities.moderate, true)
  assert.equal(managedList.json().data.items[0].capabilities.publish, true)

  const managedDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/me/managed-organizations/${organization.id}`,
    headers: managerHeaders
  })
  assert.equal(managedDetail.statusCode, 200)
  assert.equal(managedDetail.json().data.activities.length, 1)
  assert.equal(managedDetail.json().data.activities[0].status, 'draft')

  const publishedActivity = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organization.id}/activities`,
    headers: managerHeaders,
    payload: { ...activityPayload('组织管理员发布的活动'), organizer: '客户端伪造主办方' }
  })
  assert.equal(publishedActivity.statusCode, 201)
  assert.equal(publishedActivity.json().data.status, 'published')
  assert.equal(publishedActivity.json().data.organizationId, organization.id)
  assert.equal(publishedActivity.json().data.organizer, organization.name)

  const publishedAnnouncement = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organization.id}/announcements`,
    headers: managerHeaders,
    payload: announcementPayload('组织管理员发布的通知')
  })
  assert.equal(publishedAnnouncement.statusCode, 201)
  assert.equal(publishedAnnouncement.json().data.status, 'published')
  assert.equal(publishedAnnouncement.json().data.organizationId, organization.id)

  const managerHome = await app.inject({
    method: 'GET',
    url: `/api/v1/business/organizations/${organization.id}/home`,
    headers: managerHeaders
  })
  const home = managerHome.json().data
  assert.equal(managerHome.statusCode, 200)
  assert.equal(home.capabilities.update, true)
  assert.equal(home.capabilities.moderate, true)
  assert.equal(home.capabilities.publish, true)
  assert.deepEqual(home.activities.map((item) => item.title), ['组织管理员发布的活动'])
  assert.deepEqual(home.announcements.map((item) => item.title), ['组织管理员发布的通知'])
  assert.deepEqual(home.activities[0].organization, {
    id: organization.id,
    name: organization.name,
    type: organization.type,
    city: organization.city
  })
  assert.equal(home.activities[0].createdBy, undefined)

  const audits = app.services.accounts.auditLogs()
    .filter((item) => item.action === 'business.organization_content_published')
  assert.equal(audits.length, 2)
  assert.equal(audits.every((item) => item.actor === accounts.manager.id), true)
  assert.deepEqual(
    [...new Set(audits.map((item) => item.details.resource))].sort(),
    ['activities', 'announcements']
  )
  assert.equal(audits.every((item) => item.details.organizationId === organization.id), true)
})

test('组织事项发布严格限制为精确 active 组织授权且同时需要 update 和 moderate', async (t) => {
  const { app, accounts, login, rootHeaders } = await fixture(t)
  const organizationOne = await createAndPublishOrganization(app, rootHeaders, '财政金融学院分会')
  const organizationTwo = await createAndPublishOrganization(app, rootHeaders, '工商管理学院分会')

  const managerGrant = await grantOrganization(
    app,
    rootHeaders,
    organizationOne.id,
    accounts.manager.id,
    ['read', 'update', 'moderate']
  )
  assert.equal(managerGrant.statusCode, 201)
  const readerGrant = await grantOrganization(
    app,
    rootHeaders,
    organizationOne.id,
    accounts.reader.id,
    ['read', 'update']
  )
  assert.equal(readerGrant.statusCode, 201)

  const manager = await login('manager')
  const reader = await login('reader')
  const member = await login('member')
  const managerHeaders = { authorization: `Bearer ${manager.accessToken}` }
  const readerHeaders = { authorization: `Bearer ${reader.accessToken}` }
  const memberHeaders = { authorization: `Bearer ${member.accessToken}` }

  const crossOrganization = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationTwo.id}/activities`,
    headers: managerHeaders,
    payload: activityPayload('越权发布')
  })
  assert.equal(crossOrganization.statusCode, 403)
  assert.equal(crossOrganization.json().code, 'ORGANIZATION_SCOPE_REQUIRED')

  const missingModerate = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/announcements`,
    headers: readerHeaders,
    payload: announcementPayload('缺少发布权限')
  })
  assert.equal(missingModerate.statusCode, 403)
  assert.equal(missingModerate.json().code, 'ORGANIZATION_SCOPE_REQUIRED')

  const ordinaryList = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/managed-organizations',
    headers: memberHeaders
  })
  assert.equal(ordinaryList.statusCode, 200)
  assert.equal(ordinaryList.json().data.total, 0)
  const ordinaryDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}`,
    headers: memberHeaders
  })
  assert.equal(ordinaryDetail.statusCode, 403)

  const forcedOrganization = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/activities`,
    headers: managerHeaders,
    payload: { ...activityPayload('服务端强制组织归属'), organizationId: organizationTwo.id }
  })
  assert.equal(forcedOrganization.statusCode, 201)
  assert.equal(forcedOrganization.json().data.organizationId, organizationOne.id)
  assert.equal(forcedOrganization.json().data.organizer, organizationOne.name)

  const revoked = await app.inject({
    method: 'DELETE',
    url: `/api/v1/admin/delegations/${managerGrant.json().data.id}`,
    headers: rootHeaders,
    payload: { reason: '撤销组织运营授权' }
  })
  assert.equal(revoked.statusCode, 200)
  const afterRevoke = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/activities`,
    headers: managerHeaders,
    payload: activityPayload('撤权后发布')
  })
  assert.equal(afterRevoke.statusCode, 403)
  assert.equal(afterRevoke.json().code, 'ORGANIZATION_SCOPE_REQUIRED')

  const activity = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/activities',
    headers: rootHeaders,
    payload: activityPayload('普通活动记录')
  })
  assert.equal(activity.statusCode, 201)
  const invalidRecordCreateGrant = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/delegations',
    headers: rootHeaders,
    payload: {
      accountId: accounts.member.id,
      resource: 'activities',
      resourceId: activity.json().data.id,
      permissions: ['read', 'create']
    }
  })
  assert.equal(invalidRecordCreateGrant.statusCode, 400)
  assert.equal(invalidRecordCreateGrant.json().code, 'DELEGATION_PERMISSION_INVALID')

  const organizationTwoActivity = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationTwo.id}/activities`,
    headers: rootHeaders,
    payload: activityPayload('下架组织的活动')
  })
  assert.equal(organizationTwoActivity.statusCode, 201)
  const offline = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/organizations/${organizationTwo.id}/actions`,
    headers: rootHeaders,
    payload: { action: 'unpublish' }
  })
  assert.equal(offline.statusCode, 200)

  const organizationTwoHome = await app.inject({
    method: 'GET',
    url: `/api/v1/business/organizations/${organizationTwo.id}/home`
  })
  assert.equal(organizationTwoHome.statusCode, 404)
  const hiddenFromGlobalList = await app.inject({
    method: 'GET',
    url: '/api/v1/business/activities?page=1&pageSize=100'
  })
  assert.equal(
    hiddenFromGlobalList.json().data.items.some((item) => item.id === organizationTwoActivity.json().data.id),
    false
  )
  const hiddenFromGlobalDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/activities/${organizationTwoActivity.json().data.id}`
  })
  assert.equal(hiddenFromGlobalDetail.statusCode, 404)
  const publishWhileOffline = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationTwo.id}/activities`,
    headers: rootHeaders,
    payload: activityPayload('组织下架后禁止发布')
  })
  assert.equal(publishWhileOffline.statusCode, 409)
  assert.equal(publishWhileOffline.json().code, 'ORGANIZATION_NOT_PUBLISHED')
})

test('组织通知只进入正式成员的全局渠道，主页公开且成员与报名统计准确', async (t) => {
  const { app, accounts, login, rootHeaders } = await fixture(t)
  const organization = await createAndPublishOrganization(
    app,
    rootHeaders,
    '统计与通知分会',
    { memberCount: 5 }
  )
  const announcementResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organization.id}/announcements`,
    headers: rootHeaders,
    payload: announcementPayload('仅组织正式成员进入全局渠道的通知')
  })
  assert.equal(announcementResponse.statusCode, 201)
  const announcement = announcementResponse.json().data

  const anonymousHome = await app.inject({
    method: 'GET',
    url: `/api/v1/business/organizations/${organization.id}/home`
  })
  assert.equal(anonymousHome.statusCode, 200)
  assert.equal(
    anonymousHome.json().data.announcements.some((item) => item.id === announcement.id),
    true
  )

  const member = await login('member')
  const pending = await login('pending')
  const memberHeaders = { authorization: `Bearer ${member.accessToken}` }
  const pendingHeaders = { authorization: `Bearer ${pending.accessToken}` }
  const announcementIsVisible = async (headers) => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/business/announcements?page=1&pageSize=100',
      headers
    })
    const bootstrap = await app.inject({
      method: 'GET',
      url: '/api/v1/business/bootstrap',
      headers
    })
    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/business/me/inbox?page=1&pageSize=100',
      headers
    })
    return {
      list: list.json().data.items.some((item) => item.id === announcement.id),
      bootstrap: bootstrap.json().data.announcements.some((item) => item.id === announcement.id),
      inbox: inbox.json().data.items.some((item) => item.resourceId === announcement.id)
    }
  }
  assert.deepEqual(await announcementIsVisible(memberHeaders), {
    list: false,
    bootstrap: false,
    inbox: false
  })

  const pendingMembership = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: pendingHeaders,
    payload: {
      type: 'organization-membership',
      resourceId: organization.id,
      payload: { note: '待审核申请不应获得组织通知' }
    }
  })
  assert.equal(pendingMembership.statusCode, 201)
  assert.deepEqual(await announcementIsVisible(pendingHeaders), {
    list: false,
    bootstrap: false,
    inbox: false
  })

  const membershipResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: memberHeaders,
    payload: {
      type: 'organization-membership',
      resourceId: organization.id,
      payload: { note: '申请加入组织' }
    }
  })
  assert.equal(membershipResponse.statusCode, 201)
  const approvedMembership = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${membershipResponse.json().data.id}/actions`,
    headers: rootHeaders,
    payload: { action: 'approve' }
  })
  assert.equal(approvedMembership.statusCode, 200)
  assert.equal(approvedMembership.json().data.status, 'approved')
  assert.deepEqual(await announcementIsVisible(memberHeaders), {
    list: true,
    bootstrap: true,
    inbox: true
  })

  const timestamp = new Date().toISOString()
  await app.services.database.transaction((databaseState) => {
    const statuses = ['active', 'joined', 'submitted', 'pending_review', 'processing', 'rejected', 'cancelled']
    for (const status of statuses) {
      databaseState.business.submissions.unshift({
        id: `organization-membership-${status}`,
        number: `TEST-${status}`,
        type: 'organization-membership',
        resourceType: 'organizations',
        resourceId: organization.id,
        accountId: `synthetic-${status}`,
        actorSnapshot: { name: `测试${status}` },
        payload: {},
        status,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        adminReply: '',
        adminNote: ''
      })
    }
    databaseState.business.revision += 1
  })

  const activityResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organization.id}/activities`,
    headers: rootHeaders,
    payload: activityPayload('用于核验报名统计的活动')
  })
  assert.equal(activityResponse.statusCode, 201)
  const registration = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: memberHeaders,
    payload: {
      type: 'event-registration',
      resourceId: activityResponse.json().data.id,
      payload: { note: '确认参加' }
    }
  })
  assert.equal(registration.statusCode, 201)

  const memberHome = await app.inject({
    method: 'GET',
    url: `/api/v1/business/organizations/${organization.id}/home`,
    headers: memberHeaders
  })
  assert.equal(memberHome.json().data.organization.memberCount, 8)
  assert.equal(memberHome.json().data.organization.members, 8)
  assert.equal(memberHome.json().data.organization.joined, true)
  assert.equal(
    memberHome.json().data.activities.find((item) => item.id === activityResponse.json().data.id)
      .registrationCount,
    1
  )

  const pendingHome = await app.inject({
    method: 'GET',
    url: `/api/v1/business/organizations/${organization.id}/home`,
    headers: pendingHeaders
  })
  assert.equal(pendingHome.json().data.organization.joined, false)
  assert.equal(pendingHome.json().data.organization.memberCount, 8)

  const managedDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/me/managed-organizations/${organization.id}`,
    headers: rootHeaders
  })
  assert.equal(managedDetail.statusCode, 200)
  assert.equal(managedDetail.json().data.organization.memberCount, 8)
  assert.equal(
    managedDetail.json().data.activities
      .find((item) => item.id === activityResponse.json().data.id)
      .registrationCount,
    1
  )
  assert.equal(managedDetail.json().data.activities.length <= 100, true)
  assert.equal(managedDetail.json().data.announcements.length <= 100, true)
})

test('默认组织授权可用但过期授权立即失效', async (t) => {
  const { app, accounts, login, rootHeaders } = await fixture(t)
  const organization = await createAndPublishOrganization(app, rootHeaders, '授权有效期分会')
  const grant = await grantOrganization(
    app,
    rootHeaders,
    organization.id,
    accounts.manager.id
  )
  assert.equal(grant.statusCode, 201)
  assert.deepEqual(
    grant.json().data.permissions,
    ['read', 'update', 'moderate', 'manage_members']
  )
  assert.equal(grant.json().data.permissions.includes('create'), false)

  const manager = await login('manager')
  const managerHeaders = { authorization: `Bearer ${manager.accessToken}` }
  const beforeExpiry = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organization.id}/activities`,
    headers: managerHeaders,
    payload: activityPayload('默认授权可发布')
  })
  assert.equal(beforeExpiry.statusCode, 201)

  await app.services.database.transaction((databaseState) => {
    const storedGrant = databaseState.adminDelegations
      .find((item) => item.id === grant.json().data.id)
    storedGrant.expiresAt = '2020-01-01T00:00:00.000Z'
  })

  const managedList = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/managed-organizations',
    headers: managerHeaders
  })
  assert.equal(managedList.statusCode, 200)
  assert.equal(managedList.json().data.total, 0)

  const managedDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/me/managed-organizations/${organization.id}`,
    headers: managerHeaders
  })
  assert.equal(managedDetail.statusCode, 403)
  assert.equal(managedDetail.json().code, 'ORGANIZATION_SCOPE_REQUIRED')

  const afterExpiry = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organization.id}/announcements`,
    headers: managerHeaders,
    payload: announcementPayload('过期授权不可发布')
  })
  assert.equal(afterExpiry.statusCode, 403)
  assert.equal(afterExpiry.json().code, 'ORGANIZATION_SCOPE_REQUIRED')
})

test('组织管理员可编辑和执行状态动作，跨组织与通用后台均不能绕过归属', async (t) => {
  const { app, accounts, login, rootHeaders } = await fixture(t)
  const organizationOne = await createAndPublishOrganization(app, rootHeaders, '编辑闭环一分会')
  const organizationTwo = await createAndPublishOrganization(app, rootHeaders, '编辑闭环二分会')
  const grant = await grantOrganization(
    app,
    rootHeaders,
    organizationOne.id,
    accounts.manager.id
  )
  assert.equal(grant.statusCode, 201)
  const moduleGrant = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/accounts/${accounts.manager.id}/permissions`,
    headers: rootHeaders,
    payload: { resources: ['activities', 'announcements'] }
  })
  assert.equal(moduleGrant.statusCode, 200)

  const manager = await login('manager')
  const managerHeaders = { authorization: `Bearer ${manager.accessToken}` }
  const activityResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/activities`,
    headers: managerHeaders,
    payload: activityPayload('待编辑组织活动')
  })
  assert.equal(activityResponse.statusCode, 201)
  const activity = activityResponse.json().data
  const announcementResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/announcements`,
    headers: managerHeaders,
    payload: announcementPayload('待编辑组织通知')
  })
  assert.equal(announcementResponse.statusCode, 201)
  const announcement = announcementResponse.json().data

  const editedActivity = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/activities/${activity.id}`,
    headers: managerHeaders,
    payload: {
      title: '已编辑组织活动',
      organizer: '客户端伪造主办方',
      organizationId: organizationOne.id,
      expectedRevision: activity.revision
    }
  })
  assert.equal(editedActivity.statusCode, 200)
  assert.equal(editedActivity.json().data.title, '已编辑组织活动')
  assert.equal(editedActivity.json().data.organizer, organizationOne.name)
  assert.equal(editedActivity.json().data.organizationId, organizationOne.id)
  assert.equal(editedActivity.json().data.revision, activity.revision + 1)

  const rebindViaManagedRoute = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/activities/${activity.id}`,
    headers: managerHeaders,
    payload: { organizationId: organizationTwo.id }
  })
  assert.equal(rebindViaManagedRoute.statusCode, 400)
  assert.equal(rebindViaManagedRoute.json().code, 'BUSINESS_PROTECTED_FIELD')

  const editedAnnouncement = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/announcements/${announcement.id}`,
    headers: managerHeaders,
    payload: { content: '组织通知正文已经更新。' }
  })
  assert.equal(editedAnnouncement.statusCode, 200)
  assert.equal(editedAnnouncement.json().data.content, '组织通知正文已经更新。')

  const wrongOrganizationAsSuperAdmin = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/me/managed-organizations/${organizationTwo.id}/activities/${activity.id}`,
    headers: rootHeaders,
    payload: { title: '不能通过错误组织路径编辑' }
  })
  assert.equal(wrongOrganizationAsSuperAdmin.statusCode, 404)
  assert.equal(wrongOrganizationAsSuperAdmin.json().code, 'BUSINESS_ITEM_NOT_FOUND')

  const wrongOrganizationAsManager = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationTwo.id}/activities/${activity.id}/actions`,
    headers: managerHeaders,
    payload: { action: 'unpublish' }
  })
  assert.equal(wrongOrganizationAsManager.statusCode, 403)
  assert.equal(wrongOrganizationAsManager.json().code, 'ORGANIZATION_SCOPE_REQUIRED')

  const genericActivity = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/activities',
    headers: managerHeaders,
    payload: {
      ...activityPayload('通用后台创建的关联活动'),
      organizationId: organizationOne.id,
      organizer: '伪造组织名称'
    }
  })
  assert.equal(genericActivity.statusCode, 201)
  assert.equal(genericActivity.json().data.organizer, organizationOne.name)
  assert.equal(genericActivity.json().data.status, 'draft')

  const genericAnnouncement = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/announcements',
    headers: managerHeaders,
    payload: {
      ...announcementPayload('通用后台创建的关联通知'),
      organizationId: organizationOne.id
    }
  })
  assert.equal(genericAnnouncement.statusCode, 201)
  assert.equal(genericAnnouncement.json().data.status, 'draft')

  const crossOrganizationGenericCreate = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/activities',
    headers: managerHeaders,
    payload: {
      ...activityPayload('通用后台跨组织创建'),
      organizationId: organizationTwo.id
    }
  })
  assert.equal(crossOrganizationGenericCreate.statusCode, 403)
  assert.equal(crossOrganizationGenericCreate.json().code, 'ADMIN_SCOPE_REQUIRED')

  const genericPublished = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/activities/${genericActivity.json().data.id}/actions`,
    headers: managerHeaders,
    payload: { action: 'publish' }
  })
  assert.equal(genericPublished.statusCode, 200)
  assert.equal(genericPublished.json().data.status, 'published')
  assert.equal(genericPublished.json().data.organizer, organizationOne.name)

  const genericAnnouncementPublished = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/announcements/${genericAnnouncement.json().data.id}/actions`,
    headers: managerHeaders,
    payload: { action: 'publish' }
  })
  assert.equal(genericAnnouncementPublished.statusCode, 200)
  assert.equal(genericAnnouncementPublished.json().data.status, 'published')

  const rootRebind = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/activities/${activity.id}`,
    headers: rootHeaders,
    payload: { organizationId: organizationTwo.id }
  })
  assert.equal(rootRebind.statusCode, 400)
  assert.equal(rootRebind.json().code, 'BUSINESS_PROTECTED_FIELD')

  const rootSpoofOrganizer = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/activities/${activity.id}`,
    headers: rootHeaders,
    payload: { organizer: '后台伪造组织名称' }
  })
  assert.equal(rootSpoofOrganizer.statusCode, 200)
  assert.equal(rootSpoofOrganizer.json().data.organizer, organizationOne.name)

  const renamedOrganization = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/organizations/${organizationOne.id}`,
    headers: rootHeaders,
    payload: { name: '编辑闭环一分会（新名称）' }
  })
  assert.equal(renamedOrganization.statusCode, 200)
  const activityAfterOrganizationRename = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/business/activities/${activity.id}`,
    headers: rootHeaders
  })
  assert.equal(activityAfterOrganizationRename.statusCode, 200)
  assert.equal(
    activityAfterOrganizationRename.json().data.organizer,
    renamedOrganization.json().data.name
  )

  const organizationTwoDraft = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/activities',
    headers: rootHeaders,
    payload: {
      ...activityPayload('二分会通用后台草稿'),
      organizationId: organizationTwo.id
    }
  })
  assert.equal(organizationTwoDraft.statusCode, 201)
  const crossOrganizationGenericAction = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/activities/${organizationTwoDraft.json().data.id}/actions`,
    headers: managerHeaders,
    payload: { action: 'publish' }
  })
  assert.equal(crossOrganizationGenericAction.statusCode, 403)
  assert.equal(crossOrganizationGenericAction.json().code, 'ADMIN_SCOPE_REQUIRED')

  for (const [resource, record] of [
    ['activities', rootSpoofOrganizer.json().data],
    ['announcements', editedAnnouncement.json().data]
  ]) {
    const unpublished = await app.inject({
      method: 'POST',
      url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/${resource}/${record.id}/actions`,
      headers: managerHeaders,
      payload: { action: 'unpublish' }
    })
    assert.equal(unpublished.statusCode, 200)
    assert.equal(unpublished.json().data.status, 'offline')
  }

  const homeAfterUnpublish = await app.inject({
    method: 'GET',
    url: `/api/v1/business/organizations/${organizationOne.id}/home`,
    headers: managerHeaders
  })
  assert.equal(
    homeAfterUnpublish.json().data.activities.some((item) => item.id === activity.id),
    false
  )
  assert.equal(
    homeAfterUnpublish.json().data.announcements.some((item) => item.id === announcement.id),
    false
  )
  const managedAfterUnpublish = await app.inject({
    method: 'GET',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}`,
    headers: managerHeaders
  })
  assert.equal(
    managedAfterUnpublish.json().data.activities.find((item) => item.id === activity.id).status,
    'offline'
  )
  assert.equal(
    managedAfterUnpublish.json().data.announcements.find((item) => item.id === announcement.id).status,
    'offline'
  )

  const republished = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/activities/${activity.id}/actions`,
    headers: managerHeaders,
    payload: { action: 'publish' }
  })
  assert.equal(republished.statusCode, 200)

  const organizationOffline = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/organizations/${organizationOne.id}/actions`,
    headers: rootHeaders,
    payload: { action: 'unpublish' }
  })
  assert.equal(organizationOffline.statusCode, 200)
  const managerListWhileOffline = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/managed-organizations?page=1&pageSize=100',
    headers: managerHeaders
  })
  assert.equal(
    managerListWhileOffline.json().data.items
      .find((item) => item.id === organizationOne.id)
      .capabilities.publish,
    false
  )

  const unpublishWhileOrganizationOffline = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/activities/${activity.id}/actions`,
    headers: managerHeaders,
    payload: { action: 'unpublish' }
  })
  assert.equal(unpublishWhileOrganizationOffline.statusCode, 200)
  const blockedRepublish = await app.inject({
    method: 'POST',
    url: `/api/v1/business/me/managed-organizations/${organizationOne.id}/activities/${activity.id}/actions`,
    headers: managerHeaders,
    payload: { action: 'publish' }
  })
  assert.equal(blockedRepublish.statusCode, 409)
  assert.equal(blockedRepublish.json().code, 'ORGANIZATION_NOT_PUBLISHED')

  const genericBlockedRepublish = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/announcements/${announcement.id}/actions`,
    headers: rootHeaders,
    payload: { action: 'publish' }
  })
  assert.equal(genericBlockedRepublish.statusCode, 409)
  assert.equal(genericBlockedRepublish.json().code, 'ORGANIZATION_NOT_PUBLISHED')

  const actionAudits = app.services.accounts.auditLogs()
    .filter((item) => item.action.startsWith('business.organization_content_'))
  assert.equal(
    actionAudits.some((item) => (
      item.actor === accounts.manager.id
      && item.details.organizationId === organizationOne.id
      && item.details.action === 'unpublish'
    )),
    true
  )
})
