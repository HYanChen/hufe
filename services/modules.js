import { reactive } from 'vue'
import { request } from './http'
import { moduleEnabled, moduleForPage, moduleForResource, normalizeModuleFlags } from '../server/src/modules/catalog.js'

export const moduleState = reactive({ flags:normalizeModuleFlags(),revision:0,loaded:false,error:'',updatedAt:null })
let inFlight=null,lastLoaded=0
// Independently rendered H5 roots are outside the page's render tree. Deliver
// confirmed configuration changes explicitly rather than relying only on their
// component computed caches to refresh after a bootstrap/heartbeat update.
const configListeners=new Set()
export function subscribeModuleConfig(listener){
  configListeners.add(listener)
  listener(moduleState)
  return()=>configListeners.delete(listener)
}
export function applyModuleConfig(config){
  if(!config||!config.flags||typeof config.flags!=='object')return false
  if(moduleState.loaded&&Number(config.revision||0)<moduleState.revision)return false
  moduleState.flags=normalizeModuleFlags(config.flags)
  moduleState.revision=Number(config.revision||0)
  moduleState.updatedAt=config.updatedAt||null
  moduleState.loaded=true;moduleState.error='';lastLoaded=Date.now()
  for(const listener of configListeners)listener(moduleState)
  return true
}
export async function refreshModuleConfig({force=false}={}){
  if(inFlight)return inFlight
  if(!force&&moduleState.loaded&&Date.now()-lastLoaded<15000)return moduleState
  inFlight=request({path:'/api/v1/modules'}).then(config=>{applyModuleConfig(config);return moduleState}).catch(error=>{
    // Retain the last confirmed configuration on transient errors. Before the
    // first successful read, default to visible; the server still guards APIs.
    moduleState.error=error.message||'模块配置暂时无法更新';return moduleState
  }).finally(()=>{inFlight=null})
  return inFlight
}
export const isModuleEnabled=id=>moduleEnabled(moduleState.flags,id)
export const isPageModuleEnabled=path=>isModuleEnabled(moduleForPage(path))
export const isResourceModuleEnabled=resource=>isModuleEnabled(moduleForResource(resource))
export const filterModuleEntries=rows=>(Array.isArray(rows)?rows:[]).filter(row=>row.moduleId?isModuleEnabled(row.moduleId):isPageModuleEnabled(row.path||row.route||row.target||row.url||''))
