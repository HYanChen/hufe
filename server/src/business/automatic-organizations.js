import { createHash, randomUUID } from 'node:crypto'
import { academicAffiliations } from '../accounts/affiliations.js'
import { auditRecord } from '../audit/metadata.js'
import { normalizeOrganizationType } from './organization-categories.js'

const types = { department: '学院组织', major: '同专业校友', grade: '同年级校友', class: '同班校友', city: '地方组织', interest: '同兴趣校友', industry: '行业组织' }
const active = row => ['approved', 'active', 'joined'].includes(row.status)
const text = value => typeof value === 'string' && !/[\u0000-\u001f<>]/.test(value) ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function organizationAffiliations(account, regions) {
  const affiliations = academicAffiliations(account)
  if (account?.status !== 'active' || account.schoolIdentityVerified !== true || !['student', 'alumni'].includes(account.personType)) return []
  const personal = account.personalProfile || {}
  const add = (kind, identity, title, values) => affiliations.push({ key: `organization:${kind}:${hash(identity)}`, kind, title, ...values })
  if (regions && (personal.city || personal.regionCode)) {
    try {
      const choice = regions.selection(personal), item = regions.describe(choice.regionCode)
      const scope = item.path.find(row => row.level === 'city' && !['市辖区', '县', '省直辖县级行政单位'].includes(row.name))
        || item.path.find(row => row.level === 'province' && ['CN-11', 'CN-12', 'CN-31', 'CN-50'].includes(row.code))
        || item.path.find(row => row.level === 'district')
      if (scope) add('city', [scope.code], `${choice.city}校友组织`, { city: choice.city, regionCode: scope.code })
    } catch {}
  }
  const industry = text(personal.industry || account.industry)
  if (industry && industry.length <= 120) add('industry', [industry], `${industry}行业校友组织`, { industry })
  const interests = personal.interests || personal.interestTags || account.interests || account.interestTags
  if (Array.isArray(interests)) for (const interest of [...new Set(interests.map(text).filter(value => value && value.length <= 30))].slice(0, 12)) add('interest', [interest], `${interest}兴趣校友组织`, { interestTags: [interest] })
  return affiliations
}

function semanticMatch(organization, affiliation, regions) {
  if (normalizeOrganizationType(organization.type) !== types[affiliation.kind]) return false
  if (affiliation.kind === 'city') {
    try { return regions.selection({ city: organization.city }).city === affiliation.city } catch { return false }
  }
  if (affiliation.kind === 'industry') return text(organization.industry) === affiliation.industry
  if (affiliation.kind === 'interest') return organization.interestTags?.length === 1 && text(organization.interestTags[0]) === affiliation.interestTags[0]
  const values = { department: text(organization.college), major: text(organization.major), className: text(organization.className), enrollmentYear: text(organization.grade).replace(/级$/, '') }
  // A grade-specific or college-specific manual organization is not a match
  // for a broader automatically-created major/year organization.
  return ['department', 'major', 'className', 'enrollmentYear'].every(key => (affiliation[key] || '') === values[key])
}

export function automaticOrganizationFingerprint(data, regions) {
  return hash({
    accounts: data.accounts.map(account => [account.id, organizationAffiliations(account, regions)]),
    organizations: (data.business?.resources?.organizations || []).map(row => [row.id, row.status, row.revision, row.automaticAffiliation?.key]),
    memberships: (data.business?.submissions || []).filter(row => row.type === 'organization-membership').map(row => [row.id, row.resourceId, row.accountId, row.status, row.automaticAffiliationKey, row.automaticEndReason]),
    optOuts: data.business?.automaticOrganizationOptOuts || []
  })
}

export function optOutAutomaticOrganization(business, submission, reason, actor) {
  const organization = business.resources.organizations.find(row => row.id === submission.resourceId)
  const affiliationKey = organization?.automaticAffiliation?.key
  if (!affiliationKey) return
  business.automaticOrganizationOptOuts ||= []
  if (!business.automaticOrganizationOptOuts.some(row => row.accountId === submission.accountId && row.affiliationKey === affiliationKey)) business.automaticOrganizationOptOuts.push({ accountId: submission.accountId, organizationId: organization.id, affiliationKey, reason, actor: actor || submission.accountId, createdAt: new Date().toISOString() })
}

export function reconcileAutomaticOrganizations(data, regions) {
  const business = data.business, organizations = business.resources.organizations
  business.automaticOrganizationOptOuts ||= []
  const desiredByAccount = new Map(data.accounts.map(account => [account.id, organizationAffiliations(account, regions)]))
  const desired = new Map([...desiredByAccount.values()].flat().map(row => [row.key, row]))
  const resolved = new Map(), timestamp = new Date().toISOString()
  const result = { created: 0, adopted: 0, joined: 0, ended: 0, ambiguous: 0 }
  for (const affiliation of desired.values()) {
    let organization = organizations.find(row => row.automaticAffiliation?.key === affiliation.key)
    if (!organization) {
      const matches = organizations.filter(row => !row.automaticAffiliation && semanticMatch(row, affiliation, regions))
      if (matches.length > 1) { result.ambiguous++; continue }
      organization = matches[0]
      if (organization) { organization.automaticAffiliation = { key: affiliation.key, kind: affiliation.kind }; organization.revision = Number(organization.revision || 0) + 1; organization.updatedAt = timestamp; result.adopted++ }
      else {
        organization = { id: randomUUID(), resource: 'organizations', name: affiliation.title.slice(0, 160), type: types[affiliation.kind], college: affiliation.department || '', major: affiliation.major || '', grade: affiliation.enrollmentYear || '', className: affiliation.className || '', city: affiliation.city || '', regionCode: affiliation.regionCode || '', industry: affiliation.industry || '', interestTags: affiliation.interestTags || [], automaticAffiliation: { key: affiliation.key, kind: affiliation.kind }, status: 'published', revision: 1, memberCount: 0, summary: '依据已认证用户的明确资料建立，欢迎在组织内交流与参与活动。', joinInstructions: '匹配资料的实名校友自动加入。退出后不会自动重新加入；组织运营和成员管理仍由后台负责。', createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp, createdBy: 'system:automatic-organizations', updatedBy: 'system:automatic-organizations' }
        organizations.push(organization); result.created++
      }
    }
    resolved.set(affiliation.key, organization)
  }
  for (const row of business.submissions.filter(row => row.type === 'organization-membership' && row.automaticMembership === true && active(row))) {
    if ((desiredByAccount.get(row.accountId) || []).some(affiliation => affiliation.key === row.automaticAffiliationKey)) continue
    row.status = 'cancelled'; row.automaticEndReason = 'identity_changed'; row.updatedAt = timestamp; row.revision = Number(row.revision || 0) + 1; result.ended++
  }
  const optOut = (accountId, key) => business.automaticOrganizationOptOuts.some(row => row.accountId === accountId && row.affiliationKey === key)
  for (const account of data.accounts) for (const affiliation of desiredByAccount.get(account.id) || []) {
    const organization = resolved.get(affiliation.key)
    if (!organization || organization.status !== 'published' || optOut(account.id, affiliation.key)) continue
    const memberships = business.submissions.filter(row => row.type === 'organization-membership' && row.resourceId === organization.id && row.accountId === account.id)
    if (memberships.some(active)) continue
    if (memberships.some(row => ['cancelled', 'rejected', 'closed', 'completed'].includes(row.status) && row.automaticEndReason !== 'identity_changed')) {
      optOutAutomaticOrganization(business, memberships.find(row => ['cancelled', 'rejected', 'closed', 'completed'].includes(row.status) && row.automaticEndReason !== 'identity_changed'), 'previous_exit_or_removal', 'system:automatic-organizations')
      continue
    }
    const pending = memberships.find(row => ['submitted', 'pending_review'].includes(row.status))
    const membership = pending || { id: randomUUID(), number: `AUTO-${randomUUID().slice(0, 8).toUpperCase()}`, type: 'organization-membership', resourceType: 'organizations', resourceId: organization.id, accountId: account.id, actorSnapshot: { name: account.name || '', department: account.department || '', personType: account.personType }, payload: { organizationName: organization.name }, createdAt: timestamp, revision: 0 }
    Object.assign(membership, { status: 'approved', automaticMembership: true, automaticAffiliationKey: affiliation.key, approvedAt: timestamp, approvedBy: 'system:automatic-organizations', updatedAt: timestamp, revision: Number(membership.revision || 0) + 1 })
    if (!pending) business.submissions.push(membership)
    result.joined++
  }
  if (result.created || result.adopted || result.joined || result.ended) {
    business.revision += 1
    data.auditLogs.unshift(auditRecord('business.automatic_organizations_synced', 'organizations', { actor: 'system:automatic-organizations' }, result))
  }
  return result
}
