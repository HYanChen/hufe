import { auditRecord } from '../audit/metadata.js'
import { randomUUID } from 'node:crypto'
import { businessResourceKeys, isBusinessResource, isStoredResource } from '../business/definitions.js'

export const delegationPermissions = Object.freeze(['read', 'create', 'update', 'moderate', 'manage_members'])

const resourceLabels = Object.freeze({
  'community-posts': '湖财圈', applications: '业务申请', 'service-catalog': '服务目录',
  'service-applications': '服务申请', activities: '活动', 'campus-visits': '返校申请',
  organizations: '校友组织', directory: '校友名录', jobs: '招聘', mentors: '导师',
  volunteers: '志愿服务', 'giving-projects': '公益项目',
  'alumni-enterprises': '校友企业馆', 'collaboration-opportunities': '资源合作广场',
  'alumni-academy': '校友课堂', announcements: '公告管理', 'alumni-benefits': '校友权益',
  'academic-calendar': '学校校历', feedback: '反馈', 'home-config': '首页运营'
})

const submissionResource = Object.freeze({
  'event-registration': 'activities', 'organization-membership': 'organizations',
  'organization-message': 'organizations',
  'community-comment': 'community-posts',
  'job-application': 'jobs', 'mentor-application': 'mentors',
  'volunteer-application': 'volunteers', 'giving-intent': 'giving-projects',
  'service-application': 'service-catalog', 'campus-visit': 'campus-visits',
  feedback: 'feedback', 'community-report': 'community-posts',
  'benefit-claim': 'alumni-benefits'
})

const applicationResources = new Set(['activities', 'organizations', 'community-posts', 'jobs', 'mentors', 'volunteers', 'giving-projects', 'service-catalog', 'alumni-benefits'])

function now() { return new Date().toISOString() }

function permissionError(message, code = 'ADMIN_PERMISSION_DENIED', statusCode = 403) {
  return Object.assign(new Error(message), { code, statusCode })
}

function ensureDelegations(data) {
  if (!Array.isArray(data.adminDelegations)) data.adminDelegations = []
  return data.adminDelegations
}

function active(grant, timestamp = Date.now()) {
  return grant.status === 'active' && (!grant.expiresAt || Date.parse(grant.expiresAt) > timestamp)
}

function parentIds(grant) {
  return Array.isArray(grant.parentGrantIds) ? grant.parentGrantIds.filter(Boolean).map(String) : []
}

function activeIn(data, grant, timestamp = Date.now(), visiting = new Set()) {
  if (!active(grant, timestamp) || visiting.has(grant.id)) return false
  const parents = parentIds(grant)
  if (!parents.length) return true
  const next = new Set(visiting).add(grant.id)
  return parents.every((id) => {
    const parent = ensureDelegations(data).find((item) => item.id === id)
    return Boolean(parent) && activeIn(data, parent, timestamp, next)
  })
}

function endGrant(data, grant, status, metadata, reason, action) {
  if (grant.status !== 'active') return false
  const timestamp = now()
  grant.status = status
  grant.updatedAt = timestamp
  grant.revision = Number(grant.revision || 0) + 1
  if (status === 'revoked') {
    grant.revokedAt = timestamp
    grant.revokedBy = metadata.actor || 'system'
    grant.revokeReason = String(reason || '').slice(0, 500)
  }
  if (!Array.isArray(data.auditLogs)) data.auditLogs = []
  data.auditLogs.unshift(audit(action, grant.id, metadata, {
    accountId: grant.accountId, resource: grant.resource, resourceId: grant.resourceId, reason: reason || ''
  }))
  return true
}

function cascadeEndedGrant(data, rootGrant, status, metadata, reason) {
  const queue = [rootGrant.id]
  const ended = []
  while (queue.length) {
    const parentId = queue.shift()
    for (const child of ensureDelegations(data).filter((item) => item.status === 'active' && parentIds(item).includes(parentId))) {
      if (endGrant(data, child, status, metadata, `parent-delegation-ended:${parentId}`, `admin.delegation_${status}_cascade`)) {
        ended.push(child.id)
        queue.push(child.id)
      }
    }
  }
  return ended
}

function expireActiveGrants(data, metadata = {}) {
  const timestamp = Date.now()
  for (const grant of ensureDelegations(data)) {
    const expiresAt = grant.expiresAt ? Date.parse(grant.expiresAt) : null
    if (grant.status !== 'active' || expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > timestamp)) continue
    if (endGrant(data, grant, 'expired', metadata, 'expiry-reached', 'admin.delegation_expired')) {
      cascadeEndedGrant(data, grant, 'expired', metadata, 'parent-expired')
    }
  }
}

function normalizedPermissions(input, { recordScope = false, defaults = true } = {}) {
  const fallback = recordScope
    ? ['read', 'update', 'moderate', 'manage_members']
    : ['read', 'create', 'update', 'moderate', 'manage_members']
  const source = Array.isArray(input) && input.length ? input : (defaults ? fallback : [])
  const values = [...new Set(source.map(String))]
  if (!values.length || values.some((value) => !delegationPermissions.includes(value))) {
    throw permissionError('管理权限包含无效操作', 'DELEGATION_PERMISSION_INVALID', 400)
  }
  if (recordScope && values.includes('create')) throw permissionError('具体记录授权不能包含 create', 'DELEGATION_PERMISSION_INVALID', 400)
  return values
}

function audit(action, targetId, metadata = {}, details = {}) { return auditRecord(action, targetId, metadata, details) }

function safeAccount(account = {}) {
  return {
    id: account.id || '', username: account.username || '', name: account.name || '', displayName: account.name || '',
    department: account.department || '', personType: account.personType || 'member', status: account.status || '',
    schoolIdentityVerified: Boolean(account.schoolIdentityVerified), accountSource: account.accountSource || 'school_registered',
    source: account.accountSource === 'admin_provisioned' ? 'admin_created' : (account.accountSource || 'school_registered'),
    mustChangePassword: Boolean(account.mustChangePassword)
  }
}

function grantView(grant, data) {
  return { ...grant, account: safeAccount(data.accounts.find((item) => item.id === grant.accountId)) }
}

export class DelegationService {
  constructor(database) {
    this.database = database
  }

  resources() {
    return { items: businessResourceKeys.map((key) => ({ key, label: resourceLabels[key] || key })), permissions: [...delegationPermissions] }
  }

  grantsFor(data, accountId) {
    const timestamp = Date.now()
    return ensureDelegations(data).filter((grant) => grant.accountId === accountId && activeIn(data, grant, timestamp))
  }

  accessIn(data, account) {
    if (!account) return { adminRole: 'member', adminPermissions: [], derivedAdminPermissions: [], adminScopes: [] }
    if (account.isAdmin) {
      return {
        adminRole: 'super_admin', adminPermissions: ['*'], derivedAdminPermissions: ['*'],
        adminScopes: [{ resource: '*', resourceId: null, permissions: ['*'] }]
      }
    }
    const grants = this.grantsFor(data, account.id)
    const base = [...new Set(grants.map((grant) => grant.resource))]
    const derived = [...base]
    if (base.some((resource) => applicationResources.has(resource)) && !derived.includes('applications')) derived.push('applications')
    if (base.includes('service-catalog') && !derived.includes('service-applications')) derived.push('service-applications')
    if (base.includes('community-posts') && !derived.includes('feedback')) derived.push('feedback')
    return {
      adminRole: grants.length ? 'delegated_admin' : 'member',
      adminPermissions: derived,
      derivedAdminPermissions: derived.filter((resource) => !base.includes(resource)),
      adminScopes: grants.map((grant) => ({ id: grant.id, resource: grant.resource, resourceId: grant.resourceId || null, permissions: [...grant.permissions] }))
    }
  }

  decorateAccount(account) {
    return this.database.read((data) => ({ ...account, ...this.accessIn(data, account) }))
  }

  canIn(data, account, resource, permission, resourceId = null) {
    if (account?.isAdmin) return true
    if (!account || account.status !== 'active') return false
    return this.grantsFor(data, account.id).some((grant) => {
      if (grant.resource !== resource || !grant.permissions.includes(permission)) return false
      if (!grant.resourceId) return true
      return Boolean(resourceId) && grant.resourceId === resourceId
    })
  }

  can(account, resource, permission, resourceId = null) {
    return this.database.read((data) => this.canIn(data, account, resource, permission, resourceId))
  }

  canOrganizationIn(data, account, organizationId, permission) {
    if (account?.isAdmin) return true
    if (!account || account.status !== 'active' || !organizationId) return false
    return this.grantsFor(data, account.id).some((grant) => (
      grant.resource === 'organizations'
      && grant.resourceId === organizationId
      && grant.permissions.includes(permission)
    ))
  }

  canOrganization(account, organizationId, permission) {
    return this.database.read((data) => this.canOrganizationIn(data, account, organizationId, permission))
  }

  organizationCapabilitiesIn(data, account, organizationId) {
    const update = this.canOrganizationIn(data, account, organizationId, 'update')
    const moderate = this.canOrganizationIn(data, account, organizationId, 'moderate')
    const organization = data.business?.resources?.organizations
      ?.find((item) => item.id === organizationId)
    return {
      read: this.canOrganizationIn(data, account, organizationId, 'read'),
      update,
      moderate,
      publish: update && moderate && organization?.status === 'published',
      manageManagers: this.canOrganizationIn(data, account, organizationId, 'manage_members')
    }
  }

  organizationCapabilities(account, organizationId) {
    return this.database.read((data) => this.organizationCapabilitiesIn(data, account, organizationId))
  }

  canRouteIn(data, account, requestedResource, permission) {
    if (account?.isAdmin) return true
    if (!account || account.status !== 'active') return false
    const resources = requestedResource === 'applications'
      ? ['applications', ...applicationResources]
      : requestedResource === 'service-applications' ? ['service-applications', 'service-catalog']
        : requestedResource === 'feedback' ? ['feedback', 'community-posts'] : [requestedResource]
    return this.grantsFor(data, account.id).some((grant) => resources.includes(grant.resource) && grant.permissions.includes(permission))
  }

  canRoute(account, requestedResource, permission) {
    return this.database.read((data) => this.canRouteIn(data, account, requestedResource, permission))
  }

  hasBackendAccess(account) {
    return account?.isAdmin || this.database.read((data) => this.grantsFor(data, account?.id).length > 0)
  }

  capabilities(account, resource, resourceId = null) {
    return this.database.read((data) => ({
      read: this.canIn(data, account, resource, 'read', resourceId),
      create: this.canIn(data, account, resource, 'create'),
      update: this.canIn(data, account, resource, 'update', resourceId),
      moderate: this.canIn(data, account, resource, 'moderate', resourceId),
      manageManagers: this.canIn(data, account, resource, 'manage_members', resourceId)
    }))
  }

  recordCapabilities(account, requestedResource, record) {
    return {
      read: this.canRecord(account, requestedResource, 'read', record),
      create: this.canRoute(account, requestedResource, 'create'),
      update: this.canRecord(account, requestedResource, 'update', record),
      moderate: this.canRecord(account, requestedResource, 'moderate', record),
      manageManagers: record?.recordKind === 'submission' ? false : this.canRecord(account, requestedResource, 'manage_members', record)
    }
  }

  recordScope(record, requestedResource) {
    if (record?.recordKind === 'submission') {
      return { resource: submissionResource[record.submissionType] || requestedResource, resourceId: record.resourceId || null }
    }
    return { resource: requestedResource, resourceId: record?.id || null }
  }

  canRecordIn(data, account, requestedResource, permission, record) {
    if (record?.recordKind === 'submission' && this.canIn(data, account, requestedResource, permission, null)) return true
    if (record?.recordKind === 'submission' && record.submissionType === 'community-report') {
      return this.canIn(data, account, 'feedback', permission, null) || this.canIn(data, account, 'community-posts', permission, record.resourceId || null)
    }
    const scope = this.recordScope(record, requestedResource)
    return this.canIn(data, account, scope.resource, permission, scope.resourceId)
  }

  canRecord(account, requestedResource, permission, record) {
    return this.database.read((data) => this.canRecordIn(data, account, requestedResource, permission, record))
  }

  adminRecordFilter(account, requestedResource, permission = 'read') {
    return (record, data) => this.canRecordIn(data, account, requestedResource, permission, record)
  }

  assertRecordExists(data, resource, resourceId) {
    if (!isBusinessResource(resource)) throw permissionError('业务板块不存在', 'BUSINESS_RESOURCE_NOT_FOUND', 404)
    if (!resourceId) return
    if (!isStoredResource(resource)) throw permissionError('该板块不支持具体记录授权', 'DELEGATION_SCOPE_INVALID', 400)
    const record = data.business?.resources?.[resource]?.find((item) => item.id === resourceId)
    if (!record) throw permissionError('授权目标业务记录不存在', 'BUSINESS_ITEM_NOT_FOUND', 404)
  }

  assertGrantActor(data, actor, resource, resourceId, permissions) {
    if (actor.isAdmin) return { parentGrantIds: [], lineageGrantIds: [], expiresAtLimit: null }
    if (!resourceId) {
      throw permissionError('无权管理该业务记录的管理员')
    }
    const supporting = this.grantsFor(data, actor.id).filter((grant) => grant.resource === resource && (!grant.resourceId || grant.resourceId === resourceId))
    const required = [...new Set(['manage_members', ...permissions])]
    const selected = []
    for (const permission of required) {
      const candidates = supporting.filter((grant) => grant.permissions.includes(permission)).sort((left, right) => {
        const leftExpiry = left.expiresAt ? Date.parse(left.expiresAt) : Number.POSITIVE_INFINITY
        const rightExpiry = right.expiresAt ? Date.parse(right.expiresAt) : Number.POSITIVE_INFINITY
        return rightExpiry - leftExpiry
      })
      if (!candidates.length) {
        if (permission === 'manage_members') throw permissionError('无权管理该业务记录的管理员')
        throw permissionError('不能授予超出自身范围的权限')
      }
      selected.push(candidates[0])
    }
    const parents = [...new Set(selected.map((grant) => grant.id))]
    const lineage = [...new Set(selected.flatMap((grant) => [grant.id, ...(Array.isArray(grant.lineageGrantIds) ? grant.lineageGrantIds : [])]))]
    const finiteExpiries = selected.map((grant) => grant.expiresAt ? Date.parse(grant.expiresAt) : Number.POSITIVE_INFINITY).filter(Number.isFinite)
    return { parentGrantIds: parents, lineageGrantIds: lineage, expiresAtLimit: finiteExpiries.length ? Math.min(...finiteExpiries) : null }
  }

  async create(actor, input = {}, metadata = {}) {
    const accountId = String(input.accountId || '')
    const resource = String(input.resource || '')
    const resourceId = input.resourceId ? String(input.resourceId) : null
    const permissions = normalizedPermissions(input.permissions, { recordScope: Boolean(resourceId) })
    const hasExpiry = Object.prototype.hasOwnProperty.call(input, 'expiresAt')
    const expiryValue = input.expiresAt == null ? '' : String(input.expiresAt).trim()
    const expiresAt = expiryValue ? new Date(expiryValue) : null
    if ((hasExpiry && input.expiresAt != null && !expiryValue) || (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()))) {
      throw permissionError('授权到期时间必须是晚于当前时间的有效时间', 'DELEGATION_EXPIRY_INVALID', 400)
    }
    if (!actor.isAdmin && !expiresAt) throw permissionError('链式委派必须设置授权到期时间', 'DELEGATION_EXPIRY_REQUIRED', 400)
    return this.database.transaction((data) => {
      const grants = ensureDelegations(data)
      expireActiveGrants(data, metadata)
      this.assertRecordExists(data, resource, resourceId)
      const authority = this.assertGrantActor(data, actor, resource, resourceId, permissions)
      if (!actor.isAdmin && authority.expiresAtLimit && expiresAt.getTime() > authority.expiresAtLimit) {
        throw permissionError('链式委派到期时间不能晚于上级授权', 'DELEGATION_EXPIRY_EXCEEDS_PARENT', 400)
      }
      const account = data.accounts.find((item) => item.id === accountId && item.status === 'active')
      if (!account) throw permissionError('被授权账号不存在或不可用', 'ACCOUNT_NOT_FOUND', 404)
      if (account.isAdmin) throw permissionError('超级管理员不需要业务委派', 'DELEGATION_TARGET_INVALID', 409)
      if (!account.schoolIdentityVerified && account.accountSource !== 'admin_provisioned' && !account.localDevelopmentOnly) {
        throw permissionError('仅可委派学校实名用户或平台运营账号', 'DELEGATION_TARGET_INVALID', 400)
      }
      const duplicate = grants.find((item) => item.accountId === accountId && item.resource === resource && (item.resourceId || null) === resourceId && activeIn(data, item))
      if (duplicate) throw permissionError('该账号已有相同有效管理授权', 'DELEGATION_ALREADY_EXISTS', 409)
      const timestamp = now()
      const grant = {
        id: randomUUID(), accountId, resource, resourceId, permissions, status: 'active', revision: 1,
        grantedBy: actor.id, createdAt: timestamp, updatedAt: timestamp, expiresAt: expiresAt?.toISOString() || null,
        parentGrantIds: authority.parentGrantIds, lineageGrantIds: authority.lineageGrantIds,
        revokedAt: null, revokedBy: null, revokeReason: ''
      }
      grants.unshift(grant)
      data.auditLogs.unshift(audit('admin.delegation_created', grant.id, metadata, { accountId, resource, resourceId, permissions }))
      return grantView(grant, data)
    })
  }

  list(actor, input = {}) {
    return this.database.read((data) => {
      const status = String(input.status || 'active')
      const records = ensureDelegations(data).filter((grant) => {
        if (status && (status === 'active' ? !activeIn(data, grant) : grant.status !== status)) return false
        if (input.accountId && grant.accountId !== String(input.accountId)) return false
        if (input.resource && grant.resource !== String(input.resource)) return false
        if (input.resourceId && grant.resourceId !== String(input.resourceId)) return false
        if (actor.isAdmin) return true
        return Boolean(grant.resourceId) && this.canIn(data, actor, grant.resource, 'manage_members', grant.resourceId)
      }).map((grant) => grantView(grant, data))
      return { items: records, total: records.length }
    })
  }

  async revoke(actor, id, metadata = {}, reason = '') {
    return this.database.transaction((data) => {
      const grant = ensureDelegations(data).find((item) => item.id === id && activeIn(data, item))
      if (!grant) throw permissionError('有效管理授权不存在', 'DELEGATION_NOT_FOUND', 404)
      if (!actor.isAdmin && (!grant.resourceId || !this.canIn(data, actor, grant.resource, 'manage_members', grant.resourceId))) {
        throw permissionError('无权撤销该管理授权')
      }
      endGrant(data, grant, 'revoked', metadata, reason, 'admin.delegation_revoked')
      cascadeEndedGrant(data, grant, 'revoked', metadata, reason)
      return { revoked: true, delegation: grantView(grant, data) }
    })
  }

  modulePermissions(accountId) {
    return this.database.read((data) => {
      const account = data.accounts.find((item) => item.id === accountId)
      if (!account) throw permissionError('账号不存在', 'ACCOUNT_NOT_FOUND', 404)
      const resources = this.grantsFor(data, accountId).filter((grant) => !grant.resourceId).map((grant) => grant.resource)
      return { account: safeAccount(account), resources: [...new Set(resources)], ...this.accessIn(data, account) }
    })
  }

  async replaceModulePermissions(actor, accountId, resources, metadata = {}) {
    if (!actor.isAdmin) throw permissionError('仅超级管理员可分配板块权限')
    const requested = [...new Set((Array.isArray(resources) ? resources : []).map(String))]
    if (requested.some((resource) => !isBusinessResource(resource))) throw permissionError('包含无效业务板块', 'DELEGATION_SCOPE_INVALID', 400)
    return this.database.transaction((data) => {
      const account = data.accounts.find((item) => item.id === accountId && item.status === 'active')
      if (!account) throw permissionError('账号不存在或不可用', 'ACCOUNT_NOT_FOUND', 404)
      if (account.isAdmin) throw permissionError('超级管理员不需要业务委派', 'DELEGATION_TARGET_INVALID', 409)
      if (!account.schoolIdentityVerified && account.accountSource !== 'admin_provisioned' && !account.localDevelopmentOnly) throw permissionError('仅可委派学校实名用户或平台运营账号', 'DELEGATION_TARGET_INVALID', 400)
      const grants = ensureDelegations(data)
      expireActiveGrants(data, metadata)
      const timestamp = now()
      for (const grant of grants.filter((item) => item.accountId === accountId && !item.resourceId && activeIn(data, item))) {
        endGrant(data, grant, 'revoked', metadata, 'module-permissions-replaced', 'admin.delegation_revoked')
        cascadeEndedGrant(data, grant, 'revoked', metadata, 'module-permissions-replaced')
      }
      for (const resource of requested) {
        grants.unshift({
          id: randomUUID(), accountId, resource, resourceId: null,
          permissions: normalizedPermissions(null), status: 'active', revision: 1, grantedBy: actor.id,
          parentGrantIds: [], lineageGrantIds: [],
          createdAt: timestamp, updatedAt: timestamp, expiresAt: null, revokedAt: null, revokedBy: null, revokeReason: ''
        })
      }
      data.auditLogs.unshift(audit('admin.module_permissions_replaced', accountId, metadata, { resources: requested }))
      return { account: safeAccount(account), resources: requested, ...this.accessIn(data, account) }
    })
  }

  recordManagers(actor, resource, resourceId) {
    return this.database.read((data) => {
      this.assertRecordExists(data, resource, resourceId)
      if (!actor.isAdmin && !this.canIn(data, actor, resource, 'read', resourceId) && !this.canIn(data, actor, resource, 'manage_members', resourceId)) throw permissionError('无权查看该记录管理员')
      const items = ensureDelegations(data).filter((grant) => grant.resource === resource && grant.resourceId === resourceId && activeIn(data, grant)).map((grant) => grantView(grant, data))
      return { items, total: items.length }
    })
  }

  async revokeRecordManager(actor, resource, resourceId, accountId, metadata = {}) {
    const grant = this.database.read((data) => ensureDelegations(data).find((item) => item.accountId === accountId && item.resource === resource && item.resourceId === resourceId && activeIn(data, item)))
    if (!grant) throw permissionError('该账号不是当前记录管理员', 'DELEGATION_NOT_FOUND', 404)
    return this.revoke(actor, grant.id, metadata, 'record-manager-removed')
  }

  searchAccounts(actor, input = {}) {
    const needle = String(input.query || '').trim().toLowerCase()
    if (needle.length < 2) throw permissionError('请至少输入 2 个字符搜索账号', 'ACCOUNT_SEARCH_QUERY_REQUIRED', 400)
    const limit = Math.min(50, Math.max(1, Number(input.limit) || 20))
    return this.database.read((data) => {
      if (!actor.isAdmin && !this.grantsFor(data, actor.id).some((grant) => grant.permissions.includes('manage_members'))) throw permissionError('无权搜索可委派账号')
      const items = data.accounts.filter((account) => account.status === 'active' && !account.isAdmin && (account.schoolIdentityVerified || account.accountSource === 'admin_provisioned' || account.localDevelopmentOnly) && [account.username, account.name, account.department].some((value) => String(value || '').toLowerCase().includes(needle)))
        .slice(0, limit).map(safeAccount)
      return { items, total: items.length }
    })
  }

}
