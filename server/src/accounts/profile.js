import { auditRecord } from '../audit/metadata.js'

export const educationKeys = ['major', 'className', 'enrollmentYear', 'graduationYear', 'expectedGraduationYear']
const limits = { major:120, className:80, enrollmentYear:4, graduationYear:4, expectedGraduationYear:4, city:80, regionCode:50, phone:32, email:160, bio:500 }
const fail = (message, code = 'PROFILE_INVALID', statusCode = 400) => Object.assign(new Error(message), { code, statusCode })
export function educationSnapshot(source = {}) {
  return Object.fromEntries(educationKeys.map(key => [key, String(source[key] || '').trim().slice(0, limits[key])]).filter(([,value]) => value))
}
export function selfProfile(account) {
  const extra = account.personalProfile || {}
  const fields = Object.fromEntries(Object.keys(limits).map(key => [key, String((educationKeys.includes(key) ? account[key] : extra[key]) || '')]))
  // Administrator supplements carry their exact values. A later changed school
  // value must not inherit the old supplement's provenance or graduation flag.
  const supplement=account.educationSupplement?.source==='explicit-user-request' ? account.educationSupplement : null
  const educationSupplementedFields=supplement ? educationKeys.filter(key=>fields[key]&&fields[key]===supplement.fields?.[key]) : []
  const graduationYearConfirmed=supplement?.graduationYearConfirmed===true&&educationSupplementedFields.includes('graduationYear')
  if(account.personType==='student'&&!graduationYearConfirmed)fields.expectedGraduationYear=fields.expectedGraduationYear || fields.graduationYear
  return { accountId:account.id, name:account.name, username:account.username, personType:account.personType, department:account.department || '', studentIdMasked:account.studentIdMasked || '', alumniNo:account.alumniNo || '', schoolIdentityVerified:account.schoolIdentityVerified === true, verificationSource:account.verificationSource || '', fields, lockedFields:[...educationKeys], educationSupplementedFields, graduationYearConfirmed, educationSyncedAt:account.educationSyncedAt || account.schoolIdentityVerifiedAt || null, revision:Number(account.profileRevision || 0), updatedAt:account.profileUpdatedAt || null }
}
export async function updateSelfProfile(database, id, input, metadata, regions) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['revision', 'fields'].includes(key))) throw fail('只能更新本人的补充资料')
  const fields = input.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !Object.hasOwn(limits,key))) throw fail('包含不允许修改的资料字段')
  return database.transaction(state => {
    const account = state.accounts.find(row => row.id === id && row.status === 'active')
    if (!account) throw fail('请重新登录', 'ACCOUNT_INACTIVE', 401)
    if (!Number.isInteger(input.revision) || input.revision !== Number(account.profileRevision || 0)) throw fail('资料已在其他页面更新，请刷新后再保存', 'PROFILE_CONFLICT', 409)
    const next = { ...account.personalProfile }, changed = []
    for (const [key, value] of Object.entries(fields)) {
      if (educationKeys.includes(key)) throw fail('学籍资料仅由学校统一认证或授权人工复核提供，不能自行修改', 'PROFILE_VERIFIED_FIELD_LOCKED')
      if (typeof value !== 'string' || value.length > limits[key] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw fail('资料格式或长度不正确')
      const text = value.trim()
      if (key.endsWith('Year') && text && (!/^\d{4}$/.test(text) || Number(text)<1900 || Number(text)>new Date().getFullYear()+10)) throw fail('请填写有效的四位年份')
      if (key === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw fail('邮箱格式不正确')
      next[key] = text
      if (text !== (account.personalProfile?.[key] || '')) changed.push(key)
    }
    if(regions)Object.assign(next,regions.selection(fields,account.personalProfile||{}))
    account.personalProfile=next; account.profileRevision=Number(account.profileRevision || 0)+1; account.profileUpdatedAt=new Date().toISOString()
    state.auditLogs.unshift(auditRecord('account.profile_updated',id,metadata,{fields:changed,revision:account.profileRevision}))
    return selfProfile(account)
  })
}
