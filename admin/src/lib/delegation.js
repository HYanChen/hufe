import { api } from './api.js'

export const delegatedResourceOptions = Object.freeze([
  { key: 'applications', label: '申请与报名', group: '服务与办理' },
  { key: 'community-posts', label: '湖财圈管理', group: '内容与运营' },
  { key: 'academic-calendar', label: '校历管理', group: '内容与运营' },
  { key: 'service-catalog', label: '服务目录', group: '服务与办理' },
  { key: 'service-applications', label: '服务申请', group: '服务与办理' },
  { key: 'activities', label: '活动管理', group: '内容与运营' },
  { key: 'campus-visits', label: '返校预约', group: '服务与办理' },
  { key: 'alumni-enterprises', label: '企业认证与名录', group: '生态运营' },
  { key: 'collaboration-opportunities', label: '合作广场', group: '生态运营' },
  { key: 'alumni-academy', label: '校友课堂', group: '生态运营' },
  { key: 'organizations', label: '校友组织', group: '校友连接' },
  { key: 'directory', label: '校友名录', group: '校友连接' },
  { key: 'jobs', label: '岗位招聘审核', group: '校友连接' },
  { key: 'mentors', label: '校友导师', group: '校友连接' },
  { key: 'volunteers', label: '志愿者', group: '校友连接' },
  { key: 'giving-projects', label: '回馈母校', group: '校友连接' },
  { key: 'feedback', label: '意见反馈', group: '服务与办理' },
  { key: 'home-config', label: '首页运营', group: '内容与运营' }
])

function listFrom(data, keys) {
  if (Array.isArray(data)) return data
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key]
  return []
}

function permissionKey(value) {
  if (typeof value === 'string') return value
  return value?.key || value?.resource || value?.scope || value?.permission || ''
}

export function normalizePermissions(data) {
  const direct = Array.isArray(data?.resources)
    ? data.resources
    : Array.isArray(data?.adminPermissions)
      ? data.adminPermissions
      : Array.isArray(data?.permissions) ? data.permissions : []
  const scopes = listFrom(data, ['adminScopes', 'managementScopes', 'assignments'])
  return [...new Set([
    ...direct.filter((scope) => typeof scope === 'string' || (!scope?.resourceId && !scope?.recordId && !scope?.organizationId)).map(permissionKey),
    ...scopes.filter((scope) => !scope?.resourceId && !scope?.recordId && !scope?.organizationId).map(permissionKey)
  ].filter(Boolean))]
}

export async function getDelegationResources() {
  const data = await api('/admin/delegation/resources')
  const items = listFrom(data, ['items', 'resources']).map((item) => {
    const value = typeof item === 'string' ? { key: item } : item
    const fallback = delegatedResourceOptions.find((entry) => entry.key === value?.key) || {}
    return { ...fallback, ...value, label: value?.label || fallback.label || value?.key }
  }).filter((item) => item?.key)
  // 权限目录必须以服务端为准。空响应不能回退为前端内置的全量板块，
  // 否则服务端配置异常时会在授权界面误显示不可授予的范围。
  return items
}

export async function getAccountPermissions(accountId) {
  const data = await api(`/admin/accounts/${encodeURIComponent(accountId)}/permissions`)
  const permissions = normalizePermissions(data)
  return { ...data, permissions: permissions.length ? permissions : normalizePermissions(data?.account || data?.user) }
}

export async function updateAccountPermissions(accountId, permissions) {
  const data = await api(`/admin/accounts/${encodeURIComponent(accountId)}/permissions`, {
    method: 'PUT', body: { resources: [...new Set(permissions)] }
  })
  const normalized = normalizePermissions(data)
  return { ...data, permissions: normalized.length ? normalized : normalizePermissions(data?.account || data?.user) }
}

export async function searchPlatformAccounts(query, limit = 8) {
  const params = new URLSearchParams({ query: String(query || '').trim(), limit: String(limit) })
  const data = await api(`/admin/accounts/search?${params}`)
  return listFrom(data, ['items', 'accounts', 'users'])
}

export async function getRecordManagers(resource, recordId) {
  const data = await api(`/admin/business/${encodeURIComponent(resource)}/${encodeURIComponent(recordId)}/managers`)
  return listFrom(data, ['items', 'managers', 'accounts', 'users']).map((item) => ({
    ...(item.account || {}),
    ...item,
    accountId: item.accountId || item.account?.id || item.id,
    name: item.name || item.displayName || item.account?.name || item.account?.displayName || '',
    department: item.department || item.account?.department || ''
  }))
}

export async function addRecordManager(resource, recordId, accountId, expiresAt) {
  return api(`/admin/business/${encodeURIComponent(resource)}/${encodeURIComponent(recordId)}/managers`, {
    method: 'POST',
    body: {
      accountId,
      expiresAt
    }
  })
}

export async function removeRecordManager(resource, recordId, accountId) {
  return api(`/admin/business/${encodeURIComponent(resource)}/${encodeURIComponent(recordId)}/managers/${encodeURIComponent(accountId)}`, {
    method: 'DELETE'
  })
}

export async function getMentorOwner(recordId) {
  return api(`/admin/business/mentors/${encodeURIComponent(recordId)}/owner`)
}

export async function bindMentorOwner(recordId, accountId) {
  return api(`/admin/business/mentors/${encodeURIComponent(recordId)}/owner`, {
    method: 'PUT',
    body: { accountId }
  })
}

export async function unbindMentorOwner(recordId) {
  return api(`/admin/business/mentors/${encodeURIComponent(recordId)}/owner`, {
    method: 'DELETE'
  })
}
