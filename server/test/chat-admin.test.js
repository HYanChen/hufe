import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { ChatAdminService } from '../src/chat/admin-service.js'

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-oversight-qa-'))
  const status={stale:false,itemCount:0,sourceStatuses:[]}
  const contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>status,home:()=>({status,sections:{}}),list:()=>({items:[],total:0,status}),get:async()=>null}
  const app=await buildApp({config:createConfig({env:'test',dataFile:path.join(dir,'data.json'),dataHashSecret:'isolated-oversight-qa',chatChunkSize:64}),logger:false,refreshContent:false,scheduleContent:false,contentService})
  t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true})})
  const users={},tokens={}
  for(const name of ['admin','alice','bob','delegate']){
    users[name]=await app.services.accounts.register({schoolSubject:'oversight-'+name,name:'测试'+name,department:'测试学院',personType:'student',isAdmin:name==='admin',verificationSource:'school-registration-check'},{username:'qa_'+name,password:'Only-QA-'+name+'-2026!'})
    tokens[name]=app.services.sessions.issueAccess(users[name]).accessToken
  }
  await app.services.database.transaction(d=>{const a=d.accounts.find(a=>a.id===users.delegate.id);a.adminRole='delegated_admin';a.adminPermissions=['community-posts','chat-management']})
  const call=(who,method,url,payload,extra={})=>app.inject({method,url,headers:{...(tokens[who]?{authorization:'Bearer '+tokens[who]}:{}),...extra},...(payload===undefined?{}:{payload})})
  const chat=app.services.chat,oversight=new ChatAdminService(chat)
  const c=await chat.create(users.alice.id,{type:'direct',memberIds:[users.bob.id]})
  const base='/api/v1/admin/chat/conversations/'+c.id
  const send=(text='需要核查的原始消息',clientMessageId='first')=>call('alice','POST','/api/v1/chat/conversations/'+c.id+'/messages',{kind:'text',text,clientMessageId})
  const moderate=(mid,status,revision=0,reason='平台规则核查')=>call('admin','PATCH',base+(mid?'/messages/'+mid:''),{status,revision,reason})
  return {app,chat,oversight,users,tokens,call,c,base,send,moderate}
}

test('后台全量读取：普通/委派管理员不得越权；非成员全局管理员可查看且账号信息最小化',async t=>{
  const {call,c,base,send,users,app}=await fixture(t);await send()
  for(const who of [null,'alice','delegate']){
    assert.equal((await call(who,'GET','/api/v1/admin/chat/conversations')).statusCode,who?403:401)
    assert.equal((await call(who,'GET',base+'/messages')).statusCode,who?403:401)
    assert.equal((await call(who,'PATCH',base,{status:'paused',revision:0,reason:'不应允许'})).statusCode,who?403:401)
  }
  assert.equal((await call('admin','GET',`/api/v1/chat/conversations/${c.id}/messages`)).statusCode,403)
  const result=await call('admin','GET',base+'/messages');assert.equal(result.statusCode,200,result.body)
  assert.equal(result.headers['cache-control'],'private, no-store')
  assert.equal(result.json().data.items[0].text,'需要核查的原始消息')
  assert.equal(result.json().data.items[0].sender.username,'qa_alice')
  assert.doesNotMatch(result.body,/passwordHash|studentId|idCard|schoolSubject|accessToken/)
  await app.services.database.transaction(d=>{d.accounts.find(a=>a.id===users.admin.id).mustChangePassword=true})
  assert.equal((await call('admin','GET',base+'/messages')).statusCode,403)
})

test('隐藏/恢复：原文保留；用户摘要、幂等重试和旧游标均不泄露；版本冲突保护',async t=>{
  const {call,chat,c,base,send,moderate,users}=await fixture(t)
  const m=(await send()).json().data
  assert.equal((await moderate(m.id,'hidden',0,'')).statusCode,400)
  const hide=await moderate(m.id,'hidden');assert.equal(hide.statusCode,200,hide.body)
  assert.equal((await moderate(m.id,'visible',0)).statusCode,409)
  const publicResult=await call('bob','GET',`/api/v1/chat/conversations/${c.id}/messages?after=1&revision=0`)
  assert.equal(publicResult.json().data.reset,true);assert.equal(publicResult.json().data.revision,1)
  assert.equal(publicResult.json().data.items[0].status,'hidden');assert.doesNotMatch(publicResult.body,/需要核查|平台规则核查/)
  assert.doesNotMatch(JSON.stringify(chat.list(users.alice.id)),/需要核查/)
  const retry=await send();assert.equal(retry.json().data.status,'hidden');assert.doesNotMatch(retry.body,/需要核查/)
  const admin=(await call('admin','GET',base+'/messages')).json().data
  assert.equal(admin.items[0].text,'需要核查的原始消息');assert.equal(admin.history.length,1);assert.equal(admin.history[0].actor.id,users.admin.id)
  assert.equal((await moderate(m.id,'visible',1)).statusCode,200)
  const restored=chat.messages(users.bob.id,c.id,{after:1,revision:1});assert.equal(restored.reset,true);assert.equal(restored.items[0].text,'需要核查的原始消息')
})

test('附件管理：旧用户票据随隐藏失效；管理票据可查原件，注销/撤权后失效',async t=>{
  const {app,chat,call,c,base,moderate,users,tokens}=await fixture(t)
  const u=await chat.startUpload(users.alice.id,c.id,{name:'原始记录.bin',size:128})
  await chat.putChunk(users.alice.id,u.id,0,Buffer.alloc(64,10));await chat.putChunk(users.alice.id,u.id,1,Buffer.alloc(64,20));await chat.complete(users.alice.id,u.id)
  const route='/api/v1/admin/chat/files/'+u.id+'/ticket'
  assert.equal((await call('admin','POST',route,{})).statusCode,404)
  const m=await chat.send(users.alice.id,c.id,{kind:'file',attachmentId:u.id,clientMessageId:'file'})
  const memberLink=chat.ticket(users.bob.id,u.id).url
  assert.equal((await call('alice','POST',route,{})).statusCode,403)
  const link=(await call('admin','POST',route,{})).json().data.url
  await moderate(m.id,'hidden')
  assert.equal((await call(null,'GET',memberLink)).statusCode,403)
  assert.equal((await call('bob','POST',`/api/v1/chat/files/${u.id}/ticket`,{})).statusCode,403)
  assert.doesNotMatch((await call('bob','GET',`/api/v1/chat/conversations/${c.id}/messages`)).body,/原始记录|attachmentId/)
  const binary=await call(null,'GET',link,undefined,{range:'bytes=60-67'})
  assert.equal(binary.statusCode,206,binary.body);assert.deepEqual(binary.rawPayload,Buffer.from([10,10,10,10,20,20,20,20]))
  const audit=await app.services.audit.list({targetId:u.id});assert.ok(audit.items.some(e=>e.actor===users.admin.id&&e.trace.authorizationSource==='admin-chat-ticket'))
  app.services.sessions.revoke(tokens.admin)
  assert.equal((await call(null,'GET',link)).statusCode,401)
  tokens.admin=app.services.sessions.issueAccess(users.admin).accessToken
  const newer=(await call('admin','POST',route,{})).json().data.url
  await app.services.database.transaction(d=>{d.accounts.find(a=>a.id===users.admin.id).isAdmin=false})
  assert.equal((await call(null,'HEAD',newer)).statusCode,403)
  assert.equal((await call(null,'GET',newer,undefined,{range:'bytes=1-2'})).statusCode,403)
  assert.equal((await call('admin','GET',base+'/messages')).statusCode,403)
})

test('停用会话：发送/上传/分片/完成/成员修改封锁，历史与取消和退群保留',async t=>{
  const {chat,call,c,moderate,send,users,oversight}=await fixture(t)
  await send();const u=await chat.startUpload(users.alice.id,c.id,{name:'pending.bin',size:64});await chat.putChunk(users.alice.id,u.id,0,Buffer.alloc(64))
  assert.equal((await moderate(null,'paused')).statusCode,200)
  assert.equal((await send('停用后不可发送','second')).statusCode,403)
  const duplicate=await chat.create(users.alice.id,{type:'direct',memberIds:[users.bob.id]});assert.equal(duplicate.id,c.id);assert.equal(duplicate.status,'paused')
  await assert.rejects(chat.startUpload(users.alice.id,c.id,{name:'new.bin',size:64}),{code:'CHAT_PAUSED'})
  await assert.rejects(chat.putChunk(users.alice.id,u.id,0,Buffer.alloc(64)),{code:'CHAT_PAUSED'})
  await assert.rejects(chat.complete(users.alice.id,u.id),{code:'CHAT_PAUSED'})
  assert.equal(chat.messages(users.bob.id,c.id).items.length,1)
  await chat.cancel(users.alice.id,u.id)
  assert.equal((await moderate(null,'active',1)).statusCode,200);assert.equal((await send('已恢复','third')).statusCode,201)
  const g=await chat.create(users.alice.id,{type:'group',title:'退出群测试',memberIds:[users.bob.id]})
  await chat.send(users.bob.id,g.id,{kind:'text',text:'退群前的发言',clientMessageId:'group'})
  await oversight.moderate(users.admin.id,g.id,null,{status:'paused',revision:0,reason:'停止违规活动'})
  await assert.rejects(chat.group(users.alice.id,g.id,{title:'改群名'}),{code:'CHAT_PAUSED'})
  await chat.leave(users.bob.id,g.id)
  await assert.rejects(()=>chat.leave(users.alice.id,g.id),{code:'CHAT_OWNER_CANNOT_LEAVE'})
  await chat.dissolve(users.alice.id,g.id,{revision:chat.conversation(users.alice.id,g.id).groupRevision})
  await chat.leave(users.alice.id,g.id)
  assert.equal(oversight.detail(users.admin.id,g.id).items[0].text,'退群前的发言')
})

test('真实群路由强制固定群不可退出、自建群仅群主解散并记录中文审计',async t=>{
  const {app,call,users}=await fixture(t)
  const groups=(await call('alice','GET','/api/v1/chat/conversations')).json().data.items
  const fixed=groups.find(row=>row.schoolGroup)
  assert.equal((await call('alice','POST',`/api/v1/chat/conversations/${fixed.id}/leave`,{})).json().code,'CHAT_SCHOOL_GROUP_FIXED')
  assert.equal((await call('alice','POST',`/api/v1/chat/conversations/${fixed.id}/dissolve`,{revision:fixed.groupRevision})).json().code,'CHAT_SCHOOL_GROUP_FIXED')
  const response=await call('alice','POST','/api/v1/chat/conversations',{type:'group',title:'路由解散验收',memberIds:[users.bob.id,users.delegate.id]})
  assert.equal(response.statusCode,201,response.body)
  const c=response.json().data,route=`/api/v1/chat/conversations/${c.id}`
  assert.equal((await call('bob','POST',route+'/dissolve',{revision:0})).statusCode,403)
  assert.equal((await call('bob','POST',route+'/leave',{})).statusCode,200)
  assert.equal((await call('alice','POST',route+'/dissolve',{revision:0})).json().code,'CHAT_GROUP_CONFLICT')
  const dissolved=await call('alice','POST',route+'/dissolve',{revision:1})
  assert.equal(dissolved.statusCode,200,dissolved.body)
  assert.equal(dissolved.json().data.conversation.status,'dissolved')
  assert.equal((await call('delegate','GET',route+'/messages')).statusCode,200)
  assert.equal((await call('delegate','POST',route+'/messages',{kind:'text',text:'不应发送',clientMessageId:'after-dissolved'})).json().code,'CHAT_DISSOLVED')
  const audit=await app.services.audit.list({actor:users.alice.id})
  assert.ok(audit.items.some(row=>row.details.label==='群主解散自建群聊'&&row.trace.result==='success'))
})

test('全量分页和检索：消息不截断、账号/内容/文件/日期筛选且不虚构历史IP',async t=>{
  const {chat,call,c,base,users,oversight}=await fixture(t)
  for(let i=0;i<67;i++)await chat.send(users.alice.id,c.id,{kind:'text',text:'分页消息 '+i,clientMessageId:'page-'+i})
  const pages=await Promise.all([1,2,3].map(page=>call('admin','GET',base+'/messages?page='+page)))
  assert.equal(pages[0].json().data.total,67);assert.equal(new Set(pages.flatMap(r=>r.json().data.items.map(m=>m.id))).size,67)
  assert.equal(pages[0].json().data.items[0].trace,null)
  assert.equal((await call('admin','GET','/api/v1/admin/chat/conversations?query='+encodeURIComponent('分页消息 66'))).json().data.total,1)
  assert.equal((await call('admin','GET',base+'/messages?query='+encodeURIComponent('分页消息 66'))).json().data.total,1)
  assert.equal((await call('admin','GET',base+'/messages?from=2099-01-01')).json().data.total,0)
  assert.equal((await call('admin','GET',base+'/messages?from=2099-01-01&to=2000-01-01')).statusCode,400)
  for(let i=0;i<22;i++)await chat.create(users.alice.id,{type:'group',title:'分页群'+i,memberIds:[users.bob.id]})
  // 23 个手建会话之外，实名资料还会产生 1 个真实学院群。
  assert.equal(oversight.list(users.admin.id).items.length,20);assert.equal(oversight.list(users.admin.id,{page:2}).items.length,4)
  assert.equal(oversight.list(users.admin.id).total,24)
})

test('来源IP与管理员读取审计：不信任客户端伪造，管理事件与状态原子持久化',async t=>{
  const {app,chat,call,c,base,users,moderate}=await fixture(t)
  const created=await call('alice','POST',`/api/v1/chat/conversations/${c.id}/messages`,{kind:'text',text:'只保存在消息库的内容',clientMessageId:'trace',trace:{ip:'1.2.3.4'}},{'x-forwarded-for':'8.8.8.8','user-agent':'QA Browser'})
  assert.equal(created.statusCode,201,created.body);assert.doesNotMatch(created.body,/QA Browser|1\.2\.3\.4/)
  const m=created.json().data
  const d=(await call('admin','GET',base+'/messages')).json().data
  assert.notEqual(d.items[0].trace.ip,'8.8.8.8');assert.notEqual(d.items[0].trace.ip,'1.2.3.4')
  await moderate(m.id,'hidden')
  const raw=JSON.parse(await fs.readFile(path.join(chat.dir,'index.json'),'utf8'))
  assert.equal(raw.messages[0].status,'hidden');assert.equal(raw.chatModerationEvents[0].messageId,m.id);assert.equal(raw.chatModerationEvents[0].actor.id,users.admin.id)
  const logs=await app.services.audit.list({targetId:c.id})
  assert.ok(logs.items.some(e=>e.actor===users.admin.id&&e.details.label==='管理员查看聊天记录'))
  assert.ok(logs.items.some(e=>e.actor===users.admin.id&&e.details.label==='管理对话消息可见性'))
  assert.doesNotMatch(JSON.stringify(logs),/只保存在消息库的内容/)
})

test('自动群路由同步并支持后台指定群主，用户路径只有群主可授管理员且冲突受保护',async t=>{
 const {chat,call,users}=await fixture(t)
 const listed=await call('alice','GET','/api/v1/chat/conversations')
 assert.equal(listed.statusCode,200,listed.body)
 const group=listed.json().data.items.find(c=>c.schoolGroup)
 assert.ok(group)
 const url='/api/v1/admin/chat/conversations/'+group.id+'/owner'
 for(const actor of [null,'alice','delegate'])assert.equal((await call(actor,'PUT',url,{ownerId:users.alice.id,revision:group.groupRevision})).statusCode,actor?403:401)
 const owned=await call('admin','PUT',url,{ownerId:users.alice.id,revision:group.groupRevision})
 assert.equal(owned.statusCode,200,owned.body)
 const path='/api/v1/chat/conversations/'+group.id
 const grant=await call('alice','PATCH',path,{adminId:users.bob.id,role:'admin',revision:owned.json().data.groupRevision})
 assert.equal(grant.statusCode,200,grant.body)
 assert.equal((await call('alice','PATCH',path,{adminId:users.bob.id,role:'member',revision:owned.json().data.groupRevision})).statusCode,409)
 assert.equal(chat.conversation(users.bob.id,group.id).permissions.manageMembers,true)
 assert.equal(chat.conversation(users.bob.id,group.id).permissions.manageAdmins,false)
})

test('管理表情原件与落盘失败回滚：下架表情仍可后台核查，普通用户不可读取',async t=>{
  const {chat,call,users,c,moderate,send}=await fixture(t)
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')
  const s=await chat.saveSticker(users.admin.id,{name:'核查表情',category:'测试',status:'hidden',sortOrder:1,dataBase64:bytes.toString('base64')})
  assert.equal((await call(null,'GET',s.url)).statusCode,404)
  assert.equal((await call('alice','GET',`/api/v1/admin/chat/stickers/${s.id}/content`)).statusCode,403)
  const admin=await call('admin','GET',`/api/v1/admin/chat/stickers/${s.id}/content`);assert.equal(admin.statusCode,200);assert.deepEqual(admin.rawPayload,bytes)
  const m=(await send()).json().data,persist=chat.db.persist.bind(chat.db)
  chat.db.persist=async()=>{throw new Error('test disk failure')}
  assert.equal((await moderate(m.id,'hidden')).statusCode,500)
  assert.equal(chat.messages(users.bob.id,c.id).items[0].text,'需要核查的原始消息')
  assert.equal(chat.db.read(d=>(d.chatModerationEvents||[]).length),0)
  chat.db.persist=persist;assert.equal((await moderate(m.id,'hidden')).statusCode,200)
})
