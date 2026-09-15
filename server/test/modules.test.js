import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { JsonDatabase } from '../src/storage/json-database.js'
import { ModuleService } from '../src/modules/service.js'
import { registerModuleRoutes } from '../src/modules/routes.js'
import { BusinessService } from '../src/business/service.js'
import { MODULE_CATALOG,moduleForPage,moduleForAdminRoute,moduleEnabled,normalizeModuleFlags } from '../src/modules/catalog.js'

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-modules-')),file=path.join(root,'db.json'),database=await new JsonDatabase(file).init()
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const admin={id:'admin',name:'管理员',isAdmin:true,status:'active',credentialRevision:0}
  await database.transaction(state=>{
    state.accounts=[admin,{id:'member',status:'active'},{id:'delegate',status:'active',isAdmin:true,adminRole:'delegated_admin'},{id:'pending',status:'active',isAdmin:true,mustChangePassword:true}]
    state.business={resources:{'community-posts':[{id:'post',content:'保留的帖子'}],activities:[{id:'event',organizationId:'org'}],announcements:[{id:'notice'}]},submissions:[{id:'comment',type:'community-comment'},{id:'giving',type:'giving-intent'},{id:'service',type:'service-application'}]}
  })
  return {database,service:new ModuleService(database),admin,file}
}
const change=(service,admin,id,enabled)=>service.set(admin,id,{enabled,revision:service.publicConfig().revision,reason:'管理员功能调整'})

test('模块默认全部开启，基础页面不受开关影响，真实专属页面与后台路由映射一致',()=>{
  const flags=normalizeModuleFlags({community:false,unknown:false})
  assert.equal(Object.keys(flags).length,MODULE_CATALOG.length)
  assert.equal(moduleEnabled(flags,'community'),false)
  assert.equal(moduleEnabled(flags,'accounts'),true)
  for(const page of ['chapter-about','chapter-contact','chapter-members','chapter-album','chapter-messages'])assert.equal(moduleForPage(`/pages/${page}/index?id=x`),'organizations')
  assert.equal(moduleForPage('http://localhost/#/pages/gate/index'),'gate')
  assert.equal(moduleForPage('/pages/enterprise-job-editor/index'),'jobs')
  for(const page of ['services','home','mine','card','profile','verify','change-password','inbox','ecosystem'])assert.equal(moduleForPage(`/pages/${page}/index`),'')
  assert.equal(moduleForAdminRoute('chatStickers'),'chat')
  for(const name of ['accounts','audit','modules','regions','sensitiveWords'])assert.equal(moduleForAdminRoute(name),'')
})

test('关闭持久化且保留全部历史业务，重新启用恢复，操作有审计',async t=>{
  const {database,service,admin,file}=await fixture(t),before=database.read(state=>state.business)
  const first=await change(service,admin,'community',false)
  assert.equal(first.revision,1);assert.equal(first.flags.community,false)
  assert.deepEqual(database.read(state=>state.business),before)
  assert.equal(new ModuleService(await new JsonDatabase(file).init()).publicConfig().flags.community,false)
  assert.throws(()=>service.assertRequest({url:'/api/v1/business/community-posts/post/comments'}),{code:'MODULE_DISABLED',statusCode:404})
  await change(service,admin,'community',true)
  assert.doesNotThrow(()=>service.assertRequest({url:'/api/v1/business/community-posts/post/comments'}))
  assert.deepEqual(database.read(state=>state.business),before)
  assert.equal(database.read(state=>state.auditLogs.filter(row=>row.action==='system.module_status_changed').length),2)
})

test('模块变更权限、版本、未知基础模块和输入校验不能绕过，写入失败不发布',async t=>{
  const {database,service,admin}=await fixture(t)
  for(const id of ['member','delegate','pending','missing'])await assert.rejects(change(service,{id},'chat',false),{code:'ADMIN_PERMISSION_DENIED'})
  for(const id of ['accounts','audit','modules','unknown'])await assert.rejects(change(service,admin,id,false),{code:'MODULE_LOCKED'})
  for(const input of [{enabled:'false',revision:0,reason:'测试配置原因'},{enabled:false,revision:0,reason:'短'},{enabled:false,revision:0,reason:'测试配置原因',password:'x'}])await assert.rejects(service.set(admin,'chat',input),{code:'MODULE_CONFIG_INVALID'})
  const persist=database.persist.bind(database);database.persist=async()=>{throw new Error('disk-failure')}
  await assert.rejects(change(service,admin,'chat',false),/disk-failure/);assert.equal(service.publicConfig().flags.chat,true)
  database.persist=persist;await change(service,admin,'chat',false)
  await assert.rejects(service.set(admin,'chat',{enabled:true,revision:0,reason:'测试版本过期'}),{code:'MODULE_REVISION_CONFLICT'})
  await database.transaction(state=>{state.accounts[0].credentialRevision=1})
  await assert.rejects(change(service,admin,'chat',true),{code:'CREDENTIALS_CHANGED'})
})

test('关闭拦截前后台、旧业务申请、组织相册文件与上传目标，基础身份审计不受影响',async t=>{
  const {database,service,admin}=await fixture(t)
  for(const id of ['community','chat','organizations','gate','maps','giving','services','official-content','enterprises'])await change(service,admin,id,false)
  const requests=[
    {url:'/api/v1/business/community-highlights'},
    {url:'/api/v1/business/community-posts/post/comments'},
    {url:'/api/v1/admin/business/applications/comment/actions',params:{id:'comment'}},
    {url:'/api/v1/business/me/submissions/giving/cancel',params:{id:'giving'}},
    {url:'/api/v1/business/submissions',body:{type:'giving-intent'}},
    {url:'/api/v1/business/me/submissions?type=service-application',query:{type:'service-application'}},
    {url:'/api/v1/chat/conversations/x/messages'},
    {url:'/api/v1/admin/chat/files/x/ticket'},
    {url:'/api/v1/admin/chat-stickers/packs'},
    {url:'/api/v1/gate/passes'},
    {url:'/api/v1/maps/viewer/index.html'},
    {url:'/api/v1/business/organization-album-photos/photo'},
    {url:'/api/v1/admin/organization-album-photos/photo'},
    {url:'/api/v1/business/activities/event',params:{id:'event'}},
    {url:'/api/v1/business/me/enterprise-certifications'},
    {url:'/api/v1/enterprise-lookup',body:{name:'企业'}},
    {url:'/api/v1/admin/ops/content/sync'},
    {url:'/api/v1/image-uploads',body:{target:'/api/v1/business/community-media'}}
  ]
  for(const request of requests)assert.throws(()=>service.assertRequest(request),{code:'MODULE_DISABLED'},request.url)
  for(const url of ['/api/v1/auth/login','/api/v1/me/profile','/api/v1/me/identity-card','/api/v1/admin/modules','/api/v1/modules','/api/v1/admin/audit-logs','/api/v1/admin/accounts','/api/v1/regions'])assert.doesNotThrow(()=>service.assertRequest({url}),url)
  assert.equal(database.read(state=>state.business.submissions.length),3)
})

test('统一首页配置使用真实字段过滤并返回开关；混合业务申请隐藏关闭类型',async t=>{
  const {service,admin,database}=await fixture(t)
  for(const id of ['community','enterprises','academy','benefits','collaboration','giving','jobs'])await change(service,admin,id,false)
  const original={communityPosts:[{id:'p'}],alumniEnterprises:[{id:'e'}],alumniAcademy:[{id:'a'}],alumniBenefits:[{id:'b'}],collaborationOpportunities:[{id:'c'}],givingProjects:[{id:'g'}],jobs:[{id:'j'}],activities:[{id:'keep'}],serviceCatalog:[{id:'job',path:'/pages/jobs/index'},{id:'identity',path:'/pages/card/index'}]}
  const result=service.filterBootstrap(original)
  for(const key of ['communityPosts','alumniEnterprises','alumniAcademy','alumniBenefits','collaborationOpportunities','givingProjects','jobs'])assert.deepEqual(result[key],[],key)
  assert.deepEqual(result.activities,[{id:'keep'}]);assert.deepEqual(result.serviceCatalog,[{id:'identity',path:'/pages/card/index'}]);assert.equal(result.modules.flags.jobs,false);assert.equal(original.jobs.length,1)
  const submissions=database.read(state=>state.business.submissions);assert.deepEqual(service.filterSubmissions(submissions).map(row=>row.id),['service'])
  await change(service,admin,'services',false);assert.deepEqual(service.filterBootstrap(original).serviceCatalog,[])
})

test('同城地图的城市聚合和定位独立控制，名录关闭不连带关闭地图',async t=>{
  const {service,admin}=await fixture(t)
  await change(service,admin,'directory',false)
  assert.throws(()=>service.assertRequest({url:'/api/v1/business/directory'}),{code:'MODULE_DISABLED'})
  for(const suffix of ['city-stats','city-center'])assert.doesNotThrow(()=>service.assertRequest({url:`/api/v1/business/directory/${suffix}`}))
  await change(service,admin,'maps',false)
  for(const suffix of ['city-stats','city-center'])assert.throws(()=>service.assertRequest({url:`/api/v1/business/directory/${suffix}`}),{code:'MODULE_DISABLED'})
})

test('真实模块路由需管理员，开启关闭后请求钩子在业务处理前生效',async t=>{
  const {database,admin}=await fixture(t),app=Fastify();t.after(()=>app.close())
  app.setErrorHandler((error,request,reply)=>reply.code(error.statusCode||500).send({code:error.code,message:error.message}))
  const modules=registerModuleRoutes(app,{database,requireSuperAdmin:r=>{if(r.headers['x-admin']!=='yes')throw Object.assign(new Error('forbidden'),{statusCode:403});return admin},requestMeta:()=>({actor:admin.id}),data:value=>({code:0,data:value})})
  app.addHook('preHandler',async request=>modules.assertRequest(request))
  let called=0;app.post('/api/v1/business/community-posts',async()=>{called++;return {ok:true}})
  assert.equal((await app.inject({url:'/api/v1/admin/modules'})).statusCode,403)
  const publicResponse=await app.inject({url:'/api/v1/modules'});assert.equal(publicResponse.statusCode,200);assert.equal(publicResponse.headers['cache-control'],'no-store')
  const changed=await app.inject({method:'PATCH',url:'/api/v1/admin/modules/community',headers:{'x-admin':'yes'},payload:{enabled:false,revision:0,reason:'模块维护暂时关闭'}})
  assert.equal(changed.statusCode,200)
  assert.equal((await app.inject({method:'POST',url:'/api/v1/business/community-posts',payload:{content:'禁止提交'}})).statusCode,404);assert.equal(called,0)
  const list=await app.inject({url:'/api/v1/admin/modules',headers:{'x-admin':'yes'}});assert.equal(list.json().data.items.find(row=>row.id==='community').enabled,false)
  assert.equal((await app.inject({method:'PATCH',url:'/api/v1/admin/modules/community',headers:{'x-admin':'yes'},payload:{enabled:true,revision:1,reason:'模块维护已完成'}})).statusCode,200)
  assert.equal((await app.inject({method:'POST',url:'/api/v1/business/community-posts',payload:{content:'恢复提交'}})).statusCode,200);assert.equal(called,1)
})

test('业务混合列表先过滤再分页，摘要、收件箱、组织主页与焦点轮播不夹带已关闭模块',async t=>{
  const {database,service,admin}=await fixture(t),business=new BusinessService(database,{env:'test'})
  await business.init()
  const timestamp=new Date().toISOString()
  await database.transaction(state=>{
    Object.assign(state.accounts.find(row=>row.id==='member'),{name:'实名用户',schoolIdentityVerified:true})
    state.business.resources.organizations=[{id:'org',name:'校友组织',type:'regional',status:'published'}]
    state.business.resources.activities=[{id:'school-event',title:'学校活动',status:'published'},{id:'org-event',title:'组织活动',organizationId:'org',status:'published'}]
    state.business.resources.announcements=[{id:'announcement',title:'全校公告',status:'published',audience:'all',carouselPlacement:'pinned',startAt:'2020-01-01T00:00:00Z',endAt:'2099-01-01T00:00:00Z'},{id:'org-announcement',title:'组织公告',status:'published',organizationId:'org',audience:'all',startAt:'2020-01-01T00:00:00Z',endAt:'2099-01-01T00:00:00Z'}]
    state.business.submissions=[
      {id:'giving',accountId:'member',type:'giving-intent',status:'submitted',createdAt:timestamp},
      {id:'comment',accountId:'member',type:'community-comment',status:'published',createdAt:timestamp},
      {id:'event-1',accountId:'member',type:'event-registration',resourceType:'activities',resourceId:'school-event',status:'submitted',createdAt:timestamp},
      {id:'event-2',accountId:'member',type:'event-registration',resourceType:'activities',resourceId:'org-event',status:'submitted',createdAt:timestamp}
    ]
    state.business.notifications=[{id:'giving-note',accountId:'member',type:'submission.submitted',resourceType:'giving-projects',target:'/pages/giving/index',createdAt:timestamp},{id:'core-note',accountId:'member',type:'identity.verified',title:'身份验证成功',target:'/pages/profile/index',createdAt:timestamp}]
  })
  const before=database.read(state=>state.business)
  for(const id of ['giving','community','organizations','announcements'])await change(service,admin,id,false)
  const mine=business.mySubmissions('member',{page:1,pageSize:1});assert.equal(mine.total,1);assert.equal(mine.items[0].id,'event-1')
  const adminList=business.listAdmin('applications',{page:1,pageSize:1});assert.equal(adminList.total,1);assert.equal(adminList.items[0].id,'event-1')
  const publicEvents=business.listPublic('activities',{},'member');assert.equal(publicEvents.total,1);assert.equal(publicEvents.items[0].id,'school-event')
  const summary=business.summary();assert.equal(summary.submissions,1);assert.equal(summary.resources.applications.total,1);assert.equal(summary.resources.announcements.total,0)
  assert.equal(business.mySummary('member').applications,1)
  assert.deepEqual(business.communityHighlights('member').items,[])
  const inbox=business.inbox({id:'member'});assert.equal(inbox.total,1);assert.equal(inbox.items[0].title,'身份验证成功');assert.equal(inbox.unreadCount,1)
  assert.equal(business.bootstrap('member').activities.length,1)
  await change(service,admin,'organizations',true);await change(service,admin,'activities',false)
  const home=business.organizationHome('org','member');assert.deepEqual(home.activities,[]);assert.deepEqual(home.announcements,[]);assert.equal(home.activityTotal,0);assert.equal(home.announcementTotal,0)
  const managed=business.managedOrganizationDetail('org');assert.equal(managed.activityTotal,0);assert.equal(managed.announcementTotal,0)
  assert.deepEqual(database.read(state=>state.business),before)
})
