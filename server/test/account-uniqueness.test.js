import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonDatabase } from '../src/storage/json-database.js'
import { AccountService } from '../src/accounts/service.js'
import { createConfig } from '../src/config.js'

async function fixture(env = 'test') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-account-test-'))
  const config = createConfig({ env, dataFile: path.join(directory, 'data.json'), dataHashSecret: 'test-secret' })
  const database = await new JsonDatabase(config.dataFile).init()
  return { directory, database, service: new AccountService(database, config) }
}

const identity = {
  schoolSubject: 'school-subject-001', name: '测试用户', personType: 'student', department: '测试学院',
  schoolIdentityVerified: true, alumniStatusVerified: false, verificationSource: 'school-registration-check', isAdmin: false
}

test('已有中文正式账号移除演示标记后可跨环境登录，保留强密码和隐私边界', async (t) => {
  const { directory, database, service } = await fixture('development')
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const created = await service.createDevelopmentUser({ username: '正式校友', password: 'FormalAccount!2026', name: '正式校友', department: '测试学院' })
  await database.transaction((data) => {
    const account = data.accounts.find((item) => item.id === created.id)
    delete account.localDevelopmentOnly
    delete account.developmentSchoolIdentityFixture
    account.schoolIdentityVerified = true
    account.verificationSource = 'platform-admin-confirmed'
    account.accountSource = 'platform_member'
    account.studentIdDisplay = '202200000123'
    account.studentIdMasked = '********0123'
  })
  for (const env of ['development', 'production']) {
    service.config.env = env
    const account = await service.login({ username: '正式校友', password: 'FormalAccount!2026' })
    assert.equal(account.id, created.id)
    assert.equal(account.schoolIdentityVerified, true)
    assert.equal(account.verificationSource, 'platform-admin-confirmed')
    assert.equal(account.localDevelopmentOnly, undefined)
    assert.equal(account.studentIdDisplay, undefined)
    assert.equal(account.passwordHash, undefined)
    assert.equal(account.studentIdMasked, '********0123')
    await assert.rejects(() => service.login({ username: '正式校友', password: '123456' }), (error) => error.code === 'INVALID_PASSWORD')
  }
  await assert.rejects(() => service.register(identity, { username: '新的中文账号', password: 'FormalAccount!2026' }), (error) => error.code === 'INVALID_USERNAME')
})

test('学校校验只产生注册资格，不自动创建账号', async (t) => {
  const { directory, service } = await fixture()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const eligible = await service.checkRegistrationEligibility(identity)
  assert.equal(eligible.status, 'registration_verified')
  assert.equal(service.listAccounts().total, 0)

  const account = await service.register(eligible.identity, { username: 'test_user', password: 'StrongPass!2026' })
  assert.equal(account.username, 'test_user')
  assert.equal(account.lastLoginAt, null)
  assert.equal(service.listAccounts().total, 1)

  const nextCheck = await service.checkRegistrationEligibility(identity)
  assert.equal(nextCheck.status, 'account_exists')
})

test('本地用户名大小写不敏感且密码使用哈希校验', async (t) => {
  const { directory, database, service } = await fixture()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await service.register(identity, { username: 'Local.User', password: 'StrongPass!2026' })

  const stored = database.read((data) => data.accounts[0])
  assert.match(stored.passwordHash, /^scrypt\$/)
  assert.notEqual(stored.passwordHash, 'StrongPass!2026')

  const account = await service.login({ username: 'local.user', password: 'StrongPass!2026' })
  assert.equal(account.username, 'Local.User')
  await assert.rejects(
    () => service.login({ username: 'Local.User', password: 'wrong-password' }),
    (error) => error.code === 'INVALID_CREDENTIALS'
  )
  await assert.rejects(
    () => service.login({ username: 'unknown_user', password: 'wrong-password' }),
    (error) => error.code === 'INVALID_CREDENTIALS' && error.message === '用户名或密码错误'
  )
})

test('注册校验发现多个有效账号时阻断且不会创建第三个账号', async (t) => {
  const { directory, database, service } = await fixture()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await service.register(identity, { username: 'first_user', password: 'StrongPass!2026' })
  await database.transaction((data) => {
    data.accounts.push({ ...data.accounts[0], id: 'duplicate-account', username: 'second_user', usernameNormalized: 'second_user', createdAt: '2025-01-01T00:00:00.000Z' })
  })

  const result = await service.checkRegistrationEligibility(identity)
  assert.equal(result.status, 'account_conflict')
  assert.equal(result.conflict.accountCount, 2)
  assert.equal(service.listAccounts().total, 2)
})

test('保留一个冲突账号后只允许使用平台账号登录，不自动签发登录结果', async (t) => {
  const { directory, database, service } = await fixture()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const first = await service.register(identity, { username: 'first_user', password: 'StrongPass!2026' })
  await database.transaction((data) => data.accounts.push({ ...data.accounts[0], id: 'duplicate-account', username: 'second_user', usernameNormalized: 'second_user' }))
  const blocked = await service.checkRegistrationEligibility(identity)

  const resolved = await service.resolveConflict(blocked.conflict.id, {
    action: 'keep_existing', keepAccountId: first.id, confirmation: '确认注销多余账号'
  })
  assert.equal(resolved.status, 'account_kept')
  assert.equal(resolved.loginRequired, true)
  assert.equal(service.listAccounts({ status: 'active' }).total, 1)
  assert.equal(service.listAccounts({ status: 'deactivated' }).total, 1)

  const login = await service.login({ username: 'first_user', password: 'StrongPass!2026' })
  assert.equal(login.id, first.id)
})

test('重复账号合并只刷新实名资料，不允许身份快照静默改写超级管理员权限', async (t) => {
  const { directory, database, service } = await fixture()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const oldAdmin = await service.register({ ...identity, isAdmin: true }, { username: 'old_admin', password: 'StrongPass!2026' })
  const reviewingAdmin = await service.register({ ...identity, schoolSubject: 'reviewing-super-admin', name: '复核管理员', isAdmin: true }, { username: 'reviewing_admin', password: 'StrongPass!2026' })
  await database.transaction((data) => {
    data.accounts.push({
      ...data.accounts[0], id: 'duplicate-admin-account', username: 'duplicate_admin', usernameNormalized: 'duplicate_admin'
    })
  })

  const blocked = await service.checkRegistrationEligibility({ ...identity, name: '最新实名资料', isAdmin: false })
  await assert.rejects(() => service.resolveConflict(blocked.conflict.id, {
    action: 'keep_existing', keepAccountId: oldAdmin.id, confirmation: '确认注销多余账号'
  }, { actor: 'self-service' }), (error) => error.code === 'SUPER_ADMIN_SELF_DEACTIVATION_FORBIDDEN')
  const result = await service.resolveConflict(blocked.conflict.id, {
    action: 'keep_existing', keepAccountId: oldAdmin.id, confirmation: '确认注销多余账号'
  }, { actor: reviewingAdmin.id })

  assert.equal(result.status, 'account_kept')
  const loggedIn = await service.login({ username: 'old_admin', password: 'StrongPass!2026' })
  assert.equal(loggedIn.name, '最新实名资料')
  assert.equal(loggedIn.isAdmin, true)
})

test('注销全部冲突账号后不会自动建号，可重新获得注册资格', async (t) => {
  const { directory, database, service } = await fixture()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await service.register(identity, { username: 'first_user', password: 'StrongPass!2026' })
  await database.transaction((data) => data.accounts.push({ ...data.accounts[0], id: 'duplicate-account', username: 'second_user', usernameNormalized: 'second_user' }))
  const blocked = await service.checkRegistrationEligibility(identity)

  const resolved = await service.resolveConflict(blocked.conflict.id, {
    action: 'recreate', confirmation: '确认注销全部旧账号并新注册'
  })
  assert.equal(resolved.status, 'registration_required')
  assert.equal(service.listAccounts({ status: 'active' }).total, 0)
  assert.equal(service.listAccounts().total, 2)
  assert.equal((await service.checkRegistrationEligibility(identity)).status, 'registration_verified')
})

test('本地登录每次重查学校身份账号唯一性', async (t) => {
  const { directory, database, service } = await fixture()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await service.register(identity, { username: 'first_user', password: 'StrongPass!2026' })
  await database.transaction((data) => data.accounts.push({ ...data.accounts[0], id: 'duplicate-account', username: 'second_user', usernameNormalized: 'second_user' }))

  await assert.rejects(
    () => service.login({ username: 'first_user', password: 'StrongPass!2026' }),
    (error) => error.code === 'ACCOUNT_CONFLICT'
  )
  assert.equal(service.listConflicts({ status: 'open' }).length, 1)
  assert.equal(service.auditLogs().some((item) => item.action === 'identity.duplicate_blocked' && item.details.context === 'local-login'), true)
})

test('被后台暂停的学校身份不能重新注册或登录', async (t) => {
  const { directory, service } = await fixture()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const first = await service.register(identity, { username: 'test_user', password: 'StrongPass!2026' })
  await service.setAccountStatus(first.id, 'suspended')

  await assert.rejects(() => service.checkRegistrationEligibility(identity), (error) => error.code === 'ACCOUNT_SUSPENDED')
  await assert.rejects(
    () => service.login({ username: 'test_user', password: 'StrongPass!2026' }),
    (error) => error.code === 'ACCOUNT_SUSPENDED'
  )
  assert.equal(service.listAccounts().total, 1)
})

test('本地演示管理员只能在 development 初始化且不会伪装成学校已认证身份', async (t) => {
  const { directory, database, service } = await fixture('development')
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const admin = await service.createDevelopmentAdmin({ username: 'demo_admin', password: 'Temporary!2026' })
  assert.equal(admin.isAdmin, true)
  assert.equal(admin.localDevelopmentOnly, true)
  assert.equal(admin.schoolIdentityVerified, false)
  assert.equal(admin.passwordHash, undefined)
  assert.match(database.read((data) => data.accounts[0].passwordHash), /^scrypt\$/)
  assert.equal((await service.login({ username: 'demo_admin', password: 'Temporary!2026' })).isAdmin, true)

  service.config.env = 'production'
  await assert.rejects(
    () => service.createDevelopmentAdmin({ username: 'another_admin', password: 'Temporary!2026' }),
    (error) => error.code === 'DEV_ADMIN_BOOTSTRAP_DISABLED'
  )
})

test('本地演示普通用户可使用中文账号和六位密码且生产环境不放宽规则', async (t) => {
  const { directory, database, service } = await fixture('development')
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  // All identity fields in this disposable fixture are deliberately fictional.
  const account = await service.createDevelopmentUser({ username: '虚构测试学员', password: '123456', name: '虚构测试学员' })
  assert.equal(account.username, '虚构测试学员')
  assert.equal(account.name, '虚构测试学员')
  assert.equal(account.isAdmin, false)
  assert.equal(account.localDevelopmentOnly, true)
  assert.equal(account.schoolIdentityVerified, false)
  assert.equal(account.mustChangePassword, false)
  assert.equal(account.passwordHash, undefined)
  assert.match(database.read((data) => data.accounts[0].passwordHash), /^scrypt\$/)
  assert.equal((await service.login({ username: '虚构测试学员', password: '123456' })).id, account.id)
  await database.transaction((data) => {
    Object.assign(data.accounts.find((item) => item.id === account.id), {
      personType: 'student',
      department: '虚构测试学院',
      studentIdMasked: '********1001',
      studentIdDisplay: 'DEMO00001001',
      alumniNo: 'TEST-ALUMNI-001',
      verificationSource: 'local-development-school-verification-fixture',
      developmentSchoolIdentityFixture: true
    })
  })
  const simulatedIdentity = await service.login({ username: '虚构测试学员', password: '123456' })
  assert.equal(simulatedIdentity.studentIdDisplay, 'DEMO00001001')
  assert.equal(simulatedIdentity.schoolIdentityVerified, false)
  assert.equal(simulatedIdentity.developmentSchoolIdentityFixture, true)
  const listedIdentity = service.listAccounts({ query: '虚构测试学员' }).items[0]
  assert.equal(listedIdentity.studentIdDisplay, undefined)
  assert.equal(listedIdentity.studentIdMasked, '********1001')
  const asciiAccount = await service.createDevelopmentUser({ username: 'ascii_demo', password: 'StrongPass!2026' })
  await assert.rejects(
    () => service.register({ ...identity, schoolSubject: 'formal-short-password' }, { username: 'formal_user', password: '123456' }),
    (error) => error.code === 'INVALID_PASSWORD'
  )

  service.config.env = 'production'
  assert.equal(service.getActiveAccount(account.id).studentIdDisplay, undefined)
  await assert.rejects(
    () => service.login({ username: '虚构测试学员', password: '123456' }),
    (error) => error.code === 'INVALID_CREDENTIALS'
  )
  await assert.rejects(
    () => service.login({ username: asciiAccount.username, password: 'StrongPass!2026' }),
    (error) => error.code === 'INVALID_CREDENTIALS'
  )
  await assert.rejects(
    () => service.createDevelopmentUser({ username: '测试用户', password: '123456' }),
    (error) => error.code === 'DEV_USER_BOOTSTRAP_DISABLED'
  )
})
