import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { JsonDatabase } from '../src/storage/json-database.js'
import { DossierService } from '../src/accounts/dossier.js'
import { registerDossierRoutes } from '../src/accounts/dossier-routes.js'
import { hmac } from '../src/auth/crypto.js'
import { sealStudentNumber } from '../src/accounts/student-number.js'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-dossier-'))
  const database = await new JsonDatabase(path.join(root, 'data.json')).init()
  t.after(async () => { await database.close?.(); await fs.rm(root, { recursive: true, force: true }) })
  const secret = 'dossier-unit-secret', number = '20220000123'
  const admin = { id: 'admin', name: '全局管理员', status: 'active', isAdmin: true, credentialRevision: 0 }
  const member = { id: 'member', name: '同名校友', username: 'member', status: 'active', personType: 'alumni', department: '学院', major: '专业', className: '一班', enrollmentYear: '2022', schoolIdentityVerified: true, passwordHash: 'secret-password-hash', studentIdKey: hmac(`student-id:${number}`, secret), studentIdSealed: sealStudentNumber(number, secret), studentIdMasked: '*******0123', schoolSubjectKey: 'secret-school-key', personalProfile: { phone: '13800000000', email: 'member@example.test' }, alumniNo: 'HUFE0001' }
  await database.transaction(state => {
    state.accounts.push(admin, member, { ...member, id: 'other', username: 'other', studentIdKey: 'different-number', studentIdSealed: '' }, { id: 'delegate', name: '委派管理员', status: 'active', isAdmin: true, adminRole: 'delegated_admin' }, { id: 'pending-admin', status: 'active', isAdmin: true, mustChangePassword: true })
    state.business = { resources: {
      organizations: [{ id: 'org', name: '校友组织' }],
      activities: [{ id: 'event', title: '校友交流活动', startAt: '2026-01-01', location: '学校' }],
      'giving-projects': [{ id: 'giving', title: '回馈母校' }],
      'collaboration-opportunities': [{ id: 'own-resource', authorAccountId: 'member', title: '本人合作需求', category: '需求', status: 'published' }, { id: 'not-own-resource', authorAccountId: 'other', authorName: '同名校友', title: '其他人供需' }],
      'alumni-enterprises': [{ id: 'own-company', name: '本人企业', ownerAccountId: 'member', verificationStatus: 'verified', unifiedSocialCreditCodeEncrypted: 'secret-company-code' }, { id: 'applying-company', name: '申请中的企业', certificationApplicantAccountId: 'member', verificationStatus: 'pending' }, { id: 'not-own-company', name: '同名校友企业', ownerAccountId: 'other' }]
    }, submissions: [
      { id: 'registration', accountId: 'member', type: 'event-registration', resourceType: 'activities', resourceId: 'event', status: 'approved', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'member-org', accountId: 'member', type: 'organization-membership', resourceId: 'org', status: 'approved' },
      { id: 'pending-org', accountId: 'member', type: 'organization-membership', resourceId: 'org', status: 'submitted' },
      { id: 'giving-intent', accountId: 'member', type: 'giving-intent', resourceId: 'giving', status: 'submitted', payload: { amount: 99999 } },
      { id: 'giving-confirmed', accountId: 'member', type: 'giving-intent', resourceId: 'giving', status: 'completed', certificate: { certificateNo: 'CERT1', confirmedAmount: 128.56, officialReceiptNo: 'secret-receipt', templateSnapshot: { private: 'secret-template' } } },
      { id: 'other-record', accountId: 'other', type: 'event-registration', resourceType: 'activities', resourceId: 'event', status: 'approved' }
    ] }
  })
  const accounts = { database, config: { dataHashSecret: secret } }
  return { database, accounts, service: new DossierService(accounts), admin, member, number }
}

test('人员档案按账号绑定真实业务，不同名拼接，不把意向算到账或报名当出席', async t => {
  const { service, admin } = await fixture(t)
  const result = service.get(admin, 'member')
  assert.equal(result.tabs.resources.total, 1)
  assert.equal(result.tabs.enterprises.total, 2)
  assert.equal(result.tabs.activities.total, 1)
  assert.equal(result.tabs.giving.total, 2)
  assert.equal(result.tabs.analysis.mode, 'facts')
  assert.equal(result.tabs.analysis.metrics.confirmedGivingAmount, 128.56)
  assert.equal(result.tabs.analysis.metrics.confirmedGivingCount, 1)
  assert.equal(result.tabs.analysis.metrics.organizationCount, 1)
  assert.match(result.tabs.activities.items[0].source, /不等同于签到/)
  assert.equal(result.tabs.relations.items.find(row => row.targetId === 'other').relationship, '同班校友')
  const encoded = JSON.stringify(result)
  for (const secret of ['secret-password-hash', 'secret-school-key', 'secret-company-code', 'secret-receipt', 'secret-template', 'studentIdSealed', 'studentIdKey', 'passwordHash']) assert.equal(encoded.includes(secret), false, secret)
  assert.equal(result.tabs.followups.total, 0)
  assert.deepEqual(result.supplement.profile.education, [])
})

test('档案只能全局管理员访问，委派、待改密、撤权与旧凭据都被拒绝', async t => {
  const { service, database, admin } = await fixture(t)
  for (const id of ['member', 'delegate', 'pending-admin', 'missing']) assert.throws(() => service.get({ id }, 'member'), { statusCode: 403 })
  await database.transaction(state => { state.accounts.find(row => row.id === 'admin').credentialRevision = 2 })
  assert.throws(() => service.get(admin, 'member'), { code: 'CREDENTIALS_CHANGED' })
  await assert.rejects(service.updateProfile(admin, 'member', { revision: 0, profile: { notes: '不能写入' } }), { code: 'CREDENTIALS_CHANGED' })
  assert.equal(database.read(state => state.accountDossiers?.length || 0), 0)
})

test('关闭业务模块后档案原业务与统计隐藏，内部CRM及核验学籍关系保留且恢复不丢数据', async t => {
  const { service, database, admin } = await fixture(t)
  await database.transaction(state => {
    state.business.submissions.push(
      { id: 'volunteer-own', accountId: 'member', type: 'volunteer-application', resourceType: 'volunteers', status: 'approved' },
      { id: 'visit-own', accountId: 'member', type: 'campus-visit', status: 'approved', payload: { visitDate: '2026-09-20' } }
    )
  })
  let revision = 0
  for (const section of ['resources', 'enterprises', 'activities', 'giving', 'relations']) {
    const fields = { title: `内部${section}记录`, ...(section === 'giving' ? { amount: 99999 } : {}), ...(section === 'relations' ? { relationship: '学校联络人' } : {}) }
    await service.saveRecord(admin, 'member', section, null, { revision: revision++, ...fields })
  }
  await service.addFollowup(admin, 'member', { revision, method: 'phone', content: '模块维护期间仍保留内部跟进' })
  const original = database.read(state => ({ accounts: state.accounts, business: state.business, records: state.accountDossierRecords, dossiers: state.accountDossiers }))
  const before = service.get(admin, 'member')
  assert.equal(before.tabs.analysis.metrics.activityRegistrationCount, 3)
  assert.equal(before.tabs.analysis.metrics.confirmedGivingAmount, 128.56)
  await database.transaction(state => {
    state.moduleSettings = { flags: { collaboration: false, enterprises: false, activities: false, volunteers: false, 'campus-visits': false, giving: false, organizations: false, directory: false } }
  })
  const closed = service.get(admin, 'member')
  for (const section of ['resources', 'enterprises', 'activities', 'giving']) {
    assert.equal(closed.tabs[section].total, 1, section)
    assert.equal(closed.tabs[section].items[0].internal, true, section)
    assert.deepEqual(service.section(admin, 'member', section).items, closed.tabs[section].items, section)
  }
  for (const metric of ['resourceCount', 'enterpriseCount', 'activityRegistrationCount', 'givingIntentCount', 'confirmedGivingCount', 'confirmedGivingAmount', 'organizationCount']) assert.equal(closed.tabs.analysis.metrics[metric], 0, metric)
  assert.equal(closed.tabs.analysis.metrics.internalRecordCount, 5)
  assert.equal(closed.tabs.analysis.metrics.academicRelationCount, 1)
  assert.equal(closed.tabs.analysis.metrics.followupCount, 1)
  assert.equal(closed.tabs.relations.total, 2)
  assert.equal(closed.tabs.relations.items.find(row => row.targetId === 'other').relationship, '同班校友')
  assert.equal(closed.account.schoolIdentityVerified, true)
  assert.equal(closed.account.alumniNo, 'HUFE0001')
  assert.equal(JSON.stringify(closed).includes('本人合作需求'), false)
  assert.equal(JSON.stringify(closed).includes('本人企业'), false)
  assert.equal(JSON.stringify(closed).includes('CERT1'), false)
  await database.transaction(state => { state.moduleSettings.flags = {} })
  const restored = service.get(admin, 'member')
  assert.deepEqual(restored.tabs.analysis.metrics, before.tabs.analysis.metrics)
  for (const section of ['resources', 'enterprises', 'activities', 'giving', 'relations', 'followups']) assert.deepEqual(restored.tabs[section], before.tabs[section], section)
  assert.deepEqual(database.read(state => ({ accounts: state.accounts, business: state.business, records: state.accountDossierRecords, dossiers: state.accountDossiers })), original)
})

test('档案跨模块关联先过滤再分页，组织关闭隐藏其活动而不连带关闭校级活动和公益', async t => {
  const { service, database, admin } = await fixture(t)
  await database.transaction(state => {
    state.business.resources.activities.push({ id: 'org-event', title: '组织维护中活动', organizationId: 'org' })
    for (let i = 0; i < 105; i++) state.business.submissions.push({ id: `org-event-join-${i}`, accountId: 'member', type: 'event-registration', resourceType: 'activities', resourceId: 'org-event', status: 'approved', createdAt: '2026-09-01' })
    state.moduleSettings = { flags: { organizations: false } }
  })
  const first = service.section(admin, 'member', 'activities', { page: 1, pageSize: 1 })
  const second = service.section(admin, 'member', 'activities', { page: 2, pageSize: 1 })
  assert.equal(first.total, 1); assert.equal(first.items[0].id, 'registration')
  assert.equal(second.total, 1); assert.equal(second.items.length, 0)
  const closed = service.get(admin, 'member')
  assert.equal(closed.tabs.analysis.metrics.activityRegistrationCount, 1)
  assert.equal(closed.tabs.analysis.metrics.organizationCount, 0)
  assert.equal(closed.tabs.analysis.metrics.confirmedGivingAmount, 128.56)
  assert.equal(closed.tabs.enterprises.total, 2)
  await database.transaction(state => { state.moduleSettings.flags.organizations = true })
  const restored = service.section(admin, 'member', 'activities', { page: 3, pageSize: 50 })
  assert.equal(restored.total, 106); assert.equal(restored.items.length, 6)
  assert.equal(service.get(admin, 'member').tabs.analysis.metrics.organizationCount, 1)
})

test('教育工作联系标签真实保存并保留核验学籍、密码和登录状态，拒绝受保护字段和冲突', async t => {
  const { service, database, admin } = await fixture(t)
  const original = database.read(state => state.accounts.find(row => row.id === 'member'))
  const saved = await service.updateProfile(admin, 'member', { revision: 0, profile: { contacts: { phone: '13900000000', email: 'new@example.test', wechat: 'school-test' }, education: [{ school: '湖南财政经济学院', major: '补充专业', startYear: '2022', endYear: '2024', degree: '本科' }], employment: [{ company: '单位', title: '工程师', startDate: '2024-07-01' }], tags: ['志愿者', '志愿者', '联络人'], notes: '管理员核实的补充说明' } })
  assert.equal(saved.revision, 1)
  assert.deepEqual(saved.profile.tags, ['志愿者', '联络人'])
  assert.deepEqual(database.read(state => state.accounts.find(row => row.id === 'member')), original)
  const again = service.get(admin, 'member')
  assert.equal(again.supplement.profile.contacts.phone, '13900000000')
  assert.equal(again.personalProfile.fields.phone, '13800000000')
  assert.equal(again.account.major, '专业')
  assert.equal(again.supplement.profile.education[0].major, '补充专业')
  await assert.rejects(service.updateProfile(admin, 'member', { revision: 0, profile: { notes: '覆盖' } }), { code: 'DOSSIER_REVISION_CONFLICT' })
  for (const field of ['username', 'password', 'schoolIdentityVerified', 'major', 'alumniNo']) await assert.rejects(service.updateProfile(admin, 'member', { revision: 1, profile: { [field]: '不允许' } }), { code: 'DOSSIER_INVALID' })
  const log = database.read(state => state.auditLogs.find(row => row.action === 'account.dossier_updated'))
  assert.equal(log.actor, 'admin')
  assert.equal(JSON.stringify(log).includes('13900000000'), false)
})

test('补充资料校验地区库、时间顺序、邮箱、未知字段与HTML，写入失败原子回滚', async t => {
  const { service, database, admin } = await fixture(t)
  const invalid = [
    { contacts: { email: 'invalid-email' } }, { contacts: { city: '随意填写城市' } },
    { education: [{ school: '大学', startYear: '2025', endYear: '2020' }] },
    { employment: [{ company: '单位', startDate: '2026-02-30' }] }, { tags: ['<script>'] }, { notes: 'x', passwordHash: 'x' }
  ]
  for (const profile of invalid) await assert.rejects(service.updateProfile(admin, 'member', { revision: 0, profile }))
  assert.equal(database.read(state => state.accountDossiers?.length || 0), 0)
  const persist = database.persist.bind(database)
  database.persist = async () => { throw new Error('simulated commit failure') }
  await assert.rejects(service.updateProfile(admin, 'member', { revision: 0, profile: { notes: '不应发布' } }))
  assert.equal(service.get(admin, 'member').supplement.revision, 0)
  database.persist = persist
})

test('新增与完成跟进均持久化、有版本保护、保留原始联系内容与审计', async t => {
  const { service, database, admin } = await fixture(t)
  const added = await service.addFollowup(admin, 'member', { revision: 0, method: 'phone', content: '已电话核实工作信息', occurredAt: '2026-09-10T10:00:00+08:00', nextFollowUpAt: '2026-09-20', status: 'pending' })
  assert.equal(added.revision, 1)
  assert.equal(added.item.occurredAt, '2026-09-10T02:00:00.000Z')
  await assert.rejects(service.updateFollowup(admin, 'member', added.item.id, { revision: 0, status: 'completed' }), { code: 'DOSSIER_REVISION_CONFLICT' })
  const completed = await service.updateFollowup(admin, 'member', added.item.id, { revision: 1, status: 'completed' })
  assert.equal(completed.revision, 2)
  assert.equal(completed.item.content, added.item.content)
  assert.equal(service.section(admin, 'member', 'followups').items[0].creatorName, '全局管理员')
  assert.deepEqual(database.read(state => state.auditLogs.slice(0, 2).map(row => row.action)), ['account.dossier_followup_status_changed', 'account.dossier_followup_added'])
})

test('完整学工号须单独授权且填写原因，返回和审计均不暴露密钥密文', async t => {
  const { service, database, admin, number } = await fixture(t)
  assert.equal(JSON.stringify(service.get(admin, 'member')).includes(number), false)
  await assert.rejects(service.revealStudentNumber({ id: 'member' }, 'member', { reason: '用于身份资料核对' }), { statusCode: 403 })
  await assert.rejects(service.revealStudentNumber(admin, 'member', { reason: '查看' }), { code: 'DOSSIER_INVALID' })
  const result = await service.revealStudentNumber(admin, 'member', { reason: '用于校友档案身份核对' })
  assert.deepEqual(result, { accountId: 'member', studentId: number })
  const log = database.read(state => state.auditLogs[0])
  assert.equal(log.action, 'account.dossier_student_number_viewed')
  assert.equal(JSON.stringify(log).includes(number), false)
  assert.equal(JSON.stringify(log).includes('studentIdSealed'), false)
})

test('档案路由鉴权与禁缓存、分页、JSON错误状态正常，补充写入不覆盖学校数据', async t => {
  const { accounts, database, admin } = await fixture(t)
  const app = Fastify({ logger: false })
  t.after(() => app.close())
  app.setErrorHandler((error, request, reply) => reply.code(error.statusCode || 500).send({ code: error.code, message: error.message }))
  registerDossierRoutes(app, { accounts, requireSuperAdmin(request) { if (request.headers.authorization !== 'admin') throw Object.assign(new Error('请登录'), { statusCode: 401 }); return admin }, requestMeta: () => ({}), data: value => ({ code: 0, data: value }) })
  const url = '/api/v1/admin/accounts/member/dossier'
  assert.equal((await app.inject(url)).statusCode, 401)
  const headers = { authorization: 'admin' }
  const response = await app.inject({ url, headers })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'private, no-store')
  await database.transaction(state => { for (let i = 0; i < 105; i++) state.business.submissions.push({ id: `registration-${i}`, accountId: 'member', type: 'event-registration', resourceType: 'activities', resourceId: 'event', createdAt: `2026-01-01T00:00:00Z` }) })
  const last = await app.inject({ url: url + '/activities?page=3&pageSize=50', headers })
  assert.equal(last.json().data.total, 106)
  assert.equal(last.json().data.items.length, 6)
  assert.equal((await app.inject({ url: url + '/not-found', headers })).statusCode, 404)
  assert.equal((await app.inject({ method: 'PUT', url: url + '/profile', headers, payload: { revision: 0, profile: { notes: '路由真实保存' } } })).statusCode, 200)
  assert.equal((await app.inject({ url, headers })).json().data.supplement.profile.notes, '路由真实保存')
})

test('内部资源、企业、活动与捐赠备注真实保存，独立来源不伪造业务或到账', async t => {
  const { service, database, admin } = await fixture(t)
  const original = database.read(state => ({ accounts: state.accounts, business: state.business }))
  const entries = {
    resources: { title: '科研合作资源', category: '科研', cooperationModes: ['合作研究', '实习'], priority: 'high', partner: '合作团队', resources: '实验资源', progress: '正在对接', outcomes: '已确认联系人', description: '管理员核实后登记', occurredAt: '2026-09-01', validUntil: '2027-09-01' },
    enterprises: { title: '内部联络企业', partner: '校友单位', status: 'pending', cooperationModes: ['就业合作'] },
    activities: { title: '座谈联络计划', status: 'active', occurredAt: '2026-10-01' },
    giving: { title: '回馈意向联络备注', amount: 1000000.25, status: 'completed', outcomes: '仅内部登记，不确认收款' }
  }
  let revision = 0
  for (const [section, fields] of Object.entries(entries)) {
    const saved = await service.saveRecord(admin, 'member', section, null, { revision, ...fields })
    assert.equal(saved.revision, ++revision)
    assert.equal(saved.item.internal, true)
    assert.equal(saved.item.source, '学校内部维护')
    assert.equal(service.section(admin, 'member', section).items.some(row => row.id === saved.item.id), true)
  }
  const result = service.get(admin, 'member')
  assert.equal(result.tabs.analysis.metrics.confirmedGivingAmount, 128.56)
  assert.equal(result.tabs.analysis.metrics.confirmedGivingCount, 1)
  assert.equal(result.tabs.analysis.metrics.activityRegistrationCount, 1)
  assert.equal(result.tabs.analysis.metrics.internalRecordCount, 4)
  assert.match(result.tabs.giving.items.find(row => row.internal).amountNote, /不作为到账确认/)
  assert.deepEqual(database.read(state => ({ accounts: state.accounts, business: state.business })), original)
  assert.equal(database.read(state => state.accountDossierRecords.length), 4)
})

test('内部记录可按版本编辑与软归档，持久化保留原件且拒绝修改系统聚合记录', async t => {
  const { service, database, accounts, admin } = await fixture(t)
  const first = await service.saveRecord(admin, 'member', 'resources', null, { revision: 0, title: '合作资源', status: 'pending' })
  await assert.rejects(service.saveRecord(admin, 'member', 'resources', first.item.id, { revision: 0, title: '旧版本覆盖' }), { code: 'DOSSIER_REVISION_CONFLICT' })
  const edited = await service.saveRecord(admin, 'member', 'resources', first.item.id, { revision: 1, status: 'completed', outcomes: '已完成资源对接' })
  assert.equal(edited.item.title, '合作资源')
  assert.equal(edited.item.revision, 2)
  for (const [section, id] of [['resources', 'own-resource'], ['enterprises', 'own-company'], ['giving', 'giving-confirmed']]) {
    await assert.rejects(service.saveRecord(admin, 'member', section, id, { revision: 2, title: '禁止更改正式业务' }), { code: 'DOSSIER_RECORD_NOT_FOUND' })
    await assert.rejects(service.archiveRecord(admin, 'member', section, id, { revision: 2 }), { code: 'DOSSIER_RECORD_NOT_FOUND' })
  }
  const archived = await service.archiveRecord(admin, 'member', 'resources', first.item.id, { revision: 2, reason: '联络事项已结束，保留历史' })
  assert.equal(archived.archived, true)
  assert.equal(archived.revision, 3)
  assert.equal(service.section(admin, 'member', 'resources').items.some(row => row.id === first.item.id), false)
  const persisted = await new JsonDatabase(database.file).init()
  assert.equal(persisted.read(state => state.accountDossierRecords[0].archiveReason), '联络事项已结束，保留历史')
  assert.equal(new DossierService({ ...accounts, database: persisted }).get(admin, 'member').supplement.revision, 3)
  assert.deepEqual(database.read(state => state.auditLogs.slice(0, 3).map(row => row.action)), ['account.dossier_record_archived', 'account.dossier_record_updated', 'account.dossier_record_added'])
  await assert.rejects(service.saveRecord(admin, 'member', 'resources', first.item.id, { revision: 3, title: '归档后不能覆盖' }), { code: 'DOSSIER_RECORD_NOT_FOUND' })
})

test('内部关系必须显式填写，系统人员按真实UUID绑定，不同名猜测或伪造关联', async t => {
  const { service, database, admin } = await fixture(t)
  const targetId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  await database.transaction(state => state.accounts.push({ id: targetId, name: '真实关联人员', status: 'active' }))
  const linked = await service.saveRecord(admin, 'member', 'relations', null, { revision: 0, title: '合作联系人', relationship: '项目合作伙伴', targetAccountId: targetId })
  assert.equal(linked.item.targetName, '真实关联人员')
  assert.equal(linked.item.targetAccountId, targetId)
  for (const input of [
    { title: '关系', targetAccountId: targetId },
    { title: '关系', relationship: '同名', targetAccountId: '真实关联人员' },
    { title: '关系', relationship: '合作伙伴', targetAccountId: 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee' }
  ]) await assert.rejects(service.saveRecord(admin, 'member', 'relations', null, { revision: 1, ...input }))
  const external = await service.saveRecord(admin, 'member', 'relations', null, { revision: 1, title: '校外单位联系人', relationship: '单位联络人', targetAccountId: '' })
  assert.equal(external.item.targetAccountId, '')
  assert.equal(external.item.targetName, undefined)
  assert.equal(service.get(admin, 'member').tabs.analysis.metrics.academicRelationCount, 1)
})

test('内部字段按板块限制并校验金额、日期、长度、类型和权限，失败无副作用', async t => {
  const { service, database, admin } = await fixture(t)
  const original = database.read()
  const invalid = [
    ['resources', { title: '标题', amount: 1 }], ['giving', { title: '标题', amount: -1 }], ['giving', { title: '标题', amount: 1.234 }], ['giving', { title: '标题', amount: '100' }],
    ['activities', { title: '标题', occurredAt: '2026-02-30' }], ['resources', { title: '标题', occurredAt: '2026-09-01', validUntil: '2026-08-01' }],
    ['resources', { title: '标题', status: 'approved' }], ['resources', { title: '标题', priority: 'urgent' }], ['resources', { title: '标题', cooperationModes: '字符串' }],
    ['resources', { title: '<script>' }], ['resources', { title: '标题', description: 'x'.repeat(3001) }], ['resources', { title: '标题', createdBy: 'forged' }]
  ]
  for (const [section, fields] of invalid) await assert.rejects(service.saveRecord(admin, 'member', section, null, { revision: 0, ...fields }), { code: 'DOSSIER_INVALID' })
  for (const actor of [{ id: 'member' }, { id: 'delegate' }, { id: 'pending-admin' }]) await assert.rejects(service.saveRecord(actor, 'member', 'resources', null, { revision: 0, title: '越权写入' }), { statusCode: 403 })
  await assert.rejects(service.saveRecord(admin, 'member', 'analysis', null, { revision: 0, title: '伪造分析' }), { statusCode: 404 })
  assert.deepEqual(database.read(), original)
})

test('内部记录不能跨人员或板块修改，SQL等持久化失败不发布新记录', async t => {
  const { service, database, admin } = await fixture(t)
  const own = await service.saveRecord(admin, 'member', 'resources', null, { revision: 0, title: '本人资源' })
  await assert.rejects(service.saveRecord(admin, 'other', 'resources', own.item.id, { revision: 0, title: '跨人员修改' }), { code: 'DOSSIER_RECORD_NOT_FOUND' })
  await assert.rejects(service.archiveRecord(admin, 'member', 'enterprises', own.item.id, { revision: 1 }), { code: 'DOSSIER_RECORD_NOT_FOUND' })
  const original = database.read(), persist = database.persist.bind(database)
  database.persist = async () => { throw new Error('commit failed') }
  await assert.rejects(service.saveRecord(admin, 'member', 'activities', null, { revision: 1, title: '不能提交' }))
  assert.deepEqual(database.read(), original)
  database.persist = persist
})

test('跟进主题、关键要点和下一步计划均保存，原状态更新保持这些信息', async t => {
  const { service, admin } = await fixture(t)
  const followup = await service.addFollowup(admin, 'member', { revision: 0, method: 'visit', content: '实际拜访情况', title: '拜访校友', keyPoints: '合作事项已沟通', nextPlan: '安排下一次交流', nextFollowUpAt: '2026-12-01' })
  await service.updateFollowup(admin, 'member', followup.item.id, { revision: 1, status: 'completed' })
  const row = service.section(admin, 'member', 'followups').items[0]
  assert.equal(row.title, '拜访校友')
  assert.equal(row.keyPoints, '合作事项已沟通')
  assert.equal(row.nextPlan, '安排下一次交流')
})

test('内部记录新增、编辑与归档路由可执行，必须鉴权且保持禁缓存', async t => {
  const { accounts, admin } = await fixture(t), app = Fastify({ logger: false })
  t.after(() => app.close())
  app.setErrorHandler((error, request, reply) => reply.code(error.statusCode || 500).send({ code: error.code }))
  registerDossierRoutes(app, { accounts, requireSuperAdmin(request) { if (request.headers.authorization !== 'admin') throw Object.assign(new Error('请登录'), { statusCode: 401 }); return admin }, requestMeta: () => ({}), data: value => ({ code: 0, data: value }) })
  const url = '/api/v1/admin/accounts/member/dossier/records/resources', headers = { authorization: 'admin' }
  assert.equal((await app.inject({ method: 'POST', url, payload: { revision: 0, title: '记录' } })).statusCode, 401)
  const added = await app.inject({ method: 'POST', url, headers, payload: { revision: 0, title: '路由资源' } })
  assert.equal(added.statusCode, 201)
  assert.equal(added.headers['cache-control'], 'private, no-store')
  const record = added.json().data.item
  const updated = await app.inject({ method: 'PUT', url: `${url}/${record.id}`, headers, payload: { revision: 1, progress: '已联系' } })
  assert.equal(updated.statusCode, 200)
  assert.equal(updated.json().data.item.progress, '已联系')
  const archived = await app.inject({ method: 'DELETE', url: `${url}/${record.id}`, headers, payload: { revision: 2, reason: '已结束' } })
  assert.equal(archived.statusCode, 200)
  assert.equal(archived.json().data.archived, true)
})
