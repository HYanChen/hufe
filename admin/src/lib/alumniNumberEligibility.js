export function canIssueAlumniNumber(account){
  if(!account||account.status!=='active'||account.schoolIdentityVerified!==true||String(account.alumniNo||'').trim())return false
  if(account.localDevelopmentOnly===true||account.developmentSchoolIdentityFixture===true||account.isDemo===true||account.isMock===true)return false
  return ![account.accountSource,account.verificationSource].some(value=>/^(?:local-development|demo|mock)(?:[-_:]|$)/i.test(String(value||'')))
}
