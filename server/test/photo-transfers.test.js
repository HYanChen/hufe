import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import {ImageTransfers,MAX_PHOTO_BYTES,PHOTO_CHUNK_BYTES,uploadedImage} from '../src/media/transfers.js'
import {MediaService} from '../src/media/service.js'
import {buildApp} from '../src/app.js'
import {createConfig} from '../src/config.js'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')
const meta={target:'/api/v1/admin/media',mimeType:'image/png',filename:'验收.png'}
async function transferFixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-photo-'));const config={mediaDir:path.join(dir,'media')};let transfers=await new ImageTransfers(config).init();t.after(async()=>{await transfers.close();await fs.rm(dir,{recursive:true,force:true})});return {config,get transfers(){return transfers},restart:async()=>{await transfers.close();transfers=await new ImageTransfers(config).init();return transfers}}}

test('500MiB实际分片合并、重启续传和流式落盘；超过上限拒绝',async t=>{
  const f=await transferFixture(t);let service=f.transfers
  await assert.rejects(()=>service.start('owner',{...meta,size:MAX_PHOTO_BYTES+1}),e=>e.statusCode===413)
  const below=await service.start('owner',{...meta,size:MAX_PHOTO_BYTES-1});await service.cancel(below.id,'owner')
  const upload=await service.start('owner',{...meta,size:MAX_PHOTO_BYTES});assert.equal(upload.parts,125)
  // A valid small PNG with trailing transport padding exercises byte limits without
  // decoding a 500MiB image in memory. This is a transport, not visual-decode test.
  const sum=createHash('sha256'),part=Buffer.alloc(PHOTO_CHUNK_BYTES,0)
  for(let i=0;i<upload.parts;i++){
    part.fill(0);if(i===0)png.copy(part);sum.update(part)
    await service.part(upload.id,'owner',i,part)
    if(i===62){service=await f.restart();assert.equal(service.view(service.row(upload.id)).received.length,63)}
  }
  await service.complete(upload.id,'owner');const body={filename:'500MiB.png',uploadId:upload.id}
  const claim=await service.claim(upload.id,'owner',meta.target,'POST',body)
  const media=await new MediaService(f.config,{transaction:async fn=>fn({auditLogs:[]})}).init()
  const saved=await media.save({[uploadedImage]:claim.image},{actor:'owner'})
  assert.equal(saved.size,MAX_PHOTO_BYTES)
  const output=await media.read(saved.url.split('/').at(-1)),actual=createHash('sha256');for await(const b of output.buffer)actual.update(b)
  assert.equal(actual.digest('hex'),sum.digest('hex'))
  await service.finish(upload.id,201,JSON.stringify({data:saved}))
  assert.equal((await service.claim(upload.id,'owner',meta.target,'POST',body)).result.data.url,saved.url)
  await assert.rejects(()=>service.claim(upload.id,'owner',meta.target,'POST',{...body,filename:'changed.png'}),e=>e.code==='IMAGE_BIND_CONFLICT')
})

test('分片越权、用途、缺片、重复不一致、格式、提交并发和失败隔离',async t=>{
  const {transfers:s}=await transferFixture(t)
  const a=await s.start('a',{...meta,size:png.length})
  await assert.rejects(()=>s.part(a.id,'b',0,png),e=>e.statusCode===403)
  await assert.rejects(()=>s.complete(a.id,'a'),e=>e.code==='IMAGE_PARTS_MISSING')
  await s.part(a.id,'a',0,png);await s.part(a.id,'a',0,png)
  await assert.rejects(()=>s.part(a.id,'a',0,Buffer.alloc(png.length)),e=>e.code==='IMAGE_CHUNK_CONFLICT')
  await s.complete(a.id,'a')
  await assert.rejects(()=>s.claim(a.id,'a','/other','POST'),e=>e.statusCode===403)
  await s.claim(a.id,'a',meta.target,'POST')
  await assert.rejects(()=>s.claim(a.id,'a',meta.target,'POST'),e=>e.code==='IMAGE_BIND_BUSY')
  await s.finish(a.id,400,'{}');await s.claim(a.id,'a',meta.target,'POST')
  await s.finish(a.id,500,'{}')
  await assert.rejects(()=>s.claim(a.id,'a',meta.target,'POST'),e=>e.code==='IMAGE_BIND_BUSY')
  const bad=await s.start('a',{...meta,size:png.length,mimeType:'image/jpeg'});await s.part(bad.id,'a',0,png)
  await assert.rejects(()=>s.complete(bad.id,'a'),e=>e.code==='MEDIA_SIGNATURE_MISMATCH');await s.cancel(bad.id,'a')
})

async function apiFixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-photo-api-'))
  const contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({}),list:()=>({items:[]})}
  const app=await buildApp({config:createConfig({env:'test',dataFile:path.join(dir,'data.json'),mediaDir:path.join(dir,'media'),dataHashSecret:'photo-qa-secret'}),contentService,logger:false,refreshContent:false,scheduleContent:false})
  t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true})})
  const users={},headers={}
  for(const name of ['admin','person','other']){
    users[name]=await app.services.accounts.register({schoolSubject:'photo-'+name,name:'测试'+name,personType:'alumni',isAdmin:name==='admin',verificationSource:'school-registration-check'},{username:'photo_'+name,password:'Photo-Testing!2026'})
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'photo_'+name,password:'Photo-Testing!2026'}});headers[name]={authorization:'Bearer '+login.json().data.accessToken}
  }
  const org=randomUUID();await app.services.database.transaction(d=>d.business.resources.organizations.push({id:org,name:'照片验收组织',status:'published'}))
  return {app,users,headers,org}
}

test('API贯通后台图片、实名发帖、组织相册、企业材料和表情包；不允许跨用户或篡改用途',async t=>{
  const {app,headers,org,users}=await apiFixture(t)
  const bytes=Buffer.alloc(3*1024*1024);png.copy(bytes)
  const album=(await app.inject({method:'POST',url:`/api/v1/business/organizations/${org}/albums`,headers:headers.person,payload:{title:'分片相册'}})).json().data
  const targets=[['admin','/api/v1/admin/media',{}],['person','/api/v1/business/community-media',{}],['person',`/api/v1/business/organizations/${org}/albums/${album.id}/photos`,{caption:'合影',clientRequestId:randomUUID()}],['person','/api/v1/business/enterprise-certifications/materials',{materialType:'business_license'}],['admin','/api/v1/admin/chat-stickers',{name:'分片表情',category:'测试',status:'active',sortOrder:0}]]
  for(const [who,target,extra] of targets){
    const started=await app.inject({method:'POST',url:'/api/v1/image-uploads',headers:headers[who],payload:{...meta,target,size:bytes.length}})
    assert.equal(started.statusCode,200,started.body);const id=started.json().data.id
    assert.equal((await app.inject({url:'/api/v1/image-uploads/'+id,headers:headers.other})).statusCode,403)
    const put=await app.inject({method:'PUT',url:`/api/v1/image-uploads/${id}/chunks/0`,headers:{...headers[who],'content-type':'application/octet-stream'},payload:bytes});assert.equal(put.statusCode,200,put.body)
    assert.equal((await app.inject({method:'POST',url:`/api/v1/image-uploads/${id}/complete`,headers:headers[who],payload:{}})).statusCode,200)
    const payload={filename:'分片.png',mimeType:'image/png',uploadId:id,...extra}
    const saved=await app.inject({method:'POST',url:target,headers:headers[who],payload});assert.ok(saved.statusCode>=200&&saved.statusCode<300,saved.body)
    const replay=await app.inject({method:'POST',url:target,headers:headers[who],payload});assert.equal(replay.statusCode,saved.statusCode,replay.body);assert.deepEqual(replay.json(),saved.json())
  }
  assert.equal((await app.inject({method:'POST',url:'/api/v1/image-uploads',payload:{...meta,size:10}})).statusCode,401)
  assert.equal((await app.inject({method:'POST',url:'/api/v1/image-uploads',headers:headers.person,payload:{...meta,size:10}})).statusCode,403)
  const start=(await app.inject({method:'POST',url:'/api/v1/image-uploads',headers:headers.person,payload:{...meta,target:'/api/v1/business/community-media',size:10}})).json().data
  await app.services.database.transaction(d=>{d.accounts.find(a=>a.id===users.person.id).status='disabled'})
  assert.equal((await app.inject({url:'/api/v1/image-uploads/'+start.id,headers:headers.person})).statusCode,401)
})
