import { auditRecord } from '../audit/metadata.js'
import { filterModuleRecords } from '../modules/catalog.js'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from 'node:crypto'
import { hmac } from '../auth/crypto.js'
import {
  allowedSubmissionTypes,
  businessResourceKeys,
  defaultStatuses,
  developmentBackfillResourceKeys,
  isBusinessResource,
  isStoredResource,
  mentorSelfEditableFields,
  mentorVerificationStatuses,
  publicCreateResources,
  publicStatuses,
  resourceFieldRules,
  resourceRequiredFields,
  strictBusinessResources,
  storedResourceKeys,
  submissionBackedResources
} from './definitions.js'
import { developmentBusinessSeeds } from './seeds.js'
import { normalizeOrganizationType } from './organization-categories.js'
import { communityLimits, normalizeCommunityTopics, extractCommunityTopics, postTopics } from './community.js'
import { anonymousFlag, createAnonymousIdentity, anonymousPresentation, anonymousPostView, anonymityAdminFields } from './community-anonymity.js'
import { academicAffiliations } from '../accounts/affiliations.js'
import { automaticOrganizationFingerprint, reconcileAutomaticOrganizations, optOutAutomaticOrganization } from './automatic-organizations.js'
import {validateGivingTemplate,verifyGivingBackground,givingTemplateSnapshot} from './giving-template.js'

const terminalSubmissionStatuses = ['cancelled', 'rejected', 'completed', 'closed']
const favoriteTypes = ['job-favorite', 'news-favorite']
const directSpeechTypes = new Set(['organization-message', 'community-comment'])
const visibleSpeechStatuses = ['published', 'approved', 'completed']
const organizationContentResources = new Set(['activities', 'announcements'])
const organizationMembershipStatuses = new Set(['approved', 'active', 'joined'])
const organizationHomeContentLimit = 50
const managedOrganizationContentLimit = 100
const notificationSubmissionActions = new Set(['approve', 'reject', 'start', 'complete', 'resolve', 'close', 'unpublish', 'publish'])
const notificationActionLabels = Object.freeze({
  approve: '已通过',
  reject: '未通过',
  start: '已开始办理',
  complete: '已办理完成',
  resolve: '已处理完成',
  close: '已关闭',
  unpublish: '已下架',
  publish: '已恢复展示'
})
const submissionTypeLabels = Object.freeze({
  'event-registration': '活动报名',
  'organization-membership': '组织加入申请',
  'organization-message': '组织留言',
  'job-application': '岗位申请',
  'mentor-application': '导师申请',
  'volunteer-application': '志愿服务申请',
  'giving-intent': '公益参与意向',
  'service-application': '服务申请',
  'campus-visit': '返校预约',
  feedback: '意见反馈',
  'community-report': '内容举报',
  'community-comment': '湖财圈评论',
  'benefit-claim': '校友权益领取'
})
const submissionNotificationTargets = Object.freeze({
  'event-registration': '/pages/events/index',
  'organization-membership': '/pages/chapters/index',
  'organization-message': '/pages/chapters/index',
  'job-application': '/pages/jobs/index',
  'mentor-application': '/pages/mentors/index',
  'volunteer-application': '/pages/volunteer/index',
  'giving-intent': '/pages/giving/index',
  'service-application': '/pages/services/index',
  'campus-visit': '/pages/campus-visit/index',
  feedback: '/pages/feedback/index',
  'community-report': '/pages/feedback/index',
  'community-comment': '/pages/community/index',
  'benefit-claim': '/pages/benefits/index?tab=mine'
})
const collaborationNotificationTarget = '/pages/collaboration/index?tab=mine'
const enterpriseNotificationTarget = '/pages/enterprises/index'
const jobOwnerNotificationTarget = '/pages/jobs/index'
const allowedNotificationTargets = new Set([
  ...Object.values(submissionNotificationTargets),
  collaborationNotificationTarget,
  enterpriseNotificationTarget,
  jobOwnerNotificationTarget
])
const allowedClientRoutes = new Set([
  '/pages/home/index',
  '/pages/services/index',
  '/pages/community/index',
  '/pages/mine/index',
  '/pages/verify/index',
  '/pages/official-news/index',
  '/pages/card/index',
  '/pages/events/index',
  '/pages/event-detail/index',
  '/pages/chapters/index',
  '/pages/chapter-detail/index',
  '/pages/chapter-manager/index',
  '/pages/chapter-publish/index',
  '/pages/directory/index',
  '/pages/campus-visit/index',
  '/pages/news-detail/index',
  '/pages/ecosystem/index',
  '/pages/enterprises/index',
  '/pages/collaboration/index',
  '/pages/academy/index',
  '/pages/alumni-map/index',
  '/pages/jobs/index',
  '/pages/mentors/index',
  '/pages/mentor-profile/index',
  '/pages/volunteer/index',
  '/pages/giving/index',
  '/pages/benefits/index',
  '/pages/inbox/index',
  '/pages/feedback/index',
  '/pages/about/index',
  '/pages/calendar/index'
])
const certificateProtectedFields = Object.freeze([
  'certificateTemplate',
  'templateSnapshot',
  'templateProjectRevision',
  'certificateProjectRevision',
  'expectedProjectRevision',
  'certificate',
  'certificateNo',
  'certificateNumber',
  'confirmedAmount',
  'confirmedAmountCents',
  'actualAmount',
  'actualAmountCents',
  'donatedAt',
  'officialReceiptNo',
  'officialReceiptNumber',
  'receiptNo',
  'receiptNumber',
  'recipientName',
  'issuer',
  'issuedAt'
])
const protectedSubmissionPayloadFields = new Set([
  'id',
  'number',
  'accountId',
  'actorSnapshot',
  'resourceType',
  'resourceId',
  'status',
  'revision',
  'createdAt',
  'updatedAt',
  'cancelledAt',
  'adminReply',
  'adminNote',
  'rejectionReason',
  'moderationNote',
  'reviewNote',
  'reviewedBy',
  'reviewedAt',
  'approvedBy',
  'approvedAt',
  'completedBy',
  'completedAt',
  ...certificateProtectedFields
])
const collaborationProtectedFields = [
  'id',
  'resource',
  'status',
  'revision',
  'authorAccountId',
  'authorName',
  'authorDepartment',
  'cancelledAt',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy'
]
const enterprisePublicProfileFields = Object.freeze([
  'name',
  'industry',
  'city',
  'regionCode',
  'foundedYear',
  'scale',
  'address',
  'logoUrl',
  'website',
  'contactName',
  'contactMethod',
  'summary',
  'description',
  'tags',
  'sortOrder'
])
const enterpriseCertificationInputFields = new Set([
  ...enterprisePublicProfileFields.filter((field) => field !== 'sortOrder'),
  'unifiedSocialCreditCode',
  'expectedRevision'
])
const enterpriseStoredProfileFields = [...enterprisePublicProfileFields, 'region']
const enterpriseProtectedFields = Object.freeze([
  'owner',
  'ownerAccountId',
  'applicant',
  'certificationApplicantAccountId',
  'certificationMaterials',
  'verificationStatus',
  'enterpriseVerifiedAt',
  'enterpriseReviewedAt',
  'enterpriseReviewedBy',
  'pendingOwnerProfile',
  'ownerProfileReviewStatus',
  'ownerProfileSubmittedAt',
  'ownerProfileReviewedAt',
  'ownerProfileReviewedBy',
  'ownerProfileReviewNote',
  'unifiedSocialCreditCode',
  'unifiedSocialCreditCodeMasked',
  'unifiedSocialCreditCodeKey',
  'unifiedSocialCreditCodeEncrypted'
])
const jobOwnerEditableFields = Object.freeze([
  'title',
  'city',
  'regionCode',
  'salary',
  'employmentType',
  'headcount',
  'experience',
  'education',
  'tags',
  'deadline',
  'description',
  'requirements',
  'applicationMethod'
])
const enterpriseOwnerEditableFields = Object.freeze([
  'industry',
  'city',
  'regionCode',
  'contactName',
  'contactMethod',
  'summary'
])
const enterpriseMaterialTypes = Object.freeze([
  'business_license',
  'authorization_letter',
  'alumni_relationship',
  'other_evidence'
])
const enterpriseMaterialLabels = Object.freeze({
  business_license: '营业执照',
  authorization_letter: '企业授权书',
  alumni_relationship: '校友关联证明',
  other_evidence: '其他证明材料'
})
const maximumEnterpriseMaterials = 6
const unifiedCreditAlphabet = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const unifiedCreditWeights = Object.freeze([1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28])

function now() { return new Date().toISOString() }

function businessError(message, code = 'BUSINESS_REQUEST_INVALID', statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode })
}

function expectedRevisionFrom(value) {
  if (value === undefined || value === null || value === '') return null
  const revision = Number(value)
  if (!Number.isInteger(revision) || revision < 1) {
    throw businessError('expectedRevision 必须是正整数', 'BUSINESS_REVISION_INVALID', 400)
  }
  return revision
}

function assertOnlyFields(payload, allowed, subject = '当前接口') {
  const attempted = Object.keys(payload).find((key) => !allowed.has(key))
  if (attempted) {
    throw businessError(`${subject}不允许设置字段 ${attempted}`, 'BUSINESS_PROTECTED_FIELD', 400)
  }
}

function normalizeUnifiedSocialCreditCode(value, secret) {
  const code = String(value || '').replace(/\s+/gu, '').toUpperCase()
  if (!/^[0-9ABCDEFGHJKLMNPQRTUWXY]{18}$/u.test(code)) {
    throw businessError('统一社会信用代码须为 18 位有效格式', 'ENTERPRISE_CREDIT_CODE_INVALID', 400)
  }
  const sum = unifiedCreditWeights.reduce((total, weight, index) => {
    return total + unifiedCreditAlphabet.indexOf(code[index]) * weight
  }, 0)
  const checkIndex = (31 - (sum % 31)) % 31
  if (unifiedCreditAlphabet[checkIndex] !== code[17]) {
    throw businessError('统一社会信用代码校验位无效', 'ENTERPRISE_CREDIT_CODE_INVALID', 400)
  }
  return {
    value: code,
    masked: `${code.slice(0, 2)}${'*'.repeat(12)}${code.slice(-4)}`,
    key: hmac(`enterprise-credit-code:${code}`, secret)
  }
}

function enterpriseEncryptionKey(secret) {
  return createHash('sha256').update(`hufe-enterprise-credit-code:${String(secret || '')}`).digest()
}

function encryptEnterpriseCreditCode(value, secret) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', enterpriseEncryptionKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

function decryptEnterpriseCreditCode(value, secret) {
  const [version, ivValue, tagValue, ciphertextValue, ...rest] = String(value || '').split('.')
  if (version !== 'v1' || rest.length || !ivValue || !tagValue || !ciphertextValue) return ''
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      enterpriseEncryptionKey(secret),
      Buffer.from(ivValue, 'base64url')
    )
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    return ''
  }
}

function accountSummary(account = {}) {
  if (!account?.id) return null
  return {
    id: account.id,
    username: account.username || '',
    name: account.name || '',
    department: account.department || '',
    personType: account.personType || 'member',
    status: account.status || '',
    schoolIdentityVerified: Boolean(account.schoolIdentityVerified)
  }
}

function requireSchoolVerifiedAccount(account) {
  if (!account?.schoolIdentityVerified) {
    throw businessError('该内容仅限已完成学校实名校验的账号查看', 'SCHOOL_IDENTITY_REQUIRED', 403)
  }
  return account
}

function ensureBusinessData(data) {
  if (!data.business || typeof data.business !== 'object') {
    data.business = { version: 1, revision: 0, resources: {}, submissions: [], reactions: [] }
  }
  data.business.version = 1
  data.business.revision = Number(data.business.revision || 0)
  data.business.resources ||= {}
  for (const key of storedResourceKeys) if (!Array.isArray(data.business.resources[key])) data.business.resources[key] = []
  if (!Array.isArray(data.business.submissions)) data.business.submissions = []
  if (!Array.isArray(data.business.reactions)) data.business.reactions = []
  if (!Array.isArray(data.business.notifications)) data.business.notifications = []
  if (!Array.isArray(data.business.inboxReads)) data.business.inboxReads = []
  if (!Array.isArray(data.business.enterpriseMediaOrphans)) data.business.enterpriseMediaOrphans = []
  return data.business
}

function audit(action, targetId, metadata = {}, details = {}) { return auditRecord(action, targetId, metadata, details) }

function createNotification(business, input = {}) {
  const accountId = String(input.accountId || '')
  if (!accountId) return null
  const requestedTarget = String(input.target || '')
  const notification = {
    id: randomUUID(),
    accountId,
    type: String(input.type || 'business.status_changed').slice(0, 120),
    title: String(input.title || '业务状态已更新').slice(0, 180),
    body: String(input.body || '').slice(0, 2000),
    resourceType: String(input.resourceType || '').slice(0, 120),
    resourceId: String(input.resourceId || '').slice(0, 120),
    status: String(input.status || '').slice(0, 40),
    target: allowedNotificationTargets.has(requestedTarget) ? requestedTarget : '',
    createdAt: now()
  }
  business.notifications.unshift(notification)
  return notification
}

function normalizedPostTopics(input, current = {}) {
  try {
    if (input.topics !== undefined && !Array.isArray(input.topics)) throw new Error('话题必须是列表')
    return normalizeCommunityTopics([
      ...(input.topics !== undefined ? input.topics : (input.topic !== undefined ? [input.topic] : postTopics(current))),
      ...extractCommunityTopics(input.content ?? current.content ?? '')
    ])
  } catch (error) { throw businessError(error.message, 'COMMUNITY_TOPIC_INVALID', 400) }
}

function selectedIds(value, limit, label) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > limit || value.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))) {
    throw businessError(`${label}列表无效或超过 ${limit} 项`, 'COMMUNITY_SELECTION_INVALID', 400)
  }
  return [...new Set(value)]
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) throw businessError('提交内容层级过深')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw businessError('数字字段无效')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 100_000) throw businessError('文本字段超过允许长度', 'BUSINESS_FIELD_TOO_LONG', 400)
    return value.trim()
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1))
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const output = {}
    for (const [key, child] of Object.entries(value).slice(0, 100)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) continue
      output[key] = sanitizeValue(child, depth + 1)
    }
    return output
  }
  throw businessError('提交内容包含不支持的字段类型')
}

function sanitizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw businessError('请求内容必须是对象')
  return sanitizeValue(value)
}

function sanitizeSubmissionPayload(value) {
  const payload = sanitizeObject(value)
  for (const key of protectedSubmissionPayloadFields) delete payload[key]
  return payload
}

function pageValues(input = {}) {
  const page = Math.max(1, Number(input.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(input.pageSize) || 20))
  return { page, pageSize }
}

function paginate(items, input = {}, revision = 0) {
  const { page, pageSize } = pageValues(input)
  const start = (page - 1) * pageSize
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize, revision }
}

function organizationPageInput(input = {}) {
  const page = Number(input.page ?? 1)
  const pageSize = Number(input.pageSize ?? 20)
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw businessError('分页参数无效，请使用有效的页码和每页人数', 'ORGANIZATION_PAGE_INVALID', 400)
  }
  return { ...input, page, pageSize }
}

function searchAndFilter(items, input = {}, resource = '', regions = null) {
  const query = String(input.query || '').trim().toLowerCase()
  const ignored = new Set(['page', 'pageSize', 'query'])
  const cityNames = new Map()
  const normalizedCity = (value) => {
    const name = String(value ?? '').trim()
    if (!regions || !name) return name
    if (!cityNames.has(name)) {
      // Resolve only known catalog aliases. Keep unrecognized historical names
      // exact, and never rewrite stored records merely to perform a lookup.
      try { cityNames.set(name, regions.selection({ city: name }, {}, true).city) }
      catch { cityNames.set(name, name) }
    }
    return cityNames.get(name)
  }
  return items.filter((item) => {
    for (const [key, value] of Object.entries(input)) {
      if (ignored.has(key) || value === '' || value === undefined || value === null) continue
      if (resource === 'community-posts' && key === 'topic') {
        if (!postTopics(item).some((topic) => topic.toLocaleLowerCase() === String(value).replace(/^#/, '').toLocaleLowerCase())) return false
        continue
      }
      const candidate = resource === 'organizations' && key === 'type' ? normalizeOrganizationType(item[key]) : item[key]
      if (key === 'city') {
        if (normalizedCity(candidate) !== normalizedCity(value)) return false
        continue
      }
      if (resource === 'organizations' && key === 'type') {
        if (candidate !== normalizeOrganizationType(value)) return false
        continue
      }
      if (Array.isArray(candidate)) {
        if (!candidate.map(String).includes(String(value))) return false
      } else if (String(candidate ?? '') !== String(value)) return false
    }
    if (!query) return true
    return JSON.stringify(item).toLowerCase().includes(query)
  })
}

function sortRecords(items, resource) {
  return [...items].sort((left, right) => {
    if (resource === 'academic-calendar' && left.startDate && right.startDate) {
      const dateOrder = String(left.startDate).localeCompare(String(right.startDate))
      if (dateOrder) return dateOrder
    }
    const order = Number(left.sortOrder ?? 9999) - Number(right.sortOrder ?? 9999)
    if (order) return order
    if (resource === 'activities' && left.startAt && right.startAt) return String(left.startAt).localeCompare(String(right.startAt))
    return String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''))
  })
}

function audienceAllows(audience, account) {
  const value = String(audience || 'all').trim().toLowerCase()
  if (!value || value === 'all') return true
  if (!account?.schoolIdentityVerified) return false
  const personType = String(account.personType || 'member').toLowerCase()
  if (value === 'campus') return ['student', 'faculty', 'staff'].includes(personType)
  if (value === 'faculty_staff') return ['faculty', 'staff'].includes(personType)
  return value === personType
}

function withinPublicationWindow(record, timestamp = Date.now()) {
  if (record.startAt) {
    const startsAt = Date.parse(record.startAt)
    if (Number.isFinite(startsAt) && startsAt > timestamp) return false
  }
  if (record.endAt) {
    const endsAt = Date.parse(record.endAt)
    if (Number.isFinite(endsAt) && endsAt < timestamp) return false
  }
  return true
}

function isPublicRecordVisible(resource, record, account = null) {
  if (!(publicStatuses[resource] || []).includes(record.status)) return false
  if (resource === 'community-posts') {
    const visibility = record.visibility || 'all'
    if (!account?.schoolIdentityVerified || account.status !== 'active') return false
    if (!['all', 'alumni', 'campus'].includes(visibility)) return false
    if (!audienceAllows(visibility, account)) return false
  }
  if (resource === 'collaboration-opportunities' && record.deadline) {
    const expiresAt = Date.parse(`${String(record.deadline).slice(0, 10)}T23:59:59.999+08:00`)
    if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) return false
  }
  if (['announcements', 'alumni-benefits'].includes(resource)) {
    if (!withinPublicationWindow(record)) return false
    if (!audienceAllows(record.audience, account)) return false
  }
  if (resource === 'academic-calendar' && !audienceAllows(record.audience, account)) return false
  return true
}

function hasPublicOrganizationParent(resource, record, business, account = null) {
  if (!organizationContentResources.has(resource) || !record.organizationId) return true
  const organization = business.resources.organizations
    .find((item) => item.id === record.organizationId)
  return Boolean(organization && isPublicRecordVisible('organizations', organization, account))
}

function currentAutomaticMembership(membership, account) {
  return !membership.automaticMembership || !membership.automaticAffiliationKey?.startsWith('academic:') || academicAffiliations(account).some(row => row.key === membership.automaticAffiliationKey)
}

function organizationMemberships(business, organizationId, accounts) {
  return business.submissions.filter((item) => (
    item.type === 'organization-membership'
    && item.resourceId === organizationId
    && organizationMembershipStatuses.has(item.status)
    && (!accounts || currentAutomaticMembership(item, accounts.find(account => account.id === item.accountId)))
  ))
}

function isOrganizationMember(business, organizationId, account) {
  if (!organizationId || !account?.id) return false
  return organizationMemberships(business, organizationId)
    .some((item) => item.accountId === account.id && currentAutomaticMembership(item, account))
}

function activityRegistrations(business, activityId) {
  return business.submissions.filter((item) => (
    item.type === 'event-registration'
    && item.resourceId === activityId
    && !['cancelled', 'rejected'].includes(item.status)
  ))
}

function isPublicRecordVisibleInBusiness(resource, record, business, account = null, options = {}) {
  return isPublicRecordVisible(resource, record, account)
    && hasPublicOrganizationParent(resource, record, business, account)
    && (
      resource !== 'announcements'
      || !record.organizationId
      || options.organizationHome === true
      || isOrganizationMember(business, record.organizationId, account)
    )
}

function publicOrganizationSummary(business, organizationId) {
  if (!organizationId) return null
  const organization = business.resources.organizations.find((item) => item.id === organizationId)
  if (!organization) return null
  return {
    id: organization.id,
    name: organization.name || '',
    type: normalizeOrganizationType(organization.type),
    city: organization.city || ''
  }
}

function publicRecord(record) {
  if (record.resource === 'community-posts' && record.anonymous === true) return anonymousPostView(record)
  const {
    authorAccountId, createdBy, updatedBy, moderationNote, adminNote, automaticAffiliation,
    applicantContact, contact, phone, email, contactName, contactPhone, contactMethod,
    ownerAccountId, verificationStatus, mentorOwnerBoundAt, mentorVerifiedAt,
    ownerEnterpriseId, certificationApplicantAccountId, certificationMaterials,
    certificationSubmittedAt, enterpriseVerifiedAt, enterpriseReviewedAt, enterpriseReviewedBy,
    pendingOwnerProfile, ownerProfileReviewStatus, ownerProfileSubmittedAt,
    ownerProfileReviewedAt, ownerProfileReviewedBy, ownerProfileReviewNote,
    unifiedSocialCreditCode, unifiedSocialCreditCodeMasked,
    unifiedSocialCreditCodeKey, unifiedSocialCreditCodeEncrypted,
    certificate, certificateNo, certificateNumber, confirmedAmount, confirmedAmountCents,
    actualAmount, actualAmountCents, donatedAt, officialReceiptNo, officialReceiptNumber,
    receiptNo, receiptNumber, recipientName, issuer, issuedAt,
    applicant, owner, publisher, enterprise,
    ...safe
  } = record
  return safe
}

function publicDirectoryRecord(record) {
  return {
    id: record.id,
    resource: record.resource,
    status: record.status,
    revision: record.revision,
    name: record.name,
    graduationYear: record.graduationYear,
    college: record.college,
    major: record.major,
    city: record.city,
    industry: record.industry,
    title: record.title,
    organization: record.organization,
    bio: record.bio,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}

function ownerSubmission(record) {
  const {
    accountId,
    actorSnapshot,
    adminNote,
    reviewedBy,
    approvedBy,
    completedBy,
    ...safe
  } = record
  return safe
}

function ownerCollaborationRecord(record) {
  const {
    authorAccountId, createdBy, updatedBy, moderationNote, adminNote,
    ...safe
  } = record
  return safe
}

function validateRequired(resource, input) {
  const missing = (resourceRequiredFields[resource] || []).find((key) => {
    const value = input[key]
    return value === undefined || value === null || (typeof value === 'string' && !value.trim())
  })
  if (missing) throw businessError(`缺少必填字段：${missing}`, 'BUSINESS_FIELD_REQUIRED', 400)
}

function normalizeLineEndings(value) {
  return String(value).replace(/\r\n?/g, '\n').trim()
}

function assertSafeCharacters(value, field) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) {
    throw businessError(`字段 ${field} 包含不支持的控制字符`, 'BUSINESS_FIELD_INVALID', 400)
  }
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase()
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
    || normalized === '::1'
}

function allowedHttpProtocol(parsed, options = {}) {
  if (parsed.protocol === 'https:') return true
  return parsed.protocol === 'http:'
    && options.allowLocalHttp === true
    && isLoopbackHostname(parsed.hostname)
}

function normalizeHttpUrl(value, field, options = {}) {
  const normalized = normalizeLineEndings(value)
  if (!normalized) return ''
  let parsed
  try { parsed = new URL(normalized) } catch {
    throw businessError(`字段 ${field} 不是有效网址`, 'BUSINESS_URL_INVALID', 400)
  }
  if (!allowedHttpProtocol(parsed, options) || !parsed.hostname || parsed.username || parsed.password) {
    throw businessError(`字段 ${field} 仅支持 HTTPS 网址（开发环境 localhost 可使用 HTTP）`, 'BUSINESS_URL_INVALID', 400)
  }
  return parsed.toString()
}

function isManagedMediaPath(value) {
  return /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp|gif)$/i.test(value)
}

function validMarkdownLink(destination, image, options = {}) {
  if (!destination || /[\u0000-\u0020\u007F]/u.test(destination) || destination.includes('\\')) return false
  if (image && isManagedMediaPath(destination)) return true
  if (/^https?:\/\//i.test(destination)) {
    try {
      const parsed = new URL(destination)
      return allowedHttpProtocol(parsed, options) && Boolean(parsed.hostname) && !parsed.username && !parsed.password
    } catch { return false }
  }
  if (image) return false
  if (/^mailto:/i.test(destination)) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(destination.slice(7))
  if (/^tel:/i.test(destination)) return /^\+?[0-9 ()-]{5,30}$/u.test(destination.slice(4))
  if (destination.startsWith('#')) return /^#[A-Za-z][\w:.-]{0,127}$/u.test(destination)
  if (destination.startsWith('/pages/')) {
    return !destination.includes('..') && !destination.startsWith('//') && /^\/pages\/[A-Za-z0-9/_-]+(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?(?:#[A-Za-z0-9_:.-]+)?$/u.test(destination)
  }
  return false
}

function validateMarkdownDestinations(value, field, options = {}) {
  const markdownLink = /(!?)\[[^\]\n]*\]\(\s*(?:<([^>\s]+)>|([^\s)>]+))/gu
  for (const match of value.matchAll(markdownLink)) {
    const destination = match[2] || match[3] || ''
    if (!validMarkdownLink(destination, match[1] === '!', options)) {
      throw businessError(`字段 ${field} 包含不安全或不受支持的 Markdown 链接`, 'BUSINESS_MARKDOWN_UNSAFE', 400)
    }
  }
  const angleLink = /<((?:https?:\/\/|mailto:|tel:)[^>\s]+)>/giu
  const withoutAutolinks = value.replace(angleLink, (whole, destination) => {
    if (!validMarkdownLink(destination, false, options)) {
      throw businessError(`字段 ${field} 包含不安全或不受支持的 Markdown 链接`, 'BUSINESS_MARKDOWN_UNSAFE', 400)
    }
    return ''
  })
  if (/<!--|<!DOCTYPE\b|<\s*\/?\s*[A-Za-z][^>]*>/iu.test(withoutAutolinks)) {
    throw businessError(`字段 ${field} 不允许嵌入 HTML，请使用 Markdown`, 'BUSINESS_MARKDOWN_UNSAFE', 400)
  }
}

function normalizeDate(value, field, includeTime) {
  const normalized = normalizeLineEndings(value)
  if (!normalized) return ''
  const pattern = includeTime
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/u
    : /^\d{4}-\d{2}-\d{2}$/u
  if (!pattern.test(normalized) || Number.isNaN(Date.parse(includeTime ? normalized : `${normalized}T00:00:00Z`))) {
    throw businessError(`字段 ${field} 的日期格式无效`, 'BUSINESS_DATE_INVALID', 400)
  }
  const [year, month, day] = normalized.slice(0, 10).split('-').map(Number)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw businessError(`字段 ${field} 的日期不存在`, 'BUSINESS_DATE_INVALID', 400)
  }
  if (includeTime) {
    // datetime-local 不包含时区。管理后台面向中国校内业务，必须按
    // Asia/Shanghai（固定 +08:00）解释后再规范为 UTC ISO，不能依赖
    // Node 进程或容器的本地时区。
    const hasExplicitOffset = /(?:Z|[+-]\d{2}:\d{2})$/u.test(normalized)
    const instant = new Date(hasExplicitOffset ? normalized : `${normalized}+08:00`)
    if (Number.isNaN(instant.getTime())) {
      throw businessError(`字段 ${field} 的日期格式无效`, 'BUSINESS_DATE_INVALID', 400)
    }
    return instant.toISOString()
  }
  return normalized
}

function normalizeRuleValue(value, field, rule, options = {}) {
  if (value === null || value === undefined) return value
  if (rule.type === 'number') {
    if (value === '') return null
    const normalized = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(normalized) || (rule.integer && !Number.isInteger(normalized))
      || (rule.min !== undefined && normalized < rule.min) || (rule.max !== undefined && normalized > rule.max)) {
      throw businessError(`字段 ${field} 的数字超出允许范围`, 'BUSINESS_FIELD_INVALID', 400)
    }
    return normalized
  }
  if (rule.type === 'tags') {
    if (!Array.isArray(value)) throw businessError(`字段 ${field} 必须是数组`, 'BUSINESS_FIELD_INVALID', 400)
    if (value.length > rule.maxItems) throw businessError(`字段 ${field} 的条目过多`, 'BUSINESS_FIELD_TOO_LONG', 400)
    return value.map((entry) => {
      if (typeof entry !== 'string') throw businessError(`字段 ${field} 包含无效条目`, 'BUSINESS_FIELD_INVALID', 400)
      const normalized = normalizeLineEndings(entry)
      assertSafeCharacters(normalized, field)
      if (!normalized || normalized.length > rule.itemMaxLength) throw businessError(`字段 ${field} 包含无效或过长条目`, 'BUSINESS_FIELD_TOO_LONG', 400)
      return normalized
    })
  }
  if (typeof value !== 'string') throw businessError(`字段 ${field} 必须是文本`, 'BUSINESS_FIELD_INVALID', 400)
  const normalized = normalizeLineEndings(value)
  assertSafeCharacters(normalized, field)
  if (rule.maxLength && normalized.length > rule.maxLength) {
    throw businessError(`字段 ${field} 最多允许 ${rule.maxLength} 个字符`, 'BUSINESS_FIELD_TOO_LONG', 400)
  }
  if (rule.values && normalized && !rule.values.includes(normalized)) {
    throw businessError(`字段 ${field} 的值不在允许范围内`, 'BUSINESS_FIELD_INVALID', 400)
  }
  if (rule.type === 'markdown' && normalized) validateMarkdownDestinations(normalized, field, options)
  if (rule.type === 'url') return normalizeHttpUrl(normalized, field, options)
  if (rule.type === 'asset-url') {
    if (!normalized || isManagedMediaPath(normalized)) return normalized
    return normalizeHttpUrl(normalized, field, options)
  }
  if (rule.type === 'route') {
    if (normalized && (!/^\/pages\/[A-Za-z0-9/_-]+(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?(?:#[A-Za-z0-9_:.-]+)?$/u.test(normalized) || normalized.includes('..'))) {
      throw businessError(`字段 ${field} 不是有效站内页面路径`, 'BUSINESS_URL_INVALID', 400)
    }
    const pathname = normalized.split(/[?#]/u, 1)[0]
    if (normalized && !allowedClientRoutes.has(pathname)) {
      throw businessError(`字段 ${field} 指向的站内页面不存在或不允许作为运营入口`, 'BUSINESS_URL_INVALID', 400)
    }
  }
  if (rule.type === 'date') return normalizeDate(normalized, field, false)
  if (rule.type === 'datetime') return normalizeDate(normalized, field, true)
  return normalized
}

function validateDateOrder(resource, record) {
  const pairs = resource === 'activities'
    ? [['startAt', 'endAt'], ['registrationDeadline', 'startAt']]
    : (resource === 'academic-calendar'
        ? [['startDate', 'endDate']]
        : (['giving-projects', 'home-config', 'announcements', 'alumni-benefits'].includes(resource) ? [['startAt', 'endAt']] : []))
  for (const [before, after] of pairs) {
    if (!record[before] || !record[after]) continue
    const beforeTime = Date.parse(record[before])
    const afterTime = Date.parse(record[after])
    const mustBeStrictlyEarlier = before === 'startAt'
      && after === 'endAt'
      && ['activities', 'announcements', 'alumni-benefits'].includes(resource)
    if (beforeTime > afterTime || (mustBeStrictlyEarlier && beforeTime === afterTime)) {
      throw businessError(
        mustBeStrictlyEarlier
          ? `字段 ${before} 必须早于 ${after}`
          : `字段 ${before} 不能晚于 ${after}`,
        'BUSINESS_DATE_ORDER_INVALID',
        400
      )
    }
  }
}

function validateAcademicCalendar(record) {
  const match = /^(\d{4})-(\d{4})$/u.exec(String(record.academicYear || ''))
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw businessError('字段 academicYear 必须使用连续学年的 YYYY-YYYY 格式', 'BUSINESS_FIELD_INVALID', 400)
  }
}

export function normalizeAdminPayload(resource, input, current = {}, options = {}) {
  const output = { ...input }
  if (resource === 'community-posts') {
    if (['anonymous', 'anonymousIdentity', 'publicationMode', 'anonymousNickname', 'authorName', 'initials', 'meta', 'avatar'].some(field => Object.hasOwn(output, field))) {
      throw businessError('发布身份与匿名形象由本人发布流程确定，后台不能修改', 'BUSINESS_PROTECTED_FIELD', 400)
    }
    if (['images', 'mediaIds', 'mentions', 'mentionAccountIds'].some((field) => Object.hasOwn(output, field))) {
      throw businessError('图片与提及人员由实名发帖流程绑定，后台不能伪造归属', 'BUSINESS_PROTECTED_FIELD', 400)
    }
    output.topics = normalizedPostTopics(output, current)
    output.topic = output.topics[0] || ''
  }
  const rules = resourceFieldRules[resource] || {}
  if (strictBusinessResources.includes(resource)) {
    const unknown = Object.keys(output).find((field) => !Object.prototype.hasOwnProperty.call(rules, field))
    if (unknown) throw businessError(`字段 ${unknown} 不受支持`, 'BUSINESS_FIELD_UNKNOWN', 400)
  }
  for (const [field, rule] of Object.entries(rules)) {
    if (Object.prototype.hasOwnProperty.call(output, field)) output[field] = normalizeRuleValue(output[field], field, rule, options)
  }
  if(rules.city && options.regions)Object.assign(output,options.regions.selection(output,current,['jobs','collaboration-opportunities'].includes(resource)))
  if (resource === 'organizations' && Object.prototype.hasOwnProperty.call(output, 'type')) {
    output.type = normalizeOrganizationType(output.type)
  }
  const merged = { ...current, ...output }
  if (resource === 'home-config' && Object.prototype.hasOwnProperty.call(merged, 'target')) {
    if (merged.targetType === 'url') output.target = normalizeHttpUrl(merged.target, 'target', options)
    if (merged.targetType === 'route') {
      output.target = normalizeRuleValue(merged.target, 'target', { type: 'route', maxLength: 500 }, options)
    }
  }
  if (resource === 'announcements' && Object.prototype.hasOwnProperty.call(merged, 'target')) {
    if (merged.targetType === 'url') output.target = normalizeHttpUrl(merged.target, 'target', options)
    if (merged.targetType === 'route') {
      output.target = normalizeRuleValue(merged.target, 'target', { type: 'route', maxLength: 500 }, options)
    }
    if (merged.targetType === 'none' && merged.target) {
      throw businessError('无需跳转的公告不能设置跳转目标', 'BUSINESS_FIELD_INVALID', 400)
    }
  }
  if (resource === 'announcements'
    && ['route', 'url'].includes(merged.targetType)
    && !String(merged.target || '').trim()) {
    throw businessError('公告跳转类型为 route 或 url 时必须设置跳转目标', 'BUSINESS_FIELD_REQUIRED', 400)
  }
  if (resource === 'community-posts') {
    if (!String(merged.content || '').trim() && !merged.images?.length) throw businessError('请填写文字或添加图片', 'COMMUNITY_CONTENT_INVALID', 400)
  } else validateRequired(resource, merged)
  if (resource === 'academic-calendar') validateAcademicCalendar(merged)
  validateDateOrder(resource, merged)
  return output
}

function accountSnapshot(account = {}) {
  return {
    id: account.id || '',
    name: account.name || account.username || '湖财用户',
    username: account.username || '',
    personType: account.personType || 'member',
    department: account.department || '',
    studentIdMasked: account.studentIdMasked || ''
  }
}

function mentorVerificationStatus(record = {}) {
  const value = String(record.verificationStatus || '')
  if (mentorVerificationStatuses.includes(value)) return value
  return record.ownerAccountId ? 'pending' : 'unverified'
}

function mentorOwnerSummary(account = {}) {
  if (!account?.id) return null
  return {
    id: account.id,
    username: account.username || '',
    name: account.name || '',
    department: account.department || '',
    personType: account.personType || 'member',
    status: account.status || '',
    schoolIdentityVerified: Boolean(account.schoolIdentityVerified)
  }
}

function mentorSelfProfile(record, eligible = false) {
  if (!record) return null
  return {
    ...publicRecord(record),
    verificationStatus: mentorVerificationStatus(record),
    canEdit: Boolean(eligible)
  }
}

function enterpriseVerificationStatus(record = {}) {
  const status = String(record.verificationStatus || '')
  if (['unverified', 'pending', 'verified', 'rejected'].includes(status)) return status
  if (record.ownerAccountId) return 'verified'
  if (record.status === 'pending_review') return 'pending'
  if (record.status === 'rejected') return 'rejected'
  return 'unverified'
}

function enterpriseOwnerProfileReviewStatus(record = {}) {
  const status = String(record.ownerProfileReviewStatus || '')
  return ['pending_review', 'rejected'].includes(status) ? status : ''
}

function enterprisePendingOwnerProfile(record = {}) {
  if (!record.pendingOwnerProfile
    || typeof record.pendingOwnerProfile !== 'object'
    || Array.isArray(record.pendingOwnerProfile)) return null
  const pending = {}
  for (const field of enterpriseStoredProfileFields) {
    if (Object.prototype.hasOwnProperty.call(record.pendingOwnerProfile, field)) {
      pending[field] = record.pendingOwnerProfile[field]
    }
  }
  return Object.keys(pending).length ? pending : null
}

function enterpriseProfileView(record, { canEdit = false } = {}) {
  if (!record) return null
  const reviewStatus = enterpriseOwnerProfileReviewStatus(record)
  const pending = reviewStatus ? enterprisePendingOwnerProfile(record) : null
  const source = pending ? { ...record, ...pending } : record
  const profile = {
    id: record.id,
    resource: 'alumni-enterprises',
    status: reviewStatus || record.status,
    publicationStatus: record.status,
    profileReviewStatus: reviewStatus,
    reviewNote: record.ownerProfileReviewNote || '',
    revision: Number(record.revision || 0),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    canEdit
  }
  for (const field of enterprisePublicProfileFields) {
    if (source[field] !== undefined) profile[field] = source[field]
  }
  return profile
}

function enterpriseMaterialView(record, material, { admin = false } = {}) {
  const base = {
    id: material.id,
    materialId: material.id,
    materialType: material.materialType,
    name: material.name,
    mimeType: material.mimeType,
    size: material.size,
    uploadedAt: material.uploadedAt,
    requiresAuthorization: true
  }
  if (!admin) return base
  const url = `/api/v1/admin/business/alumni-enterprises/${record.id}/materials/${material.id}`
  return { ...base, url, downloadUrl: url }
}

function enterpriseCertificationView(record) {
  if (!record) return null
  const verificationStatus = enterpriseVerificationStatus(record)
  const status = String(record.status || 'draft')
  return {
    id: record.id,
    enterpriseId: record.id,
    status,
    verificationStatus,
    revision: Number(record.revision || 0),
    unifiedSocialCreditCodeMasked: record.unifiedSocialCreditCodeMasked || '',
    materialCount: Array.isArray(record.certificationMaterials) ? record.certificationMaterials.length : 0,
    materials: (record.certificationMaterials || []).map((item) => enterpriseMaterialView(record, item)),
    reviewNote: record.rejectionReason || '',
    submittedAt: record.certificationSubmittedAt || null,
    reviewedAt: record.enterpriseReviewedAt || null,
    cancelledAt: record.cancelledAt || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    canEdit: ['draft', 'rejected'].includes(status),
    canSubmit: ['draft', 'rejected'].includes(status),
    canCancel: ['draft', 'pending_review', 'rejected'].includes(status),
    enterprise: enterpriseProfileView(record, { canEdit: ['draft', 'rejected'].includes(status) })
  }
}

function enterpriseAdminView(record, data, secret, { includeSensitive = false } = {}) {
  const profileReviewStatus = enterpriseOwnerProfileReviewStatus(record)
  const pendingProfile = profileReviewStatus ? enterprisePendingOwnerProfile(record) : null
  const safe = { ...record, ...(pendingProfile || {}) }
  for (const field of enterpriseProtectedFields) delete safe[field]
  delete safe.certificationSubmittedAt
  delete safe.cancelledAt
  const applicant = data.accounts.find((item) => item.id === record.certificationApplicantAccountId)
  const owner = data.accounts.find((item) => item.id === record.ownerAccountId)
  const materials = Array.isArray(record.certificationMaterials) ? record.certificationMaterials : []
  return {
    ...safe,
    status: profileReviewStatus || record.status,
    publicationStatus: record.status,
    profileReviewStatus,
    profileReviewNote: record.ownerProfileReviewNote || '',
    recordKind: 'resource',
    verificationStatus: enterpriseVerificationStatus(record),
    unifiedSocialCreditCodeMasked: record.unifiedSocialCreditCodeMasked || '',
    ...(includeSensitive && record.unifiedSocialCreditCodeEncrypted
      ? { unifiedSocialCreditCode: decryptEnterpriseCreditCode(record.unifiedSocialCreditCodeEncrypted, secret) }
      : {}),
    materialCount: materials.length,
    ...(includeSensitive
      ? { materials: materials.map((item) => enterpriseMaterialView(record, item, { admin: true })) }
      : {}),
    applicant: accountSummary(applicant),
    owner: accountSummary(owner),
    submittedAt: record.certificationSubmittedAt || null,
    reviewedAt: record.enterpriseReviewedAt || null,
    cancelledAt: record.cancelledAt || null
  }
}

function jobSelfView(record) {
  const safe = publicRecord(record)
  return {
    ...safe,
    canEdit: ['pending_review', 'rejected', 'published', 'offline'].includes(record.status),
    canCancel: ['pending_review', 'rejected', 'published', 'offline'].includes(record.status)
  }
}

function jobAdminView(record, data) {
  const safe = { ...record }
  delete safe.authorAccountId
  delete safe.ownerEnterpriseId
  const publisher = data.accounts.find((item) => item.id === record.authorAccountId)
  const enterprise = data.business.resources['alumni-enterprises']
    .find((item) => item.id === (record.ownerEnterpriseId || record.enterpriseId))
  return {
    ...safe,
    recordKind: 'resource',
    publisher: accountSummary(publisher),
    enterprise: enterprise
      ? {
          id: enterprise.id,
          name: enterprise.name || '',
          status: enterprise.status || '',
          verificationStatus: enterpriseVerificationStatus(enterprise)
        }
      : null
  }
}

function verifiedEnterpriseForAccount(business, accountId) {
  const owned = business.resources['alumni-enterprises'].filter((item) => (
    item.ownerAccountId === accountId
    && enterpriseVerificationStatus(item) === 'verified'
    && item.status !== 'cancelled'
  ))
  if (owned.length > 1) {
    throw businessError('企业档案归属异常，请联系管理员处理', 'ENTERPRISE_PROFILE_CONFLICT', 409)
  }
  return owned[0] || null
}

function certificationEnterpriseForAccount(business, accountId) {
  const records = business.resources['alumni-enterprises'].filter((item) => (
    item.certificationApplicantAccountId === accountId
    && item.status !== 'cancelled'
  ))
  if (records.length > 1) {
    throw businessError('企业认证申请异常，请联系管理员处理', 'ENTERPRISE_CERTIFICATION_CONFLICT', 409)
  }
  return records[0] || null
}

function activeAccountIn(data, account) {
  const current = data.accounts.find((item) => item.id === account?.id && item.status === 'active')
  if (!current?.schoolIdentityVerified) {
    throw businessError('该操作仅限已完成学校实名校验的账号', 'SCHOOL_IDENTITY_REQUIRED', 403)
  }
  return current
}

function enterpriseMaterialName(materialType, mimeType) {
  const extension = ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  })[mimeType] || 'img'
  return `${enterpriseMaterialLabels[materialType] || '证明材料'}.${extension}`
}

function resourceForSubmission(type) {
  return ({
    'event-registration': 'activities',
    'organization-membership': 'organizations',
    'organization-message': 'organizations',
    'job-application': 'jobs',
    'job-favorite': 'jobs',
    'mentor-application': 'mentors',
    'volunteer-application': 'volunteers',
    'giving-intent': 'giving-projects',
    'service-application': 'service-catalog',
    'community-comment': 'community-posts',
    'community-report': 'community-posts',
    'benefit-claim': 'alumni-benefits'
  })[type] || ''
}

function submissionNumber(type, id) {
  const prefix = ({
    'campus-visit': 'VISIT', feedback: 'FB', 'service-application': 'SERVICE',
    'event-registration': 'EVENT', 'volunteer-application': 'VOL', 'benefit-claim': 'BENEFIT'
  })[type] || 'REQ'
  return `HUFE-${prefix}-${id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
}

function givingCertificateNumber(business) {
  const year = new Date().getUTCFullYear()
  const existing = new Set(business.submissions
    .map((item) => item.certificate?.certificateNo)
    .filter(Boolean))
  let certificateNo
  do {
    certificateNo = `HUFE-GIVING-${year}-${randomUUID().replace(/-/gu, '').slice(0, 12).toUpperCase()}`
  } while (existing.has(certificateNo))
  return certificateNo
}

function normalizedGivingCertificateInput(input, options = {}) {
  const body = sanitizeObject(input || {})
  const allowed = new Set([
    'action',
    'confirmedAmount',
    'donatedAt',
    'officialReceiptNo',
    'title',
    'note',
    'expectedProjectRevision',
    'expectedRevision'
  ])
  const attempted = Object.keys(body).find((key) => !allowed.has(key))
  if (attempted) {
    throw businessError(`公益证书签发不支持字段 ${attempted}`, 'GIVING_CERTIFICATE_FIELD_INVALID', 400)
  }
  const amount = typeof body.confirmedAmount === 'number'
    ? body.confirmedAmount
    : Number(body.confirmedAmount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000
    || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-8) {
    throw businessError('实际到账金额必须是大于 0 且最多保留两位小数的数字', 'GIVING_CERTIFICATE_AMOUNT_INVALID', 400)
  }
  const donatedAt = normalizeRuleValue(body.donatedAt, 'donatedAt', { type: 'date' }, options)
  if (!donatedAt) {
    throw businessError('请填写实际捐赠日期', 'GIVING_CERTIFICATE_DATE_REQUIRED', 400)
  }
  const officialReceiptNo = normalizeRuleValue(
    body.officialReceiptNo,
    'officialReceiptNo',
    { type: 'text', maxLength: 120 },
    options
  )
  if (!officialReceiptNo || officialReceiptNo.length < 2) {
    throw businessError('请填写有效的官方回执号', 'GIVING_CERTIFICATE_RECEIPT_REQUIRED', 400)
  }
  const title = normalizeRuleValue(
    body.title || '湖南财政经济学院公益捐赠证书',
    'title',
    { type: 'text', maxLength: 180 },
    options
  )
  const note = normalizeRuleValue(
    body.note || '',
    'note',
    { type: 'text', maxLength: 1000 },
    options
  )
  return {
    confirmedAmount: amount,
    donatedAt,
    officialReceiptNo,
    title,
    note,
    expectedRevision: expectedRevisionFrom(body.expectedRevision),
    expectedProjectRevision: expectedRevisionFrom(body.expectedProjectRevision)
  }
}

function submissionAdminView(submission, data) {
  const account = data.accounts.find((item) => item.id === submission.accountId)
  const snapshot = submission.actorSnapshot || accountSnapshot(account)
  const linkedResource = submission.resourceType
    ? data.business.resources[submission.resourceType]?.find((item) => item.id === submission.resourceId)
    : null
  const payload = submission.payload || {}
  return {
    ...payload,
    ...(submission.type === 'community-comment' ? { ...anonymityAdminFields(submission), authorAccountId: submission.accountId, authorUsername: account?.username || snapshot.username || '' } : {}),
    id: submission.id,
    recordKind: 'submission',
    submissionType: submission.type,
    resourceId: submission.resourceId,
    status: submission.status,
    revision: submission.revision,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
    applicantName: submission.type === 'community-comment' ? snapshot.name || account?.name || '' : payload.applicantName || snapshot.name,
    applicantContact: payload.contact || payload.phone || '',
    submitterName: submission.type === 'community-comment' ? snapshot.name || account?.name || '' : payload.anonymous ? '匿名用户' : (payload.submitterName || snapshot.name),
    volunteerName: submission.type === 'community-comment' ? snapshot.name || account?.name || '' : payload.volunteerName || snapshot.name,
    serviceTitle: payload.serviceTitle || linkedResource?.title || '',
    projectTitle: payload.projectTitle || linkedResource?.projectTitle || linkedResource?.title || linkedResource?.name || (submission.type === 'community-comment' ? String(linkedResource?.content || '').slice(0, 60) : ''),
    applicationNo: submission.number,
    bookingNo: submission.number,
    feedbackNo: submission.number,
    certificate: submission.certificate || null,
    ...(submission.type === 'giving-intent' ? {
      certificateTemplate: linkedResource?.certificateTemplate || null,
      certificateProjectRevision: linkedResource?.revision || null
    } : {}),
    adminReply: submission.adminReply || '',
    adminNote: submission.adminNote || '',
    rejectionReason: submission.rejectionReason || ''
  }
}

export class BusinessService {
  constructor(database, config) {
    this.database = database
    this.config = config
    this.normalizationOptions = {
      allowLocalHttp: ['development', 'test'].includes(String(config?.env || ''))
    }
  }

  async init() {
    return this.database.transaction((data) => {
      const preexistingResourceKeys = new Set(Object.keys(data.business?.resources || {}))
      const business = ensureBusinessData(data)
      const total = storedResourceKeys.reduce((sum, key) => sum + business.resources[key].length, 0)
      const seededResources = []
      const backfilledResources = []
      if (this.config.env === 'development') {
        const seeds = developmentBusinessSeeds()
        if (total === 0) {
          for (const key of storedResourceKeys) {
            business.resources[key] = structuredClone(seeds[key] || [])
            if (business.resources[key].length) seededResources.push(key)
          }
        } else {
          // 升级已有开发数据时，只为本期新增且尚不存在的板块补种子；绝不覆盖
          // 用户已维护的记录，也不会在重复启动时再次插入。
          for (const key of developmentBackfillResourceKeys) {
            if (preexistingResourceKeys.has(key) || business.resources[key].length || !seeds[key]?.length) continue
            business.resources[key] = structuredClone(seeds[key])
            backfilledResources.push(key)
          }
        }
        if (seededResources.length || backfilledResources.length) {
          business.revision += 1
          data.auditLogs.unshift(audit(
            backfilledResources.length ? 'business.development_ecosystem_backfilled' : 'business.development_seeded',
            'business',
            { actor: 'development-bootstrap' },
            { resources: backfilledResources.length ? backfilledResources : seededResources }
          ))
        }
      }
      reconcileAutomaticOrganizations(data, this.normalizationOptions.regions)
      return {
        revision: business.revision,
        seeded: seededResources.length > 0,
        backfilled: backfilledResources
      }
    })
  }

  revision() {
    return this.database.read((data) => ensureBusinessData(data).revision)
  }

  async syncAutomaticOrganizations() {
    const fingerprint = this.database.read(data => automaticOrganizationFingerprint(data, this.normalizationOptions.regions))
    if (fingerprint === this.automaticOrganizationsFingerprint) return { unchanged: true }
    const outcome = await this.database.transaction(data => {
      ensureBusinessData(data)
      const result = reconcileAutomaticOrganizations(data, this.normalizationOptions.regions)
      return { result, fingerprint: automaticOrganizationFingerprint(data, this.normalizationOptions.regions) }
    })
    this.automaticOrganizationsFingerprint = outcome.fingerprint
    return outcome.result
  }

  enterpriseMediaOrphans() {
    return this.database.read((data) => {
      return ensureBusinessData(data).enterpriseMediaOrphans.map((item) => ({ ...item }))
    })
  }

  async queueEnterpriseMediaOrphans(filenames, metadata = {}, error = null) {
    const normalized = [...new Set((filenames || [])
      .map((item) => String(item || ''))
      .filter((item) => /^[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/iu.test(item)))]
    if (!normalized.length) return { queued: 0 }
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const existing = new Set(business.enterpriseMediaOrphans.map((item) => item.filename))
      const timestamp = now()
      let queued = 0
      for (const filename of normalized) {
        if (existing.has(filename)) continue
        business.enterpriseMediaOrphans.push({
          filename,
          createdAt: timestamp,
          retryCount: 0,
          lastError: String(error?.code || error?.message || '').slice(0, 200)
        })
        queued += 1
      }
      if (queued) {
        data.auditLogs.unshift(audit('business.enterprise_material_orphan_queued', 'enterprise-media', metadata, {
          count: queued
        }))
      }
      return { queued }
    })
  }

  async resolveEnterpriseMediaOrphans(filenames, metadata = {}) {
    const resolved = new Set((filenames || []).map(String))
    if (!resolved.size) return { resolved: 0 }
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const before = business.enterpriseMediaOrphans.length
      business.enterpriseMediaOrphans = business.enterpriseMediaOrphans
        .filter((item) => !resolved.has(item.filename))
      const count = before - business.enterpriseMediaOrphans.length
      if (count) {
        data.auditLogs.unshift(audit('business.enterprise_material_orphan_resolved', 'enterprise-media', metadata, {
          count
        }))
      }
      return { resolved: count }
    })
  }

  enrich(resource, record, business, accountId = '', accounts = []) {
    const safe = resource === 'directory' ? publicDirectoryRecord(record) : (resource === 'community-posts' && record.anonymous === true ? anonymousPostView(record) : publicRecord(record))
    if (resource === 'community-posts') {
      const likes = business.reactions.filter((item) => item.type === 'community-like' && item.resourceId === record.id)
      const authors = new Set(accounts.filter((item) => item.status === 'active' && item.schoolIdentityVerified).map((item) => item.id))
      const comments = business.submissions.filter((item) => item.type === 'community-comment' && item.resourceId === record.id && visibleSpeechStatuses.includes(item.status) && authors.has(item.accountId))
      return { ...safe, likeCount: likes.length, displayLikeCount: likes.length, commentCount: comments.length, liked: Boolean(accountId && likes.some((item) => item.accountId === accountId)) }
    }
    if (resource === 'activities') {
      const registrations = activityRegistrations(business, record.id)
      return {
        ...safe,
        organization: publicOrganizationSummary(business, record.organizationId),
        registrationCount: registrations.length,
        joined: registrations.length,
        registered: Boolean(accountId && registrations.some((item) => item.accountId === accountId))
      }
    }
    if (resource === 'organizations') {
      const memberships = organizationMemberships(business, record.id, accounts)
      return { ...safe, type: normalizeOrganizationType(record.type), memberCount: Number(record.memberCount || record.members || 0) + memberships.length, members: Number(record.memberCount || record.members || 0) + memberships.length, joined: Boolean(accountId && memberships.some((item) => item.accountId === accountId)), automatic: Boolean(record.automaticAffiliation), ownMembershipId: memberships.find(item => item.accountId === accountId)?.id || '' }
    }
    if (resource === 'jobs') {
      const applications = business.submissions.filter((item) => item.type === 'job-application' && item.resourceId === record.id && !terminalSubmissionStatuses.includes(item.status))
      const favorites = business.submissions.filter((item) => item.type === 'job-favorite' && item.resourceId === record.id && item.status === 'active')
      return { ...safe, applicationCount: applications.length, applied: Boolean(accountId && applications.some((item) => item.accountId === accountId)), favorited: Boolean(accountId && favorites.some((item) => item.accountId === accountId)) }
    }
    if (resource === 'mentors') {
      const applications = business.submissions.filter((item) => item.type === 'mentor-application' && item.resourceId === record.id && !terminalSubmissionStatuses.includes(item.status))
      return { ...safe, applicationCount: applications.length, applied: Boolean(accountId && applications.some((item) => item.accountId === accountId)) }
    }
    if (resource === 'volunteers') {
      const applications = business.submissions.filter((item) => item.type === 'volunteer-application' && item.resourceId === record.id && !terminalSubmissionStatuses.includes(item.status))
      return { ...safe, applicationCount: applications.length, applied: Boolean(accountId && applications.some((item) => item.accountId === accountId)) }
    }
    if (resource === 'alumni-benefits') {
      const claims = business.submissions.filter((item) => item.type === 'benefit-claim'
        && item.resourceId === record.id
        && !['cancelled', 'rejected'].includes(item.status))
      return {
        ...safe,
        claimCount: claims.length,
        claimed: Boolean(accountId && claims.some((item) => item.accountId === accountId))
      }
    }
    if (resource === 'announcements') {
      return {
        ...safe,
        organization: publicOrganizationSummary(business, record.organizationId)
      }
    }
    return safe
  }

  listPublic(resource, input = {}, accountId = '') {
    if (!isStoredResource(resource) || !publicStatuses[resource]) throw businessError('业务板块不存在', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const account = accountId ? data.accounts.find((item) => item.id === accountId && item.status === 'active') : null
      if (resource === 'directory') requireSchoolVerifiedAccount(account)
      const visible = filterModuleRecords(data,resource,business.resources[resource])
        .filter((item) => isPublicRecordVisibleInBusiness(resource, item, business, account))
        .map((item) => this.enrich(resource, item, business, accountId, data.accounts))
      const filtered = sortRecords(searchAndFilter(visible, input, resource, this.normalizationOptions.regions), resource)
      return paginate(filtered, input, business.revision)
    })
  }

  communityHighlights(accountId = '') {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const account = data.accounts.find((item) => item.id === accountId && item.status === 'active') || null
      const visible = (resource) => filterModuleRecords(data,resource,business.resources[resource])
        .filter((item) => isPublicRecordVisibleInBusiness(resource, item, business, account))
        .map((item) => this.enrich(resource, item, business, accountId, data.accounts))
      const timestamp = (item) => Date.parse(item.publishedAt || item.createdAt) || 0
      const newest = (a, b) => timestamp(b) - timestamp(a) || String(a.id).localeCompare(String(b.id))
      const posts = visible('community-posts')
      const pinned = [
        ...visible('announcements').filter((item) => item.carouselPlacement === 'pinned').map((item) => ({ ...item, kind: 'announcement' })),
        ...posts.filter((item) => item.carouselPlacement === 'pinned').map((item) => ({ ...item, kind: 'post' }))
      ].sort((a, b) => (Number(a.kind === 'post' ? a.carouselSortOrder : a.sortOrder) || 0) - (Number(b.kind === 'post' ? b.carouselSortOrder : b.sortOrder) || 0) || newest(a, b)).slice(0, 6)
      const score = (item) => item.likeCount + 2 * item.commentCount
      const hot = posts.filter((item) => score(item) > 0)
        .sort((a, b) => score(b) - score(a) || newest(a, b)).slice(0, 5)
        .filter(item => item.carouselPlacement !== 'pinned')
      // Explicit DTO: never send private account IDs, moderation notes or protected image URLs.
      const describe = (item, placement) => ({
        id: item.id, kind: item.kind || 'post', placement,
        title: String(item.title || item.content || '分享了一组校园影像').slice(0, 180),
        summary: String(item.kind === 'announcement' ? item.summary || '' : item.authorName || '湖财人').slice(0, 160),
        createdAt: item.publishedAt || item.createdAt || '',
        likeCount: item.likeCount || 0, commentCount: item.commentCount || 0
      })
      return { items: [...pinned.map((item) => describe(item, 'pinned')), ...hot.map((item) => describe(item, 'hot'))], revision: business.revision }
    })
  }

  getPublic(resource, id, accountId = '') {
    if (!isStoredResource(resource) || !publicStatuses[resource]) throw businessError('业务板块不存在', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const account = accountId ? data.accounts.find((item) => item.id === accountId && item.status === 'active') : null
      if (resource === 'directory') requireSchoolVerifiedAccount(account)
      const record = filterModuleRecords(data,resource,business.resources[resource]).find((item) => (
        item.id === id && isPublicRecordVisibleInBusiness(resource, item, business, account)
      ))
      if (!record) throw businessError('内容不存在或已下架', 'BUSINESS_ITEM_NOT_FOUND', 404)
      return this.enrich(resource, record, business, accountId, data.accounts)
    })
  }

  organizationHome(id, accountId = '') {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const account = accountId
        ? data.accounts.find((item) => item.id === accountId && item.status === 'active')
        : null
      const organization = business.resources.organizations.find((item) => (
        item.id === id && isPublicRecordVisible('organizations', item, account)
      ))
      if (!organization) {
        throw businessError('校友组织不存在或已下架', 'BUSINESS_ITEM_NOT_FOUND', 404)
      }
      const visibleFor = (resource) => {
        const records = filterModuleRecords(data,resource,business.resources[resource])
          .filter((item) => (
            item.organizationId === id
            && isPublicRecordVisibleInBusiness(
              resource,
              item,
              business,
              account,
              { organizationHome: true }
            )
          ))
        return {
          total: records.length,
          items: sortRecords(records, resource)
            .slice(0, organizationHomeContentLimit)
            .map((item) => this.enrich(resource, item, business, accountId, data.accounts))
        }
      }
      const activities = visibleFor('activities')
      const announcements = visibleFor('announcements')
      return {
        organization: this.enrich('organizations', organization, business, accountId, data.accounts),
        activities: activities.items,
        announcements: announcements.items,
        activityTotal: activities.total,
        announcementTotal: announcements.total,
        contentLimit: organizationHomeContentLimit,
        revision: business.revision
      }
    })
  }

  organizationMembers(id, accountId, input = {}, resolveRole = () => 'member') {
    input = organizationPageInput(input)
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const viewer = data.accounts.find((item) => item.id === accountId && item.status === 'active')
      requireSchoolVerifiedAccount(viewer)
      const organization = business.resources.organizations.find((item) => (
        item.id === id && isPublicRecordVisible('organizations', item, viewer)
      ))
      if (!organization) throw businessError('校友组织不存在或已下架', 'BUSINESS_ITEM_NOT_FOUND', 404)
      const accountMap = new Map(data.accounts
        .filter((item) => item.status === 'active' && item.schoolIdentityVerified)
        .map((item) => [item.id, item]))
      const seen = new Set()
      const keyword = String(input.query || '').trim().toLocaleLowerCase()
      // Historical headcounts and pending applications are not roster entries.
      const memberships = organizationMemberships(business, id, data.accounts).slice().sort((a, b) => (
        String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        || String(a.id).localeCompare(String(b.id))
      ))
      const members = []
      for (const membership of memberships) {
        const member = accountMap.get(membership.accountId)
        if (!member || seen.has(member.id)) continue
        seen.add(member.id)
        if (keyword && !`${member.name || ''} ${member.department || ''}`.toLocaleLowerCase().includes(keyword)) continue
        // Whitelist only: submission payloads and identity snapshots contain private data.
        members.push({
          id: membership.id,
          name: member.name || '校友',
          department: member.department || '',
          personType: member.personType || 'member',
          role: resolveRole(data, member, id) === 'manager' ? 'manager' : 'member'
        })
      }
      return paginate(members, input, business.revision)
    })
  }

  organizationContact(id, accountId) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const viewer = data.accounts.find((item) => item.id === accountId && item.status === 'active')
      requireSchoolVerifiedAccount(viewer)
      const organization = business.resources.organizations.find((item) => item.id === id && isPublicRecordVisible('organizations', item, viewer))
      if (!organization) throw businessError('校友组织不存在或已下架', 'BUSINESS_ITEM_NOT_FOUND', 404)
      return { contactName: String(organization.contactName || ''), contactMethod: String(organization.contactPhone || organization.contactMethod || organization.contactEmail || ''), city: String(organization.city || '') }
    })
  }

  organizationMessages(id, accountId, input = {}) {
    return this.discussionMessages('organizations', 'organization-message', id, accountId, input)
  }

  communityComments(id, accountId, input = {}) {
    return this.discussionMessages('community-posts', 'community-comment', id, accountId, input)
  }

  discussionMessages(resource, type, id, accountId, input = {}) {
    input = organizationPageInput(input)
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const viewer = data.accounts.find((item) => item.id === accountId && item.status === 'active')
      requireSchoolVerifiedAccount(viewer)
      if (!business.resources[resource].some((item) => item.id === id && isPublicRecordVisible(resource, item, viewer))) {
        throw businessError('内容不存在或已下架', 'BUSINESS_ITEM_NOT_FOUND', 404)
      }
      const authors = new Map(data.accounts.filter((item) => item.status === 'active' && item.schoolIdentityVerified).map((item) => [item.id, item]))
      const messages = business.submissions.filter((item) => (
        item.type === type && item.resourceId === id && authors.has(item.accountId)
        && (visibleSpeechStatuses.includes(item.status) || (item.accountId === accountId && ['submitted', 'pending_review', 'processing', 'rejected'].includes(item.status)))
      )).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(a.id).localeCompare(String(b.id))).map((item) => ({
        id: item.id, ...(type === 'community-comment' && item.anonymous === true ? anonymousPresentation(item) : { authorName: authors.get(item.accountId).name || '校友', anonymous: false }), content: String(item.payload?.content || ''),
        createdAt: item.createdAt, reply: String(item.adminReply || ''), status: item.status, mine: item.accountId === accountId
      }))
      return paginate(messages, input, business.revision)
    })
  }

  managedOrganizationDetail(id) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const organization = business.resources.organizations.find((item) => item.id === id)
      if (!organization) {
        throw businessError('校友组织不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      }
      const memberships = organizationMemberships(business, organization.id, data.accounts)
      const memberCount = Number(organization.memberCount || organization.members || 0) + memberships.length
      const recordsFor = (resource) => {
        const records = filterModuleRecords(data,resource,business.resources[resource])
          .filter((item) => item.organizationId === id)
        return {
          total: records.length,
          items: sortRecords(records, resource)
            .slice(0, managedOrganizationContentLimit)
            .map((item) => {
              const registrationCount = resource === 'activities'
                ? activityRegistrations(business, item.id).length
                : 0
              return {
                ...item,
                ...(resource === 'activities'
                  ? { registrationCount, joined: registrationCount }
                  : {}),
                recordKind: 'resource'
              }
            })
        }
      }
      const activities = recordsFor('activities')
      const announcements = recordsFor('announcements')
      return {
        organization: {
          ...organization,
          memberCount,
          members: memberCount,
          recordKind: 'resource'
        },
        activities: activities.items,
        announcements: announcements.items,
        activityTotal: activities.total,
        announcementTotal: announcements.total,
        contentLimit: managedOrganizationContentLimit,
        revision: business.revision
      }
    })
  }

  async createOrganizationContent(resource, organizationId, input, metadata = {}, authorize = null) {
    if (!organizationContentResources.has(resource)) {
      throw businessError('该类型不能作为校友组织事项发布', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    }
    const payload = sanitizeObject(input || {})
    const allowedFields = new Set(Object.keys(resourceFieldRules[resource] || {}))
    allowedFields.delete('carouselPlacement') // Platform curation is not an organization-manager permission.
    const unsupported = Object.keys(payload).find((field) => !allowedFields.has(field))
    if (unsupported) {
      throw businessError(`字段 ${unsupported} 不受支持`, 'BUSINESS_FIELD_UNKNOWN', 400)
    }
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const organization = business.resources.organizations.find((item) => item.id === organizationId)
      if (!organization) {
        throw businessError('校友组织不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      }
      if (!isPublicRecordVisible('organizations', organization)) {
        throw businessError('校友组织尚未发布或已下架，不能发布组织事项', 'ORGANIZATION_NOT_PUBLISHED', 409)
      }
      if (authorize) authorize(data, { ...organization, recordKind: 'resource' })
      const normalized = normalizeAdminPayload(
        resource,
        {
          ...payload,
          organizationId,
          ...(resource === 'activities' ? { organizer: organization.name } : {})
        },
        {},
        this.normalizationOptions
      )
      const timestamp = now()
      const record = {
        id: randomUUID(),
        resource,
        ...normalized,
        status: 'published',
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: metadata.actor || 'organization-manager',
        updatedBy: metadata.actor || 'organization-manager'
      }
      business.resources[resource].unshift(record)
      business.revision += 1
      data.auditLogs.unshift(audit(
        'business.organization_content_published',
        record.id,
        metadata,
        { organizationId, resource }
      ))
      return { ...record, recordKind: 'resource' }
    })
  }

  async updateOrganizationContent(
    resource,
    organizationId,
    contentId,
    input,
    metadata = {},
    authorize = null
  ) {
    if (!organizationContentResources.has(resource)) {
      throw businessError('该类型不属于校友组织事项', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    }
    const payload = sanitizeObject(input || {})
    const expectedRevision = expectedRevisionFrom(payload.expectedRevision)
    delete payload.expectedRevision
    const allowedFields = new Set(Object.keys(resourceFieldRules[resource] || {}))
    allowedFields.delete('carouselPlacement')
    const unsupported = Object.keys(payload).find((field) => !allowedFields.has(field))
    if (unsupported) {
      throw businessError(`字段 ${unsupported} 不受支持`, 'BUSINESS_FIELD_UNKNOWN', 400)
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'organizationId')) {
      const requestedOrganizationId = String(payload.organizationId || '')
      if (requestedOrganizationId !== organizationId) {
        throw businessError('组织事项不能改绑到其他校友组织', 'BUSINESS_PROTECTED_FIELD', 400)
      }
      delete payload.organizationId
    }
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const organization = business.resources.organizations
        .find((item) => item.id === organizationId)
      if (!organization) {
        throw businessError('校友组织不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      }
      const record = business.resources[resource]
        .find((item) => item.id === contentId && item.organizationId === organizationId)
      if (!record) {
        throw businessError('组织事项不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      }
      if (authorize) {
        authorize(
          data,
          { ...organization, recordKind: 'resource' },
          { ...record, recordKind: 'resource' }
        )
      }
      if (expectedRevision !== null && Number(record.revision || 0) !== expectedRevision) {
        throw businessError('该记录已被其他管理员更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
      }
      const normalized = normalizeAdminPayload(
        resource,
        {
          ...payload,
          ...(resource === 'activities' ? { organizer: organization.name } : {})
        },
        record,
        this.normalizationOptions
      )
      Object.assign(record, normalized, {
        organizationId,
        ...(resource === 'activities' ? { organizer: organization.name } : {}),
        updatedAt: now(),
        updatedBy: metadata.actor || 'organization-manager',
        revision: Number(record.revision || 0) + 1
      })
      business.revision += 1
      data.auditLogs.unshift(audit(
        'business.organization_content_updated',
        record.id,
        metadata,
        { organizationId, resource }
      ))
      return { ...record, recordKind: 'resource' }
    })
  }

  async actOrganizationContent(
    resource,
    organizationId,
    contentId,
    input,
    metadata = {},
    authorize = null
  ) {
    if (!organizationContentResources.has(resource)) {
      throw businessError('该类型不属于校友组织事项', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    }
    const body = sanitizeObject(input || {})
    assertOnlyFields(body, new Set(['action', 'reason', 'expectedRevision']), '组织事项动作接口')
    const action = String(body.action || '')
    const allowedActions = resource === 'activities'
      ? new Set(['publish', 'unpublish', 'close', 'complete'])
      : new Set(['publish', 'unpublish'])
    if (!allowedActions.has(action)) {
      throw businessError('不支持的组织事项操作', 'BUSINESS_ACTION_INVALID', 400)
    }
    const expectedRevision = expectedRevisionFrom(body.expectedRevision)
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const organization = business.resources.organizations
        .find((item) => item.id === organizationId)
      if (!organization) {
        throw businessError('校友组织不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      }
      const record = business.resources[resource]
        .find((item) => item.id === contentId && item.organizationId === organizationId)
      if (!record) {
        throw businessError('组织事项不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      }
      if (authorize) {
        authorize(
          data,
          { ...organization, recordKind: 'resource' },
          { ...record, recordKind: 'resource' }
        )
      }
      if (expectedRevision !== null && Number(record.revision || 0) !== expectedRevision) {
        throw businessError('该记录已被其他管理员更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
      }
      if (action === 'publish' && organization.status !== 'published') {
        throw businessError(
          '校友组织尚未发布或已下架，不能发布组织事项',
          'ORGANIZATION_NOT_PUBLISHED',
          409
        )
      }
      const status = this.actionStatus(resource, action, 'resource')
      if (!status || !this.actionAllowed(action, record.status)) {
        throw businessError('当前状态不能执行该操作', 'BUSINESS_ACTION_STATE_INVALID', 409)
      }
      record.status = status
      if (resource === 'activities') record.organizer = organization.name
      const reason = String(body.reason || '').trim().slice(0, 1000)
      if (reason) record.adminNote = reason
      record.updatedAt = now()
      record.updatedBy = metadata.actor || 'organization-manager'
      record.revision = Number(record.revision || 0) + 1
      business.revision += 1
      data.auditLogs.unshift(audit(
        `business.organization_content_${action}`,
        record.id,
        metadata,
        { organizationId, resource, action, status, reason }
      ))
      return { ...record, recordKind: 'resource' }
    })
  }

  bootstrap(accountId = '') {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const account = accountId ? data.accounts.find((item) => item.id === accountId && item.status === 'active') : null
      const take = (resource, limit) => sortRecords(filterModuleRecords(data,resource,business.resources[resource])
        .filter((item) => isPublicRecordVisibleInBusiness(resource, item, business, account))
        .map((item) => this.enrich(resource, item, business, accountId, data.accounts)), resource).slice(0, limit)
      return {
        revision: business.revision,
        homeConfig: take('home-config', 30),
        serviceCatalog: take('service-catalog', 100),
        activities: take('activities', 6),
        organizations: take('organizations', 6),
        communityPosts: take('community-posts', 8),
        jobs: take('jobs', 6),
        mentors: take('mentors', 6),
        volunteers: take('volunteers', 6),
        givingProjects: take('giving-projects', 6),
        alumniEnterprises: take('alumni-enterprises', 6),
        collaborationOpportunities: take('collaboration-opportunities', 6),
        alumniAcademy: take('alumni-academy', 6),
        announcements: take('announcements', 10),
        alumniBenefits: take('alumni-benefits', 10),
        academicCalendar: take('academic-calendar', 50)
      }
    })
  }

  directoryCityStats() {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const counts = new Map()
      for (const profile of business.resources.directory) {
        if (!publicStatuses.directory.includes(profile.status)) continue
        const city = String(profile.city || '').trim()
        if (!city) continue
        counts.set(city, (counts.get(city) || 0) + 1)
      }
      const items = [...counts.entries()]
        .map(([city, count]) => ({ city, count }))
        .sort((left, right) => right.count - left.count || left.city.localeCompare(right.city, 'zh-CN'))
      const totalProfiles = items.reduce((sum, item) => sum + item.count, 0)
      return {
        items,
        total: totalProfiles,
        totalProfiles,
        totalCities: items.length,
        revision: business.revision
      }
    })
  }

  mentorAccess(account) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const current = data.accounts.find((item) => item.id === account?.id && item.status === 'active')
      if (!current?.schoolIdentityVerified) {
        return {
          eligible: false,
          verificationStatus: 'unverified',
          profile: null,
          reason: 'SCHOOL_IDENTITY_REQUIRED'
        }
      }
      const owned = business.resources.mentors.filter((item) => item.ownerAccountId === current.id)
      if (!owned.length) {
        return {
          eligible: false,
          verificationStatus: 'unverified',
          profile: null,
          reason: 'MENTOR_ROLE_REQUIRED'
        }
      }
      if (owned.length !== 1) {
        return {
          eligible: false,
          verificationStatus: 'unverified',
          profile: null,
          reason: 'MENTOR_PROFILE_CONFLICT'
        }
      }
      const profile = owned[0]
      const verificationStatus = mentorVerificationStatus(profile)
      const eligible = verificationStatus === 'verified'
      return {
        eligible,
        verificationStatus,
        profile: mentorSelfProfile(profile, eligible),
        ...(eligible ? {} : { reason: 'MENTOR_VERIFICATION_REQUIRED' })
      }
    })
  }

  async saveMyMentorProfile(account, input, metadata = {}) {
    if (!account?.schoolIdentityVerified) {
      throw businessError('该操作仅限已完成学校实名校验的账号', 'SCHOOL_IDENTITY_REQUIRED', 403)
    }
    const payload = sanitizeObject(input || {})
    const expectedRevisionValue = payload.expectedRevision
    delete payload.expectedRevision
    const expectedRevision = expectedRevisionValue === undefined || expectedRevisionValue === null || expectedRevisionValue === ''
      ? null
      : Number(expectedRevisionValue)
    if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
      throw businessError('expectedRevision 必须是正整数', 'BUSINESS_REVISION_INVALID', 400)
    }
    const attempted = Object.keys(payload).find((key) => !mentorSelfEditableFields.includes(key))
    if (attempted) {
      throw businessError(`字段 ${attempted} 不能由导师本人修改`, 'BUSINESS_PROTECTED_FIELD', 400)
    }
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const currentAccount = data.accounts.find((item) => item.id === account.id && item.status === 'active')
      if (!currentAccount?.schoolIdentityVerified) {
        throw businessError('该操作仅限已完成学校实名校验的账号', 'SCHOOL_IDENTITY_REQUIRED', 403)
      }
      const owned = business.resources.mentors.filter((item) => item.ownerAccountId === currentAccount.id)
      if (!owned.length) throw businessError('当前账号不是已绑定的导师', 'MENTOR_ROLE_REQUIRED', 403)
      if (owned.length !== 1) throw businessError('导师档案归属异常，请联系管理员处理', 'MENTOR_PROFILE_CONFLICT', 409)
      const profile = owned[0]
      if (mentorVerificationStatus(profile) !== 'verified') {
        throw businessError('导师认证尚未通过，暂不能编辑资料', 'MENTOR_VERIFICATION_REQUIRED', 403)
      }
      if (expectedRevision !== null && Number(profile.revision || 0) !== expectedRevision) {
        throw businessError('导师资料已在其他位置更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
      }
      const normalized = normalizeAdminPayload('mentors', payload, profile, this.normalizationOptions)
      Object.assign(profile, normalized, {
        // 实名字段永远由当前绑定账号回填，客户端无法伪造。
        name: currentAccount.name,
        department: currentAccount.department || '',
        updatedAt: now(),
        updatedBy: currentAccount.id,
        revision: Number(profile.revision || 0) + 1
      })
      business.revision += 1
      data.auditLogs.unshift(audit('business.mentor_self_updated', profile.id, metadata, {
        fields: Object.keys(normalized)
      }))
      return {
        eligible: true,
        verificationStatus: 'verified',
        profile: mentorSelfProfile(profile, true)
      }
    })
  }

  getMentorOwner(id) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const profile = business.resources.mentors.find((item) => item.id === id)
      if (!profile) throw businessError('导师档案不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      const owner = data.accounts.find((item) => item.id === profile.ownerAccountId)
      return {
        profileId: profile.id,
        verificationStatus: mentorVerificationStatus(profile),
        owner: mentorOwnerSummary(owner),
        boundAt: profile.mentorOwnerBoundAt || null,
        verifiedAt: profile.mentorVerifiedAt || null,
        revision: Number(profile.revision || 0)
      }
    })
  }

  async bindMentorOwner(id, accountId, metadata = {}, authorize = null) {
    const normalizedAccountId = String(accountId || '').trim()
    if (!normalizedAccountId) throw businessError('请选择要认证为导师的实名账号', 'MENTOR_OWNER_REQUIRED', 400)
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const profile = business.resources.mentors.find((item) => item.id === id)
      if (!profile) throw businessError('导师档案不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      if (authorize) authorize(data, { ...profile, recordKind: 'resource' })
      const owner = data.accounts.find((item) => item.id === normalizedAccountId && item.status === 'active')
      if (!owner) throw businessError('绑定账号不存在或不可用', 'ACCOUNT_NOT_FOUND', 404)
      if (!owner.schoolIdentityVerified) {
        throw businessError('导师所有者必须是学校实名账号', 'MENTOR_OWNER_IDENTITY_REQUIRED', 400)
      }
      const duplicate = business.resources.mentors.find((item) => item.id !== id && item.ownerAccountId === owner.id)
      if (duplicate) throw businessError('该实名账号已绑定其他导师档案', 'MENTOR_OWNER_ALREADY_BOUND', 409)
      const timestamp = now()
      Object.assign(profile, {
        ownerAccountId: owner.id,
        verificationStatus: 'verified',
        name: owner.name,
        department: owner.department || '',
        mentorOwnerBoundAt: profile.ownerAccountId === owner.id && profile.mentorOwnerBoundAt
          ? profile.mentorOwnerBoundAt
          : timestamp,
        mentorVerifiedAt: timestamp,
        updatedAt: timestamp,
        updatedBy: metadata.actor || 'admin',
        revision: Number(profile.revision || 0) + 1
      })
      business.revision += 1
      data.auditLogs.unshift(audit('business.mentor_owner_verified', profile.id, metadata, {
        ownerAccountId: owner.id
      }))
      return this.getMentorOwnerIn(data, profile)
    })
  }

  async unbindMentorOwner(id, metadata = {}, authorize = null) {
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const profile = business.resources.mentors.find((item) => item.id === id)
      if (!profile) throw businessError('导师档案不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      if (authorize) authorize(data, { ...profile, recordKind: 'resource' })
      const previousOwnerAccountId = profile.ownerAccountId || ''
      Object.assign(profile, {
        ownerAccountId: '',
        verificationStatus: 'unverified',
        mentorOwnerBoundAt: null,
        mentorVerifiedAt: null,
        updatedAt: now(),
        updatedBy: metadata.actor || 'admin',
        revision: Number(profile.revision || 0) + 1
      })
      business.revision += 1
      data.auditLogs.unshift(audit('business.mentor_owner_unbound', profile.id, metadata, {
        previousOwnerAccountId
      }))
      return this.getMentorOwnerIn(data, profile)
    })
  }

  getMentorOwnerIn(data, profile) {
    const owner = data.accounts.find((item) => item.id === profile.ownerAccountId)
    return {
      profileId: profile.id,
      verificationStatus: mentorVerificationStatus(profile),
      owner: mentorOwnerSummary(owner),
      boundAt: profile.mentorOwnerBoundAt || null,
      verifiedAt: profile.mentorVerifiedAt || null,
      revision: Number(profile.revision || 0)
    }
  }

  enterpriseAccess(account) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const current = data.accounts.find((item) => item.id === account?.id && item.status === 'active')
      if (!current?.schoolIdentityVerified) {
        return {
          eligible: false,
          verificationStatus: 'unverified',
          profile: null,
          certification: null,
          reason: 'SCHOOL_IDENTITY_REQUIRED'
        }
      }
      const owned = verifiedEnterpriseForAccount(business, current.id)
      const certification = certificationEnterpriseForAccount(business, current.id)
      if (owned) {
        return {
          eligible: true,
          verificationStatus: 'verified',
          profile: enterpriseProfileView(owned, { canEdit: true }),
          certification: enterpriseCertificationView(certification || owned)
        }
      }
      const verificationStatus = enterpriseVerificationStatus(certification || {})
      return {
        eligible: false,
        verificationStatus,
        profile: null,
        certification: enterpriseCertificationView(certification),
        reason: certification
          ? (verificationStatus === 'rejected' ? 'ENTERPRISE_CERTIFICATION_REJECTED' : 'ENTERPRISE_VERIFICATION_REQUIRED')
          : 'ENTERPRISE_CERTIFICATION_REQUIRED'
      }
    })
  }

  enterpriseCertification(account) {
    return this.enterpriseAccess(account).certification
  }

  async prepareEnterpriseCertificationMaterial(account, metadata = {}) {
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      if (verifiedEnterpriseForAccount(business, current.id)) {
        throw businessError('当前实名账号已绑定认证企业', 'ENTERPRISE_OWNER_ALREADY_BOUND', 409)
      }
      let record = certificationEnterpriseForAccount(business, current.id)
      if (!record) {
        const cancelled = [...business.resources['alumni-enterprises']]
          .filter((item) => item.certificationApplicantAccountId === current.id && item.status === 'cancelled')
          .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0]
        const timestamp = now()
        if (cancelled) {
          record = cancelled
          Object.assign(record, {
            status: 'draft',
            verificationStatus: 'unverified',
            certificationMaterials: [],
            pendingOwnerProfile: {},
            ownerProfileReviewStatus: '',
            ownerProfileSubmittedAt: null,
            ownerProfileReviewedAt: null,
            ownerProfileReviewedBy: '',
            ownerProfileReviewNote: '',
            cancelledAt: null,
            rejectionReason: '',
            updatedAt: timestamp,
            updatedBy: current.id,
            revision: Number(record.revision || 0) + 1
          })
          business.revision += 1
          data.auditLogs.unshift(audit('business.enterprise_certification_reopened', record.id, metadata))
        } else {
          record = {
            id: randomUUID(),
            resource: 'alumni-enterprises',
            status: 'draft',
            verificationStatus: 'unverified',
            ownerAccountId: '',
            certificationApplicantAccountId: current.id,
            certificationMaterials: [],
            pendingOwnerProfile: {},
            ownerProfileReviewStatus: '',
            ownerProfileSubmittedAt: null,
            ownerProfileReviewedAt: null,
            ownerProfileReviewedBy: '',
            ownerProfileReviewNote: '',
            unifiedSocialCreditCodeMasked: '',
            unifiedSocialCreditCodeKey: '',
            unifiedSocialCreditCodeEncrypted: '',
            enterpriseVerifiedAt: null,
            enterpriseReviewedAt: null,
            enterpriseReviewedBy: '',
            revision: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: current.id,
            updatedBy: current.id
          }
          business.resources['alumni-enterprises'].unshift(record)
          business.revision += 1
          data.auditLogs.unshift(audit('business.enterprise_certification_draft_created', record.id, metadata))
        }
      }
      if (!['draft', 'rejected'].includes(record.status)) {
        throw businessError('当前认证状态不能上传证明材料', 'ENTERPRISE_CERTIFICATION_NOT_EDITABLE', 409)
      }
      if ((record.certificationMaterials || []).length >= maximumEnterpriseMaterials) {
        throw businessError(`每份企业认证最多上传 ${maximumEnterpriseMaterials} 张图片`, 'ENTERPRISE_MATERIAL_LIMIT', 409)
      }
      return { enterpriseId: record.id, revision: Number(record.revision || 0) }
    })
  }

  async attachEnterpriseCertificationMaterial(account, enterpriseId, upload, input = {}, metadata = {}) {
    const materialType = String(input.materialType || 'other_evidence').trim()
    if (!enterpriseMaterialTypes.includes(materialType)) {
      throw businessError('企业证明材料类型无效', 'ENTERPRISE_MATERIAL_TYPE_INVALID', 400)
    }
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      const record = business.resources['alumni-enterprises'].find((item) => (
        item.id === enterpriseId && item.certificationApplicantAccountId === current.id
      ))
      if (!record) throw businessError('企业认证申请不存在', 'ENTERPRISE_CERTIFICATION_NOT_FOUND', 404)
      if (!['draft', 'rejected'].includes(record.status)) {
        throw businessError('当前认证状态不能上传证明材料', 'ENTERPRISE_CERTIFICATION_NOT_EDITABLE', 409)
      }
      record.certificationMaterials ||= []
      if (record.certificationMaterials.length >= maximumEnterpriseMaterials) {
        throw businessError(`每份企业认证最多上传 ${maximumEnterpriseMaterials} 张图片`, 'ENTERPRISE_MATERIAL_LIMIT', 409)
      }
      const material = {
        id: randomUUID(),
        filename: upload.filename,
        materialType,
        name: enterpriseMaterialName(materialType, upload.mimeType),
        mimeType: upload.mimeType,
        size: upload.size,
        uploadedAt: now()
      }
      record.certificationMaterials.push(material)
      record.updatedAt = material.uploadedAt
      record.updatedBy = current.id
      record.revision = Number(record.revision || 0) + 1
      business.revision += 1
      data.auditLogs.unshift(audit('business.enterprise_material_uploaded', record.id, metadata, {
        materialId: material.id,
        materialType,
        mimeType: material.mimeType,
        size: material.size
      }))
      return {
        certification: enterpriseCertificationView(record),
        material: enterpriseMaterialView(record, material)
      }
    })
  }

  async removeEnterpriseCertificationMaterial(account, materialId, metadata = {}) {
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      const record = certificationEnterpriseForAccount(business, current.id)
      if (!record) throw businessError('企业认证申请不存在', 'ENTERPRISE_CERTIFICATION_NOT_FOUND', 404)
      if (!['draft', 'rejected'].includes(record.status)) {
        throw businessError('当前认证状态不能删除证明材料', 'ENTERPRISE_CERTIFICATION_NOT_EDITABLE', 409)
      }
      const index = (record.certificationMaterials || []).findIndex((item) => item.id === materialId)
      if (index < 0) throw businessError('企业证明材料不存在', 'ENTERPRISE_MATERIAL_NOT_FOUND', 404)
      const [removed] = record.certificationMaterials.splice(index, 1)
      record.updatedAt = now()
      record.updatedBy = current.id
      record.revision = Number(record.revision || 0) + 1
      business.revision += 1
      data.auditLogs.unshift(audit('business.enterprise_material_removed', record.id, metadata, {
        materialId: removed.id
      }))
      return { certification: enterpriseCertificationView(record), filename: removed.filename }
    })
  }

  async submitEnterpriseCertification(account, input = {}, metadata = {}) {
    const payload = sanitizeObject(input || {})
    assertOnlyFields(payload, enterpriseCertificationInputFields, '企业认证申请')
    const expectedRevision = expectedRevisionFrom(payload.expectedRevision)
    delete payload.expectedRevision
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      if (verifiedEnterpriseForAccount(business, current.id)) {
        throw businessError('当前实名账号已绑定认证企业', 'ENTERPRISE_OWNER_ALREADY_BOUND', 409)
      }
      const record = certificationEnterpriseForAccount(business, current.id)
      if (!record) throw businessError('请先上传至少一份企业证明材料', 'ENTERPRISE_MATERIAL_REQUIRED', 400)
      if (!['draft', 'rejected'].includes(record.status)) {
        throw businessError('当前认证状态不能提交或重新提交', 'ENTERPRISE_CERTIFICATION_SUBMIT_INVALID', 409)
      }
      if (expectedRevision !== null && Number(record.revision || 0) !== expectedRevision) {
        throw businessError('企业认证申请已更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
      }
      if (!(record.certificationMaterials || []).length) {
        throw businessError('请先上传至少一份企业证明材料', 'ENTERPRISE_MATERIAL_REQUIRED', 400)
      }
      const existingCreditCode = decryptEnterpriseCreditCode(
        record.unifiedSocialCreditCodeEncrypted,
        this.config.dataHashSecret
      )
      const credit = normalizeUnifiedSocialCreditCode(
        payload.unifiedSocialCreditCode || existingCreditCode,
        this.config.dataHashSecret
      )
      const duplicate = business.resources['alumni-enterprises'].find((item) => (
        item.id !== record.id
        && item.status !== 'cancelled'
        && item.unifiedSocialCreditCodeKey
        && item.unifiedSocialCreditCodeKey === credit.key
      ))
      if (duplicate) {
        throw businessError('该统一社会信用代码已存在认证记录', 'ENTERPRISE_CREDIT_CODE_DUPLICATE', 409)
      }
      const profileInput = {}
      for (const field of enterprisePublicProfileFields) {
        if (Object.prototype.hasOwnProperty.call(payload, field)) profileInput[field] = payload[field]
      }
      const normalized = normalizeAdminPayload(
        'alumni-enterprises',
        profileInput,
        record,
        this.normalizationOptions
      )
      const timestamp = now()
      Object.assign(record, normalized, {
        status: 'pending_review',
        verificationStatus: 'pending',
        ownerAccountId: '',
        certificationApplicantAccountId: current.id,
        unifiedSocialCreditCodeMasked: credit.masked,
        unifiedSocialCreditCodeKey: credit.key,
        unifiedSocialCreditCodeEncrypted: encryptEnterpriseCreditCode(credit.value, this.config.dataHashSecret),
        certificationSubmittedAt: timestamp,
        enterpriseReviewedAt: null,
        enterpriseReviewedBy: '',
        enterpriseVerifiedAt: null,
        rejectionReason: '',
        cancelledAt: null,
        updatedAt: timestamp,
        updatedBy: current.id,
        revision: Number(record.revision || 0) + 1
      })
      business.revision += 1
      createNotification(business, {
        accountId: current.id,
        type: 'enterprise.certification_submitted',
        title: '企业认证申请已提交',
        body: `企业“${String(record.name || '未命名企业').slice(0, 80)}”已进入审核流程。`,
        resourceType: 'alumni-enterprises',
        resourceId: record.id,
        status: record.status,
        target: enterpriseNotificationTarget
      })
      data.auditLogs.unshift(audit('business.enterprise_certification_submitted', record.id, metadata, {
        materialCount: record.certificationMaterials.length,
        unifiedSocialCreditCodeMasked: credit.masked
      }))
      return enterpriseCertificationView(record)
    })
  }

  async cancelEnterpriseCertification(account, id, input = {}, metadata = {}) {
    const payload = sanitizeObject(input || {})
    assertOnlyFields(payload, new Set(['expectedRevision']), '企业认证取消')
    const expectedRevision = expectedRevisionFrom(payload.expectedRevision)
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      const record = business.resources['alumni-enterprises'].find((item) => (
        item.id === id && item.certificationApplicantAccountId === current.id
      ))
      if (!record) throw businessError('企业认证申请不存在', 'ENTERPRISE_CERTIFICATION_NOT_FOUND', 404)
      if (!['draft', 'pending_review', 'rejected'].includes(record.status)) {
        throw businessError('当前认证状态不能取消', 'ENTERPRISE_CERTIFICATION_CANCEL_INVALID', 409)
      }
      if (expectedRevision !== null && Number(record.revision || 0) !== expectedRevision) {
        throw businessError('企业认证申请已更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
      }
      const filenames = (record.certificationMaterials || []).map((item) => item.filename).filter(Boolean)
      record.certificationMaterials = []
      Object.assign(record, {
        status: 'cancelled',
        verificationStatus: 'unverified',
        ownerAccountId: '',
        pendingOwnerProfile: {},
        ownerProfileReviewStatus: '',
        ownerProfileSubmittedAt: null,
        ownerProfileReviewedAt: null,
        ownerProfileReviewedBy: '',
        ownerProfileReviewNote: '',
        unifiedSocialCreditCodeMasked: '',
        unifiedSocialCreditCodeKey: '',
        unifiedSocialCreditCodeEncrypted: '',
        cancelledAt: now(),
        updatedAt: now(),
        updatedBy: current.id,
        revision: Number(record.revision || 0) + 1
      })
      business.revision += 1
      data.auditLogs.unshift(audit('business.enterprise_certification_cancelled', record.id, metadata, {
        removedMaterialCount: filenames.length
      }))
      return { certification: enterpriseCertificationView(record), filenames }
    })
  }

  enterpriseMaterialForAdmin(enterpriseId, materialId) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const record = business.resources['alumni-enterprises'].find((item) => item.id === enterpriseId)
      const material = record?.certificationMaterials?.find((item) => item.id === materialId)
      if (!record || !material) {
        throw businessError('企业证明材料不存在', 'ENTERPRISE_MATERIAL_NOT_FOUND', 404)
      }
      return { filename: material.filename, mimeType: material.mimeType }
    })
  }

  async saveMyEnterpriseProfile(account, input = {}, metadata = {}) {
    const payload = sanitizeObject(input || {})
    const allowed = new Set([...enterpriseOwnerEditableFields, 'expectedRevision'])
    assertOnlyFields(payload, allowed, '企业资料编辑')
    const expectedRevision = expectedRevisionFrom(payload.expectedRevision)
    delete payload.expectedRevision
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      const record = verifiedEnterpriseForAccount(business, current.id)
      if (!record) throw businessError('当前账号尚未绑定已认证企业', 'ENTERPRISE_VERIFICATION_REQUIRED', 403)
      if (expectedRevision !== null && Number(record.revision || 0) !== expectedRevision) {
        throw businessError('企业资料已更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
      }
      const currentCandidate = {
        ...record,
        ...(enterprisePendingOwnerProfile(record) || {})
      }
      const normalized = normalizeAdminPayload(
        'alumni-enterprises',
        payload,
        currentCandidate,
        this.normalizationOptions
      )
      const timestamp = now()
      record.pendingOwnerProfile = {
        ...(enterprisePendingOwnerProfile(record) || {}),
        ...normalized
      }
      Object.assign(record, {
        ownerProfileReviewStatus: 'pending_review',
        ownerProfileSubmittedAt: timestamp,
        ownerProfileReviewedAt: null,
        ownerProfileReviewedBy: '',
        ownerProfileReviewNote: '',
        updatedAt: timestamp,
        updatedBy: current.id,
        revision: Number(record.revision || 0) + 1
      })
      business.revision += 1
      data.auditLogs.unshift(audit('business.enterprise_owner_updated', record.id, metadata, {
        fields: Object.keys(normalized),
        reviewStatus: 'pending_review',
        publicationStatus: record.status
      }))
      return {
        eligible: true,
        verificationStatus: 'verified',
        profile: enterpriseProfileView(record, { canEdit: true }),
        certification: enterpriseCertificationView(record)
      }
    })
  }

  myEnterpriseJobs(account, input = {}) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      const enterprise = verifiedEnterpriseForAccount(business, current.id)
      if (!enterprise) {
        throw businessError('只有已审核企业所有者可以管理岗位', 'ENTERPRISE_VERIFICATION_REQUIRED', 403)
      }
      const records = business.resources.jobs
        .filter((item) => item.ownerEnterpriseId === enterprise.id && item.authorAccountId === current.id)
        .map(jobSelfView)
      return paginate(sortRecords(searchAndFilter(records, input, 'jobs', this.normalizationOptions.regions), 'jobs'), input, business.revision)
    })
  }

  async createMyEnterpriseJob(account, input = {}, metadata = {}) {
    const payload = sanitizeObject(input || {})
    assertOnlyFields(payload, new Set(jobOwnerEditableFields), '企业岗位提交')
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      const enterprise = verifiedEnterpriseForAccount(business, current.id)
      if (!enterprise) {
        throw businessError('只有已审核企业所有者可以提交岗位', 'ENTERPRISE_VERIFICATION_REQUIRED', 403)
      }
      const normalized = normalizeAdminPayload(
        'jobs',
        { ...payload, company: enterprise.name },
        {},
        this.normalizationOptions
      )
      const timestamp = now()
      const record = {
        id: randomUUID(),
        resource: 'jobs',
        ...normalized,
        company: enterprise.name,
        enterpriseId: enterprise.id,
        ownerEnterpriseId: enterprise.id,
        authorAccountId: current.id,
        status: 'pending_review',
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: current.id,
        updatedBy: current.id
      }
      business.resources.jobs.unshift(record)
      business.revision += 1
      createNotification(business, {
        accountId: current.id,
        type: 'job.pending_review',
        title: '企业岗位已提交',
        body: `岗位“${String(record.title || '未命名岗位').slice(0, 80)}”已进入审核流程。`,
        resourceType: 'jobs',
        resourceId: record.id,
        status: record.status,
        target: jobOwnerNotificationTarget
      })
      data.auditLogs.unshift(audit('business.enterprise_job_submitted', record.id, metadata, {
        enterpriseId: enterprise.id
      }))
      return jobSelfView(record)
    })
  }

  async updateMyEnterpriseJob(account, id, input = {}, metadata = {}) {
    const payload = sanitizeObject(input || {})
    const allowed = new Set([...jobOwnerEditableFields, 'expectedRevision'])
    assertOnlyFields(payload, allowed, '企业岗位编辑')
    const expectedRevision = expectedRevisionFrom(payload.expectedRevision)
    delete payload.expectedRevision
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      const enterprise = verifiedEnterpriseForAccount(business, current.id)
      if (!enterprise) {
        throw businessError('只有已审核企业所有者可以编辑岗位', 'ENTERPRISE_VERIFICATION_REQUIRED', 403)
      }
      const record = business.resources.jobs.find((item) => (
        item.id === id
        && item.ownerEnterpriseId === enterprise.id
        && item.authorAccountId === current.id
      ))
      if (!record) throw businessError('企业岗位不存在', 'ENTERPRISE_JOB_NOT_FOUND', 404)
      if (!['pending_review', 'rejected', 'published', 'offline'].includes(record.status)) {
        throw businessError('当前岗位状态不能编辑', 'ENTERPRISE_JOB_NOT_EDITABLE', 409)
      }
      if (expectedRevision !== null && Number(record.revision || 0) !== expectedRevision) {
        throw businessError('岗位已更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
      }
      const normalized = normalizeAdminPayload(
        'jobs',
        { ...payload, company: enterprise.name },
        record,
        this.normalizationOptions
      )
      Object.assign(record, normalized, {
        company: enterprise.name,
        enterpriseId: enterprise.id,
        ownerEnterpriseId: enterprise.id,
        authorAccountId: current.id,
        status: 'pending_review',
        rejectionReason: '',
        adminNote: '',
        updatedAt: now(),
        updatedBy: current.id,
        revision: Number(record.revision || 0) + 1
      })
      business.revision += 1
      createNotification(business, {
        accountId: current.id,
        type: 'job.resubmitted',
        title: '企业岗位已重新提交',
        body: `岗位“${String(record.title || '未命名岗位').slice(0, 80)}”已进入审核流程。`,
        resourceType: 'jobs',
        resourceId: record.id,
        status: record.status,
        target: jobOwnerNotificationTarget
      })
      data.auditLogs.unshift(audit('business.enterprise_job_resubmitted', record.id, metadata, {
        enterpriseId: enterprise.id
      }))
      return jobSelfView(record)
    })
  }

  async cancelMyEnterpriseJob(account, id, input = {}, metadata = {}) {
    const payload = sanitizeObject(input || {})
    assertOnlyFields(payload, new Set(['expectedRevision']), '企业岗位取消')
    const expectedRevision = expectedRevisionFrom(payload.expectedRevision)
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = activeAccountIn(data, account)
      const enterprise = verifiedEnterpriseForAccount(business, current.id)
      if (!enterprise) {
        throw businessError('只有已审核企业所有者可以管理岗位', 'ENTERPRISE_VERIFICATION_REQUIRED', 403)
      }
      const record = business.resources.jobs.find((item) => (
        item.id === id
        && item.ownerEnterpriseId === enterprise.id
        && item.authorAccountId === current.id
      ))
      if (!record) throw businessError('企业岗位不存在', 'ENTERPRISE_JOB_NOT_FOUND', 404)
      if (!['pending_review', 'rejected', 'published', 'offline'].includes(record.status)) {
        throw businessError('当前岗位状态不能取消', 'ENTERPRISE_JOB_CANCEL_INVALID', 409)
      }
      if (expectedRevision !== null && Number(record.revision || 0) !== expectedRevision) {
        throw businessError('岗位已更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
      }
      record.status = 'cancelled'
      record.cancelledAt = now()
      record.updatedAt = record.cancelledAt
      record.updatedBy = current.id
      record.revision = Number(record.revision || 0) + 1
      business.revision += 1
      data.auditLogs.unshift(audit('business.enterprise_job_cancelled', record.id, metadata, {
        enterpriseId: enterprise.id
      }))
      return jobSelfView(record)
    })
  }

  async createCommunityPost(account, input, metadata = {}) {
    if (!publicCreateResources.includes('community-posts')) throw businessError('当前不允许用户发布', 'BUSINESS_CREATE_DISABLED', 403)
    const payload = sanitizeObject(input || {})
    const anonymous = anonymousFlag(payload.anonymous)
    if (Object.hasOwn(payload, 'anonymousIdentity')) throw businessError('匿名昵称和头像由系统分配', 'BUSINESS_PROTECTED_FIELD', 400)
    if (['carouselPlacement', 'carouselSortOrder', 'sortOrder'].some(key => Object.hasOwn(payload, key))) throw businessError('校园墙置顶只能由后台管理员设置', 'BUSINESS_PROTECTED_FIELD', 403)
    const content = String(payload.content || '').trim()
    const mediaIds = selectedIds(payload.mediaIds, communityLimits.images, '图片')
    const mentionIds = selectedIds(payload.mentionAccountIds, communityLimits.mentions, '提及人员')
    const topics = normalizedPostTopics(payload)
    if ((!content && !mediaIds.length) || content.length > communityLimits.content) throw businessError('请填写文字或添加图片，正文最多 2000 字', 'COMMUNITY_CONTENT_INVALID', 400)
    if (payload.images !== undefined) throw businessError('请先上传本人图片，不接受外部图片地址', 'COMMUNITY_MEDIA_INVALID', 400)
    if (payload.visibility && !['all', 'alumni', 'campus'].includes(payload.visibility)) {
      throw businessError('请选择有效可见范围', 'COMMUNITY_VISIBILITY_INVALID', 400)
    }
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const author = requireSchoolVerifiedAccount(data.accounts.find((item) => item.id === account.id && item.status === 'active'))
      if (business.resources['community-posts'].filter((post) => post.authorAccountId === author.id && Date.parse(post.createdAt) > Date.now() - 60000).length >= 5) throw businessError('发布过于频繁，请稍后再试', 'COMMUNITY_POST_RATE_LIMIT', 429)
      const uploads = mediaIds.map((id) => {
        const media = (data.communityMedia || []).find((item) => item.id === id && item.ownerAccountId === author.id && item.purpose === 'community-post' && item.state === 'staged' && Date.parse(item.expiresAt) > Date.now())
        if (!media) throw businessError('图片不属于本人、已被使用或已过期，请重新上传', 'COMMUNITY_MEDIA_INVALID', 409)
        return media
      })
      const mentions = mentionIds.map((id) => {
        const person = data.accounts.find((item) => item.id === id && item.status === 'active' && item.schoolIdentityVerified && audienceAllows(payload.visibility || 'all', item))
        if (!person) throw businessError('提及人员不可用或不在动态可见范围内，请重新选择', 'COMMUNITY_MENTION_INVALID', 400)
        return { id: person.id, name: person.name || '湖财人' }
      })
      const timestamp = now()
      const record = {
        id: randomUUID(), resource: 'community-posts', status: 'published', revision: 1,
        anonymous, ...(anonymous ? { anonymousIdentity: createAnonymousIdentity() } : {}),
        content, topic: topics[0] || '', topics, mentions,
        images: uploads.map((item) => ({ id: item.id, url: `/api/v1/business/community-media/${item.id}` })),
        visibility: payload.visibility || 'all',
        location: payload.showLocation === false ? '城市已隐藏' : String(payload.location || ''),
        authorAccountId: author.id, authorName: author.name || author.username, initials: String(author.name || author.username || '湖财').slice(-2),
        meta: [author.department, author.personType].filter(Boolean).join(' · '), createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp
      }
      business.resources['community-posts'].unshift(record)
      for (const upload of uploads) { upload.state = 'bound'; upload.postId = record.id }
      for (const mention of mentions.filter((person) => person.id !== author.id)) {
        createNotification(business, { accountId: mention.id, type: 'community.mention', title: `${anonymous ? anonymousPresentation(record).authorName : author.name || '湖财人'} 在湖财圈提到了你`, body: '点击查看这条校园墙动态。', resourceType: 'community-posts', resourceId: record.id, status: 'published', target: '/pages/community/index' })
      }
      business.revision += 1
      data.auditLogs.unshift(audit('business.community_post_published', record.id, metadata, { topic: record.topic, status: record.status }))
      return publicRecord(record)
    })
  }

  communityPeople(account, input = {}) {
    return this.database.read((data) => {
      requireSchoolVerifiedAccount(data.accounts.find((item) => item.id === account.id && item.status === 'active'))
      const query = String(input.query || '').trim().slice(0, 40)
      if (query.length < 2) return { items: [] }
      return { items: data.accounts.filter((item) => item.status === 'active' && item.schoolIdentityVerified && `${item.name || ''} ${item.department || ''}`.includes(query)).slice(0, 20).map((item) => ({ id: item.id, name: item.name, department: item.department || '', personType: item.personType || 'member' })) }
    })
  }

  communityImage(account, id, canReadAdmin = () => false) {
    return this.database.read((data) => {
      const media = (data.communityMedia || []).find((item) => item.id === id && item.state !== 'deleted')
      const current = data.accounts.find((item) => item.id === account.id && item.status === 'active')
      const post = media?.postId && data.business.resources['community-posts'].find((item) => item.id === media.postId && item.images?.some((image) => image.id === id))
      const readable = current && media && (media.state === 'staged'
        ? current.schoolIdentityVerified && media.ownerAccountId === current.id && Date.parse(media.expiresAt) > Date.now()
        : post && (isPublicRecordVisible('community-posts', post, current) || canReadAdmin(data, current, post)))
      if (!readable) throw businessError('图片不存在或当前不可查看', 'COMMUNITY_MEDIA_NOT_FOUND', 404)
      return { filename: media.filename, mimeType: media.mimeType }
    })
  }

  async createCollaborationOpportunity(account, input, metadata = {}) {
    if (!publicCreateResources.includes('collaboration-opportunities')) {
      throw businessError('当前不允许用户发布合作信息', 'BUSINESS_CREATE_DISABLED', 403)
    }
    let payload = sanitizeObject(input || {})
    const protectedField = collaborationProtectedFields.find((key) => Object.prototype.hasOwnProperty.call(payload, key))
    if (protectedField) {
      throw businessError(`字段 ${protectedField} 不能由用户设置`, 'BUSINESS_PROTECTED_FIELD', 400)
    }
    return this.database.transaction((data) => {
      payload = normalizeAdminPayload('collaboration-opportunities', payload, {}, this.normalizationOptions)
      const business = ensureBusinessData(data)
      const timestamp = now()
      const record = {
        id: randomUUID(),
        resource: 'collaboration-opportunities',
        ...payload,
        status: 'pending_review',
        revision: 1,
        authorAccountId: account.id,
        authorName: account.name || account.username || '湖财用户',
        authorDepartment: account.department || '',
        createdAt: timestamp,
        updatedAt: timestamp
      }
      business.resources['collaboration-opportunities'].unshift(record)
      createNotification(business, {
        accountId: account.id,
        type: 'collaboration.submitted',
        title: '合作信息已提交',
        body: `您提交的合作信息“${String(record.title || '未命名合作').slice(0, 80)}”已进入审核流程。`,
        resourceType: 'collaboration-opportunities',
        resourceId: record.id,
        status: record.status,
        target: collaborationNotificationTarget
      })
      business.revision += 1
      data.auditLogs.unshift(audit('business.collaboration_submitted', record.id, metadata, {
        category: record.category,
        city: record.city || ''
      }))
      return ownerCollaborationRecord(record)
    })
  }

  myCollaborationOpportunities(accountId, input = {}) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const records = business.resources['collaboration-opportunities']
        .filter((item) => item.authorAccountId === accountId)
        .map(ownerCollaborationRecord)
      return paginate(
        sortRecords(searchAndFilter(records, input, 'collaboration-opportunities', this.normalizationOptions.regions), 'collaboration-opportunities'),
        input,
        business.revision
      )
    })
  }

  async cancelCollaborationOpportunity(accountId, id, metadata = {}) {
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const record = business.resources['collaboration-opportunities']
        .find((item) => item.id === id && item.authorAccountId === accountId)
      if (!record) throw businessError('合作信息不存在', 'COLLABORATION_NOT_FOUND', 404)
      if (!['pending_review', 'rejected'].includes(record.status)) {
        throw businessError('当前合作信息状态不能取消', 'COLLABORATION_CANNOT_CANCEL', 409)
      }
      record.status = 'cancelled'
      record.cancelledAt = now()
      record.updatedAt = record.cancelledAt
      record.revision = Number(record.revision || 0) + 1
      business.revision += 1
      data.auditLogs.unshift(audit('business.collaboration_cancelled', record.id, metadata, {}))
      return ownerCollaborationRecord(record)
    })
  }

  async toggleCommunityLike(account, postId, metadata = {}) {
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const post = business.resources['community-posts'].find((item) => item.id === postId && isPublicRecordVisible('community-posts', item, account))
      if (!post) throw businessError('动态不存在或未发布', 'BUSINESS_ITEM_NOT_FOUND', 404)
      const index = business.reactions.findIndex((item) => item.type === 'community-like' && item.resourceId === postId && item.accountId === account.id)
      let liked
      if (index >= 0) { business.reactions.splice(index, 1); liked = false } else {
        business.reactions.push({ id: randomUUID(), type: 'community-like', resourceId: postId, accountId: account.id, createdAt: now() })
        liked = true
      }
      business.revision += 1
      data.auditLogs.unshift(audit('business.community_like_toggled', postId, metadata, { liked }))
      return { liked, likeCount: business.reactions.filter((item) => item.type === 'community-like' && item.resourceId === postId).length }
    })
  }

  async createSubmission(account, input, metadata = {}) {
    const body = sanitizeObject(input || {})
    const type = String(body.type || '')
    if (!allowedSubmissionTypes.includes(type)) throw businessError('不支持的业务提交类型', 'SUBMISSION_TYPE_INVALID', 400)
    const payload = sanitizeSubmissionPayload(body.payload || {})
    const anonymous = type === 'community-comment' ? anonymousFlag(payload.anonymous) : false
    if (type === 'community-comment' && Object.hasOwn(payload, 'anonymousIdentity')) throw businessError('匿名昵称和头像由系统分配', 'BUSINESS_PROTECTED_FIELD', 400)
    const resourceId = String(body.resourceId || '')
    const resourceType = resourceForSubmission(type)
    if (resourceType && !resourceId) throw businessError('缺少关联业务记录', 'SUBMISSION_RESOURCE_REQUIRED', 400)
    if (type === 'feedback' && String(payload.content || '').length < 5) throw businessError('反馈内容至少 5 个字', 'FEEDBACK_CONTENT_INVALID', 400)
    if (type === 'campus-visit' && !payload.date && !payload.visitDate) throw businessError('请选择返校日期', 'VISIT_DATE_REQUIRED', 400)
    if (directSpeechTypes.has(type)) {
      const content = typeof payload.content === 'string' ? payload.content.trim() : ''
      if (content.length < 2 || content.length > 500) throw businessError('留言或评论请输入 2–500 个字', 'ORGANIZATION_MESSAGE_INVALID', 400)
      for (const key of Object.keys(payload)) delete payload[key]
      payload.content = content
    }

    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      let target = null
      if (directSpeechTypes.has(type)) {
        account = requireSchoolVerifiedAccount(data.accounts.find((item) => item.id === account.id && item.status === 'active'))
        const recent = business.submissions.filter((item) => item.type === type && item.accountId === account.id && Date.parse(item.createdAt) > Date.now() - 60000)
        if (recent.length >= 5) throw businessError('留言过于频繁，请稍后再试', 'ORGANIZATION_MESSAGE_RATE_LIMIT', 429)
      }
      if (resourceType) {
        target = business.resources[resourceType]?.find((item) => item.id === resourceId)
        if (!target) throw businessError('关联内容不存在或不可申请', 'SUBMISSION_RESOURCE_NOT_FOUND', 404)
        if (!hasPublicOrganizationParent(resourceType, target, business, account)) {
          throw businessError('关联内容不存在或不可申请', 'SUBMISSION_RESOURCE_NOT_FOUND', 404)
        }
        if (type === 'event-registration') {
          if (target.status !== 'published') {
            throw businessError('活动当前不在报名状态', 'EVENT_REGISTRATION_CLOSED', 409)
          }
          const timestamp = Date.now()
          const deadline = target.registrationDeadline ? Date.parse(target.registrationDeadline) : null
          if (Number.isFinite(deadline) && deadline <= timestamp) {
            throw businessError('活动报名已截止', 'EVENT_REGISTRATION_DEADLINE_PASSED', 409)
          }
          const startsAt = target.startAt ? Date.parse(target.startAt) : null
          if (Number.isFinite(startsAt) && startsAt <= timestamp) {
            throw businessError('活动已经开始，不能继续报名', 'EVENT_ALREADY_STARTED', 409)
          }
        } else if (type === 'benefit-claim') {
          if (target.status !== 'published') {
            throw businessError('该权益当前不可领取', 'BENEFIT_NOT_AVAILABLE', 409)
          }
          const timestamp = Date.now()
          const startsAt = target.startAt ? Date.parse(target.startAt) : null
          const endsAt = target.endAt ? Date.parse(target.endAt) : null
          if (Number.isFinite(startsAt) && startsAt > timestamp) {
            throw businessError('该权益尚未开始领取', 'BENEFIT_NOT_STARTED', 409)
          }
          if (Number.isFinite(endsAt) && endsAt < timestamp) {
            throw businessError('该权益已过期', 'BENEFIT_EXPIRED', 409)
          }
          if (!audienceAllows(target.audience, account)) {
            throw businessError('当前身份不在该权益适用范围内', 'BENEFIT_AUDIENCE_DENIED', 403)
          }
        } else if (!isPublicRecordVisible(resourceType, target, account)) {
          throw businessError('关联内容不存在或不可申请', 'SUBMISSION_RESOURCE_NOT_FOUND', 404)
        }
      }
      if (type === 'benefit-claim') {
        payload.benefitTitle = String(target?.title || '').slice(0, 180)
        payload.provider = String(target?.provider || '').slice(0, 160)
      }

      if (favoriteTypes.includes(type)) {
        const existing = business.submissions.find((item) => item.type === type && item.resourceId === resourceId && item.accountId === account.id)
        if (existing) {
          existing.status = existing.status === 'active' ? 'cancelled' : 'active'
          existing.updatedAt = now()
          existing.revision += 1
          business.revision += 1
          return { active: existing.status === 'active', item: ownerSubmission(existing) }
        }
      }

      const uniqueTypes = ['event-registration', 'organization-membership', 'job-application', 'mentor-application', 'volunteer-application', 'service-application']
      const duplicate = type === 'benefit-claim'
        ? business.submissions.find((item) => item.type === type && item.resourceId === resourceId && item.accountId === account.id && !['cancelled', 'rejected'].includes(item.status))
        : uniqueTypes.includes(type) && business.submissions.find((item) => item.type === type && item.resourceId === resourceId && item.accountId === account.id && !terminalSubmissionStatuses.includes(item.status))
      if (duplicate) throw businessError('请勿重复提交', 'SUBMISSION_ALREADY_EXISTS', 409)
      if (type === 'event-registration' && Number(target?.quota) > 0) {
        const registrations = business.submissions.filter((item) => item.type === 'event-registration'
          && item.resourceId === resourceId
          && !['cancelled', 'rejected'].includes(item.status))
        if (registrations.length >= Number(target.quota)) {
          throw businessError('活动报名名额已满', 'EVENT_REGISTRATION_FULL', 409)
        }
      }
      if (type === 'benefit-claim' && Number(target?.quota) > 0) {
        const claims = business.submissions.filter((item) => item.type === 'benefit-claim'
          && item.resourceId === resourceId
          && !['cancelled', 'rejected'].includes(item.status))
        if (claims.length >= Number(target.quota)) {
          throw businessError('该权益领取名额已满', 'BENEFIT_CLAIM_FULL', 409)
        }
      }

      const id = randomUUID()
      const timestamp = now()
      const status = directSpeechTypes.has(type) ? 'published' : (favoriteTypes.includes(type) ? 'active' : (type.startsWith('community-') ? 'pending_review' : 'submitted'))
      const submission = {
        id, number: submissionNumber(type, id), type, resourceType, resourceId,
        accountId: account.id, actorSnapshot: accountSnapshot(account), payload,
        ...(type === 'community-comment' ? {
          anonymous,
          ...(anonymous ? { anonymousIdentity: (target?.anonymous === true && target.authorAccountId === account.id ? target.anonymousIdentity : null)
            || business.submissions.find(item => item.type === type && item.resourceId === resourceId && item.accountId === account.id && item.anonymous === true && item.anonymousIdentity)?.anonymousIdentity
            || createAnonymousIdentity() } : {})
        } : {}),
        status, revision: 1, createdAt: timestamp, updatedAt: timestamp,
        adminReply: '', adminNote: ''
      }
      business.submissions.unshift(submission)
      if (!favoriteTypes.includes(type)) {
        const subject = submissionTypeLabels[type] || '业务申请'
        createNotification(business, {
          accountId: account.id,
          type: `submission.${status === 'published' ? 'published' : (status === 'pending_review' ? 'pending_review' : 'submitted')}`,
          title: `${subject}${status === 'published' ? '已发布' : '已提交'}`,
          body: status === 'published' ? `您的${subject}已发布，无需等待审核，请文明交流。` : `您提交的${subject}（${submission.number}）已进入处理流程。`,
          resourceType: resourceType || type,
          resourceId: resourceId || submission.id,
          status,
          target: submissionNotificationTargets[type] || ''
        })
      }
      business.revision += 1
      data.auditLogs.unshift(audit('business.submission_created', submission.id, metadata, { type, resourceId }))
      return favoriteTypes.includes(type) ? { active: true, item: ownerSubmission(submission) } : ownerSubmission(submission)
    })
  }

  mySubmissions(accountId, input = {}, filterModules = rows => rows) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const records = filterModules(filterModuleRecords(data,'applications',business.submissions.filter((item) => item.accountId === accountId)))
        .map(ownerSubmission)
      return paginate(sortRecords(searchAndFilter(records, input, '', this.normalizationOptions.regions), ''), input, business.revision)
    })
  }

  mySummary(accountId) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const mine = filterModuleRecords(data,'applications',business.submissions.filter((item) => item.accountId === accountId))
      const account = data.accounts.find((item) => item.id === accountId && item.status === 'active')
      return {
        revision: business.revision,
        activityRegistrations: mine.filter((item) => item.type === 'event-registration' && !terminalSubmissionStatuses.includes(item.status)).length,
        posts: filterModuleRecords(data,'community-posts',business.resources['community-posts']).filter((item) => item.authorAccountId === accountId).length,
        collaborations: filterModuleRecords(data,'collaboration-opportunities',business.resources['collaboration-opportunities'])
          .filter((item) => item.authorAccountId === accountId && item.status !== 'cancelled').length,
        organizations: mine.filter((item) => item.type === 'organization-membership' && !terminalSubmissionStatuses.includes(item.status)).length,
        benefits: mine.filter((item) => item.type === 'benefit-claim' && !['cancelled', 'rejected'].includes(item.status)).length,
        applications: mine.filter((item) => !favoriteTypes.includes(item.type)).length,
        unreadInbox: account ? this.inboxItemsIn(data, account).filter((item) => !item.read).length : 0,
        pending: mine.filter((item) => ['submitted', 'pending_review', 'processing'].includes(item.status)).length
          + filterModuleRecords(data,'collaboration-opportunities',business.resources['collaboration-opportunities'])
            .filter((item) => item.authorAccountId === accountId && item.status === 'pending_review').length
      }
    })
  }

  inboxItemsIn(data, account) {
    const business = ensureBusinessData(data)
    const reads = new Map(business.inboxReads
      .filter((item) => item.accountId === account.id)
      .map((item) => [item.inboxItemId, item.readAt]))
    const announcements = filterModuleRecords(data,'announcements',business.resources.announcements)
      .filter((item) => isPublicRecordVisibleInBusiness('announcements', item, business, account))
      .map((record) => {
        const id = `announcement:${record.id}-${Number(record.revision || 1)}`
        const safe = publicRecord(record)
        return {
          id,
          kind: 'announcement',
          type: 'announcement',
          title: safe.title || '平台公告',
          summary: safe.summary || '',
          body: safe.content || safe.summary || '',
          category: safe.category || '',
          priority: safe.priority || 'normal',
          status: safe.status || 'published',
          targetType: safe.targetType || 'none',
          target: safe.target || '',
          resourceType: 'announcements',
          resourceId: safe.id,
          createdAt: safe.publishedAt || safe.updatedAt || safe.createdAt || now(),
          read: reads.has(id),
          readAt: reads.get(id) || null
        }
      })
    const notifications = filterModuleRecords(data,'notifications',business.notifications)
      .filter((item) => item.accountId === account.id)
      .map((notification) => {
        const id = `notification:${notification.id}`
        return {
          id,
          kind: notification.type === 'community.mention' ? 'interaction' : 'business',
          category: notification.type === 'community.mention' ? '湖财圈 · @提及' : '',
          type: notification.type || 'business.status_changed',
          title: notification.title || '业务状态已更新',
          summary: notification.body || '',
          body: notification.body || '',
          resourceType: notification.resourceType || '',
          resourceId: notification.resourceId || '',
          status: notification.status || '',
          target: notification.type === 'community.mention' && /^[A-Za-z0-9_-]{1,100}$/.test(notification.resourceId || '')
            ? `/pages/community-comments/index?id=${encodeURIComponent(notification.resourceId)}`
            : (allowedNotificationTargets.has(notification.target) ? notification.target : ''),
          createdAt: notification.createdAt,
          read: reads.has(id),
          readAt: reads.get(id) || null
        }
      })
    return [...announcements, ...notifications].sort((left, right) =>
      String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  }

  inbox(account, input = {}) {
    return this.database.read((data) => {
      const current = data.accounts.find((item) => item.id === account.id && item.status === 'active')
      if (!current) throw businessError('账号不存在或不可用', 'ACCOUNT_NOT_FOUND', 404)
      const allItems = this.inboxItemsIn(data, current)
      const unreadCount = allItems.filter((item) => !item.read).length
      let filtered = input.unreadOnly === true || String(input.unreadOnly || '') === 'true'
        ? allItems.filter((item) => !item.read)
        : allItems
      if (input.kind === 'notice') filtered = filtered.filter((item) => item.kind === 'announcement')
      if (input.kind === 'progress') filtered = filtered.filter((item) => item.kind === 'business')
      if (input.kind === 'interaction') filtered = filtered.filter((item) => item.kind === 'interaction')
      const { page, pageSize } = pageValues(input)
      const start = (page - 1) * pageSize
      return {
        items: filtered.slice(start, start + pageSize),
        total: filtered.length,
        unreadCount,
        page,
        pageSize
      }
    })
  }

  async markInboxRead(account, inboxItemId) {
    const normalizedId = String(inboxItemId || '').trim()
    if (!/^(?:announcement|notification):[A-Za-z0-9_-]{1,160}$/u.test(normalizedId)) {
      throw businessError('消息标识无效', 'INBOX_ITEM_INVALID', 400)
    }
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = data.accounts.find((item) => item.id === account.id && item.status === 'active')
      const visible = current ? this.inboxItemsIn(data, current) : []
      const item = visible.find((entry) => entry.id === normalizedId)
      if (!item) throw businessError('消息不存在或当前账号不可见', 'INBOX_ITEM_NOT_FOUND', 404)
      let read = business.inboxReads.find((entry) => entry.accountId === current.id && entry.inboxItemId === normalizedId)
      if (!read) {
        read = {
          id: randomUUID(),
          accountId: current.id,
          inboxItemId: normalizedId,
          readAt: now()
        }
        business.inboxReads.unshift(read)
      }
      const unreadCount = this.inboxItemsIn(data, current).filter((entry) => !entry.read).length
      return { id: normalizedId, read: true, readAt: read.readAt, unreadCount }
    })
  }

  async markAllInboxRead(account) {
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const current = data.accounts.find((item) => item.id === account.id && item.status === 'active')
      if (!current) throw businessError('账号不存在或不可用', 'ACCOUNT_NOT_FOUND', 404)
      const items = this.inboxItemsIn(data, current)
      const alreadyRead = new Set(business.inboxReads
        .filter((item) => item.accountId === current.id)
        .map((item) => item.inboxItemId))
      const timestamp = now()
      let updated = 0
      for (const item of items) {
        if (alreadyRead.has(item.id)) continue
        business.inboxReads.unshift({
          id: randomUUID(),
          accountId: current.id,
          inboxItemId: item.id,
          readAt: timestamp
        })
        updated += 1
      }
      return { updated, unreadCount: 0 }
    })
  }

  async cancelSubmission(accountId, id, metadata = {}) {
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const submission = business.submissions.find((item) => item.id === id && item.accountId === accountId)
      if (!submission) throw businessError('业务记录不存在', 'SUBMISSION_NOT_FOUND', 404)
      if (['completed', 'closed', 'rejected'].includes(submission.status)) throw businessError('当前状态不能取消', 'SUBMISSION_CANNOT_CANCEL', 409)
      submission.status = 'cancelled'
      if (submission.type === 'organization-membership') {
        optOutAutomaticOrganization(business, submission, 'user_left', accountId)
        submission.automaticEndReason = 'user_left'
      }
      submission.updatedAt = now()
      submission.revision += 1
      business.revision += 1
      data.auditLogs.unshift(audit('business.submission_cancelled', id, metadata, { type: submission.type }))
      return ownerSubmission(submission)
    })
  }

  adminRecords(data, resource) {
    const business = ensureBusinessData(data)
    if (submissionBackedResources[resource]) {
      return business.submissions
        .filter((item) => submissionBackedResources[resource].includes(item.type))
        .map((item) => submissionAdminView(item, data))
    }
    const resources = business.resources[resource] || []
    if (resource === 'community-posts') return resources.map(item => ({ ...item, ...anonymityAdminFields(item), authorUsername: data.accounts.find(account => account.id === item.authorAccountId)?.username || '', recordKind: 'resource' }))
    if (resource === 'organizations') {
      return resources.map((item) => ({ ...item, type: normalizeOrganizationType(item.type), recordKind: 'resource' }))
    }
    if (resource === 'mentors') {
      return resources.map((item) => ({
        ...item,
        verificationStatus: mentorVerificationStatus(item),
        owner: mentorOwnerSummary(data.accounts.find((account) => account.id === item.ownerAccountId)),
        recordKind: 'resource'
      }))
    }
    if (resource === 'alumni-enterprises') {
      return resources.map((item) => enterpriseAdminView(item, data, this.config.dataHashSecret))
    }
    if (resource === 'jobs') {
      return resources.map((item) => jobAdminView(item, data))
    }
    if (organizationContentResources.has(resource)) {
      return resources.map((item) => ({
        ...item,
        organization: publicOrganizationSummary(business, item.organizationId),
        recordKind: 'resource'
      }))
    }
    if (resource !== 'volunteers') return resources.map((item) => ({ ...item, recordKind: 'resource' }))
    const applications = business.submissions
      .filter((item) => item.type === 'volunteer-application')
      .map((item) => submissionAdminView(item, data))
    return [...resources.map((item) => ({ ...item, recordKind: 'resource' })), ...applications]
  }

  listAdmin(resource, input = {}, predicate = null) {
    if (!isBusinessResource(resource)) throw businessError('业务板块不存在', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const available = filterModuleRecords(data,resource,this.adminRecords(data, resource))
      const accessible = predicate ? available.filter((record) => predicate(record, data)) : available
      const filtered = sortRecords(searchAndFilter(accessible, input, resource, this.normalizationOptions.regions), resource)
      return paginate(filtered, input, business.revision)
    })
  }

  getAdmin(resource, id) {
    if (!isBusinessResource(resource)) throw businessError('业务板块不存在', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      if (resource === 'alumni-enterprises') {
        const enterprise = business.resources['alumni-enterprises'].find((item) => item.id === id)
        if (!enterprise) throw businessError('业务记录不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
        return enterpriseAdminView(enterprise, data, this.config.dataHashSecret, { includeSensitive: true })
      }
      if (resource === 'jobs') {
        const job = business.resources.jobs.find((item) => item.id === id)
        if (!job) throw businessError('业务记录不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
        return jobAdminView(job, data)
      }
      const record = filterModuleRecords(data,resource,this.adminRecords(data, resource)).find((item) => item.id === id)
      if (!record) throw businessError('业务记录不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      return record
    })
  }

  async saveGivingCertificateTemplate(id,input,metadata={},authorize=null) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key=>!['expectedRevision','certificateTemplate'].includes(key))
      || !Number.isInteger(input.expectedRevision) || input.expectedRevision<1) throw businessError('请提交当前项目版本和完整证书模板','GIVING_TEMPLATE_INVALID',400)
    const template=validateGivingTemplate(input.certificateTemplate)
    await verifyGivingBackground(template,this.config.mediaDir)
    return this.database.transaction(data=>{
      const business=ensureBusinessData(data),project=business.resources['giving-projects'].find(item=>item.id===id)
      if (!project) throw businessError('公益项目不存在','BUSINESS_ITEM_NOT_FOUND',404)
      if (authorize) authorize(data,{...project,recordKind:'resource'})
      const actor=data.accounts.find(account=>account.id===metadata.actor&&account.status==='active')
      if (actor?.mustChangePassword) throw businessError('首次登录必须先修改临时密码','PASSWORD_CHANGE_REQUIRED',403)
      if (Number(project.revision||0)!==input.expectedRevision) throw businessError('公益项目已更新，请刷新后重新确认模板','BUSINESS_REVISION_CONFLICT',409)
      project.certificateTemplate=structuredClone(template)
      project.revision=Number(project.revision||0)+1
      project.updatedAt=now();project.updatedBy=metadata.actor||'admin'
      business.revision+=1
      data.auditLogs.unshift(audit('business.giving_template_updated',id,metadata,{resource:'giving-projects',revision:project.revision,layout:template.layout,hasBackground:Boolean(template.backgroundUrl)}))
      return {...project,recordKind:'resource'}
    })
  }

  async createAdmin(resource, input, metadata = {}, authorize = null) {
    if (!isBusinessResource(resource)) throw businessError('业务板块不存在', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    let payload = sanitizeObject(input || {})
    const certificateField = certificateProtectedFields
      .find((key) => Object.prototype.hasOwnProperty.call(payload, key))
    if (certificateField) {
      throw businessError(
        `证书字段 ${certificateField} 只能由公益证书专用签发动作生成`,
        'BUSINESS_PROTECTED_FIELD',
        400
      )
    }
    if (strictBusinessResources.includes(resource)) {
      const protectedField = [
        'id', 'resource', 'resourceType', 'resourceId', 'accountId', 'actorSnapshot',
        'authorAccountId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
        'revision', 'expectedRevision', 'status', 'cancelledAt'
      ].find((key) => Object.prototype.hasOwnProperty.call(payload, key))
      if (protectedField) {
        throw businessError(`字段 ${protectedField} 不能由新增接口设置`, 'BUSINESS_PROTECTED_FIELD', 400)
      }
    }
    if (resource === 'mentors' && ['owner', 'ownerAccountId', 'verificationStatus', 'mentorOwnerBoundAt', 'mentorVerifiedAt'].some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
      throw businessError('导师所有者和认证状态必须通过专用认证接口设置', 'BUSINESS_PROTECTED_FIELD', 400)
    }
    if (resource === 'alumni-enterprises' && enterpriseProtectedFields.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
      throw businessError('企业认证归属和证明材料必须通过专用认证流程设置', 'BUSINESS_PROTECTED_FIELD', 400)
    }
    if (resource === 'jobs' && ['authorAccountId', 'ownerEnterpriseId'].some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
      throw businessError('企业岗位归属不能由后台普通字段接口设置', 'BUSINESS_PROTECTED_FIELD', 400)
    }
    if (resource === 'collaboration-opportunities' && collaborationProtectedFields.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
      throw businessError('合作信息状态和作者归属不能由新增接口设置', 'BUSINESS_PROTECTED_FIELD', 400)
    }
    for (const key of ['id', 'resource', 'resourceType', 'resourceId', 'accountId', 'actorSnapshot', 'authorAccountId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'revision']) delete payload[key]
    delete payload.expectedRevision
    if (Object.prototype.hasOwnProperty.call(payload, 'status')) throw businessError('新增内容不能直接指定状态，请保存后执行审核或发布操作', 'BUSINESS_PROTECTED_FIELD', 400)
    if (['applications', 'service-applications'].includes(resource)) throw businessError('业务申请必须由用户提交', 'ADMIN_CREATE_DISABLED', 405)
    if (submissionBackedResources[resource]) {
      const type = resource === 'campus-visits' ? 'campus-visit' : 'feedback'
      return this.database.transaction((data) => {
        if (authorize) authorize(data, null)
        const business = ensureBusinessData(data)
        const id = randomUUID()
        const timestamp = now()
        const submission = { id, number: submissionNumber(type, id), type, resourceType: '', resourceId: '', accountId: '', actorSnapshot: { name: payload.applicantName || payload.submitterName || '管理员代录' }, payload, status: 'submitted', revision: 1, createdAt: timestamp, updatedAt: timestamp, adminReply: payload.adminReply || '', adminNote: payload.adminNote || '' }
        business.submissions.unshift(submission)
        business.revision += 1
        data.auditLogs.unshift(audit('business.admin_created', id, metadata, { resource }))
        return submissionAdminView(submission, data)
      })
    }
    if (!isStoredResource(resource)) throw businessError('该板块不支持新增', 'ADMIN_CREATE_DISABLED', 405)
    const normalizeWithOrganization = organizationContentResources.has(resource)
    return this.database.transaction((data) => {
      if (authorize) authorize(data, null)
      if (!normalizeWithOrganization) payload = normalizeAdminPayload(resource, payload, {}, this.normalizationOptions)
      const business = ensureBusinessData(data)
      let normalizedPayload = payload
      if (normalizeWithOrganization) {
        const organizationId = String(payload.organizationId || '').trim()
        const organization = organizationId
          ? business.resources.organizations.find((item) => item.id === organizationId)
          : null
        if (organizationId && !organization) {
          throw businessError('关联校友组织不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
        }
        normalizedPayload = normalizeAdminPayload(
          resource,
          {
            ...payload,
            ...(organization ? { organizationId: organization.id } : {}),
            ...(organization && resource === 'activities'
              ? { organizer: organization.name }
              : {})
          },
          {},
          this.normalizationOptions
        )
      }
      const timestamp = now()
      const record = {
        id: randomUUID(),
        resource,
        ...normalizedPayload,
        ...(resource === 'mentors' ? {
          ownerAccountId: '',
          verificationStatus: 'unverified',
          mentorOwnerBoundAt: null,
          mentorVerifiedAt: null
        } : {}),
        ...(resource === 'alumni-enterprises' ? {
          ownerAccountId: '',
          verificationStatus: 'unverified',
          certificationApplicantAccountId: '',
          certificationMaterials: [],
          pendingOwnerProfile: {},
          ownerProfileReviewStatus: '',
          ownerProfileSubmittedAt: null,
          ownerProfileReviewedAt: null,
          ownerProfileReviewedBy: '',
          ownerProfileReviewNote: '',
          unifiedSocialCreditCodeMasked: '',
          unifiedSocialCreditCodeKey: '',
          unifiedSocialCreditCodeEncrypted: '',
          enterpriseVerifiedAt: null,
          enterpriseReviewedAt: null,
          enterpriseReviewedBy: ''
        } : {}),
        status: defaultStatuses[resource] || 'draft',
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: metadata.actor || 'admin',
        updatedBy: metadata.actor || 'admin'
      }
      business.resources[resource].unshift(record)
      business.revision += 1
      data.auditLogs.unshift(audit('business.admin_created', record.id, metadata, { resource }))
      if (resource === 'alumni-enterprises') {
        return enterpriseAdminView(record, data, this.config.dataHashSecret, { includeSensitive: true })
      }
      if (resource === 'jobs') return jobAdminView(record, data)
      return { ...record, recordKind: 'resource' }
    })
  }

  async updateAdmin(resource, id, input, metadata = {}, authorize = null) {
    if (!isBusinessResource(resource)) throw businessError('业务板块不存在', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    const payload = sanitizeObject(input || {})
    const expectedRevisionValue = payload.expectedRevision
    delete payload.expectedRevision
    const expectedRevision = expectedRevisionValue === undefined || expectedRevisionValue === null || expectedRevisionValue === ''
      ? null
      : Number(expectedRevisionValue)
    if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
      throw businessError('expectedRevision 必须是正整数', 'BUSINESS_REVISION_INVALID', 400)
    }
    const protectedFields = [
      'id', 'resource', 'resourceType', 'resourceId', 'createdAt', 'createdBy', 'revision',
      'accountId', 'actorSnapshot', 'authorAccountId', 'status',
      'anonymousIdentity', 'publicationMode', 'anonymousNickname',
      'automaticAffiliation', 'automaticMembership', 'automaticAffiliationKey', 'automaticEndReason',
      ...certificateProtectedFields,
      ...(resource === 'mentors'
        ? ['owner', 'ownerAccountId', 'verificationStatus', 'mentorOwnerBoundAt', 'mentorVerifiedAt']
        : []),
      ...(resource === 'alumni-enterprises'
        ? [...enterpriseProtectedFields, 'certificationSubmittedAt']
        : []),
      ...(resource === 'jobs'
        ? ['authorAccountId', 'ownerEnterpriseId']
        : []),
      ...(resource === 'collaboration-opportunities'
        ? ['authorName', 'authorDepartment', 'cancelledAt']
        : [])
    ]
    const attempted = protectedFields.find((key) => Object.prototype.hasOwnProperty.call(payload, key))
    if (attempted) throw businessError(`字段 ${attempted} 不能通过编辑接口修改`, 'BUSINESS_PROTECTED_FIELD', 400)
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const stored = business.resources[resource]?.find((item) => item.id === id)
      const submission = business.submissions.find((item) => item.id === id && (
        submissionBackedResources[resource]?.includes(item.type)
        || (resource === 'volunteers' && item.type === 'volunteer-application')
      ))
      if (!stored && !submission) throw businessError('业务记录不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      if (stored?.automaticAffiliation && ['type', 'college', 'grade', 'major', 'className', 'city', 'regionCode', 'interestTags', 'industry'].some(key => Object.hasOwn(payload, key) && JSON.stringify(payload[key]) !== JSON.stringify(stored[key] ?? (key === 'interestTags' ? [] : '')))) throw businessError('自动组织的匹配范围由认证资料维护，可编辑名称、说明、联系方式或执行下架', 'AUTO_ORGANIZATION_SCOPE_LOCKED', 409)
      if (submission?.type === 'community-comment' && Object.keys(payload).some(key => !['content', 'adminReply', 'adminNote'].includes(key))) throw businessError('评论编辑仅支持正文、管理回复和内部备注，不能更改发布身份', 'BUSINESS_PROTECTED_FIELD', 400)
      if (stored && resource === 'jobs' && stored.ownerEnterpriseId) {
        const attemptedBindingField = ['company', 'enterpriseId']
          .find((key) => Object.prototype.hasOwnProperty.call(payload, key))
        if (attemptedBindingField) {
          throw businessError(
            `企业自助岗位字段 ${attemptedBindingField} 由认证企业归属自动维护`,
            'BUSINESS_PROTECTED_FIELD',
            400
          )
        }
      }
      const authorizationRecord = stored
        ? { ...stored, recordKind: 'resource' }
        : submissionAdminView(submission, data)
      if (authorize) authorize(data, authorizationRecord)
      let linkedOrganization = null
      if (stored && organizationContentResources.has(resource)) {
        const storedOrganizationId = String(stored.organizationId || '')
        if (Object.prototype.hasOwnProperty.call(payload, 'organizationId')) {
          const requestedOrganizationId = String(payload.organizationId || '').trim()
          if (requestedOrganizationId !== storedOrganizationId) {
            throw businessError(
              '组织事项不能改绑到其他校友组织',
              'BUSINESS_PROTECTED_FIELD',
              400
            )
          }
          delete payload.organizationId
        }
        if (storedOrganizationId) {
          linkedOrganization = business.resources.organizations
            .find((item) => item.id === storedOrganizationId)
          if (!linkedOrganization) {
            throw businessError(
              '组织事项关联的校友组织不存在',
              'ORGANIZATION_PARENT_INVALID',
              409
            )
          }
        }
      }
      const target = stored || submission
      if (expectedRevision !== null && Number(target.revision || 0) !== expectedRevision) {
        throw businessError('该记录已被其他管理员更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
      }
      if (stored) {
        const profileReviewStatus = resource === 'alumni-enterprises'
          ? enterpriseOwnerProfileReviewStatus(stored)
          : ''
        const normalizationBase = profileReviewStatus
          ? { ...stored, ...(enterprisePendingOwnerProfile(stored) || {}) }
          : stored
        const normalized = normalizeAdminPayload(
          resource,
          {
            ...payload,
            ...(linkedOrganization && resource === 'activities'
              ? { organizer: linkedOrganization.name }
              : {})
          },
          normalizationBase,
          this.normalizationOptions
        )
        const identity = resource === 'mentors' && stored.ownerAccountId
          ? data.accounts.find((account) => account.id === stored.ownerAccountId && account.status === 'active')
          : null
        const ownerEnterprise = resource === 'jobs' && stored.ownerEnterpriseId
          ? business.resources['alumni-enterprises'].find((item) => item.id === stored.ownerEnterpriseId)
          : null
        if (resource === 'jobs' && stored.ownerEnterpriseId && !ownerEnterprise) {
          throw businessError('企业岗位绑定的认证企业不存在', 'ENTERPRISE_JOB_OWNER_INVALID', 409)
        }
        const directUpdates = { ...normalized }
        if (profileReviewStatus) {
          const pendingUpdates = {}
          for (const field of enterpriseStoredProfileFields) {
            if (!Object.prototype.hasOwnProperty.call(directUpdates, field)) continue
            pendingUpdates[field] = directUpdates[field]
            delete directUpdates[field]
          }
          stored.pendingOwnerProfile = {
            ...(enterprisePendingOwnerProfile(stored) || {}),
            ...pendingUpdates
          }
        }
        Object.assign(stored, directUpdates, {
          ...(identity ? { name: identity.name, department: identity.department || '' } : {}),
          ...(ownerEnterprise
            ? { company: ownerEnterprise.name, enterpriseId: ownerEnterprise.id }
            : {}),
          updatedAt: now(),
          updatedBy: metadata.actor || 'admin',
          revision: Number(stored.revision || 0) + 1
        })
        if (resource === 'organizations'
          && Object.prototype.hasOwnProperty.call(directUpdates, 'name')) {
          for (const activity of business.resources.activities
            .filter((item) => item.organizationId === stored.id)) {
            if (activity.organizer === stored.name) continue
            activity.organizer = stored.name
            activity.updatedAt = stored.updatedAt
            activity.updatedBy = metadata.actor || 'admin'
            activity.revision = Number(activity.revision || 0) + 1
          }
        }
      } else {
        const topLevelKeys = ['status', 'adminReply', 'adminNote']
        for (const key of topLevelKeys) if (payload[key] !== undefined) submission[key] = payload[key]
        const nested = { ...payload }
        for (const key of topLevelKeys) delete nested[key]
        submission.payload = { ...(submission.payload || {}), ...nested }
        submission.updatedAt = now()
        submission.revision = Number(submission.revision || 0) + 1
      }
      business.revision += 1
      data.auditLogs.unshift(audit('business.admin_updated', id, metadata, { resource }))
      if (!stored) return submissionAdminView(submission, data)
      if (resource === 'alumni-enterprises') {
        return enterpriseAdminView(stored, data, this.config.dataHashSecret, { includeSensitive: true })
      }
      if (resource === 'jobs') return jobAdminView(stored, data)
      return { ...stored, recordKind: 'resource' }
    })
  }

  actionStatus(resource, action, recordKind) {
    if (action === 'approve') {
      return recordKind === 'submission'
        ? 'approved'
        : (['community-posts', 'jobs', 'mentors', 'collaboration-opportunities'].includes(resource) ? 'published' : 'approved')
    }
    if (action === 'publish') return resource === 'volunteers' ? 'recruiting' : 'published'
    return ({ unpublish: 'offline', reject: 'rejected', start: 'processing', complete: 'completed', resolve: 'resolved', close: 'closed', show: 'visible', hide: 'hidden' })[action] || ''
  }

  actionAllowed(action, currentStatus) {
    const allowed = {
      approve: ['submitted', 'pending_review', 'draft'], publish: ['draft', 'offline', 'approved'],
      unpublish: ['published', 'recruiting'], reject: ['submitted', 'pending_review'],
      start: ['submitted', 'pending_review'], complete: ['approved', 'processing', 'published', 'closed', 'recruiting'],
      resolve: ['submitted', 'pending_review', 'processing'], close: ['published', 'resolved', 'processing'],
      show: ['hidden', 'pending_review'], hide: ['visible']
    }
    return (allowed[action] || []).includes(String(currentStatus || ''))
  }

  async actAdmin(resource, id, input, metadata = {}, authorize = null) {
    if (!isBusinessResource(resource)) throw businessError('业务板块不存在', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    const body = sanitizeObject(input || {})
    const action = String(body.action || '')
    if (resource === 'academic-calendar' && !['publish', 'unpublish'].includes(action)) {
      throw businessError('校历事项仅支持发布或下架操作', 'BUSINESS_ACTION_INVALID', 400)
    }
    return this.database.transaction((data) => {
      const business = ensureBusinessData(data)
      const stored = business.resources[resource]?.find((item) => item.id === id)
      const submission = business.submissions.find((item) => item.id === id && (
        submissionBackedResources[resource]?.includes(item.type)
        || (resource === 'volunteers' && item.type === 'volunteer-application')
      ))
      if (!stored && !submission) throw businessError('业务记录不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
      const recordKind = stored ? 'resource' : 'submission'
      const authorizationRecord = stored
        ? { ...stored, recordKind }
        : submissionAdminView(submission, data)
      if (authorize) authorize(data, authorizationRecord)
      const speechSubmission = submission && directSpeechTypes.has(submission.type)
      if (action === 'remove_member') {
        if (submission?.type !== 'organization-membership' || !['approved', 'active', 'joined', 'submitted', 'pending_review'].includes(submission.status)) throw businessError('只能移出有效组织成员或取消加入申请', 'ORGANIZATION_MEMBER_REMOVE_INVALID', 409)
        if (!String(body.reason || '').trim()) throw businessError('请填写移出组织的原因', 'BUSINESS_ACTION_REASON_REQUIRED', 400)
        const expected = expectedRevisionFrom(body.expectedRevision)
        if (expected !== null && expected !== Number(submission.revision || 0)) throw businessError('成员状态已更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
        submission.status = 'cancelled'; submission.automaticEndReason = 'admin_removed'; submission.updatedAt = now(); submission.revision = Number(submission.revision || 0) + 1
        submission.adminNote = String(body.reason).trim().slice(0, 1000)
        optOutAutomaticOrganization(business, submission, 'admin_removed', metadata.actor)
        business.revision += 1
        data.auditLogs.unshift(audit('business.organization_member_removed', submission.id, metadata, { organizationId: submission.resourceId, accountId: submission.accountId, reason: submission.adminNote }))
        return submissionAdminView(submission, data)
      }
      const speechRecord = speechSubmission || (stored && resource === 'community-posts')
      if (submission && !speechSubmission && ['publish', 'unpublish'].includes(action)) {
        throw businessError('该申请不支持发言上下架操作', 'BUSINESS_ACTION_INVALID', 400)
      }
      if (speechRecord) {
        const expectedRevision = expectedRevisionFrom(body.expectedRevision)
        if (expectedRevision !== null && Number((stored || submission).revision || 0) !== expectedRevision) {
          throw businessError('该内容已更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
        }
      }
      if (speechRecord && !['approve', 'reject', 'publish', 'unpublish'].includes(action)) {
        throw businessError('发言仅支持下架、恢复展示或处理历史待审核内容', 'BUSINESS_ACTION_INVALID', 400)
      }
      if (speechSubmission && ['publish', 'approve'].includes(action)) {
        const author = requireSchoolVerifiedAccount(data.accounts.find((item) => item.id === submission.accountId && item.status === 'active'))
        const parentResource = resourceForSubmission(submission.type)
        const parent = business.resources[parentResource]?.find((item) => item.id === submission.resourceId)
        if (!parent || !isPublicRecordVisible(parentResource, parent, author)) {
          throw businessError('关联内容已下架或不可见，不能恢复发言', 'SUBMISSION_RESOURCE_NOT_FOUND', 409)
        }
      }
      const linkedOrganization = stored
        && organizationContentResources.has(resource)
        && stored.organizationId
        ? business.resources.organizations.find((item) => item.id === stored.organizationId)
        : null
      if (stored && organizationContentResources.has(resource) && stored.organizationId && !linkedOrganization) {
        throw businessError(
          '组织事项关联的校友组织不存在',
          'ORGANIZATION_PARENT_INVALID',
          409
        )
      }
      if (linkedOrganization && action === 'publish' && linkedOrganization.status !== 'published') {
        throw businessError(
          '校友组织尚未发布或已下架，不能发布组织事项',
          'ORGANIZATION_NOT_PUBLISHED',
          409
        )
      }
      if (action === 'issue_certificate') {
        if (!submission || submission.type !== 'giving-intent') {
          throw businessError('公益证书只能为公益参与意向签发', 'GIVING_CERTIFICATE_ACTION_INVALID', 400)
        }
        if (submission.certificate) {
          throw businessError('该公益意向已经签发证书', 'GIVING_CERTIFICATE_ALREADY_ISSUED', 409)
        }
        if (!['submitted', 'pending_review', 'processing', 'approved'].includes(submission.status)) {
          throw businessError('当前公益意向状态不能签发证书', 'GIVING_CERTIFICATE_STATE_INVALID', 409)
        }
        const recipient = data.accounts.find((item) => (
          item.id === submission.accountId
          && item.status === 'active'
          && item.schoolIdentityVerified
        ))
        if (!recipient) {
          throw businessError('证书领取人尚未完成有效学校实名校验', 'GIVING_CERTIFICATE_IDENTITY_REQUIRED', 409)
        }
        const certificateInput = normalizedGivingCertificateInput(body, this.normalizationOptions)
        if (certificateInput.expectedRevision !== null
          && Number(submission.revision || 0) !== certificateInput.expectedRevision) {
          throw businessError('公益意向已更新，请刷新后重试', 'BUSINESS_REVISION_CONFLICT', 409)
        }
        const duplicateReceipt = business.submissions.find((item) => (
          item.id !== submission.id
          && item.certificate?.officialReceiptNo === certificateInput.officialReceiptNo
        ))
        if (duplicateReceipt) {
          throw businessError('该官方回执号已经用于其他公益证书', 'GIVING_CERTIFICATE_RECEIPT_DUPLICATE', 409)
        }
        const project = business.resources['giving-projects']
          .find((item) => item.id === submission.resourceId)
        if ((project?.certificateTemplate || certificateInput.expectedProjectRevision !== null)
          && Number(project?.revision||0) !== certificateInput.expectedProjectRevision) {
          throw businessError('项目或证书模板已变化，请刷新后重新核对签发预览','GIVING_TEMPLATE_REVISION_CONFLICT',409)
        }
        const templateSnapshot = givingTemplateSnapshot(project,certificateInput)
        const issuedAt = now()
        submission.certificate = {
          certificateNo: givingCertificateNumber(business),
          recipientName: recipient.name || recipient.username || '湖财人',
          projectTitle: project?.title || submission.payload?.projectTitle || '公益项目',
          confirmedAmount: certificateInput.confirmedAmount,
          donatedAt: certificateInput.donatedAt,
          officialReceiptNo: certificateInput.officialReceiptNo,
          issuer: templateSnapshot.issuer,
          title: templateSnapshot.title,
          templateSnapshot,
          templateProjectRevision: project?.revision || null,
          issuedAt,
          note: certificateInput.note
        }
        submission.status = 'completed'
        submission.completedAt = issuedAt
        submission.completedBy = metadata.actor || 'admin'
        submission.updatedAt = issuedAt
        submission.revision = Number(submission.revision || 0) + 1
        business.revision += 1
        createNotification(business, {
          accountId: submission.accountId,
          type: 'giving.certificate_issued',
          title: '公益捐赠证书已签发',
          body: `您参与“${String(submission.certificate.projectTitle).slice(0, 80)}”的公益捐赠证书已签发，可在我的办理记录中查看。`,
          resourceType: 'giving-projects',
          resourceId: submission.resourceId,
          status: submission.status,
          target: submissionNotificationTargets['giving-intent']
        })
        data.auditLogs.unshift(audit(
          'business.giving_certificate_issued',
          submission.id,
          metadata,
          {
            certificateNo: submission.certificate.certificateNo,
            projectId: submission.resourceId,
            templateProjectRevision: submission.certificate.templateProjectRevision,
            confirmedAmount: submission.certificate.confirmedAmount
          }
        ))
        return submissionAdminView(submission, data)
      }
      if (submission?.type === 'giving-intent' && ['approve', 'complete'].includes(action)) {
        throw businessError(
          '公益参与意向必须通过 issue_certificate 完成到账核验和证书签发',
          'GIVING_CERTIFICATE_ACTION_REQUIRED',
          409
        )
      }
      const enterpriseProfileReview = stored
        && resource === 'alumni-enterprises'
        && enterpriseOwnerProfileReviewStatus(stored) === 'pending_review'
        && Boolean(enterprisePendingOwnerProfile(stored))
      if (enterpriseProfileReview && !['approve', 'reject'].includes(action)) {
        throw businessError('企业资料待审版本仅支持通过或驳回', 'BUSINESS_ACTION_INVALID', 400)
      }
      const enterpriseCertification = stored
        && resource === 'alumni-enterprises'
        && !enterpriseProfileReview
        && Boolean(stored.certificationApplicantAccountId)
      if (enterpriseCertification) {
        if (!['approve', 'reject', 'publish', 'unpublish'].includes(action)) {
          throw businessError('企业认证记录不支持该操作', 'BUSINESS_ACTION_INVALID', 400)
        }
        if (['approve', 'reject'].includes(action) && stored.status !== 'pending_review') {
          throw businessError('只有待审核企业认证可以执行审核操作', 'BUSINESS_ACTION_STATE_INVALID', 409)
        }
        if (action === 'publish' && enterpriseVerificationStatus(stored) !== 'verified') {
          throw businessError('企业认证通过后才能发布', 'ENTERPRISE_VERIFICATION_REQUIRED', 409)
        }
      }
      const enterpriseOwnedJob = stored
        && resource === 'jobs'
        && Boolean(stored.authorAccountId || stored.ownerEnterpriseId)
      if (enterpriseOwnedJob && !['approve', 'reject', 'publish', 'unpublish'].includes(action)) {
        throw businessError('企业自助岗位不支持该操作', 'BUSINESS_ACTION_INVALID', 400)
      }
      const status = enterpriseProfileReview
        ? (action === 'approve' ? stored.status : 'rejected')
        : this.actionStatus(resource, action, recordKind)
      if (!status) throw businessError('不支持的业务操作', 'BUSINESS_ACTION_INVALID', 400)
      const target = stored || submission
      if (resource === 'academic-calendar') {
        const allowedStatuses = action === 'publish' ? ['draft', 'offline'] : ['published']
        if (!allowedStatuses.includes(target.status)) {
          throw businessError('当前状态不能执行该操作', 'BUSINESS_ACTION_STATE_INVALID', 409)
        }
      }
      const actionAllowed = speechSubmission && action === 'unpublish'
        ? visibleSpeechStatuses.includes(target.status)
        : (speechSubmission && target.status === 'processing' && ['approve', 'reject'].includes(action)) || this.actionAllowed(action, target.status)
      if (!enterpriseProfileReview && !actionAllowed) {
        throw businessError('当前状态不能执行该操作', 'BUSINESS_ACTION_STATE_INVALID', 409)
      }
      const actionReason = String(body.reason || '').trim().slice(0, 1000)
      if (action === 'reject' && !actionReason) {
        throw businessError('驳回操作必须填写原因', 'BUSINESS_ACTION_REASON_REQUIRED', 400)
      }
      if (speechRecord && action === 'unpublish' && !actionReason) {
        throw businessError('下架发言必须填写原因，便于通知作者和审计追溯', 'BUSINESS_ACTION_REASON_REQUIRED', 400)
      }
      if (stored && resource === 'alumni-benefits' && ['publish', 'approve'].includes(action)) {
        const endsAt = Date.parse(stored.endAt)
        if (!Number.isFinite(endsAt) || endsAt <= Date.now()) {
          throw businessError('权益有效期已结束，不能公开发布', 'BENEFIT_EXPIRED', 409)
        }
      }
      if (body.patch !== undefined) throw businessError('动作接口不接受任意字段 patch，请使用受保护的编辑接口', 'BUSINESS_ACTION_PATCH_FORBIDDEN', 400)
      let enterpriseApplicant = null
      if (enterpriseCertification && action === 'approve') {
        enterpriseApplicant = data.accounts.find((item) => (
          item.id === stored.certificationApplicantAccountId
          && item.status === 'active'
          && item.schoolIdentityVerified
        ))
        if (!enterpriseApplicant) {
          throw businessError('企业认证申请人的学校实名账号不可用', 'ENTERPRISE_APPLICANT_INVALID', 409)
        }
        if (!(stored.certificationMaterials || []).length || !stored.unifiedSocialCreditCodeKey) {
          throw businessError('企业认证材料或统一社会信用代码不完整', 'ENTERPRISE_CERTIFICATION_INCOMPLETE', 409)
        }
        const ownerDuplicate = business.resources['alumni-enterprises'].find((item) => (
          item.id !== stored.id
          && item.ownerAccountId === enterpriseApplicant.id
          && enterpriseVerificationStatus(item) === 'verified'
          && item.status !== 'cancelled'
        ))
        if (ownerDuplicate) {
          throw businessError('该实名账号已绑定其他认证企业', 'ENTERPRISE_OWNER_ALREADY_BOUND', 409)
        }
        const creditDuplicate = business.resources['alumni-enterprises'].find((item) => (
          item.id !== stored.id
          && item.status !== 'cancelled'
          && item.unifiedSocialCreditCodeKey
          && item.unifiedSocialCreditCodeKey === stored.unifiedSocialCreditCodeKey
        ))
        if (creditDuplicate) {
          throw businessError('该统一社会信用代码已存在认证记录', 'ENTERPRISE_CREDIT_CODE_DUPLICATE', 409)
        }
      }
      if (enterpriseProfileReview) {
        const timestamp = now()
        if (action === 'approve') {
          Object.assign(stored, enterprisePendingOwnerProfile(stored) || {})
          stored.pendingOwnerProfile = {}
          stored.ownerProfileReviewStatus = ''
          stored.ownerProfileReviewNote = ''
        } else {
          stored.ownerProfileReviewStatus = 'rejected'
          stored.ownerProfileReviewNote = actionReason
        }
        stored.ownerProfileReviewedAt = timestamp
        stored.ownerProfileReviewedBy = metadata.actor || 'admin'
      } else {
        target.status = status
        if (stored && linkedOrganization && resource === 'activities') {
          stored.organizer = linkedOrganization.name
        }
        if (action === 'reject') target.rejectionReason = actionReason
        else if (actionReason) target.adminNote = actionReason
        if (speechRecord && action === 'unpublish') target.takedownReason = actionReason
        if (speechRecord && ['publish', 'approve'].includes(action)) target.takedownReason = ''
      }
      if (enterpriseCertification && action === 'approve') {
        Object.assign(stored, {
          ownerAccountId: enterpriseApplicant.id,
          verificationStatus: 'verified',
          enterpriseVerifiedAt: now(),
          enterpriseReviewedAt: now(),
          enterpriseReviewedBy: metadata.actor || 'admin',
          rejectionReason: ''
        })
      } else if (enterpriseCertification && action === 'reject') {
        Object.assign(stored, {
          ownerAccountId: '',
          verificationStatus: 'rejected',
          enterpriseVerifiedAt: null,
          enterpriseReviewedAt: now(),
          enterpriseReviewedBy: metadata.actor || 'admin'
        })
      }
      target.updatedAt = now()
      if (submission?.type === 'organization-membership' && ['rejected', 'completed', 'closed', 'cancelled'].includes(target.status)) {
        optOutAutomaticOrganization(business, submission, 'admin_removed', metadata.actor)
        submission.automaticEndReason = 'admin_removed'
      }
      if (submission?.type === 'organization-membership' && action === 'approve') business.automaticOrganizationOptOuts = (business.automaticOrganizationOptOuts || []).filter(row => row.accountId !== submission.accountId || row.organizationId !== submission.resourceId)
      target.revision = Number(target.revision || 0) + 1
      business.revision += 1
      if (submission && notificationSubmissionActions.has(action) && submission.accountId) {
        const subject = submissionTypeLabels[submission.type] || '业务申请'
        const stateLabel = notificationActionLabels[action] || '状态已更新'
        const publicReason = ['reject', 'unpublish'].includes(action) ? actionReason : ''
        createNotification(business, {
          accountId: submission.accountId,
          type: `submission.${action}`,
          title: `${subject}${stateLabel}`,
          body: `您提交的${subject}（${submission.number}）${stateLabel}${publicReason ? `：${publicReason}` : ''}，请进入我的记录查看详情。`,
          resourceType: submission.resourceType || resource,
          resourceId: submission.resourceId || submission.id,
          status,
          target: submissionNotificationTargets[submission.type] || ''
        })
      }
      if (stored && resource === 'community-posts' && stored.authorAccountId && ['unpublish', 'publish'].includes(action)) {
        createNotification(business, {
          accountId: stored.authorAccountId,
          type: `community.${action}`,
          title: `湖财圈动态${notificationActionLabels[action]}`,
          body: action === 'unpublish' ? `您的动态已下架，原因：${actionReason}` : '您的动态已恢复展示。',
          resourceType: resource, resourceId: stored.id, status, target: '/pages/community/index'
        })
      }
      if (stored && resource === 'collaboration-opportunities'
        && stored.authorAccountId
        && ['approve', 'reject'].includes(action)) {
        const stateLabel = action === 'approve' ? '已通过审核并发布' : '未通过审核'
        const publicReason = action === 'reject' ? actionReason : ''
        createNotification(business, {
          accountId: stored.authorAccountId,
          type: `collaboration.${action}`,
          title: `合作信息${action === 'approve' ? '审核通过' : '审核未通过'}`,
          body: `您提交的合作信息“${String(stored.title || '未命名合作').slice(0, 80)}”${stateLabel}${publicReason ? `：${publicReason}` : ''}，请进入我的发布查看详情。`,
          resourceType: 'collaboration-opportunities',
          resourceId: stored.id,
          status,
          target: collaborationNotificationTarget
        })
      }
      if (enterpriseCertification && ['approve', 'reject'].includes(action)) {
        const approved = action === 'approve'
        createNotification(business, {
          accountId: stored.certificationApplicantAccountId,
          type: `enterprise.certification_${action}`,
          title: approved ? '企业认证已通过' : '企业认证未通过',
          body: approved
            ? `企业“${String(stored.name || '未命名企业').slice(0, 80)}”已完成认证，您现在可以维护企业资料并提交岗位。`
            : `企业“${String(stored.name || '未命名企业').slice(0, 80)}”认证未通过${actionReason ? `：${actionReason}` : ''}。`,
          resourceType: 'alumni-enterprises',
          resourceId: stored.id,
          status: stored.status,
          target: enterpriseNotificationTarget
        })
      }
      if (enterpriseProfileReview) {
        const approved = action === 'approve'
        createNotification(business, {
          accountId: stored.ownerAccountId,
          type: `enterprise.profile_${action}`,
          title: approved ? '企业资料审核通过' : '企业资料需要修改',
          body: approved
            ? `企业“${String(stored.name || '未命名企业').slice(0, 80)}”的资料修改已审核通过。`
            : `企业“${String(stored.name || '未命名企业').slice(0, 80)}”的资料修改未通过审核：${actionReason}`,
          resourceType: 'alumni-enterprises',
          resourceId: stored.id,
          status: enterpriseOwnerProfileReviewStatus(stored) || stored.status,
          target: enterpriseNotificationTarget
        })
      }
      if (enterpriseOwnedJob && stored.authorAccountId && ['approve', 'reject'].includes(action)) {
        const approved = action === 'approve'
        createNotification(business, {
          accountId: stored.authorAccountId,
          type: `job.${action}`,
          title: approved ? '企业岗位已发布' : '企业岗位未通过审核',
          body: approved
            ? `岗位“${String(stored.title || '未命名岗位').slice(0, 80)}”已通过审核并公开发布。`
            : `岗位“${String(stored.title || '未命名岗位').slice(0, 80)}”未通过审核${actionReason ? `：${actionReason}` : ''}。`,
          resourceType: 'jobs',
          resourceId: stored.id,
          status: stored.status,
          target: jobOwnerNotificationTarget
        })
      }
      const auditAction = enterpriseProfileReview
        ? `business.enterprise_profile_${action === 'approve' ? 'approved' : 'rejected'}`
        : `business.admin_${action}`
      data.auditLogs.unshift(audit(auditAction, id, metadata, {
        resource,
        status,
        publicationStatus: enterpriseProfileReview ? stored.status : undefined,
        reason: body.reason || ''
      }))
      if (!stored) return submissionAdminView(submission, data)
      if (resource === 'alumni-enterprises') {
        return enterpriseAdminView(stored, data, this.config.dataHashSecret, { includeSensitive: true })
      }
      if (resource === 'jobs') return jobAdminView(stored, data)
      return { ...stored, recordKind }
    })
  }

  summary(predicate = null) {
    return this.database.read((data) => {
      const business = ensureBusinessData(data)
      const accessibleSubmissionIds = new Set()
      const resources = Object.fromEntries(businessResourceKeys.map((resource) => {
        const available = filterModuleRecords(data,resource,this.adminRecords(data, resource))
        const records = predicate ? available.filter((record) => predicate(record, data, resource)) : available
        for (const record of records) if (record.recordKind === 'submission') accessibleSubmissionIds.add(record.id)
        return [resource, {
          total: records.length,
          pending: records.filter((item) => ['submitted', 'pending_review', 'processing'].includes(item.status)).length,
          public: records.filter((item) => ['published', 'visible', 'recruiting'].includes(item.status)).length
        }]
      }))
      return { revision: business.revision, resources, submissions: predicate ? accessibleSubmissionIds.size : filterModuleRecords(data,'applications',business.submissions).length }
    })
  }
}
