import {Map,Marker,NavigationControl,ScaleControl,Popup,addProtocol} from './vendor/maplibre-gl.mjs'
const params=new URLSearchParams(location.search),editing=params.get('edit')==='1',status=document.getElementById('status'),toolbar=document.getElementById('toolbar')
let map,mode='browse',points=[],features=[],ready=false
let networkMarkers=[],networkVersion=0,networkSnapshot=''
const empty=()=>({type:'FeatureCollection',features:[]})
const notify=(emitChange=true)=>{document.getElementById('draw-status').textContent=`${features.length} 个要素 · ${points.length} 个待完成点`;if(emitChange&&editing&&parent!==window)parent.postMessage({type:'hufe-map-change',geojson:{type:'FeatureCollection',features}},location.origin)}
function render(emitChange=true){if(!ready)return;map.getSource('editing').setData({type:'FeatureCollection',features});map.getSource('drawing').setData({type:'FeatureCollection',features:points.map((p,i)=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates:p}})).concat(points.length>1?[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points}}]:[])});notify(emitChange)}
function addGeometry(type,coordinates){features.push({type:'Feature',properties:{name:document.getElementById('feature-name').value.trim(),color:document.getElementById('feature-color').value},geometry:{type,coordinates}});points=[];render()}
function finish(){if(mode==='Point')return;if(points.length<(mode==='Polygon'?3:2)){status.textContent=mode==='Polygon'?'画面至少标记3个顶点':'画线至少标记2个点';return}addGeometry(mode,mode==='Polygon'?[[...points,points[0]]]:[...points])}
function addGeojson(id,data,editable=false){
  map.addSource(id,{type:'geojson',data})
  map.addLayer({id:`${id}-fill`,type:'fill',source:id,filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['coalesce',['get','color'],'#d65a42'],'fill-opacity':0.22}})
  map.addLayer({id:`${id}-line`,type:'line',source:id,filter:['!=',['geometry-type'],'Point'],paint:{'line-color':['coalesce',['get','color'],'#d65a42'],'line-width':3}})
  map.addLayer({id:`${id}-point`,type:'circle',source:id,filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['coalesce',['get','color'],'#d65a42'],'circle-radius':7,'circle-stroke-color':'white','circle-stroke-width':2}})
  if(!editable)for(const suffix of ['fill','line','point'])map.on('click',`${id}-${suffix}`,event=>{if(mode!=='browse')return;const p=event.features[0].properties,box=document.createElement('div'),title=document.createElement('strong'),desc=document.createElement('p');title.textContent=p.name||'地图标注';desc.textContent=p.description||'';box.append(title,desc);new Popup().setLngLat(event.lngLat).setDOMContent(box).addTo(map)})
}
window.addEventListener('message',event=>{if(!editing||event.origin!==location.origin||event.source!==parent||event.data?.type!=='hufe-map-load')return;const fc=event.data.geojson;if(fc?.type!=='FeatureCollection'||!Array.isArray(fc.features)||fc.features.length>1000)return;features=structuredClone(fc.features);points=[];render()})
toolbar.addEventListener('click',event=>{const next=event.target.dataset.mode;if(!next)return;mode=next;points=[];for(const button of toolbar.querySelectorAll('[data-mode]'))button.classList.toggle('active',button.dataset.mode===mode);map.getCanvas().style.cursor=mode==='browse'?'':'crosshair';render()})
document.getElementById('finish').onclick=finish
document.getElementById('undo').onclick=()=>{if(points.length)points.pop();else features.pop();render()}
function schoolMarker(school){
  if(!school||!Number.isFinite(school.longitude)||!Number.isFinite(school.latitude))return
  const button=document.createElement('button');button.className='school-marker';button.type='button';button.setAttribute('aria-label',`${school.name} · ${school.campus}`)
  const icon=document.createElement('span'),label=document.createElement('span');icon.textContent='校';label.textContent=school.name;button.append(icon,label)
  const box=document.createElement('div'),title=document.createElement('strong'),address=document.createElement('p'),link=document.createElement('a');title.textContent=`${school.name} · ${school.campus}`;address.textContent=school.address;link.textContent='学校官网位置说明';link.href=school.officialUrl;link.target='_blank';link.rel='noopener noreferrer';box.append(title,address,link)
  new Marker({element:button,anchor:'bottom'}).setLngLat([school.longitude,school.latitude]).setPopup(new Popup({offset:25}).setDOMContent(box)).addTo(map)
}
async function loadNetwork(){
  if(editing||document.hidden)return
  const version=++networkVersion
  try{
    const response=await fetch('/api/v1/maps/network',{cache:'no-store'}),payload=await response.json();if(!response.ok||payload.code!==0||version!==networkVersion)return
    const snapshot=JSON.stringify(payload.data.features);if(snapshot===networkSnapshot)return;networkSnapshot=snapshot
    for(const marker of networkMarkers)marker.remove();networkMarkers=[]
    for(const feature of payload.data.features){
      const p=feature.properties,button=document.createElement('button');button.type='button';button.className='alumni-marker';button.textContent=`${p.city} · ${p.count} 位校友`;button.setAttribute('aria-label',`${p.city}大致区域，${p.count}位公开校友`)
      const box=document.createElement('div'),title=document.createElement('strong'),description=document.createElement('p'),open=document.createElement('button');title.textContent=`${p.city} · ${p.count} 位校友`;description.textContent='按公开城市资料汇总，仅表示大致区域，不是个人实时位置。';open.textContent='查看该地区校友';open.onclick=()=>{if(parent!==window)parent.postMessage({type:'hufe-map-city-select',city:p.city},location.origin);else location.href=`/#/pages/directory/index?city=${encodeURIComponent(p.city)}`};box.append(title,description,open)
      networkMarkers.push(new Marker({element:button,anchor:'center'}).setLngLat(feature.geometry.coordinates).setPopup(new Popup({offset:24}).setDOMContent(box)).addTo(map))
    }
  }catch{status.textContent='街道底图可用，校友区域暂未加载；稍后会自动重试'}
}
document.addEventListener('visibilitychange',()=>{if(ready&&!document.hidden)loadNetwork()})
async function start(){
  const response=await fetch('/api/v1/maps/public',{cache:'no-store'}),payload=await response.json();if(!response.ok||payload.code!==0)throw new Error(payload.message||'地图服务暂不可用')
  const config=payload.data,b=config.basemap,school=config.school;if(!b)throw new Error('尚未安装可用本地底图，请管理员在地图管理中上传并发布')
  const protocol=new window.pmtiles.Protocol();addProtocol('pmtiles',protocol.tile)
  const lon=Number(params.get('lon')),lat=Number(params.get('lat')),requested=params.has('lon')&&params.has('lat'),inside=requested&&Number.isFinite(lon)&&Number.isFinite(lat)&&lon>=b.bounds[0]&&lon<=b.bounds[2]&&lat>=b.bounds[1]&&lat<=b.bounds[3]
  const layers=window.basemaps.layers('local',window.basemaps.namedFlavor('light'),{lang:'zh'})
  const copyright=String(b.attribution||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
  for(const layer of layers)if(layer.layout?.['text-font'])layer.layout['text-font']=['Noto Sans Regular']
  const schoolInside=school&&school.longitude>=b.bounds[0]&&school.longitude<=b.bounds[2]&&school.latitude>=b.bounds[1]&&school.latitude<=b.bounds[3]
  map=new Map({container:'map',style:{version:8,glyphs:`${location.origin}/api/v1/maps/viewer/fonts/{fontstack}/{range}.pbf`,sprite:`${location.origin}/api/v1/maps/viewer/vendor/light`,sources:{local:{type:'vector',url:`pmtiles://${location.origin}${b.url}`,attribution:`${copyright} · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">数据许可</a>`}},layers},center:inside?[lon,lat]:schoolInside?[school.longitude,school.latitude]:[(b.bounds[0]+b.bounds[2])/2,(b.bounds[1]+b.bounds[3])/2],zoom:inside?12:schoolInside?(window.innerWidth<600?10.5:12):9,maxZoom:19,maxBounds:[[b.bounds[0],b.bounds[1]],[b.bounds[2],b.bounds[3]]],localIdeographFontFamily:'PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif',attributionControl:{compact:true}})
  map.addControl(new NavigationControl(),'top-right');map.addControl(new ScaleControl(),'bottom-left')
  map.on('error',event=>{status.textContent=`地图资源加载失败：${event.error?.message||'请重试'}`;status.classList.add('error')})
  map.on('load',async()=>{ready=true;status.textContent=`${b.name}${requested&&!inside?'；所选城市尚未安装底图，当前显示已安装范围':''}`;toolbar.hidden=!editing
    for(const layer of config.layers){try{const r=await fetch(layer.url,{cache:'no-store'});if(!r.ok)throw new Error('图层不可用');addGeojson(`published-${layer.id}`,await r.json())}catch{status.textContent='部分已发布图层加载失败，请重新加载'}}
    addGeojson('editing',empty(),true);addGeojson('drawing',empty(),true);render(false);if(schoolInside)schoolMarker(school);if(!editing){loadNetwork();setInterval(loadNetwork,60000)}if(editing&&parent!==window)parent.postMessage({type:'hufe-map-ready'},location.origin)
  })
  map.on('click',event=>{if(!editing||mode==='browse')return;const p=[Number(event.lngLat.lng.toFixed(7)),Number(event.lngLat.lat.toFixed(7))];if(mode==='Point')addGeometry('Point',p);else{points.push(p);render()}})
}
start().catch(error=>{status.textContent=error.message;status.classList.add('error')})
