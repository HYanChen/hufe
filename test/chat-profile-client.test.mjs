import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { conversationTitle, isFixedGroup, canLeaveGroup, canDissolveGroup } from '../utils/chatGroups.js'
import { isManualVerification } from '../utils/identityVerification.js'

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
async function page(kind='chat',overrides={}){
  const file=kind==='chat'?'../components/ChatThread.vue':kind==='conversations'?'../components/ConversationList.vue':`../pages/${kind}/index.vue`
  const text=await fs.readFile(new URL(file,import.meta.url),'utf8')
  const script=text.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm,'').replace('export default','globalThis.options=')
const ctx={isManualVerification,getMyInbox:async()=>({items:[],unread:0}),conversationTitle,isFixedGroup,canLeaveGroup,canDissolveGroup,getAccessToken:()=> 'a',chatApi:async()=>({items:[]}),request:async()=>({id:'alice'}),chatUrl:x=>x,fileSize:x=>x,messageId:()=> 'client-id',setInterval:()=>0,clearInterval(){},AbortController,URLSearchParams,uni:{getStorageSync(){},setStorageSync(){},removeStorageSync(){},removeTabBarBadge(){},setTabBarBadge(){},showModal(){},showToast(){},previewImage(){}},openPage(){},identityLabel:x=>x,...overrides}
  vm.runInNewContext(script,ctx)
  const options=ctx.options,p={...options.data(),id:'group',sessionToken:'a',$nextTick:f=>f()}
  for(const [name,m]of Object.entries(options.methods))p[name]=m.bind(p)
  for(const [name,getter]of Object.entries(options.computed||{}))Object.defineProperty(p,name,{get:()=>getter.call(p)})
  return {p,options}
}

test('对话换号：旧群管理响应不可回填，旧文件选择不可替新账号上传',async()=>{
  let token='a';const pending=deferred()
  const {p}=await page('chat',{getAccessToken:()=>token,chatApi:()=>pending.promise})
  p.conversation={id:'group',type:'group',groupRevision:1,permissions:{rename:true},members:[]}
  const update=p.manage({title:'甲的群'});token='b';p.resetSession('b');pending.resolve({title:'甲的群',members:[{id:'private'}]});await update
  assert.equal(p.conversation,null)
  token='a';const picker=deferred();let uploads=0
  const {p:q}=await page('chat',{getAccessToken:()=>token,pickChatFile:()=>picker.promise,uploadChatFile:async()=>{uploads++}})
  const choosing=q.choose();token='b';q.resetSession('b');picker.resolve({name:'私人图片.png'});await choosing;assert.equal(uploads,0)
})

test('对话换号：轮询前发送不能借用旧草稿；旧预览不能打开',async()=>{
  let token='b',sends=0
  const {p}=await page('chat',{getAccessToken:()=>token,chatApi:async()=>{sends++}})
  p.draft='甲的内容';await p.send('text');assert.equal(sends,0);assert.equal(p.draft,'')
  token='a';let opened=0;const ticket=deferred()
  const {p:q}=await page('chat',{getAccessToken:()=>token,chatFileLink:()=>ticket.promise,uni:{previewImage(){opened++}}})
  const preview=q.preview({id:'private'});token='b';ticket.resolve('private-url');await preview;assert.equal(opened,0)
})

test('对话离页后加载锁可恢复，敏感词拒绝后草稿仍保留',async()=>{
  const pending=deferred();let calls=0
  const {p}=await page('chat',{request:async()=>({id:'alice'}),chatApi:async path=>{calls++;if(calls===1)return pending.promise;return path.endsWith('/messages')?{items:[],hasMore:false}:{items:[],title:'群',members:[]}}})
  const loading=p.refresh(true);await Promise.resolve();p.stop();assert.equal(p.loading,false);pending.resolve({title:'old',members:[]});await loading;await p.refresh(true);assert.ok(p.conversation)
  const {p:q}=await page('chat',{chatApi:async()=>{throw Object.assign(new Error('内容包含限制用语'),{statusCode:422})}})
  q.draft='需要修改的草稿';await q.send('text');assert.equal(q.draft,'需要修改的草稿');assert.equal(q.sending,false)
})

test('附件发送丢失确认后恢复：已绑定任务清理本地卡片，不重复发送',async()=>{
  let sendCalls=0;const {p}=await page('chat',{chatApi:async(path)=>{if(path.startsWith('/uploads/'))return {status:'bound',messageId:'persisted'};sendCalls++;return {items:[]}}})
  p.upload={id:'file',ready:true};p.refresh=async()=>{}
  await p.sendAttachment();assert.equal(p.upload,null);assert.equal(sendCalls,0)
})

test('定时拉取消息不会清除敏感词失败提示',async()=>{
  const {p}=await page('chat',{chatApi:async()=>({items:[],hasMore:false})})
  p.conversation={id:'group'};p.error='内容包含限制用语';await p.refresh();assert.equal(p.error,'内容包含限制用语')
})

test('管理员隐藏/停用同步：旧分页响应不能恢复原文或回退会话状态',async()=>{
  const pending=deferred()
  const {p}=await page('chat',{chatApi:async path=>path.includes('before=')?pending.promise:{items:[{id:'latest',seq:2,kind:'text',text:'消息已被管理员隐藏',status:'hidden'}],reset:true,revision:1,status:'paused',hasMore:true}})
  p.conversation={id:'group',status:'active',moderationRevision:0};p.messages=[{id:'latest',seq:2,text:'已缓存原文'}];p.previews={image:'old-ticket'}
  const older=p.older();await p.refresh()
  assert.equal(p.conversation.status,'paused');assert.equal(p.conversation.moderationRevision,1);assert.equal(Object.keys(p.previews).length,0)
  pending.resolve({items:[{id:'secret',seq:1,text:'不应恢复的原文'}],revision:0,status:'active'});await older
  assert.equal(p.messages.some(m=>m.id==='secret'),false);assert.equal(p.conversation.status,'paused');assert.equal(p.olderLoading,false)
})

test('隐藏后的旧图片票据响应不能回填预览；停用会话不发送新内容',async()=>{
  const ticket=deferred();let sends=0
  const {p}=await page('chat',{chatFileLink:()=>ticket.promise,chatApi:async()=>{sends++}})
  const m={id:'photo',kind:'image',attachment:{id:'image',size:60}}
  p.messages=[m];const load=p.loadPreviews([m],p.generation,'a');p.messages=[{id:'photo',kind:'text',status:'hidden'}];ticket.resolve('old-url');await load
  assert.equal(Object.keys(p.previews).length,0)
  p.conversation={status:'paused'};p.draft='停用后的草稿';await p.send('text');assert.equal(sends,0);assert.equal(p.draft,'停用后的草稿')
})

test('个人资料学籍区为只读；学生显示预计毕业年，校友显示毕业年',async()=>{
  const {p,options}=await page('profile')
  assert.equal(p.fieldDefinitions.some(f=>['major','className','enrollmentYear','graduationYear'].includes(f.key)),false)
  const profile={fields:{expectedGraduationYear:'2027',graduationYear:'2023'},personType:'student'}
  const student=options.computed.identityRows.call({profile,manual:false})
  assert.ok(student.some(r=>r.label==='预计毕业年份'&&r.value==='2027'))
  assert.ok(student.some(r=>r.label==='专业'&&r.value==='学校暂未提供'))
  const alumni=options.computed.identityRows.call({profile:{...profile,personType:'alumni'},manual:false})
  assert.ok(alumni.some(r=>r.label==='毕业年份'&&r.value==='2023'))
  const confirmed={...profile,personType:'student',graduationYearConfirmed:true,educationSupplementedFields:['graduationYear']}
  const rows=options.computed.identityRows.call({profile:confirmed,manual:false})
  assert.ok(rows.some(r=>r.label==='毕业年份'&&r.value==='2023'));assert.equal(rows.some(r=>r.label==='预计毕业年份'),false)
  assert.match(options.computed.schoolNote.call({profile:confirmed,manual:false}),/管理员.*补录/)
})

test('个人资料换号后不能把旧表单写入新账号；旧保存响应不可回填',async()=>{
  let token='a',writes=0;const pending=deferred()
  const {p}=await page('profile',{getAccessToken:()=>token,request:async input=>{if(input.method==='PATCH'){writes++;return pending.promise}return {name:'乙',fields:{},lockedFields:[]}}})
  p.ownerToken='a';p.profile={revision:0,lockedFields:[]};p.form={city:'甲的城市'}
  token='b';await p.save();assert.equal(writes,0);assert.equal(p.profile.name,'乙')
  p.form={city:'乙的城市'};const save=p.save();token='c';p.loadVersion++;p.profile=null;pending.resolve({name:'乙',fields:{}});await save;assert.equal(p.profile,null)
})

test('后台人工校验学籍在个人资料标为人工来源，未知年份不推算或误称学校接口返回',async()=>{
  const {p}=await page('profile')
  for(const verificationSource of ['admin-personnel-review','platform-admin-confirmed','manual-identity-review']){
    p.profile={name:'隔离人员',schoolIdentityVerified:true,verificationSource,personType:'student',fields:{className:'2022级一班'}}
    assert.equal(p.manual,true);assert.match(p.schoolNote,/管理员人工复核/);assert.match(p.schoolNote,/不是学校接口/)
    assert.equal(p.identityRows.find(row=>row.label==='入学年份').value,'复核暂未提供');assert.equal(p.identityRows.find(row=>row.label==='预计毕业年份').value,'复核暂未提供')
  }
})

test('自动群按服务端权限开放管理，管理员不能邀请或管理群主和其他管理员',async()=>{
  let requests=0
  const {p}=await page('chat',{chatApi:async()=>{requests++;return {}}})
  p.meId='admin';p.conversation={id:'group',type:'group',status:'active',schoolGroup:{kind:'class'},ownerId:'owner',groupRevision:2,permissions:{manageMembers:true,manageAdmins:false,rename:false,leave:true,addMembers:false},members:[{id:'owner',role:'owner'},{id:'admin',role:'admin'},{id:'other-admin',role:'admin'},{id:'member',role:'member'}]}
  assert.equal(p.canAddMembers,false)
  assert.equal(p.canRemove(p.conversation.members[0]),false)
  assert.equal(p.canRemove(p.conversation.members[2]),false)
  assert.equal(p.canRemove(p.conversation.members[3]),false)
  await p.manage({title:'越权改名'});await p.manage({addIds:['outside']});await p.manage({adminId:'member',role:'admin'});await p.searchPeople()
  assert.equal(requests,0)
})

test('群主设置管理员带确认时群版本，版本变化后等待后台冲突处理',async()=>{
  let confirmation;const calls=[]
  const {p}=await page('chat',{uni:{showModal:options=>{confirmation=options}},chatApi:async(path,options)=>{calls.push({path,options});return {...p.conversation,groupRevision:8,members:[{id:'owner',role:'owner'},{id:'target',role:'admin'}]}}})
  p.meId='owner';p.conversation={id:'group',type:'group',status:'active',ownerId:'owner',groupRevision:6,permissions:{manageMembers:true,manageAdmins:true,rename:true,leave:false},members:[{id:'owner',role:'owner'},{id:'target',name:'同学',role:'member'}]}
  p.changeAdmin(p.conversation.members[1]);assert.match(confirmation.title,/设置群管理员/)
  p.conversation.groupRevision=7
  confirmation.success({confirm:true});await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,1);assert.equal(calls[0].options.data.revision,6);assert.equal(calls[0].options.data.adminId,'target');assert.equal(calls[0].options.data.role,'admin')
  assert.equal(p.conversation.members[1].role,'admin')
})

test('群权限变化通过消息版本刷新，不清空未发送草稿',async()=>{
  const old={id:'group',type:'group',title:'学院群',ownerId:'owner',groupRevision:1,status:'active',members:[{id:'alice',role:'admin'}],permissions:{manageMembers:true}}
  const current={...old,groupRevision:2,members:[{id:'alice',role:'member'}],permissions:{manageMembers:false,manageAdmins:false,rename:false,leave:true}}
  const {p}=await page('chat',{chatApi:async path=>path.includes('/messages?')?{items:[],groupRevision:2,status:'active',revision:0}:current})
  p.conversation=old;p.meId='alice';p.draft='尚未发送';p.people=[{id:'candidate'}]
  await p.refresh()
  assert.equal(p.conversation.groupRevision,2);assert.equal(p.groupPermissions.manageMembers,false);assert.equal(p.people.length,0);assert.equal(p.draft,'尚未发送')
})

test('固定群直接显示专业、班级或学院原名，不改变包含学院及年份的隔离key',()=>{
  for(const [kind,value]of [['major','计算机科学与技术'],['class','2022级专升本计算机科学与技术一班'],['department','信息技术与管理学院']]){
    const group={key:'独立学院-专业-年份',kind,department:'信息技术与管理学院',major:'计算机科学与技术',className:'2022级专升本计算机科学与技术一班'}
    assert.equal(conversationTitle({title:'旧学院 · 旧前缀名称群',schoolGroup:group}),value);assert.equal(group.key,'独立学院-专业-年份')
  }
  assert.equal(conversationTitle({title:'我命名的自建群'}),'我命名的自建群')
})

test('固定群即使读到旧permissions也无退出、解散或移出入口',async()=>{
  let modals=0,writes=0;const{p}=await page('chat',{uni:{showModal(){modals++}},chatApi:async()=>{writes++}})
  p.meId='owner';p.conversation={id:'group',type:'group',status:'active',schoolGroup:{kind:'class'},ownerId:'owner',permissions:{leave:true,dissolve:true,manageMembers:true,removeMembers:true},members:[{id:'member',role:'member'}]}
  assert.equal(p.canLeave,false);assert.equal(p.canDissolve,false);assert.equal(p.canRemove(p.conversation.members[0]),false)
  p.leave();p.dissolve();await p.manage({removeId:'member'});assert.equal(modals,0);assert.equal(writes,0)
})

test('自建群普通成员退出必须确认，群主不能用退出代替解散',async()=>{
  let modal;const calls=[];const{p}=await page('chat',{uni:{showModal:r=>modal=r},chatApi:async(path,options)=>{calls.push({path,options})}})
  p.meId='member';p.conversation={id:'group',title:'相聚群',type:'group',status:'active',ownerId:'owner',permissions:{leave:true,dissolve:false},members:[]}
  p.leave();assert.equal(calls.length,0);await modal.success({confirm:false});assert.equal(calls.length,0)
  await modal.success({confirm:true});assert.equal(calls[0].path,'/conversations/group/leave');assert.equal(calls[0].options.token,'a')
  p.meId='owner';assert.equal(p.canLeave,false)
})

test('自建群群主解散带确认时revision，解散后保留历史并停止发言、上传和成员管理',async()=>{
  let modal;const calls=[];const{p}=await page('chat',{uni:{showModal:r=>modal=r,showToast(){}},chatApi:async(path,options)=>{calls.push({path,options});return {dissolved:true,conversation:{...p.conversation,status:'dissolved',groupRevision:8,permissions:{leave:false,dissolve:false}}}}})
  p.meId='owner';p.conversation={id:'group',title:'自建群',type:'group',status:'paused',ownerId:'owner',groupRevision:6,permissions:{dissolve:true},members:[]};p.messages=[{id:'history',text:'保留的历史消息'}]
  assert.equal(p.canDissolve,true);p.dissolve();assert.match(modal.content,/不可恢复/);p.conversation.groupRevision=7;await modal.success({confirm:true})
  assert.equal(calls[0].path,'/conversations/group/dissolve');assert.equal(calls[0].options.data.revision,6);assert.equal(p.conversation.status,'dissolved');assert.equal(p.messages.length,1);assert.equal(p.canDissolve,false);assert.equal(p.readOnly,true)
  p.draft='不能发送';await p.send('text');await p.choose(true);assert.equal(calls.length,1)
})

test('解散确认期间换号不发送；版本冲突重载群资料后必须重新确认',async()=>{
  let token='a',modal,writes=0;const{p}=await page('chat',{getAccessToken:()=>token,uni:{showModal:r=>modal=r},chatApi:async(path,options)=>{if(options?.method==='POST'){writes++;throw Object.assign(new Error('群资料已变化'),{statusCode:409})}return {...p.conversation,groupRevision:2}}})
  p.meId='owner';p.conversation={id:'group',type:'group',title:'自建群',status:'active',ownerId:'owner',groupRevision:1,permissions:{dissolve:true},members:[]}
  p.dissolve();token='b';await modal.success({confirm:true});assert.equal(writes,0)
  token='a';p.dissolve();await modal.success({confirm:true});assert.equal(writes,1);assert.equal(p.conversation.groupRevision,2);assert.match(p.error,/重新确认解散/);assert.equal(p.managing,false)
})

test('解散后旧消息分页不可重新启用群；文件选择迟到不能启动上传',async()=>{
  let uploads=0;const pick=deferred(),old=deferred();const{p}=await page('chat',{pickChatFile:()=>pick.promise,uploadChatFile:async()=>{uploads++},chatApi:()=>old.promise})
  p.meId='owner';p.conversation={id:'group',type:'group',status:'active',groupRevision:1,moderationRevision:0};p.messages=[{id:'history',seq:1}]
  const picking=p.choose(),reading=p.older();p.applyGroup({...p.conversation,status:'dissolved',groupRevision:2,permissions:{}})
  pick.resolve({name:'图片.jpg'});await picking;assert.equal(uploads,0)
  old.resolve({items:[{id:'old'}],revision:0,groupRevision:1,status:'active'});await reading;assert.equal(p.conversation.status,'dissolved');assert.equal(p.messages.length,1)
})
