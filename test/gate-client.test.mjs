import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import qrcode from '../utils/vendor/qrcode.mjs'
import jsQR from '../utils/vendor/jsqr.mjs'
import { gateQrDataUrl, gateSeconds, normalizeGatePayload } from '../utils/gateQr.js'
import { loadAllPages } from '../utils/pagination.js'

const payload='HUFE-GATE-V1:'+Buffer.alloc(32,8).toString('base64url')
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
async function page(kind='gate',overrides={}){
  const source=await fs.readFile(new URL('../pages/'+kind+'/index.vue',import.meta.url),'utf8')
  const script=source.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm,'').replace('export default','globalThis.options=')
  const context={gateApi:async()=>({items:[]}),getAccessToken:()=> 'a',getUser:()=>({schoolIdentityVerified:true}),identityLabel:x=>x,openPage(){},appConfig:{},gateQrDataUrl,gateSeconds,normalizeGatePayload,loadAllPages,URLSearchParams,setInterval:()=>0,clearInterval(){},uni:{showModal(){},$on(){},$off(){},setClipboardData(){}},...overrides}
  vm.runInNewContext(script,context)
  const options=context.options,p={...options.data(),isModuleEnabled:()=>true,visible:true,ownerToken:'a',$nextTick:async()=>{},$refs:{}}
  for(const [key,fn]of Object.entries(options.methods))p[key]=fn.bind(p)
  for(const [key,fn]of Object.entries(options.computed||{}))Object.defineProperty(p,key,{get:()=>fn.call(p)})
  return{p,options}
}
const preview=()=>({previewId:'preview-a',expiresAt:new Date(Date.now()+60000).toISOString(),person:{name:'校友甲',department:'学院'},station:{id:'station',name:'返校服务点'}})

test('本地二维码真实编解码一致，令牌不是明文个人资料，过期与格式严格校验',()=>{
  const qr=qrcode(0,'M');qr.addData(normalizeGatePayload(payload),'Byte');qr.make()
  const size=qr.getModuleCount(),scale=6,margin=24,width=size*scale+margin*2,pixels=new Uint8ClampedArray(width*width*4).fill(255)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(qr.isDark(y,x))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const index=((y*scale+margin+dy)*width+x*scale+margin+dx)*4;pixels[index]=pixels[index+1]=pixels[index+2]=0}
  assert.equal(jsQR(pixels,width,width)?.data,payload)
  assert.match(gateQrDataUrl(payload),/^data:image\/gif;base64,R0lGOD/)
  assert.throws(()=>gateQrDataUrl('https://example.com/胡同学/学号'),/当前有效/)
  assert.equal(gateSeconds('invalid'),0);assert.equal(gateSeconds('2000-01-01'),0)
  assert.equal(gateSeconds('2026-09-12T00:02:00Z',Date.parse('2026-09-12T00:00:00Z')),120)
})

test('身份卡换账号或离页后，不显示迟到的动态码且不复制旧码',async()=>{
  let token='a',copies=0;const pending=deferred()
  const{p}=await page('card',{getAccessToken:()=>token,gateApi:()=>pending.promise,uni:{setClipboardData(){copies++}}})
  p.canIssue=true;const issuing=p.issuePass();token='b';pending.resolve({qrPayload:payload,expiresAt:new Date(Date.now()+120000).toISOString()});await issuing
  assert.equal(p.qrUrl,'');assert.equal(p.pass,null)
  p.pass={qrPayload:payload,expiresAt:new Date(Date.now()+120000).toISOString()};p.copyPass();assert.equal(copies,0)
  p.stop();assert.equal(p.pass,null);assert.equal(p.visible,false)
})

test('手动核验码只产生待核验预览，确认弹框取消不写放行记录',async()=>{
  let modal;const calls=[]
  const{p}=await page('gate',{gateApi:async(path,options)=>{calls.push({path,options});return preview()},uni:{showModal:value=>modal=value}})
  p.role={canScan:true};p.stations=[{id:'station',name:'返校点',status:'active'}]
  await p.inspect(payload,'手动核验码');assert.equal(calls.length,1);assert.equal(calls[0].path,'/scans/preview');assert.equal(p.previewSource,'手动核验码')
  p.reason='现场核对';p.confirm('allow');assert.match(modal.content,/确认后保存/);await modal.success({confirm:false});assert.equal(calls.length,1)
  await modal.success({confirm:true});assert.equal(calls.length,2);assert.equal(calls[1].path,'/scans/confirm');assert.equal(calls[1].options.data.previewId,'preview-a');assert.equal(p.preview,null);assert.match(p.notice,/确认放行/)
})

test('放行确认过期或角色撤销后清除待核验身份，不能继续使用',async()=>{
  let modal;const{p}=await page('gate',{gateApi:async()=>{throw Object.assign(new Error('权限已撤销'),{statusCode:403})},uni:{showModal:value=>modal=value}})
  p.role={canScan:true};p.preview=preview();p.reason='现场核对';p.records=[{person:{name:'旧身份'}}];p.confirm('allow');await modal.success({confirm:true})
  assert.equal(p.preview,null);assert.equal(p.role,null);assert.equal(p.records.length,0);assert.match(p.error,/权限已撤销/)
  p.role={canScan:true};p.preview={...preview(),expiresAt:'2000-01-01'};p.reason='拒绝原因';modal=null;p.confirm('deny');assert.equal(modal,null)
})

test('扫码后换号或退出页面，旧响应不回填；确认期间换号不发送',async()=>{
  let token='a',modal,writes=0;const pending=deferred()
  const{p}=await page('gate',{getAccessToken:()=>token,gateApi:async()=>{writes++;return pending.promise},uni:{showModal:value=>modal=value}})
  p.role={canScan:true};p.stations=[{id:'station',status:'active'}]
  const reading=p.inspect(payload,'二维码图片识别');token='b';p.stop();pending.resolve(preview());await reading;assert.equal(p.preview,null)
  token='a';p.visible=true;p.ownerToken='a';p.role={canScan:true};p.preview=preview();p.reason='核对本人';p.confirm('allow');token='b';await modal.success({confirm:true});assert.equal(writes,1)
})

test('实时撤销角色清除相机、待核验信息和私有记录',async()=>{
  let stopped=0;const{p}=await page('gate',{gateApi:async()=>({role:'none',canScan:false,canManage:false})})
  p.role={canScan:true,canManage:true};p.preview=preview();p.records=[{id:'record'}];p.people=[{name:'私有账号'}];p.stopCameraFn=()=>stopped++;p.cameraActive=true
  await p.refreshRole();assert.equal(p.preview,null);assert.equal(p.records.length,0);assert.equal(p.people.length,0);assert.equal(p.cameraActive,false);assert.equal(stopped,1)
})

test('待核验请求进行中撤销权限，迟到成功也不能恢复身份信息',async()=>{
  const pending=deferred();const{p}=await page('gate',{gateApi:async path=>path==='/me'?{canScan:false,canManage:false}:pending.promise})
  p.role={canScan:true};p.stations=[{id:'station',status:'active'}]
  const request=p.inspect(payload,'相机扫码');await p.refreshRole();pending.resolve(preview());await request
  assert.equal(p.preview,null);assert.equal(p.role.canScan,false)
})

test('浏览器页面不自动开启相机，扫码图片由本地库解析',async()=>{
  const script=await fs.readFile(new URL('../utils/gateScanner.js',import.meta.url),'utf8')
  assert.match(script,/getUserMedia\(\{ video/);assert.match(script,/window.isSecureContext/);assert.match(script,/jsQR\(pixels.data/);assert.doesNotMatch(script,/fetch\(/)
  const{options}=await page();assert.doesNotMatch(options.onShow.toString(),/startCamera|startGateCamera/)
})

test('保安我的页面显示平台已登录与退出入口，不伪装学校实名',async()=>{
  const{p}=await page('mine',{getPlatformUser:()=>({id:'guard',username:'qa_guard',realName:'核验保安',personType:'member'}),isSignedIn:()=>true,isVerified:()=>false,gateApi:async()=>({role:'guard',canScan:true}),isManualVerification:()=>false})
  await p.load();await Promise.resolve()
  assert.equal(p.signedIn,true);assert.equal(p.verified,false);assert.equal(p.user.realName,'核验保安');assert.equal(p.identityBadge,'✓ 平台已登录');assert.equal(p.identityNumber,'qa_guard');assert.equal(p.roleLabel,'核验人员');assert.doesNotMatch(p.identityDescription,/未登录|模拟/)
  const source=await fs.readFile(new URL('../pages/mine/index.vue',import.meta.url),'utf8');assert.match(source,/signedIn \? signOut\(\)/)
})

test('身份卡按5秒刷新而不是等待10秒过期，刷新期间先清码且不重叠请求',async()=>{
  const base=Date.now();let now=base,tick,calls=0;const pending=deferred()
  class Clock extends Date {static now(){return now}}
  const{p,options}=await page('card',{Date:Clock,setInterval:fn=>{tick=fn;return 1},gateApi:async()=>{calls++;return pending.promise}})
  p.canIssue=true;p.load=()=>{};p.pass={qrPayload:payload,expiresAt:new Date(base+10000).toISOString()};p.qrUrl='old-image';p.refreshAt=base+5000;options.onShow.call(p)
  now=base+4000;tick();assert.equal(calls,0);assert.equal(p.refreshRemaining,1)
  now=base+5000;tick();assert.equal(calls,1);assert.equal(p.qrUrl,'');assert.equal(p.pass,null);assert.equal(p.issuing,true)
  now=base+6000;tick();assert.equal(calls,1)
  pending.resolve({qrPayload:payload,expiresAt:new Date(base+16000).toISOString(),ttlSeconds:10,refreshIntervalSeconds:5});await new Promise(resolve=>setImmediate(resolve))
  assert.equal(p.refreshAt,base+11000);assert.equal(p.refreshRemaining,5);assert.ok(p.qrUrl)
  options.onHide.call(p);assert.equal(p.qrUrl,'');assert.equal(p.pass,null);assert.equal(p.timer,null)
})

test('本人完整学工号只从本人接口读取，换号迟到结果丢弃且缺失不猜测掩码',async()=>{
  const calls=[];const{p}=await page('card',{request:async options=>{calls.push(options);return {studentIdDisplay:'20220000001'}}})
  p.user={studentIdMasked:'2022*******',alumniNo:'ALUMNI-1'};await p.loadStudentNumber(p.generation,'a')
  assert.equal(calls[0].path,'/api/v1/me/identity-card');assert.equal(calls[0].token,'a');assert.equal(calls[0].data,undefined);assert.equal(p.identityNumber,'20220000001');assert.equal(p.user.studentIdDisplay,undefined)
  let token='a';const pending=deferred();const{p:q}=await page('card',{getAccessToken:()=>token,request:()=>pending.promise})
  const reading=q.loadStudentNumber(q.generation,'a');token='b';pending.resolve({studentIdDisplay:'private-number'});await reading;assert.equal(q.selfStudentNumber,'')
  q.studentNumberLoading=false;q.user={studentIdMasked:'1234****'};assert.equal(q.identityNumber,'暂未提供完整学工号')
})

test('本人身份卡从实时本人接口刷新校友编号，不等待缓存过期也不让换号旧响应回填',async()=>{
  const{p}=await page('card',{request:async()=>({studentIdDisplay:'20220000001',alumniNo:'HUFE-2026-123456AB'})})
  p.user={id:'a',alumniNo:'',personType:'student'};await p.loadStudentNumber(p.generation,'a');assert.equal(p.user.alumniNo,'HUFE-2026-123456AB');assert.equal(p.user.personType,'student')
  let token='a';const pending=deferred(),{p:q}=await page('card',{getAccessToken:()=>token,request:()=>pending.promise})
  q.user={id:'a',alumniNo:''};const request=q.loadStudentNumber(q.generation,'a');token='b';q.user={id:'b',alumniNo:'OTHER-NUMBER'};pending.resolve({alumniNo:'PRIVATE-A'});await request;assert.equal(q.user.alumniNo,'OTHER-NUMBER')
})
