<template>
  <view class="page-shell events-page">
    <view class="events-hero">
      <view class="events-hero__ring events-hero__ring--large"></view>
      <view class="events-hero__ring events-hero__ring--small"></view>
      <text class="events-hero__eyebrow">HUFE ALUMNI EVENTS</text>
      <text class="events-hero__title">与湖财人，再见一面</text>
      <text class="events-hero__desc">从职业成长到返校相聚，让每一次连接都有回响。</text>
      <view class="events-hero__stats">
        <view class="hero-stat">
          <text class="hero-stat__value">{{ events.length }}</text>
          <text class="hero-stat__label">近期活动</text>
        </view>
        <view class="hero-stat">
          <text class="hero-stat__value">{{ registeredCount }}</text>
          <text class="hero-stat__label">我的报名</text>
        </view>
        <view class="hero-stat hero-stat--wide">
          <text class="hero-stat__value">{{ totalJoined }}</text>
          <text class="hero-stat__label">校友参与</text>
        </view>
      </view>
    </view>

    <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false">
      <view class="filter-row">
        <view
          v-for="filter in filters"
          :key="filter"
          class="filter-chip"
          :class="{ 'filter-chip--active': activeFilter === filter }"
          @tap="chooseFilter(filter)"
        >
          {{ filter }}
          <text v-if="filter === '我已报名' && registeredCount" class="filter-chip__count">{{ registeredCount }}</text>
        </view>
      </view>
    </scroll-view>

    <view class="result-head">
      <view>
        <text class="result-head__title">{{ activeFilter }}</text>
        <text class="result-head__desc">共 {{ filteredEvents.length }} 场活动</text>
      </view>
      <text class="result-head__hint">按活动时间排序</text>
    </view>

    <view v-if="loading && !events.length" class="empty-state surface"><view class="empty-state__icon">…</view><text class="empty-state__title">正在加载活动</text></view>
    <view v-else-if="error && !events.length" class="empty-state surface"><view class="empty-state__icon">!</view><text class="empty-state__title">活动暂时无法加载</text><text class="empty-state__desc">{{ error }}</text><button class="secondary-button empty-state__button" @tap="loadEvents">重新加载</button></view>
    <view v-else-if="filteredEvents.length" class="event-list">
      <EventCard
        v-for="event in filteredEvents"
        :key="event.id"
        :event="event"
        @select="openEvent"
      />
    </view>
    <view v-else class="empty-state surface">
      <view class="empty-state__icon">会</view>
      <text class="empty-state__title">暂无符合条件的活动</text>
      <text class="empty-state__desc">切换分类，发现更多湖财校友活动。</text>
      <button class="secondary-button empty-state__button" @tap="chooseFilter('全部')">查看全部活动</button>
    </view>

    <view class="events-note">
      <view class="events-note__icon">i</view>
      <text>活动信息与报名状态由湖财人后台实时提供，已下架活动不会继续展示。</text>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import EventCard from '../../components/EventCard.vue'
import { getActivities, getMyActivityRegistrations } from '../../services/business'
import { isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { EventCard },
  data() {
    return {
      events: [],
      activeFilter: '全部',
      filters: ['全部', '我已报名', '职业成长', '返校活动', '产业连接'],
      loading: false,
      error: ''
    }
  },
  computed: {
    filteredEvents() {
      if (this.activeFilter === '全部') return this.events
      if (this.activeFilter === '我已报名') return this.events.filter((event) => event.registered)
      return this.events.filter((event) => event.tag === this.activeFilter)
    },
    registeredCount() {
      return this.events.filter((event) => event.registered).length
    },
    totalJoined() {
      return this.events.reduce((total, event) => total + event.joined, 0)
    }
  },
  onShow() { this.loadEvents() },
  onPullDownRefresh() { this.loadEvents().finally(() => uni.stopPullDownRefresh()) },
  onShareAppMessage() {
    return { title: '湖财校友近期活动', path: '/pages/events/index' }
  },
  methods: {
    chooseFilter(filter) {
      this.activeFilter = filter
    },
    formatEvent(event, registration) {
      const start = new Date(event.startAt || '')
      const valid = !Number.isNaN(start.getTime())
      const pad = (value) => String(value).padStart(2, '0')
      return {
        ...event,
        tag: event.category || '湖财活动',
        theme: event.theme || ['career', 'homecoming', 'finance'][Math.abs(String(event.id).length) % 3],
        month: valid ? pad(start.getMonth() + 1) : '--', day: valid ? pad(start.getDate()) : '--',
        time: valid ? `${start.getFullYear()}.${pad(start.getMonth() + 1)}.${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}` : (event.time || '时间待定'),
        deadline: event.registrationDeadline || '', city: event.city || '长沙',
        joined: Number(event.registrationCount || 0), registered: Boolean(registration),
        registrationId: registration?.id || '', registrationRevision: registration?.revision
      }
    },
    async loadEvents() {
      if (this.loading) return
      this.loading = true; this.error = ''
      try {
        const [publicResult, myResult] = await Promise.all([
          getActivities({ page: 1, pageSize: 100 }),
          isVerified() ? getMyActivityRegistrations() : Promise.resolve({ items: [] })
        ])
        const activeRegistrations = new Map(myResult.items.filter((item) => !['cancelled', 'rejected'].includes(item.status)).map((item) => [item.activityId, item]))
        this.events = publicResult.items.map((item) => this.formatEvent(item, activeRegistrations.get(item.id)))
      } catch (error) { this.events = []; this.error = error.message || '网络暂时不可用' }
      finally { this.loading = false }
    },
    openEvent(id) {
      openPage(`/pages/event-detail/index?id=${id}`)
    }
  }
}
</script>

<style scoped>
.events-page { padding-top: 12rpx; }
.events-hero { position: relative; min-height: 330rpx; padding: 38rpx 34rpx 30rpx; overflow: hidden; border-radius: 38rpx; color: #FFFFFF; background: linear-gradient(140deg, #082C68 0%, #033481 58%, #1B5AA3 100%); box-shadow: 0 24rpx 54rpx rgba(9, 47, 105, .21); }
.events-hero__ring { position: absolute; border: 1rpx solid rgba(255, 255, 255, .14); border-radius: 50%; }
.events-hero__ring--large { width: 280rpx; height: 280rpx; right: -90rpx; top: -120rpx; }
.events-hero__ring--small { width: 130rpx; height: 130rpx; right: -4rpx; top: -46rpx; background: rgba(224, 194, 135, .08); }
.events-hero__eyebrow, .events-hero__title, .events-hero__desc, .hero-stat__value, .hero-stat__label, .result-head__title, .result-head__desc, .empty-state__title, .empty-state__desc { display: block; }
.events-hero__eyebrow { color: #E1C58E; font-size: 18rpx; font-weight: 700; letter-spacing: 4rpx; }
.events-hero__title { margin-top: 16rpx; font-size: 42rpx; line-height: 1.25; font-weight: 700; }
.events-hero__desc { width: 510rpx; margin-top: 12rpx; color: rgba(255, 255, 255, .64); font-size: 21rpx; line-height: 1.55; }
.events-hero__stats { position: absolute; left: 34rpx; right: 34rpx; bottom: 28rpx; display: flex; align-items: center; }
.hero-stat { min-width: 128rpx; padding-right: 28rpx; margin-right: 28rpx; border-right: 1rpx solid rgba(255, 255, 255, .16); }
.hero-stat--wide { min-width: 150rpx; margin-right: 0; padding-right: 0; border-right: none; }
.hero-stat__value { color: #E7CD9A; font-family: Georgia, serif; font-size: 34rpx; line-height: 1; font-weight: 700; }
.hero-stat__label { margin-top: 7rpx; color: rgba(255, 255, 255, .52); font-size: 18rpx; }
.filter-scroll { width: calc(100% + 56rpx); margin: 30rpx -28rpx 0; white-space: nowrap; }
.filter-row { padding: 0 28rpx 10rpx; display: inline-flex; }
.filter-chip { height: 64rpx; margin-right: 14rpx; padding: 0 24rpx; display: flex; align-items: center; justify-content: center; border: 1rpx solid rgba(11, 58, 130, .06); border-radius: 22rpx; color: #68758A; background: #FFFFFF; box-shadow: 0 8rpx 20rpx rgba(26, 49, 82, .04); font-size: 22rpx; }
.filter-chip--active { color: #FFFFFF; background: #033481; box-shadow: 0 10rpx 24rpx rgba(11, 58, 130, .2); }
.filter-chip__count { min-width: 32rpx; height: 32rpx; margin-left: 9rpx; padding: 0 7rpx; display: flex; align-items: center; justify-content: center; border-radius: 99rpx; color: #765824; background: #E4C98F; font-size: 17rpx; font-weight: 700; }
.result-head { margin: 24rpx 4rpx 20rpx; display: flex; align-items: flex-end; justify-content: space-between; }
.result-head__title { font-size: 32rpx; font-weight: 700; }
.result-head__desc { margin-top: 6rpx; color: #8C95A4; font-size: 20rpx; }
.result-head__hint { color: #A0A7B2; font-size: 19rpx; }
.event-list { display: flex; flex-direction: column; }
.event-list :deep(.event-card) { margin-bottom: 18rpx; }
.empty-state__title { color: #344056; font-size: 27rpx; font-weight: 650; }
.empty-state__desc { margin-top: 10rpx; font-size: 21rpx; }
.empty-state__button { width: 250rpx; height: 72rpx; margin: 26rpx auto 0; line-height: 72rpx; font-size: 23rpx; }
.events-note { margin: 30rpx 6rpx 0; padding: 22rpx 24rpx; display: flex; align-items: flex-start; border-radius: 22rpx; color: #7C8798; background: #E9EDF4; font-size: 19rpx; line-height: 1.55; }
.events-note__icon { width: 32rpx; height: 32rpx; margin-right: 12rpx; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 2rpx solid #A5834B; border-radius: 50%; color: #92713E; font-size: 17rpx; font-weight: 700; }
</style>
