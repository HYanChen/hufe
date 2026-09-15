import {moduleState,isPageModuleEnabled,isModuleEnabled,refreshModuleConfig,subscribeModuleConfig} from '../services/modules'

let installed=false, redirecting=false
export function guardModulePage(){
  if(!moduleState.loaded||redirecting)return
  const pages=typeof getCurrentPages==='function'?getCurrentPages():[]
  const current=pages[pages.length-1]
  let route=current?.route?'/'+current.route:''
  // #ifdef H5
  route=window.location.hash.slice(1)||route
  // #endif
  if(!route||isPageModuleEnabled(route))return
  redirecting=true
  let hashNavigation=false
  // #ifdef H5
  // A pasted hash can finish loading before uni.switchTab has a page stack.
  // Hash replacement reaches the same H5 router without waiting on that API's
  // cold-start callback, and removes the disabled page from browser history.
  if(typeof window!=='undefined'&&window.location?.replace){
    window.location.replace('#/pages/home/index')
    hashNavigation=true;redirecting=false
  }
  // #endif
  if(!hashNavigation)uni.switchTab({url:'/pages/home/index',complete(){redirecting=false}})
  uni.showToast({title:'该功能已关闭，已返回首页',icon:'none'})
}
export function updateModuleTabs(){
  // #ifdef H5
  if(typeof document==='undefined')return
  for(const item of document.querySelectorAll('.uni-tabbar__item')){
    const label=item.querySelector('.uni-tabbar__label')?.textContent.trim()
    const id=label==='对话'?'chat':label==='湖财圈'?'community':''
    item.toggleAttribute('data-hufe-module-hidden',Boolean(id&&!isModuleEnabled(id)))
  }
  // #endif
}
export function installModuleNavigation(){
  if(installed)return;installed=true
  for(const name of ['navigateTo','redirectTo','reLaunch','switchTab'])uni.addInterceptor(name,{invoke(args){
    if(isPageModuleEnabled(args.url))return args
    uni.showToast({title:'该功能暂未启用',icon:'none'});return false
  }})
  subscribeModuleConfig(()=>{updateModuleTabs();guardModulePage()})
  // #ifdef H5
  window.addEventListener('hashchange',()=>{updateModuleTabs();guardModulePage()})
  // #endif
  refreshModuleConfig().then(()=>{updateModuleTabs();guardModulePage()})
}
