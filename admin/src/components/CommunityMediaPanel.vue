<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { apiBlob, accessToken } from '../lib/api.js'
const props = defineProps({ images: { type: Array, default: () => [] }, mentions: { type: Array, default: () => [] } })
const photos = ref([])
let version = 0
function clear() { version++; photos.value.forEach(photo => { if (photo.src) URL.revokeObjectURL(photo.src) }); photos.value = [] }
async function load() {
  clear(); const current = version; const token = accessToken()
  photos.value = props.images.slice(0, 9).map(image => ({ id: image.id, src: '', error: false }))
  for (let index = 0; index < photos.value.length; index++) {
    try { const blob = await apiBlob(`/business/community-media/${encodeURIComponent(photos.value[index].id)}`, { token }); if (current !== version || token !== accessToken()) return; photos.value[index].src = URL.createObjectURL(blob) }
    catch { if (current !== version || token !== accessToken()) return; photos.value[index].error = true }
  }
}
watch(() => props.images, load, { immediate: true, deep: true })
onBeforeUnmount(clear)
</script>
<template>
  <section v-if="images.length || mentions.length" class="community-media-panel">
    <h3>动态图片与提及人员</h3>
    <p v-if="mentions.length">{{ mentions.map(person => '@' + person.name).join('、') }}</p>
    <div class="community-media-grid"><a v-for="(photo,index) in photos" :key="photo.id" :href="photo.src || undefined" target="_blank" rel="noopener"><img v-if="photo.src" :src="photo.src" :alt="'动态图片 ' + (index + 1)" /><span v-else>{{ photo.error ? '图片不可用' : '加载中…' }}</span></a></div>
    <p>图片仅用于内容管理，关闭详情后会释放临时预览。</p>
  </section>
</template>
<style scoped>
.community-media-panel{margin:18px 0;padding:20px;border:1px solid #dae4f0;border-radius:12px}.community-media-panel h3{font-size:16px;margin:0 0 12px}.community-media-panel p{font-size:14px;color:#62768e;line-height:1.7;overflow-wrap:anywhere}.community-media-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.community-media-grid a{display:block;aspect-ratio:1;background:#eef3fa;border-radius:10px;overflow:hidden}.community-media-grid img{width:100%;height:100%;object-fit:cover}.community-media-grid span{font-size:14px;padding:12px;display:block}
</style>
