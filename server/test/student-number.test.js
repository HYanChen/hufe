import test from 'node:test'
import assert from 'node:assert/strict'
import {sealStudentNumber,selfStudentNumber} from '../src/accounts/student-number.js'
import {hmac} from '../src/auth/crypto.js'
import {AuthSessionStore} from '../src/auth/session-store.js'
import {createConfig} from '../src/config.js'
import {mapSchoolIdentity} from '../src/auth/identity.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {buildApp} from '../src/app.js'

test('本人完整学号加密保存并校验身份指纹，旧脱敏值不得推算',()=>{
  const secret='self-only-test-key',number='0022001234',studentIdKey=hmac('student-id:'+number,secret)
  const studentIdSealed=sealStudentNumber(number,secret)
  assert.equal(studentIdSealed.includes(number),false)
  assert.equal(selfStudentNumber({studentIdSealed,studentIdKey},secret),number)
  assert.equal(selfStudentNumber({studentIdDisplay:number,studentIdKey},secret),number)
  assert.equal(selfStudentNumber({studentIdMasked:'******1234',studentIdKey},secret),'')
  assert.equal(selfStudentNumber({studentIdDisplay:'0022991234',studentIdKey},secret),'')
  assert.equal(selfStudentNumber({studentIdSealed,studentIdKey},'wrong-key'),'')
  assert.equal(selfStudentNumber({studentIdSealed:studentIdSealed+'x',studentIdKey},secret),'')
})
test('学校认证换票保留加密学号但不把完整号码序列化到注册身份',async()=>{
  const config=createConfig({env:'test',dataHashSecret:'ticket-student-only'}),sessions=new AuthSessionStore(config)
  const identity=await mapSchoolIdentity({subject:'student-self-qa',claims:{cn:'测试本人',department:'测试学院',studentNo:'0022001234',affiliation:'student'}},config)
  const ticket=sessions.issueRegistrationTicket(identity),safe=sessions.authenticateRegistrationTicket(ticket.registrationTicket)
  assert.equal(selfStudentNumber(safe,config.dataHashSecret),'0022001234')
  assert.equal(JSON.stringify(safe).includes('0022001234'),false)
  const second=sessions.issueRegistrationTicket(safe)
  assert.equal(selfStudentNumber(sessions.authenticateRegistrationTicket(second.registrationTicket),config.dataHashSecret),'0022001234')
})
test('完整学号只从本人专用接口返回，其他账户和公共资料无原号或密文',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-self-student-'))
  const config=createConfig({env:'test',dataFile:path.join(dir,'data.json'),dataHashSecret:'student-http-only'})
  const status={stale:false,itemCount:0,sourceStatuses:[]},contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>status,home:()=>({status,sections:{}}),list:()=>({items:[],total:0,status}),get:async()=>null}
  const app=await buildApp({config,logger:false,refreshContent:false,scheduleContent:false,contentService})
  t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true})})
  const tokens={},users={}
  for(const [name,number] of [['alice','0022001234'],['bob','0022005678']]){
    const identity=await mapSchoolIdentity({subject:'student-self-'+name,claims:{cn:'测试'+name,department:'测试学院',studentNo:number,affiliation:'student'}},config)
    const ticket=app.services.sessions.issueRegistrationTicket(identity)
    users[name]=await app.services.accounts.register(app.services.sessions.authenticateRegistrationTicket(ticket.registrationTicket),{username:'self_'+name,password:'Only-QA-'+name+'-2026!'})
    tokens[name]=app.services.sessions.issueAccess(users[name]).accessToken
    assert.doesNotMatch(JSON.stringify(users[name]),/studentIdSealed|0022001234|0022005678/)
  }
  const call=(who,url)=>app.inject({url,headers:tokens[who]?{authorization:'Bearer '+tokens[who]}:{}})
  assert.equal((await call(null,'/api/v1/me/identity-card')).statusCode,401)
  const alice=await call('alice','/api/v1/me/identity-card')
  assert.equal(alice.json().data.studentIdDisplay,'0022001234')
  assert.equal(alice.headers['cache-control'],'private, no-store')
  assert.equal((await call('bob','/api/v1/me/identity-card')).json().data.studentIdDisplay,'0022005678')
  assert.equal((await call('bob','/api/v1/me/identity-card?accountId='+users.alice.id)).statusCode,400)
  assert.doesNotMatch((await call('alice','/api/v1/me')).body,/studentIdSealed|0022001234/)
  assert.doesNotMatch((await call('alice','/api/v1/me/profile')).body,/studentIdSealed|0022001234/)
  await app.services.database.transaction(s=>{s.accounts.find(a=>a.id===users.alice.id).status='suspended'})
  assert.equal((await call('alice','/api/v1/me/identity-card')).statusCode,401)
})
