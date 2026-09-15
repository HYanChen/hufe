import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { MAX_FILE_SIZE } from '../src/chat/service.js'
import { educationSnapshot, selfProfile } from '../src/accounts/profile.js'
import { mapSchoolIdentity } from '../src/auth/identity.js'
import { ModerationService } from '../src/moderation/service.js'

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')
test('管理员补录来源及实际毕业年份独立于人员类型；学校后续变更不沿用旧来源',()=>{
  const fields={major:'计算机科学与技术',className:'2022级专升本计算机科学与技术一班',enrollmentYear:'2022',graduationYear:'2024'}
  const account={id:'test',name:'测试',personType:'student',schoolIdentityVerified:true,...fields,educationSupplement:{source:'explicit-user-request',fields,graduationYearConfirmed:true}}
  const profile=selfProfile(account)
  assert.deepEqual(profile.educationSupplementedFields,Object.keys(fields));assert.equal(profile.graduationYearConfirmed,true);assert.equal(profile.fields.expectedGraduationYear,'');assert.equal(profile.personType,'student')
  assert.ok(profile.lockedFields.includes('graduationYear'))
  const changed=selfProfile({...account,major:'新专业',graduationYear:'2028'})
  assert.equal(changed.educationSupplementedFields.includes('major'),false);assert.equal(changed.graduationYearConfirmed,false);assert.equal(changed.fields.expectedGraduationYear,'2028')
})
async function fixture(t,overrides={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-chat-qa-'))
  const status={stale:false,itemCount:0,sourceStatuses:[]}
  const contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>status,home:()=>({status,sections:{}}),list:()=>({items:[],total:0,status}),get:async()=>null}
  const app=await buildApp({config:createConfig({env:'test',dataFile:path.join(dir,'data.json'),mediaDir:path.join(dir,'media'),dataHashSecret:'isolated-chat-qa',chatChunkSize:64,...overrides}),logger:false,refreshContent:false,scheduleContent:false,contentService})
  t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true})})
  const users={},headers={}
  for(const name of ['admin','alice','bob','carol']){
    users[name]=await app.services.accounts.register({schoolSubject:'chat-qa-'+name,name:'测试'+name,department:'测试学院',personType:'student',isAdmin:name==='admin',verificationSource:'school-registration-check',...(name==='alice'?{major:'学校专业',enrollmentYear:'2020'}:{})},{username:'qa_'+name,password:'Only-QA-'+name+'-2026!'})
    headers[name]={authorization:'Bearer '+app.services.sessions.issueAccess(users[name]).accessToken}
  }
  const call=(who,method,url,payload,extra={})=>app.inject({method,url,headers:{...headers[who],...extra},...(payload===undefined?{}:{payload})})
  const chat=app.services.chat
  const direct=()=>chat.create(users.alice.id,{type:'direct',memberIds:[users.bob.id]})
  const upload=async(cid,bytes=png)=>{const u=await chat.startUpload(users.alice.id,cid,{name:'测试.png',size:bytes.length});for(let i=0;i<u.parts;i++)await chat.putChunk(users.alice.id,u.id,i,bytes.subarray(i*u.chunkSize,(i+1)*u.chunkSize));await chat.complete(users.alice.id,u.id);return u}
  return {app,dir,users,headers,call,chat,direct,upload}
}

test('本人资料：学籍只读、补充持久化、版本冲突、敏感字段不泄露',async t=>{
  const {app,call,users}=await fixture(t)
  assert.deepEqual(educationSnapshot({}),{})
  assert.equal((await call(null,'GET','/api/v1/me/profile')).statusCode,401)
  const profile=(await call('alice','GET','/api/v1/me/profile')).json().data
  assert.equal(profile.fields.major,'学校专业');assert.ok(profile.lockedFields.includes('major'))
  for(const fields of [{major:'冒改专业'},{className:'自填班级'},{enrollmentYear:'2020'},{graduationYear:'2024'},{expectedGraduationYear:'2028'},{studentId:'123456'},{isAdmin:true}])assert.equal((await call('alice','PATCH','/api/v1/me/profile',{revision:0,fields})).statusCode,400)
  const saved=await call('alice','PATCH','/api/v1/me/profile',{revision:0,fields:{city:'长沙',email:'qa@example.test'}})
  assert.equal(saved.statusCode,200,saved.body)
  assert.equal((await call('alice','PATCH','/api/v1/me/profile',{revision:0,fields:{city:'北京'}})).statusCode,409)
  assert.equal((await call('alice','GET','/api/v1/me/profile')).json().data.fields.city,'长沙市')
  assert.equal((await call('bob','GET','/api/v1/me/profile')).json().data.fields.className,'')
  assert.doesNotMatch(JSON.stringify(app.services.accounts.getActiveAccount(users.alice.id)),/qa@example|personalProfile|profileRevision/)
})

test('学校学籍全链路：班级专业与预计毕业年映射，已有账号复验刷新，不采纳历史自填',async t=>{
  const {app,call,users}=await fixture(t)
  const config=createConfig({env:'test',dataHashSecret:'isolated-chat-qa',auth:{alumniVerifyApiUrl:'',attributes:{major:'zy',className:'bj',enrollmentYear:'rxnf',expectedGraduationYear:'yjby'}}})
  const identity=await mapSchoolIdentity({subject:'chat-qa-alice',claims:{cn:'测试alice',department:'测试学院',personType:'student',zy:'计算机科学与技术',bj:'2022级1班',rxnf:'2022',yjby:'2026'}},config)
  assert.equal(identity.expectedGraduationYear,'2026');assert.equal(identity.className,'2022级1班')
  const result=await app.services.accounts.checkRegistrationEligibility(identity)
  assert.equal(result.status,'account_exists')
  const profile=(await call('alice','GET','/api/v1/me/profile')).json().data
  assert.equal(profile.fields.major,'计算机科学与技术');assert.equal(profile.fields.enrollmentYear,'2022');assert.equal(profile.fields.expectedGraduationYear,'2026');assert.equal(profile.fields.className,'2022级1班')
  await app.services.database.transaction(d=>{const a=d.accounts.find(a=>a.id===users.bob.id);a.personalProfile={major:'历史自填专业',className:'历史自填班级',graduationYear:'2024'};a.graduationYear='2028'})
  const current=(await call('bob','GET','/api/v1/me/profile')).json().data
  assert.equal(current.fields.major,'');assert.equal(current.fields.className,'');assert.equal(current.fields.expectedGraduationYear,'2028');assert.ok(current.lockedFields.includes('className'))
})

test('对话：私聊幂等、真实消息、已读、群管理与加入后的可见范围',async t=>{
  const {call,chat,direct,users}=await fixture(t)
  assert.equal((await call(null,'GET','/api/v1/chat/conversations')).statusCode,401)
  const [a,b]=await Promise.all([direct(),direct()]);assert.equal(a.id,b.id)
  const m={kind:'text',text:'你好 👋',clientMessageId:'qa-one'}
  assert.equal((await call('alice','POST',`/api/v1/chat/conversations/${a.id}/messages`,m)).statusCode,201)
  const replay=await chat.send(users.alice.id,a.id,m);assert.equal(replay.seq,1)
  await assert.rejects(chat.send(users.alice.id,a.id,{...m,text:'另一个内容'}),{statusCode:409})
  assert.equal(chat.list(users.bob.id).items[0].unread,1)
  assert.equal((await call('carol','GET',`/api/v1/chat/conversations/${a.id}/messages`)).statusCode,403)
  await chat.read(users.bob.id,a.id,1);assert.equal(chat.list(users.bob.id).items[0].unread,0)
  const g=await chat.create(users.alice.id,{type:'group',title:'测试群',memberIds:[users.bob.id]})
  await chat.send(users.alice.id,g.id,m)
  await assert.rejects(chat.group(users.bob.id,g.id,{title:'越权改名'}),{statusCode:403})
  await chat.group(users.alice.id,g.id,{addIds:[users.carol.id]})
  assert.equal(chat.messages(users.carol.id,g.id).items.length,0)
  await chat.send(users.bob.id,g.id,{...m,clientMessageId:'second'})
  assert.equal(chat.messages(users.carol.id,g.id).items.length,1)
  await chat.group(users.alice.id,g.id,{removeId:users.carol.id})
  assert.throws(()=>chat.messages(users.carol.id,g.id),{statusCode:403})
  await chat.leave(users.bob.id,g.id)
  assert.throws(()=>chat.conversation(users.bob.id,g.id),{statusCode:403})
})

test('分片：鉴权、校验与续传、单文件5GB边界、绑定后不可取消、Range下载',async t=>{
  const {call,chat,direct,users}=await fixture(t);const c=await direct()
  const u=await chat.startUpload(users.alice.id,c.id,{name:'相聚.png',size:png.length})
  const endpoint=`/api/v1/chat/uploads/${u.id}/chunks/0`
  assert.equal((await call(null,'PUT',endpoint,png.subarray(0,64),{'content-type':'application/octet-stream'})).statusCode,401)
  assert.equal((await call('bob','PUT',endpoint,png.subarray(0,64),{'content-type':'application/octet-stream'})).statusCode,404)
  const put=await call('alice','PUT',endpoint,png.subarray(0,64),{'content-type':'application/octet-stream'});assert.equal(put.statusCode,200,put.body)
  await chat.putChunk(users.alice.id,u.id,0,png.subarray(0,64))
  await assert.rejects(chat.putChunk(users.alice.id,u.id,0,Buffer.alloc(64)),{statusCode:409})
  assert.ok((await chat.uploadStatus(users.alice.id,u.id)).received[0])
  await assert.rejects(chat.complete(users.alice.id,u.id))
  await chat.putChunk(users.alice.id,u.id,1,png.subarray(64));await chat.complete(users.alice.id,u.id)
  await chat.send(users.alice.id,c.id,{kind:'image',attachmentId:u.id,clientMessageId:'image-one'})
  await assert.rejects(chat.cancel(users.alice.id,u.id))
  const link=chat.ticket(users.bob.id,u.id).url
  assert.equal((await call(null,'GET',`/api/v1/chat/files/${u.id}`)).statusCode,401)
  assert.equal((await call('carol','POST',`/api/v1/chat/files/${u.id}/ticket`,{})).statusCode,403)
  const ranged=await call(null,'GET',link,undefined,{range:'bytes=60-67'})
  assert.equal(ranged.statusCode,206);assert.deepEqual(ranged.rawPayload,png.subarray(60,68))
  assert.equal(ranged.headers['cache-control'],'private, no-store')
  assert.equal(ranged.headers['cross-origin-resource-policy'],'cross-origin')
  assert.equal((await call(null,'GET',link,undefined,{range:'bytes=-0'})).statusCode,416)
  await assert.rejects(chat.startUpload(users.alice.id,c.id,{name:'over.bin',size:MAX_FILE_SIZE+1}),{statusCode:413})
  const largest=await chat.startUpload(users.alice.id,c.id,{name:'limit.bin',size:MAX_FILE_SIZE});assert.equal(largest.size,MAX_FILE_SIZE);await chat.cancel(users.alice.id,largest.id)
})

test('附件：过期与群成员撤销、无法看到加入前附件、下载票据不绕过封禁',async t=>{
  const {app,chat,users,upload}=await fixture(t)
  const c=await chat.create(users.alice.id,{type:'group',title:'权限测试',memberIds:[users.bob.id]})
  const stale=await upload(c.id)
  await chat.db.transaction(d=>{d.uploads.find(u=>u.id===stale.id).expiresAt=1})
  await assert.rejects(chat.send(users.alice.id,c.id,{kind:'image',attachmentId:stale.id,clientMessageId:'expired'}))
  await chat.cleanup();await assert.rejects(fs.stat(chat.uploadPath(stale.id)),{code:'ENOENT'})
  const live=await upload(c.id)
  await chat.send(users.alice.id,c.id,{kind:'image',attachmentId:live.id,clientMessageId:'valid'})
  await chat.group(users.alice.id,c.id,{addIds:[users.carol.id]})
  assert.throws(()=>chat.ticket(users.carol.id,live.id),{statusCode:403})
  const ticket=new URL(chat.ticket(users.bob.id,live.id).url,'http://test').searchParams.get('ticket')
  await chat.group(users.alice.id,c.id,{removeId:users.bob.id})
  assert.throws(()=>chat.download(live.id,ticket),{statusCode:403})
  const ownTicket=new URL(chat.ticket(users.alice.id,live.id).url,'http://test').searchParams.get('ticket')
  await app.services.database.transaction(d=>{d.accounts.find(u=>u.id===users.alice.id).status='suspended'})
  assert.throws(()=>chat.download(live.id,ownTicket),{statusCode:401})
})

test('后台表情包：上传、分组、替换回收、下架、非法格式和普通用户越权',async t=>{
  const {call,chat,users,direct}=await fixture(t)
  const body={name:'你好',category:'湖财问候',sortOrder:1,status:'active',dataBase64:png.toString('base64')}
  assert.equal((await call('alice','POST','/api/v1/admin/chat-stickers',body)).statusCode,403)
  const created=await call('admin','POST','/api/v1/admin/chat-stickers',body);assert.equal(created.statusCode,200,created.body);const s=created.json().data
  assert.equal(chat.stickers(users.alice.id).items[0].category,'湖财问候')
  assert.equal((await call(null,'GET',s.url)).statusCode,200)
  const old=chat.db.read(d=>d.stickers[0].filename)
  await chat.saveSticker(users.admin.id,body,s.id)
  await assert.rejects(fs.stat(path.join(chat.dir,'stickers',old)),{code:'ENOENT'})
  const c=await direct();await chat.send(users.alice.id,c.id,{kind:'sticker',stickerId:s.id,clientMessageId:'sticker-one'})
  await chat.saveSticker(users.admin.id,{...body,dataBase64:undefined,status:'hidden'},s.id)
  assert.equal((await call(null,'GET',s.url)).statusCode,404)
  assert.equal(chat.messages(users.bob.id,c.id).items[0].sticker.url,'')
  await assert.rejects(chat.send(users.alice.id,c.id,{kind:'sticker',stickerId:s.id,clientMessageId:'sticker-two'}))
  await assert.rejects(chat.saveSticker(users.admin.id,{...body,dataBase64:Buffer.from('<svg><script/></svg>').toString('base64')}))
})

test('敏感词：管理员批量、去重、启停和发帖/匿名评论/组织留言/对话全部阻止入库',async t=>{
  const {app,call,chat,direct}=await fixture(t)
  const root='/api/v1/admin/sensitive-words'
  assert.equal((await call('alice','POST',root,{words:['测试禁词'],enabled:true})).statusCode,403)
  const added=await call('admin','POST',root,{words:['测试禁词','FORBIDDEN',' forbidden '],enabled:true});assert.equal(added.statusCode,200,added.body)
  const rules=(await call('admin','GET',root)).json().data.items;assert.equal(rules.length,2)
  const c=await direct()
  const ok=await call('alice','POST','/api/v1/business/community-posts',{content:'今天阳光真好',anonymous:true});assert.equal(ok.statusCode,201,ok.body)
  const post=ok.json().data
  const routes=[
    ['/api/v1/business/community-posts',{content:'测 试\u200b禁词',anonymous:true}],
    [`/api/v1/business/community-posts/${post.id}/comments`,{content:'测试禁词',anonymous:true}],
    ['/api/v1/business/organizations/test-org/messages',{content:'测试禁词'}],
    ['/api/v1/business/submissions',{type:'community-comment',resourceId:post.id,payload:{content:'测试禁词'}}],
    [`/api/v1/chat/conversations/${c.id}/messages`,{kind:'text',text:'ＦＯＲＢＩＤＤＥＮ',clientMessageId:'blocked'}],
    ['/api/v1/business/organizations/test-org/albums',{title:'测试禁词'}]
  ]
  const before=app.services.database.read()
  for(const [url,body]of routes){const r=await call('alice','POST',url,body);assert.equal(r.statusCode,422,r.body);assert.equal(r.json().code,'CONTENT_SENSITIVE_WORD')}
  assert.deepEqual(app.services.database.read(),before)
  assert.equal(chat.db.read(d=>d.messages.length),0)
  assert.throws(()=>app.services.moderation.assert({content:'测试**禁**词'}),{statusCode:422})
  await call('admin','POST',root,{words:['text','12345'],enabled:true})
  assert.equal((await call('alice','POST','/api/v1/business/community-posts',{content:12345})).statusCode,422)
  assert.equal((await call('alice','POST',`/api/v1/chat/conversations/${c.id}/uploads`,{name:'测试禁词.pdf',size:64})).statusCode,422)
  assert.equal((await call('alice','POST',`/api/v1/chat/conversations/${c.id}/messages`,{kind:'text',text:'普通消息',clientMessageId:'safe'})).statusCode,201)
  assert.throws(()=>new ModerationService(app.services.database).assert({content:'forbidden'}),{statusCode:422})
  for(const row of rules)assert.equal((await call('admin','PATCH',root+'/'+row.id,{enabled:false})).statusCode,200)
  const allowed=await call('alice','POST',`/api/v1/business/community-posts/${post.id}/comments`,{content:'测试禁词',anonymous:true});assert.equal(allowed.statusCode,201,allowed.body)
})

test('过期孤立文件回收，保留新建未提交目录；分片持久化失败可重新上传',async t=>{
  const {chat,direct,users}=await fixture(t);const c=await direct()
  const orphan=chat.uploadPath(randomUUID()),fresh=chat.uploadPath(randomUUID())
  await fs.mkdir(orphan,{recursive:true});await fs.mkdir(fresh,{recursive:true});await fs.utimes(orphan,new Date(0),new Date(0));await chat.cleanup()
  await assert.rejects(fs.stat(orphan),{code:'ENOENT'});assert.ok((await fs.stat(fresh)).isDirectory())
  const u=await chat.startUpload(users.alice.id,c.id,{name:'retry.bin',size:64})
  const save=chat.saveManifest.bind(chat);chat.saveManifest=async()=>{throw new Error('simulated disk failure')}
  await assert.rejects(chat.putChunk(users.alice.id,u.id,0,Buffer.alloc(64)))
  chat.saveManifest=save;await chat.putChunk(users.alice.id,u.id,0,Buffer.alloc(64));await chat.complete(users.alice.id,u.id)
  assert.equal((await chat.uploadStatus(users.alice.id,u.id)).status,'ready')
})

test('上传后新增敏感词仍在发送时复查文件名；中断分片不占死上传槽位',async t=>{
  const {app,call,chat,direct,users}=await fixture(t);const c=await direct()
  app.addHook('preParsing',(r,_p,payload,done)=>{if(r.headers['x-test-abort'])r.raw.emit('aborted');done(null,payload)})
  const u=await chat.startUpload(users.alice.id,c.id,{name:'稍后限制的文件.bin',size:64})
  for(let i=0;i<5;i++)assert.equal((await call('alice','PUT',`/api/v1/chat/uploads/${u.id}/chunks/0`,Buffer.alloc(64),{'content-type':'application/octet-stream',...(i<4?{'x-test-abort':'1'}:{})})).statusCode,200)
  await chat.complete(users.alice.id,u.id)
  await call('admin','POST','/api/v1/admin/sensitive-words',{words:['稍后限制'],enabled:true})
  const denied=await call('alice','POST',`/api/v1/chat/conversations/${c.id}/messages`,{kind:'file',attachmentId:u.id,clientMessageId:'after-word-change'})
  assert.equal(denied.statusCode,422);assert.equal((await chat.uploadStatus(users.alice.id,u.id)).status,'ready')
})

test('真实5GiB分片写入、重启续传校验、跨4GiB边界下载（显式启用）',{skip:process.env.HUFE_QA_5GB!=='1'},async t=>{
  const {chat,users,direct}=await fixture(t,{chatChunkSize:4*1024*1024})
  const c=await direct(),u=await chat.startUpload(users.alice.id,c.id,{name:'qa-5GiB.bin',size:MAX_FILE_SIZE})
  const chunk=Buffer.alloc(u.chunkSize,42)
  for(let i=0;i<u.parts;i++){await chat.putChunk(users.alice.id,u.id,i,chunk);if(i===511){await chat.close();await chat.init();assert.equal(Object.keys((await chat.uploadStatus(users.alice.id,u.id)).received).length,512)}if(i%256===0)t.diagnostic(`已校验并持久化 ${i+1}/${u.parts} 个4MiB分片`)}
  assert.equal(Object.keys((await chat.uploadStatus(users.alice.id,u.id)).received).length,1280)
  await chat.putChunk(users.alice.id,u.id,1024,chunk)
  await chat.complete(users.alice.id,u.id)
  await chat.send(users.alice.id,c.id,{kind:'file',attachmentId:u.id,clientMessageId:'five-gib'})
  const ticket=new URL(chat.ticket(users.bob.id,u.id).url,'http://test').searchParams.get('ticket')
  for(const [range,length]of [['bytes=4294967290-4294967304',15],['bytes=-9',9],['bytes=5368709119-',1]]){
    const result=chat.download(u.id,ticket,range),parts=[];for await(const part of result.stream)parts.push(part)
    assert.deepEqual(Buffer.concat(parts),Buffer.alloc(length,42))
  }
})
