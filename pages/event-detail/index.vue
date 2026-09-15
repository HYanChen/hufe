<template>
  <view v-if="event" class="page-shell with-sticky-action event-detail-page">
    <view class="detail-hero" :class="`detail-hero--${event.theme}`">
      <view class="detail-hero__watermark">HUFE</view>
      <view class="detail-date">
        <text class="detail-date__month">{{ event.month }}月</text>
        <text class="detail-date__day">{{ event.day }}</text>
      </view>
      <view class="detail-hero__body">
        <view class="detail-hero__topline">
          <text class="detail-tag">{{ event.tag }}</text>
          <text class="detail-city">◉ {{ event.city }}</text>
        </view>
        <text class="detail-title">{{ event.title }}</text>
        <text class="detail-subtitle">{{ event.subtitle }}</text>
      </view>
    </view>

    <view class="status-card surface">
      <view class="status-card__top">
        <view>
          <text class="status-card__eyebrow">REGISTRATION</text>
          <text class="status-card__title">{{ registrationTitle }}</text>
        </view>
        <text class="status-badge" :class="{ 'status-badge--joined': event.registered, 'status-badge--closed': !registrationOpen }">{{ registrationBadge }}</text>
      </view>
      <view v-if="hasQuota" class="quota-track"><view class="quota-track__fill" :style="{ width: `${progress}%` }"></view></view>
      <view class="quota-meta"><text>已报名 {{ currentJoined }} 人</text><text>{{ hasQuota ? `限额 ${event.quota} 人` : '名额不限' }}</text></view>
    </view>

    <view class="section-head"><view><text class="section-title">活动信息</text><text class="section-kicker">EVENT DETAILS</text></view></view>
    <view class="info-card surface">
      <view v-for="item in infoItems" :key="item.label" class="info-row">
        <view class="info-row__icon">{{ item.icon }}</view>
        <view class="info-row__body"><text class="info-row__label">{{ item.label }}</text><text class="info-row__value">{{ item.value }}</text></view>
      </view>
    </view>

    <view class="section-head"><view><text class="section-title">活动亮点</text><text class="section-kicker">HIGHLIGHTS</text></view></view>
    <view class="highlight-list">
      <view v-for="(highlight, index) in event.highlights" :key="highlight" class="highlight-item surface">
        <text class="highlight-item__index">0{{ index + 1 }}</text>
        <text class="highlight-item__text">{{ highlight }}</text>
      </view>
    </view>

    <view class="section-head"><view><text class="section-title">活动介绍</text><text class="section-kicker">ABOUT THE EVENT</text></view></view>
    <view class="description-card surface">
      <BusinessRichText :content="event.description" empty-text="暂无活动介绍" />
      <view class="description-card__organizer"><text>主办方</text><text>{{ event.organizer }}</text></view>
    </view>

    <view class="registration-note">
      <text class="registration-note__title">报名说明</text>
      <text>{{ registrationState.description }}</text>
    </view>

    <SupportFooter />
    <view class="sticky-action action-row">
      <button class="share-button" open-type="share" @tap="share"><text>↗</text><text>分享</text></button>
      <button class="primary-button registration-button" :class="{ 'registration-button--cancel': event.registered && canCancelRegistration, 'registration-button--disabled': actionDisabled }" :disabled="actionDisabled" @tap="toggleRegister">
        {{ actionLabel }}
      </button>
    </view>
  </view>
  <view v-else class="page-shell">
    <view class="empty-state surface"><view class="empty-state__icon">{{ loading ? '…' : '!' }}</view><text>{{ loading ? '正在加载活动详情' : (error || '活动不存在或已下架') }}</text><button v-if="!loading" class="secondary-button" @tap="loadEvent">重新加载</button></view>
    <SupportFooter />
  </view>
</template>

<script>
import { sharePage } from '../../utils/share'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { cancelActivityRegistration, getActivity, getMyActivityRegistrations, registerForActivity } from '../../services/business'
import { isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessRichText },
  data() {
    return { eventId: '', event: null, loading: false, error: '', nowTimestamp: Date.now(), statusTimer: null }
  },
  computed: {
    currentJoined() {
      return this.event ? this.event.joined : 0
    },
    hasQuota() {
      return Boolean(this.event && this.event.quota > 0)
    },
    remaining() {
      return this.hasQuota ? Math.max(this.event.quota - this.currentJoined, 0) : Number.POSITIVE_INFINITY
    },
    progress() {
      if (!this.event || !this.event.quota) return 0
      return Math.min(Math.round((this.currentJoined / this.event.quota) * 100), 100)
    },
    registrationState() {
      if (!this.event) {
        return { code: 'unavailable', title: '活动暂不可报名', badge: '不可报名', actionLabel: '暂不可报名', description: '活动状态正在同步，请稍后重试。' }
      }
      const status = String(this.event.status || '').toLowerCase()
      if (status === 'completed') {
        return { code: 'completed', title: '活动已结束', badge: '已结束', actionLabel: '活动已结束', description: '本次活动已经结束，报名和取消入口均已关闭。' }
      }
      if (status === 'closed') {
        return { code: 'closed', title: '活动报名已关闭', badge: '已关闭', actionLabel: '报名已关闭', description: '后台已关闭本次活动报名，已报名记录仍可在“我的活动”中查看。' }
      }
      const startsAt = Date.parse(this.event.startAt || '')
      if (Number.isFinite(startsAt) && startsAt <= this.nowTimestamp) {
        return { code: 'started', title: '活动已开始', badge: '已开始', actionLabel: '活动已开始', description: '活动已经开始，不能再报名或取消；现场安排以主办方通知为准。' }
      }
      const deadline = Date.parse(this.event.registrationDeadline || '')
      if (Number.isFinite(deadline) && deadline <= this.nowTimestamp) {
        return { code: 'deadline', title: '活动报名已截止', badge: '已截止', actionLabel: '报名已截止', description: '本次活动已超过报名截止时间，不能再报名或取消。' }
      }
      if (!this.event.registered && this.hasQuota && this.remaining <= 0) {
        return { code: 'full', title: '活动名额已满', badge: '名额已满', actionLabel: '名额已满', description: '本次活动报名名额已满；如有名额释放，请以页面最新状态为准。' }
      }
      return {
        code: 'open',
        title: '活动报名进行中',
        badge: this.hasQuota ? `${this.remaining} 个名额` : '不限名额',
        actionLabel: '立即报名',
        description: '报名结果由服务端保存，可在“我的活动”查看；活动变更、截止或下架状态以后台最新发布为准。'
      }
    },
    registrationOpen() {
      return this.registrationState.code === 'open'
    },
    canCancelRegistration() {
      return Boolean(this.event?.registered && this.registrationOpen)
    },
    actionDisabled() {
      if (!this.event) return true
      return this.event.registered ? !this.canCancelRegistration : !this.registrationOpen
    },
    registrationTitle() {
      if (!this.event?.registered) return this.registrationState.title
      return this.registrationOpen ? '你已报名本次活动' : `你已报名 · ${this.registrationState.title}`
    },
    registrationBadge() {
      return this.event?.registered ? '已报名' : this.registrationState.badge
    },
    actionLabel() {
      if (!this.event) return '立即报名'
      if (this.event.registered && this.canCancelRegistration) return '取消报名'
      if (this.event.registered) return this.registrationState.actionLabel
      return this.registrationState.actionLabel
    },
    infoItems() {
      if (!this.event) return []
      return [
        { icon: '时', label: '活动时间', value: this.event.time },
        { icon: '址', label: '活动地点', value: this.event.venue },
        { icon: '止', label: '报名截止', value: this.event.deadline },
        { icon: '办', label: '主办单位', value: this.event.organizer }
      ]
    }
  },
  onLoad(options) {
    this.eventId = options.id || ''
    this.loadEvent()
  },
  onShow() {
    this.startStatusClock()
    if (this.eventId) this.loadEvent()
  },
  onHide() {
    this.stopStatusClock()
  },
  onUnload() {
    this.stopStatusClock()
  },
  onShareAppMessage() {
    const title = this.event?.title || '湖财校友活动'
    return { title: `${title}｜湖财校友活动`, path: `/pages/event-detail/index?id=${this.eventId}` }
  },
  methods: {
    share() { return sharePage(`/pages/event-detail/index?id=${encodeURIComponent(this.eventId)}`, this.event?.title || '湖财校友活动') },
    startStatusClock() {
      this.stopStatusClock()
      this.nowTimestamp = Date.now()
      this.statusTimer = setInterval(() => { this.nowTimestamp = Date.now() }, 30 * 1000)
    },
    stopStatusClock() {
      if (this.statusTimer) clearInterval(this.statusTimer)
      this.statusTimer = null
    },
    formatDate(value, fallback = '时间待定') {
      const date = new Date(value || '')
      if (Number.isNaN(date.getTime())) return fallback
      const pad = (part) => String(part).padStart(2, '0')
      return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
    async loadEvent() {
      if (!this.eventId || this.loading) return
      this.loading = true; this.error = ''
      this.nowTimestamp = Date.now()
      try {
        const [source, mine] = await Promise.all([
          getActivity(this.eventId),
          isVerified() ? getMyActivityRegistrations() : Promise.resolve({ items: [] })
        ])
        const registration = mine.items.find((item) => item.activityId === source.id && !['cancelled', 'rejected'].includes(item.status))
        const start = new Date(source.startAt || '')
        const pad = (value) => String(value).padStart(2, '0')
        this.event = {
          ...source, tag: source.category || '湖财活动', theme: source.theme || 'career',
          month: Number.isNaN(start.getTime()) ? '--' : pad(start.getMonth() + 1), day: Number.isNaN(start.getTime()) ? '--' : pad(start.getDate()),
          time: this.formatDate(source.startAt), deadline: this.formatDate(source.registrationDeadline, '以后台通知为准'),
          subtitle: source.summary || '', joined: Number(source.registrationCount || 0), quota: Number(source.quota || 0),
          highlights: Array.isArray(source.highlights) ? source.highlights : [], registered: Boolean(registration),
          registrationId: registration?.id || '', registrationRevision: registration?.revision
        }
        uni.setNavigationBarTitle({ title: this.event.tag })
      } catch (error) { this.event = null; this.error = error.message || '活动详情加载失败' }
      finally { this.loading = false }
    },
    toggleRegister() {
      this.nowTimestamp = Date.now()
      if (this.actionDisabled) {
        uni.showToast({ title: this.registrationState.actionLabel, icon: 'none' })
        return
      }
      if (!isVerified()) {
        uni.showModal({
          title: '需要登录湖财人账号',
          content: '登录已实名注册的平台账号后即可报名活动。',
          confirmText: '去登录',
          confirmColor: '#033481',
          success: (res) => { if (res.confirm) openPage('/pages/verify/index') }
        })
        return
      }
      if (!this.event.registered && this.hasQuota && this.remaining <= 0) {
        uni.showToast({ title: '本场活动名额已满', icon: 'none' })
        return
      }
      if (this.event.registered) {
        uni.showModal({
          title: '取消报名',
          content: '确认取消本次活动报名吗？取消后名额将重新释放。',
          confirmText: '确认取消',
          confirmColor: '#9A4C48',
          success: async (res) => {
            if (!res.confirm) return
            try { await cancelActivityRegistration(this.event.registrationId, this.event.registrationRevision); await this.loadEvent(); uni.showToast({ title: '已取消报名', icon: 'none' }) }
            catch (error) { uni.showModal({ title: '取消失败', content: error.message || '请稍后重试', showCancel: false }) }
          }
        })
        return
      }
      uni.showModal({
        title: '确认报名',
        content: `${this.event.title}\n${this.event.time}\n${this.event.venue}`,
        confirmText: '确认报名',
        confirmColor: '#033481',
        success: async (res) => {
          if (!res.confirm) return
          try { await registerForActivity(this.event.id); await this.loadEvent(); uni.showToast({ title: '报名成功' }) }
          catch (error) { uni.showModal({ title: '报名失败', content: error.message || '请稍后重试', showCancel: false }) }
        }
      })
    }
  }
}
</script>

<style scoped>
.event-detail-page { padding-top: 12rpx; }
.detail-hero { position: relative; min-height: 386rpx; padding: 34rpx; overflow: hidden; display: flex; align-items: flex-end; border-radius: 38rpx; color: #FFFFFF; box-shadow: 0 24rpx 54rpx rgba(9, 47, 105, .2); }
.detail-hero--career { background: linear-gradient(140deg, #082D69, #15549C); }
.detail-hero--homecoming { background: linear-gradient(140deg, #61461F, #A27A3F 68%, #C2A66F); }
.detail-hero--finance { background: linear-gradient(140deg, #124D43, #247562 68%, #438D79); }
.detail-hero::before { content: ''; position: absolute; width: 310rpx; height: 310rpx; right: -105rpx; top: -118rpx; border: 1rpx solid rgba(255, 255, 255, .16); border-radius: 50%; box-shadow: 0 0 0 45rpx rgba(255, 255, 255, .035); }
.detail-hero__watermark { position: absolute; right: 20rpx; top: 150rpx; color: rgba(255, 255, 255, .08); font-family: Georgia, serif; font-size: 86rpx; font-weight: 700; letter-spacing: 6rpx; transform: rotate(-10deg); }
.detail-date { width: 112rpx; height: 132rpx; margin-right: 24rpx; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1rpx solid rgba(255, 255, 255, .25); border-radius: 28rpx; background: rgba(255, 255, 255, .1); backdrop-filter: blur(12rpx); }
.detail-date__month, .detail-date__day, .detail-title, .detail-subtitle, .status-card__eyebrow, .status-card__title, .info-row__label, .info-row__value { display: block; }
.detail-date__month { color: rgba(255, 255, 255, .72); font-size: 20rpx; }
.detail-date__day { margin-top: 4rpx; font-family: Georgia, serif; font-size: 50rpx; line-height: 1; font-weight: 700; }
.detail-hero__body { position: relative; z-index: 1; flex: 1; min-width: 0; }
.detail-hero__topline { display: flex; align-items: center; justify-content: space-between; }
.detail-tag { padding: 8rpx 16rpx; border-radius: 99rpx; color: #745522; background: #E5CA92; font-size: 18rpx; font-weight: 700; }
.detail-city { color: rgba(255, 255, 255, .62); font-size: 19rpx; }
.detail-title { margin-top: 16rpx; font-size: 38rpx; line-height: 1.28; font-weight: 700; }
.detail-subtitle { margin-top: 12rpx; color: rgba(255, 255, 255, .62); font-size: 21rpx; line-height: 1.5; }
.status-card { position: relative; z-index: 2; margin: -20rpx 18rpx 0; padding: 26rpx; }
.status-card__top { display: flex; align-items: center; justify-content: space-between; }
.status-card__eyebrow { color: #A3834D; font-size: 17rpx; font-weight: 700; letter-spacing: 3rpx; }
.status-card__title { margin-top: 7rpx; font-size: 26rpx; font-weight: 650; }
.status-badge { padding: 9rpx 16rpx; border-radius: 99rpx; color: #765823; background: #F4E5C7; font-size: 18rpx; font-weight: 650; }
.status-badge--joined { color: #176551; background: #E4F1EC; }
.status-badge--closed { color: #69778A; background: #E9EDF2; }
.quota-track { height: 12rpx; margin-top: 24rpx; overflow: hidden; border-radius: 99rpx; background: #EDF0F5; }
.quota-track__fill { height: 100%; border-radius: 99rpx; background: linear-gradient(90deg, #033481, #C2A26B); transition: width .25s ease; }
.quota-meta { margin-top: 10rpx; display: flex; justify-content: space-between; color: #939BA8; font-size: 18rpx; }
.info-card { padding: 0 26rpx; }
.info-row { min-height: 112rpx; padding: 22rpx 0; display: flex; align-items: center; border-bottom: 1rpx solid #EDF0F4; }
.info-row:last-child { border-bottom: none; }
.info-row__icon { width: 58rpx; height: 58rpx; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 19rpx; color: #033481; background: #E8EEF8; font-size: 21rpx; font-weight: 700; }
.info-row__body { margin-left: 18rpx; }
.info-row__label { color: #939BA8; font-size: 19rpx; }
.info-row__value { margin-top: 6rpx; color: #2F3B50; font-size: 24rpx; line-height: 1.45; font-weight: 600; }
.highlight-list { display: flex; flex-wrap: wrap; margin: 0 -7rpx; }
.highlight-item { width: calc(50% - 14rpx); min-height: 142rpx; margin: 0 7rpx 14rpx; padding: 24rpx; display: flex; flex-direction: column; justify-content: space-between; }
.highlight-item:first-child { width: calc(100% - 14rpx); min-height: 126rpx; flex-direction: row; align-items: center; justify-content: flex-start; }
.highlight-item__index { color: #C2A26B; font-family: Georgia, serif; font-size: 28rpx; font-weight: 700; }
.highlight-item__text { margin-top: 18rpx; color: #354156; font-size: 23rpx; line-height: 1.45; font-weight: 600; }
.highlight-item:first-child .highlight-item__text { margin: 0 0 0 22rpx; }
.description-card { padding: 30rpx; color: #4B576A; font-size: 23rpx; line-height: 1.9; }
.description-card__organizer { margin-top: 26rpx; padding-top: 22rpx; display: flex; justify-content: space-between; border-top: 1rpx solid #EDF0F4; font-size: 20rpx; }
.description-card__organizer text:first-child { color: #9AA2AF; }
.description-card__organizer text:last-child { color: #38445A; font-weight: 600; }
.registration-note { margin-top: 22rpx; padding: 24rpx; border-radius: 24rpx; color: #7C8798; background: #E9EDF4; font-size: 20rpx; line-height: 1.65; }
.registration-note__title { display: block; margin-bottom: 6rpx; color: #526077; font-weight: 700; }
.action-row { display: flex; }
.share-button { width: 118rpx; height: 88rpx; margin: 0 16rpx 0 0; padding: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1rpx solid #DDE3EC; border-radius: 22rpx; color: #657188; background: #FFFFFF; font-size: 18rpx; line-height: 1; }
.share-button text:first-child { margin-bottom: 7rpx; color: #033481; font-size: 28rpx; }
.registration-button { flex: 1; margin: 0; padding: 0; }
.registration-button--cancel { color: #8F4845; background: #F5E7E5; box-shadow: none; }
.registration-button--disabled { color: #7D8898; background: #E5E9EF; box-shadow: none; opacity: 1; }
</style>
