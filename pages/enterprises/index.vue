<template>
  <view class="page-shell enterprises-page">
    <view class="enterprise-hero">
      <text class="enterprise-hero__eyebrow">HUFE ALUMNI ENTERPRISES</text>
      <text class="enterprise-hero__title">校友企业馆</text>
      <text class="enterprise-hero__desc">汇聚校友企业与专业能力，让可信资源被更多湖财人看见。</text>
      <view class="enterprise-hero__count"><text>{{ enterprises.length }}</text><text>家审核发布企业</text></view>
      <text class="enterprise-hero__mark">企</text>
    </view>

    <view class="owner-entry surface" @tap="openOwnerWorkbench">
      <view class="owner-entry__icon">主</view>
      <view><text>企业主工作台</text><text>提交企业认证，维护企业资料与招聘</text></view>
      <text>进入 ›</text>
    </view>

    <view class="search-box surface"><text>⌕</text><input v-model="keyword" placeholder="搜索企业、行业、城市或服务" placeholder-class="field-placeholder" /><text v-if="keyword" @tap="keyword = ''">×</text></view>
    <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false"><view class="filter-row"><view v-for="item in industries" :key="item" class="filter-chip" :class="{ 'filter-chip--active': industry === item }" @tap="industry = item">{{ item }}</view></view></scroll-view>

    <view class="result-head"><text>{{ filteredEnterprises.length }} 家企业</text><text>后台审核发布</text></view>
    <view v-if="loading && !enterprises.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载校友企业</text></view>
    <view v-else-if="error && !enterprises.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ error }}</text><button class="secondary-button retry-button" @tap="load">重新加载</button></view>
    <view v-else-if="filteredEnterprises.length" class="enterprise-list">
      <view v-for="(item,index) in filteredEnterprises" :key="item.id" class="enterprise-card surface" @tap="selected = item">
        <view class="enterprise-card__head">
          <image v-if="item.logoUrl" class="enterprise-logo" :src="item.logoUrl" mode="aspectFill" />
          <view v-else class="enterprise-logo enterprise-logo--text" :class="`enterprise-logo--${index % 3}`">{{ item.name.slice(0, 1) }}</view>
          <view class="enterprise-card__main"><text class="enterprise-name">{{ item.name }}</text><text class="enterprise-meta">{{ item.industry || '综合行业' }} · {{ item.city || '城市未标注' }}</text></view>
          <text class="enterprise-arrow">›</text>
        </view>
        <text class="enterprise-summary">{{ item.summaryText }}</text>
        <view v-if="item.tags.length" class="enterprise-tags"><text v-for="tag in item.tags.slice(0, 4)" :key="tag">{{ tag }}</text></view>
      </view>
    </view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">企</view><text>暂无匹配企业</text><text class="empty-hint">尝试更换关键词或行业筛选</text></view>

    <BusinessDetailSheet
      :open="Boolean(selected)"
      :title="selected ? selected.name : ''"
      :subtitle="selected ? `${selected.industry || '综合行业'} · ${selected.city || '城市未标注'}` : ''"
      eyebrow="ALUMNI ENTERPRISE PROFILE"
      :show-actions="true"
      @close="selected = null"
    >
      <template v-if="selected">
        <view v-if="selected.tags.length" class="detail-tags"><text v-for="tag in selected.tags" :key="tag">{{ tag }}</text></view>
        <BusinessRichText :content="selected.summary" empty-text="暂无企业简介" />
        <view class="detail-section"><text>企业详情</text><BusinessRichText :content="selected.description" empty-text="暂无更多企业详情" /></view>
        <view v-if="selected.contactName || selected.contactMethod" class="contact-card">
          <text>审核公开联系信息</text>
          <text>{{ selected.contactName || '企业联系人' }}</text>
          <text>{{ selected.contactMethod || '请通过平台联系' }}</text>
        </view>
      </template>
      <template #actions>
        <button class="secondary-button" @tap="selected = null">关闭</button>
        <button class="primary-button" :disabled="!selected || !selected.website" @tap="openWebsite">访问企业官网</button>
      </template>
    </BusinessDetailSheet>

    <view class="enterprise-note"><text>馆</text><view><text>企业展示说明</text><text>页面信息由学校后台审核发布，不构成投资、交易或信用背书。合作前请独立核实。</text></view></view>
    <SupportFooter />
  </view>
</template>

<script>
import { loadAllPages } from '../../utils/authPagination'
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { getAlumniEnterprises } from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { resolveMediaUrl } from '../../services/media'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() {
    return { enterprises: [], keyword: '', industries: ['全部'], industry: '全部', selected: null, loading: false, error: '' }
  },
  computed: {
    filteredEnterprises() {
      const keyword = this.keyword.trim().toLowerCase()
      return this.enterprises.filter((item) => {
        const matchesIndustry = this.industry === '全部' || item.industry === this.industry
        const searchable = [item.name, item.industry, item.city, item.summaryText, ...item.tags].join(' ').toLowerCase()
        return matchesIndustry && (!keyword || searchable.includes(keyword))
      })
    }
  },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => uni.stopPullDownRefresh()) },
  methods: {
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const result = await loadAllPages(getAlumniEnterprises)
        this.enterprises = result.items.map((item) => ({
          ...item,
          name: String(item.name || '校友企业'),
          logoUrl: resolveMediaUrl(item.logoUrl),
          tags: Array.isArray(item.tags) ? item.tags : [],
          summaryText: markdownToPlainText(item.summary, { singleLine: true, maxLength: 100 }) || '暂无企业简介'
        }))
        this.industries = ['全部', ...new Set(this.enterprises.map((item) => item.industry).filter(Boolean))]
      } catch (error) {
        this.enterprises = []
        this.error = error.message || '校友企业加载失败'
      } finally { this.loading = false }
    },
    openWebsite() {
      const url = this.selected?.website || ''
      if (!url) return
      this.selected = null
      openPage(url)
    },
    openOwnerWorkbench() { openPage('/pages/enterprise-owner/index') }
  }
}
</script>

<style scoped>
.enterprises-page{padding-top:14rpx}.enterprise-hero{position:relative;min-height:285rpx;padding:37rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#102f55,#073b79 65%,#205e9e);box-shadow:0 22rpx 49rpx rgba(11,58,120,.19)}.enterprise-hero__eyebrow,.enterprise-hero__title,.enterprise-hero__desc{position:relative;z-index:2;display:block}.enterprise-hero__eyebrow{color:#e1c58d;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.enterprise-hero__title{margin-top:15rpx;font-size:40rpx;font-weight:700}.enterprise-hero__desc{width:520rpx;margin-top:11rpx;color:rgba(255,255,255,.65);font-size:20rpx;line-height:1.65}.enterprise-hero__count{position:absolute;z-index:2;left:34rpx;bottom:27rpx;display:flex;align-items:baseline;color:rgba(255,255,255,.58);font-size:18rpx}.enterprise-hero__count text:first-child{margin-right:9rpx;color:#ead3a4;font-family:Georgia,serif;font-size:32rpx;font-weight:700}.enterprise-hero__mark{position:absolute;right:22rpx;top:-28rpx;color:rgba(255,255,255,.055);font-family:"STKaiti","KaiTi",serif;font-size:230rpx;font-weight:700}.owner-entry{position:relative;z-index:3;margin:-13rpx 18rpx 0;padding:20rpx;display:flex;align-items:center}.owner-entry__icon{width:56rpx;height:56rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:18rpx;color:#fff;background:#033481;font-size:19rpx;font-weight:700}.owner-entry>view:nth-child(2){min-width:0;flex:1}.owner-entry>view:nth-child(2) text{display:block}.owner-entry>view:nth-child(2) text:first-child{color:#3d4e64;font-size:21rpx;font-weight:700}.owner-entry>view:nth-child(2) text:last-child{margin-top:4rpx;color:#8c96a4;font-size:17rpx}.owner-entry>text{color:#033481;font-size:18rpx;font-weight:650}.search-box{height:86rpx;margin-top:23rpx;padding:0 20rpx;display:flex;align-items:center}.search-box>text:first-child{color:#033481;font-size:35rpx}.search-box input{min-width:0;flex:1;height:84rpx;margin-left:13rpx;color:#27354a;font-size:23rpx}.search-box>text:last-child{padding:12rpx;color:#a1a9b4;font-size:34rpx}.field-placeholder{color:#abb2bd}.filter-scroll{width:calc(100% + 56rpx);margin:20rpx -28rpx 0;white-space:nowrap}.filter-row{padding:0 28rpx;display:inline-flex}.filter-chip{height:58rpx;margin-right:12rpx;padding:0 22rpx;display:flex;align-items:center;border-radius:19rpx;color:#657187;background:#fff;font-size:21rpx}.filter-chip--active{color:#fff;background:#033481}.result-head{margin:27rpx 4rpx 16rpx;display:flex;justify-content:space-between;color:#37455a;font-size:24rpx;font-weight:650}.result-head text:last-child{color:#9a733b;font-size:18rpx}.enterprise-list{display:flex;flex-direction:column}.enterprise-card{margin-bottom:18rpx;padding:25rpx}.enterprise-card__head{display:flex;align-items:center}.enterprise-logo{width:76rpx;height:76rpx;flex-shrink:0;border-radius:24rpx;background:#edf1f6}.enterprise-logo--text{display:flex;align-items:center;justify-content:center;color:#fff;font-size:25rpx;font-weight:700}.enterprise-logo--0{background:linear-gradient(145deg,#033481,#4f7db8)}.enterprise-logo--1{background:linear-gradient(145deg,#85622e,#c5a063)}.enterprise-logo--2{background:linear-gradient(145deg,#17604f,#579481)}.enterprise-card__main{min-width:0;flex:1;margin-left:18rpx}.enterprise-name,.enterprise-meta,.enterprise-summary{display:block}.enterprise-name{overflow:hidden;color:#2a384e;font-size:28rpx;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.enterprise-meta{margin-top:6rpx;color:#8a94a3;font-size:19rpx}.enterprise-arrow{margin-left:12rpx;color:#aab2bd;font-size:38rpx}.enterprise-summary{margin-top:18rpx;color:#687589;font-size:21rpx;line-height:1.65}.enterprise-tags,.detail-tags{margin-top:16rpx;display:flex;flex-wrap:wrap;gap:8rpx}.enterprise-tags text,.detail-tags text{padding:7rpx 12rpx;border-radius:99rpx;color:#596b82;background:#eef2f7;font-size:17rpx}.retry-button{width:220rpx;margin:22rpx auto 0}.empty-hint{display:block;margin-top:9rpx;font-size:19rpx}.detail-tags{margin:0 0 21rpx}.detail-section{margin-top:25rpx;padding-top:22rpx;border-top:1rpx solid #e9edf3}.detail-section>text{display:block;margin-bottom:12rpx;color:#2e3c52;font-size:24rpx;font-weight:700}.contact-card{margin-top:24rpx;padding:20rpx;border-radius:20rpx;background:#eef3f8}.contact-card text{display:block}.contact-card text:first-child{color:#8a6a35;font-size:18rpx;font-weight:700}.contact-card text:nth-child(2){margin-top:8rpx;color:#34445a;font-size:22rpx;font-weight:650}.contact-card text:last-child{margin-top:4rpx;color:#6e7c90;font-size:20rpx;overflow-wrap:anywhere}.enterprise-note{margin-top:7rpx;padding:23rpx;display:flex;align-items:flex-start;border-radius:24rpx;color:#768195;background:#e9eef5}.enterprise-note>text{width:50rpx;height:50rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#80602c;background:#f1dfbd;font-size:19rpx;font-weight:700}.enterprise-note view text{display:block}.enterprise-note view text:first-child{color:#4b5a70;font-size:21rpx;font-weight:700}.enterprise-note view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}
</style>
