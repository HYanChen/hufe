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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-mentor-self-test-'))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    dataHashSecret: 'mentor-self-profile-secret',
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

  const register = (schoolSubject, username, name, options = {}) => app.services.accounts.register({
    schoolSubject,
    name,
    personType: options.personType || 'alumni',
    department: options.department || '财政金融学院',
    verificationSource: 'school-registration-check',
    isAdmin: Boolean(options.isAdmin)
  }, { username, password: options.password || 'StrongPass!2026' })

  const admin = await register('mentor-admin', 'mentor_admin', '导师平台主管', { isAdmin: true, personType: 'staff', department: '校友工作办公室' })
  const mentor = await register('mentor-owner', 'mentor_owner', '胡导师')
  const other = await register('mentor-other', 'mentor_other', '其他实名用户')
  const unverified = await register('mentor-unverified', 'mentor_unverified', '未实名用户')
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
    return response.json().data
  }

  return {
    app,
    accounts: { admin, mentor, other, unverified },
    adminLogin: await login('mentor_admin'),
    mentorLogin: await login('mentor_owner'),
    otherLogin: await login('mentor_other'),
    unverifiedLogin: await login('mentor_unverified')
  }
}

function headers(token) {
  return { authorization: `Bearer ${token}` }
}

test('管理员绑定学校实名导师后，本人只能维护自己的公开资料', async (t) => {
  const { app, accounts, adminLogin, mentorLogin, otherLogin, unverifiedLogin } = await fixture(t)
  const adminHeaders = headers(adminLogin.accessToken)
  const mentorHeaders = headers(mentorLogin.accessToken)

  const beforeBinding = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/mentor-profile',
    headers: mentorHeaders
  })
  assert.equal(beforeBinding.statusCode, 200)
  assert.deepEqual(beforeBinding.json().data, {
    eligible: false,
    verificationStatus: 'unverified',
    profile: null,
    reason: 'MENTOR_ROLE_REQUIRED'
  })

  const createdResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/mentors',
    headers: adminHeaders,
    payload: {
      name: '不能覆盖实名姓名',
      title: '金融科技产品负责人',
      company: '湖财校友企业',
      topics: ['职业规划'],
      bio: '管理员创建的导师档案。'
    }
  })
  assert.equal(createdResponse.statusCode, 201)
  const created = createdResponse.json().data
  assert.equal(created.verificationStatus, 'unverified')

  const genericOwnerBypass = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/mentors/${created.id}`,
    headers: adminHeaders,
    payload: { ownerAccountId: accounts.mentor.id, verificationStatus: 'verified' }
  })
  assert.equal(genericOwnerBypass.statusCode, 400)
  assert.equal(genericOwnerBypass.json().code, 'BUSINESS_PROTECTED_FIELD')

  const bound = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/business/mentors/${created.id}/owner`,
    headers: adminHeaders,
    payload: { accountId: accounts.mentor.id }
  })
  assert.equal(bound.statusCode, 200)
  assert.equal(bound.json().data.verificationStatus, 'verified')
  assert.equal(bound.json().data.owner.id, accounts.mentor.id)
  assert.equal(bound.json().data.owner.name, '胡导师')
  assert.equal(bound.json().data.owner.passwordHash, undefined)

  const mine = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/mentor-profile',
    headers: mentorHeaders
  })
  assert.equal(mine.statusCode, 200)
  assert.equal(mine.json().data.eligible, true)
  assert.equal(mine.json().data.profile.name, '胡导师')
  assert.equal(mine.json().data.profile.department, '财政金融学院')
  assert.equal(mine.json().data.profile.ownerAccountId, undefined)

  const saved = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/mentor-profile',
    headers: mentorHeaders,
    payload: {
      expectedRevision: mine.json().data.profile.revision,
      title: '资深金融科技产品负责人',
      company: '湖财校友科技企业',
      availableSlots: 5,
      topics: ['职业规划', '产品创新'],
      bio: '由导师本人维护的安全 **Markdown** 简介。',
      availability: '每周六下午可预约。'
    }
  })
  assert.equal(saved.statusCode, 200)
  assert.equal(saved.json().data.eligible, true)
  assert.equal(saved.json().data.profile.name, '胡导师')
  assert.equal(saved.json().data.profile.company, '湖财校友科技企业')
  assert.equal(saved.json().data.profile.availableSlots, 5)

  const forgedIdentity = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/mentor-profile',
    headers: mentorHeaders,
    payload: { name: '伪造姓名', department: '伪造学院', status: 'published' }
  })
  assert.equal(forgedIdentity.statusCode, 400)
  assert.equal(forgedIdentity.json().code, 'BUSINESS_PROTECTED_FIELD')

  const staleSave = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/mentor-profile',
    headers: mentorHeaders,
    payload: {
      expectedRevision: mine.json().data.profile.revision,
      bio: '过期页面不应覆盖最新资料。'
    }
  })
  assert.equal(staleSave.statusCode, 409)
  assert.equal(staleSave.json().code, 'BUSINESS_REVISION_CONFLICT')

  const otherDenied = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/mentor-profile',
    headers: headers(otherLogin.accessToken),
    payload: { bio: '不能编辑他人的导师档案。' }
  })
  assert.equal(otherDenied.statusCode, 403)
  assert.equal(otherDenied.json().code, 'MENTOR_ROLE_REQUIRED')

  const schoolIdentityDenied = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/mentor-profile',
    headers: headers(unverifiedLogin.accessToken),
    payload: { bio: '非实名账号不得编辑。' }
  })
  assert.equal(schoolIdentityDenied.statusCode, 403)
  assert.equal(schoolIdentityDenied.json().code, 'SCHOOL_IDENTITY_REQUIRED')

  const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: mentorHeaders })
  assert.equal(me.json().data.canEditMentorProfile, true)
  assert.equal(me.json().data.mentorProfileId, created.id)
  assert.equal(me.json().data.mentorAccess.verificationStatus, 'verified')
})

test('导师所有者唯一、仅限 active 学校实名账号，解绑后权限立即失效', async (t) => {
  const { app, accounts, adminLogin, mentorLogin, unverifiedLogin } = await fixture(t)
  const adminHeaders = headers(adminLogin.accessToken)
  const mentorHeaders = headers(mentorLogin.accessToken)
  const createMentor = async (name) => (await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/mentors',
    headers: adminHeaders,
    payload: { name, company: '湖财校友企业', title: '导师' }
  })).json().data

  const first = await createMentor('第一位导师')
  const second = await createMentor('第二位导师')

  const unverifiedBind = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/business/mentors/${first.id}/owner`,
    headers: adminHeaders,
    payload: { accountId: accounts.unverified.id }
  })
  assert.equal(unverifiedBind.statusCode, 400)
  assert.equal(unverifiedBind.json().code, 'MENTOR_OWNER_IDENTITY_REQUIRED')

  assert.equal((await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/business/mentors/${first.id}/owner`,
    headers: adminHeaders,
    payload: { accountId: accounts.mentor.id }
  })).statusCode, 200)

  const duplicate = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/business/mentors/${second.id}/owner`,
    headers: adminHeaders,
    payload: { accountId: accounts.mentor.id }
  })
  assert.equal(duplicate.statusCode, 409)
  assert.equal(duplicate.json().code, 'MENTOR_OWNER_ALREADY_BOUND')

  const adminList = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/business/mentors',
    headers: adminHeaders
  })
  const owned = adminList.json().data.items.find((item) => item.id === first.id)
  assert.equal(owned.owner.id, accounts.mentor.id)
  assert.equal(owned.owner.passwordHash, undefined)

  await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/mentors/${first.id}/actions`,
    headers: adminHeaders,
    payload: { action: 'publish' }
  })
  const publicProfile = await app.inject({
    method: 'GET',
    url: `/api/v1/business/mentors/${first.id}`,
    headers: mentorHeaders
  })
  assert.equal(publicProfile.statusCode, 200)
  assert.equal(publicProfile.json().data.ownerAccountId, undefined)
  assert.equal(publicProfile.json().data.verificationStatus, undefined)
  assert.equal(publicProfile.json().data.mentorVerifiedAt, undefined)

  const unbound = await app.inject({
    method: 'DELETE',
    url: `/api/v1/admin/business/mentors/${first.id}/owner`,
    headers: adminHeaders
  })
  assert.equal(unbound.statusCode, 200)
  assert.equal(unbound.json().data.verificationStatus, 'unverified')
  assert.equal(unbound.json().data.owner, null)

  const revokedImmediately = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/mentor-profile',
    headers: mentorHeaders,
    payload: { bio: '解绑后不得继续保存。' }
  })
  assert.equal(revokedImmediately.statusCode, 403)
  assert.equal(revokedImmediately.json().code, 'MENTOR_ROLE_REQUIRED')

  const unverifiedStatus = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/mentor-profile',
    headers: headers(unverifiedLogin.accessToken)
  })
  assert.equal(unverifiedStatus.statusCode, 200)
  assert.equal(unverifiedStatus.json().data.eligible, false)
  assert.equal(unverifiedStatus.json().data.reason, 'SCHOOL_IDENTITY_REQUIRED')

  const actions = app.services.accounts.auditLogs().map((item) => item.action)
  assert.equal(actions.includes('business.mentor_owner_verified'), true)
  assert.equal(actions.includes('business.mentor_self_updated'), false)
  assert.equal(actions.includes('business.mentor_owner_unbound'), true)
})
