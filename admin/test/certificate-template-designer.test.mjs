import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { DEFAULT_CERTIFICATE_TEMPLATE, CERTIFICATE_VARIABLES, normalizeCertificateTemplate, certificateTemplateError, renderCertificateMessage, certificateTheme } from '../../utils/certificateTemplate.js'

const pending=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no});return {promise,resolve,reject}}
const readScript=async file=>(await readFile(new URL(file,import.meta.url),'utf8')).split('<script setup>')[1].split('</script>')[0].replace(/^import[^\n]*$/gm,'')
async function designer(overrides={}){
  const props={open:true,projectId:'qa_project'},calls=[],events=[],watchers=[],listeners=new Map();let token='admin-a',unmount
  const auth={state:{user:{id:'qa_admin'}},canRecord:()=>true}
  const context={computed:fn=>({get value(){return fn()}}),ref:value=>({value}),reactive:value=>value,watch(get,callback,options){watchers.push({get,callback,options})},nextTick:async()=>{},onMounted:fn=>fn(),onBeforeUnmount:fn=>{unmount=fn},defineExpose(){},defineProps:()=>props,defineEmits:()=>((name,value)=>events.push({name,value})),auth,accessToken:()=>token,DEFAULT_CERTIFICATE_TEMPLATE,CERTIFICATE_VARIABLES,normalizeCertificateTemplate,certificateTemplateError,renderCertificateMessage,certificateTheme,window:{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},document:{querySelector:()=>null},...overrides,api:async(path,options)=>{calls.push({path,options:structuredClone(options)});return overrides.api?overrides.api(path,options):{id:'qa_project',title:'隔离公益项目',revision:7,certificateTemplate:{...DEFAULT_CERTIFICATE_TEMPLATE}}}}
  vm.runInNewContext(await readScript('../src/components/CertificateTemplateDesigner.vue')+'\nglobalThis.subject={load,save,cancel,confirmDiscard,confirmNavigation,beforeUnload,form,project,initial,dirty,uploading,saving,loading,error,discard};',context)
  await context.subject.load()
  return Object.assign(context.subject,{calls,events,props,auth,watchers,listeners,setToken:value=>{token=value},unmount:()=>unmount()})
}
async function imageUpload(parent,waiting){
  const props={modelValue:'',managedOnly:true},events=[]
  const context={ref:value=>({value}),computed:fn=>({get value(){return fn()}}),watch(){},defineProps:()=>props,defineEmits:()=>((name,value)=>{events.push({name,value});if(name==='uploading')parent.uploading.value=value;if(name==='update:modelValue')parent.form.backgroundUrl=value}),validateImageFile:()=>'',uploadAdminImage:()=>waiting.promise,isManagedMediaUrl:()=>true,isSafeImageUrl:()=>true}
  vm.runInNewContext(await readScript('../src/components/ImageUploadField.vue')+'\nglobalThis.subject={uploadImage,uploading,error};',context)
  return Object.assign(context.subject,{events})
}

test('证书模板设计器可编译，具备实时预览与版本保护', async () => {
  const filename = new URL('../src/components/CertificateTemplateDesigner.vue', import.meta.url)
  const source = await readFile(filename, 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'certificate-designer-test' })
  const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'certificate-designer-test', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.match(source, /expectedRevision: project\.value\.revision/)
  assert.match(source, /token !== accessToken\(\)/)
  assert.match(source, /run !== generation/)
  assert.match(source, /ImageUploadField/)
  assert.match(source, /示例姓名和金额，不会签发真实证书/)
  assert.match(source, /放弃未保存的模板修改/)
  assert.doesNotMatch(source, /v-html/)
})

test('列表首列及创建后的项目详情提供真实设计器入口', async () => {
  const view = await readFile(new URL('../src/views/ResourceManagementView.vue', import.meta.url), 'utf8')
  const drawer = await readFile(new URL('../src/components/ResourceDrawer.vue', import.meta.url), 'utf8')
  assert.match(view, /certificate-template-entry/)
  assert.match(view, /CertificateTemplateDesigner/)
  assert.match(view, /auth\.canRecord\('giving-projects', record, 'update'\)/)
  assert.match(drawer, /@click="emit\('design-certificate'\)"/)
})

test('背景图片上传完成之前实际 save/cancel/离开函数均阻止操作，完成后才保存真实背景地址',async()=>{
  const p=await designer(),wait=pending(),upload=await imageUpload(p,wait),task=upload.uploadImage({target:{files:[{name:'隔离背景.png'}],value:'selected'}})
  assert.equal(p.uploading.value,true);await p.save();p.cancel();assert.equal(p.calls.length,1);assert.equal(p.events.length,0);assert.equal(p.confirmNavigation(),false);assert.equal(p.discard.value,false)
  let prevented=false;const unload={preventDefault(){prevented=true}};p.beforeUnload(unload);assert.equal(prevented,true);assert.equal(unload.returnValue,'')
  const url='/api/v1/media/12345678-1234-4123-8123-123456789abc.png';wait.resolve({url});await task;assert.equal(p.uploading.value,false);assert.equal(p.form.backgroundUrl,url)
  await p.save();assert.equal(p.calls.length,2);assert.equal(p.calls[1].options.token,'admin-a');assert.equal(p.calls[1].options.body.expectedRevision,7);assert.equal(p.calls[1].options.body.certificateTemplate.backgroundUrl,url);assert.ok(p.events.some(e=>e.name==='saved'))
  assert.deepEqual(upload.events.filter(e=>e.name==='uploading').map(e=>e.value),[true,false])
})

test('背景上传失败释放等待状态但不会自动保存或离开，保留失败说明供重试',async()=>{
  const p=await designer(),wait=pending(),upload=await imageUpload(p,wait),task=upload.uploadImage({target:{files:[{name:'隔离背景.png'}],value:'selected'}})
  await p.save();wait.reject(new Error('隔离网络中断'));await task;assert.equal(p.uploading.value,false);assert.equal(p.calls.length,1);assert.equal(p.events.length,0);assert.match(upload.error.value,/网络中断/);assert.equal(p.form.backgroundUrl,DEFAULT_CERTIFICATE_TEMPLATE.backgroundUrl)
})

test('实际 route leave/update 守卫先保护证书草稿，显式放弃关闭后才允许导航',async()=>{
  const p=await designer(),source=await readFile(new URL('../src/views/ResourceManagementView.vue',import.meta.url),'utf8')
  const body=source.match(/function confirmResourceNavigation\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(body)
  const guards={},context={certificateDesignerComponent:{value:{confirmNavigation:()=>p.confirmNavigation()}},drawerComponent:{value:{confirmNavigation:()=>true}},onBeforeRouteUpdate:fn=>{guards.update=fn},onBeforeRouteLeave:fn=>{guards.leave=fn}}
  vm.runInNewContext(body+'\nonBeforeRouteUpdate(confirmResourceNavigation);onBeforeRouteLeave(confirmResourceNavigation);',context)
  assert.match(source,/onBeforeRouteUpdate\(confirmResourceNavigation\)/);assert.match(source,/onBeforeRouteLeave\(confirmResourceNavigation\)/)
  assert.equal(guards.leave(),true);p.form.title='尚未保存的新证书标题';assert.equal(p.dirty.value,true);assert.equal(guards.leave(),false);assert.equal(p.discard.value,true);assert.equal(p.calls.length,1)
  p.discard.value=false;assert.equal(guards.update(),false);p.confirmDiscard();assert.ok(p.events.some(e=>e.name==='cancel'));p.props.open=false;assert.equal(guards.leave(),true)
  context.drawerComponent.value.confirmNavigation=()=>false;assert.equal(guards.update(),false)
  assert.ok(p.listeners.has('beforeunload'));p.unmount();assert.equal(p.listeners.has('beforeunload'),false)
})

test('保存期间不能二次保存或离开，卸载/换号后的迟到结果不发成功',async()=>{
  for(const end of [p=>p.unmount(),p=>p.setToken('admin-b')]){
    const wait=pending(),p=await designer({api:async(path)=>path.endsWith('/certificate-template')?wait.promise:{id:'qa_project',title:'隔离项目',revision:7}})
    p.form.title='隔离修改';const work=p.save();await p.save();assert.equal(p.calls.length,2);assert.equal(p.confirmNavigation(),false);end(p);wait.resolve({id:'qa_project',revision:8});await work;assert.equal(p.events.some(e=>e.name==='saved'),false)
  }
})

test('认证状态变化与跨页签换号会清空证书草稿，旧请求迟到不能恢复项目',async()=>{
  for(const event of ['storage','hufe:auth-expired','account-watch']){
    const wait=pending(),p=await designer({api:async(path)=>path.endsWith('/certificate-template')?wait.promise:{id:'qa_project',title:'原账号私有项目',revision:7}})
    p.form.title='原账号未保存私有文案';const work=p.save()
    if(event==='account-watch'){p.auth.state.user={id:'new-admin'};p.watchers.find(w=>w.get()==='new-admin').callback()}
    else {p.setToken(event==='storage'?'new-token':'');p.listeners.get(event)()}
    assert.equal(p.project.value,null);assert.equal(p.form.title,DEFAULT_CERTIFICATE_TEMPLATE.title);assert.equal(p.initial.value,'');assert.equal(p.saving.value,false);assert.ok(p.events.some(e=>e.name==='cancel'))
    wait.resolve({id:'qa_project',revision:8});await work;assert.equal(p.project.value,null);assert.equal(p.events.some(e=>e.name==='saved'),false)
    p.unmount();assert.equal(p.listeners.size,0)
  }
})
