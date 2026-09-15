export function registerGivingTemplateRoutes(app,{business,requireBackendUser,delegations,transactionRecordGuard,requestMeta,data}) {
  app.post('/api/v1/admin/business/giving-projects/:id/certificate-template', {
    bodyLimit:8192,config:{rateLimit:{max:30,timeWindow:'1 minute'}}
  },async(request,reply)=>{
    reply.header('cache-control','private, no-store')
    const actor=requireBackendUser(request),record=business.getAdmin('giving-projects',request.params.id)
    if (!delegations.canRecord(actor,'giving-projects','update',record)) throw Object.assign(new Error('没有该公益项目的管理权限'),{statusCode:403,code:'ADMIN_SCOPE_REQUIRED'})
    const guard=transactionRecordGuard(actor,'giving-projects','update')
    const result=await business.saveGivingCertificateTemplate(request.params.id,request.body,requestMeta(request,actor.id),(state,currentRecord)=>{
      const current=state.accounts.find(account=>account.id===actor.id&&account.status==='active')
      if (!current || current.mustChangePassword || Number(current.credentialRevision||0)!==Number(actor.credentialRevision||0)) throw Object.assign(new Error('登录凭据或账号状态已变化，请重新登录'),{statusCode:403,code:'ADMIN_SCOPE_REQUIRED'})
      guard(state,currentRecord)
    })
    return data({...result,capabilities:delegations.recordCapabilities(actor,'giving-projects',result)})
  })
}
