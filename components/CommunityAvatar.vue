<template><view class="community-avatar" :class="{ 'community-avatar--anonymous': anonymous }" :style="anonymous ? { background: chosen.background } : {}" :aria-label="anonymous ? '匿名头像' : '用户头像'"><text>{{ anonymous ? chosen.symbol : initials }}</text></view></template>
<script>
import { anonymousAvatars } from '../shared/community'
export default {
  props: { anonymous: { type: Boolean, default: false }, avatar: { type: String, default: '' }, initials: { type: String, default: '湖财' } },
  computed: { chosen() { return anonymousAvatars.find(item => item.key === this.avatar) || anonymousAvatars[0] } }
}
</script>
<style scoped>
.community-avatar{width:44px;height:44px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:14px;background:#124789;color:#fff;font-size:15px;font-weight:600}.community-avatar--anonymous{font-size:25px;font-weight:400}
</style>
