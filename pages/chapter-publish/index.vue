<template>
  <view class="page-shell chapter-publish-page" :class="{ 'with-sticky-action': state === 'ready' }">
    <view class="publish-hero">
      <text class="publish-hero__eyebrow">CHAPTER CONTENT STUDIO</text>
      <text class="publish-hero__title">{{ recordId ? `编辑组织${type === 'activity' ? '活动' : '通知'}` : '组织内容发布' }}</text>
      <text class="publish-hero__desc">{{ recordId ? '修改会保留原有组织归属与状态，保存后立即同步管理工作台和公开组织主页。' : '由当前组织授权管理人员发布活动或通知，提交成功后直接同步至公开组织主页。' }}</text>
      <view v-if="organization" class="publish-hero__organization">
        <view>{{ initials }}</view>
        <view>
          <text>{{ organization.name || '校友组织' }}</text>
          <text>组织编号由服务端绑定 · 发布操作全程留痕</text>
        </view>
      </view>
      <text class="publish-hero__mark">{{ type === 'activity' ? '会' : '告' }}</text>
    </view>

    <view v-if="state !== 'ready'" class="access-state surface">
      <view class="access-state__icon">{{ stateIcon }}</view>
      <text class="access-state__title">{{ stateTitle }}</text>
      <text class="access-state__desc">{{ stateDescription }}</text>
      <button v-if="state === 'guest'" class="primary-button access-state__button" @tap="open('/pages/verify/index')">去登录</button>
      <button v-else-if="state === 'forbidden'" class="secondary-button access-state__button" @tap="open('/pages/chapters/index')">返回组织列表</button>
      <button v-else-if="state === 'error'" class="secondary-button access-state__button" @tap="load">重新加载</button>
    </view>

    <template v-else>
      <view v-if="!recordId" class="publish-type-tabs surface">
        <view :class="{ 'publish-type-tab--active': type === 'activity' }" @tap="changeType('activity')">
          <text>会</text>
          <view><text>发布活动</text><text>时间、场地与报名信息</text></view>
        </view>
        <view :class="{ 'publish-type-tab--active': type === 'announcement' }" @tap="changeType('announcement')">
          <text>告</text>
          <view><text>发布通知</text><text>生效时段与受众范围</text></view>
        </view>
      </view>
      <view v-else class="edit-mode-banner surface">
        <text>{{ type === 'activity' ? '会' : '告' }}</text>
        <view><text>正在编辑{{ type === 'activity' ? '组织活动' : '组织通知' }}</text><text>组织归属与发布类型不可在编辑时改绑</text></view>
      </view>

      <template v-if="type === 'activity'">
        <view class="section-head">
          <view><text class="section-title">活动基本信息</text><text class="section-kicker">EVENT INFORMATION</text></view>
          <text class="required-note">* 必填</text>
        </view>
        <view class="editor-card editor-card--grid surface">
          <label class="form-field form-field--wide">
            <text class="form-field__label">活动名称 *</text>
            <input v-model="activity.title" maxlength="160" placeholder="请输入清晰完整的活动名称" placeholder-class="field-placeholder" />
            <text class="form-field__count">{{ activity.title.length }}/160</text>
          </label>
          <picker mode="selector" :range="activityCategoryOptions" :value="activityCategoryIndex" @change="chooseActivityCategory">
            <view class="picker-field"><view><text>活动分类 *</text><text>用于公开主页筛选与识别</text></view><text>{{ activity.category || '请选择' }} ›</text></view>
          </picker>
          <label class="form-field">
            <text class="form-field__label">活动场地 *</text>
            <input v-model="activity.venue" maxlength="200" placeholder="例如：厚生楼报告厅 / 线上会议" placeholder-class="field-placeholder" />
            <text class="form-field__count">{{ activity.venue.length }}/200</text>
          </label>
          <view class="date-time-field">
            <text class="form-field__label">开始时间 *</text>
            <view>
              <picker mode="date" :value="activity.startDate" :start="today" @change="setActivityDate('startDate', $event)"><text>{{ activity.startDate || '选择日期' }}</text></picker>
              <picker mode="time" :value="activity.startTime" @change="setActivityDate('startTime', $event)"><text>{{ activity.startTime || '选择时间' }}</text></picker>
            </view>
          </view>
          <view class="date-time-field">
            <text class="form-field__label">结束时间 *</text>
            <view>
              <picker mode="date" :value="activity.endDate" :start="activity.startDate || today" @change="setActivityDate('endDate', $event)"><text>{{ activity.endDate || '选择日期' }}</text></picker>
              <picker mode="time" :value="activity.endTime" @change="setActivityDate('endTime', $event)"><text>{{ activity.endTime || '选择时间' }}</text></picker>
            </view>
          </view>
          <view class="date-time-field">
            <text class="form-field__label">报名截止 *</text>
            <view>
              <picker mode="date" :value="activity.deadlineDate" :start="today" :end="activity.startDate || ''" @change="setActivityDate('deadlineDate', $event)"><text>{{ activity.deadlineDate || '选择日期' }}</text></picker>
              <picker mode="time" :value="activity.deadlineTime" @change="setActivityDate('deadlineTime', $event)"><text>{{ activity.deadlineTime || '选择时间' }}</text></picker>
            </view>
          </view>
          <label class="form-field">
            <text class="form-field__label">报名名额 *</text>
            <input v-model="activity.quota" type="number" maxlength="7" placeholder="0 表示不限名额" placeholder-class="field-placeholder" />
            <text class="form-field__hint">请输入 0–1,000,000 的整数。</text>
          </label>
        </view>

        <view class="section-head"><view><text class="section-title">活动介绍</text><text class="section-kicker">SUMMARY & DETAILS</text></view></view>
        <view class="editor-card surface">
          <label class="form-field form-field--textarea">
            <text class="form-field__label">活动摘要 *</text>
            <textarea v-model="activity.summary" maxlength="2000" :show-confirm-bar="false" placeholder="用 10–2000 个字概括活动亮点、对象与参与价值" placeholder-class="field-placeholder" />
            <view class="textarea-meta"><text>将展示在活动列表和组织主页</text><text>{{ activity.summary.length }}/2000</text></view>
          </label>
          <label class="form-field form-field--textarea form-field--detail">
            <text class="form-field__label">活动详情 *</text>
            <textarea v-model="activity.description" maxlength="30000" :show-confirm-bar="false" placeholder="说明活动安排、参与方式、注意事项等。支持 Markdown 标题与列表。" placeholder-class="field-placeholder" />
            <view class="textarea-meta"><text>请至少填写 20 个字</text><text>{{ activity.description.length }}/30000</text></view>
          </label>
        </view>
      </template>

      <template v-else>
        <view class="section-head">
          <view><text class="section-title">通知基本信息</text><text class="section-kicker">NOTICE INFORMATION</text></view>
          <text class="required-note">* 必填</text>
        </view>
        <view class="editor-card editor-card--grid surface">
          <label class="form-field form-field--wide">
            <text class="form-field__label">通知标题 *</text>
            <input v-model="announcement.title" maxlength="180" placeholder="请输入清晰明确的通知标题" placeholder-class="field-placeholder" />
            <text class="form-field__count">{{ announcement.title.length }}/180</text>
          </label>
          <picker mode="selector" :range="announcementCategoryOptions" :value="announcementCategoryIndex" @change="chooseAnnouncementCategory">
            <view class="picker-field"><view><text>通知分类 *</text><text>帮助成员快速识别事项</text></view><text>{{ announcement.category || '请选择' }} ›</text></view>
          </picker>
          <picker mode="selector" range-key="label" :range="audienceOptions" :value="audienceIndex" @change="chooseAudience">
            <view class="picker-field"><view><text>发布受众 *</text><text>按平台实名身份控制可见范围</text></view><text>{{ audienceLabel }} ›</text></view>
          </picker>
          <picker mode="selector" range-key="label" :range="priorityOptions" :value="priorityIndex" @change="choosePriority">
            <view class="picker-field"><view><text>通知级别 *</text><text>请按事项紧急程度选择</text></view><text>{{ priorityLabel }} ›</text></view>
          </picker>
          <view class="date-time-field">
            <text class="form-field__label">生效时间 *</text>
            <view>
              <picker mode="date" :value="announcement.startDate" :start="today" @change="setAnnouncementDate('startDate', $event)"><text>{{ announcement.startDate || '选择日期' }}</text></picker>
              <picker mode="time" :value="announcement.startTime" @change="setAnnouncementDate('startTime', $event)"><text>{{ announcement.startTime || '选择时间' }}</text></picker>
            </view>
          </view>
          <view class="date-time-field">
            <text class="form-field__label">失效时间 *</text>
            <view>
              <picker mode="date" :value="announcement.endDate" :start="announcement.startDate || today" @change="setAnnouncementDate('endDate', $event)"><text>{{ announcement.endDate || '选择日期' }}</text></picker>
              <picker mode="time" :value="announcement.endTime" @change="setAnnouncementDate('endTime', $event)"><text>{{ announcement.endTime || '选择时间' }}</text></picker>
            </view>
          </view>
        </view>

        <view class="section-head"><view><text class="section-title">通知内容</text><text class="section-kicker">SUMMARY & CONTENT</text></view></view>
        <view class="editor-card surface">
          <label class="form-field form-field--textarea">
            <text class="form-field__label">通知摘要 *</text>
            <textarea v-model="announcement.summary" maxlength="3000" :show-confirm-bar="false" placeholder="用 10–3000 个字说明通知核心事项" placeholder-class="field-placeholder" />
            <view class="textarea-meta"><text>将展示在通知卡片和组织主页</text><text>{{ announcement.summary.length }}/3000</text></view>
          </label>
          <label class="form-field form-field--textarea form-field--detail">
            <text class="form-field__label">通知正文 *</text>
            <textarea v-model="announcement.content" maxlength="30000" :show-confirm-bar="false" placeholder="完整说明事项背景、时间安排、办理方式和注意事项。支持 Markdown 排版。" placeholder-class="field-placeholder" />
            <view class="textarea-meta"><text>请至少填写 20 个字</text><text>{{ announcement.content.length }}/30000</text></view>
          </label>
        </view>
      </template>

      <view class="publish-policy">
        <text>权</text>
        <view>
          <text>发布权限与组织归属由服务端最终校验</text>
          <text>客户端提交的组织编号不会作为授权依据。新发布内容会立即公开，编辑会保留原状态；请确认时间、受众与正文准确，不要填写身份证号、密码等个人敏感信息。</text>
        </view>
      </view>
    </template>

    <SupportFooter />

    <view v-if="state === 'ready'" class="sticky-action publish-actions">
      <view><text>{{ recordId ? '编辑' : '发布' }}{{ type === 'activity' ? '组织活动' : '组织通知' }}</text><text>{{ currentDirty ? '当前内容尚未保存' : (recordId ? '内容尚未修改' : '请填写当前页签内容') }}</text></view>
      <button class="secondary-button" :disabled="submitting" @tap="cancel">取消</button>
      <button class="primary-button" :loading="submitting" :disabled="submitting || !currentDirty" @tap="confirmSubmit">{{ submitting ? (recordId ? '保存中…' : '发布中…') : (recordId ? '保存修改' : '确认发布') }}</button>
    </view>
  </view>
</template>

<script>
import {
  getMyManagedOrganization,
  publishManagedOrganizationActivity,
  publishManagedOrganizationAnnouncement,
  updateManagedOrganizationActivity,
  updateManagedOrganizationAnnouncement
} from '../../services/business'
import { getAccessToken } from '../../utils/store'
import { openPage } from '../../utils/nav'

const activityCategoryOptions = ['校友联谊', '职业发展', '行业交流', '返校活动', '公益志愿', '文体活动', '学院活动', '其他活动']
const announcementCategoryOptions = ['组织通知', '活动提醒', '会议安排', '报名通知', '服务提醒', '重要公告']
const audienceOptions = [
  { value: 'all', label: '组织主页公开展示' },
  { value: 'alumni', label: '完成实名的校友' },
  { value: 'campus', label: '在校师生及教职工' },
  { value: 'student', label: '学生' },
  { value: 'faculty', label: '教师' },
  { value: 'staff', label: '教职工' },
  { value: 'faculty_staff', label: '教师及教职工' },
  { value: 'member', label: '平台实名成员' }
]
const priorityOptions = [
  { value: 'normal', label: '普通' },
  { value: 'high', label: '重要' },
  { value: 'urgent', label: '紧急' },
  { value: 'low', label: '一般' }
]

const createActivity = () => ({
  title: '',
  category: '',
  venue: '',
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  deadlineDate: '',
  deadlineTime: '',
  quota: '0',
  summary: '',
  description: ''
})

const createAnnouncement = () => ({
  title: '',
  category: '组织通知',
  audience: 'all',
  priority: 'normal',
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  summary: '',
  content: ''
})

function detailValue(source = {}) {
  if (source?.data && (source.data.organization || source.data.activities || source.data.announcements)) return source.data
  return source || {}
}

function localDateTime(date, time) {
  if (!date || !time) return ''
  const value = new Date(`${date}T${time}:00`)
  return Number.isNaN(value.getTime()) ? '' : value.toISOString()
}

function localDateTimeParts(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return { date: '', time: '' }
  const pad = (part) => String(part).padStart(2, '0')
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
}

function trimmed(value) {
  return String(value || '').trim()
}

export default {
  data() {
    return {
      state: 'loading',
      organizationId: '',
      recordId: '',
      recordRevision: null,
      organization: null,
      capabilities: null,
      type: 'activity',
      activityCategoryOptions,
      announcementCategoryOptions,
      audienceOptions,
      priorityOptions,
      activity: createActivity(),
      announcement: createAnnouncement(),
      initialActivitySnapshot: '',
      initialAnnouncementSnapshot: '',
      submitting: false,
      allowBack: false,
      leaveProtectionActive: false,
      beforeUnloadHandler: null,
      error: ''
    }
  },
  computed: {
    initials() {
      return String(this.organization?.initials || this.organization?.name || '湖财').slice(0, 2)
    },
    today() {
      const date = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    },
    activityCategoryIndex() {
      return Math.max(0, this.activityCategoryOptions.indexOf(this.activity.category))
    },
    announcementCategoryIndex() {
      return Math.max(0, this.announcementCategoryOptions.indexOf(this.announcement.category))
    },
    audienceIndex() {
      return Math.max(0, this.audienceOptions.findIndex((item) => item.value === this.announcement.audience))
    },
    priorityIndex() {
      return Math.max(0, this.priorityOptions.findIndex((item) => item.value === this.announcement.priority))
    },
    audienceLabel() {
      return this.audienceOptions[this.audienceIndex]?.label || '请选择'
    },
    priorityLabel() {
      return this.priorityOptions[this.priorityIndex]?.label || '请选择'
    },
    activitySnapshot() {
      return JSON.stringify({
        title: trimmed(this.activity.title),
        category: this.activity.category,
        venue: trimmed(this.activity.venue),
        startDate: this.activity.startDate,
        startTime: this.activity.startTime,
        endDate: this.activity.endDate,
        endTime: this.activity.endTime,
        deadlineDate: this.activity.deadlineDate,
        deadlineTime: this.activity.deadlineTime,
        quota: String(this.activity.quota),
        summary: trimmed(this.activity.summary),
        description: trimmed(this.activity.description)
      })
    },
    announcementSnapshot() {
      return JSON.stringify({
        title: trimmed(this.announcement.title),
        category: this.announcement.category,
        audience: this.announcement.audience,
        priority: this.announcement.priority,
        startDate: this.announcement.startDate,
        startTime: this.announcement.startTime,
        endDate: this.announcement.endDate,
        endTime: this.announcement.endTime,
        summary: trimmed(this.announcement.summary),
        content: trimmed(this.announcement.content)
      })
    },
    currentDirty() {
      return this.type === 'activity'
        ? this.activitySnapshot !== this.initialActivitySnapshot
        : this.announcementSnapshot !== this.initialAnnouncementSnapshot
    },
    dirty() {
      return this.activitySnapshot !== this.initialActivitySnapshot
        || this.announcementSnapshot !== this.initialAnnouncementSnapshot
    },
    stateIcon() {
      return ({ loading: '…', guest: '登', forbidden: '权', error: '!' })[this.state] || '发'
    },
    stateTitle() {
      return ({
        loading: '正在核验组织发布权限',
        guest: '登录后才能发布组织内容',
        forbidden: '当前账号没有此组织发布权限',
        error: '组织发布编辑器暂时无法加载'
      })[this.state] || '组织内容发布'
    },
    stateDescription() {
      return ({
        loading: '系统正在核验当前账号的组织委派、编辑与审核权限。',
        guest: '请先登录平台账号，再由服务端核验组织管理委派。',
        forbidden: '只有同时拥有当前组织编辑与审核权限的有效管理人员才能直接发布。',
        error: this.error || '请检查网络后重试。'
      })[this.state] || ''
    }
  },
  watch: {
    dirty(value) {
      this.syncLeaveProtection(value)
    },
    state() {
      this.syncLeaveProtection(this.dirty)
    }
  },
  onLoad(options = {}) {
    this.organizationId = String(options.id || '')
    this.recordId = String(options.record || '')
    this.type = options.type === 'announcement' ? 'announcement' : 'activity'
    this.resetSnapshots()
    this.load()
  },
  onBackPress() {
    if (!this.dirty || this.allowBack || this.state !== 'ready') return false
    uni.showModal({
      title: '有尚未发布的组织内容',
      content: '离开后当前填写内容会丢失，确定直接返回吗？',
      confirmText: '直接离开',
      confirmColor: '#9A403B',
      success: (result) => {
        if (!result.confirm) return
        this.allowBack = true
        this.syncLeaveProtection(false)
        uni.navigateBack()
      }
    })
    return true
  },
  onShow() {
    this.syncLeaveProtection(this.dirty)
  },
  onUnload() {
    this.syncLeaveProtection(false)
  },
  methods: {
    open(url) { openPage(url) },
    resetSnapshots(type = '') {
      if (!type || type === 'activity') this.initialActivitySnapshot = this.activitySnapshot
      if (!type || type === 'announcement') this.initialAnnouncementSnapshot = this.announcementSnapshot
    },
    syncLeaveProtection(requested) {
      const active = Boolean(requested && this.state === 'ready' && !this.allowBack)
      if (active === this.leaveProtectionActive) return
      this.leaveProtectionActive = active
      const message = '当前组织内容尚未保存，确定离开吗？'
      // #ifdef H5
      if (active) {
        if (!this.beforeUnloadHandler) {
          this.beforeUnloadHandler = (event) => {
            if (!this.dirty || this.allowBack) return undefined
            event.preventDefault()
            event.returnValue = message
            return message
          }
        }
        window.addEventListener('beforeunload', this.beforeUnloadHandler)
      } else if (this.beforeUnloadHandler) {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler)
      }
      // #endif
      // #ifdef MP-WEIXIN
      if (typeof wx !== 'undefined') {
        if (active && typeof wx.enableAlertBeforeUnload === 'function') {
          wx.enableAlertBeforeUnload({ message })
        } else if (!active && typeof wx.disableAlertBeforeUnload === 'function') {
          wx.disableAlertBeforeUnload()
        }
      }
      // #endif
      // #ifdef MP-ALIPAY
      if (typeof my !== 'undefined') {
        if (active && typeof my.enableAlertBeforeUnload === 'function') {
          my.enableAlertBeforeUnload({ message })
        } else if (!active && typeof my.disableAlertBeforeUnload === 'function') {
          my.disableAlertBeforeUnload()
        }
      }
      // #endif
    },
    async load() {
      this.error = ''
      if (!getAccessToken()) {
        this.state = 'guest'
        return
      }
      if (!this.organizationId) {
        this.state = 'forbidden'
        return
      }
      this.state = 'loading'
      try {
        const result = detailValue(await getMyManagedOrganization(this.organizationId))
        if (!result.organization) throw new Error('组织管理资料不完整')
        this.organization = result.organization
        this.capabilities = result.capabilities || result.organization.capabilities || null
        const canEdit = this.capabilities?.update === true && this.capabilities?.moderate === true
        const canPublish = this.capabilities && Object.prototype.hasOwnProperty.call(this.capabilities, 'publish')
          ? this.capabilities.publish === true
          : canEdit
        if ((this.recordId && !canEdit) || (!this.recordId && !canPublish)) {
          this.state = 'forbidden'
          return
        }
        if (this.recordId) {
          const records = this.type === 'activity'
            ? (Array.isArray(result.activities) ? result.activities : [])
            : (Array.isArray(result.announcements) ? result.announcements : [])
          const record = records.find((item) => String(item.id) === this.recordId)
          if (!record) {
            this.error = '要编辑的组织内容不存在或已不属于当前组织'
            this.state = 'forbidden'
            return
          }
          if (this.type === 'activity') this.hydrateActivity(record)
          else this.hydrateAnnouncement(record)
        }
        this.state = 'ready'
        this.resetSnapshots()
        uni.setNavigationBarTitle({ title: `${this.organization.name || '组织'}${this.recordId ? '编辑' : '发布'}` })
      } catch (error) {
        if (error.statusCode === 401) this.state = 'guest'
        else if (error.statusCode === 403 || error.statusCode === 404) this.state = 'forbidden'
        else {
          this.error = error.message || '组织发布权限核验失败'
          this.state = 'error'
        }
      }
    },
    changeType(type) {
      if (this.submitting || this.recordId || type === this.type) return
      this.type = type
      uni.setNavigationBarTitle({ title: `${this.organization?.name || '组织'}${type === 'activity' ? '活动' : '通知'}发布` })
    },
    hydrateActivity(record) {
      this.recordRevision = Number(record.revision || 0) || null
      const start = localDateTimeParts(record.startAt)
      const end = localDateTimeParts(record.endAt)
      const deadline = localDateTimeParts(record.registrationDeadline)
      this.activity = {
        title: String(record.title || ''),
        category: String(record.category || ''),
        venue: String(record.venue || ''),
        startDate: start.date,
        startTime: start.time,
        endDate: end.date,
        endTime: end.time,
        deadlineDate: deadline.date,
        deadlineTime: deadline.time,
        quota: String(Number(record.quota || 0)),
        summary: String(record.summary || ''),
        description: String(record.description || '')
      }
    },
    hydrateAnnouncement(record) {
      this.recordRevision = Number(record.revision || 0) || null
      const start = localDateTimeParts(record.startAt)
      const end = localDateTimeParts(record.endAt)
      this.announcement = {
        title: String(record.title || ''),
        category: String(record.category || '组织通知'),
        audience: String(record.audience || 'all'),
        priority: String(record.priority || 'normal'),
        startDate: start.date,
        startTime: start.time,
        endDate: end.date,
        endTime: end.time,
        summary: String(record.summary || ''),
        content: String(record.content || '')
      }
    },
    chooseActivityCategory(event) {
      this.activity.category = this.activityCategoryOptions[Number(event.detail.value)] || ''
    },
    chooseAnnouncementCategory(event) {
      this.announcement.category = this.announcementCategoryOptions[Number(event.detail.value)] || ''
    },
    chooseAudience(event) {
      this.announcement.audience = this.audienceOptions[Number(event.detail.value)]?.value || 'all'
    },
    choosePriority(event) {
      this.announcement.priority = this.priorityOptions[Number(event.detail.value)]?.value || 'normal'
    },
    setActivityDate(field, event) {
      this.activity[field] = event.detail.value
    },
    setAnnouncementDate(field, event) {
      this.announcement[field] = event.detail.value
    },
    activityPayload() {
      return {
        title: trimmed(this.activity.title),
        category: this.activity.category,
        venue: trimmed(this.activity.venue),
        startAt: localDateTime(this.activity.startDate, this.activity.startTime),
        endAt: localDateTime(this.activity.endDate, this.activity.endTime),
        registrationDeadline: localDateTime(this.activity.deadlineDate, this.activity.deadlineTime),
        quota: Number(this.activity.quota),
        summary: trimmed(this.activity.summary),
        description: trimmed(this.activity.description)
      }
    },
    announcementPayload() {
      return {
        title: trimmed(this.announcement.title),
        category: this.announcement.category,
        audience: this.announcement.audience,
        priority: this.announcement.priority,
        startAt: localDateTime(this.announcement.startDate, this.announcement.startTime),
        endAt: localDateTime(this.announcement.endDate, this.announcement.endTime),
        summary: trimmed(this.announcement.summary),
        content: trimmed(this.announcement.content)
      }
    },
    validateActivity() {
      const payload = this.activityPayload()
      if (payload.title.length < 4) return '活动名称至少填写 4 个字'
      if (!payload.category || payload.category.length > 50) return '请选择有效的活动分类'
      if (payload.venue.length < 2) return '活动场地至少填写 2 个字'
      if (!payload.startAt) return '请选择完整的活动开始时间'
      if (!payload.endAt) return '请选择完整的活动结束时间'
      if (!payload.registrationDeadline) return '请选择完整的报名截止时间'
      const startAt = Date.parse(payload.startAt)
      const endAt = Date.parse(payload.endAt)
      const deadline = Date.parse(payload.registrationDeadline)
      if (!this.recordId && startAt <= Date.now()) return '活动开始时间必须晚于当前时间'
      if (endAt <= startAt) return '活动结束时间必须晚于开始时间'
      if (deadline > startAt) return '报名截止时间不能晚于活动开始时间'
      if (!this.recordId && deadline <= Date.now()) return '报名截止时间必须晚于当前时间'
      if (!Number.isInteger(payload.quota) || payload.quota < 0 || payload.quota > 1000000) return '报名名额请输入 0–1,000,000 的整数'
      if (payload.summary.length < 10) return '活动摘要至少填写 10 个字'
      if (payload.description.length < 20) return '活动详情至少填写 20 个字'
      return ''
    },
    validateAnnouncement() {
      const payload = this.announcementPayload()
      if (payload.title.length < 4) return '通知标题至少填写 4 个字'
      if (!payload.category || payload.category.length > 60) return '请选择有效的通知分类'
      if (!this.audienceOptions.some((item) => item.value === payload.audience)) return '请选择有效的发布受众'
      if (!this.priorityOptions.some((item) => item.value === payload.priority)) return '请选择有效的通知级别'
      if (!payload.startAt) return '请选择完整的通知生效时间'
      if (!payload.endAt) return '请选择完整的通知失效时间'
      if (Date.parse(payload.endAt) <= Date.parse(payload.startAt)) return '通知失效时间必须晚于生效时间'
      if (Date.parse(payload.endAt) <= Date.now()) return '通知失效时间必须晚于当前时间'
      if (payload.summary.length < 10) return '通知摘要至少填写 10 个字'
      if (payload.content.length < 20) return '通知正文至少填写 20 个字'
      return ''
    },
    confirmSubmit() {
      if (this.submitting) return
      const message = this.type === 'activity' ? this.validateActivity() : this.validateAnnouncement()
      if (message) {
        uni.showToast({ title: message, icon: 'none' })
        return
      }
      uni.showModal({
        title: `${this.recordId ? '确认保存' : '确认发布'}${this.type === 'activity' ? '活动' : '通知'}？`,
        content: this.recordId
          ? `修改会保留“${this.organization?.name || '当前组织'}”归属和当前发布状态，并同步管理工作台。`
          : `内容将以“${this.organization?.name || '当前组织'}”名义立即公开，并同步至组织主页。`,
        confirmText: this.recordId ? '保存修改' : '确认发布',
        confirmColor: '#033481',
        success: (result) => {
          if (result.confirm) this.submit()
        }
      })
    },
    async submit() {
      if (this.submitting) return
      this.submitting = true
      try {
        const publishedType = this.type
        if (this.type === 'activity') {
          if (this.recordId) {
            await updateManagedOrganizationActivity(this.organizationId, this.recordId, {
              ...this.activityPayload(),
              expectedRevision: this.recordRevision
            })
          } else {
            await publishManagedOrganizationActivity(this.organizationId, this.activityPayload())
            this.activity = createActivity()
          }
          this.resetSnapshots('activity')
        } else {
          if (this.recordId) {
            await updateManagedOrganizationAnnouncement(this.organizationId, this.recordId, {
              ...this.announcementPayload(),
              expectedRevision: this.recordRevision
            })
          } else {
            await publishManagedOrganizationAnnouncement(this.organizationId, this.announcementPayload())
            this.announcement = createAnnouncement()
          }
          this.resetSnapshots('announcement')
        }
        const hasOtherDraft = !this.recordId && (publishedType === 'activity'
          ? this.announcementSnapshot !== this.initialAnnouncementSnapshot
          : this.activitySnapshot !== this.initialActivitySnapshot)
        uni.showModal({
          title: this.recordId ? '保存成功' : '发布成功',
          content: hasOtherDraft
            ? `${publishedType === 'activity' ? '活动' : '通知'}已同步至公开组织主页；另一页签的草稿仍保留，可继续完善并发布。`
            : this.recordId
              ? `${publishedType === 'activity' ? '活动' : '通知'}修改已保存，当前状态保持不变。`
              : `${publishedType === 'activity' ? '活动' : '通知'}已同步至公开组织主页，可返回工作台继续管理。`,
          showCancel: false,
          confirmText: hasOtherDraft ? '继续编辑' : '返回工作台',
          confirmColor: '#033481',
          success: () => {
            if (hasOtherDraft) {
              this.changeType(publishedType === 'activity' ? 'announcement' : 'activity')
              return
            }
            this.allowBack = true
            this.syncLeaveProtection(false)
            this.returnToWorkbench()
          }
        })
      } catch (error) {
        if (error.statusCode === 401) this.state = 'guest'
        else if (error.statusCode === 403 || error.statusCode === 404) this.state = 'forbidden'
        uni.showModal({
          title: '发布失败',
          content: error.message || '请检查内容和网络后重试。',
          showCancel: false,
          confirmColor: '#033481'
        })
      } finally {
        this.submitting = false
      }
    },
    cancel() {
      if (!this.dirty) {
        this.allowBack = true
        this.syncLeaveProtection(false)
        this.returnToWorkbench()
        return
      }
      uni.showModal({
        title: '放弃本次填写？',
        content: '离开后尚未发布的活动或通知内容会丢失。',
        confirmText: '放弃填写',
        confirmColor: '#9A403B',
        success: (result) => {
          if (!result.confirm) return
          this.allowBack = true
          this.syncLeaveProtection(false)
          this.returnToWorkbench()
        }
      })
    },
    returnToWorkbench() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      const previous = pages.length > 1 ? pages[pages.length - 2] : null
      const previousRoute = String(previous?.route || previous?.$page?.fullPath || '')
      if (previousRoute.includes('pages/chapter-manager/index')) {
        uni.navigateBack({
          delta: 1,
          fail: () => uni.redirectTo({
            url: `/pages/chapter-manager/index?id=${encodeURIComponent(this.organizationId)}`
          })
        })
        return
      }
      uni.redirectTo({
        url: `/pages/chapter-manager/index?id=${encodeURIComponent(this.organizationId)}`
      })
    }
  }
}
</script>

<style scoped>
.chapter-publish-page{padding-top:14rpx}.publish-hero{position:relative;min-height:350rpx;padding:38rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#102e57,#073e82 58%,#145c9a);box-shadow:0 23rpx 52rpx rgba(9,55,119,.2)}.publish-hero__eyebrow,.publish-hero__title,.publish-hero__desc{position:relative;z-index:2;display:block}.publish-hero__eyebrow{color:#e3c98f;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.publish-hero__title{margin-top:13rpx;font-size:40rpx;font-weight:700}.publish-hero__desc{width:540rpx;margin-top:10rpx;color:rgba(255,255,255,.64);font-size:19rpx;line-height:1.65}.publish-hero__organization{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:27rpx;padding-top:18rpx;display:flex;align-items:center;border-top:1rpx solid rgba(255,255,255,.15)}.publish-hero__organization>view:first-child{width:56rpx;height:56rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:18rpx;color:#70501f;background:#e4ca92;font-size:17rpx;font-weight:700}.publish-hero__organization>view:last-child{min-width:0}.publish-hero__organization text{display:block}.publish-hero__organization text:first-child{overflow:hidden;color:#fff;font-size:21rpx;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.publish-hero__organization text:last-child{margin-top:3rpx;color:rgba(255,255,255,.5);font-size:16rpx}.publish-hero__mark{position:absolute;right:19rpx;top:-38rpx;color:rgba(255,255,255,.055);font-family:serif;font-size:250rpx;font-weight:700}.access-state{margin-top:22rpx;padding:80rpx 34rpx;text-align:center}.access-state__icon{width:86rpx;height:86rpx;margin:0 auto 22rpx;display:flex;align-items:center;justify-content:center;border-radius:28rpx;color:#fff;background:#083f83;font-size:29rpx;font-weight:700}.access-state__title,.access-state__desc{display:block}.access-state__title{color:#334158;font-size:29rpx;font-weight:700}.access-state__desc{max-width:560rpx;margin:11rpx auto 0;color:#838e9e;font-size:20rpx;line-height:1.7}.access-state__button{width:280rpx;margin:27rpx auto 0}.publish-type-tabs{position:relative;z-index:3;margin:-9rpx 18rpx 0;padding:11rpx;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9rpx}.publish-type-tabs>view{min-width:0;height:94rpx;padding:14rpx 16rpx;display:flex;align-items:center;border-radius:22rpx;color:#69778a;background:#f4f6f9}.publish-type-tabs>view>text{width:51rpx;height:51rpx;margin-right:12rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#6d7c91;background:#e4e8ee;font-size:18rpx;font-weight:700}.publish-type-tabs>view>view{min-width:0}.publish-type-tabs>view>view text{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.publish-type-tabs>view>view text:first-child{color:#48586e;font-size:20rpx;font-weight:700}.publish-type-tabs>view>view text:last-child{margin-top:3rpx;color:#99a2af;font-size:15rpx}.publish-type-tabs .publish-type-tab--active{color:#fff;background:#0a4389}.publish-type-tabs .publish-type-tab--active>text{color:#7b5925;background:#e8cf99}.publish-type-tabs .publish-type-tab--active>view text:first-child{color:#fff}.publish-type-tabs .publish-type-tab--active>view text:last-child{color:rgba(255,255,255,.58)}.required-note{color:#9a443f;font-size:18rpx}.editor-card{padding:0 27rpx}.editor-card--grid{display:grid}.form-field,.date-time-field,.picker-field{position:relative;min-height:108rpx;padding:23rpx 0;display:block;border-bottom:1rpx solid #edf0f4}.form-field:last-child,.date-time-field:last-child,.picker-field:last-child{border-bottom:0}.form-field__label{display:block;color:#455368;font-size:22rpx;font-weight:650}.form-field input{width:100%;height:68rpx;margin-top:5rpx;padding-right:84rpx;color:#27354a;font-size:23rpx}.form-field__count{position:absolute;right:0;top:66rpx;color:#9da6b2;font-size:16rpx}.form-field__hint{display:block;margin-top:4rpx;color:#929caa;font-size:16rpx}.field-placeholder{color:#adb5c0}.picker-field{display:flex;align-items:center}.picker-field>view{min-width:0;flex:1}.picker-field>view text{display:block}.picker-field>view text:first-child{color:#455368;font-size:22rpx;font-weight:650}.picker-field>view text:last-child{margin-top:5rpx;color:#99a2ae;font-size:16rpx}.picker-field>text{max-width:240rpx;margin-left:18rpx;color:#094483;font-size:20rpx;font-weight:650}.date-time-field>view{margin-top:13rpx;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11rpx}.date-time-field picker{min-width:0}.date-time-field picker text{height:62rpx;padding:0 14rpx;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:17rpx;color:#38536f;background:#edf2f7;font-size:18rpx;text-overflow:ellipsis;white-space:nowrap}.form-field--textarea{padding:25rpx 0}.form-field--textarea textarea{width:100%;height:245rpx;margin-top:13rpx;color:#27354a;font-size:23rpx;line-height:1.75}.form-field--detail textarea{height:380rpx}.textarea-meta{padding-top:12rpx;display:flex;justify-content:space-between;gap:18rpx;border-top:1rpx solid #edf0f4;color:#98a1ad;font-size:16rpx}.textarea-meta text:first-child{flex:1}.publish-policy{margin-top:24rpx;padding:23rpx;display:flex;align-items:flex-start;border-radius:24rpx;color:#758195;background:#e9eef5}.publish-policy>text{width:49rpx;height:49rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:16rpx;color:#176551;background:#dcece6;font-size:18rpx;font-weight:700}.publish-policy view text{display:block}.publish-policy view text:first-child{color:#4b5b70;font-size:20rpx;font-weight:700}.publish-policy view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}.publish-actions{display:flex;align-items:center;gap:12rpx}.publish-actions>view{min-width:0;flex:1}.publish-actions>view text{display:block}.publish-actions>view text:first-child{color:#2f3e53;font-size:19rpx;font-weight:700}.publish-actions>view text:last-child{margin-top:3rpx;color:#949eac;font-size:15rpx}.publish-actions button{width:174rpx;margin:0}.publish-actions .secondary-button{width:130rpx}.publish-actions button[disabled]{opacity:.5}
.publish-hero__desc,.access-state__title,.access-state__desc,.publish-policy view text,.publish-actions>view text{overflow-wrap:anywhere}
.editor-card,.editor-card--grid>*{min-width:0}
.picker-field>text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.publish-policy>view{min-width:0}
.edit-mode-banner{position:relative;z-index:3;margin:-9rpx 18rpx 0;padding:22rpx;display:flex;align-items:center}.edit-mode-banner>text{width:55rpx;height:55rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:18rpx;color:#fff;background:#0a4389;font-size:19rpx;font-weight:700}.edit-mode-banner>view{min-width:0}.edit-mode-banner>view text{display:block;overflow-wrap:anywhere}.edit-mode-banner>view text:first-child{color:#31425a;font-size:21rpx;font-weight:700}.edit-mode-banner>view text:last-child{margin-top:4rpx;color:#909aa8;font-size:17rpx}
@media screen and (min-width:768px){.publish-hero{min-height:330px;padding:44px 48px;border-radius:35px}.publish-hero__eyebrow{font-size:14px}.publish-hero__title{margin-top:13px;font-size:45px}.publish-hero__desc{width:auto;max-width:750px;font-size:16px}.publish-hero__organization{left:48px;right:48px;bottom:34px}.publish-type-tabs{max-width:850px;margin:-13px auto 0;padding:12px;gap:12px}.publish-type-tabs>view{height:92px;padding:18px 22px}.editor-card--grid{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:32px}.editor-card--grid>*:nth-child(odd){padding-right:0}.form-field--wide{grid-column:1/-1}.editor-card--grid .form-field--wide{border-bottom:1px solid #edf0f4}.form-field,.date-time-field,.picker-field{min-height:112px;padding:22px 0}.editor-card--grid>*:last-child{border-bottom:0}.form-field--textarea textarea{height:250px}.form-field--detail textarea{height:390px}.publish-actions{max-width:1120px;left:50%;right:auto;width:calc(100% - 64px);transform:translateX(-50%)}}
@media screen and (min-width:768px){
  .chapter-publish-page .section-title{font-size:22px}
  .chapter-publish-page .section-kicker{margin-top:5px;font-size:12px}
  .required-note{font-size:13px}
  .publish-hero__organization text:first-child{font-size:16px}
  .publish-hero__organization text:last-child{font-size:13px}
  .access-state__title{font-size:22px}
  .access-state__desc{font-size:15px}
  .publish-type-tabs>view>view text:first-child{font-size:16px}
  .publish-type-tabs>view>view text:last-child{font-size:13px}
  .edit-mode-banner{max-width:850px;margin:-13px auto 0;padding:18px 22px}.edit-mode-banner>text{width:48px;height:48px;margin-right:14px;border-radius:15px;font-size:16px}.edit-mode-banner>view text:first-child{font-size:16px}.edit-mode-banner>view text:last-child{font-size:13px}
  .form-field__label,.picker-field>view text:first-child{font-size:16px}
  .form-field input,.form-field--textarea textarea{font-size:16px}
  .form-field__count,.form-field__hint,.picker-field>view text:last-child,.textarea-meta{font-size:13px}
  .picker-field>text{font-size:15px}
  .date-time-field picker text{font-size:14px}
  .publish-policy view text:first-child{font-size:15px}
  .publish-policy view text:last-child{font-size:14px}
  .publish-actions>view text:first-child{font-size:15px}
  .publish-actions>view text:last-child{font-size:13px}
  .publish-actions button{height:50px;font-size:15px;line-height:50px}
}
@media screen and (min-width:1200px){.publish-hero,.section-head,.editor-card,.publish-policy{max-width:1120px;margin-left:auto;margin-right:auto}.publish-type-tabs{max-width:900px}.editor-card{padding:0 34px}.editor-card--grid{column-gap:46px}.form-field--textarea{padding:28px 0}.publish-policy{padding:24px 28px}}
</style>
