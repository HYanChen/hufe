import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig as baseConfig } from '../src/config.js'
import { hmac } from '../src/auth/crypto.js'

const registeredCas = { serviceUrl: 'https://alumni-api.hufe.edu.cn/api/v1/auth/registration/callback' }
// These tests exercise explicitly environment-configured legacy deployments.
const createConfig = (overrides = {}) => baseConfig({ ...overrides, auth: { managedInAdmin: false, ...overrides.auth } })

function responseCookie(response) {
  return String(response.headers['set-cookie'] || '').split(';')[0]
}

function signedBrowserCookie(sessionId, browserBinding, secret) {
  const payload = `${sessionId}.${browserBinding}`
  return `hufe_registration_verification=${payload}.${hmac(payload, secret)}`
}

function contentStub() {
  const status = { stale: false, itemCount: 1, lastAttemptAt: '2026-07-17T00:00:00.000Z', sourceStatuses: [] }
  const item = { id: 'official-1', category: 'news', title: '官网测试内容', sourceUrl: 'https://www.hufe.edu.cn/info/1047/1.htm' }
  return {
    init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status,
    home: () => ({ status, sections: { news: [item] } }),
    list: () => ({ items: [item], total: 1, page: 1, pageSize: 12, status }),
    get: async (id) => id === item.id ? item : null,
    refresh: async () => status
  }
}

test('跨域编辑、撤回与删除通过浏览器预检，未许可域名仍被拒绝', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-cors-test-'))
  const origin = 'http://127.0.0.1:4180'
  const config = createConfig({ env: 'test', dataFile: path.join(directory, 'data.json'), corsOrigins: [origin], content: { cacheFile: path.join(directory, 'content.json') } })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })
  for (const method of ['PATCH', 'PUT', 'DELETE']) {
    const response = await app.inject({ method: 'OPTIONS', url: '/api/v1/admin/business/applications/example', headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type' } })
    assert.equal(response.statusCode, 204)
    assert.equal(response.headers['access-control-allow-origin'], origin)
    assert.ok(response.headers['access-control-allow-methods'].split(',').map((value) => value.trim()).includes(method))
    assert.match(response.headers['access-control-allow-headers'], /authorization/)
  }
  const denied = await app.inject({ method: 'OPTIONS', url: '/api/v1/admin/business/applications/example', headers: { origin: 'https://untrusted.invalid', 'access-control-request-method': 'PATCH' } })
  assert.notEqual(denied.headers['access-control-allow-origin'], 'https://untrusted.invalid')
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/admin/business/applications/example', headers: { origin }, payload: {} })).statusCode, 401)
})

test('API 提供品牌、官网内容与新用户注册 CAS 跳转事务', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-api-test-'))
  const config = createConfig({
    env: 'test', publicBaseUrl: 'https://alumni-api.hufe.edu.cn', dataFile: path.join(directory, 'data.json'),
    content: { cacheFile: path.join(directory, 'content.json') },
    auth: { protocol: 'cas', cas: registeredCas }
  })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  const brand = await app.inject({ method: 'GET', url: '/api/v1/brand' })
  assert.equal(brand.statusCode, 200)
  assert.equal(brand.json().data.name, '湖南财政经济学院')

  const content = await app.inject({ method: 'GET', url: '/api/v1/content/official-1' })
  assert.equal(content.json().data.title, '官网测试内容')

  const created = await app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5' } })
  assert.equal(created.statusCode, 201)
  const transaction = created.json().data
  assert.equal(transaction.purpose, 'new_user_registration')
  const transactionCookie = responseCookie(created)
  assert.match(created.headers['set-cookie'], /hufe_registration_verification=.*HttpOnly; Secure; SameSite=Lax/)
  const start = await app.inject({
    method: 'GET', url: new URL(transaction.authorizeUrl).pathname + new URL(transaction.authorizeUrl).search,
    headers: { cookie: transactionCookie }
  })
  assert.equal(start.statusCode, 302)
  assert.match(start.headers.location, /^https:\/\/uia\.hufe\.edu\.cn\/cas\/login\?service=/)
  const schoolService = new URL(start.headers.location).searchParams.get('service')
  assert.equal(schoolService, registeredCas.serviceUrl)
  assert.equal(start.headers['set-cookie'], undefined)

  const legacy = await app.inject({ method: 'POST', url: '/api/v1/auth/sso/sessions', payload: { platform: 'h5' } })
  assert.equal(legacy.statusCode, 201)
  assert.equal(legacy.json().data.purpose, 'new_user_registration')
  assert.equal(new URL(legacy.json().data.authorizeUrl).pathname, '/api/v1/auth/registration/start')
})

test('转发注册链接或窃取 pollToken 不能跨浏览器完成注册换票', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-login-csrf-test-'))
  const config = createConfig({
    env: 'test', publicBaseUrl: 'https://alumni-api.hufe.edu.cn', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'browser-binding-secret',
    content: { cacheFile: path.join(directory, 'content.json') }, auth: { protocol: 'cas', cas: registeredCas }
  })
  let loginCalls = 0
  const casClient = {
    loginUrl(service) { loginCalls += 1; return `https://uia.hufe.edu.cn/cas/login?service=${encodeURIComponent(service)}` },
    validate: async () => ({ subject: 'csrf-safe-subject', claims: { cn: '绑定测试', department: '信息工程学院', affiliation: 'student' } })
  }
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub(), casClient })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  for (const platform of ['mp-weixin', 'mp-alipay', 'app']) {
    const unsupported = await app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform } })
    assert.equal(unsupported.statusCode, 400)
    assert.equal(unsupported.json().code, 'REGISTRATION_PLATFORM_BINDING_UNAVAILABLE')
  }

  const createdResponse = await app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5' } })
  const created = createdResponse.json().data
  const ownerCookie = responseCookie(createdResponse)
  const authorize = new URL(created.authorizeUrl)
  const forwarded = await app.inject({ method: 'GET', url: `${authorize.pathname}${authorize.search}` })
  assert.equal(forwarded.statusCode, 401)
  assert.equal(forwarded.json().code, 'REGISTRATION_BROWSER_BINDING_REQUIRED')
  assert.equal(loginCalls, 0)

  const forbiddenContext = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/registration/callback?ticket=ST-FORWARDED&session=${created.sessionId}&state=${authorize.searchParams.get('state')}`,
    headers: { cookie: ownerCookie }
  })
  assert.equal(forbiddenContext.statusCode, 400)
  assert.equal(forbiddenContext.json().code, 'REGISTRATION_CALLBACK_CONTEXT_FORBIDDEN')

  const started = await app.inject({ method: 'GET', url: `${authorize.pathname}${authorize.search}`, headers: { cookie: ownerCookie } })
  assert.equal(started.statusCode, 302)
  assert.equal(loginCalls, 1)
  const callbackWithoutCookie = await app.inject({ method: 'GET', url: '/api/v1/auth/registration/callback?ticket=ST-NO-COOKIE' })
  assert.equal(callbackWithoutCookie.statusCode, 401)
  assert.equal(callbackWithoutCookie.json().code, 'REGISTRATION_BROWSER_BINDING_REQUIRED')
  const callback = await app.inject({ method: 'GET', url: '/api/v1/auth/registration/callback?ticket=ST-OWNER', headers: { cookie: ownerCookie } })
  assert.equal(callback.statusCode, 200)

  const polled = (await app.inject({
    method: 'GET', url: `/api/v1/auth/registration/verification-sessions/${created.sessionId}`,
    headers: { authorization: `Bearer ${created.pollToken}` }
  })).json().data
  assert.ok(polled.exchangeCode)
  const stolenExchange = await app.inject({
    method: 'POST', url: '/api/v1/auth/registration/exchange', headers: { authorization: `Bearer ${created.pollToken}` },
    payload: { sessionId: created.sessionId, exchangeCode: polled.exchangeCode }
  })
  assert.equal(stolenExchange.statusCode, 401)
  assert.equal(stolenExchange.json().code, 'REGISTRATION_BROWSER_BINDING_REQUIRED')
  const ownerExchange = await app.inject({
    method: 'POST', url: '/api/v1/auth/registration/exchange', headers: { authorization: `Bearer ${created.pollToken}`, cookie: ownerCookie },
    payload: { sessionId: created.sessionId, exchangeCode: polled.exchangeCode }
  })
  assert.equal(ownerExchange.statusCode, 200)
  assert.equal(ownerExchange.json().data.status, 'registration_verified')
})

test('未配置公网 HTTPS CAS service 时会在创建事务和开始跳转前明确拒绝', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-cas-config-test-'))
  const config = createConfig({
    env: 'test', publicBaseUrl: 'http://localhost:8787', dataFile: path.join(directory, 'data.json'),
    content: { cacheFile: path.join(directory, 'content.json') }, auth: { protocol: 'cas' }
  })
  let loginCalls = 0
  const casClient = { loginUrl() { loginCalls += 1; return 'https://should-not-be-called.invalid' } }
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub(), casClient })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  const created = await app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5' } })
  assert.equal(created.statusCode, 503)
  assert.equal(created.json().code, 'CAS_PUBLIC_SERVICE_URL_REQUIRED')
  assert.equal(loginCalls, 0)

  const { session, browserBinding } = app.services.sessions.create({ platform: 'h5', returnUrl: '', protocol: 'cas' })
  const start = await app.inject({
    method: 'GET', url: `/api/v1/auth/registration/start?session=${session.id}&state=${session.state}`,
    headers: { cookie: signedBrowserCookie(session.id, browserBinding, config.dataHashSecret) }
  })
  assert.equal(start.statusCode, 503)
  assert.equal(start.json().code, 'CAS_PUBLIC_SERVICE_URL_REQUIRED')
  assert.equal(loginCalls, 0)
})

test('未登记回跳域名会被拒绝', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-return-test-'))
  const config = createConfig({ env: 'test', dataFile: path.join(directory, 'data.json'), content: { cacheFile: path.join(directory, 'content.json') } })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5', returnUrl: 'https://evil.example/callback' } })
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().code, 'RETURN_URL_NOT_ALLOWED')
})

test('学校回调只签发一次性注册票据，平台用户名密码独立注册和登录', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-auth-flow-test-'))
  const config = createConfig({
    env: 'test', publicBaseUrl: 'https://alumni-api.hufe.edu.cn', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'flow-secret',
    content: { cacheFile: path.join(directory, 'content.json') }, auth: { protocol: 'cas', cas: registeredCas }
  })
  let validatedService = ''
  const casClient = {
    loginUrl: (service) => `https://uia.hufe.edu.cn/cas/login?service=${encodeURIComponent(service)}`,
    validate: async (_ticket, service) => {
      validatedService = service
      return { subject: 'stable-school-subject', claims: { sub: 'stable-school-subject', cn: '实名测试', studentId: '20260001', idCard: '430102199901011234', affiliation: 'student', department: '财政金融学院' } }
    }
  }
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub(), casClient })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  const createdResponse = await app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5' } })
  const created = createdResponse.json().data
  const transactionCookie = responseCookie(createdResponse)
  const authorize = new URL(created.authorizeUrl)
  const started = await app.inject({ method: 'GET', url: `${authorize.pathname}${authorize.search}`, headers: { cookie: transactionCookie } })
  assert.equal(started.statusCode, 302)
  const callback = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/registration/callback?ticket=ST-TEST',
    headers: { cookie: transactionCookie }
  })
  assert.equal(callback.statusCode, 200)
  assert.equal(validatedService, registeredCas.serviceUrl)
  assert.equal(callback.headers['set-cookie'], undefined)
  assert.equal(app.services.accounts.listAccounts().total, 0)

  const polled = (await app.inject({ method: 'GET', url: `/api/v1/auth/registration/verification-sessions/${created.sessionId}`, headers: { authorization: `Bearer ${created.pollToken}` } })).json().data
  assert.equal(polled.result, 'registration_verified')
  assert.ok(polled.exchangeCode)

  const exchangedResponse = await app.inject({
    method: 'POST', url: '/api/v1/auth/registration/exchange', headers: { authorization: `Bearer ${created.pollToken}`, cookie: transactionCookie },
    payload: { sessionId: created.sessionId, exchangeCode: polled.exchangeCode }
  })
  const exchanged = exchangedResponse.json().data
  assert.match(exchangedResponse.headers['set-cookie'], /Max-Age=0/)
  assert.equal(exchanged.status, 'registration_verified')
  assert.ok(exchanged.registrationTicket)
  assert.equal(exchanged.registrationToken, exchanged.registrationTicket)
  assert.equal(exchanged.accessToken, undefined)
  assert.deepEqual(exchanged.identity, {
    name: '实名测试', department: '财政金融学院', college: '财政金融学院', personType: 'student', studentIdMasked: '****0001',
    idCardMasked: '4301**********1234', idCardVerified: true
  })
  assert.deepEqual(exchanged.verifiedIdentity, exchanged.identity)
  assert.equal(exchanged.identity.schoolSubject, undefined)
  assert.equal(exchanged.identity.studentId, undefined)

  const registered = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { username: 'student_001', password: 'StrongPass!2026', registrationTicket: exchanged.registrationTicket }
  })
  assert.equal(registered.statusCode, 201)
  assert.equal(registered.json().data.status, 'registered')
  assert.equal(registered.json().data.loginRequired, true)
  assert.equal(registered.json().data.accessToken, undefined)
  assert.equal(registered.json().data.user.studentIdMasked, '****0001')
  assert.equal(registered.json().data.user.idCardMasked, '4301**********1234')
  assert.equal(registered.json().data.user.studentIdKey, undefined)
  assert.equal(registered.json().data.user.idCardKey, undefined)
  const storedAccount = app.services.database.read((value) => value.accounts[0])
  assert.equal(storedAccount.studentIdMasked, '****0001')
  assert.equal(storedAccount.idCardMasked, '4301**********1234')
  assert.ok(storedAccount.studentIdKey)
  assert.ok(storedAccount.idCardKey)
  assert.equal(storedAccount.studentId, undefined)
  assert.equal(storedAccount.idCard, undefined)
  const serializedStorage = JSON.stringify(app.services.database.read((value) => value))
  assert.equal(serializedStorage.includes('430102199901011234'), false)
  assert.equal(serializedStorage.includes('20260001'), false)

  const replay = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { username: 'student_002', password: 'StrongPass!2026', registrationTicket: exchanged.registrationTicket }
  })
  assert.equal(replay.statusCode, 401)
  assert.equal(replay.json().code, 'REGISTRATION_TICKET_INVALID')

  const loggedIn = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'student_001', password: 'StrongPass!2026' }
  })
  assert.equal(loggedIn.statusCode, 200)
  const login = loggedIn.json().data
  assert.equal(login.status, 'authenticated')
  assert.equal(login.user.name, '实名测试')
  assert.equal(login.user.studentIdMasked, '****0001')
  assert.equal(login.user.idCardMasked, '4301**********1234')
  assert.equal(login.user.studentIdKey, undefined)
  assert.equal(login.user.idCardKey, undefined)
  assert.equal(login.user.passwordHash, undefined)

  const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${login.accessToken}` } })
  assert.equal(me.statusCode, 200)
  assert.equal(me.json().data.schoolIdentityVerified, true)
})

test('已有唯一账号再次学校校验只返回 account_exists，不返回注册或登录令牌', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-account-exists-test-'))
  const config = createConfig({
    env: 'test', publicBaseUrl: 'https://alumni-api.hufe.edu.cn', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'flow-secret',
    content: { cacheFile: path.join(directory, 'content.json') }, auth: { protocol: 'cas', cas: registeredCas }
  })
  const casClient = {
    loginUrl: (service) => `https://uia.hufe.edu.cn/cas/login?service=${encodeURIComponent(service)}`,
    validate: async () => ({ subject: 'existing-subject', claims: { sub: 'existing-subject', cn: '实名测试', affiliation: 'student', department: '财政金融学院' } })
  }
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub(), casClient })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  const verify = async () => {
    const createdResponse = await app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5' } })
    const created = createdResponse.json().data
    const transactionCookie = responseCookie(createdResponse)
    const authorize = new URL(created.authorizeUrl)
    await app.inject({ method: 'GET', url: `${authorize.pathname}${authorize.search}`, headers: { cookie: transactionCookie } })
    await app.inject({ method: 'GET', url: '/api/v1/auth/registration/callback?ticket=ST-TEST', headers: { cookie: transactionCookie } })
    const poll = (await app.inject({ method: 'GET', url: `/api/v1/auth/registration/verification-sessions/${created.sessionId}`, headers: { authorization: `Bearer ${created.pollToken}` } })).json().data
    return (await app.inject({
      method: 'POST', url: '/api/v1/auth/registration/exchange', headers: { authorization: `Bearer ${created.pollToken}`, cookie: transactionCookie },
      payload: { sessionId: created.sessionId, exchangeCode: poll.exchangeCode }
    })).json().data
  }

  const first = await verify()
  await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'existing_user', password: 'StrongPass!2026', registrationTicket: first.registrationTicket } })
  const second = await verify()
  assert.deepEqual(second, { status: 'account_exists', loginRequired: true })
})

test('重复账号注销全部后只返回新的注册票据，不自动登录', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-conflict-flow-test-'))
  const config = createConfig({
    env: 'test', publicBaseUrl: 'https://alumni-api.hufe.edu.cn', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'flow-secret',
    content: { cacheFile: path.join(directory, 'content.json') }, auth: { protocol: 'cas', cas: registeredCas }
  })
  const identity = {
    schoolSubject: 'conflict-subject', name: '冲突测试', personType: 'student', department: '测试学院',
    verificationSource: 'school-registration-check', isAdmin: false
  }
  const casClient = {
    loginUrl: (service) => `https://uia.hufe.edu.cn/cas/login?service=${encodeURIComponent(service)}`,
    validate: async () => ({ subject: identity.schoolSubject, claims: { sub: identity.schoolSubject, cn: identity.name, affiliation: 'student', department: identity.department } })
  }
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub(), casClient })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  await app.services.accounts.register(identity, { username: 'conflict_one', password: 'StrongPass!2026' })
  await app.services.database.transaction((data) => {
    data.accounts.push({ ...data.accounts[0], id: 'duplicate-account', username: 'conflict_two', usernameNormalized: 'conflict_two' })
  })

  const createdResponse = await app.inject({ method: 'POST', url: '/api/v1/auth/registration/verification-sessions', payload: { platform: 'h5' } })
  const created = createdResponse.json().data
  const transactionCookie = responseCookie(createdResponse)
  const authorize = new URL(created.authorizeUrl)
  await app.inject({ method: 'GET', url: `${authorize.pathname}${authorize.search}`, headers: { cookie: transactionCookie } })
  await app.inject({ method: 'GET', url: '/api/v1/auth/registration/callback?ticket=ST-TEST', headers: { cookie: transactionCookie } })
  const poll = (await app.inject({ method: 'GET', url: `/api/v1/auth/registration/verification-sessions/${created.sessionId}`, headers: { authorization: `Bearer ${created.pollToken}` } })).json().data
  assert.equal(poll.result, 'account_conflict')
  const exchanged = (await app.inject({
    method: 'POST', url: '/api/v1/auth/registration/exchange', headers: { authorization: `Bearer ${created.pollToken}`, cookie: transactionCookie },
    payload: { sessionId: created.sessionId, exchangeCode: poll.exchangeCode }
  })).json().data
  assert.equal(exchanged.status, 'account_conflict')
  assert.ok(exchanged.conflictToken)

  const resolved = await app.inject({
    method: 'POST', url: `/api/v1/auth/registration/conflicts/${exchanged.conflict.id}/resolve`,
    headers: { authorization: `Bearer ${exchanged.conflictToken}` },
    payload: { action: 'recreate', confirmation: '确认注销全部旧账号并新注册' }
  })
  assert.equal(resolved.statusCode, 200)
  assert.equal(resolved.json().data.status, 'registration_verified')
  assert.ok(resolved.json().data.registrationTicket)
  assert.equal(resolved.json().data.accessToken, undefined)
  assert.equal(app.services.accounts.listAccounts({ status: 'active' }).total, 0)
})

test('管理后台使用平台账号登录，并由服务端强制校验管理员权限', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-admin-login-test-'))
  const config = createConfig({
    env: 'test', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'admin-flow-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  await app.services.accounts.register({
    schoolSubject: 'admin-subject', name: '后台管理员', personType: 'staff', department: '信息中心',
    verificationSource: 'school-registration-check', isAdmin: true
  }, { username: 'platform_admin', password: 'StrongAdmin!2026' })
  await app.services.accounts.register({
    schoolSubject: 'member-subject', name: '普通用户', personType: 'student', department: '测试学院',
    verificationSource: 'school-registration-check', isAdmin: false
  }, { username: 'platform_member', password: 'StrongMember!2026' })

  const adminLogin = (await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'platform_admin', password: 'StrongAdmin!2026' }
  })).json().data
  const adminDashboard = await app.inject({
    method: 'GET', url: '/api/v1/admin/dashboard',
    headers: { authorization: `Bearer ${adminLogin.accessToken}` }
  })
  assert.equal(adminDashboard.statusCode, 200)

  const memberLogin = (await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'platform_member', password: 'StrongMember!2026' }
  })).json().data
  const rejectedDashboard = await app.inject({
    method: 'GET', url: '/api/v1/admin/dashboard',
    headers: { authorization: `Bearer ${memberLogin.accessToken}` }
  })
  assert.equal(rejectedDashboard.statusCode, 403)
  assert.equal(rejectedDashboard.json().code, 'ADMIN_REQUIRED')
})
