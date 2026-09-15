<template>
  <view class="wall-body">
    <text v-if="post.content" class="wall-body__text">{{ post.content }}</text>
    <view v-if="topics.length" class="wall-body__tags"><button v-for="topic in topics" :key="topic" @tap="openTopic(topic)">#{{ topic }}</button></view>
    <view v-if="post.mentions?.length" class="wall-body__mentions"><text v-for="person in post.mentions" :key="person.id">@{{ person.name }}</text></view>
    <view v-if="post.images?.length" class="wall-photos" :class="{ 'wall-photos--single': post.images.length === 1, 'wall-photos--four': post.images.length === 4 }">
      <view v-for="(photo, index) in photos" :key="photo.id" class="wall-photo" @tap="preview(index)">
        <image v-if="photo.src" :src="photo.src" mode="aspectFill" :aria-label="`动态图片 ${index + 1}`" />
        <button v-else class="wall-photo__retry" @tap.stop="load">{{ photo.error ? '图片加载失败 · 重试' : '图片加载中…' }}</button>
      </view>
    </view>
  </view>
</template>
<script>
import { postTopics } from '../shared/community'
import { loadCommunityImage } from '../services/communityMedia'
import { getAccessToken } from '../utils/store'
import { openPage } from '../utils/nav'
export default {
  props: { post: { type: Object, required: true } },
  emits: ['topic'],
  data() { return { photos: [], version: 0 } },
  computed: { topics() { return postTopics(this.post) }, imageKey() { return `${this.post.id || ''}:${this.post.status || ''}:${(this.post.images || []).map(image => image.id).join(',')}` } },
  watch: { imageKey() { this.load() } },
  mounted() { this.load(); uni.$on('hufe-auth-changed', this.load) },
  beforeUnmount() { this.clear(); uni.$off('hufe-auth-changed', this.load) },
  methods: {
    clear() { this.version++; this.photos.forEach((photo) => photo.dispose?.()); this.photos = [] },
    async load() {
      this.clear()
      const version = this.version; const token = getAccessToken()
      this.photos = (this.post.images || []).slice(0, 9).map((image) => ({ id: image.id, src: '', error: false }))
      if (!token) return
      for (let index = 0; index < this.photos.length; index++) {
        try {
          const result = await loadCommunityImage(this.photos[index].id, token)
          if (this.version !== version || token !== getAccessToken()) { result.dispose(); return }
          this.photos[index] = { ...this.photos[index], ...result }
        } catch { if (this.version !== version || token !== getAccessToken()) return; this.photos[index].error = true }
      }
    },
    preview(index) { const current = this.photos[index]?.src; if (current) uni.previewImage({ current, urls: this.photos.map((photo) => photo.src).filter(Boolean) }) },
    openTopic(topic) { uni.setStorageSync('hufe_wall_topic', topic); this.$emit('topic', topic); openPage('/pages/community/index') }
  }
}
</script>
<style scoped>
.wall-body{min-width:0}.wall-body__text{display:block;margin-top:16px;color:#25354c;font-size:16px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.wall-body__tags,.wall-body__mentions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.wall-body__tags button{margin:0;padding:4px 10px;height:auto;line-height:1.6;font-size:14px;color:#124d92;background:#edf4ff;border:0;border-radius:8px;max-width:100%;overflow-wrap:anywhere}.wall-body__tags button::after{border:0}.wall-body__mentions text{font-size:14px;color:#124d92;overflow-wrap:anywhere}.wall-photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:16px;max-width:620px}.wall-photos--single{grid-template-columns:minmax(0,1fr);max-width:460px}.wall-photos--four{grid-template-columns:repeat(2,minmax(0,1fr));max-width:460px}.wall-photo{position:relative;height:0;padding-top:100%;overflow:hidden;border-radius:10px;background:#eef2f8}.wall-photos--single .wall-photo{padding-top:72%}.wall-photo image{position:absolute;inset:0;width:100%;height:100%}.wall-photo__retry{position:absolute;inset:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;white-space:normal;padding:6px;margin:0;color:#758298;font-size:13px;line-height:1.5;border:0;background:transparent}
</style>
