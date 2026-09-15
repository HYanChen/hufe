import {hmac} from '../auth/crypto.js'
export const manualVerificationSources = ['manual-identity-review','platform-admin-confirmed','admin-personnel-review']
export function verificationStatus(account){return !account.schoolIdentityVerified?'unverified':manualVerificationSources.includes(account.verificationSource)?'manual':'school'}
const fail=message=>Object.assign(new Error(message),{statusCode:400,code:'ACCOUNT_FILTER_INVALID'})
export function filterAccounts(accounts,input={},secret){
  const fields=['department','major','className','enrollmentYear','graduationYear','expectedGraduationYear','personType','status','verification']
  const filters=Object.fromEntries(fields.map(k=>[k,String(input[k]||'').trim()]))
  if(Object.values(filters).some(v=>v.length>160))throw fail('筛选条件过长')
  if(filters.status&&!['active','suspended','deactivated'].includes(filters.status)||filters.personType&&!['student','alumni','faculty','staff','member'].includes(filters.personType)||filters.verification&&!['school','manual','unverified'].includes(filters.verification))throw fail('身份、认证或账号状态筛选值无效')
  for(const key of ['enrollmentYear','graduationYear','expectedGraduationYear'])if(filters[key]&&!/^\d{4}$/.test(filters[key]))throw fail('年份筛选须为四位年份')
  const raw=String(input.query||'').trim().slice(0,160),needle=raw.toLowerCase(),studentKey=raw&&secret?hmac(`student-id:${raw.replace(/\s+/g,'')}`,secret):''
  return accounts.filter(a=>fields.every(key=>!filters[key]||(key==='verification'?verificationStatus(a):String(a[key]||''))===filters[key])&&(!needle||studentKey&&a.studentIdKey===studentKey||[a.username,a.name,a.department,a.major,a.className,a.studentIdMasked,a.personType].some(v=>String(v||'').toLowerCase().includes(needle))))
}
export function accountFilterOptions(accounts,input={}){
  const unique=values=>[...new Set(values.map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'))
  const department=String(input.department||''),major=String(input.major||'')
  return {departments:unique(accounts.map(a=>a.department)),majors:unique(accounts.filter(a=>!department||a.department===department).map(a=>a.major)),classes:unique(accounts.filter(a=>(!department||a.department===department)&&(!major||a.major===major)).map(a=>a.className)),enrollmentYears:unique(accounts.map(a=>a.enrollmentYear)).reverse(),graduationYears:unique(accounts.map(a=>a.graduationYear)).reverse(),expectedGraduationYears:unique(accounts.map(a=>a.expectedGraduationYear)).reverse()}
}
