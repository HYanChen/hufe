import { reactive } from 'vue'
import { api } from './api.js'
import { moduleEnabled,moduleForAdminRoute,normalizeModuleFlags } from '../../../server/src/modules/catalog.js'

export const moduleState=reactive({flags:normalizeModuleFlags(),revision:0,loaded:false,error:'',updatedAt:null})
let inFlight=null,lastLoaded=0
export function applyModuleConfig(config){
  if(!config?.flags||typeof config.flags!=='object')return false
  if(moduleState.loaded&&Number(config.revision||0)<moduleState.revision)return false
  moduleState.flags=normalizeModuleFlags(config.flags);moduleState.revision=Number(config.revision||0)
  moduleState.updatedAt=config.updatedAt||null;moduleState.loaded=true;moduleState.error='';lastLoaded=Date.now();return true
}
export async function refreshModuleConfig({force=false}={}){
  if(inFlight)return inFlight
  if(!force&&moduleState.loaded&&Date.now()-lastLoaded<15000)return moduleState
  inFlight=api('/modules',{token:''}).then(config=>{applyModuleConfig(config);return moduleState}).catch(error=>{moduleState.error=error.message||'模块配置暂时无法更新';return moduleState}).finally(()=>{inFlight=null})
  return inFlight
}
export const isModuleEnabled=id=>moduleEnabled(moduleState.flags,id)
export const isAdminRouteEnabled=name=>isModuleEnabled(moduleForAdminRoute(name))
