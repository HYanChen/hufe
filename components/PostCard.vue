<template>
  <view class="post-card surface">
    <view class="post-author">
      <CommunityAvatar :anonymous="post.anonymous === true" :avatar="post.avatar || ''" :initials="post.initials" />
      <view class="post-author__info">
        <text class="post-author__name">{{ post.author }}</text>
        <text class="post-author__meta">{{ post.meta }}</text>
      </view>
      <text class="post-author__time">{{ post.location }} · {{ post.time }}</text>
    </view>
    <CommunityPostBody :post="post" @topic="$emit('topic', $event)" />
    <view class="post-actions">
      <view class="post-action" @tap="$emit('like', post.id)">
        <text class="post-action__icon" :class="{ 'post-action__icon--liked': post.liked }">{{ post.liked ? '♥' : '♡' }}</text>
        <text>{{ post.displayLikeCount }}</text>
      </view>
      <view class="post-action" @tap="$emit('comment', post.id)">
        <text class="post-action__icon">◌</text>
        <text>{{ post.commentCount }}</text>
      </view>
      <button class="post-action post-action--share" open-type="share" :data-post-id="post.id" @tap="share">
        <text class="post-action__icon">↗</text>
        <text>分享</text>
      </button>
    </view>
  </view>
</template>

<script>
import { sharePage } from '../utils/share'
import CommunityPostBody from './CommunityPostBody.vue'
import CommunityAvatar from './CommunityAvatar.vue'
export default {
  name: 'PostCard',
  components: { CommunityPostBody, CommunityAvatar },
  props: {
    post: { type: Object, required: true },
    visualIndex: { type: Number, default: 0 }
  },
  emits: ['like', 'comment', 'topic'],
  methods: { share() { return sharePage(`/pages/community-comments/index?id=${encodeURIComponent(this.post.id)}`, '湖财圈 · 校友动态') } }
}
</script>

<style scoped>
.post-card { padding: 20px; }
.post-author { display: flex; align-items: center; gap: 10px; }
.post-author__avatar {
  width: 42px; height: 42px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  border-radius: 14px; color: #FFFFFF; background: linear-gradient(145deg, #1B4F91, #033481); font-size: 14px; font-weight: 700;
}
.post-author__info { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.post-author__name, .post-author__meta { display: block; }
.post-author__name { font-size: 16px; font-weight: 650; }
.post-author__meta, .post-author__time { color: #7f8a9a; font-size: 12px; line-height: 1.5; }
.post-author__meta { margin-top: 3px; }
.post-author__time { max-width: 100px; align-self: flex-start; margin-top: 2px; text-align: right; overflow-wrap: anywhere; }
.post-actions { margin-top: 16px; padding-top: 14px; display: flex; align-items: center; border-top: 1px solid #EFF1F5; }
.post-action { margin-right: 24px; display: flex; align-items: center; color: #7E8898; font-size: 14px; }
.post-action__icon { margin-right: 6px; color: #718099; font-size: 20px; }
.post-action__icon--liked { color: #B95A55; }
.post-action--share { height: auto; margin: 0 0 0 auto; padding: 0; line-height: 1; background: transparent; }
@media(max-width:520px){.post-card{padding:18px 16px}.post-author__time{max-width:80px}}
</style>
