import { auditRecord } from '../audit/metadata.js'
import { educationSnapshot } from './profile.js'
import {sealStudentNumber} from './student-number.js'
import {readSensitiveIdentityRaw} from '../auth/identity.js'
import { filterAccounts, accountFilterOptions } from './filters.js'
import { randomUUID } from 'node:crypto'
import { hashPassword, hmac, verifyPassword } from '../auth/crypto.js'

// 对不存在的用户名也执行一次同等成本的 scrypt 校验，降低账号枚举的时序差异。
const dummyPasswordHash = hashPassword(randomUUID())

function now() { return new Date().toISOString() }

function serviceError(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode })
}

function maskName(name = '') {
  if (!name) return '湖财用户'
  if (name.length === 1) return `${name}*`
  return `${name[0]}${'*'.repeat(Math.min(2, name.length - 1))}`
}

function maskStudentId(studentId = '') {
  const value = String(studentId || '')
  if (!value) return ''
  if (value.length <= 4) return '****'
  return `${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase()
}

export function validatePassword(password, field = '密码') {
  const value = String(password || '')
  const passwordBytes = Buffer.byteLength(value, 'utf8')
  if (value.length < 8 || passwordBytes > 128) throw serviceError(`${field}长度须为 8-128 字节`, 'INVALID_PASSWORD', 400)
  return value
}

function validateCredentials({ username, password } = {}) {
  const displayUsername = String(username || '').trim()
  const passwordValue = validatePassword(password)
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{3,31}$/.test(displayUsername)) {
    throw serviceError('用户名须为 4-32 位字母、数字、下划线、点或连字符，且须以字母、数字或下划线开头', 'INVALID_USERNAME', 400)
  }
  return { username: displayUsername, usernameNormalized: normalizeUsername(displayUsername), password: passwordValue }
}

// 登录兼容已存在的中文平台用户名；不改变新注册用户名规则或正式密码强度。
function validateLoginCredentials({ username, password } = {}) {
  const displayUsername = String(username || '').trim()
  const passwordValue = validatePassword(password)
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_.-]{1,31}$/u.test(displayUsername)) {
    throw serviceError('请输入有效的平台用户名', 'INVALID_USERNAME', 400)
  }
  return { username: displayUsername, usernameNormalized: normalizeUsername(displayUsername), password: passwordValue }
}

// 仅供本机 development 演示账号使用。正式注册、运营账号和生产环境仍使用上面的强规则。
function validateDevelopmentCredentials({ username, password } = {}) {
  const displayUsername = String(username || '').trim()
  const passwordValue = String(password || '')
  const passwordBytes = Buffer.byteLength(passwordValue, 'utf8')
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_.-]{1,31}$/u.test(displayUsername)) {
    throw serviceError('本地演示用户名须为 2-32 位文字、字母、数字、下划线、点或连字符', 'INVALID_USERNAME', 400)
  }
  if ((!/^\d{6}$/.test(passwordValue) && passwordValue.length < 8) || passwordBytes > 128) {
    throw serviceError('本地演示密码须为 6 位数字或 8-128 字节密码', 'INVALID_PASSWORD', 400)
  }
  return { username: displayUsername, usernameNormalized: normalizeUsername(displayUsername), password: passwordValue }
}

function identitySnapshot(identity) {
  return {
    name: identity.name || '湖财用户',
    personType: identity.personType || 'member',
    department: identity.department || '',
    ...educationSnapshot(identity),
    studentIdMasked: identity.studentIdMasked || maskStudentId(identity.studentId),
    studentIdKey: identity.studentIdKey || '',
    idCardMasked: identity.idCardMasked || '',
    idCardKey: identity.idCardKey || '',
    idCardVerified: Boolean(identity.idCardVerified),
    alumniNo: identity.alumniNo || '',
    alumniStatusVerified: Boolean(identity.alumniStatusVerified),
    verificationSource: identity.verificationSource,
    isAdmin: Boolean(identity.isAdmin)
  }
}

function accountMatchesIdentity(account, subjectKey, identity = {}) {
  if (account.schoolSubjectKey === subjectKey) return true
  if (identity.idCardKey && account.idCardKey && account.idCardKey === identity.idCardKey) return true
  return Boolean(identity.studentIdKey && account.studentIdKey && account.studentIdKey === identity.studentIdKey)
}

function accountsForIdentity(data, subjectKey, identity = {}) {
  return data.accounts.filter((account) => accountMatchesIdentity(account, subjectKey, identity))
}

function accountFromRegistration(identity, subjectKey, credentials, passwordHash, secret) {
  const timestamp = now()
  const snapshot = identitySnapshot(identity)
  return {
    id: randomUUID(),
    username: credentials.username,
    usernameNormalized: credentials.usernameNormalized,
    passwordHash,
    schoolSubjectKey: subjectKey,
    status: 'active',
    accountSource: identity.accountSource || 'school_registered',
    mustChangePassword: Boolean(identity.mustChangePassword),
    ...snapshot,
    studentIdSealed: identity.studentIdSealed || sealStudentNumber(readSensitiveIdentityRaw(identity).studentId || identity.studentId, secret),
    schoolIdentityVerified: true,
    schoolIdentityVerifiedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: null,
    deactivatedAt: null,
    deactivatedReason: null
  }
}

function publicAccount(account) {
  const { schoolSubjectKey, usernameNormalized, passwordHash, idCardKey, studentIdKey, studentIdDisplay, studentIdSealed, personalProfile, profileRevision, profileUpdatedAt, educationSupplement, ...safe } = account
  return { ...safe, revision: Number(account.accountRevision || 0), credentialRevision: Number(account.credentialRevision || 0), source: account.accountSource === 'admin_provisioned' ? 'admin_created' : (account.accountSource || 'school_registered') }
}

function conflictAccount(account) {
  return {
    id: account.id,
    maskedName: maskName(account.name),
    maskedUsername: account.username ? `${String(account.username).slice(0, 2)}***` : '',
    personType: account.personType,
    department: account.department,
    studentIdMasked: account.studentIdMasked,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt
  }
}

function assertSuperAdminDeactivation(data, accountIds, metadata = {}) {
  const targetIds = new Set(accountIds)
  const superTargets = data.accounts.filter((account) => targetIds.has(account.id) && account.status === 'active' && account.isAdmin)
  if (!superTargets.length) return
  const remaining = data.accounts.filter((account) => account.status === 'active' && account.isAdmin && !targetIds.has(account.id))
  if (!remaining.length) throw serviceError('不能停用或注销最后一个超级管理员', 'LAST_SUPER_ADMIN', 409)
  const actor = data.accounts.find((account) => account.id === metadata.actor && account.status === 'active' && account.isAdmin)
  if (!actor || targetIds.has(actor.id)) throw serviceError('超级管理员不能通过自助流程注销自身权限', 'SUPER_ADMIN_SELF_DEACTIVATION_FORBIDDEN', 409)
}

export class AccountService {
  constructor(database, config) {
    this.database = database
    this.config = config
  }

  authenticatedAccount(account) {
    const safe = publicAccount(account)
    if (
      this.config.env === 'development'
      && account.localDevelopmentOnly === true
      && account.developmentSchoolIdentityFixture === true
    ) {
      return { ...safe, studentIdDisplay: String(account.studentIdDisplay || '') }
    }
    return safe
  }

  subjectKey(subject) {
    return hmac(subject, this.config.dataHashSecret)
  }

  ensureOpenConflict(data, subjectKey, active, identity) {
    let conflict = data.identityConflicts.find((item) => item.schoolSubjectKey === subjectKey && item.status === 'open')
    if (!conflict) {
      conflict = {
        id: randomUUID(),
        schoolSubjectKey: subjectKey,
        accountIds: active.map((account) => account.id),
        identitySnapshot: identitySnapshot(identity),
        status: 'open',
        createdAt: now(),
        resolvedAt: null,
        resolution: null
      }
      data.identityConflicts.push(conflict)
    } else {
      conflict.accountIds = active.map((account) => account.id)
      conflict.identitySnapshot = identitySnapshot(identity)
    }
    return conflict
  }

  async checkRegistrationEligibility(identity, metadata = {}) {
    if (!identity?.schoolSubject) throw serviceError('学校身份结果缺少稳定标识', 'SCHOOL_SUBJECT_MISSING', 502)
    const subjectKey = this.subjectKey(identity.schoolSubject)
    return this.database.transaction((data) => {
      const sameIdentity = accountsForIdentity(data, subjectKey, identity)
      const active = sameIdentity.filter((account) => account.status === 'active')

      if (active.length === 0) {
        if (sameIdentity.some((account) => account.status === 'suspended')) {
          data.auditLogs.unshift(this.audit('registration.suspended_identity_blocked', subjectKey.slice(0, 16), metadata, {}))
          throw serviceError('该学校身份对应账号已被暂停，请联系管理员处理', 'ACCOUNT_SUSPENDED', 403)
        }
        data.auditLogs.unshift(this.audit('registration.identity_verified', subjectKey.slice(0, 16), metadata, { activeAccountCount: 0 }))
        return { status: 'registration_verified', identity }
      }

      if (active.length === 1) {
        const education=educationSnapshot(identity)
        if(Object.keys(education).length){Object.assign(active[0],education,{educationSyncedAt:now()});data.auditLogs.unshift(this.audit('account.education_synced',active[0].id,metadata,{fields:Object.keys(education)}))}
        data.auditLogs.unshift(this.audit('registration.account_exists', active[0].id, metadata, {}))
        return { status: 'account_exists' }
      }

      const conflict = this.ensureOpenConflict(data, subjectKey, active, identity)
      data.auditLogs.unshift(this.audit('identity.duplicate_blocked', conflict.id, metadata, { accountCount: active.length, context: 'registration' }))
      return { status: 'account_conflict', conflict: this.publicConflict(conflict, active), identity }
    })
  }

  // 旧内部调用名保留，但语义已改为“注册资格校验”，不会创建账号或登录。
  async reconcile(identity, metadata = {}) {
    return this.checkRegistrationEligibility(identity, metadata)
  }

  async register(identity, input, metadata = {}) {
    if (!identity?.schoolSubject) throw serviceError('注册校验凭证缺少学校身份', 'REGISTRATION_IDENTITY_INVALID', 401)
    const credentials = validateCredentials(input)
    const subjectKey = this.subjectKey(identity.schoolSubject)
    const passwordHash = await hashPassword(credentials.password)

    const result = await this.database.transaction((data) => {
      if (data.accounts.some((account) => account.usernameNormalized === credentials.usernameNormalized)) {
        throw serviceError('该用户名已被使用', 'USERNAME_TAKEN', 409)
      }
      const sameIdentity = accountsForIdentity(data, subjectKey, identity)
      const active = sameIdentity.filter((account) => account.status === 'active')
      if (active.length === 1) throw serviceError('该学校身份已注册，请使用平台账号登录或找回密码', 'ACCOUNT_EXISTS', 409)
      if (active.length > 1) {
        const conflict = this.ensureOpenConflict(data, subjectKey, active, identity)
        data.auditLogs.unshift(this.audit('identity.duplicate_blocked', conflict.id, metadata, { accountCount: active.length, context: 'register-submit' }))
        return { blockedByConflict: true }
      }
      if (sameIdentity.some((account) => account.status === 'suspended')) {
        throw serviceError('该学校身份对应账号已被暂停，请联系管理员处理', 'ACCOUNT_SUSPENDED', 403)
      }

      const account = accountFromRegistration(identity, subjectKey, credentials, passwordHash, this.config.dataHashSecret)
      data.accounts.push(account)
      data.auditLogs.unshift(this.audit('account.registered', account.id, metadata, { personType: account.personType }))
      return { account: publicAccount(account) }
    })
    if (result.blockedByConflict) throw serviceError('该学校身份存在多个有效账号，请先注销多余账号', 'ACCOUNT_CONFLICT', 409)
    return result.account
  }

  async createDevelopmentAdmin(input, metadata = {}) {
    if (this.config.env !== 'development') {
      throw serviceError('本地演示管理员初始化仅允许在 development 环境执行', 'DEV_ADMIN_BOOTSTRAP_DISABLED', 403)
    }
    const credentials = validateCredentials(input)
    const passwordHash = await hashPassword(credentials.password)
    const schoolSubject = `local-development-admin:${credentials.usernameNormalized}`
    const subjectKey = this.subjectKey(schoolSubject)

    return this.database.transaction((data) => {
      if (data.accounts.some((account) => account.usernameNormalized === credentials.usernameNormalized)) {
        throw serviceError('本地演示管理员用户名已存在，拒绝覆盖密码', 'USERNAME_TAKEN', 409)
      }
      const account = accountFromRegistration({
        schoolSubject,
        name: String(input.name || '本地演示管理员').trim() || '本地演示管理员',
        personType: 'staff',
        department: '本地开发环境',
        alumniStatusVerified: false,
        verificationSource: 'local-development-bootstrap',
        isAdmin: true
      }, subjectKey, credentials, passwordHash)
      Object.assign(account, {
        schoolIdentityVerified: false,
        schoolIdentityVerifiedAt: null,
        localDevelopmentOnly: true
      })
      data.accounts.push(account)
      data.auditLogs.unshift(this.audit('account.local_dev_admin_created', account.id, metadata, { username: account.username }))
      return publicAccount(account)
    })
  }

  async createDevelopmentUser(input, metadata = {}) {
    if (this.config.env !== 'development') {
      throw serviceError('本地演示用户初始化仅允许在 development 环境执行', 'DEV_USER_BOOTSTRAP_DISABLED', 403)
    }
    const credentials = validateDevelopmentCredentials(input)
    const passwordHash = await hashPassword(credentials.password)
    const schoolSubject = `local-development-user:${credentials.usernameNormalized}`
    const subjectKey = this.subjectKey(schoolSubject)

    return this.database.transaction((data) => {
      if (data.accounts.some((account) => account.usernameNormalized === credentials.usernameNormalized)) {
        throw serviceError('本地演示用户名已存在，拒绝覆盖密码', 'USERNAME_TAKEN', 409)
      }
      const account = accountFromRegistration({
        schoolSubject,
        name: String(input.name || credentials.username).trim() || credentials.username,
        personType: 'member',
        department: String(input.department || '本地演示环境').trim() || '本地演示环境',
        accountSource: 'admin_provisioned',
        alumniStatusVerified: false,
        verificationSource: 'local-development-user',
        isAdmin: false
      }, subjectKey, credentials, passwordHash)
      Object.assign(account, {
        schoolIdentityVerified: false,
        schoolIdentityVerifiedAt: null,
        localDevelopmentOnly: true,
        accountSource: 'admin_provisioned',
        mustChangePassword: false,
        isAdmin: false
      })
      data.accounts.push(account)
      data.auditLogs.unshift(this.audit('account.local_dev_user_created', account.id, metadata, { username: account.username }))
      return publicAccount(account)
    })
  }

  async provisionOperator(input, metadata = {}) {
    const credentials = validateCredentials({ username: input.username, password: input.temporaryPassword })
    if (input.accountType && input.accountType !== 'operations') throw serviceError('仅支持创建平台运营账号', 'INVALID_ACCOUNT_TYPE', 400)
    const name = String(input.displayName || input.name || '').trim()
    const department = String(input.department || '').trim()
    if (!name) throw serviceError('请填写账号姓名', 'ACCOUNT_NAME_REQUIRED', 400)
    if (!department) throw serviceError('请填写所属部门', 'ACCOUNT_DEPARTMENT_REQUIRED', 400)
    const passwordHash = await hashPassword(credentials.password)
    const internalSubject = `admin-provisioned:${randomUUID()}`
    const subjectKey = this.subjectKey(internalSubject)
    return this.database.transaction((data) => {
      if (data.accounts.some((account) => account.usernameNormalized === credentials.usernameNormalized)) throw serviceError('该用户名已被使用', 'USERNAME_TAKEN', 409)
      const account = accountFromRegistration({
        schoolSubject: internalSubject, name, department, personType: 'staff', accountSource: 'admin_provisioned',
        mustChangePassword: true, alumniStatusVerified: false, verificationSource: 'admin-provisioned-operator', isAdmin: false
      }, subjectKey, credentials, passwordHash)
      Object.assign(account, { schoolIdentityVerified: false, schoolIdentityVerifiedAt: null, accountSource: 'admin_provisioned', mustChangePassword: true, isAdmin: false })
      data.accounts.push(account)
      data.auditLogs.unshift(this.audit('account.admin_provisioned', account.id, metadata, { username: account.username, department }))
      return publicAccount(account)
    })
  }

  async login(input, metadata = {}) {
    const usernameNormalized = normalizeUsername(input?.username)
    const candidate = this.database.read((data) => data.accounts.find((account) => account.usernameNormalized === usernameNormalized))
    if (candidate?.localDevelopmentOnly && this.config.env !== 'development') {
      const passwordHash = candidate.passwordHash || await dummyPasswordHash
      await verifyPassword(String(input?.password || ''), passwordHash)
      throw serviceError('用户名或密码错误', 'INVALID_CREDENTIALS', 401)
    }
    let credentials
    try {
      credentials = validateLoginCredentials(input)
    } catch (error) {
      if (this.config.env !== 'development' || !candidate?.localDevelopmentOnly) throw error
      credentials = validateDevelopmentCredentials(input)
    }
    const passwordHash = candidate?.passwordHash || await dummyPasswordHash
    const passwordValid = await verifyPassword(credentials.password, passwordHash)
    if (!candidate?.passwordHash || !passwordValid) {
      throw serviceError('用户名或密码错误', 'INVALID_CREDENTIALS', 401)
    }

    const result = await this.database.transaction((data) => {
      const account = data.accounts.find((item) => item.id === candidate.id)
      if (account?.passwordHash !== passwordHash) throw serviceError('密码已更新，请使用新密码重新登录', 'CREDENTIALS_CHANGED', 401)
      if (!account || account.status === 'deactivated') throw serviceError('账号已注销', 'ACCOUNT_INACTIVE', 403)
      if (account.status === 'suspended') throw serviceError('账号已暂停，请联系管理员', 'ACCOUNT_SUSPENDED', 403)
      const active = accountsForIdentity(data, account.schoolSubjectKey, account).filter((item) => item.status === 'active')
      if (active.length !== 1 || active[0].id !== account.id) {
        if (active.length > 1) {
          const conflict = this.ensureOpenConflict(data, account.schoolSubjectKey, active, account)
          data.auditLogs.unshift(this.audit('identity.duplicate_blocked', conflict.id, metadata, { accountCount: active.length, context: 'local-login' }))
        }
        return { blockedByConflict: true }
      }
      account.lastLoginAt = now()
      account.updatedAt = now()
      data.auditLogs.unshift(this.audit('account.local_login', account.id, metadata, { uniqueness: 'unique' }))
      return { account: this.authenticatedAccount(account) }
    })
    if (result.blockedByConflict) throw serviceError('该学校身份账号不唯一，请先处理多余账号', 'ACCOUNT_CONFLICT', 409)
    return result.account
  }

  async changePassword(id, currentPassword, newPassword, metadata = {}) {
    const next = validatePassword(newPassword, '新密码')
    if (String(currentPassword || '') === next) throw serviceError('新密码不能与当前密码相同', 'PASSWORD_UNCHANGED', 400)
    const candidate = this.database.read((data) => data.accounts.find((item) => item.id === id && item.status === 'active'))
    if (!candidate?.passwordHash || !(await verifyPassword(String(currentPassword || ''), candidate.passwordHash))) {
      throw serviceError('当前密码错误', 'CURRENT_PASSWORD_INVALID', 401)
    }
    const passwordHash = await hashPassword(next)
    return this.database.transaction((data) => {
      const account = data.accounts.find((item) => item.id === id && item.status === 'active')
      if (!account) throw serviceError('账号不存在或不可用', 'ACCOUNT_NOT_FOUND', 404)
      if (account.passwordHash !== candidate.passwordHash) throw serviceError('密码已在其他页面更新，请重新登录', 'CREDENTIALS_CHANGED', 409)
      account.passwordHash = passwordHash
      account.accountRevision = Number(account.accountRevision || 0) + 1
      account.credentialRevision = Number(account.credentialRevision || 0) + 1
      account.mustChangePassword = false
      account.passwordChangedAt = now()
      account.updatedAt = account.passwordChangedAt
      data.auditLogs.unshift(this.audit('account.password_changed', account.id, metadata, { mustChangePassword: false }))
      return publicAccount(account)
    })
  }

  async resolveConflict(conflictId, input, metadata = {}) {
    return this.database.transaction((data) => {
      const conflict = data.identityConflicts.find((item) => item.id === conflictId && item.status === 'open')
      if (!conflict) throw serviceError('账号冲突不存在或已处理', 'CONFLICT_NOT_OPEN', 404)
      const accounts = data.accounts.filter((account) => conflict.accountIds.includes(account.id) && account.status === 'active')
      if (accounts.length < 2) throw serviceError('有效账号已不足两个，请重新进行注册身份校验', 'CONFLICT_CHANGED', 409)

      let keptAccount = null
      let action = input.action
      if (action === 'keep_existing') {
        if (input.confirmation !== '确认注销多余账号') throw serviceError('请完成注销确认', 'CONFIRMATION_REQUIRED', 400)
        keptAccount = accounts.find((item) => item.id === input.keepAccountId)
        if (!keptAccount) throw serviceError('要保留的账号不属于本次冲突', 'INVALID_KEEP_ACCOUNT', 400)
        assertSuperAdminDeactivation(data, accounts.filter((item) => item.id !== keptAccount.id).map((item) => item.id), metadata)
        const verifiedSnapshot = conflict.identitySnapshot || {}
        Object.assign(keptAccount, {
          ...educationSnapshot(verifiedSnapshot),
          name: verifiedSnapshot.name || keptAccount.name,
          personType: verifiedSnapshot.personType || keptAccount.personType,
          department: verifiedSnapshot.department || keptAccount.department,
          studentIdMasked: verifiedSnapshot.studentIdMasked || keptAccount.studentIdMasked,
          studentIdKey: verifiedSnapshot.studentIdKey || keptAccount.studentIdKey,
          idCardMasked: verifiedSnapshot.idCardMasked || keptAccount.idCardMasked,
          idCardKey: verifiedSnapshot.idCardKey || keptAccount.idCardKey,
          idCardVerified: Boolean(verifiedSnapshot.idCardVerified),
          alumniNo: verifiedSnapshot.alumniNo || keptAccount.alumniNo,
          schoolIdentityVerified: true,
          schoolIdentityVerifiedAt: now(),
          alumniStatusVerified: Boolean(verifiedSnapshot.alumniStatusVerified),
          verificationSource: verifiedSnapshot.verificationSource || keptAccount.verificationSource,
          updatedAt: now()
        })
        for (const item of accounts) {
          if (item.id === keptAccount.id) continue
          item.status = 'deactivated'
          item.credentialRevision = Number(item.credentialRevision || 0) + 1
          item.deactivatedAt = now()
          item.deactivatedReason = 'duplicate-account-resolution'
          item.updatedAt = now()
        }
      } else if (action === 'recreate' || action === 'deactivate_all') {
        const confirmations = ['确认注销全部旧账号并新注册', '确认注销全部旧账号']
        if (!confirmations.includes(input.confirmation)) throw serviceError('请完成全部旧账号注销确认', 'CONFIRMATION_REQUIRED', 400)
        action = 'recreate'
        assertSuperAdminDeactivation(data, accounts.map((item) => item.id), metadata)
        for (const item of accounts) {
          item.status = 'deactivated'
          item.credentialRevision = Number(item.credentialRevision || 0) + 1
          item.deactivatedAt = now()
          item.deactivatedReason = 'duplicate-account-recreated'
          item.updatedAt = now()
        }
      } else {
        throw serviceError('不支持的冲突处理方式', 'INVALID_RESOLUTION', 400)
      }

      conflict.status = 'resolved'
      conflict.resolvedAt = now()
      conflict.resolution = { action, keepAccountId: keptAccount?.id || null, actor: metadata.actor || 'self-service' }
      data.auditLogs.unshift(this.audit('identity.duplicate_resolved', conflict.id, metadata, conflict.resolution))
      return action === 'keep_existing'
        ? { status: 'account_kept', loginRequired: true, account: publicAccount(keptAccount) }
        : { status: 'registration_required', registrationRequired: true }
    })
  }

  publicConflict(conflict, accounts) {
    return {
      id: conflict.id,
      status: conflict.status,
      accountCount: accounts.length,
      accounts: accounts.map(conflictAccount),
      createdAt: conflict.createdAt
    }
  }

  listAccounts(input = {}) {
    const all = this.database.read(data => data.accounts)
    const items = filterAccounts(all, input, this.config.dataHashSecret)
    const page = Math.max(1, Math.floor(Number(input.page) || 1))
    const size = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 20)))
    const start = (page - 1) * size
    return { items: items.slice(start, start + size).map(publicAccount), total: items.length, page, pageSize: size, filterOptions: accountFilterOptions(all, input) }
  }

  getActiveAccount(id) {
    const account = this.database.read((data) => data.accounts.find((item) => item.id === id))
    if (!account || account.status !== 'active') return null
    return this.authenticatedAccount(account)
  }

  async setAccountStatus(id, status, metadata = {}) {
    if (!['active', 'suspended', 'deactivated'].includes(status)) throw serviceError('不支持的账号状态', 'INVALID_ACCOUNT_STATUS', 400)
    return this.database.transaction((data) => {
      const account = data.accounts.find((item) => item.id === id)
      if (!account) throw serviceError('账号不存在', 'ACCOUNT_NOT_FOUND', 404)
      if (status !== 'active') assertSuperAdminDeactivation(data, [id], metadata)
      if (metadata.actor === id) throw serviceError('不能变更当前登录账号自身状态', 'SELF_ACCOUNT_STATUS_CHANGE', 409)
      if (status === 'active') {
        const duplicate = accountsForIdentity(data, account.schoolSubjectKey, account)
          .find((item) => item.id !== id && item.status === 'active')
        if (duplicate) throw serviceError('该学校身份已存在其他有效账号，不能直接启用', 'ACCOUNT_UNIQUENESS_CONFLICT', 409)
      }
      account.status = status
      account.credentialRevision = Number(account.credentialRevision || 0) + 1
      account.accountRevision = Number(account.accountRevision || 0) + 1
      account.updatedAt = now()
      account.deactivatedAt = status === 'deactivated' ? now() : null
      account.deactivatedReason = status === 'deactivated' ? 'admin-action' : null
      if (status !== 'active' && Array.isArray(data.adminDelegations)) {
        for (const grant of data.adminDelegations.filter((item) => item.accountId === id && item.status === 'active')) {
          grant.status = 'revoked'; grant.revokedAt = now(); grant.updatedAt = grant.revokedAt; grant.revokedBy = metadata.actor || 'system'; grant.revokeReason = 'account-status-changed'; grant.revision = Number(grant.revision || 0) + 1
        }
      }
      data.auditLogs.unshift(this.audit('account.status_changed', account.id, metadata, { status }))
      return publicAccount(account)
    })
  }

  async deactivateSelf(id, confirmation, metadata = {}) {
    if (confirmation !== '确认注销账号') throw serviceError('请完成账号注销确认', 'CONFIRMATION_REQUIRED', 400)
    return this.database.transaction((data) => {
      const account = data.accounts.find((item) => item.id === id && item.status === 'active')
      if (!account) throw serviceError('有效账号不存在', 'ACCOUNT_NOT_FOUND', 404)
      assertSuperAdminDeactivation(data, [id], metadata)
      account.status = 'deactivated'
      account.credentialRevision = Number(account.credentialRevision || 0) + 1
      account.accountRevision = Number(account.accountRevision || 0) + 1
      account.deactivatedAt = now()
      account.deactivatedReason = 'self-service'
      account.updatedAt = now()
      if (Array.isArray(data.adminDelegations)) {
        for (const grant of data.adminDelegations.filter((item) => item.accountId === id && item.status === 'active')) {
          grant.status = 'revoked'; grant.revokedAt = now(); grant.updatedAt = grant.revokedAt; grant.revokedBy = id; grant.revokeReason = 'account-self-deactivated'; grant.revision = Number(grant.revision || 0) + 1
        }
      }
      data.auditLogs.unshift(this.audit('account.self_deactivated', account.id, metadata, {}))
      return publicAccount(account)
    })
  }

  listConflicts({ status = 'open' } = {}) {
    return this.database.read((data) => data.identityConflicts
      .filter((conflict) => !status || conflict.status === status)
      .map((conflict) => this.publicConflict(conflict, data.accounts.filter((account) => conflict.accountIds.includes(account.id)))))
  }

  auditLogs(limit = 100) {
    return this.database.read((data) => data.auditLogs.slice(0, Math.min(500, Math.max(1, Number(limit) || 100))))
  }

  dashboard() {
    return this.database.read((data) => ({
      accounts: data.accounts.length,
      activeAccounts: data.accounts.filter((item) => item.status === 'active').length,
      schoolVerifiedAccounts: data.accounts.filter((item) => item.status === 'active' && item.schoolIdentityVerified).length,
      operationsAccounts: data.accounts.filter((item) => item.status === 'active' && !item.schoolIdentityVerified).length,
      students: data.accounts.filter((item) => item.status === 'active' && item.schoolIdentityVerified && item.personType === 'student').length,
      facultyAndStaff: data.accounts.filter((item) => item.status === 'active' && item.schoolIdentityVerified && ['faculty', 'staff'].includes(item.personType)).length,
      alumni: data.accounts.filter((item) => item.status === 'active' && item.schoolIdentityVerified && item.personType === 'alumni').length,
      openConflicts: data.identityConflicts.filter((item) => item.status === 'open').length
    }))
  }

  audit(action, targetId, metadata, details) { return auditRecord(action, targetId, metadata, details) }
}
