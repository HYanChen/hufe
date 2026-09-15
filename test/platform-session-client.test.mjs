import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

async function store(){
  const values=new Map(),source=(await fs.readFile(new URL('../utils/store.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'')
  const ctx={appConfig:{authStorageKey:'auth',identityFreshTtlMs:300000,localDevelopment:false},uni:{getStorageSync:key=>values.get(key),setStorageSync:(key,value)=>values.set(key,value),removeStorageSync:key=>values.delete(key)}}
  vm.runInNewContext(source+'\nglobalThis.testStore={getUser,getPlatformUser,isVerified,isSchoolVerified,isSignedIn,saveAuthenticatedSession,clearAuthState,getAccessToken};',ctx)
  return{...ctx.testStore,values}
}
test('运营保安账号登录与学校实名分开判断，不把已登录人员当游客也不放宽实名权限',async()=>{
  const s=await store();s.saveAuthenticatedSession({accessToken:'guard-token',user:{id:'guard',username:'qa_guard',name:'核验保安',personType:'member',schoolIdentityVerified:false}})
  assert.equal(s.isSignedIn(),true);assert.equal(s.getPlatformUser().realName,'核验保安');assert.equal(s.getPlatformUser().username,'qa_guard')
  assert.equal(s.isVerified(),false);assert.equal(s.isSchoolVerified(),false);assert.equal(s.getUser().personType,'guest')
  s.clearAuthState();assert.equal(s.isSignedIn(),false);assert.equal(s.getPlatformUser().realName,'')
})
test('仅伪造持久化用户或切换令牌不能伪装已登录平台人员',async()=>{
  const s=await store();s.values.set('auth',{accessToken:'forged',user:{name:'伪造用户',schoolIdentityVerified:true}})
  assert.equal(s.isSignedIn(),false);assert.equal(s.getPlatformUser().realName,'')
  s.saveAuthenticatedSession({accessToken:'a',user:{id:'member',name:'实名校友',schoolIdentityVerified:true}});assert.equal(s.isSignedIn(),true);assert.equal(s.isSchoolVerified(),true)
  s.values.set('auth',{accessToken:'b'});assert.equal(s.isSignedIn(),false);assert.equal(s.getPlatformUser().realName,'')
})
