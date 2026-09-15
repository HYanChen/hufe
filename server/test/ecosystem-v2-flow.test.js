import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-ecosystem-v2-test-'))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    dataHashSecret: 'ecosystem-v2-flow-secret',
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

  const register = (subject, username, name, personType, isAdmin = false) =>
    app.services.accounts.register({
      schoolSubject: subject,
      name,
      personType,
      department: personType === 'student' ? '财政金融学院' : '校友工作办公室',
      verificationSource: 'school-registration-check',
      isAdmin
    }, { username, password: 'StrongPass!2026' })

  await register('ecosystem-v2-admin', 'ecosystem_v2_admin', '生态二期管理员', 'staff', true)
  await register('ecosystem-v2-alumni-one', 'ecosystem_v2_alumni_one', '校友甲', 'alumni')
  await register('ecosystem-v2-alumni-two', 'ecosystem_v2_alumni_two', '校友乙', 'alumni')
  await register('ecosystem-v2-student', 'ecosystem_v2_student', '学生甲', 'student')
  await app.services.accounts.provisionOperator({
    username: 'ecosystem_v2_operator',
    temporaryPassword: 'StrongPass!2026',
    displayName: '未实名运营账号',
    department: '平台运营'
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
    headers: {
      admin: { authorization: `Bearer ${await login('ecosystem_v2_admin')}` },
      alumniOne: { authorization: `Bearer ${await login('ecosystem_v2_alumni_one')}` },
      alumniTwo: { authorization: `Bearer ${await login('ecosystem_v2_alumni_two')}` },
      student: { authorization: `Bearer ${await login('ecosystem_v2_student')}` },
      operator: { authorization: `Bearer ${await login('ecosystem_v2_operator')}` }
    }
  }
}

function isoFromNow(milliseconds) {
  return new Date(Date.now() + milliseconds).toISOString()
}

async function createAndPublish(app, headers, resource, payload) {
  const createdResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/${resource}`,
    headers,
    payload
  })
  assert.equal(createdResponse.statusCode, 201, createdResponse.body)
  const created = createdResponse.json().data
  const publishedResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/${resource}/${created.id}/actions`,
    headers,
    payload: { action: 'publish' }
  })
  assert.equal(publishedResponse.statusCode, 200, publishedResponse.body)
  return publishedResponse.json().data
}

function announcementPayload(overrides = {}) {
  return {
    title: '校友服务公告',
    category: '平台公告',
    audience: 'alumni',
    priority: 'normal',
    startAt: isoFromNow(-60 * 60 * 1000),
    endAt: isoFromNow(7 * 24 * 60 * 60 * 1000),
    targetType: 'none',
    target: '',
    summary: '面向校友发布的服务公告。',
    content: '公告正文仅向符合受众条件的账号展示。',
    sortOrder: 10,
    ...overrides
  }
}

function benefitPayload(overrides = {}) {
  return {
    title: '校友专享权益',
    category: '校园服务',
    provider: '校友工作办公室',
    audience: 'alumni',
    value: '校友专享服务一次',
    startAt: isoFromNow(-60 * 60 * 1000),
    endAt: isoFromNow(7 * 24 * 60 * 60 * 1000),
    quota: 10,
    claimInstructions: '实名校友提交领取后，由平台后台审核。',
    terms: '每个实名账号限领一次。',
    coverUrl: '',
    externalUrl: '',
    tags: ['校友专享'],
    sortOrder: 10,
    ...overrides
  }
}

test('公告与校友权益纳入严格 CRUD、公开有效期、bootstrap 和权益领取闭环', async (t) => {
  const { app, headers } = await fixture(t)

  const delegation = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/delegation/resources',
    headers: headers.admin
  })
  assert.equal(delegation.statusCode, 200)
  assert.deepEqual(
    delegation.json().data.items
      .filter((item) => ['announcements', 'alumni-benefits'].includes(item.key))
      .map((item) => [item.key, item.label]),
    [['announcements', '公告管理'], ['alumni-benefits', '校友权益']]
  )

  const unknownAnnouncementField = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/announcements',
    headers: headers.admin,
    payload: { ...announcementPayload(), clientOnlyFlag: true }
  })
  assert.equal(unknownAnnouncementField.statusCode, 400)
  assert.equal(unknownAnnouncementField.json().code, 'BUSINESS_FIELD_UNKNOWN')

  const invalidPriority = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/announcements',
    headers: headers.admin,
    payload: announcementPayload({ priority: 'important' })
  })
  assert.equal(invalidPriority.statusCode, 400)
  assert.equal(invalidPriority.json().code, 'BUSINESS_FIELD_INVALID')

  const missingAnnouncementWindow = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/announcements',
    headers: headers.admin,
    payload: announcementPayload({ startAt: '' })
  })
  assert.equal(missingAnnouncementWindow.statusCode, 400)
  assert.equal(missingAnnouncementWindow.json().code, 'BUSINESS_FIELD_REQUIRED')

  const reversedAnnouncementWindow = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/announcements',
    headers: headers.admin,
    payload: announcementPayload({
      startAt: isoFromNow(2 * 60 * 60 * 1000),
      endAt: isoFromNow(60 * 60 * 1000)
    })
  })
  assert.equal(reversedAnnouncementWindow.statusCode, 400)
  assert.equal(reversedAnnouncementWindow.json().code, 'BUSINESS_DATE_ORDER_INVALID')

  const missingAnnouncementTarget = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/announcements',
    headers: headers.admin,
    payload: announcementPayload({ targetType: 'url', target: '' })
  })
  assert.equal(missingAnnouncementTarget.statusCode, 400)
  assert.equal(missingAnnouncementTarget.json().code, 'BUSINESS_FIELD_REQUIRED')

  const insecureAnnouncementTarget = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/announcements',
    headers: headers.admin,
    payload: announcementPayload({ targetType: 'url', target: 'http://example.com/notice' })
  })
  assert.equal(insecureAnnouncementTarget.statusCode, 400)
  assert.equal(insecureAnnouncementTarget.json().code, 'BUSINESS_URL_INVALID')

  const missingInternalRoute = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/announcements',
    headers: headers.admin,
    payload: announcementPayload({
      targetType: 'route',
      target: '/pages/not-a-real-page/index'
    })
  })
  assert.equal(missingInternalRoute.statusCode, 400)
  assert.equal(missingInternalRoute.json().code, 'BUSINESS_URL_INVALID')

  const announcement = await createAndPublish(
    app,
    headers.admin,
    'announcements',
    announcementPayload()
  )
  assert.equal(announcement.status, 'published')
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/business/announcements',
    headers: headers.alumniOne
  })).json().data.total, 1)
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/business/announcements',
    headers: headers.student
  })).json().data.total, 0)
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/business/announcements'
  })).json().data.total, 0)
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/business/announcements',
    headers: headers.operator
  })).json().data.total, 0)

  const directoryCreated = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/directory',
    headers: headers.admin,
    payload: {
      name: '隐私边界校友',
      graduationYear: 2022,
      college: '信息技术与管理学院',
      major: '信息管理',
      city: '长沙',
      bio: '仅展示自愿公开的校友简介。',
      phone: '13800000000',
      email: 'private@example.edu.cn',
      contactMethod: '仅供后台使用',
      accountId: 'private-account-id',
      adminNote: '内部备注'
    }
  })
  assert.equal(directoryCreated.statusCode, 201, directoryCreated.body)
  const directoryId = directoryCreated.json().data.id
  const directoryShown = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/directory/${directoryId}/actions`,
    headers: headers.admin,
    payload: { action: 'show' }
  })
  assert.equal(directoryShown.statusCode, 200, directoryShown.body)

  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/business/directory'
  })).statusCode, 401)
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/business/directory',
    headers: headers.operator
  })).statusCode, 403)
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/business/directory/not-visible',
    headers: headers.operator
  })).statusCode, 403)
  const verifiedDirectory = await app.inject({
    method: 'GET',
    url: '/api/v1/business/directory',
    headers: headers.alumniOne
  })
  assert.equal(verifiedDirectory.statusCode, 200)
  const directoryProfile = verifiedDirectory.json().data.items[0]
  const allowedDirectoryKeys = new Set([
    'id', 'resource', 'status', 'revision', 'name', 'graduationYear', 'college',
    'major', 'city', 'industry', 'title', 'organization', 'bio', 'createdAt', 'updatedAt'
  ])
  assert.equal(Object.keys(directoryProfile).every((key) => allowedDirectoryKeys.has(key)), true)
  assert.equal(directoryProfile.name, '隐私边界校友')
  for (const privateKey of ['phone', 'email', 'contactMethod', 'accountId', 'adminNote']) {
    assert.equal(Object.prototype.hasOwnProperty.call(directoryProfile, privateKey), false)
  }
  const anonymousCityStats = await app.inject({
    method: 'GET',
    url: '/api/v1/business/directory/city-stats'
  })
  assert.equal(anonymousCityStats.statusCode, 200)
  assert.equal(anonymousCityStats.json().data.totalCities, 1)

  const benefit = await createAndPublish(
    app,
    headers.admin,
    'alumni-benefits',
    benefitPayload()
  )
  const alumniBootstrap = await app.inject({
    method: 'GET',
    url: '/api/v1/business/bootstrap',
    headers: headers.alumniOne
  })
  assert.equal(alumniBootstrap.json().data.announcements[0].id, announcement.id)
  assert.equal(alumniBootstrap.json().data.alumniBenefits[0].id, benefit.id)
  assert.equal(alumniBootstrap.json().data.alumniBenefits[0].claimCount, 0)
  assert.equal(alumniBootstrap.json().data.alumniBenefits[0].claimed, false)
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/business/bootstrap',
    headers: headers.student
  })).json().data.alumniBenefits.length, 0)

  const claimResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: headers.alumniOne,
    payload: {
      type: 'benefit-claim',
      resourceId: benefit.id,
      payload: {
        benefitTitle: '伪造权益标题',
        provider: '伪造提供方',
        adminReply: '伪造后台回复',
        adminNote: '伪造内部备注',
        rejectionReason: '伪造驳回原因',
        status: 'approved',
        revision: 999
      }
    }
  })
  assert.equal(claimResponse.statusCode, 201, claimResponse.body)
  const claim = claimResponse.json().data
  assert.equal(claim.payload.benefitTitle, benefit.title)
  assert.equal(claim.payload.provider, benefit.provider)
  assert.equal(claim.adminReply, '')
  for (const protectedKey of ['adminReply', 'adminNote', 'rejectionReason', 'status', 'revision']) {
    assert.equal(Object.prototype.hasOwnProperty.call(claim.payload, protectedKey), false)
  }

  const claimedDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/alumni-benefits/${benefit.id}`,
    headers: headers.alumniOne
  })
  assert.equal(claimedDetail.json().data.claimCount, 1)
  assert.equal(claimedDetail.json().data.claimed, true)
  assert.equal((await app.inject({
    method: 'GET',
    url: `/api/v1/business/alumni-benefits/${benefit.id}`,
    headers: headers.alumniTwo
  })).json().data.claimed, false)

  let processedClaim = claim
  for (const action of ['approve', 'complete']) {
    const reason = action === 'approve' ? '内部审批备注，不得通知用户。' : undefined
    const actionResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/business/applications/${claim.id}/actions`,
      headers: headers.admin,
      payload: { action, ...(reason ? { reason } : {}) }
    })
    assert.equal(actionResponse.statusCode, 200, actionResponse.body)
    processedClaim = actionResponse.json().data
  }
  const annotatedClaim = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/applications/${claim.id}`,
    headers: headers.admin,
    payload: {
      expectedRevision: processedClaim.revision,
      adminReply: '请凭实名账号到服务点核销。',
      adminNote: '内部联络记录，不得返回用户。'
    }
  })
  assert.equal(annotatedClaim.statusCode, 200, annotatedClaim.body)
  const myClaims = (await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/submissions?type=benefit-claim',
    headers: headers.alumniOne
  })).json().data.items
  assert.equal(myClaims[0].adminReply, '请凭实名账号到服务点核销。')
  assert.equal(Object.prototype.hasOwnProperty.call(myClaims[0], 'adminNote'), false)
  const claimInbox = (await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/inbox?page=1&pageSize=100',
    headers: headers.alumniOne
  })).json().data.items
  assert.equal(claimInbox.some((item) => String(item.body || '').includes('内部审批备注，不得通知用户。')), false)
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: headers.alumniOne,
    payload: { type: 'benefit-claim', resourceId: benefit.id, payload: {} }
  })
  assert.equal(duplicate.statusCode, 409)
  assert.equal(duplicate.json().code, 'SUBMISSION_ALREADY_EXISTS')
  const summary = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/summary',
    headers: headers.alumniOne
  })
  assert.equal(summary.json().data.benefits, 1)
  assert.equal(summary.json().data.unreadInbox, 4)

  const expiredDraft = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/alumni-benefits',
    headers: headers.admin,
    payload: benefitPayload({
      title: '已过期权益',
      startAt: isoFromNow(-3 * 24 * 60 * 60 * 1000),
      endAt: isoFromNow(-2 * 24 * 60 * 60 * 1000)
    })
  })
  assert.equal(expiredDraft.statusCode, 201)
  const expiredPublish = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/alumni-benefits/${expiredDraft.json().data.id}/actions`,
    headers: headers.admin,
    payload: { action: 'publish' }
  })
  assert.equal(expiredPublish.statusCode, 409)
  assert.equal(expiredPublish.json().code, 'BENEFIT_EXPIRED')

  const expiredUpdate = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/alumni-benefits/${benefit.id}`,
    headers: headers.admin,
    payload: {
      expectedRevision: benefit.revision,
      startAt: isoFromNow(-3 * 24 * 60 * 60 * 1000),
      endAt: isoFromNow(-2 * 24 * 60 * 60 * 1000)
    }
  })
  assert.equal(expiredUpdate.statusCode, 200, expiredUpdate.body)
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/business/alumni-benefits',
    headers: headers.alumniOne
  })).json().data.total, 0)
})

test('消息中心合并受众公告和业务通知，公告修订后重置未读且响应不泄露内部身份字段', async (t) => {
  const { app, headers } = await fixture(t)
  const announcement = await createAndPublish(
    app,
    headers.admin,
    'announcements',
    announcementPayload()
  )
  const benefit = await createAndPublish(
    app,
    headers.admin,
    'alumni-benefits',
    benefitPayload()
  )
  const claim = (await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: headers.alumniOne,
    payload: { type: 'benefit-claim', resourceId: benefit.id, payload: {} }
  })).json().data
  const approvedClaim = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${claim.id}/actions`,
    headers: headers.admin,
    payload: { action: 'approve' }
  })
  assert.equal(approvedClaim.statusCode, 200)

  const collaboration = (await app.inject({
    method: 'POST',
    url: '/api/v1/business/collaboration-opportunities',
    headers: headers.alumniOne,
    payload: {
      title: '校友企业联合活动',
      category: '资源共享',
      organization: '校友企业',
      summary: '寻找联合活动合作伙伴。',
      contactMethod: 'owner@example.edu.cn'
    }
  })).json().data
  assert.equal(collaboration.contactMethod, 'owner@example.edu.cn')
  const approvedCollaboration = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/collaboration-opportunities/${collaboration.id}/actions`,
    headers: headers.admin,
    payload: { action: 'approve' }
  })
  assert.equal(approvedCollaboration.statusCode, 200)
  const publicCollaboration = (await app.inject({
    method: 'GET',
    url: `/api/v1/business/collaboration-opportunities/${collaboration.id}`,
    headers: headers.alumniTwo
  })).json().data
  assert.equal(Object.prototype.hasOwnProperty.call(publicCollaboration, 'contactMethod'), false)

  const inboxResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/inbox',
    headers: headers.alumniOne
  })
  assert.equal(inboxResponse.statusCode, 200)
  const inbox = inboxResponse.json().data
  assert.equal(inbox.total, 5)
  assert.equal(inbox.unreadCount, 5)
  const announcementItem = inbox.items.find((item) => item.kind === 'announcement')
  assert.match(announcementItem.id, new RegExp(`^announcement:${announcement.id}-2$`))
  assert.equal(inbox.items.some((item) => item.kind === 'business' && item.type === 'submission.approve'), true)
  assert.equal(inbox.items.some((item) => item.kind === 'business' && item.type === 'collaboration.approve'), true)
  assert.equal(inbox.items.some((item) => item.kind === 'business' && item.type === 'submission.submitted'), true)
  assert.equal(inbox.items.some((item) => item.kind === 'business' && item.type === 'collaboration.submitted'), true)
  assert.equal(
    inbox.items
      .filter((item) => item.kind === 'business')
      .every((item) => item.status && item.target?.startsWith('/pages/')),
    true
  )
  assert.equal(JSON.stringify(inbox).includes('accountId'), false)
  assert.equal(JSON.stringify(inbox).includes('actorSnapshot'), false)

  const studentInbox = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/inbox',
    headers: headers.student
  })
  assert.equal(studentInbox.json().data.total, 0)

  const marked = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/me/inbox/${encodeURIComponent(announcementItem.id)}/read`,
    headers: headers.alumniOne
  })
  assert.equal(marked.statusCode, 200, marked.body)
  assert.equal(marked.json().data.read, true)
  assert.equal(marked.json().data.unreadCount, 4)

  const updatedAnnouncement = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/announcements/${announcement.id}`,
    headers: headers.admin,
    payload: {
      expectedRevision: announcement.revision,
      summary: '公告内容已更新，应该重新进入未读状态。'
    }
  })
  assert.equal(updatedAnnouncement.statusCode, 200, updatedAnnouncement.body)
  const refreshedInbox = (await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/inbox',
    headers: headers.alumniOne
  })).json().data
  assert.equal(refreshedInbox.items.some((item) => item.id === `announcement:${announcement.id}-3` && !item.read), true)
  assert.equal(refreshedInbox.unreadCount, 5)

  const readAll = await app.inject({
    method: 'POST',
    url: '/api/v1/business/me/inbox/read-all',
    headers: headers.alumniOne
  })
  assert.equal(readAll.statusCode, 200)
  assert.equal(readAll.json().data.unreadCount, 0)
  const afterReadAll = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/inbox',
    headers: headers.alumniOne
  })
  assert.equal(afterReadAll.json().data.unreadCount, 0)
  assert.equal(afterReadAll.json().data.items.every((item) => item.read), true)
})

test('驳回原因对提交人可见，后台内部备注不进入本人响应', async (t) => {
  const { app, headers } = await fixture(t)
  const benefit = await createAndPublish(
    app,
    headers.admin,
    'alumni-benefits',
    benefitPayload()
  )
  const claim = (await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: headers.alumniOne,
    payload: { type: 'benefit-claim', resourceId: benefit.id, payload: {} }
  })).json().data

  const missingReason = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${claim.id}/actions`,
    headers: headers.admin,
    payload: { action: 'reject' }
  })
  assert.equal(missingReason.statusCode, 400)
  assert.equal(missingReason.json().code, 'BUSINESS_ACTION_REASON_REQUIRED')

  const rejected = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${claim.id}/actions`,
    headers: headers.admin,
    payload: { action: 'reject', reason: '该权益领取材料不符合要求。' }
  })
  assert.equal(rejected.statusCode, 200, rejected.body)

  const mine = (await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/submissions?type=benefit-claim',
    headers: headers.alumniOne
  })).json().data.items[0]
  assert.equal(mine.rejectionReason, '该权益领取材料不符合要求。')
  assert.equal(Object.prototype.hasOwnProperty.call(mine, 'adminNote'), false)

  const inbox = (await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/inbox',
    headers: headers.alumniOne
  })).json().data.items
  const rejectionNotice = inbox.find((item) => item.type === 'submission.reject')
  assert.equal(rejectionNotice.status, 'rejected')
  assert.equal(rejectionNotice.target, '/pages/benefits/index?tab=mine')
})

test('活动报名仅允许发布且未截止未开始的活动，并在事务内执行名额校验', async (t) => {
  const { app, headers } = await fixture(t)
  const incompleteActivity = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/activities',
    headers: headers.admin,
    payload: {
      title: '字段不完整活动',
      organizer: '校友工作办公室'
    }
  })
  assert.equal(incompleteActivity.statusCode, 400)
  assert.equal(incompleteActivity.json().code, 'BUSINESS_FIELD_REQUIRED')

  const invalidActivityWindow = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/activities',
    headers: headers.admin,
    payload: {
      title: '时间关系无效活动',
      category: '校友活动',
      organizer: '校友工作办公室',
      venue: '湖南财政经济学院',
      startAt: isoFromNow(2 * 24 * 60 * 60 * 1000),
      endAt: isoFromNow(24 * 60 * 60 * 1000),
      registrationDeadline: isoFromNow(3 * 24 * 60 * 60 * 1000),
      description: '开始、结束和报名截止时间关系无效。'
    }
  })
  assert.equal(invalidActivityWindow.statusCode, 400)
  assert.equal(invalidActivityWindow.json().code, 'BUSINESS_DATE_ORDER_INVALID')

  const activity = await createAndPublish(app, headers.admin, 'activities', {
    title: '限额活动',
    category: '校友活动',
    organizer: '校友工作办公室',
    venue: '湖南财政经济学院',
    startAt: isoFromNow(3 * 24 * 60 * 60 * 1000),
    registrationDeadline: isoFromNow(2 * 24 * 60 * 60 * 1000),
    quota: 1,
    description: '用于验证事务内名额校验。'
  })
  const register = (headersValue) => app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: headersValue,
    payload: { type: 'event-registration', resourceId: activity.id, payload: {} }
  })
  const concurrent = await Promise.all([register(headers.alumniOne), register(headers.alumniTwo)])
  assert.equal(concurrent.filter((response) => response.statusCode === 201).length, 1)
  const full = concurrent.find((response) => response.statusCode === 409)
  assert.equal(full.json().code, 'EVENT_REGISTRATION_FULL')

  const deadlinePassed = await createAndPublish(app, headers.admin, 'activities', {
    title: '报名已截止活动',
    category: '校友活动',
    organizer: '校友工作办公室',
    venue: '湖南财政经济学院',
    startAt: isoFromNow(2 * 24 * 60 * 60 * 1000),
    registrationDeadline: isoFromNow(-60 * 60 * 1000),
    quota: 10,
    description: '报名截止时间已经过去。'
  })
  const deadlineResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: headers.student,
    payload: { type: 'event-registration', resourceId: deadlinePassed.id, payload: {} }
  })
  assert.equal(deadlineResponse.statusCode, 409)
  assert.equal(deadlineResponse.json().code, 'EVENT_REGISTRATION_DEADLINE_PASSED')

  const alreadyStarted = await createAndPublish(app, headers.admin, 'activities', {
    title: '已经开始的活动',
    category: '校友活动',
    organizer: '校友工作办公室',
    venue: '湖南财政经济学院',
    startAt: isoFromNow(-60 * 60 * 1000),
    quota: 10,
    description: '活动已经开始。'
  })
  const startedResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: headers.student,
    payload: { type: 'event-registration', resourceId: alreadyStarted.id, payload: {} }
  })
  assert.equal(startedResponse.statusCode, 409)
  assert.equal(startedResponse.json().code, 'EVENT_ALREADY_STARTED')

  const closedActivity = await createAndPublish(app, headers.admin, 'activities', {
    title: '后台已关闭报名活动',
    category: '校友活动',
    organizer: '校友工作办公室',
    venue: '湖南财政经济学院',
    startAt: isoFromNow(3 * 24 * 60 * 60 * 1000),
    registrationDeadline: isoFromNow(2 * 24 * 60 * 60 * 1000),
    quota: 10,
    description: '后台关闭报名。'
  })
  const closed = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/activities/${closedActivity.id}/actions`,
    headers: headers.admin,
    payload: { action: 'close' }
  })
  assert.equal(closed.statusCode, 200)
  const closedResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: headers.student,
    payload: { type: 'event-registration', resourceId: closedActivity.id, payload: {} }
  })
  assert.equal(closedResponse.statusCode, 409)
  assert.equal(closedResponse.json().code, 'EVENT_REGISTRATION_CLOSED')
})

test('后台 datetime-local 按 Asia/Shanghai 解释并规范为 UTC ISO 存储', async (t) => {
  const { app, headers } = await fixture(t)
  const createdResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/activities',
    headers: headers.admin,
    payload: {
      title: '上海时区活动',
      category: '校友活动',
      organizer: '校友工作办公室',
      venue: '湖南财政经济学院',
      registrationDeadline: '2032-03-01T18:00',
      startAt: '2032-03-02T09:30',
      endAt: '2032-03-02T11:00',
      quota: 20,
      description: '验证 datetime-local 不受服务端系统时区影响。'
    }
  })
  assert.equal(createdResponse.statusCode, 201, createdResponse.body)
  const created = createdResponse.json().data
  assert.equal(created.registrationDeadline, '2032-03-01T10:00:00.000Z')
  assert.equal(created.startAt, '2032-03-02T01:30:00.000Z')
  assert.equal(created.endAt, '2032-03-02T03:00:00.000Z')

  const updatedResponse = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/activities/${created.id}`,
    headers: headers.admin,
    payload: {
      expectedRevision: created.revision,
      endAt: '2032-03-02T12:15'
    }
  })
  assert.equal(updatedResponse.statusCode, 200, updatedResponse.body)
  assert.equal(updatedResponse.json().data.endAt, '2032-03-02T04:15:00.000Z')
})
