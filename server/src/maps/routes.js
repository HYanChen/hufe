import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {MapService,MAP_CHUNK_SIZE} from './service.js'
import {mapError,parseByteRange} from './pmtiles.js'
import {AlumniMapNetwork} from './network.js'
import {SCHOOL_CENTER} from './school-center.js'

const assets=path.resolve(fileURLToPath(new URL('./assets/',import.meta.url)))
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.pbf':'application/x-protobuf','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'}
export async function registerMapRoutes(app,{database,config,requireSuperAdmin,requestMeta,data}){
  const maps=await new MapService(database,config).init()
  const network=new AlumniMapNetwork(app.services.business,app.services.regions,maps)
  app.get('/api/v1/maps/public',async(request,reply)=>{reply.header('cache-control','no-store');return data({...maps.publicConfig(),school:SCHOOL_CENTER})})
  app.get('/api/v1/maps/network',async(request,reply)=>{reply.header('cache-control','no-store');return data(await network.locations())})
  app.get('/api/v1/maps/basemaps/:id/content',{config:{rateLimit:{max:1200,timeWindow:'1 minute'}}},async(request,reply)=>{
    const {file,row}=maps.basemap(request.params.id),stat=await fsp.stat(file)
    if(stat.size!==row.size)throw mapError('底图文件已改变，请管理员重新校验',503)
    reply.header('Accept-Ranges','bytes').header('ETag',`"${row.sha256}"`).header('cache-control','public,max-age=86400,immutable').type('application/vnd.pmtiles')
    let range;try{range=parseByteRange(request.headers.range,stat.size)}catch(error){reply.header('content-range',`bytes */${stat.size}`);throw error}
    if(range){if(range.end-range.start+1>16*1024*1024)throw mapError('单次地图范围请求最多16MB',416);reply.code(206).header('content-range',`bytes ${range.start}-${range.end}/${stat.size}`).header('content-length',range.end-range.start+1);return fs.createReadStream(file,range)}
    reply.header('content-length',stat.size);return fs.createReadStream(file)
  })
  app.get('/api/v1/maps/layers/:id/content',async(request,reply)=>{reply.header('cache-control','no-store');return maps.layer(request.params.id)})
  app.get('/api/v1/maps/viewer/*',{config:{rateLimit:{max:1200,timeWindow:'1 minute'}}},async(request,reply)=>{
    const name=request.params['*']||'index.html'
    if(name.split('/').some(part=>!part||part==='.'||part==='..')||!/^[A-Za-z0-9_ /@.%-]+$/.test(name)||!mime[path.extname(name)])throw mapError('地图资源不存在',404)
    const file=path.resolve(assets,name);if(!file.startsWith(assets+path.sep))throw mapError('地图资源不存在',404)
    let stat;try{stat=await fsp.stat(file)}catch{throw mapError('地图资源不存在',404)}if(!stat.isFile())throw mapError('地图资源不存在',404)
    // Viewer URLs are stable across deployments, so always revalidate the UI
    // and its dependencies. Versioned PMTiles keep their immutable policy.
    reply.type(mime[path.extname(name)]).header('cache-control','no-cache').header('content-length',stat.size)
    if(name.endsWith('.html'))reply.header('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
    return fs.createReadStream(file)
  })
  app.get('/api/v1/admin/maps',async(request,reply)=>{const actor=requireSuperAdmin(request);reply.header('cache-control','private,no-store');return data(maps.adminConfig(actor))})
  app.post('/api/v1/admin/maps/uploads',{bodyLimit:4096},async request=>{const actor=requireSuperAdmin(request);return data(await maps.createUpload(actor,request.body||{},requestMeta(request,actor.id)))})
  app.get('/api/v1/admin/maps/uploads/:id',async(request,reply)=>{const actor=requireSuperAdmin(request);reply.header('cache-control','private,no-store');return data(maps.publicUpload(maps.upload(request.params.id,actor)))})
  app.put('/api/v1/admin/maps/uploads/:id/chunks/:index',{bodyLimit:Math.ceil(MAP_CHUNK_SIZE/3)*4+1024,config:{rateLimit:{max:600,timeWindow:'1 minute'}}},async request=>{const actor=requireSuperAdmin(request);return data(await maps.chunk(request.params.id,request.params.index,request.body,actor))})
  app.post('/api/v1/admin/maps/uploads/:id/complete',async request=>{const actor=requireSuperAdmin(request);return data(await maps.completeUpload(request.params.id,actor,requestMeta(request,actor.id)))})
  app.delete('/api/v1/admin/maps/uploads/:id',async request=>{const actor=requireSuperAdmin(request);return data(await maps.cancelUpload(request.params.id,actor,requestMeta(request,actor.id)))})
  app.post('/api/v1/admin/maps/basemaps/:id/publish',async request=>{const actor=requireSuperAdmin(request);return data(await maps.publishBasemap(request.params.id,request.body||{},actor,requestMeta(request,actor.id)))})
  app.post('/api/v1/admin/maps/layers',{bodyLimit:4*1024*1024},async request=>{const actor=requireSuperAdmin(request);return data(await maps.saveLayer(request.body||{},actor,requestMeta(request,actor.id)))})
  app.post('/api/v1/admin/maps/layers/:id/action',async request=>{const actor=requireSuperAdmin(request);return data(await maps.layerAction(request.params.id,request.body||{},actor,requestMeta(request,actor.id)))})
  app.get('/api/v1/admin/maps/layers/:id/content',async(request,reply)=>{const actor=requireSuperAdmin(request);reply.header('cache-control','private,no-store');return data(await maps.layer(request.params.id,{actor}))})
  return maps
}
