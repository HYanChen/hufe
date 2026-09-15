import { ApiError, request } from './http'
import { getDeviceId } from '../utils/deviceIdentity'
import { isRevokedSession, sessionEndMessage } from '../utils/sessionErrors'
import { initialPasswordError } from '../utils/passwordChange'
import {
  clearAuthState,
  invalidateAuthenticatedSession,
  clearConflictSession,
  clearPendingSession,
  clearRegistrationVerification,
  readAuthState,
  saveAuthenticatedSession,
  saveConflictSession,
  savePendingSession,
  saveRegistrationVerification,
  updateAuthenticatedUser
} from '../utils/store'

let authAttempt = 0
let profileRequest = null
async function ensureCurrentAttempt(version, result) {
  if (version === authAttempt) return
  if (result?.accessToken) await request({ path:'/api/v1/auth/logout', method:'POST', token:result.accessToken }).catch(() => {})
  throw new ApiError('登录操作已被后续操作替代，请使用当前账号', { code:'AUTH_ATTEMPT_SUPERSEDED' })
}

export function currentPlatform() {
  let platform = 'h5'
  // #ifdef MP-WEIXIN
  platform = 'mp-weixin'
  // #endif
  // #ifdef MP-ALIPAY
  platform = 'mp-alipay'
  // #endif
  // #ifdef APP-PLUS
  platform = 'app'
  // #endif
  return platform
}

function browserRegistrationReturnUrl() {
  let returnUrl = ''
  // #ifdef H5
  returnUrl = `${window.location.origin}${window.location.pathname}#/pages/register/index`
  // #endif
  return returnUrl
}

function sessionIdentity(session = {}) {
  return session.sessionId || session.id || ''
}

function registrationToken(result = {}) {
  return result.registrationToken || result.registrationTicket || result.credential || ''
}

function registrationIdentity(result = {}) {
  const source = result.identity
    || result.verifiedIdentity
    || result.schoolIdentity
    || result.profile
    || result.user
    || result.result?.identity
    || null
  if (!source || typeof source !== 'object') return null
  const name = String(source.name || source.realName || source.cn || source.displayName || '').trim()
  const department = String(source.department || source.college || source.dept || source.organization || '').trim()
  return {
    name,
    realName: name,
    department,
    college: department,
    major: String(source.major || ''), className: String(source.className || ''),
    enrollmentYear: String(source.enrollmentYear || ''), graduationYear: String(source.graduationYear || ''),
    expectedGraduationYear: String(source.expectedGraduationYear || ''),
    personType: source.personType || 'member',
    studentIdMasked: String(source.studentIdMasked || ''),
    idCardMasked: String(source.idCardMasked || ''),
    alumniNo: String(source.alumniNo || ''),
    schoolIdentityVerified: source.schoolIdentityVerified === true
  }
}

function configurationError(message = '学校实名校验通道尚未完成正式配置', code = 'REGISTRATION_AUTH_NOT_READY', statusCode = 503) {
  return new ApiError(message, { code, statusCode })
}

export function isRegistrationConfigurationError(error) {
  return [
    'REGISTRATION_AUTH_NOT_READY',
    'SCHOOL_AUTH_CONFIG_CHANGED',
    'REGISTRATION_VERIFICATION_UNAVAILABLE',
    'SSO_NOT_CONFIGURED',
    'CAS_PUBLIC_SERVICE_URL_REQUIRED',
    'CAS_SERVICE_NOT_REGISTERED',
    'AUTH_CONFIGURATION_REQUIRED',
    'OIDC_CONFIGURATION_REQUIRED',
    'REGISTRATION_PLATFORM_BINDING_UNAVAILABLE',
    'REGISTRATION_BROWSER_BINDING_REQUIRED',
    'REGISTRATION_BROWSER_BINDING_MISMATCH'
  ].includes(error?.code)
}

export function isRegistrationPlatformBindingError(error) {
  return error?.code === 'REGISTRATION_PLATFORM_BINDING_UNAVAILABLE'
}

export function isRegistrationBrowserBindingError(error) {
  return ['REGISTRATION_BROWSER_BINDING_REQUIRED', 'REGISTRATION_BROWSER_BINDING_MISMATCH'].includes(error?.code)
}

export function isOfficialRegistrationAuthorizeUrl(authorizeUrl) {
  const value = String(authorizeUrl || '').trim()
  if (!/^https:\/\//i.test(value)) return false
  return !/^https:\/\/(?:localhost|127(?:\.\d+){3}|\[::1\])(?::|\/|$)/i.test(value)
}

function saveRegistrationResult(result, extra = {}) {
  const status = result.status || (registrationToken(result) ? 'registration_verified' : 'pending')
  const currentIdentity = readAuthState().registrationVerification?.identity || null
  return saveRegistrationVerification({
    ...extra,
    status,
    registrationToken: registrationToken(result),
    identity: registrationIdentity(result) || extra.identity || currentIdentity,
    expiresAt: result.expiresAt || extra.expiresAt || '',
    account: result.account || null
  })
}

export function getRegistrationConfiguration() {
  return request({ path: '/api/v1/auth/registration/config', token: '' })
}

export async function createRegistrationVerificationSession() {
  const configuration = await getRegistrationConfiguration()
  if (!configuration.ready) throw configurationError(configuration.message)
  const data = {
    platform: currentPlatform(),
    ...(browserRegistrationReturnUrl() ? { returnUrl: browserRegistrationReturnUrl() } : {})
  }
  const session = await request({
    path: '/api/v1/auth/registration/verification-sessions',
    method: 'POST',
    token: '',
    data
  })
  const platform = currentPlatform()
  const bindingMode = String(session.clientBinding || session.bindingMode || session.binding || '').toLowerCase()
  if (platform !== 'h5' && !['secure-return', 'platform-return', 'universal-link', 'app-link'].includes(bindingMode)) {
    throw configurationError(
      '当前 App / 小程序尚未配置可验证的安全回跳，请改用正式 H5 注册页或联系管理员完成配置',
      'REGISTRATION_PLATFORM_BINDING_UNAVAILABLE',
      400
    )
  }
  const pending = {
    ...session,
    sessionId: sessionIdentity(session),
    kind: 'registration-verification',
    endpoint: 'registration'
  }
  if (session.registrationReady === false || session.configured === false) {
    throw configurationError(session.message || '学校实名校验通道尚未完成正式配置')
  }
  if (!isOfficialRegistrationAuthorizeUrl(pending.authorizeUrl)) {
    throw configurationError('学校统一认证必须使用已登记的正式 HTTPS 回调地址，当前环境已停止跳转')
  }
  savePendingSession(pending)
  saveRegistrationVerification({ ...pending, status: 'pending', registrationToken: '', identity: null })
  return pending
}

export function openRegistrationVerification(authorizeUrl) {
  // #ifdef H5
  window.location.assign(authorizeUrl)
  return
  // #endif

  // #ifdef APP-PLUS
  plus.runtime.openURL(authorizeUrl)
  return
  // #endif

  // #ifdef MP-WEIXIN || MP-ALIPAY
  uni.navigateTo({ url: `/pages/sso-webview/index?url=${encodeURIComponent(authorizeUrl)}` })
  // #endif
}

export async function startRegistrationVerification() {
  clearConflictSession()
  clearRegistrationVerification()
  const session = await createRegistrationVerificationSession()
  openRegistrationVerification(session.authorizeUrl)
  return session
}

export async function resumeRegistrationVerification() {
  const auth = readAuthState()
  const pending = auth.pendingSession || (auth.registrationVerification?.status === 'pending' ? auth.registrationVerification : null)
  if (!pending?.sessionId || !pending?.pollToken) return { status: auth.registrationVerification?.status || 'idle', ...auth.registrationVerification }

  if (currentPlatform() !== 'h5') {
    clearPendingSession()
    clearRegistrationVerification()
    throw configurationError(
      '当前 App / 小程序没有可验证的安全回跳，已停止旧的轮询换票流程',
      'REGISTRATION_PLATFORM_BINDING_UNAVAILABLE',
      400
    )
  }

  const base = '/api/v1/auth/registration/verification-sessions'
  try {
    const result = await request({
      path: `${base}/${encodeURIComponent(pending.sessionId)}`,
      token: pending.pollToken
    })
    if (result.status === 'pending') return result
    if (result.status === 'failed' || result.status === 'expired') {
      clearPendingSession()
      saveRegistrationVerification({ ...pending, status: result.status, error: result.error || null })
      return result
    }
    if (result.status !== 'complete' || !result.exchangeCode) return result

    const exchanged = await request({
      path: '/api/v1/auth/registration/exchange',
      method: 'POST',
      token: pending.pollToken,
      data: { sessionId: pending.sessionId, exchangeCode: result.exchangeCode }
    })
    clearPendingSession()
    if (exchanged.status === 'account_conflict') {
      saveConflictSession(
        { ...(exchanged.conflict || {}), context: 'registration', verifiedIdentity: registrationIdentity(exchanged) },
        exchanged.conflictToken,
        exchanged.expiresAt
      )
      uni.$emit('hufe-registration-changed', { status: 'account_conflict', conflict: exchanged.conflict })
      return exchanged
    }
    saveRegistrationResult(exchanged, { sessionId: pending.sessionId, endpoint: pending.endpoint })
    uni.$emit('hufe-registration-changed', exchanged)
    return exchanged
  } catch (error) {
    if ([
      'SSO_SESSION_NOT_FOUND',
      'SSO_SESSION_EXPIRED',
      'REGISTRATION_SESSION_NOT_FOUND',
      'REGISTRATION_SESSION_EXPIRED',
      'UNAUTHORIZED',
      'SCHOOL_AUTH_CONFIG_CHANGED',
      'REGISTRATION_AUTH_NOT_READY',
      'REGISTRATION_BROWSER_BINDING_REQUIRED',
      'REGISTRATION_BROWSER_BINDING_MISMATCH'
    ].includes(error.code)) {
      clearPendingSession()
    }
    if (isRegistrationBrowserBindingError(error) || ['SCHOOL_AUTH_CONFIG_CHANGED', 'REGISTRATION_AUTH_NOT_READY'].includes(error.code)) clearRegistrationVerification()
    throw error
  }
}

export async function loginPlatformAccount({ username, password }) {
  const attempt = ++authAttempt
  const result = await request({
    path: '/api/v1/auth/login',
    method: 'POST',
    token: '',
    data: { username: String(username || '').trim(), password: String(password || ''), deviceId:getDeviceId() }
  })
  await ensureCurrentAttempt(attempt, result)
  if (result.status === 'account_conflict') {
    saveConflictSession(
      { ...(result.conflict || {}), context: 'login' },
      result.conflictToken,
      result.expiresAt
    )
    uni.$emit('hufe-auth-changed', { status: 'account_conflict', conflict: result.conflict })
    return result
  }
  saveAuthenticatedSession(result)
  uni.$emit('hufe-auth-changed', { status: 'authenticated', user: result.user })
  return result
}

export async function registerPlatformAccount({ username, password, registrationToken: token }) {
  const attempt = ++authAttempt
  const result = await request({
    path: '/api/v1/auth/register',
    method: 'POST',
    token: '',
    data: {
      username: String(username || '').trim(),
      password: String(password || ''),
      registrationToken: token,
      registrationTicket: token,
      deviceId:getDeviceId()
    }
  })
  await ensureCurrentAttempt(attempt, result)
  if (result.status === 'account_conflict') {
    saveConflictSession(
      { ...(result.conflict || {}), context: 'registration' },
      result.conflictToken,
      result.expiresAt
    )
    uni.$emit('hufe-registration-changed', { status: 'account_conflict', conflict: result.conflict })
    return result
  }
  clearRegistrationVerification()
  clearConflictSession()
  if (result.accessToken) {
    saveAuthenticatedSession(result)
    uni.$emit('hufe-auth-changed', { status: 'authenticated', user: result.user })
  }
  return result
}

export async function refreshPlatformProfile() {
  const auth = readAuthState()
  if (!auth.accessToken) return null
  if (profileRequest?.token === auth.accessToken) return profileRequest.promise
  const task = {token:auth.accessToken,promise:null}
  task.promise = loadPlatformProfile(auth).finally(() => { if(profileRequest === task) profileRequest = null })
  profileRequest = task
  return task.promise
}

async function loadPlatformProfile(auth) {
  try {
    const user = await request({ path: '/api/v1/me', token: auth.accessToken })
    if (readAuthState().accessToken !== auth.accessToken) return null
    updateAuthenticatedUser(user)
    uni.$emit('hufe-auth-changed', { status: 'authenticated', user })
    return user
  } catch (error) {
    if (isRevokedSession(error)) {
      if (readAuthState().accessToken !== auth.accessToken) return null
      invalidateAuthenticatedSession(auth.accessToken, sessionEndMessage(error))
      return null
    }
    throw error
  }
}

export async function resolveAccountConflict({ action, keepAccountId = '' }) {
  const attempt = ++authAttempt
  const auth = readAuthState()
  const conflict = auth.conflict
  if (!conflict?.id || !conflict?.conflictToken) throw new Error('冲突处理凭证不存在，请重新发起注册实名校验')
  const confirmation = action === 'keep_existing' ? '确认注销多余账号' : '确认注销全部旧账号并新注册'
  const registrationContext = conflict.context === 'registration'
  const conflictBase = registrationContext ? '/api/v1/auth/registration/conflicts' : '/api/v1/auth/conflicts'
  const result = await request({
    path: `${conflictBase}/${encodeURIComponent(conflict.id)}/resolve`,
    method: 'POST',
    token: conflict.conflictToken,
    data: { action, ...(keepAccountId ? { keepAccountId } : {}), confirmation, deviceId:getDeviceId() }
  })
  await ensureCurrentAttempt(attempt, result)
  clearConflictSession()
  if (!registrationContext && result.accessToken) {
    saveAuthenticatedSession(result)
    uni.$emit('hufe-auth-changed', { status: 'authenticated', user: result.user })
    return result
  }
  if (result.status === 'account_kept') {
    clearRegistrationVerification()
    uni.$emit('hufe-registration-changed', result)
    return result
  }
  saveRegistrationResult(result, { identity: registrationIdentity(conflict) })
  uni.$emit('hufe-registration-changed', result)
  return result
}

export async function logoutPlatformAccount() {
  const auth = readAuthState()
  authAttempt++
  clearAuthState()
  uni.$emit('hufe-auth-changed', { status: 'signed_out' })
  try {
    if (auth.accessToken) await request({ path: '/api/v1/auth/logout', method: 'POST', token:auth.accessToken })
  } catch (error) {
    // 服务端不可用时仍清理本地令牌，已签发令牌依赖服务端到期或撤销。
  }
}

export async function changeInitialPassword({ currentPassword, newPassword, confirmPassword, token }) {
  const validation = initialPasswordError({ currentPassword, newPassword, confirmPassword })
  if (validation) throw new ApiError(validation, { code: 'PASSWORD_VALIDATION_FAILED' })
  if (!token || readAuthState().accessToken !== token) throw new ApiError('登录账号已变化，请重新进入修改密码页面', { code: 'AUTH_SESSION_CHANGED' })
  const result = await request({
    path: '/api/v1/auth/change-password', method: 'POST', token,
    data: { currentPassword, newPassword }
  })
  if (readAuthState().accessToken !== token) throw new ApiError('登录账号已变化，请使用当前账号继续操作', { code: 'AUTH_SESSION_CHANGED' })
  if (result?.passwordChanged !== true || result?.loginRequired !== true) throw new ApiError('未收到密码修改确认，请重新登录后确认状态', { code: 'PASSWORD_CHANGE_UNCONFIRMED' })
  return result
}

export function completeInitialPasswordChange(token) {
  if (!token || readAuthState().accessToken !== token) return false
  authAttempt++
  clearAuthState()
  uni.$emit('hufe-auth-changed', { status: 'signed_out', reason: 'password_changed' })
  return true
}

export async function deactivatePlatformAccount() {
  const auth = readAuthState()
  if (!auth.accessToken) return
  await request({ path: '/api/v1/me', method: 'DELETE', data: { confirmation: '确认注销账号' } })
  clearAuthState()
  uni.$emit('hufe-auth-changed', { status: 'signed_out' })
}

// 保留旧导出名，避免尚未迁移的业务页面在过渡期构建失败。
export const refreshSchoolProfile = refreshPlatformProfile
export const logoutSchoolAccount = logoutPlatformAccount
export const deactivateSchoolAccount = deactivatePlatformAccount
