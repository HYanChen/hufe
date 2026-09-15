<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { api, apiBlob, accessToken } from '../lib/api.js'
const props = defineProps({ organizationId: { type: String, required: true } })
const albums = ref([]), photos = ref([]), total = ref(0), photoTotal = ref(0), page = ref(0), photoPage = ref(0), selected = ref(null), loading = ref(false), busy = ref(false), error = ref(''), pending = ref(null), reason = ref('')
let version = 0
const base = () => `/admin/organizations/${encodeURIComponent(props.organizationId)}`
function clearPhotos() { photos.value.forEach(photo => { if (photo.src) URL.revokeObjectURL(photo.src) }); photos.value = [] }
async function load(reset = true) {
  const current = version, token = accessToken(), next = reset ? 1 : page.value + 1
  loading.value = true; error.value = ''
  try { const result = await api(`${base()}/albums?page=${next}&pageSize=12`); if (current !== version || token !== accessToken()) return; albums.value = reset ? result.items : [...albums.value, ...result.items]; total.value = result.total; page.value = next }
  catch (e) { if (current === version) error.value = e.message }
  finally { if (current === version) loading.value = false }
}
async function openAlbum(album, reset = true) {
  const current = ++version, token = accessToken(), next = reset ? 1 : photoPage.value + 1
  selected.value = album; loading.value = true; error.value = ''; if (reset) { clearPhotos(); photoPage.value = 0; photoTotal.value = 0 }
  try {
    const result = await api(`${base()}/albums/${encodeURIComponent(album.id)}/photos?page=${next}&pageSize=12`)
    if (current !== version || token !== accessToken()) return
    photoPage.value = next; photoTotal.value = result.total
    const added = result.items.map(photo => ({ ...photo, src: '', imageError: false }))
    photos.value = [...photos.value, ...added]
    for (const photo of added) {
      try { const blob = await apiBlob(`/admin/organization-album-photos/${encodeURIComponent(photo.id)}`); if (current !== version || token !== accessToken()) return; photo.src = URL.createObjectURL(blob) }
      catch { if (current === version) photo.imageError = true }
    }
  } catch (e) { if (current === version) error.value = e.message }
  finally { if (current === version) loading.value = false }
}
function promptAction(kind, item) { pending.value = { kind, item, action: item.status === 'offline' ? 'publish' : 'unpublish' }; reason.value = '' }
async function submitAction() {
  if (!pending.value || busy.value || !reason.value.trim()) return
  const current = version, token = accessToken(), action = pending.value
  busy.value = true; error.value = ''
  try {
    await api(`${base()}/${action.kind === 'photo' ? 'album-photos' : 'albums'}/${encodeURIComponent(action.item.id)}/actions`, { method: 'POST', body: { action: action.action, reason: reason.value } })
    if (current !== version || token !== accessToken()) return
    pending.value = null
    if (selected.value) await openAlbum(selected.value)
    await load()
  } catch (e) { if (current === version) error.value = e.message }
  finally { busy.value = false }
}
function back() { version++; selected.value = null; pending.value = null; clearPhotos(); load() }
watch(() => props.organizationId, () => { version++; clearPhotos(); selected.value = null; albums.value = []; pending.value = null; load() }, { immediate: true })
onBeforeUnmount(() => { version++; clearPhotos() })
</script>
<template>
  <section class="organization-albums-panel">
    <h3>用户共建相册</h3><p>所有实名用户均可新建相册和上传照片；可下架相册或单张照片，操作记录保留在审计日志中。</p>
    <button v-if="selected" class="button button-secondary" type="button" :disabled="busy" @click="back">返回相册列表</button>
    <div v-if="pending" class="album-moderation"><strong>{{ pending.action === 'unpublish' ? '下架' : '恢复' }}{{ pending.kind === 'photo' ? '照片' : '相册' }}</strong><label>处理原因（必填）<textarea v-model="reason" maxlength="300" placeholder="请填写处理原因" /></label><div><button class="button button-ghost" type="button" :disabled="busy" @click="pending = null">取消</button><button class="button button-primary" type="button" :disabled="busy || !reason.trim()" @click="submitAction">确认处理</button></div></div>
    <template v-if="!selected"><div v-for="album in albums" :key="album.id" class="album-admin-row"><div><strong>{{ album.title }}</strong><p>{{ album.authorName }} · {{ album.photoCount }} 张 · {{ album.status === 'offline' ? '已下架' : '公开展示' }}</p><small v-if="album.moderationReason">处理原因：{{ album.moderationReason }}</small></div><div><button class="button button-secondary" type="button" :disabled="busy || loading" @click="openAlbum(album)">查看照片</button><button class="button button-ghost" type="button" :disabled="busy" @click="promptAction('album', album)">{{ album.status === 'offline' ? '恢复相册' : '下架相册' }}</button></div></div><button v-if="albums.length < total" class="button button-secondary" type="button" :disabled="loading" @click="load(false)">更多相册</button><p v-if="!loading && !albums.length && !error">暂无用户创建的相册。</p></template>
    <template v-else><h4>{{ selected.title }}</h4><div class="album-admin-grid"><article v-for="photo in photos" :key="photo.id"><a v-if="photo.src" :href="photo.src" target="_blank" rel="noopener"><img :src="photo.src" :alt="photo.caption || '组织照片'" /></a><p v-else>{{ photo.imageError ? '图片暂时无法预览' : '读取图片中…' }}</p><strong>{{ photo.caption || '相聚留影' }}</strong><p>{{ photo.authorName }} · {{ photo.status === 'offline' ? '已下架' : '公开展示' }}</p><small v-if="photo.moderationReason">{{ photo.moderationReason }}</small><button class="button button-secondary" type="button" :disabled="busy" @click="promptAction('photo', photo)">{{ photo.status === 'offline' ? '恢复照片' : '下架照片' }}</button></article></div><p v-if="!photos.length && !loading">相册内暂无照片。</p><button v-if="photos.length < photoTotal" class="button button-secondary" type="button" :disabled="loading" @click="openAlbum(selected, false)">更多照片</button></template>
    <p v-if="loading">正在加载…</p><p v-if="error" class="album-admin-error" role="alert">{{ error }} <button class="button button-ghost" type="button" :disabled="loading" @click="selected ? openAlbum(selected) : load()">重试</button></p>
  </section>
</template>
<style scoped>
.organization-albums-panel{margin:20px 0;padding:20px;border:1px solid #dbe4ef;border-radius:14px;flex-shrink:0;min-width:0}.organization-albums-panel h3{margin:0;font-size:18px}.organization-albums-panel p{font-size:14px;line-height:1.7;color:#6a7d94}.album-admin-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid #e6ecf3;flex-wrap:wrap}.album-admin-row>div{min-width:0}.album-admin-row strong,.album-admin-grid strong{overflow-wrap:anywhere}.album-admin-row>div:last-child{display:flex;gap:8px;flex-wrap:wrap}.album-admin-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.album-admin-grid article{min-width:0;border:1px solid #e1e8f0;padding:12px;border-radius:12px;overflow-wrap:anywhere}.album-admin-grid img{width:100%;height:130px;object-fit:cover;border-radius:8px}.album-admin-grid button{margin-top:8px}.album-moderation{padding:16px;background:#f0f5fc;border-radius:12px;margin:16px 0}.album-moderation label{display:block;margin:12px 0}.album-moderation textarea{display:block;width:100%;box-sizing:border-box;min-height:80px;margin-top:8px;padding:10px}.album-admin-error{color:#a33434!important}@media(max-width:700px){.album-admin-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.organization-albums-panel{padding:14px}}
</style>
