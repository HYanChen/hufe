import {AlumniNumberService} from './alumni-numbers.js'

export function registerAlumniNumberRoutes(app,{accounts,requireSuperAdmin,requestMeta,data}){
  const service=new AlumniNumberService(accounts)
  const options={bodyLimit:4096,config:{rateLimit:{max:12,timeWindow:'1 minute'}}}
  app.post('/api/v1/admin/accounts/:id/alumni-number',options,async(request,reply)=>{
    reply.header('cache-control','private, no-store')
    const actor=requireSuperAdmin(request)
    return data(await service.issue(actor,request.params.id,request.body,requestMeta(request,actor.id)))
  })
  app.post('/api/v1/admin/accounts/alumni-numbers/preview',options,async(request,reply)=>{
    reply.header('cache-control','private, no-store')
    const actor=requireSuperAdmin(request)
    return data(service.preview(actor,request.body||{}))
  })
  app.post('/api/v1/admin/accounts/alumni-numbers/apply',options,async(request,reply)=>{
    reply.header('cache-control','private, no-store')
    const actor=requireSuperAdmin(request)
    return data(await service.apply(actor,request.body,requestMeta(request,actor.id)))
  })
  return service
}
