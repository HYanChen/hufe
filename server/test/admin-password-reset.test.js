import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {JsonDatabase} from '../src/storage/json-database.js'
import {AccountService} from '../src/accounts/service.js'
import {PasswordResetService} from '../src/accounts/password-reset.js'
import {AuthSessionStore} from '../src/auth/session-store.js'
import {hashPassword,verifyPassword} from '../src/auth/crypto.js'
import {createConfig} from '../src/config.js'
import {buildApp} from '../src/app.js'

const oldPassword='IsolatedOld2026!',nextPassword='IsolatedNext2026!'
const input=(extra={})=>({newPassword:nextPassword,confirmPassword:nextPassword,reason:'隔离测试用户忘记平台密码',expectedRevision:0,confirmation:'确认修改该账号密码',...extra})
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-reset-')),config=createConfig({env:'test',dataFile:path.join(dir,'data.json'),dataHashSecret:'password-test-only'})
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));const database=await new JsonDatabase(config.dataFile).init(),passwordHash=await hashPassword(oldPassword)
  await database.transaction(state=>{state.accounts=['admin','second','member','delegate','suspended'].map(id=>({id,username:'qa_'+id,usernameNormalized:'qa_'+id,name:'隔离'+id,isAdmin:['admin','second','delegate'].includes(id),...(id==='delegate'?{adminRole:'delegated_admin'}:{}),passwordHash,status:id==='suspended'?'suspended':'active',schoolSubjectKey:'qa-id-'+id,credentialRevision:0}))})
  const accounts=new AccountService(database,config),sessions=new AuthSessionStore(config),service=new PasswordResetService(accounts,sessions)
  return {dir,config,database,accounts,sessions,service,admin:accounts.getActiveAccount('admin')}
}

test('管理员单账号重置保存哈希，递增账号版本，撤销全部旧会话并要求本人改密，审计无口令',async t=>{
  const f=await fixture(t),old=f.sessions.issueAccess(f.accounts.getActiveAccount('member')),other=f.sessions.issueAccess(f.accounts.getActiveAccount('member')),adminToken=f.sessions.issueAccess(f.admin)
  const result=await f.service.reset(f.admin,'member',input())
  assert.deepEqual(result,{accountId:'member',revision:1,passwordChanged:true,mustChangePassword:true,loginRequired:false})
  assert.throws(()=>f.sessions.authenticate(old.accessToken));assert.throws(()=>f.sessions.authenticate(other.accessToken));assert.equal(f.sessions.authenticate(adminToken.accessToken).id,'admin')
  const row=f.database.read(s=>s.accounts.find(a=>a.id==='member'));assert.equal(await verifyPassword(nextPassword,row.passwordHash),true);assert.equal(row.credentialRevision,1)
  const safe=f.accounts.listAccounts().items.find(a=>a.id==='member');assert.equal(safe.revision,1);assert.equal(safe.passwordHash,undefined)
  const stored=await fs.readFile(f.config.dataFile,'utf8');assert.ok(!stored.includes(nextPassword));assert.ok(!stored.includes(oldPassword));assert.ok(!JSON.stringify(result).includes(nextPassword))
  const audit=f.database.read(s=>s.auditLogs.at(0));assert.equal(audit.action,'account.admin_password_reset');assert.equal(audit.actor,'admin');assert.equal(audit.details.reason,input().reason)
  await assert.rejects(f.accounts.login({username:'qa_member',password:oldPassword}),{code:'INVALID_CREDENTIALS'})
  assert.equal((await f.accounts.login({username:'qa_member',password:nextPassword})).mustChangePassword,true)
})

test('普通、delegated污染isAdmin、过期凭据与临时密码管理员均禁止重置',async t=>{
  const f=await fixture(t)
  for(const id of ['member','delegate'])await assert.rejects(f.service.reset(f.accounts.getActiveAccount(id),'member',input()),{code:'ADMIN_PERMISSION_DENIED'})
  await assert.rejects(f.service.reset({...f.admin,credentialRevision:99},'member',input()),{code:'CREDENTIALS_CHANGED'})
  await f.database.transaction(s=>{s.accounts.find(a=>a.id==='admin').mustChangePassword=true})
  await assert.rejects(f.service.reset(f.admin,'member',input()),{code:'ADMIN_PERMISSION_DENIED'})
})

test('密码强度、重复输入、理由、确认、有效目标与版本缺一不可，失败不修改账号',async t=>{
  const f=await fixture(t),before=await fs.readFile(f.config.dataFile,'utf8')
  for(const extra of [{newPassword:'abcdefgh',confirmPassword:'abcdefgh'},{newPassword:'12345678',confirmPassword:'12345678'},{newPassword:'Tiny1',confirmPassword:'Tiny1'},{newPassword:'A1'+'中'.repeat(50),confirmPassword:'A1'+'中'.repeat(50)},{confirmPassword:'Mismatch123'},{reason:''},{reason:'原因'+nextPassword},{confirmation:''},{expectedRevision:7},{newPassword:oldPassword,confirmPassword:oldPassword},{isAdmin:true}])await assert.rejects(f.service.reset(f.admin,'member',input(extra)))
  for(const id of ['missing','suspended'])await assert.rejects(f.service.reset(f.admin,id,input()),{code:'ACCOUNT_RESET_UNAVAILABLE'})
  assert.equal(await fs.readFile(f.config.dataFile,'utf8'),before)
})

test('本人重置要求当前密码，成功不再强制临时改密，但必须重新登录',async t=>{
  const f=await fixture(t),token=f.sessions.issueAccess(f.admin)
  await assert.rejects(f.service.reset(f.admin,'admin',input()),{code:'CURRENT_PASSWORD_INVALID'})
  const response=await f.service.reset(f.admin,'admin',input({currentPassword:oldPassword}));assert.equal(response.loginRequired,true);assert.equal(response.mustChangePassword,false);assert.throws(()=>f.sessions.authenticate(token.accessToken))
  assert.equal((await f.accounts.login({username:'qa_admin',password:nextPassword})).credentialRevision,1)
})

test('哈希计算期间权限撤销与并发状态变更在事务提交时重新校验',async t=>{
  const f=await fixture(t),pending=f.service.reset(f.admin,'member',input())
  await f.database.transaction(s=>{s.accounts.find(a=>a.id==='admin').adminRole='delegated_admin'})
  await assert.rejects(pending,{code:'ADMIN_PERMISSION_DENIED'})
  const second=f.accounts.getActiveAccount('second'),racing=f.service.reset(second,'member',input())
  await f.accounts.setAccountStatus('member','suspended',{actor:'second'});await f.accounts.setAccountStatus('member','active',{actor:'second'})
  await assert.rejects(racing,{code:'ACCOUNT_REVISION_CONFLICT'});assert.equal(await verifyPassword(oldPassword,f.database.read(s=>s.accounts.find(a=>a.id==='member').passwordHash)),true)
})

test('并发重置只有一个版本成功，数据库落盘失败不撤销旧会话',async t=>{
  const f=await fixture(t),results=await Promise.allSettled([f.service.reset(f.admin,'member',input()),f.service.reset(f.accounts.getActiveAccount('second'),'member',input())])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'ACCOUNT_REVISION_CONFLICT')
  const token=f.sessions.issueAccess(f.accounts.getActiveAccount('second')),persist=f.database.persist.bind(f.database)
  f.database.persist=async()=>{throw Error('isolated disk failure')}
  await assert.rejects(f.service.reset(f.admin,'second',input()),/disk failure/);f.database.persist=persist
  assert.equal(f.sessions.authenticate(token.accessToken).id,'second');assert.equal(await verifyPassword(oldPassword,f.database.read(s=>s.accounts.find(a=>a.id==='second').passwordHash)),true)
})

test('旧密码校验与本人改密开始后发生重置，不允许迟到操作覆盖新密码或完成旧密码登录',async t=>{
  const f=await fixture(t),replacement=await hashPassword(nextPassword)
  let waiting=f.accounts.login({username:'qa_member',password:oldPassword})
  await f.database.transaction(s=>{s.accounts.find(a=>a.id==='member').passwordHash=replacement})
  await assert.rejects(waiting,{code:'CREDENTIALS_CHANGED'})
  waiting=f.accounts.changePassword('second',oldPassword,'OtherReplacement2026!')
  await f.database.transaction(s=>{s.accounts.find(a=>a.id==='second').passwordHash=replacement})
  await assert.rejects(waiting,{code:'CREDENTIALS_CHANGED'})
})

test('完整HTTP重置：无权限和污染授权拦截、实际旧会话退出、新密码登录改密、迟签旧版本令牌无效',async t=>{
  const f=await fixture(t),contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({}),list:()=>({items:[]})}
  const app=await buildApp({config:f.config,logger:false,refreshContent:false,scheduleContent:false,contentService});t.after(()=>app.close())
  const account=id=>app.services.accounts.getActiveAccount(id),sessions=app.services.sessions,oldAccount=account('member')
  const tokens=Object.fromEntries(['admin','member','delegate'].map(id=>[id,sessions.issueAccess(account(id)).accessToken]))
  const call=(id,method,url,payload)=>app.inject({method,url:'/api/v1'+url,headers:id?{authorization:'Bearer '+tokens[id]}:{},...(payload?{payload}:{})})
  assert.equal((await call(null,'POST','/admin/accounts/member/password',input())).statusCode,401)
  for(const id of ['member','delegate'])assert.equal((await call(id,'POST','/admin/accounts/member/password',input())).statusCode,403)
  const response=await call('admin','POST','/admin/accounts/member/password',input());assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'private, no-store');assert.ok(!response.body.includes(nextPassword))
  assert.equal((await call('member','GET','/me')).statusCode,401)
  tokens.member=sessions.issueAccess(oldAccount).accessToken;assert.equal((await call('member','GET','/me')).statusCode,401)
  const login=await call(null,'POST','/auth/login',{username:'qa_member',password:nextPassword});assert.equal(login.statusCode,200,login.body);assert.equal(login.json().data.user.mustChangePassword,true);tokens.member=login.json().data.accessToken
  const changed=await call('member','POST','/auth/change-password',{currentPassword:nextPassword,newPassword:'OwnFinalPassword2026!'});assert.equal(changed.statusCode,200,changed.body);assert.equal((await call('member','GET','/me')).statusCode,401)
  const own=await call('admin','POST','/admin/accounts/admin/password',input({currentPassword:oldPassword}));assert.equal(own.statusCode,200,own.body);assert.equal(own.json().data.loginRequired,true);assert.equal((await call('admin','GET','/admin/accounts')).statusCode,401)
  const audit=await app.services.audit.list({});assert.ok(audit.items.some(r=>r.details.label==='全局管理员修改单个账号平台密码'));assert.ok(!JSON.stringify(audit).includes(nextPassword));assert.ok(!JSON.stringify(audit).includes(oldPassword))
})

test('重置撤销真实持久登录，服务重启后旧设备凭据仍然无效且新口令可重新登录',async t=>{
  const f=await fixture(t),contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({}),list:()=>({items:[]})}
  const options={config:f.config,logger:false,refreshContent:false,scheduleContent:false,contentService}
  let app=await buildApp(options);t.after(()=>app.close())
  const call=(method,url,payload,token)=>app.inject({method,url:'/api/v1'+url,headers:token?{authorization:'Bearer '+token}:{},...(payload?{payload}:{})})
  const login=async(username,password)=>call('POST','/auth/login',{username,password,deviceId:'isolated_password_device_'+username})
  const admin=(await login('qa_admin',oldPassword)).json().data.accessToken
  const member=(await login('qa_member',oldPassword)).json().data.accessToken
  const secondMember=(await login('qa_member',oldPassword)).json().data.accessToken
  assert.equal((await call('GET','/me',null,member)).statusCode,200)
  assert.ok(app.services.database.read(s=>s.authDeviceSessions.some(row=>row.accountId==='member')))
  const changed=await call('POST','/admin/accounts/member/password',input(),admin);assert.equal(changed.statusCode,200,changed.body)
  assert.equal(app.services.database.read(s=>s.authDeviceSessions.some(row=>row.accountId==='member')),false)
  for(const token of [member,secondMember])assert.equal((await call('GET','/me',null,token)).statusCode,401)
  const file=await fs.readFile(f.config.dataFile,'utf8');for(const value of [member,secondMember,admin,nextPassword])assert.ok(!file.includes(value))
  await app.close();app=await buildApp(options)
  for(const token of [member,secondMember])assert.equal((await call('GET','/me',null,token)).statusCode,401)
  assert.equal((await call('GET','/me',null,admin)).statusCode,200)
  const next=await login('qa_member',nextPassword);assert.equal(next.statusCode,200,next.body);assert.equal(next.json().data.user.mustChangePassword,true)
})
