import { randomUUID } from 'node:crypto'
import { auditRecord } from '../audit/metadata.js'
import { selfProfile } from './profile.js'
import { selfStudentNumber } from './student-number.js'
import { filterModuleRecords } from '../modules/catalog.js'

const fail = (message, code = 'DOSSIER_INVALID', statusCode = 400) => Object.assign(new Error(message), { code, statusCode })
const own = (object, key) => Object.hasOwn(object || {}, key)
const pick = (record, fields) => Object.fromEntries(fields.filter(key => own(record, key)).map(key => [key, structuredClone(record[key])]))
const safeFields = ['id', 'name', 'username', 'personType', 'department', 'major', 'className', 'enrollmentYear', 'graduationYear', 'expectedGraduationYear', 'alumniNo', 'studentIdMasked', 'status', 'accountSource', 'schoolIdentityVerified', 'schoolIdentityVerifiedAt', 'verificationSource', 'createdAt', 'updatedAt', 'lastLoginAt']
const profileFields = ['contacts', 'education', 'employment', 'tags', 'notes']
const contactLimits = { phone: 32, email: 160, wechat: 100, city: 80, regionCode: 50, address: 240 }
const educationLimits = { school: 160, department: 120, major: 120, degree: 80, startYear: 4, endYear: 4, note: 500 }
const employmentLimits = { company: 160, title: 120, industry: 120, startDate: 10, endDate: 10, note: 500 }
const followupMethods = ['phone', 'wechat', 'email', 'visit', 'event', 'other']
const listSections = ['resources', 'enterprises', 'activities', 'giving', 'followups', 'relations']
const internalSections = ['resources', 'enterprises', 'activities', 'giving', 'relations']
const recordCommon = ['title', 'category', 'status', 'description', 'priority', 'occurredAt', 'validUntil']
const recordFields = {
  resources: [...recordCommon, 'cooperationModes', 'partner', 'resources', 'progress', 'outcomes'],
  enterprises: [...recordCommon, 'cooperationModes', 'partner', 'resources', 'progress', 'outcomes'],
  activities: [...recordCommon, 'partner', 'resources', 'progress', 'outcomes'],
  giving: [...recordCommon, 'partner', 'progress', 'outcomes', 'amount'],
  relations: [...recordCommon, 'targetAccountId', 'relationship']
}
const recordLimits = { title: 160, category: 80, description: 3000, partner: 160, resources: 2000, progress: 1500, outcomes: 2000, relationship: 100 }
const recordStatuses = ['pending', 'active', 'completed', 'paused']
const blankProfile = () => ({ contacts: {}, education: [], employment: [], tags: [], notes: '' })
const timestamp = () => new Date().toISOString()
const sortRecent = rows => rows.sort((a, b) => String(b.createdAt || b.occurredAt || '').localeCompare(String(a.createdAt || a.occurredAt || '')) || String(a.id).localeCompare(String(b.id)))

function object(value, keys, message = '包含不支持的档案字段') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw fail(message)
  return value
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(value) || required && !value.trim()) throw fail('档案文字内容为空、过长或格式不正确')
  return value.trim()
}
function date(value, datetime = false) {
  value = text(value, datetime ? 32 : 10)
  if (!value) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value.slice(0, 10))).toISOString().slice(0, 10) !== value.slice(0, 10)) throw fail('日期格式无效')
  if (!datetime && value.length !== 10) throw fail('日期须为 YYYY-MM-DD')
  return datetime ? new Date(value).toISOString() : value
}
function collection(values, limits, kind) {
  if (!Array.isArray(values) || values.length > 30) throw fail('教育或工作经历最多可填写30条')
  return values.map(input => {
    object(input, Object.keys(limits))
    const row = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, text(value, limits[key])]))
    if (!row[kind === 'education' ? 'school' : 'company']) throw fail(kind === 'education' ? '教育经历须填写学校名称' : '工作经历须填写单位名称')
    if (kind === 'education') {
      for (const key of ['startYear', 'endYear']) if (row[key] && (!/^\d{4}$/.test(row[key]) || Number(row[key]) < 1900 || Number(row[key]) > new Date().getFullYear() + 15)) throw fail('教育经历年份无效')
      if (row.startYear && row.endYear && row.endYear < row.startYear) throw fail('结束年份不能早于开始年份')
    } else {
      for (const key of ['startDate', 'endDate']) if (row[key]) row[key] = date(row[key])
      if (row.startDate && row.endDate && row.endDate < row.startDate) throw fail('离职日期不能早于入职日期')
    }
    return row
  })
}
function normalizeProfile(input, previous, regions) {
  object(input, profileFields)
  const profile = { ...blankProfile(), ...structuredClone(previous) }
  if (own(input, 'contacts')) {
    object(input.contacts, Object.keys(contactLimits))
    const contacts = { ...profile.contacts, ...Object.fromEntries(Object.entries(input.contacts).map(([key, value]) => [key, text(value, contactLimits[key])])) }
    if (contacts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacts.email)) throw fail('联系邮箱格式不正确')
    if (regions) Object.assign(contacts, regions.selection(input.contacts, previous?.contacts || {}))
    else if (own(input.contacts, 'city') || own(input.contacts, 'regionCode')) {
      if (String(contacts.city || '') !== String(previous?.contacts?.city || '') || String(contacts.regionCode || '') !== String(previous?.contacts?.regionCode || '')) throw fail('地区库尚未就绪，暂不能修改所在地区', 'DOSSIER_REGIONS_UNAVAILABLE', 503)
    }
    profile.contacts = contacts
  }
  if (own(input, 'education')) profile.education = collection(input.education, educationLimits, 'education')
  if (own(input, 'employment')) profile.employment = collection(input.employment, employmentLimits, 'employment')
  if (own(input, 'tags')) {
    if (!Array.isArray(input.tags) || input.tags.length > 30) throw fail('最多可设置30个标签')
    profile.tags = [...new Set(input.tags.map(tag => text(tag, 30, true)))]
  }
  if (own(input, 'notes')) profile.notes = text(input.notes, 3000)
  return profile
}
function paginate(items, input = {}) {
  const page = Math.max(1, Math.min(10000, Math.trunc(Number(input.page) || 1)))
  const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(input.pageSize) || 50)))
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
}
function normalizeRecord(section, input, previous = {}) {
  if (!internalSections.includes(section)) throw fail('该板块不支持内部记录维护', 'DOSSIER_SECTION_NOT_FOUND', 404)
  object(input, recordFields[section])
  const row = { ...pick(previous, recordFields[section]), status: previous?.status || 'active', priority: previous?.priority || 'normal' }
  for (const [key, max] of Object.entries(recordLimits)) if (own(input, key)) row[key] = text(input[key], max, key === 'title' || section === 'relations' && key === 'relationship')
  if (!row.title) throw fail('请填写记录名称')
  if (section === 'relations' && !row.relationship) throw fail('请填写关系类型，不会自动推测人际关系')
  for (const key of ['occurredAt', 'validUntil']) if (own(input, key)) row[key] = date(input[key])
  if (row.occurredAt && row.validUntil && row.validUntil < row.occurredAt) throw fail('有效截止日期不能早于发生日期')
  if (own(input, 'status')) { if (!recordStatuses.includes(input.status)) throw fail('记录状态无效'); row.status = input.status }
  if (own(input, 'priority')) { if (!['low', 'normal', 'high'].includes(input.priority)) throw fail('记录优先级无效'); row.priority = input.priority }
  if (own(input, 'cooperationModes')) {
    if (!Array.isArray(input.cooperationModes) || input.cooperationModes.length > 12) throw fail('合作方式最多填写12项')
    row.cooperationModes = [...new Set(input.cooperationModes.map(value => text(value, 50, true)))]
  }
  if (own(input, 'amount')) {
    const amount = input.amount
    if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1000000000 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.00001)) throw fail('内部金额须为不超过十亿元的非负数，最多两位小数；不作为实际到账确认')
    row.amount = amount === null ? null : Math.round(amount * 100) / 100
  }
  if (own(input, 'targetAccountId')) {
    const id = text(input.targetAccountId, 36)
    if (id && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw fail('关联人员须选择系统内的有效账号')
    row.targetAccountId = id
  }
  return row
}
function internalRecordView(state, entry) {
  const item = { ...pick(entry, ['id', 'section', ...recordFields[entry.section], 'revision', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'archivedAt']), internal: true, source: '学校内部维护' }
  if (entry.targetAccountId) item.targetName = state.accounts.find(account => account.id === entry.targetAccountId)?.name || '原关联人员'
  if (entry.section === 'giving') item.amountNote = '内部记录金额，不作为到账确认，不签发捐赠证书'
  return item
}
function supplemental(state, id) {
  const row = (state.accountDossiers || []).find(row => row.accountId === id)
  const stored = row?.profile || {}, profile = {
    contacts: pick(stored.contacts || {}, Object.keys(contactLimits)),
    education: (stored.education || []).map(entry => pick(entry, Object.keys(educationLimits))),
    employment: (stored.employment || []).map(entry => pick(entry, Object.keys(employmentLimits))),
    tags: Array.isArray(stored.tags) ? stored.tags.filter(tag => typeof tag === 'string') : [],
    notes: typeof stored.notes === 'string' ? stored.notes : ''
  }
  return { revision: Number(row?.revision || 0), profile, updatedAt: row?.updatedAt || null, updatedBy: row?.updatedBy || '', followups: structuredClone(row?.followups || []) }
}
function target(state, id) {
  const account = state.accounts.find(row => row.id === id)
  if (!account) throw fail('人员账号不存在', 'DOSSIER_ACCOUNT_NOT_FOUND', 404)
  return account
}
function storedDossier(state, id, revision) {
  target(state, id)
  state.accountDossiers ||= []
  let row = state.accountDossiers.find(row => row.accountId === id)
  if (!Number.isSafeInteger(revision) || revision !== Number(row?.revision || 0)) throw fail('人员档案已被更新，请刷新后再保存', 'DOSSIER_REVISION_CONFLICT', 409)
  if (!row) { row = { id: randomUUID(), accountId: id, revision: 0, profile: blankProfile(), followups: [], createdAt: timestamp() }; state.accountDossiers.push(row) }
  return row
}

export class DossierService {
  constructor(accounts, { regions } = {}) { this.accounts = accounts; this.database = accounts.database; this.secret = accounts.config.dataHashSecret; this.regions = regions }
  guard(state, actor) {
    const current = state.accounts.find(row => row.id === actor?.id && row.status === 'active')
    if (current?.isAdmin !== true || current.mustChangePassword || [current.role, current.adminRole].some(role => role && !['admin', 'super_admin'].includes(role))) throw fail('仅有效全局管理员可以查看或维护人员档案', 'ADMIN_PERMISSION_DENIED', 403)
    if (Number(current.credentialRevision || 0) !== Number(actor.credentialRevision || 0)) throw fail('管理员登录状态已变化，请重新登录', 'CREDENTIALS_CHANGED', 401)
  }
  dataset(state, id) {
    const account = target(state, id), extra = supplemental(state, id), business = state.business || {}, resources = business.resources || {}
    // Dossiers are core account data, but their business-derived sections obey
    // module visibility before pagination and metrics. Internal CRM records and
    // verified academic relationships remain independent below.
    const submissions = filterModuleRecords(state, 'submissions', business.submissions).filter(row => row.accountId === id)
    const opportunities = sortRecent(filterModuleRecords(state, 'collaboration-opportunities', resources['collaboration-opportunities']).filter(row => row.authorAccountId === id).map(row => ({ ...pick(row, ['id', 'title', 'category', 'city', 'organization', 'cooperationMode', 'targetAudience', 'budget', 'summary', 'tags', 'status', 'createdAt', 'updatedAt']), source: '本人发布的合作供需' })))
    const enterprises = sortRecent(filterModuleRecords(state, 'alumni-enterprises', resources['alumni-enterprises']).filter(row => row.ownerAccountId === id || row.certificationApplicantAccountId === id).map(row => ({ ...pick(row, ['id', 'name', 'industry', 'city', 'scale', 'summary', 'status', 'verificationStatus', 'createdAt', 'updatedAt', 'enterpriseVerifiedAt']), relation: row.ownerAccountId === id ? '已绑定企业负责人' : '企业认证申请人', source: '企业认证与归属记录' })))
    const activities = sortRecent(submissions.filter(row => ['event-registration', 'volunteer-application', 'campus-visit'].includes(row.type)).map(row => {
      const event = (resources[row.resourceType] || []).find(event => event.id === row.resourceId)
      return { ...pick(row, ['id', 'type', 'resourceId', 'resourceType', 'status', 'createdAt', 'updatedAt']), title: event?.title || row.payload?.serviceTitle || ({ 'campus-visit': '返校预约', 'event-registration': '活动报名', 'volunteer-application': '志愿服务申请' })[row.type], startAt: event?.startAt || row.payload?.visitDate || row.payload?.date || '', location: event?.location || '', source: '本人提交记录（不等同于签到出席）' }
    }))
    const giving = sortRecent(submissions.filter(row => row.type === 'giving-intent').map(row => {
      const project = (resources['giving-projects'] || []).find(project => project.id === row.resourceId)
      return { ...pick(row, ['id', 'resourceId', 'status', 'createdAt', 'updatedAt']), projectTitle: project?.title || row.certificate?.projectTitle || row.payload?.projectTitle || '原公益项目', intentAmount: row.payload?.amount ?? null, certificate: row.certificate ? pick(row.certificate, ['certificateNo', 'confirmedAmount', 'donatedAt', 'issuedAt', 'title', 'issuer']) : null, source: row.certificate?.certificateNo ? '学校确认捐赠并签发证书' : '参与意向，尚无已确认到账证书' }
    }))
    const memberships = submissions.filter(row => row.type === 'organization-membership' && ['approved', 'active', 'joined'].includes(row.status))
    const relations = memberships.map(row => {
      const organization = (resources.organizations || []).find(item => item.id === row.resourceId)
      return { id: row.id, type: 'organization', targetId: row.resourceId, name: organization?.name || '原校友组织', relationship: '组织成员', status: row.status, source: '已生效的组织成员记录', createdAt: row.createdAt }
    })
    if (account.schoolIdentityVerified === true) for (const other of state.accounts) {
      if (other.id === id || other.status !== 'active' || other.schoolIdentityVerified !== true) continue
      const sameCollege = account.department && account.department === other.department
      const sameMajor = sameCollege && account.major && account.major === other.major
      const sameClass = sameMajor && account.className && account.enrollmentYear && account.className === other.className && account.enrollmentYear === other.enrollmentYear
      if (sameClass || sameMajor || sameCollege) relations.push({ id: other.id, type: 'account', targetId: other.id, name: other.name || other.username || '湖财人', relationship: sameClass ? '同班校友' : sameMajor ? '同专业校友' : '同学院校友', department: other.department || '', source: '双方已核验学籍字段一致' })
    }
    const followups = sortRecent(extra.followups.map(row => ({ ...pick(row, ['id', 'method', 'content', 'title', 'keyPoints', 'nextPlan', 'occurredAt', 'nextFollowUpAt', 'status', 'createdAt', 'updatedAt', 'createdBy', 'revision']), creatorName: state.accounts.find(account => account.id === row.createdBy)?.name || '原管理员' })))
    const automaticTags = [...new Set([account.schoolIdentityVerified ? '已实名' : '待实名', ({student:'在校学生',alumni:'校友',faculty:'教师',staff:'教职工'})[account.personType], account.department, account.major, account.enrollmentYear ? `${account.enrollmentYear}级` : ''].filter(Boolean))]
    const confirmed = giving.filter(row => row.certificate?.certificateNo && Number.isFinite(row.certificate.confirmedAmount) && row.certificate.confirmedAmount > 0)
    const confirmedAmountCents = confirmed.reduce((sum, row) => sum + Math.round(row.certificate.confirmedAmount * 100), 0)
    const metrics = { resourceCount: opportunities.length, enterpriseCount: enterprises.length, activityRegistrationCount: activities.length, givingIntentCount: giving.length, confirmedGivingCount: confirmed.length, confirmedGivingAmount: confirmedAmountCents / 100, followupCount: followups.length, organizationCount: memberships.length, academicRelationCount: relations.filter(row => row.type === 'account').length }
    const groups = { resources: opportunities, enterprises, activities, giving, relations }
    for (const entry of state.accountDossierRecords || []) if (entry.accountId === id && internalSections.includes(entry.section) && !entry.archivedAt) groups[entry.section].push(internalRecordView(state, entry))
    for (const section of internalSections) sortRecent(groups[section])
    metrics.internalRecordCount = Object.values(groups).reduce((sum, rows) => sum + rows.filter(row => row.internal).length, 0)
    const analysis = { mode: 'facts', title: '档案事实汇总', generatedAt: timestamp(), metrics, statements: [`已关联 ${memberships.length} 个组织成员记录。`, `已关联 ${metrics.activityRegistrationCount} 条活动、志愿服务或返校申请，不据此推定实际出席。`, `已有 ${confirmed.length} 笔带已签发证书的捐赠确认记录，合计 ${metrics.confirmedGivingAmount.toFixed(2)} 元。`, `另有 ${metrics.internalRecordCount} 条学校内部维护记录，单独标注来源，不作为报名或到账确认。`], limitations: ['系统业务仅汇总已绑定本人账号的记录，不按同名猜测关联。', '此处不是 AI 推测，不推断未记录的人际关系、意向或贡献。', '学校内部维护的合作、活动和金额备注，不会修改前台业务、审批、到账金额或证书。'] }
    const supplement = pick(extra, ['revision', 'profile', 'updatedAt', 'updatedBy'])
    return { account: pick(account, safeFields), personalProfile: selfProfile(account), supplement, tabs: { basic: { source: '学校核验资料与管理员补充档案分开保存' }, tags: { automatic: automaticTags, custom: extra.profile.tags }, resources: opportunities, enterprises, activities, giving, followups, relations, analysis } }
  }
  get(actor, id) {
    return this.database.read(state => {
      this.guard(state, actor)
      const dossier = this.dataset(state, id)
      for (const section of listSections) dossier.tabs[section] = paginate(dossier.tabs[section])
      return dossier
    })
  }
  section(actor, id, section, input = {}) {
    if (!listSections.includes(section)) throw fail('档案板块不存在', 'DOSSIER_SECTION_NOT_FOUND', 404)
    return this.database.read(state => { this.guard(state, actor); return paginate(this.dataset(state, id).tabs[section], input) })
  }
  async updateProfile(actor, id, input, metadata = {}) {
    object(input, ['revision', 'profile'])
    return this.database.transaction(state => {
      this.guard(state, actor)
      const row = storedDossier(state, id, input.revision)
      row.profile = normalizeProfile(input.profile, row.profile, this.regions)
      row.revision++; row.updatedAt = timestamp(); row.updatedBy = actor.id
      state.auditLogs.unshift(auditRecord('account.dossier_updated', id, { ...metadata, actor: actor.id }, { fields: Object.keys(input.profile), revision: row.revision }))
      return supplemental(state, id)
    })
  }
  async addFollowup(actor, id, input, metadata = {}) {
    object(input, ['revision', 'method', 'content', 'occurredAt', 'nextFollowUpAt', 'status', 'title', 'keyPoints', 'nextPlan'])
    if (!followupMethods.includes(input.method) || !['pending', 'completed'].includes(input.status || 'pending')) throw fail('请选择有效的联系渠道与跟进状态')
    const content = text(input.content, 3000, true), occurredAt = date(input.occurredAt || timestamp(), true), nextFollowUpAt = date(input.nextFollowUpAt || '')
    const details = Object.fromEntries([['title', 160], ['keyPoints', 2000], ['nextPlan', 2000]].filter(([key]) => own(input, key)).map(([key, max]) => [key, text(input[key], max)]))
    return this.database.transaction(state => {
      this.guard(state, actor)
      const row = storedDossier(state, id, input.revision)
      if (row.followups.length >= 5000) throw fail('该人员跟进记录已达上限，请联系系统管理员归档', 'DOSSIER_FOLLOWUP_LIMIT', 409)
      const entry = { id: randomUUID(), method: input.method, content, occurredAt, nextFollowUpAt, ...details, status: input.status || 'pending', createdBy: actor.id, createdAt: timestamp(), revision: 1 }
      row.followups.push(entry); row.revision++; row.updatedAt = entry.createdAt; row.updatedBy = actor.id
      state.auditLogs.unshift(auditRecord('account.dossier_followup_added', id, { ...metadata, actor: actor.id }, { followupId: entry.id, method: entry.method, revision: row.revision }))
      return { item: entry, revision: row.revision }
    })
  }
  async saveRecord(actor, id, section, recordId, input, metadata = {}) {
    if (!internalSections.includes(section)) throw fail('该板块不支持内部记录维护', 'DOSSIER_SECTION_NOT_FOUND', 404)
    object(input, ['revision', ...recordFields[section]])
    return this.database.transaction(state => {
      this.guard(state, actor)
      const dossier = storedDossier(state, id, input.revision)
      state.accountDossierRecords ||= []
      const existing = recordId ? state.accountDossierRecords.find(entry => entry.id === recordId && entry.accountId === id && entry.section === section && !entry.archivedAt) : null
      if (recordId && !existing) throw fail('内部维护记录不存在或已归档，不能修改系统业务记录', 'DOSSIER_RECORD_NOT_FOUND', 404)
      if (!existing && state.accountDossierRecords.filter(entry => entry.accountId === id).length >= 5000) throw fail('该人员内部维护记录已达上限，请联系管理员', 'DOSSIER_RECORD_LIMIT', 409)
      const fields = normalizeRecord(section, Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'revision')), existing)
      if (fields.targetAccountId) {
        target(state, fields.targetAccountId)
        if (fields.targetAccountId === id) throw fail('不能将本人设置为自己的关联人员')
      }
      const now = timestamp()
      const entry = existing || { id: randomUUID(), accountId: id, section, createdAt: now, createdBy: actor.id, revision: 0 }
      Object.assign(entry, fields, { updatedAt: now, updatedBy: actor.id, revision: entry.revision + 1 })
      if (!existing) state.accountDossierRecords.push(entry)
      dossier.revision++; dossier.updatedAt = now; dossier.updatedBy = actor.id
      state.auditLogs.unshift(auditRecord(existing ? 'account.dossier_record_updated' : 'account.dossier_record_added', id, { ...metadata, actor: actor.id }, { section, recordId: entry.id, fields: Object.keys(fields), revision: dossier.revision }))
      return { item: internalRecordView(state, entry), revision: dossier.revision }
    })
  }
  async archiveRecord(actor, id, section, recordId, input, metadata = {}) {
    if (!internalSections.includes(section)) throw fail('该板块不支持内部记录维护', 'DOSSIER_SECTION_NOT_FOUND', 404)
    object(input, ['revision', 'reason'])
    const reason = own(input, 'reason') ? text(input.reason, 300) : ''
    return this.database.transaction(state => {
      this.guard(state, actor)
      const dossier = storedDossier(state, id, input.revision)
      const entry = (state.accountDossierRecords || []).find(row => row.id === recordId && row.accountId === id && row.section === section && !row.archivedAt)
      if (!entry) throw fail('内部维护记录不存在或已归档，不能归档系统业务记录', 'DOSSIER_RECORD_NOT_FOUND', 404)
      const now = timestamp()
      Object.assign(entry, { archivedAt: now, archivedBy: actor.id, archiveReason: reason, updatedAt: now, updatedBy: actor.id, revision: entry.revision + 1 })
      dossier.revision++; dossier.updatedAt = now; dossier.updatedBy = actor.id
      state.auditLogs.unshift(auditRecord('account.dossier_record_archived', id, { ...metadata, actor: actor.id }, { section, recordId: entry.id, reason, revision: dossier.revision }))
      return { item: internalRecordView(state, entry), revision: dossier.revision, archived: true }
    })
  }
  async updateFollowup(actor, id, followupId, input, metadata = {}) {
    object(input, ['revision', 'status'])
    if (!['pending', 'completed'].includes(input.status)) throw fail('跟进状态无效')
    return this.database.transaction(state => {
      this.guard(state, actor)
      const row = storedDossier(state, id, input.revision), entry = row.followups.find(item => item.id === followupId)
      if (!entry) throw fail('跟进记录不存在', 'DOSSIER_FOLLOWUP_NOT_FOUND', 404)
      entry.status = input.status; entry.revision++; entry.updatedAt = timestamp()
      row.revision++; row.updatedAt = entry.updatedAt; row.updatedBy = actor.id
      state.auditLogs.unshift(auditRecord('account.dossier_followup_status_changed', id, { ...metadata, actor: actor.id }, { followupId: entry.id, status: entry.status, revision: row.revision }))
      return { item: entry, revision: row.revision }
    })
  }
  async revealStudentNumber(actor, id, input, metadata = {}) {
    object(input, ['reason'])
    const reason = text(input.reason, 300, true)
    if (reason.length < 5) throw fail('请填写至少5个字的学工号查看原因')
    return this.database.transaction(state => {
      this.guard(state, actor)
      const account = target(state, id), studentId = selfStudentNumber(account, this.secret)
      if (!studentId) throw fail('系统尚未保存可校验的完整学工号，请通过原身份核验流程补齐', 'DOSSIER_STUDENT_NUMBER_UNAVAILABLE', 409)
      if (reason.replace(/\s+/g, '').includes(studentId)) throw fail('查看原因请勿包含完整学工号')
      state.auditLogs.unshift(auditRecord('account.dossier_student_number_viewed', id, { ...metadata, actor: actor.id }, { reason }))
      return { accountId: id, studentId }
    })
  }
}
