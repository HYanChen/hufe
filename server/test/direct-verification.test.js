import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {JsonDatabase} from '../src/storage/json-database.js'
import {AccountService} from '../src/accounts/service.js'
import {PersonnelService} from '../src/accounts/personnel.js'
import {DirectVerificationService} from '../src/accounts/direct-verification.js'
import {hashPassword,hmac} from '../src/auth/crypto.js'
import {selfStudentNumber} from '../src/accounts/student-number.js'
import {createConfig} from '../src/config.js'
import {buildApp} from '../src/app.js'

const number='001234567AbC',password='IsolatedAdmin2026!'
const fields={name:'隔离待校验人员',personType:'alumni',department:'信息技术与管理学院',major:'计算机科学与技术',className:'2022级计算机科学与技术一班',studentId:'',enrollmentYear:'2022',graduationYear:'2024',expectedGraduationYear:''}
const input=extra=>({expectedRevision:0,fields:{...fields},verificationBasis:'已核对原始学籍档案与毕业证明材料',confirmation:'确认人工实名校验通过',...extra})
const contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({}),list:()=>({items:[]})}
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-direct-verification-'))
  t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const config=createConfig({env:'test',dataFile:path.join(dir,'data.json'),dataHashSecret:'isolated-direct-verification-secret'})
  const database=await new JsonDatabase(config.dataFile).init(),passwordHash=await hashPassword(password)
  await database.transaction(s=>{s.accounts=['admin','second','delegate'].map(id=>({id,username:'qa_'+id,usernameNormalized:'qa_'+id,name:'隔离'+id,department:'管理部门',personType:'staff',passwordHash,status:'active',isAdmin:true,credentialRevision:0,schoolSubjectKey:'qa-'+id,...(id==='delegate'?{adminRole:'delegated_admin'}:{})}))})
  const accounts=new AccountService(database,config),admin=accounts.getActiveAccount('admin'),personnel=new PersonnelService(accounts)
  const preview=personnel.preview(admin,[{rowNumber:1,input:{username:'qa_pending',...fields,studentId:number}}])
  assert.equal(preview.invalid,0)
  const imported=await personnel.apply(admin,{token:preview.token,verificationMode:'unverified'})
  const id=imported.accountIds[0],service=new DirectVerificationService(accounts)
  return {dir,config,database,accounts,admin,id,service,target:database.read(s=>s.accounts.find(a=>a.id===id))}
}

test('后台待实名人员核验保持同账号、密码、临时改密和委派权限，私有记录与来源可追溯',async t=>{
  const f=await fixture(t)
  await f.database.transaction(s=>{Object.assign(s.accounts.find(a=>a.id===f.id),{adminRole:'delegated_admin',adminPermissions:['organizations']});s.adminDelegations=[{id:'delegation',accountId:f.id,status:'active',resource:'organizations'}]})
  const result=await f.service.verify(f.admin,f.id,input(),{ip:'192.0.2.50'})
  assert.equal(result.verified,true);assert.equal(result.account.id,f.id);assert.equal(result.account.schoolIdentityVerified,true);assert.equal(result.verificationSource,'admin-personnel-review')
  const row=f.database.read(s=>s.accounts.find(a=>a.id===f.id))
  for(const key of ['id','passwordHash','username','mustChangePassword','schoolSubjectKey','isAdmin','credentialRevision'])assert.equal(row[key],f.target[key])
  assert.equal(row.accountRevision,1);assert.equal(row.adminRole,'delegated_admin');assert.deepEqual(row.adminPermissions,['organizations'])
  assert.equal(f.database.read(s=>s.adminDelegations[0].status),'active');assert.equal(selfStudentNumber(row,f.config.dataHashSecret),number)
  const serialized=JSON.stringify({response:result,audit:f.database.read(s=>s.auditLogs),review:f.database.read(s=>s.accountManualVerifications)})
  for(const secret of [number,row.studentIdKey,row.studentIdSealed])assert.ok(!serialized.includes(secret))
  assert.equal(result.account.verificationBasis,undefined);assert.equal(result.account.reviewedFields,undefined)
  const record=f.database.read(s=>s.accountManualVerifications[0]);assert.equal(record.actorId,'admin');assert.equal(record.targetId,f.id);assert.equal(record.verificationBasis,input().verificationBasis);assert.equal(record.reviewedFields.studentIdMasked,row.studentIdMasked)
  assert.equal(f.database.read(s=>s.auditLogs[0].action),'account.personnel_manually_verified')
  await assert.rejects(f.service.verify(f.admin,f.id,input()),{code:'ACCOUNT_VERIFICATION_UNAVAILABLE'})
})

test('权限仅实时有效全局管理员，拒绝污染委派、临时密码及过期凭据',async t=>{
  const f=await fixture(t),before=await fs.readFile(f.config.dataFile,'utf8')
  for(const actor of [undefined,f.accounts.getActiveAccount(f.id),f.accounts.getActiveAccount('delegate')])await assert.rejects(f.service.verify(actor,f.id,input()),{code:'ADMIN_PERMISSION_DENIED'})
  await assert.rejects(f.service.verify({...f.admin,credentialRevision:99},f.id,input()),{code:'CREDENTIALS_CHANGED'})
  assert.equal(await fs.readFile(f.config.dataFile,'utf8'),before)
  await f.database.transaction(s=>{s.accounts.find(a=>a.id==='admin').mustChangePassword=true})
  await assert.rejects(f.service.verify(f.admin,f.id,input()),{code:'ADMIN_PERMISSION_DENIED'})
})

test('运营源、已实名、停用、模拟与全局管理员目标不可覆盖，非法字段年份依据和二次确认拒绝',async t=>{
  const f=await fixture(t)
  for(const change of [{accountSource:'admin_provisioned'},{schoolIdentityVerified:true},{status:'suspended'},{isAdmin:true},{isSuperAdmin:true},{role:'super_admin'},{localDevelopmentOnly:true},{developmentSchoolIdentityFixture:true},{isDemo:true},{isMock:true}]){
    await f.database.transaction(s=>{Object.assign(s.accounts.find(a=>a.id===f.id),change)})
    await assert.rejects(f.service.verify(f.admin,f.id,input()),{code:'ACCOUNT_VERIFICATION_UNAVAILABLE'})
    await f.database.transaction(s=>{s.accounts[s.accounts.findIndex(a=>a.id===f.id)]={...f.target}})
  }
  const before=await fs.readFile(f.config.dataFile,'utf8')
  for(const patch of [{name:''},{personType:'member'},{department:''},{department:'长'.repeat(121)},{major:''},{enrollmentYear:'1899'},{graduationYear:'2021'},{personType:'student'},{expectedGraduationYear:'2028'},{studentId:'***AbC'},{isAdmin:true}])await assert.rejects(f.service.verify(f.admin,f.id,input({fields:{...fields,...patch}})))
  for(const extra of [{confirmation:''},{verificationBasis:'不全'},{verificationBasis:'已核对完整学号'+number},{verificationBasis:'已核对学号'+number.split('').join(' ')},{expectedRevision:1},{source:'school-registration-check'}])await assert.rejects(f.service.verify(f.admin,f.id,input(extra)))
  assert.equal(await fs.readFile(f.config.dataFile,'utf8'),before)
})

test('稳定学工号不可替换：空值保留已验证密文，坏密文须重填原号，前导零及大小写一致',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.service.verify(f.admin,f.id,input({fields:{...fields,studentId:'Different1234'}})),{code:'ACCOUNT_VERIFICATION_IDENTITY_CHANGED'})
  await f.database.transaction(s=>{s.accounts.find(a=>a.id===f.id).studentIdSealed='corrupted'})
  await assert.rejects(f.service.verify(f.admin,f.id,input()),{code:'ACCOUNT_VERIFICATION_STUDENT_ID_REQUIRED'})
  await assert.rejects(f.service.verify(f.admin,f.id,input({fields:{...fields,studentId:number.toLowerCase()}})),{code:'ACCOUNT_VERIFICATION_IDENTITY_CHANGED'})
  const result=await f.service.verify(f.admin,f.id,input({fields:{...fields,studentId:' 00 1234567AbC '}}))
  assert.equal(result.account.studentIdMasked,'********7AbC')
  assert.equal(selfStudentNumber(f.database.read(s=>s.accounts.find(a=>a.id===f.id)),f.config.dataHashSecret),number)
  const next=await fixture(t)
  await next.database.transaction(s=>{const a=s.accounts.find(a=>a.id===next.id);delete a.studentIdKey;delete a.studentIdSealed;a.studentIdMasked=''})
  await assert.rejects(next.service.verify(next.admin,next.id,input()),{code:'ACCOUNT_VERIFICATION_STUDENT_ID_REQUIRED'})
  assert.equal((await next.service.verify(next.admin,next.id,input({fields:{...fields,studentId:number}}))).verified,true)
})

test('防重包含暂停注销账号、既有证件及学校索引、待审人工申请和未处理身份冲突',async t=>{
  const f=await fixture(t)
  for(const status of ['active','suspended','deactivated']){
    await f.database.transaction(s=>s.accounts.push({id:'conflicting',status,studentIdKey:f.target.studentIdKey}))
    await assert.rejects(f.service.verify(f.admin,f.id,input()),{code:'ACCOUNT_VERIFICATION_IDENTITY_CONFLICT'})
    await f.database.transaction(s=>{s.accounts=s.accounts.filter(a=>a.id!=='conflicting')})
  }
  for(const key of ['schoolSubjectKey','idCardKey']){
    await f.database.transaction(s=>{const a=s.accounts.find(a=>a.id===f.id);if(key==='idCardKey')a[key]='private-idcard-hash';s.accounts.push({id:'conflicting',status:'deactivated',[key]:a[key]})})
    await assert.rejects(f.service.verify(f.admin,f.id,input()),{code:'ACCOUNT_VERIFICATION_IDENTITY_CONFLICT'})
    await f.database.transaction(s=>{s.accounts=s.accounts.filter(a=>a.id!=='conflicting')})
  }
  for(const status of ['submitted','under_review','needs_more','approved']){
    await f.database.transaction(s=>{s.manualIdentityVerifications=[{id:'manual-pending',status,profile:{studentIdKey:f.target.studentIdKey}}]})
    await assert.rejects(f.service.verify(f.admin,f.id,input()),{code:'ACCOUNT_VERIFICATION_APPLICATION_CONFLICT'})
  }
  await f.database.transaction(s=>{s.manualIdentityVerifications=[];s.identityConflicts=[{id:'open',status:'open',accountIds:[f.id]}]})
  await assert.rejects(f.service.verify(f.admin,f.id,input()),{code:'ACCOUNT_VERIFICATION_IDENTITY_CONFLICT'})
  assert.equal(f.database.read(s=>s.accounts.find(a=>a.id===f.id).schoolIdentityVerified),false)
})

test('并发仅一次通过，排队期间撤权重新校验，写盘失败不留认证结论或复核记录',async t=>{
  const f=await fixture(t),result=await Promise.allSettled([f.service.verify(f.admin,f.id,input()),f.service.verify(f.accounts.getActiveAccount('second'),f.id,input())])
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.database.read(s=>s.accountManualVerifications.length),1)
  const queued=await fixture(t)
  let release,entered
  const ready=new Promise(r=>{entered=r}),block=queued.database.transaction(async s=>{entered();await new Promise(r=>{release=r});s.accounts.find(a=>a.id==='admin').adminRole='delegated_admin'})
  await ready;const pending=queued.service.verify(queued.admin,queued.id,input());release();await block
  await assert.rejects(pending,{code:'ADMIN_PERMISSION_DENIED'})
  const broken=await fixture(t),before=await fs.readFile(broken.config.dataFile,'utf8'),persist=broken.database.persist.bind(broken.database)
  broken.database.persist=async()=>{throw Error('isolated verification disk failure')}
  await assert.rejects(broken.service.verify(broken.admin,broken.id,input()),/disk failure/)
  broken.database.persist=persist
  assert.equal(await fs.readFile(broken.config.dataFile,'utf8'),before);assert.equal(broken.database.read(s=>s.accounts.find(a=>a.id===broken.id).schoolIdentityVerified),false)
  assert.equal(broken.database.read(s=>s.accountManualVerifications),undefined)
})

test('完整HTTP后补核验：旧会话即时看到实名，临时密码仍禁止发帖对话，改密后关联学籍组织群及防止重复注册',async t=>{
  const f=await fixture(t),app=await buildApp({config:f.config,logger:false,refreshContent:false,scheduleContent:false,contentService})
  t.after(()=>app.close())
  const login=async(username,pass)=>{const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username,password:pass,deviceId:'device_direct_verification_qa'}});assert.equal(r.statusCode,200,r.body);return r.json().data.accessToken}
  const adminToken=await login('qa_admin',password),oldToken=await login('qa_pending','qa_pending123456'),delegateToken=await login('qa_delegate',password)
  const call=(value,method,url,payload)=>app.inject({method,url:'/api/v1'+url,headers:value?{authorization:'Bearer '+value}:{},...(payload?{payload}:{})})
  assert.equal((await call(null,'POST',`/admin/accounts/${f.id}/manual-verification`,input())).statusCode,401)
  assert.equal((await call(oldToken,'POST',`/admin/accounts/${f.id}/manual-verification`,input())).statusCode,403)
  const response=await call(adminToken,'POST',`/admin/accounts/${f.id}/manual-verification`,input())
  assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'private, no-store')
  for(const url of ['/admin/audit-logs','/admin/accounts']){
    const denied=await call(delegateToken,'GET',url)
    assert.equal(denied.statusCode,403,denied.body);assert.ok(!denied.body.includes(input().verificationBasis))
  }
  assert.equal((await call(delegateToken,'POST',`/admin/accounts/${f.id}/manual-verification`,input())).statusCode,403)
  const me=await call(oldToken,'GET','/me');assert.equal(me.statusCode,200);assert.equal(me.json().data.id,f.id);assert.equal(me.json().data.schoolIdentityVerified,true);assert.equal(me.json().data.mustChangePassword,true)
  for(const [method,url,payload] of [['POST','/business/community-posts',{content:'不应允许临时密码发帖'}],['GET','/chat/conversations']]){const r=await call(oldToken,method,url,payload);assert.equal(r.statusCode,403,r.body);assert.equal(r.json().code,'PASSWORD_CHANGE_REQUIRED')}
  const profile=await call(oldToken,'GET','/me/profile');assert.equal(profile.json().data.verificationSource,'admin-personnel-review');assert.ok(!profile.body.includes(number));assert.ok(!profile.body.includes(input().verificationBasis))
  const card=await call(oldToken,'GET','/me/identity-card');assert.equal(card.json().data.studentIdDisplay,number)
  const changed=await call(oldToken,'POST','/auth/change-password',{currentPassword:'qa_pending123456',newPassword:'VerifiedOwnPassword2026!'});assert.equal(changed.statusCode,200,changed.body);assert.equal((await call(oldToken,'GET','/me')).statusCode,401)
  const currentToken=await login('qa_pending','VerifiedOwnPassword2026!')
  const chats=await call(currentToken,'GET','/chat/conversations');assert.equal(chats.statusCode,200,chats.body);assert.equal(chats.json().data.items.filter(c=>c.schoolGroup).length,3)
  const organizations=await call(currentToken,'GET','/business/organizations');assert.equal(organizations.statusCode,200,organizations.body)
  const memberships=app.services.database.read(s=>s.business.submissions.filter(r=>r.accountId===f.id&&r.automaticMembership&&r.status==='approved'));assert.equal(memberships.length,4)
  assert.ok(memberships.every(r=>!r.isAdmin))
  const posted=await call(currentToken,'POST','/business/community-posts',{content:'完成真实校验及改密后发布'});assert.equal(posted.statusCode,201,posted.body)
  await assert.rejects(app.services.accounts.register({schoolSubject:'other-school-ticket',name:fields.name,personType:'alumni',department:fields.department,studentIdKey:hmac('student-id:'+number,f.config.dataHashSecret)},{username:'qa_duplicate',password:'OtherPassword2026!'}),{code:'ACCOUNT_EXISTS'})
  assert.equal(app.services.database.read(s=>s.accounts.length),4)
  const audit=await app.services.audit.list({});assert.ok(audit.items.some(r=>r.details.label==='全局管理员完成人员人工实名校验'));assert.ok(!JSON.stringify(audit).includes(number))
})
