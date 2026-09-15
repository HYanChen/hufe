import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { loadAllPages } from '../../utils/pagination.js'
async function view(overrides={}){
  const source=await fs.readFile(new URL('../src/views/GateManagementView.vue',import.meta.url),'utf8'),script=source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
  const ctx={ref:value=>({value}),api:async path=>path==='/gate/me'?{canManage:true,canGrantManagers:true}:{items:[],total:0},accessToken:()=> 'admin-a',loadAllPages,URLSearchParams,onMounted(){},onBeforeUnmount(){},setInterval:()=>0,clearInterval(){},...overrides}
  vm.runInNewContext(script+'\nglobalThis.testState={load,apply,grant,revoke,saveStation,toggleStation,checkRole,role,staff,records,stations,action,stationForm,error,notice};',ctx)
  return ctx.testState
}
test('保安授权使用普通账号id并单独确认，未确认不改账号权限',async()=>{
  const calls=[],p=await view({api:async(path,options)=>{calls.push({path,options});return path==='/gate/me'?{canManage:true,canGrantManagers:true}:{items:[],total:0}}})
  await p.load();calls.length=0;p.grant({id:'person',name:'甲',username:'jia'},'guard');assert.equal(calls.length,0);assert.equal(p.action.value.body.accountId,'person');await p.apply()
  assert.equal(calls[0].path,'/gate/staff');assert.equal(calls[0].options.body.role,'guard');assert.equal(calls[0].options.token,'admin-a');assert.equal(p.action.value,null)
})
test('后台核验站点修改保留编辑时revision；冲突后要求重新确认',async()=>{
  const calls=[],p=await view({api:async(path,options)=>{calls.push({path,options});if(options?.method==='PATCH')throw Object.assign(new Error('站点已修改'),{status:409});return path==='/gate/me'?{canManage:true}:{items:[],total:0}}})
  await p.load();p.stationForm.value={id:'station',name:'东门服务点',description:'说明',expectedRevision:7};p.saveStation();await p.apply()
  const write=calls.find(c=>c.options?.method==='PATCH');assert.equal(write.options.body.expectedRevision,7);assert.equal(p.action.value,null);assert.match(p.error.value,/重新确认/)
})
test('权限撤销立即清理后台人员记录，换号后旧授权不能提交',async()=>{
  let token='admin-a',allowed=true,writes=0;const p=await view({accessToken:()=>token,api:async(path,options)=>{if(options?.method)writes++;return path==='/gate/me'?{canManage:allowed,canGrantManagers:true}:{items:[],total:0}}})
  await p.load();p.grant({id:'person',name:'甲'},'manager');token='admin-b';await p.apply();assert.equal(writes,0);assert.equal(p.action.value,null)
  await p.load();p.records.value=[{person:{name:'私有记录'}}];allowed=false;await p.checkRole();assert.equal(p.role.value,null);assert.equal(p.records.value.length,0)
})
