import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { mapEditorMessage } from '../src/lib/mapEditorMessage.js'

const origin='http://127.0.0.1:4180'
const feature=name=>({type:'Feature',properties:{name},geometry:{type:'Point',coordinates:[112.97,28.2]}})
const collection=name=>({type:'FeatureCollection',features:name?[feature(name)]:[]})
const initialCatalog=()=>({revision:4,layers:[],basemaps:[],uploads:[],chunkSize:4*1024**2})
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
async function view(overrides={}){
  const source=await fs.readFile(new URL('../src/views/MapsView.vue',import.meta.url),'utf8')
  const script=source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
  let unmount
  const sent=[],listeners=new Map(),contentWindow={postMessage:(data,target)=>sent.push({data,target})}
  const context={ref:value=>({value}),computed:fn=>({get value(){return fn()}}),api:async()=>initialCatalog(),apiUrl:path=>origin+path,accessToken:()=> 'admin-a',mapEditorMessage,URL,AbortController,FileReader:class{},onMounted(){},onBeforeUnmount(fn){unmount=fn},window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},...overrides}
  vm.runInNewContext(script+'\nglobalThis.testState={load,saveLayer,editLayer,layerAction,publish,upload,importGeojson,newLayer,receive,revoked,answerConfirm,confirmation,catalog,geojson,layerId,layerName,dirty,busy,file,progress,error,message,frame};',context)
  const p=context.testState;p.frame.value={contentWindow,src:'initial'}
  return Object.assign(p,{sent,unmount:()=>unmount(),event:(type,geojson)=>({origin,source:contentWindow,data:{type,geojson}})})
}

test('地图首次 ready 之前忽略空 change，ready 后向子页发送现有草稿',async()=>{
  const p=await view();await p.load();p.geojson.value=collection('保留的草稿');p.dirty.value=true
  p.receive(p.event('hufe-map-change',collection()));assert.equal(p.geojson.value.features[0].properties.name,'保留的草稿')
  p.receive(p.event('hufe-map-ready'));assert.equal(p.sent.at(-1).data.geojson.features.length,1)
  p.receive(p.event('hufe-map-change',collection('保留的草稿')));assert.equal(p.dirty.value,true)
  p.receive({...p.event('hufe-map-change',collection()),origin:'https://untrusted.example'});assert.equal(p.geojson.value.features.length,1)
})

test('发布重新加载 iframe 不清空已选图层、未保存草稿或 dirty 标记',async()=>{
  const calls=[],p=await view({api:async(path,options)=>{calls.push({path,options});return initialCatalog()}})
  await p.load();p.layerId.value='layer-a';p.layerName.value='现有图层';p.geojson.value=collection('待保存');p.dirty.value=true;p.receive(p.event('hufe-map-ready'))
  const pending=p.layerAction({id:'layer-b',name:'另一个已存图层'},'publish');assert.equal(calls.length,1);assert.ok(p.confirmation.value);p.answerConfirm(true);await pending
  assert.match(p.frame.value.src,/&r=/);p.receive(p.event('hufe-map-change',collection()));p.receive(p.event('hufe-map-ready'))
  assert.equal(p.layerId.value,'layer-a');assert.equal(p.layerName.value,'现有图层');assert.equal(p.dirty.value,true);assert.equal(p.geojson.value.features[0].properties.name,'待保存');assert.equal(p.sent.at(-1).data.geojson.features.length,1)
  const write=calls.find(call=>call.options.method==='POST');assert.equal(write.options.token,'admin-a');assert.equal(write.options.body.expectedRevision,4)
})

test('切换账号后确认框不能以新账号发布旧图层，取消无任何写入',async()=>{
  let token='admin-a';const writes=[],p=await view({accessToken:()=>token,api:async(path,options)=>{if(options.method)writes.push(path);return initialCatalog()}})
  await p.load();let work=p.publish({id:'base-a',name:'底图甲'});p.answerConfirm(false);await work;assert.equal(writes.length,0)
  work=p.publish({id:'base-a',name:'底图甲'});token='admin-b';p.answerConfirm(true);await work;assert.equal(writes.length,0);assert.equal(p.confirmation.value,null)
})

test('离开页面后迟到的 edit 响应不回填私人草稿，也不触发 catalog 刷新',async()=>{
  const wait=deferred(),calls=[],p=await view({api:async(path)=>{calls.push(path);return path.endsWith('/content')?wait.promise:initialCatalog()}})
  await p.load();const work=p.editLayer({id:'layer-a',name:'旧图层'});p.unmount();wait.resolve(collection('私人草稿'));await work
  assert.equal(p.catalog.value,null);assert.equal(p.geojson.value.features.length,0);assert.equal(p.layerId.value,'');assert.equal(calls.length,2);assert.equal(p.sent.length,0)
})

test('迟到的保存响应在撤权后不恢复图层、提示或地图内容',async()=>{
  const wait=deferred(),p=await view({api:async(_path,options)=>options.method==='POST'?wait.promise:initialCatalog()})
  await p.load();p.geojson.value=collection('原私人草稿');p.layerName.value='原图层';const work=p.saveLayer();p.revoked();wait.resolve({id:'late'});await work
  assert.equal(p.layerId.value,'');assert.equal(p.catalog.value,null);assert.equal(p.message.value,'');assert.equal(p.busy.value,false);assert.equal(p.geojson.value.features.length,0)
})

test('保存中的新绘制仍标记未保存，请求体保持提交时快照',async()=>{
  const wait=deferred(),calls=[],p=await view({api:async(path,options)=>{calls.push({path,options});return options.method==='POST'?wait.promise:initialCatalog()}})
  await p.load();p.layerName.value='图层';p.geojson.value=collection('已提交');p.receive(p.event('hufe-map-ready'));const work=p.saveLayer()
  p.receive(p.event('hufe-map-change',collection('新绘制')));wait.resolve({id:'saved'});await work
  assert.equal(p.dirty.value,true);assert.equal(p.geojson.value.features[0].properties.name,'新绘制');assert.equal(calls.find(c=>c.options.method==='POST').options.body.geojson.features[0].properties.name,'已提交');assert.match(p.message.value,/仍待保存/)
})

test('catalog 较早响应和旧账号拒绝响应不能覆盖当前页面',async()=>{
  const first=deferred(),second=deferred();let count=0,token='admin-a'
  const p=await view({accessToken:()=>token,api:()=>++count===1?first.promise:second.promise})
  const a=p.load(),b=p.load();second.resolve({...initialCatalog(),revision:8});await b;first.resolve({...initialCatalog(),revision:3});await a;assert.equal(p.catalog.value.revision,8)
  const wait=deferred(),q=await view({accessToken:()=>token,api:()=>wait.promise});const loading=q.load();token='admin-b';wait.reject(new Error('旧错误'));await loading;assert.equal(q.catalog.value,null);assert.doesNotMatch(q.error.value,/旧错误/)
})

test('读取 GeoJSON 文件后离开或新建图层，旧文件不覆盖当前编辑器',async()=>{
  const wait=deferred(),p=await view();await p.load();const work=p.importGeojson({target:{files:[{size:100,text:()=>wait.promise}],value:'local'}})
  await p.newLayer();wait.resolve(JSON.stringify(collection('旧导入')));await work;assert.equal(p.geojson.value.features.length,0)
  const later=deferred(),q=await view();await q.load();const pending=q.importGeojson({target:{files:[{size:100,text:()=>later.promise}],value:'local'}});q.unmount();later.resolve(JSON.stringify(collection('离开后导入')));await pending;assert.equal(q.geojson.value.features.length,0)
})

test('分片读取中切账号，绝不使用新会话上传旧文件或完成旧任务',async()=>{
  let token='admin-a',reader;const calls=[],p=await view({accessToken:()=>token,FileReader:class{readAsDataURL(){reader=this}},api:async(path,options)=>{calls.push({path,options});return path==='/admin/maps/uploads'?{id:'upload',totalChunks:1,chunks:[]}:initialCatalog()}})
  await p.load();p.file.value={name:'map.pmtiles',size:100,slice:()=>({})};const work=p.upload();await tick();assert.ok(reader);token='admin-b';reader.result='data:application/octet-stream;base64,YQ==';reader.onload();await work
  assert.equal(calls.filter(c=>c.path.includes('/chunks/')||c.path.endsWith('/complete')).length,0);assert.ok(calls.every(c=>c.options.token==='admin-a'));assert.equal(p.catalog.value,null);assert.equal(p.file.value,null);assert.equal(p.progress.value,'');assert.equal(p.busy.value,false)
})

test('403 权限变化清理地图私人状态，已失效页面不再发起请求',async()=>{
  let calls=0;const p=await view({api:async()=>{calls++;throw Object.assign(new Error('无权查看'),{status:403})}})
  p.geojson.value=collection('私有');await p.load();await p.load();await p.saveLayer();assert.equal(calls,1);assert.equal(p.geojson.value.features.length,0);assert.equal(p.catalog.value,null)
})

test('真实 viewer 初始化仅发 ready，收到父草稿后才发 change 回显',async()=>{
  const source=await fs.readFile(new URL('../../server/src/maps/assets/viewer.js',import.meta.url),'utf8')
  const posted=[],listeners={},events={},sources=new Map(),parent={postMessage:(data,target)=>posted.push({data,target})},elements={}
  const element=id=>elements[id]??={textContent:'',value:'',classList:{add(){},toggle(){}},addEventListener(){},querySelectorAll:()=>[]}
  class LocalMap{on(type,...args){events[type]=args.at(-1)}addSource(id,value){sources.set(id,{...value,setData(data){this.data=data}})}getSource(id){return sources.get(id)}addLayer(){}addControl(){}getCanvas(){return {style:{}}}}
  const window={addEventListener:(type,fn)=>listeners[type]=fn,pmtiles:{Protocol:class{tile(){}}},basemaps:{layers:()=>[],namedFlavor:()=>({})}}
  const ctx={Map:LocalMap,NavigationControl:class{},ScaleControl:class{},Popup:class{},addProtocol(){},URLSearchParams,structuredClone,location:{origin,search:'?edit=1'},parent,window,document:{getElementById:element,addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({code:0,data:{basemap:{name:'本地测试底图',bounds:[112,27,114,29],url:'/base.pmtiles'},layers:[]}})})}
  vm.runInNewContext(source.replace(/^import .*$/gm,'').replace('start().catch(error=>','globalThis.started=start().catch(error=>'),ctx);await ctx.started;await events.load()
  assert.deepEqual(posted.map(p=>p.data.type),['hufe-map-ready'])
  listeners.message({origin,source:parent,data:mapEditorMessage(collection('父页面草稿'))})
  assert.equal(posted.at(-1).data.type,'hufe-map-change');assert.equal(posted.at(-1).data.geojson.features[0].properties.name,'父页面草稿');assert.equal(sources.get('editing').data.features.length,1)
})
