import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {auditRecord} from '../audit/metadata.js'
import {inspectPmtiles,mapError} from './pmtiles.js'
import {validateGeojson} from './geojson.js'

export const MAP_CHUNK_SIZE=4*1024*1024
const builtinRoot=fileURLToPath(new URL('./builtin/',import.meta.url))
const emptyCatalog=()=>({revision:0,activeBasemapId:'',basemaps:[],layers:[],uploads:[]})
const safeId=id=>{if(!/^[a-z0-9-]{8,80}$/.test(String(id)))throw mapError('地图记录不存在',404);return id}
const clean=(value,max=200)=>String(value||'').trim().replace(/[\u0000-\u001f]/g,'').slice(0,max)
const publicBasemap=row=>{if(!row)return null;const {id,name,source,attribution,license,size,sha256,bounds,minZoom,maxZoom,format,createdAt,publishedAt}=row;return {id,name,source,attribution,license,size,sha256,bounds,minZoom,maxZoom,format,createdAt,publishedAt,url:`/api/v1/maps/basemaps/${id}/content`}}
export class MapService{
  constructor(database,config,{builtinDirectory=builtinRoot}={}){this.database=database;this.root=path.join(path.dirname(config.dataFile),'maps');this.builtinDirectory=builtinDirectory;this.locks=new Set()}
  catalog(){return this.database.read(s=>s.mapCatalog||emptyCatalog())}
  guard(state,actor){if(!state.accounts.some(a=>a.id===actor?.id&&a.status==='active'&&a.isAdmin&&a.role!=='delegated_admin'&&a.adminRole!=='delegated_admin'&&!a.mustChangePassword))throw mapError('仅有效超级管理员可管理地图',403)}
  async init(){
    for(const dir of ['basemaps','layers','uploads'])await fs.mkdir(path.join(this.root,dir),{recursive:true})
    if(this.database.read(s=>Boolean(s.mapCatalog)))return this
    let manifest;try{manifest=JSON.parse(await fs.readFile(path.join(this.builtinDirectory,'manifest.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return this;throw error}
    if(manifest.id!=='changsha-v1'||manifest.file!=='changsha-v1.pmtiles'||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw mapError('内置地图清单不正确')
    const info=await inspectPmtiles(path.join(this.builtinDirectory,manifest.file),{expectedSha:manifest.sha256})
    await this.database.transaction(state=>{if(state.mapCatalog)return;const now=new Date().toISOString();state.mapCatalog={...emptyCatalog(),revision:1,activeBasemapId:manifest.id,basemaps:[{...manifest,...info,builtin:true,createdAt:now,publishedAt:now}]};state.auditLogs.unshift(auditRecord('maps.builtin_installed',manifest.id,{}, {sha256:info.sha256,bounds:info.bounds,source:manifest.source}))})
    return this
  }
  publicConfig(){const c=this.catalog();return {revision:c.revision,basemap:publicBasemap(c.basemaps.find(r=>r.id===c.activeBasemapId)),layers:c.layers.filter(l=>l.published&&!l.deleted).map(l=>({id:l.id,name:l.published.name||l.name,version:l.published.version,url:`/api/v1/maps/layers/${l.id}/content?v=${l.published.version}`})),notice:'当前内置长沙及周边真实街道底图，其他范围由管理员上传后启用。地图不展示个人精确位置。'}}
  adminConfig(actor){this.database.read(s=>this.guard(s,actor));const c=this.catalog();return {...c,basemaps:c.basemaps.map(publicBasemap),layers:c.layers.filter(l=>!l.deleted).map(({draft,published,...row})=>({...row,draftVersion:draft.version,publishedVersion:published?.version||0})),uploads:c.uploads.filter(u=>u.actorId===actor.id&&u.status!=='cancelled').map(u=>this.publicUpload(u)),chunkSize:MAP_CHUNK_SIZE,maxFileSize:20*1024**3}}
  publicUpload(u){return {id:u.id,name:u.name,size:u.size,status:u.status,chunks:u.chunks.map(c=>c.index),totalChunks:Math.ceil(u.size/MAP_CHUNK_SIZE),resultId:u.resultId||'',createdAt:u.createdAt}}
  async locked(id,run){if(this.locks.has(id))throw mapError('此地图任务正在处理，请稍候',409);this.locks.add(id);try{return await run()}finally{this.locks.delete(id)}}
  revision(c,input){if(!Number.isInteger(input.expectedRevision)||input.expectedRevision!==c.revision)throw mapError('地图数据已有更新，请刷新后重新操作',409)}
  async mutate(actor,input,metadata,action,run){return this.database.transaction(state=>{this.guard(state,actor);const c=state.mapCatalog ||=emptyCatalog();this.revision(c,input);const result=run(c);c.revision++;state.auditLogs.unshift(auditRecord(action,result?.id||'',metadata,{revision:c.revision}));return result})}
  async createUpload(actor,input,metadata){
    const name=clean(input.name,100),source=clean(input.source,500),attribution=clean(input.attribution,500),license=clean(input.license,200),size=Number(input.size),sha256=String(input.sha256||'').toLowerCase()
    if(!name||!/^https:\/\/[^\s<>]+$/.test(source)||!attribution||!license||input.licenseConfirmed!==true)throw mapError('请填写名称、HTTPS来源、版权署名及许可，并确认有自托管权利')
    if(!Number.isSafeInteger(size)||size<127||size>20*1024**3||!/^[a-f0-9]{64}$/.test(sha256))throw mapError('请选择20GB以内PMTiles文件并填写来源方或本地计算的SHA256')
    const upload={id:randomUUID(),actorId:actor.id,name,source,attribution,license,size,sha256,status:'uploading',chunks:[],createdAt:new Date().toISOString()}
    await this.database.transaction(async state=>{this.guard(state,actor);const c=state.mapCatalog ||=emptyCatalog();const pending=c.uploads.filter(u=>u.status==='uploading');if(pending.length>=2||pending.some(u=>u.actorId===actor.id))throw mapError('请先完成或取消现有地图上传任务',409);const stat=await fs.statfs(this.root);if(stat.bavail*stat.bsize<2*(size+pending.reduce((sum,u)=>sum+u.size,0))+1024**3)throw mapError('服务器剩余空间不足，须预留地图大小两倍及1GB安全空间',507);await fs.mkdir(path.join(this.root,'uploads',upload.id),{recursive:false});c.uploads.push(upload);state.auditLogs.unshift(auditRecord('maps.upload_started',upload.id,metadata,{size,name,source,sha256}))})
    return this.publicUpload(upload)
  }
  upload(id,actor){safeId(id);this.database.read(s=>this.guard(s,actor));const u=this.catalog().uploads.find(u=>u.id===id&&u.actorId===actor.id);if(!u)throw mapError('地图上传任务不存在',404);return u}
  async chunk(id,index,input,actor){return this.locked(id,async()=>{
    const u=this.upload(id,actor);index=Number(index)
    if(u.status!=='uploading'||!Number.isInteger(index)||index<0||index>=Math.ceil(u.size/MAP_CHUNK_SIZE))throw mapError('上传分片序号或任务状态不正确')
    const raw=input?.contentBase64;if(typeof raw!=='string'||raw.length>Math.ceil(MAP_CHUNK_SIZE/3)*4||raw.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))throw mapError('上传分片编码错误')
    const buffer=Buffer.from(raw,'base64'),expected=Math.min(MAP_CHUNK_SIZE,u.size-index*MAP_CHUNK_SIZE);if(buffer.length!==expected)throw mapError('上传分片长度不匹配')
    const hash=createHash('sha256').update(buffer).digest('hex'),existing=u.chunks.find(c=>c.index===index)
    if(existing){if(existing.sha256!==hash)throw mapError('重复分片内容不一致，请取消后重新上传',409);return this.publicUpload(u)}
    const file=path.join(this.root,'uploads',u.id,`${index}.part`),temp=`${file}.tmp`;await fs.writeFile(temp,buffer,{flag:'w',mode:0o600});await fs.rename(temp,file)
    await this.database.transaction(state=>{this.guard(state,actor);const live=state.mapCatalog.uploads.find(x=>x.id===id);if(live.status!=='uploading')throw mapError('上传任务已经结束',409);live.chunks.push({index,sha256:hash})})
    return this.publicUpload(this.upload(id,actor))
  })}
  async completeUpload(id,actor,metadata){return this.locked(id,async()=>{
    const u=this.upload(id,actor);if(u.status==='complete')return publicBasemap(this.catalog().basemaps.find(r=>r.id===u.resultId))
    const total=Math.ceil(u.size/MAP_CHUNK_SIZE);if(u.status!=='uploading'||u.chunks.length!==total)throw mapError('分片尚未全部上传')
    const temp=path.join(this.root,'basemaps',`${u.id}.pending`),handle=await fs.open(temp,'w',0o600)
    try{for(let i=0;i<total;i++){const buffer=await fs.readFile(path.join(this.root,'uploads',u.id,`${i}.part`));if(buffer.length!==Math.min(MAP_CHUNK_SIZE,u.size-i*MAP_CHUNK_SIZE)||createHash('sha256').update(buffer).digest('hex')!==u.chunks.find(c=>c.index===i)?.sha256)throw mapError('服务器分片校验失败，请重新上传');await handle.write(buffer)}}catch(error){await handle.close();await fs.rm(temp,{force:true});throw error}await handle.close()
    let info;try{info=await inspectPmtiles(temp,{expectedSha:u.sha256})}catch(error){await fs.rm(temp,{force:true});throw error}
    const file=`${u.id}.pmtiles`;await fs.rename(temp,path.join(this.root,'basemaps',file))
    const row={...info,id:u.id,file,name:u.name,source:u.source,attribution:u.attribution,license:u.license,createdAt:new Date().toISOString(),publishedAt:''}
    await this.database.transaction(state=>{this.guard(state,actor);const live=state.mapCatalog.uploads.find(x=>x.id===id);if(live.status!=='uploading')throw mapError('上传任务已经结束',409);live.status='complete';live.resultId=row.id;state.mapCatalog.basemaps.push(row);state.mapCatalog.revision++;state.auditLogs.unshift(auditRecord('maps.basemap_uploaded',row.id,metadata,{sha256:row.sha256,size:row.size,name:row.name}))})
    await fs.rm(path.join(this.root,'uploads',id),{recursive:true,force:true});return publicBasemap(row)
  })}
  async cancelUpload(id,actor,metadata){return this.locked(id,async()=>{const u=this.upload(id,actor);if(u.status==='complete')throw mapError('已完成的底图不能作为上传任务取消');await this.database.transaction(state=>{this.guard(state,actor);state.mapCatalog.uploads.find(x=>x.id===id).status='cancelled';state.auditLogs.unshift(auditRecord('maps.upload_cancelled',id,metadata))});await fs.rm(path.join(this.root,'uploads',id),{recursive:true,force:true});return {id,status:'cancelled'}})}
  async publishBasemap(id,input,actor,metadata){safeId(id);const row=this.catalog().basemaps.find(r=>r.id===id);if(!row)throw mapError('底图不存在',404);await inspectPmtiles(this.basemapFile(row),{expectedSha:row.sha256});return this.mutate(actor,input,metadata,'maps.basemap_published',c=>{const live=c.basemaps.find(r=>r.id===id);live.publishedAt ||=new Date().toISOString();c.activeBasemapId=id;return publicBasemap(live)})}
  basemapFile(row){safeId(row.id);if(!/^[a-z0-9-]+\.pmtiles$/.test(row.file))throw mapError('底图路径无效');return path.join(row.builtin?this.builtinDirectory:path.join(this.root,'basemaps'),row.file)}
  basemap(id){safeId(id);const row=this.catalog().basemaps.find(r=>r.id===id&&r.publishedAt);if(!row)throw mapError('底图尚未发布或不存在',404);return {file:this.basemapFile(row),row}}
  async saveLayer(input,actor,metadata){
    const name=clean(input.name,100);if(!name)throw mapError('请填写图层名称');const geojson=validateGeojson(input.geojson),id=input.id?safeId(input.id):randomUUID(),version=randomUUID(),file=`${id}-${version}.json`
    this.database.read(s=>this.guard(s,actor));await fs.writeFile(path.join(this.root,'layers',file),JSON.stringify(geojson),{flag:'wx',mode:0o600})
    try{return await this.mutate(actor,input,metadata,'maps.layer_saved',c=>{let row=c.layers.find(l=>l.id===id&&!l.deleted);if(input.id&&!row)throw mapError('图层不存在',404);if(!row){if(c.layers.filter(l=>!l.deleted).length>=50)throw mapError('最多维护50个图层');row={id,name,createdAt:new Date().toISOString()};c.layers.push(row)}row.name=name;row.updatedAt=new Date().toISOString();row.draft={file,version,count:geojson.features.length};return {id,version}})}catch(error){await fs.rm(path.join(this.root,'layers',file),{force:true});throw error}
  }
  async layerAction(id,input,actor,metadata){safeId(id);if(!['publish','unpublish','delete'].includes(input.action))throw mapError('图层操作不正确');return this.mutate(actor,input,metadata,`maps.layer_${input.action}`,c=>{const row=c.layers.find(l=>l.id===id&&!l.deleted);if(!row)throw mapError('图层不存在',404);if(input.action==='publish')row.published={...row.draft,name:row.name};else row.published=null;if(input.action==='delete')row.deleted=true;return {id,action:input.action}})}
  async layer(id,{actor}={}){safeId(id);if(actor)this.database.read(s=>this.guard(s,actor));const row=this.catalog().layers.find(l=>l.id===id&&!l.deleted),version=actor?row?.draft:row?.published;if(!version)throw mapError('图层不存在或尚未发布',404);if(!/^[a-z0-9-]+\.json$/.test(version.file))throw mapError('图层文件名无效');return JSON.parse(await fs.readFile(path.join(this.root,'layers',version.file),'utf8'))}
}
