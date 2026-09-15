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
  return { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status, home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, page: 1, pageSize: 12, status }), get: async () => null, refresh: async () => status }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-delegation-test-'))
  const config = createConfig({ env: 'test', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'delegation-flow-secret', content: { cacheFile: path.join(directory, 'content.json') } })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const identities = [
    ['root', '平台超级管理员', true], ['manager', '组织负责人', false], ['candidate', '候选管理员', false],
    ['member_one', '成员甲', false], ['member_two', '成员乙', false], ['community_manager', '湖财圈管理员', false]
  ]
  const created = {}
  for (const [username, name, isAdmin] of identities) {
    created[username] = await app.services.accounts.register({
      schoolSubject: `subject-${username}`, name, personType: isAdmin ? 'staff' : 'alumni', department: isAdmin ? '信息中心' : '财政金融学院',
      verificationSource: 'school-registration-check', schoolIdentityVerified: true, isAdmin
    }, { username, password: `Strong-${username}-2026!` })
  }
  const login = async (username, password = `Strong-${username}-2026!`) => (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } })).json().data
  const rootLogin = await login('root')
  return { app, created, login, rootHeaders: { authorization: `Bearer ${rootLogin.accessToken}` } }
}

async function createAndPublish(app, headers, resource, payload) {
  const created = (await app.inject({ method: 'POST', url: `/api/v1/admin/business/${resource}`, headers, payload })).json().data
  await app.inject({ method: 'POST', url: `/api/v1/admin/business/${resource}/${created.id}/actions`, headers, payload: { action: 'publish' } })
  return created
}

test('超级管理员可创建非实名运营账号，强制改密后仅按板块授权且停用立即撤权', async (t) => {
  const { app, created, login, rootHeaders } = await fixture(t)
  const lastRoot = await app.inject({ method: 'PATCH', url: `/api/v1/admin/accounts/${created.root.id}/status`, headers: rootHeaders, payload: { status: 'suspended' } })
  assert.equal(lastRoot.statusCode, 409)
  assert.equal(lastRoot.json().code, 'LAST_SUPER_ADMIN')
  const selfDeactivateRoot = await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: rootHeaders, payload: { confirmation: '确认注销账号' } })
  assert.equal(selfDeactivateRoot.statusCode, 409)
  assert.equal(selfDeactivateRoot.json().code, 'LAST_SUPER_ADMIN')
  const provisionedResponse = await app.inject({
    method: 'POST', url: '/api/v1/admin/accounts', headers: rootHeaders,
    payload: { username: 'org_operator', displayName: '组织运营员', department: '校友工作办公室', temporaryPassword: 'TempPass-2026!', adminPermissions: ['organizations'], accountType: 'operations' }
  })
  assert.equal(provisionedResponse.statusCode, 201)
  const provisioned = provisionedResponse.json().data.account
  assert.equal(provisioned.accountSource, 'admin_provisioned')
  assert.equal(provisioned.source, 'admin_created')
  assert.equal(provisioned.schoolIdentityVerified, false)
  assert.equal(provisioned.isAdmin, false)
  assert.equal(provisioned.mustChangePassword, true)
  assert.equal(provisioned.adminRole, 'delegated_admin')
  assert.deepEqual(provisioned.adminPermissions, ['organizations', 'applications'])
  assert.equal(provisioned.passwordHash, undefined)

  const duplicate = await app.inject({
    method: 'POST', url: '/api/v1/admin/accounts', headers: rootHeaders,
    payload: { username: 'org_operator', displayName: '重复账号', department: '校友办', temporaryPassword: 'TempPass-2026!', adminPermissions: ['organizations'], accountType: 'operations' }
  })
  assert.equal(duplicate.statusCode, 409)

  const operatorLogin = await login('org_operator', 'TempPass-2026!')
  const operatorHeaders = { authorization: `Bearer ${operatorLogin.accessToken}` }
  assert.equal(operatorLogin.user.adminRole, 'delegated_admin')
  assert.equal(operatorLogin.user.mustChangePassword, true)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/business/organizations', headers: operatorHeaders })).json().code, 'PASSWORD_CHANGE_REQUIRED')
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: operatorHeaders, payload: { topic: '校园', content: '后台运营账号不能冒充学校实名用户发布内容。' } })).json().code, 'PASSWORD_CHANGE_REQUIRED')

  const changed = await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', headers: operatorHeaders, payload: { currentPassword: 'TempPass-2026!', newPassword: 'ChangedPass-2026!' } })
  assert.deepEqual(changed.json().data, { passwordChanged: true, loginRequired: true })
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/me', headers: operatorHeaders })).statusCode, 401)

  const relogin = await login('org_operator', 'ChangedPass-2026!')
  const activeHeaders = { authorization: `Bearer ${relogin.accessToken}` }
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: activeHeaders, payload: { topic: '校园', content: '完成改密也不能让后台运营账号冒充学校实名用户。' } })).json().code, 'SCHOOL_IDENTITY_REQUIRED')
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/business/organizations', headers: activeHeaders })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/business/jobs', headers: activeHeaders })).statusCode, 403)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/accounts', headers: activeHeaders })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/accounts', headers: activeHeaders, payload: {} })).statusCode, 403)

  const organization = (await app.inject({ method: 'POST', url: '/api/v1/admin/business/organizations', headers: activeHeaders, payload: { name: '运营测试组织', type: '学院分会' } })).json().data
  const bypass = await app.inject({ method: 'PATCH', url: `/api/v1/admin/business/organizations/${organization.id}`, headers: activeHeaders, payload: { status: 'published' } })
  assert.equal(bypass.statusCode, 400)
  assert.equal(bypass.json().code, 'BUSINESS_PROTECTED_FIELD')

  const memberDenied = await app.inject({ method: 'POST', url: '/api/v1/admin/accounts', headers: { authorization: `Bearer ${(await login('manager')).accessToken}` }, payload: {} })
  assert.equal(memberDenied.statusCode, 403)

  await app.inject({ method: 'PATCH', url: `/api/v1/admin/accounts/${provisioned.id}/status`, headers: rootHeaders, payload: { status: 'suspended' } })
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/business/organizations', headers: activeHeaders })).statusCode, 401)
  await app.inject({ method: 'PATCH', url: `/api/v1/admin/accounts/${provisioned.id}/status`, headers: rootHeaders, payload: { status: 'active' } })
  const restored = await login('org_operator', 'ChangedPass-2026!')
  assert.equal(restored.user.adminRole, 'member')
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/business/organizations', headers: { authorization: `Bearer ${restored.accessToken}` } })).statusCode, 403)
  assert.equal(created.root.id !== provisioned.id, true)
})

test('具体组织管理员只能查看和审核本组织及关联申请，并可委派同记录管理员', async (t) => {
  const { app, created, login, rootHeaders } = await fixture(t)
  const orgOne = await createAndPublish(app, rootHeaders, 'organizations', { name: '财政金融学院分会', type: '学院分会' })
  const orgTwo = await createAndPublish(app, rootHeaders, 'organizations', { name: '工商管理学院分会', type: '学院分会' })
  const activity = await createAndPublish(app, rootHeaders, 'activities', {
    title: '校友活动',
    category: '校友活动',
    organizer: '学校',
    venue: '厚生楼',
    startAt: futureIso(),
    description: '用于组织委派范围回归。'
  })
  const memberOneHeaders = { authorization: `Bearer ${(await login('member_one')).accessToken}` }
  const memberTwoHeaders = { authorization: `Bearer ${(await login('member_two')).accessToken}` }
  const firstApplication = (await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: memberOneHeaders, payload: { type: 'organization-membership', resourceId: orgOne.id, payload: { note: '加入一分会' } } })).json().data
  const secondApplication = (await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: memberTwoHeaders, payload: { type: 'organization-membership', resourceId: orgTwo.id, payload: { note: '加入二分会' } } })).json().data
  await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: memberTwoHeaders, payload: { type: 'event-registration', resourceId: activity.id, payload: { note: '参加活动' } } })

  const grant = await app.inject({ method: 'POST', url: `/api/v1/admin/business/organizations/${orgOne.id}/managers`, headers: rootHeaders, payload: { accountId: created.manager.id, scope: { resource: 'jobs', resourceId: orgTwo.id } } })
  assert.equal(grant.statusCode, 201)
  const managerLogin = await login('manager')
  const managerHeaders = { authorization: `Bearer ${managerLogin.accessToken}` }
  assert.equal(managerLogin.user.adminRole, 'delegated_admin')
  assert.equal(managerLogin.user.adminScopes[0].resourceId, orgOne.id)

  const organizations = (await app.inject({ method: 'GET', url: '/api/v1/admin/business/organizations', headers: managerHeaders })).json().data
  assert.equal(organizations.total, 1)
  assert.equal(organizations.items[0].id, orgOne.id)
  assert.equal(organizations.items[0].capabilities.manageManagers, true)
  const applications = (await app.inject({ method: 'GET', url: '/api/v1/admin/business/applications', headers: managerHeaders })).json().data
  assert.equal(applications.total, 1)
  assert.equal(applications.items[0].id, firstApplication.id)
  assert.equal(JSON.stringify(applications).includes(secondApplication.id), false)
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/admin/business/applications/${secondApplication.id}`, headers: managerHeaders })).statusCode, 404)

  const approved = await app.inject({ method: 'POST', url: `/api/v1/admin/business/applications/${firstApplication.id}/actions`, headers: managerHeaders, payload: { action: 'approve' } })
  assert.equal(approved.statusCode, 200)
  assert.equal(approved.json().data.status, 'approved')

  const search = await app.inject({ method: 'GET', url: '/api/v1/admin/accounts/search?query=%E5%80%99%E9%80%89&limit=8', headers: managerHeaders })
  assert.equal(search.statusCode, 200)
  assert.equal(search.json().data.items[0].id, created.candidate.id)
  assert.equal(search.json().data.items[0].adminScopes, undefined)
  const delegated = await app.inject({
    method: 'POST', url: `/api/v1/admin/business/organizations/${orgOne.id}/managers`, headers: managerHeaders,
    payload: { accountId: created.candidate.id, expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() }
  })
  assert.equal(delegated.statusCode, 201)
  const candidateLogin = await login('candidate')
  const candidateHeaders = { authorization: `Bearer ${candidateLogin.accessToken}` }
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/business/organizations', headers: candidateHeaders })).json().data.total, 1)

  const overreach = await app.inject({
    method: 'POST', url: '/api/v1/admin/delegations', headers: managerHeaders,
    payload: { accountId: created.candidate.id, resource: 'organizations', resourceId: orgTwo.id, permissions: ['read'], expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() }
  })
  assert.equal(overreach.statusCode, 403)
  const summary = (await app.inject({ method: 'GET', url: '/api/v1/admin/business/summary', headers: managerHeaders })).json().data
  assert.equal(summary.resources.organizations.total, 1)
  assert.equal(summary.resources.applications.total, 1)
  assert.equal(summary.submissions, 1)

  await app.inject({ method: 'DELETE', url: `/api/v1/admin/business/organizations/${orgOne.id}/managers/${created.candidate.id}`, headers: managerHeaders })
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/business/organizations', headers: candidateHeaders })).statusCode, 403)
  assert.equal(app.services.accounts.auditLogs().some((item) => item.action === 'admin.delegation_created'), true)
  assert.equal(app.services.accounts.auditLogs().some((item) => item.action === 'admin.delegation_revoked'), true)
})

test('湖财圈授权只可在反馈队列看到关联举报，不可读取普通反馈', async (t) => {
  const { app, created, login, rootHeaders } = await fixture(t)
  const authorHeaders = { authorization: `Bearer ${(await login('member_one')).accessToken}` }
  const post = (await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: authorHeaders, payload: { topic: '校园记忆', content: '用于验证举报最小权限隔离的湖财圈测试内容。' } })).json().data
  await app.inject({ method: 'POST', url: `/api/v1/admin/business/community-posts/${post.id}/actions`, headers: rootHeaders, payload: { action: 'approve' } })
  await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: authorHeaders, payload: { type: 'community-report', resourceId: post.id, payload: { content: '测试举报内容' } } })
  await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: authorHeaders, payload: { type: 'feedback', payload: { content: '这是一条普通意见反馈' } } })
  await app.inject({ method: 'POST', url: '/api/v1/admin/delegations', headers: rootHeaders, payload: { accountId: created.community_manager.id, resource: 'community-posts' } })

  const managerHeaders = { authorization: `Bearer ${(await login('community_manager')).accessToken}` }
  const queue = await app.inject({ method: 'GET', url: '/api/v1/admin/business/feedback', headers: managerHeaders })
  assert.equal(queue.statusCode, 200)
  assert.equal(queue.json().data.total, 1)
  assert.equal(queue.json().data.items[0].submissionType, 'community-report')
})

test('applications 与 service-applications 的同名板块直授权可直接访问列表', async (t) => {
  const { app, created, login, rootHeaders } = await fixture(t)
  const activity = await createAndPublish(app, rootHeaders, 'activities', {
    title: '直授权活动',
    category: '校友活动',
    organizer: '学校',
    venue: '厚生楼',
    startAt: futureIso(45),
    description: '用于申请中心直授权回归。'
  })
  const service = await createAndPublish(app, rootHeaders, 'service-catalog', { title: '校友证明服务', category: '证明', summary: '用于直授权回归' })
  const memberHeaders = { authorization: `Bearer ${(await login('member_one')).accessToken}` }
  await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: memberHeaders, payload: { type: 'event-registration', resourceId: activity.id, payload: { note: '活动报名' } } })
  await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: memberHeaders, payload: { type: 'service-application', resourceId: service.id, payload: { note: '服务申请' } } })

  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/delegations', headers: rootHeaders, payload: { accountId: created.candidate.id, resource: 'applications' } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/delegations', headers: rootHeaders, payload: { accountId: created.community_manager.id, resource: 'service-applications' } })).statusCode, 201)
  const applicationsHeaders = { authorization: `Bearer ${(await login('candidate')).accessToken}` }
  const servicesHeaders = { authorization: `Bearer ${(await login('community_manager')).accessToken}` }
  const applications = await app.inject({ method: 'GET', url: '/api/v1/admin/business/applications', headers: applicationsHeaders })
  const serviceApplications = await app.inject({ method: 'GET', url: '/api/v1/admin/business/service-applications', headers: servicesHeaders })
  assert.equal(applications.statusCode, 200)
  const automaticallyJoined = app.services.database.read(state => state.business.submissions.filter(row => row.type === 'organization-membership' && row.automaticMembership === true).length)
  assert.equal(applications.json().data.total, 2 + automaticallyJoined)
  assert.deepEqual(applications.json().data.items.filter(row => row.submissionType !== 'organization-membership').map(row => row.submissionType).sort(), ['event-registration', 'service-application'])
  assert.equal(applications.json().data.items.filter(row => row.submissionType === 'organization-membership' && row.status === 'approved').length, automaticallyJoined)
  assert.equal(serviceApplications.statusCode, 200)
  assert.equal(serviceApplications.json().data.total, 1)
  assert.equal(serviceApplications.json().data.items[0].submissionType, 'service-application')
})

test('创建新授权前会落账已过期但仍标 active 的旧授权', async (t) => {
  const { app, created, rootHeaders } = await fixture(t)
  await app.services.database.transaction((data) => {
    data.adminDelegations.push({
      id: 'stale-active-grant', accountId: created.candidate.id, resource: 'jobs', resourceId: null,
      permissions: ['read', 'create', 'update', 'moderate', 'manage_members'], status: 'active', revision: 1,
      grantedBy: created.root.id, parentGrantIds: [], lineageGrantIds: [], expiresAt: '2020-01-01T00:00:00.000Z',
      createdAt: '2019-01-01T00:00:00.000Z', updatedAt: '2019-01-01T00:00:00.000Z', revokedAt: null, revokedBy: null, revokeReason: ''
    })
  })
  const replacement = await app.inject({
    method: 'POST', url: '/api/v1/admin/delegations', headers: rootHeaders,
    payload: { accountId: created.candidate.id, resource: 'jobs' }
  })
  assert.equal(replacement.statusCode, 201)
  const grants = app.services.database.read((data) => data.adminDelegations.filter((grant) => grant.accountId === created.candidate.id && grant.resource === 'jobs'))
  assert.equal(grants.find((grant) => grant.id === 'stale-active-grant').status, 'expired')
  assert.equal(grants.filter((grant) => grant.status === 'active').length, 1)
  assert.equal(app.services.accounts.auditLogs().some((item) => item.action === 'admin.delegation_expired' && item.targetId === 'stale-active-grant'), true)
})

test('非超级管理员链式委派必须限期且不得超过上级授权，撤销上级会级联撤权', async (t) => {
  const { app, created, login, rootHeaders } = await fixture(t)
  const organization = await createAndPublish(app, rootHeaders, 'organizations', { name: '链式委派分会', type: '学院分会' })
  const parentExpiry = Date.now() + 60 * 60 * 1000
  const parentResponse = await app.inject({
    method: 'POST', url: '/api/v1/admin/delegations', headers: rootHeaders,
    payload: {
      accountId: created.manager.id, resource: 'organizations', resourceId: organization.id,
      permissions: ['read', 'update', 'manage_members'], expiresAt: new Date(parentExpiry).toISOString()
    }
  })
  assert.equal(parentResponse.statusCode, 201)
  const parentGrant = parentResponse.json().data
  const managerHeaders = { authorization: `Bearer ${(await login('manager')).accessToken}` }

  const missingExpiry = await app.inject({
    method: 'POST', url: '/api/v1/admin/delegations', headers: managerHeaders,
    payload: { accountId: created.candidate.id, resource: 'organizations', resourceId: organization.id, permissions: ['read'] }
  })
  assert.equal(missingExpiry.statusCode, 400)
  assert.equal(missingExpiry.json().code, 'DELEGATION_EXPIRY_REQUIRED')
  const invalidExpiry = await app.inject({
    method: 'POST', url: '/api/v1/admin/delegations', headers: managerHeaders,
    payload: { accountId: created.candidate.id, resource: 'organizations', resourceId: organization.id, permissions: ['read'], expiresAt: 'not-a-date' }
  })
  assert.equal(invalidExpiry.statusCode, 400)
  assert.equal(invalidExpiry.json().code, 'DELEGATION_EXPIRY_INVALID')
  const overlong = await app.inject({
    method: 'POST', url: '/api/v1/admin/delegations', headers: managerHeaders,
    payload: {
      accountId: created.candidate.id, resource: 'organizations', resourceId: organization.id,
      permissions: ['read'], expiresAt: new Date(parentExpiry + 60_000).toISOString()
    }
  })
  assert.equal(overlong.statusCode, 400)
  assert.equal(overlong.json().code, 'DELEGATION_EXPIRY_EXCEEDS_PARENT')

  const childResponse = await app.inject({
    method: 'POST', url: '/api/v1/admin/delegations', headers: managerHeaders,
    payload: {
      accountId: created.candidate.id, resource: 'organizations', resourceId: organization.id,
      permissions: ['read'], expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }
  })
  assert.equal(childResponse.statusCode, 201)
  const childGrant = childResponse.json().data
  assert.deepEqual(childGrant.parentGrantIds, [parentGrant.id])
  assert.equal(childGrant.lineageGrantIds.includes(parentGrant.id), true)
  const candidateHeaders = { authorization: `Bearer ${(await login('candidate')).accessToken}` }
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/business/organizations', headers: candidateHeaders })).statusCode, 200)

  assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/admin/delegations/${parentGrant.id}`, headers: rootHeaders, payload: { reason: '上级授权撤销测试' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/business/organizations', headers: candidateHeaders })).statusCode, 403)
  const childStored = app.services.database.read((data) => data.adminDelegations.find((grant) => grant.id === childGrant.id))
  assert.equal(childStored.status, 'revoked')
  assert.match(childStored.revokeReason, /^parent-delegation-ended:/)
  assert.equal(app.services.accounts.auditLogs().some((item) => item.action === 'admin.delegation_revoked_cascade' && item.targetId === childGrant.id), true)
})
