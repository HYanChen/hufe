import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { developmentBusinessSeeds } from '../src/business/seeds.js'

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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-ecosystem-test-'))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    dataHashSecret: 'ecosystem-flow-secret',
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

  const register = (subject, username, name, options = {}) => app.services.accounts.register({
    schoolSubject: subject,
    name,
    personType: options.personType || 'alumni',
    department: options.department || '工商管理学院',
    verificationSource: 'school-registration-check',
    isAdmin: Boolean(options.isAdmin)
  }, { username, password: 'StrongPass!2026' })

  const admin = await register('ecosystem-admin', 'ecosystem_admin', '生态平台主管', { isAdmin: true, personType: 'staff' })
  const user = await register('ecosystem-user', 'ecosystem_user', '合作发布人')
  const other = await register('ecosystem-other', 'ecosystem_other', '其他实名用户')
  const unverified = await register('ecosystem-unverified', 'ecosystem_unverified', '未实名用户')
  await app.services.database.transaction((data) => {
    const account = data.accounts.find((item) => item.id === unverified.id)
    account.schoolIdentityVerified = false
    account.schoolIdentityVerifiedAt = null
  })

  const login = async (username) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: 'StrongPass!2026' }
    })
    assert.equal(response.statusCode, 200)
    return response.json().data.accessToken
  }

  return {
    app,
    accounts: { admin, user, other, unverified },
    tokens: {
      admin: await login('ecosystem_admin'),
      user: await login('ecosystem_user'),
      other: await login('ecosystem_other'),
      unverified: await login('ecosystem_unverified')
    }
  }
}

function auth(token) {
  return { authorization: `Bearer ${token}` }
}

test('三类校友生态资源支持后台通用管理和公开列表详情', async (t) => {
  const { app, tokens } = await fixture(t)
  const headers = auth(tokens.admin)

  const enterpriseResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/alumni-enterprises',
    headers,
    payload: {
      name: '湖财校友数科',
      industry: '数字科技',
      city: '长沙',
      foundedYear: 2021,
      logoUrl: '/api/v1/media/123e4567-e89b-42d3-a456-426614174000.png',
      website: 'https://example.com/enterprise',
      summary: '校友企业馆 **安全简介**。',
      description: '支持校友企业展示与资源连接。',
      tags: ['数字科技', '校友企业']
    }
  })
  assert.equal(enterpriseResponse.statusCode, 201)
  const enterprise = enterpriseResponse.json().data
  assert.equal(enterprise.status, 'draft')
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/business/alumni-enterprises' })).json().data.total, 0)

  const academyResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/alumni-academy',
    headers,
    payload: {
      title: '校友企业增长课',
      category: '创业成长',
      lecturer: '示例讲师',
      lecturerTitle: '校友企业负责人',
      coverUrl: 'https://example.com/academy-cover.png',
      videoUrl: 'https://example.com/course.mp4',
      duration: '45 分钟',
      summary: '从真实实践中总结增长方法。',
      content: '## 课程提纲\n\n- 市场定位\n- 组织建设',
      tags: ['创业', '增长']
    }
  })
  assert.equal(academyResponse.statusCode, 201)
  const academy = academyResponse.json().data

  for (const [resource, id] of [
    ['alumni-enterprises', enterprise.id],
    ['alumni-academy', academy.id]
  ]) {
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/business/${resource}/${id}/actions`,
      headers,
      payload: { action: 'publish' }
    })
    assert.equal(published.statusCode, 200)
    assert.equal(published.json().data.status, 'published')
    const detail = await app.inject({ method: 'GET', url: `/api/v1/business/${resource}/${id}` })
    assert.equal(detail.statusCode, 200)
  }

  const enterpriseList = await app.inject({
    method: 'GET',
    url: '/api/v1/business/alumni-enterprises?city=%E9%95%BF%E6%B2%99'
  })
  assert.equal(enterpriseList.statusCode, 200)
  assert.equal(enterpriseList.json().data.total, 1)
  assert.equal(enterpriseList.json().data.items[0].logoUrl.startsWith('/api/v1/media/'), true)
  assert.equal(enterpriseList.json().data.items[0].city, '长沙市')
  for (const city of ['长沙', '长沙市']) {
    const query = `?city=${encodeURIComponent(city)}`
    assert.equal((await app.inject({ url: '/api/v1/business/alumni-enterprises' + query })).json().data.total, 1)
    assert.equal((await app.inject({ url: '/api/v1/admin/business/alumni-enterprises' + query, headers })).json().data.total, 1)
  }
  assert.equal((await app.inject({ url: '/api/v1/business/alumni-enterprises?city=' + encodeURIComponent('长沙县') })).json().data.total, 0)
  // The canonical picker also finds legacy rows without changing their data.
  await app.services.database.transaction((data) => {
    data.business.resources['alumni-enterprises'].find((item) => item.id === enterprise.id).city = '长沙'
  })
  const legacyList = await app.inject({ url: '/api/v1/business/alumni-enterprises?city=' + encodeURIComponent('长沙市') })
  assert.equal(legacyList.json().data.total, 1)
  assert.equal(legacyList.json().data.items[0].city, '长沙')

  const adminUpdate = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/alumni-enterprises/${enterprise.id}`,
    headers,
    payload: {
      expectedRevision: 2,
      summary: '更新后的校友企业馆简介。'
    }
  })
  assert.equal(adminUpdate.statusCode, 200)
  assert.equal(adminUpdate.json().data.summary, '更新后的校友企业馆简介。')

  const unknownField = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/alumni-enterprises',
    headers,
    payload: {
      name: '未知字段企业',
      industry: '科技',
      city: '长沙',
      summary: '字段白名单测试。',
      isFeaturedByClient: true
    }
  })
  assert.equal(unknownField.statusCode, 400)
  assert.equal(unknownField.json().code, 'BUSINESS_FIELD_UNKNOWN')

  const unsafeMarkdown = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/alumni-academy',
    headers,
    payload: {
      title: '危险课程',
      category: '测试',
      lecturer: '测试讲师',
      summary: '<script>alert(1)</script>'
    }
  })
  assert.equal(unsafeMarkdown.statusCode, 400)
  assert.equal(unsafeMarkdown.json().code, 'BUSINESS_MARKDOWN_UNSAFE')

  const unsafeUrl = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/alumni-enterprises/${enterprise.id}`,
    headers,
    payload: { website: 'javascript:alert(1)' }
  })
  assert.equal(unsafeUrl.statusCode, 400)
  assert.equal(unsafeUrl.json().code, 'BUSINESS_URL_INVALID')

  const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/business/bootstrap' })
  assert.equal(bootstrap.json().data.alumniEnterprises.length, 1)
  assert.equal(bootstrap.json().data.alumniAcademy.length, 1)

  const delegationResources = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/delegation/resources',
    headers
  })
  const resourceKeys = delegationResources.json().data.items.map((item) => item.key)
  assert.equal(resourceKeys.includes('alumni-enterprises'), true)
  assert.equal(resourceKeys.includes('collaboration-opportunities'), true)
  assert.equal(resourceKeys.includes('alumni-academy'), true)

  const adminSummary = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/business/summary',
    headers
  })
  assert.equal(adminSummary.json().data.resources['alumni-enterprises'].public, 1)
  assert.equal(adminSummary.json().data.resources['alumni-academy'].public, 1)
})

test('实名用户合作信息进入待审核、本人记录和取消闭环，作者账号不公开', async (t) => {
  const { app, accounts, tokens } = await fixture(t)
  const userHeaders = auth(tokens.user)
  const adminHeaders = auth(tokens.admin)

  const statusForgery = await app.inject({
    method: 'POST',
    url: '/api/v1/business/collaboration-opportunities',
    headers: userHeaders,
    payload: {
      title: '伪造状态合作',
      category: '项目合作',
      summary: '不能由客户端发布。',
      status: 'published'
    }
  })
  assert.equal(statusForgery.statusCode, 400)
  assert.equal(statusForgery.json().code, 'BUSINESS_PROTECTED_FIELD')

  const ownerForgery = await app.inject({
    method: 'POST',
    url: '/api/v1/business/collaboration-opportunities',
    headers: userHeaders,
    payload: {
      title: '伪造作者合作',
      category: '项目合作',
      summary: '不能由客户端指定作者。',
      authorAccountId: accounts.other.id
    }
  })
  assert.equal(ownerForgery.statusCode, 400)
  assert.equal(ownerForgery.json().code, 'BUSINESS_PROTECTED_FIELD')

  const submittedResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/business/collaboration-opportunities',
    headers: userHeaders,
    payload: {
      title: '校企联合实践基地共建',
      category: '校企合作',
      city: '长沙',
      organization: '校友创新中心',
      deadline: '2026-12-31',
      cooperationMode: '联合共建',
      targetAudience: '学校及校友企业',
      budget: '面议',
      contactMethod: '请通过平台联系',
      summary: '征集校友企业共同建设实践基地。',
      description: '希望围绕 **实习实践** 与课程项目开展长期合作。',
      tags: ['校企合作', '实践基地']
    }
  })
  assert.equal(submittedResponse.statusCode, 201)
  const submitted = submittedResponse.json().data
  assert.equal(submitted.status, 'pending_review')
  assert.equal(submitted.authorAccountId, undefined)
  assert.equal(submitted.authorName, '合作发布人')

  const hidden = await app.inject({ method: 'GET', url: '/api/v1/business/collaboration-opportunities' })
  assert.equal(hidden.json().data.total, 0)

  const mine = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/collaboration-opportunities',
    headers: userHeaders
  })
  assert.equal(mine.statusCode, 200)
  assert.equal(mine.json().data.total, 1)
  assert.equal(mine.json().data.items[0].id, submitted.id)
  assert.equal(mine.json().data.items[0].authorAccountId, undefined)

  const otherCannotCancel = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/me/collaboration-opportunities/${submitted.id}/cancel`,
    headers: auth(tokens.other)
  })
  assert.equal(otherCannotCancel.statusCode, 404)
  assert.equal(otherCannotCancel.json().code, 'COLLABORATION_NOT_FOUND')

  const adminRecord = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/business/collaboration-opportunities/${submitted.id}`,
    headers: adminHeaders
  })
  assert.equal(adminRecord.statusCode, 200)
  assert.equal(adminRecord.json().data.authorAccountId, accounts.user.id)

  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/collaboration-opportunities/${submitted.id}/actions`,
    headers: adminHeaders,
    payload: { action: 'approve' }
  })
  assert.equal(approved.statusCode, 200)
  assert.equal(approved.json().data.status, 'published')

  const publicDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/collaboration-opportunities/${submitted.id}`
  })
  assert.equal(publicDetail.statusCode, 200)
  assert.equal(publicDetail.json().data.authorAccountId, undefined)
  assert.equal(publicDetail.json().data.authorName, '合作发布人')

  const publishedCannotCancel = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/me/collaboration-opportunities/${submitted.id}/cancel`,
    headers: userHeaders
  })
  assert.equal(publishedCannotCancel.statusCode, 409)
  assert.equal(publishedCannotCancel.json().code, 'COLLABORATION_CANNOT_CANCEL')

  const second = (await app.inject({
    method: 'POST',
    url: '/api/v1/business/collaboration-opportunities',
    headers: userHeaders,
    payload: {
      title: '待取消的资源对接',
      category: '资源对接',
      summary: '用于验证本人取消闭环。'
    }
  })).json().data
  const cancelled = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/me/collaboration-opportunities/${second.id}/cancel`,
    headers: userHeaders
  })
  assert.equal(cancelled.statusCode, 200)
  assert.equal(cancelled.json().data.status, 'cancelled')
  assert.equal(cancelled.json().data.authorAccountId, undefined)

  const summary = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/summary',
    headers: userHeaders
  })
  assert.equal(summary.json().data.collaborations, 1)
  assert.equal(summary.json().data.pending, 0)

  const unverifiedDenied = await app.inject({
    method: 'POST',
    url: '/api/v1/business/collaboration-opportunities',
    headers: auth(tokens.unverified),
    payload: {
      title: '非实名发布',
      category: '测试',
      summary: '非实名账号不得发布。'
    }
  })
  assert.equal(unverifiedDenied.statusCode, 403)
  assert.equal(unverifiedDenied.json().code, 'SCHOOL_IDENTITY_REQUIRED')

  const auditActions = app.services.accounts.auditLogs().map((item) => item.action)
  assert.equal(auditActions.includes('business.collaboration_submitted'), true)
  assert.equal(auditActions.includes('business.collaboration_cancelled'), true)
  assert.equal(auditActions.includes('business.admin_approve'), true)
})

test('已过截止日期的合作信息保留后台记录但不再公开展示', async (t) => {
  const { app, tokens } = await fixture(t)
  const headers = auth(tokens.admin)
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/collaboration-opportunities',
    headers,
    payload: {
      title: '已到期合作机会',
      category: '资源对接',
      organization: '生态圈测试组织',
      deadline: '2000-01-01',
      summary: '该记录用于验证截止日期后的公开隐藏逻辑。'
    }
  })
  assert.equal(created.statusCode, 201)
  const id = created.json().data.id
  const published = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/collaboration-opportunities/${id}/actions`,
    headers,
    payload: { action: 'publish' }
  })
  assert.equal(published.statusCode, 200)
  assert.equal(published.json().data.status, 'published')

  const publicList = await app.inject({
    method: 'GET',
    url: '/api/v1/business/collaboration-opportunities'
  })
  assert.equal(publicList.statusCode, 200)
  assert.equal(publicList.json().data.items.some((item) => item.id === id), false)
  const publicDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/collaboration-opportunities/${id}`
  })
  assert.equal(publicDetail.statusCode, 404)

  const adminDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/business/collaboration-opportunities/${id}`,
    headers
  })
  assert.equal(adminDetail.statusCode, 200)
})

test('城市统计只聚合公开名录城市，不返回个人资料', async (t) => {
  const { app, tokens } = await fixture(t)
  const headers = auth(tokens.admin)

  async function createDirectory(name, city, visible) {
    const record = (await app.inject({
      method: 'POST',
      url: '/api/v1/admin/business/directory',
      headers,
      payload: { name, city, college: '工商管理学院', industry: '数字经济' }
    })).json().data
    if (visible) {
      const shown = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/business/directory/${record.id}/actions`,
        headers,
        payload: { action: 'show' }
      })
      assert.equal(shown.statusCode, 200)
    }
    return record
  }

  await createDirectory('长沙公开校友甲', '长沙', true)
  await createDirectory('长沙公开校友乙', '长沙', true)
  await createDirectory('深圳公开校友', '深圳', true)
  await createDirectory('绝不能出现在统计中的隐藏姓名', '武汉', false)
  await createDirectory('无城市公开校友', '', true)

  const stats = await app.inject({
    method: 'GET',
    url: '/api/v1/business/directory/city-stats'
  })
  assert.equal(stats.statusCode, 200)
  assert.deepEqual(stats.json().data.items, [
    { city: '长沙市', count: 2 },
    { city: '深圳市', count: 1 }
  ])
  assert.equal(stats.json().data.totalProfiles, 3)
  assert.equal(stats.json().data.totalCities, 2)
  assert.equal(JSON.stringify(stats.json().data).includes('校友'), false)
  assert.equal(JSON.stringify(stats.json().data).includes('武汉'), false)
})

test('开发种子包含校友生态一期与二期资源', () => {
  const seeds = developmentBusinessSeeds()
  for (const resource of [
    'alumni-enterprises',
    'collaboration-opportunities',
    'alumni-academy',
    'announcements',
    'alumni-benefits'
  ]) {
    assert.equal(Array.isArray(seeds[resource]), true)
    assert.equal(seeds[resource].length > 0, true)
    assert.equal(seeds[resource][0].resource, resource)
    assert.equal(seeds[resource][0].status, 'published')
  }
})

test('已有 development 数据只幂等补齐缺失的生态圈板块且不覆盖现有记录', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-ecosystem-backfill-test-'))
  const dataFile = path.join(directory, 'data.json')
  const existingEnterprise = {
    id: 'existing-enterprise',
    resource: 'alumni-enterprises',
    status: 'published',
    revision: 7,
    name: '用户已经维护的真实开发记录',
    industry: '现代服务',
    city: '长沙',
    summary: '不得被开发种子覆盖。',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  await fs.writeFile(dataFile, `${JSON.stringify({
    version: 1,
    accounts: [],
    adminDelegations: [],
    identityConflicts: [],
    auditLogs: [],
    contentRules: [],
    business: {
      version: 1,
      revision: 9,
      resources: {
        activities: [{
          id: 'existing-activity',
          resource: 'activities',
          status: 'published',
          revision: 1,
          title: '已有活动',
          organizer: '学校'
        }],
        'alumni-enterprises': [existingEnterprise]
      },
      submissions: [],
      reactions: []
    }
  }, null, 2)}\n`, 'utf8')

  const config = createConfig({
    env: 'development',
    dataFile,
    dataHashSecret: 'ecosystem-development-backfill-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const first = await buildApp({
    config,
    logger: false,
    refreshContent: false,
    scheduleContent: false,
    contentService: contentStub()
  })
  const afterFirst = first.services.database.read((data) => data)
  assert.equal(afterFirst.business.resources['alumni-enterprises'].length, 1)
  assert.equal(afterFirst.business.resources['alumni-enterprises'][0].id, existingEnterprise.id)
  assert.equal(afterFirst.business.resources['collaboration-opportunities'].length, 1)
  assert.equal(afterFirst.business.resources['alumni-academy'].length, 1)
  assert.deepEqual(
    afterFirst.auditLogs.find((item) => item.action === 'business.development_ecosystem_backfilled').details.resources,
    ['collaboration-opportunities', 'alumni-academy', 'announcements', 'alumni-benefits', 'academic-calendar']
  )
  assert.equal(afterFirst.business.resources['academic-calendar'].length, 1)
  assert.match(afterFirst.business.resources['academic-calendar'][0].title, /开发示例/u)
  await first.close()

  const second = await buildApp({
    config,
    logger: false,
    refreshContent: false,
    scheduleContent: false,
    contentService: contentStub()
  })
  t.after(async () => {
    await second.close()
    await fs.rm(directory, { recursive: true, force: true })
  })
  const afterSecond = second.services.database.read((data) => data)
  assert.equal(afterSecond.business.resources['alumni-enterprises'].length, 1)
  assert.equal(afterSecond.business.resources['collaboration-opportunities'].length, 1)
  assert.equal(afterSecond.business.resources['alumni-academy'].length, 1)
  assert.equal(afterSecond.business.resources.announcements.length, 1)
  assert.equal(afterSecond.business.resources['alumni-benefits'].length, 1)
  assert.equal(afterSecond.business.resources['academic-calendar'].length, 1)
  assert.equal(
    afterSecond.auditLogs.filter((item) => item.action === 'business.development_ecosystem_backfilled').length,
    1
  )
})
