// Disposable browser fixture only. Never opens the local or production database.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createServer} from '../admin/node_modules/vite/dist/node/index.js'
import {buildApp} from '../server/src/app.js'
import {createConfig} from '../server/src/config.js'
import {PersonnelService} from '../server/src/accounts/personnel.js'

const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-account-verification-qa-'))
const apiOrigin='http://127.0.0.1:8892',adminOrigin='http://127.0.0.1:4292'
let app,vite,closing=false
async function close(code=0){
  if(closing)return
  closing=true
  await vite?.close()
  await app?.close()
  await fs.rm(directory,{recursive:true,force:true})
  process.exit(code)
}
process.on('SIGINT',()=>close())
process.on('SIGTERM',()=>close())
try{
  app=await buildApp({config:createConfig({env:'test',dataFile:path.join(directory,'data.json'),mediaDir:path.join(directory,'media'),cacheFile:path.join(directory,'content.json'),auditGeoDir:path.join(directory,'ip-region'),publicBaseUrl:apiOrigin,corsOrigins:[adminOrigin,'http://127.0.0.1:5292'],trustProxy:false}),logger:false,refreshContent:false,scheduleContent:false,contentService:{init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({sections:{}}),list:()=>({items:[]})}})
  const administrator=await app.services.accounts.register({schoolSubject:'disposable-verification-administrator',name:'隔离人工校验管理员',department:'临时测试管理部',personType:'staff',isAdmin:true,verificationSource:'isolated-browser-fixture'},{username:'verify_qa_admin',password:'IsolatedVerify2026!'})
  const actor=app.services.accounts.getActiveAccount(administrator.id)
  const personnel=new PersonnelService(app.services.accounts)
  const preview=personnel.preview(actor,[
    {rowNumber:1,input:{username:'verify_qa_pending',name:'隔离待核验人员',personType:'alumni',department:'临时测试学院',major:'临时测试专业',className:'2022级隔离测试一班',enrollmentYear:'2022',graduationYear:'2024'}},
    {rowNumber:2,input:{username:'verify_qa_existing',name:'隔离已录入学工号人员',personType:'staff',department:'临时测试部门',studentId:'QA20260001'}}
  ])
  if(preview.invalid)throw Error('Invalid isolated fixture: '+JSON.stringify(preview.items))
  const result=await personnel.apply(actor,{token:preview.token,verificationMode:'unverified'},{actor:actor.id})
  for (const [suffix,personType,name] of [['student','student','隔离在校生'],['staff','staff','隔离教职工'],['alumni','alumni','隔离校友']]) {
    await app.services.accounts.register({schoolSubject:`disposable-number-${suffix}`,name,department:'隔离编号验收学院',personType,verificationSource:'isolated-browser-fixture'},{username:`number_qa_${suffix}`,password:'IsolatedNumber2026!'})
  }
  const givingProject=await app.services.business.createAdmin('giving-projects',{title:'隔离验收 · 学子成长公益项目',organizer:'湖南财政经济学院',summary:'仅隔离数据用于证书模板验收',description:'该记录位于临时数据库，不是正式公益项目。'},{actor:actor.id})
  await app.services.business.actAdmin('giving-projects',givingProject.id,{action:'publish'},{actor:actor.id})
  const givingIntent=await app.services.business.createSubmission(actor,{type:'giving-intent',resourceId:givingProject.id,payload:{amountIntent:'1000',message:'隔离证书模板验收'}},{actor:actor.id})
  const baseline=app.services.database.read(state=>new Map(state.accounts.map(account=>[account.id,{passwordHash:account.passwordHash,mustChangePassword:account.mustChangePassword,isAdmin:account.isAdmin}])))
  app.get('/__qa__/verification-state',(_request,reply)=>reply.header('cache-control','no-store').send({
    isolated:true,
    credentialsAndPermissionsUnchanged:app.services.database.read(state=>state.accounts.every(account=>{const before=baseline.get(account.id);return before&&account.passwordHash===before.passwordHash&&account.mustChangePassword===before.mustChangePassword&&account.isAdmin===before.isAdmin})),
    accounts:app.services.accounts.listAccounts({pageSize:100}),
    givingProjectId:givingProject.id,givingIntentId:givingIntent.id,
    audit:app.services.database.read(state=>state.auditLogs.filter(row=>String(row.action||row.type||'').includes('manual')))
  }))
  await app.listen({host:'127.0.0.1',port:8892})
  process.env.HUFE_API_PROXY=apiOrigin
  vite=await createServer({root:path.resolve('admin'),configFile:path.resolve('admin/vite.config.js'),server:{host:'127.0.0.1',port:4292,strictPort:true}})
  await vite.listen()
  console.log(JSON.stringify({isolated:true,apiOrigin,adminOrigin,administrator:'verify_qa_admin',target:'verify_qa_pending',existingStudentId:'QA20260001',created:result.created,teardown:'SIGINT/SIGTERM removes this disposable database'}))
}catch(error){console.error(error.message);await close(1)}
