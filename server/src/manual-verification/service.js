import { auditRecord } from '../audit/metadata.js'
import { randomUUID } from 'node:crypto'
import { hmac, randomToken, safeEqual, sha256 } from '../auth/crypto.js'
import {sealStudentNumber} from '../accounts/student-number.js'

const statuses = Object.freeze([
  'draft',
  'submitted',
  'under_review',
  'needs_more',
  'approved',
  'rejected',
  'cancelled'
])

const personTypes = Object.freeze(['student', 'faculty', 'staff', 'alumni', 'member'])
const materialTypes = Object.freeze(['graduation_certificate', 'student_record', 'identity_document', 'other_evidence'])
const editableStatuses = new Set(['draft', 'needs_more', 'rejected'])
const terminalStatuses = new Set(['approved', 'rejected', 'cancelled'])
const maximumMaterials = 10
export const MANUAL_TRACKING_TTL_MS = 90 * 24 * 60 * 60 * 1000
export const MANUAL_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

function now() { return new Date().toISOString() }

function reviewError(message, code = 'MANUAL_VERIFICATION_INVALID', statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode })
}

function ensureApplications(data) {
  if (!Array.isArray(data.manualIdentityVerifications)) data.manualIdentityVerifications = []
  return data.manualIdentityVerifications
}

function ensureMediaOrphans(data) {
  if (!Array.isArray(data.manualVerificationMediaOrphans)) data.manualVerificationMediaOrphans = []
  return data.manualVerificationMediaOrphans
}

function audit(action, targetId, metadata = {}, details = {}) { return auditRecord(action, targetId, { ...metadata, actor: metadata.actor || 'manual-verification-applicant' }, details) }

function history(action, status, metadata = {}, note = '') {
  return {
    id: randomUUID(),
    action,
    status,
    note: String(note || '').trim().slice(0, 1000),
    actor: metadata.actor || 'manual-verification-applicant',
    createdAt: now()
  }
}

function valueFrom(input, names) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      return { present: true, value: source[name] }
    }
  }
  return { present: false, value: undefined }
}

function cleanText(value, label, maximum, { minimum = 0 } = {}) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw reviewError(`${label}格式无效`, 'MANUAL_VERIFICATION_FIELD_INVALID')
  }
  const result = String(value).trim()
  if (result.length > maximum) throw reviewError(`${label}不能超过 ${maximum} 个字符`, 'MANUAL_VERIFICATION_FIELD_INVALID')
  if (result && result.length < minimum) throw reviewError(`${label}至少需要 ${minimum} 个字符`, 'MANUAL_VERIFICATION_FIELD_INVALID')
  return result
}

function yearValue(value, label) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  const maximum = new Date().getUTCFullYear() + 1
  if (!Number.isInteger(parsed) || parsed < 1949 || parsed > maximum) {
    throw reviewError(`${label}须为 1949-${maximum} 之间的年份`, 'MANUAL_VERIFICATION_YEAR_INVALID')
  }
  return parsed
}

function maskStudentId(value) {
  if (!value) return ''
  if (value.length <= 4) return '****'
  return `${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`
}

function maskIdCard(value) {
  if (!value) return ''
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(8, value.length - 8))}${value.slice(-4)}`
}

function maskPhone(value) {
  if (!value) return ''
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

function normalizeStudentId(value, secret) {
  const studentId = String(value || '').replace(/\s+/g, '')
  if (!studentId) return { studentIdMasked: '', studentIdKey: '', studentIdSealed: '' }
  if (!/^[A-Za-z0-9_.-]{4,40}$/.test(studentId)) {
    throw reviewError('学号或工号格式无效', 'MANUAL_VERIFICATION_STUDENT_ID_INVALID')
  }
  return {
    studentIdMasked: maskStudentId(studentId),
    studentIdKey: hmac(`student-id:${studentId}`, secret),
    studentIdSealed: sealStudentNumber(studentId,secret)
  }
}

function normalizeIdCard(value, secret) {
  const idCard = String(value || '').replace(/\s+/g, '').toUpperCase()
  if (!idCard) return { idCardMasked: '', idCardKey: '' }
  if (!/^\d{17}[\dX]$/.test(idCard)) {
    throw reviewError('身份证号须为 18 位有效格式', 'MANUAL_VERIFICATION_ID_CARD_INVALID')
  }
  return {
    idCardMasked: maskIdCard(idCard),
    idCardKey: hmac(`id-card:${idCard}`, secret)
  }
}

function normalizePhone(value, secret) {
  const phone = String(value || '').replace(/[\s-]+/g, '')
  if (!phone) return { phoneMasked: '', phoneKey: '' }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw reviewError('手机号须为有效的 11 位号码', 'MANUAL_VERIFICATION_PHONE_INVALID')
  }
  return {
    phoneMasked: maskPhone(phone),
    phoneKey: hmac(`phone:${phone}`, secret)
  }
}

function updateProfile(current = {}, input = {}, secret) {
  const profile = { ...current }
  const textFields = [
    { target: 'name', aliases: ['name', 'realName', 'applicantName'], label: '真实姓名', maximum: 80, minimum: 2 },
    { target: 'formerName', aliases: ['formerName', 'previousName'], label: '曾用名', maximum: 80 },
    { target: 'college', aliases: ['college', 'department'], label: '学院或部门', maximum: 160, minimum: 2 },
    { target: 'major', aliases: ['major'], label: '专业', maximum: 160 },
    { target: 'statement', aliases: ['statement', 'description', 'reason', 'remark'], label: '申请说明', maximum: 3000 }
  ]
  for (const field of textFields) {
    const candidate = valueFrom(input, field.aliases)
    if (candidate.present) {
      profile[field.target] = cleanText(candidate.value, field.label, field.maximum, { minimum: field.minimum || 0 })
    }
  }

  const personType = valueFrom(input, ['personType', 'identityType'])
  if (personType.present) {
    const normalized = cleanText(personType.value, '人员类型', 30)
    if (normalized && !personTypes.includes(normalized)) {
      throw reviewError('人员类型仅支持 student、faculty、staff、alumni 或 member', 'MANUAL_VERIFICATION_PERSON_TYPE_INVALID')
    }
    profile.personType = normalized
  }

  const enrollmentYear = valueFrom(input, ['enrollmentYear', 'admissionYear'])
  if (enrollmentYear.present) profile.enrollmentYear = yearValue(enrollmentYear.value, '入学年份')
  const graduationYear = valueFrom(input, ['graduationYear'])
  if (graduationYear.present) profile.graduationYear = yearValue(graduationYear.value, '毕业年份')
  if (profile.enrollmentYear && profile.graduationYear && profile.graduationYear < profile.enrollmentYear) {
    throw reviewError('毕业年份不能早于入学年份', 'MANUAL_VERIFICATION_YEAR_INVALID')
  }

  const studentId = valueFrom(input, ['studentId', 'studentNumber', 'studentNo', 'employeeNumber'])
  if (studentId.present) Object.assign(profile, normalizeStudentId(studentId.value, secret))
  const idCard = valueFrom(input, ['idCard', 'idCardNo', 'idCardNumber', 'identityNumber'])
  if (idCard.present) Object.assign(profile, normalizeIdCard(idCard.value, secret))
  const phone = valueFrom(input, ['phone', 'mobile'])
  if (phone.present) Object.assign(profile, normalizePhone(phone.value, secret))

  return profile
}

function validateSubmission(application) {
  const profile = application.profile || {}
  assertAlumniProfile(profile)
  const required = [
    ['name', '真实姓名'],
    ['personType', '人员类型'],
    ['college', '学院或部门'],
    ['idCardKey', '身份证号'],
    ['phoneKey', '手机号'],
    ['statement', '申请说明']
  ]
  const missing = required.filter(([key]) => !profile[key]).map(([, label]) => label)
  if (['student', 'alumni', 'member'].includes(profile.personType) && !profile.major) missing.push('专业')
  if (['student', 'alumni'].includes(profile.personType) && !profile.enrollmentYear) missing.push('入学年份')
  if (profile.personType === 'alumni' && !profile.graduationYear) missing.push('毕业年份')
  if (!application.materials?.length) missing.push('证明材料')
  if (missing.length) {
    throw reviewError(`请先补全：${[...new Set(missing)].join('、')}`, 'MANUAL_VERIFICATION_INCOMPLETE')
  }
  if (profile.statement.length < 10) {
    throw reviewError('申请说明至少需要 10 个字符', 'MANUAL_VERIFICATION_INCOMPLETE')
  }
}

function assertAlumniProfile(profile = {}) {
  if (profile.personType !== 'alumni') {
    throw reviewError('人工实名复核仅用于无法通过学校官网校验的老校友', 'MANUAL_VERIFICATION_ALUMNI_ONLY', 400)
  }
}

function revisionCheck(application, input = {}) {
  if (input.expectedRevision === undefined || input.expectedRevision === null || input.expectedRevision === '') return
  if (Number(input.expectedRevision) !== Number(application.revision)) {
    throw reviewError('申请已被更新，请刷新后重试', 'MANUAL_VERIFICATION_REVISION_CONFLICT', 409)
  }
}

function materialView(application, material, { admin = false } = {}) {
  const base = admin
    ? `/api/v1/admin/manual-verifications/${application.id}/materials/${material.id}`
    : `/api/v1/auth/manual-verifications/${application.id}/materials/${material.id}`
  return {
    id: material.id,
    materialId: material.id,
    name: material.name,
    label: material.label,
    materialType: material.materialType,
    mimeType: material.mimeType,
    size: material.size,
    uploadedAt: material.uploadedAt,
    url: base,
    downloadUrl: base,
    requiresAuthorization: true
  }
}

function reviewerName(data, application) {
  const reviewer = data.accounts?.find((account) => account.id === application.claimedBy)
  return reviewer?.name || ''
}

function publicHistory(application, data, { admin = false } = {}) {
  return (application.history || []).map((item) => {
    const base = {
      id: item.id,
      action: item.action,
      status: item.status,
      note: item.note || '',
      createdAt: item.createdAt
    }
    if (!admin) return base
    const actor = data.accounts?.find((account) => account.id === item.actor)
    return { ...base, actorId: item.actor, operatorName: actor?.name || (item.actor === 'manual-verification-applicant' ? '申请人' : '') }
  })
}

function applicationView(application, data, { admin = false } = {}) {
  const profile = application.profile || {}
  return {
    id: application.id,
    applicationId: application.id,
    applicationNo: application.applicationNo,
    status: application.status,
    revision: application.revision,
    version: application.revision,
    source: 'manual_pre_registration',
    name: profile.name || '',
    applicantName: profile.name || '',
    realName: profile.name || '',
    formerName: profile.formerName || '',
    personType: profile.personType || '',
    college: profile.college || '',
    department: profile.college || '',
    major: profile.major || '',
    enrollmentYear: profile.enrollmentYear || null,
    graduationYear: profile.graduationYear || null,
    studentIdMasked: profile.studentIdMasked || '',
    studentNumberMasked: profile.studentIdMasked || '',
    idCardMasked: profile.idCardMasked || '',
    identityNumberMasked: profile.idCardMasked || '',
    phoneMasked: profile.phoneMasked || '',
    statement: profile.statement || '',
    materialCount: (application.materials || []).length,
    materials: (application.materials || []).map((item) => materialView(application, item, { admin })),
    reviewNote: application.reviewNote || '',
    reviewerName: reviewerName(data, application),
    submittedAt: application.submittedAt || null,
    claimedAt: application.claimedAt || null,
    reviewedAt: application.reviewedAt || null,
    cancelledAt: application.cancelledAt || null,
    trackingExpiresAt: application.trackingExpiresAt || null,
    expiryCleanupAt: application.expiryCleanupAt || null,
    closureReason: application.closureReason || '',
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    canEdit: editableStatuses.has(application.status),
    canSubmit: editableStatuses.has(application.status),
    canExchange: application.status === 'approved',
    history: publicHistory(application, data, { admin })
  }
}

function authorizedApplication(data, id, trackingToken) {
  const application = ensureApplications(data).find((item) => item.id === String(id || ''))
  const token = String(trackingToken || '')
  const valid = Boolean(
    application
    && token.length >= 40
    && application.trackingTokenHash
    && safeEqual(application.trackingTokenHash, sha256(token))
  )
  if (!valid) {
    throw reviewError('申请查询凭证无效', 'MANUAL_VERIFICATION_TRACKING_INVALID', 401)
  }
  const expiresAt = Date.parse(application.trackingExpiresAt || '')
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw reviewError('申请查询凭证已过期，请重新发起人工实名申请', 'MANUAL_VERIFICATION_TRACKING_EXPIRED', 410)
  }
  return application
}

function normalizedAdminStatus(value) {
  const aliases = {
    pending: 'submitted',
    pending_review: 'submitted',
    reviewing: 'under_review',
    in_review: 'under_review',
    supplement_required: 'needs_more',
    needs_more_info: 'needs_more'
  }
  const status = aliases[String(value || '').trim()] || String(value || '').trim()
  return status && statuses.includes(status) ? status : ''
}

function normalizedAction(value) {
  const aliases = {
    take: 'claim',
    start: 'claim',
    start_review: 'claim',
    reviewing: 'claim',
    request_supplement: 'request_more',
    supplement_required: 'request_more',
    needs_more: 'request_more',
    unclaim: 'release'
  }
  const action = String(value || '').trim()
  return aliases[action] || action
}

function reviewNote(input) {
  return cleanText(input.reviewNote ?? input.note ?? input.reason, '审核意见', 1000)
}

function generatedApplicationNo() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `MR${date}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`
}

function generatedAlumniNo(data) {
  const year = new Date().getUTCFullYear()
  const used = new Set([
    ...(data.accounts || []).map((account) => account.alumniNo).filter(Boolean),
    ...ensureApplications(data).map((item) => item.approvedIdentity?.alumniNo).filter(Boolean)
  ])
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `HUFE-${year}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
    if (!used.has(candidate)) return candidate
  }
  throw reviewError('暂时无法生成校友编号，请稍后重试', 'MANUAL_VERIFICATION_ALUMNI_NO_FAILED', 503)
}

function approvedIdentity(data, application, secret) {
  const profile = application.profile
  assertAlumniProfile(profile)
  const verifiedAt = now()
  return {
    schoolSubject: `manual-review:${hmac(`identity:${profile.idCardKey}`, secret)}`,
    name: profile.name,
    department: profile.college,
    major: profile.major || '',
    className: profile.className || '',
    enrollmentYear: profile.enrollmentYear || '',
    graduationYear: profile.graduationYear || '',
    personType: 'alumni',
    studentIdMasked: profile.studentIdMasked || '',
    studentIdKey: profile.studentIdKey || '',
    studentIdSealed: profile.studentIdSealed || '',
    idCardMasked: profile.idCardMasked,
    idCardKey: profile.idCardKey,
    idCardVerified: true,
    schoolIdentityVerified: true,
    alumniNo: generatedAlumniNo(data),
    alumniStatusVerified: true,
    verificationSource: 'manual-identity-review',
    verifiedAt,
    isAdmin: false
  }
}

export class ManualVerificationService {
  constructor(database, config, media = null) {
    this.database = database
    this.config = config
    this.media = media
    this.cleanupTimer = null
    this.cleanupPromise = null
  }

  async create(input = {}, metadata = {}) {
    const trackingToken = randomToken(40)
    const timestamp = now()
    const profile = updateProfile({}, input, this.config.dataHashSecret)
    assertAlumniProfile(profile)
    const trackingExpiresAt = new Date(Date.now() + MANUAL_TRACKING_TTL_MS).toISOString()
    const application = {
      id: randomUUID(),
      applicationNo: generatedApplicationNo(),
      trackingTokenHash: sha256(trackingToken),
      trackingExpiresAt,
      status: 'draft',
      revision: 1,
      profile,
      materials: [],
      history: [],
      reviewNote: '',
      claimedBy: null,
      claimedAt: null,
      submittedAt: null,
      reviewedAt: null,
      cancelledAt: null,
      approvedIdentity: null,
      exchangeCount: 0,
      lastExchangeAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    application.history.unshift(history('created', application.status, metadata))
    const result = await this.database.transaction((data) => {
      ensureApplications(data).push(application)
      data.auditLogs ||= []
      data.auditLogs.unshift(audit('manual_verification.created', application.id, metadata, { applicationNo: application.applicationNo }))
      return applicationView(application, data)
    })
    return { application: result, trackingToken, trackingExpiresAt, expiresAt: trackingExpiresAt }
  }

  get(id, trackingToken) {
    return this.database.read((data) => applicationView(authorizedApplication(data, id, trackingToken), data))
  }

  async update(id, trackingToken, input = {}, metadata = {}) {
    return this.database.transaction((data) => {
      const application = authorizedApplication(data, id, trackingToken)
      if (!editableStatuses.has(application.status)) {
        throw reviewError('当前状态不能修改申请资料', 'MANUAL_VERIFICATION_NOT_EDITABLE', 409)
      }
      revisionCheck(application, input)
      application.profile = updateProfile(application.profile, input, this.config.dataHashSecret)
      assertAlumniProfile(application.profile)
      application.revision += 1
      application.updatedAt = now()
      application.history.unshift(history('updated', application.status, metadata))
      data.auditLogs ||= []
      data.auditLogs.unshift(audit('manual_verification.updated', application.id, metadata, { revision: application.revision }))
      return applicationView(application, data)
    })
  }

  assertCanUpload(id, trackingToken) {
    return this.database.read((data) => {
      const application = authorizedApplication(data, id, trackingToken)
      if (!editableStatuses.has(application.status)) {
        throw reviewError('当前状态不能上传证明材料', 'MANUAL_VERIFICATION_NOT_EDITABLE', 409)
      }
      if (application.materials.length >= maximumMaterials) {
        throw reviewError(`每份申请最多上传 ${maximumMaterials} 张图片`, 'MANUAL_VERIFICATION_MATERIAL_LIMIT', 409)
      }
      return { id: application.id }
    })
  }

  async attachMaterial(id, trackingToken, upload, input = {}, metadata = {}) {
    return this.database.transaction((data) => {
      const application = authorizedApplication(data, id, trackingToken)
      if (!editableStatuses.has(application.status)) {
        throw reviewError('当前状态不能上传证明材料', 'MANUAL_VERIFICATION_NOT_EDITABLE', 409)
      }
      if (application.materials.length >= maximumMaterials) {
        throw reviewError(`每份申请最多上传 ${maximumMaterials} 张图片`, 'MANUAL_VERIFICATION_MATERIAL_LIMIT', 409)
      }
      const material = {
        id: randomUUID(),
        filename: upload.filename,
        materialType: cleanText(input.materialType || 'other_evidence', '材料类型', 50),
        label: cleanText(input.label || input.filename || input.name || '证明材料', '材料标签', 160) || '证明材料',
        name: cleanText(input.filename || input.name || input.label || '证明材料', '材料名称', 160) || '证明材料',
        mimeType: upload.mimeType,
        size: upload.size,
        uploadedAt: now()
      }
      if (!materialTypes.includes(material.materialType)) {
        throw reviewError('材料类型无效', 'MANUAL_VERIFICATION_MATERIAL_TYPE_INVALID')
      }
      application.materials.push(material)
      application.revision += 1
      application.updatedAt = now()
      application.history.unshift(history('material_uploaded', application.status, metadata))
      data.auditLogs ||= []
      data.auditLogs.unshift(audit('manual_verification.material_uploaded', application.id, metadata, {
        materialId: material.id,
        materialType: material.materialType,
        mimeType: material.mimeType,
        size: material.size
      }))
      return { application: applicationView(application, data), material: materialView(application, material) }
    })
  }

  async removeMaterial(id, trackingToken, materialId, metadata = {}) {
    return this.database.transaction((data) => {
      const application = authorizedApplication(data, id, trackingToken)
      if (!editableStatuses.has(application.status)) {
        throw reviewError('当前状态不能删除证明材料', 'MANUAL_VERIFICATION_NOT_EDITABLE', 409)
      }
      const index = application.materials.findIndex((item) => item.id === materialId)
      if (index < 0) throw reviewError('证明材料不存在', 'MANUAL_VERIFICATION_MATERIAL_NOT_FOUND', 404)
      const [removed] = application.materials.splice(index, 1)
      application.revision += 1
      application.updatedAt = now()
      application.history.unshift(history('material_removed', application.status, metadata))
      data.auditLogs ||= []
      data.auditLogs.unshift(audit('manual_verification.material_removed', application.id, metadata, { materialId }))
      return { application: applicationView(application, data), filename: removed.filename }
    })
  }

  materialForApplicant(id, trackingToken, materialId) {
    return this.database.read((data) => {
      const application = authorizedApplication(data, id, trackingToken)
      if (['approved', 'cancelled'].includes(application.status)) {
        throw reviewError('当前申请状态不允许申请人读取原始证明材料', 'MANUAL_VERIFICATION_MATERIAL_ACCESS_CLOSED', 403)
      }
      const material = application.materials.find((item) => item.id === materialId)
      if (!material) throw reviewError('证明材料不存在', 'MANUAL_VERIFICATION_MATERIAL_NOT_FOUND', 404)
      return { filename: material.filename, mimeType: material.mimeType }
    })
  }

  async submit(id, trackingToken, input = {}, metadata = {}) {
    return this.database.transaction((data) => {
      const application = authorizedApplication(data, id, trackingToken)
      if (!editableStatuses.has(application.status)) {
        throw reviewError('当前状态不能提交或重新提交', 'MANUAL_VERIFICATION_SUBMIT_INVALID', 409)
      }
      revisionCheck(application, input)
      validateSubmission(application)
      application.status = 'submitted'
      application.submittedAt = now()
      application.claimedBy = null
      application.claimedAt = null
      application.reviewNote = ''
      application.revision += 1
      application.updatedAt = application.submittedAt
      application.history.unshift(history('submitted', application.status, metadata))
      data.auditLogs ||= []
      data.auditLogs.unshift(audit('manual_verification.submitted', application.id, metadata, { revision: application.revision }))
      return applicationView(application, data)
    })
  }

  async cancel(id, trackingToken, input = {}, metadata = {}) {
    return this.database.transaction((data) => {
      const application = authorizedApplication(data, id, trackingToken)
      if (['approved', 'cancelled'].includes(application.status)) {
        throw reviewError('当前状态不能取消申请', 'MANUAL_VERIFICATION_CANCEL_INVALID', 409)
      }
      revisionCheck(application, input)
      application.status = 'cancelled'
      application.cancelledAt = now()
      const filenames = application.materials.map((material) => material.filename).filter(Boolean)
      application.materials = []
      application.revision += 1
      application.updatedAt = application.cancelledAt
      application.history.unshift(history('cancelled', application.status, metadata))
      data.auditLogs ||= []
      data.auditLogs.unshift(audit('manual_verification.cancelled', application.id, metadata, { removedMaterialCount: filenames.length }))
      return { application: applicationView(application, data), filenames }
    })
  }

  listAdmin({ query = '', status = '', page = 1, pageSize = 20 } = {}) {
    return this.database.read((data) => {
      const needle = String(query || '').trim().toLowerCase()
      const requestedStatus = String(status || '').trim()
      const normalizedStatus = normalizedAdminStatus(status)
      if (requestedStatus && !normalizedStatus) {
        throw reviewError('人工实名申请状态筛选值无效', 'MANUAL_VERIFICATION_STATUS_INVALID')
      }
      const filtered = ensureApplications(data).filter((application) => {
        if (normalizedStatus && application.status !== normalizedStatus) return false
        if (!requestedStatus && ['draft', 'cancelled'].includes(application.status)) return false
        if (!needle) return true
        const profile = application.profile || {}
        return [
          application.applicationNo,
          profile.name,
          profile.formerName,
          profile.college,
          profile.major,
          profile.studentIdMasked,
          profile.idCardMasked,
          profile.phoneMasked
        ].some((value) => String(value || '').toLowerCase().includes(needle))
      }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      const size = Math.min(100, Math.max(1, Number(pageSize) || 20))
      const currentPage = Math.max(1, Number(page) || 1)
      const start = (currentPage - 1) * size
      return {
        items: filtered.slice(start, start + size).map((application) => applicationView(application, data, { admin: true })),
        total: filtered.length,
        page: currentPage,
        pageSize: size
      }
    })
  }

  getAdmin(id) {
    return this.database.read((data) => {
      const application = ensureApplications(data).find((item) => item.id === id)
      if (!application) throw reviewError('人工实名申请不存在', 'MANUAL_VERIFICATION_NOT_FOUND', 404)
      return applicationView(application, data, { admin: true })
    })
  }

  materialForAdmin(id, materialId) {
    return this.database.read((data) => {
      const application = ensureApplications(data).find((item) => item.id === id)
      const material = application?.materials?.find((item) => item.id === materialId)
      if (!application || !material) throw reviewError('证明材料不存在', 'MANUAL_VERIFICATION_MATERIAL_NOT_FOUND', 404)
      return { filename: material.filename, mimeType: material.mimeType }
    })
  }

  async action(id, admin, input = {}, metadata = {}) {
    const action = normalizedAction(input.action)
    return this.database.transaction((data) => {
      const application = ensureApplications(data).find((item) => item.id === id)
      if (!application) throw reviewError('人工实名申请不存在', 'MANUAL_VERIFICATION_NOT_FOUND', 404)
      revisionCheck(application, input)
      const note = reviewNote(input)
      const timestamp = now()

      if (action === 'claim') {
        if (application.status === 'under_review' && application.claimedBy === admin.id) {
          return applicationView(application, data, { admin: true })
        }
        if (application.status !== 'submitted') {
          throw reviewError('只有待复核申请可以认领', 'MANUAL_VERIFICATION_ACTION_INVALID', 409)
        }
        application.status = 'under_review'
        application.claimedBy = admin.id
        application.claimedAt = timestamp
      } else if (action === 'release') {
        this.assertClaimed(application, admin)
        application.status = 'submitted'
        application.claimedBy = null
        application.claimedAt = null
      } else if (action === 'request_more') {
        this.assertClaimed(application, admin)
        if (!note) throw reviewError('要求补充材料时必须填写说明', 'MANUAL_VERIFICATION_REVIEW_NOTE_REQUIRED')
        application.status = 'needs_more'
        application.reviewNote = note
        application.reviewedAt = timestamp
      } else if (action === 'reject') {
        this.assertClaimed(application, admin)
        if (!note) throw reviewError('驳回申请时必须填写原因', 'MANUAL_VERIFICATION_REVIEW_NOTE_REQUIRED')
        application.status = 'rejected'
        application.reviewNote = note
        application.reviewedAt = timestamp
      } else if (action === 'approve') {
        this.assertClaimed(application, admin)
        assertAlumniProfile(application.profile)
        validateSubmission(application)
        application.status = 'approved'
        application.reviewNote = note
        application.reviewedAt = timestamp
        application.approvedIdentity = approvedIdentity(data, application, this.config.dataHashSecret)
      } else {
        throw reviewError('不支持的审核操作', 'MANUAL_VERIFICATION_ACTION_INVALID')
      }

      application.revision += 1
      application.updatedAt = timestamp
      application.history.unshift(history(action, application.status, metadata, note))
      data.auditLogs ||= []
      data.auditLogs.unshift(audit(`manual_verification.${action}`, application.id, metadata, {
        status: application.status,
        revision: application.revision
      }))
      return applicationView(application, data, { admin: true })
    })
  }

  assertClaimed(application, admin) {
    if (application.status !== 'under_review') {
      throw reviewError('请先认领该申请', 'MANUAL_VERIFICATION_NOT_CLAIMED', 409)
    }
    if (application.claimedBy !== admin.id) {
      throw reviewError('该申请已由其他管理员认领', 'MANUAL_VERIFICATION_CLAIMED_BY_OTHER', 409)
    }
  }

  approvedIdentity(id, trackingToken) {
    return this.database.read((data) => {
      const application = authorizedApplication(data, id, trackingToken)
      if (application.status !== 'approved' || !application.approvedIdentity) {
        throw reviewError('人工实名复核尚未通过', 'MANUAL_VERIFICATION_NOT_APPROVED', 409)
      }
      assertAlumniProfile(application.profile)
      assertAlumniProfile(application.approvedIdentity)
      return structuredClone(application.approvedIdentity)
    })
  }

  async recordExchange(id, trackingToken, outcome, metadata = {}) {
    return this.database.transaction((data) => {
      const application = authorizedApplication(data, id, trackingToken)
      if (application.status !== 'approved' || !application.approvedIdentity) {
        throw reviewError('人工实名复核尚未通过', 'MANUAL_VERIFICATION_NOT_APPROVED', 409)
      }
      application.exchangeCount = Number(application.exchangeCount || 0) + 1
      application.lastExchangeAt = now()
      application.updatedAt = application.lastExchangeAt
      data.auditLogs ||= []
      data.auditLogs.unshift(audit('manual_verification.exchanged', application.id, metadata, {
        result: String(outcome || ''),
        exchangeCount: application.exchangeCount
      }))
      return applicationView(application, data)
    })
  }

  cleanupExpired(metadata = {}) {
    if (this.cleanupPromise) return this.cleanupPromise
    this.cleanupPromise = this.performExpiredCleanup(metadata).finally(() => {
      this.cleanupPromise = null
    })
    return this.cleanupPromise
  }

  async performExpiredCleanup(metadata = {}) {
    const cutoff = Date.now()
    const cleanedAt = now()
    // 到期判定、撤销可读材料引用、状态变更和 orphan 入队在一个事务完成。
    // 上传/补材事务会重新校验 token 到期时间，因此不能在清理之后重新挂接材料。
    const staged = await this.database.transaction((data) => {
      let expiredApplications = 0
      let removedMaterials = 0
      let queuedPrivateFiles = 0
      let cancelledApplications = 0
      let preservedDecisions = 0
      const orphans = ensureMediaOrphans(data)
      for (const application of ensureApplications(data)) {
        const expiresAt = Date.parse(application.trackingExpiresAt || '')
        if (!Number.isFinite(expiresAt) || expiresAt > cutoff) continue
        if (application.expiryCleanupAt && !application.materials?.length) continue

        const previousStatus = application.status
        const materials = Array.isArray(application.materials) ? application.materials : []
        for (const material of materials) {
          if (!material.filename || orphans.some((item) => item.filename === material.filename)) continue
          orphans.push({
            id: randomUUID(),
            applicationId: application.id,
            filename: material.filename,
            reason: 'tracking_expired',
            attempts: 0,
            queuedAt: cleanedAt,
            lastAttemptAt: null,
            lastErrorCode: ''
          })
          queuedPrivateFiles += 1
        }
        application.materials = []
        application.expiryCleanupAt = cleanedAt
        application.materialsExpiredAt = cleanedAt
        if (!terminalStatuses.has(previousStatus)) {
          application.status = 'cancelled'
          application.cancelledAt ||= cleanedAt
          application.closureReason = 'tracking_expired'
          cancelledApplications += 1
        } else {
          preservedDecisions += 1
        }
        application.revision = Number(application.revision || 0) + 1
        application.updatedAt = cleanedAt
        application.history ||= []
        application.history.unshift(history(
          'tracking_expired',
          application.status,
          metadata,
          'trackingToken 已过期，私有证明材料已清理'
        ))
        data.auditLogs ||= []
        data.auditLogs.unshift(audit('manual_verification.tracking_expired_cleanup', application.id, metadata, {
          previousStatus,
          resultingStatus: application.status,
          removedMaterialCount: materials.length
        }))
        expiredApplications += 1
        removedMaterials += materials.length
      }
      return {
        cleanedAt,
        expiredApplications,
        removedMaterials,
        queuedPrivateFiles,
        cancelledApplications,
        preservedDecisions
      }
    })

    const deletion = await this.cleanupOrphanedMaterials(metadata)
    return { ...staged, ...deletion }
  }

  async cleanupOrphanedMaterials(metadata = {}) {
    const pending = this.database.read((data) => ensureMediaOrphans(data).map((item) => ({ ...item })))
    if (!pending.length) {
      return { deletedPrivateFiles: 0, failedPrivateFiles: 0, pendingPrivateFiles: 0 }
    }

    const outcomes = []
    for (const orphan of pending) {
      try {
        if (!this.media) throw reviewError('私有材料清理服务不可用', 'MANUAL_VERIFICATION_CLEANUP_UNAVAILABLE', 503)
        await this.media.removePrivate(orphan.filename)
        outcomes.push({ id: orphan.id, success: true })
      } catch (error) {
        outcomes.push({ id: orphan.id, success: false, code: String(error?.code || 'PRIVATE_MEDIA_DELETE_FAILED').slice(0, 80) })
      }
    }

    return this.database.transaction((data) => {
      const orphans = ensureMediaOrphans(data)
      let deletedPrivateFiles = 0
      let failedPrivateFiles = 0
      for (const outcome of outcomes) {
        const index = orphans.findIndex((item) => item.id === outcome.id)
        if (index < 0) continue
        const orphan = orphans[index]
        if (outcome.success) {
          orphans.splice(index, 1)
          deletedPrivateFiles += 1
          continue
        }
        orphan.attempts = Number(orphan.attempts || 0) + 1
        orphan.lastAttemptAt = now()
        orphan.lastErrorCode = outcome.code
        data.auditLogs ||= []
        data.auditLogs.unshift(audit(
          'manual_verification.expired_material_delete_failed',
          orphan.applicationId,
          metadata,
          { orphanId: orphan.id, attempt: orphan.attempts, errorCode: outcome.code }
        ))
        failedPrivateFiles += 1
      }
      return {
        deletedPrivateFiles,
        failedPrivateFiles,
        pendingPrivateFiles: orphans.length
      }
    })
  }

  startCleanupScheduler({
    metadata = { actor: 'system:manual-verification-expiry' },
    intervalMs = MANUAL_CLEANUP_INTERVAL_MS,
    onError = () => {}
  } = {}) {
    this.stopCleanupScheduler()
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired(metadata).catch(onError)
    }, intervalMs)
    this.cleanupTimer.unref?.()
    return this.cleanupTimer
  }

  stopCleanupScheduler() {
    if (!this.cleanupTimer) return
    clearInterval(this.cleanupTimer)
    this.cleanupTimer = null
  }
}
