<template>
  <view class="page-shell inbox-page">
    <view class="inbox-hero">
      <view>
        <text class="inbox-hero__eyebrow">MESSAGE & PROGRESS</text>
        <text class="inbox-hero__title">消息与办理进度</text>
        <text class="inbox-hero__desc">通知、审核结果与服务办理节点集中到达，不错过每一次状态变化。</text>
      </view>
      <view class="inbox-hero__count"><text>{{ unread }}</text><text>未读</text></view>
    </view>

    <template v-if="!verified">
      <view class="login-guide surface"><view>信</view><text>消息和办理记录仅本人可见，请先登录湖财人账号。</text><button class="primary-button" @tap="open('/pages/verify/index')">去登录</button></view>
    </template>
    <template v-else>
      <view class="inbox-toolbar">
        <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false">
          <view class="filter-row">
            <view v-for="item in filters" :key="item.key" class="filter-chip" :class="{ 'filter-chip--active': filter === item.key }" @tap="filter = item.key">{{ item.label }}<text v-if="item.key === 'unread' && unread">{{ unread }}</text></view>
          </view>
        </scroll-view>
        <text v-if="unread" class="read-all" @tap="readAll">全部已读</text>
      </view>

      <view v-if="loading && !messages.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在同步消息</text></view>
      <view v-else-if="error && !messages.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ error }}</text><button class="secondary-button retry-button" @tap="load">重新加载</button></view>
      <view v-else-if="filteredMessages.length" class="message-list">
        <view v-for="item in filteredMessages" :key="item.id" class="message-card surface" :class="{ 'message-card--unread': !item.read }" @tap="openMessage(item)">
          <view class="message-card__icon" :class="`message-card__icon--${item.kind}`">{{ item.kind === 'interaction' ? '@' : item.kind === 'progress' ? '进' : '知' }}<text v-if="!item.read"></text></view>
          <view class="message-card__body">
            <view class="message-card__head"><text>{{ item.title }}</text><text>{{ timeText(item.createdAt) }}</text></view>
            <text class="message-card__summary">{{ item.summary }}</text>
            <view class="message-card__foot"><text>{{ item.category }}</text><text v-if="item.status">{{ statusLabel(item.status) }}</text><text v-if="item.target">查看详情 ›</text></view>
          </view>
        </view>
      </view>
      <view v-else class="empty-state surface"><view class="empty-state__icon">信</view><text>{{ emptyText }}</text><button v-if="filter !== 'all'" class="secondary-button retry-button" @tap="filter = 'all'">查看全部消息</button></view>

      <view v-if="messages.length" class="inbox-pagination">
        <text v-if="error">{{ error }}</text>
        <button v-if="messages.length < total" class="secondary-button retry-button" :disabled="loading" @tap="load(true)">{{ loading ? '正在加载…' : '加载更多消息' }}</button>
        <text v-else>已显示全部 {{ total }} 条消息</text>
      </view>

      <view class="inbox-note"><text>安</text><view><text>仅展示本人消息</text><text>办理结果以对应业务详情和学校后台审核记录为准，平台不会通过消息索取密码或验证码。</text></view></view>
    </template>

    <BusinessDetailSheet
      :open="Boolean(selectedMessage)"
      :title="selectedMessage ? selectedMessage.title : ''"
      :subtitle="selectedMessage ? messageDetailSubtitle(selectedMessage) : ''"
      eyebrow="MESSAGE DETAILS"
      :show-actions="Boolean(selectedMessage && selectedMessage.target)"
      @close="selectedMessage = null"
    >
      <template v-if="selectedMessage">
        <view class="message-detail__meta">
          <text>{{ selectedMessage.category }}</text>
          <text v-if="selectedMessage.status">{{ statusLabel(selectedMessage.status) }}</text>
        </view>
        <text class="message-detail__body" selectable user-select>{{ selectedMessage.body || '暂无更多消息内容' }}</text>
      </template>
      <template #actions>
        <button v-if="selectedMessage && selectedMessage.target" class="primary-button" @tap="openSelectedTarget">查看相关详情</button>
      </template>
    </BusinessDetailSheet>

    <SupportFooter />
  </view>
</template>

<script>
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import { getMyInbox, markAllInboxMessagesRead, markInboxMessageRead } from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessDetailSheet },
  data() {
    return {
      verified: false, messages: [], unread: 0, filter: 'all', loading: false, error: '', selectedMessage: null,
      page: 0, total: 0, requestVersion: 0, authVersion: 0, markingIds: [],
      filters: [
        { key: 'all', label: '全部' },
        { key: 'unread', label: '未读' },
        { key: 'interaction', label: '互动 / @我' },
        { key: 'notice', label: '通知' },
        { key: 'progress', label: '办理进度' }
      ]
    }
  },
  computed: {
    filteredMessages() {
      if (this.filter === 'unread') return this.messages.filter((item) => !item.read)
      if (['notice', 'progress', 'interaction'].includes(this.filter)) return this.messages.filter((item) => item.kind === this.filter)
      return this.messages
    },
    emptyText() {
      return ({ unread: '没有未读消息', notice: '暂无平台通知', progress: '暂无办理进度消息', interaction: '暂无互动或提及消息' })[this.filter] || '暂时没有消息'
    }
  },
  watch: {
    filter() { if (this.verified) this.load() }
  },
  onLoad(options = {}) {
    if (['all', 'unread', 'notice', 'progress', 'interaction'].includes(options.filter)) this.filter = options.filter
    uni.$on('hufe-auth-changed', this.syncAuth)
  },
  onShow() { this.syncAuth() },
  onUnload() { uni.$off('hufe-auth-changed', this.syncAuth); this.requestVersion += 1; this.authVersion += 1 },
  onReachBottom() { if (this.verified && this.messages.length < this.total) this.load(true) },
  onPullDownRefresh() {
    const task = this.verified ? this.load() : Promise.resolve()
    task.finally(() => uni.stopPullDownRefresh())
  },
  methods: {
    syncAuth() {
      this.authVersion += 1
      this.verified = isVerified()
      this.requestVersion += 1
      this.loading = false
      this.messages = []
      this.selectedMessage = null
      this.total = 0
      this.unread = 0
      if (this.verified) return this.load()
    },
    normalize(item = {}) {
      const rawType = String(item.kind || item.messageType || item.type || item.category || '').toLowerCase()
      const progressType = /business|notification|submission|progress|application|review|status/.test(rawType)
      const kind = rawType === 'interaction' || item.type === 'community.mention' ? 'interaction' : rawType === 'announcement' ? 'notice' : (progressType ? 'progress' : 'notice')
      const body = markdownToPlainText(item.body || item.content || item.summary || item.message) || '暂无更多消息内容'
      return {
        ...item,
        kind,
        title: String(item.title || (kind === 'progress' ? '办理进度更新' : '平台通知')),
        category: String(item.category || (kind === 'interaction' ? '湖财圈 · @提及' : kind === 'progress' ? '办理进度' : '平台通知')),
        summary: markdownToPlainText(item.summary || body, { singleLine: true, maxLength: 120 }) || '点击查看消息详情',
        body,
        target: item.target || item.route || item.url || '',
        read: item.read === true || Boolean(item.readAt)
      }
    },
    async load(more = false) {
      if (!this.verified || (more === true && this.loading)) return
      const append = more === true
      const version = ++this.requestVersion
      const page = append ? this.page + 1 : 1
      if (!append) { this.messages = []; this.page = 0; this.total = 0 }
      this.loading = true
      this.error = ''
      try {
        const result = await getMyInbox({ page, pageSize: 30, unreadOnly: this.filter === 'unread', kind: ['notice', 'progress', 'interaction'].includes(this.filter) ? this.filter : '' })
        if (version !== this.requestVersion || !this.verified) return
        const items = result.items.map(this.normalize)
        this.messages = append ? [...new Map([...this.messages, ...items].map((item) => [item.id, item])).values()] : items
        this.total = Number(result.total ?? this.messages.length)
        this.page = page
        this.unread = Number(result.unread ?? this.messages.filter((item) => !item.read).length)
      } catch (error) {
        if (version === this.requestVersion) this.error = error.message || '消息暂时无法加载'
      } finally { if (version === this.requestVersion) this.loading = false }
    },
    open(url) { openPage(url) },
    timeText(value) {
      if (!value) return ''
      const source = String(value).replace('T', ' ')
      return source.slice(0, 16)
    },
    statusLabel(status) {
      return ({
        submitted: '待受理',
        pending_review: '待审核',
        processing: '办理中',
        approved: '已通过',
        published: '已发布',
        offline: '已下架',
        completed: '已完成',
        fulfilled: '已完成',
        rejected: '未通过',
        cancelled: '已取消'
      })[status] || status
    },
    messageDetailSubtitle(item) {
      const parts = [this.timeText(item.createdAt), item.category]
      if (item.status) parts.push(this.statusLabel(item.status))
      return parts.filter(Boolean).join(' · ')
    },
    async openMessage(item) {
      if (this.markingIds.includes(item.id)) return
      const authVersion = this.authVersion
      const version = this.requestVersion
      if (!item.read) {
        this.markingIds.push(item.id)
        try {
          const result = await markInboxMessageRead(item.id)
          if (version !== this.requestVersion || !this.verified) return
          item.read = true
          this.unread = Number(result.unreadCount ?? Math.max(0, this.unread - 1))
          if (this.filter === 'unread') await this.load()
        } catch (error) {
          uni.showToast({ title: error.message || '已读状态同步失败', icon: 'none' })
        } finally { this.markingIds = this.markingIds.filter((id) => id !== item.id) }
      }
      if (this.verified && authVersion === this.authVersion) this.selectedMessage = item
    },
    openSelectedTarget() {
      const target = this.selectedMessage?.target || ''
      this.selectedMessage = null
      if (target) openPage(target)
    },
    readAll() {
      if (!this.unread) return
      uni.showModal({
        title: '全部标为已读',
        content: '确认将当前全部未读消息标记为已读？',
        confirmColor: '#033481',
        success: async (result) => {
          if (!result.confirm) return
          const version = this.requestVersion
          try {
            await markAllInboxMessagesRead()
            if (version !== this.requestVersion || !this.verified) return
            await this.load()
            uni.showToast({ title: '已全部标为已读' })
          } catch (error) {
            uni.showModal({ title: '操作失败', content: error.message || '请稍后重试', showCancel: false })
          }
        }
      })
    }
  }
}
</script>

<style scoped>
.inbox-pagination{margin:22rpx 0;text-align:center;color:#728094;font-size:20rpx}.inbox-pagination>text{display:block}.inbox-pagination .retry-button{margin-top:12rpx}
.inbox-page{padding-top:14rpx}.inbox-hero{min-height:270rpx;padding:38rpx 34rpx;display:flex;align-items:flex-start;justify-content:space-between;gap:24rpx;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#17324e,#073a78 64%,#1d5b9b);box-shadow:0 22rpx 49rpx rgba(11,58,115,.19)}.inbox-hero>view:first-child{min-width:0;flex:1}.inbox-hero__eyebrow,.inbox-hero__title,.inbox-hero__desc{display:block}.inbox-hero__eyebrow{color:#e1c58d;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.inbox-hero__title{margin-top:15rpx;font-size:40rpx;font-weight:700}.inbox-hero__desc{max-width:510rpx;margin-top:11rpx;color:rgba(255,255,255,.66);font-size:20rpx;line-height:1.65}.inbox-hero__count{width:112rpx;height:112rpx;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1rpx solid rgba(255,255,255,.2);border-radius:35rpx;background:rgba(255,255,255,.09)}.inbox-hero__count text{display:block}.inbox-hero__count text:first-child{color:#ead09c;font-size:36rpx;font-weight:700}.inbox-hero__count text:last-child{margin-top:2rpx;color:rgba(255,255,255,.65);font-size:17rpx}.login-guide{margin-top:24rpx;padding:58rpx 30rpx;text-align:center}.login-guide>view{width:76rpx;height:76rpx;margin:0 auto 20rpx;display:flex;align-items:center;justify-content:center;border-radius:24rpx;color:#fff;background:#033481;font-size:24rpx;font-weight:700}.login-guide>text{display:block;color:#728094;font-size:21rpx}.login-guide button{width:260rpx;margin:25rpx auto 0}.inbox-toolbar{margin-top:22rpx;display:flex;align-items:center;gap:14rpx}.filter-scroll{min-width:0;flex:1;white-space:nowrap}.filter-row{display:inline-flex}.filter-chip{height:58rpx;margin-right:10rpx;padding:0 20rpx;display:flex;align-items:center;gap:7rpx;border-radius:19rpx;color:#657187;background:#fff;font-size:21rpx}.filter-chip text{min-width:26rpx;height:26rpx;padding:0 6rpx;display:flex;align-items:center;justify-content:center;border-radius:99rpx;color:#fff;background:#a04b45;font-size:14rpx}.filter-chip--active{color:#fff;background:#033481}.read-all{flex-shrink:0;color:#8b6730;font-size:19rpx;font-weight:650}.message-list{margin-top:20rpx;display:flex;flex-direction:column}.message-card{position:relative;margin-bottom:16rpx;padding:25rpx;display:flex}.message-card--unread::before{content:"";position:absolute;left:0;top:28rpx;bottom:28rpx;width:5rpx;border-radius:0 5rpx 5rpx 0;background:#b88b45}.message-card__icon{position:relative;width:62rpx;height:62rpx;margin-right:18rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:20rpx;font-size:21rpx;font-weight:700}.message-card__icon--notice{color:#805f2d;background:#f4e8d2}.message-card__icon--progress{color:#033481;background:#e8eef8}.message-card__icon>text{position:absolute;right:-2rpx;top:-2rpx;width:14rpx;height:14rpx;border:3rpx solid #fff;border-radius:50%;background:#a64f4a}.message-card__body{min-width:0;flex:1}.message-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:18rpx}.message-card__head text:first-child{min-width:0;flex:1;color:#2d3b50;font-size:25rpx;font-weight:700}.message-card__head text:last-child{flex-shrink:0;color:#9aa3af;font-size:16rpx}.message-card__summary{display:-webkit-box;margin-top:8rpx;overflow:hidden;color:#727e90;font-size:19rpx;line-height:1.6;-webkit-box-orient:vertical;-webkit-line-clamp:2}.message-card__foot{margin-top:14rpx;display:flex;align-items:center;gap:9rpx}.message-card__foot text{padding:5rpx 9rpx;border-radius:99rpx;color:#66768b;background:#eef2f7;font-size:16rpx}.message-card__foot text:last-child{margin-left:auto;color:#033481;background:transparent;font-weight:650}.retry-button{width:240rpx;margin:22rpx auto 0}.inbox-note{margin-top:8rpx;padding:23rpx;display:flex;align-items:flex-start;border-radius:24rpx;color:#768195;background:#e9eef5}.inbox-note>text{width:50rpx;height:50rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#176551;background:#dcece6;font-size:19rpx;font-weight:700}.inbox-note view text{display:block}.inbox-note view text:first-child{color:#4b5a70;font-size:21rpx;font-weight:700}.inbox-note view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}
.message-detail__meta{display:flex;flex-wrap:wrap;gap:10rpx}.message-detail__meta text{padding:7rpx 13rpx;border-radius:99rpx;color:#5c6d83;background:#edf2f7;font-size:18rpx}.message-detail__body{display:block;margin-top:24rpx;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;color:#354258;font-size:23rpx;line-height:1.85}
@media screen and (min-width:800px){.message-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.message-card{margin-bottom:0}.inbox-hero{align-items:center}}
@media screen and (max-width:360px){.inbox-hero{padding-left:26rpx;padding-right:26rpx}.inbox-hero__count{width:96rpx;height:96rpx}.message-card{padding:22rpx}.message-card__head{flex-direction:column;gap:5rpx}}
</style>
