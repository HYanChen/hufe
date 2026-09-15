// Pure shared definitions: the API, uni-app and admin editor use the same labels.
export const organizationTypes = Object.freeze([
  '同年级校友', '同班校友', '同专业校友', '同兴趣校友',
  '地方组织', '学院组织', '行业组织'
])

const aliases = Object.freeze({
  grade: '同年级校友', cohort: '同年级校友', 年级组织: '同年级校友',
  class: '同班校友', classmate: '同班校友', 班级组织: '同班校友',
  major: '同专业校友', 专业组织: '同专业校友',
  interest: '同兴趣校友', 兴趣组织: '同兴趣校友', 兴趣分会: '同兴趣校友',
  regional: '地方组织', local: '地方组织', city: '地方组织', 地方分会: '地方组织',
  college: '学院组织', 学院分会: '学院组织',
  industry: '行业组织', 行业分会: '行业组织'
})

export function normalizeOrganizationType(value) {
  const type = String(value || '').trim()
  const key = type.toLowerCase()
  return Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : type
}

export function organizationProfileDetails(organization = {}) {
  return [
    { key: 'college', label: '学院 / 系部', value: organization.college },
    { key: 'grade', label: '入学年级', value: organization.grade },
    { key: 'major', label: '专业', value: organization.major },
    { key: 'className', label: '班级', value: organization.className },
    { key: 'interestTags', label: '共同兴趣', value: Array.isArray(organization.interestTags) ? organization.interestTags.join('、') : '' }
  ].filter((item) => String(item.value || '').trim())
}

export function organizationProfileSummary(organization = {}) {
  return organizationProfileDetails(organization).map((item) => item.value).join(' · ')
}
