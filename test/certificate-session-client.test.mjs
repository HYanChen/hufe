import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import {loadAllPages} from '../utils/pagination.js'
import {issuedCertificateTemplate,renderCertificateMessage,certificateTheme} from '../utils/certificateTemplate.js'

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const certificate=number=>({certificateNumber:number,title:'已签发证书',actualAmount:100,recipientName:'隔离本人',projectTitle:'隔离项目',issuedAt:'2026-09-13'})
async function page(overrides={}){
  const source=await fs.readFile(new URL('../pages/giving-certificate/index.vue',import.meta.url),'utf8')
  const code=source.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm,'').replace('export default','globalThis.options=')
  const c={getAccessToken:()=> 'a',isVerified:()=>true,loadAllPages,issuedCertificateTemplate,renderCertificateMessage,certificateTheme,resolveMediaUrl:value=>value,openPage(){},getMyGivingIntents:async()=>({items:[],total:0}),uni:{$on(){},$off(){},setClipboardData(){},showToast(){}},...overrides}
  vm.runInNewContext(code,c)
  const p={...c.options.data(),visible:true,submissionId:'target'}
  for(const[k,fn]of Object.entries(c.options.methods))p[k]=fn.bind(p)
  for(const[k,fn]of Object.entries(c.options.computed))Object.defineProperty(p,k,{get:()=>fn.call(p)})
  return {p,options:c.options}
}

test('证书页真实完整分页不遗漏第101条，所有页固定原token并只采用签发快照',async()=>{
  const calls=[],snapshot={title:'原项目模板',message:'感谢{recipientName}',issuer:'原签发单位'},issued={...certificate('CERT-101'),templateSnapshot:snapshot}
  const {p}=await page({getMyGivingIntents:async(query,token)=>{calls.push({page:query.page,token});return {page:query.page,pageSize:100,total:101,items:query.page===1?Array.from({length:100},(_,id)=>({id:'older-'+id})): [{id:'target',certificate:issued}]}}})
  await p.loadCertificate();assert.deepEqual(calls,[{page:1,token:'a'},{page:2,token:'a'}]);assert.equal(p.certificateNumber,'CERT-101');assert.equal(p.template.title,'原项目模板');assert.equal(p.templateMessage,'感谢隔离本人');assert.equal(p.loading,false)
})

test('证书页换号/退出立即清内容，旧页或旧分页响应不能显示另一个人的证书',async()=>{
  let token='a';const pending=deferred(),{p}=await page({getAccessToken:()=>token,getMyGivingIntents:(_query,requestToken)=>requestToken==='a'?pending.promise:Promise.resolve({items:[],total:0})})
  const loading=p.loadCertificate();token='b';p.handleAuthChanged();pending.resolve({items:[{id:'target',certificate:certificate('PRIVATE-A')}],total:1});await loading
  assert.equal(p.issuedCertificate,null);assert.equal(p.ownerToken,'b')
  p.issuedCertificate=certificate('B');token='';p.handleAuthChanged();assert.equal(p.issuedCertificate,null);assert.equal(p.loginRequired,true)
})

test('离开证书页使未完成加载失效，回到页能重试；并发重载只使用最后响应',async()=>{
  const pending=deferred();let calls=0;const {p}=await page({getMyGivingIntents:async()=>++calls===1?pending.promise:{items:[{id:'target',certificate:certificate('NEW')}],total:1}})
  const old=p.loadCertificate();p.stop();pending.resolve({items:[{id:'target',certificate:certificate('OLD')}],total:1});await old
  assert.equal(p.loading,false);assert.equal(p.issuedCertificate,null)
  p.visible=true;await p.loadCertificate();assert.equal(p.certificateNumber,'NEW')
  const first=deferred();let attempt=0;const {p:q}=await page({getMyGivingIntents:()=>++attempt===1?first.promise:Promise.resolve({items:[{id:'target',certificate:certificate('LATEST')}],total:1})})
  const a=q.loadCertificate();await q.loadCertificate();first.resolve({items:[{id:'target',certificate:certificate('STALE')}],total:1});await a;assert.equal(q.certificateNumber,'LATEST')
})

test('未经实名、缺少编号或尚未签发均不生成静态证书；失败不保留旧证书',async()=>{
  let calls=0;const {p}=await page({isVerified:()=>false,getMyGivingIntents:async()=>calls++});await p.loadCertificate();assert.equal(calls,0);assert.equal(p.loginRequired,true)
  const {p:q}=await page({getMyGivingIntents:async()=>({items:[{id:'target'}],total:1})});await q.loadCertificate();assert.match(q.error,/尚未签发/);assert.equal(q.issuedCertificate,null)
  const {p:r}=await page({getMyGivingIntents:async()=>{throw Error('网络暂时不可用')}});r.issuedCertificate=certificate('OLD');await r.loadCertificate();assert.equal(r.issuedCertificate,null);assert.match(r.error,/网络暂时不可用/)
})

test('证书复制与打印必须仍是当前账号和当前可见页面，晚到旧证书不能操作',async()=>{
  let token='a',copies=0,prints=0;const {p}=await page({getAccessToken:()=>token,uni:{setClipboardData(){copies++},showToast(){}},window:{print(){prints++}}})
  p.ownerToken='a';p.issuedCertificate=certificate('REAL');p.copyCertificateNumber();p.printCertificate();assert.equal(copies,1);assert.equal(prints,1)
  token='b';p.copyCertificateNumber();p.printCertificate();assert.equal(copies,1);assert.equal(prints,1)
  token='a';p.stop();p.issuedCertificate=certificate('STALE');p.copyCertificateNumber();p.printCertificate();assert.equal(copies,1);assert.equal(prints,1)
})

test('公益记录分页服务绑定显式token，不将申请人填写的伪证书当作已签发',async()=>{
  const source=(await fs.readFile(new URL('../services/business.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'')
  const calls=[],c={request:async options=>{calls.push(options);return {items:[{id:'fake',type:'giving-intent',payload:{certificate:certificate('FAKE')}}],total:101,page:2,pageSize:100}}}
  vm.runInNewContext(source+'\nObject.assign(globalThis,{getMyGivingIntents})',c)
  const result=await c.getMyGivingIntents({page:2,pageSize:100},'explicit-person')
  assert.equal(calls[0].token,'explicit-person');assert.equal(calls[0].data.page,2);assert.equal(calls[0].data.type,'giving-intent');assert.equal(result.items[0].certificate,undefined)
})
