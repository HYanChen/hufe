import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import {canManuallyVerifyAccount} from '../src/lib/manualVerificationEligibility.js'
const pending=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return {promise,resolve}}
const account=(extra={})=>({id:'person',username:'qa_person',name:'隔离人员',personType:'alumni',department:'测试学院',major:'计算机科学与技术',className:'2022级一班',enrollmentYear:'2022',graduationYear:'2024',status:'active',schoolIdentityVerified:false,accountSource:'admin_personnel',revision:3,mustChangePassword:true,...extra})
async function dialog(overrides={}){
  const source=await fs.readFile(new URL('../src/components/AccountManualVerificationDialog.vue',import.meta.url),'utf8'),script=source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
  let token='admin-a',unmount;const calls=[],events=[],props={open:true,account:account()},auth={state:{user:{id:'admin'}},isSuperAdmin:{value:true}}
  const context={nextTick:async()=>{},computed:fn=>({get value(){return fn()}}),ref:value=>({value}),watch(_fn,handler,options){if(options?.immediate)handler()},onBeforeUnmount(fn){unmount=fn},defineProps:()=>props,defineEmits:()=>((name,value)=>events.push({name,value})),canManuallyVerifyAccount,personTypeLabel:x=>x,accessToken:()=>token,auth,AbortController,window:{addEventListener(){},removeEventListener(){}},api:async(path,options)=>{calls.push({path,options:structuredClone({...options,signal:undefined})});return {verified:true,revision:4,verificationSource:'admin-personnel-review',account:account({schoolIdentityVerified:true,mustChangePassword:true})}},...overrides}
  vm.runInNewContext(script+'\nglobalThis.subject={start,confirm,close,target,fields,basis,attested,stage,error,busy,formValid,normalizeIdentity};',context)
  const p=context.subject;p.fields.value.studentId='002200001';p.basis.value='已核对毕业证及本人有效身份证明';p.attested.value=true
  return Object.assign(p,{calls,events,props,auth,setToken:value=>{token=value},unmount:()=>unmount()})
}
test('仅未认证有效后台录入人员有人工校验资格；已有委派权限不替代实名也不阻止核验',()=>{
  assert.equal(canManuallyVerifyAccount(account()),true)
  for(const extra of [{status:'suspended'},{status:'deactivated'},{schoolIdentityVerified:true},{accountSource:'admin_provisioned'},{accountSource:'school_registered'},{isAdmin:true},{isSuperAdmin:true},{adminRole:'admin'},{role:'super_admin'},{localDevelopmentOnly:true},{developmentSchoolIdentityFixture:true}])assert.equal(canManuallyVerifyAccount(account(extra)),false,JSON.stringify(extra))
  for(const extra of [{adminRole:'delegated_admin'},{role:'organization_admin'},{adminPermissions:['*']},{adminScopes:[{resource:'news'}]}])assert.equal(canManuallyVerifyAccount(account(extra)),true,JSON.stringify(extra))
})
test('首次资料核对不提交，明确二次确认才发送当前账号版本与9字段，不修改密码/首次改密/权限',async()=>{
  const p=await dialog();assert.equal(p.formValid.value,true);await p.confirm();assert.equal(p.stage.value,'confirm');assert.equal(p.calls.length,0);await p.confirm()
  const request=p.calls[0];assert.equal(request.path,'/admin/accounts/person/manual-verification');assert.equal(request.options.token,'admin-a');assert.equal(request.options.body.expectedRevision,3);assert.equal(request.options.body.confirmation,'确认人工实名校验通过')
  assert.equal(Object.keys(request.options.body.fields).length,9);assert.equal(request.options.body.fields.studentId,'002200001');assert.equal(request.options.body.fields.enrollmentYear,'2022')
  for(const key of ['password','newPassword','isAdmin','mustChangePassword','username'])assert.equal(Object.hasOwn(request.options.body.fields,key),false)
  assert.equal(p.events.find(e=>e.name==='verified').value.account.mustChangePassword,true);assert.equal(p.fields.value.studentId,'');assert.equal(p.basis.value,'')
})
test('脱敏已有号码只展示不回填，空号可保留已有；无号人员须补录完整学工号',async()=>{
  const p=await dialog();p.props.account=account({studentIdMasked:'*****0001',studentIdSealed:'sensitive-private-cipher',studentIdKey:'private-hmac'});p.start();assert.equal(p.fields.value.studentId,'');assert.equal(p.target.value.studentIdSealed,undefined);p.basis.value='已核对本人原学籍材料';p.attested.value=true;assert.equal(p.formValid.value,true);await p.confirm();await p.confirm();assert.equal(p.calls[0].options.body.fields.studentId,'')
  const q=await dialog();q.fields.value.studentId='';assert.equal(q.formValid.value,false);q.fields.value.studentId='***0001';assert.equal(q.formValid.value,false)
  q.fields.value.studentId='SF.0022_01-1';assert.equal(q.formValid.value,true);await q.confirm();await q.confirm();assert.equal(q.calls[0].options.body.fields.studentId,'SF.0022_01-1')
})
test('必须明确校内身份、学院、核验依据和本人核对确认；学生只使用预计毕业，不从班级推算年份',async()=>{
  const p=await dialog();p.props.account=account({personType:'member',enrollmentYear:'',graduationYear:'',className:'2022级专升本一班'});p.start();assert.equal(p.fields.value.personType,'');assert.equal(p.fields.value.enrollmentYear,'');assert.equal(p.fields.value.graduationYear,'')
  p.fields.value.studentId='002200001';p.basis.value='已核对在读证明与本人材料';p.attested.value=true;assert.equal(p.formValid.value,false);p.fields.value.personType='student';p.fields.value.graduationYear='2024';p.normalizeIdentity();assert.equal(p.fields.value.graduationYear,'');assert.equal(p.fields.value.expectedGraduationYear,'')
  p.fields.value.expectedGraduationYear='2028';p.fields.value.enrollmentYear='2022';assert.equal(p.formValid.value,true);p.fields.value.expectedGraduationYear='2020';assert.equal(p.formValid.value,false)
  p.fields.value.expectedGraduationYear='2028';p.attested.value=false;await p.confirm();assert.equal(p.calls.length,0);p.attested.value=true;p.fields.value.department='';assert.equal(p.formValid.value,false)
})
test('核验依据中抄写完整学工号阻止进入确认，普通校验失败保留资料但要求重新确认',async()=>{
  const p=await dialog();p.basis.value='已核对号码002200001';await p.confirm();assert.equal(p.stage.value,'edit');assert.match(p.error.value,/请勿抄写/);assert.equal(p.calls.length,0)
  const q=await dialog({api:async()=>{throw Object.assign(new Error('需补齐有效学工号'),{status:400})}});await q.confirm();await q.confirm();assert.equal(q.stage.value,'edit');assert.equal(q.attested.value,false);assert.equal(q.fields.value.name,'隔离人员');assert.match(q.error.value,/有效学工号/)
})
test('版本冲突和权限失效清空资料关闭弹窗，不能自动重试旧审核',async()=>{
  for(const status of [401,403,409]){const p=await dialog({api:async()=>{throw Object.assign(new Error('账号或权限已更新'),{status})}});await p.confirm();await p.confirm();assert.equal(p.target.value,null);assert.equal(p.fields.value.studentId,'');assert.equal(p.basis.value,'');assert.ok(p.events.some(e=>e.name==='stale'))}
})
test('确认前切号/版本变更或撤销管理员权限，禁止发出人工通过请求',async()=>{
  for(const change of [p=>p.setToken('admin-b'),p=>p.props.account.revision++,p=>p.auth.isSuperAdmin.value=false,p=>p.props.account.status='suspended']){const p=await dialog();await p.confirm();change(p);await p.confirm();assert.equal(p.calls.length,0);assert.equal(p.fields.value.studentId,'')}
})
test('切账号或离开后的迟到通过响应不回填身份，不展示旧操作成功',async()=>{
  for(const end of [p=>p.unmount(),p=>p.setToken('admin-b')]){const wait=pending(),p=await dialog({api:()=>wait.promise});await p.confirm();const work=p.confirm();end(p);wait.resolve({verified:true,account:account({schoolIdentityVerified:true})});await work;assert.equal(p.events.some(e=>e.name==='verified'),false);assert.equal(p.fields.value.studentId,'');assert.equal(p.basis.value,'')}
})
test('入口位于认证状态旁，窄屏另有无需横滚的快捷行；弹层滚动与真实来源提示保留',async()=>{
  const source=await fs.readFile(new URL('../src/views/AccountsView.vue',import.meta.url),'utf8'),modal=await fs.readFile(new URL('../src/components/AccountManualVerificationDialog.vue',import.meta.url),'utf8')
  assert.match(source,/待实名校验[\s\S]*manual-inline-action/);assert.match(source,/aria-label="本页待人工校验人员"/);assert.match(source,/@media\(max-width:700px\).*manual-mobile-shortcuts\{display:block/);assert.match(modal,/<ConfirmDialog/);assert.match(modal,/不取消首次登录改密要求/);assert.match(modal,/不是学校官网接口校验/);assert.doesNotMatch(modal,/window\.confirm|localStorage|sessionStorage/)
})
