<script setup>
import {computed,onBeforeUnmount,onMounted,ref} from 'vue'
import {api,apiUrl,accessToken} from '../lib/api.js'
import {mapEditorMessage} from '../lib/mapEditorMessage.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
const empty=()=>({type:'FeatureCollection',features:[]})
const catalog=ref(null),error=ref(''),message=ref(''),busy=ref(false),progress=ref(''),frame=ref(null),layerId=ref(''),layerName=ref(''),geojson=ref(empty()),dirty=ref(false),file=ref(null)
const name=ref(''),source=ref(''),attribution=ref('© OpenStreetMap contributors · Protomaps'),license=ref('ODbL 1.0'),sha256=ref(''),licenseConfirmed=ref(false)
const confirmation=ref(null)
const viewerUrl=apiUrl('/api/v1/maps/viewer/index.html?edit=1'),viewerOrigin=new URL(viewerUrl).origin
const active=computed(()=>catalog.value?.basemaps.find(r=>r.id===catalog.value.activeBasemapId)),revision=computed(()=>catalog.value?.revision??0)
const pageToken=accessToken()
let generation=0,loadSequence=0,importSequence=0,controller,disposed=false,invalidated=false,frameReady=false,editorRevision=0
let confirmResolve
const sizeText=size=>size>=1024**3?`${(size/1024**3).toFixed(2)} GB`:`${(size/1024**2).toFixed(1)} MB`
const filenameStatus=u=>u.status==='complete'?'已校验完成':'等待继续上传'
function current(epoch=generation){return !disposed&&!invalidated&&epoch===generation&&!!pageToken&&accessToken()===pageToken}
function clearPrivate(){answerConfirm(false);catalog.value=null;layerId.value='';layerName.value='';geojson.value=empty();dirty.value=false;file.value=null;name.value='';source.value='';sha256.value='';licenseConfirmed.value=false;message.value='';progress.value='';frameReady=false;editorRevision++;importSequence++}
function revoked(){invalidated=true;generation++;controller?.abort();controller=null;busy.value=false;clearPrivate();postMap();error.value='登录状态或权限已变化，请重新登录'}
function permitted(){if(current())return true;if(!disposed)revoked();return false}
function showFailure(e){if(e.status===401||e.status===403){revoked();return}error.value=e.name==='AbortError'?'上传已暂停，可重新选择原文件继续':e.message}
function askConfirm(title,description,tone='danger'){
  if(!permitted()||busy.value)return Promise.resolve(false)
  answerConfirm(false);confirmation.value={title,description,tone,epoch:generation}
  return new Promise(resolve=>{confirmResolve=resolve})
}
function answerConfirm(yes){const pending=confirmation.value,resolve=confirmResolve;confirmation.value=null;confirmResolve=null;resolve?.(!!yes&&!!pending&&current(pending.epoch))}
async function load(){
  if(!permitted())return
  const epoch=generation,run=++loadSequence
  try{const result=await api('/admin/maps',{token:pageToken});if(!current(epoch)||run!==loadSequence)return;catalog.value=result}
  catch(e){if(current(epoch)&&run===loadSequence)showFailure(e)}
  finally{if(!disposed&&!invalidated&&accessToken()!==pageToken)revoked()}
}
async function action(run){
  if(!permitted()||busy.value)return
  const epoch=generation,abort=new AbortController();controller=abort;busy.value=true;error.value='';message.value=''
  const valid=()=>current(epoch)&&!abort.signal.aborted
  const assertCurrent=()=>{if(!valid())throw Object.assign(new Error('当前操作已取消'),{name:'AbortError'})}
  const request=async(path,options={})=>{assertCurrent();const result=await api(path,{...options,token:pageToken,signal:abort.signal});assertCurrent();return result}
  try{await run({request,current:valid,assertCurrent,signal:abort.signal});if(valid())await load()}
  catch(e){if(current(epoch))showFailure(e)}
  finally{if(!disposed&&!invalidated&&accessToken()!==pageToken)revoked();if(current(epoch))busy.value=false;if(controller===abort)controller=null}
}
function postMap(){frame.value?.contentWindow?.postMessage(mapEditorMessage(geojson.value),viewerOrigin)}
function receive(event){
  if(!current()||!catalog.value||event.origin!==viewerOrigin||event.source!==frame.value?.contentWindow)return
  if(event.data?.type==='hufe-map-ready'){frameReady=true;postMap()}
  else if(frameReady&&event.data?.type==='hufe-map-change'&&event.data.geojson?.type==='FeatureCollection'&&Array.isArray(event.data.geojson.features)){
    const next=event.data.geojson;if(JSON.stringify(next)!==JSON.stringify(geojson.value)){dirty.value=true;editorRevision++}geojson.value=next
  }
}
function reloadViewer(){frameReady=false;if(frame.value)frame.value.src=viewerUrl+`&r=${Date.now()}`}
async function newLayer(){if(busy.value||!permitted())return;if(dirty.value&&!await askConfirm('新建图层','当前尚有未保存绘制，是否放弃并新建？'))return;layerId.value='';layerName.value='';geojson.value=empty();dirty.value=false;editorRevision++;importSequence++;postMap()}
async function editLayer(row){
  if(busy.value||!permitted())return
  if(dirty.value&&!await askConfirm('打开其他图层','是否放弃未保存的绘制？'))return
  const edit=editorRevision
  await action(async({request})=>{const result=await request(`/admin/maps/layers/${row.id}/content`);if(edit!==editorRevision)throw new Error('读取期间绘制已变化，请保存当前绘制后重新打开图层');layerId.value=row.id;layerName.value=row.name;geojson.value=result;dirty.value=false;editorRevision++;importSequence++;postMap()})
}
async function saveLayer(){
  const body={id:layerId.value||undefined,name:layerName.value,geojson:mapEditorMessage(geojson.value).geojson,expectedRevision:revision.value}
  const edit=editorRevision
  await action(async({request})=>{const result=await request('/admin/maps/layers',{method:'POST',body});layerId.value=result.id;dirty.value=edit!==editorRevision||layerName.value!==body.name||JSON.stringify(geojson.value)!==JSON.stringify(body.geojson);message.value=dirty.value?'已保存提交时的草稿；当前新增修改仍待保存。':'草稿已保存；点击发布后才会展示到前台。'})
}
async function layerAction(row,kind){
  if(busy.value||!permitted())return
  const expectedRevision=revision.value
  if(!await askConfirm('确认图层操作',`${{publish:'发布当前草稿到前台',unpublish:'从前台下架',delete:'删除此图层（前台同时下架）'}[kind]}：${row.name}？`,kind==='publish'?'info':'danger'))return
  await action(async({request})=>{await request(`/admin/maps/layers/${row.id}/action`,{method:'POST',body:{action:kind,expectedRevision}});message.value='图层状态已更新';if(kind==='delete'&&row.id===layerId.value){layerId.value='';layerName.value='';geojson.value=empty();dirty.value=false;editorRevision++;importSequence++}reloadViewer()})
}
async function importGeojson(event){
  const selected=event.target.files?.[0];event.target.value=''
  if(!selected||busy.value||!permitted())return
  if(selected.size>4*1024**2){error.value='GeoJSON文件最多4MB';return}
  const epoch=generation,run=++importSequence,edit=editorRevision
  try{
    const raw=await selected.text()
    if(!current(epoch)||run!==importSequence||edit!==editorRevision||busy.value)return
    const parsed=JSON.parse(raw)
    if(parsed.type!=='FeatureCollection'||!Array.isArray(parsed.features)||parsed.features.length>1000)throw new Error('须为FeatureCollection，最多1000个要素')
    for(const feature of parsed.features){if(feature?.type!=='Feature'||!['Point','LineString','Polygon'].includes(feature.geometry?.type)||!Array.isArray(feature.geometry.coordinates))throw new Error('只支持有效点、线和面');const p=feature.properties||{};feature.properties={name:String(p.name||'').slice(0,120),description:String(p.description||'').slice(0,500),color:/^#[a-f0-9]{6}$/i.test(p.color)?p.color:'#d65a42'}}
    if(dirty.value&&!await askConfirm('确认导入 GeoJSON','导入将替换当前未保存绘制，是否继续？'))return
    if(!current(epoch)||run!==importSequence||edit!==editorRevision)return
    geojson.value=parsed;dirty.value=true;editorRevision++;postMap();message.value='已载入编辑器，保存时服务端将校验坐标与图形格式。'
  }catch(e){if(current(epoch)&&run===importSequence)error.value=`导入失败：${e.message}`}
}
function deleteFeature(index){if(busy.value||!permitted())return;geojson.value={...geojson.value,features:geojson.value.features.filter((_,i)=>i!==index)};dirty.value=true;editorRevision++;postMap()}
function featureChanged(){if(!permitted())return;dirty.value=true;editorRevision++;postMap()}
function pickFile(event){if(busy.value||!permitted())return;file.value=event.target.files?.[0]||null;if(file.value&&!name.value)name.value=file.value.name.replace(/\.pmtiles$/i,'')}
function asBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('无法读取文件分片'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob)})}
async function upload(existing){await action(async({request,assertCurrent})=>{
  if(!file.value||!file.value.name.toLowerCase().endsWith('.pmtiles'))throw new Error('请先选择本地PMTiles文件')
  if(existing&&existing.size!==file.value.size)throw new Error('续传文件大小与原任务不同，请选择原文件')
  const selected=file.value,chunkSize=catalog.value.chunkSize
  const task=existing?await request(`/admin/maps/uploads/${existing.id}`):await request('/admin/maps/uploads',{method:'POST',body:{name:name.value,size:selected.size,source:source.value,attribution:attribution.value,license:license.value,sha256:sha256.value.trim(),licenseConfirmed:licenseConfirmed.value}})
  try{
    for(let index=0;index<task.totalChunks;index++){
      assertCurrent();if(task.chunks.includes(index))continue
      progress.value=`上传 ${index+1} / ${task.totalChunks} 分片（每片4MB）`
      const contentBase64=await asBase64(selected.slice(index*chunkSize,Math.min(selected.size,(index+1)*chunkSize)))
      await request(`/admin/maps/uploads/${task.id}/chunks/${index}`,{method:'PUT',body:{contentBase64}})
    }
    assertCurrent();progress.value='上传完毕，正在校验 SHA256 与 PMTiles 索引…'
    await request(`/admin/maps/uploads/${task.id}/complete`,{method:'POST'});message.value='底图已校验入库，点击发布切换后前台才会使用。'
  }finally{if(current())progress.value=''}
})}
async function cancelUpload(task){if(busy.value||!permitted()||!await askConfirm('取消上传任务','取消任务并清理已上传分片？'))return;await action(({request})=>request(`/admin/maps/uploads/${task.id}`,{method:'DELETE'}))}
async function publish(row){if(busy.value||!permitted())return;const expectedRevision=revision.value;if(!await askConfirm('确认发布底图',`将前台底图切换为“${row.name}”？原版本仍可再次启用。`,'info'))return;await action(async({request})=>{await request(`/admin/maps/basemaps/${row.id}/publish`,{method:'POST',body:{expectedRevision}});message.value='底图已发布';reloadViewer()})}
onMounted(()=>{window.addEventListener('message',receive);window.addEventListener('hufe:auth-expired',revoked);load()})
onBeforeUnmount(()=>{disposed=true;generation++;controller?.abort();controller=null;clearPrivate();window.removeEventListener('message',receive);window.removeEventListener('hufe:auth-expired',revoked)})
</script>
<template>
  <section class="maps-admin">
    <ConfirmDialog :open="!!confirmation" :title="confirmation?.title||'确认地图操作'" :description="confirmation?.description||''" :tone="confirmation?.tone||'danger'" @confirm="answerConfirm(true)" @cancel="answerConfirm(false)" />
    <header class="maps-head"><div><p>湖财人管理后台</p><h1>地图管理</h1><p>内置本地真实街道底图，维护点、路线与区域；草稿保存和前台发布相互独立。</p></div><button :disabled="busy" @click="load">刷新</button></header>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p><p v-if="message" class="notice" role="status">{{ message }}</p>
    <template v-if="catalog">
      <div class="notice">当前底图：{{ active?.name||'尚未发布' }} · 版本 {{ revision }}。目前内置长沙及周边，其他地区须上传合法授权数据。普通地图浏览不依赖外部地图接口。</div>
      <section class="map-panel"><div class="panel-title"><h2>地图绘制与图层</h2><div><button :disabled="busy" @click="newLayer">新建图层</button><label class="file-button">导入 GeoJSON<input type="file" accept=".json,.geojson,application/geo+json,application/json" :disabled="busy" @change="importGeojson"></label></div></div>
        <p class="help">使用地图中的标点、画线、画面工具，点击地图添加顶点后“完成绘制”。坐标为 WGS84；每层最多1000个要素、20000个坐标点。图层标注与原始道路底图分开维护。</p>
        <iframe ref="frame" :src="viewerUrl" class="map-editor" :style="busy ? {pointerEvents:'none'} : null" title="本地地图点线面编辑器"></iframe>
        <div class="edit-heading"><label>图层名称<input v-model="layerName" maxlength="100" placeholder="例如：校园路线 / 校友活动地点" :disabled="busy" @input="dirty=true"></label><button class="primary" :disabled="busy||!layerName.trim()" @click="saveLayer">保存草稿{{ dirty?' *':'' }}</button></div>
        <div v-if="geojson.features.length" class="feature-list"><div v-for="(feature,index) in geojson.features" :key="index" class="feature-row"><span>{{ index+1 }} · {{ {Point:'点',LineString:'线',Polygon:'面'}[feature.geometry?.type]||'待校验图形' }}</span><input v-model="feature.properties.name" maxlength="120" placeholder="标注名称" :disabled="busy" @input="featureChanged"><input v-model="feature.properties.description" maxlength="500" placeholder="标注说明" :disabled="busy" @input="featureChanged"><button :disabled="busy" @click="deleteFeature(index)">删除</button></div></div>
        <div class="table-scroll"><table><thead><tr><th>图层</th><th>前台状态</th><th>操作</th></tr></thead><tbody><tr v-for="row in catalog.layers" :key="row.id"><td>{{ row.name }}</td><td>{{ row.publishedVersion ? row.publishedVersion===row.draftVersion?'已发布当前版本':'已发布旧版，草稿有更新':'未发布' }}</td><td class="actions"><button :disabled="busy" @click="editLayer(row)">编辑</button><button :disabled="busy||row.publishedVersion===row.draftVersion" @click="layerAction(row,'publish')">发布草稿</button><button v-if="row.publishedVersion" :disabled="busy" @click="layerAction(row,'unpublish')">下架</button><button :disabled="busy" @click="layerAction(row,'delete')">删除</button></td></tr><tr v-if="!catalog.layers.length"><td colspan="3">暂无图层，可以在地图上直接创建。</td></tr></tbody></table></div>
      </section>
      <section class="map-panel"><h2>底图版本与切换</h2><p class="help">发布会重新核验完整 SHA256，原底图不覆盖、不删除，可切回旧版本。底图须为 Protomaps v4 层结构的 PMTiles v3。</p><div class="basemap-list"><article v-for="row in catalog.basemaps" :key="row.id"><div><h3>{{ row.name }}</h3><p>{{ sizeText(row.size) }} · 缩放 {{ row.minZoom }}–{{ row.maxZoom }} · {{ row.license }}</p><p>范围 {{ row.bounds.join(', ') }}</p><code>SHA256 {{ row.sha256 }}</code><p>{{ row.attribution }}</p></div><button :disabled="busy||row.id===catalog.activeBasemapId" @click="publish(row)">{{ row.id===catalog.activeBasemapId?'正在使用':'发布 / 切换' }}</button></article></div></section>
      <section class="map-panel"><h2>上传其他地区或新版底图</h2><p class="help">每片4MB断点续传，单文件最多20GB，并检查服务器可用空间。地图浏览资源已本地内置，不会自动下载外部底图。SHA256请使用来源方提供值，或本地执行 shasum -a 256 文件名 获取。</p><div class="upload-grid"><label>PMTiles 文件<input type="file" accept=".pmtiles" :disabled="busy" @change="pickFile"></label><label>底图名称<input v-model="name" maxlength="100" :disabled="busy"></label><label>数据来源 HTTPS 地址<input v-model="source" placeholder="https://…" :disabled="busy"></label><label>版权署名<input v-model="attribution" maxlength="500" :disabled="busy"></label><label>授权许可<input v-model="license" maxlength="200" :disabled="busy"></label><label>完整 SHA256<input v-model="sha256" maxlength="64" placeholder="64位十六进制校验值" :disabled="busy"></label></div><label class="check"><input v-model="licenseConfirmed" type="checkbox" :disabled="busy">我已确认数据允许自托管，并会按许可证显示版权署名。</label><div class="upload-actions"><button class="primary" :disabled="busy||!file||!licenseConfirmed" @click="upload()">上传并校验</button><button v-if="progress" @click="controller?.abort()">暂停上传</button><span role="status">{{ progress }}</span></div><div v-for="task in catalog.uploads" :key="task.id" class="upload-task"><span>{{ task.name }} · {{ sizeText(task.size) }} · {{ filenameStatus(task) }} · {{ task.chunks.length }}/{{ task.totalChunks }} 片</span><template v-if="task.status==='uploading'"><button :disabled="busy||!file" @click="upload(task)">选择原文件后续传</button><button :disabled="busy" @click="cancelUpload(task)">取消并清理分片</button></template></div></section>
    </template>
  </section>
</template>
<style scoped>
.maps-admin{max-width:1440px;margin:auto;min-width:0;color:#24352e}.maps-head,.panel-title,.edit-heading{display:flex;justify-content:space-between;align-items:center;gap:16px}.maps-head p,.help{font-size:13px;color:#738278;line-height:1.7}.maps-head h1{font-size:28px;margin:8px 0}.map-panel{background:#fff;border:1px solid #dfe7e1;border-radius:16px;padding:22px;margin:20px 0;min-width:0}.map-panel h2{font-size:18px;margin:0 0 12px}.notice{padding:13px 16px;background:#eff7f1;color:#326b4b;border:1px solid #d6e6d9;border-radius:10px;margin:14px 0;font-size:13px;line-height:1.7}.notice.error{background:#fff0ef;color:#a8342e;border-color:#f0cac7}.maps-admin button,.file-button{font:inherit;font-size:13px;border:1px solid #d3dfd5;background:white;color:#36573f;border-radius:8px;padding:8px 12px;cursor:pointer;white-space:nowrap}.maps-admin button:disabled{opacity:.5;cursor:not-allowed}.maps-admin button.primary{background:#286649;color:white;border-color:#286649}.file-button{display:inline-block;margin-left:8px}.file-button input{display:none}.map-editor{width:100%;height:560px;border:1px solid #d5e0d7;border-radius:12px;background:#e8f0e9}.edit-heading{margin:16px 0}.edit-heading label{flex:1}.maps-admin label{font-size:13px;color:#526757}.maps-admin input:not([type=checkbox]){display:block;width:100%;box-sizing:border-box;border:1px solid #d5dfd7;border-radius:7px;padding:9px 10px;font:inherit;margin-top:6px;min-width:0}.feature-list{max-height:260px;overflow:auto;border:1px solid #e3e9e4;border-radius:9px;padding:8px}.feature-row{display:grid;grid-template-columns:80px 1fr 2fr auto;gap:8px;align-items:center;font-size:12px}.feature-row input{margin-bottom:6px}.table-scroll{overflow:auto;margin-top:18px}table{border-collapse:collapse;width:100%;min-width:520px;font-size:13px}td,th{padding:12px;border-bottom:1px solid #e8ece8;text-align:left}.actions button{margin-right:6px}.basemap-list article{border:1px solid #e1e7e1;border-radius:10px;padding:16px;display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:12px}.basemap-list h3{font-size:15px;margin:0 0 9px}.basemap-list p{font-size:12px;color:#68776d;line-height:1.6;margin:5px 0}.basemap-list code{font-size:11px;word-break:break-all;display:block;color:#5e7565}.upload-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.check{display:flex;align-items:flex-start;gap:7px;margin:18px 0}.upload-actions,.upload-task{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:13px}.upload-task{padding:14px 0;border-top:1px solid #e1e7e3;margin-top:16px}.upload-task span{flex:1;min-width:180px}@media(max-width:700px){.map-panel{padding:14px}.maps-head,.panel-title{align-items:flex-start;flex-direction:column}.map-editor{height:520px}.upload-grid{grid-template-columns:1fr}.basemap-list article{align-items:flex-start;flex-direction:column}.feature-row{grid-template-columns:55px 1fr auto}.feature-row input:nth-of-type(2){grid-column:2}.edit-heading{align-items:flex-end}}
</style>
