import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
const chosen='IsolatedUiPassword2026!'
const deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return {promise,resolve}}
async function dialog(overrides={}){
  const source=await fs.readFile(new URL('../src/components/AccountPasswordDialog.vue',import.meta.url),'utf8'),script=source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
  let token='admin-a',unmount;const events=[],calls=[],routes=[],listeners=new Map(),props={open:true,account:{id:'member',name:'隔离用户',username:'qa_member',status:'active',revision:7}},auth={state:{user:{id:'admin'}},isSuperAdmin:{value:true}}
  const ctx={computed:fn=>({get value(){return fn()}}),ref:value=>({value}),watch(_get,fn,options){if(options?.immediate)fn()},onBeforeUnmount(fn){unmount=fn},defineProps:()=>props,defineEmits:()=>((name,value)=>events.push({name,value})),accessToken:()=>token,saveAccessToken:value=>{token=value},api:async(path,options)=>{calls.push({path,options:structuredClone({...options,signal:undefined})});return {accountId:'member',passwordChanged:true,loginRequired:false}},auth,useRouter:()=>({replace:async value=>routes.push(value)}),AbortController,TextEncoder,CustomEvent:class{constructor(type){this.type=type}},window:{addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),dispatchEvent:event=>listeners.get(event.type)?.()},...overrides}
  vm.runInNewContext(script+'\nglobalThis.testState={start,confirm,close,target,newPassword,confirmPassword,currentPassword,reason,stage,error,busy,formValid};',ctx)
  const p=ctx.testState;p.newPassword.value=chosen;p.confirmPassword.value=chosen;p.reason.value='隔离用户申请重置密码'
  return Object.assign(p,{props,auth,events,calls,routes,token:()=>token,setToken:value=>{token=value},unmount:()=>unmount()})
}
test('单账号改密先双填强密码和原因，再二次确认，确认前无请求且不回显明文',async()=>{
  const p=await dialog();assert.equal(p.formValid.value,true);await p.confirm();assert.equal(p.calls.length,0);assert.equal(p.stage.value,'confirm')
  await p.confirm();assert.equal(p.calls.length,1);assert.equal(p.calls[0].path,'/admin/accounts/member/password');assert.equal(p.calls[0].options.token,'admin-a');assert.equal(p.calls[0].options.body.expectedRevision,7);assert.equal(p.calls[0].options.body.confirmation,'确认修改该账号密码');assert.equal(p.newPassword.value,'');assert.equal(p.confirmPassword.value,'');assert.ok(!JSON.stringify(p.events).includes(chosen))
})
test('弱密码、两次不一致及将密码写入原因都不能进入提交',async()=>{
  const p=await dialog();p.newPassword.value='abcdefgh';p.confirmPassword.value='abcdefgh';await p.confirm();assert.equal(p.stage.value,'edit')
  p.newPassword.value=chosen;await p.confirm();assert.equal(p.calls.length,0);p.confirmPassword.value=chosen;p.reason.value='临时口令'+chosen;await p.confirm();assert.match(p.error.value,/请勿/);assert.equal(p.stage.value,'edit');assert.equal(p.calls.length,0)
})
test('确认期间换号或管理员权限撤销，不向新账号提交旧密码，立即清空口令',async()=>{
  const p=await dialog();await p.confirm();p.setToken('admin-b');await p.confirm();assert.equal(p.calls.length,0);assert.equal(p.newPassword.value,'');assert.ok(p.events.some(e=>e.name==='cancel'))
  const q=await dialog();await q.confirm();q.auth.isSuperAdmin.value=false;await q.confirm();assert.equal(q.calls.length,0);assert.equal(q.reason.value,'')
})
test('目标账号版本冲突关闭弹层并要求重新读取，不保留密码以自动重试',async()=>{
  const p=await dialog({api:async()=>{throw Object.assign(new Error('账号已更新'),{status:409})}});await p.confirm();await p.confirm();assert.equal(p.newPassword.value,'');assert.equal(p.target.value,null);assert.ok(p.events.some(e=>e.name==='stale'))
})
test('请求期间离页或换号，迟到成功不改变当前登录或发成功提示',async()=>{
  const wait=deferred(),p=await dialog({api:()=>wait.promise});await p.confirm();const work=p.confirm();p.unmount();wait.resolve({loginRequired:true});await work;assert.equal(p.routes.length,0);assert.equal(p.token(),'admin-a');assert.equal(p.newPassword.value,'');assert.equal(p.events.some(e=>e.name==='saved'),false)
  const next=deferred(),q=await dialog({api:()=>next.promise});await q.confirm();const ongoing=q.confirm();q.setToken('admin-b');next.resolve({loginRequired:true});await ongoing;assert.equal(q.token(),'admin-b');assert.equal(q.routes.length,0);assert.equal(q.newPassword.value,'')
})
test('本人改密必须输入当前密码，成功清会话并跳回登录，不保留任何口令',async()=>{
  const p=await dialog({api:async()=>({loginRequired:true,passwordChanged:true})});p.props.account={id:'admin',username:'qa_admin',name:'隔离管理员',status:'active',revision:2};p.start();p.newPassword.value=chosen;p.confirmPassword.value=chosen;p.reason.value='本人定期更换登录密码';assert.equal(p.formValid.value,false)
  p.currentPassword.value='IsolatedOld2026!';await p.confirm();await p.confirm();assert.equal(p.token(),'');assert.equal(p.auth.state.user,null);assert.equal(p.routes[0].name,'login');assert.equal(p.currentPassword.value,'');assert.equal(p.newPassword.value,'')
})
test('账号列表为有效账号提供单账号按钮，弹窗复用可滚动的标准确认框而不使用原生confirm',async()=>{
  const accounts=await fs.readFile(new URL('../src/views/AccountsView.vue',import.meta.url),'utf8'),modal=await fs.readFile(new URL('../src/components/AccountPasswordDialog.vue',import.meta.url),'utf8'),confirm=await fs.readFile(new URL('../src/components/ConfirmDialog.vue',import.meta.url),'utf8')
  assert.match(accounts,/auth\.isSuperAdmin\.value&&account\.status==='active'/);assert.match(accounts,/@click="openPassword\(account\)"/);assert.match(modal,/<ConfirmDialog/);assert.match(confirm,/dialog-scroll/);assert.doesNotMatch(modal,/window\.confirm|type="text"/)
})
test('旧API未更新时显示明确未修改的友好提示，不暴露原始路由报错',async()=>{
  const p=await dialog({api:async()=>{throw Object.assign(new Error('Route POST /api/v1/admin/accounts/id/password not found'),{status:404})}});await p.confirm();await p.confirm();assert.match(p.error.value,/尚未修改密码/);assert.doesNotMatch(p.error.value,/Route POST/);assert.equal(p.newPassword.value,'')
})
