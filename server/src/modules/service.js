import { auditRecord } from '../audit/metadata.js'
import { CORE_MODULES, MODULE_CATALOG, filterModuleRecords,moduleRecordEnabled, moduleEnabled, moduleForPage, moduleForResource, moduleForSubmission, normalizeModuleFlags } from './catalog.js'

const fail=(message,code='MODULE_CONFIG_INVALID',statusCode=400)=>Object.assign(new Error(message),{code,statusCode})
const denied=id=>fail(`${MODULE_CATALOG.find(row=>row.id===id)?.name||'该功能'}暂未启用，请稍后再试`,'MODULE_DISABLED',404)
const own=(object,key)=>Object.hasOwn(object||{},key)
function snapshot(state){const config=state.moduleSettings||{};return {revision:Number(config.revision||0),flags:normalizeModuleFlags(config.flags),updatedAt:config.updatedAt||null}}
function resourceFromRequest(request){
  const path=String(request.url||request.raw?.url||request.routeOptions?.url||'').split('?')[0]
  const parts=path.split('/').filter(Boolean).map(part=>{try{return decodeURIComponent(part)}catch{return part}})
  return {path,parts}
}

export class ModuleService {
  constructor(database){this.database=database}
  publicConfig(){return this.database.read(snapshot)}
  guard(state,actor){
    const current=state.accounts.find(row=>row.id===actor?.id&&row.status==='active')
    if(current?.isAdmin!==true||current.mustChangePassword||[current.role,current.adminRole].some(role=>role&&!['admin','super_admin'].includes(role)))throw fail('仅有效全局管理员可以管理模块','ADMIN_PERMISSION_DENIED',403)
    if(Number(current.credentialRevision||0)!==Number(actor.credentialRevision||0))throw fail('管理员登录状态已变化，请重新登录','CREDENTIALS_CHANGED',401)
  }
  list(actor){return this.database.read(state=>{this.guard(state,actor);const config=snapshot(state);return {...config,items:MODULE_CATALOG.map(row=>({...row,enabled:config.flags[row.id]})),core:CORE_MODULES}})}
  async set(actor,id,input,metadata={}){
    if(!MODULE_CATALOG.some(row=>row.id===id))throw fail('该模块不存在或属于不可关闭的基础能力','MODULE_LOCKED',400)
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['enabled','revision','reason'].includes(key))||typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.revision))throw fail('请确认模块开关与当前配置版本')
    const reason=typeof input.reason==='string'?input.reason.trim():''
    if(reason.length<5||reason.length>300||/[\u0000-\u001f<>]/.test(reason))throw fail('请填写5至300字操作原因')
    return this.database.transaction(state=>{
      this.guard(state,actor);const current=snapshot(state)
      if(input.revision!==current.revision)throw fail('模块配置已被其他管理员修改，请刷新后重试','MODULE_REVISION_CONFLICT',409)
      if(current.flags[id]===input.enabled)return {...current,unchanged:true}
      state.moduleSettings={revision:current.revision+1,flags:{...current.flags,[id]:input.enabled},updatedAt:new Date().toISOString(),updatedBy:actor.id}
      state.auditLogs.unshift(auditRecord('system.module_status_changed',id,{...metadata,actor:actor.id},{label:MODULE_CATALOG.find(row=>row.id===id).name,enabled:input.enabled,reason,revision:state.moduleSettings.revision,dataRetained:true}))
      return snapshot(state)
    })
  }
  required(request,state){
    const {path,parts}=resourceFromRequest(request),needed=new Set(),add=id=>{if(id)needed.add(id)}
    if(!path.startsWith('/api/v1/'))return []
    if(/^\/api\/v1\/(?:admin\/)?(?:chat(?:\/|-stickers)|chat-stickers)/.test(path))add('chat')
    if(/^\/api\/v1\/(?:admin\/)?maps(?:\/|$)/.test(path))add('maps')
    if(/^\/api\/v1\/(?:admin\/)?gate(?:\/|$)/.test(path))add('gate')
    if(/^\/api\/v1\/(?:admin\/)?enterprise-lookup(?:\/|$)/.test(path))add('enterprises')
    if(/^\/api\/v1\/(?:content(?:\/|$)|sync\/|admin\/(?:ops\/)?content\/)/.test(path))add('official-content')
    const index=parts.indexOf('business')
    if(index>=0){
      const tail=parts.slice(index+1),names=new Set(tail)
      const mapCityLookup=names.has('directory')&&(names.has('city-stats')||names.has('city-center'))
      for(const segment of tail)if(!(mapCityLookup&&segment==='directory'))add(moduleForResource(segment))
      if(tail.some(segment=>segment.startsWith('community-')))add('community')
      if(names.has('enterprise-certifications')||names.has('enterprise-profile'))add('enterprises')
      if(names.has('mentor-profile'))add('mentors')
      if(names.has('managed-organizations'))add('organizations')
      if(request.body?.organizationId)add('organizations')
      if(names.has('submissions')||names.has('applications')||names.has('service-applications')||names.has('campus-visits')){
        add(moduleForSubmission(request.body?.type||request.query?.type||request.query?.submissionType))
        if(request.body?.type==='event-registration'&&(state.business?.resources?.activities||[]).find(row=>row.id===request.body.resourceId)?.organizationId)add('organizations')
        const id=request.params?.id||tail[tail.indexOf('submissions')+1]
        if(id){const row=(state.business?.submissions||[]).find(row=>row.id===id);if(row){add(moduleForSubmission(row.type));add(moduleForResource(row.resourceType));if(row.type==='event-registration'&&(state.business?.resources?.activities||[]).find(activity=>activity.id===row.resourceId)?.organizationId)add('organizations')}}
      }
      if(mapCityLookup)add('maps')
      const id=request.params?.id
      if(id&&['activities','announcements'].some(resource=>names.has(resource))){const resource=names.has('activities')?'activities':'announcements';if((state.business?.resources?.[resource]||[]).find(row=>row.id===id)?.organizationId)add('organizations')}
    }
    if(/^\/api\/v1\/admin\/organizations(?:\/|$)/.test(path))add('organizations')
    if(/^\/api\/v1\/(?:admin|business)\/organization-album-photos(?:\/|$)/.test(path))add('organizations')
    if(path==='/api/v1/image-uploads'&&typeof request.body?.target==='string'&&!request.body.target.startsWith('/api/v1/image-uploads')){for(const id of this.required({url:request.body.target,body:{}},state))add(id)}
    return [...needed]
  }
  assertRequest(request){
    return this.database.read(state=>{const flags=snapshot(state).flags;for(const id of this.required(request,state))if(!moduleEnabled(flags,id))throw denied(id)})
  }
  filterSubmissions(rows){return this.database.read(state=>filterModuleRecords(state,'applications',rows))}
  filterBootstrap(value){
    const config=this.publicConfig(),result=structuredClone(value),flags=config.flags
    for(const [key,resource] of Object.entries({activities:'activities',organizations:'organizations',communityPosts:'community-posts',directory:'directory',jobs:'jobs',mentors:'mentors',volunteers:'volunteers',givingProjects:'giving-projects',alumniEnterprises:'alumni-enterprises',collaborationOpportunities:'collaboration-opportunities',alumniAcademy:'alumni-academy',alumniBenefits:'alumni-benefits',announcements:'announcements',academicCalendar:'academic-calendar'}))if(own(result,key))result[key]=(result[key]||[]).filter(row=>moduleRecordEnabled(flags,resource,row))
    if(Array.isArray(result.serviceCatalog))result.serviceCatalog=flags.services?result.serviceCatalog.filter(row=>moduleEnabled(flags,moduleForPage(row.path||row.route||row.target||row.url))):[]
    result.modules=config
    return result
  }
}
