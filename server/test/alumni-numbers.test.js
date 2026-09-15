import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {JsonDatabase} from '../src/storage/json-database.js'
import {AccountService} from '../src/accounts/service.js'
import {AlumniNumberService} from '../src/accounts/alumni-numbers.js'
import {hashPassword} from '../src/auth/crypto.js'
import {createConfig} from '../src/config.js'
import {buildApp} from '../src/app.js'

const password='IsolatedNumbers2026!',reason='根据本次实名人员校友服务编号下发安排'
const single=(extra={})=>({expectedRevision:0,reason,confirmation:'确认下发校友编号',...extra})
const apply=(token,extra={})=>({token,reason,confirmation:'确认批量下发校友编号',...extra})
const contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({}),list:()=>({items:[]})}
async function fixture(t,options={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-alumni-numbers-'))
  t.after(()=>fs.rm(directory,{recursive:true,force:true}))
  const config=createConfig({env:'test',dataFile:path.join(directory,'data.json'),dataHashSecret:'isolated-alumni-numbers-secret'})
  const database=await new JsonDatabase(config.dataFile).init(),passwordHash=await hashPassword(password)
  const account=(id,extra={})=>({id,username:'qa_'+id,usernameNormalized:'qa_'+id,name:'隔离'+id,department:'隔离学院',personType:'member',status:'active',schoolIdentityVerified:true,alumniStatusVerified:false,passwordHash,schoolSubjectKey:'qa-'+id,credentialRevision:0,...extra})
  await database.transaction(state=>{
    state.accounts=[account('admin',{isAdmin:true,alumniNo:'EXISTING-ADMIN'}),account('other-admin',{isAdmin:true,alumniNo:'EXISTING-OTHER'}),...['student','alumni','faculty','staff','member'].map(personType=>account(personType,{personType,mustChangePassword:true})),account('assigned',{alumniNo:'SCHOOL-ORIGINAL'}),account('pending',{schoolIdentityVerified:false}),account('suspended',{status:'suspended'}),account('deactivated',{status:'deactivated'}),account('demo',{localDevelopmentOnly:true})]
  })
  const accounts=new AccountService(database,config),actor=accounts.getActiveAccount('admin'),service=new AlumniNumberService(accounts,options)
  return {config,database,accounts,actor,service,read:id=>database.read(state=>state.accounts.find(account=>account.id===id))}
}

test('只读预览固定所有已实名人员并区分跳过原因，样本不含密码或稳定身份索引',async t=>{
  const f=await fixture(t),before=await fs.readFile(f.config.dataFile,'utf8'),preview=f.service.preview(f.actor)
  assert.equal(preview.scope,'all_verified');assert.equal(preview.total,12);assert.equal(preview.eligible,5);assert.equal(preview.skipped,7)
  assert.deepEqual(preview.skippedReasons,{alreadyAssigned:3,unverified:1,inactive:2,demo:1})
  assert.deepEqual(new Set(preview.sample.map(row=>row.personType)),new Set(['student','alumni','faculty','staff','member']))
  assert.ok(Date.parse(preview.expiresAt)>Date.now());assert.equal(preview.expiresInMinutes,10)
  assert.equal(await fs.readFile(f.config.dataFile,'utf8'),before)
  const safe=JSON.stringify(preview);assert.ok(!safe.includes(f.read('student').passwordHash));assert.ok(!safe.includes('qa-student'))
  assert.throws(()=>f.service.preview(f.actor,{scope:'alumni_only'}),{code:'ALUMNI_NUMBER_INVALID'})
})

test('单人下发保留身份密码权限，既有学校编号不覆盖，本人即时可读且全状态与人工申请预留唯一',async t=>{
  const sequence=['AAAAAAAA-0000-0000-0000-000000000000','BBBBBBBB-0000-0000-0000-000000000000','CCCCCCCC-0000-0000-0000-000000000000']
  const f=await fixture(t,{now:()=>Date.UTC(2026,8,13),random:()=>sequence.shift()})
  await f.database.transaction(state=>{state.accounts.find(a=>a.id==='deactivated').alumniNo='HUFE-2026-aaaaaaaa';state.manualIdentityVerifications=[{id:'approved',status:'approved',approvedIdentity:{alumniNo:'HUFE-2026-BBBBBBBB'}}]})
  const before=f.read('student'),result=await f.service.issue(f.actor,'student',single(),{ip:'192.0.2.8'})
  assert.equal(result.alumniNo,'HUFE-2026-CCCCCCCC');assert.equal(result.account.alumniNo,result.alumniNo);assert.equal(result.revision,1)
  const after=f.read('student')
  for(const [key,value]of Object.entries(before))if(!['accountRevision','profileRevision','updatedAt','alumniNo'].includes(key))assert.deepEqual(after[key],value,key)
  assert.equal(after.mustChangePassword,true);assert.equal(after.schoolIdentityVerified,true);assert.equal(after.alumniStatusVerified,false);assert.equal(after.personType,'student')
  await assert.rejects(f.service.issue(f.actor,'assigned',single()),{code:'ALUMNI_NUMBER_ALREADY_ASSIGNED'})
  assert.equal(f.read('assigned').alumniNo,'SCHOOL-ORIGINAL')
  const audit=f.database.read(state=>state.auditLogs[0]);assert.equal(audit.action,'account.alumni_number_issued');assert.equal(audit.actor,'admin');assert.equal(audit.details.alumniNo,result.alumniNo);assert.equal(audit.ip,'192.0.2.8')
})

test('资格与权限实时校验：拒绝待实名停用演示、污染委派和过期管理员；单人需要revision理由确认',async t=>{
  const f=await fixture(t)
  for(const id of ['pending','suspended','deactivated','demo','absent'])await assert.rejects(f.service.issue(f.actor,id,single()),{code:'ALUMNI_NUMBER_INELIGIBLE'})
  for(const field of ['localDevelopmentOnly','developmentSchoolIdentityFixture','isDemo','isMock']){await f.database.transaction(state=>state.accounts.find(a=>a.id==='member')[field]=true);await assert.rejects(f.service.issue(f.actor,'member',single()),{code:'ALUMNI_NUMBER_INELIGIBLE'});await f.database.transaction(state=>delete state.accounts.find(a=>a.id==='member')[field])}
  for(const field of ['accountSource','verificationSource']){await f.database.transaction(state=>state.accounts.find(a=>a.id==='member')[field]='mock-example');await assert.rejects(f.service.issue(f.actor,'member',single()),{code:'ALUMNI_NUMBER_INELIGIBLE'});await f.database.transaction(state=>delete state.accounts.find(a=>a.id==='member')[field])}
  const before=await fs.readFile(f.config.dataFile,'utf8')
  await assert.rejects(f.service.issue(f.actor,'student',single({expectedRevision:1})),{code:'ACCOUNT_REVISION_CONFLICT'})
  await assert.rejects(f.service.issue(f.actor,'student',single({confirmation:''})),{code:'ALUMNI_NUMBER_CONFIRM_REQUIRED'})
  await assert.rejects(f.service.issue(f.actor,'student',single({reason:'不足'})),{code:'ALUMNI_NUMBER_REASON_INVALID'})
  await assert.rejects(f.service.issue(f.actor,'student',single({alumniNo:'SPOOFED'})),{code:'ALUMNI_NUMBER_INVALID'})
  await assert.rejects(f.service.issue(undefined,'student',single()),{code:'ADMIN_PERMISSION_DENIED'})
  await assert.rejects(f.service.issue(f.accounts.getActiveAccount('student'),'student',single()),{code:'ADMIN_PERMISSION_DENIED'})
  await assert.rejects(f.service.issue({...f.actor,credentialRevision:1},'student',single()),{code:'CREDENTIALS_CHANGED'})
  assert.equal(await fs.readFile(f.config.dataFile,'utf8'),before)
  for(const change of [{adminRole:'delegated_admin'},{role:'delegated_admin'},{mustChangePassword:true},{status:'suspended'}]){
    const original=f.read('admin');await f.database.transaction(state=>Object.assign(state.accounts.find(a=>a.id==='admin'),change))
    assert.throws(()=>f.service.preview(f.actor),{code:'ADMIN_PERMISSION_DENIED'})
    await f.database.transaction(state=>{state.accounts[state.accounts.findIndex(a=>a.id==='admin')]=original})
  }
})

test('批量原子下发所有身份，重复确认或重启后重放不再次编号，理由不可变更',async t=>{
  const f=await fixture(t),before=f.database.read(state=>state.accounts),preview=f.service.preview(f.actor)
  const [first,second]=await Promise.all([f.service.apply(f.actor,apply(preview.token)),f.service.apply(f.actor,apply(preview.token))])
  assert.equal(first.issuedCount,5);assert.equal(first.alreadyApplied,false);assert.equal(second.alreadyApplied,true)
  const numbers=['student','alumni','faculty','staff','member'].map(id=>f.read(id).alumniNo);assert.equal(new Set(numbers).size,5);assert.ok(numbers.every(no=>/^HUFE-\d{4}-[A-F0-9]{8}$/.test(no)))
  for(const account of before){const after=f.read(account.id);for(const key of ['personType','schoolIdentityVerified','alumniStatusVerified','passwordHash','mustChangePassword','isAdmin','credentialRevision'])assert.equal(after[key],account[key],key)}
  const nextDatabase=await new JsonDatabase(f.config.dataFile).init(),nextAccounts=new AccountService(nextDatabase,f.config),next=new AlumniNumberService(nextAccounts)
  const again=await next.apply(nextAccounts.getActiveAccount('admin'),apply(preview.token));assert.equal(again.alreadyApplied,true);assert.equal(again.issuedCount,5)
  assert.equal(nextDatabase.read(state=>state.alumniNumberBatches.length),1)
  assert.equal(nextDatabase.read(state=>state.auditLogs.filter(log=>log.action==='account.alumni_number_issued').length),5)
  await assert.rejects(next.apply(nextAccounts.getActiveAccount('admin'),apply(preview.token,{reason:'更换原因不能重复操作'})),{code:'ALUMNI_NUMBER_BATCH_CONFLICT'})
  const empty=next.preview(nextAccounts.getActiveAccount('admin'));assert.equal(empty.eligible,0)
  await assert.rejects(next.apply(nextAccounts.getActiveAccount('admin'),apply(empty.token)),{code:'ALUMNI_NUMBER_NOTHING_TO_ISSUE'})
})

test('预览只可由同管理员在10分钟内确认，签名篡改/凭据变化拒绝，队列过期重新检查',async t=>{
  let now=Date.UTC(2026,8,13);const f=await fixture(t,{now:()=>now}),preview=f.service.preview(f.actor)
  await assert.rejects(f.service.apply(f.accounts.getActiveAccount('other-admin'),apply(preview.token)),{code:'ALUMNI_NUMBER_PREVIEW_FORBIDDEN'})
  await assert.rejects(f.service.apply(f.actor,apply(preview.token.replace(/^./,preview.token[0]==='a'?'b':'a'))),{code:'ALUMNI_NUMBER_PREVIEW_EXPIRED'})
  await f.database.transaction(state=>state.accounts.find(a=>a.id==='admin').credentialRevision=1)
  await assert.rejects(f.service.apply(f.actor,apply(preview.token)),{code:'CREDENTIALS_CHANGED'})
  await assert.rejects(f.service.apply(f.accounts.getActiveAccount('admin'),apply(preview.token)),{code:'CREDENTIALS_CHANGED'})
  await f.database.transaction(state=>state.accounts.find(a=>a.id==='admin').credentialRevision=0)
  let release,entered;const waiting=new Promise(r=>entered=r),block=f.database.transaction(async()=>{entered();await new Promise(r=>release=r)})
  await waiting;const response=f.service.apply(f.actor,apply(preview.token));now+=10*60*1000;release();await block
  await assert.rejects(response,{code:'ALUMNI_NUMBER_PREVIEW_EXPIRED'});assert.equal(f.read('student').alumniNo,undefined)
})

test('预览后资格、人员资料、账号revision、编号或人工申请预留变化必须重预览，绝不部分下发',async t=>{
  const f=await fixture(t)
  for(const mutation of [s=>s.accounts.find(a=>a.id==='pending').schoolIdentityVerified=true,s=>s.accounts.find(a=>a.id==='student').status='suspended',s=>s.accounts.find(a=>a.id==='student').name='变更后姓名',s=>s.accounts.find(a=>a.id==='student').accountRevision=1,s=>s.accounts.find(a=>a.id==='student').alumniNo='NEW-SCHOOL-NUMBER',s=>s.manualIdentityVerifications.push({approvedIdentity:{alumniNo:'HUFE-2026-RESERVED'}})]){
    const backup=f.database.read(),preview=f.service.preview(f.actor);await f.database.transaction(mutation)
    await assert.rejects(f.service.apply(f.actor,apply(preview.token)),{code:'ALUMNI_NUMBER_PREVIEW_CHANGED'})
    assert.equal(f.read('faculty').alumniNo,undefined);assert.equal(f.database.read(state=>state.alumniNumberBatches),undefined)
    await f.database.transaction(state=>{for(const key of Object.keys(state))delete state[key];Object.assign(state,backup)})
  }
})

test('并发单人与批量只有一个范围成功，排队撤权及写盘/编号生成失败全部回滚',async t=>{
  const f=await fixture(t),preview=f.service.preview(f.actor)
  const responses=await Promise.allSettled([f.service.issue(f.actor,'student',single()),f.service.apply(f.actor,apply(preview.token))])
  assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.read('faculty').alumniNo,undefined)
  const second=await fixture(t),pending=second.service.preview(second.actor)
  let release,entered;const ready=new Promise(r=>entered=r),block=second.database.transaction(async state=>{entered();await new Promise(r=>release=r);state.accounts.find(a=>a.id==='admin').adminRole='delegated_admin'})
  await ready;const result=second.service.apply(second.actor,apply(pending.token));release();await block;await assert.rejects(result,{code:'ADMIN_PERMISSION_DENIED'});assert.equal(second.read('student').alumniNo,undefined)
  const broken=await fixture(t),original=await fs.readFile(broken.config.dataFile,'utf8'),draft=broken.service.preview(broken.actor),persist=broken.database.persist.bind(broken.database)
  broken.database.persist=async()=>{throw Error('isolated disk error')};await assert.rejects(broken.service.apply(broken.actor,apply(draft.token)),/isolated disk error/);broken.database.persist=persist
  assert.equal(await fs.readFile(broken.config.dataFile,'utf8'),original);assert.equal(broken.read('student').alumniNo,undefined)
  const collision=await fixture(t,{random:()=> 'AAAAAAAA-0000-0000-0000-000000000000'}),batch=collision.service.preview(collision.actor)
  await assert.rejects(collision.service.apply(collision.actor,apply(batch.token)),{code:'ALUMNI_NUMBER_GENERATION_FAILED'})
  assert.equal(collision.read('student').alumniNo,undefined);assert.equal(collision.database.read(state=>state.alumniNumberBatches),undefined)
})

test('真实HTTP权限与本人profile/身份卡立即显示编号，未改变身份或撤销当前令牌',async t=>{
  const f=await fixture(t)
  await f.database.transaction(state=>state.accounts.find(a=>a.id==='student').mustChangePassword=false)
  const app=await buildApp({config:f.config,logger:false,refreshContent:false,scheduleContent:false,contentService});t.after(()=>app.close())
  const login=async username=>{const response=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username,password,deviceId:'device_number_qa_'+username}});assert.equal(response.statusCode,200,response.body);return response.json().data.accessToken}
  const admin=await login('qa_admin'),user=await login('qa_student')
  const call=(token,url,payload)=>app.inject({method:payload?'POST':'GET',url:'/api/v1'+url,headers:token?{authorization:'Bearer '+token}:{},...(payload?{payload}:{})})
  assert.equal((await call(null,'/admin/accounts/alumni-numbers/preview',{})).statusCode,401)
  assert.equal((await call(user,'/admin/accounts/alumni-numbers/preview',{})).statusCode,403)
  const issued=await call(admin,'/admin/accounts/student/alumni-number',single());assert.equal(issued.statusCode,200,issued.body);assert.equal(issued.headers['cache-control'],'private, no-store')
  const number=issued.json().data.alumniNo
  for(const route of ['/me','/me/profile','/me/identity-card']){const current=await call(user,route);assert.equal(current.statusCode,200,current.body);assert.equal(current.json().data.alumniNo,number);if(route!=='/me/identity-card')assert.equal(current.json().data.personType,'student')}
  const preview=await call(admin,'/admin/accounts/alumni-numbers/preview',{});assert.equal(preview.statusCode,200,preview.body);assert.equal(preview.json().data.eligible,4)
  const applied=await call(admin,'/admin/accounts/alumni-numbers/apply',apply(preview.json().data.token));assert.equal(applied.statusCode,200,applied.body);assert.equal(applied.json().data.issuedCount,4)
  const again=await call(admin,'/admin/accounts/alumni-numbers/apply',apply(preview.json().data.token));assert.equal(again.json().data.alreadyApplied,true)
  assert.equal((await call(user,'/me')).json().data.alumniNo,number)
  const logs=await app.services.audit.list({pageSize:100});assert.ok(logs.items.some(log=>log.action==='account.alumni_number_issued'&&log.targetId==='student'&&log.details.alumniNo===number&&log.trace.actorAccountId==='admin'))
})
