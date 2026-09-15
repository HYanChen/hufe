import Fastify from '../server/node_modules/fastify/fastify.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {JsonDatabase} from '../server/src/storage/json-database.js'
import {registerMapRoutes} from '../server/src/maps/routes.js'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-map-browser-qa-')),database=await new JsonDatabase(path.join(root,'data.json')).init()
const app=Fastify({logger:false})
await registerMapRoutes(app,{database,config:{dataFile:database.file},requireSuperAdmin(){throw Object.assign(new Error('QA viewer only'),{statusCode:403})},requestMeta:()=>({}),data:data=>({code:0,data})})
await app.listen({host:'127.0.0.1',port:4899})
console.log('Isolated local map QA: http://127.0.0.1:4899/api/v1/maps/viewer/index.html?lon=112.97087&lat=28.19874')
async function close(){await app.close();await fs.rm(root,{recursive:true,force:true});process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
