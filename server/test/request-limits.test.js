import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import {requestLimitKey,rateLimitResponse} from '../src/auth/request-limits.js'

test('同IP真实账号配额隔离，读取轮询不能消耗写操作，登录依然严格按IP限频且中文429',async t=>{
  const app=Fastify();t.after(()=>app.close())
  const valid=new Map([['Bearer qa-a',{id:'account-a'}],['Bearer qa-b',{id:'account-b'}]])
  app.addHook('onRequest',async request=>{request.user=valid.get(request.headers.authorization)})
  await app.register(rateLimit,{max:2,timeWindow:'1 minute',keyGenerator:requestLimitKey,errorResponseBuilder:rateLimitResponse})
  for(const route of ['/api/v1/read-a','/api/v1/read-b'])app.get(route,()=>({ok:true}))
  app.post('/api/v1/write',()=>({ok:true}))
  app.post('/api/v1/auth/login',{config:{rateLimit:{max:2,timeWindow:'1 minute'}}},()=>({ok:true}))
  const request=(auth,method,url)=>app.inject({method,url,headers:auth?{authorization:'Bearer '+auth}: {}})
  assert.equal((await request('qa-a','GET','/api/v1/read-a')).statusCode,200)
  assert.equal((await request('qa-a','GET','/api/v1/read-b')).statusCode,200)
  const limited=await request('qa-a','GET','/api/v1/read-a')
  assert.equal(limited.statusCode,429);assert.equal(limited.json().code,'RATE_LIMITED');assert.match(limited.json().message,/秒后重试/)
  assert.equal((await request('qa-a','POST','/api/v1/write')).statusCode,200)
  assert.equal((await request('qa-b','GET','/api/v1/read-a')).statusCode,200)
  assert.equal((await request('qa-a','POST','/api/v1/auth/login')).statusCode,200)
  assert.equal((await request('qa-b','POST','/api/v1/auth/login')).statusCode,200)
  assert.equal((await request(null,'POST','/api/v1/auth/login')).statusCode,429)
})

test('路由参数不能创建无限配额，显式高频地图资源共用同一个受限桶',()=>{
  const base={ip:'192.0.2.2',user:{id:'account-a'},method:'GET',routeOptions:{url:'/api/v1/maps/viewer/*',config:{rateLimit:{max:1200}}}}
  assert.equal(requestLimitKey({...base,params:{'*':'one.js'}}),requestLimitKey({...base,params:{'*':'two.js'}}))
  const anonymous={...base,user:undefined,headers:{'x-hufe-device-id':'forged'}}
  assert.match(requestLimitKey(anonymous),/^ip:192.0.2.2:/)
})
