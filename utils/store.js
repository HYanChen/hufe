import { appConfig } from '../config/index'

const guestUser = Object.freeze({
  id: '',
  nickName: '湖财人',
  realName: '',
  initials: '湖财',
  personType: 'guest',
  graduationYear: '',
  college: '',
  department: '',
  major: '',
  city: '',
  verificationStatus: 'unverified',
  schoolIdentityVerified: false,
  alumniStatusVerified: false,
  mustChangePassword: false,
  alumniNo: '',
  studentIdMasked: ''
})

function defaultAuthState() {
  return {
    accessToken: '',
    tokenType: 'Bearer',
    expiresAt: '',
    user: null,
    pendingSession: null,
    registrationVerification: null,
    conflict: null
  }
}

// 实名资料只在当前进程内保留；本地持久化仅保存不透明令牌与登录事务。
// 这样修改 localStorage/uni storage 不能直接伪造“学校实名已验证”的展示状态。
let trustedSessionUser = null
let trustedAccessToken = ''
let trustedValidatedAt = 0

function hasFreshPlatformSession(auth = readAuthState()) {
  return Boolean(auth.accessToken && trustedSessionUser && trustedAccessToken === auth.accessToken
    && Date.now() - trustedValidatedAt <= appConfig.identityFreshTtlMs)
}

function hasFreshTrustedProfile(auth = readAuthState()) {
  const trustedIdentity = trustedSessionUser?.schoolIdentityVerified === true
    || (appConfig.localDevelopment && trustedSessionUser?.localDevelopmentOnly === true)
  return Boolean(
    auth.accessToken
    && trustedAccessToken === auth.accessToken
    && trustedIdentity
    && Date.now() - trustedValidatedAt <= appConfig.identityFreshTtlMs
  )
}

const personTypeLabels = {
  student: '学生',
  faculty: '教师',
  staff: '教职工',
  alumni: '校友',
  member: '湖财成员',
  guest: '未登录'
}

function normalizeSchoolUser(user = {}) {
  const realName = String(user.name || user.realName || '')
  const personType = user.personType || 'member'
  const department = String(user.department || user.college || '')
  return {
    ...guestUser,
    ...user,
    name: realName,
    realName,
    nickName: realName || '湖财人',
    initials: realName ? realName.slice(-2) : '湖财',
    personType,
    personTypeLabel: personTypeLabels[personType] || personTypeLabels.member,
    department,
    college: department,
    verificationStatus: user.schoolIdentityVerified === true ? 'verified' : 'unverified',
    schoolIdentityVerified: user.schoolIdentityVerified === true,
    mustChangePassword: user.mustChangePassword === true,
    alumniStatusVerified: user.alumniStatusVerified === true
  }
}

export function getUser() {
  const auth = readAuthState()
  return hasFreshTrustedProfile(auth) ? normalizeSchoolUser(trustedSessionUser) : { ...guestUser }
}

// 登录与学校实名是两种状态。运营/保安账号可以登录，但不能因此获得校友实名权限。
export function isSignedIn() { return hasFreshPlatformSession() }
export function getPlatformUser() {
  return hasFreshPlatformSession() ? normalizeSchoolUser(trustedSessionUser) : { ...guestUser }
}

export function isVerified() {
  const auth = readAuthState()
  return hasFreshTrustedProfile(auth)
}

export function isSchoolVerified() {
  const auth = readAuthState()
  return hasFreshTrustedProfile(auth) && trustedSessionUser?.schoolIdentityVerified === true
}

export function identityLabel(personType) {
  return personTypeLabels[personType] || personTypeLabels.member
}

export function readAuthState() {
  try {
    const stored = uni.getStorageSync(appConfig.authStorageKey)
    if (!stored || typeof stored !== 'object') return defaultAuthState()
    return { ...defaultAuthState(), ...stored, user: null }
  } catch (error) {
    return defaultAuthState()
  }
}

export function writeAuthState(nextState) {
  const value = { ...defaultAuthState(), ...nextState, user: null }
  uni.setStorageSync(appConfig.authStorageKey, value)
  uni.$emit?.('hufe:auth-changed')
  return value
}

export function savePendingSession(pendingSession) {
  return writeAuthState({ ...readAuthState(), pendingSession })
}

export function saveRegistrationVerification(verification) {
  const auth = readAuthState()
  return writeAuthState({
    ...auth,
    registrationVerification: {
      ...(auth.registrationVerification || {}),
      ...verification
    }
  })
}

export function readRegistrationVerification() {
  return readAuthState().registrationVerification
}

export function clearRegistrationVerification() {
  return writeAuthState({
    ...readAuthState(),
    pendingSession: null,
    registrationVerification: null
  })
}

export function saveAuthenticatedSession(payload) {
  const value = writeAuthState({
    ...readAuthState(),
    accessToken: payload.accessToken,
    tokenType: payload.tokenType || 'Bearer',
    expiresAt: payload.expiresAt || '',
    pendingSession: null,
    registrationVerification: null,
    conflict: null
  })
  trustedAccessToken = value.accessToken
  trustedSessionUser = payload.user || null
  trustedValidatedAt = Date.now()
  return value
}

export function saveConflictSession(conflict, conflictToken, expiresAt = '') {
  trustedAccessToken = ''
  trustedSessionUser = null
  trustedValidatedAt = 0
  return writeAuthState({
    ...readAuthState(),
    accessToken: '',
    user: null,
    pendingSession: null,
    conflict: { ...conflict, conflictToken, expiresAt }
  })
}

export function clearConflictSession() {
  return writeAuthState({ ...readAuthState(), conflict: null })
}

export function updateAuthenticatedUser(user) {
  const auth = readAuthState()
  trustedAccessToken = auth.accessToken
  trustedSessionUser = user || null
  trustedValidatedAt = Date.now()
  return auth
}

export function clearPendingSession() {
  return writeAuthState({ ...readAuthState(), pendingSession: null })
}

export function clearAuthState() {
  trustedAccessToken = ''
  trustedSessionUser = null
  trustedValidatedAt = 0
  uni.removeStorageSync(appConfig.authStorageKey)
  uni.$emit?.('hufe:auth-changed')
  return defaultAuthState()
}

export function invalidateAuthenticatedSession(token, reason = '') {
  if (!token || readAuthState().accessToken !== token) return false
  clearAuthState()
  uni.$emit?.('hufe-auth-changed', { status: 'signed_out', reason })
  if (reason) uni.showToast?.({ title: reason, icon: 'none', duration: 4000 })
  return true
}

export function syncStoredSession() {
  if (trustedAccessToken === readAuthState().accessToken) return
  trustedAccessToken = ''
  trustedSessionUser = null
  trustedValidatedAt = 0
  uni.$emit?.('hufe:auth-changed')
  uni.$emit?.('hufe-auth-changed', { status: 'session_changed' })
}

export function getAccessToken() {
  return readAuthState().accessToken || ''
}

export function clearLocalUiCache() {
  // 兼容清理升级前的本地原型数据；正式业务记录不在客户端持久化。
  uni.removeStorageSync('hufe_alumni_demo_state')
}
