import { hmac, randomToken, sha256, safeEqual } from './crypto.js'
import { readSensitiveIdentityRaw } from './identity.js'
import { educationSnapshot } from '../accounts/profile.js'
import {sealStudentNumber} from '../accounts/student-number.js'
import {PersistentSessions} from './persistent-sessions.js'

const trustedSafeIdentity = Symbol('hufeTrustedSafeRegistrationIdentity')

function authError(message, code = 'UNAUTHORIZED', statusCode = 401) {
  return Object.assign(new Error(message), { code, statusCode })
}

function safeRegistrationIdentity(input, secret, { trustSafeFields = false } = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const scalar = (keys) => {
    const lookup = new Map(Object.entries(source).map(([key, value]) => [String(key).toLowerCase(), value]))
    for (const key of keys) {
      const value = lookup.get(String(key).toLowerCase())
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim()
        if (text) return text
      }
    }
    return ''
  }
  const list = (key) => Array.isArray(source[key]) ? source[key].filter((value) => typeof value === 'string' || typeof value === 'number').slice(0, 50).map(String) : []
  const identity = {
    schoolSubject: scalar(['schoolSubject']), name: scalar(['name']), department: scalar(['department', 'college']),
    ...educationSnapshot(source),
    personType: scalar(['personType']) || 'member', affiliation: list('affiliation'), roles: list('roles'),
    schoolIdentityVerified: source.schoolIdentityVerified === true,
    alumniStatusVerified: source.alumniStatusVerified === true,
    verificationSource: scalar(['verificationSource']), verifiedAt: scalar(['verifiedAt']), alumniNo: scalar(['alumniNo']),
    isAdmin: source.isAdmin === true
  }
  const trustedRaw = readSensitiveIdentityRaw(source)
  const studentId = String(trustedRaw.studentId || scalar(['studentId', 'studentNo', 'student_no', 'employeeNumber', 'employeeNo', 'uid', '学号', '工号'])).replace(/\s+/g, '')
  const idCard = String(trustedRaw.idCard || scalar(['idCard', 'idCardNo', 'idNumber', 'nationalId', 'certificateNumber', 'sfzh', '身份证号', '证件号码'])).replace(/\s+/g, '')
  if (studentId) {
    identity.studentIdMasked = studentId.length <= 4 ? '****' : `${'*'.repeat(Math.max(4, studentId.length - 4))}${studentId.slice(-4)}`
    identity.studentIdKey = hmac(`student-id:${studentId}`, secret)
    identity.studentIdSealed = sealStudentNumber(studentId,secret)
  }
  if (idCard) {
    identity.idCardMasked = idCard.length <= 8 ? '*'.repeat(Math.max(8, idCard.length)) : `${idCard.slice(0, 4)}${'*'.repeat(Math.max(8, idCard.length - 8))}${idCard.slice(-4)}`
    identity.idCardKey = hmac(`id-card:${idCard.toUpperCase()}`, secret)
    identity.idCardVerified = true
  } else if (source[trustedSafeIdentity] === true || trustSafeFields === true) {
    // 只允许本模块上一次净化产生的对象，或服务端人工复核显式标记的安全对象，
    // 在 session -> ticket 间保留脱敏值与 HMAC。普通 HTTP 输入不会获得该信任参数。
    if (typeof source.studentIdMasked === 'string' && source.studentIdMasked.length <= 128) identity.studentIdMasked = source.studentIdMasked
    if (typeof source.studentIdKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(source.studentIdKey)) identity.studentIdKey = source.studentIdKey
    if (typeof source.studentIdSealed === 'string' && source.studentIdSealed.length<300) identity.studentIdSealed = source.studentIdSealed
    if (typeof source.idCardMasked === 'string' && source.idCardMasked.length <= 128) identity.idCardMasked = source.idCardMasked
    if (typeof source.idCardKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(source.idCardKey)) identity.idCardKey = source.idCardKey
    if (source.idCardVerified === true && identity.idCardKey) identity.idCardVerified = true
  }
  Object.defineProperty(identity, trustedSafeIdentity, { value: true, enumerable: false, configurable: false })
  return identity
}

export class AuthSessionStore {
  constructor(config, {database} = {}) {
    this.config = config
    this.sessions = new Map()
    this.accessTokens = new Map()
    this.conflictTokens = new Map()
    this.registrationTickets = new Map()
    this.persistent = database ? new PersistentSessions(database,config.dataHashSecret) : null
  }

  create({ platform, returnUrl, protocol }) {
    const id = randomToken(18)
    const state = randomToken(24)
    const pollToken = randomToken(32)
    const browserBinding = randomToken(32)
    const timestamp = Date.now()
    const session = {
      id, state, platform, returnUrl, protocol,
      pollTokenHash: sha256(pollToken),
      browserBindingHash: sha256(browserBinding),
      status: 'pending',
      createdAt: timestamp,
      expiresAt: timestamp + this.config.auth.sessionTtlMs,
      exchangeCodeHash: null,
      exchangeCode: null,
      exchangeConsumed: false,
      oidc: null,
      outcome: null,
      error: null
    }
    this.sessions.set(id, session)
    return { session, pollToken, browserBinding }
  }

  get(id) {
    const session = this.sessions.get(id)
    if (!session) throw authError('注册身份校验事务不存在', 'REGISTRATION_SESSION_NOT_FOUND', 404)
    if (session.expiresAt <= Date.now()) {
      session.status = 'expired'
      throw authError('注册身份校验事务已过期，请重新发起校验', 'REGISTRATION_SESSION_EXPIRED', 410)
    }
    return session
  }

  forStart(id, state) {
    const session = this.get(id)
    if (session.status !== 'pending') throw authError('注册身份校验事务状态不可继续', 'REGISTRATION_SESSION_INVALID_STATE', 409)
    if (!safeEqual(session.state, state)) throw authError('注册身份校验 state 校验失败', 'REGISTRATION_STATE_MISMATCH')
    return session
  }

  verifyBrowserBinding(id, browserBinding) {
    const session = this.get(id)
    if (!browserBinding || !session.browserBindingHash || !safeEqual(session.browserBindingHash, sha256(browserBinding))) {
      throw authError('注册身份校验必须在发起校验的同一浏览器中继续', 'REGISTRATION_BROWSER_BINDING_REQUIRED')
    }
    return session
  }

  byState(state) {
    const session = [...this.sessions.values()].find((item) => item.state === state)
    if (!session) throw authError('注册身份校验 state 无效', 'REGISTRATION_STATE_MISMATCH')
    const current = this.get(session.id)
    if (current.status !== 'pending') throw authError('注册身份校验事务状态不可继续', 'REGISTRATION_SESSION_INVALID_STATE', 409)
    return current
  }

  setOidc(id, context) {
    const session = this.get(id)
    session.oidc = context
    return session
  }

  complete(id, outcome) {
    const session = this.get(id)
    const exchangeCode = randomToken(32)
    session.status = 'complete'
    session.outcome = outcome?.identity ? { ...outcome, identity: safeRegistrationIdentity(outcome.identity, this.config.dataHashSecret) } : outcome
    session.exchangeCodeHash = sha256(exchangeCode)
    session.exchangeCode = exchangeCode
    session.completedAt = Date.now()
    return exchangeCode
  }

  fail(id, error) {
    const session = this.sessions.get(id)
    if (!session || session.status !== 'pending') return
    session.status = 'failed'
    session.error = { code: error.code || 'REGISTRATION_VERIFICATION_FAILED', message: error.message || '注册身份校验失败' }
  }

  poll(id, pollToken) {
    const session = this.authorizePoll(id, pollToken)
    const base = { sessionId: session.id, status: session.status, expiresAt: new Date(session.expiresAt).toISOString() }
    if (session.status === 'failed') return { ...base, error: session.error }
    if (session.status === 'complete') return { ...base, result: session.outcome.status, exchangeCode: session.exchangeConsumed ? null : session.exchangeCode }
    return base
  }

  exchange(id, pollToken, exchangeCode) {
    const session = this.authorizePoll(id, pollToken)
    if (session.status !== 'complete') throw authError('学校注册身份校验尚未完成', 'REGISTRATION_NOT_COMPLETE', 409)
    if (session.exchangeConsumed) throw authError('一次性换票已使用', 'EXCHANGE_CODE_REPLAY', 409)
    if (!session.exchangeCodeHash || !safeEqual(session.exchangeCodeHash, sha256(exchangeCode))) throw authError('一次性换票无效', 'EXCHANGE_CODE_INVALID')
    session.exchangeConsumed = true
    session.exchangeCode = null
    return session.outcome
  }

  authorizePoll(id, pollToken) {
    const session = this.get(id)
    if (!pollToken || !safeEqual(session.pollTokenHash, sha256(pollToken))) throw authError('注册身份校验事务凭证无效')
    return session
  }

  exchangeCodeForTest(id) {
    return this.sessions.get(id)?.exchangeCode
  }

  issueAccess(account) {
    const token = randomToken(40)
    const tokenHash = sha256(token)
    const expiresAt = Date.now() + this.config.auth.accessTokenTtlMs
    this.accessTokens.set(tokenHash, { account, expiresAt })
    return { accessToken: token, tokenType: 'Bearer', expiresAt: new Date(expiresAt).toISOString(), user: account }
  }

  beginLogin(){return this.persistent?.beginLogin()}
  issueLogin(account,deviceId,metadata,attempt){
    return this.persistent?this.persistent.issue(account,deviceId,metadata,attempt):Promise.resolve(this.issueAccess(account))
  }

  issueRegistrationTicket(identity, options = {}) {
    if (!identity?.schoolSubject) throw authError('学校注册身份结果无效', 'REGISTRATION_IDENTITY_INVALID')
    const safeIdentity = safeRegistrationIdentity(identity, this.config.dataHashSecret, options)
    const token = randomToken(40)
    const tokenHash = sha256(token)
    const expiresAt = Date.now() + this.config.auth.registrationTicketTtlMs
    this.registrationTickets.set(tokenHash, { identity: safeIdentity, expiresAt })
    return {
      registrationTicket: token,
      // registrationToken 为旧客户端兼容别名；新代码统一使用 registrationTicket。
      registrationToken: token,
      expiresAt: new Date(expiresAt).toISOString()
    }
  }

  authenticateRegistrationTicket(token) {
    const tokenHash = token ? sha256(token) : ''
    const record = tokenHash ? this.registrationTickets.get(tokenHash) : null
    if (!record || record.expiresAt <= Date.now()) {
      if (tokenHash) this.registrationTickets.delete(tokenHash)
      throw authError('注册校验凭证无效或已过期', 'REGISTRATION_TICKET_INVALID')
    }
    return record.identity
  }

  consumeRegistrationTicket(token) {
    if (token) this.registrationTickets.delete(sha256(token))
  }

  authenticate(token) {
    if (!token) throw authError('请先登录')
    const tokenHash = sha256(token)
    const record = this.accessTokens.get(tokenHash)
    if(!record&&this.persistent)return this.persistent.authenticate(token)
    if (!record || record.expiresAt <= Date.now()) {
      this.accessTokens.delete(tokenHash)
      throw authError('登录已过期', 'ACCESS_TOKEN_EXPIRED')
    }
    return record.account
  }

  revoke(token,metadata) {
    if (token) this.accessTokens.delete(sha256(token))
    return token?this.persistent?.revoke(token,metadata):undefined
  }

  revokeAccount(accountId) {
    for (const [tokenHash, record] of this.accessTokens.entries()) {
      if (record.account?.id === accountId) this.accessTokens.delete(tokenHash)
    }
    return this.persistent?.revokeAccount(accountId)
  }

  issueConflict(conflict, identity, options = {}) {
    const token = randomToken(40)
    const tokenHash = sha256(token)
    const expiresAt = Date.now() + this.config.auth.sessionTtlMs
    this.conflictTokens.set(tokenHash, { conflictId: conflict.id, identity: safeRegistrationIdentity(identity, this.config.dataHashSecret, options), expiresAt })
    return { conflictToken: token, expiresAt: new Date(expiresAt).toISOString() }
  }

  authenticateConflict(token, conflictId) {
    const tokenHash = token ? sha256(token) : ''
    const record = tokenHash ? this.conflictTokens.get(tokenHash) : null
    if (!record || record.expiresAt <= Date.now() || record.conflictId !== conflictId) {
      if (tokenHash) this.conflictTokens.delete(tokenHash)
      throw authError('账号冲突处理凭证无效或已过期', 'CONFLICT_TOKEN_INVALID')
    }
    return record
  }

  consumeConflict(token) {
    if (token) this.conflictTokens.delete(sha256(token))
  }
}

export function bearerToken(request) {
  const value = request.headers.authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}
