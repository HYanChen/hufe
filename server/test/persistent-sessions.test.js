import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {JsonDatabase} from '../src/storage/json-database.js'
import {AuthSessionStore} from '../src/auth/session-store.js'
import {AccountService} from '../src/accounts/service.js'
import {hashPassword} from '../src/auth/crypto.js'
import {createConfig} from '../src/config.js'
import {buildApp} from '../src/app.js'

const deviceA='device_0123456789abcdef0123456789abcdef',deviceB='device_fedcba9876543210fedcba9876543210'
const password='IsolatedSession2026!'
const contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({}),list:()=>({items:[]})}
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-session-'))
  t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const config=createConfig({env:'test',dataFile:path.join(dir,'data.json'),dataHashSecret:'isolated-session-test'})
  const database=await new JsonDatabase(config.dataFile).init(),passwordHash=await hashPassword(password)
  await database.transaction(s=>{s.accounts=['member','admin'].map(id=>({id,username:'qa_'+id,usernameNormalized:'qa_'+id,name:'隔离'+id,schoolSubjectKey:'qa-subject-'+id,status:'active',isAdmin:id==='admin',passwordHash,credentialRevision:0}))})
  const accounts=new AccountService(database,config),sessions=new AuthSessionStore(config,{database})
  return {dir,config,database,accounts,sessions,member:accounts.getActiveAccount('member')}
}
const token=result=>result.accessToken

test('真实持久会话只保存hash，无自动时间退出，服务器重启保留同一令牌',async t=>{
  const f=await fixture(t),issued=await f.sessions.issueLogin(f.member,deviceA)
  assert.equal(issued.expiresAt,null);assert.deepEqual(issued.sessionPolicy,{persistent:true,singleDevice:true,expiresAutomatically:false})
  const serialized=await fs.readFile(f.config.dataFile,'utf8')
  for(const secret of [token(issued),deviceA,password])assert.ok(!serialized.includes(secret))
  const restarted=new AuthSessionStore(f.config,{database:await new JsonDatabase(f.config.dataFile).init()})
  t.mock.method(Date,'now',()=>Date.UTC(2200,0,1))
  assert.equal(restarted.authenticate(token(issued)).id,'member')
  assert.equal(restarted.authenticate(token(issued)).credentialRevision,0)
})

test('同设备真实重登保留已有标签令牌，换设备撤销全部旧设备且重启后仍撤销',async t=>{
  const f=await fixture(t),first=await f.sessions.issueLogin(f.member,deviceA),second=await f.sessions.issueLogin(f.member,deviceA)
  assert.equal(f.sessions.authenticate(token(first)).id,'member');assert.equal(f.sessions.authenticate(token(second)).id,'member')
  const third=await f.sessions.issueLogin(f.member,deviceB)
  for(const old of [first,second])assert.throws(()=>f.sessions.authenticate(token(old)),{code:'SESSION_REPLACED'})
  assert.equal(f.sessions.authenticate(token(third)).id,'member')
  const restarted=new AuthSessionStore(f.config,{database:await new JsonDatabase(f.config.dataFile).init()})
  assert.throws(()=>restarted.authenticate(token(first)),{code:'SESSION_REPLACED'})
  assert.equal(restarted.authenticate(token(third)).id,'member')
  assert.equal(f.database.read(s=>s.authDeviceSessions.length),1)
})

test('较旧密码请求迟到不能抢回已成功的新设备，错误密码及无效设备不踢当前用户',async t=>{
  const f=await fixture(t),older=f.sessions.beginLogin(),newer=f.sessions.beginLogin()
  const current=await f.sessions.issueLogin(f.member,deviceB,{},newer)
  await assert.rejects(f.sessions.issueLogin(f.member,deviceA,{},older),{code:'LOGIN_SUPERSEDED'})
  await assert.rejects(f.accounts.login({username:'qa_member',password:'WrongPassword123',deviceId:deviceA}),{code:'INVALID_CREDENTIALS'})
  await assert.rejects(f.sessions.issueLogin(f.member,'x'),{code:'DEVICE_ID_INVALID'})
  assert.equal(f.sessions.authenticate(token(current)).id,'member')
})

test('主动退出只结束对应活动设备，旧设备迟到退出不会注销新登录，退出阻断未签发请求',async t=>{
  const f=await fixture(t),first=await f.sessions.issueLogin(f.member,deviceA),second=await f.sessions.issueLogin(f.member,deviceA)
  const inFlight=f.sessions.beginLogin()
  await f.sessions.revoke(token(first))
  assert.throws(()=>f.sessions.authenticate(token(second)),{code:'SESSION_REVOKED'})
  await assert.rejects(f.sessions.issueLogin(f.member,deviceA,{},inFlight),{code:'LOGIN_SUPERSEDED'})
  const current=await f.sessions.issueLogin(f.member,deviceB)
  await f.sessions.revoke(token(first))
  assert.equal(f.sessions.authenticate(token(current)).id,'member')
  const restarted=new AuthSessionStore(f.config,{database:await new JsonDatabase(f.config.dataFile).init()})
  assert.throws(()=>restarted.authenticate(token(first)),{code:'SESSION_REVOKED'})
})

test('停用再启用、注销和改密均拒绝旧会话；旧凭据快照不能补签新token',async t=>{
  const f=await fixture(t),issued=await f.sessions.issueLogin(f.member,deviceA)
  await f.accounts.setAccountStatus('member','suspended',{actor:'admin'})
  assert.throws(()=>f.sessions.authenticate(token(issued)),{code:'ACCOUNT_INACTIVE'})
  await f.accounts.setAccountStatus('member','active',{actor:'admin'})
  assert.throws(()=>f.sessions.authenticate(token(issued)),{code:'CREDENTIALS_CHANGED'})
  await assert.rejects(f.sessions.issueLogin(f.member,deviceA),{code:'CREDENTIALS_CHANGED'})
  let member=f.accounts.getActiveAccount('member'),current=await f.sessions.issueLogin(member,deviceA)
  await f.accounts.changePassword('member',password,'NewSessionPassword2026!')
  assert.throws(()=>f.sessions.authenticate(token(current)),{code:'CREDENTIALS_CHANGED'})
  member=f.accounts.getActiveAccount('member');current=await f.sessions.issueLogin(member,deviceA)
  await f.accounts.deactivateSelf('member','确认注销账号',{actor:'member'})
  assert.throws(()=>f.sessions.authenticate(token(current)),{code:'ACCOUNT_INACTIVE'})
})

test('持久化失败不发布新令牌、不踢旧设备；同设备令牌数量有界且audit不记录凭证',async t=>{
  const f=await fixture(t),old=await f.sessions.issueLogin(f.member,deviceA),persist=f.database.persist.bind(f.database)
  f.database.persist=async()=>{throw Error('isolated write failure')}
  await assert.rejects(f.sessions.issueLogin(f.member,deviceB),/write failure/)
  assert.equal(f.sessions.authenticate(token(old)).id,'member');f.database.persist=persist
  for(let i=0;i<34;i++)await f.sessions.issueLogin(f.member,deviceA)
  assert.equal(f.database.read(s=>s.authDeviceSessions[0].tokens.length),32)
  const audit=JSON.stringify(f.database.read(s=>s.auditLogs))
  assert.ok(!audit.includes(token(old)));assert.ok(!audit.includes(deviceA))
})

test('真实HTTP登录持久化、游客边界、错误密码、跨设备退出与服务器重启',async t=>{
  const f=await fixture(t)
  let app=await buildApp({config:f.config,logger:false,contentService,refreshContent:false,scheduleContent:false})
  t.after(()=>app.close())
  const login=(deviceId,pass=password)=>app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'qa_member',password:pass,deviceId}})
  const me=value=>app.inject({url:'/api/v1/me',headers:value?{authorization:'Bearer '+value}:{}})
  assert.equal((await me()).statusCode,401)
  const initial=await login(deviceA);assert.equal(initial.statusCode,200,initial.body)
  const first=initial.json().data.accessToken;assert.equal(initial.headers['cache-control'],'private, no-store')
  assert.equal((await me(first)).statusCode,200)
  assert.equal((await login(deviceB,'WrongPassword2026!')).statusCode,401)
  assert.equal((await me(first)).statusCode,200)
  const second=(await login(deviceB)).json().data.accessToken
  assert.equal((await me(first)).json().code,'SESSION_REPLACED')
  assert.equal((await me(second)).statusCode,200)
  await app.close();app=await buildApp({config:f.config,logger:false,contentService,refreshContent:false,scheduleContent:false})
  assert.equal((await me(second)).statusCode,200)
  const logout=await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{authorization:'Bearer '+second}})
  assert.equal(logout.statusCode,200,logout.body);assert.equal((await me(second)).statusCode,401)
})
