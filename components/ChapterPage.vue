<template>
  <view class="page-shell chapter-detail-page" :class="{ 'with-sticky-action': organization && !sectionView, 'chapter-section-page': sectionView }">
    <template v-if="organization">
      <view v-if="sectionView" class="chapter-section-heading"><text>{{ organization.name }}</text><text>{{ sectionTitle }} · {{ organizationType }}</text></view>
      <view v-if="!sectionView" class="chapter-hero">
        <view class="chapter-hero__identity">
          <view class="chapter-hero__mark">{{ initials }}</view>
          <view class="chapter-hero__copy">
            <text class="chapter-hero__eyebrow">HUFE ALUMNI CHAPTER</text>
            <text class="chapter-hero__title">{{ organization.name || '湖财校友组织' }}</text>
            <text class="chapter-hero__meta">{{ organizationType }} · {{ organization.city || '所在地待完善' }}</text>
          </view>
        </view>
        <view class="chapter-hero__stats">
          <view><text>{{ memberCount }}</text><text>组织成员</text></view>
          <view v-if="isModuleEnabled('activities')"><text>{{ activities.length }}</text><text>近期活动</text></view>
          <view v-if="isModuleEnabled('announcements')"><text>{{ announcements.length }}</text><text>组织通知</text></view>
        </view>
        <text class="chapter-hero__watermark">HUFE</text>
      </view>

      <view v-if="canManage && !sectionView" class="manager-entry surface" @tap="openManager">
        <view class="manager-entry__icon">管</view>
        <view><text>你是本组织管理人员</text><text>进入工作台发布活动与组织通知</text></view>
        <text>管理组织 ›</text>
      </view>

      <view v-if="!sectionView" class="chapter-shortcuts surface" aria-label="组织主页快捷导航">
        <button v-for="entry in shortcuts" :key="entry.id" role="button" tabindex="0" :aria-label="entry.label" @tap="goSection(entry.id)" @keydown.enter.prevent="goSection(entry.id)">
          <view class="chapter-shortcuts__icon" :class="'chapter-shortcuts__icon--' + entry.id">{{ entry.icon }}</view>
          <text>{{ entry.label }}</text>
        </button>
      </view>

      <view v-if="!sectionView && membershipActive && membership?.automatic" class="chapter-auto-membership"><text>已按身份与个人资料关联本组织。</text><text>可通过底部“退出组织”离开，退出后不会自动加回。</text></view>

      <image v-if="!sectionView && coverUrl && !coverFailed" class="chapter-cover" :src="coverUrl" mode="aspectFill" aria-label="组织封面" @error="coverFailed = true" />

      <view v-if="!sectionView" class="chapter-content-grid">
        <view v-if="isModuleEnabled('activities')" id="chapter-activities" class="chapter-content-column">
          <view class="section-head"><view><text class="section-title">近期活动</text><text class="section-kicker">CHAPTER EVENTS</text></view><text class="section-more">{{ activities.length }} 场</text></view>
          <view v-if="activities.length" class="activity-list">
            <view v-for="activity in activities" :key="activity.id" class="activity-card surface" @tap="openActivity(activity)">
              <view class="activity-date"><text>{{ activityMonth(activity) }}</text><text>{{ activityDay(activity) }}</text></view>
              <view class="activity-copy">
                <view><text>{{ activity.category || '组织活动' }}</text><text>{{ activity.city || organization.city || '地点待定' }}</text></view>
                <text>{{ activity.title || '未命名活动' }}</text>
                <text>{{ formatDateTime(activity.startAt) }} · {{ activity.venue || '场地待定' }}</text>
              </view>
              <text class="card-arrow">›</text>
            </view>
          </view>
          <view v-else class="content-empty surface"><text>会</text><view><text>近期暂无公开活动</text><text>组织发布的新活动会显示在这里。</text></view></view>
        </view>

        <view v-if="isModuleEnabled('announcements')" id="chapter-notices" class="chapter-content-column">
          <view class="section-head"><view><text class="section-title">组织资讯</text><text class="section-kicker">CHAPTER NEWS</text></view><text class="section-more">{{ announcements.length }} 条</text></view>
          <view v-if="announcements.length" class="notice-list surface">
            <view v-for="notice in announcements" :key="notice.id" class="notice-card" @tap="openAnnouncement(notice)">
              <view class="notice-card__top"><text :class="`notice-priority notice-priority--${notice.priority || 'normal'}`">{{ priorityLabel(notice.priority) }}</text><text>{{ formatDate(notice.startAt || notice.createdAt) }}</text></view>
              <text class="notice-card__title">{{ notice.title || '组织通知' }}</text>
              <text class="notice-card__summary">{{ notice.summary || plainText(notice.content) || '点击查看通知内容' }}</text>
            </view>
          </view>
          <view v-else class="content-empty surface"><text>告</text><view><text>近期暂无组织通知</text><text>重要安排将由组织管理人员统一发布。</text></view></view>
        </view>
      </view>

      <view v-if="sectionView === 'members'" id="chapter-members" class="chapter-members surface">
        <view class="chapter-members__header">
          <view><text class="chapter-members__title">组织成员</text><text class="chapter-members__hint">相聚于此，认识组织里的湖财人</text></view>
          <text v-if="memberTotal !== null" class="chapter-members__count">{{ memberTotal }} 人</text>
        </view>
        <view v-if="!verified" class="chapter-members__state">
          <text class="chapter-members__state-title">实名登录后查看成员</text>
          <text>仅展示审核通过的成员姓名、学院和组织角色。</text>
          <button class="chapter-members__button" role="button" tabindex="0" @tap="openVerification" @keydown.enter.prevent="openVerification">去登录 / 实名认证</button>
        </view>
        <template v-else>
          <view class="chapter-members__search">
            <input v-model="memberKeyword" maxlength="120" placeholder="搜索成员姓名、学院" aria-label="搜索成员姓名、学院" confirm-type="search" @confirm="loadMembers(true)" />
            <button class="chapter-members__button" role="button" tabindex="0" @tap="loadMembers(true)" @keydown.enter.prevent="loadMembers(true)">搜索</button>
            <button v-if="memberKeyword || appliedMemberKeyword" class="chapter-members__reset" role="button" tabindex="0" @tap="resetMemberSearch" @keydown.enter.prevent="resetMemberSearch">重置</button>
          </view>
          <view v-if="members.length" class="chapter-members__grid">
            <view v-for="member in members" :key="member.id" class="chapter-members__card">
              <view class="chapter-members__avatar" :class="{ 'chapter-members__avatar--manager': member.role === 'manager' }">{{ String(member.name || '校').slice(0, 1) }}</view>
              <view class="chapter-members__identity">
                <view class="chapter-members__name-row"><text class="chapter-members__name">{{ member.name }}</text><text v-if="member.role === 'manager'" class="chapter-members__role">管理员</text></view>
                <text class="chapter-members__department">{{ member.department || '学院信息未完善' }}</text>
                <text class="chapter-members__type">{{ personTypeLabel(member.personType) }} · {{ member.role === 'manager' ? '组织管理人员' : '组织成员' }}</text>
              </view>
            </view>
          </view>
          <view v-else-if="!membersLoading && !membersError" class="chapter-members__state">
            <text class="chapter-members__state-title">{{ appliedMemberKeyword ? '没有找到相关成员' : '暂无已入驻成员' }}</text>
            <text>{{ appliedMemberKeyword ? '换一个姓名或学院关键词试试。' : '加入申请审核通过后，成员会显示在这里。' }}</text>
          </view>
          <view v-if="membersError" class="chapter-members__state" role="alert"><text>{{ membersError }}</text><button class="chapter-members__button" role="button" tabindex="0" @tap="loadMembers(memberPage === 0)" @keydown.enter.prevent="loadMembers(memberPage === 0)">重新加载</button></view>
          <view v-if="membersLoading" class="chapter-members__loading" role="status">正在加载成员…</view>
          <button v-else-if="members.length < memberTotal && !membersError" class="chapter-members__more" role="button" tabindex="0" @tap="loadMembers(false)" @keydown.enter.prevent="loadMembers(false)">查看更多成员（已显示 {{ members.length }} / {{ memberTotal }}）</button>
          <text class="chapter-members__privacy">仅显示平台内审核通过且账号有效的成员；历史登记人数不等于已入驻人数。不公开学号、身份证号或私人联系方式。</text>
        </template>
      </view>

      <view v-if="!sectionView || sectionView === 'album'" id="chapter-album" class="chapter-album surface">
        <OrganizationAlbums :organization-id="organizationId" :legacy-photos="albumPhotos" :active="active" />
      </view>

      <view v-if="!sectionView || sectionView === 'messages'" id="chapter-messages" class="chapter-messages surface">
        <view class="chapter-members__header"><view><text class="chapter-members__title">组织留言</text><text class="chapter-members__hint">向同窗问好，给组织捎句话</text></view><text v-if="messageTotal !== null" class="chapter-members__count">{{ messageTotal }} 条</text></view>
        <view v-if="!verified" class="chapter-members__state"><text>实名登录后可查看留言，与组织交流。</text><button class="chapter-members__button" role="button" tabindex="0" @tap="openVerification" @keydown.enter.prevent="openVerification">去登录 / 实名认证</button></view>
        <template v-else>
          <view class="chapter-messages__form">
            <textarea v-model="messageDraft" maxlength="500" aria-label="给组织留言" placeholder="分享近况、送上祝福，或向组织提个建议…" />
            <view><text>实名留言直接发布，无需审核；管理员可下架不当内容。请勿填写身份证、电话等隐私信息。</text><button class="chapter-members__button" role="button" tabindex="0" :disabled="messagePosting || messageDraft.trim().length < 2" :loading="messagePosting" @tap="postMessage" @keydown.enter.prevent="postMessage">发布留言</button></view>
          </view>
          <view v-for="message in messages" :key="message.id" class="chapter-messages__item">
            <view class="chapter-messages__avatar">{{ String(message.authorName || '校').slice(0, 1) }}</view>
            <view class="chapter-messages__body">
              <view class="chapter-messages__byline"><text>{{ message.authorName }}</text><text>{{ formatDate(message.createdAt) }}</text></view>
              <text v-if="message.mine && !['approved','published','completed'].includes(message.status)" class="chapter-messages__pending">{{ message.status === 'rejected' ? '未通过审核 · 仅自己可见' : '历史待审核留言 · 仅自己可见' }}</text>
              <text class="chapter-messages__content">{{ message.content }}</text>
              <view v-if="message.reply" class="chapter-messages__reply"><text>组织回复</text><text>{{ message.reply }}</text></view>
              <button v-if="message.mine && !['completed','rejected'].includes(message.status)" class="chapter-members__reset" role="button" tabindex="0" :disabled="Boolean(messageActing)" @tap="withdrawMessage(message)" @keydown.enter.prevent="withdrawMessage(message)">撤回留言</button>
            </view>
          </view>
          <view v-if="messagesError" class="chapter-members__state" role="alert"><text>{{ messagesError }}</text><button class="chapter-members__button" role="button" tabindex="0" @tap="loadMessages(messagePage === 0)" @keydown.enter.prevent="loadMessages(messagePage === 0)">重新加载</button></view>
          <view v-else-if="messagesLoading" class="chapter-members__loading" role="status">正在加载留言…</view>
          <view v-else-if="!messages.length" class="chapter-members__state"><text>还没有公开留言，来说声“你好”吧。</text></view>
          <button v-if="!messagesLoading && !messagesError && messages.length < messageTotal" class="chapter-members__more" role="button" tabindex="0" @tap="loadMessages(false)" @keydown.enter.prevent="loadMessages(false)">查看更多留言</button>
        </template>
      </view>

      <view v-if="['about', 'contact'].includes(sectionView)" class="chapter-overview">
        <view v-if="sectionView === 'about'" id="chapter-about" class="overview-card surface">
          <view class="section-head overview-head"><view><text class="section-title">组织简介</text><text class="section-kicker">ABOUT THE CHAPTER</text></view></view>
          <BusinessRichText :content="organization.summary" empty-text="组织简介正在完善中。" />
          <view v-if="profileDetails.length" class="contact-list">
            <view v-for="detail in profileDetails" :key="detail.key"><text>{{ detail.label }}</text><text>{{ detail.value }}</text></view>
          </view>
        </view>
        <view v-if="sectionView === 'contact'" id="chapter-contact" class="overview-card surface">
          <view class="section-head overview-head"><view><text class="section-title">联系组织</text><text class="section-kicker">OFFICIAL CONTACT</text></view></view>
          <view v-if="!verified" class="chapter-members__state"><text>实名登录后可查看组织的官方联系方式。</text><button class="chapter-members__button" role="button" tabindex="0" @tap="openVerification" @keydown.enter.prevent="openVerification">去登录 / 实名认证</button></view>
          <view v-else-if="contactError" class="chapter-members__state"><text>{{ contactError }}</text><button class="chapter-members__button" role="button" tabindex="0" @tap="loadHome" @keydown.enter.prevent="loadHome">重试</button></view>
          <view v-else class="contact-list">
            <view><text>联系人</text><text>{{ contactInfo?.contactName || (loading ? '加载中…' : '组织联系人待完善') }}</text></view>
            <view><text>联系方式</text><text>{{ contactInfo?.contactMethod || (loading ? '加载中…' : '组织暂未公布联系方式') }}</text></view>
            <view><text>所在地区</text><text>{{ organization.city || '所在地待完善' }}</text></view>
          </view>
          <button v-if="verified && contactInfo?.contactMethod" class="chapter-members__more" role="button" tabindex="0" @tap="copyOrganizationContact" @keydown.enter.prevent="copyOrganizationContact">复制组织联系方式</button>
        </view>
      </view>

      <view v-if="sectionView === 'about'" class="join-guide surface">
        <view class="join-guide__icon">入</view>
        <view><text>加入说明</text><BusinessRichText :content="organization.joinInstructions" empty-text="提交申请后，由组织管理人员在平台复核。" /></view>
      </view>

      <view class="chapter-policy">
        <text>信</text>
        <view><text>组织信息来自湖财人后台</text><text>组织资料、联系人、活动与通知只展示已发布内容；成员申请及管理权限均由服务端校验并留痕。</text></view>
      </view>
      <BusinessDetailSheet
        :open="Boolean(selectedNotice)"
        :title="selectedNotice ? selectedNotice.title : ''"
        :subtitle="selectedNotice ? noticeSubtitle(selectedNotice) : ''"
        eyebrow="CHAPTER NOTICE"
        :show-actions="Boolean(selectedNotice && selectedNotice.target)"
        @close="selectedNotice = null"
      >
        <template v-if="selectedNotice">
          <view class="notice-detail-meta">
            <text>{{ priorityLabel(selectedNotice.priority) }}</text>
            <text>{{ selectedNotice.category || '组织通知' }}</text>
          </view>
          <BusinessRichText :content="selectedNotice.content || selectedNotice.summary" empty-text="该通知暂无更多正文。" />
        </template>
        <template #actions>
          <button v-if="selectedNotice && selectedNotice.target" class="primary-button" @tap="openNoticeTarget">查看相关事项</button>
        </template>
      </BusinessDetailSheet>
      <view v-if="!sectionView" class="sticky-action chapter-actions">
        <!-- #ifdef H5 -->
        <button class="share-action" @tap="shareOrganization"><text>↗</text><text>分享主页</text></button>
        <!-- #endif -->
        <!-- #ifdef MP -->
        <button class="share-action" open-type="share"><text>↗</text><text>分享主页</text></button>
        <!-- #endif -->
        <!-- #ifdef APP-PLUS -->
        <button class="share-action" @tap="shareOrganizationApp"><text>↗</text><text>分享主页</text></button>
        <!-- #endif -->
        <button class="primary-button membership-action" :class="{ 'membership-action--danger': membershipActive }" :loading="acting" :disabled="acting" @tap="toggleMembership">{{ membershipActionLabel }}</button>
      </view>
    </template>

    <view v-else class="detail-state surface">
      <view class="detail-state__icon">{{ loading ? '…' : '!' }}</view>
      <text class="detail-state__title">{{ loading ? '正在进入组织主页' : '组织主页暂时无法打开' }}</text>
      <text class="detail-state__desc">{{ loading ? '正在同步组织资料、活动与通知。' : (error || '该组织不存在、未发布或已停止对外展示。') }}</text>
      <button v-if="!loading" class="secondary-button detail-state__button" @tap="loadHome">重新加载</button>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import BusinessDetailSheet from '../components/BusinessDetailSheet.vue'
import BusinessRichText from '../components/BusinessRichText.vue'
import OrganizationAlbums from './OrganizationAlbums.vue'
import {
  endOrganizationMembership,
  getMyManagedOrganizations,
  getMyOrganizationMemberships,
  getOrganizationHome,
  getOrganizationMembers,
  getOrganizationMessages,
  getOrganizationContact,
  createOrganizationMessage,
  cancelOrganizationMessage,
  joinOrganization
} from '../services/business'
import { markdownToPlainText, markdownImages } from '../services/businessMarkdown'
import { resolveMediaUrl } from '../services/media'
import { getAccessToken, getUser, isVerified } from '../utils/store'
import { openPage } from '../utils/nav'
import { normalizeOrganizationType, organizationProfileDetails } from '../server/src/business/organization-categories.js'

function listValue(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  return []
}

function homeValue(source = {}) {
  if (source?.data && (source.data.organization || source.data.activities || source.data.announcements)) return source.data
  return source || {}
}

function capabilityGranted(capabilities, keys) {
  if (Array.isArray(capabilities)) return keys.some((key) => capabilities.includes(key))
  if (typeof capabilities === 'string') return keys.some((key) => capabilities.split(/[,，\s]+/).includes(key))
  if (!capabilities || typeof capabilities !== 'object') return false
  return keys.some((key) => capabilities[key] === true || capabilities[key] === 'granted')
}

export default {
  components: { BusinessDetailSheet, BusinessRichText, OrganizationAlbums },
  props: { chapterId: { type: String, default: '' }, sectionView: { type: String, default: '' } },
  data() {
    return {
      organizationId: '', active: true,
      organization: null,
      activities: [],
      announcements: [],
      membership: null,
      capabilities: null,
      managed: false,
      selectedNotice: null,
      loading: false,
      acting: false,
      error: '',
      verified: false,
      members: [], memberTotal: null, memberPage: 0, memberKeyword: '', appliedMemberKeyword: '',
      membersLoading: false, membersError: '', membersVersion: 0, homeVersion: 0,
      messages: [], messageTotal: null, messagePage: 0, messagesLoading: false, messagesError: '', messagesVersion: 0,
      messageDraft: '', messagePosting: false, messageActing: '', albumLimit: 6, coverFailed: false,
      draftOwnerId: '',
      contactInfo: null, contactError: '',
      shortcuts: [
        { id: 'about', label: '简介', icon: '介' },
        { id: 'contact', label: '联系', icon: '联' },
        { id: 'members', label: '成员', icon: '友' },
        { id: 'album', label: '相册', icon: '影' },
        { id: 'messages', label: '留言', icon: '言' }
      ]
    }
  },
  computed: {
    sectionTitle() { return ({ about: '组织简介', contact: '联系组织', members: '组织成员', album: '组织相册', messages: '组织留言' })[this.sectionView] || '' },
    coverUrl() { return resolveMediaUrl(this.organization?.coverUrl) },
    albumPhotos() { return markdownImages(this.organization?.photoAlbumContent || '') },
    initials() {
      return String(this.organization?.initials || this.organization?.name || '湖财').slice(0, 2)
    },
    organizationType() {
      return normalizeOrganizationType(this.organization?.type) || '校友组织'
    },
    profileDetails() {
      return organizationProfileDetails(this.organization || {})
    },
    memberCount() {
      return Number(this.organization?.memberCount || this.organization?.members || 0)
    },
    membershipStatus() {
      return String(this.membership?.status || '').toLowerCase()
    },
    membershipActive() {
      return ['approved', 'active', 'joined'].includes(this.membershipStatus)
    },
    membershipPending() {
      return ['submitted', 'pending', 'pending_review', 'reviewing', 'processing', 'under_review', 'needs_more']
        .includes(this.membershipStatus)
    },
    membershipActionLabel() {
      if (!this.verified) return '登录后申请加入'
      if (this.membershipActive) return '退出组织'
      if (this.membershipPending) return '撤回加入申请'
      return '申请加入组织'
    },
    canManage() {
      return this.managed
        || capabilityGranted(this.capabilities, ['manage', 'manageOrganization', 'publish'])
        || (
          capabilityGranted(this.capabilities, ['update'])
          && capabilityGranted(this.capabilities, ['moderate'])
        )
    }
  },
  watch: {
    chapterId(value) {
      if (value === this.organizationId) return
      this.homeVersion += 1; this.loading = false; this.organizationId = value
      this.organization = null; this.messageDraft = ''; this.clearMembers(); this.clearMessages()
      this.loadHome()
    }
  },
  mounted() {
    this.organizationId = this.chapterId
    this.draftOwnerId = getUser().id || ''
    uni.$on('hufe-auth-changed', this.syncAuth)
    this.loadHome()
  },
  beforeUnmount() {
    uni.$off('hufe-auth-changed', this.syncAuth)
    this.clearMembers(); this.clearMessages(); this.homeVersion += 1
  },
  methods: {
    clearMembers() {
      this.membersVersion += 1
      this.members = []; this.memberTotal = null; this.memberPage = 0
      this.membersLoading = false; this.membersError = ''
    },
    syncAuth() {
      this.clearMembers()
      this.clearMessages()
      this.activities = []; this.announcements = []; this.selectedNotice = null
      const owner = getUser().id || ''
      if (!isVerified() || !owner || owner !== this.draftOwnerId) this.messageDraft = ''
      this.draftOwnerId = owner
      this.homeVersion += 1; this.loading = false; this.acting = false
      this.verified = Boolean(getAccessToken()) && isVerified()
      this.membership = null; this.capabilities = null; this.managed = false; this.selectedNotice = null
      this.memberKeyword = ''; this.appliedMemberKeyword = ''
      return this.loadHome()
    },
    openVerification() { openPage('/pages/verify/index') },
    expirePrivateAccess() {
      this.clearMembers(); this.clearMessages(); this.messageDraft = ''
      this.verified = false; this.membership = null; this.capabilities = null; this.managed = false
      this.selectedNotice = null; this.activities = []; this.announcements = []
      this.homeVersion += 1; this.loading = false
    },
    previewPhoto(photo) { uni.previewImage({ current: photo.url, urls: this.albumPhotos.map((item) => item.url) }) },
    clearMessages() {
      this.messagesVersion += 1
      this.messages = []; this.messageTotal = null; this.messagePage = 0
      this.messagesLoading = false; this.messagesError = ''; this.messagePosting = false; this.messageActing = ''
      this.contactInfo = null; this.contactError = ''
    },
    copyOrganizationContact() { if (this.contactInfo?.contactMethod) uni.setClipboardData({ data: this.contactInfo.contactMethod }) },
    async loadContact() {
      const version = this.homeVersion; const token = getAccessToken()
      try {
        const result = await getOrganizationContact(this.organizationId)
        if (version === this.homeVersion && token === getAccessToken() && isVerified()) this.contactInfo = result
      } catch (error) {
        if (version !== this.homeVersion || token !== getAccessToken()) return
        if ([401, 403].includes(error.statusCode)) { this.expirePrivateAccess(); return }
        this.contactError = error.message || '联系方式暂时无法加载'
      }
    },
    async loadMessages(reset = true) {
      const token = getAccessToken()
      if (!token || !isVerified()) { this.clearMessages(); return }
      if (!this.organizationId || (reset === false && this.messagesLoading)) return
      if (reset !== false) this.clearMessages()
      const version = ++this.messagesVersion
      const organizationId = this.organizationId
      const current = () => version === this.messagesVersion && token === getAccessToken() && isVerified() && organizationId === this.organizationId
      this.messagesLoading = true; this.messagesError = ''
      try {
        const result = await getOrganizationMessages(organizationId, { page: this.messagePage + 1, pageSize: 10 })
        if (!current()) return
        this.messages = [...new Map([...this.messages, ...result.items].map((item) => [item.id, item])).values()]
        this.messageTotal = result.total; this.messagePage += 1
      } catch (error) {
        if (!current()) return
        if ([401, 403].includes(error.statusCode)) { this.expirePrivateAccess(); return }
        this.messagesError = error.message || '留言暂时无法加载。'
      } finally { if (version === this.messagesVersion) this.messagesLoading = false }
    },
    async postMessage() {
      const content = this.messageDraft.trim()
      if (this.messagePosting || content.length < 2 || !this.verified) return
      const token = getAccessToken(); const version = this.homeVersion
      this.messagePosting = true
      try {
        await createOrganizationMessage(this.organizationId, content)
        if (token !== getAccessToken() || version !== this.homeVersion) return
        this.messageDraft = ''
        await this.loadMessages(true)
        uni.showToast({ title: '留言已发布', icon: 'success' })
      } catch (error) {
        if (token === getAccessToken() && version === this.homeVersion) {
          if ([401, 403].includes(error.statusCode)) this.expirePrivateAccess()
          uni.showModal({ title: '留言未提交', content: error.message || '请稍后重试', showCancel: false })
        }
      } finally { if (version === this.homeVersion) this.messagePosting = false }
    },
    withdrawMessage(message) {
      if (this.messageActing || !message.mine) return
      const token = getAccessToken(); const version = this.homeVersion
      uni.showModal({ title: '撤回这条留言？', content: '撤回后，该留言及组织回复将不再展示。', success: async (result) => {
        if (!result.confirm || token !== getAccessToken() || version !== this.homeVersion) return
        this.messageActing = message.id
        try {
          await cancelOrganizationMessage(message.id)
          if (token === getAccessToken() && version === this.homeVersion) await this.loadMessages(true)
        } catch (error) {
          if (token === getAccessToken() && version === this.homeVersion) {
            if ([401, 403].includes(error.statusCode)) this.expirePrivateAccess()
            uni.showModal({ title: '撤回失败', content: error.message || '请稍后重试', showCancel: false })
          }
        } finally { if (version === this.homeVersion) this.messageActing = '' }
      } })
    },
    goSection(section) { openPage(`/pages/chapter-${section}/index?id=${encodeURIComponent(this.organizationId)}`) },
    personTypeLabel(value) { return ({ student: '学生', faculty: '教师', staff: '教职工', alumni: '校友' })[value] || '学校成员' },
    resetMemberSearch() { this.memberKeyword = ''; return this.loadMembers(true) },
    async loadMembers(reset = true) {
      const token = getAccessToken()
      if (!token || !isVerified()) { this.clearMembers(); this.verified = false; return }
      if (!this.organizationId || (reset === false && this.membersLoading)) return
      if (reset !== false) { this.clearMembers(); this.appliedMemberKeyword = this.memberKeyword.trim() }
      const version = ++this.membersVersion
      const organizationId = this.organizationId
      const page = this.memberPage + 1
      this.membersLoading = true; this.membersError = ''
      const current = () => version === this.membersVersion && token === getAccessToken() && isVerified() && organizationId === this.organizationId
      try {
        const result = await getOrganizationMembers(organizationId, { page, pageSize: 12, query: this.appliedMemberKeyword })
        if (!current()) return
        this.members = [...new Map([...this.members, ...result.items].map((item) => [item.id, item])).values()]
        this.memberTotal = result.total; this.memberPage = page
      } catch (error) {
        if (!current()) return
        if ([401, 403].includes(error.statusCode)) { this.expirePrivateAccess(); return }
        this.membersError = error.message || '成员名单暂时无法加载，请稍后重试。'
      } finally {
        if (version === this.membersVersion) this.membersLoading = false
      }
    },
    async loadHome() {
      if (this.active === false) return
      if (!this.organizationId || this.loading) {
        if (!this.organizationId) this.error = '缺少组织编号'
        return
      }
      this.loading = true
      this.error = ''
      const version = ++this.homeVersion
      const token = getAccessToken()
      this.clearMembers()
      this.clearMessages()
      try {
        const verified = isVerified()
        this.verified = verified
        const loggedIn = Boolean(getAccessToken())
        const [homeResult, membershipResult, managedResult] = await Promise.all([
          getOrganizationHome(this.organizationId),
          verified ? getMyOrganizationMemberships().catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
          loggedIn ? getMyManagedOrganizations().catch(() => ({ items: [] })) : Promise.resolve({ items: [] })
        ])
        if (version !== this.homeVersion || token !== getAccessToken()) return
        const home = homeValue(homeResult)
        const organization = home.organization || (home.id || home.name ? home : null)
        if (!organization?.id && !organization?.name) throw new Error('组织主页数据不完整')
        const ownMembership = home.membership || home.myMembership
          || membershipResult.items.find((item) => String(item.organizationId || item.resourceId) === this.organizationId)
          || ((home.ownMembershipId || organization.ownMembershipId) ? { id: home.ownMembershipId || organization.ownMembershipId, status: 'approved', automatic: home.automatic === true || organization.automatic === true } : null)
        const managedRecord = managedResult.items.find((item) => String(item.id || item.organizationId) === this.organizationId)
        if (organization.coverUrl !== this.organization?.coverUrl) this.coverFailed = false
        this.organization = { ...organization, id: organization.id || this.organizationId }
        this.activities = listValue(home.activities)
        this.announcements = listValue(home.announcements)
        this.membership = ownMembership ? { ...ownMembership, automatic: ownMembership.automatic === true || organization.automatic === true || home.automatic === true } : null
        this.capabilities = home.capabilities || organization.capabilities || managedRecord?.capabilities || null
        this.managed = Boolean(home.isManager || home.canManage || managedRecord)
        uni.setNavigationBarTitle({ title: this.sectionTitle || this.organization.name || '组织主页' })
        if (verified) await Promise.all([
          this.sectionView === 'members' ? this.loadMembers(true) : Promise.resolve(),
          this.sectionView === 'contact' ? this.loadContact() : Promise.resolve(),
          !this.sectionView || this.sectionView === 'messages' ? this.loadMessages(true) : Promise.resolve()
        ])
      } catch (error) {
        if (version !== this.homeVersion || token !== getAccessToken()) return
        this.organization = null
        this.activities = []
        this.announcements = []
        this.error = error.message || '组织主页加载失败'
      } finally {
        if (version === this.homeVersion) this.loading = false
      }
    },
    openManager() {
      openPage(`/pages/chapter-manager/index?id=${encodeURIComponent(this.organizationId)}`)
    },
    async shareOrganization() {
      // #ifdef H5
      const title = `${this.organization?.name || '湖财校友组织'}｜组织主页`
      const url = window.location.href
      if (navigator.share) {
        try {
          await navigator.share({ title, text: '查看湖财校友组织主页', url })
          return
        } catch (error) {
          if (error?.name === 'AbortError') return
        }
      }
      uni.setClipboardData({
        data: url,
        success: () => uni.showToast({ title: '主页链接已复制', icon: 'none' }),
        fail: () => uni.showModal({ title: '分享失败', content: '暂时无法调用系统分享，请复制浏览器地址后发送。', showCancel: false })
      })
      // #endif
    },
    shareOrganizationApp() {
      // #ifdef APP-PLUS
      const title = `${this.organization?.name || '湖财校友组织'}｜组织主页`
      const summary = `${title}\n请打开湖财人 App 查看该组织的活动与通知。`
      if (typeof uni.shareWithSystem === 'function') {
        uni.shareWithSystem({
          type: 'text',
          summary,
          fail: () => uni.setClipboardData({
            data: summary,
            success: () => uni.showToast({ title: '组织信息已复制', icon: 'none' })
          })
        })
        return
      }
      uni.setClipboardData({
        data: summary,
        success: () => uni.showToast({ title: '组织信息已复制', icon: 'none' })
      })
      // #endif
    },
    openActivity(activity) {
      if (!activity?.id) return
      openPage(`/pages/event-detail/index?id=${encodeURIComponent(activity.id)}`)
    },
    openAnnouncement(notice) {
      this.selectedNotice = notice || null
    },
    noticeSubtitle(notice) {
      return [this.formatDate(notice?.startAt || notice?.createdAt), notice?.category || '组织通知']
        .filter(Boolean)
        .join(' · ')
    },
    openNoticeTarget() {
      const target = this.selectedNotice?.target || ''
      this.selectedNotice = null
      if (target) openPage(target)
    },
    plainText(value) {
      return markdownToPlainText(value, { singleLine: true, maxLength: 90 })
    },
    formatDate(value) {
      const date = new Date(value || '')
      if (Number.isNaN(date.getTime())) return '时间待定'
      const pad = (part) => String(part).padStart(2, '0')
      return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
    },
    formatDateTime(value) {
      const date = new Date(value || '')
      if (Number.isNaN(date.getTime())) return '时间待定'
      const pad = (part) => String(part).padStart(2, '0')
      return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
    activityMonth(activity) {
      const date = new Date(activity?.startAt || '')
      return Number.isNaN(date.getTime()) ? '--月' : `${String(date.getMonth() + 1).padStart(2, '0')}月`
    },
    activityDay(activity) {
      const date = new Date(activity?.startAt || '')
      return Number.isNaN(date.getTime()) ? '--' : String(date.getDate()).padStart(2, '0')
    },
    priorityLabel(value) {
      return ({ urgent: '紧急', high: '重要', normal: '通知', low: '一般' })[value] || '通知'
    },
    toggleMembership() {
      if (this.acting) return
      if (!this.verified) {
        uni.showModal({
          title: '请先登录湖财人账号',
          content: '登录已实名注册的平台账号后，才能申请加入校友组织。',
          confirmText: '去登录',
          confirmColor: '#033481',
          success: (result) => { if (result.confirm) openPage('/pages/verify/index') }
        })
        return
      }
      if (this.membershipActive || this.membershipPending) {
        const active = this.membershipActive
        const membershipId = this.membership?.id
        const token = getAccessToken()
        uni.showModal({
          title: active ? '确认退出组织' : '确认撤回申请',
          content: active
            ? `退出“${this.organization.name}”后，将不再计入组织成员。${this.membership?.automatic ? '系统不会自动将你加回。' : ''}确定继续吗？`
            : `确定撤回加入“${this.organization.name}”的申请吗？`,
          confirmText: active ? '确认退出' : '确认撤回',
          confirmColor: '#9A4C48',
          success: async (result) => {
            if (!result.confirm || token !== getAccessToken() || membershipId !== this.membership?.id) return
            await this.endMembership(active, membershipId, token)
          }
        })
        return
      }
      uni.showModal({
        title: '申请加入组织',
        content: `确认申请加入“${this.organization.name}”吗？提交后由组织管理人员复核。`,
        confirmText: '提交申请',
        confirmColor: '#033481',
        success: async (result) => {
          if (!result.confirm) return
          this.acting = true
          try {
            await joinOrganization(this.organizationId)
            await this.loadHome()
            uni.showToast({ title: '加入申请已提交', icon: 'none' })
          } catch (error) {
            uni.showModal({ title: '申请失败', content: error.message || '请稍后重试', showCancel: false })
          } finally {
            this.acting = false
          }
        }
      })
    },
    async endMembership(active, membershipId = this.membership?.id, token = getAccessToken()) {
      if (this.acting || token !== getAccessToken() || membershipId !== this.membership?.id) return
      if (!membershipId) {
        uni.showModal({ title: '操作失败', content: '当前加入记录缺少唯一编号，请刷新页面后重试。', showCancel: false })
        return
      }
      this.acting = true
      try {
        await endOrganizationMembership(membershipId, token)
        if (token !== getAccessToken()) return
        await this.loadHome()
        if (token !== getAccessToken()) return
        uni.showToast({ title: active ? '已退出组织' : '申请已撤回', icon: 'none' })
      } catch (error) {
        if (token === getAccessToken()) uni.showModal({ title: '操作失败', content: error.message || '请稍后重试', showCancel: false })
      } finally {
        if (token === getAccessToken()) this.acting = false
      }
    }
  }
}
</script>

<style scoped>
.notice-detail-meta{margin-bottom:22rpx;display:flex;flex-wrap:wrap;gap:10rpx}.notice-detail-meta text{padding:7rpx 13rpx;border-radius:99rpx;color:#5c6d83;background:#edf2f7;font-size:18rpx}
.chapter-detail-page{padding-top:14rpx}.chapter-hero{position:relative;min-height:400rpx;padding:36rpx 34rpx 30rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#082e67,#033481 58%,#1e5a9a);box-shadow:0 24rpx 54rpx rgba(9,47,105,.2)}.chapter-hero:after{content:"";position:absolute;width:280rpx;height:280rpx;right:-98rpx;top:-118rpx;border:1rpx solid rgba(255,255,255,.14);border-radius:50%;box-shadow:0 0 0 44rpx rgba(255,255,255,.035)}.chapter-hero__identity{position:relative;z-index:2;display:flex;align-items:center}.chapter-hero__mark{width:100rpx;height:100rpx;margin-right:22rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:1rpx solid rgba(255,255,255,.23);border-radius:30rpx;color:#efd7a5;background:rgba(255,255,255,.08);font-family:serif;font-size:27rpx;font-weight:700}.chapter-hero__copy{min-width:0}.chapter-hero__eyebrow,.chapter-hero__title,.chapter-hero__meta,.chapter-hero__stats text{display:block}.chapter-hero__eyebrow{color:#dfc28b;font-size:17rpx;font-weight:700;letter-spacing:3rpx}.chapter-hero__title{max-width:490rpx;margin-top:11rpx;font-size:36rpx;font-weight:700;line-height:1.3;overflow-wrap:anywhere}.chapter-hero__meta{margin-top:8rpx;color:rgba(255,255,255,.63);font-size:20rpx;overflow-wrap:anywhere}.chapter-hero__stats{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:29rpx;padding-top:21rpx;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1rpx solid rgba(255,255,255,.14)}.chapter-hero__stats view{padding:0 20rpx;border-right:1rpx solid rgba(255,255,255,.14)}.chapter-hero__stats view:first-child{padding-left:0}.chapter-hero__stats view:last-child{border-right:0}.chapter-hero__stats text:first-child{color:#ead19d;font-family:Georgia,serif;font-size:31rpx;font-weight:700}.chapter-hero__stats text:last-child{margin-top:5rpx;color:rgba(255,255,255,.5);font-size:17rpx}.chapter-hero__watermark{position:absolute;right:17rpx;bottom:77rpx;color:rgba(255,255,255,.06);font-family:Georgia,serif;font-size:76rpx;font-weight:700;letter-spacing:5rpx}.manager-entry{position:relative;z-index:3;margin:-12rpx 18rpx 0;padding:22rpx;display:flex;align-items:center}.manager-entry__icon{width:58rpx;height:58rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#fff;background:#176551;font-size:19rpx;font-weight:700}.manager-entry>view:nth-child(2){min-width:0;flex:1}.manager-entry text{display:block}.manager-entry>view:nth-child(2) text:first-child{color:#35504b;font-size:22rpx;font-weight:700;overflow-wrap:anywhere}.manager-entry>view:nth-child(2) text:last-child{margin-top:4rpx;color:#83928e;font-size:17rpx;overflow-wrap:anywhere}.manager-entry>text{margin-left:12rpx;color:#176551;font-size:20rpx;font-weight:650;white-space:nowrap}.chapter-overview{margin-top:24rpx;display:grid;gap:18rpx}.overview-card{padding:0 26rpx 27rpx;min-width:0}.overview-head{margin-top:28rpx;margin-bottom:20rpx}.contact-list{display:grid}.contact-list view{min-height:73rpx;padding:16rpx 0;display:flex;align-items:center;justify-content:space-between;gap:24rpx;border-bottom:1rpx solid #edf0f4}.contact-list view:last-child{border-bottom:0}.contact-list text:first-child{flex-shrink:0;color:#919aa8;font-size:19rpx}.contact-list text:last-child{max-width:68%;color:#3b4d64;font-size:21rpx;text-align:right;overflow-wrap:anywhere}.join-guide{margin-top:18rpx;padding:25rpx;display:flex;align-items:flex-start}.join-guide__icon{width:52rpx;height:52rpx;margin-right:15rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#7c5d29;background:#f4e6cc;font-size:18rpx;font-weight:700}.join-guide>view:not(.join-guide__icon){min-width:0;flex:1}.join-guide>view>text{display:block;margin-bottom:8rpx;color:#654d29;font-size:22rpx;font-weight:700}.chapter-content-grid{display:grid}.chapter-content-column{min-width:0}.activity-list{display:grid;gap:16rpx}.activity-card{padding:22rpx;display:flex;align-items:center;min-width:0}.activity-date{width:78rpx;height:88rpx;margin-right:17rpx;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:23rpx;color:#fff;background:linear-gradient(145deg,#033481,#1f5da3)}.activity-date text{display:block}.activity-date text:first-child{font-size:16rpx}.activity-date text:last-child{margin-top:3rpx;font-family:Georgia,serif;font-size:31rpx;font-weight:700}.activity-copy{min-width:0;flex:1}.activity-copy>view{display:flex;justify-content:space-between;gap:12rpx}.activity-copy>view text{min-width:0;color:#9b773a;font-size:17rpx;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-copy>view text:last-child{color:#939dab}.activity-copy>text{display:block}.activity-copy>text:nth-child(2){margin-top:8rpx;overflow:hidden;color:#2f3e54;font-size:24rpx;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.activity-copy>text:nth-child(3){margin-top:6rpx;overflow:hidden;color:#8c96a5;font-size:17rpx;text-overflow:ellipsis;white-space:nowrap}.card-arrow{margin-left:10rpx;color:#a4adba;font-size:34rpx}.notice-list{padding:0 24rpx;min-width:0}.notice-card{padding:23rpx 0;border-bottom:1rpx solid #edf0f4;min-width:0}.notice-card:last-child{border-bottom:0}.notice-card__top{display:flex;align-items:center;justify-content:space-between;gap:12rpx;color:#9ba3af;font-size:17rpx}.notice-priority{padding:5rpx 10rpx;flex-shrink:0;border-radius:99rpx;color:#4e6681;background:#eef3f8;font-size:16rpx;font-weight:650}.notice-priority--urgent{color:#9a3f3a;background:#f7e4e2}.notice-priority--high{color:#88632a;background:#f6ead2}.notice-card__title,.notice-card__summary{display:block;overflow-wrap:anywhere}.notice-card__title{margin-top:12rpx;color:#2e3c51;font-size:24rpx;font-weight:700}.notice-card__summary{margin-top:7rpx;display:-webkit-box;overflow:hidden;color:#7d899a;font-size:19rpx;line-height:1.6;-webkit-box-orient:vertical;-webkit-line-clamp:2}.content-empty{padding:30rpx;display:flex;align-items:center;min-width:0}.content-empty>text{width:60rpx;height:60rpx;margin-right:15rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:20rpx;color:#8b6a31;background:#f5ead7;font-weight:700}.content-empty>view{min-width:0}.content-empty view text{display:block;overflow-wrap:anywhere}.content-empty view text:first-child{color:#46566b;font-size:22rpx;font-weight:650}.content-empty view text:last-child{margin-top:5rpx;color:#929caa;font-size:17rpx}.chapter-policy{margin-top:26rpx;padding:23rpx;display:flex;align-items:flex-start;border-radius:24rpx;color:#758195;background:#e9eef5}.chapter-policy>text{width:48rpx;height:48rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:16rpx;color:#176551;background:#dcece6;font-size:18rpx;font-weight:700}.chapter-policy>view{min-width:0}.chapter-policy view text{display:block;overflow-wrap:anywhere}.chapter-policy view text:first-child{color:#4b5b70;font-size:20rpx;font-weight:700}.chapter-policy view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}.chapter-actions{display:flex;gap:14rpx}.chapter-actions button{margin:0}.share-action{width:31%;height:88rpx;display:flex;align-items:center;justify-content:center;gap:8rpx;border-radius:22rpx;color:#53627a;background:#eef2f7;font-size:21rpx}.share-action text:first-child{font-size:26rpx}.membership-action{min-width:0;flex:1}.membership-action--danger{color:#924641;background:#f7e7e5;box-shadow:none}.detail-state{margin-top:20rpx;padding:80rpx 34rpx;text-align:center}.detail-state__icon{width:86rpx;height:86rpx;margin:0 auto 22rpx;display:flex;align-items:center;justify-content:center;border-radius:28rpx;color:#fff;background:#033481;font-size:30rpx;font-weight:700}.detail-state__title,.detail-state__desc{display:block;overflow-wrap:anywhere}.detail-state__title{color:#334158;font-size:29rpx;font-weight:700}.detail-state__desc{max-width:560rpx;margin:11rpx auto 0;color:#838e9e;font-size:20rpx;line-height:1.7}.detail-state__button{width:260rpx;margin:27rpx auto 0}
@media screen and (min-width:768px){.chapter-hero{min-height:370px;padding:46px 50px;border-radius:36px}.chapter-hero__mark{width:92px;height:92px;margin-right:28px;border-radius:28px;font-size:25px}.chapter-hero__eyebrow{font-size:14px}.chapter-hero__title{max-width:760px;margin-top:12px;font-size:44px}.chapter-hero__meta{font-size:16px}.chapter-hero__stats{left:50px;right:50px;bottom:35px;padding-top:24px}.chapter-hero__stats text:first-child{font-size:30px}.chapter-hero__stats text:last-child{font-size:13px}.manager-entry{margin:-14px 34px 0;padding:21px 24px}.chapter-overview{grid-template-columns:1.2fr .8fr;gap:20px}.overview-card{padding:0 30px 30px}.chapter-content-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.activity-card{padding:20px}.notice-list{padding:0 26px}.chapter-actions{left:50%;right:auto;width:min(760px,calc(100% - 48px));transform:translateX(-50%);border-radius:24px 24px 0 0}}
@media screen and (min-width:768px){
  .chapter-detail-page .section-title{font-size:22px}
  .chapter-detail-page .section-kicker{margin-top:5px;font-size:12px}
  .chapter-detail-page .section-more{font-size:14px}
  .manager-entry>view:nth-child(2) text:first-child{font-size:16px}
  .manager-entry>view:nth-child(2) text:last-child{font-size:14px}
  .manager-entry>text{font-size:15px}
  .contact-list text:first-child{font-size:13px}
  .contact-list text:last-child{font-size:15px}
  .join-guide>view>text{font-size:16px}
  .activity-copy>view text,.activity-copy>text:nth-child(3){font-size:13px}
  .activity-copy>text:nth-child(2){font-size:17px}
  .notice-card__top{font-size:13px}
  .notice-priority{font-size:12px}
  .notice-card__title{font-size:17px}
  .notice-card__summary{font-size:14px}
  .content-empty view text:first-child{font-size:16px}
  .content-empty view text:last-child{font-size:13px}
  .chapter-policy view text:first-child{font-size:15px}
  .chapter-policy view text:last-child{font-size:14px}
  .share-action{height:50px;border-radius:15px;font-size:15px}
  .membership-action{height:50px;font-size:16px;line-height:50px}
}
@media screen and (min-width:1200px){.chapter-hero,.manager-entry,.chapter-overview,.join-guide,.chapter-content-grid,.chapter-policy{max-width:1120px;margin-left:auto;margin-right:auto}.manager-entry{margin-top:-14px}.chapter-content-grid{gap:28px}.chapter-content-column .section-head{margin-top:46px}}
/* Independent px layout keeps directory sections readable across uni-app rpx breakpoints. */
.chapter-shortcuts{max-width:1120px;margin:16px auto 0;padding:18px 8px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-radius:18px}
.chapter-shortcuts button{width:100%;margin:0;padding:0;min-width:0;border:0;background:transparent;line-height:1.5;font-size:14px;color:#21334b}
.chapter-shortcuts button:after,.chapter-members button:after,.chapter-album button:after,.chapter-messages button:after{border:0}
.chapter-shortcuts__icon{width:42px;height:42px;margin:0 auto 7px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:#e8f1fb;color:#235b99;font-size:20px;font-weight:700}
.chapter-shortcuts__icon--contact{color:#3c73a7;background:#e8f3fa}.chapter-shortcuts__icon--members{color:#227b68;background:#e4f3ed}.chapter-shortcuts__icon--album{color:#6953a0;background:#efebf8}.chapter-shortcuts__icon--messages{color:#946a25;background:#faf0da}
.chapter-cover{display:block;width:100%;max-width:1120px;height:200px;margin:16px auto 0;border-radius:16px}
.chapter-members,.chapter-album,.chapter-messages{max-width:1120px;margin:20px auto 0;padding:20px;border-radius:18px;box-sizing:border-box;min-width:0}
.chapter-members__header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:18px;border-bottom:1px solid #edf0f5}
.chapter-members__header>view{min-width:0}.chapter-members__title{display:block;color:#152d4b;font-size:20px;font-weight:700;line-height:1.45;border-left:3px solid #b8914d;padding-left:10px}
.chapter-members__hint{display:block;margin-top:6px;color:#8390a2;font-size:12px;line-height:1.5}
.chapter-members__count{flex-shrink:0;font-size:14px;color:#657993;font-variant-numeric:tabular-nums}
.chapter-members__search{display:flex;align-items:center;gap:8px;margin:16px 0;min-width:0}
.chapter-members__search input{min-width:0;flex:1;height:44px;box-sizing:border-box;padding:0 10px;border:1px solid #dce4f0;border-radius:10px;font-size:14px;background:#f9fbfd}
.chapter-members__button{margin:0;padding:0 16px;min-height:44px;flex-shrink:0;border-radius:10px;background:#033481;color:#fff;font-size:14px;font-weight:600;line-height:44px}
.chapter-members__button[disabled]{color:#919bac;background:#e8edf4}.chapter-members__reset{margin:0;padding:8px 0;min-height:44px;background:transparent;color:#577398;font-size:13px;line-height:28px;flex-shrink:0}
.chapter-members__grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.chapter-members__card{display:flex;align-items:flex-start;gap:12px;min-width:0;padding:16px;border:1px solid #e9eef5;background:#fbfcfe;border-radius:14px}
.chapter-members__avatar,.chapter-messages__avatar{flex-shrink:0;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#e7effa;color:#1e528b;font-size:18px;font-weight:650}
.chapter-members__avatar--manager{background:#f4ead7;color:#927037}.chapter-members__identity{min-width:0;flex:1}
.chapter-members__name-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.chapter-members__name{color:#203955;font-size:16px;font-weight:650;overflow-wrap:anywhere}
.chapter-members__role{background:#f4e9d3;color:#816026;border-radius:5px;padding:2px 5px;font-size:11px}
.chapter-members__department{display:block;margin-top:5px;color:#687a90;font-size:13px;overflow-wrap:anywhere;line-height:1.5}.chapter-members__type{display:block;margin-top:5px;color:#8996a6;font-size:12px}
.chapter-members__state{padding:28px 8px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;color:#7b889a;font-size:14px;line-height:1.7;overflow-wrap:anywhere}
.chapter-members__state-title{font-size:16px;font-weight:650;color:#405672}.chapter-members__loading{padding:20px;text-align:center;font-size:14px;color:#69809b}
.chapter-members__more{width:100%;margin:16px 0 0;min-height:44px;padding:10px;border:1px solid #dce5f0;background:#f7f9fc;border-radius:10px;color:#255285;font-size:14px;line-height:24px}
.chapter-members__privacy{display:block;margin-top:16px;padding-top:12px;border-top:1px solid #edf1f6;color:#8994a3;font-size:12px;line-height:1.7;overflow-wrap:anywhere}
.chapter-album__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}
.chapter-album__photo{min-width:0;width:100%;margin:0;padding:0;background:#f5f7fb;border-radius:12px;overflow:hidden;text-align:left;line-height:1.5}
.chapter-album__photo image{width:100%;height:130px;display:block}.chapter-album__photo>text{display:block;padding:10px;font-size:13px;color:#566b83;overflow-wrap:anywhere}
.chapter-messages__form{padding:16px 0;border-bottom:1px solid #edf1f6}.chapter-messages__form textarea{width:100%;height:110px;box-sizing:border-box;padding:12px;border:1px solid #dce5ef;border-radius:10px;background:#f9fbfd;font-size:14px;line-height:1.6}
.chapter-messages__form>view{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:12px}.chapter-messages__form>view>text{min-width:0;font-size:12px;line-height:1.6;color:#8b97a7}
.chapter-messages__item{display:flex;gap:12px;min-width:0;padding:22px 0;border-bottom:1px solid #edf1f6}.chapter-messages__item:last-child{border:0}.chapter-messages__body{min-width:0;flex:1}
.chapter-messages__byline{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}.chapter-messages__byline>text:first-child{color:#28415d;font-size:15px;font-weight:650;overflow-wrap:anywhere}.chapter-messages__byline>text:last-child{font-size:12px;color:#929ead}
.chapter-messages__pending{display:block;font-size:12px;color:#a47e39;margin-top:6px}.chapter-messages__content{display:block;margin-top:10px;font-size:15px;color:#3c5068;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}
.chapter-messages__reply{margin-top:12px;padding:12px;border-radius:8px;background:#f3f6fa;font-size:14px;line-height:1.7;overflow-wrap:anywhere;white-space:pre-wrap}.chapter-messages__reply>text:first-child{display:block;color:#255889;font-size:12px;font-weight:650;margin-bottom:3px}
.chapter-detail-page button:focus-visible{outline:3px solid #b8914d;outline-offset:3px}
.chapter-overview{margin-top:20px;gap:16px}.overview-card{padding:0 20px 20px;border-radius:18px}.overview-head{margin-top:20px;margin-bottom:18px}
.chapter-detail-page .section-title{font-size:20px}.chapter-detail-page .section-kicker{font-size:11px;margin-top:5px}.chapter-detail-page .section-more{font-size:13px}
.chapter-detail-page .contact-list text:first-child{font-size:13px}.chapter-detail-page .contact-list text:last-child{font-size:14px}.chapter-detail-page .contact-list view{padding:14px 0;min-height:46px;gap:12px}
.chapter-detail-page .join-guide{padding:18px;border-radius:16px}.chapter-detail-page .join-guide>view>text{font-size:15px}
.chapter-detail-page .section-head{margin-top:24px;margin-bottom:14px}.chapter-detail-page .activity-card{padding:18px;border-radius:16px}
.chapter-detail-page .activity-copy>view text,.chapter-detail-page .activity-copy>text:nth-child(3){font-size:12px}.chapter-detail-page .activity-copy>text:nth-child(2){font-size:16px;white-space:normal;overflow-wrap:anywhere;line-height:1.5}
.chapter-detail-page .content-empty{padding:20px;border-radius:16px}.chapter-detail-page .content-empty view text:first-child{font-size:15px}.chapter-detail-page .content-empty view text:last-child{font-size:12px;line-height:1.6}
.chapter-detail-page .notice-list{padding:0 20px;border-radius:16px}.chapter-detail-page .notice-card{padding:18px 0}.chapter-detail-page .notice-card__title{font-size:16px;line-height:1.5}.chapter-detail-page .notice-card__summary{font-size:13px}.chapter-detail-page .notice-card__top{font-size:12px}.chapter-detail-page .notice-priority{font-size:11px}
@media screen and (min-width:600px){.chapter-members__grid{grid-template-columns:repeat(2,minmax(0,1fr))}.chapter-album__grid{grid-template-columns:repeat(3,minmax(0,1fr))}.chapter-album__photo image{height:180px}.chapter-cover{height:280px}}
@media screen and (min-width:1024px){.chapter-members,.chapter-album,.chapter-messages{padding:28px;margin-top:24px}.chapter-members__grid{grid-template-columns:repeat(3,minmax(0,1fr))}.chapter-members__search{max-width:600px}.chapter-members__title{font-size:22px}.chapter-shortcuts{padding:22px 48px}.chapter-shortcuts button{display:flex;align-items:center;justify-content:center;gap:14px;font-size:16px}.chapter-shortcuts__icon{margin:0}.chapter-album__grid{grid-template-columns:repeat(4,minmax(0,1fr))}.chapter-cover{height:340px}}
.chapter-section-heading{max-width:1120px;margin:12px auto 20px;padding:22px 24px;border-left:4px solid #b8914d;border-radius:0 16px 16px 0;background:#eaf0f8;color:#203b5c}.chapter-section-heading>text{display:block;overflow-wrap:anywhere}.chapter-section-heading>text:first-child{font-size:20px;font-weight:700;line-height:1.5}.chapter-section-heading>text:last-child{margin-top:6px;color:#637d9b;font-size:13px}.chapter-section-page .chapter-overview{display:block}.chapter-section-page .chapter-members,.chapter-section-page .chapter-album,.chapter-section-page .chapter-messages{margin-top:0}
</style>
<style scoped>
.chapter-auto-membership{margin:18rpx 0;padding:20rpx 24rpx;border-radius:18rpx;background:#edf5f1;color:#376451;font-size:22rpx;line-height:1.7}.chapter-auto-membership text{display:block}.chapter-auto-membership text+text{color:#728c80;font-size:20rpx}
</style>
