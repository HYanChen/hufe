<template>
  <view class="organization-albums">
    <view class="album-toolbar">
      <view><text class="album-heading">组织相册</text><text class="album-hint">每位实名用户都能新建相册，共同上传相聚的照片</text></view>
      <button class="album-primary" :disabled="busy || choosing" @tap="beginCreate">＋ 新建相册</button>
    </view>
    <view v-if="formOpen" class="album-form">
      <text class="album-heading">{{ editId ? '编辑相册' : '新建相册' }}</text>
      <text class="album-label">相册名称 *</text><input v-model="title" maxlength="60" placeholder="例如：毕业二十周年返校合影" :disabled="busy" aria-label="相册名称" />
      <text class="album-label">相册简介</text><textarea v-model="description" maxlength="300" placeholder="记录这次相聚的时间、地点和故事" :disabled="busy" aria-label="相册简介" />
      <text class="album-hint">相册及照片公开展示，请确认拥有上传权限，勿上传身份证等私密材料。</text>
      <view class="album-actions"><button class="album-secondary" :disabled="busy" @tap="formOpen = false">取消</button><button class="album-primary" :disabled="busy || !title.trim()" @tap="saveAlbum">{{ busy ? '保存中…' : '保存相册' }}</button></view>
    </view>
    <view v-if="selected" class="album-detail">
      <button class="album-link" :disabled="busy || choosing" @tap="backToAlbums">‹ 全部相册</button>
      <view class="album-toolbar"><view><text class="album-heading">{{ selected.title }}</text><text class="album-hint">{{ selected.authorName }} 创建 · {{ photoTotal }} 张照片</text></view><button class="album-primary" :disabled="busy || choosing || queue.length > 0" @tap="choosePhotos">{{ choosing ? '读取图片中…' : '＋ 上传照片' }}</button></view>
      <text v-if="selected.description" class="album-description">{{ selected.description }}</text>
      <view v-if="selected.canEdit" class="album-actions"><button class="album-link" :disabled="busy || choosing" @tap="beginEdit">编辑相册</button><button class="album-danger" :disabled="busy || choosing" @tap="removeContent('album', selected)">删除相册</button></view>
      <view v-if="queue.length" class="album-upload-queue">
        <text class="album-label">待上传照片（每张不超过 500MB，最多 9 张一批）</text>
        <view v-for="(file,index) in queue" :key="index" class="album-upload-row">
          <image v-if="file.localPath" :src="file.localPath" mode="aspectFill" />
          <view><input v-model="file.caption" maxlength="120" placeholder="照片说明" :disabled="busy || file.status === 'done'" :aria-label="'第' + (index + 1) + '张照片说明'" /><text :class="{ 'album-error': file.status === 'error' }">{{ file.status === 'done' ? '已上传' : file.status === 'uploading' ? '上传中…' : file.error || '待上传' }}</text></view>
        </view>
        <view class="album-actions"><button class="album-secondary" :disabled="busy" @tap="queue = []">清空待上传</button><button class="album-primary" :disabled="busy" @tap="uploadPhotos">{{ busy ? '正在上传…' : '上传 / 重试未成功照片' }}</button></view>
      </view>
      <view class="album-photo-grid">
        <view v-for="photo in photos" :key="photo.id" class="album-photo">
          <button class="album-image-button" :aria-label="'预览照片：' + photo.caption" @tap="preview(photo)"><image :src="imageUrl(photo.url)" mode="aspectFill" /><text>{{ photo.caption || '相聚留影' }}</text></button>
          <view class="album-photo-meta"><text>{{ photo.authorName }}</text><button v-if="photo.canDelete" class="album-danger" :disabled="busy" @tap="removeContent('photo', photo)">删除</button></view>
        </view>
      </view>
      <view v-if="!photos.length && !photosLoading && !error" class="album-empty">还没有照片，上传第一张相聚的记忆吧。</view>
      <button v-if="photos.length < photoTotal && !error" class="album-secondary album-more" :disabled="photosLoading" @tap="loadPhotos(false)">查看更多照片（{{ photos.length }}/{{ photoTotal }}）</button>
      <text v-if="photosLoading" class="album-hint">照片加载中…</text>
    </view>
    <template v-else>
      <view class="album-card-grid"><button v-for="album in albums" :key="album.id" class="album-card" :disabled="busy" @tap="selectAlbum(album)"><image v-if="album.cover" :src="imageUrl(album.cover)" mode="aspectFill" /><view v-else class="album-cover-empty">相聚 · 留影</view><view class="album-card-copy"><text class="album-heading">{{ album.title }}</text><text class="album-hint">{{ album.authorName }} · {{ album.photoCount }} 张</text></view></button></view>
      <view v-if="!albums.length && !loading && !error" class="album-empty"><text>相聚的影像，待你我共添</text><text class="album-hint">实名登录后即可新建相册，不需要组织管理员身份。</text></view>
      <button v-if="albums.length < total" class="album-secondary album-more" :disabled="loading" @tap="loadAlbums(false)">查看更多相册（{{ albums.length }}/{{ total }}）</button>
      <text v-if="loading" class="album-hint">相册加载中…</text>
      <view v-if="legacyPhotos.length" class="album-legacy"><text class="album-heading">组织历史照片</text><view class="album-photo-grid"><button v-for="photo in legacyPhotos.slice(0, legacyLimit)" :key="photo.url" class="album-image-button" @tap="previewLegacy(photo)"><image :src="photo.url" mode="aspectFill" /><text>{{ photo.caption }}</text></button></view><button v-if="legacyLimit < legacyPhotos.length" class="album-secondary album-more" @tap="legacyLimit += 12">查看更多历史照片</button></view>
    </template>
    <view v-if="error" class="album-error" role="alert"><text>{{ error }}</text><button class="album-link" :disabled="busy" @tap="selected ? loadPhotos(true) : loadAlbums(true)">重新加载</button></view>
    <text class="album-policy">仅可编辑自己的相册、删除自己上传的照片；其他实名用户也可向公开相册添加照片。管理员可下架不当内容。</text>
  </view>
</template>

<script>
import { listOrganizationAlbums, listAlbumPhotos, saveOrganizationAlbum, uploadAlbumPhoto, deleteAlbumContent, albumImageUrl } from '../services/organizationAlbums'
import { chooseImageFiles } from '../services/privateMaterials'
import { getAccessToken, isVerified } from '../utils/store'
import { openPage } from '../utils/nav'
export default {
  props: { organizationId: { type: String, required: true }, legacyPhotos: { type: Array, default: () => [] }, active: { type: Boolean, default: true } },
  data() { return { albums: [], total: 0, page: 0, loading: false, photos: [], photoTotal: 0, photoPage: 0, photosLoading: false, selected: null, formOpen: false, title: '', description: '', editId: '', createRequestId: '', busy: false, choosing: false, queue: [], error: '', epoch: 0, photoVersion: 0, legacyLimit: 12 } },
  watch: {
    organizationId() { this.reset() },
    active(value) { if (value) { this.loadAlbums(); if (this.selected) this.loadPhotos() } }
  },
  mounted() { uni.$on('hufe-auth-changed', this.reset); this.reset() },
  beforeUnmount() { uni.$off('hufe-auth-changed', this.reset); this.clear() },
  methods: {
    imageUrl: albumImageUrl,
    clear() { this.epoch++; this.photoVersion++; this.albums = []; this.photos = []; this.queue = []; this.selected = null; this.formOpen = false; this.title = ''; this.description = ''; this.editId = ''; this.busy = false; this.choosing = false; this.loading = false; this.photosLoading = false; this.error = ''; this.page = 0; this.photoPage = 0; this.total = 0; this.photoTotal = 0 },
    reset() { this.clear(); if (this.active && this.organizationId) this.loadAlbums() },
    requireIdentity() { if (getAccessToken() && isVerified()) return true; openPage('/pages/verify/index'); return false },
    async loadAlbums(reset = true) {
      if (this.loading || !this.active) return
      const epoch = this.epoch, token = getAccessToken(), page = reset ? 1 : this.page + 1
      this.loading = true; this.error = ''
      try { const result = await listOrganizationAlbums(this.organizationId, page); if (epoch !== this.epoch || token !== getAccessToken()) return; this.albums = reset ? result.items : [...this.albums, ...result.items]; this.total = result.total; this.page = page }
      catch (error) { if (epoch === this.epoch) this.error = error.message || '相册加载失败' }
      finally { if (epoch === this.epoch) this.loading = false }
    },
    selectAlbum(album) { if (this.busy || this.choosing) return; this.selected = album; this.queue = []; this.formOpen = false; this.photos = []; this.photoPage = 0; this.photoTotal = 0; this.loadPhotos() },
    backToAlbums() { if (this.queue.some(file => file.status !== 'done')) { uni.showModal({ title: '照片尚未上传', content: '返回将清空待上传照片，已上传照片不受影响。', success: result => { if (result.confirm) { this.queue = []; this.backToAlbums() } } }); return } this.photoVersion++; this.selected = null; this.formOpen = false; this.queue = []; this.loadAlbums() },
    async loadPhotos(reset = true) {
      if (!this.selected) return
      const epoch = this.epoch, version = ++this.photoVersion, token = getAccessToken(), id = this.selected.id, page = reset ? 1 : this.photoPage + 1
      this.photosLoading = true; this.error = ''
      try { const result = await listAlbumPhotos(this.organizationId, id, page); if (epoch !== this.epoch || version !== this.photoVersion || token !== getAccessToken()) return; this.selected = result.album; this.photos = reset ? result.items : [...this.photos, ...result.items]; this.photoTotal = result.total; this.photoPage = page }
      catch (error) { if (epoch === this.epoch && version === this.photoVersion) { this.error = error.message || '照片加载失败'; if (error.statusCode === 404) { this.photos = []; this.selected = null; this.queue = []; this.loadAlbums() } } }
      finally { if (epoch === this.epoch && version === this.photoVersion) this.photosLoading = false }
    },
    requestId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) },
    beginCreate() { if (!this.requireIdentity() || this.busy || this.choosing) return; if (this.queue.some(file => file.status !== 'done')) { uni.showModal({ title: '还有待上传照片', content: '请先上传照片或清空待上传列表，再新建相册。', showCancel: false }); return } this.createRequestId = this.requestId(); this.editId = ''; this.title = ''; this.description = ''; this.formOpen = true },
    beginEdit() { this.editId = this.selected.id; this.title = this.selected.title; this.description = this.selected.description; this.formOpen = true },
    async saveAlbum() {
      if (this.busy || !this.title.trim() || !this.requireIdentity()) return
      const epoch = this.epoch, token = getAccessToken(); this.busy = true; this.error = ''
      try { const album = await saveOrganizationAlbum(this.organizationId, this.editId, { title: this.title, description: this.description, clientRequestId: this.createRequestId }, token); if (epoch !== this.epoch || token !== getAccessToken()) return; this.formOpen = false; if (this.selected?.id !== album.id) this.queue = []; this.selected = album; this.photos = []; this.photoPage = 0; this.photoTotal = 0; await this.loadPhotos(); await this.loadAlbums() }
      catch (error) { if (epoch === this.epoch && token === getAccessToken()) this.error = error.message || '相册保存失败，填写内容已保留' }
      finally { if (epoch === this.epoch) this.busy = false }
    },
    async choosePhotos() {
      if (!this.requireIdentity() || this.busy || this.choosing || !this.selected) return
      const epoch = this.epoch, token = getAccessToken(), id = this.selected.id; this.choosing = true
      try { const files = await chooseImageFiles({ count: 9, label: '组织公开照片' }); if (epoch !== this.epoch || token !== getAccessToken() || this.selected?.id !== id) return; this.queue = files.map(file => ({ ...file, clientRequestId: this.requestId(), caption: '', status: 'pending', error: '' })) }
      catch (error) { if (epoch === this.epoch) this.error = error.message || '选择照片失败' }
      finally { if (epoch === this.epoch) this.choosing = false }
    },
    async uploadPhotos() {
      if (this.busy || !this.selected || !this.requireIdentity()) return
      const epoch = this.epoch, token = getAccessToken(), organizationId = this.organizationId, albumId = this.selected.id
      this.busy = true; this.error = ''
      try {
        for (const file of this.queue) {
          if (epoch !== this.epoch || token !== getAccessToken()) return
          if (file.status === 'done') continue
          file.status = 'uploading'; file.error = ''
          try { await uploadAlbumPhoto(organizationId, albumId, file, token); if (epoch !== this.epoch || token !== getAccessToken()) return; file.status = 'done'; file.dataBase64 = ''; file.localPath = '' }
          catch (error) { if (epoch !== this.epoch || token !== getAccessToken()) return; file.status = 'error'; file.error = error.message || '上传失败，可重试'; if ([401, 403, 404].includes(error.statusCode)) break }
        }
        if (this.queue.every(file => file.status === 'done')) { this.queue = []; uni.showToast({ title: '照片已上传', icon: 'success' }) }
        await this.loadPhotos(); await this.loadAlbums()
      } finally { if (epoch === this.epoch) this.busy = false }
    },
    removeContent(kind, item) {
      const epoch = this.epoch, token = getAccessToken(), organizationId = this.organizationId
      uni.showModal({ title: kind === 'album' ? '删除这个相册？' : '删除这张照片？', content: kind === 'album' ? '相册中的所有照片（包括他人添加的照片）将不再公开展示。此操作不可撤回。' : '照片将从相册中移除，此操作不可撤回。', confirmColor: '#a53333', success: async result => {
        if (!result.confirm || this.busy || epoch !== this.epoch || token !== getAccessToken()) return
        this.busy = true
        try { await deleteAlbumContent(organizationId, kind, item.id, token); if (epoch !== this.epoch || token !== getAccessToken()) return; if (kind === 'album') { this.selected = null; this.queue = []; this.formOpen = false } else await this.loadPhotos(); await this.loadAlbums() }
        catch (error) { if (epoch === this.epoch) this.error = error.message || '删除失败' }
        finally { if (epoch === this.epoch) this.busy = false }
      } })
    },
    preview(photo) { uni.previewImage({ current: this.imageUrl(photo.url), urls: this.photos.map(item => this.imageUrl(item.url)) }) },
    previewLegacy(photo) { uni.previewImage({ current: photo.url, urls: this.legacyPhotos.map(item => item.url) }) }
  }
}
</script>

<style scoped>
.organization-albums{min-width:0;color:#203b5c}.album-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}.album-toolbar>view{flex:1;min-width:180px}.album-heading{display:block;font-size:20px;font-weight:700;line-height:1.5;overflow-wrap:anywhere}.album-hint{display:block;margin-top:6px;font-size:14px;line-height:1.7;color:#71839b}.organization-albums button{margin:0;font-size:14px;line-height:1.5;border:0}.organization-albums button::after{border:0}.organization-albums button[disabled]{opacity:.5}.album-primary,.album-secondary,.album-danger,.album-link{min-height:44px;padding:10px 16px;border-radius:10px}.album-primary{background:#073880;color:#fff}.album-secondary{background:#eaf0f8;color:#254e7d}.album-danger{background:#faeeee;color:#a33434}.album-link{background:transparent;color:#275690}.album-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:12px}.album-form,.album-upload-queue{padding:18px;margin-top:18px;background:#f4f7fc;border-radius:14px}.album-label{display:block;font-size:15px;font-weight:600;margin:14px 0 8px}.album-form input,.album-form textarea,.album-upload-row input{box-sizing:border-box;width:100%;min-width:0;background:#fff;border:1px solid #dbe4ee;border-radius:10px;padding:12px;font-size:16px;line-height:1.6;height:48px}.album-form textarea{height:110px}.album-detail{margin-top:18px}.album-description{display:block;margin:12px 0;line-height:1.8;font-size:16px;overflow-wrap:anywhere}.album-card-grid,.album-photo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:20px}.album-card,.album-photo{min-width:0;border:1px solid #e1e8f1!important;border-radius:14px;overflow:hidden;background:#fff;text-align:left;padding:0!important}.album-card-copy{padding:14px}.album-card-copy .album-heading{font-size:16px}.album-card image,.album-cover-empty,.album-image-button image{display:block;width:100%;height:145px;background:#eaf0f8}.album-cover-empty{display:flex;align-items:center;justify-content:center;color:#557498;font-size:17px}.album-image-button{display:block;width:100%;padding:0;background:#f4f7fb;text-align:left;overflow:hidden;border-radius:12px}.album-image-button>text{display:block;padding:10px;font-size:14px;overflow-wrap:anywhere;line-height:1.6}.album-photo-meta{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:4px 10px 10px;color:#73869d;font-size:13px;overflow-wrap:anywhere}.album-photo-meta button{padding:8px;flex-shrink:0}.album-empty{padding:32px 12px;text-align:center;font-size:16px;line-height:1.8}.album-more{width:100%;margin-top:18px!important}.album-upload-row{display:flex;gap:12px;align-items:center;margin-top:12px}.album-upload-row image{flex-shrink:0;width:64px;height:64px;border-radius:8px}.album-upload-row>view{min-width:0;flex:1}.album-upload-row text{font-size:14px;line-height:1.8}.album-error{margin-top:16px;color:#a33434;line-height:1.7;overflow-wrap:anywhere}.album-policy{display:block;margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;color:#73869d;font-size:13px;line-height:1.8}.album-legacy{margin-top:24px;padding-top:20px;border-top:1px solid #e2e8f0}@media(min-width:768px){.album-card-grid,.album-photo-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.album-card image,.album-cover-empty,.album-image-button image{height:190px}}@media(min-width:1200px){.album-card-grid,.album-photo-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:420px){.album-toolbar>view{min-width:150px}.album-primary{padding:10px 12px}.album-card-grid,.album-photo-grid{gap:10px}.album-card-copy{padding:10px}.album-heading{font-size:18px}}
</style>
