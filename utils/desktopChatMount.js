import {createVNode,render} from 'vue'
import DesktopChatDock from '../components/DesktopChatDock.vue'
import {updateModuleTabs} from './moduleNavigation'
import {isModuleEnabled,subscribeModuleConfig} from '../services/modules'
export function installDesktopChat(app){
  let host=null,observer=null,context=null,mounted=false,disposed=false
  const markChatTab=()=>{for(const item of document.querySelectorAll('.uni-tabbar__item'))item.toggleAttribute('data-hufe-chat-tab',item.querySelector('.uni-tabbar__label')?.textContent.trim()==='对话');updateModuleTabs()}
  const syncDock=()=>{
    if(disposed||!host||!context)return
    const enabled=isModuleEnabled('chat')
    if(!enabled){
      if(mounted)render(null,host)
      mounted=false
      window.__hufeDesktopChatReady=false
      return
    }
    if(mounted)return
    const vnode=createVNode(DesktopChatDock);vnode.appContext=context
    // Mark before render: the global mounted mixin also runs in this root.
    mounted=true;render(vnode,host)
  }
  const unsubscribe=subscribeModuleConfig(syncDock)
  // Mount through the existing uni-app Vue context, sharing the real H5 components and services.
  // App.vue has no page template in uni-app, so the dock lives beside the page router, not inside an iframe.
  app.mixin({mounted(){if(disposed||host||typeof document==='undefined'||!document.body)return;host=document.createElement('div');host.id='hufe-desktop-chat-root';document.body.appendChild(host);context=this.$.appContext;syncDock();markChatTab();observer=new MutationObserver(markChatTab);observer.observe(document.body,{childList:true,subtree:true,characterData:true})}})
  const originalUnmount=app.unmount.bind(app)
  app.unmount=()=>{disposed=true;unsubscribe();observer?.disconnect();if(host){render(null,host);host.remove();host=null}mounted=false;context=null;window.__hufeDesktopChatReady=false;originalUnmount()}
}
