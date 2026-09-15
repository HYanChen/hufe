<template>
  <view class="page-shell page-shell--tab home-page">
    <view class="welcome-row surface">
      <view class="welcome-brand">
        <image class="school-logo" :src="logoUrl" mode="aspectFit" />
        <view class="welcome-copy">
          <text class="welcome-title">你好，{{ user.realName || '湖财人' }}</text>
          <text class="welcome-meta">{{ welcomeMeta }}</text>
        </view>
      </view>
      <view class="notice-button" @tap="open('/pages/inbox/index')"><text>信</text><view v-if="unreadCount">{{ unreadCount > 99 ? '99+' : unreadCount }}</view></view>
    </view>

    <view class="home-desktop-layout">
      <view class="home-primary-pane">
        <view class="hero-card">
          <view class="hero-card__glow hero-card__glow--one"></view><view class="hero-card__glow hero-card__glow--two"></view>
          <view class="hero-copy">
            <view class="hero-kicker"><text class="hero-kicker__dot"></text><text>正德厚生 · 经世济用</text></view>
            <view class="hero-title">{{ heroTitle }}<text>{{ heroHighlight }}</text></view>
            <text class="hero-desc">{{ heroSubtitle }}</text>
            <button class="hero-action" @tap="openHeroAction"><text>{{ verified ? '进入湖财服务' : '登录湖财人' }}</text><text>→</text></button>
          </view>
          <view class="campus-mark"><text>HUFE</text><text>连接每一位湖财人</text></view>
          <text class="official-stamp">HUFE · 官方授权</text>
        </view>
      </view>

      <view class="home-side-pane">
        <view class="task-grid surface">
          <view v-for="item in filterModuleEntries(taskEntries)" :key="item.key" class="task-item" @tap="openTask(item)">
            <view class="task-item__icon" :class="`task-item__icon--${item.tone}`">{{ item.icon }}</view>
            <text class="task-item__title">{{ item.title }}</text><text class="task-item__hint">{{ item.hint }}</text>
          </view>
        </view>

        <view class="ecosystem-entry surface" @tap="open('/pages/ecosystem/index')">
          <view class="ecosystem-entry__icon">生态</view><view><text>湖财校友生态圈</text><text>组织 · 企业 · 合作 · 导师 · 课堂 · 权益</text></view><text>完整导航 ›</text>
        </view>
      </view>
    </view>

    <template v-if="isModuleEnabled('activities') && featuredEvents.length">
      <view class="section-head"><view><text class="section-title">{{ featuredTitle }}</text><text class="section-kicker">MEET AGAIN</text></view><text class="section-more" @tap="open('/pages/events/index')">查看全部 ›</text></view>
      <view class="event-stack"><EventCard v-for="event in featuredEvents" :key="event.id" :event="event" @select="openEvent" /></view>
    </template>

    <template v-if="isModuleEnabled('official-content')">
    <view class="section-head"><view><text class="section-title">湖财官网资讯</text><text class="section-kicker">OFFICIAL WEBSITE SYNC</text></view><text class="section-more" @tap="open('/pages/official-news/index')">查看全部 ›</text></view>
    <view class="content-status" :class="{ 'content-status--offline': contentOffline }"><text>{{ contentStatusText }}</text></view>
    <view v-if="newsItems.length" class="news-list surface">
      <view v-for="(item,index) in newsItems" :key="item.id" class="news-item" :class="{ 'news-item--border': index !== newsItems.length - 1 }" @tap="openNews(item)">
        <image v-if="item.imageUrl" class="news-thumb news-thumb--image" :src="item.imageUrl" mode="aspectFill" />
        <view v-else class="news-thumb" :class="`news-thumb--${item.tone}`"><view class="news-thumb__ring"></view><text>湖财</text></view>
        <view class="news-item__body"><text class="news-item__meta">{{ item.category }} · {{ item.date }}</text><text class="news-item__title">{{ item.title }}</text><text class="news-item__summary">{{ item.summary }}</text></view>
      </view>
    </view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">闻</view><text>官网同步服务暂不可用，请稍后下拉刷新</text></view>
    </template>

    <template v-if="networkVisible && (isModuleEnabled('organizations') || isModuleEnabled('activities') || isModuleEnabled('jobs'))">
      <view class="section-head"><view><text class="section-title">湖财在一起</text><text class="section-kicker">ALUMNI NETWORK</text></view></view>
      <view class="network-card">
        <view><text class="network-card__title">可信连接，协作共成长</text><text class="network-card__desc">连接在校学生、教师、教职工与海内外校友。</text></view>
        <view class="network-card__stats"><view v-for="item in visibleStats" :key="item.label" class="network-stat"><view><text class="network-stat__value">{{ item.value }}</text><text class="network-stat__unit">{{ item.unit }}</text></view><text class="network-stat__label">{{ item.label }}</text></view></view>
      </view>
    </template>
    <SupportFooter />
  </view>
</template>

<script>
import EventCard from '../../components/EventCard.vue'
import { appConfig } from '../../config/index'
import { getHomeOperations, getMyInbox } from '../../services/business'
import { formatOfficialItem, getOfficialHome } from '../../services/content'
import { getUser, identityLabel, isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { EventCard },
  data() {
    return {
      user: {}, logoUrl: appConfig.officialLogoUrl, verified: false, unreadCount: 0,
      newsItems: [], contentStatus: null, contentOffline: true, featuredEvents: [],
      heroConfig: null, featuredConfig: null, networkVisible: false,
      taskEntries: [
        { key:'find',icon:'找',title:'找校友',hint:'人脉与组织',tone:'blue',url:'/pages/directory/index' },
        { key:'handle',icon:'办',title:'办服务',hint:'校园事项',tone:'gold',url:'/pages/services/index' },
        { key:'connect',icon:'联',title:'联资源',hint:'企业与合作',tone:'green',url:'/pages/ecosystem/index' },
        { key:'learn',icon:'学',title:'学成长',hint:'课堂与资讯',tone:'red',url:'/pages/academy/index' },
        { key:'enjoy',icon:'享',title:'享权益',hint:'专属与回馈',tone:'purple',url:'/pages/benefits/index' }
      ],
      stats: [
        { value:'—',unit:'',label:'公开组织' },
        { value:'—',unit:'',label:'近期活动' },
        { value:'—',unit:'',label:'在招岗位' }
      ]
    }
  },
  computed: {
    visibleStats() { return this.stats.filter(item => this.isModuleEnabled(({ '公开组织':'organizations', '近期活动':'activities', '在招岗位':'jobs' })[item.label])) },
    heroTitle() { return this.heroConfig?.title || '连接每一位' },
    heroHighlight() { return this.heroConfig?.highlight || (this.heroConfig ? '' : '湖财人') },
    heroSubtitle() { return this.heroConfig?.subtitle || '身份、服务、资源与共同记忆，在这里重新相遇。' },
    welcomeMeta() {
      if (!this.verified) return '登录后使用实名校园服务'
      return `${identityLabel(this.user.personType)} · ${this.user.department || '湖南财政经济学院'}`
    },
    featuredTitle() { return this.featuredConfig?.title || '近期活动' },
    contentStatusText() {
      if (this.contentOffline) return '官网同步暂不可用，当前暂无可展示资讯'
      return this.contentStatus?.stale ? '已读取官网缓存，部分内容源待恢复' : '已与学校官网内容源同步'
    }
  },
  onLoad() { uni.$on('hufe-auth-changed', this.loadData) },
  onShow() { this.loadData() },
  onUnload() { uni.$off('hufe-auth-changed', this.loadData) },
  onPullDownRefresh() { this.loadData().finally(() => { uni.stopPullDownRefresh(); uni.showToast({ title:'已刷新' }) }) },
  onShareAppMessage() { return { title:'湖财人 · 连接每一位师生校友', path:'/pages/home/index' } },
  methods: {
    async loadData() {
      this.user = getUser()
      this.verified = isVerified()
      const tasks = [this.loadBusinessHome(), this.loadOfficialContent()]
      if (this.verified) tasks.push(this.loadInboxSummary())
      else this.unreadCount = 0
      await Promise.allSettled(tasks)
    },
    async loadOfficialContent() {
      try {
        const result = await getOfficialHome()
        const sections = result.sections || {}
        const officialItems = [sections.news?.[0], sections.notices?.[0], sections.academic?.[0], sections.alumni?.[0]].filter(Boolean)
        if (!officialItems.length) throw new Error('官网暂无同步内容')
        this.newsItems = officialItems.map(formatOfficialItem)
        this.contentStatus = result.status || null
        this.contentOffline = false
      } catch {
        this.newsItems = []
        this.contentStatus = null
        this.contentOffline = true
      }
    },
    async loadInboxSummary() {
      try {
        const result = await getMyInbox({ page:1, pageSize:1 })
        this.unreadCount = Number(result.unread || 0)
      } catch { this.unreadCount = 0 }
    },
    formatEvent(event,index) {
      const date = new Date(event.startAt || '')
      const valid = !Number.isNaN(date.getTime())
      const pad = (value) => String(value).padStart(2,'0')
      return {
        ...event, tag:event.category || '湖财活动', theme:['career','homecoming','finance'][index % 3],
        month:valid ? pad(date.getMonth()+1) : '--', day:valid ? pad(date.getDate()) : '--',
        time:valid ? `${date.getFullYear()}.${pad(date.getMonth()+1)}.${pad(date.getDate())}` : '时间待定',
        city:event.city || '长沙', joined:Number(event.registrationCount || 0), registered:false
      }
    },
    async loadBusinessHome() {
      const [homeResult] = await Promise.allSettled([getHomeOperations()])
      if (homeResult.status === 'fulfilled') {
        const result = homeResult.value
        const sections = Array.isArray(result.sections) ? [...result.sections].sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0)) : []
        this.heroConfig = sections.find((item)=>item.slot === 'hero') || null
        this.featuredConfig = sections.find((item)=>item.slot === 'featured') || null
        this.featuredEvents = (result.activities || []).slice(0,2).map(this.formatEvent)
        const organizations = result.organizations || [], jobs = result.jobs || []
        this.networkVisible = organizations.length > 0 || jobs.length > 0
        this.stats = [
          { value:String(organizations.length),unit:'个',label:'公开组织' },
          { value:String((result.activities || []).length),unit:'场',label:'近期活动' },
          { value:String(jobs.length),unit:'个',label:'在招岗位' }
        ]
      }
    },
    targetUrl(item) {
      if (!item) return ''
      const target = item.target || item.route || item.url || ''
      if (!target) return ''
      if (item.targetType === 'activity') return `/pages/event-detail/index?id=${encodeURIComponent(target)}`
      if (item.targetType === 'service') return '/pages/services/index'
      if (item.targetType === 'official-content' && !String(target).startsWith('/')) return `/pages/news-detail/index?id=${encodeURIComponent(target)}&official=1`
      return target
    },
    openHeroAction() {
      if (!this.verified) { openPage('/pages/verify/index'); return }
      openPage(this.targetUrl(this.heroConfig) || '/pages/services/index')
    },
    open(url) { openPage(url) },
    openTask(item) {
      if (item?.key === 'find' && !this.verified) {
        uni.showModal({
          title: '请先完成实名登录',
          content: '校友名录仅向已完成学校实名校验的账号开放。',
          confirmText: '去登录',
          confirmColor: '#033481',
          success: (result) => { if (result.confirm) openPage('/pages/verify/index') }
        })
        return
      }
      openPage(item?.url || '/pages/services/index')
    },
    openEvent(id) { openPage(`/pages/event-detail/index?id=${id}`) },
    openNews(item) { openPage(`/pages/news-detail/index?id=${encodeURIComponent(item.id)}${item.official ? '&official=1' : ''}`) }
  }
}
</script>

<style scoped>
.home-page{overflow:hidden}.home-primary-pane,.home-side-pane{min-width:0}.welcome-row{margin-bottom:22rpx;padding:18rpx 18rpx 18rpx 20rpx;display:flex;align-items:center;justify-content:space-between;gap:16rpx;border:1rpx solid rgba(3,52,129,.06);background:linear-gradient(100deg,#fff,#f6f9fd)}.welcome-brand{min-width:0;flex:1;display:flex;align-items:center;gap:18rpx}.school-logo{width:206rpx;height:58rpx;padding:6rpx 10rpx;flex-shrink:0;border-radius:13rpx;background:#033481}.welcome-copy{min-width:0;flex:1}.welcome-title,.welcome-meta{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.welcome-title{color:#17304f;font-size:28rpx;line-height:1.25;font-weight:700}.welcome-meta{margin-top:5rpx;color:#7d899a;font-size:17rpx;line-height:1.35}.notice-button{position:relative;width:66rpx;height:66rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:22rpx;color:#033481;background:#edf3fb;font-size:20rpx;font-weight:700}.notice-button>text{width:34rpx;height:34rpx;display:flex;align-items:center;justify-content:center;border:2rpx solid currentColor;border-radius:12rpx}.notice-button>view{position:absolute;right:-9rpx;top:-9rpx;min-width:33rpx;height:33rpx;padding:0 6rpx;display:flex;align-items:center;justify-content:center;border:3rpx solid #fff;border-radius:99rpx;color:#fff;background:#a64f4a;font-size:12rpx}.hero-card{position:relative;min-height:400rpx;padding:44rpx 38rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(145deg,#062b67 0%,#033481 54%,#18569e 100%);box-shadow:0 24rpx 54rpx rgba(9,47,105,.22)}.hero-card__glow{position:absolute;border:1rpx solid rgba(255,255,255,.14);border-radius:50%}.hero-card__glow--one{width:380rpx;height:380rpx;top:-230rpx;right:-70rpx}.hero-card__glow--two{width:230rpx;height:230rpx;right:30rpx;bottom:-150rpx}.hero-copy{position:relative;z-index:3;width:68%}.hero-kicker{display:flex;align-items:center;color:rgba(255,255,255,.72);font-size:20rpx}.hero-kicker__dot{width:10rpx;height:10rpx;margin-right:12rpx;border-radius:50%;background:#e0bd7d;box-shadow:0 0 0 8rpx rgba(224,189,125,.12)}.hero-title{margin-top:28rpx;font-size:49rpx;line-height:1.2;font-weight:700;letter-spacing:2rpx}.hero-title text{display:block;color:#e6c98f}.hero-desc{display:block;max-width:420rpx;margin-top:16rpx;color:rgba(255,255,255,.66);font-size:21rpx;line-height:1.6}.hero-action{width:244rpx;height:64rpx;margin:25rpx 0 0;padding:0 22rpx;display:flex;align-items:center;justify-content:space-between;border-radius:18rpx;color:#033481;background:#fff;font-size:22rpx;line-height:64rpx;font-weight:600}.campus-mark{position:absolute;right:34rpx;bottom:38rpx;text-align:right}.campus-mark text{display:block}.campus-mark text:first-child{color:rgba(255,255,255,.13);font-family:Georgia,serif;font-size:72rpx;font-weight:700;letter-spacing:6rpx}.campus-mark text:last-child{margin-top:5rpx;color:rgba(255,255,255,.43);font-size:16rpx;letter-spacing:2rpx}.official-stamp{position:absolute;right:22rpx;top:20rpx;padding:8rpx 14rpx;border:1rpx solid rgba(255,255,255,.26);border-radius:99rpx;color:rgba(255,255,255,.62);font-size:18rpx;letter-spacing:2rpx}.task-grid{position:relative;z-index:4;margin:-18rpx 15rpx 0;padding:24rpx 8rpx 20rpx;display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}.task-item{min-width:0;text-align:center}.task-item__icon{width:68rpx;height:68rpx;margin:0 auto;display:flex;align-items:center;justify-content:center;border-radius:22rpx;font-size:24rpx;font-weight:700}.task-item__icon--blue{color:#033481;background:#e6edf8}.task-item__icon--gold{color:#8b682e;background:#f6ebd7}.task-item__icon--green{color:#176551;background:#e4f2ed}.task-item__icon--red{color:#964644;background:#f7e7e5}.task-item__icon--purple{color:#654888;background:#eee7f5}.task-item__title,.task-item__hint{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.task-item__title{margin-top:12rpx;font-size:21rpx;font-weight:650}.task-item__hint{margin-top:4rpx;color:#9aa2af;font-size:15rpx}.announcement-card{margin-top:22rpx;padding:23rpx;display:flex;align-items:center}.announcement-card__icon{position:relative;width:64rpx;height:64rpx;margin-right:17rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:21rpx;color:#7d5d29;background:#f3e5ca;font-size:22rpx;font-weight:700}.announcement-card__icon>text{position:absolute;right:-7rpx;top:-7rpx;width:26rpx;height:26rpx;display:flex;align-items:center;justify-content:center;border:3rpx solid #fff;border-radius:50%;color:#fff;background:#a64f4a;font-size:13rpx}.announcement-card__body{min-width:0;flex:1}.announcement-card__body>view{display:flex;justify-content:space-between;gap:12rpx}.announcement-card__body>view text{color:#9a733b;font-size:16rpx}.announcement-card__body>view text:last-child{color:#9aa2af}.announcement-card__title,.announcement-card__summary{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.announcement-card__title{margin-top:6rpx;color:#334157;font-size:23rpx;font-weight:700}.announcement-card__summary{margin-top:5rpx;color:#8b95a3;font-size:18rpx}.announcement-card__arrow{margin-left:12rpx;color:#033481;font-size:34rpx}.event-stack{display:flex;flex-direction:column}.event-stack :deep(.event-card){margin-bottom:18rpx}.content-status{margin:-8rpx 4rpx 16rpx;color:#176551;font-size:19rpx}.content-status--offline{color:#946d32}.news-list{padding:0 24rpx}.news-item{padding:24rpx 0;display:flex}.news-item--border{border-bottom:1rpx solid #edf0f4}.news-thumb{position:relative;width:130rpx;height:126rpx;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;border-radius:24rpx;color:rgba(255,255,255,.92);font-size:26rpx;font-weight:700;letter-spacing:4rpx}.news-thumb--blue{background:linear-gradient(145deg,#0a377d,#4a76b1)}.news-thumb--gold{background:linear-gradient(145deg,#9b743a,#d5b274)}.news-thumb--green{background:linear-gradient(145deg,#1b6353,#6b9c89)}.news-thumb--image{display:block;background:#e9eef6}.news-thumb__ring{position:absolute;width:88rpx;height:88rpx;border:1rpx solid rgba(255,255,255,.36);border-radius:50%}.news-thumb text{position:relative;z-index:1}.news-item__body{flex:1;min-width:0;margin-left:22rpx}.news-item__meta,.news-item__title,.news-item__summary{display:block}.news-item__meta{color:#a07a42;font-size:20rpx}.news-item__title,.news-item__summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.news-item__title{margin-top:7rpx;font-size:27rpx;font-weight:650}.news-item__summary{margin-top:8rpx;color:#8992a0;font-size:21rpx}.ecosystem-entry{margin-top:26rpx;padding:23rpx 25rpx;display:flex;align-items:center;background:linear-gradient(100deg,#fff,#f2f6fb)}.ecosystem-entry__icon{width:72rpx;height:72rpx;margin-right:18rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:23rpx;color:#fff;background:linear-gradient(145deg,#033481,#326ba8);font-size:19rpx;font-weight:700}.ecosystem-entry>view:nth-child(2){min-width:0;flex:1}.ecosystem-entry>view:nth-child(2) text{display:block}.ecosystem-entry>view:nth-child(2) text:first-child{color:#2d3b51;font-size:25rpx;font-weight:700}.ecosystem-entry>view:nth-child(2) text:last-child{margin-top:5rpx;color:#8b95a4;font-size:18rpx}.ecosystem-entry>text{margin-left:12rpx;color:#033481;font-size:18rpx;font-weight:650}.network-card{padding:34rpx 30rpx;border-radius:30rpx;color:#fff;background:linear-gradient(135deg,#17304f,#244d72)}.network-card__title,.network-card__desc,.network-stat__label{display:block}.network-card__title{font-size:30rpx;font-weight:650}.network-card__desc{margin-top:10rpx;color:rgba(255,255,255,.6);font-size:21rpx}.network-card__stats{margin-top:34rpx;display:flex}.network-stat{flex:1;border-right:1rpx solid rgba(255,255,255,.13);text-align:center}.network-stat:last-child{border-right:none}.network-stat__value{color:#e1c58d;font-size:38rpx;font-weight:700}.network-stat__unit{margin-left:5rpx;color:rgba(255,255,255,.62);font-size:19rpx}.network-stat__label{margin-top:6rpx;color:rgba(255,255,255,.56);font-size:19rpx}
@media screen and (min-width:768px){.hero-copy{width:75%}.hero-title{font-size:54px}.hero-desc{max-width:680px}.task-grid{padding-left:36px;padding-right:36px}.task-item__icon{width:64px;height:64px}.task-item__title{font-size:17px}.task-item__hint{font-size:13px}.news-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:30px}.news-item:nth-child(odd){border-bottom:1rpx solid #edf0f4}.news-item:nth-child(even){border-bottom:none}.event-stack{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.campus-mark text:first-child{font-size:100px}}
@media screen and (min-width:1200px){.welcome-row{margin-bottom:28px;padding:16px 18px 16px 20px;border-radius:22px}.welcome-brand{gap:20px}.school-logo{width:245px;height:58px;padding:7px 12px;border-radius:14px}.welcome-title{font-size:24px}.welcome-meta{margin-top:5px;font-size:14px}.notice-button{width:50px;height:50px;border-radius:16px}.notice-button>text{width:28px;height:28px;border-width:1px;border-radius:9px}.home-desktop-layout{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(390px,.65fr);gap:28px;align-items:stretch}.home-primary-pane{display:flex}.hero-card{width:100%;min-height:530px;padding:58px 56px;border-radius:34px}.hero-copy{width:70%}.hero-kicker{font-size:17px}.hero-title{margin-top:34px;font-size:66px}.hero-desc{max-width:650px;margin-top:22px;font-size:20px}.hero-action{width:240px;height:64px;margin-top:34px;padding:0 24px;border-radius:18px;font-size:18px;line-height:64px}.home-side-pane{display:flex;flex-direction:column;gap:18px}.home-side-pane .task-grid{flex:1;margin:0;padding:18px;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.home-side-pane .task-item{padding:16px 14px;display:grid;grid-template-columns:48px minmax(0,1fr);grid-template-rows:auto auto;column-gap:12px;align-items:center;border:1px solid #edf1f6;border-radius:18px;background:#f8fafc;text-align:left}.home-side-pane .task-item:last-child{grid-column:1/-1}.home-side-pane .task-item__icon{width:48px;height:48px;margin:0;grid-row:1/3;border-radius:15px}.home-side-pane .task-item__title{margin:0;font-size:16px}.home-side-pane .task-item__hint{margin-top:3px;font-size:13px}.home-side-pane .announcement-card,.home-side-pane .ecosystem-entry{margin-top:0;padding:20px;border-radius:22px}.home-side-pane .announcement-card__title{font-size:17px}.home-side-pane .announcement-card__summary{font-size:14px}.home-side-pane .ecosystem-entry__icon{width:56px;height:56px;margin-right:14px}.home-side-pane .ecosystem-entry>view:nth-child(2) text:first-child{font-size:18px}.home-side-pane .ecosystem-entry>view:nth-child(2) text:last-child{font-size:13px}.section-title{font-size:30px}.network-card{padding:42px 44px}}
@media screen and (max-width:360px){.welcome-row{padding-left:14rpx;padding-right:14rpx;gap:12rpx}.welcome-brand{gap:13rpx}.school-logo{width:180rpx;height:54rpx}.welcome-title{font-size:25rpx}.welcome-meta{font-size:15rpx}.notice-button{width:60rpx;height:60rpx}.hero-card{padding-left:27rpx;padding-right:27rpx}.hero-copy{width:78%}.hero-title{font-size:43rpx}.official-stamp{font-size:15rpx}.task-grid{margin-left:5rpx;margin-right:5rpx}.task-item__icon{width:60rpx;height:60rpx}.task-item__hint{display:none}.announcement-card{padding:20rpx}.campus-mark{display:none}}
</style>
