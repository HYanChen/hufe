import { computed, reactive } from 'vue'
import { api, accessToken, saveAccessToken } from './api.js'
import { getDeviceId } from '../../../utils/deviceIdentity.js'
import { isRevokedSession } from '../../../utils/sessionErrors.js'

let bootstrapPromise = null
let bootstrapToken = ''
let validatedToken = ''
let sessionGeneration = 0
let loginAttempt = 0

const state = reactive({
  ready: false,
  user: null,
  sessionError: ''
})

function permissionKey(value) {
  if (typeof value === 'string') return value
  return value?.key || value?.resource || value?.scope || value?.permission || ''
}

function normalizeOperations(value) {
  const source = Array.isArray(value) ? value : []
  return [...new Set(source.map((item) => typeof item === 'string' ? item : item?.key).filter(Boolean))]
}

function normalizeScope(value) {
  if (typeof value === 'string') return { resource: value, resourceId: null, permissions: [] }
  const resource = permissionKey(value)
  if (!resource) return null
  return {
    ...value,
    resource,
    resourceId: value.resourceId || value.recordId || value.organizationId || null,
    permissions: normalizeOperations(value.permissions || value.operations || value.actions)
  }
}

function normalizeAdminUser(user) {
  if (!user || typeof user !== 'object') return null
  const permissionFields = ['adminPermissions', 'derivedAdminPermissions', 'derivedPermissions', 'permissions']
  const scopeFields = ['adminScopes', 'managementScopes']
  const permissionValues = permissionFields.flatMap((key) => Array.isArray(user[key]) ? user[key] : [])
  const rawScopes = scopeFields.flatMap((key) => Array.isArray(user[key]) ? user[key] : [])
  const adminScopes = rawScopes.map(normalizeScope).filter(Boolean)
  const permissions = [...new Set([
    ...permissionValues.map(permissionKey),
    ...adminScopes.map((scope) => scope.resource)
  ].filter(Boolean))]
  return {
    ...user,
    adminPermissions: permissions,
    adminScopes,
    permissionsProvided: permissionFields.some((key) => Array.isArray(user[key])) || scopeFields.some((key) => Array.isArray(user[key])),
    scopesProvided: scopeFields.some((key) => Array.isArray(user[key]))
  }
}

function adminRole(user = state.user) {
  return String(user?.adminRole || user?.role || '').toLowerCase()
}

function hasAdminAccess(user = state.user) {
  const role = adminRole(user)
  return Boolean(user?.isAdmin || user?.isSuperAdmin || ['admin', 'super_admin', 'delegated_admin', 'resource_admin', 'organization_admin'].includes(role))
}

function isSuperAdmin(user = state.user) {
  if (!hasAdminAccess(user)) return false
  const role = adminRole(user)
  if (user?.isSuperAdmin === true || role === 'super_admin' || user?.adminPermissions?.includes('*')) return true
  // 缺少明确的超级管理员声明时一律按非超级管理员处理。
  return false
}

function permissionAliases(permission) {
  const value = String(permission || '')
  return new Set([value, `business:${value}`, `resource:${value}`, `admin:${value}`])
}

function canAccess(permission, user = state.user) {
  if (!hasAdminAccess(user)) return false
  if (!permission) return true
  if (isSuperAdmin(user)) return true
  if (permission === 'dashboard') return false
  const owned = new Set(user?.adminPermissions || [])
  return [...permissionAliases(permission)].some((item) => owned.has(item))
}

function matchingScopes(resource, recordId, user = state.user) {
  const aliases = permissionAliases(resource)
  return (user?.adminScopes || []).filter((scope) => aliases.has(scope.resource)
    && (!scope.resourceId || (recordId && String(scope.resourceId) === String(recordId))))
}

function operationAllowed(permissions, operation) {
  if (!permissions?.length) return false
  const aliases = {
    read: ['read'], create: ['create'], update: ['update', 'edit'],
    moderate: ['moderate', 'review'], manageManagers: ['manageManagers', 'manage_members', 'manage-managers']
  }[operation] || [operation, 'moderate']
  return aliases.some((item) => permissions.includes(item))
}

function serverCapability(record, operation) {
  const capabilities = record?.capabilities ?? record?._permissions
  if (capabilities === undefined || capabilities === null) return null
  const aliases = {
    read: ['read'], create: ['create'], update: ['update', 'edit'],
    moderate: ['moderate', 'review'], manageManagers: ['manageManagers', 'manage_members', 'manage-managers']
  }[operation] || [operation, 'moderate']
  if (Array.isArray(capabilities)) return aliases.some((item) => capabilities.includes(item))
  if (typeof capabilities === 'object') {
    for (const key of aliases) if (Object.prototype.hasOwnProperty.call(capabilities, key)) return Boolean(capabilities[key])
    return false
  }
  return false
}

function canCreate(resource, user = state.user) {
  if (isSuperAdmin(user)) return true
  if (!canAccess(resource, user)) return false
  if (!user?.scopesProvided) return false
  return (user.adminScopes || []).some((scope) => permissionAliases(resource).has(scope.resource)
    && !scope.resourceId && operationAllowed(scope.permissions, 'create'))
}

function canRecord(resource, record, operation = 'read', user = state.user) {
  if (isSuperAdmin(user)) return true
  if (!canAccess(resource, user)) return false
  const explicit = serverCapability(record, operation)
  if (explicit !== null) return explicit
  if (!user?.scopesProvided) return false
  return matchingScopes(resource, record?.id, user).some((scope) => operationAllowed(scope.permissions, operation))
}

async function revokeToken(token) {
  if (!token) return
  try { await api('/auth/logout', { method: 'POST', token }) } catch { /* 本地依然清除会话 */ }
}

const orderedRoutes = [
  ['community', 'community-posts'], ['announcements', 'announcements'], ['academicCalendar', 'academic-calendar'],
  ['activities', 'activities'], ['homeConfig', 'home-config'], ['alumniBenefits', 'alumni-benefits'],
  ['applications', 'applications'], ['givingCertificates', 'applications'], ['serviceCatalog', 'service-catalog'], ['serviceApplications', 'service-applications'],
  ['campusVisits', 'campus-visits'], ['feedback', 'feedback'],
  ['alumniEnterprises', 'alumni-enterprises'], ['collaborationOpportunities', 'collaboration-opportunities'],
  ['alumniAcademy', 'alumni-academy'], ['organizations', 'organizations'],
  ['directory', 'directory'], ['jobs', 'jobs'], ['mentors', 'mentors'], ['volunteers', 'volunteers'],
  ['givingProjects', 'giving-projects']
]

export const auth = {
  state,
  isAuthenticated: computed(() => Boolean(state.user)),
  isAdmin: computed(() => hasAdminAccess()),
  isSuperAdmin: computed(() => isSuperAdmin()),
  isDelegatedAdmin: computed(() => hasAdminAccess() && !isSuperAdmin()),
  permissions: computed(() => state.user?.adminPermissions || []),
  scopes: computed(() => state.user?.adminScopes || []),
  canAccess,
  canCreate,
  canRecord,
  firstAccessibleRoute() {
    if (isSuperAdmin()) return 'dashboard'
    const directlyScoped = orderedRoutes.find(([, permission]) => (state.user?.adminScopes || [])
      .some((scope) => permissionAliases(permission).has(scope.resource)))
    if (directlyScoped) return directlyScoped[0]
    return orderedRoutes.find(([, permission]) => canAccess(permission))?.[0] || 'forbidden'
  },

  async bootstrap(force = false) {
    const token = accessToken()
    if (state.ready && !force && validatedToken === token) return state.user
    if (bootstrapPromise && bootstrapToken === token) return bootstrapPromise
    const generation = ++sessionGeneration
    const current = () => generation === sessionGeneration && accessToken() === token
    bootstrapToken = token
    const work = (async () => {
      if (!token) {
        state.user = null
        validatedToken = ''
        state.ready = true
        return null
      }
      try {
        const user = normalizeAdminUser(await api('/me', {token}))
        if (!current()) return null
        state.user = hasAdminAccess(user) ? user : null
        validatedToken = token
        state.sessionError = ''
        if (!state.user) {
          await revokeToken(token)
          if (current()) {saveAccessToken('');validatedToken=''}
        }
      } catch (error) {
        if (!current()) return null
        if (isRevokedSession(error)) { state.user=null;saveAccessToken('');validatedToken='' }
        else {
          if (validatedToken !== token) state.user=null
          state.sessionError='暂时无法验证已保存的会话，请检查网络后重试；登录凭证未被清除。'
        }
      } finally {
        if (current()) state.ready = true
      }
      return state.user
    })().finally(() => { if(bootstrapPromise === work) bootstrapPromise = null })
    bootstrapPromise = work
    return bootstrapPromise
  },

  async login(username, password) {
    const attempt=++loginAttempt
    const result = await api('/auth/login', {
      method: 'POST',
      token: '',
      body: { username, password, deviceId:getDeviceId() }
    })
    if(attempt!==loginAttempt){await revokeToken(result?.accessToken);throw new Error('登录操作已被后续操作替代')}
    if (!result?.accessToken || !result?.user) throw new Error('登录响应不完整，请联系系统管理员')
    const user = normalizeAdminUser(result.user)
    if (!hasAdminAccess(user)) {
      await revokeToken(result.accessToken)
      throw new Error('该平台账号未授予后台管理权限')
    }
    saveAccessToken(result.accessToken)
    sessionGeneration++
    validatedToken=result.accessToken
    state.user = user
    state.ready = true
    state.sessionError = ''
    return user
  },

  async changePassword(currentPassword, newPassword) {
    const token=accessToken()
    const result = await api('/auth/change-password', {
      method: 'POST',
      token,
      body: { currentPassword, newPassword }
    })
    if(accessToken()===token){saveAccessToken('');sessionGeneration++;validatedToken='';state.user=null;state.ready=true}
    return result
  },

  async logout() {
    const token = accessToken()
    loginAttempt++
    sessionGeneration++
    saveAccessToken('')
    validatedToken=''
    state.user = null
    state.ready = true
    await revokeToken(token)
  }
}

window.addEventListener('hufe:auth-expired', (event) => {
  sessionGeneration++
  validatedToken=''
  state.user = null
  state.ready = true
  state.sessionError=event.detail?.message||'登录状态已失效，请重新登录。'
})

window.addEventListener('storage', (event) => {
  if(event.key!==null&&event.key!=='hufe.admin.access-token')return
  sessionGeneration++
  validatedToken=''
  state.user=null
  state.ready=false
  auth.bootstrap(true)
})
