import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { JsonDatabase } from '../src/storage/json-database.js'
import { ChatService } from '../src/chat/service.js'
import { ChatAdminService } from '../src/chat/admin-service.js'

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-school-groups-'))
  const accounts = await new JsonDatabase(path.join(directory, 'accounts.json')).init()
  const make = (name, extra = {}) => ({ id: randomUUID(), name, username: name, status: 'active', personType: 'alumni', schoolIdentityVerified: true, department: '信息技术与管理学院', major: '计算机科学与技术', className: '一班', enrollmentYear: '2022', ...extra })
  const users = { alice: make('alice'), bob: make('bob'), carol: make('carol'), otherYear: make('otherYear', {enrollmentYear:'2023'}), otherDepartment: make('otherDepartment', {department:'会计学院'}), admin: make('admin', {isAdmin:true,personType:'staff',schoolIdentityVerified:false}), unverified: make('unverified',{schoolIdentityVerified:false}) }
  await accounts.transaction(d => { d.accounts = Object.values(users) })
  const config = { dataFile: accounts.file, env:'test' }
  let chat = await new ChatService(accounts, config).init()
  t.after(async () => { await chat.close(); await fs.rm(directory,{recursive:true,force:true}) })
  return { accounts, users, get chat(){return chat}, restart:async()=>{await chat.close();chat=await new ChatService(accounts,config).init();return chat} }
}

test('实名学籍自动建立三类群，班级跨学院和年份隔离，重复同步不重复建群', async t => {
  const {chat,users}=await setup(t)
  const groups=chat.list(users.alice.id).items
  assert.deepEqual(groups.map(g=>g.schoolGroup.kind).sort(),['class','department','major'])
  assert.ok(groups.every(g=>!g.ownerId && g.members.every(m=>m.role==='member')))
  const classroom=groups.find(g=>g.schoolGroup.kind==='class')
  assert.equal(classroom.title, '一班')
  assert.equal(groups.find(g=>g.schoolGroup.kind==='major').title, '计算机科学与技术')
  assert.equal(groups.find(g=>g.schoolGroup.kind==='department').title, '信息技术与管理学院')
  assert.ok(groups.every(g=>g.permissions.leave===false&&g.permissions.dissolve===false&&g.permissions.removeMembers===false))
  assert.equal(classroom.members.length,3)
  assert.throws(()=>chat.messages(users.otherYear.id,classroom.id),{code:'CHAT_FORBIDDEN'})
  assert.throws(()=>chat.messages(users.otherDepartment.id,classroom.id),{code:'CHAT_FORBIDDEN'})
  assert.throws(()=>chat.list(users.unverified.id),{code:'CHAT_VERIFICATION_REQUIRED'})
  const before=chat.db.read(d=>d.conversations.length)
  await Promise.all([chat.syncSchoolGroups(),chat.syncSchoolGroups(),chat.syncSchoolGroups()])
  assert.equal(chat.db.read(d=>d.conversations.length),before)
  assert.equal(new Set(chat.db.read(d=>d.conversations.map(c=>c.schoolGroup.key))).size,before)
})

test('后台指定实名群主，群主设置管理员，角色越权与版本冲突均阻止', async t => {
  const {chat,users}=await setup(t),cid=chat.list(users.alice.id).items.find(g=>g.schoolGroup.kind==='class').id
  const revision=()=>chat.conversation(users.alice.id,cid).groupRevision
  await assert.rejects(()=>chat.assignOwner(users.bob.id,cid,{ownerId:users.bob.id,revision:revision()}),{code:'ADMIN_REQUIRED'})
  await assert.rejects(()=>chat.assignOwner(users.admin.id,cid,{ownerId:users.otherYear.id,revision:revision()}))
  await chat.assignOwner(users.admin.id,cid,{ownerId:users.alice.id,revision:revision()})
  const first=revision()
  await chat.group(users.alice.id,cid,{adminId:users.bob.id,role:'admin',revision:first})
  await assert.rejects(()=>chat.group(users.alice.id,cid,{adminId:users.carol.id,role:'admin',revision:first}),{code:'CHAT_GROUP_CONFLICT'})
  await assert.rejects(()=>chat.group(users.bob.id,cid,{adminId:users.carol.id,role:'admin',revision:revision()}),{code:'CHAT_OWNER_REQUIRED'})
  await chat.group(users.alice.id,cid,{adminId:users.carol.id,role:'admin',revision:revision()})
  await assert.rejects(()=>chat.group(users.bob.id,cid,{removeId:users.carol.id,revision:revision()}),{code:'CHAT_SCHOOL_GROUP_FIXED'})
  await assert.rejects(()=>chat.group(users.bob.id,cid,{removeId:users.alice.id,revision:revision()}))
  await assert.rejects(()=>chat.group(users.alice.id,cid,{addIds:[users.otherYear.id],revision:revision()}))
  await assert.rejects(()=>chat.group(users.alice.id,cid,{title:'任意名称',revision:revision()}))
  await chat.group(users.alice.id,cid,{adminId:users.carol.id,role:'member',revision:revision()})
  await assert.rejects(()=>chat.group(users.bob.id,cid,{removeId:users.carol.id,revision:revision()}),{code:'CHAT_SCHOOL_GROUP_FIXED'})
  assert.ok(chat.conversation(users.alice.id,cid).members.some(m=>m.id===users.carol.id))
  assert.ok(chat.db.read(d=>d.chatGroupEvents.some(e=>e.action==='owner_assigned')))
  const result=new ChatAdminService(chat).detail(users.admin.id,cid)
  assert.equal(result.conversation.ownerId,users.alice.id)
  assert.equal(result.conversation.members.find(p=>p.id===users.bob.id).role,'admin')
  assert.equal(result.conversation.members.find(p=>p.id===users.bob.id).schoolIdentityVerified,true)
})

test('固定学籍群禁止退出并恢复历史退出标记；学籍变更仍立即撤销旧群访问并关联新群', async t => {
  const context=await setup(t),{users,accounts}=context
  let chat=context.chat,cid=chat.list(users.alice.id).items.find(g=>g.schoolGroup.kind==='class').id
  await assert.rejects(()=>chat.leave(users.bob.id,cid),{code:'CHAT_SCHOOL_GROUP_FIXED'})
  await chat.db.transaction(d=>{const group=d.conversations.find(c=>c.id===cid);group.members=group.members.filter(m=>m.id!==users.bob.id);group.excludedIds=[users.bob.id];group.title='旧版包含学院的标题'})
  await context.restart();chat=context.chat
  assert.ok(chat.list(users.bob.id).items.some(c=>c.id===cid))
  assert.equal(chat.conversation(users.bob.id,cid).title,'一班')
  assert.deepEqual(chat.db.read(d=>d.conversations.find(c=>c.id===cid).excludedIds),[])
  assert.ok(chat.db.read(d=>d.chatGroupEvents.some(e=>e.restoredFixedMemberships===1)))
  await chat.assignOwner(users.admin.id,cid,{ownerId:users.alice.id,revision:chat.conversation(users.alice.id,cid).groupRevision})
  await chat.send(users.alice.id,cid,{kind:'text',text:'旧班级消息',clientMessageId:'old'})
  await accounts.transaction(d=>{d.accounts.find(a=>a.id===users.alice.id).enrollmentYear='2024'})
  assert.throws(()=>chat.messages(users.alice.id,cid),{code:'CHAT_FORBIDDEN'})
  await chat.syncSchoolGroups()
  const next=chat.list(users.alice.id).items.find(c=>c.schoolGroup.kind==='class')
  assert.notEqual(next.id,cid);assert.equal(next.members.length,1)
  assert.equal(chat.db.read(d=>d.conversations.find(c=>c.id===cid).ownerId),'')
  assert.equal(chat.messages(users.alice.id,next.id).items.length,0)
  await accounts.transaction(d=>{d.accounts.find(a=>a.id===users.bob.id).schoolIdentityVerified=false})
  await chat.syncSchoolGroups()
  assert.ok(!chat.db.read(d=>d.conversations.find(c=>c.id===cid).members.some(m=>m.id===users.bob.id)))
})

test('自建群成员可退出、群主不能直接退出且仅群主可解散，固定群不受管理人设置影响', async t=>{
  const {chat,users}=await setup(t)
  const c=await chat.create(users.alice.id,{type:'group',title:'自建讨论群',memberIds:[users.bob.id,users.carol.id]})
  assert.equal(c.permissions.leave,false)
  assert.equal(c.permissions.dissolve,true)
  assert.equal(chat.conversation(users.bob.id,c.id).permissions.leave,true)
  await assert.rejects(()=>chat.leave(users.alice.id,c.id),{code:'CHAT_OWNER_CANNOT_LEAVE'})
  await chat.group(users.alice.id,c.id,{adminId:users.bob.id,role:'admin',revision:0})
  await assert.rejects(()=>chat.dissolve(users.bob.id,c.id,{revision:1}),{code:'CHAT_OWNER_REQUIRED'})
  await assert.rejects(()=>chat.dissolve(users.alice.id,c.id,{revision:0}),{code:'CHAT_GROUP_CONFLICT'})
  await chat.leave(users.carol.id,c.id,{requestId:'left-trace'})
  assert.throws(()=>chat.conversation(users.carol.id,c.id),{code:'CHAT_FORBIDDEN'})
  const classroom=chat.list(users.alice.id).items.find(g=>g.schoolGroup?.kind==='class')
  await chat.assignOwner(users.admin.id,classroom.id,{ownerId:users.alice.id,revision:classroom.groupRevision})
  await assert.rejects(()=>chat.dissolve(users.alice.id,classroom.id,{revision:chat.conversation(users.alice.id,classroom.id).groupRevision}),{code:'CHAT_SCHOOL_GROUP_FIXED'})
  const dissolved=await chat.dissolve(users.alice.id,c.id,{revision:2},{requestId:'dissolve-trace'})
  assert.equal(dissolved.dissolved,true)
  assert.equal(dissolved.conversation.status,'dissolved')
  assert.equal(dissolved.conversation.permissions.dissolve,false)
  assert.equal(dissolved.conversation.permissions.leave,true)
  assert.ok(chat.db.read(d=>d.chatGroupEvents.some(e=>e.action==='member_left'&&e.trace?.requestId==='left-trace')))
  assert.ok(chat.db.read(d=>d.chatGroupEvents.some(e=>e.action==='group_dissolved'&&e.trace?.requestId==='dissolve-trace')))
  await chat.leave(users.alice.id,c.id)
  assert.equal(chat.conversation(users.bob.id,c.id).status,'dissolved')
})

test('解散群保留真实聊天及附件历史，禁止新消息/上传/成员变更及后台重新启用，可跨重启读取', async t=>{
  const f=await setup(t),{users}=f;let chat=f.chat
  const c=await chat.create(users.alice.id,{type:'group',title:'历史保留群',memberIds:[users.bob.id]})
  await chat.send(users.alice.id,c.id,{kind:'text',text:'真实历史消息',clientMessageId:'history'})
  const upload=await chat.startUpload(users.alice.id,c.id,{name:'历史附件.bin',size:8})
  await chat.putChunk(users.alice.id,upload.id,0,Buffer.alloc(8,12));await chat.complete(users.alice.id,upload.id)
  await chat.send(users.alice.id,c.id,{kind:'file',attachmentId:upload.id,clientMessageId:'history-file'})
  const pending=await chat.startUpload(users.alice.id,c.id,{name:'未完成附件.bin',size:8})
  await chat.putChunk(users.alice.id,pending.id,0,Buffer.alloc(8,12))
  const oversight=new ChatAdminService(chat)
  await oversight.moderate(users.admin.id,c.id,null,{status:'paused',revision:0,reason:'暂停期间仍可明确解散'})
  const results=await Promise.all([chat.dissolve(users.alice.id,c.id,{revision:0}),chat.dissolve(users.alice.id,c.id,{revision:0})])
  assert.ok(results.every(r=>r.dissolved))
  assert.equal(chat.db.read(d=>d.chatGroupEvents.filter(e=>e.action==='group_dissolved').length),1)
  assert.equal(chat.messages(users.bob.id,c.id).items.length,2)
  assert.equal(chat.attachment(users.bob.id,upload.id).id,upload.id)
  await assert.rejects(()=>chat.send(users.alice.id,c.id,{kind:'text',text:'解散后发送',clientMessageId:'after'}),{code:'CHAT_DISSOLVED'})
  await assert.rejects(()=>chat.group(users.alice.id,c.id,{title:'解散后修改'}),{code:'CHAT_DISSOLVED'})
  await assert.rejects(()=>chat.startUpload(users.alice.id,c.id,{name:'解散后上传.bin',size:8}),{code:'CHAT_DISSOLVED'})
  await assert.rejects(()=>chat.putChunk(users.alice.id,pending.id,0,Buffer.alloc(8,12)),{code:'CHAT_DISSOLVED'})
  await assert.rejects(()=>chat.complete(users.alice.id,pending.id),{code:'CHAT_DISSOLVED'})
  await assert.rejects(()=>chat.assignOwner(users.admin.id,c.id,{ownerId:users.bob.id,revision:1}),{code:'CHAT_DISSOLVED'})
  await assert.rejects(()=>oversight.moderate(users.admin.id,c.id,null,{status:'active',revision:2,reason:'不可复活'}),{code:'CHAT_MODERATION_CONFLICT'})
  assert.equal(oversight.detail(users.admin.id,c.id).conversation.status,'dissolved')
  await f.restart();chat=f.chat
  assert.equal(chat.messages(users.bob.id,c.id).status,'dissolved')
  assert.equal(chat.messages(users.bob.id,c.id).items.length,2)
  await chat.cancel(users.alice.id,pending.id)
})

test('自建群解散写盘失败时不发布解散状态，重试保留原记录且不重复审计', async t=>{
  const {chat,users}=await setup(t),c=await chat.create(users.alice.id,{type:'group',title:'原子解散群',memberIds:[users.bob.id]})
  const persist=chat.db.persist.bind(chat.db)
  chat.db.persist=async()=>{throw Error('disk full')}
  await assert.rejects(()=>chat.dissolve(users.alice.id,c.id,{revision:0}),/disk full/)
  assert.equal(chat.conversation(users.alice.id,c.id).status,'active')
  assert.equal(chat.db.read(d=>d.chatGroupEvents.filter(e=>e.action==='group_dissolved').length),0)
  chat.db.persist=persist
  await chat.dissolve(users.alice.id,c.id,{revision:0})
  assert.equal(chat.conversation(users.alice.id,c.id).status,'dissolved')
})

test('资料未齐不编造班级，学院自动群不受普通群100人限制', async t => {
  const {chat,users,accounts}=await setup(t)
  await accounts.transaction(d=>{
    d.accounts.find(a=>a.id===users.alice.id).className=''
    for(let i=0;i<110;i++)d.accounts.push({...users.bob,id:randomUUID(),username:'student'+i,className:'',major:'',enrollmentYear:''})
  })
  await chat.syncSchoolGroups()
  const groups=chat.list(users.alice.id).items
  assert.ok(!groups.some(c=>c.schoolGroup.kind==='class'))
  assert.ok(groups.find(c=>c.schoolGroup.kind==='department').members.length>100)
})
