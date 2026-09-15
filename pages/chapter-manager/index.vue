<template>
  <view class="page-shell chapter-manager-page">
    <template v-if="state === 'ready' && organization">
      <view class="manager-hero">
        <text class="manager-hero__eyebrow">CHAPTER MANAGEMENT</text>
        <text class="manager-hero__title">组织管理工作台</text>
        <text class="manager-hero__desc">以组织管理人员身份发布活动和通知，所有内容与权限均由服务端校验并留痕。</text>
        <view class="manager-hero__organization"><view>{{ initials }}</view><view><text>{{ organization.name }}</text><text>{{ organizationType }} · {{ organization.city || '所在地待完善' }}</text></view></view>
        <text class="manager-hero__mark">组</text>
      </view>

      <scroll-view v-if="managedOrganizations.length > 1" class="organization-switch" scroll-x :show-scrollbar="false">
        <view class="organization-switch__row">
          <view
            v-for="item in managedOrganizations"
            :key="item.id"
            class="organization-chip"
            :class="{ 'organization-chip--active': String(item.id) === organizationId }"
            :title="item.name || '校友组织'"
            :aria-label="item.name || '校友组织'"
            @tap="selectOrganization(item)"
          >
            <text>{{ String(item.name || '组织').slice(0, 2) }}</text>
            <text>{{ item.name || '校友组织' }}</text>
          </view>
        </view>
      </scroll-view>

      <view class="manager-summary surface">
        <view><text>{{ activities.length }}</text><text>活动记录</text></view>
        <view><text>{{ announcements.length }}</text><text>通知记录</text></view>
        <view><text>{{ publishedCount }}</text><text>当前公开</text></view>
        <view><text>{{ memberCount }}</text><text>组织成员</text></view>
      </view>

      <view v-if="canPublish" class="publish-grid">
        <view v-if="isModuleEnabled('activities')" class="publish-entry publish-entry--activity" @tap="openPublish('activity')">
          <view class="publish-entry__icon">会</view>
          <view><text>发布组织活动</text><text>设置时间、场地、报名截止与活动详情</text></view>
          <text>＋</text>
        </view>
        <view v-if="isModuleEnabled('announcements')" class="publish-entry publish-entry--notice" @tap="openPublish('announcement')">
          <view class="publish-entry__icon">告</view>
          <view><text>发布组织通知</text><text>在组织主页发布重要安排与提醒</text></view>
          <text>＋</text>
        </view>
      </view>

      <view class="workbench-grid">
        <view v-if="isModuleEnabled('activities')" class="workbench-column">
          <view class="section-head"><view><text class="section-title">活动管理</text><text class="section-kicker">CHAPTER EVENTS</text></view><text class="section-more">{{ activities.length }} 条</text></view>
          <view v-if="activities.length" class="manager-list">
            <view v-for="activity in activities" :key="activity.id" class="manager-record surface" @tap="openActivity(activity)">
              <view class="manager-record__top"><text :class="`record-status record-status--${statusTone(activity.status)}`">{{ statusLabel(activity.status) }}</text><text>{{ formatDate(activity.updatedAt || activity.createdAt) }}</text></view>
              <text class="manager-record__title">{{ activity.title || '未命名活动' }}</text>
              <text class="manager-record__meta">{{ formatDateTime(activity.startAt) }} · {{ activity.venue || '场地待定' }}</text>
              <view class="manager-record__foot"><text>{{ activity.category || '组织活动' }}</text><text>报名 {{ Number(activity.registrationCount || 0) }} / {{ Number(activity.quota || 0) || '不限' }} ›</text></view>
              <view v-if="canEdit" class="manager-record__actions">
                <button class="record-action record-action--edit" :disabled="Boolean(actingId)" @tap.stop="editRecord('activity', activity)">编辑</button>
                <button v-if="canPublish && ['draft','offline'].includes(recordStatus(activity))" class="record-action" :loading="actingId === activity.id" :disabled="Boolean(actingId)" @tap.stop="actRecord('activity', activity, 'publish')">重新发布</button>
                <button v-if="recordStatus(activity) === 'published'" class="record-action" :loading="actingId === activity.id" :disabled="Boolean(actingId)" @tap.stop="actRecord('activity', activity, 'close')">关闭报名</button>
                <button v-if="recordStatus(activity) === 'published'" class="record-action record-action--danger" :loading="actingId === activity.id" :disabled="Boolean(actingId)" @tap.stop="actRecord('activity', activity, 'unpublish')">下架</button>
                <button v-if="recordStatus(activity) === 'closed'" class="record-action" :loading="actingId === activity.id" :disabled="Boolean(actingId)" @tap.stop="actRecord('activity', activity, 'complete')">标记结束</button>
              </view>
            </view>
          </view>
          <view v-else class="manager-empty surface"><text>会</text><view><text>还没有组织活动</text><text>发布后会直接进入公开组织主页。</text></view><button v-if="canPublish" class="secondary-button" @tap="openPublish('activity')">发布活动</button></view>
        </view>

        <view v-if="isModuleEnabled('announcements')" class="workbench-column">
          <view class="section-head"><view><text class="section-title">通知管理</text><text class="section-kicker">CHAPTER NOTICES</text></view><text class="section-more">{{ announcements.length }} 条</text></view>
          <view v-if="announcements.length" class="manager-list">
            <view v-for="notice in announcements" :key="notice.id" class="manager-record surface" @tap="previewNotice(notice)">
              <view class="manager-record__top"><text :class="`record-status record-status--${statusTone(notice.status)}`">{{ statusLabel(notice.status) }}</text><text>{{ formatDate(notice.updatedAt || notice.createdAt) }}</text></view>
              <text class="manager-record__title">{{ notice.title || '未命名通知' }}</text>
              <text class="manager-record__summary">{{ notice.summary || plainText(notice.content) || '暂无摘要' }}</text>
              <view class="manager-record__foot"><text>{{ priorityLabel(notice.priority) }} · {{ notice.category || '组织通知' }}</text><text>{{ audienceLabel(notice.audience) }} ›</text></view>
            </view>
          </view>
          <view v-else class="manager-empty surface"><text>告</text><view><text>还没有组织通知</text><text>发布后会直接进入公开组织主页。</text></view><button v-if="canPublish" class="secondary-button" @tap="openPublish('announcement')">发布通知</button></view>
        </view>
      </view>

      <view class="management-policy">
        <text>权</text>
        <view><text>管理权限仅作用于当前组织</text><text>发布请求不会信任客户端提交的组织编号；服务端会按当前账号有效的组织编辑与审核权限重新绑定并校验。</text></view>
      </view>
      <view v-if="!canPublish" class="permission-note surface">{{ permissionMessage }}</view>
      <button class="public-home-button ghost-button" @tap="openPublicHome">查看公开组织主页</button>
      <BusinessDetailSheet
        :open="Boolean(selectedNotice)"
        :title="selectedNotice ? selectedNotice.title : ''"
        :subtitle="selectedNotice ? noticeSubtitle(selectedNotice) : ''"
        eyebrow="CHAPTER NOTICE"
        :show-actions="Boolean(selectedNotice && canEdit)"
        @close="selectedNotice = null"
      >
        <template v-if="selectedNotice">
          <view class="notice-detail-meta">
            <text>{{ priorityLabel(selectedNotice.priority) }}</text>
            <text>{{ audienceLabel(selectedNotice.audience) }}</text>
          </view>
          <BusinessRichText :content="selectedNotice.content || selectedNotice.summary" empty-text="暂无通知正文。" />
        </template>
        <template #actions>
          <view v-if="selectedNotice" class="notice-actions">
            <button class="secondary-button" :disabled="Boolean(actingId)" @tap="editRecord('announcement', selectedNotice)">编辑通知</button>
            <button
              v-if="canPublish && ['draft','offline'].includes(recordStatus(selectedNotice))"
              class="primary-button"
              :loading="actingId === selectedNotice.id"
              :disabled="Boolean(actingId)"
              @tap="actRecord('announcement', selectedNotice, 'publish')"
            >重新发布</button>
            <button
              v-else-if="recordStatus(selectedNotice) === 'published'"
              class="primary-button notice-action--danger"
              :loading="actingId === selectedNotice.id"
              :disabled="Boolean(actingId)"
              @tap="actRecord('announcement', selectedNotice, 'unpublish')"
            >下架通知</button>
          </view>
        </template>
      </BusinessDetailSheet>
    </template>

    <view v-else class="access-state surface">
      <view class="access-state__icon">{{ stateIcon }}</view>
      <text class="access-state__title">{{ stateTitle }}</text>
      <text class="access-state__desc">{{ stateDescription }}</text>
      <button v-if="state === 'guest'" class="primary-button access-state__button" @tap="open('/pages/verify/index')">去登录</button>
      <button v-else-if="state === 'forbidden'" class="secondary-button access-state__button" @tap="open('/pages/chapters/index')">返回组织列表</button>
      <button v-else-if="state === 'error'" class="secondary-button access-state__button" @tap="loadWorkbench">重新加载</button>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import {
  actManagedOrganizationContent,
  getMyManagedOrganization,
  getMyManagedOrganizations
} from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { getAccessToken } from '../../utils/store'
import { openPage } from '../../utils/nav'
import { normalizeOrganizationType } from '../../server/src/business/organization-categories.js'

function listValue(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  return []
}

function detailValue(source = {}) {
  if (source?.data && (source.data.organization || source.data.activities || source.data.announcements)) return source.data
  return source || {}
}

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() {
    return {
      state: 'loading',
      organizationId: '',
      organization: null,
      managedOrganizations: [],
      activities: [],
      announcements: [],
      capabilities: null,
      selectedNotice: null,
      error: '',
      loading: false,
      actingId: ''
    }
  },
  computed: {
    initials() {
      return String(this.organization?.initials || this.organization?.name || '湖财').slice(0, 2)
    },
    organizationType() {
      return normalizeOrganizationType(this.organization?.type) || '校友组织'
    },
    memberCount() {
      return Number(this.organization?.memberCount || this.organization?.members || 0)
    },
    publishedCount() {
      return [...this.activities, ...this.announcements].filter((item) => String(item.status || '').toLowerCase() === 'published').length
    },
    canPublish() {
      if (this.capabilities && Object.prototype.hasOwnProperty.call(this.capabilities, 'publish')) {
        return this.capabilities.publish === true
      }
      return this.canEdit
    },
    canEdit() {
      return this.capabilities?.update === true && this.capabilities?.moderate === true
    },
    permissionMessage() {
      if (this.organization && String(this.organization.status || '') !== 'published') {
        return '当前组织尚未发布或已下架，暂时不能发布组织事项；请先由学校后台恢复组织公开状态。'
      }
      return '当前账号只有组织查看权限；需要学校后台补充“编辑”和“审核办理”权限后才能发布内容。'
    },
    stateIcon() {
      return ({ loading: '…', guest: '登', forbidden: '权', error: '!' })[this.state] || '管'
    },
    stateTitle() {
      return ({
        loading: '正在核验组织管理权限',
        guest: '登录后才能进入管理工作台',
        forbidden: '当前账号没有组织管理权限',
        error: '组织管理工作台暂时无法加载'
      })[this.state] || '组织管理工作台'
    },
    stateDescription() {
      return ({
        loading: '系统正在读取当前账号被委派管理的组织。',
        guest: '请先登录平台账号，再由服务端核验组织管理委派。',
        forbidden: '只有被学校或组织授权、且委派仍在有效期内的管理人员才能发布内容。',
        error: this.error || '请检查网络后重试。'
      })[this.state] || ''
    }
  },
  onLoad(options = {}) {
    this.organizationId = String(options.id || '')
    this.loadWorkbench()
  },
  onShow() {
    if (this.state === 'ready' && this.organizationId) this.loadDetail()
  },
  onPullDownRefresh() {
    this.loadWorkbench().finally(() => uni.stopPullDownRefresh())
  },
  methods: {
    open(url) { openPage(url) },
    async loadWorkbench() {
      if (this.loading) return
      if (!getAccessToken()) {
        this.state = 'guest'
        return
      }
      this.loading = true
      this.state = 'loading'
      this.error = ''
      try {
        const result = await getMyManagedOrganizations()
        this.managedOrganizations = result.items
        if (!this.managedOrganizations.length) {
          this.state = 'forbidden'
          return
        }
        const selected = this.organizationId
          ? this.managedOrganizations.find((item) => String(item.id || item.organizationId) === this.organizationId)
          : this.managedOrganizations[0]
        if (!selected) {
          this.state = 'forbidden'
          return
        }
        this.organizationId = String(selected.id || selected.organizationId)
        await this.loadDetail()
      } catch (error) {
        if (error.statusCode === 401) this.state = 'guest'
        else if (error.statusCode === 403 || error.statusCode === 404) this.state = 'forbidden'
        else {
          this.error = error.message || '组织管理信息加载失败'
          this.state = 'error'
        }
      } finally {
        this.loading = false
      }
    },
    async loadDetail() {
      if (!this.organizationId) return
      try {
        const result = detailValue(await getMyManagedOrganization(this.organizationId))
        const organization = result.organization || this.managedOrganizations.find((item) => String(item.id || item.organizationId) === this.organizationId)
        if (!organization) throw new Error('组织管理资料不完整')
        this.organization = { ...organization, id: organization.id || this.organizationId }
        this.activities = listValue(result.activities)
        this.announcements = listValue(result.announcements)
        this.capabilities = result.capabilities || organization.capabilities || null
        this.state = 'ready'
        uni.setNavigationBarTitle({ title: `${this.organization.name || '组织'}管理` })
      } catch (error) {
        if (error.statusCode === 401) this.state = 'guest'
        else if (error.statusCode === 403 || error.statusCode === 404) this.state = 'forbidden'
        else {
          this.error = error.message || '组织管理详情加载失败'
          this.state = 'error'
        }
      }
    },
    selectOrganization(item) {
      const id = String(item?.id || item?.organizationId || '')
      if (!id || id === this.organizationId) return
      this.organizationId = id
      this.state = 'loading'
      this.loadDetail()
    },
    openPublish(type) {
      if (!this.canPublish) {
        uni.showModal({
          title: '当前账号不能发布',
          content: '请联系学校后台为当前组织补充“编辑”和“审核办理”权限。',
          showCancel: false,
          confirmColor: '#033481'
        })
        return
      }
      openPage(`/pages/chapter-publish/index?id=${encodeURIComponent(this.organizationId)}&type=${type}`)
    },
    editRecord(type, record) {
      if (!this.canEdit || !record?.id) return
      this.selectedNotice = null
      openPage(`/pages/chapter-publish/index?id=${encodeURIComponent(this.organizationId)}&type=${type}&record=${encodeURIComponent(record.id)}`)
    },
    recordStatus(record) {
      return String(record?.status || '').toLowerCase()
    },
    actionText(type, action) {
      if (action === 'publish') return type === 'announcement' ? '重新发布通知' : '重新发布活动'
      if (action === 'unpublish') return type === 'announcement' ? '下架通知' : '下架活动'
      if (action === 'close') return '关闭活动报名'
      if (action === 'complete') return '标记活动结束'
      return '更新状态'
    },
    actRecord(type, record, action) {
      if (!record?.id || this.actingId) return
      if (!this.canEdit || (action === 'publish' && !this.canPublish)) return
      const actionText = this.actionText(type, action)
      uni.showModal({
        title: `确认${actionText}？`,
        content: action === 'unpublish'
          ? '下架后该内容会立即从公开组织主页移除，之后仍可重新发布。'
          : `系统将立即执行“${actionText}”并同步组织主页。`,
        confirmText: actionText.slice(0, 6),
        confirmColor: action === 'unpublish' ? '#9A403B' : '#033481',
        success: async (result) => {
          if (!result.confirm) return
          this.actingId = record.id
          try {
            await actManagedOrganizationContent(this.organizationId, type, record.id, action)
            this.selectedNotice = null
            await this.loadDetail()
            uni.showToast({ title: `${actionText}成功`, icon: 'none' })
          } catch (error) {
            uni.showModal({ title: `${actionText}失败`, content: error.message || '请稍后重试。', showCancel: false })
          } finally {
            this.actingId = ''
          }
        }
      })
    },
    openActivity(activity) {
      if (!activity?.id) return
      if (this.recordStatus(activity) !== 'published') {
        this.editRecord('activity', activity)
        return
      }
      openPage(`/pages/event-detail/index?id=${encodeURIComponent(activity.id)}`)
    },
    openPublicHome() {
      openPage(`/pages/chapter-detail/index?id=${encodeURIComponent(this.organizationId)}`)
    },
    previewNotice(notice) {
      this.selectedNotice = notice || null
    },
    noticeSubtitle(notice) {
      return [this.formatDate(notice?.startAt || notice?.createdAt), notice?.category || '组织通知']
        .filter(Boolean)
        .join(' · ')
    },
    plainText(value) {
      return markdownToPlainText(value, { singleLine: true, maxLength: 100 })
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
    statusLabel(value) {
      return ({ draft: '草稿', pending_review: '待审核', published: '已发布', closed: '已截止', completed: '已结束', offline: '已下架', rejected: '已驳回' })[String(value || '').toLowerCase()] || value || '状态待同步'
    },
    statusTone(value) {
      const status = String(value || '').toLowerCase()
      if (['published', 'completed'].includes(status)) return 'success'
      if (['draft', 'pending_review'].includes(status)) return 'warning'
      if (['offline', 'rejected'].includes(status)) return 'danger'
      return 'neutral'
    },
    priorityLabel(value) {
      return ({ urgent: '紧急', high: '重要', normal: '普通', low: '一般' })[value] || '普通'
    },
    audienceLabel(value) {
      return ({
        all: '组织主页公开',
        alumni: '实名校友',
        campus: '在校师生',
        student: '学生',
        faculty: '教师',
        staff: '教职工',
        faculty_staff: '教师及教职工',
        member: '平台实名成员'
      })[value] || value || '受众待确认'
    }
  }
}
</script>

<style scoped>
.permission-note{margin-top:20rpx;padding:22rpx;color:#80602d;background:#f7ecd7;font-size:19rpx;line-height:1.65}.notice-detail-meta{margin-bottom:22rpx;display:flex;flex-wrap:wrap;gap:10rpx}.notice-detail-meta text{padding:7rpx 13rpx;border-radius:99rpx;color:#5c6d83;background:#edf2f7;font-size:18rpx}
.manager-record__actions{margin-top:18rpx;padding-top:16rpx;display:flex;flex-wrap:wrap;gap:10rpx;border-top:1rpx solid #edf0f4}.record-action{min-width:116rpx;height:58rpx;margin:0;padding:0 16rpx;border-radius:16rpx;color:#315b79;background:#edf3f8;font-size:17rpx;line-height:58rpx}.record-action--edit{color:#075b4c;background:#e5f1ed}.record-action--danger,.notice-action--danger{color:#963f3b;background:#f7e5e3;box-shadow:none}.notice-actions{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12rpx}.notice-actions button{width:100%;margin:0}
.chapter-manager-page{padding-top:14rpx}.manager-hero{position:relative;min-height:360rpx;padding:38rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#12374f,#07506c 58%,#176b65);box-shadow:0 23rpx 52rpx rgba(16,72,87,.2)}.manager-hero__eyebrow,.manager-hero__title,.manager-hero__desc{position:relative;z-index:2;display:block}.manager-hero__eyebrow{color:#e1c58d;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.manager-hero__title{margin-top:13rpx;font-size:39rpx;font-weight:700}.manager-hero__desc{width:540rpx;margin-top:10rpx;color:rgba(255,255,255,.64);font-size:19rpx;line-height:1.6}.manager-hero__organization{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:28rpx;padding-top:19rpx;display:flex;align-items:center;border-top:1rpx solid rgba(255,255,255,.15)}.manager-hero__organization>view:first-child{width:54rpx;height:54rpx;margin-right:13rpx;display:flex;align-items:center;justify-content:center;border-radius:18rpx;color:#765421;background:#e4ca92;font-size:17rpx;font-weight:700}.manager-hero__organization>view:last-child{min-width:0}.manager-hero__organization text{display:block}.manager-hero__organization text:first-child{overflow:hidden;color:#fff;font-size:21rpx;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.manager-hero__organization text:last-child{margin-top:3rpx;color:rgba(255,255,255,.52);font-size:16rpx}.manager-hero__mark{position:absolute;right:18rpx;top:-35rpx;color:rgba(255,255,255,.055);font-family:serif;font-size:240rpx;font-weight:700}.organization-switch{width:calc(100% + 56rpx);margin:25rpx -28rpx 0;white-space:nowrap}.organization-switch__row{padding:0 28rpx 9rpx;display:inline-flex}.organization-chip{min-width:220rpx;height:72rpx;margin-right:13rpx;padding:0 18rpx;display:flex;align-items:center;border:1rpx solid #e2e7ee;border-radius:22rpx;color:#596a80;background:#fff}.organization-chip>text:first-child{width:42rpx;height:42rpx;margin-right:10rpx;display:flex;align-items:center;justify-content:center;border-radius:14rpx;color:#fff;background:#66819a;font-size:14rpx}.organization-chip>text:last-child{min-width:0;max-width:190rpx;overflow:hidden;font-size:19rpx;text-overflow:ellipsis;white-space:nowrap}.organization-chip--active{border-color:#176551;color:#176551;background:#e8f3ef}.organization-chip--active>text:first-child{background:#176551}.manager-summary{position:relative;z-index:3;margin:-10rpx 18rpx 0;padding:22rpx;display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.manager-summary view{padding:0 10rpx;border-right:1rpx solid #e4e8ee;text-align:center}.manager-summary view:last-child{border-right:0}.manager-summary text{display:block}.manager-summary text:first-child{color:#184d54;font-family:Georgia,serif;font-size:29rpx;font-weight:700}.manager-summary text:last-child{margin-top:5rpx;color:#909aa7;font-size:16rpx}.publish-grid{margin-top:22rpx;display:grid;gap:15rpx}.publish-entry{min-height:122rpx;padding:22rpx;display:flex;align-items:center;border-radius:27rpx}.publish-entry--activity{color:#fff;background:linear-gradient(135deg,#073d83,#175b9f);box-shadow:0 15rpx 34rpx rgba(8,58,121,.18)}.publish-entry--notice{color:#fff;background:linear-gradient(135deg,#795b2c,#a27f45);box-shadow:0 15rpx 34rpx rgba(105,76,31,.17)}.publish-entry__icon{width:60rpx;height:60rpx;margin-right:15rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:20rpx;background:rgba(255,255,255,.13);font-size:19rpx;font-weight:700}.publish-entry>view:nth-child(2){min-width:0;flex:1}.publish-entry text{display:block}.publish-entry>view:nth-child(2) text:first-child{font-size:24rpx;font-weight:700}.publish-entry>view:nth-child(2) text:last-child{margin-top:5rpx;color:rgba(255,255,255,.62);font-size:17rpx}.publish-entry>text{margin-left:12rpx;font-size:38rpx}.workbench-grid{display:grid}.manager-list{display:grid;gap:16rpx}.manager-record{min-width:0;padding:23rpx}.manager-record__top{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:14rpx;color:#99a2ae;font-size:16rpx}.manager-record__top>text:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.record-status{flex-shrink:0;padding:5rpx 11rpx;border-radius:99rpx;color:#69778a;background:#edf1f5;font-size:16rpx;font-weight:650}.record-status--success{color:#176551;background:#e4f1ec}.record-status--warning{color:#856126;background:#f5e9d1}.record-status--danger{color:#97413d;background:#f7e5e3}.manager-record__title,.manager-record__meta,.manager-record__summary{display:block;min-width:0}.manager-record__title{margin-top:13rpx;color:#2c3b50;font-size:25rpx;font-weight:700;line-height:1.45;overflow-wrap:anywhere;word-break:break-all}.manager-record__meta{margin-top:7rpx;overflow:hidden;color:#8792a1;font-size:18rpx;text-overflow:ellipsis;white-space:nowrap}.manager-record__summary{margin-top:8rpx;display:-webkit-box;overflow:hidden;color:#748196;font-size:18rpx;line-height:1.6;overflow-wrap:anywhere;word-break:break-all;-webkit-box-orient:vertical;-webkit-line-clamp:2}.manager-record__foot{min-width:0;margin-top:18rpx;padding-top:16rpx;display:flex;align-items:flex-start;justify-content:space-between;gap:16rpx;border-top:1rpx solid #edf0f4;color:#8b96a5;font-size:17rpx}.manager-record__foot text{min-width:0;overflow-wrap:anywhere;word-break:break-all}.manager-record__foot text:first-child{flex:1}.manager-record__foot text:last-child{max-width:48%;flex-shrink:1;color:#345a78;text-align:right}.manager-empty{padding:28rpx;display:flex;align-items:center}.manager-empty>text{width:58rpx;height:58rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#7f602c;background:#f4e7d0;font-weight:700}.manager-empty>view{min-width:0;flex:1}.manager-empty>view text{display:block}.manager-empty>view text:first-child{color:#445469;font-size:21rpx;font-weight:650}.manager-empty>view text:last-child{margin-top:4rpx;color:#929baa;font-size:16rpx}.manager-empty button{width:150rpx;height:62rpx;margin:0 0 0 12rpx;border-radius:18rpx;font-size:19rpx;line-height:62rpx}.management-policy{margin-top:27rpx;padding:23rpx;display:flex;align-items:flex-start;border-radius:24rpx;color:#758195;background:#e9eef5}.management-policy>text{width:48rpx;height:48rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:16rpx;color:#176551;background:#dcece6;font-size:18rpx;font-weight:700}.management-policy view{min-width:0}.management-policy view text{display:block;overflow-wrap:anywhere;word-break:break-word}.management-policy view text:first-child{color:#4b5b70;font-size:20rpx;font-weight:700}.management-policy view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}.public-home-button{width:310rpx;margin:22rpx auto 0}.access-state{margin-top:20rpx;padding:80rpx 34rpx;text-align:center}.access-state__icon{width:86rpx;height:86rpx;margin:0 auto 22rpx;display:flex;align-items:center;justify-content:center;border-radius:28rpx;color:#fff;background:#176551;font-size:29rpx;font-weight:700}.access-state__title,.access-state__desc{display:block}.access-state__title{color:#334158;font-size:29rpx;font-weight:700}.access-state__desc{max-width:560rpx;margin:11rpx auto 0;color:#838e9e;font-size:20rpx;line-height:1.7;overflow-wrap:anywhere;word-break:break-word}.access-state__button{width:280rpx;margin:27rpx auto 0}
@media screen and (min-width:768px){.manager-hero{min-height:330px;padding:44px 48px;border-radius:35px}.manager-hero__eyebrow{font-size:14px}.manager-hero__title{margin-top:13px;font-size:45px}.manager-hero__desc{width:auto;max-width:750px;font-size:16px}.manager-hero__organization{left:48px;right:48px;bottom:34px}.manager-hero__organization>view:first-child{width:52px;height:52px;margin-right:14px;border-radius:16px;font-size:16px}.manager-hero__organization text:first-child{font-size:18px}.manager-hero__organization text:last-child{margin-top:4px;font-size:14px}.manager-summary{margin:-12px 34px 0;padding:24px}.manager-summary text:first-child{font-size:28px}.manager-summary text:last-child{font-size:14px}.publish-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.publish-entry{min-height:126px;padding:25px}.publish-entry__icon{width:58px;height:58px;margin-right:16px;border-radius:18px;font-size:18px}.publish-entry>view:nth-child(2) text:first-child{font-size:18px}.publish-entry>view:nth-child(2) text:last-child{margin-top:6px;font-size:14px;line-height:1.55}.publish-entry>text{font-size:30px}.workbench-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:26px}.manager-list{gap:16px}.manager-record{padding:22px}.manager-record__top,.record-status{font-size:13px}.record-status{padding:5px 10px}.manager-record__title{margin-top:12px;font-size:18px}.manager-record__meta,.manager-record__summary{font-size:14px}.manager-record__foot{margin-top:16px;padding-top:14px;gap:14px;font-size:13px}.organization-switch{width:100%;margin:24px 0 0}.organization-switch__row{padding:0 0 8px}.organization-chip{min-width:280px;height:62px;padding:0 18px;border-radius:18px}.organization-chip>text:first-child{width:38px;height:38px;margin-right:12px;border-radius:12px;font-size:13px}.organization-chip>text:last-child{max-width:250px;font-size:15px}.manager-empty{min-height:140px;padding:24px}.manager-empty>text{width:52px;height:52px;margin-right:14px;border-radius:17px;font-size:16px}.manager-empty>view text:first-child{font-size:17px}.manager-empty>view text:last-child{font-size:13px}.manager-empty button{width:112px;height:42px;margin-left:14px;border-radius:12px;font-size:14px;line-height:42px}.management-policy{padding:22px;font-size:14px}.management-policy>text{width:44px;height:44px;margin-right:14px;border-radius:14px;font-size:16px}.management-policy view text:first-child{font-size:16px}.management-policy view text:last-child{font-size:14px}.permission-note{padding:18px;font-size:14px}.notice-detail-meta text{padding:6px 11px;font-size:13px}.public-home-button{width:240px;font-size:15px}.access-state{padding:76px 40px}.access-state__icon{width:76px;height:76px;margin-bottom:20px;border-radius:24px;font-size:26px}.access-state__title{font-size:26px}.access-state__desc{max-width:680px;font-size:16px}.access-state__button{width:220px;font-size:15px}}
@media screen and (min-width:768px){.workbench-column .section-title{font-size:24px}.workbench-column .section-kicker{margin-top:6px;font-size:13px}.workbench-column .section-more{font-size:14px}}
@media screen and (min-width:768px){.manager-record__actions{margin-top:16px;padding-top:14px;gap:9px}.record-action{min-width:82px;height:38px;padding:0 13px;border-radius:11px;font-size:13px;line-height:38px}.notice-actions{gap:12px}.notice-actions button{height:46px;font-size:15px;line-height:46px}}
@media screen and (min-width:1200px){.manager-hero,.organization-switch,.manager-summary,.publish-grid,.workbench-grid,.management-policy{max-width:1120px;margin-left:auto;margin-right:auto}.manager-summary{margin-top:-12px}.workbench-grid{gap:30px}.workbench-column .section-head{margin-top:46px}}
</style>
