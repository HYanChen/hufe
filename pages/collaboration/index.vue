<template>
  <view class="page-shell collaboration-page">
    <view class="collaboration-hero">
      <text class="collaboration-hero__eyebrow">HUFE COLLABORATION SQUARE</text>
      <text class="collaboration-hero__title">合作广场</text>
      <text class="collaboration-hero__desc">让真实需求遇见可信资源，让每一次合作从清晰表达开始。</text>
      <button class="collaboration-hero__action" @tap="openEditor"><text>＋</text>实名发布合作</button>
      <text class="collaboration-hero__mark">合</text>
    </view>

    <view class="tab-switch surface">
      <view :class="{ active: tab === 'public' }" @tap="tab = 'public'"><text>公开机会</text><text>{{ publicItems.length }}</text></view>
      <view :class="{ active: tab === 'mine' }" @tap="showMine"><text>我的发布</text><text>{{ myItems.length }}</text></view>
    </view>

    <template v-if="tab === 'mine' && !verified">
      <view class="login-guide surface"><view>登</view><text>登录后查看我的合作发布和审核状态</text><button class="secondary-button" @tap="openLogin">去登录</button></view>
    </template>
    <template v-else>
      <view class="search-box surface"><text>⌕</text><input v-model="keyword" placeholder="搜索标题、组织、城市或合作类型" placeholder-class="field-placeholder" /><text v-if="keyword" @tap="keyword = ''">×</text></view>
      <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false"><view class="filter-row"><view v-for="item in categories" :key="item" class="filter-chip" :class="{ 'filter-chip--active': category === item }" @tap="category = item">{{ item }}</view></view></scroll-view>

      <view class="result-head"><text>{{ filteredItems.length }} 条{{ tab === 'mine' ? '我的发布' : '合作机会' }}</text><text>{{ tab === 'mine' ? '含待审核记录' : '学校后台审核发布' }}</text></view>
      <view v-if="loading && !activeItems.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载合作机会</text></view>
      <view v-else-if="error && !activeItems.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ error }}</text><button class="secondary-button retry-button" @tap="load">重新加载</button></view>
      <view v-else-if="filteredItems.length" class="opportunity-list">
        <view v-for="item in filteredItems" :key="item.id" class="opportunity-card surface" @tap="selected = item">
          <view class="opportunity-card__head"><text class="opportunity-category">{{ item.category || '合作需求' }}</text><text v-if="item._mine" class="opportunity-status" :class="`opportunity-status--${statusTone(item.status)}`">{{ statusLabel(item.status) }}</text><text v-else class="opportunity-deadline">{{ deadlineText(item.deadline) }}</text></view>
          <text class="opportunity-title">{{ item.title }}</text>
          <text class="opportunity-meta">{{ item.organization || '组织未标注' }} · {{ item.city || '城市不限' }}</text>
          <text class="opportunity-summary">{{ item.summaryText }}</text>
          <view class="opportunity-card__foot"><view><text v-for="tag in item.tags.slice(0, 3)" :key="tag">{{ tag }}</text></view><text>查看详情 ›</text></view>
        </view>
      </view>
      <view v-else class="empty-state surface"><view class="empty-state__icon">合</view><text>{{ tab === 'mine' ? '还没有合作发布' : '暂无匹配合作机会' }}</text><button v-if="tab === 'mine'" class="secondary-button retry-button" @tap="openEditor">发布第一条</button></view>
    </template>

    <BusinessDetailSheet
      :open="Boolean(selected)"
      :title="selected ? selected.title : ''"
      :subtitle="selected ? `${selected.organization || '组织未标注'} · ${selected.city || '城市不限'}` : ''"
      eyebrow="COLLABORATION DETAILS"
      :show-actions="true"
      @close="selected = null"
    >
      <template v-if="selected">
        <view class="detail-facts"><text>{{ selected.category || '合作需求' }}</text><text>{{ deadlineText(selected.deadline) }}</text><text v-if="selected.authorName">发布人：{{ selected.authorName }}</text></view>
        <view v-if="selected.tags.length" class="detail-tags"><text v-for="tag in selected.tags" :key="tag">{{ tag }}</text></view>
        <BusinessRichText :content="selected.summary" empty-text="暂无摘要" />
        <view class="detail-section"><text>合作详情</text><BusinessRichText :content="selected.description" empty-text="暂无详情" /></view>
        <view class="detail-section"><text>联系说明</text><BusinessRichText :content="selected.contactMethod" empty-text="请通过平台工作人员协助联系" /></view>
        <view v-if="selected._mine" class="mine-state-note"><text>当前状态：{{ statusLabel(selected.status) }}</text><text>审核记录仅本人可见，公开列表只展示已发布内容。</text></view>
      </template>
      <template #actions>
        <button class="secondary-button" @tap="selected = null">关闭</button>
        <button v-if="selected && selected._mine && canCancel(selected)" class="danger-button" @tap="cancelSelected">{{ selected.status === 'rejected' ? '撤回记录' : '撤回审核' }}</button>
        <button v-else class="primary-button" @tap="selected = null">我知道了</button>
      </template>
    </BusinessDetailSheet>

    <view class="collaboration-note"><text>安</text><view><text>安全合作提醒</text><text>请勿在公开内容中填写身份证、私人手机号、微信号或账号密码。合作前请独立核验主体与约定。</text></view></view>
    <SupportFooter />
  </view>
</template>

<script>
import { loadAllPages } from '../../utils/authPagination'
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import {
  cancelMyCollaborationOpportunity,
  getCollaborationOpportunities,
  getMyCollaborationOpportunities
} from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() {
    return {
      publicItems: [], myItems: [], tab: 'public', verified: false, keyword: '',
      category: '全部', selected: null, loading: false, error: ''
    }
  },
  computed: {
    activeItems() { return this.tab === 'mine' ? this.myItems : this.publicItems },
    categories() { return ['全部', ...new Set(this.activeItems.map((item) => item.category).filter(Boolean))] },
    filteredItems() {
      const keyword = this.keyword.trim().toLowerCase()
      return this.activeItems.filter((item) => {
        const matchesCategory = this.category === '全部' || item.category === this.category
        const searchable = [item.title, item.organization, item.city, item.category, item.summaryText, ...item.tags].join(' ').toLowerCase()
        return matchesCategory && (!keyword || searchable.includes(keyword))
      })
    }
  },
  watch: {
    tab() { this.category = '全部'; this.keyword = '' }
  },
  onLoad(options = {}) {
    if (options.tab === 'mine') this.tab = 'mine'
  },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => uni.stopPullDownRefresh()) },
  methods: {
    normalize(item, mine = false) {
      return {
        ...item,
        _mine: mine,
        title: String(item.title || '合作机会'),
        tags: Array.isArray(item.tags) ? item.tags : [],
        summaryText: markdownToPlainText(item.summary, { singleLine: true, maxLength: 110 }) || '暂无合作摘要'
      }
    },
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      this.verified = isVerified()
      try {
        const [published, mine] = await Promise.all([
          loadAllPages(getCollaborationOpportunities),
          this.verified ? loadAllPages(getMyCollaborationOpportunities) : Promise.resolve({ items: [] })
        ])
        this.publicItems = published.items.map((item) => this.normalize(item))
        this.myItems = mine.items.map((item) => this.normalize(item, true))
      } catch (error) {
        this.publicItems = []
        this.myItems = []
        this.error = error.message || '合作机会加载失败'
      } finally { this.loading = false }
    },
    showMine() {
      this.tab = 'mine'
      if (!isVerified()) this.verified = false
    },
    openLogin() { openPage('/pages/verify/index') },
    openEditor() { openPage('/pages/collaboration-editor/index') },
    deadlineText(deadline) { return deadline ? `截止 ${String(deadline).slice(0, 10)}` : '长期有效' },
    statusLabel(status) {
      return ({ pending_review: '待审核', published: '已发布', rejected: '已驳回', offline: '已下架', cancelled: '已取消', draft: '草稿' })[status] || '处理中'
    },
    statusTone(status) {
      return ({ published: 'success', pending_review: 'warning', rejected: 'danger', cancelled: 'neutral', offline: 'neutral', draft: 'neutral' })[status] || 'neutral'
    },
    canCancel(item) { return ['pending_review', 'rejected'].includes(item?.status) },
    cancelSelected() {
      const item = this.selected
      if (!item || !this.canCancel(item)) return
      uni.showModal({
        title: '撤回合作记录',
        content: item.status === 'rejected' ? '确认撤回这条已驳回记录？撤回后将保留审计记录。' : '确认撤回这条待审核记录？撤回后将不再进入审核流程。',
        confirmText: '确认撤回',
        confirmColor: '#9A403B',
        success: async (result) => {
          if (!result.confirm) return
          try {
            await cancelMyCollaborationOpportunity(item.id)
            this.selected = null
            await this.load()
            uni.showToast({ title: '合作记录已撤回', icon: 'none' })
          } catch (error) {
            uni.showModal({ title: '撤回失败', content: error.message || '请稍后重试', showCancel: false })
          }
        }
      })
    }
  }
}
</script>

<style scoped>
.collaboration-page{padding-top:14rpx}.collaboration-hero{position:relative;min-height:310rpx;padding:37rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#17304d,#083a78 66%,#1e5c9b);box-shadow:0 22rpx 49rpx rgba(11,58,115,.19)}.collaboration-hero__eyebrow,.collaboration-hero__title,.collaboration-hero__desc{position:relative;z-index:2;display:block}.collaboration-hero__eyebrow{color:#e1c58d;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.collaboration-hero__title{margin-top:15rpx;font-size:40rpx;font-weight:700}.collaboration-hero__desc{width:520rpx;margin-top:11rpx;color:rgba(255,255,255,.64);font-size:20rpx;line-height:1.65}.collaboration-hero__action{position:absolute;z-index:2;left:34rpx;bottom:29rpx;width:250rpx;height:63rpx;margin:0;padding:0 18rpx;border-radius:19rpx;color:#033481;background:#fff;font-size:21rpx;line-height:63rpx;font-weight:700}.collaboration-hero__action text{margin-right:8rpx}.collaboration-hero__mark{position:absolute;right:20rpx;top:-27rpx;color:rgba(255,255,255,.055);font-family:"STKaiti","KaiTi",serif;font-size:230rpx;font-weight:700}.tab-switch{position:relative;z-index:3;margin:-13rpx 18rpx 0;padding:7rpx;display:flex}.tab-switch view{height:65rpx;flex:1;display:flex;align-items:center;justify-content:center;gap:9rpx;border-radius:20rpx;color:#718095;font-size:21rpx}.tab-switch view text:last-child{min-width:30rpx;height:30rpx;padding:0 7rpx;display:flex;align-items:center;justify-content:center;border-radius:99rpx;background:#edf1f5;font-size:16rpx}.tab-switch view.active{color:#fff;background:#033481}.tab-switch view.active text:last-child{color:#033481;background:#fff}.login-guide{margin-top:24rpx;padding:37rpx 28rpx;text-align:center}.login-guide>view{width:70rpx;height:70rpx;margin:0 auto 18rpx;display:flex;align-items:center;justify-content:center;border-radius:23rpx;color:#fff;background:#033481;font-weight:700}.login-guide>text{display:block;color:#687589;font-size:22rpx}.login-guide button{width:230rpx;margin:23rpx auto 0}.search-box{height:84rpx;margin-top:22rpx;padding:0 20rpx;display:flex;align-items:center}.search-box>text:first-child{color:#033481;font-size:34rpx}.search-box input{min-width:0;flex:1;height:82rpx;margin-left:13rpx;color:#27354a;font-size:23rpx}.search-box>text:last-child{padding:12rpx;color:#a1a9b4;font-size:34rpx}.field-placeholder{color:#abb2bd}.filter-scroll{width:calc(100% + 56rpx);margin:20rpx -28rpx 0;white-space:nowrap}.filter-row{padding:0 28rpx;display:inline-flex}.filter-chip{height:58rpx;margin-right:12rpx;padding:0 22rpx;display:flex;align-items:center;border-radius:19rpx;color:#657187;background:#fff;font-size:21rpx}.filter-chip--active{color:#fff;background:#033481}.result-head{margin:27rpx 4rpx 16rpx;display:flex;justify-content:space-between;color:#37455a;font-size:24rpx;font-weight:650}.result-head text:last-child{color:#9a733b;font-size:18rpx}.opportunity-list{display:flex;flex-direction:column}.opportunity-card{margin-bottom:18rpx;padding:26rpx}.opportunity-card__head{display:flex;align-items:center;justify-content:space-between}.opportunity-category{padding:7rpx 12rpx;border-radius:99rpx;color:#805e29;background:#f4e7cf;font-size:18rpx;font-weight:650}.opportunity-deadline{color:#8e98a6;font-size:18rpx}.opportunity-status{padding:6rpx 11rpx;border-radius:99rpx;font-size:17rpx;font-weight:650}.opportunity-status--success{color:#176551;background:#e4f1ec}.opportunity-status--warning{color:#876225;background:#f5e9d1}.opportunity-status--danger{color:#97443f;background:#f7e5e3}.opportunity-status--neutral{color:#687589;background:#edf1f5}.opportunity-title,.opportunity-meta,.opportunity-summary{display:block}.opportunity-title{margin-top:15rpx;color:#29374c;font-size:29rpx;font-weight:700}.opportunity-meta{margin-top:7rpx;color:#8a94a3;font-size:19rpx}.opportunity-summary{margin-top:15rpx;color:#657287;font-size:21rpx;line-height:1.65}.opportunity-card__foot{margin-top:18rpx;padding-top:17rpx;display:flex;align-items:center;justify-content:space-between;border-top:1rpx solid #edf0f4}.opportunity-card__foot view{display:flex;flex-wrap:wrap;gap:7rpx}.opportunity-card__foot view text{padding:6rpx 10rpx;border-radius:99rpx;color:#64758a;background:#eef2f7;font-size:16rpx}.opportunity-card__foot>text{flex-shrink:0;color:#033481;font-size:18rpx;font-weight:650}.retry-button{width:230rpx;margin:22rpx auto 0}.detail-facts{display:flex;flex-wrap:wrap;gap:9rpx}.detail-facts text,.detail-tags text{padding:7rpx 12rpx;border-radius:99rpx;color:#586a81;background:#eef2f7;font-size:18rpx}.detail-tags{margin:14rpx 0 22rpx;display:flex;flex-wrap:wrap;gap:8rpx}.detail-section{margin-top:25rpx;padding-top:22rpx;border-top:1rpx solid #e9edf3}.detail-section>text{display:block;margin-bottom:12rpx;color:#2e3c52;font-size:24rpx;font-weight:700}.mine-state-note{margin-top:24rpx;padding:19rpx;border-radius:19rpx;background:#eef3f8}.mine-state-note text{display:block}.mine-state-note text:first-child{color:#35506e;font-size:20rpx;font-weight:700}.mine-state-note text:last-child{margin-top:5rpx;color:#78869a;font-size:18rpx}.danger-button{height:88rpx;flex:1;margin:0;border-radius:22rpx;color:#fff;background:#9a403b;font-size:27rpx;font-weight:650;line-height:88rpx}.collaboration-note{margin-top:7rpx;padding:23rpx;display:flex;align-items:flex-start;border-radius:24rpx;color:#768195;background:#e9eef5}.collaboration-note>text{width:50rpx;height:50rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#176551;background:#dcece6;font-size:19rpx;font-weight:700}.collaboration-note view text{display:block}.collaboration-note view text:first-child{color:#4b5a70;font-size:21rpx;font-weight:700}.collaboration-note view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}
</style>
