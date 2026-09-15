export function canManuallyVerifyAccount(account){
  if(!account||account.status!=='active'||(account.accountSource||account.source)!=='admin_personnel'||account.schoolIdentityVerified)return false
  if(account.isAdmin||account.isSuperAdmin||account.localDevelopmentOnly||account.developmentSchoolIdentityFixture)return false
  if([account.adminRole,account.role].some(role=>['admin','super_admin'].includes(role)))return false
  return true
}
