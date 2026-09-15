import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
async function evaluate(file,exposed,overrides={}){
  const source=await fs.readFile(new URL(file,import.meta.url),'utf8'),script=source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
  const context={ref:value=>({value}),reactive:value=>value,computed:get=>({get value(){return get()}}),onMounted(){},onBeforeUnmount(){},watch(){},nextTick:async()=>{},useOverlayScrollLock(){},URLSearchParams,URL,Map,Uint8Array,document:{activeElement:null},window:{addEventListener(){},removeEventListener(){},setTimeout(){}},accessToken:()=> 'admin-a',api:async()=>({items:[],total:0}),defineProps:()=>({open:true,mode:'manual'}),defineEmits:()=>()=>{},auth:{state:{user:{id:'admin-a'}},isSuperAdmin:{value:true}},...overrides}
  vm.runInNewContext(script+`\nglobalThis.subject={${exposed}};`,context)
  return context.subject
}
test('学籍联动筛选清理子级，保留组合筛选并防止迟到结果覆盖',async()=>{
  const pending=deferred(),calls=[];let count=0
  const state=await evaluate('../src/views/AccountsView.vue','filters,departmentChanged,majorChanged,load,result,query,status',{api:async url=>{calls.push(url);return ++count===1?pending.promise:{items:[{id:'new'}],total:1,filterOptions:{}}}})
  Object.assign(state.filters,{department:'甲学院',major:'旧专业',className:'旧班级',personType:'alumni'});state.departmentChanged();assert.equal(state.filters.major,'');assert.equal(state.filters.className,'')
  state.filters.major='新专业';state.filters.className='临时班';state.majorChanged();assert.equal(state.filters.className,'')
  await new Promise(resolve=>setImmediate(resolve));pending.resolve({items:[{id:'old'}],total:1});await new Promise(resolve=>setImmediate(resolve))
  assert.equal(state.result.value.items[0].id,'new');assert.ok(calls[1].includes('major='));assert.ok(calls[1].includes('personType=alumni'))
})
test('账号变更后不展示迟到人员结果，权限失效会清空弹窗和记录',async()=>{
  let token='admin-a';const wait=deferred(),state=await evaluate('../src/views/AccountsView.vue','load,result,clearPrivateState,personnelOpen',{accessToken:()=>token,api:()=>wait.promise})
  const work=state.load();token='admin-b';wait.resolve({items:[{id:'private-person'}],total:1});await work;assert.equal(state.result.value.items.length,0)
  state.personnelOpen.value=true;state.clearPrivateState();assert.equal(state.personnelOpen.value,false)
})
test('人员预检和导入确认绑定当前账号，双击不能重复提交',async()=>{
  let token='admin-a';const waiting=deferred();let calls=0
  const state=await evaluate('../src/components/PersonnelImportDrawer.vue','reset,preview,apply,busy,result,verificationMode,inspect',{accessToken:()=>token,api:()=>{calls++;return waiting.promise}})
  state.reset();state.preview.value={token:'preview-a',invalid:0,total:1};const work=state.apply();await state.apply();assert.equal(calls,1);assert.equal(state.busy.value,true)
  token='admin-b';waiting.resolve({created:1,accountIds:['private-person']});await work;assert.equal(state.result.value,null)
})
