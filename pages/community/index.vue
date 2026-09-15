<template>
  <view class="page-shell page-shell--tab community-page">
    <view class="community-head"><view><text class="community-head__eyebrow">HUFE · CAMPUS WALL</text><text class="community-head__title">湖财圈 · 校园墙</text><text class="community-head__desc">分享心动与日常，找到同频的湖财人</text></view></view>
    <CommunityHighlights :active="pageVisible" :refresh-key="highlightsVersion" />
    <view class="wall-feed-tools surface"><input v-model="keyword" maxlength="80" placeholder="搜索内容、#话题或发布人" @input="feedLimit = 20" /></view>
    <scroll-view class="topic-scroll" scroll-x :show-scrollbar="false"><view class="topic-row"><view v-for="topic in topics" :key="topic" class="topic-chip" :class="{ 'topic-chip--active': activeTopic === topic }" @tap="chooseTopic(topic)">{{ topic === '全部' ? topic : '#' + topic }}</view></view></scroll-view>
    <view v-if="loading && !posts.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在读取校友动态</text></view>
    <view v-else-if="error && !posts.length" class="community-pending surface"><view class="community-pending__icon">!</view><text class="community-pending__title">湖财圈暂时无法加载</text><text class="community-pending__desc">{{ error }}</text><button class="secondary-button" @tap="loadPosts">重新加载</button></view>
    <view v-else-if="filteredPosts.length" class="post-list"><PostCard v-for="(post,index) in filteredPosts.slice(0, feedLimit)" :key="post.id" :post="post" :visual-index="index" @like="like" @comment="comment" @topic="chooseTopic" /><button v-if="filteredPosts.length > feedLimit" class="secondary-button" @tap="feedLimit += 20">查看更多动态</button></view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">圈</view><text>这个频道还没有公开动态</text></view>
    <SupportFooter />
    <view class="compose-button" @tap="create"><text>＋</text><text>发布</text></view>
  </view>
</template>

<script>
import { loadAllPages } from '../../utils/authPagination'
import PostCard from '../../components/PostCard.vue'
import CommunityHighlights from '../../components/CommunityHighlights.vue'
import { getCommunityPosts, toggleCommunityLike } from '../../services/business'
import { isVerified, getAccessToken } from '../../utils/store'
import { openPage } from '../../utils/nav'
import { postTopics, suggestedCommunityTopics } from '../../shared/community'
export default {
  components: { PostCard, CommunityHighlights },
  data() { return { activeTopic: '全部', posts: [], loading: false, error: '', keyword: '', feedLimit: 20, version: 0, pageVisible: true, highlightsVersion: 0 } },
  computed: {
    topics() { return ['全部', ...[...this.posts.flatMap(postTopics), ...suggestedCommunityTopics].filter((topic, index, items) => items.findIndex(item => item.toLocaleLowerCase() === topic.toLocaleLowerCase()) === index)] },
    filteredPosts() {
      const query = this.keyword.trim().replace(/^#/, '').toLocaleLowerCase()
      return this.posts.filter((post) => (this.activeTopic === '全部' || postTopics(post).some(topic => topic.toLocaleLowerCase() === this.activeTopic.toLocaleLowerCase())) && (!query || [post.content, post.author, ...postTopics(post)].join(' ').toLocaleLowerCase().includes(query)))
    }
  },
  onLoad() { uni.$on('hufe-auth-changed', this.resetAccount) },
  onShow() { this.pageVisible = true; this.highlightsVersion++; const topic = uni.getStorageSync('hufe_wall_topic'); if (topic) { this.activeTopic = topic; uni.removeStorageSync('hufe_wall_topic') } this.loadPosts() },
  onHide() { this.pageVisible = false },
  onUnload() { this.version++; uni.$off('hufe-auth-changed', this.resetAccount) },
  onPullDownRefresh() { this.highlightsVersion++; this.loadPosts().finally(() => uni.stopPullDownRefresh()) },
  onShareAppMessage(event) { const id = event?.target?.dataset?.postId; return { title: '湖财圈', path: id ? `/pages/community-comments/index?id=${encodeURIComponent(id)}` : '/pages/community/index' } },
  methods: {
    chooseTopic(topic) { this.activeTopic = topic; this.feedLimit = 20 },
    resetAccount() { this.version++; this.posts = []; this.activeTopic = '全部'; this.keyword = ''; this.loading = false; this.loadPosts() },
    formatPost(post) {
      const name = post.anonymous === true ? post.authorName || '匿名湖财人' : post.authorName || post.author || '湖财人'
      const createdAt = new Date(post.publishedAt || post.createdAt || '')
      const time = Number.isNaN(createdAt.getTime()) ? (post.time || '') : `${createdAt.getMonth() + 1}月${createdAt.getDate()}日`
      return { ...post, author: name, initials: post.initials || name.slice(-2), meta: post.anonymous === true ? '匿名发布' : post.authorMeta || post.meta || '湖财实名用户', location: post.anonymous === true ? '身份已隐藏' : post.location || '湖财圈', time, liked: Boolean(post.liked), displayLikeCount: Number(post.likeCount || 0), commentCount: Number(post.commentCount || 0) }
    },
    async loadPosts() {
      if (this.loading) return
      const version = ++this.version; const token = getAccessToken()
      this.loading = true; this.error = ''
      try { const result = await loadAllPages(getCommunityPosts); if (version === this.version && token === getAccessToken()) this.posts = result.items.map(this.formatPost) }
      catch (error) { if (version === this.version) { this.posts = []; this.error = error.message || '网络暂时不可用，请稍后重试' } }
      finally { if (version === this.version) this.loading = false }
    },
    async like(id) {
      if (!isVerified()) { openPage('/pages/verify/index'); return }
      const post = this.posts.find((item) => item.id === id)
      if (!post) return
      if (post.liking) return
      const token = getAccessToken(); post.liking = true
      try {
        const result = await toggleCommunityLike(id)
        if (token !== getAccessToken()) return
        const current = this.posts.find(item => item.id === id)
        if (current) { current.liked = result.liked; current.displayLikeCount = result.likeCount; current.likeCount = result.likeCount }
      } catch (error) { if (token === getAccessToken()) uni.showToast({ title: error.message || '操作失败', icon: 'none' }) }
      finally { post.liking = false }
    },
    comment(id) { openPage(`/pages/community-comments/index?id=${encodeURIComponent(id)}`) },
    openOfficial() { openPage('/pages/official-news/index') },
    create() {
      if (!isVerified()) {
        uni.showModal({ title: '需要登录湖财人账号', content: '登录已实名注册的平台账号后即可发布动态。', confirmText: '去登录', success: (res) => { if (res.confirm) openPage('/pages/verify/index') } })
        return
      }
      openPage('/pages/post-editor/index')
    }
  }
}
</script>

<style scoped>
.community-page{padding-top:12rpx}.community-head{position:relative;padding:34rpx 32rpx;overflow:hidden;border-radius:34rpx;color:#FFF;background:linear-gradient(135deg,#17314F,#033481)}.community-head__eyebrow,.community-head__title,.community-head__desc{display:block}.community-head__eyebrow{color:#E0C48A;font-size:18rpx;font-weight:700;letter-spacing:4rpx}.community-head__title{margin-top:14rpx;font-size:40rpx;font-weight:700}.community-head__desc{margin-top:10rpx;color:rgba(255,255,255,.62);font-size:21rpx}.community-head__rings view{position:absolute;border:1rpx solid rgba(255,255,255,.13);border-radius:50%}.community-head__rings view:nth-child(1){width:180rpx;height:180rpx;right:-30rpx;top:-50rpx}.community-head__rings view:nth-child(2){width:100rpx;height:100rpx;right:10rpx;top:-10rpx}.community-head__rings view:nth-child(3){width:18rpx;height:18rpx;right:51rpx;top:31rpx;background:#DFC387}
.topic-scroll{width:calc(100% + 56rpx);margin:30rpx -28rpx 20rpx;white-space:nowrap}.topic-row{padding:0 28rpx;display:inline-flex}.topic-chip{min-width:96rpx;height:62rpx;margin-right:14rpx;padding:0 24rpx;display:flex;align-items:center;justify-content:center;border-radius:20rpx;color:#69758A;background:#FFF;font-size:23rpx}.topic-chip--active{color:#FFF;background:#033481;box-shadow:0 10rpx 22rpx rgba(11,58,130,.2)}.post-list{display:flex;flex-direction:column}.post-list :deep(.post-card){margin-bottom:20rpx}.compose-button{position:fixed;z-index:20;right:32rpx;bottom:calc(92px + env(safe-area-inset-bottom));width:128rpx;height:68rpx;display:flex;align-items:center;justify-content:center;border-radius:99rpx;color:#FFF;background:linear-gradient(135deg,#033481,#1959A2);box-shadow:0 14rpx 30rpx rgba(11,58,130,.28);font-size:22rpx;font-weight:600}.compose-button text:first-child{margin-right:6rpx;font-size:30rpx}
.community-pending{margin-top:26rpx;padding:58rpx 36rpx;text-align:center}.community-pending__icon{width:84rpx;height:84rpx;margin:0 auto;display:flex;align-items:center;justify-content:center;border-radius:26rpx;color:#795a29;background:#f4e7d1;font-size:28rpx;font-weight:700}.community-pending__title,.community-pending__desc{display:block}.community-pending__title{margin-top:24rpx;font-size:30rpx;font-weight:700}.community-pending__desc{margin:13rpx auto 0;max-width:540rpx;color:#7e8999;font-size:21rpx;line-height:1.7}.community-pending .secondary-button{margin-top:30rpx}
</style>
<style scoped>
.community-page{max-width:1120px;margin:0 auto}.wall-feed-tools{margin:12px auto 0;padding:10px 14px;max-width:860px;box-sizing:border-box}.wall-feed-tools input{margin-top:0;background:transparent;padding:4px 0;height:26px;font-size:14px}.topic-row{gap:10px}.topic-chip{margin-right:0;flex-shrink:0;font-size:14px}.topic-scroll{margin-top:18px}.post-list{max-width:860px;margin:0 auto}.community-head__desc{font-size:14px}@media(min-width:961px){.topic-scroll{width:100%;margin-left:0;margin-right:0;white-space:normal}.topic-row{padding:0;display:flex;flex-wrap:wrap}.topic-chip{height:40px;padding:0 16px;min-width:0}.community-head{padding:28px}.community-head__title{font-size:30px}.compose-button{right:max(28px,calc((100vw - 1180px)/2));width:110px;height:46px;font-size:16px}}
</style>
