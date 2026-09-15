import fs from 'node:fs'
import {PersonnelService} from './personnel.js'
import {XLSX_BYTES} from './xlsx.js'

export function registerPersonnelRoutes(app,{accounts,requireSuperAdmin,requestMeta,data}){
  const personnel=new PersonnelService(accounts)
  app.get('/api/v1/admin/personnel/template',async(request,reply)=>{
    requireSuperAdmin(request)
    const file=new URL('./templates/personnel-import.xlsx',import.meta.url)
    if(!fs.existsSync(file))throw Object.assign(new Error('人员导入模板尚未安装，请联系管理员'),{statusCode:503,code:'PERSONNEL_TEMPLATE_UNAVAILABLE'})
    reply.header('cache-control','private, no-store').header('content-disposition',"attachment; filename=personnel-import.xlsx; filename*=UTF-8''%E4%BA%BA%E5%91%98%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx").type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return fs.createReadStream(file)
  })
  app.post('/api/v1/admin/personnel/preview',{bodyLimit:64*1024},async request=>{
    const admin=requireSuperAdmin(request)
    return data(personnel.preview(admin,[{rowNumber:1,input:request.body||{}}]))
  })
  app.post('/api/v1/admin/personnel/import-preview',{bodyLimit:Math.ceil(XLSX_BYTES/3)*4+4096,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async request=>{
    const admin=requireSuperAdmin(request)
    return data(personnel.previewWorkbook(admin,request.body))
  })
  app.post('/api/v1/admin/personnel/apply',{bodyLimit:4096,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async request=>{
    const admin=requireSuperAdmin(request)
    return data(await personnel.apply(admin,request.body,requestMeta(request,admin.id)))
  })
  return personnel
}
