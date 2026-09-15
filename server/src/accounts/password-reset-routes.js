import {PasswordResetService} from './password-reset.js'
export function registerPasswordResetRoutes(app,{accounts,sessions,requireSuperAdmin,requestMeta,data}){
  const passwords=new PasswordResetService(accounts,sessions)
  app.post('/api/v1/admin/accounts/:id/password',{bodyLimit:4096,config:{rateLimit:{max:8,timeWindow:'1 minute'}}},async(request,reply)=>{
    const actor=requireSuperAdmin(request)
    reply.header('cache-control','private, no-store')
    return data(await passwords.reset(actor,request.params.id,request.body,requestMeta(request,actor.id)))
  })
  return passwords
}
