import {DirectVerificationService} from './direct-verification.js'
export function registerDirectVerificationRoutes(app,{accounts,requireSuperAdmin,requestMeta,data}){
  const verification=new DirectVerificationService(accounts)
  app.post('/api/v1/admin/accounts/:id/manual-verification',{bodyLimit:8192,config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async(request,reply)=>{
    reply.header('cache-control','private, no-store')
    const actor=requireSuperAdmin(request)
    return data(await verification.verify(actor,request.params.id,request.body,requestMeta(request,actor.id)))
  })
  return verification
}
