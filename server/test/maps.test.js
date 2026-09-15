import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import Fastify from 'fastify'
import {JsonDatabase} from '../src/storage/json-database.js'
import {MapService,MAP_CHUNK_SIZE} from '../src/maps/service.js'
import {inspectPmtiles,parseByteRange} from '../src/maps/pmtiles.js'
import {validateGeojson} from '../src/maps/geojson.js'
import {registerMapRoutes} from '../src/maps/routes.js'
import {RegionService} from '../src/regions/service.js'

const actor={id:'test-admin'},member={id:'test-member'},meta={actor:actor.id,ip:'192.0.2.20'}
const sha=buffer=>createHash('sha256').update(buffer).digest('hex')
function fixture(size=4096){const data=Buffer.alloc(size),metadata=Buffer.from(JSON.stringify({vector_layers:['earth','water','roads','places'].map(id=>({id,fields:{}}))}));data.write('PMTiles');data[7]=3;for(const [offset,value] of [[8,127],[16,5],[24,132],[32,metadata.length],[40,132+metadata.length],[48,0],[56,132+metadata.length],[64,size-132-metadata.length],[72,1],[80,1],[88,1]])data.writeBigUInt64LE(BigInt(value),offset);data[96]=1;data[97]=1;data[98]=1;data[99]=1;data[100]=0;data[101]=15;[111.85,27.84,114.28,28.97].forEach((v,i)=>data.writeInt32LE(Math.round(v*1e7),102+4*i));Buffer.from([1,0,1,1,1]).copy(data,127);metadata.copy(data,132);return data}
async function setup(t,{builtin=false}={}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-maps-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const config={dataFile:path.join(root,'data.json')},db=await new JsonDatabase(config.dataFile).init();await db.transaction(s=>{s.accounts=[{...actor,status:'active',isAdmin:true},{...member,status:'active',isAdmin:false}]});const service=await new MapService(db,config,builtin?{}:{builtinDirectory:path.join(root,'no-builtin')}).init();return {root,db,config,service}}
async function uploaded(service,buffer){const u=await service.createUpload(actor,{name:'隔离测试底图',source:'https://example.org/authorized.pmtiles',attribution:'Synthetic QA',license:'CC0',licenseConfirmed:true,size:buffer.length,sha256:sha(buffer)},meta);for(let i=0;i<Math.ceil(buffer.length/MAP_CHUNK_SIZE);i++)await service.chunk(u.id,i,{contentBase64:buffer.subarray(i*MAP_CHUNK_SIZE,(i+1)*MAP_CHUNK_SIZE).toString('base64')},actor);return {u,row:await service.completeUpload(u.id,actor,meta)}}

test('真实长沙内置包SHA、索引、范围通过；首次注册且不覆盖管理员地图配置',async t=>{const {service,db,config}=await setup(t,{builtin:true});const current=service.publicConfig();assert.equal(current.basemap.sha256,'835f661a0aee1d8c74a093b6a9a5e81a0ad85d83a64187c685868bdabe2f0972');assert.deepEqual(current.basemap.bounds,[111.85,27.84,114.28,28.97]);assert.equal(current.basemap.maxZoom,15);assert.equal(current.revision,1);await db.transaction(s=>{s.mapCatalog.activeBasemapId='';s.mapCatalog.revision=8});await new MapService(db,config).init();assert.equal(service.publicConfig().basemap,null);assert.equal(service.catalog().revision,8);assert.equal(db.read(s=>s.accounts.length),2)})

test('PMTiles拒绝截断、错误SHA、栅格格式、重叠分区；Range严格校验',async t=>{const {root}=await setup(t),file=path.join(root,'sample.pmtiles'),data=fixture();await fs.writeFile(file,data);assert.equal((await inspectPmtiles(file)).size,data.length);await assert.rejects(()=>inspectPmtiles(file,{expectedSha:'0'.repeat(64)}),/SHA256/);for(const mutate of [b=>{b[7]=2},b=>{b[99]=2},b=>{b.writeBigUInt64LE(999999n,32)},b=>{b.writeBigUInt64LE(127n,24)}]){const modified=Buffer.from(data);mutate(modified);await fs.writeFile(file,modified);await assert.rejects(()=>inspectPmtiles(file))}assert.deepEqual(parseByteRange('bytes=0-126',4096),{start:0,end:126});assert.deepEqual(parseByteRange('bytes=-127',4096),{start:3969,end:4095});for(const value of ['bytes=0-1,3-4','bytes=4096-','bytes=2-1','bytes=-0','bad','bytes=-'])assert.throws(()=>parseByteRange(value,4096),e=>e.statusCode===416)})

test('点线面校验拒绝非法坐标/非闭合面/过多要素，并清除额外属性',()=>{const fc={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'活动点',secret:'not-for-public'},geometry:{type:'Point',coordinates:[112.97,28.19]}}]};assert.equal(validateGeojson(fc).features[0].properties.secret,undefined);for(const coordinates of [[181,28],[112,90],[112,28,300],['112',28]])assert.throws(()=>validateGeojson({...fc,features:[{...fc.features[0],geometry:{type:'Point',coordinates}}]}));assert.throws(()=>validateGeojson({...fc,features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[1,2],[2,3],[4,5],[9,9]]]}}]}));assert.throws(()=>validateGeojson({...fc,features:Array(1001).fill(fc.features[0])}))})

test('图层草稿不公开、发布持久化、草稿修改不改线上、乐观冲突拒绝；下架删除与审计',async t=>{const {service,db,config}=await setup(t),geojson={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'原名'},geometry:{type:'Point',coordinates:[112.97,28.19]}}]};const row=await service.saveLayer({name:'测试图层',geojson,expectedRevision:0},actor,meta);assert.equal(service.publicConfig().layers.length,0);await assert.rejects(()=>service.layer(row.id),e=>e.statusCode===404);await service.layerAction(row.id,{action:'publish',expectedRevision:1},actor,meta);assert.equal((await service.layer(row.id)).features[0].properties.name,'原名');geojson.features[0].properties.name='草稿新名';await service.saveLayer({id:row.id,name:'测试图层',geojson,expectedRevision:2},actor,meta);assert.equal((await service.layer(row.id)).features[0].properties.name,'原名');assert.equal((await service.layer(row.id,{actor})).features[0].properties.name,'草稿新名');await assert.rejects(()=>service.layerAction(row.id,{action:'publish',expectedRevision:1},actor,meta),e=>e.statusCode===409);const reloaded=new MapService(await new JsonDatabase(config.dataFile).init(),config);assert.equal((await reloaded.layer(row.id)).features[0].properties.name,'原名');await service.layerAction(row.id,{action:'unpublish',expectedRevision:3},actor,meta);await assert.rejects(()=>service.layer(row.id));assert.equal(db.read(s=>s.auditLogs[0].ip),'192.0.2.20');await service.layerAction(row.id,{action:'delete',expectedRevision:4},actor,meta);await assert.rejects(()=>service.layer(row.id,{actor}))})

test('分片上传真实落盘、断点重复幂等、重启继续、完整SHA再校验、发布切换保留旧版',async t=>{const {service,db,config}=await setup(t),buffer=fixture(MAP_CHUNK_SIZE+4096),u=await service.createUpload(actor,{name:'分片测试',source:'https://example.org/map.pmtiles',attribution:'QA',license:'CC0',licenseConfirmed:true,size:buffer.length,sha256:sha(buffer)},meta);const contentBase64=buffer.subarray(0,MAP_CHUNK_SIZE).toString('base64');await service.chunk(u.id,0,{contentBase64},actor);await service.chunk(u.id,0,{contentBase64},actor);const changed=Buffer.from(buffer.subarray(0,MAP_CHUNK_SIZE));changed[500]++;await assert.rejects(()=>service.chunk(u.id,0,{contentBase64:changed.toString('base64')},actor),e=>e.statusCode===409);await assert.rejects(()=>service.completeUpload(u.id,actor,meta));const resumed=new MapService(db,config);assert.deepEqual(resumed.publicUpload(resumed.upload(u.id,actor)).chunks,[0]);await resumed.chunk(u.id,1,{contentBase64:buffer.subarray(MAP_CHUNK_SIZE).toString('base64')},actor);const row=await resumed.completeUpload(u.id,actor,meta);assert.equal(row.sha256,sha(buffer));assert.equal((await resumed.completeUpload(u.id,actor,meta)).id,row.id);assert.throws(()=>resumed.basemap(row.id),e=>e.statusCode===404);await resumed.publishBasemap(row.id,{expectedRevision:1},actor,meta);assert.equal(resumed.publicConfig().basemap.id,row.id);const second=await uploaded(resumed,fixture());await resumed.publishBasemap(second.row.id,{expectedRevision:3},actor,meta);assert.ok(resumed.basemap(row.id));assert.equal(resumed.publicConfig().basemap.id,second.row.id);assert.equal((await fs.stat(resumed.basemap(row.id).file)).size,buffer.length)})

test('仅超级管理员上传/发布，取消清理分片，账号权限撤销后拒绝继续',async t=>{const {service,db}=await setup(t),buffer=fixture(),input={name:'测试',source:'https://example.org/map.pmtiles',attribution:'QA',license:'CC0',licenseConfirmed:true,size:buffer.length,sha256:sha(buffer)};await assert.rejects(()=>service.createUpload(member,input,meta),e=>e.statusCode===403);await assert.rejects(()=>service.createUpload(actor,{...input,licenseConfirmed:false},meta));const u=await service.createUpload(actor,input,meta);await service.chunk(u.id,0,{contentBase64:buffer.toString('base64')},actor);await service.cancelUpload(u.id,actor,meta);await assert.rejects(()=>fs.stat(path.join(service.root,'uploads',u.id)),{code:'ENOENT'});const next=await service.createUpload(actor,input,meta);await db.transaction(s=>{s.accounts[0].isAdmin=false});await assert.rejects(()=>service.chunk(next.id,0,{contentBase64:buffer.toString('base64')},actor),e=>e.statusCode===403);assert.throws(()=>service.adminConfig(actor),e=>e.statusCode===403)})

test('委派管理员即使脏数据isAdmin为真也不能管理地图',async t=>{const {service,db}=await setup(t);for(const field of ['role','adminRole']){await db.transaction(s=>{s.accounts[0]={...actor,status:'active',isAdmin:true,[field]:'delegated_admin'}});assert.throws(()=>service.adminConfig(actor),e=>e.statusCode===403);await assert.rejects(()=>service.saveLayer({name:'越权',geojson:{type:'FeatureCollection',features:[]},expectedRevision:0},actor,meta),e=>e.statusCode===403)}})

test('HTTP地图资源同源、Range206、更新不缓存旧界面、草稿404与权限边界',async t=>{
  const {db,config}=await setup(t),app=Fastify()
  t.after(()=>app.close())
  app.decorate('services',{business:{directoryCityStats:()=>({items:[],revision:0})},regions:await new RegionService(db,config).init()})
  app.setErrorHandler((e,q,r)=>r.code(e.statusCode||500).send({code:e.code,message:e.message}))
  const maps=await registerMapRoutes(app,{database:db,config,data:data=>({code:0,data}),requestMeta:()=>meta,requireSuperAdmin:request=>{
    if(request.headers.authorization!=='Bearer qa-admin')throw Object.assign(new Error('请登录'),{statusCode:401})
    return actor
  }})
  const json=(await app.inject('/api/v1/maps/public')).json()
  assert.equal(json.code,0)
  assert.equal(json.data.basemap.id,'changsha-v1')
  const range=await app.inject({url:'/api/v1/maps/basemaps/changsha-v1/content',headers:{range:'bytes=0-126'}})
  assert.equal(range.statusCode,206)
  assert.equal(range.rawPayload.length,127)
  assert.match(range.headers['content-range'],/^bytes 0-126\//)
  assert.equal(range.rawPayload.subarray(0,7).toString(),'PMTiles')
  assert.equal(range.headers['cache-control'],'public,max-age=86400,immutable')
  assert.equal((await app.inject('/api/v1/admin/maps')).statusCode,401)
  const viewer=await app.inject('/api/v1/maps/viewer/index.html')
  assert.equal(viewer.statusCode,200)
  assert.doesNotMatch(viewer.body,/https?:\/\//)
  assert.equal(viewer.headers['cache-control'],'no-cache')
  for(const asset of ['viewer.js','viewer.css','vendor/maplibre-gl.mjs','vendor/maplibre-gl-shared.mjs','vendor/maplibre-gl-worker.mjs','vendor/pmtiles.js','vendor/basemaps.js','vendor/light.png','fonts/Noto%20Sans%20Regular/0-255.pbf']){
    const response=await app.inject('/api/v1/maps/viewer/'+asset)
    assert.equal(response.statusCode,200,asset)
    assert.equal(response.headers['cache-control'],'no-cache',asset)
  }
  const style=await app.inject('/api/v1/maps/viewer/vendor/maplibre-gl.mjs')
  assert.match(style.headers['content-type'],/javascript/)
  const newMap=await uploaded(maps,fixture())
  assert.equal((await app.inject(`/api/v1/maps/basemaps/${newMap.row.id}/content`)).statusCode,404)
  const row=await maps.saveLayer({name:'私密草稿',geojson:{type:'FeatureCollection',features:[]},expectedRevision:2},actor,meta)
  assert.equal((await app.inject(`/api/v1/maps/layers/${row.id}/content`)).statusCode,404)
  for(const p of ['/api/v1/maps/viewer/%2e%2e/service.js','/api/v1/maps/viewer/%252e%252e/service.js','/api/v1/maps/viewer/vendor/nope.json'])assert.notEqual((await app.inject(p)).statusCode,200)
})
