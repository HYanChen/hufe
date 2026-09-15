import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { trustedProxyPolicy, normalizeIp } from '../src/audit/metadata.js'
import { verifyXdb, searchXdb, GeoLocator } from '../src/audit/geo-location.js'

async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'hufe-audit-'))
  const config = createConfig({ env:'test', dataFile:path.join(dir,'data.json'), mediaDir:path.join(dir,'media'), dataHashSecret:'audit-tests-only', ...overrides })
  const content = { init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({}),list:()=>({items:[]}),get:async()=>null }
  const app = await buildApp({config,logger:false,contentService:content,scheduleContent:false})
  t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true})})
  const users = {}, headers = {}
  for (const name of ['admin','member']) {
    users[name] = await app.services.accounts.register({schoolSubject:'audit-'+name,name:name==='member'?'审计真实姓名':'审计管理员',department:'审计学院',personType:'student',isAdmin:name==='admin',verificationSource:'school-registration-check'},{username:name,password:'Secret-Audit-Pass2026!'})
    const login = await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:name,password:'Secret-Audit-Pass2026!'}})
    headers[name] = {authorization:'Bearer '+login.json().data.accessToken}
  }
  return {app,users,headers,dir}
}

test('发帖评论点赞撤回及失败请求真实关联，敏感数据不进入审计且公共端隔离',async t=>{
  const {app,users,headers,dir} = await fixture(t)
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1'
  const postResponse = await app.inject({method:'POST',url:'/api/v1/business/community-posts?secret=QuerySecretProbe',headers:{...headers.member,'user-agent':ua,'x-forwarded-for':'8.8.8.8','x-real-ip':'1.1.1.1','x-request-id':'ForgedRequestProbe','x-location':'FakeCityProbe'},payload:{content:'正文不能进入请求日志Probe',anonymous:true,password:'BodySecretProbe'}})
  assert.equal(postResponse.statusCode,201,postResponse.body); const post=postResponse.json().data
  const comment=(await app.inject({method:'POST',url:`/api/v1/business/community-posts/${post.id}/comments`,headers:headers.member,payload:{content:'匿名评论',anonymous:true}})).json().data
  assert.equal((await app.inject({method:'POST',url:`/api/v1/business/community-posts/${post.id}/like`,headers:headers.member,payload:{}})).statusCode,200)
  assert.equal((await app.inject({method:'PATCH',url:`/api/v1/business/me/submissions/${comment.id}/cancel`,headers:headers.member,payload:{}})).statusCode,200)
  await app.inject({method:'POST',url:'/api/v1/business/community-posts',headers:headers.member,payload:{content:'x',anonymous:'true'}})
  await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'member',password:'FailedPasswordProbe'}})
  assert.equal((await app.inject({url:'/api/v1/admin/audit-logs',headers:headers.member})).statusCode,403)
  const audit = await app.inject({url:'/api/v1/admin/audit-logs?targetId='+post.id,headers:headers.admin})
  assert.equal(audit.statusCode,200,audit.body); assert.match(audit.headers['cache-control'],/no-store/)
  const rows=audit.json().data.items, publish=rows.find(row=>row.action==='business.community_post_published')
  assert.ok(publish);assert.equal(publish.trace.actorAccountId,users.member.id);assert.equal(publish.trace.actorName,'审计真实姓名')
  assert.equal(publish.ip,'127.0.0.1');assert.equal(publish.trace.location.source,'local-network');assert.equal(publish.trace.device.browser,'Safari')
  assert.equal(publish.trace.result,'success');assert.equal(publish.trace.route,'/api/v1/business/community-posts');assert.notEqual(publish.requestId,'ForgedRequestProbe')
  assert.equal(rows.filter(row=>row.action==='business.community_post_published').length,1)
  assert.ok(rows.some(row=>row.action==='business.submission_created'));assert.ok(rows.some(row=>row.action==='business.submission_cancelled'))
  assert.ok(rows.some(row=>row.action==='business.community_like_toggled' && row.trace.result==='success'))
  const failed=await app.services.audit.list({result:'failure'});assert.ok(failed.items.some(row=>row.trace.route==='/api/v1/business/community-posts'))
  const blocked=await app.services.audit.list({result:'blocked'});assert.ok(blocked.items.some(row=>row.trace.route==='/api/v1/admin/audit-logs'))
  const files=await fs.readdir(path.join(dir,'audit-requests'))
  const raw=(await Promise.all(files.map(file=>fs.readFile(path.join(dir,'audit-requests',file),'utf8')))).join('')
  for(const secret of ['QuerySecretProbe','BodySecretProbe','FailedPasswordProbe','Secret-Audit-Pass2026!','FakeCityProbe','ForgedRequestProbe','正文不能进入请求日志Probe',headers.member.authorization]) assert.equal(raw.includes(secret),false,secret)
  for(const url of ['/api/v1/business/community-posts',`/api/v1/business/community-posts/${post.id}`,'/api/v1/business/community-highlights']) {
    const response=await app.inject({url,headers:headers.member})
    for(const field of ['peerIp','ipSource','requestId','actorAccountId','userAgent','databaseDate']) assert.equal(response.body.includes(field),false,field)
  }
})

test('可信代理白名单拒绝伪造链与全网信任，支持IPv4和IPv6归一化',async t=>{
  assert.throws(()=>trustedProxyPolicy(true),/TRUSTED_PROXY/)
  assert.throws(()=>trustedProxyPolicy(['0.0.0.0\/0']),/CIDR/)
  assert.equal(normalizeIp('::ffff:7f00:1'),'127.0.0.1')
  assert.equal(normalizeIp('0:0:0:0:0:ffff:808:808'),'8.8.8.8')
  const {app,headers}=await fixture(t,{trustProxy:['127.0.0.1/32']})
  await app.inject({url:'/api/v1/me',headers:{...headers.member,'x-forwarded-for':'1.1.1.1, 8.8.8.8'}})
  const result=await app.services.audit.list({query:'8.8.8.8'})
  assert.ok(result.items.some(row=>row.trace.route==='/api/v1/me'&&row.ip==='8.8.8.8'&&row.trace.ipSource==='trusted-proxy'))
  assert.equal(result.items.some(row=>row.ip==='1.1.1.1'),false)
  await app.inject({url:'/api/v1/me',remoteAddress:'9.9.9.9',headers:{...headers.member,'x-forwarded-for':'1.1.1.1'}})
  assert.ok((await app.services.audit.list({query:'9.9.9.9'})).items.some(row=>row.ip==='9.9.9.9'))
})

test('跨域拒绝仍记录已认证执行人，未匹配API不记录原始URL或敏感参数',async t=>{
  const {app,headers,users}=await fixture(t)
  assert.equal((await app.inject({url:'/api/v1/me',headers:{...headers.member,origin:'https://blocked.invalid'}})).statusCode,403)
  const blocked=await app.services.audit.list({result:'blocked'})
  assert.ok(blocked.items.some(row=>row.trace.errorCode==='CORS_ORIGIN_DENIED'&&row.trace.actorAccountId===users.member.id))
  assert.equal((await app.inject({url:'/api/v1/MissingSecretProbe?token=QuerySecretProbe',headers:headers.member})).statusCode,404)
  const failed=await app.services.audit.list({result:'failure'})
  assert.ok(failed.items.some(row=>row.trace.route==='/api/v1/[unmatched]'))
  assert.equal(JSON.stringify(failed).includes('MissingSecretProbe'),false)
})

test('历史日志超过300条仍可按目标查询、分页；追加日志可跨重启读取',async t=>{
  const {app,users,headers}=await fixture(t)
  await app.services.database.transaction(state=>{ for(let i=0;i<340;i++)state.auditLogs.push({id:'old-'+i,action:'business.community_post_published',targetId:'old-post-'+i,actor:users.member.id,createdAt:new Date(Date.UTC(2020,0,1,0,0,i)).toISOString(),details:{}}) })
  const result=await app.services.audit.list({query:'old-post',page:11,pageSize:30})
  assert.equal(result.total,340);assert.equal(result.items.length,30);assert.equal(result.items[0].targetId,'old-post-39')
  const old=await app.services.audit.list({targetId:'old-post-0'});assert.equal(old.items.length,1);assert.equal(old.items[0].trace.result,undefined)
  assert.equal(old.items[0].trace.actorName,'审计真实姓名')
  await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:headers.member,payload:{}})
  const {AuditService}=await import('../src/audit/service.js')
  const restarted=await new AuditService(app.services.database,app.services.config).init()
  assert.ok((await restarted.list({actor:users.member.id})).items.some(row=>row.trace.route==='/api/v1/auth/logout'))
  await restarted.close()
})

test('审计落盘异常明确降级，不能伪报健康或把异常细节泄漏给用户',async t=>{
  const {app,headers}=await fixture(t)
  const file=path.join(app.services.audit.dir,'not-a-directory');await fs.writeFile(file,'test')
  const original=app.services.audit.dir;app.services.audit.dir=file
  const response=await app.inject({url:'/api/v1/me',headers:headers.member})
  assert.equal(response.statusCode,200);assert.equal(app.services.audit.status().healthy,false);assert.equal(app.services.audit.status().failures,1)
  app.services.audit.dir=original
})

test('残缺日志原件保留、后续完整记录可读，并明确提示记录缺失',async t=>{
  const {app,headers}=await fixture(t)
  const file=path.join(app.services.audit.dir,new Date().toISOString().slice(0,10)+'.jsonl')
  await fs.appendFile(file,'{"id":"interrupted-write"')
  assert.equal((await app.inject({url:'/api/v1/me',headers:headers.member})).statusCode,200)
  const result=await app.services.audit.list()
  assert.equal(result.status.healthy,false);assert.equal(result.status.damagedRecords,1)
  assert.ok(result.items.some(row=>row.trace.route==='/api/v1/me'))
  assert.ok(result.items.some(row=>row.action==='account.local_login'))
  assert.match(await fs.readFile(file,'utf8'),/interrupted-write/)
})

test('北京时间日期边界和图片上传业务日志均可完整查询',async t=>{
  const {app,headers}=await fixture(t)
  await app.services.database.transaction(state=>{
    for(const [id,time] of [['before','2026-09-10T15:59:59.999Z'],['first','2026-09-10T16:00:00.000Z'],['last','2026-09-11T15:59:59.999Z'],['after','2026-09-11T16:00:00.000Z']]) state.auditLogs.push({id:'date-'+id,action:'test.date',targetId:'date-probe',actor:'system',createdAt:time,details:{}})
  })
  const result=await app.services.audit.list({targetId:'date-probe',from:'2026-09-11',to:'2026-09-11'})
  assert.deepEqual(result.items.map(row=>row.id),['date-last','date-first'])
  const payload={mimeType:'image/png',dataBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='}
  for(const [url,actor,action] of [['/api/v1/business/community-media','member','media.community_uploaded'],['/api/v1/admin/media','admin','media.uploaded']]) {
    const uploaded=await app.inject({method:'POST',url,headers:headers[actor],payload});assert.equal(uploaded.statusCode,201)
    const asset=uploaded.json().data
    const logs=await app.services.audit.list({targetId:asset.id||asset.filename})
    const row=logs.items.find(row=>row.action===action)
    assert.ok(row);assert.equal(row.trace.result,'success');assert.equal(row.trace.actorUsername,actor);assert.ok(row.requestId)
  }
})

function xdb(version,endExclusive=false) {
  const region=Buffer.from('中国|湖南省|长沙市|测试运营商|CN'),start=524544+region.length,size=version===4?14:38
  const buffer=Buffer.alloc(start+size);buffer.writeUInt16LE(3,0);buffer.writeUInt16LE(1,2);buffer.writeUInt32LE(1700000000,4);buffer.writeUInt32LE(start,8);buffer.writeUInt32LE(start,12);buffer.writeUInt16LE(version,16);buffer.writeUInt16LE(4,18);region.copy(buffer,524544)
  const bucket=version===4?8*256+8:0x240e
  buffer.writeUInt32LE(start,256+bucket*8);buffer.writeUInt32LE(start+(endExclusive?size:0),260+bucket*8)
  if(version===4){buffer.writeUInt32LE(0x08080000,start);buffer.writeUInt32LE(0x0808ffff,start+4)}else{Buffer.from('240e0000000000000000000000000000','hex').copy(buffer,start);Buffer.from('240effffffffffffffffffffffffffff','hex').copy(buffer,start+16)}
  const width=version===4?4:16;buffer.writeUInt16LE(region.length,start+width*2);buffer.writeUInt32LE(524544,start+width*2+2)
  return buffer
}
test('离线归属查询正确处理IPv4/IPv6字节序、两种索引边界及损坏文件',async t=>{
  for(const version of [4,6])for(const end of [false,true]){
    const buffer=xdb(version,end),db=verifyXdb(buffer,version)
    assert.match(searchXdb(db,version===4?'8.8.8.8':'240e::1'),/长沙市/)
    assert.equal(searchXdb(db,version===4?'1.1.1.1':'2606::1'),'')
    assert.throws(()=>verifyXdb(buffer.subarray(0,buffer.length-1),version))
    buffer.writeUInt32LE(buffer.length+500,db.start+(version===4?10:34));assert.throws(()=>searchXdb(db,version===4?'8.8.8.8':'240e::1'))
  }
  const {dir}=await fixture(t);const geo=new GeoLocator(dir);await geo.init()
  assert.equal(geo.lookup('127.0.0.1').source,'local-network');assert.equal(geo.lookup('8.8.8.8').source,'unavailable')
})
