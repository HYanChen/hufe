// Isolated QA database only. Never change local/production accounts or settings.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'
import {execFile} from 'node:child_process'
import {buildApp} from '../server/src/app.js'
import {createConfig} from '../server/src/config.js'
const root=path.resolve(import.meta.dirname,'..'),mysql=JSON.parse(await fs.readFile(path.join(root,'.local-runtime/mysql/qa.json'),'utf8'))
if(!/^hufe_mysql_qa_/.test(mysql.database))throw Error('Disposable QA database required')
// Restarting this harness must preserve browser QA edits and the large audit
// fixture. Reset is an explicit, separate action, never the default.
if(process.env.HUFE_QA_RESET_SQL==='1'){
  if(process.env.HUFE_QA_REUSE_SQL==='1')throw Error('Choose either explicit QA reset or reuse, not both')
  await promisify(execFile)(process.execPath,['scripts/mysql-full-acceptance.mjs'],{cwd:root,maxBuffer:1024*1024})
}
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-mysql-browser-'))
const config=createConfig({env:'test',databaseDriver:'mysql',mysql,dataFile:path.join(temp,'data/application-data.json'),mediaDir:path.join(temp,'data/media'),content:{cacheFile:path.join(temp,'data/content-cache.json')},publicBaseUrl:'http://127.0.0.1:8893',corsOrigins:['http://127.0.0.1:4293','http://127.0.0.1:5293'],trustProxy:false})
const app=await buildApp({config,logger:false,refreshContent:false,scheduleContent:false})
const existing=name=>app.services.database.read(d=>d.accounts.find(a=>a.username===name))
const administrator=existing('mysql_qa_admin')||await app.services.accounts.register({schoolSubject:'mysql-browser-qa-admin',name:'隔离验收管理员',department:'隔离验收学院',personType:'staff',isAdmin:true,verificationSource:'isolated-browser-fixture'},{username:'mysql_qa_admin',password:'MySqlBrowserQA2026!'})
const person=existing('mysql_qa_alumni')||await app.services.accounts.register({schoolSubject:'mysql-browser-qa-alumni',name:'隔离验收校友',department:'隔离验收学院',personType:'alumni',verificationSource:'isolated-browser-fixture'},{username:'mysql_qa_alumni',password:'MySqlBrowserQA2026!'})
// HTTP probes use a different account so single-device login does not log out
// the administrator who is concurrently inspecting the browser UI.
const httpAdministrator=existing('mysql_qa_http_admin')||await app.services.accounts.register({schoolSubject:'mysql-http-qa-admin',name:'隔离HTTP验收管理员',department:'隔离验收学院',personType:'staff',isAdmin:true,verificationSource:'isolated-http-fixture'},{username:'mysql_qa_http_admin',password:'MySqlHttpQA2026!'})
app.get('/__qa/identity',async()=>({isolated:true,database:mysql.database,httpAdministrator:httpAdministrator.id,person:person.id}))
if(process.env.HUFE_QA_TRACE==='1'){
  for(const [label,target,names] of [['modules',app.services.modules,['assertRequest','publicConfig']],['audit',app.services.audit,['begin','capture']]])for(const name of names){const original=target[name].bind(target);target[name]=function(...args){console.log('QA ENTER',label,name);const result=original(...args);if(result?.then)return result.then(value=>{console.log('QA EXIT',label,name);return value},error=>{console.log('QA FAIL',label,name,error.code||error.name);throw error});console.log('QA EXIT',label,name);return result}}
  const store=app.services.audit.requestDatabase
  for(const name of ['transaction','append','checkOwnership','writeDiff']){const original=store[name]?.bind(store);if(!original)continue;store[name]=async function(...args){console.log('QA SQL ENTER',name);try{const result=await original(...args);console.log('QA SQL EXIT',name);return result}catch(error){console.log('QA SQL FAIL',name,error.code||error.name);throw error}}}
}
app.server.prependListener('request',request=>console.log('QA HTTP',request.method,request.url.split('?')[0]))
app.addHook('onResponse',async(request,reply)=>console.log('QA RESPONSE',reply.statusCode,request.url.split('?')[0]))
await app.listen({host:'127.0.0.1',port:8893})
let closing=false
async function close(){if(closing)return;closing=true;await app.close();await fs.rm(temp,{recursive:true,force:true});process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
console.log(JSON.stringify({isolated:true,database:mysql.database,adminOrigin:'http://127.0.0.1:4293',apiOrigin:'http://127.0.0.1:8893',administrator:administrator.id,person:person.id}))
