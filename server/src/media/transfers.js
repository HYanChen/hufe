import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {openDatabase} from '../storage/database.js'
import {detectedMimeType} from './service.js'
export const MAX_PHOTO_BYTES=500*1024*1024
export const PHOTO_CHUNK_BYTES=4*1024*1024
export const uploadedImage=Symbol('validated-image-upload')
const fail=(message,code='IMAGE_UPLOAD_INVALID',statusCode=400)=>Object.assign(new Error(message),{code,statusCode})
const hash=b=>createHash('sha256').update(b).digest('hex')
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value
const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}
export class ImageTransfers{
  constructor(config){this.config=config;this.directory=path.join(config.mediaDir,'private','image-transfers');this.locks=new Map();this.claims=new Set()}
  async init(){
    await fs.mkdir(this.directory,{recursive:true,mode:0o700})
    this.db=await openDatabase(this.config,{namespace:'image-transfers',file:path.join(this.directory,'uploads.json')})
    try{await this.cleanup();this.timer=setInterval(()=>this.cleanup().catch(()=>{}),3600000);this.timer.unref();return this}
    catch(error){await this.db.close?.();throw error}
  }
  async close(){clearInterval(this.timer);await Promise.allSettled([...this.locks.values()]);await this.db.queue;await this.db.close?.()}
  lock(id,work){const p=(this.locks.get(id)||Promise.resolve()).then(work,work);this.locks.set(id,p);return p.finally(()=>{if(this.locks.get(id)===p)this.locks.delete(id)})}
  row(id){if(!/^[a-f0-9-]{36}$/.test(String(id)))throw fail('上传任务不存在','IMAGE_UPLOAD_NOT_FOUND',404);const r=this.db.read(d=>(d.imageUploads||[]).find(r=>r.id===id));if(!r||r.expiresAt<Date.now())throw fail('上传任务不存在或已过期，请重新选择图片','IMAGE_UPLOAD_NOT_FOUND',404);return r}
  owned(id,owner){const r=this.row(id);if(r.owner!==owner)throw fail('不能访问其他人的上传任务','IMAGE_UPLOAD_FORBIDDEN',403);return r}
  view(r){return {id:r.id,size:r.size,parts:r.parts,chunkSize:PHOTO_CHUNK_BYTES,received:Object.keys(r.received||{}).map(Number),state:r.state}}
  async start(owner,input){
    const {target,method='POST',size,mimeType}=input
    if(!Number.isSafeInteger(size)||size<1||size>MAX_PHOTO_BYTES)throw fail('单张图片须在500MB以内','IMAGE_TOO_LARGE',413)
    if(!extensions[mimeType])throw fail('仅支持JPEG、PNG、GIF或WebP图片')
    const id=randomUUID(),createdAt=Date.now()
    const r=await this.db.transaction(async d=>{d.imageUploads||=[];const alive=d.imageUploads.filter(r=>r.expiresAt>createdAt),own=alive.filter(r=>r.owner===owner);if(own.filter(r=>r.state!=='bound').length>=4)throw fail('同时最多上传4张图片，请先完成已有任务','IMAGE_UPLOAD_LIMIT',429);if(own.reduce((s,r)=>s+r.size,0)+size>5*1024**3||alive.reduce((s,r)=>s+r.size,0)+size>20*1024**3)throw fail('本日图片上传容量已达上限，请稍后再试','IMAGE_UPLOAD_QUOTA',429);const free=await fs.statfs(this.directory),reserved=alive.reduce((total,r)=>total+(r.state==='bound'?0:r.state==='uploading'?2*r.size-Object.keys(r.received).reduce((n,i)=>n+Math.min(PHOTO_CHUNK_BYTES,r.size-Number(i)*PHOTO_CHUNK_BYTES),0):r.size),0);if(free.bavail*free.bsize<reserved+size*2+128*1024*1024)throw fail('图片存储空间不足，请联系管理员','IMAGE_STORAGE_FULL',507);const r={id,owner,target,method,size,mimeType,filename:String(input.filename||'图片').slice(0,160),parts:Math.ceil(size/PHOTO_CHUNK_BYTES),received:{},state:'uploading',createdAt,expiresAt:createdAt+86400000};d.imageUploads.push(r);return r})
    try{await fs.mkdir(path.join(this.directory,id),{mode:0o700})}catch(error){await this.db.transaction(d=>{d.imageUploads=d.imageUploads.filter(r=>r.id!==id)});throw error}return this.view(r)
  }
  async part(id,owner,index,bytes){return this.lock(id,async()=>{const r=this.owned(id,owner);if(r.state!=='uploading')throw fail('上传任务已完成','IMAGE_UPLOAD_CLOSED',409);if(!Number.isInteger(index)||index<0||index>=r.parts||!Buffer.isBuffer(bytes)||bytes.length!==Math.min(PHOTO_CHUNK_BYTES,r.size-index*PHOTO_CHUNK_BYTES))throw fail('分片编号或长度不正确');const digest=hash(bytes);if(r.received[index]){if(r.received[index]!==digest)throw fail('重复分片内容不一致','IMAGE_CHUNK_CONFLICT',409);return this.view(r)}const filename=path.join(this.directory,id,String(index));await fs.writeFile(filename,bytes,{mode:0o600});return this.db.transaction(d=>{const current=d.imageUploads.find(x=>x.id===id);if(!current||current.state!=='uploading')throw fail('上传已结束');current.received[index]=digest;return this.view(current)})})}
  async complete(id,owner){return this.lock(id,async()=>{const r=this.owned(id,owner);if(r.state!=='uploading')return this.view(r);if(Object.keys(r.received).length!==r.parts)throw fail('图片尚未上传完整','IMAGE_PARTS_MISSING',409);const output=path.join(this.directory,id,'original');const file=await fs.open(output,'w',0o600),sum=createHash('sha256');let detected='';try{for(let i=0;i<r.parts;i++){const bytes=await fs.readFile(path.join(this.directory,id,String(i)));if(hash(bytes)!==r.received[i])throw fail('分片校验失败，请重新上传');if(i===0)detected=detectedMimeType(bytes);sum.update(bytes);let offset=0;while(offset<bytes.length){const {bytesWritten}=await file.write(bytes,offset,bytes.length-offset);if(!bytesWritten)throw fail('图片写入失败');offset+=bytesWritten}}}finally{await file.close()}if(detected!==r.mimeType){await fs.rm(output,{force:true});throw fail('图片实际格式与声明不一致','MEDIA_SIGNATURE_MISMATCH')}
    const result=await this.db.transaction(d=>{const current=d.imageUploads.find(x=>x.id===id);current.state='ready';current.hash=sum.digest('hex');return this.view(current)});for(let i=0;i<r.parts;i++)await fs.rm(path.join(this.directory,id,String(i)),{force:true});return result})}
  async claim(id,owner,target,method,body={}){return this.lock(id,async()=>{
    const r=this.owned(id,owner),fingerprint=hash(JSON.stringify(stable(body)))
    if(r.target!==target||r.method!==method)throw fail('图片上传用途与当前操作不一致','IMAGE_PURPOSE_MISMATCH',403)
    if(r.fingerprint&&r.fingerprint!==fingerprint)throw fail('重试提交内容已变化，请重新选择图片','IMAGE_BIND_CONFLICT',409)
    if(r.state==='bound')return {result:r.result,status:r.status}
    if(r.state==='binding'||this.claims.has(id))throw fail('图片正在保存或保存结果待确认，请刷新目标页面核对，勿重复提交','IMAGE_BIND_BUSY',409)
    if(r.state!=='ready')throw fail('图片尚未上传完整','IMAGE_NOT_READY',409)
    // Write intent before invoking any business handler. After a crash an uncertain
    // binding is quarantined, never automatically replayed into a second record.
    await this.db.transaction(d=>{const current=d.imageUploads.find(x=>x.id===id);current.state='binding';current.fingerprint=fingerprint})
    this.claims.add(id)
    return {image:{filePath:path.join(this.directory,id,'original'),size:r.size,mimeType:r.mimeType,extension:extensions[r.mimeType],hash:r.hash}}
  })}
  async finish(id,status,payload){try{
    if(status>=200&&status<300){await this.db.transaction(d=>{const r=d.imageUploads.find(x=>x.id===id);if(r){r.state='bound';r.status=status;r.result=typeof payload==='string'?JSON.parse(payload):payload}});await fs.rm(path.join(this.directory,id,'original'),{force:true}).catch(()=>{})}
    else if(status>=400&&status<500){await this.db.transaction(d=>{const r=d.imageUploads.find(x=>x.id===id);if(r){r.state='ready';delete r.fingerprint}})}
    // 5xx outcomes can be ambiguous; leave durable binding intent for reconciliation.
  }finally{this.claims.delete(id)}}
  async cancel(id,owner){return this.lock(id,async()=>{const r=this.owned(id,owner);if(['binding','bound'].includes(r.state)||this.claims.has(id))throw fail('已提交的图片不能取消','IMAGE_UPLOAD_CLOSED',409);await this.db.transaction(d=>{d.imageUploads=d.imageUploads.filter(x=>x.id!==id)});await fs.rm(path.join(this.directory,id),{recursive:true,force:true});return {cancelled:true}})}
  async cleanup(){const now=Date.now(),expired=this.db.read(d=>(d.imageUploads||[]).filter(r=>r.expiresAt<=now&&!this.claims.has(r.id)&&!this.locks.has(r.id)));for(const r of expired)await fs.rm(path.join(this.directory,r.id),{recursive:true,force:true});await this.db.transaction(d=>{d.imageUploads=(d.imageUploads||[]).filter(r=>!expired.some(x=>x.id===r.id))})}
}
