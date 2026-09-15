<template>
  <view class="page-shell benefits-page">
    <view class="benefit-hero">
      <text class="benefit-hero__eyebrow">HUFE ALUMNI BENEFITS</text>
      <text class="benefit-hero__title">湖财权益中心</text>
      <text class="benefit-hero__desc">汇聚学校、校友企业与合作伙伴提供的专属权益，实名领取、记录可查。</text>
      <view class="benefit-hero__rule"><text>实名</text><text>审核</text><text>留痕</text></view>
      <text class="benefit-hero__mark">享</text>
    </view>

    <view class="tab-switch surface">
      <view :class="{ active: tab === 'public' }" @tap="changeTab('public')"><text>权益大厅</text><text>{{ benefits.length }}</text></view>
      <view :class="{ active: tab === 'mine' }" @tap="changeTab('mine')"><text>我的领取</text><text>{{ claims.length }}</text></view>
    </view>

    <template v-if="tab === 'public'">
      <view class="search-box surface">
        <text>⌕</text>
        <input v-model="keyword" placeholder="搜索权益、服务方或适用人群" placeholder-class="field-placeholder" />
        <text v-if="keyword" @tap="keyword = ''">×</text>
      </view>
      <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false">
        <view class="filter-row">
          <view v-for="item in categories" :key="item" class="filter-chip" :class="{ 'filter-chip--active': category === item }" @tap="category = item">{{ item }}</view>
        </view>
      </scroll-view>

      <view class="result-head"><text>{{ filteredBenefits.length }} 项可查看权益</text><text>后台审核发布</text></view>
      <view v-if="loading && !benefits.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载权益</text></view>
      <view v-else-if="error && !benefits.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ error }}</text><button class="secondary-button retry-button" @tap="load">重新加载</button></view>
      <view v-else-if="filteredBenefits.length" class="benefit-list">
        <view v-for="item in filteredBenefits" :key="item.id" class="benefit-card surface" @tap="selected = item">
          <image v-if="item.coverUrl" class="benefit-card__cover" :src="item.coverUrl" mode="aspectFill" />
          <view v-else class="benefit-card__cover benefit-card__cover--placeholder"><text>{{ item.category.slice(0, 1) }}</text><text>HUFE BENEFIT</text></view>
          <view class="benefit-card__body">
            <view class="benefit-card__meta"><text>{{ item.category }}</text><text>{{ item.audience }}</text></view>
            <text class="benefit-card__title">{{ item.title }}</text>
            <text class="benefit-card__provider">{{ item.provider }}</text>
            <view class="benefit-card__value"><text>{{ item.value }}</text><text>{{ periodText(item) }}</text></view>
            <view class="benefit-card__foot"><text>{{ quotaText(item) }}</text><text>{{ benefitActionText(item.id) }}</text></view>
          </view>
        </view>
      </view>
      <view v-else class="empty-state surface"><view class="empty-state__icon">享</view><text>{{ keyword || category !== '全部' ? '没有匹配的权益，试试其他条件' : '暂无已发布权益' }}</text><button v-if="keyword || category !== '全部'" class="secondary-button retry-button" @tap="resetFilter">清除筛选</button></view>
    </template>

    <template v-else>
      <view v-if="!verified" class="login-guide surface">
        <view>登</view><text>登录学校实名账号后，可查看权益领取记录与处理状态。</text>
        <button class="primary-button" @tap="open('/pages/verify/index')">去登录</button>
      </view>
      <template v-else>
        <view class="claim-tip surface"><view>记</view><view><text>每次领取均有记录</text><text>权益核销方式、有效期与审核结果以本页记录和服务方说明为准。</text></view></view>
        <view v-if="claimLoading && !claims.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载领取记录</text></view>
        <view v-else-if="claimError && !claims.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ claimError }}</text><button class="secondary-button retry-button" @tap="loadClaims">重新加载</button></view>
        <view v-else-if="claims.length" class="claim-list">
          <view v-for="claim in claims" :key="claim.id" class="claim-card surface">
            <view class="claim-card__head"><text>{{ claimTitle(claim) }}</text><text :class="`status--${statusTone(claim.status)}`">{{ statusLabel(claim.status) }}</text></view>
            <text class="claim-card__meta">申请时间：{{ dateTimeText(claim.createdAt) }}</text>
            <text v-if="claim.adminReply || claim.rejectionReason || claim.reviewNote || claim.note" class="claim-card__note">{{ claim.adminReply || claim.rejectionReason || claim.reviewNote || claim.note }}</text>
            <view class="claim-card__foot"><text>领取编号 {{ claim.number || shortId(claim.id) }}</text><text @tap="openClaimBenefit(claim)">查看权益 ›</text></view>
          </view>
        </view>
        <view v-else class="empty-state surface"><view class="empty-state__icon">享</view><text>还没有权益领取记录</text><button class="secondary-button retry-button" @tap="changeTab('public')">去权益大厅</button></view>
      </template>
    </template>

    <BusinessDetailSheet
      :open="Boolean(selected)"
      :title="selected ? selected.title : ''"
      :subtitle="selected ? selected.provider : ''"
      eyebrow="BENEFIT DETAILS"
      :show-actions="true"
      @close="selected = null"
    >
      <template v-if="selected">
        <image v-if="selected.coverUrl" class="detail-cover" :src="selected.coverUrl" mode="aspectFill" />
        <view class="detail-facts"><text>{{ selected.category }}</text><text>{{ selected.audience }}</text><text>{{ selected.value }}</text></view>
        <view class="detail-section"><text>权益说明</text><BusinessRichText :content="selected.summary || selected.content" empty-text="暂无权益说明" /></view>
        <view class="detail-section"><text>领取方式</text><BusinessRichText :content="selected.claimInstructions" empty-text="领取后请留意消息中心的办理通知" /></view>
        <view class="detail-section"><text>使用规则</text><BusinessRichText :content="selected.terms" empty-text="请以服务方实际核验规则为准" /></view>
        <view class="detail-period"><text>有效期</text><text>{{ periodText(selected) }}</text><text>名额</text><text>{{ quotaText(selected) }}</text></view>
      </template>
      <template #actions>
        <button v-if="selected && selected.externalUrl" class="secondary-button" @tap="openExternal">服务方说明</button>
        <button class="primary-button" :disabled="!selected || hasClaimed(selected.id) || claiming" @tap="claimSelected">{{ claimButtonText }}</button>
      </template>
    </BusinessDetailSheet>

    <SupportFooter />
  </view>
</template>

<script>
import { loadAllPages } from '../../utils/authPagination'
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { claimAlumniBenefit, getAlumniBenefits, getMyBenefitClaims } from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { isSchoolVerified, isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() {
    return {
      tab: 'public', benefits: [], claims: [], selected: null, keyword: '', category: '全部',
      verified: false, loading: false, claimLoading: false, claiming: false, error: '', claimError: ''
    }
  },
  computed: {
    categories() { return ['全部', ...new Set(this.benefits.map((item) => item.category).filter(Boolean))] },
    filteredBenefits() {
      const keyword = this.keyword.trim().toLowerCase()
      return this.benefits.filter((item) => {
        const categoryMatched = this.category === '全部' || item.category === this.category
        const searchable = [item.title, item.provider, item.audience, item.value, item.summaryText, ...item.tags].join(' ').toLowerCase()
        return categoryMatched && (!keyword || searchable.includes(keyword))
      })
    },
    claimedIds() {
      return this.claims
        .filter((item) => !['rejected', 'cancelled'].includes(String(item.status || '').toLowerCase()))
        .map((item) => String(item.benefitId || item.resourceId || ''))
        .filter(Boolean)
    },
    claimButtonText() {
      if (!this.selected) return '实名领取'
      if (this.hasClaimed(this.selected.id)) return '已领取'
      if (this.claiming) return '提交中…'
      return this.hasRetryableClaim(this.selected.id) ? '重新领取' : '实名领取'
    }
  },
  onLoad(options = {}) {
    if (options.tab === 'mine') this.tab = 'mine'
  },
  onShow() {
    this.verified = isVerified()
    this.load()
  },
  onPullDownRefresh() { this.load().finally(() => uni.stopPullDownRefresh()) },
  onShareAppMessage() { return { title: '湖财校友专属权益', path: '/pages/benefits/index' } },
  methods: {
    normalizeBenefit(item = {}) {
      const audienceLabels = {
        all: '所有用户',
        student: '在校学生',
        faculty: '教师',
        staff: '教职工',
        faculty_staff: '教师与教职工',
        campus: '在校师生员工',
        alumni: '校友',
        member: '学校实名用户'
      }
      const audience = String(item.audience || 'member')
      return {
        ...item,
        title: String(item.title || '湖财专属权益'),
        category: String(item.category || '综合权益'),
        provider: String(item.provider || '湖南财政经济学院'),
        audience: audienceLabels[audience] || audience,
        value: String(item.value || '专属权益'),
        tags: Array.isArray(item.tags) ? item.tags : [],
        summaryText: markdownToPlainText(item.summary || item.content, { singleLine: true, maxLength: 100 })
      }
    },
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      this.verified = isVerified()
      try {
        const result = await loadAllPages(getAlumniBenefits)
        this.benefits = result.items.map(this.normalizeBenefit)
      } catch (error) {
        if (!this.benefits.length) this.error = error.message || '权益暂时无法加载'
      } finally { this.loading = false }
      if (this.verified) await this.loadClaims()
      else this.claims = []
    },
    async loadClaims() {
      if (this.claimLoading || !isVerified()) return
      this.claimLoading = true
      this.claimError = ''
      try {
        const result = await getMyBenefitClaims()
        this.claims = result.items
      } catch (error) {
        if (!this.claims.length) this.claimError = error.message || '领取记录暂时无法加载'
      } finally { this.claimLoading = false }
    },
    changeTab(tab) {
      this.tab = tab
      if (tab === 'mine' && isVerified()) this.loadClaims()
    },
    resetFilter() { this.keyword = ''; this.category = '全部' },
    open(url) { openPage(url) },
    hasClaimed(id) { return this.claimedIds.includes(String(id)) },
    hasRetryableClaim(id) {
      const targetId = String(id)
      return this.claims.some((item) =>
        String(item.benefitId || item.resourceId || '') === targetId
        && ['rejected', 'cancelled'].includes(String(item.status || '').toLowerCase()))
    },
    benefitActionText(id) {
      if (this.hasClaimed(id)) return '已领取 ›'
      return this.hasRetryableClaim(id) ? '可重新领取 ›' : '查看并领取 ›'
    },
    periodText(item) {
      const start = item?.startAt ? String(item.startAt).slice(0, 10) : ''
      const end = item?.endAt ? String(item.endAt).slice(0, 10) : ''
      if (start && end) return `${start} 至 ${end}`
      if (end) return `截至 ${end}`
      if (start) return `${start} 起`
      return '长期有效'
    },
    quotaText(item) {
      const quota = Number(item?.quota)
      if (!Number.isFinite(quota) || quota <= 0) return '名额以服务方确认为准'
      const claimed = Number(item?.claimCount || item?.claimedCount || 0)
      return claimed > 0 ? `限 ${quota} 份 · 已领取 ${claimed}` : `限量 ${quota} 份`
    },
    statusLabel(status) {
      return ({
        submitted: '待受理',
        pending_review: '待审核',
        processing: '办理中',
        approved: '已通过',
        completed: '已完成',
        fulfilled: '已发放',
        rejected: '未通过',
        cancelled: '已取消',
        closed: '已关闭',
        active: '生效中'
      })[status] || '处理中'
    },
    statusTone(status) {
      return ({
        approved: 'success',
        completed: 'success',
        fulfilled: 'success',
        rejected: 'danger',
        cancelled: 'neutral',
        closed: 'neutral',
        active: 'success',
        submitted: 'warning',
        pending_review: 'warning',
        processing: 'warning'
      })[status] || 'warning'
    },
    claimTitle(claim) {
      if (claim.benefitTitle || claim.title) return claim.benefitTitle || claim.title
      const target = this.benefits.find((item) => String(item.id) === String(claim.benefitId || claim.resourceId))
      return target?.title || '湖财专属权益'
    },
    dateTimeText(value) {
      if (!value) return '时间待同步'
      return String(value).replace('T', ' ').slice(0, 16)
    },
    shortId(id) {
      const value = String(id || '')
      return value ? value.slice(-8).toUpperCase() : '待生成'
    },
    openClaimBenefit(claim) {
      const target = this.benefits.find((item) => String(item.id) === String(claim.benefitId || claim.resourceId))
      if (target) this.selected = target
      else uni.showToast({ title: '该权益已停止公开展示', icon: 'none' })
    },
    openExternal() {
      const url = this.selected?.externalUrl
      this.selected = null
      if (url) openPage(url)
    },
    claimSelected() {
      const benefit = this.selected
      if (!benefit || this.claiming || this.hasClaimed(benefit.id)) return
      if (!isSchoolVerified()) {
        uni.showModal({
          title: '需要学校实名',
          content: '权益仅面向通过学校官网校验的实名用户开放，请先登录或完成实名校验。',
          confirmText: '去校验',
          confirmColor: '#033481',
          success: (result) => { if (result.confirm) openPage('/pages/verify/index') }
        })
        return
      }
      uni.showModal({
        title: '确认领取权益',
        content: `确认领取“${benefit.title}”？领取记录和处理进度可在“我的领取”及消息中心查看。`,
        confirmText: '确认领取',
        confirmColor: '#033481',
        success: async (result) => {
          if (!result.confirm) return
          this.claiming = true
          try {
            await claimAlumniBenefit(benefit.id)
            this.selected = null
            await this.loadClaims()
            this.tab = 'mine'
            uni.showToast({ title: '领取申请已提交', icon: 'none' })
          } catch (error) {
            uni.showModal({ title: '领取失败', content: error.message || '请稍后重试', showCancel: false })
          } finally { this.claiming = false }
        }
      })
    }
  }
}
</script>

<style scoped>
.benefits-page{padding-top:14rpx}.benefit-hero{position:relative;min-height:330rpx;padding:38rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#17334f,#083a78 60%,#8c6b35);box-shadow:0 22rpx 50rpx rgba(11,58,115,.2)}.benefit-hero__eyebrow,.benefit-hero__title,.benefit-hero__desc{position:relative;z-index:2;display:block}.benefit-hero__eyebrow{color:#ead09a;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.benefit-hero__title{margin-top:15rpx;font-size:42rpx;font-weight:700}.benefit-hero__desc{max-width:560rpx;margin-top:12rpx;color:rgba(255,255,255,.68);font-size:20rpx;line-height:1.65}.benefit-hero__rule{position:absolute;z-index:2;left:34rpx;bottom:30rpx;display:flex;gap:12rpx}.benefit-hero__rule text{padding:8rpx 15rpx;border:1rpx solid rgba(255,255,255,.22);border-radius:99rpx;color:rgba(255,255,255,.76);font-size:17rpx}.benefit-hero__mark{position:absolute;right:28rpx;top:-40rpx;color:rgba(255,255,255,.06);font-family:"STKaiti","KaiTi",serif;font-size:250rpx;font-weight:700}.tab-switch{position:relative;z-index:3;margin:-14rpx 18rpx 0;padding:7rpx;display:flex}.tab-switch view{height:66rpx;flex:1;display:flex;align-items:center;justify-content:center;gap:9rpx;border-radius:20rpx;color:#718095;font-size:21rpx}.tab-switch view text:last-child{min-width:30rpx;height:30rpx;padding:0 7rpx;display:flex;align-items:center;justify-content:center;border-radius:99rpx;background:#edf1f5;font-size:16rpx}.tab-switch view.active{color:#fff;background:#033481}.tab-switch view.active text:last-child{color:#033481;background:#fff}.search-box{height:84rpx;margin-top:22rpx;padding:0 20rpx;display:flex;align-items:center}.search-box>text:first-child{color:#033481;font-size:34rpx}.search-box input{min-width:0;flex:1;height:82rpx;margin-left:13rpx;color:#27354a;font-size:23rpx}.search-box>text:last-child{padding:12rpx;color:#a1a9b4;font-size:34rpx}.field-placeholder{color:#abb2bd}.filter-scroll{width:calc(100% + 56rpx);margin:20rpx -28rpx 0;white-space:nowrap}.filter-row{padding:0 28rpx;display:inline-flex}.filter-chip{height:58rpx;margin-right:12rpx;padding:0 22rpx;display:flex;align-items:center;border-radius:19rpx;color:#657187;background:#fff;font-size:21rpx}.filter-chip--active{color:#fff;background:#033481}.result-head{margin:28rpx 4rpx 16rpx;display:flex;justify-content:space-between;color:#37455a;font-size:24rpx;font-weight:650}.result-head text:last-child{color:#9a733b;font-size:18rpx}.benefit-list,.claim-list{display:flex;flex-direction:column}.benefit-card{margin-bottom:18rpx;overflow:hidden}.benefit-card__cover{width:100%;height:230rpx;display:block;background:#e9eef5}.benefit-card__cover--placeholder{padding:28rpx;display:flex;align-items:flex-end;justify-content:space-between;color:#fff;background:linear-gradient(135deg,#0b3b7f,#244f75 65%,#a17c40)}.benefit-card__cover--placeholder text:first-child{font-size:88rpx;font-family:"STKaiti","KaiTi",serif;font-weight:700}.benefit-card__cover--placeholder text:last-child{color:rgba(255,255,255,.56);font-size:16rpx;letter-spacing:3rpx}.benefit-card__body{padding:25rpx 27rpx}.benefit-card__meta{display:flex;gap:8rpx}.benefit-card__meta text{padding:6rpx 11rpx;border-radius:99rpx;color:#735625;background:#f5e8d0;font-size:17rpx}.benefit-card__meta text:last-child{color:#53677e;background:#edf2f7}.benefit-card__title,.benefit-card__provider{display:block}.benefit-card__title{margin-top:14rpx;color:#29374c;font-size:30rpx;font-weight:700}.benefit-card__provider{margin-top:6rpx;color:#8b95a3;font-size:19rpx}.benefit-card__value{margin-top:18rpx;display:flex;align-items:flex-end;justify-content:space-between}.benefit-card__value text:first-child{color:#9a6e2f;font-size:27rpx;font-weight:700}.benefit-card__value text:last-child{color:#8b95a3;font-size:17rpx}.benefit-card__foot{margin-top:18rpx;padding-top:16rpx;display:flex;justify-content:space-between;border-top:1rpx solid #edf0f4;color:#8792a2;font-size:18rpx}.benefit-card__foot text:last-child{color:#033481;font-weight:650}.retry-button{width:240rpx;margin:22rpx auto 0}.login-guide{margin-top:24rpx;padding:56rpx 30rpx;text-align:center}.login-guide>view{width:76rpx;height:76rpx;margin:0 auto 20rpx;display:flex;align-items:center;justify-content:center;border-radius:24rpx;color:#fff;background:#033481;font-size:24rpx;font-weight:700}.login-guide>text{display:block;color:#728094;font-size:21rpx;line-height:1.65}.login-guide button{width:260rpx;margin:25rpx auto 0}.claim-tip{margin-top:24rpx;padding:23rpx;display:flex;align-items:center}.claim-tip>view:first-child{width:58rpx;height:58rpx;margin-right:16rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#7d5d29;background:#f3e5ca;font-weight:700}.claim-tip>view:last-child text{display:block}.claim-tip>view:last-child text:first-child{color:#344257;font-size:22rpx;font-weight:700}.claim-tip>view:last-child text:last-child{margin-top:5rpx;color:#8993a2;font-size:18rpx;line-height:1.5}.claim-card{margin-top:18rpx;padding:25rpx}.claim-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:18rpx}.claim-card__head>text:first-child{min-width:0;flex:1;color:#2d3b50;font-size:26rpx;font-weight:700}.claim-card__head>text:last-child{flex-shrink:0;padding:6rpx 11rpx;border-radius:99rpx;font-size:17rpx;font-weight:650}.status--success{color:#176551;background:#e4f1ec}.status--warning{color:#876225;background:#f5e9d1}.status--danger{color:#97443f;background:#f7e5e3}.status--neutral{color:#687589;background:#edf1f5}.claim-card__meta,.claim-card__note{display:block}.claim-card__meta{margin-top:10rpx;color:#8b95a4;font-size:18rpx}.claim-card__note{margin-top:14rpx;padding:14rpx;border-radius:15rpx;color:#667489;background:#f3f6f9;font-size:19rpx;line-height:1.55}.claim-card__foot{margin-top:18rpx;padding-top:16rpx;display:flex;justify-content:space-between;border-top:1rpx solid #edf0f4;color:#929baa;font-size:17rpx}.claim-card__foot text:last-child{color:#033481;font-weight:650}.detail-cover{width:100%;height:260rpx;margin-bottom:22rpx;display:block;border-radius:22rpx;background:#eef2f6}.detail-facts{display:flex;flex-wrap:wrap;gap:9rpx}.detail-facts text{padding:7rpx 12rpx;border-radius:99rpx;color:#586a81;background:#eef2f7;font-size:18rpx}.detail-section{margin-top:25rpx;padding-top:22rpx;border-top:1rpx solid #e9edf3}.detail-section>text{display:block;margin-bottom:12rpx;color:#2e3c52;font-size:24rpx;font-weight:700}.detail-period{margin-top:24rpx;padding:18rpx;display:grid;grid-template-columns:auto 1fr;gap:9rpx 20rpx;border-radius:19rpx;background:#f3f6f9;font-size:18rpx}.detail-period text:nth-child(odd){color:#8a94a3}.detail-period text:nth-child(even){color:#435168;text-align:right}
@media screen and (min-width:800px){.benefit-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.benefit-card{margin-bottom:0}.benefit-card__cover{height:220px}.claim-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.claim-card{margin-top:0}}
@media screen and (max-width:360px){.benefit-hero{padding-left:26rpx;padding-right:26rpx}.benefit-hero__desc{max-width:510rpx}.benefit-card__value{align-items:flex-start;flex-direction:column;gap:8rpx}}
</style>
