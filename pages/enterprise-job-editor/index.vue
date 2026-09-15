<template>
  <view class="page-shell enterprise-job-editor-page" :class="{ 'with-sticky-action': state === 'ready' }">
    <view class="job-editor-hero">
      <text class="job-editor-hero__eyebrow">ENTERPRISE RECRUITMENT</text>
      <text class="job-editor-hero__title">{{ editing ? '编辑企业招聘' : '新增企业招聘' }}</text>
      <text class="job-editor-hero__desc">岗位由已认证企业负责人提交，后台审核通过后才会进入公开招聘列表。</text>
      <view class="job-editor-hero__enterprise"><text>{{ enterpriseName }}</text><text>{{ user.realName || '企业负责人' }}</text></view>
      <text class="job-editor-hero__mark">职</text>
    </view>

    <view v-if="state !== 'ready'" class="access-card surface">
      <view class="access-card__icon">{{ stateIcon }}</view>
      <text class="access-card__title">{{ stateTitle }}</text>
      <text class="access-card__desc">{{ stateDescription }}</text>
      <button v-if="state === 'guest'" class="primary-button access-card__button" @tap="open('/pages/verify/index')">去登录</button>
      <button v-else-if="state === 'unverified'" class="primary-button access-card__button" @tap="open('/pages/register/index')">了解实名注册</button>
      <button v-else-if="state === 'ineligible'" class="secondary-button access-card__button" @tap="open('/pages/enterprise-owner/index')">查看企业认证</button>
      <button v-else-if="state === 'error'" class="secondary-button access-card__button" @tap="load">重新加载</button>
    </view>

    <template v-else>
      <view v-if="editing" class="job-review-state surface">
        <view :class="`job-review-state__badge job-review-state__badge--${statusTone(job.status)}`">{{ statusLabel(job.status) }}</view>
        <view><text>{{ job.title }}</text><text>编辑保存后将重新进入后台审核，客户端不能直接发布岗位。</text></view>
      </view>
      <view v-if="job.reviewNote || job.rejectionReason" class="review-note"><text>审核意见</text><text>{{ job.reviewNote || job.rejectionReason }}</text></view>

      <view class="section-head"><view><text class="section-title">岗位信息</text><text class="section-kicker">POSITION DETAILS</text></view><text class="required-note">* 必填</text></view>
      <view class="job-form surface">
        <view class="readonly-row"><view><text>所属企业</text><text>由当前已认证企业自动绑定</text></view><text>{{ enterpriseName }}</text></view>
        <label class="form-field">
          <text>岗位名称 *</text>
          <input v-model.trim="form.title" maxlength="80" placeholder="例如：产品经理、财务主管" placeholder-class="field-placeholder" />
          <small>{{ form.title.length }}/80</small>
        </label>
        <label class="form-field">
          <text>工作城市 *</text>
          <RegionPicker v-model="form.city" v-model:code="form.regionCode" allow-remote />
        </label>
        <picker mode="selector" :range="employmentOptions" :value="employmentIndex" @change="chooseEmployment">
          <view class="picker-row"><view><text>用工类型 *</text><text>请选择岗位性质</text></view><text>{{ form.employmentType || '请选择' }} ›</text></view>
        </picker>
        <label class="form-field">
          <text>薪资说明 *</text>
          <input v-model.trim="form.salary" maxlength="60" placeholder="例如：8k–12k、年薪面议" placeholder-class="field-placeholder" />
        </label>
        <label class="form-field">
          <text>招聘人数 *</text>
          <input v-model="form.headcount" type="number" maxlength="3" placeholder="1–999" placeholder-class="field-placeholder" />
        </label>
        <label class="form-field">
          <text>经验要求</text>
          <input v-model.trim="form.experience" maxlength="60" placeholder="例如：3 年以上、应届生可投" placeholder-class="field-placeholder" />
        </label>
        <label class="form-field">
          <text>学历要求</text>
          <input v-model.trim="form.education" maxlength="60" placeholder="例如：本科及以上、不限" placeholder-class="field-placeholder" />
        </label>
        <view class="deadline-field">
          <picker mode="date" :value="form.deadline" :start="today" @change="form.deadline = $event.detail.value">
            <view class="picker-row"><view><text>招聘截止日期</text><text>不选择表示长期有效</text></view><text>{{ form.deadline || '长期有效' }} ›</text></view>
          </picker>
          <text v-if="form.deadline" @tap="form.deadline = ''">清除日期</text>
        </view>
        <label class="form-field form-field--wide">
          <text>岗位标签</text>
          <input v-model="form.tagsText" maxlength="180" placeholder="多个标签用逗号分隔，例如：五险一金，双休" placeholder-class="field-placeholder" />
          <view v-if="tags.length" class="tag-preview"><text v-for="tag in tags.slice(0, 8)" :key="tag">{{ tag }}</text></view>
          <small>最多 8 个标签，每个不超过 16 个字。</small>
        </label>
      </view>

      <view class="section-head"><view><text class="section-title">职责与要求</text><text class="section-kicker">RESPONSIBILITIES & REQUIREMENTS</text></view></view>
      <view class="job-form job-form--content surface">
        <label class="form-field form-field--wide form-field--textarea">
          <text>岗位职责 *</text>
          <textarea v-model="form.description" maxlength="12000" :show-confirm-bar="false" placeholder="说明主要工作内容、岗位目标和职责边界，至少 20 个字" placeholder-class="field-placeholder" />
          <small>{{ form.description.length }}/12000</small>
        </label>
        <label class="form-field form-field--wide form-field--textarea">
          <text>任职要求 *</text>
          <textarea v-model="form.requirements" maxlength="12000" :show-confirm-bar="false" placeholder="说明能力、经验、学历等要求，至少 20 个字" placeholder-class="field-placeholder" />
          <small>{{ form.requirements.length }}/12000</small>
        </label>
        <label class="form-field form-field--wide form-field--textarea form-field--short">
          <text>投递说明 *</text>
          <textarea v-model="form.applicationMethod" maxlength="1000" :show-confirm-bar="false" placeholder="说明通过平台申请后的联系或面试流程，请勿填写不必要的个人敏感信息" placeholder-class="field-placeholder" />
          <small>{{ form.applicationMethod.length }}/1000</small>
        </label>
      </view>

      <view class="privacy-note"><text>安</text><view><text>招聘信息将进入后台审核</text><text>请勿填写身份证号、账号密码、私人社交账号或与招聘无关的敏感信息；岗位公开不代表学校作出招聘承诺。</text></view></view>
    </template>

    <SupportFooter />

    <view v-if="state === 'ready'" class="sticky-action job-editor-actions">
      <view><text>{{ dirty ? '有尚未提交的岗位修改' : '当前岗位内容已同步' }}</text><text>保存后进入后台审核</text></view>
      <button class="primary-button" :loading="saving" :disabled="saving || !dirty" @tap="confirmSave">{{ saving ? '提交中…' : (editing ? '保存并重新审核' : '提交岗位审核') }}</button>
    </view>
  </view>
</template>

<script>
import {
  createMyEnterpriseJob,
  getMyEnterpriseJobs,
  getMyEnterpriseProfile,
  updateMyEnterpriseJob
} from '../../services/business'
import { refreshPlatformProfile } from '../../services/schoolAuth'
import { getAccessToken, getUser, isSchoolVerified, isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

const employmentOptions = ['全职', '兼职', '实习', '项目制', '其他']
const createForm = () => ({
  title: '',
  city: '',
  regionCode: '',
  employmentType: '',
  salary: '',
  headcount: '1',
  experience: '',
  education: '',
  deadline: '',
  tagsText: '',
  description: '',
  requirements: '',
  applicationMethod: ''
})

function certificationApproved(result = {}) {
  const certification = result.certification || result.application || result.enterpriseCertification || {}
  const raw = result.eligible === true
    ? 'approved'
    : (certification.verificationStatus || certification.status || result.verificationStatus
      || result.certificationStatus
      || (result.certified === true || result.enterpriseCertified === true ? 'approved' : result.status))
  return ['approved', 'verified', 'certified', 'published'].includes(String(raw || '').toLowerCase())
}

export default {
  data() {
    return {
      state: 'loading',
      user: {},
      profile: {},
      certification: {},
      jobId: '',
      job: {},
      form: createForm(),
      initialSnapshot: '',
      revision: 0,
      employmentOptions,
      saving: false,
      error: '',
      allowBack: false
    }
  },
  computed: {
    editing() { return Boolean(this.jobId) },
    enterpriseName() {
      return this.profile.name || this.profile.enterpriseName || this.certification.enterpriseName || this.certification.name || '已认证企业'
    },
    employmentIndex() { return Math.max(0, this.employmentOptions.indexOf(this.form.employmentType)) },
    tags() {
      return this.form.tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
    },
    snapshot() {
      return JSON.stringify({
        title: this.form.title.trim(),
        city: this.form.city.trim(),
        regionCode: String(this.form.regionCode || ''),
        employmentType: this.form.employmentType,
        salary: this.form.salary.trim(),
        headcount: String(this.form.headcount),
        experience: this.form.experience.trim(),
        education: this.form.education.trim(),
        deadline: this.form.deadline,
        tags: this.tags,
        description: this.form.description.trim(),
        requirements: this.form.requirements.trim(),
        applicationMethod: this.form.applicationMethod.trim()
      })
    },
    dirty() { return this.state === 'ready' && this.snapshot !== this.initialSnapshot },
    today() {
      const date = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    },
    stateIcon() {
      return ({ loading: '…', guest: '登', unverified: '验', ineligible: '企', error: '!' })[this.state] || '职'
    },
    stateTitle() {
      return ({
        loading: '正在核验企业招聘权限',
        guest: '请先登录湖财人账号',
        unverified: '当前账号未通过学校实名',
        ineligible: '企业认证通过后才能发布招聘',
        error: '招聘编辑器暂时无法加载'
      })[this.state] || '企业招聘'
    },
    stateDescription() {
      return ({
        loading: '系统将核对当前会话、企业认证状态和岗位归属。',
        guest: '企业招聘必须绑定已登录的平台账号。',
        unverified: '只有学校官网实名账号可以申请企业认证并发布招聘。',
        ineligible: '请先在企业主工作台提交企业认证；待学校后台审核通过后再发布岗位。',
        error: this.error || '请检查网络后重试。'
      })[this.state] || ''
    }
  },
  onLoad(options = {}) {
    this.jobId = String(options.id || '')
    this.load()
  },
  onBackPress() {
    if (!this.dirty || this.allowBack) return false
    uni.showModal({
      title: '有尚未提交的岗位修改',
      content: '离开后本次修改将丢失，确定直接返回吗？',
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
    open(url) { openPage(url) },
    chooseEmployment(event) {
      this.form.employmentType = this.employmentOptions[Number(event.detail.value)] || ''
    },
    async load() {
      if (this.saving) return
      this.state = 'loading'
      this.error = ''
      try {
        if (!isVerified() && getAccessToken()) await refreshPlatformProfile()
      } catch (error) {}
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
        const result = await getMyEnterpriseProfile()
        if (!certificationApproved(result)) {
          this.state = 'ineligible'
          return
        }
        this.certification = result.certification || result.application || result.enterpriseCertification || {}
        this.profile = result.profile || result.enterpriseProfile || result.enterprise || {}
        if (this.editing) {
          const jobs = await getMyEnterpriseJobs({ page: 1, pageSize: 100 })
          const job = jobs.items.find((item) => String(item.id) === this.jobId)
          if (!job) throw new Error('未找到本人企业的该招聘记录')
          if (String(job.status || '').toLowerCase() === 'cancelled') throw new Error('已取消的招聘记录不能再次编辑')
          this.applyJob(job)
        } else {
          this.job = {}
          this.revision = 0
          this.form = createForm()
          this.initialSnapshot = this.snapshot
        }
        this.state = 'ready'
      } catch (error) {
        if (error.statusCode === 401) this.state = 'guest'
        else if (error.code === 'SCHOOL_IDENTITY_REQUIRED') this.state = 'unverified'
        else if (error.statusCode === 403 || ['ENTERPRISE_CERTIFICATION_REQUIRED', 'ENTERPRISE_CERTIFICATION_PENDING'].includes(error.code)) this.state = 'ineligible'
        else {
          this.error = error.message || '招聘编辑器加载失败'
          this.state = 'error'
        }
      }
    },
    applyJob(job = {}) {
      this.job = job
      this.revision = Number(job.revision || 0)
      this.form = {
        title: String(job.title || ''),
        city: String(job.city || ''),
        regionCode: String(job.regionCode || ''),
        employmentType: String(job.employmentType || ''),
        salary: String(job.salary || ''),
        headcount: String(job.headcount ?? 1),
        experience: String(job.experience || ''),
        education: String(job.education || ''),
        deadline: job.deadline ? String(job.deadline).slice(0, 10) : '',
        tagsText: Array.isArray(job.tags) ? job.tags.join('，') : '',
        description: String(job.description || ''),
        requirements: String(job.requirements || ''),
        applicationMethod: String(job.applicationMethod || '')
      }
      this.initialSnapshot = this.snapshot
    },
    statusLabel(status) {
      return ({
        draft: '草稿',
        submitted: '待审核',
        pending_review: '待审核',
        published: '已发布',
        rejected: '已驳回',
        offline: '已下架',
        cancelled: '已取消'
      })[String(status || '').toLowerCase()] || '处理中'
    },
    statusTone(status) {
      return ({
        published: 'success',
        submitted: 'warning',
        pending_review: 'warning',
        rejected: 'danger',
        draft: 'neutral',
        offline: 'neutral',
        cancelled: 'neutral'
      })[String(status || '').toLowerCase()] || 'neutral'
    },
    validate() {
      if (this.form.title.trim().length < 2) return '请填写岗位名称'
      if (!this.form.city.trim()) return '请选择工作地区'
      if (!this.form.employmentType) return '请选择用工类型'
      if (!this.form.salary.trim()) return '请填写薪资说明'
      const headcount = Number(this.form.headcount)
      if (!Number.isInteger(headcount) || headcount < 1 || headcount > 999) return '招聘人数须为 1–999 的整数'
      if (this.tags.length > 8) return '岗位标签最多 8 个'
      if (this.tags.some((tag) => tag.length > 16)) return '每个岗位标签不能超过 16 个字'
      if (this.form.description.trim().length < 20) return '岗位职责至少填写 20 个字'
      if (this.form.requirements.trim().length < 20) return '任职要求至少填写 20 个字'
      if (this.form.applicationMethod.trim().length < 6) return '请填写清晰的投递说明'
      const sensitive = /(?:身份证|账号密码|登录密码)\s*[:：]?\s*[A-Za-z0-9+_-]{5,}/i
      if (sensitive.test(`${this.form.description}\n${this.form.requirements}\n${this.form.applicationMethod}`)) return '内容疑似包含不必要的敏感信息，请删除后提交'
      return ''
    },
    confirmSave() {
      const message = this.validate()
      if (message) {
        uni.showToast({ title: message, icon: 'none' })
        return
      }
      uni.showModal({
        title: this.editing ? '确认提交岗位修改' : '确认提交企业招聘',
        content: '岗位信息将进入学校后台审核；审核通过前不会出现在公开招聘列表。',
        confirmText: '提交审核',
        confirmColor: '#033481',
        success: (result) => { if (result.confirm) this.save() }
      })
    },
    async save() {
      if (this.saving || !this.dirty) return
      this.saving = true
      try {
        const payload = {
          title: this.form.title.trim(),
          city: this.form.city.trim(),
          regionCode: String(this.form.regionCode || ''),
          employmentType: this.form.employmentType,
          salary: this.form.salary.trim(),
          headcount: Number(this.form.headcount),
          experience: this.form.experience.trim(),
          education: this.form.education.trim(),
          deadline: this.form.deadline || null,
          tags: this.tags,
          description: this.form.description.trim(),
          requirements: this.form.requirements.trim(),
          applicationMethod: this.form.applicationMethod.trim(),
          ...(this.editing && this.revision ? { expectedRevision: this.revision } : {})
        }
        const result = this.editing
          ? await updateMyEnterpriseJob(this.jobId, payload)
          : await createMyEnterpriseJob(payload)
        this.applyJob(result?.job || result || {})
        uni.showModal({
          title: '招聘信息已提交',
          content: '岗位已进入后台审核；审核通过后才会进入公开招聘列表。',
          showCancel: false,
          confirmColor: '#033481',
          success: () => {
            this.allowBack = true
            uni.navigateBack()
          }
        })
      } catch (error) {
        if (error.statusCode === 409) {
          uni.showModal({
            title: '招聘记录已被更新',
            content: '服务端版本已变化，请重新加载最新岗位后再修改。',
            confirmText: '重新加载',
            confirmColor: '#033481',
            success: (result) => { if (result.confirm) this.load() }
          })
        } else {
          uni.showModal({ title: '提交失败', content: error.message || '请稍后重试', showCancel: false })
        }
      } finally {
        this.saving = false
      }
    }
  }
}
</script>

<style scoped>
.enterprise-job-editor-page{padding-top:14rpx}.job-editor-hero{position:relative;min-height:340rpx;padding:37rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#13304f,#0a3974 64%,#205e9d);box-shadow:0 23rpx 50rpx rgba(11,58,115,.2)}.job-editor-hero__eyebrow,.job-editor-hero__title,.job-editor-hero__desc{position:relative;z-index:2;display:block}.job-editor-hero__eyebrow{color:#e1c58d;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.job-editor-hero__title{margin-top:15rpx;font-size:41rpx;font-weight:700}.job-editor-hero__desc{width:520rpx;margin-top:11rpx;color:rgba(255,255,255,.65);font-size:20rpx;line-height:1.65}.job-editor-hero__enterprise{position:absolute;z-index:2;left:34rpx;bottom:29rpx;display:flex;gap:10rpx}.job-editor-hero__enterprise text{padding:7rpx 12rpx;border:1rpx solid rgba(255,255,255,.12);border-radius:99rpx;color:rgba(255,255,255,.7);background:rgba(255,255,255,.06);font-size:16rpx}.job-editor-hero__mark{position:absolute;right:18rpx;top:-32rpx;color:rgba(255,255,255,.05);font-family:"STKaiti","KaiTi",serif;font-size:245rpx;font-weight:700}.access-card{margin-top:25rpx;padding:61rpx 32rpx;text-align:center}.access-card__icon{width:82rpx;height:82rpx;margin:0 auto 20rpx;display:flex;align-items:center;justify-content:center;border-radius:27rpx;color:#fff;background:#033481;font-size:31rpx;font-weight:700}.access-card__title,.access-card__desc{display:block}.access-card__title{color:#334158;font-size:29rpx;font-weight:700}.access-card__desc{max-width:570rpx;margin:12rpx auto 0;color:#7e8999;font-size:21rpx;line-height:1.7}.access-card__button{width:290rpx;margin:27rpx auto 0}.job-review-state{position:relative;z-index:3;margin:-13rpx 18rpx 0;padding:22rpx;display:flex;align-items:center}.job-review-state__badge{width:61rpx;height:61rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:20rpx;font-size:17rpx;font-weight:700}.job-review-state__badge--success{color:#176551;background:#e4f1ec}.job-review-state__badge--warning{color:#876225;background:#f5e9d1}.job-review-state__badge--danger{color:#97443f;background:#f7e5e3}.job-review-state__badge--neutral{color:#687589;background:#edf1f5}.job-review-state>view:last-child{min-width:0}.job-review-state>view:last-child text{display:block}.job-review-state>view:last-child text:first-child{color:#3d4e64;font-size:21rpx;font-weight:700}.job-review-state>view:last-child text:last-child{margin-top:4rpx;color:#8792a1;font-size:17rpx}.review-note{margin-top:18rpx;padding:20rpx;border-radius:21rpx;color:#884845;background:#f7e7e5}.review-note text{display:block}.review-note text:first-child{font-size:18rpx;font-weight:700}.review-note text:last-child{margin-top:6rpx;font-size:18rpx;line-height:1.6}.required-note{color:#99433e;font-size:18rpx}.job-form{padding:0 26rpx;display:grid;grid-template-columns:1fr}.readonly-row,.picker-row{min-height:99rpx;padding:20rpx 0;display:flex;align-items:center;justify-content:space-between;gap:20rpx;border-bottom:1rpx solid #edf0f4}.readonly-row>view,.picker-row>view{min-width:0}.readonly-row>view text,.picker-row>view text{display:block}.readonly-row>view text:first-child,.picker-row>view text:first-child{color:#455368;font-size:23rpx;font-weight:650}.readonly-row>view text:last-child,.picker-row>view text:last-child{margin-top:4rpx;color:#98a1ad;font-size:16rpx}.readonly-row>text,.picker-row>text{max-width:48%;color:#033481;font-size:20rpx;text-align:right;overflow-wrap:anywhere}.form-field{position:relative;padding:23rpx 0;display:block;border-bottom:1rpx solid #edf0f4}.form-field>text,.form-field>small{display:block}.form-field>text:first-child{color:#455368;font-size:23rpx;font-weight:650}.form-field input{width:100%;height:70rpx;margin-top:5rpx;padding-right:72rpx;color:#27354a;font-size:23rpx}.form-field>small{margin-top:6rpx;color:#929caa;font-size:16rpx}.form-field--textarea textarea{width:100%;height:265rpx;margin-top:12rpx;color:#27354a;font-size:23rpx;line-height:1.7}.form-field--short textarea{height:190rpx}.field-placeholder{color:#afb6c0}.deadline-field{position:relative}.deadline-field>text{position:absolute;right:0;bottom:7rpx;color:#98453f;font-size:16rpx}.tag-preview{margin-top:8rpx;display:flex;flex-wrap:wrap;gap:8rpx}.tag-preview text{padding:7rpx 11rpx;border-radius:99rpx;color:#586b82;background:#eef2f7;font-size:17rpx}.privacy-note{margin-top:22rpx;padding:22rpx;display:flex;align-items:flex-start;border-radius:23rpx;color:#758195;background:#e9eef5}.privacy-note>text{width:49rpx;height:49rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#176551;background:#dcece6;font-size:18rpx;font-weight:700}.privacy-note view text{display:block}.privacy-note view text:first-child{color:#4b5a70;font-size:20rpx;font-weight:700}.privacy-note view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}.job-editor-actions{display:flex;align-items:center;gap:18rpx}.job-editor-actions>view{min-width:0;flex:1}.job-editor-actions>view text{display:block}.job-editor-actions>view text:first-child{color:#44546a;font-size:20rpx;font-weight:650}.job-editor-actions>view text:last-child{margin-top:4rpx;color:#939daa;font-size:16rpx}.job-editor-actions button{width:330rpx;margin:0;flex-shrink:0}
@media screen and (min-width:768px){.job-editor-hero{min-height:320px;padding:44px 48px;border-radius:34px}.job-editor-hero__eyebrow{font-size:14px}.job-editor-hero__title{margin-top:14px;font-size:46px}.job-editor-hero__desc{width:auto;max-width:760px;font-size:17px}.job-editor-hero__enterprise{left:48px;bottom:32px}.job-editor-hero__enterprise text{font-size:13px}.job-form{padding:0 30px;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px}.readonly-row,.form-field--wide{grid-column:1/-1}.form-field:nth-child(even):not(.form-field--wide){border-right:1px solid #edf0f4;padding-right:28px}.form-field>text:first-child{font-size:16px}.form-field input{height:54px;font-size:16px}.form-field>small{font-size:12px}.form-field--textarea textarea{height:190px;font-size:15px}.form-field--short textarea{height:145px}.job-form--content{display:block}.job-form--content .form-field{border-right:0}.privacy-note{padding:20px 24px}.job-editor-actions>view text:first-child{font-size:15px}.job-editor-actions>view text:last-child{font-size:12px}.job-editor-actions button{width:280px}}
@media screen and (min-width:1200px){.job-editor-hero{min-height:300px;padding:42px 52px}.job-editor-hero__enterprise{left:52px}.access-card,.job-review-state,.review-note,.job-form,.privacy-note,.section-head{max-width:1120px;margin-left:auto;margin-right:auto}.job-form{padding-left:36px;padding-right:36px}.job-editor-actions{left:50%;width:1120px;right:auto;transform:translateX(-50%);border-radius:24px 24px 0 0}}
@media screen and (max-width:360px){.job-editor-hero{padding-left:26rpx;padding-right:26rpx}.job-editor-hero__enterprise{left:26rpx}.job-editor-actions>view{display:none}.job-editor-actions button{width:100%}}
</style>
