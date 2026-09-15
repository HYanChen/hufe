<template>
  <view class="page-shell chapters-page chapter-discovery">
    <view class="chapter-discovery__banner">
      <view class="chapter-discovery__heading">
        <text class="chapter-discovery__eyebrow">HUFE ALUMNI · 校友网络</text>
        <text class="chapter-discovery__title">找到你的校友组织</text>
        <text class="chapter-discovery__intro">重逢同窗，连接同专业与同兴趣的湖财人。</text>
      </view>
      <view class="chapter-discovery__stats" aria-label="组织概况">
        <view><text>{{ loading && !chapters.length ? '—' : chapters.length }}</text><text>公开组织</text></view>
        <view><text>{{ loading && !chapters.length ? '—' : joinedCount }}</text><text>我已加入</text></view>
      </view>
    </view>

    <view class="chapter-discovery__workspace">
      <view class="chapter-discovery__navigation">
        <text class="chapter-discovery__nav-title">组织分类</text>
        <view class="chapter-discovery__categories" role="group" aria-label="校友组织分类">
          <button
            v-for="filter in filters" :key="filter"
            class="chapter-discovery__category"
            :class="{ 'chapter-discovery__category--active': activeFilter === filter }"
            role="button" tabindex="0" :aria-label="filter" :aria-pressed="activeFilter === filter"
            @tap="activeFilter = filter" @keydown.enter.prevent="activeFilter = filter" @keydown.space.prevent="activeFilter = filter"
          ><text>{{ filter }}</text><text class="chapter-discovery__category-count">{{ categoryCount(filter) }}</text></button>
        </view>
        <view class="chapter-discovery__guide">
          <text>找到组织之后</text>
          <text>进入主页查看介绍、活动与通知。登录并完成实名后，可申请加入。</text>
        </view>
      </view>

      <view class="chapter-discovery__main">
        <view class="chapter-discovery__search">
          <text class="chapter-discovery__search-icon" aria-hidden="true"></text>
          <input v-model="keyword" class="chapter-discovery__input" aria-label="搜索校友组织" placeholder="搜索组织、年级、班级、专业或兴趣" confirm-type="search" />
          <button v-if="keyword" class="chapter-discovery__clear" role="button" tabindex="0" aria-label="清空搜索" @tap="keyword = ''" @keydown.enter.prevent="keyword = ''" @keydown.space.prevent="keyword = ''">×</button>
        </view>
        <view class="chapter-discovery__results-head">
          <view><text class="chapter-discovery__results-title">{{ activeFilter }}</text><text class="chapter-discovery__results-count">{{ loading ? '正在同步…' : '共 ' + filteredChapters.length + ' 个组织' }}</text></view>
          <button v-if="activeFilter !== '全部组织' || keyword" class="chapter-discovery__reset" role="button" tabindex="0" @tap="resetFilter" @keydown.enter.prevent="resetFilter" @keydown.space.prevent="resetFilter">重置筛选</button>
        </view>

        <view v-if="loading && !chapters.length" class="chapter-discovery__state" role="status">
          <text class="chapter-discovery__state-mark">…</text>
          <text class="chapter-discovery__state-title">正在加载校友组织</text>
          <text class="chapter-discovery__state-desc">组织主页与加入状态正在同步。</text>
        </view>
        <view v-else-if="error && !chapters.length" class="chapter-discovery__state" role="alert">
          <text class="chapter-discovery__state-mark">!</text>
          <text class="chapter-discovery__state-title">组织暂时无法加载</text>
          <text class="chapter-discovery__state-desc">{{ error }}</text>
          <button class="chapter-discovery__state-action" role="button" tabindex="0" @tap="loadChapters" @keydown.enter.prevent="loadChapters" @keydown.space.prevent="loadChapters">重新加载</button>
        </view>
        <view v-else-if="showJoinedGuestState" class="chapter-discovery__state">
          <text class="chapter-discovery__state-mark">入</text>
          <text class="chapter-discovery__state-title">登录后查看你的组织</text>
          <text class="chapter-discovery__state-desc">完成平台登录与实名认证后，可查看已加入的组织。</text>
          <button class="chapter-discovery__state-action" role="button" tabindex="0" @tap="openVerification" @keydown.enter.prevent="openVerification" @keydown.space.prevent="openVerification">去登录 / 实名认证</button>
        </view>
        <view v-else-if="filteredChapters.length" class="chapter-discovery__cards">
          <button
            v-for="(chapter, index) in filteredChapters" :key="chapter.id"
            class="chapter-discovery__card" role="button" tabindex="0"
            :aria-label="'进入' + chapter.name + '组织主页'" @tap="openChapter(chapter)" @keydown.enter.prevent="openChapter(chapter)" @keydown.space.prevent="openChapter(chapter)"
          >
            <view class="chapter-discovery__card-top">
              <view class="chapter-discovery__avatar" :class="'chapter-discovery__avatar--' + index % 4">{{ chapter.initials }}</view>
              <view class="chapter-discovery__card-labels">
                <text class="chapter-discovery__type">{{ chapter.type }}</text>
                <text class="chapter-discovery__city">{{ chapter.city }}</text>
              </view>
            </view>
            <text class="chapter-discovery__name">{{ chapter.name }}</text>
            <text v-if="chapter.profileSummary" class="chapter-discovery__profile">{{ chapter.profileSummary }}</text>
            <text class="chapter-discovery__description">{{ chapter.description }}</text>
            <view class="chapter-discovery__card-footer">
              <view class="chapter-discovery__member-status">
                <text>{{ chapter.members }} 位成员</text>
                <text v-if="chapter.joined || chapter.membership" class="chapter-discovery__membership" :class="{ 'chapter-discovery__membership--joined': chapter.joined }">{{ chapter.joined ? '已加入' : membershipLabel(chapter) }}</text>
              </view>
              <text class="chapter-discovery__entry">进入主页 <text aria-hidden="true">↗</text></text>
            </view>
          </button>
        </view>
        <view v-else class="chapter-discovery__state">
          <text class="chapter-discovery__state-mark">组</text>
          <text class="chapter-discovery__state-title">{{ emptyTitle }}</text>
          <text class="chapter-discovery__state-desc">{{ keyword ? '换一个年级、班级、专业或兴趣关键词试试。' : '组织发布后会显示在对应分类中，你也可以先看看其他组织。' }}</text>
          <button class="chapter-discovery__state-action" role="button" tabindex="0" @tap="resetFilter" @keydown.enter.prevent="resetFilter" @keydown.space.prevent="resetFilter">查看全部组织</button>
        </view>
        <view class="chapter-discovery__note"><text>加入须知</text><text>组织由管理人员创建和维护，加入申请以组织审核结果为准。</text></view>
      </view>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import { getMyOrganizationMemberships, getOrganizations } from '../../services/business'
import { isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { normalizeOrganizationType, organizationTypes, organizationProfileSummary } from '../../server/src/business/organization-categories.js'

export default {
  data() {
    return {
      chapters: [],
      keyword: '',
      loading: false,
      error: '',
      verified: false,
      activeFilter: '全部组织',
      filters: ['全部组织', '我已加入', ...organizationTypes]
    }
  },
  computed: {
    filteredChapters() {
      const keyword = this.keyword.trim().toLowerCase()
      return this.chapters.filter((chapter) => {
        const matchesFilter = this.activeFilter === '全部组织'
          || (this.activeFilter === '我已加入' && chapter.joined)
          || chapter.type === this.activeFilter
        const searchable = [chapter.name, chapter.type, chapter.city, chapter.profileSummary, chapter.summary].join(' ').toLowerCase()
        return matchesFilter && (!keyword || searchable.includes(keyword))
      })
    },
    joinedCount() {
      return this.chapters.filter((chapter) => chapter.joined).length
    },
    showJoinedGuestState() {
      return this.activeFilter === '我已加入' && !this.verified
    },
    emptyTitle() {
      if (this.keyword) return '没有找到相关组织'
      if (this.activeFilter === '我已加入') return '你还没有加入组织'
      return this.activeFilter === '全部组织' ? '暂时没有公开组织' : `暂无${this.activeFilter}${this.activeFilter.endsWith('组织') ? '' : '组织'}`
    }
  },
  onShow() {
    this.verified = isVerified()
    this.loadChapters()
  },
  onPullDownRefresh() {
    this.loadChapters().finally(() => uni.stopPullDownRefresh())
  },
  onShareAppMessage() {
    return { title: '湖财校友组织', path: '/pages/chapters/index' }
  },
  methods: {
    categoryCount(filter) {
      if (this.loading && !this.chapters.length) return '—'
      if (filter === '全部组织') return this.chapters.length
      if (filter === '我已加入') return this.joinedCount
      return this.chapters.filter((chapter) => chapter.type === filter).length
    },
    async loadChapters() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const verified = isVerified()
        this.verified = verified
        const [publicResult, mine] = await Promise.all([
          getOrganizations({ page: 1, pageSize: 100 }),
          verified
            ? getMyOrganizationMemberships().catch(() => ({ items: [] }))
            : Promise.resolve({ items: [] })
        ])
        // Include later pages before category/search filtering.
        const publicItems = [...publicResult.items]
        let page = 1
        while (publicItems.length < publicResult.total) {
          const next = await getOrganizations({ page: ++page, pageSize: 100 })
          if (!next.items.length) break
          publicItems.push(...next.items)
        }
        const membershipStatuses = new Set([
          'submitted', 'pending', 'pending_review', 'reviewing', 'processing',
          'under_review', 'needs_more', 'approved', 'active', 'joined'
        ])
        const memberships = new Map(
          mine.items
            .filter((item) => membershipStatuses.has(String(item.status || '').toLowerCase()))
            .map((item) => [item.organizationId || item.resourceId, item])
        )
        this.chapters = [...new Map(publicItems.map((item) => [item.id, item])).values()].map((chapter) => {
          const membership = memberships.get(chapter.id) || null
          return {
            ...chapter,
            type: normalizeOrganizationType(chapter.type) || '校友组织',
            profileSummary: organizationProfileSummary(chapter),
            description: markdownToPlainText(chapter.summary || '') || '进入主页，了解组织介绍、活动与加入方式。',
            city: chapter.city || '所在地待完善',
            initials: chapter.initials || String(chapter.name || '湖财').slice(0, 2),
            members: Number(chapter.memberCount || 0),
            activity: chapter.recentActivity || chapter.recentActivityTitle || '查看组织动态',
            membership,
            joined: verified && (chapter.joined === true || ['approved', 'active', 'joined'].includes(String(membership?.status || '').toLowerCase()))
          }
        })
      } catch (error) {
        this.chapters = []
        this.error = error.message || '组织加载失败'
      }
      finally { this.loading = false }
    },
    resetFilter() {
      this.keyword = ''
      this.activeFilter = '全部组织'
    },
    openChapter(chapter) {
      if (!chapter?.id) return
      openPage(`/pages/chapter-detail/index?id=${encodeURIComponent(chapter.id)}`)
    },
    openVerification() {
      openPage('/pages/verify/index')
    },
    membershipLabel(chapter) {
      if (!chapter.membership) return '申请加入'
      return chapter.joined ? '已加入' : '申请审核中'
    }
  }
}
</script>

<style scoped>
/* Use stable logical sizes across uni-app's 960px rpx breakpoint. */
.page-shell.chapter-discovery { width: 100%; max-width: 1680px; min-height: calc(100vh - 44px); margin: 0 auto; padding: 20px 16px max(24px, env(safe-area-inset-bottom)); color: #172d4e; font-size: 16px; line-height: 1.6; }
.chapter-discovery__banner { display: flex; flex-direction: column; gap: 16px; padding: 20px; border-radius: 20px; background: linear-gradient(115deg, #092d61, #0c4687); color: #fff; }
.chapter-discovery__heading { min-width: 0; }
.chapter-discovery__eyebrow, .chapter-discovery__title, .chapter-discovery__intro { display: block; }
.chapter-discovery__eyebrow { color: #ecd3a3; font-size: 12px; font-weight: 650; letter-spacing: 1.5px; }
.chapter-discovery__title { margin-top: 10px; font-size: 26px; font-weight: 700; line-height: 1.35; letter-spacing: .5px; overflow-wrap: anywhere; }
.chapter-discovery__intro { display: none; margin-top: 10px; max-width: 640px; color: #d2e1f3; font-size: 15px; line-height: 1.7; }
.chapter-discovery__stats { display: flex; gap: 32px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.2); }
.chapter-discovery__stats > view { min-width: 72px; display: flex; align-items: baseline; gap: 10px; }
.chapter-discovery__stats text:first-child { color: #fff; font-size: 27px; line-height: 1.2; font-weight: 700; font-variant-numeric: tabular-nums; }
.chapter-discovery__stats text:last-child { color: #c7d9ef; font-size: 13px; }
.chapter-discovery__workspace { display: flex; flex-direction: column; gap: 22px; margin-top: 24px; }
.chapter-discovery__navigation, .chapter-discovery__main { min-width: 0; }
.chapter-discovery__nav-title { display: block; margin-bottom: 12px; color: #5b6c82; font-size: 14px; font-weight: 600; }
.chapter-discovery__categories { display: flex; flex-wrap: wrap; gap: 8px; }
.chapter-discovery__category { display: flex; align-items: center; justify-content: center; gap: 8px; width: auto; max-width: 100%; min-height: 44px; margin: 0; padding: 10px; border: 1px solid #dce4ef; border-radius: 10px; background: #fff; color: #4a5d76; font-size: 14px; line-height: 1.5; text-align: left; white-space: normal; overflow-wrap: anywhere; cursor: pointer; }
.chapter-discovery__category-count { display: none; color: #738297; font-size: 13px; font-variant-numeric: tabular-nums; }
.chapter-discovery__category--active { border-color: #0b3d7d; background: #0b3d7d; color: #fff; font-weight: 600; }
.chapter-discovery__category--active .chapter-discovery__category-count { color: #d0e3fc; }
.chapter-discovery__guide { display: none; }
.chapter-discovery__search { display: flex; align-items: center; gap: 14px; min-height: 56px; padding: 6px 16px; border: 1px solid #dce4ef; border-radius: 12px; background: #fff; }
.chapter-discovery__search:focus-within { border-color: #0b4a96; box-shadow: 0 0 0 3px rgba(11,74,150,.1); }
.chapter-discovery__search-icon { position: relative; flex: 0 0 15px; height: 15px; margin-right: 3px; border: 2px solid #718198; border-radius: 50%; }
.chapter-discovery__search-icon::after { content: ''; position: absolute; width: 7px; height: 2px; right: -5px; bottom: -3px; transform: rotate(45deg); border-radius: 1px; background: #718198; }
.chapter-discovery__input { flex: 1; min-width: 0; height: 42px; color: #243b59; font-size: 16px; }
.chapter-discovery__clear { display: flex; align-items: center; justify-content: center; flex: 0 0 36px; width: 36px; height: 36px; margin: 0; padding: 0; border-radius: 8px; background: #f0f4f8; color: #526783; font-size: 24px; line-height: 1; }
.chapter-discovery__results-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin: 24px 0 18px; }
.chapter-discovery__results-head > view { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; min-width: 0; }
.chapter-discovery__results-title { color: #17304e; font-size: 21px; font-weight: 700; }
.chapter-discovery__results-count { color: #6b7b90; font-size: 14px; }
.chapter-discovery__reset { display: inline-flex; align-items: center; min-height: 40px; margin: 0; padding: 6px 0; background: transparent; color: #0b4a96; font-size: 14px; line-height: 1.5; }
.chapter-discovery__cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: stretch; }
.chapter-discovery__card { display: flex; flex-direction: column; min-width: 0; width: 100%; height: auto; margin: 0; padding: 22px; border: 1px solid #dfe6ef; border-radius: 16px; color: #243b59; background: #fff; box-shadow: 0 4px 16px rgba(26,49,81,.025); font-size: 16px; line-height: 1.6; text-align: left; white-space: normal; cursor: pointer; transition: border-color .18s, box-shadow .18s; }
.chapter-discovery__card-top { display: flex; align-items: center; gap: 16px; min-width: 0; }
.chapter-discovery__avatar { display: flex; align-items: center; justify-content: center; flex: 0 0 52px; width: 52px; height: 52px; border-radius: 14px; color: #1b518b; background: #eaf1fa; font-size: 18px; font-weight: 700; }
.chapter-discovery__avatar--1 { color: #876329; background: #f6eddd; }
.chapter-discovery__avatar--2 { color: #246b5b; background: #e6f2ed; }
.chapter-discovery__avatar--3 { color: #74539d; background: #f0eaf7; }
.chapter-discovery__card-labels { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; flex: 1; min-width: 0; }
.chapter-discovery__type { max-width: 100%; padding: 4px 8px; border-radius: 6px; color: #58708d; background: #f0f4f9; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.chapter-discovery__city { color: #758398; font-size: 13px; overflow-wrap: anywhere; }
.chapter-discovery__name { display: block; margin-top: 18px; color: #172f50; font-size: 19px; font-weight: 700; line-height: 1.5; overflow-wrap: anywhere; }
.chapter-discovery__profile { display: block; margin-top: 8px; color: #355e87; font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
.chapter-discovery__description { display: -webkit-box; margin: 10px 0 22px; overflow: hidden; color: #697b91; font-size: 14px; line-height: 1.8; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
.chapter-discovery__card-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: auto; padding-top: 16px; border-top: 1px solid #edf1f5; }
.chapter-discovery__member-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: #6a7c91; font-size: 13px; }
.chapter-discovery__membership { padding: 2px 6px; border-radius: 4px; color: #886428; background: #faf0db; font-size: 12px; }
.chapter-discovery__membership--joined { color: #236c55; background: #e7f3ec; }
.chapter-discovery__entry { color: #0a438a; font-size: 14px; font-weight: 600; white-space: nowrap; }
.chapter-discovery__entry > text { margin-left: 6px; font-size: 19px; }
.chapter-discovery__state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; padding: 44px 24px; border: 1px dashed #ccd8e8; border-radius: 16px; background: #fff; text-align: center; }
.chapter-discovery__state-mark { display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; margin-bottom: 16px; border-radius: 16px; color: #537398; background: #eef3f9; font-size: 24px; font-weight: 600; }
.chapter-discovery__state-title { display: block; color: #304865; font-size: 20px; font-weight: 650; line-height: 1.5; }
.chapter-discovery__state-desc { display: block; max-width: 460px; margin-top: 10px; color: #718198; font-size: 15px; line-height: 1.8; overflow-wrap: anywhere; }
.chapter-discovery__state-action { width: auto; max-width: 100%; min-height: 44px; margin: 24px 0 0; padding: 10px 22px; border: 1px solid #cbdbee; border-radius: 9px; background: #eef4fc; color: #144782; font-size: 15px; line-height: 1.6; white-space: normal; }
.chapter-discovery__note { display: flex; flex-wrap: wrap; gap: 8px 12px; margin-top: 24px; color: #7b8798; font-size: 13px; line-height: 1.8; }
.chapter-discovery__note > text:first-child { color: #4e6683; font-weight: 600; }
.chapter-discovery button::after { border: 0; }
.chapter-discovery button:focus-visible { outline: 3px solid #bb924d; outline-offset: 3px; }
.chapter-discovery :deep(.support-footer) { padding-top: 36px; }
.chapter-discovery :deep(.support-footer__copyright), .chapter-discovery :deep(.support-footer__text) { font-size: 12px; }
@media screen and (min-width: 600px) {
  .page-shell.chapter-discovery { padding: 28px 24px 32px; }
  .chapter-discovery__banner { flex-direction: row; align-items: center; justify-content: space-between; gap: 30px; padding: 32px; }
  .chapter-discovery__intro { display: block; }
  .chapter-discovery__stats { flex: 0 0 auto; padding: 0 0 0 28px; border-top: 0; border-left: 1px solid rgba(255,255,255,.2); gap: 24px; }
  .chapter-discovery__stats > view { flex-direction: column; gap: 8px; }
  .chapter-discovery__title { font-size: 32px; }
  .chapter-discovery__cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media screen and (min-width: 1024px) {
  .page-shell.chapter-discovery { padding: 36px 32px 40px; }
  .chapter-discovery__banner { padding: 36px 40px; border-radius: 20px; }
  .chapter-discovery__title { font-size: 36px; }
  .chapter-discovery__intro { font-size: 16px; }
  .chapter-discovery__stats { gap: 36px; padding-left: 40px; }
  .chapter-discovery__stats text:first-child { font-size: 34px; }
  .chapter-discovery__stats text:last-child { font-size: 14px; }
  .chapter-discovery__workspace { flex-direction: row; align-items: flex-start; gap: 32px; margin-top: 32px; }
  .chapter-discovery__navigation { position: sticky; top: 68px; flex: 0 0 208px; }
  .chapter-discovery__nav-title { margin-bottom: 16px; padding: 0 14px; font-size: 15px; }
  .chapter-discovery__categories { flex-direction: column; gap: 6px; }
  .chapter-discovery__category { width: 100%; justify-content: space-between; padding: 12px 16px; border-color: transparent; background: transparent; font-size: 15px; }
  .chapter-discovery__category-count { display: block; }
  .chapter-discovery__category--active { border-color: #d9e5f5; background: #e5eefb; color: #0b3d7d; }
  .chapter-discovery__category--active .chapter-discovery__category-count { color: #0b3d7d; }
  .chapter-discovery__guide { display: block; margin: 28px 14px 0; padding-top: 22px; border-top: 1px solid #dce3ed; color: #7a899c; font-size: 13px; line-height: 1.8; }
  .chapter-discovery__guide > text { display: block; }
  .chapter-discovery__guide > text:first-child { margin-bottom: 8px; color: #526980; font-weight: 600; }
  .chapter-discovery__main { flex: 1; }
  .chapter-discovery__results-head { margin-top: 28px; }
  .chapter-discovery__cards { gap: 20px; }
  .chapter-discovery__state { min-height: 350px; }
}
@media screen and (min-width: 1440px) {
  .page-shell.chapter-discovery { padding-left: 40px; padding-right: 40px; }
  .chapter-discovery__navigation { flex-basis: 224px; }
  .chapter-discovery__cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .chapter-discovery__card { padding: 24px; }
}
@media (hover: hover) {
  .chapter-discovery__category:not(.chapter-discovery__category--active):hover { background: #edf2f8; border-color: #dce4ef; }
  .chapter-discovery__card:hover { border-color: #aac1df; box-shadow: 0 8px 24px rgba(22,58,105,.07); }
}
@media (prefers-reduced-motion: reduce) { .chapter-discovery__card { transition: none; } }
</style>
