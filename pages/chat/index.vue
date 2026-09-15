<template><ChatThread v-if="!desktop" :conversation-id="conversationId" :active="visible"/><view v-else class="desktop-chat-page-note"><text>对话已在右下角独立窗口打开</text><button @tap="openDock">展开对话窗口</button><text>你可以继续浏览页面，同时收发消息。</text></view></template>
<script>
import ChatThread from '../../components/ChatThread.vue'
import {DESKTOP_CHAT_QUERY,isDesktopChat,requestDesktopChat} from '../../utils/desktopChat'
export default{
  components:{ChatThread},data:()=>({conversationId:'',visible:false,desktop:false,screenQuery:null}),
  onLoad(query){this.conversationId=query.id||'';this.desktop=isDesktopChat();
    // #ifdef H5
    this.screenQuery=window.matchMedia(DESKTOP_CHAT_QUERY);this.screenQuery.addEventListener('change',this.screenChanged)
    // #endif
  },
  onShow(){this.visible=true;this.desktop=isDesktopChat();if(this.desktop)this.$nextTick(this.openDock)},
  onHide(){this.visible=false},onUnload(){this.visible=false;this.screenQuery?.removeEventListener('change',this.screenChanged)},
  methods:{openDock(){requestDesktopChat(this.conversationId)},screenChanged(event){this.desktop=event.matches;if(this.desktop&&this.visible)this.openDock()}}
}
</script>
<style scoped>.desktop-chat-page-note{min-height:70vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px;font-size:18px;color:#617b9b}.desktop-chat-page-note button{background:#164786;color:#fff;font-size:16px;padding:0 24px;line-height:46px;border-radius:12px}.desktop-chat-page-note>text+text{font-size:14px}</style>
