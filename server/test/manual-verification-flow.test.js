import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { hmac } from '../src/auth/crypto.js'
import { createConfig } from '../src/config.js'
import { MANUAL_TRACKING_TTL_MS } from '../src/manual-verification/service.js'

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

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

async function fixture(t, suffix = 'flow') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `hufe-manual-verification-${suffix}-`))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    mediaDir: path.join(directory, 'media'),
    dataHashSecret: `manual-verification-${suffix}-secret`,
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

  await app.services.accounts.register({
    schoolSubject: `manual-admin-${suffix}`,
    name: '人工复核管理员',
    personType: 'staff',
    department: '校友工作办公室',
    verificationSource: 'school-registration-check',
    isAdmin: true
  }, { username: `review_admin_${suffix}`, password: 'StrongReview!2026' })
  await app.services.accounts.register({
    schoolSubject: `manual-member-${suffix}`,
    name: '普通用户',
    personType: 'student',
    department: '测试学院',
    verificationSource: 'school-registration-check',
    isAdmin: false
  }, { username: `review_member_${suffix}`, password: 'StrongMember!2026' })

  const login = async (username, password) => (await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password }
  })).json().data.accessToken

  return {
    app,
    config,
    directory,
    adminToken: await login(`review_admin_${suffix}`, 'StrongReview!2026'),
    memberToken: await login(`review_member_${suffix}`, 'StrongMember!2026')
  }
}

async function createDraft(app, overrides = {}) {
  const payload = {
    name: '老校友测试',
    formerName: '测试曾用名',
    personType: 'alumni',
    college: '财政金融学院',
    major: '财政学',
    enrollmentYear: 1986,
    graduationYear: 1990,
    studentId: '19860001',
    idCard: '430102196801011234',
    phone: '13800138000',
    statement: '本人为学校往届校友，现申请人工复核实名身份。',
    ...overrides
  }
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/manual-verification/applications',
    payload
  })
  assert.equal(response.statusCode, 201)
  return response.json().data
}

async function uploadMaterial(app, applicationId, trackingToken, filename = '毕业证.png') {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${applicationId}/materials`,
    headers: { authorization: `Bearer ${trackingToken}` },
    payload: {
      filename,
      materialType: 'graduation_certificate',
      label: '毕业证书',
      mimeType: 'image/png',
      dataBase64: onePixelPng
    }
  })
  assert.equal(response.statusCode, 201)
  return response.json().data
}

test('预注册人工复核从私有材料到注册票据形成闭环且不落敏感明文', async (t) => {
  const { app, adminToken, memberToken } = await fixture(t)
  const rawStudentId = '19860001'
  const rawIdCard = '430102196801011234'
  const rawPhone = '13800138000'
  const created = await createDraft(app)
  const { application, trackingToken } = created

  assert.equal(application.status, 'draft')
  assert.ok(trackingToken.length >= 40)
  assert.equal(created.expiresAt, created.trackingExpiresAt)
  assert.equal(application.trackingExpiresAt, created.trackingExpiresAt)
  assert.ok(Date.parse(created.trackingExpiresAt) - Date.now() <= MANUAL_TRACKING_TTL_MS)
  assert.ok(Date.parse(created.trackingExpiresAt) - Date.now() > MANUAL_TRACKING_TTL_MS - 60_000)
  assert.equal(application.idCardMasked, '4301**********1234')
  assert.equal(application.studentIdMasked, '****0001')
  assert.equal(application.phoneMasked, '138****8000')
  assert.equal(application.idCardKey, undefined)
  assert.equal(application.trackingTokenHash, undefined)

  const persistedDraft = JSON.stringify(app.services.database.read((data) => data))
  assert.equal(persistedDraft.includes(rawStudentId), false)
  assert.equal(persistedDraft.includes(rawIdCard), false)
  assert.equal(persistedDraft.includes(rawPhone), false)
  assert.equal(persistedDraft.includes(trackingToken), false)

  const idOnly = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/manual-verifications/${application.id}`
  })
  assert.equal(idOnly.statusCode, 401)
  assert.equal(idOnly.json().code, 'MANUAL_VERIFICATION_TRACKING_INVALID')
  const wrongToken = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/manual-verifications/${application.id}`,
    headers: { authorization: 'Bearer not-the-tracking-token' }
  })
  assert.equal(wrongToken.statusCode, 401)

  const uploaded = await uploadMaterial(app, application.id, trackingToken)
  assert.equal(uploaded.application.materials.length, 1)
  assert.equal(uploaded.material.filename, undefined)
  assert.equal(uploaded.material.materialType, 'graduation_certificate')
  assert.equal(uploaded.material.label, '毕业证书')
  assert.equal(uploaded.material.requiresAuthorization, true)
  assert.match(uploaded.material.url, new RegExp(`/auth/manual-verifications/${application.id}/materials/`))

  const privateFilename = app.services.database.read((data) => data.manualIdentityVerifications[0].materials[0].filename)
  const publicAttempt = await app.inject({ method: 'GET', url: `/api/v1/media/${privateFilename}` })
  assert.equal(publicAttempt.statusCode, 404)
  const materialWithoutToken = await app.inject({ method: 'GET', url: uploaded.material.url })
  assert.equal(materialWithoutToken.statusCode, 401)
  const materialWithToken = await app.inject({
    method: 'GET',
    url: uploaded.material.url,
    headers: { authorization: `Bearer ${trackingToken}` }
  })
  assert.equal(materialWithToken.statusCode, 200)
  assert.equal(materialWithToken.headers['content-type'], 'image/png')
  assert.match(materialWithToken.headers['cache-control'], /no-store/)
  assert.deepEqual(materialWithToken.rawPayload, Buffer.from(onePixelPng, 'base64'))

  const aliasRead = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/manual-verification/applications/${application.id}`,
    headers: { authorization: `Bearer ${trackingToken}` }
  })
  assert.equal(aliasRead.statusCode, 200)
  assert.equal(aliasRead.json().data.id, application.id)

  const submittedResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${application.id}/submit`,
    headers: { authorization: `Bearer ${trackingToken}` },
    payload: { expectedRevision: uploaded.application.revision }
  })
  assert.equal(submittedResponse.statusCode, 200)
  let current = submittedResponse.json().data
  assert.equal(current.status, 'submitted')

  const memberList = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/manual-verifications',
    headers: { authorization: `Bearer ${memberToken}` }
  })
  assert.equal(memberList.statusCode, 403)
  const adminList = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/manual-verifications?status=pending_review',
    headers: { authorization: `Bearer ${adminToken}` }
  })
  assert.equal(adminList.statusCode, 200)
  assert.equal(adminList.json().data.total, 1)
  assert.equal(adminList.json().data.items[0].idCardKey, undefined)
  assert.equal(adminList.json().data.items[0].materials[0].filename, undefined)

  const claimed = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'claim', expectedRevision: current.revision }
  })
  assert.equal(claimed.statusCode, 200)
  current = claimed.json().data
  assert.equal(current.status, 'under_review')

  const requestedMore = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'request_more', reviewNote: '请补充说明毕业证姓名变更情况。', expectedRevision: current.revision }
  })
  assert.equal(requestedMore.statusCode, 200)
  current = requestedMore.json().data
  assert.equal(current.status, 'needs_more')

  const supplemented = await app.inject({
    method: 'PATCH',
    url: `/api/v1/auth/manual-verifications/${application.id}`,
    headers: { authorization: `Bearer ${trackingToken}` },
    payload: {
      statement: '本人为学校往届校友，毕业证上的姓名为曾用名，现申请人工复核实名身份。',
      expectedRevision: current.revision
    }
  })
  assert.equal(supplemented.statusCode, 200)
  current = supplemented.json().data
  const resubmitted = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${application.id}/submit`,
    headers: { authorization: `Bearer ${trackingToken}` },
    payload: { expectedRevision: current.revision }
  })
  assert.equal(resubmitted.statusCode, 200)
  current = resubmitted.json().data
  assert.equal(current.status, 'submitted')

  const reclaimed = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'claim', expectedRevision: current.revision }
  })
  current = reclaimed.json().data
  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'approve', reviewNote: '材料核验一致。', expectedRevision: current.revision }
  })
  assert.equal(approved.statusCode, 200)
  assert.equal(approved.json().data.status, 'approved')
  assert.equal(approved.json().data.canExchange, true)

  const applicantMaterialAfterApproval = await app.inject({
    method: 'GET',
    url: uploaded.material.url,
    headers: { authorization: `Bearer ${trackingToken}` }
  })
  assert.equal(applicantMaterialAfterApproval.statusCode, 403)
  assert.equal(applicantMaterialAfterApproval.json().code, 'MANUAL_VERIFICATION_MATERIAL_ACCESS_CLOSED')

  const adminMaterial = await app.inject({
    method: 'GET',
    url: approved.json().data.materials[0].url,
    headers: { authorization: `Bearer ${adminToken}` }
  })
  assert.equal(adminMaterial.statusCode, 200)
  assert.deepEqual(adminMaterial.rawPayload, Buffer.from(onePixelPng, 'base64'))

  const exchange = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${application.id}/exchange`,
    headers: { authorization: `Bearer ${trackingToken}` }
  })
  assert.equal(exchange.statusCode, 200)
  const exchanged = exchange.json().data
  assert.equal(exchanged.status, 'registration_verified')
  assert.ok(exchanged.registrationTicket)
  assert.equal(exchanged.identity.schoolSubject, undefined)
  assert.equal(exchanged.identity.idCardKey, undefined)
  assert.equal(exchanged.identity.idCardMasked, '4301**********1234')

  const registered = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username: 'manual_alumni',
      password: 'StrongManual!2026',
      registrationTicket: exchanged.registrationTicket
    }
  })
  assert.equal(registered.statusCode, 201)
  const account = registered.json().data.user
  assert.equal(account.schoolIdentityVerified, true)
  assert.equal(account.verificationSource, 'manual-identity-review')
  assert.match(account.alumniNo, /^HUFE-\d{4}-[A-F0-9]{8}$/)
  assert.equal(account.idCardKey, undefined)

  const storedAccount = app.services.database.read((data) => data.accounts.find((item) => item.username === 'manual_alumni'))
  assert.ok(storedAccount.idCardKey)
  assert.ok(storedAccount.studentIdKey)
  assert.equal(storedAccount.idCardMasked, '4301**********1234')
  const finalStorage = JSON.stringify(app.services.database.read((data) => data))
  assert.equal(finalStorage.includes(rawStudentId), false)
  assert.equal(finalStorage.includes(rawIdCard), false)
  assert.equal(finalStorage.includes(rawPhone), false)
  assert.equal(finalStorage.includes(trackingToken), false)

  const secondExchange = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${application.id}/exchange`,
    headers: { authorization: `Bearer ${trackingToken}` }
  })
  assert.equal(secondExchange.statusCode, 200)
  assert.deepEqual(secondExchange.json().data, { status: 'account_exists', loginRequired: true })
})

test('人工审核换票复用身份证 HMAC 唯一性检查且不能绕过既有账号', async (t) => {
  const { app, config, adminToken } = await fixture(t, 'duplicate')
  const rawIdCard = '430102196801011234'
  const idCardKey = hmac(`id-card:${rawIdCard}`, config.dataHashSecret)
  await app.services.accounts.register({
    schoolSubject: 'official-existing-subject',
    name: '已有实名校友',
    personType: 'alumni',
    department: '财政金融学院',
    idCardMasked: '4301**********1234',
    idCardKey,
    idCardVerified: true,
    alumniStatusVerified: true,
    verificationSource: 'school-registration-check',
    isAdmin: false
  }, { username: 'existing_alumni', password: 'StrongExisting!2026' })

  const created = await createDraft(app, { studentId: '' })
  const uploaded = await uploadMaterial(app, created.application.id, created.trackingToken)
  const submitted = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${created.application.id}/submit`,
    headers: { authorization: `Bearer ${created.trackingToken}` },
    payload: { expectedRevision: uploaded.application.revision }
  })
  let current = submitted.json().data
  const claimed = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${created.application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'claim', expectedRevision: current.revision }
  })
  current = claimed.json().data
  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${created.application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'approve', expectedRevision: current.revision }
  })
  assert.equal(approved.statusCode, 200)

  const exchange = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${created.application.id}/exchange`,
    headers: { authorization: `Bearer ${created.trackingToken}` }
  })
  assert.equal(exchange.statusCode, 200)
  assert.deepEqual(exchange.json().data, { status: 'account_exists', loginRequired: true })
  assert.equal(app.services.accounts.listAccounts({ query: 'existing_alumni' }).total, 1)

  const officialCheck = await app.services.accounts.checkRegistrationEligibility({
    schoolSubject: 'different-official-subject',
    name: '同一身份证',
    personType: 'alumni',
    department: '其他学院',
    idCardKey,
    idCardMasked: '4301**********1234',
    idCardVerified: true
  })
  assert.equal(officialCheck.status, 'account_exists')
})

test('人工审核发现多个旧账号时返回既有 conflictToken 并保留安全注册身份', async (t) => {
  const { app, config, adminToken } = await fixture(t, 'conflict')
  const rawIdCard = '430102196801011234'
  const idCardKey = hmac(`id-card:${rawIdCard}`, config.dataHashSecret)
  await app.services.accounts.register({
    schoolSubject: 'legacy-account-one',
    name: '重复账号校友',
    personType: 'alumni',
    department: '财政金融学院',
    idCardMasked: '4301**********1234',
    idCardKey,
    idCardVerified: true,
    alumniStatusVerified: true,
    verificationSource: 'school-registration-check',
    isAdmin: false
  }, { username: 'legacy_alumni_one', password: 'StrongExisting!2026' })
  await app.services.database.transaction((data) => {
    const original = data.accounts.find((item) => item.username === 'legacy_alumni_one')
    data.accounts.push({
      ...original,
      id: 'legacy-duplicate-account',
      username: 'legacy_alumni_two',
      usernameNormalized: 'legacy_alumni_two',
      schoolSubjectKey: app.services.accounts.subjectKey('legacy-account-two')
    })
  })

  const created = await createDraft(app, { studentId: '' })
  const uploaded = await uploadMaterial(app, created.application.id, created.trackingToken)
  let current = (await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verification/applications/${created.application.id}/submit`,
    headers: { authorization: `Bearer ${created.trackingToken}` },
    payload: { expectedRevision: uploaded.application.revision }
  })).json().data
  current = (await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${created.application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'claim', expectedRevision: current.revision }
  })).json().data
  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${created.application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'approve', expectedRevision: current.revision }
  })
  assert.equal(approved.statusCode, 200)

  const exchange = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verification/applications/${created.application.id}/exchange`,
    headers: { authorization: `Bearer ${created.trackingToken}` }
  })
  assert.equal(exchange.statusCode, 200)
  const conflict = exchange.json().data
  assert.equal(conflict.status, 'account_conflict')
  assert.equal(conflict.conflict.accountCount, 2)
  assert.ok(conflict.conflictToken)

  const resolved = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/registration/conflicts/${conflict.conflict.id}/resolve`,
    headers: { authorization: `Bearer ${conflict.conflictToken}` },
    payload: { action: 'recreate', confirmation: '确认注销全部旧账号并新注册' }
  })
  assert.equal(resolved.statusCode, 200)
  const result = resolved.json().data
  assert.equal(result.status, 'registration_verified')
  assert.ok(result.registrationTicket)
  const registered = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username: 'manual_conflict_resolved',
      password: 'StrongResolved!2026',
      registrationTicket: result.registrationTicket
    }
  })
  assert.equal(registered.statusCode, 201)
  const stored = app.services.database.read((data) => data.accounts.find((item) => item.username === 'manual_conflict_resolved'))
  assert.equal(stored.idCardKey, idCardKey)
  assert.equal(app.services.accounts.listAccounts({ status: 'active', query: 'legacy_alumni' }).total, 0)
})

test('人工申请提交校验材料完整性且驳回申请可补充后重新提交', async (t) => {
  const { app, adminToken } = await fixture(t, 'validation')
  const created = await createDraft(app)
  const missingMaterial = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${created.application.id}/submit`,
    headers: { authorization: `Bearer ${created.trackingToken}` },
    payload: { expectedRevision: created.application.revision }
  })
  assert.equal(missingMaterial.statusCode, 400)
  assert.equal(missingMaterial.json().code, 'MANUAL_VERIFICATION_INCOMPLETE')

  const uploaded = await uploadMaterial(app, created.application.id, created.trackingToken)
  let current = (await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${created.application.id}/submit`,
    headers: { authorization: `Bearer ${created.trackingToken}` },
    payload: { expectedRevision: uploaded.application.revision }
  })).json().data
  current = (await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${created.application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'claim', expectedRevision: current.revision }
  })).json().data
  current = (await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${created.application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'reject', reviewNote: '材料信息不清晰，请重新上传后提交。', expectedRevision: current.revision }
  })).json().data
  assert.equal(current.status, 'rejected')

  const updated = await app.inject({
    method: 'PATCH',
    url: `/api/v1/auth/manual-verifications/${created.application.id}`,
    headers: { authorization: `Bearer ${created.trackingToken}` },
    payload: { statement: '本人已重新核对全部材料，现补充说明并再次申请人工实名复核。', expectedRevision: current.revision }
  })
  assert.equal(updated.statusCode, 200)
  const resubmitted = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verifications/${created.application.id}/submit`,
    headers: { authorization: `Bearer ${created.trackingToken}` },
    payload: { expectedRevision: updated.json().data.revision }
  })
  assert.equal(resubmitted.statusCode, 200)
  assert.equal(resubmitted.json().data.status, 'submitted')
})

test('trackingToken 在服务端 90 天到期且有效 token 过期后统一返回 410', async (t) => {
  const { app } = await fixture(t, 'expiry')
  const created = await createDraft(app)
  assert.equal(created.expiresAt, created.trackingExpiresAt)
  assert.ok(Date.parse(created.expiresAt) > Date.now())

  await app.services.database.transaction((data) => {
    const application = data.manualIdentityVerifications.find((item) => item.id === created.application.id)
    application.trackingExpiresAt = new Date(Date.now() - 1000).toISOString()
  })
  const expired = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/manual-verification/applications/${created.application.id}`,
    headers: { authorization: `Bearer ${created.trackingToken}` }
  })
  assert.equal(expired.statusCode, 410)
  assert.equal(expired.json().code, 'MANUAL_VERIFICATION_TRACKING_EXPIRED')

  const wrongTokenStillUnauthorized = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/manual-verification/applications/${created.application.id}`,
    headers: { authorization: 'Bearer wrong-tracking-token-value-that-is-long-enough-000000' }
  })
  assert.equal(wrongTokenStillUnauthorized.statusCode, 401)
  assert.equal(wrongTokenStillUnauthorized.json().code, 'MANUAL_VERIFICATION_TRACKING_INVALID')
})

test('取消申请清空材料引用并删除私有文件，后台默认隐藏草稿和已取消', async (t) => {
  const { app, adminToken } = await fixture(t, 'cancel')
  const cancelledDraft = await createDraft(app)
  const uploaded = await uploadMaterial(app, cancelledDraft.application.id, cancelledDraft.trackingToken)
  const storedMaterial = app.services.database.read((data) => data.manualIdentityVerifications
    .find((item) => item.id === cancelledDraft.application.id).materials[0])
  const privatePath = path.join(app.services.media.privateDirectory, storedMaterial.filename)
  await fs.access(privatePath)

  const cancelled = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verification/applications/${cancelledDraft.application.id}/cancel`,
    headers: { authorization: `Bearer ${cancelledDraft.trackingToken}` },
    payload: { expectedRevision: uploaded.application.revision }
  })
  assert.equal(cancelled.statusCode, 200)
  assert.equal(cancelled.json().data.status, 'cancelled')
  assert.deepEqual(cancelled.json().data.materials, [])
  assert.equal(JSON.stringify(cancelled.json()).includes(storedMaterial.filename), false)
  assert.equal(app.services.database.read((data) => data.manualIdentityVerifications
    .find((item) => item.id === cancelledDraft.application.id).materials.length), 0)
  await assert.rejects(() => fs.access(privatePath), (error) => error.code === 'ENOENT')

  const closedMaterial = await app.inject({
    method: 'GET',
    url: uploaded.material.url,
    headers: { authorization: `Bearer ${cancelledDraft.trackingToken}` }
  })
  assert.equal(closedMaterial.statusCode, 403)
  assert.equal(closedMaterial.json().code, 'MANUAL_VERIFICATION_MATERIAL_ACCESS_CLOSED')

  const remainingDraft = await createDraft(app, { name: '仍在草稿' })
  assert.equal(remainingDraft.application.status, 'draft')
  const defaultList = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/manual-verifications',
    headers: { authorization: `Bearer ${adminToken}` }
  })
  assert.equal(defaultList.statusCode, 200)
  assert.equal(defaultList.json().data.total, 0)
  const cancelledList = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/manual-verifications?status=cancelled',
    headers: { authorization: `Bearer ${adminToken}` }
  })
  assert.equal(cancelledList.json().data.total, 1)
  const draftList = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/manual-verifications?status=draft',
    headers: { authorization: `Bearer ${adminToken}` }
  })
  assert.equal(draftList.json().data.total, 1)
})

test('人工复核在创建、更新、提交和通过阶段均只允许 alumni', async (t) => {
  const { app, adminToken } = await fixture(t, 'alumni-only')
  const disallowedCreate = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/manual-verification/applications',
    payload: {
      name: '在校学生',
      personType: 'student',
      college: '财政金融学院',
      major: '财政学',
      enrollmentYear: 2025,
      idCard: '430102200601011234',
      phone: '13800138001',
      statement: '本人尝试使用不适用于在校生的人工实名复核通道。'
    }
  })
  assert.equal(disallowedCreate.statusCode, 400)
  assert.equal(disallowedCreate.json().code, 'MANUAL_VERIFICATION_ALUMNI_ONLY')

  const submissionGuard = await createDraft(app, { name: '提交阶段校友限制' })
  const disallowedUpdate = await app.inject({
    method: 'PATCH',
    url: `/api/v1/auth/manual-verification/applications/${submissionGuard.application.id}`,
    headers: { authorization: `Bearer ${submissionGuard.trackingToken}` },
    payload: { personType: 'staff', expectedRevision: submissionGuard.application.revision }
  })
  assert.equal(disallowedUpdate.statusCode, 400)
  assert.equal(disallowedUpdate.json().code, 'MANUAL_VERIFICATION_ALUMNI_ONLY')
  await app.services.database.transaction((data) => {
    data.manualIdentityVerifications.find((item) => item.id === submissionGuard.application.id).profile.personType = 'staff'
  })
  const disallowedSubmit = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verification/applications/${submissionGuard.application.id}/submit`,
    headers: { authorization: `Bearer ${submissionGuard.trackingToken}` }
  })
  assert.equal(disallowedSubmit.statusCode, 400)
  assert.equal(disallowedSubmit.json().code, 'MANUAL_VERIFICATION_ALUMNI_ONLY')

  const approvalGuard = await createDraft(app, { name: '通过阶段校友限制' })
  const uploaded = await uploadMaterial(app, approvalGuard.application.id, approvalGuard.trackingToken)
  let current = (await app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verification/applications/${approvalGuard.application.id}/submit`,
    headers: { authorization: `Bearer ${approvalGuard.trackingToken}` },
    payload: { expectedRevision: uploaded.application.revision }
  })).json().data
  current = (await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${approvalGuard.application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'claim', expectedRevision: current.revision }
  })).json().data
  await app.services.database.transaction((data) => {
    data.manualIdentityVerifications.find((item) => item.id === approvalGuard.application.id).profile.personType = 'faculty'
  })
  const disallowedApprove = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/manual-verifications/${approvalGuard.application.id}/actions`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'approve', expectedRevision: current.revision }
  })
  assert.equal(disallowedApprove.statusCode, 400)
  assert.equal(disallowedApprove.json().code, 'MANUAL_VERIFICATION_ALUMNI_ONLY')
})

test('过期清理保留脱敏审核记录、删除全部私有材料且保持终态结论', async (t) => {
  const { app } = await fixture(t, 'cleanup')
  const cases = [
    { name: '过期未提交申请', status: 'draft' },
    { name: '过期已通过申请', status: 'approved' },
    { name: '过期已驳回申请', status: 'rejected' }
  ]
  const applications = []
  const privatePaths = []
  for (const item of cases) {
    const created = await createDraft(app, { name: item.name })
    const uploaded = await uploadMaterial(app, created.application.id, created.trackingToken)
    const stored = app.services.database.read((data) => data.manualIdentityVerifications
      .find((application) => application.id === created.application.id).materials[0])
    privatePaths.push(path.join(app.services.media.privateDirectory, stored.filename))
    applications.push({ ...item, id: created.application.id, revision: uploaded.application.revision })
  }
  await app.services.database.transaction((data) => {
    for (const item of applications) {
      const application = data.manualIdentityVerifications.find((candidate) => candidate.id === item.id)
      application.status = item.status
      application.reviewNote = item.status === 'approved' ? '已通过审核' : (item.status === 'rejected' ? '已驳回审核' : '')
      application.trackingExpiresAt = new Date(Date.now() - 1000).toISOString()
    }
  })

  const cleaned = await app.services.manualVerifications.cleanupExpired({ actor: 'system:cleanup-test' })
  assert.deepEqual(cleaned, {
    cleanedAt: cleaned.cleanedAt,
    expiredApplications: 3,
    removedMaterials: 3,
    queuedPrivateFiles: 3,
    deletedPrivateFiles: 3,
    failedPrivateFiles: 0,
    pendingPrivateFiles: 0,
    cancelledApplications: 1,
    preservedDecisions: 2
  })
  for (const file of privatePaths) {
    await assert.rejects(() => fs.access(file), (error) => error.code === 'ENOENT')
  }
  const records = app.services.database.read((data) => data.manualIdentityVerifications
    .filter((application) => applications.some((item) => item.id === application.id)))
  const draft = records.find((application) => application.id === applications[0].id)
  const approved = records.find((application) => application.id === applications[1].id)
  const rejected = records.find((application) => application.id === applications[2].id)
  assert.equal(draft.status, 'cancelled')
  assert.equal(draft.closureReason, 'tracking_expired')
  assert.equal(approved.status, 'approved')
  assert.equal(approved.reviewNote, '已通过审核')
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.reviewNote, '已驳回审核')
  for (const record of records) {
    assert.deepEqual(record.materials, [])
    assert.ok(record.expiryCleanupAt)
    assert.equal(record.history[0].action, 'tracking_expired')
  }
  const cleanupAudits = app.services.database.read((data) => data.auditLogs
    .filter((item) => item.action === 'manual_verification.tracking_expired_cleanup' && item.actor === 'system:cleanup-test'))
  assert.equal(cleanupAudits.length, 3)

  const idempotent = await app.services.manualVerifications.cleanupExpired({ actor: 'system:cleanup-test' })
  assert.equal(idempotent.expiredApplications, 0)
  assert.equal(idempotent.removedMaterials, 0)
  assert.equal(idempotent.queuedPrivateFiles, 0)
  assert.equal(idempotent.deletedPrivateFiles, 0)
  assert.equal(idempotent.pendingPrivateFiles, 0)
})

test('过期文件删除失败时材料引用仍立即撤销并由 orphan 队列重试', async (t) => {
  const { app, adminToken } = await fixture(t, 'cleanup-retry')
  const created = await createDraft(app, { name: '删除失败重试申请' })
  const uploaded = await uploadMaterial(app, created.application.id, created.trackingToken)
  const stored = app.services.database.read((data) => data.manualIdentityVerifications
    .find((application) => application.id === created.application.id).materials[0])
  const privatePath = path.join(app.services.media.privateDirectory, stored.filename)
  await app.services.database.transaction((data) => {
    data.manualIdentityVerifications.find((application) => application.id === created.application.id)
      .trackingExpiresAt = new Date(Date.now() - 1000).toISOString()
  })

  const originalRemovePrivate = app.services.media.removePrivate
  let failOnce = true
  app.services.media.removePrivate = async function removePrivateWithTransientFailure(filename) {
    if (failOnce) {
      failOnce = false
      throw Object.assign(new Error('transient delete failure'), { code: 'TRANSIENT_DELETE_FAILURE' })
    }
    return originalRemovePrivate.call(this, filename)
  }
  const firstCleanup = await app.services.manualVerifications.cleanupExpired({ actor: 'system:cleanup-retry-test' })
  assert.equal(firstCleanup.expiredApplications, 1)
  assert.equal(firstCleanup.removedMaterials, 1)
  assert.equal(firstCleanup.deletedPrivateFiles, 0)
  assert.equal(firstCleanup.failedPrivateFiles, 1)
  assert.equal(firstCleanup.pendingPrivateFiles, 1)
  const afterFailure = app.services.database.read((data) => data.manualIdentityVerifications
    .find((application) => application.id === created.application.id))
  assert.equal(afterFailure.status, 'cancelled')
  assert.deepEqual(afterFailure.materials, [])
  assert.equal(app.services.database.read((data) => data.manualVerificationMediaOrphans.length), 1)
  await fs.access(privatePath)
  const adminRead = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/manual-verifications/${created.application.id}/materials/${uploaded.material.id}`,
    headers: { authorization: `Bearer ${adminToken}` }
  })
  assert.equal(adminRead.statusCode, 404)
  const failedAudits = app.services.database.read((data) => data.auditLogs
    .filter((item) => item.action === 'manual_verification.expired_material_delete_failed'))
  assert.equal(failedAudits.length, 1)
  assert.equal(JSON.stringify(failedAudits).includes(stored.filename), false)

  app.services.media.removePrivate = originalRemovePrivate
  const retried = await app.services.manualVerifications.cleanupExpired({ actor: 'system:cleanup-retry-test' })
  assert.equal(retried.expiredApplications, 0)
  assert.equal(retried.deletedPrivateFiles, 1)
  assert.equal(retried.failedPrivateFiles, 0)
  assert.equal(retried.pendingPrivateFiles, 0)
  assert.equal(app.services.database.read((data) => data.manualVerificationMediaOrphans.length), 0)
  await assert.rejects(() => fs.access(privatePath), (error) => error.code === 'ENOENT')
})

test('上传处理中 tracking 过期时，清理事务阻止晚到材料重新挂接', async (t) => {
  const { app } = await fixture(t, 'race')
  const created = await createDraft(app, { name: '并发过期申请' })
  const originalSavePrivate = app.services.media.savePrivate
  let savedUpload = null
  let releaseUpload
  let signalSaved
  const saved = new Promise((resolve) => { signalSaved = resolve })
  const released = new Promise((resolve) => { releaseUpload = resolve })
  app.services.media.savePrivate = async function pausedPrivateSave(input, metadata) {
    const result = await originalSavePrivate.call(this, input, metadata)
    savedUpload = result
    signalSaved()
    await released
    return result
  }

  const uploadRequest = app.inject({
    method: 'POST',
    url: `/api/v1/auth/manual-verification/applications/${created.application.id}/materials`,
    headers: { authorization: `Bearer ${created.trackingToken}` },
    payload: {
      filename: '并发材料.png',
      materialType: 'graduation_certificate',
      label: '毕业证书',
      mimeType: 'image/png',
      dataBase64: onePixelPng
    }
  })
  await saved
  const inFlightPath = path.join(app.services.media.privateDirectory, savedUpload.filename)
  await fs.access(inFlightPath)
  await app.services.database.transaction((data) => {
    data.manualIdentityVerifications.find((application) => application.id === created.application.id)
      .trackingExpiresAt = new Date(Date.now() - 1000).toISOString()
  })
  const cleaned = await app.services.manualVerifications.cleanupExpired({ actor: 'system:cleanup-concurrency-test' })
  assert.equal(cleaned.expiredApplications, 1)
  assert.equal(cleaned.removedMaterials, 0)
  assert.equal(cleaned.queuedPrivateFiles, 0)
  releaseUpload()
  const response = await uploadRequest
  app.services.media.savePrivate = originalSavePrivate
  assert.equal(response.statusCode, 410)
  assert.equal(response.json().code, 'MANUAL_VERIFICATION_TRACKING_EXPIRED')
  const application = app.services.database.read((data) => data.manualIdentityVerifications
    .find((item) => item.id === created.application.id))
  assert.equal(application.status, 'cancelled')
  assert.deepEqual(application.materials, [])
  assert.equal(app.services.database.read((data) => data.manualVerificationMediaOrphans.length), 0)
  await assert.rejects(() => fs.access(inFlightPath), (error) => error.code === 'ENOENT')
})

test('服务重启自动清理过期材料并在 app close 停止小时任务', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-manual-verification-startup-cleanup-'))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    mediaDir: path.join(directory, 'media'),
    dataHashSecret: 'manual-startup-cleanup-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  let firstApp = null
  let secondApp = null
  let firstClosed = false
  let secondClosed = false
  t.after(async () => {
    if (secondApp && !secondClosed) await secondApp.close()
    if (firstApp && !firstClosed) await firstApp.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  firstApp = await buildApp({
    config,
    logger: false,
    refreshContent: false,
    scheduleContent: false,
    contentService: contentStub()
  })
  const created = await createDraft(firstApp, { name: '启动清理申请' })
  await uploadMaterial(firstApp, created.application.id, created.trackingToken)
  const stored = firstApp.services.database.read((data) => data.manualIdentityVerifications
    .find((application) => application.id === created.application.id).materials[0])
  const privatePath = path.join(firstApp.services.media.privateDirectory, stored.filename)
  await firstApp.services.database.transaction((data) => {
    data.manualIdentityVerifications.find((application) => application.id === created.application.id)
      .trackingExpiresAt = new Date(Date.now() - 1000).toISOString()
  })
  assert.ok(firstApp.services.manualVerifications.cleanupTimer)
  await firstApp.close()
  firstClosed = true
  assert.equal(firstApp.services.manualVerifications.cleanupTimer, null)

  secondApp = await buildApp({
    config,
    logger: false,
    refreshContent: false,
    scheduleContent: false,
    contentService: contentStub()
  })
  const cleaned = secondApp.services.database.read((data) => data.manualIdentityVerifications
    .find((application) => application.id === created.application.id))
  assert.equal(cleaned.status, 'cancelled')
  assert.equal(cleaned.closureReason, 'tracking_expired')
  assert.deepEqual(cleaned.materials, [])
  assert.equal(cleaned.history[0].action, 'tracking_expired')
  assert.equal(secondApp.services.database.read((data) => data.auditLogs.some((item) => (
    item.action === 'manual_verification.tracking_expired_cleanup'
    && item.actor === 'system:manual-verification-expiry'
  ))), true)
  await assert.rejects(() => fs.access(privatePath), (error) => error.code === 'ENOENT')
  assert.ok(secondApp.services.manualVerifications.cleanupTimer)
  await secondApp.close()
  secondClosed = true
  assert.equal(secondApp.services.manualVerifications.cleanupTimer, null)
})
