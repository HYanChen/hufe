import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { conversationTitle, isFixedGroup } from '../../utils/chatGroups.js'
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
async function view(overrides={}){
  const source=await fs.readFile(new URL('../src/views/ChatManagementView.vue',import.meta.url),'utf8')
  const script=source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
  const context={conversationTitle,isFixedGroup,ref:value=>({value}),accessToken:()=> 'admin-a',api:async()=>({items:[],total:0}),apiUrl:u=>u,URLSearchParams,URL,window:{addEventListener(){},removeEventListener(){}},onMounted(){},onBeforeUnmount(){},...overrides}
  vm.runInNewContext(script+'\nglobalThis.testState={read,select,prepare,attachment,load,current,detail,selected,rows,action,preview,from,to,error,ownerCandidates,prepareOwner,setOwner,ownerAction,nextOwnerId,notice};',context)
  return context.testState
}
test('对话管理筛选错误保留详情与筛选值，仍能修正重试',async()=>{
  const p=await view({api:async()=>{throw Object.assign(new Error('开始日期不能晚于结束日期'),{status:400})}})
  p.selected.value='cid';p.detail.value={conversation:{id:'cid'},items:[]};p.from.value='2099-01-01';p.to.value='2000-01-01'
  await p.read();assert.ok(p.detail.value);assert.equal(p.from.value,'2099-01-01');assert.match(p.error.value,/开始日期/)
})
test('延迟图片票据不能叠加到消息处理弹窗上',async()=>{
  const pending=deferred(),p=await view({api:()=>pending.promise})
  p.selected.value='cid';p.detail.value={conversation:{id:'cid'}}
  const opening=p.attachment({kind:'image',attachment:{id:'img',name:'qa.png'}})
  p.prepare({id:'mid',revision:0,status:'visible'});pending.resolve({url:'/api/v1/chat/files/img?ticket=secret'});await opening
  assert.ok(p.action.value);assert.equal(p.preview.value,null)
})
test('会话和账号切换后，迟到的聊天记录不会泄露到新页面',async()=>{
  const a=deferred(),b=deferred();let count=0,token='admin-a'
  const p=await view({accessToken:()=>token,api:()=>++count===1?a.promise:b.promise})
  p.selected.value='a';const first=p.read();p.selected.value='b';const second=p.read()
  b.resolve({conversation:{id:'b'},items:[]});await second;a.resolve({conversation:{id:'a'},items:[{text:'private-a'}]});await first;assert.equal(p.detail.value.conversation.id,'b')
  token='admin-b';assert.equal(p.current('admin-a'),false);assert.equal(p.detail.value,null);assert.equal(p.rows.value.length,0)
})

test('指定群主仅展示当前活跃实名成员，并提交预览时的群版本',async()=>{
  const calls=[],conversation={id:'group',type:'group',title:'专业群',ownerId:'old',groupRevision:5,members:[
    {id:'old',current:true,status:'active',schoolIdentityVerified:true},
    {id:'new',name:'新群主',current:true,status:'active',schoolIdentityVerified:true},
    {id:'left',current:false,status:'active',schoolIdentityVerified:true},
    {id:'inactive',current:true,status:'disabled',schoolIdentityVerified:true},
    {id:'unverified',current:true,status:'active',schoolIdentityVerified:false}
  ]}
  const p=await view({api:async(path,options)=>{calls.push({path,options});return path.includes('/messages?')?{conversation,items:[]}:{items:[],total:0}}})
  p.selected.value='group';p.detail.value={conversation,items:[]};p.prepareOwner()
  assert.deepEqual(Array.from(p.ownerCandidates(),m=>m.id),['old','new'])
  p.nextOwnerId.value='new';conversation.groupRevision=6
  await p.setOwner()
  assert.equal(calls[0].path,'/admin/chat/conversations/group/owner')
  assert.equal(calls[0].options.method,'PUT')
  assert.equal(calls[0].options.body.ownerId,'new');assert.equal(calls[0].options.body.revision,5)
  assert.equal(p.ownerAction.value,null);assert.match(p.notice.value,/群主已更新/)
})

test('指定群主冲突后刷新成员与版本，需要重新确认',async()=>{
  let writes=0
  const conversation={id:'group',type:'group',title:'班级群',ownerId:'old',groupRevision:3,members:[{id:'new',current:true,status:'active',schoolIdentityVerified:true}]}
  const p=await view({api:async(path,options)=>{if(options?.method==='PUT'){writes++;throw Object.assign(new Error('群资料已经更新'),{status:409})}return {conversation:{...conversation,groupRevision:4},items:[]}}})
  p.selected.value='group';p.detail.value={conversation,items:[]};p.prepareOwner();p.nextOwnerId.value='new';await p.setOwner()
  assert.equal(writes,1);assert.equal(p.ownerAction.value,null);assert.equal(p.detail.value.conversation.groupRevision,4);assert.match(p.error.value,/重新选择群主/)
})

test('指定群主弹层阻止旧图片预览回填，换账号不能提交',async()=>{
  let token='admin-a';const pending=deferred(),calls=[]
  const p=await view({accessToken:()=>token,api:async(path,options)=>{calls.push({path,options});return pending.promise}})
  p.selected.value='group';p.detail.value={conversation:{id:'group',type:'group',members:[{id:'new',current:true,status:'active',schoolIdentityVerified:true}]}}
  const image=p.attachment({kind:'image',attachment:{id:'image',name:'图片'}})
  p.prepareOwner();pending.resolve({url:'/api/v1/image'});await image;assert.equal(p.preview.value,null)
  p.nextOwnerId.value='new';token='admin-b';await p.setOwner();assert.equal(calls.length,1);assert.equal(p.ownerAction.value,null)
})

test('后台已解散群只能查历史，不提供恢复会话或指定群主操作',async()=>{
  const p=await view();p.selected.value='group';p.detail.value={conversation:{id:'group',type:'group',status:'dissolved',members:[{id:'candidate',current:true,status:'active',schoolIdentityVerified:true}]},items:[]}
  p.prepareOwner();assert.equal(p.ownerAction.value,null);assert.equal(p.ownerCandidates().length,0)
  p.prepare(null);assert.equal(p.action.value,null);assert.match(p.error.value,/不能重新启用/)
  p.prepare({id:'historical-message',revision:1,status:'visible'});assert.equal(p.action.value.mid,'historical-message')
})
