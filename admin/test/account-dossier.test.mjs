import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import * as helpers from '../src/lib/dossier.js'

const fixture=()=>({account:{id:'person',name:'测试校友',username:'qa_person',department:'信息学院',personType:'student',studentIdMasked:'***1234'},personalProfile:{fields:{major:'计算机',enrollmentYear:'2022',expectedGraduationYear:'2026',phone:'本人手机'}},supplement:{revision:3,profile:helpers.profileDraft({notes:'原校内备注'})},tabs:Object.fromEntries(helpers.dossierTabs.map(tab=>[tab.key,['basic','tags','analysis'].includes(tab.key)?{}:{items:[],total:0,page:1,pageSize:50}]))})
async function view(overrides={}){
  const source=await fs.readFile(new URL('../src/views/AccountDossierView.vue',import.meta.url),'utf8'),script=source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
  let token='admin-token',unmount;const route={params:{id:'person'}},calls=[],state=fixture(),events=new Map(),auth={state:{user:{id:'admin'}},isSuperAdmin:{value:true}}
  const context={...helpers,ref:value=>({value}),computed:fn=>({get value(){return fn()}}),watch(){},useRoute:()=>route,onBeforeUnmount:fn=>{unmount=fn},onBeforeRouteLeave(){},onBeforeRouteUpdate(){},accessToken:()=>token,auth,AbortController,URLSearchParams,Date,clearTimeout,setTimeout,window:{addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name)},api:async(path,options={})=>{calls.push({path,options:structuredClone({...options,signal:undefined})});if(options.method){if(path.endsWith('/profile')){Object.assign(state.supplement.profile,structuredClone(options.body.profile));state.supplement.revision++}return {item:{},revision:state.supplement.revision}}return structuredClone(state)},...overrides}
  vm.runInNewContext(script+'\nglobalThis.subject={load,openEdit,saveProfile,openRecord,saveRecord,requestArchive,archiveRecord,openFollowup,saveFollowup,requestLeave,discard,clearPrivate,revealNumber,loadSection,dossier,loading,busy,error,notice,editKind,draft,editError,tab,recordForm,followup,revealOpen,revealReason,studentId,discardOpen,tagInput,addTag,tagGroup,dirty};',context)
  const subject=context.subject;await subject.load();return Object.assign(subject,{calls,route,auth,state,events,unmount:()=>unmount(),setToken:value=>{token=value}})
}

test('nine dossier sections are real; AI remains factual overview and core school years remain read-only',()=>{
  assert.equal(helpers.dossierTabs.length,9);assert.equal(helpers.dossierTabs.at(-1).label,'资料概览')
  const fields=helpers.academicFields(fixture());assert.ok(fields.some(row=>row.label==='预计毕业年份'&&row.value==='2026年'));assert.equal(fields.some(row=>row.label==='毕业年份'),false)
  assert.equal(helpers.confirmedGivingAmount([{intentAmount:10000},{internal:true,amount:30000},{certificate:{certificateNo:'C-1',confirmedAmount:0.1}},{certificate:{certificateNo:'C-2',confirmedAmount:0.2}}]),0.3)
})
test('profile payload explicitly permits only the selected supplemental section and never identity or permissions',async()=>{
  const page=await view();page.openEdit('notes');page.draft.value.notes='已核实个人成就与联系偏好';page.draft.value.schoolIdentityVerified=true;await page.saveProfile()
  const request=page.calls.find(row=>row.options.method==='PUT');assert.equal(request.path,'/admin/accounts/person/dossier/profile');assert.deepEqual(request.options.body,{revision:3,profile:{notes:'已核实个人成就与联系偏好'}});assert.equal(page.dossier.value.supplement.profile.notes,'已核实个人成就与联系偏好');assert.match(page.notice.value,/未修改学校核验/)
  assert.throws(()=>helpers.profileUpdate('account',{}));assert.equal(helpers.profileDraft({contacts:{phone:'1',secret:'hide'},notes:'note',isAdmin:true}).contacts.secret,undefined)
})
test('internal resource records use persisted endpoint, section whitelist and real dossier revision',async()=>{
  const page=await view();page.tab.value='resources';page.openRecord();Object.assign(page.recordForm.value.fields,{title:'实习基地合作',category:'供给',description:'提供校内联系记录',cooperationModes:['实习','', ' 实习 ','科研'],authorAccountId:'injected'});await page.saveRecord()
  const request=page.calls.find(row=>row.options.method==='POST');assert.equal(request.path,'/admin/accounts/person/dossier/records/resources');assert.equal(request.options.body.revision,3);assert.deepEqual(request.options.body.cooperationModes,['实习','科研']);assert.equal(request.options.body.authorAccountId,undefined)
  assert.equal(helpers.recordUpdate('giving',{title:'备注',amount:'12.35'}).amount,12.35);assert.equal(helpers.recordUpdate('giving',{title:'备注',amount:''}).amount,null)
})
test('business-derived records cannot be archived and internal archive waits for explicit confirmation',async()=>{
  const page=await view();page.tab.value='activities';page.requestArchive({id:'system',title:'系统报名'});await page.archiveRecord();assert.equal(page.calls.some(row=>row.options.method==='DELETE'),false)
  page.requestArchive({id:'internal',title:'校内活动',internal:true});assert.equal(page.calls.some(row=>row.options.method==='DELETE'),false);await page.archiveRecord();assert.equal(page.calls.find(row=>row.options.method==='DELETE').path,'/admin/accounts/person/dossier/records/activities/internal')
})
test('followups persist content/key points/next plan and unsaved record requires discard confirmation',async()=>{
  const page=await view();page.openFollowup();page.followup.value.content='联系确认';page.followup.value.keyPoints='可参与课程交流';page.followup.value.nextPlan='下周再次联系';const leave=page.requestLeave();assert.equal(page.discardOpen.value,true);page.discard(false);assert.equal(await leave,false);assert.equal(page.followup.value.content,'联系确认');await page.saveFollowup();const request=page.calls.find(row=>row.options.method==='POST');assert.equal(request.options.body.keyPoints,'可参与课程交流');assert.equal(request.options.body.nextPlan,'下周再次联系')
})
test('revision conflicts never automatically retry or discard the pending human edit',async()=>{
  const page=await view({api:async(path,options={})=>{if(options.method)throw Object.assign(new Error('版本已变化'),{status:409,code:'DOSSIER_REVISION_CONFLICT'});return fixture()}});page.openEdit('notes');page.draft.value.notes='尚未保存内容';await page.saveProfile();assert.equal(page.draft.value.notes,'尚未保存内容');assert.match(page.error.value,/其他管理员更新/);assert.equal(page.busy.value,false)
})
test('changing account/session or unmount clears private drafts and ignores delayed responses',async()=>{
  const page=await view();page.openEdit('notes');page.draft.value.notes='校内私密';page.studentId.value='full-number';page.events.get('storage')({key:'hufe.admin.access-token'});assert.equal(page.dossier.value,null);assert.equal(page.draft.value.notes,'');assert.equal(page.studentId.value,'')
  let resolve,calls=0;const pending=new Promise(ok=>{resolve=ok});const late=await view({api:async()=>++calls===1?fixture():pending});const loading=late.load();late.unmount();resolve(fixture());await loading;assert.equal(late.dossier.value,null);assert.equal(late.draft.value.notes,'')
})
test('all account rows include dossier entry before protected-account branch; responsive panels contain real editable controls',async()=>{
  const accounts=await fs.readFile(new URL('../src/views/AccountsView.vue',import.meta.url),'utf8'),source=await fs.readFile(new URL('../src/views/AccountDossierView.vue',import.meta.url),'utf8'),router=await fs.readFile(new URL('../src/router.js',import.meta.url),'utf8')
  assert.ok(accounts.indexOf('查看人员信息')<accounts.indexOf('<span v-if="account.id === auth.state.user?.id"'));assert.match(router,/accounts\/:id\/dossier[\s\S]*nav: 'accounts'/);assert.match(source,/overflow-x:auto[\s\S]*position:sticky/);assert.match(source,/@media\(max-width:700px\)/);assert.match(source,/<RegionSelect/);assert.match(source,/校内工作档案/);assert.match(source,/内部金额备注/);assert.doesNotMatch(source,/v-html|localStorage|sessionStorage|window\.confirm/)
})
