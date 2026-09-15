import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const validCreditCode = '91310000677833266F'

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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-enterprise-certification-'))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    mediaDir: path.join(directory, 'media'),
    dataHashSecret: 'enterprise-certification-flow-secret',
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
    department: options.department || '信息技术与管理学院',
    verificationSource: 'school-registration-check',
    isAdmin: Boolean(options.isAdmin)
  }, { username, password: 'StrongPass!2026' })

  const admin = await register('enterprise-admin', 'enterprise_admin', '企业平台主管', {
    isAdmin: true,
    personType: 'staff',
    department: '校友工作办公室'
  })
  const owner = await register('enterprise-owner', 'enterprise_owner', '企业校友甲')
  const other = await register('enterprise-other', 'enterprise_other', '企业校友乙')
  const unverified = await register('enterprise-unverified', 'enterprise_unverified', '未实名用户')
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
    directory,
    accounts: { admin, owner, other, unverified },
    headers: {
      admin: { authorization: `Bearer ${await login('enterprise_admin')}` },
      owner: { authorization: `Bearer ${await login('enterprise_owner')}` },
      other: { authorization: `Bearer ${await login('enterprise_other')}` },
      unverified: { authorization: `Bearer ${await login('enterprise_unverified')}` }
    }
  }
}

function enterprisePayload(overrides = {}) {
  return {
    name: '校友数智科技有限公司',
    industry: '数字科技',
    city: '长沙',
    foundedYear: 2024,
    scale: '成长型企业',
    address: '长沙市岳麓区',
    summary: '由学校实名校友提交并经后台核验的企业资料。',
    description: '专注可信数字化服务。',
    website: 'https://example.com/',
    contactName: '企业联系人',
    contactMethod: '通过平台联系',
    tags: ['校友企业', '数字科技'],
    unifiedSocialCreditCode: validCreditCode,
    ...overrides
  }
}

function jobPayload(overrides = {}) {
  return {
    title: '产品经理',
    city: '长沙',
    salary: '15-25K',
    employmentType: '全职',
    headcount: 3,
    experience: '3 年以上',
    education: '本科及以上',
    tags: ['双休', '五险一金'],
    deadline: '2027-12-31',
    description: '负责校友企业数字产品规划。',
    requirements: '具备产品与数据分析能力。',
    applicationMethod: '通过平台提交岗位申请。',
    ...overrides
  }
}

async function uploadMaterial(app, headers, overrides = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/business/enterprise-certifications/materials',
    headers,
    payload: {
      filename: '../../身份证-不得保留.png',
      materialType: 'business_license',
      mimeType: 'image/png',
      dataBase64: onePixelPng,
      ...overrides
    }
  })
}

test('企业认证材料私有存储、信用代码防重并在审核后唯一绑定所有者', async (t) => {
  const { app, headers, accounts } = await fixture(t)

  const unverifiedUpload = await uploadMaterial(app, headers.unverified)
  assert.equal(unverifiedUpload.statusCode, 403)
  assert.equal(unverifiedUpload.json().code, 'SCHOOL_IDENTITY_REQUIRED')

  const dataUrlRejected = await uploadMaterial(app, headers.owner, {
    dataBase64: `data:image/png;base64,${onePixelPng}`
  })
  assert.equal(dataUrlRejected.statusCode, 400)
  assert.equal(dataUrlRejected.json().code, 'MEDIA_BASE64_INVALID')

  const uploaded = await uploadMaterial(app, headers.owner)
  assert.equal(uploaded.statusCode, 201, uploaded.body)
  const uploadData = uploaded.json().data
  assert.equal(uploadData.material.materialType, 'business_license')
  assert.equal(uploadData.material.name, '营业执照.png')
  assert.equal(uploadData.material.filename, undefined)
  assert.equal(uploadData.material.dataBase64, undefined)
  assert.equal(uploadData.certification.status, 'draft')

  const storedMaterial = app.services.database.read((data) => {
    return data.business.resources['alumni-enterprises'][0].certificationMaterials[0]
  })
  assert.match(storedMaterial.filename, /^[0-9a-f-]{36}\.png$/u)
  const publicFileAttempt = await app.inject({
    method: 'GET',
    url: `/api/v1/media/${storedMaterial.filename}`
  })
  assert.equal(publicFileAttempt.statusCode, 404)

  const ownDraft = await app.inject({
    method: 'GET',
    url: '/api/v1/business/enterprise-certifications',
    headers: headers.owner
  })
  assert.equal(ownDraft.statusCode, 200)
  assert.equal(ownDraft.json().data.materials[0].filename, undefined)
  assert.equal(ownDraft.json().data.materials[0].url, undefined)

  const invalidCredit = await app.inject({
    method: 'POST',
    url: '/api/v1/business/enterprise-certifications',
    headers: headers.owner,
    payload: enterprisePayload({ unifiedSocialCreditCode: '913100006778332660' })
  })
  assert.equal(invalidCredit.statusCode, 400)
  assert.equal(invalidCredit.json().code, 'ENTERPRISE_CREDIT_CODE_INVALID')

  const forbiddenSortOrder = await app.inject({
    method: 'POST',
    url: '/api/v1/business/enterprise-certifications',
    headers: headers.owner,
    payload: enterprisePayload({ sortOrder: 9999 })
  })
  assert.equal(forbiddenSortOrder.statusCode, 400)
  assert.equal(forbiddenSortOrder.json().code, 'BUSINESS_PROTECTED_FIELD')

  const submitted = await app.inject({
    method: 'POST',
    url: '/api/v1/business/enterprise-certifications',
    headers: headers.owner,
    payload: enterprisePayload({ expectedRevision: ownDraft.json().data.revision })
  })
  assert.equal(submitted.statusCode, 201, submitted.body)
  assert.equal(submitted.json().data.status, 'pending_review')
  assert.equal(submitted.json().data.verificationStatus, 'pending')
  assert.equal(submitted.json().data.unifiedSocialCreditCode, undefined)
  assert.equal(submitted.json().data.unifiedSocialCreditCodeMasked, '91************266F')
  const enterpriseId = submitted.json().data.enterpriseId

  const rawData = app.services.database.read((data) => JSON.stringify(data))
  assert.equal(rawData.includes(validCreditCode), false)
  assert.equal(rawData.includes('../../身份证-不得保留.png'), false)

  const anonymousEnterprises = await app.inject({
    method: 'GET',
    url: '/api/v1/business/alumni-enterprises'
  })
  assert.equal(anonymousEnterprises.json().data.total, 0)

  const adminList = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/business/alumni-enterprises?verificationStatus=pending',
    headers: headers.admin
  })
  assert.equal(adminList.statusCode, 200)
  assert.equal(adminList.json().data.total, 1)
  assert.equal(adminList.json().data.items[0].unifiedSocialCreditCode, undefined)
  assert.equal(adminList.json().data.items[0].materials, undefined)
  assert.equal(adminList.json().data.items[0].materialCount, 1)
  assert.equal(adminList.json().data.items[0].applicant.id, accounts.owner.id)
  assert.equal(adminList.json().data.items[0].owner, null)

  const adminDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/business/alumni-enterprises/${enterpriseId}`,
    headers: headers.admin
  })
  assert.equal(adminDetail.statusCode, 200)
  assert.equal(adminDetail.json().data.unifiedSocialCreditCode, validCreditCode)
  assert.equal(adminDetail.json().data.materials.length, 1)
  assert.equal(adminDetail.json().data.materials[0].filename, undefined)
  assert.equal(adminDetail.json().data.certificationMaterials, undefined)

  const materialPreview = await app.inject({
    method: 'GET',
    url: adminDetail.json().data.materials[0].url,
    headers: headers.admin
  })
  assert.equal(materialPreview.statusCode, 200)
  assert.equal(materialPreview.headers['cache-control'], 'private, no-store')
  assert.equal(materialPreview.headers['content-type'], 'image/png')
  const unauthorizedPreview = await app.inject({
    method: 'GET',
    url: adminDetail.json().data.materials[0].url,
    headers: headers.other
  })
  assert.equal(unauthorizedPreview.statusCode, 403)

  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/alumni-enterprises/${enterpriseId}/actions`,
    headers: headers.admin,
    payload: { action: 'approve' }
  })
  assert.equal(approved.statusCode, 200, approved.body)
  assert.equal(approved.json().data.status, 'approved')
  assert.equal(approved.json().data.verificationStatus, 'verified')
  assert.equal(approved.json().data.owner.id, accounts.owner.id)
  assert.equal(approved.json().data.ownerAccountId, undefined)
  assert.equal(approved.json().data.certificationMaterials, undefined)

  const duplicateOwnerUpload = await uploadMaterial(app, headers.owner)
  assert.equal(duplicateOwnerUpload.statusCode, 409)
  assert.equal(duplicateOwnerUpload.json().code, 'ENTERPRISE_OWNER_ALREADY_BOUND')

  const published = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/alumni-enterprises/${enterpriseId}/actions`,
    headers: headers.admin,
    payload: { action: 'publish' }
  })
  assert.equal(published.statusCode, 200)
  assert.equal(published.json().data.status, 'published')

  const publicDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/alumni-enterprises/${enterpriseId}`
  })
  assert.equal(publicDetail.statusCode, 200)
  for (const key of [
    'ownerAccountId',
    'verificationStatus',
    'certificationApplicantAccountId',
    'certificationMaterials',
    'unifiedSocialCreditCode',
    'unifiedSocialCreditCodeMasked',
    'unifiedSocialCreditCodeKey',
    'unifiedSocialCreditCodeEncrypted',
    'enterpriseReviewedBy'
  ]) {
    assert.equal(publicDetail.json().data[key], undefined, key)
  }

  assert.equal((await uploadMaterial(app, headers.other)).statusCode, 201)
  const duplicateCredit = await app.inject({
    method: 'POST',
    url: '/api/v1/business/enterprise-certifications',
    headers: headers.other,
    payload: enterprisePayload({ name: '试图重复认证的企业' })
  })
  assert.equal(duplicateCredit.statusCode, 409)
  assert.equal(duplicateCredit.json().code, 'ENTERPRISE_CREDIT_CODE_DUPLICATE')

  const otherCertification = await app.inject({
    method: 'GET',
    url: '/api/v1/business/enterprise-certifications',
    headers: headers.other
  })
  const otherStoredFilename = app.services.database.read((data) => {
    return data.business.resources['alumni-enterprises']
      .find((item) => item.certificationApplicantAccountId === accounts.other.id)
      .certificationMaterials[0].filename
  })
  const cancelled = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/enterprise-certifications/${otherCertification.json().data.id}/cancel`,
    headers: headers.other,
    payload: { expectedRevision: otherCertification.json().data.revision }
  })
  assert.equal(cancelled.statusCode, 200)
  assert.equal(cancelled.json().data.status, 'cancelled')
  await assert.rejects(
    () => fs.access(path.join(app.services.media.enterprisePrivateDirectory, otherStoredFilename)),
    (error) => error.code === 'ENOENT'
  )
})

test('只有已认证企业所有者可送审岗位，后台审核发布且公开响应不泄露归属字段', async (t) => {
  const { app, headers, accounts } = await fixture(t)
  assert.equal((await uploadMaterial(app, headers.owner)).statusCode, 201)
  const submitted = await app.inject({
    method: 'POST',
    url: '/api/v1/business/enterprise-certifications',
    headers: headers.owner,
    payload: enterprisePayload()
  })
  const enterpriseId = submitted.json().data.id
  const enterpriseApproved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/alumni-enterprises/${enterpriseId}/actions`,
    headers: headers.admin,
    payload: { action: 'approve' }
  })
  assert.equal(enterpriseApproved.statusCode, 200)
  const enterprisePublished = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/alumni-enterprises/${enterpriseId}/actions`,
    headers: headers.admin,
    payload: { action: 'publish' }
  })
  assert.equal(enterprisePublished.statusCode, 200)

  const unownedCreate = await app.inject({
    method: 'POST',
    url: '/api/v1/business/me/jobs',
    headers: headers.other,
    payload: jobPayload()
  })
  assert.equal(unownedCreate.statusCode, 403)
  assert.equal(unownedCreate.json().code, 'ENTERPRISE_VERIFICATION_REQUIRED')

  const companySpoof = await app.inject({
    method: 'POST',
    url: '/api/v1/business/me/jobs',
    headers: headers.owner,
    payload: jobPayload({ company: '伪造企业名称', enterpriseId: 'fake-enterprise' })
  })
  assert.equal(companySpoof.statusCode, 400)
  assert.equal(companySpoof.json().code, 'BUSINESS_PROTECTED_FIELD')

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/business/me/jobs',
    headers: headers.owner,
    payload: jobPayload()
  })
  assert.equal(created.statusCode, 201, created.body)
  const job = created.json().data
  assert.equal(job.status, 'pending_review')
  assert.equal(job.company, '校友数智科技有限公司')
  assert.equal(job.enterpriseId, enterpriseId)
  assert.equal(job.headcount, 3)
  assert.equal(job.experience, '3 年以上')
  assert.equal(job.education, '本科及以上')
  assert.deepEqual(job.tags, ['双休', '五险一金'])
  assert.equal(job.authorAccountId, undefined)
  assert.equal(job.ownerEnterpriseId, undefined)

  for (const payload of [
    { company: '伪造企业名称' },
    { enterpriseId: 'fake-enterprise-id' }
  ]) {
    const tamperedByAdmin = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/business/jobs/${job.id}`,
      headers: headers.admin,
      payload
    })
    assert.equal(tamperedByAdmin.statusCode, 400)
    assert.equal(tamperedByAdmin.json().code, 'BUSINESS_PROTECTED_FIELD')
  }

  const publicBeforeReview = await app.inject({
    method: 'GET',
    url: `/api/v1/business/jobs/${job.id}`
  })
  assert.equal(publicBeforeReview.statusCode, 404)

  const adminJob = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/business/jobs/${job.id}`,
    headers: headers.admin
  })
  assert.equal(adminJob.statusCode, 200)
  assert.equal(adminJob.json().data.publisher.id, accounts.owner.id)
  assert.equal(adminJob.json().data.enterprise.id, enterpriseId)
  assert.equal(adminJob.json().data.authorAccountId, undefined)
  assert.equal(adminJob.json().data.ownerEnterpriseId, undefined)

  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/jobs/${job.id}/actions`,
    headers: headers.admin,
    payload: { action: 'approve' }
  })
  assert.equal(approved.statusCode, 200)
  assert.equal(approved.json().data.status, 'published')

  const publicJob = await app.inject({
    method: 'GET',
    url: `/api/v1/business/jobs/${job.id}`
  })
  assert.equal(publicJob.statusCode, 200)
  assert.equal(publicJob.json().data.company, '校友数智科技有限公司')
  assert.equal(publicJob.json().data.enterpriseId, enterpriseId)
  for (const key of ['authorAccountId', 'ownerEnterpriseId', 'publisher', 'enterprise']) {
    assert.equal(publicJob.json().data[key], undefined, key)
  }

  const forbiddenRename = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/enterprise-profile',
    headers: headers.owner,
    payload: {
      expectedRevision: (await app.inject({
        method: 'GET',
        url: '/api/v1/business/me/enterprise-profile',
        headers: headers.owner
      })).json().data.profile.revision,
      name: '湖财校友数智科技有限公司'
    }
  })
  assert.equal(forbiddenRename.statusCode, 400)
  assert.equal(forbiddenRename.json().code, 'BUSINESS_PROTECTED_FIELD')

  const profileUpdated = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/enterprise-profile',
    headers: headers.owner,
    payload: {
      expectedRevision: (await app.inject({
        method: 'GET',
        url: '/api/v1/business/me/enterprise-profile',
        headers: headers.owner
      })).json().data.profile.revision,
      industry: '人工智能与数字服务'
    }
  })
  assert.equal(profileUpdated.statusCode, 200)
  assert.equal(profileUpdated.json().data.profile.industry, '人工智能与数字服务')
  assert.equal(profileUpdated.json().data.profile.status, 'pending_review')
  assert.equal(profileUpdated.json().data.profile.publicationStatus, 'published')

  const publicEnterpriseWhilePending = await app.inject({
    method: 'GET',
    url: `/api/v1/business/alumni-enterprises/${enterpriseId}`
  })
  assert.equal(publicEnterpriseWhilePending.statusCode, 200)
  assert.equal(publicEnterpriseWhilePending.json().data.industry, '数字科技')
  assert.equal(publicEnterpriseWhilePending.json().data.pendingOwnerProfile, undefined)
  assert.equal(publicEnterpriseWhilePending.json().data.ownerProfileReviewStatus, undefined)

  const profileReview = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/business/alumni-enterprises/${enterpriseId}`,
    headers: headers.admin
  })
  assert.equal(profileReview.statusCode, 200)
  assert.equal(profileReview.json().data.status, 'pending_review')
  assert.equal(profileReview.json().data.publicationStatus, 'published')
  assert.equal(profileReview.json().data.industry, '人工智能与数字服务')

  const profileApproved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/alumni-enterprises/${enterpriseId}/actions`,
    headers: headers.admin,
    payload: { action: 'approve', reason: '企业资料核验通过' }
  })
  assert.equal(profileApproved.statusCode, 200, profileApproved.body)
  assert.equal(profileApproved.json().data.status, 'published')
  assert.equal(profileApproved.json().data.industry, '人工智能与数字服务')

  const publicEnterpriseAfterApproval = await app.inject({
    method: 'GET',
    url: `/api/v1/business/alumni-enterprises/${enterpriseId}`
  })
  assert.equal(publicEnterpriseAfterApproval.statusCode, 200)
  assert.equal(publicEnterpriseAfterApproval.json().data.industry, '人工智能与数字服务')

  const profileBeforeReject = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/enterprise-profile',
    headers: headers.owner
  })
  const secondProfileSubmission = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/enterprise-profile',
    headers: headers.owner,
    payload: {
      expectedRevision: profileBeforeReject.json().data.profile.revision,
      city: '株洲'
    }
  })
  assert.equal(secondProfileSubmission.statusCode, 200)
  const profileRejected = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/alumni-enterprises/${enterpriseId}/actions`,
    headers: headers.admin,
    payload: { action: 'reject', reason: '所在城市需要补充核验材料' }
  })
  assert.equal(profileRejected.statusCode, 200)
  assert.equal(profileRejected.json().data.status, 'rejected')
  assert.equal(profileRejected.json().data.publicationStatus, 'published')

  const ownerRejectedProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/enterprise-profile',
    headers: headers.owner
  })
  assert.equal(ownerRejectedProfile.json().data.profile.status, 'rejected')
  assert.equal(ownerRejectedProfile.json().data.profile.city, '株洲市')
  assert.equal(ownerRejectedProfile.json().data.profile.reviewNote, '所在城市需要补充核验材料')
  const publicEnterpriseAfterRejection = await app.inject({
    method: 'GET',
    url: `/api/v1/business/alumni-enterprises/${enterpriseId}`
  })
  assert.equal(publicEnterpriseAfterRejection.json().data.city, '长沙市')

  const correctedProfile = await app.inject({
    method: 'PUT',
    url: '/api/v1/business/me/enterprise-profile',
    headers: headers.owner,
    payload: {
      expectedRevision: ownerRejectedProfile.json().data.profile.revision,
      city: '湘潭'
    }
  })
  assert.equal(correctedProfile.statusCode, 200)
  assert.equal(correctedProfile.json().data.profile.status, 'pending_review')
  const correctedProfileApproved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/alumni-enterprises/${enterpriseId}/actions`,
    headers: headers.admin,
    payload: { action: 'approve', reason: '更正资料核验通过' }
  })
  assert.equal(correctedProfileApproved.statusCode, 200)
  const publicCorrectedEnterprise = await app.inject({
    method: 'GET',
    url: `/api/v1/business/alumni-enterprises/${enterpriseId}`
  })
  assert.equal(publicCorrectedEnterprise.json().data.city, '湘潭市')

  const resubmitted = await app.inject({
    method: 'PUT',
    url: `/api/v1/business/me/jobs/${job.id}`,
    headers: headers.owner,
    payload: {
      expectedRevision: approved.json().data.revision,
      title: '高级产品经理'
    }
  })
  assert.equal(resubmitted.statusCode, 200)
  assert.equal(resubmitted.json().data.status, 'pending_review')
  assert.equal(resubmitted.json().data.company, '校友数智科技有限公司')

  const otherEdit = await app.inject({
    method: 'PUT',
    url: `/api/v1/business/me/jobs/${job.id}`,
    headers: headers.other,
    payload: { title: '越权修改' }
  })
  assert.equal(otherEdit.statusCode, 403)

  const rejected = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/jobs/${job.id}/actions`,
    headers: headers.admin,
    payload: { action: 'reject', reason: '岗位说明需要补充' }
  })
  assert.equal(rejected.statusCode, 200)
  assert.equal(rejected.json().data.status, 'rejected')

  const mine = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/jobs',
    headers: headers.owner
  })
  assert.equal(mine.statusCode, 200)
  assert.equal(mine.json().data.items[0].rejectionReason, '岗位说明需要补充')

  const cancelled = await app.inject({
    method: 'PATCH',
    url: `/api/v1/business/me/jobs/${job.id}/cancel`,
    headers: headers.owner,
    payload: { expectedRevision: rejected.json().data.revision }
  })
  assert.equal(cancelled.statusCode, 200)
  assert.equal(cancelled.json().data.status, 'cancelled')
})
