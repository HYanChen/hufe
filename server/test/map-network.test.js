import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {buildApp} from '../src/app.js'
import {createConfig} from '../src/config.js'
import {AlumniMapNetwork} from '../src/maps/network.js'
import {SCHOOL_CENTER} from '../src/maps/school-center.js'

test('地图区域只包含公开城市汇总，学校主校区有带来源的WGS84中心', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-map-network-'))
  t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({}),list:()=>({items:[]})}
  const app=await buildApp({config:createConfig({env:'test',dataFile:path.join(dir,'data.json'),mediaDir:path.join(dir,'media')}),logger:false,refreshContent:false,scheduleContent:false,contentService})
  t.after(()=>app.close())
  await app.services.database.transaction(state=>state.business.resources.directory.push(
    {id:'private-id-one',name:'不能出现在地图接口的人名',city:'长沙',status:'visible',address:'私密街道88号',studentIdDisplay:'99887766'},
    {id:'private-id-two',name:'另一位校友',city:'长沙',status:'visible'},
    {id:'hidden-person',city:'长沙',status:'hidden'},
    {id:'outside-basemap',city:'深圳市',status:'visible'}
  ))
  const result=await app.inject('/api/v1/maps/network')
  assert.equal(result.statusCode,200,result.body)
  assert.equal(result.headers['cache-control'],'no-store')
  const network=result.json().data
  assert.equal(network.features.length,1)
  assert.equal(network.features[0].properties.city,'长沙')
  assert.equal(network.features[0].properties.count,2)
  assert.equal(network.features[0].properties.precision,'city')
  assert.deepEqual(network.features[0].geometry.coordinates,[112.97087,28.19874])
  assert.equal(network.unmappedCities,1)
  assert.doesNotMatch(result.body,/private-id|hidden-person|不能出现在地图接口的人名|另一位校友|私密|studentId|99887766|address/)
  const config=(await app.inject('/api/v1/maps/public')).json().data
  assert.deepEqual(config.school,SCHOOL_CENTER)
  assert.equal(config.school.coordinateSystem,'WGS84')
  assert.equal(config.school.sourceUrl,'https://www.openstreetmap.org/way/1046097578')
  assert.ok(config.school.longitude>112.916&&config.school.longitude<112.924)
  await app.services.database.transaction(state=>{for(const row of state.business.resources.directory)row.status='hidden'})
  assert.equal((await app.inject('/api/v1/maps/network')).json().data.features.length,0)
})

test('地图坐标读取期间撤销公开范围，不返回过期人数或虚构位置', async () => {
  let reads=0
  const initial={items:[{city:'长沙',count:9},{city:'不存在的地区',count:1}],revision:1}
  const business={directoryCityStats:()=>++reads===1?initial:{items:[],revision:2}}
  const regions={selection:()=>{throw new Error('No region override')}}
  const maps={publicConfig:()=>({basemap:{bounds:[111.85,27.84,114.28,28.97]}})}
  const result=await new AlumniMapNetwork(business,regions,maps).locations()
  assert.deepEqual(result.features,[])
  assert.equal(result.revision,2)
})
