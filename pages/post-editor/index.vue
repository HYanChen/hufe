<template>
  <view class="page-shell wall-editor">
    <view class="wall-heading"><text class="wall-eyebrow">HUFE · 校园墙</text><text class="wall-title">把想说的，分享给湖财人</text><text class="wall-muted">实名账号参与 · 可选择匿名展示</text></view>
    <view v-if="!verified" class="wall-compose"><text>登录实名认证账号后，可以发布文字、图片并 @校友。</text><button class="primary-button" @tap="login">登录 / 实名认证</button></view>
    <view v-else class="wall-layout">
      <view class="wall-compose">
        <view class="wall-author"><view class="wall-avatar">{{ anonymous ? '匿' : initials }}</view><view><text>{{ anonymous ? '匿名湖财人' : user.realName || user.name || '湖财人' }}</text><text class="wall-muted">{{ anonymous ? '发布时随机分配昵称与头像' : user.college || user.department || '湖南财政经济学院' }}</text></view></view>
        <view class="wall-anonymous"><view><text>匿名发帖</text><text>使用随机昵称与头像</text></view><switch :checked="anonymous" :disabled="submitting" color="#124789" aria-label="匿名发帖" @change="anonymous = $event.detail.value" /></view>
        <text v-if="anonymous" class="wall-anonymous-note">匿名后无法通过编辑改回实名。正文、照片及图片元数据仍可能包含身份信息，请自行检查后发布。</text>
        <textarea v-model="content" class="wall-input" maxlength="2000" :disabled="submitting" :show-confirm-bar="false" placeholder="此刻的心动、校园日常、失物招领，或一个想问大家的问题……输入 #话题，或在下方添加图片和 @人员" @input="onContentInput" />
        <view class="wall-toolbar"><button :disabled="busy || images.length >= 9" @tap="addImages">▧ 图片 {{ images.length }}/9</button><button :disabled="submitting" @tap="panel = panel === 'topics' ? '' : 'topics'"># 话题</button><button :disabled="submitting" @tap="panel = panel === 'people' ? '' : 'people'">@ 人员</button><text class="wall-counter">{{ content.length }}/2000</text></view>
        <view v-if="images.length" class="wall-photos">
          <view v-for="(image,index) in images" :key="image.key || image.id" class="wall-photo"><image v-if="image.src" :src="image.src" mode="aspectFill" @tap="previewImage(index)" /><text v-if="image.uploading || image.error" class="wall-image-status">{{ image.error || '上传中…' }}</text><button :disabled="busy" :aria-label="'删除第' + (index + 1) + '张图片'" @tap="removeImage(index)">×</button></view>
        </view>
        <view v-if="topics.length" class="wall-selected"><button v-for="topic in topics" :key="topic" :disabled="submitting" @tap="topics = topics.filter(item => item !== topic)">#{{ topic }} ×</button></view>
        <view v-if="mentions.length" class="wall-selected"><button v-for="person in mentions" :key="person.id" :disabled="submitting" @tap="mentions = mentions.filter(item => item.id !== person.id)">@{{ person.name }} ×</button></view>
        <view v-if="panel === 'topics'" class="wall-picker">
          <view class="wall-picker-head"><text>添加话题 · 最多 5 个</text><button @tap="panel = ''">收起</button></view>
          <view class="wall-search"><input v-model="topicInput" maxlength="22" placeholder="输入新话题，例如：湖财摄影搭子" @confirm="addTopic(topicInput)" /><button @tap="addTopic(topicInput)">添加</button></view>
          <view class="wall-suggestions"><button v-for="topic in suggestedTopics" :key="topic" @tap="addTopic(topic)">#{{ topic }}</button></view>
          <text class="wall-muted">正文中的 #话题也会自动加入，支持中英文、数字和下划线。</text>
        </view>
        <view v-if="panel === 'people'" class="wall-picker">
          <view class="wall-picker-head"><text>@实名人员 · 最多 10 人</text><button @tap="panel = ''">收起</button></view>
          <view class="wall-search"><input v-model="peopleQuery" maxlength="40" placeholder="输入至少 2 个字的姓名或学院" @input="scheduleSearch" @confirm="searchPeople" /><button :disabled="peopleLoading" @tap="searchPeople">搜索</button></view>
          <text v-if="peopleLoading" class="wall-muted">正在搜索…</text><text v-else-if="searched && !people.length" class="wall-muted">未找到匹配的实名用户，请换个关键词。</text>
          <button v-for="person in people" :key="person.id" class="wall-person" :disabled="mentions.some(item => item.id === person.id)" @tap="addMention(person)"><view><text>{{ person.name }}</text><text class="wall-muted">{{ person.department || '学院信息未公开' }}</text></view><text>{{ mentions.some(item => item.id === person.id) ? '已选择' : '@提及' }}</text></button>
          <text class="wall-muted">选择真实账号后才会发送提醒，单独输入姓名不会冒充提及。</text>
        </view>
        <view class="wall-options"><text>谁可以看</text><picker :range="visibilityOptions" range-key="label" :value="visibilityIndex" @change="visibilityIndex = Number($event.detail.value)"><view class="wall-visibility">{{ visibilityOptions[visibilityIndex].label }} ▾</view></picker></view>
        <text v-if="error" class="wall-error">{{ error }}</text>
        <view class="wall-actions"><button class="secondary-button" :disabled="busy" @tap="saveDraft">保存草稿</button><button class="primary-button" :loading="submitting" :disabled="!canSubmit" @tap="publish">{{ restoring ? '正在恢复草稿图片' : uploading ? '图片上传中' : '发布到湖财圈' }}</button></view>
      </view>
      <view class="wall-tips"><text class="wall-tips-title">每一种校园生活，都值得被看见</text><view><text>#校园表白</text><text>认真表达心意，尊重对方的感受。</text></view><view><text>#校园日常</text><text>一张照片，也能留住在湖财的时光。</text></view><view><text>#失物招领</text><text>写清地点与物品，避免公开证件号码。</text></view><text class="wall-tips-foot">最多 9 张图片，单张不超过 500MB。草稿图片保留 7 天。仅向所选范围内的实名用户展示，管理员可下架不当内容。</text></view>
    </view><SupportFooter />
  </view>
</template>
<script>
import { publishCommunityPost, searchCommunityPeople } from '../../services/business'
import { chooseImageFiles } from '../../services/privateMaterials'
import { uploadCommunityImage, removeCommunityImage, loadCommunityImage } from '../../services/communityMedia'
import { getAccessToken, getUser, isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'
import { communityDraftKey, normalizeCommunityTopics, extractCommunityTopics, suggestedCommunityTopics } from '../../shared/community'
import { isModuleEnabled } from '../../services/modules'
export default {
  data() { return { user: {}, owner: '', ownerToken: '', verified: false, anonymous: false, content: '', topics: [], topicInput: '', mentions: [], images: [], panel: '', peopleQuery: '', people: [], searched: false, peopleLoading: false, searchVersion: 0, searchTimer: null, version: 0, submitting: false, uploading: false, restoring: false, error: '', suggestedTopics: suggestedCommunityTopics, visibilityIndex: 0, visibilityOptions: [{ value: 'all', label: '全体实名用户' }, { value: 'campus', label: '在校师生员工' }, { value: 'alumni', label: '校友' }] } },
  computed: { initials() { return String(this.user.realName || this.user.name || '湖财').slice(-2) }, busy() { return this.submitting || this.uploading || this.restoring }, canSubmit() { return isModuleEnabled('community') && this.verified && !this.busy && (this.content.trim().length > 0 || this.images.some(image => image.id)) && this.images.every(image => image.id && !image.error) } },
  onLoad() { uni.$on('hufe-auth-changed', this.syncAccount); this.syncAccount() }, onShow() { this.syncAccount() }, onUnload() { this.preserveDraftForDisabledModule();this.clear(); uni.$off('hufe-auth-changed', this.syncAccount) },
  methods: {
    preserveDraftForDisabledModule() {
      if(isModuleEnabled('community') || !this.owner || this.owner!==getUser()?.id || this.ownerToken!==getAccessToken())return false
      const draft=this.draftData()
      if(!draft.content.trim()&&!draft.images.length&&!draft.topics.length&&!draft.mentions.length)return false
      try{uni.setStorageSync(communityDraftKey(this.owner),draft);return true}
      catch{uni.showToast({title:'本机存储不足，草稿保存失败',icon:'none'});return false}
    },
    login() { openPage('/pages/verify/index') },
    clear() { this.version++; this.searchVersion++; clearTimeout(this.searchTimer); this.images.forEach(image => image.dispose?.()); this.content = ''; this.anonymous = false; this.topics = []; this.topicInput = ''; this.mentions = []; this.images = []; this.people = []; this.peopleQuery = ''; this.panel = ''; this.error = ''; this.uploading = false; this.submitting = false; this.restoring = false; this.peopleLoading = false; this.searched = false; this.visibilityIndex = 0 },
    draftData() { return { anonymous: this.anonymous, content: this.content, topics: [...this.topics], mentions: this.mentions.map(person => ({ id: person.id, name: person.name })), images: this.images.filter(image => image.id).map(image => ({ id: image.id })), visibilityIndex: this.visibilityIndex } },
    async syncAccount() {
      const token = getAccessToken(); this.user = getUser(); this.verified = isVerified() && Boolean(token); const owner = this.verified ? this.user.id : ''
      if (owner === this.owner && token === this.ownerToken) return
      // 同一账号换令牌时保留当前输入，跨账号只恢复该账号自己的草稿。
      let draft = owner && owner === this.owner ? this.draftData() : null
      this.clear(); this.owner = owner; this.ownerToken = token
      if (!owner) return
      if (!draft) try { draft = uni.getStorageSync(communityDraftKey(owner)) } catch {}
      if (!draft || typeof draft !== 'object') return
      this.anonymous = draft.anonymous === true
      this.content = String(draft.content || '').slice(0, 2000); this.topics = (Array.isArray(draft.topics) ? draft.topics : []).filter(item => typeof item === 'string').slice(0, 5); this.mentions = (Array.isArray(draft.mentions) ? draft.mentions : []).filter(person => person && typeof person.id === 'string' && typeof person.name === 'string').slice(0, 10); this.visibilityIndex = [0,1,2].includes(draft.visibilityIndex) ? draft.visibilityIndex : 0
      const version = this.version
      this.images = [...new Set((Array.isArray(draft.images) ? draft.images : []).map(image => image?.id).filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id)))].slice(0, 9).map(id => ({ id, src: '', error: '' }))
      this.restoring = this.images.length > 0
      try {
        for (const id of this.images.map(image => image.id)) {
          try {
            const result = await loadCommunityImage(id, token)
            if (version !== this.version || token !== getAccessToken()) { result.dispose(); return }
            const index = this.images.findIndex(image => image.id === id)
            if (index < 0) result.dispose(); else this.images[index] = { ...this.images[index], ...result }
          } catch {
            if (version !== this.version || token !== getAccessToken()) return
            const image = this.images.find(image => image.id === id)
            if (image) image.error = '图片已过期或不可用，请移除重选'
          }
        }
      } finally { if (version === this.version) this.restoring = false }
    },
    addTopic(value) { try { this.topics = normalizeCommunityTopics([...this.topics, value]); this.topicInput = ''; this.error = '' } catch (error) { this.error = error.message } },
    onContentInput() { const match = this.content.match(/@([^@\s]{0,20})$/u); if (match) { this.panel = 'people'; this.peopleQuery = match[1]; this.scheduleSearch() } },
    scheduleSearch() { this.searchVersion++; clearTimeout(this.searchTimer); this.people = []; this.searched = false; this.searchTimer = setTimeout(() => this.searchPeople(), 350) },
    async searchPeople() {
      clearTimeout(this.searchTimer); const query = this.peopleQuery.trim(); const version = ++this.searchVersion; const token = getAccessToken(); this.people = []; this.searched = false
      if (query.length < 2) { this.peopleLoading = false; return } this.peopleLoading = true
      try { const result = await searchCommunityPeople(query); if (version !== this.searchVersion || token !== getAccessToken()) return; this.people = result.items; this.searched = true; this.error = '' }
      catch (error) { if (version === this.searchVersion) this.error = error.message || '搜索失败，请重试' } finally { if (version === this.searchVersion) this.peopleLoading = false }
    },
    addMention(person) { if (this.mentions.some(item => item.id === person.id)) return; if (this.mentions.length >= 10) { this.error = '每条动态最多提及 10 人'; return } this.mentions.push({ id: person.id, name: person.name }); if (/@([^@\s]{0,20})$/u.test(this.content)) this.content = this.content.replace(/@([^@\s]{0,20})$/u, '@' + person.name + ' '); this.error = '' },
    async addImages() {
      if (this.busy || this.images.length >= 9) return
      const version = this.version; const token = getAccessToken(); this.uploading = true; this.error = ''
      try {
        const files = await chooseImageFiles({ count: 9 - this.images.length, label: '动态图片', materialType: 'community-post' }); if (version !== this.version || token !== getAccessToken()) return
        for (const file of files.slice(0, 9 - this.images.length)) {
          const item = { key: Date.now() + '-' + this.images.length, id: '', src: file.localPath, uploading: true, error: '' }; this.images.push(item)
          try { const uploaded = await uploadCommunityImage(file, token); if (version !== this.version || token !== getAccessToken()) return; const index = this.images.findIndex(image => image.key === item.key); this.images[index] = { ...item, id: uploaded.id, uploading: false } }
          catch (error) { if (version !== this.version) return; this.images = this.images.filter(image => image.key !== item.key); throw error }
        }
      } catch (error) { if (version === this.version) this.error = error.message || '上传失败，请重新选择图片' } finally { if (version === this.version) this.uploading = false }
    },
    async removeImage(index) { if (this.busy || !this.images[index]) return; const image = this.images[index]; const version = this.version; this.uploading = true; try { if (image.id) await removeCommunityImage(image.id).catch(error => { if (error.statusCode !== 404) throw error }); if (version !== this.version) return; image.dispose?.(); this.images = this.images.filter(item => item !== image); this.error = '' } catch (error) { if (version === this.version) this.error = error.message } finally { if (version === this.version) this.uploading = false } },
    previewImage(index) { const src = this.images[index]?.src; if (src) uni.previewImage({ current: src, urls: this.images.map(image => image.src).filter(Boolean) }) },
    saveDraft() { if (!this.owner || this.busy) return; uni.setStorageSync(communityDraftKey(this.owner), this.draftData()); uni.showToast({ title: '草稿已保存到本机', icon: 'success' }) },
    async publish() {
      if (!this.canSubmit) return
      const version = this.version; const token = getAccessToken(); this.submitting = true; this.error = ''
      try {
        const topics = normalizeCommunityTopics([...this.topics, ...extractCommunityTopics(this.content)])
        const result = await publishCommunityPost({ anonymous: this.anonymous, content: this.content.trim(), topics, mediaIds: this.images.map(image => image.id), mentionAccountIds: this.mentions.map(person => person.id), visibility: this.visibilityOptions[this.visibilityIndex].value, showLocation: false })
        if (version !== this.version || token !== getAccessToken()) return
        uni.removeStorageSync(communityDraftKey(this.owner)); this.clear(); uni.showToast({ title: '发布成功', icon: 'success' }); openPage('/pages/community-comments/index?id=' + encodeURIComponent(result.id))
      } catch (error) { if (version === this.version) this.error = error.message || '发布失败，请重试' } finally { if (version === this.version) this.submitting = false }
    }
  }
}
</script>
<style scoped>
.wall-anonymous{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding:14px;background:#f2f6fc;border-radius:12px}.wall-anonymous>view{flex:1;min-width:0}.wall-anonymous text{display:block;font-size:15px;color:#24466f}.wall-anonymous text+text{margin-top:5px;font-size:12px;line-height:1.6;color:#74849a}.wall-anonymous switch{flex-shrink:0}.wall-anonymous-note{display:block;margin-top:10px;font-size:13px;line-height:1.7;color:#85632c}
.wall-editor{width:100%;max-width:1180px;margin:0 auto;padding:22px 16px 40px;box-sizing:border-box}.wall-heading{margin:4px 0 24px}.wall-eyebrow,.wall-title{display:block}.wall-eyebrow{color:#8b6a34;font-size:13px;letter-spacing:2px}.wall-title{margin:8px 0;color:#103663;font-size:26px;font-weight:700}.wall-layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:24px;align-items:start}.wall-compose{min-width:0;padding:28px;background:#fff;border-radius:22px;box-shadow:0 12px 40px #183e6810}.wall-author{display:flex;align-items:center;gap:12px}.wall-avatar{width:46px;height:46px;display:flex;align-items:center;justify-content:center;background:#0b3b85;color:white;border-radius:16px;font-size:16px}.wall-author>view:last-child{min-width:0}.wall-author text{display:block;font-size:16px;overflow-wrap:anywhere}.wall-muted,.wall-author .wall-muted{display:block;color:#778396;font-size:13px;line-height:1.7}.wall-input{width:100%;height:230px;margin-top:22px;box-sizing:border-box;font-size:17px;line-height:1.8;color:#24364c}.wall-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;border-top:1px solid #edf1f6;padding-top:16px}.wall-toolbar button{font-size:14px;color:#154d8d;border-radius:10px;padding:7px 10px;margin:0;line-height:1.7;background:#edf4ff}.wall-toolbar button::after,.wall-selected button::after,.wall-picker button::after{border:0}.wall-counter{margin-left:auto;color:#7b8799;font-size:13px}.wall-photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:20px}.wall-photo{position:relative;height:0;padding-top:100%;border-radius:12px;overflow:hidden;background:#edf1f6}.wall-photo image{position:absolute;inset:0;width:100%;height:100%}.wall-photo button{position:absolute;top:4px;right:4px;width:30px;height:30px;padding:0;margin:0;border-radius:50%;background:#15314bbd;color:white;line-height:28px;font-size:22px}.wall-image-status{position:absolute;bottom:0;left:0;right:0;background:#163049b3;color:#fff;font-size:12px;padding:8px}.wall-selected{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.wall-selected button{margin:0;padding:4px 10px;background:#edf4ff;color:#174e93;font-size:14px;line-height:1.7;border-radius:8px;max-width:100%;overflow-wrap:anywhere}.wall-picker{margin-top:20px;padding:18px;border-radius:14px;background:#f6f8fc;border:1px solid #e4ebf5}.wall-picker-head{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600}.wall-picker-head button{margin:0;padding:0;background:transparent;color:#6c7c92;font-size:13px;line-height:1.5}.wall-search{display:flex;gap:10px;margin:14px 0;align-items:center}.wall-search input{flex:1;min-width:0;height:42px;background:white;border-radius:8px;padding:0 12px;font-size:14px}.wall-search button{margin:0;padding:0 14px;line-height:42px;height:42px;font-size:14px;color:white;background:#0b3b85;border-radius:8px}.wall-suggestions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.wall-suggestions button{margin:0;padding:5px 8px;background:#e9eff9;color:#315681;font-size:13px;line-height:1.6}.wall-person{display:flex;justify-content:space-between;align-items:center;text-align:left;padding:12px 0;margin:0;border-bottom:1px solid #e2e8f1;background:none;line-height:1.6;font-size:14px;color:#17477f}.wall-person>view{min-width:0;flex:1}.wall-person text{overflow-wrap:anywhere}.wall-options{display:flex;align-items:center;justify-content:space-between;margin-top:22px;padding:18px 0;border-top:1px solid #edf1f6;font-size:14px;color:#6d7e94}.wall-visibility{color:#284f7b;padding:8px;border-radius:8px;background:#f6f8fb}.wall-actions{display:flex;gap:12px;justify-content:flex-end;margin-top:10px}.wall-actions button{margin:0;font-size:16px;padding:0 20px}.wall-actions .primary-button{flex:1;max-width:270px}.wall-error{display:block;padding:12px 0;color:#b03535;font-size:14px;line-height:1.7}.wall-tips{padding:24px;background:#eaf1fb;border-radius:20px;color:#325374}.wall-tips-title{display:block;font-size:17px;font-weight:600;line-height:1.6}.wall-tips>view{margin-top:24px}.wall-tips>view text{display:block;font-size:14px;line-height:1.8}.wall-tips>view text:first-child{color:#164784;font-weight:600;margin-bottom:3px}.wall-tips-foot{display:block;border-top:1px solid #d4e0f0;margin-top:24px;padding-top:18px;font-size:13px;line-height:1.8;color:#6e8099}button[disabled]{opacity:.5}@media(max-width:900px){.wall-layout{grid-template-columns:minmax(0,1fr)}.wall-tips{display:none}.wall-editor{max-width:720px}}@media(max-width:520px){.wall-editor{padding:16px 12px 32px}.wall-title{font-size:22px}.wall-compose{padding:20px 16px;border-radius:18px}.wall-input{height:220px;font-size:16px}.wall-toolbar{gap:7px}.wall-toolbar button{padding:7px;font-size:14px}.wall-counter{width:100%;text-align:right}.wall-actions button{padding:0 14px}.wall-picker{padding:14px}}
</style>
