<template><ConversationList v-if="!desktop" :active="visible"/><view v-else class="desktop-conversations-note"><text>电脑端对话已移至右下角</text><button @tap="openDock">打开对话窗口</button><text>手机端仍可从底部中间的“对话”进入。</text></view></template>
<script>
import ConversationList from '../../components/ConversationList.vue'
import {DESKTOP_CHAT_QUERY,isDesktopChat,requestDesktopChat} from '../../utils/desktopChat'
export default{
  components:{ConversationList},data:()=>({visible:false,desktop:false,screenQuery:null}),
  onLoad(){this.desktop=isDesktopChat();
    // #ifdef H5
    this.screenQuery=window.matchMedia(DESKTOP_CHAT_QUERY);this.screenQuery.addEventListener('change',this.screenChanged)
    // #endif
  },
  onShow(){this.visible=true;this.desktop=isDesktopChat();if(this.desktop)this.$nextTick(this.openDock)},
  onHide(){this.visible=false},onUnload(){this.visible=false;this.screenQuery?.removeEventListener('change',this.screenChanged)},
  methods:{openDock(){requestDesktopChat()},screenChanged(event){this.desktop=event.matches;if(this.desktop&&this.visible)this.openDock()}}
}
</script>
<style scoped>.desktop-conversations-note{min-height:70vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px;font-size:18px;color:#617b9b}.desktop-conversations-note button{background:#164786;color:#fff;font-size:16px;padding:0 24px;line-height:46px;border-radius:12px}</style>
