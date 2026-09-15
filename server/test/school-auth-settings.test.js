import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createConfig } from '../src/config.js'
import { buildApp } from '../src/app.js'
import { SchoolAuthSettings, assertSchoolEndpoint } from '../src/auth/settings.js'
import { JsonDatabase } from '../src/storage/json-database.js'

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-school-settings-'))
  const config = createConfig({
    env: 'test', publicBaseUrl: 'https://alumni-api.hufe.edu.cn',
    corsOrigins: ['https://alumni.hufe.edu.cn'], returnUrlOrigins: ['https://alumni.hufe.edu.cn'],
    dataFile: path.join(directory, 'database.json'), mediaDir: path.join(directory, 'media'),
    dataHashSecret: 'school-settings-tests-strong-random-key',
    auth: { managedInAdmin: true }, ...overrides
  })
  const content = { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => ({}) }
  let claims = { cn: '校验测试', department: '测试学院', affiliation: 'student' }
  const cas = { loginUrl: service => `https://uia.hufe.edu.cn/cas/login?service=${encodeURIComponent(service)}`, validate: async () => ({ subject: 'school-settings-subject', claims }) }
  const app = await buildApp({ config, logger: false, contentService: content, refreshContent: false, scheduleContent: false, casClient: cas })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const admin = await app.services.accounts.register({ schoolSubject: 'config-admin', name: '配置管理员', department: '信息中心', isAdmin: true }, { username: 'config_admin', password: 'TestPassword!2026' })
  const member = await app.services.accounts.register({ schoolSubject: 'config-member', name: '配置用户', department: '测试学院' }, { username: 'config_member', password: 'TestPassword!2026' })
  const token = app.services.sessions.issueAccess(admin).accessToken
  const memberToken = app.services.sessions.issueAccess(member).accessToken
  const request = (method, suffix = '', payload, credential = token) => app.inject({ method, url: `/api/v1/admin/school-auth-config${suffix}`, headers: credential ? { authorization: `Bearer ${credential}` } : {}, ...(payload === undefined ? {} : { payload }) })
  const save = async (settings = {}, expectedRevision = app.services.schoolAuth.view().revision) => {
    const response = await request('PUT', '', { expectedRevision, settings })
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data
  }
  const action = (name, extra = {}) => request('POST', `/${name}`, { expectedRevision: app.services.schoolAuth.view().revision, ...extra })
  const activate = async () => {
    assert.equal((await action('check')).statusCode, 200)
    const response = await action('activate', { schoolConfirmed: true })
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data
  }
  return { app, config, request, save, action, activate, memberToken, setClaims: value => { claims = value } }
}

test('全局管理员配置权限、默认关闭、草稿隔离、并发保护和密钥不回显', async t => {
  const f = await fixture(t)
  for (const [token, status] of [['', 401], [f.memberToken, 403]]) {
    for (const [method, suffix, body] of [['GET', '', undefined], ['PUT', '', { settings: {}, expectedRevision: 0 }], ['POST', '/activate', { expectedRevision: 0, schoolConfirmed: true }]]) {
      assert.equal((await f.request(method, suffix, body, token)).statusCode, status)
    }
  }
  const before = await f.app.inject('/api/v1/auth/registration/config')
  assert.equal(before.json().data.ready, false)
  const secret = 'OIDC_PRIVATE_TEST_SECRET_DO_NOT_ECHO'
  const saved = await f.save({ oidcClientSecret: secret })
  assert.equal(saved.secretConfigured, true)
  assert.equal(saved.settings.oidcClientSecret, '')
  assert.equal(saved.status.ready, false)
  assert.ok(!JSON.stringify(f.app.services.database.read()).includes(secret))
  assert.equal((await f.request('PUT', '', { expectedRevision: 0, settings: {} })).statusCode, 409)
  const retained = await f.save({ oidcClientSecret: '' })
  assert.equal(retained.secretConfigured, true)
  assert.equal((await f.request('PUT', '', { expectedRevision: retained.revision, settings: { adminSubjects: ['intruder'] } })).statusCode, 400)
  const cleared = await f.request('PUT', '', { expectedRevision: retained.revision, settings: {}, clearOidcSecret: true })
  assert.equal(cleared.json().data.secretConfigured, false)
})

test('草稿检查、学校确认和部署域名校验后才启用，发布可恢复且停用不丢未发布标记', async t => {
  const f = await fixture(t)
  await f.save({ casBaseUrl: 'https://uia.hufe.edu.cn/cas/' })
  assert.equal(f.app.services.schoolAuth.draft().casBaseUrl, 'https://uia.hufe.edu.cn/cas')
  assert.equal((await f.action('activate')).statusCode, 400)
  const active = await f.activate()
  assert.equal(active.status.ready, true)
  assert.equal(active.hasUnpublishedChanges, false)
  const fresh = new SchoolAuthSettings(await new JsonDatabase(f.config.dataFile).init(), f.config)
  assert.equal(fresh.publicStatus().ready, true)
  await f.save({ attributes: { name: 'realName' } })
  assert.equal(f.app.services.schoolAuth.snapshot().config.auth.attributes.name, 'cn')
  const disabled = (await f.action('disable')).json().data
  assert.equal(disabled.status.ready, false)
  assert.equal(disabled.hasUnpublishedChanges, true)
  assert.equal(disabled.activeRevision, active.activeRevision)
  const blocked = await f.app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5' } })
  assert.equal(blocked.statusCode, 503)
  await f.activate()
  assert.equal(f.app.services.schoolAuth.snapshot().config.auth.attributes.name, 'realName')
  await f.save({ publicBaseUrl: 'https://different-api.hufe.edu.cn' })
  const check = (await f.action('check')).json().data.lastCheck
  assert.equal(check.valid, false)
  assert.equal(check.checks.find(item => item.key === 'deployment').ok, false)
  assert.equal((await f.action('activate', { schoolConfirmed: true })).statusCode, 400)
})

test('已启用 CAS 使用后台属性映射，完整回调换票注册；切换配置使旧事务失效', async t => {
  const f = await fixture(t)
  await f.save({ attributes: { name: 'schoolName', department: 'schoolCollege' } })
  await f.activate()
  f.setClaims({ schoolName: '后台映射用户', schoolCollege: '后台映射学院', personType: 'student' })
  const create = () => f.app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5' } })
  const created = await create()
  assert.equal(created.statusCode, 201)
  const value = created.json().data
  const cookie = String(created.headers['set-cookie']).split(';')[0]
  const url = new URL(value.authorizeUrl)
  const start = await f.app.inject({ url: url.pathname + url.search, headers: { cookie } })
  assert.equal(start.statusCode, 302)
  assert.equal(new URL(start.headers.location).searchParams.get('service'), 'https://alumni-api.hufe.edu.cn/api/v1/auth/registration/callback')
  const callback = await f.app.inject({ url: '/api/v1/auth/registration/callback?ticket=TEST-ONLY', headers: { cookie } })
  assert.equal(callback.statusCode, 200)
  const poll = (await f.app.inject({ url: `/api/v1/auth/registration/verification-sessions/${value.sessionId}`, headers: { authorization: `Bearer ${value.pollToken}` } })).json().data
  assert.equal(poll.status, 'complete')
  const exchanged = (await f.app.inject({ method: 'POST', url: '/api/v1/auth/registration/exchange', headers: { cookie, authorization: `Bearer ${value.pollToken}` }, payload: { sessionId: value.sessionId, exchangeCode: poll.exchangeCode } })).json().data
  assert.equal(exchanged.identity.name, '后台映射用户')
  assert.equal(exchanged.identity.department, '后台映射学院')
  const registered = await f.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { registrationTicket: exchanged.registrationToken || exchanged.registrationTicket, username: 'settings_user', password: 'NewUserPassword!2026' } })
  assert.equal(registered.statusCode, 201, registered.body)
  const old = await create()
  await f.save({ casLoginPath: '/login2' })
  await f.activate()
  const oldUrl = new URL(old.json().data.authorizeUrl)
  const rejected = await f.app.inject({ url: oldUrl.pathname + oldUrl.search, headers: { cookie: String(old.headers['set-cookie']).split(';')[0] } })
  assert.equal(rejected.statusCode, 409)
  assert.equal(rejected.json().code, 'SCHOOL_AUTH_CONFIG_CHANGED')
})

test('配置和出站地址拒绝非法学校域名、HTTP、路径注入及未许可返回域名', async t => {
  const f = await fixture(t)
  for (const settings of [
    { casBaseUrl: 'https://attacker.test/cas' }, { casBaseUrl: 'http://uia.hufe.edu.cn/cas' },
    { casBaseUrl: 'https://127.0.0.1/cas' }, { casLoginPath: '//attacker.test/login' },
    { casValidatePath: '/../admin?token=oops' }, { returnUrlOrigins: ['https://not-approved.hufe.edu.cn'] },
    { protocol: 'oidc', oidcClientId: '', oidcScopes: 'profile' }
  ]) {
    await f.save(settings)
    assert.equal((await f.action('check')).json().data.lastCheck.valid, false)
    assert.equal((await f.action('activate', { schoolConfirmed: true })).statusCode, 400)
  }
  for (const value of ['https://uia.hufe.edu.cn:8443/cas', 'https://user:pass@uia.hufe.edu.cn/cas', 'https://uia.hufe.edu.cn/cas?url=x', 'https://evil.test/token']) assert.throws(() => assertSchoolEndpoint(value, ['uia.hufe.edu.cn']))
})

test('OIDC 事务不能走 CAS 回调，停用不影响已有账号登录', async t => {
  const f = await fixture(t)
  await f.save({ protocol: 'oidc', oidcClientId: 'school-test-client', oidcClientSecret: 'TEST-SECRET' })
  await f.activate()
  const created = await f.app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5' } })
  const value = created.json().data
  await f.app.inject({ url: '/api/v1/auth/registration/callback?ticket=TEST', headers: { cookie: String(created.headers['set-cookie']).split(';')[0] } })
  const poll = await f.app.inject({ url: `/api/v1/auth/registration/verification-sessions/${value.sessionId}`, headers: { authorization: `Bearer ${value.pollToken}` } })
  assert.equal(poll.json().data.error.code, 'REGISTRATION_PROTOCOL_MISMATCH')
  await f.action('disable')
  const login = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'config_member', password: 'TestPassword!2026' } })
  assert.equal(login.statusCode, 200)
})

test('写盘失败不发布配置，密文损坏时关闭校验而非回退环境配置', async t => {
  const f = await fixture(t)
  await f.save()
  const db = f.app.services.database
  const persist = db.persist.bind(db)
  db.persist = async () => { throw new Error('test disk failure') }
  assert.equal((await f.action('activate', { schoolConfirmed: true })).statusCode, 500)
  assert.equal(f.app.services.schoolAuth.publicStatus().ready, false)
  db.persist = persist
  await f.activate()
  await db.transaction(data => { data.schoolAuthSettings.active = 'tampered' })
  assert.equal(f.app.services.schoolAuth.publicStatus().ready, false)
  assert.throws(() => f.app.services.schoolAuth.requireReady(), /无法解密/)
})

test('生产后台配置模式允许认证未配置启动，基础 HTTPS 和强密钥约束仍保留', () => {
  const base = { env: 'production', publicBaseUrl: 'https://alumni-api.hufe.edu.cn', corsOrigins: ['https://alumni.hufe.edu.cn'], returnUrlOrigins: ['https://alumni.hufe.edu.cn'], dataHashSecret: 'production-strong-secret-at-least-32-characters', auth: { managedInAdmin: true, protocol: 'oidc', oidc: { clientId: '' } } }
  assert.doesNotThrow(() => createConfig(base))
  assert.throws(() => createConfig({ ...base, dataHashSecret: 'short' }))
  assert.throws(() => createConfig({ ...base, publicBaseUrl: 'http://localhost:8787' }))
})
