import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import {canIssueAlumniNumber} from '../src/lib/alumniNumberEligibility.js'

const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no});return {promise,resolve,reject}}
const account=(extra={})=>({id:'qa_person',username:'qa_person',name:'隔离实名人员',personType:'student',department:'隔离学院',schoolIdentityVerified:true,status:'active',revision:2,alumniNo:'',...extra})
const report=(extra={})=>({token:'isolated-preview-token',scope:'all_verified',expiresAt:new Date(Date.now()+600000).toISOString(),total:10,eligible:4,skipped:6,skippedReasons:{alreadyAssigned:2,unverified:2,inactive:1,demo:1},sample:[account()],sampleLimit:50,...extra})
async function dialog(mode='single',overrides={}){
  const source=await fs.readFile(new URL('../src/components/AccountAlumniNumberDialog.vue',import.meta.url),'utf8'),script=source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
  const calls=[],events=[],props={open:true,mode,account:mode==='single'?account():null},auth={isSuperAdmin:{value:true}}
  let token='admin-a',unmount,tick,clock=Date.now(),cleared=0
  const api=async(path,options)=>path.endsWith('/preview')?report():mode==='single'?{issued:true,alumniNo:'HUFE-QA-001',accountId:'qa_person',revision:3}:{batchId:'qa-batch',issuedCount:4,alreadyApplied:false,scope:'all_verified'}
  const context={ref:value=>({value}),computed:fn=>({get value(){return fn()}}),watch(_fn,callback,options){if(options?.immediate)callback()},nextTick:async()=>{},onBeforeUnmount(fn){unmount=fn},defineProps:()=>props,defineEmits:()=>((name,value)=>events.push({name,value})),canIssueAlumniNumber,personTypeLabel:x=>x,auth,accessToken:()=>token,AbortController,Date:class extends Date{static now(){return clock}},window:{setInterval(fn){tick=fn;return 1},clearInterval(){cleared++},addEventListener(){},removeEventListener(){}},...overrides,api:async(path,options)=>{calls.push({path,options:structuredClone({...options,signal:undefined})});return (overrides.api||api)(path,options)}}
  vm.runInNewContext(script+'\nglobalThis.subject={start,confirm,close,loadPreview,editAgain,target,preview,reason,attested,stage,error,busy,formValid,previewExpired,remainingSeconds};',context)
  await new Promise(resolve=>setImmediate(resolve))
  return Object.assign(context.subject,{calls,events,props,auth,setToken:value=>{token=value},advance:ms=>{clock+=ms;tick?.()},unmount:()=>unmount(),getCleared:()=>cleared})
}
function attest(p){p.reason.value='本次为已实名人员补发平台校友编号';p.attested.value=true}

test('编号资格包含全部正式实名身份，学生和教职工不转成校友；已有号、未实名、停用和模拟不展示下发',()=>{
  for(const personType of ['student','alumni','faculty','staff','member'])assert.equal(canIssueAlumniNumber(account({personType})),true)
  assert.equal(canIssueAlumniNumber(account({isAdmin:true,adminRole:'super_admin'})),true)
  for(const extra of [{alumniNo:'HUFE-EXISTING'},{alumniNo:' old '},{schoolIdentityVerified:false},{status:'suspended'},{status:'deactivated'},{localDevelopmentOnly:true},{developmentSchoolIdentityFixture:true},{isDemo:true},{isMock:true},{accountSource:'demo-import'},{verificationSource:'mock_school'},{verificationSource:'local-development-school'}])assert.equal(canIssueAlumniNumber(account(extra)),false,JSON.stringify(extra))
})
test('单人只在二次确认后提交目标版本与原因，不接受自选编号或修改身份权限',async()=>{
  const p=await dialog();attest(p);await p.confirm();assert.equal(p.stage.value,'confirm');assert.equal(p.calls.length,0);await p.confirm()
  assert.equal(p.calls[0].path,'/admin/accounts/qa_person/alumni-number');assert.equal(p.calls[0].options.token,'admin-a');assert.deepEqual(p.calls[0].options.body,{expectedRevision:2,reason:'本次为已实名人员补发平台校友编号',confirmation:'确认下发校友编号'})
  assert.equal(p.events.find(e=>e.name==='issued').value.alumniNo,'HUFE-QA-001');assert.equal(p.reason.value,'');assert.equal(p.target.value,null)
})
test('批量首次打开只预览全平台真实人数，不传当前筛选，确认前不 apply',async()=>{
  const p=await dialog('batch');assert.equal(p.calls.length,1);assert.equal(p.calls[0].path,'/admin/accounts/alumni-numbers/preview');assert.deepEqual(p.calls[0].options.body,{});assert.equal(p.preview.value.total,10);assert.equal(p.preview.value.eligible,4)
  attest(p);await p.confirm();assert.equal(p.calls.length,1);await p.confirm();assert.equal(p.calls.length,2);assert.equal(p.calls[1].path,'/admin/accounts/alumni-numbers/apply');assert.deepEqual(p.calls[1].options.body,{token:'isolated-preview-token',reason:'本次为已实名人员补发平台校友编号',confirmation:'确认批量下发校友编号'});assert.equal(p.events.find(e=>e.name==='issued').value.issuedCount,4)
})
test('取消与空待发预览不写入，无效范围或不完整人数不能允许批量确认',async()=>{
  const cancelled=await dialog('batch');attest(cancelled);await cancelled.confirm();cancelled.close();assert.equal(cancelled.calls.length,1);assert.equal(cancelled.preview.value,null)
  const empty=await dialog('batch',{api:async()=>report({eligible:0,skipped:10,skippedReasons:{alreadyAssigned:6,unverified:2,inactive:1,demo:1}})});attest(empty);assert.equal(empty.formValid.value,false);await empty.confirm();assert.equal(empty.calls.length,1)
  for(const extra of [{scope:'filtered'},{total:200},{skippedReasons:{alreadyAssigned:6,unverified:2,inactive:1,demo:1}}]){const p=await dialog('batch',{api:async()=>report(extra)});attest(p);assert.equal(p.preview.value,null);assert.equal(p.formValid.value,false);assert.match(p.error.value,/预览数据不完整/)}
})
test('下发原因与核对勾选必填，过期预览返回核对状态且不可发出 apply',async()=>{
  const p=await dialog('batch');p.reason.value='不足';p.attested.value=true;assert.equal(p.formValid.value,false);p.reason.value='有效下发说明';p.attested.value=false;assert.equal(p.formValid.value,false);attest(p);await p.confirm();p.advance(601000);assert.equal(p.stage.value,'edit');assert.equal(p.previewExpired.value,true);await p.confirm();assert.equal(p.calls.length,1);assert.match(p.error.value,/预览已过期/)
})
test('下发中的重复点击只发一次，持久幂等回执原样显示不再次派号',async()=>{
  const wait=deferred(),p=await dialog('batch',{api:async(path)=>path.endsWith('/preview')?report():wait.promise});attest(p);await p.confirm();const work=p.confirm();await p.confirm();assert.equal(p.calls.filter(c=>c.path.endsWith('/apply')).length,1);wait.resolve({batchId:'qa',issuedCount:4,alreadyApplied:true,scope:'all_verified'});await work;assert.equal(p.events.find(e=>e.name==='issued').value.alreadyApplied,true)
})
test('账号/权限/目标版本切换后禁止提交旧预览或目标，清理私有信息',async()=>{
  for(const change of [p=>p.setToken('admin-b'),p=>p.auth.isSuperAdmin.value=false,p=>p.props.account.revision++,p=>p.props.account.alumniNo='EXISTING',p=>p.props.account.status='suspended']){const p=await dialog();attest(p);await p.confirm();change(p);await p.confirm();assert.equal(p.calls.length,0);assert.equal(p.target.value,null);assert.equal(p.reason.value,'')}
  const p=await dialog('batch');attest(p);await p.confirm();p.setToken('admin-b');await p.confirm();assert.equal(p.calls.length,1);assert.equal(p.preview.value,null)
})
test('预览/下发的迟到响应不能跨账号或页面回填；销毁会停止倒计时',async()=>{
  for(const end of [p=>p.setToken('admin-b'),p=>p.unmount()]){
    const previewWait=deferred(),p=await dialog('batch',{api:()=>previewWait.promise});end(p);previewWait.resolve(report());await new Promise(resolve=>setImmediate(resolve));assert.equal(p.preview.value,null);assert.equal(p.events.some(e=>e.name==='issued'),false);assert.ok(p.getCleared()>0)
    const applyWait=deferred(),q=await dialog('batch',{api:async(path)=>path.endsWith('/preview')?report():applyWait.promise});attest(q);await q.confirm();const work=q.confirm();end(q);applyWait.resolve({issuedCount:4});await work;assert.equal(q.preview.value,null);assert.equal(q.reason.value,'');assert.equal(q.events.some(e=>e.name==='issued'),false)
  }
})
test('权限拒绝和预览冲突关闭旧数据，重新预览必须再次核对，无自动重试',async()=>{
  for(const status of [401,403,409]){const p=await dialog('batch',{api:async(path)=>{if(path.endsWith('/preview'))return report();throw Object.assign(new Error('人员或权限已变化'),{status})}});attest(p);await p.confirm();await p.confirm();assert.equal(p.preview.value,null);assert.equal(p.reason.value,'');assert.equal(p.calls.length,2);assert.ok(p.events.some(e=>e.name==='stale'))}
  const p=await dialog('batch');attest(p);await p.confirm();p.editAgain();await p.loadPreview();assert.equal(p.attested.value,false);assert.equal(p.stage.value,'edit');assert.equal(p.calls.every(c=>c.path.endsWith('/preview')),true)
})
test('账号列表第一列显示编号与单人入口，顶部固定批量入口，弹窗使用可滚动确认框',async()=>{
  const source=await fs.readFile(new URL('../src/views/AccountsView.vue',import.meta.url),'utf8'),modal=await fs.readFile(new URL('../src/components/AccountAlumniNumberDialog.vue',import.meta.url),'utf8'),format=await fs.readFile(new URL('../src/lib/format.js',import.meta.url),'utf8')
  assert.match(source,/openAlumniNumber\(\).*批量下发编号/);assert.match(source,/account-alumni-number.*account\.alumniNo.*canIssueAlumniNumber\(account\).*下发编号/);assert.match(modal,/<ConfirmDialog/);assert.match(modal,/不受当前搜索、筛选或分页影响/);assert.match(modal,/已有编号保留/);assert.match(modal,/学生、校友、教师与教职工/);assert.doesNotMatch(modal,/window\.confirm|localStorage|sessionStorage|Math\.random/);assert.match(format,/account\.alumni_number_issued/);assert.match(format,/account\.alumni_numbers_batch_issued/)
})
