import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {buildApp} from '../src/app.js'
import {createConfig} from '../src/config.js'

test('企业查询 HTTP：身份和配置权限、默认手动回退、字段限制与禁缓存',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-enterprise-http-'))
  const status={stale:false,itemCount:0,sourceStatuses:[]}
  const contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>status,home:()=>({status,sections:{}}),list:()=>({items:[],total:0,status}),get:async()=>null}
  const app=await buildApp({config:createConfig({env:'test',dataFile:path.join(dir,'data.json'),dataHashSecret:'isolated-enterprise-qa'}),logger:false,refreshContent:false,scheduleContent:false,contentService})
  t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true})})
  const tokens={}
  for(const name of ['admin','member']){
    const user=await app.services.accounts.register({schoolSubject:'enterprise-http-'+name,name:'企业测试'+name,department:'测试学院',personType:'alumni',isAdmin:name==='admin',verificationSource:'school-registration-check'},{username:'enterprise_'+name,password:'Only-QA-'+name+'-2026!'})
    tokens[name]=app.services.sessions.issueAccess(user).accessToken
  }
  const call=(who,method,url,payload)=>app.inject({method,url,headers:tokens[who]?{authorization:'Bearer '+tokens[who]}:{},...(payload===undefined?{}:{payload})})
  assert.equal((await call(null,'POST','/api/v1/enterprise-lookup',{name:'隔离测试企业有限公司'})).statusCode,401)
  assert.equal((await call('member','GET','/api/v1/admin/enterprise-lookup')).statusCode,403)
  const result=await call('member','POST','/api/v1/enterprise-lookup',{name:'隔离测试企业有限公司'})
  assert.equal(result.statusCode,200,result.body)
  assert.equal(result.json().data.available,false)
  assert.match(result.json().data.reason,/手动填写/)
  assert.equal(result.headers['cache-control'],'private, no-store')
  assert.equal((await call('member','POST','/api/v1/enterprise-lookup',{name:'隔离测试企业有限公司',ownerId:'injected'})).statusCode,400)
  const config=await call('admin','GET','/api/v1/admin/enterprise-lookup')
  assert.equal(config.statusCode,200)
  assert.equal(config.json().data.configured,false)
  assert.equal((await call('admin','PUT','/api/v1/admin/enterprise-lookup',{revision:0,enabled:true,dailyLimit:10,licensed:true})).statusCode,400)
})
