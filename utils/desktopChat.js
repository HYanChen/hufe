export const DESKTOP_CHAT_QUERY='(min-width: 1024px) and (pointer: fine)'
export function isDesktopChat(){
  // #ifdef H5
  return typeof window!=='undefined'&&window.matchMedia(DESKTOP_CHAT_QUERY).matches
  // #endif
  // #ifndef H5
  return false
  // #endif
}
export function requestDesktopChat(conversationId=''){
  // #ifdef H5
  if(isDesktopChat()&&window.__hufeDesktopChatReady){window.dispatchEvent(new CustomEvent('hufe:open-desktop-chat',{detail:{conversationId:String(conversationId||'')}}));return true}
  // #endif
  return false
}
