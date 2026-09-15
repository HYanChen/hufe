import { api, apiBlob } from './api.js'

const STATUS_ALIASES = {
  pending: 'pending_review',
  submitted: 'pending_review',
  pending_review: 'pending_review',
  pending_verification: 'pending_review',
  reviewing: 'reviewing',
  in_review: 'reviewing',
  under_review: 'reviewing',
  processing: 'reviewing',
  approved: 'approved',
  verified: 'approved',
  passed: 'approved',
  rejected: 'rejected',
  denied: 'rejected',
  declined: 'rejected',
  needs_more_info: 'supplement_required',
  needs_more: 'supplement_required',
  more_info_required: 'supplement_required',
  needs_supplement: 'supplement_required',
  supplement_required: 'supplement_required',
  supplement_requested: 'supplement_required',
  cancelled: 'cancelled',
  closed: 'cancelled'
}

export const manualVerificationStatuses = [
  { value: '', label: '全部状态' },
  { value: 'pending_review', label: '待复核' },
  { value: 'reviewing', label: '复核中' },
  { value: 'supplement_required', label: '待补充' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' }
]

export function normalizeManualVerificationStatus(value) {
  const key = String(value || '').trim().toLowerCase()
  return STATUS_ALIASES[key] || key || 'pending_review'
}

export function manualVerificationStatusLabel(value) {
  return ({
    pending_review: '待复核',
    reviewing: '复核中',
    supplement_required: '待补充',
    approved: '已通过',
    rejected: '已驳回',
    cancelled: '已取消'
  })[normalizeManualVerificationStatus(value)] || value || '未知状态'
}

export function manualVerificationStatusTone(value) {
  return ({
    pending_review: 'warning',
    reviewing: 'info',
    supplement_required: 'warning',
    approved: 'success',
    rejected: 'danger',
    cancelled: 'neutral'
  })[normalizeManualVerificationStatus(value)] || 'neutral'
}

function compact(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function firstValue(...values) {
  return values.find((value) => compact(value)) ?? ''
}

function maskValue(value, { prefix = 2, suffix = 4, minimum = 4 } = {}) {
  const text = compact(value)
  if (!text) return ''
  if (text.includes('*') || text.includes('•')) return text
  if (text.length <= minimum) return `${'*'.repeat(Math.max(4, text.length))}${text.slice(-1)}`
  const visiblePrefix = text.slice(0, Math.min(prefix, Math.max(1, text.length - suffix)))
  const visibleSuffix = text.slice(-Math.min(suffix, Math.max(1, text.length - prefix)))
  return `${visiblePrefix}${'*'.repeat(Math.max(4, text.length - visiblePrefix.length - visibleSuffix.length))}${visibleSuffix}`
}

export function maskStudentNumber(value) {
  return maskValue(value, { prefix: 2, suffix: 3, minimum: 5 })
}

export function maskIdentityNumber(value) {
  return maskValue(value, { prefix: 4, suffix: 4, minimum: 8 })
}

export function maskPhoneNumber(value) {
  return maskValue(value, { prefix: 3, suffix: 4, minimum: 7 })
}

export function maskEmailAddress(value) {
  const text = compact(value)
  const separator = text.lastIndexOf('@')
  if (separator <= 0) return text ? maskValue(text, { prefix: 1, suffix: 1, minimum: 3 }) : ''
  const local = text.slice(0, separator)
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(3, local.length - 1))}${text.slice(separator)}`
}

function normalizeMaterial(item, index) {
  if (typeof item === 'string') {
    return {
      id: `material-${index}`,
      name: `证明材料 ${index + 1}`,
      label: `证明材料 ${index + 1}`,
      materialType: '',
      mimeType: '',
      size: '',
      uploadedAt: '',
      url: item
    }
  }
  const source = item || {}
  return {
    id: firstValue(source.id, source.materialId, source.fileId, `material-${index}`),
    name: firstValue(source.name, source.fileName, source.filename, source.title, `证明材料 ${index + 1}`),
    label: firstValue(source.label, source.materialLabel, source.categoryName, source.title),
    materialType: firstValue(source.materialType, source.category, source.documentType),
    mimeType: firstValue(source.mimeType, source.contentType, source.type),
    size: source.size ?? source.fileSize ?? '',
    uploadedAt: firstValue(source.uploadedAt, source.createdAt, source.created_at),
    url: firstValue(source.previewUrl, source.downloadUrl, source.url, source.fileUrl, source.href)
  }
}

function normalizeHistory(item, index) {
  const source = item || {}
  return {
    id: firstValue(source.id, source.auditId, `history-${index}`),
    action: firstValue(source.action, source.event, source.type, source.status),
    status: normalizeManualVerificationStatus(firstValue(source.toStatus, source.status)),
    note: firstValue(source.reviewNote, source.note, source.reason, source.comment),
    operator: firstValue(source.operatorName, source.reviewerName, source.operator?.name, source.actor?.name, source.operator, source.actor),
    createdAt: firstValue(source.createdAt, source.operatedAt, source.reviewedAt, source.timestamp)
  }
}

function unwrapRecord(record) {
  if (!record || typeof record !== 'object') return {}
  const nested = record.application || record.verification || record.record
  return nested && typeof nested === 'object' ? { ...nested, ...record } : record
}

export function normalizeManualVerification(record) {
  const source = unwrapRecord(record)
  const applicant = source.applicant || source.user || source.identity || {}
  const school = source.schoolIdentity || source.schoolProfile || source.profile || {}
  const materials = source.materials || source.attachments || source.documents || source.evidence || []
  const history = source.history || source.auditTrail || source.reviewHistory || source.logs || []
  const rawStudentNumber = firstValue(
    source.studentNumber, source.studentId, source.schoolNumber, source.employeeNumber,
    applicant.studentNumber, applicant.studentId, school.studentNumber, school.studentId
  )
  const rawIdentityNumber = firstValue(
    source.identityNumber, source.idCardNumber, source.idCard,
    applicant.identityNumber, applicant.idCardNumber, school.identityNumber
  )
  const rawPhone = firstValue(source.phone, source.mobile, applicant.phone, applicant.mobile, school.phone)

  return {
    id: firstValue(source.id, source.verificationId, source.applicationId),
    applicationNo: firstValue(source.applicationNo, source.requestNo, source.serialNumber, source.code),
    applicantName: firstValue(source.applicantName, source.realName, source.name, applicant.realName, applicant.name, school.realName, school.name, '未命名申请人'),
    formerName: firstValue(source.formerName, source.previousName, applicant.formerName, school.formerName),
    personType: firstValue(source.personType, source.identityType, source.memberType, applicant.personType, school.personType),
    college: firstValue(source.college, source.department, source.schoolDepartment, applicant.college, applicant.department, school.college, school.department),
    major: firstValue(source.major, applicant.major, school.major),
    className: firstValue(source.className, source.class, applicant.className, school.className),
    enrollmentYear: firstValue(source.enrollmentYear, source.admissionYear, applicant.enrollmentYear, school.enrollmentYear),
    graduationYear: firstValue(source.graduationYear, applicant.graduationYear, school.graduationYear),
    studentNumberMasked: firstValue(
      source.studentNumberMasked, source.studentIdMasked, source.schoolNumberMasked,
      applicant.studentNumberMasked, applicant.studentIdMasked, school.studentNumberMasked,
      maskStudentNumber(rawStudentNumber)
    ),
    identityNumberMasked: firstValue(
      source.identityNumberMasked, source.idCardMasked, source.idCardNumberMasked,
      applicant.identityNumberMasked, applicant.idCardMasked, school.identityNumberMasked,
      maskIdentityNumber(rawIdentityNumber)
    ),
    phoneMasked: firstValue(source.phoneMasked, source.mobileMasked, applicant.phoneMasked, maskPhoneNumber(rawPhone)),
    emailMasked: firstValue(source.emailMasked, applicant.emailMasked, maskEmailAddress(firstValue(source.email, applicant.email))),
    statement: firstValue(source.statement, source.reason, source.applicationReason, source.description, source.remark),
    status: normalizeManualVerificationStatus(source.status),
    rawStatus: compact(source.status),
    source: firstValue(source.source, source.channel, source.applicationSource),
    reviewerName: firstValue(source.reviewerName, source.reviewer?.name, source.assigneeName, source.assignee?.name),
    reviewNote: firstValue(source.reviewNote, source.reviewerNote, source.decisionReason),
    createdAt: firstValue(source.createdAt, source.submittedAt, source.created_at),
    submittedAt: firstValue(source.submittedAt, source.createdAt, source.submitted_at),
    claimedAt: firstValue(source.claimedAt, source.reviewStartedAt),
    updatedAt: firstValue(source.updatedAt, source.updated_at),
    reviewedAt: firstValue(source.reviewedAt, source.decidedAt),
    cancelledAt: firstValue(source.cancelledAt, source.closedAt),
    trackingExpiresAt: firstValue(source.trackingExpiresAt, source.expiresAt),
    closureReason: firstValue(source.closureReason, source.closeReason),
    version: source.version ?? source.revision ?? source.lockVersion ?? null,
    materials: (Array.isArray(materials) ? materials : []).map(normalizeMaterial),
    history: (Array.isArray(history) ? history : []).map(normalizeHistory)
  }
}

function arrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload
  return payload?.items || payload?.records || payload?.applications || payload?.verifications || payload?.data || []
}

export async function listManualVerifications({ page = 1, pageSize = 15, query = '', status = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (query.trim()) params.set('query', query.trim())
  if (status) params.set('status', status)
  const payload = await api(`/admin/manual-verifications?${params}`)
  const items = arrayFromPayload(payload)
  return {
    items: (Array.isArray(items) ? items : []).map(normalizeManualVerification),
    total: Number(payload?.total ?? payload?.pagination?.total ?? payload?.meta?.total ?? items.length) || 0,
    page: Number(payload?.page ?? payload?.pagination?.page ?? page) || page,
    pageSize: Number(payload?.pageSize ?? payload?.pagination?.pageSize ?? pageSize) || pageSize
  }
}

export async function getManualVerification(id) {
  const payload = await api(`/admin/manual-verifications/${encodeURIComponent(id)}`)
  return normalizeManualVerification(payload?.application || payload?.verification || payload)
}

export async function performManualVerificationAction(id, { action, reviewNote = '', expectedRevision = null }) {
  const body = { action, reviewNote: reviewNote.trim() }
  if (expectedRevision !== null && expectedRevision !== undefined && expectedRevision !== '') body.expectedRevision = expectedRevision
  const payload = await api(`/admin/manual-verifications/${encodeURIComponent(id)}/actions`, { method: 'POST', body })
  return normalizeManualVerification(payload?.application || payload?.verification || payload)
}

export function fetchManualVerificationMaterial(material, { signal } = {}) {
  const url = compact(material?.url)
  if (!url) throw new Error('证明材料缺少受保护读取地址')
  return apiBlob(url, { signal })
}

export function materialIsImage(material) {
  if (String(material?.mimeType || '').toLowerCase().startsWith('image/')) return true
  return /\.(png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i.test(material?.url || '')
}

export function formatMaterialSize(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return value ? String(value) : '大小未返回'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(bytes < 1024 ** 2 * 10 ? 1 : 0)} MB`
}
