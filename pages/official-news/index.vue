<template>
  <view class="official-page page-shell">
    <view class="official-hero">
      <image class="official-hero__logo" :src="logoUrl" mode="aspectFit" />
      <view class="official-hero__copy"><text class="official-hero__eyebrow">HUFE OFFICIAL FEED</text><text class="official-hero__title">湖财官网资讯</text><text class="official-hero__desc">与湖南财政经济学院官网内容源同步</text></view>
    </view>

    <view class="sync-strip" :class="{ 'sync-strip--offline': offline }">
      <view class="sync-strip__dot"></view>
      <text>{{ syncText }}</text>
      <text v-if="!offline && syncedAt" class="sync-strip__time">{{ formatSyncTime(syncedAt) }}</text>
    </view>

    <scroll-view class="category-scroll" scroll-x :show-scrollbar="false">
      <view class="category-row">
        <view v-for="item in categories" :key="item.key" class="category-chip" :class="{ 'category-chip--active': category === item.key }" @tap="selectCategory(item.key)">{{ item.label }}</view>
      </view>
    </scroll-view>

    <view v-if="items.length" class="official-list">
      <view v-for="item in items" :key="item.id" class="official-card surface" @tap="openItem(item)">
        <image v-if="item.imageUrl" class="official-card__image" :src="item.imageUrl" mode="aspectFill" />
        <view v-else class="official-card__placeholder"><image :src="logoUrl" mode="aspectFit" /></view>
        <view class="official-card__body">
          <view class="official-card__meta"><text>{{ item.categoryLabel || item.category }}</text><text>{{ item.publishedAt || '日期以官网为准' }}</text></view>
          <text class="official-card__title">{{ item.title }}</text>
          <text class="official-card__summary">{{ item.summary || '点击查看官网同步详情' }}</text>
          <view class="official-card__source"><text>{{ item.sourceName || '湖南财政经济学院官网' }}</text><text>详情 ›</text></view>
        </view>
      </view>
    </view>
    <view v-else-if="!loading" class="empty-state surface"><view class="empty-state__icon">闻</view><text>当前分类暂无可用内容</text></view>

    <view class="load-state"><text v-if="loading">正在同步官网内容…</text><text v-else-if="hasMore">上拉加载更多</text><text v-else-if="items.length">已加载全部内容</text></view>
    <SupportFooter />
  </view>
</template>

<script>
import { appConfig } from '../../config/index'
import { contentCategories, formatOfficialItem, getOfficialContent } from '../../services/content'
import { openPage } from '../../utils/nav'

export default {
  data() {
    return { logoUrl: appConfig.officialLogoUrl, categories: contentCategories, category: '', items: [], page: 1, pageSize: 10, total: 0, loading: false, offline: false, syncedAt: '', stale: false }
  },
  computed: {
    hasMore() { return !this.offline && this.items.length < this.total },
    syncText() {
      if (this.offline) return '官网同步服务暂不可用 · 未展示本地替代内容'
      if (this.stale) return '已读取官网缓存 · 部分内容源待恢复'
      return '官网内容源已同步'
    }
  },
  onLoad(options) { this.category = options.category || ''; this.load(true) },
  onPullDownRefresh() { this.load(true).finally(() => uni.stopPullDownRefresh()) },
  onReachBottom() { if (this.hasMore && !this.loading) this.load(false) },
  methods: {
    async load(reset) {
      if (this.loading) return
      this.loading = true
      if (reset) { this.page = 1; this.items = []; this.total = 0 }
      try {
        const result = await getOfficialContent({ category: this.category, page: this.page, pageSize: this.pageSize })
        const next = (result.items || []).map((item, index) => ({ ...formatOfficialItem(item, index), categoryLabel: item.categoryLabel }))
        this.items = reset ? next : [...this.items, ...next]
        this.total = result.total || this.items.length
        this.syncedAt = result.status?.lastSuccessAt || result.status?.generatedAt || ''
        this.stale = Boolean(result.status?.stale)
        this.offline = false
        if (this.items.length < this.total) this.page += 1
      } catch (error) {
        if (reset) this.useOfflineFallback()
        else uni.showToast({ title: error.message || '加载失败', icon: 'none' })
      } finally { this.loading = false }
    },
    useOfflineFallback() {
      this.items = []
      this.total = 0
      this.offline = true
      this.stale = true
    },
    selectCategory(value) { if (this.category !== value) { this.category = value; this.load(true) } },
    openItem(item) { openPage(`/pages/news-detail/index?id=${encodeURIComponent(item.id)}${item.official === false ? '' : '&official=1'}`) },
    formatSyncTime(value) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (number) => String(number).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
  }
}
</script>

<style scoped>
.official-page{padding-top:16rpx}.official-hero{min-height:230rpx;padding:34rpx;display:flex;align-items:center;border-radius:36rpx;color:#fff;background:linear-gradient(135deg,#033481,#033481 60%,#1c5da3);box-shadow:0 22rpx 48rpx rgba(11,58,130,.2)}.official-hero__logo{width:230rpx;height:58rpx;padding:0;flex-shrink:0;border-radius:15rpx;background:transparent}.official-hero__copy{margin-left:20rpx}.official-hero__eyebrow,.official-hero__title,.official-hero__desc{display:block}.official-hero__eyebrow{color:#e1c58c;font-size:15rpx;font-weight:700;letter-spacing:1rpx}.official-hero__title{margin-top:9rpx;font-size:33rpx;font-weight:700}.official-hero__desc{margin-top:7rpx;color:rgba(255,255,255,.67);font-size:18rpx}
.sync-strip{margin:20rpx 4rpx 2rpx;padding:15rpx 20rpx;display:flex;align-items:center;border-radius:18rpx;color:#176551;background:#e8f2ee;font-size:19rpx}.sync-strip--offline{color:#8b652c;background:#f7ecd9}.sync-strip__dot{width:12rpx;height:12rpx;margin-right:11rpx;border-radius:50%;background:currentColor}.sync-strip__time{margin-left:auto;color:#7f8997}.category-scroll{width:100%;margin-top:24rpx;white-space:nowrap}.category-row{display:inline-flex;padding:0 2rpx 12rpx}.category-chip{margin-right:14rpx;padding:15rpx 23rpx;border:1rpx solid #dfe4eb;border-radius:99rpx;color:#657187;background:#fff;font-size:21rpx}.category-chip--active{color:#fff;border-color:#033481;background:#033481}
.official-list{margin-top:12rpx;display:flex;flex-direction:column;gap:20rpx}.official-card{overflow:hidden}.official-card__image,.official-card__placeholder{width:100%;height:260rpx}.official-card__placeholder{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#e8eef7,#f5ecd9)}.official-card__placeholder image{width:180rpx;height:90rpx;opacity:.82}.official-card__body{padding:25rpx}.official-card__meta{display:flex;align-items:center;justify-content:space-between;color:#9a763d;font-size:19rpx}.official-card__title,.official-card__summary{display:block}.official-card__title{margin-top:12rpx;color:#26334a;font-size:29rpx;line-height:1.45;font-weight:650}.official-card__summary{margin-top:9rpx;overflow:hidden;color:#7e8998;font-size:21rpx;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.official-card__source{margin-top:20rpx;padding-top:17rpx;display:flex;align-items:center;justify-content:space-between;border-top:1rpx solid #edf0f4;color:#98a0ac;font-size:18rpx}.official-card__source text:last-child{color:#033481}.load-state{padding:32rpx 0 12rpx;color:#9aa2ae;font-size:19rpx;text-align:center}
</style>
