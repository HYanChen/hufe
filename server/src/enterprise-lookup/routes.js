export function registerEnterpriseLookupRoutes(app,{lookup,requireUser,requireSuperAdmin,requestMeta,data}){
 app.get('/api/v1/admin/enterprise-lookup',async(r,p)=>{p.header('cache-control','private, no-store');return data(lookup.status(requireSuperAdmin(r).id))})
 app.put('/api/v1/admin/enterprise-lookup',async(r,p)=>{p.header('cache-control','private, no-store');const a=requireSuperAdmin(r);return data(await lookup.save(a.id,r.body,requestMeta(r,a.id)))})
 app.post('/api/v1/enterprise-lookup',{bodyLimit:2048,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(r,p)=>{p.header('cache-control','private, no-store');const a=requireUser(r);if(!r.body||Object.keys(r.body).some(k=>k!=='name'))throw Object.assign(new Error('仅可提交企业全称'),{statusCode:400,code:'ENTERPRISE_LOOKUP_INVALID'});return data(await lookup.lookup(a.id,r.body.name,requestMeta(r,a.id)))})
}
