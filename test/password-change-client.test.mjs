import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
class ApiError extends Error { constructor(message, options={}) { super(message); Object.assign(this, options) } }
async function script(file, context, exports=[]) {
  context.isPageModuleEnabled ??= () => true
  context.isModuleEnabled ??= () => true
  let source = await fs.readFile(new URL('../'+file, import.meta.url), 'utf8')
  if (file.endsWith('.vue')) source = source.split('<script>')[1].split('</script>')[0]
  const code = source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?\n/gm, '').replace('export default', 'globalThis.options =').replace(/^export /gm, '')
  vm.runInNewContext(code + '\nObject.assign(globalThis, {' + exports.join(',') + '})', context)
  return context
}
async function helpers(overrides={}) { return script('utils/passwordChange.js', {getAccessToken:()=> 'token-a', getPlatformUser:()=> ({}), ...overrides}, ['initialPasswordError','enforceInitialPasswordChange','requiresInitialPasswordChange','INITIAL_PASSWORD_PAGE']) }
const valid = { currentPassword: 'Temporary123456', newPassword: 'MyOwnPassword2026!', confirmPassword: 'MyOwnPassword2026!' }

test('改密校验：确认一致、长度与UTF8上限、不能沿用旧密码，不剪裁密码', async () => {
  const h=await helpers()
  assert.equal(h.initialPasswordError(valid), '')
  assert.match(h.initialPasswordError({...valid,currentPassword:''}), /当前密码/)
  assert.match(h.initialPasswordError({...valid,newPassword:'short'}), /至少 8 位/)
  assert.match(h.initialPasswordError({...valid,newPassword:'中'.repeat(43)}), /128 字节/)
  assert.match(h.initialPasswordError({...valid,newPassword:valid.currentPassword}), /不能与当前/)
  assert.match(h.initialPasswordError({...valid,confirmPassword:'different'}), /不一致/)
  assert.equal(h.initialPasswordError({...valid,newPassword:' '+valid.newPassword,confirmPassword:' '+valid.newPassword}), '')
})

test('必须改密取真实平台会话，不依赖实名；导航单次、专页不循环、普通用户不拦截', async () => {
  let user={schoolIdentityVerified:false,mustChangePassword:true},route='pages/verify/index',token='a'; const calls=[]
  const h=await helpers({getPlatformUser:()=>user,getAccessToken:()=>token,getCurrentPages:()=>[{route}],uni:{reLaunch:o=>calls.push(o)}})
  assert.equal(h.requiresInitialPasswordChange(),true)
  assert.equal(h.enforceInitialPasswordChange(),true); assert.equal(h.enforceInitialPasswordChange(),true); assert.equal(calls.length,1)
  route='pages/change-password/index';calls[0].complete();h.enforceInitialPasswordChange();assert.equal(calls.length,1)
  user={mustChangePassword:false};assert.equal(h.enforceInitialPasswordChange(),false)
  token='';user={mustChangePassword:true};assert.equal(h.requiresInitialPasswordChange(),false)
})

test('store保留服务端mustChangePassword但不信任磁盘伪造profile，未实名仍可辨识待改密', async () => {
  const state=new Map(), key='isolated-auth'
  const h=await script('utils/store.js',{appConfig:{authStorageKey:key,identityFreshTtlMs:60000,localDevelopment:false},uni:{getStorageSync:k=>state.get(k),setStorageSync:(k,v)=>state.set(k,v),removeStorageSync:k=>state.delete(k),$emit(){}}},['getUser','getPlatformUser','saveAuthenticatedSession','clearAuthState'])
  state.set(key,{accessToken:'forged',user:{schoolIdentityVerified:true,mustChangePassword:false}})
  assert.equal(h.getPlatformUser().id,'')
  h.saveAuthenticatedSession({accessToken:'real',user:{id:'pending',username:'待实名人员',schoolIdentityVerified:false,mustChangePassword:true}})
  assert.equal(h.getUser().id,'');assert.equal(h.getPlatformUser().id,'pending');assert.equal(h.getPlatformUser().mustChangePassword,true)
  assert.equal(state.get(key).user,null)
  h.clearAuthState();assert.equal(h.getPlatformUser().mustChangePassword,false)
})

test('改密服务只发送绑定令牌和两个密码；确认不上传/不持久化，成功才清当前会话', async () => {
  const h=await helpers();let token='a',clears=0;const calls=[]
  const a=await script('services/schoolAuth.js',{ApiError,initialPasswordError:h.initialPasswordError,readAuthState:()=>({accessToken:token}),request:async q=>{calls.push(q);return {passwordChanged:true,loginRequired:true}},clearAuthState:()=>{token='';clears++},uni:{$emit(){}}},['changeInitialPassword','completeInitialPasswordChange'])
  await assert.rejects(a.changeInitialPassword({...valid,confirmPassword:'bad',token:'a'}),{code:'PASSWORD_VALIDATION_FAILED'});assert.equal(calls.length,0)
  await a.changeInitialPassword({...valid,token:'a'})
  assert.equal(calls[0].path,'/api/v1/auth/change-password');assert.equal(calls[0].method,'POST');assert.equal(calls[0].token,'a')
  assert.deepEqual(Object.keys(calls[0].data),['currentPassword','newPassword']);assert.equal(clears,0)
  assert.equal(a.completeInitialPasswordChange('a'),true);assert.equal(clears,1)
  token='b';assert.equal(a.completeInitialPasswordChange('a'),false);assert.equal(token,'b')
})

test('改密服务拒绝过时令牌及迟到换号响应，错误当前密码/网络异常不退出当前账号', async () => {
  const h=await helpers();let token='a',requests=0;const pending=deferred()
  const a=await script('services/schoolAuth.js',{ApiError,initialPasswordError:h.initialPasswordError,readAuthState:()=>({accessToken:token}),request:async()=>{requests++;return pending.promise}},['changeInitialPassword'])
  await assert.rejects(a.changeInitialPassword({...valid,token:'old'}),{code:'AUTH_SESSION_CHANGED'});assert.equal(requests,0)
  const response=a.changeInitialPassword({...valid,token:'a'});token='b';pending.resolve({passwordChanged:true,loginRequired:true})
  await assert.rejects(response,{code:'AUTH_SESSION_CHANGED'});assert.equal(token,'b')
  a.request=async()=>{throw new ApiError('当前密码错误',{code:'CURRENT_PASSWORD_INVALID'})}
  await assert.rejects(a.changeInitialPassword({...valid,token:'b'}),{code:'CURRENT_PASSWORD_INVALID'});assert.equal(token,'b')
  a.request=async()=>{throw new ApiError('网络不可用',{code:'NETWORK_ERROR'})}
  await assert.rejects(a.changeInitialPassword({...valid,token:'b'}),{code:'NETWORK_ERROR'});assert.equal(token,'b')
})

async function page(overrides={}) {
  const h=await helpers(), routes=[],events=new Map()
  const c=await script('pages/change-password/index.vue',{getAccessToken:()=> 'a',getPlatformUser:()=>({id:'person',username:'普通人员',mustChangePassword:true}),initialPasswordError:h.initialPasswordError,refreshPlatformProfile:async()=>({}),changeInitialPassword:async()=>({passwordChanged:true,loginRequired:true}),completeInitialPasswordChange:()=>true,logoutPlatformAccount:async()=>{},openPage:url=>routes.push(url),uni:{$on:(k,v)=>events.set(k,v),$off:k=>events.delete(k),reLaunch:o=>routes.push(o.url)},...overrides})
  const p={...c.options.data()};for(const[k,f]of Object.entries(c.options.methods))p[k]=f.bind(p)
  for(const[k,f]of Object.entries(c.options.computed||{}))Object.defineProperty(p,k,{get:()=>f.call(p)})
  p.active=true;return {p,options:c.options,routes,events}
}

test('改密页支持未实名强制与普通用户主动改密，资料页有真实入口，退出/未登录不做请求', async () => {
  const {p,options,routes}=await page();await p.load();assert.equal(p.ready,true);assert.equal(p.required,true);assert.equal(options.onBackPress.call(p),true)
  p.returnToProfile();assert.equal(routes.length,0)
  const {p:q,routes:qr}=await page({getPlatformUser:()=>({id:'normal',mustChangePassword:false})});await q.load();assert.equal(q.ready,true);assert.equal(q.required,false);q.returnToProfile();assert.deepEqual(qr,['/pages/profile/index'])
  let requests=0;const {p:g,routes:gr}=await page({getAccessToken:()=>'',refreshPlatformProfile:async()=>requests++});await g.load();assert.equal(requests,0);assert.deepEqual(gr,['/pages/verify/index'])
  const source=await fs.readFile(new URL('../pages/profile/index.vue',import.meta.url),'utf8');assert.match(source,/@tap="open\('\/pages\/change-password\/index'\)"/)
})

test('成功改密清空输入并注销返回登录，不自动保存密码或替用户重新登录；双击只有一请求', async () => {
  let submits=0,clears=0;const pending=deferred();const {p,routes}=await page({changeInitialPassword:async()=>{submits++;return pending.promise},completeInitialPasswordChange:()=>{clears++;return true}})
  await p.load();Object.assign(p,valid);const response=p.submit();await p.submit();assert.equal(submits,1)
  pending.resolve({passwordChanged:true,loginRequired:true});await response
  assert.equal(clears,1);assert.deepEqual(routes,['/pages/verify/index?changed=1']);assert.equal(p.currentPassword,'');assert.equal(p.newPassword,'');assert.equal(p.confirmPassword,'')
})

test('改密页离开或换号后丢弃响应，清除密码，不注销/跳走新会话', async () => {
  for (const change of ['hide','account']) {
    let token='a',clears=0;const pending=deferred(),{p,routes}=await page({getAccessToken:()=>token,changeInitialPassword:()=>pending.promise,completeInitialPasswordChange:()=>{clears++;return true}})
    await p.load();Object.assign(p,valid);const response=p.submit()
    if(change==='hide')p.stop();else {token='b';p.authChanged()}
    pending.resolve({passwordChanged:true,loginRequired:true});await response
    assert.equal(clears,0);assert.equal(routes.length,0);assert.equal(p.currentPassword,'');assert.equal(p.newPassword,'')
  }
})

test('当前密码错误后保留改密入口且清理输入，断网确认不伪造可改状态', async () => {
  const {p,routes}=await page({changeInitialPassword:async()=>{throw new ApiError('当前密码错误',{code:'CURRENT_PASSWORD_INVALID'})}})
  await p.load();Object.assign(p,valid);await p.submit();assert.equal(p.ready,true);assert.equal(p.required,true);assert.equal(p.saving,false);assert.equal(p.currentPassword,'');assert.match(p.error,/当前密码错误/);assert.equal(routes.length,0)
  const {p:q}=await page({refreshPlatformProfile:async()=>{throw Error('网络不可用')}});await q.load();assert.equal(q.ready,false);assert.match(q.error,/网络不可用/)
})

test('退出按钮不能因旧页面换号而退出新账号，正常退出立即返回不等待网络', async () => {
  let token='a',logouts=0;const pending=deferred(),{p,routes}=await page({getAccessToken:()=>token,logoutPlatformAccount:()=>{logouts++;return pending.promise}})
  await p.load();token='b';await p.signOut();assert.equal(logouts,0);assert.equal(routes.length,0)
  await p.load();p.ownerToken='b';const signingOut=p.signOut();assert.equal(logouts,1);assert.deepEqual(routes,['/pages/verify/index'])
  pending.resolve();await signingOut
})

test('登录成功分支先引导改密，不显示普通登录成功或跳我的；恢复/me也检查强制状态', async () => {
  const c=await script('pages/verify/index.vue',{appConfig:{localDevelopment:false},getUser:()=>({}),isVerified:()=>false,loginPlatformAccount:async()=>({user:{mustChangePassword:true}}),enforceInitialPasswordChange:()=>true,uni:{showToast(){throw Error('should not show normal success')}},setTimeout(){throw Error('should not schedule normal navigation')}})
  const p={...c.options.data(),canSubmit:true,username:'待实名人员',password:'Temporary123456'};for(const[k,f]of Object.entries(c.options.methods))p[k]=f.bind(p)
  await p.submit();assert.equal(p.password,'');assert.equal(p.loading,false)
  let checks=0;const app=await script('App.vue',{refreshPlatformProfile:async()=>({mustChangePassword:true}),enforceInitialPasswordChange:()=>checks++})
  await app.options.methods.bootstrapAuth.call({authBootstrapping:false});assert.equal(checks,1)
})

test('通用导航和桌面对话不绕过待改密守卫', async () => {
  let navigations=0
  const h=await script('utils/nav.js',{INITIAL_PASSWORD_PAGE:'/pages/change-password/index',enforceInitialPasswordChange:()=>true,requestDesktopChat:()=>{throw Error('must not open chat')},uni:{navigateTo(){navigations++},switchTab(){navigations++}}},['openPage'])
  h.openPage('/pages/chat/index');h.openPage('/pages/profile/index');assert.equal(navigations,0)
  h.openPage('/pages/change-password/index');assert.equal(navigations,1)
  const c=await script('components/DesktopChatDock.vue',{ConversationList:{},ChatThread:{},enforceInitialPasswordChange:()=>true})
  c.options.methods.requestOpen.call({desktop:true,chatEnabled:true,authChanged(){throw Error('must not open panel')}},{detail:{}})
})
