<template>
  <view class="page-shell mentor-profile-page" :class="{ 'with-sticky-action': state === 'ready' }">
    <view class="profile-hero">
      <text class="profile-hero__eyebrow">MENTOR PROFILE CENTER</text>
      <text class="profile-hero__title">我的导师资料</text>
      <text class="profile-hero__desc">已认证导师可维护本人职业资料、辅导主题和可约安排，公开状态仍由学校后台统一管理。</text>
      <view class="profile-hero__identity">
        <text>{{ user.realName || '湖财人' }}</text>
        <text>{{ user.department || '湖南财政经济学院' }}</text>
      </view>
      <text class="profile-hero__watermark">师</text>
    </view>

    <view v-if="state === 'loading'" class="state-card surface">
      <view class="state-card__icon state-card__icon--loading">…</view>
      <text class="state-card__title">正在核验导师维护资格</text>
      <text class="state-card__desc">系统将核对当前登录账号、学校实名状态和导师档案绑定关系。</text>
    </view>

    <view v-else-if="state === 'guest'" class="state-card surface">
      <view class="state-card__icon">登</view>
      <text class="state-card__title">请先登录湖财人账号</text>
      <text class="state-card__desc">导师资料只能由本人通过学校实名账号维护。日常登录使用湖财人平台用户名和密码。</text>
      <button class="primary-button state-card__button" @tap="openLogin">去登录</button>
    </view>

    <view v-else-if="state === 'unverified'" class="state-card surface">
      <view class="state-card__icon state-card__icon--warning">验</view>
      <text class="state-card__title">当前账号未通过学校实名</text>
      <text class="state-card__desc">{{ unverifiedDescription }}</text>
      <button class="primary-button state-card__button" @tap="openRegistration">了解实名注册</button>
      <button class="ghost-button state-card__secondary" @tap="openLogin">查看当前账号</button>
    </view>

    <view v-else-if="state === 'ineligible'" class="state-card surface">
      <view class="state-card__icon state-card__icon--warning">师</view>
      <text class="state-card__title">暂未开通导师资料维护</text>
      <text class="state-card__desc">{{ eligibilityDescription }}</text>
      <view class="eligibility-steps">
        <view><text>1</text><text>学校后台建立导师档案</text></view>
        <view><text>2</text><text>绑定本人学校实名账号</text></view>
        <view><text>3</text><text>导师资格核验通过后开放维护</text></view>
      </view>
      <button class="secondary-button state-card__button" @tap="openMentors">查看导师计划</button>
    </view>

    <view v-else-if="state === 'error'" class="state-card surface">
      <view class="state-card__icon state-card__icon--error">!</view>
      <text class="state-card__title">导师资料暂时无法加载</text>
      <text class="state-card__desc">{{ error || '请检查网络后重试。' }}</text>
      <button class="secondary-button state-card__button" @tap="loadState">重新加载</button>
    </view>

    <template v-else-if="state === 'ready'">
      <view class="profile-status surface">
        <view class="profile-status__badge" :class="`profile-status__badge--${statusTone}`">{{ statusShort }}</view>
        <view class="profile-status__copy">
          <text>{{ statusLabel }}</text>
          <text>{{ statusDescription }}</text>
        </view>
        <text class="profile-status__qualification">✓ 导师资格已认证</text>
        <text class="profile-status__revision">版本 {{ revision || 1 }}</text>
      </view>

      <view class="section-head">
        <view><text class="section-title">公开资料</text><text class="section-kicker">PUBLIC MENTOR PROFILE</text></view>
        <text class="verified-tag">✓ 本人维护</text>
      </view>

      <view class="form-section surface">
        <view class="readonly-row">
          <view><text>导师姓名</text><text>来自学校实名资料，不可修改</text></view>
          <text>{{ user.realName || profile.name || '—' }}</text>
        </view>
        <view class="readonly-row">
          <view><text>学院 / 部门</text><text>由当前学校实名账号绑定</text></view>
          <text>{{ user.department || profile.department || '—' }}</text>
        </view>
        <label class="field-block">
          <text class="field-block__label">职务 / 身份 <text>*</text></text>
          <input v-model.trim="form.title" maxlength="60" placeholder="例如：产品总监、创业者、行业专家" placeholder-class="field-placeholder" />
          <text class="field-block__count">{{ form.title.length }}/60</text>
        </label>
        <label class="field-block">
          <text class="field-block__label">工作单位 <text>*</text></text>
          <input v-model.trim="form.company" maxlength="100" placeholder="请输入当前工作单位或机构" placeholder-class="field-placeholder" />
          <text class="field-block__count">{{ form.company.length }}/100</text>
        </label>
        <label class="field-block">
          <text class="field-block__label">本期可约名额 <text>*</text></text>
          <input v-model="form.availableSlots" type="number" maxlength="3" placeholder="请输入 0–999 的整数" placeholder-class="field-placeholder" />
          <text class="field-block__hint">填写 0 表示本期暂不接受新的咨询申请。</text>
        </label>
        <label class="field-block">
          <text class="field-block__label">辅导主题 <text>*</text></text>
          <input v-model="form.topicsText" maxlength="180" placeholder="多个主题请用逗号分隔" placeholder-class="field-placeholder" />
          <view v-if="topicPreview.length" class="topic-preview"><text v-for="topic in topicPreview" :key="topic">{{ topic }}</text></view>
          <text class="field-block__hint">最多 8 个主题，每个不超过 20 个字，例如：职业规划、产品管理、创业交流。</text>
        </label>
      </view>

      <view class="section-head">
        <view><text class="section-title">介绍与安排</text><text class="section-kicker">BIO & AVAILABILITY</text></view>
      </view>
      <view class="form-section surface">
        <label class="field-block field-block--textarea">
          <text class="field-block__label">导师简介 <text>*</text></text>
          <textarea v-model="form.bio" maxlength="12000" :show-confirm-bar="false" placeholder="介绍职业经历、专业方向和能够提供的帮助。支持 Markdown 标题、列表与链接。" placeholder-class="field-placeholder" />
          <view class="textarea-meta"><text>请勿填写私人手机号、身份证号等敏感信息</text><text>{{ form.bio.length }}/12000</text></view>
        </label>
        <label class="field-block field-block--textarea">
          <text class="field-block__label">可约时间说明</text>
          <textarea v-model="form.availability" maxlength="4000" :show-confirm-bar="false" placeholder="例如：每月第二个周六线上交流，具体时间由平台工作人员协调。" placeholder-class="field-placeholder" />
          <view class="textarea-meta"><text>可说明交流方式与时间范围</text><text>{{ form.availability.length }}/4000</text></view>
        </label>
      </view>

      <view class="review-note">
        <text class="review-note__icon">记</text>
        <view><text>本人修改全程留痕</text><text>保存后更新本人导师档案；只有后台已发布的资料会在导师列表展示。系统不会公开您的登录账号或联系方式，管理员可在审计记录中核对修改来源。</text></view>
      </view>
    </template>

    <SupportFooter />

    <view v-if="state === 'ready'" class="sticky-action profile-actions">
      <view class="profile-actions__copy"><text>{{ dirty ? '有尚未保存的修改' : '当前资料已同步' }}</text><text>{{ dirty ? '离开前请保存' : '可继续完善后再次提交' }}</text></view>
      <button class="primary-button profile-actions__button" :loading="saving" :disabled="saving || !dirty" @tap="saveProfile">{{ saving ? '保存中' : '保存资料' }}</button>
    </view>
  </view>
</template>

<script>
import { getMyMentorProfile, saveMyMentorProfile } from '../../services/business'
import { refreshPlatformProfile } from '../../services/schoolAuth'
import { getAccessToken, getUser, isSchoolVerified, isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

const emptyForm = () => ({
  title: '',
  company: '',
  availableSlots: '0',
  topicsText: '',
  bio: '',
  availability: ''
})

const statusLabels = {
  draft: '资料草稿',
  pending_review: '等待后台审核',
  published: '已审核发布',
  rejected: '审核未通过',
  offline: '资料已下架'
}

export default {
  data() {
    return {
      state: 'loading',
      user: {},
      profile: {},
      qualificationStatus: '',
      error: '',
      form: emptyForm(),
      initialSnapshot: '',
      revision: 0,
      saving: false,
      allowBack: false
    }
  },
  computed: {
    normalizedTopics() {
      return this.form.topicsText
        .split(/[,，]/)
        .map((topic) => topic.trim())
        .filter(Boolean)
    },
    topicPreview() {
      return this.normalizedTopics.slice(0, 8)
    },
    snapshot() {
      return JSON.stringify({
        title: this.form.title.trim(),
        company: this.form.company.trim(),
        availableSlots: String(this.form.availableSlots),
        topics: this.normalizedTopics,
        bio: this.form.bio.trim(),
        availability: this.form.availability.trim()
      })
    },
    dirty() {
      return this.state === 'ready' && this.snapshot !== this.initialSnapshot
    },
    profileStatus() {
      return this.profile.status || 'draft'
    },
    statusLabel() {
      return statusLabels[this.profileStatus] || '导师资料'
    },
    statusShort() {
      return ({ published: '已发布', pending_review: '待审核', rejected: '需修改', offline: '已下架', draft: '草稿' })[this.profileStatus] || '资料'
    },
    statusTone() {
      return ({ published: 'success', pending_review: 'warning', rejected: 'danger', offline: 'neutral', draft: 'neutral' })[this.profileStatus] || 'neutral'
    },
    statusDescription() {
      return ({
        published: '当前公开资料已通过学校后台审核并在导师列表展示。',
        pending_review: '资料已提交，学校后台审核通过后将在导师列表展示。',
        rejected: '请根据学校后台反馈完善资料后重新提交。',
        offline: '公开展示已暂停，您仍可完善资料并等待后台处理。',
        draft: '资料尚未公开，完善后保存将进入后台审核流程。'
      })[this.profileStatus] || '资料状态以学校后台审核结果为准。'
    },
    eligibilityDescription() {
      const descriptions = {
        unbound: '学校后台尚未将导师档案绑定到当前实名账号，请联系导师计划管理人员核对。',
        pending: '您的导师资格仍在核验中，通过后即可在此维护本人资料。',
        pending_review: '您的导师资格仍在核验中，通过后即可在此维护本人资料。',
        rejected: '当前导师资格未通过核验，如有疑问请联系导师计划管理人员。',
        unverified: '导师档案尚未完成资格认证，暂时不能由本人修改。'
      }
      return descriptions[this.qualificationStatus] || '只有学校后台已绑定并核验通过的导师档案可以由本人维护，普通实名用户不能自行创建导师身份。'
    },
    unverifiedDescription() {
      return this.user.localDevelopmentOnly
        ? '当前为本地演示账号，不代表学校实名，也不能获得导师资料维护权限。请使用已通过学校官网实名注册的导师账号登录。'
        : '导师资料维护要求当前账号已通过学校官网实名注册。平台运营账号或未实名账号不能编辑导师资料。'
    }
  },
  onShow() {
    if (this.state === 'ready' && this.dirty) return
    this.loadState()
  },
  onBackPress() {
    if (!this.dirty || this.allowBack) return false
    uni.showModal({
      title: '有未保存的修改',
      content: '离开后本次修改将丢失，确定不保存并返回吗？',
      confirmText: '直接离开',
      confirmColor: '#9A403B',
      success: (result) => {
        if (!result.confirm) return
        this.allowBack = true
        uni.navigateBack()
      }
    })
    return true
  },
  methods: {
    openLogin() { openPage('/pages/verify/index') },
    openRegistration() { openPage('/pages/register/index') },
    openMentors() { openPage('/pages/mentors/index') },
    async loadState() {
      if (this.saving) return
      this.state = 'loading'
      this.error = ''
      try {
        if (!isVerified() && getAccessToken()) await refreshPlatformProfile()
      } catch (error) {
        // 后续状态会根据当前可信会话决定，不使用本地缓存伪造实名。
      }
      this.user = getUser()
      if (!isVerified()) {
        this.state = 'guest'
        return
      }
      if (!isSchoolVerified()) {
        this.state = 'unverified'
        return
      }
      try {
        const result = await getMyMentorProfile()
        this.qualificationStatus = String(result?.verificationStatus || '')
        if (result?.eligible !== true) {
          this.profile = result?.profile || {}
          this.state = 'ineligible'
          return
        }
        this.applyProfile(result?.profile || {})
        this.state = 'ready'
      } catch (error) {
        if (error.statusCode === 401) {
          this.state = 'guest'
          return
        }
        if (['SCHOOL_IDENTITY_REQUIRED'].includes(error.code)) {
          this.state = 'unverified'
          return
        }
        if (['MENTOR_ROLE_REQUIRED', 'MENTOR_VERIFICATION_REQUIRED'].includes(error.code) || error.statusCode === 403) {
          this.qualificationStatus = error.code === 'MENTOR_VERIFICATION_REQUIRED' ? 'unverified' : 'unbound'
          this.state = 'ineligible'
          return
        }
        this.error = error.message || '导师资料加载失败'
        this.state = 'error'
      }
    },
    applyProfile(profile = {}) {
      this.profile = profile
      this.revision = Number(profile.revision || 0)
      const topics = Array.isArray(profile.topics) ? profile.topics : []
      this.form = {
        title: String(profile.title || profile.role || ''),
        company: String(profile.company || ''),
        availableSlots: String(profile.availableSlots ?? profile.slots ?? 0),
        topicsText: topics.join('，'),
        bio: String(profile.bio || ''),
        availability: String(profile.availability || '')
      }
      this.initialSnapshot = this.snapshot
    },
    validate() {
      if (!this.form.title.trim()) return '请填写职务或身份'
      if (!this.form.company.trim()) return '请填写工作单位'
      const slots = Number(this.form.availableSlots)
      if (!Number.isInteger(slots) || slots < 0 || slots > 999) return '可约名额须为 0–999 的整数'
      if (!this.normalizedTopics.length) return '请至少填写一个辅导主题'
      if (this.normalizedTopics.length > 8) return '辅导主题最多填写 8 个'
      if (this.normalizedTopics.some((topic) => topic.length > 20)) return '每个辅导主题不能超过 20 个字'
      if (this.form.bio.trim().length < 20) return '导师简介至少填写 20 个字'
      return ''
    },
    async saveProfile() {
      if (this.saving || !this.dirty) return
      const validationError = this.validate()
      if (validationError) {
        uni.showToast({ title: validationError, icon: 'none' })
        return
      }
      this.saving = true
      try {
        const result = await saveMyMentorProfile({
          title: this.form.title.trim(),
          company: this.form.company.trim(),
          availableSlots: Number(this.form.availableSlots),
          topics: this.normalizedTopics,
          bio: this.form.bio.trim(),
          availability: this.form.availability.trim(),
          ...(this.revision ? { expectedRevision: this.revision } : {})
        })
        this.qualificationStatus = String(result?.verificationStatus || this.qualificationStatus)
        this.applyProfile(result?.profile || result || {})
        uni.showModal({
          title: '导师资料已保存',
          content: this.profile.status === 'published'
            ? '资料已更新，公开状态以学校后台审核结果为准。'
            : '资料已保存；学校后台发布后将在导师列表展示。',
          showCancel: false,
          confirmColor: '#033481'
        })
      } catch (error) {
        if (error.statusCode === 409 || error.code === 'BUSINESS_REVISION_CONFLICT') {
          uni.showModal({
            title: '资料已被更新',
            content: '后台资料版本已变化。请重新加载最新内容后再合并修改，系统不会覆盖他人的更新。',
            confirmText: '重新加载',
            confirmColor: '#033481',
            success: (result) => { if (result.confirm) this.loadState() }
          })
          return
        }
        if (['SCHOOL_IDENTITY_REQUIRED', 'MENTOR_ROLE_REQUIRED', 'MENTOR_VERIFICATION_REQUIRED'].includes(error.code) || error.statusCode === 403) {
          this.qualificationStatus = error.code === 'MENTOR_VERIFICATION_REQUIRED' ? 'unverified' : 'unbound'
          this.state = error.code === 'SCHOOL_IDENTITY_REQUIRED' ? 'unverified' : 'ineligible'
          return
        }
        uni.showModal({ title: '保存失败', content: error.message || '请稍后重试', showCancel: false })
      } finally {
        this.saving = false
      }
    }
  }
}
</script>

<style scoped>
.mentor-profile-page{padding-top:14rpx}.profile-hero{position:relative;min-height:315rpx;padding:36rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#11304f,#073a79 62%,#1e5b9c);box-shadow:0 23rpx 50rpx rgba(11,58,110,.2)}.profile-hero__eyebrow,.profile-hero__title,.profile-hero__desc{position:relative;z-index:2;display:block}.profile-hero__eyebrow{color:#e1c58e;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.profile-hero__title{margin-top:15rpx;font-size:40rpx;font-weight:700}.profile-hero__desc{max-width:560rpx;margin-top:11rpx;color:rgba(255,255,255,.67);font-size:20rpx;line-height:1.7}.profile-hero__identity{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:28rpx;padding-top:18rpx;display:flex;align-items:center;justify-content:space-between;border-top:1rpx solid rgba(255,255,255,.15);color:rgba(255,255,255,.66);font-size:19rpx}.profile-hero__identity text:first-child{color:#ead6ac;font-weight:650}.profile-hero__watermark{position:absolute;right:21rpx;top:-24rpx;color:rgba(255,255,255,.055);font-family:"STKaiti","KaiTi",serif;font-size:235rpx;font-weight:700}
.state-card{margin-top:24rpx;padding:58rpx 34rpx;text-align:center}.state-card__icon{width:86rpx;height:86rpx;margin:0 auto 22rpx;display:flex;align-items:center;justify-content:center;border-radius:28rpx;color:#fff;background:linear-gradient(145deg,#033481,#4778b1);font-size:28rpx;font-weight:700}.state-card__icon--loading{color:#80612c;background:#f3e7cf}.state-card__icon--warning{color:#80612c;background:#f4e8d1}.state-card__icon--error{color:#98443f;background:#f8e4e2}.state-card__title,.state-card__desc{display:block}.state-card__title{color:#2d3b51;font-size:29rpx;font-weight:700}.state-card__desc{max-width:560rpx;margin:12rpx auto 0;color:#7d8899;font-size:21rpx;line-height:1.7}.state-card__button{width:310rpx;margin:28rpx auto 0}.state-card__secondary{width:310rpx;margin:14rpx auto 0}.eligibility-steps{max-width:510rpx;margin:26rpx auto 0;padding:21rpx 24rpx;border-radius:22rpx;background:#f6f8fb;text-align:left}.eligibility-steps view{min-height:48rpx;display:flex;align-items:center;color:#657287;font-size:20rpx}.eligibility-steps view+view{margin-top:9rpx}.eligibility-steps view text:first-child{width:36rpx;height:36rpx;margin-right:12rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;background:#8b6a35;font-size:17rpx;font-weight:700}
.profile-status{position:relative;z-index:3;margin:-16rpx 18rpx 0;padding:24rpx;display:flex;align-items:center;flex-wrap:wrap}.profile-status__badge{min-width:84rpx;height:58rpx;padding:0 13rpx;display:flex;align-items:center;justify-content:center;border-radius:18rpx;font-size:18rpx;font-weight:700}.profile-status__badge--success{color:#176551;background:#e4f1ec}.profile-status__badge--warning{color:#8b6524;background:#f5e9d1}.profile-status__badge--danger{color:#96433e;background:#f8e5e3}.profile-status__badge--neutral{color:#647286;background:#edf1f5}.profile-status__copy{min-width:0;flex:1;margin-left:17rpx}.profile-status__copy text{display:block}.profile-status__copy text:first-child{color:#334157;font-size:24rpx;font-weight:700}.profile-status__copy text:last-child{margin-top:5rpx;color:#8b95a4;font-size:18rpx;line-height:1.45}.profile-status__qualification{margin:10rpx 0 0 101rpx;padding:6rpx 11rpx;border-radius:99rpx;color:#176551;background:#e4f1ec;font-size:16rpx;font-weight:650}.profile-status__revision{margin:10rpx 0 0 10rpx;color:#9ba3af;font-size:17rpx}.verified-tag{padding:7rpx 14rpx;border-radius:99rpx;color:#176551;background:#e4f1ec;font-size:18rpx;font-weight:650}
.form-section{padding:0 27rpx}.readonly-row{min-height:102rpx;padding:20rpx 0;display:flex;align-items:center;border-bottom:1rpx solid #edf0f4}.readonly-row>view{min-width:0;flex:1}.readonly-row>view text{display:block}.readonly-row>view text:first-child{color:#455368;font-size:23rpx;font-weight:650}.readonly-row>view text:last-child{margin-top:5rpx;color:#9aa2ae;font-size:17rpx}.readonly-row>text{max-width:280rpx;margin-left:20rpx;overflow:hidden;color:#27354a;font-size:22rpx;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.field-block{position:relative;padding:24rpx 0;display:block;border-bottom:1rpx solid #edf0f4}.field-block:last-child{border-bottom:none}.field-block__label{display:block;color:#455368;font-size:23rpx;font-weight:650}.field-block__label>text{color:#a24d47}.field-block input{width:100%;height:72rpx;margin-top:7rpx;padding-right:80rpx;color:#26354b;font-size:25rpx}.field-block__count{position:absolute;right:0;top:66rpx;color:#a1a8b3;font-size:17rpx}.field-block__hint{display:block;margin-top:7rpx;color:#939caa;font-size:18rpx;line-height:1.55}.field-placeholder{color:#b0b7c1}.topic-preview{margin-top:8rpx;display:flex;flex-wrap:wrap;gap:8rpx}.topic-preview text{padding:7rpx 12rpx;border-radius:99rpx;color:#526781;background:#edf2f8;font-size:17rpx}.field-block--textarea textarea{width:100%;height:300rpx;margin-top:14rpx;color:#26354b;font-size:24rpx;line-height:1.75}.textarea-meta{padding-top:13rpx;display:flex;align-items:flex-start;justify-content:space-between;gap:18rpx;border-top:1rpx solid #eef1f5;color:#9ba3af;font-size:17rpx}.textarea-meta text:first-child{flex:1}.textarea-meta text:last-child{flex-shrink:0}.review-note{margin-top:22rpx;padding:23rpx;display:flex;align-items:flex-start;border-radius:24rpx;color:#738094;background:#e9eef5}.review-note__icon{width:52rpx;height:52rpx;margin-right:15rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#7f602d;background:#f1dfbd;font-size:19rpx;font-weight:700}.review-note view text{display:block}.review-note view text:first-child{color:#4e5d72;font-size:21rpx;font-weight:700}.review-note view text:last-child{margin-top:6rpx;font-size:18rpx;line-height:1.65}
.profile-actions{display:flex;align-items:center;gap:22rpx}.profile-actions__copy{min-width:0;flex:1}.profile-actions__copy text{display:block}.profile-actions__copy text:first-child{color:#44536a;font-size:21rpx;font-weight:650}.profile-actions__copy text:last-child{margin-top:4rpx;color:#939caa;font-size:17rpx}.profile-actions__button{width:300rpx;margin:0}.profile-actions__button[disabled]{opacity:.5;box-shadow:none}
</style>
