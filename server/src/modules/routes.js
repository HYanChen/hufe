import { ModuleService } from './service.js'
export function registerModuleRoutes(app,{database,requireSuperAdmin,requestMeta,data}){
  const modules=new ModuleService(database)
  app.get('/api/v1/modules',async(request,reply)=>{reply.header('cache-control','no-store');return data(modules.publicConfig())})
  app.get('/api/v1/admin/modules',async(request,reply)=>{reply.header('cache-control','private, no-store');return data(modules.list(requireSuperAdmin(request)))})
  app.patch('/api/v1/admin/modules/:id',{bodyLimit:4096,config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(request,reply)=>{
    reply.header('cache-control','private, no-store');const actor=requireSuperAdmin(request)
    return data(await modules.set(actor,request.params.id,request.body,requestMeta(request,actor.id)))
  })
  return modules
}
