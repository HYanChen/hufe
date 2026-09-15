import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { academicAffiliations } from '../src/accounts/affiliations.js'
import { BusinessService } from '../src/business/service.js'
import { RegionService } from '../src/regions/service.js'
import { JsonDatabase } from '../src/storage/json-database.js'

const student = (id, extra = {}) => ({ id, name: id, status: 'active', personType: 'alumni', schoolIdentityVerified: true, department: '信息学院', major: '计算机科学与技术', className: '一班', enrollmentYear: '2022', ...extra })
async function setup(t, accounts = [student('alice'), student('bob')], organizations = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-auto-organizations-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const dataFile = path.join(dir, 'data.json'), db = await new JsonDatabase(dataFile).init()
  await db.transaction(data => { data.accounts = accounts; data.business = { resources: { organizations }, submissions: [] } })
  const regions = await new RegionService(db, { dataFile }).init()
  const service = new BusinessService(db, { env: 'test', dataHashSecret: 'test-automatic-groups' })
  service.normalizationOptions.regions = regions
  await service.init()
  return { db, service, dataFile, regions, account: id => db.read(data => data.accounts.find(row => row.id === id)), org: kind => db.read(data => data.business.resources.organizations.find(row => row.automaticAffiliation?.kind === kind)), members: () => db.read(data => data.business.submissions.filter(row => row.type === 'organization-membership' && row.status === 'approved')) }
}

test('学籍归属共享契约仅信已实名锁定字段，跨学院/跨年同班不重复串联', () => {
  const source = student('alice'), rows = academicAffiliations(source)
  assert.deepEqual(new Set(rows.map(row => row.kind)), new Set(['department', 'major', 'class', 'grade']))
  const classKey = account => academicAffiliations(account).find(row => row.kind === 'class')?.key
  assert.notEqual(classKey(source), classKey(student('other', { department: '其他学院' })))
  assert.notEqual(classKey(source), classKey(student('other', { enrollmentYear: '2023' })))
  assert.equal(classKey(source), classKey(student('other', { department: ' 信息学院 ', enrollmentYear: 2022 })))
  assert.equal(classKey(student('other', { enrollmentYear: '', personalProfile: { enrollmentYear: '2022' } })), undefined)
  assert.equal(classKey(student('other', { major: '' })), undefined)
  for (const extra of [{ status: 'disabled' }, { schoolIdentityVerified: false }, { schoolIdentityVerified: 'true' }, { personType: 'faculty' }]) assert.deepEqual(academicAffiliations(student('other', extra)), [])
})

test('组织和成员自动落盘、去重且不授予管理权；城市兴趣行业只采明确字段', async t => {
  const f = await setup(t, [student('alice', { personalProfile: { city: '长沙市', regionCode: 'CN-430102001', interests: ['羽毛球'], industry: '软件' } }), student('bob'), student('carol', { department: '另一学院' }), student('dave', { enrollmentYear: '2023' }), student('unverified', { schoolIdentityVerified: false })])
  assert.equal(f.service.listPublic('organizations').total, 12)
  assert.equal(f.members().length, 19)
  assert.deepEqual(f.db.read(data => data.adminDelegations), [])
  const before = f.db.read(data => data.business.resources.organizations.map(row => row.id))
  await Promise.all([f.service.syncAutomaticOrganizations(), f.service.syncAutomaticOrganizations()])
  assert.deepEqual(f.db.read(data => data.business.resources.organizations.map(row => row.id)), before)
  assert.equal(f.members().length, 19)
  assert.equal(f.org('city').regionCode, 'CN-4301')
  assert.equal(f.org('city').city, '长沙市')
  const classOrg = f.org('class')
  const publicOrg = f.service.getPublic('organizations', classOrg.id, 'alice')
  assert.equal(publicOrg.automatic, true)
  assert.equal(publicOrg.joined, true)
  assert.ok(publicOrg.ownMembershipId)
  assert.equal(publicOrg.automaticAffiliation, undefined)
  assert.equal(f.service.organizationMembers(classOrg.id, 'alice').total, 2)
  assert.ok(f.service.organizationMembers(classOrg.id, 'alice').items.every(row => row.role === 'member'))
  const reloaded = await new JsonDatabase(f.dataFile).init()
  assert.equal(reloaded.read(data => data.business.resources.organizations.length), 12)
})

test('退出及管理员移除持久生效，管理员审核重新申请才恢复；下架不会自动发布', async t => {
  const f = await setup(t), group = f.org('class')
  const membership = f.members().find(row => row.accountId === 'alice' && row.resourceId === group.id)
  await f.service.cancelSubmission('alice', membership.id, { actor: 'alice' })
  await f.service.syncAutomaticOrganizations()
  await f.service.init()
  assert.equal(f.service.getPublic('organizations', group.id, 'alice').joined, false)
  const bob = f.members().find(row => row.accountId === 'bob' && row.resourceId === group.id)
  await assert.rejects(() => f.service.actAdmin('applications', bob.id, { action: 'remove_member', reason: '审核移出' }, { actor: 'fake' }, () => { throw Error('forbidden') }))
  assert.ok(f.members().some(row => row.id === bob.id))
  await f.service.actAdmin('applications', bob.id, { action: 'remove_member', reason: '审核移出', expectedRevision: bob.revision }, { actor: 'admin' })
  await f.service.syncAutomaticOrganizations()
  assert.equal(f.service.getPublic('organizations', group.id, 'bob').joined, false)
  const pending = await f.service.createSubmission(f.account('alice'), { type: 'organization-membership', resourceId: group.id })
  await f.service.syncAutomaticOrganizations()
  assert.equal(f.service.getPublic('organizations', group.id, 'alice').joined, false)
  await f.service.actAdmin('applications', pending.id, { action: 'approve' }, { actor: 'admin' })
  await f.service.syncAutomaticOrganizations()
  assert.equal(f.service.getPublic('organizations', group.id, 'alice').joined, true)
  await f.service.actAdmin('organizations', group.id, { action: 'unpublish' }, { actor: 'admin' })
  await f.service.syncAutomaticOrganizations()
  assert.equal(f.db.read(data => data.business.resources.organizations.find(row => row.id === group.id).status), 'offline')
  assert.equal(f.db.read(data => data.business.resources.organizations.filter(row => row.automaticAffiliation?.key === group.automaticAffiliation.key).length), 1)
})

test('学籍变化立即失去原自动成员受众并撤离旧关联，返回旧学籍可重新加入而非永久排除', async t => {
  const f = await setup(t), group = f.org('class')
  await f.db.transaction(data => data.business.resources.announcements.push({ id: 'class-notice', resource: 'announcements', title: '班内通知', status: 'published', organizationId: group.id, audience: 'all' }))
  assert.equal(f.service.listPublic('announcements', {}, 'alice').total, 1)
  await f.db.transaction(data => { data.accounts.find(row => row.id === 'alice').major = '软件工程' })
  assert.equal(f.service.listPublic('announcements', {}, 'alice').total, 0)
  assert.equal(f.service.organizationMembers(group.id, 'bob').total, 1)
  await f.service.syncAutomaticOrganizations()
  assert.equal(f.service.getPublic('organizations', group.id, 'alice').joined, false)
  assert.ok(f.db.read(data => data.business.submissions.some(row => row.accountId === 'alice' && row.resourceId === group.id && row.automaticEndReason === 'identity_changed')))
  await f.db.transaction(data => { data.accounts.find(row => row.id === 'alice').major = '计算机科学与技术' })
  await f.service.syncAutomaticOrganizations()
  assert.equal(f.service.getPublic('organizations', group.id, 'alice').joined, true)
  await f.db.transaction(data => { data.accounts.find(row => row.id === 'alice').status = 'disabled' })
  await f.service.syncAutomaticOrganizations()
  assert.equal(f.members().filter(row => row.accountId === 'alice').length, 0)
})

test('按完整结构复用既有组织，保留后台资料与发布状态，禁止编辑自动匹配范围', async t => {
  const existing = { id: 'existing-class', resource: 'organizations', name: '管理员维护的班级名', type: '同班校友', college: '信息学院', major: '计算机科学与技术', grade: '2022级', className: '一班', status: 'published', revision: 4, summary: '原有资料', contactName: '老师' }
  const f = await setup(t, [student('alice')], [existing])
  assert.equal(f.org('class').id, 'existing-class')
  assert.equal(f.org('class').summary, '原有资料')
  await assert.rejects(() => f.service.updateAdmin('organizations', existing.id, { major: '错专业' }), error => error.code === 'AUTO_ORGANIZATION_SCOPE_LOCKED')
  assert.equal((await f.service.updateAdmin('organizations', existing.id, { name: '后台更新名称' })).name, '后台更新名称')
  await f.service.syncAutomaticOrganizations()
  assert.equal(f.org('class').name, '后台更新名称')
})
