<template>
  <view class="page-shell enterprise-owner-page">
    <view class="owner-hero">
      <text class="owner-hero__eyebrow">ENTERPRISE OWNER CENTER</text>
      <text class="owner-hero__title">企业主工作台</text>
      <text class="owner-hero__desc">提交企业认证，维护审核通过的企业资料，并管理本人企业的招聘信息。</text>
      <view class="owner-hero__identity"><text>{{ user.realName || '湖财人' }}</text><text>{{ user.department || '湖南财政经济学院' }}</text></view>
      <text class="owner-hero__mark">企</text>
    </view>

    <view v-if="['loading','guest','unverified','error'].includes(state)" class="state-card surface">
      <view class="state-card__icon" :class="`state-card__icon--${state}`">{{ stateIcon }}</view>
      <text class="state-card__title">{{ stateTitle }}</text>
      <text class="state-card__desc">{{ stateDescription }}</text>
      <button v-if="state === 'guest'" class="primary-button state-card__button" @tap="open('/pages/verify/index')">去登录</button>
      <button v-else-if="state === 'unverified'" class="primary-button state-card__button" @tap="open('/pages/register/index')">了解实名注册</button>
      <button v-else-if="state === 'error'" class="secondary-button state-card__button" @tap="loadState">重新加载</button>
    </view>

    <template v-else-if="state === 'not_applied' || editingCertification">
      <view v-if="state === 'not_applied'" class="start-card surface">
        <text>企业认证尚未提交</text>
        <text>只有通过学校实名的本人账号可以申请。认证通过前不会获得企业资料或招聘管理权限。</text>
      </view>
      <view v-else class="certification-back" @tap="editingCertification = false"><text>‹</text>返回审核状态</view>

      <view class="section-head"><view><text class="section-title">企业认证申请</text><text class="section-kicker">VERIFIED BUSINESS APPLICATION</text></view><text class="required-note">* 必填</text></view>
      <view class="owner-form surface">
        <label class="owner-field">
          <text>企业名称 *</text>
          <input v-model.trim="certificationForm.enterpriseName" maxlength="120" placeholder="请输入营业执照上的企业全称" placeholder-class="field-placeholder" @blur="lookupEnterprise" />
          <small>{{ certificationForm.enterpriseName.length }}/120</small>
        </label>
        <view class="owner-field owner-field--wide enterprise-lookup">
          <button class="secondary-button" :loading="lookupLoading" :disabled="lookupLoading || certificationForm.enterpriseName.length < 4" @tap="lookupEnterprise">查询并补全企业资料</button>
          <text>{{ lookupMessage || '填完企业全称后自动查询；只补充空白项，未获取的资料可自行填写。' }}</text>
          <text v-if="lookupRegistration?.address">登记地址：{{ lookupRegistration.address }}</text>
          <text v-if="lookupRegistration?.status">登记状态：{{ lookupRegistration.status }}</text>
          <small>工商资料不等于企业认证通过，联系人及证明材料仍需本人填写和上传。</small>
        </view>
        <label class="owner-field">
          <text>统一社会信用代码 *</text>
          <view class="sensitive-input"><input v-model.trim="certificationForm.creditCode" :password="!showCreditCode" maxlength="18" placeholder="18 位统一社会信用代码" placeholder-class="field-placeholder" /><text @tap="showCreditCode = !showCreditCode">{{ showCreditCode ? '隐藏' : '显示' }}</text></view>
          <small>仅用于企业主体校验；审核状态页只显示脱敏片段，不进入公开企业资料。</small>
        </label>
        <label class="owner-field">
          <text>所属行业 *</text>
          <input v-model.trim="certificationForm.industry" maxlength="60" placeholder="例如：信息技术、金融服务、文化教育" placeholder-class="field-placeholder" />
        </label>
        <label class="owner-field">
          <text>所在城市 *</text>
          <RegionPicker v-model="certificationForm.city" v-model:code="certificationForm.regionCode" />
        </label>
        <label class="owner-field">
          <text>企业联系人 *</text>
          <input v-model.trim="certificationForm.contactName" maxlength="40" placeholder="请输入负责对接的联系人姓名" placeholder-class="field-placeholder" />
        </label>
        <label class="owner-field">
          <text>联系方式 *</text>
          <input v-model.trim="certificationForm.contactMethod" maxlength="120" placeholder="工作手机号或企业邮箱，仅供审核联系" placeholder-class="field-placeholder" />
          <small>请使用必要的工作联系方式，不填写身份证号、家庭地址或账号密码。</small>
        </label>
        <label class="owner-field owner-field--wide owner-field--textarea">
          <text>企业简介 *</text>
          <textarea v-model="certificationForm.summary" maxlength="1200" :show-confirm-bar="false" placeholder="介绍主营业务、服务能力及与湖财的联系，至少 20 个字" placeholder-class="field-placeholder" />
          <small>{{ certificationForm.summary.length }}/1200</small>
        </label>
        <view class="owner-field owner-field--wide owner-field--materials">
          <view v-if="serverMaterials.length" class="saved-materials">
            <view><text>已有 {{ serverMaterials.length }} 份材料安全保存在待提交草稿中</text><text>可直接继续提交；如材料选错，请先清理后重新上传。</text></view>
            <button class="secondary-button" :loading="clearingMaterials" :disabled="clearingMaterials || submitting" @tap="confirmClearServerMaterials">清理材料</button>
          </view>
          <SecureMaterialPicker
            v-model="materials"
            :maximum="Math.max(0, 4 - serverMaterials.length)"
            material-type="business_license"
            material-label="营业执照 / 企业认证证明"
          />
        </view>
      </view>

      <view class="consent-row" @tap="consent = !consent">
        <view :class="{ 'consent-check--active': consent }">{{ consent ? '✓' : '' }}</view>
        <text>我确认提交的信息和材料真实、属于本人有权代表的企业，并同意学校授权管理员仅为企业认证与平台运营目的复核。</text>
      </view>
      <button class="primary-button certification-submit" :loading="submitting" :disabled="submitting || uploadingMaterials || clearingMaterials" @tap="confirmCertification">
        {{ uploadingMaterials ? uploadProgressText : (submitting ? '提交中…' : '提交企业认证') }}
      </button>
    </template>

    <template v-else-if="state === 'pending' || state === 'rejected'">
      <view class="certification-status surface">
        <view class="certification-status__badge" :class="`certification-status__badge--${state}`">{{ state === 'pending' ? '待审核' : '已驳回' }}</view>
        <view><text>{{ state === 'pending' ? '企业认证正在审核' : '企业认证需要重新提交' }}</text><text>{{ state === 'pending' ? '审核通过前不能维护企业公开资料或发布招聘。' : '请根据审核意见核对信息，并重新提交完整证明材料。' }}</text></view>
        <button class="ghost-button" @tap="loadState">刷新状态</button>
      </view>
      <view class="certification-detail surface">
        <view v-for="row in certificationRows" :key="row.label"><text>{{ row.label }}</text><text>{{ row.value || '—' }}</text></view>
      </view>
      <view v-if="reviewNote" class="review-note" :class="{ 'review-note--danger': state === 'rejected' }"><text>审核意见</text><text>{{ reviewNote }}</text></view>
      <button v-if="state === 'rejected'" class="primary-button reapply-button" @tap="beginReapplication">按审核意见重新提交</button>
    </template>

    <template v-else-if="state === 'approved'">
      <view class="approved-banner surface">
        <view class="approved-banner__icon">✓</view>
        <view><text>企业认证已通过</text><text>{{ enterpriseName }} · {{ maskedCreditCode || '统一社会信用代码已核验' }}</text></view>
        <text>学校审核</text>
      </view>

      <view class="owner-tabs surface">
        <view :class="{ active: activeTab === 'profile' }" @tap="activeTab = 'profile'"><text>企业资料</text><text>{{ profileStatusLabel }}</text></view>
        <view v-if="jobsEnabled" :class="{ active: activeTab === 'jobs' }" @tap="showJobs"><text>招聘管理</text><text>{{ jobs.length }}</text></view>
      </view>

      <template v-if="activeTab === 'profile' || !jobsEnabled">
        <view class="section-head"><view><text class="section-title">本人企业资料</text><text class="section-kicker">OWNER-MAINTAINED PROFILE</text></view><text class="verified-tag">✓ 已认证企业</text></view>
        <view class="owner-form surface">
          <view class="readonly-field"><view><text>企业名称</text><text>来自已通过的企业认证，不可直接修改</text></view><text>{{ enterpriseName }}</text></view>
          <view class="readonly-field"><view><text>统一社会信用代码</text><text>仅展示脱敏片段</text></view><text>{{ maskedCreditCode || '已核验' }}</text></view>
          <label class="owner-field">
            <text>所属行业 *</text>
            <input v-model.trim="profileForm.industry" maxlength="60" placeholder="请输入所属行业" placeholder-class="field-placeholder" />
          </label>
          <label class="owner-field">
            <text>所在城市 *</text>
            <RegionPicker v-model="profileForm.city" v-model:code="profileForm.regionCode" />
          </label>
          <label class="owner-field">
            <text>企业联系人 *</text>
            <input v-model.trim="profileForm.contactName" maxlength="40" placeholder="请输入企业联系人" placeholder-class="field-placeholder" />
          </label>
          <label class="owner-field">
            <text>企业联系方式 *</text>
            <input v-model.trim="profileForm.contactMethod" maxlength="120" placeholder="企业邮箱或工作联系电话" placeholder-class="field-placeholder" />
            <small>该字段是否公开由后台审核规则决定，请只填写必要的企业业务联系方式。</small>
          </label>
          <label class="owner-field owner-field--wide owner-field--textarea">
            <text>企业简介 *</text>
            <textarea v-model="profileForm.summary" maxlength="12000" :show-confirm-bar="false" placeholder="介绍企业业务、专业能力和服务边界" placeholder-class="field-placeholder" />
            <small>{{ profileForm.summary.length }}/12000</small>
          </label>
        </view>
        <view v-if="profileReviewNote" class="review-note" :class="{ 'review-note--danger': profileStatus === 'rejected' }"><text>资料审核意见</text><text>{{ profileReviewNote }}</text></view>
        <view class="profile-save-row"><text>{{ profileDirty ? '有尚未保存的企业资料修改' : '企业资料已与服务端同步' }}</text><button class="primary-button" :loading="savingProfile" :disabled="savingProfile || !profileDirty" @tap="saveProfile">{{ savingProfile ? '保存中…' : '保存并提交审核' }}</button></view>
      </template>

      <template v-else>
        <view class="section-head jobs-head"><view><text class="section-title">本人企业招聘</text><text class="section-kicker">RECRUITMENT MANAGEMENT</text></view><button class="primary-button" @tap="openJobEditor()">＋ 新增招聘</button></view>
        <view v-if="jobsLoading && !jobs.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载招聘记录</text></view>
        <view v-else-if="jobsError && !jobs.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ jobsError }}</text><button class="secondary-button jobs-retry" @tap="loadJobs">重新加载</button></view>
        <view v-else-if="jobs.length" class="owner-job-list">
          <view v-for="job in jobs" :key="job.id" class="owner-job surface">
            <view class="owner-job__head"><text :class="`job-status job-status--${statusTone(job.status)}`">{{ jobStatusLabel(job.status) }}</text><text>{{ dateText(job.updatedAt || job.createdAt) }}</text></view>
            <text class="owner-job__title">{{ job.title || '未命名岗位' }}</text>
            <text class="owner-job__meta">{{ job.city || '城市待定' }} · {{ job.employmentType || '用工类型待定' }} · {{ job.salary || '薪资面议' }}</text>
            <text v-if="job.reviewNote || job.rejectionReason" class="owner-job__review">审核意见：{{ job.reviewNote || job.rejectionReason }}</text>
            <view class="owner-job__actions">
              <button class="ghost-button" :disabled="job.status === 'cancelled'" @tap="openJobEditor(job)">编辑</button>
              <button v-if="job.status !== 'cancelled'" class="danger-button" @tap="cancelJob(job)">撤回 / 停止</button>
            </view>
          </view>
        </view>
        <view v-else class="empty-state surface"><view class="empty-state__icon">职</view><text>还没有本人企业的招聘记录</text><button class="secondary-button jobs-retry" @tap="openJobEditor()">发布第一个岗位</button></view>
      </template>
    </template>

    <view class="security-note"><text>安</text><view><text>企业管理安全边界</text><text>企业认证、资料和招聘状态均以服务端审核结果为准。客户端不能自行设置“已认证”或“已发布”，也不会公开企业证明材料。</text></view></view>
    <SupportFooter />
  </view>
</template>

<script>
import SecureMaterialPicker from '../../components/SecureMaterialPicker.vue'
import { applyEnterpriseLookup, clearEnterpriseAutofill } from '../../utils/enterpriseLookup'
import {
  cancelMyEnterpriseJob,
  deleteEnterpriseCertificationMaterial,
  getMyEnterpriseJobs,
  getMyEnterpriseProfile,
  lookupEnterpriseByName,
  saveMyEnterpriseProfile,
  submitEnterpriseCertification,
  uploadEnterpriseCertificationMaterial
} from '../../services/business'
import { refreshPlatformProfile } from '../../services/schoolAuth'
import { getAccessToken, getUser, isSchoolVerified, isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

const createCertificationForm = () => ({
  enterpriseName: '',
  creditCode: '',
  industry: '',
  city: '',
  regionCode: '',
  contactName: '',
  contactMethod: '',
  summary: ''
})

const createProfileForm = () => ({
  industry: '',
  city: '',
  regionCode: '',
  contactName: '',
  contactMethod: '',
  summary: ''
})

function normalizedCertificationStatus(value) {
  const status = String(value || '').toLowerCase()
  if (['approved', 'verified', 'certified', 'published'].includes(status)) return 'approved'
  if (['submitted', 'pending', 'pending_review', 'under_review', 'reviewing'].includes(status)) return 'pending'
  if (['rejected', 'denied', 'needs_more', 'needs_supplement'].includes(status)) return 'rejected'
  return 'not_applied'
}

function maskValue(value, prefix = 4, suffix = 4) {
  const text = String(value || '').trim()
  if (!text || text.includes('*')) return text
  if (text.length <= prefix + suffix) return `${'*'.repeat(Math.max(4, text.length - 2))}${text.slice(-2)}`
  return `${text.slice(0, prefix)}${'*'.repeat(Math.max(4, text.length - prefix - suffix))}${text.slice(-suffix)}`
}

export default {
  components: { SecureMaterialPicker },
  data() {
    return {
      state: 'loading',
      user: {},
      certification: {},
      profile: {},
      certificationForm: createCertificationForm(),
      profileForm: createProfileForm(),
      materials: [],
      consent: false,
      showCreditCode: false,
      editingCertification: false,
      submitting: false,
      uploadingMaterials: false,
      clearingMaterials: false,
      uploadIndex: 0,
      profileInitialSnapshot: '',
      profileRevision: 0,
      savingProfile: false,
      activeTab: 'profile',
      jobs: [],
      jobsLoading: false,
      jobsLoaded: false,
      jobsError: '',
      jobsVersion: 0,
      error: '',
      allowBack: false,
      lookupLoading: false, lookupMessage: '', lookupRegistration: null, lookupApplied: {}, lookupName: '', lookupSequence: 0
    }
  },
  computed: {
    jobsEnabled() { return this.isModuleEnabled('jobs') },
    stateIcon() {
      return ({ loading: '…', guest: '登', unverified: '验', error: '!' })[this.state] || '企'
    },
    stateTitle() {
      return ({
        loading: '正在核验企业管理资格',
        guest: '请先登录湖财人账号',
        unverified: '当前账号未通过学校实名',
        error: '企业主工作台暂时无法加载'
      })[this.state] || '企业主工作台'
    },
    stateDescription() {
      return ({
        loading: '系统将核对当前会话、学校实名状态和本人企业认证记录。',
        guest: '企业认证会绑定本人平台账号，请先使用湖财人用户名和密码登录。',
        unverified: '只有学校官网实名注册账号可以申请企业认证；本机演示账号和平台运营账号不具备企业认证资格。',
        error: this.error || '请检查网络后重试。'
      })[this.state] || ''
    },
    enterpriseName() {
      return this.profile.name || this.profile.enterpriseName || this.certification.enterprise?.name
        || this.certification.enterpriseName || this.certification.name || '已认证企业'
    },
    maskedCreditCode() {
      return this.profile.creditCodeMasked || this.profile.unifiedSocialCreditCodeMasked
        || this.certification.creditCodeMasked || this.certification.unifiedSocialCreditCodeMasked
        || maskValue(this.profile.creditCode || this.certification.creditCode || this.certification.unifiedSocialCreditCode)
    },
    reviewNote() {
      return this.certification.reviewNote || this.certification.rejectionReason || this.certification.review?.note || ''
    },
    serverMaterials() {
      return Array.isArray(this.certification.materials) ? this.certification.materials : []
    },
    certificationRows() {
      const source = {
        ...(this.certification.enterprise || {}),
        ...this.profile,
        ...this.certification
      }
      return [
        { label: '企业名称', value: source.enterpriseName || source.name },
        { label: '统一社会信用代码', value: this.maskedCreditCode },
        { label: '所属行业', value: source.industry },
        { label: '所在城市', value: source.city },
        { label: '联系人', value: source.contactName },
        { label: '联系方式', value: source.contactMethodMasked || maskValue(source.contactMethod, 3, 3) },
        { label: '材料数量', value: `${Number(this.certification.materialCount ?? this.certification.materials?.length ?? 0)} 份` },
        { label: '提交时间', value: this.dateText(this.certification.submittedAt || this.certification.createdAt) }
      ]
    },
    uploadProgressText() {
      return `上传材料 ${this.uploadIndex}/${this.materials.length}`
    },
    profileSnapshot() {
      return JSON.stringify({
        industry: this.profileForm.industry.trim(),
        city: this.profileForm.city.trim(),
        regionCode: String(this.profileForm.regionCode || ''),
        contactName: this.profileForm.contactName.trim(),
        contactMethod: this.profileForm.contactMethod.trim(),
        summary: this.profileForm.summary.trim()
      })
    },
    profileDirty() {
      return this.state === 'approved' && this.profileSnapshot !== this.profileInitialSnapshot
    },
    certificationDirty() {
      const values = Object.values(this.certificationForm).some((value) => String(value || '').trim())
      return (this.state === 'not_applied' || this.editingCertification) && (values || this.materials.length > 0)
    },
    profileStatus() {
      return String(this.profile.status || 'draft').toLowerCase()
    },
    profileStatusLabel() {
      return ({ published: '已发布', pending_review: '待审核', rejected: '需修改', offline: '已下架', draft: '待完善' })[this.profileStatus] || '资料'
    },
    profileReviewNote() {
      return this.profile.reviewNote || this.profile.rejectionReason || ''
    }
  },
  watch: {
    jobsEnabled(enabled) { if(!enabled)this.resetDisabledJobs() },
    'certificationForm.enterpriseName'(value) {
      if(this.lookupName && value.trim()!==this.lookupName){this.lookupSequence++;this.lookupLoading=false;clearEnterpriseAutofill(this.certificationForm,this.lookupApplied);this.lookupApplied={};this.lookupRegistration=null;this.lookupMessage='';this.lookupName=''}
    }
  },
  onShow() {
    if (this.profileDirty || this.submitting || this.savingProfile) return
    this.loadState()
  },
  onPullDownRefresh() {
    this.loadState().finally(() => uni.stopPullDownRefresh())
  },
  onBackPress() {
    if ((!this.profileDirty && !this.certificationDirty) || this.allowBack) return false
    uni.showModal({
      title: '有尚未提交的修改',
      content: '离开后，企业表单和本机临时证明图片将被清除。确定直接离开吗？',
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
  onUnload() {
    this.lookupSequence++
    this.materials = []
  },
  methods: {
    async lookupEnterprise() {
      const name=this.certificationForm.enterpriseName.trim(),token=getAccessToken(),sequence=++this.lookupSequence
      if(this.lookupName&&this.lookupName!==name){clearEnterpriseAutofill(this.certificationForm,this.lookupApplied);this.lookupApplied={};this.lookupRegistration=null}
      if(name.length<4){this.lookupMessage='请先填写营业执照上的企业全称';return}
      this.lookupName=name;this.lookupLoading=true;this.lookupMessage='正在查询企业登记资料…'
      try{const result=await lookupEnterpriseByName(name);if(sequence!==this.lookupSequence||token!==getAccessToken()||this.certificationForm.enterpriseName.trim()!==name)return
        this.lookupApplied={...this.lookupApplied,...applyEnterpriseLookup(this.certificationForm,result,name)}
        this.lookupRegistration=result.available?result.registration:null
        this.lookupMessage=result.available?`已从${result.source}获取资料并补充空白项；你已填写的内容未覆盖，请核对后提交。`:(result.reason||'未查到资料，请手动填写')
      }catch(e){if(sequence===this.lookupSequence&&token===getAccessToken())this.lookupMessage=e.message||'暂时无法获取，请手动填写'}finally{if(sequence===this.lookupSequence)this.lookupLoading=false}
    },
    open(url) { openPage(url) },
    dateText(value) {
      if (!value) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      const pad = (number) => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
    async loadState() {
      this.lookupSequence++;this.lookupLoading=false;this.lookupMessage='';this.lookupRegistration=null
      if (this.submitting || this.savingProfile) return
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
        this.applyEnterpriseResult(await getMyEnterpriseProfile())
      } catch (error) {
        if (error.statusCode === 401) {
          this.state = 'guest'
          return
        }
        if (error.code === 'SCHOOL_IDENTITY_REQUIRED') {
          this.state = 'unverified'
          return
        }
        if (error.statusCode === 404 || ['ENTERPRISE_PROFILE_NOT_FOUND', 'ENTERPRISE_CERTIFICATION_NOT_FOUND', 'ENTERPRISE_CERTIFICATION_REQUIRED'].includes(error.code)) {
          this.prepareCertification()
          this.state = 'not_applied'
          return
        }
        this.error = error.message || '企业管理资料加载失败'
        this.state = 'error'
      }
    },
    applyEnterpriseResult(result = {}) {
      const directCertification = result.id && (result.verificationStatus || result.enterprise)
        ? result
        : null
      this.certification = result.certification || result.application || result.enterpriseCertification || directCertification || {}
      this.profile = result.profile || result.enterpriseProfile || result.enterprise || this.certification.enterprise || {}
      const rawStatus = result.eligible === true
        ? 'approved'
        : (this.certification.verificationStatus || this.certification.status || result.verificationStatus
          || result.certificationStatus
          || (result.certified === true || result.enterpriseCertified === true ? 'approved' : result.status))
      const nextState = normalizedCertificationStatus(rawStatus)
      this.state = nextState
      this.editingCertification = false
      this.materials = []
      this.consent = false
      if (nextState === 'not_applied') this.prepareCertification()
      if (nextState === 'approved') {
        this.applyProfile(this.profile)
        if (this.activeTab === 'jobs') this.loadJobs()
      }
    },
    prepareCertification(source = {}) {
      const candidate = source.enterprise || source
      const record = candidate.enterpriseName || candidate.name
        ? candidate
        : (this.certification.enterprise || this.profile || this.certification || {})
      this.certificationForm = {
        enterpriseName: String(record.enterpriseName || record.name || ''),
        creditCode: '',
        industry: String(record.industry || ''),
        city: String(record.city || ''),
        regionCode: String(record.regionCode || ''),
        contactName: String(record.contactName || ''),
        contactMethod: '',
        summary: String(record.summary || record.description || '')
      }
      this.materials = []
      this.consent = false
      this.showCreditCode = false
    },
    beginReapplication() {
      this.prepareCertification(this.certification)
      this.editingCertification = true
    },
    validateCertification() {
      const form = this.certificationForm
      if (form.enterpriseName.trim().length < 2) return '请填写完整企业名称'
      if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/i.test(form.creditCode.trim())) return '统一社会信用代码格式不正确'
      if (!form.industry.trim()) return '请填写所属行业'
      if (!form.city.trim()) return '请选择所在地区'
      if (!form.contactName.trim()) return '请填写企业联系人'
      if (form.contactMethod.trim().length < 5) return '请填写有效工作联系方式'
      if (form.summary.trim().length < 20) return '企业简介至少填写 20 个字'
      if (!this.materials.length && !this.serverMaterials.length) return '请上传至少一张企业证明材料'
      if (!this.consent) return '请阅读并确认企业认证声明'
      return ''
    },
    confirmClearServerMaterials() {
      if (!this.serverMaterials.length || this.clearingMaterials || this.submitting || this.uploadingMaterials) return
      uni.showModal({
        title: '清理已上传材料',
        content: '将删除当前企业认证草稿中的全部私密证明材料，之后需要重新上传。确定继续吗？',
        confirmText: '确认清理',
        confirmColor: '#9A403B',
        success: (result) => { if (result.confirm) this.clearServerMaterials() }
      })
    },
    async clearServerMaterials() {
      if (this.clearingMaterials || this.submitting || this.uploadingMaterials) return
      this.clearingMaterials = true
      try {
        for (const material of [...this.serverMaterials]) {
          const result = await deleteEnterpriseCertificationMaterial(material.materialId || material.id)
          const latest = result?.certification || result
          if (latest) {
            this.certification = latest
            this.profile = latest.enterprise || this.profile
          }
        }
        this.materials = []
        uni.showToast({ title: '材料已安全清理', icon: 'none' })
      } catch (error) {
        uni.showModal({ title: '清理材料失败', content: error.message || '请稍后重试', showCancel: false })
      } finally {
        this.clearingMaterials = false
      }
    },
    confirmCertification() {
      if (this.clearingMaterials) {
        uni.showToast({ title: '请等待材料清理完成', icon: 'none' })
        return
      }
      const message = this.validateCertification()
      if (message) {
        uni.showToast({ title: message, icon: 'none' })
        return
      }
      uni.showModal({
        title: '确认提交企业认证',
        content: '企业主体信息与证明材料将提交学校授权管理员复核。提交后，统一社会信用代码仅以脱敏形式展示。',
        confirmText: '确认提交',
        confirmColor: '#033481',
        success: (result) => { if (result.confirm) this.submitCertification() }
      })
    },
    async submitCertification() {
      if (this.submitting || this.uploadingMaterials || this.clearingMaterials) return
      this.submitting = true
      try {
        this.uploadingMaterials = true
        for (let index = 0; index < this.materials.length; index += 1) {
          this.uploadIndex = index + 1
          let materialId = this.materials[index].materialId
          if (!materialId) {
            const response = await uploadEnterpriseCertificationMaterial(this.materials[index])
            const material = response?.material || response
            materialId = material?.materialId || material?.id
            if (!materialId) throw new Error('材料上传成功但未返回安全材料编号')
            this.materials[index] = {
              ...this.materials[index],
              dataBase64: '',
              materialId: String(materialId)
            }
          }
        }
        this.uploadingMaterials = false
        const form = this.certificationForm
        const result = await submitEnterpriseCertification({
          name: form.enterpriseName.trim(),
          unifiedSocialCreditCode: form.creditCode.trim().toUpperCase(),
          industry: form.industry.trim(),
          city: form.city.trim(),
          regionCode: String(form.regionCode || ''),
          contactName: form.contactName.trim(),
          contactMethod: form.contactMethod.trim(),
          summary: form.summary.trim()
        })
        this.certificationForm.creditCode = ''
        this.certificationForm.contactMethod = ''
        this.materials = []
        this.consent = false
        this.applyEnterpriseResult(result)
        if (this.state === 'not_applied') await this.loadState()
        uni.showModal({
          title: '企业认证已提交',
          content: '申请已进入学校后台审核；审核通过前不会开放企业资料和招聘管理权限。',
          showCancel: false,
          confirmColor: '#033481'
        })
      } catch (error) {
        uni.showModal({ title: '企业认证提交失败', content: error.message || '请稍后重试', showCancel: false })
      } finally {
        this.uploadingMaterials = false
        this.uploadIndex = 0
        this.submitting = false
      }
    },
    applyProfile(profile = {}) {
      this.profile = profile
      this.profileRevision = Number(profile.revision || 0)
      this.profileForm = {
        industry: String(profile.industry || this.certification.industry || ''),
        city: String(profile.city || this.certification.city || ''),
        regionCode: String(profile.regionCode || this.certification.regionCode || ''),
        contactName: String(profile.contactName || this.certification.contactName || ''),
        contactMethod: String(profile.contactMethod || ''),
        summary: String(profile.summary || profile.description || this.certification.summary || '')
      }
      this.profileInitialSnapshot = this.profileSnapshot
    },
    validateProfile() {
      if (!this.profileForm.industry.trim()) return '请填写所属行业'
      if (!this.profileForm.city.trim()) return '请选择所在地区'
      if (!this.profileForm.contactName.trim()) return '请填写企业联系人'
      if (this.profileForm.contactMethod.trim().length < 5) return '请填写企业业务联系方式'
      if (this.profileForm.summary.trim().length < 20) return '企业简介至少填写 20 个字'
      return ''
    },
    async saveProfile() {
      if (this.savingProfile || !this.profileDirty) return
      const message = this.validateProfile()
      if (message) {
        uni.showToast({ title: message, icon: 'none' })
        return
      }
      this.savingProfile = true
      try {
        const result = await saveMyEnterpriseProfile({
          industry: this.profileForm.industry.trim(),
          city: this.profileForm.city.trim(),
          regionCode: String(this.profileForm.regionCode || ''),
          contactName: this.profileForm.contactName.trim(),
          contactMethod: this.profileForm.contactMethod.trim(),
          summary: this.profileForm.summary.trim(),
          ...(this.profileRevision ? { expectedRevision: this.profileRevision } : {})
        })
        const profile = result?.profile || result
        this.applyProfile(profile)
        uni.showModal({
          title: '企业资料已保存',
          content: '企业资料已保存。企业主体名称、认证归属和发布排序仍只能由后台管理。',
          showCancel: false,
          confirmColor: '#033481'
        })
      } catch (error) {
        if (error.statusCode === 409) {
          uni.showModal({
            title: '企业资料已被更新',
            content: '服务端版本已变化，请重新加载后再提交，系统不会覆盖较新的资料。',
            confirmText: '重新加载',
            confirmColor: '#033481',
            success: (result) => { if (result.confirm) this.loadState() }
          })
        } else {
          uni.showModal({ title: '保存失败', content: error.message || '请稍后重试', showCancel: false })
        }
      } finally {
        this.savingProfile = false
      }
    },
    resetDisabledJobs() { this.jobsVersion++;this.jobs=[];this.jobsLoaded=false;this.jobsLoading=false;this.jobsError='';this.activeTab='profile' },
    showJobs() {
      if(!this.jobsEnabled){this.resetDisabledJobs();return}
      if (this.profileDirty) {
        uni.showToast({ title: '请先保存企业资料修改', icon: 'none' })
        return
      }
      this.activeTab = 'jobs'
      if (!this.jobsLoaded) this.loadJobs()
    },
    async loadJobs() {
      if (!this.jobsEnabled || this.jobsLoading || this.state !== 'approved') return
      const version=++this.jobsVersion
      this.jobsLoading = true
      this.jobsError = ''
      try {
        const result = await getMyEnterpriseJobs({ page: 1, pageSize: 100 })
        if(!this.jobsEnabled||version!==this.jobsVersion)return
        this.jobs = result.items.map((item) => ({
          ...item,
          tags: Array.isArray(item.tags) ? item.tags : [],
          status: String(item.status || 'draft').toLowerCase()
        }))
        this.jobsLoaded = true
      } catch (error) {
        if(this.jobsEnabled&&version===this.jobsVersion)this.jobsError = error.message || '本人企业招聘加载失败'
      } finally {
        if(version===this.jobsVersion)this.jobsLoading = false
      }
    },
    openJobEditor(job = null) {
      if(!this.jobsEnabled){this.resetDisabledJobs();return}
      if (this.profileDirty) {
        uni.showToast({ title: '请先保存企业资料修改', icon: 'none' })
        return
      }
      const query = job?.id ? `?id=${encodeURIComponent(job.id)}` : ''
      openPage(`/pages/enterprise-job-editor/index${query}`)
    },
    jobStatusLabel(status) {
      return ({
        draft: '草稿',
        submitted: '待审核',
        pending_review: '待审核',
        published: '已发布',
        rejected: '已驳回',
        offline: '已下架',
        cancelled: '已取消'
      })[status] || '处理中'
    },
    statusTone(status) {
      return ({
        published: 'success',
        pending_review: 'warning',
        submitted: 'warning',
        rejected: 'danger',
        offline: 'neutral',
        cancelled: 'neutral',
        draft: 'neutral'
      })[status] || 'neutral'
    },
    cancelJob(job) {
      if(!this.jobsEnabled){this.resetDisabledJobs();return}
      uni.showModal({
        title: '确认撤回或停止招聘',
        content: job.status === 'published'
          ? `确认停止公开岗位“${job.title}”？操作将提交服务端并保留审核记录。`
          : `确认撤回岗位“${job.title}”？操作将保留历史记录。`,
        confirmText: '确认停止',
        confirmColor: '#9A403B',
        success: async (result) => {
          if (!result.confirm || !this.jobsEnabled) return
          try {
            await cancelMyEnterpriseJob(job.id, {
              ...(job.revision ? { expectedRevision: job.revision } : {})
            })
            await this.loadJobs()
            uni.showToast({ title: '招聘记录已更新', icon: 'none' })
          } catch (error) {
            uni.showModal({ title: '操作失败', content: error.message || '请稍后重试', showCancel: false })
          }
        }
      })
    }
  }
}
</script>

<style scoped>
.enterprise-lookup{display:flex;flex-direction:column;gap:14rpx;background:#f2f6fc}.enterprise-lookup text,.enterprise-lookup small{display:block;font-size:22rpx;line-height:1.7;overflow-wrap:anywhere}.enterprise-lookup .secondary-button{margin:0;width:100%}
.enterprise-owner-page{padding-top:14rpx}.owner-hero{position:relative;min-height:340rpx;padding:37rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#102f54,#073a78 64%,#1f5e9e);box-shadow:0 23rpx 50rpx rgba(11,58,115,.2)}.owner-hero__eyebrow,.owner-hero__title,.owner-hero__desc{position:relative;z-index:2;display:block}.owner-hero__eyebrow{color:#e1c58d;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.owner-hero__title{margin-top:15rpx;font-size:41rpx;font-weight:700}.owner-hero__desc{width:520rpx;margin-top:11rpx;color:rgba(255,255,255,.65);font-size:20rpx;line-height:1.65}.owner-hero__identity{position:absolute;z-index:2;left:34rpx;bottom:29rpx;display:flex;gap:10rpx}.owner-hero__identity text{padding:7rpx 12rpx;border:1rpx solid rgba(255,255,255,.12);border-radius:99rpx;color:rgba(255,255,255,.7);background:rgba(255,255,255,.06);font-size:16rpx}.owner-hero__mark{position:absolute;right:18rpx;top:-31rpx;color:rgba(255,255,255,.05);font-family:"STKaiti","KaiTi",serif;font-size:245rpx;font-weight:700}.state-card{margin-top:25rpx;padding:60rpx 32rpx;text-align:center}.state-card__icon{width:82rpx;height:82rpx;margin:0 auto 20rpx;display:flex;align-items:center;justify-content:center;border-radius:27rpx;color:#fff;background:#033481;font-size:31rpx;font-weight:700}.state-card__icon--loading{color:#7d602e;background:#f1e2c5}.state-card__icon--unverified{color:#7d5d29;background:#f4e7d0}.state-card__icon--error{color:#98433e;background:#f6e3e1}.state-card__title,.state-card__desc{display:block}.state-card__title{color:#334158;font-size:29rpx;font-weight:700}.state-card__desc{max-width:570rpx;margin:12rpx auto 0;color:#7e8999;font-size:21rpx;line-height:1.7}.state-card__button{width:280rpx;margin:27rpx auto 0}.start-card{position:relative;z-index:3;margin:-13rpx 18rpx 0;padding:22rpx}.start-card text{display:block}.start-card text:first-child{color:#405168;font-size:22rpx;font-weight:700}.start-card text:last-child{margin-top:6rpx;color:#8994a2;font-size:18rpx;line-height:1.6}.certification-back{margin:24rpx 4rpx 0;color:#033481;font-size:21rpx;font-weight:650}.certification-back text{margin-right:7rpx;font-size:30rpx}.required-note{color:#99433e;font-size:18rpx}.owner-form{padding:0 26rpx;display:grid;grid-template-columns:1fr}.owner-field{position:relative;padding:23rpx 0;display:block;border-bottom:1rpx solid #edf0f4}.owner-field>text,.owner-field>small{display:block}.owner-field>text:first-child{color:#455368;font-size:23rpx;font-weight:650}.owner-field input{width:100%;height:70rpx;margin-top:5rpx;padding-right:80rpx;color:#27354a;font-size:23rpx}.owner-field>small{margin-top:6rpx;color:#929caa;font-size:16rpx;line-height:1.55}.owner-field--textarea textarea{width:100%;height:250rpx;margin-top:12rpx;color:#27354a;font-size:23rpx;line-height:1.7}.owner-field--materials{padding:26rpx 0;border-bottom:0}.saved-materials{margin-bottom:18rpx;padding:18rpx;display:flex;align-items:center;gap:16rpx;border-radius:18rpx;background:#edf4f0}.saved-materials>view{min-width:0;flex:1}.saved-materials text{display:block}.saved-materials text:first-child{color:#315b4f;font-size:19rpx;font-weight:700}.saved-materials text:last-child{margin-top:4rpx;color:#788b84;font-size:16rpx;line-height:1.5}.saved-materials button{width:170rpx;height:58rpx;margin:0;flex-shrink:0;font-size:17rpx;line-height:58rpx}.sensitive-input{display:flex;align-items:center}.sensitive-input input{min-width:0;flex:1}.sensitive-input>text{flex-shrink:0;color:#033481;font-size:18rpx;font-weight:650}.field-placeholder{color:#afb6c0}.consent-row{margin-top:20rpx;padding:22rpx;display:flex;align-items:flex-start;border-radius:22rpx;color:#687589;background:#e9eef5;font-size:19rpx;line-height:1.6}.consent-row>view{width:38rpx;height:38rpx;margin-right:12rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2rpx solid #a7b1bd;border-radius:12rpx;color:#fff;font-size:18rpx}.consent-row .consent-check--active{border-color:#176551;background:#176551}.certification-submit,.reapply-button{margin-top:22rpx}.certification-submit[disabled]{opacity:.58}.certification-status{position:relative;z-index:3;margin:-13rpx 18rpx 0;padding:23rpx;display:flex;align-items:center;gap:15rpx}.certification-status__badge{width:64rpx;height:64rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:21rpx;font-size:18rpx;font-weight:700}.certification-status__badge--pending{color:#7e5e28;background:#f4e7cf}.certification-status__badge--rejected{color:#963f3b;background:#f6e4e2}.certification-status>view:nth-child(2){min-width:0;flex:1}.certification-status>view:nth-child(2) text{display:block}.certification-status>view:nth-child(2) text:first-child{color:#3b4c62;font-size:23rpx;font-weight:700}.certification-status>view:nth-child(2) text:last-child{margin-top:5rpx;color:#8792a1;font-size:17rpx;line-height:1.55}.certification-status button{width:150rpx;height:60rpx;margin:0;flex-shrink:0;font-size:17rpx;line-height:60rpx}.certification-detail{margin-top:21rpx;padding:0 24rpx}.certification-detail>view{min-height:82rpx;padding:17rpx 0;display:flex;align-items:center;justify-content:space-between;gap:20rpx;border-bottom:1rpx solid #edf0f4}.certification-detail>view:last-child{border-bottom:0}.certification-detail text:first-child{color:#8c97a5;font-size:18rpx}.certification-detail text:last-child{max-width:65%;color:#3f5066;font-size:20rpx;text-align:right;overflow-wrap:anywhere}.review-note{margin-top:19rpx;padding:21rpx;border-radius:22rpx;color:#7a633d;background:#f7eedf}.review-note--danger{color:#8f4844;background:#f7e7e5}.review-note text{display:block}.review-note text:first-child{font-size:19rpx;font-weight:700}.review-note text:last-child{margin-top:7rpx;font-size:19rpx;line-height:1.65;white-space:pre-wrap}.approved-banner{position:relative;z-index:3;margin:-13rpx 18rpx 0;padding:22rpx;display:flex;align-items:center}.approved-banner__icon{width:57rpx;height:57rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#fff;background:#176551;font-weight:700}.approved-banner>view:nth-child(2){min-width:0;flex:1}.approved-banner>view:nth-child(2) text{display:block}.approved-banner>view:nth-child(2) text:first-child{color:#395065;font-size:22rpx;font-weight:700}.approved-banner>view:nth-child(2) text:last-child{margin-top:4rpx;overflow:hidden;color:#8692a0;font-size:17rpx;text-overflow:ellipsis;white-space:nowrap}.approved-banner>text{color:#176551;font-size:17rpx;font-weight:650}.owner-tabs{margin-top:22rpx;padding:7rpx;display:flex}.owner-tabs view{height:66rpx;flex:1;display:flex;align-items:center;justify-content:center;gap:9rpx;border-radius:20rpx;color:#718095;font-size:21rpx}.owner-tabs view text:last-child{padding:4rpx 8rpx;border-radius:99rpx;background:#edf1f5;font-size:15rpx}.owner-tabs view.active{color:#fff;background:#033481}.owner-tabs view.active text:last-child{color:#033481;background:#fff}.verified-tag{color:#176551;font-size:18rpx}.readonly-field{min-height:96rpx;padding:20rpx 0;display:flex;align-items:center;justify-content:space-between;gap:20rpx;border-bottom:1rpx solid #edf0f4}.readonly-field>view{min-width:0}.readonly-field>view text{display:block}.readonly-field>view text:first-child{color:#455368;font-size:22rpx;font-weight:650}.readonly-field>view text:last-child{margin-top:4rpx;color:#99a1ac;font-size:16rpx}.readonly-field>text{max-width:48%;color:#3e536a;font-size:20rpx;text-align:right;overflow-wrap:anywhere}.profile-save-row{margin-top:20rpx;padding:20rpx 22rpx;display:flex;align-items:center;justify-content:space-between;gap:18rpx;border-radius:22rpx;color:#7d8999;background:#e9eef5;font-size:18rpx}.profile-save-row button{width:270rpx;margin:0;flex-shrink:0}.jobs-head{align-items:center}.jobs-head button{width:210rpx;height:68rpx;margin:0;border-radius:19rpx;font-size:20rpx;line-height:68rpx}.jobs-retry{width:240rpx;margin:22rpx auto 0}.owner-job-list{display:grid;gap:17rpx}.owner-job{padding:24rpx}.owner-job__head{display:flex;align-items:center;justify-content:space-between;color:#98a1ad;font-size:16rpx}.job-status{padding:6rpx 11rpx;border-radius:99rpx;font-size:16rpx;font-weight:650}.job-status--success{color:#176551;background:#e4f1ec}.job-status--warning{color:#876225;background:#f5e9d1}.job-status--danger{color:#98423e;background:#f7e5e3}.job-status--neutral{color:#687589;background:#edf1f5}.owner-job__title,.owner-job__meta,.owner-job__review{display:block}.owner-job__title{margin-top:14rpx;color:#2d3d53;font-size:27rpx;font-weight:700}.owner-job__meta{margin-top:7rpx;color:#8893a1;font-size:18rpx}.owner-job__review{margin-top:13rpx;padding:13rpx 15rpx;border-radius:15rpx;color:#874b47;background:#f8ebe9;font-size:18rpx;line-height:1.55}.owner-job__actions{margin-top:18rpx;padding-top:18rpx;display:flex;justify-content:flex-end;gap:11rpx;border-top:1rpx solid #edf0f4}.owner-job__actions button{width:190rpx;height:64rpx;margin:0;border-radius:17rpx;font-size:18rpx;line-height:64rpx}.danger-button{color:#963f3b;background:#f6e7e5}.security-note{margin-top:25rpx;padding:22rpx;display:flex;align-items:flex-start;border-radius:23rpx;color:#758195;background:#e9eef5}.security-note>text{width:49rpx;height:49rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#176551;background:#dcece6;font-size:18rpx;font-weight:700}.security-note view text{display:block}.security-note view text:first-child{color:#4b5a70;font-size:20rpx;font-weight:700}.security-note view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}
@media screen and (min-width:768px){.owner-hero{min-height:320px;padding:44px 48px;border-radius:34px}.owner-hero__eyebrow{font-size:14px}.owner-hero__title{margin-top:14px;font-size:46px}.owner-hero__desc{width:auto;max-width:760px;font-size:17px}.owner-hero__identity{left:48px;bottom:32px}.owner-hero__identity text{font-size:13px}.state-card{padding:70px}.owner-form{padding:0 30px;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px}.owner-field--wide{grid-column:1/-1}.owner-field:nth-child(odd):not(.owner-field--wide){border-right:1px solid #edf0f4;padding-right:28px}.owner-field>text:first-child{font-size:16px}.owner-field input{height:54px;font-size:16px}.owner-field>small{font-size:12px}.owner-field--textarea textarea{height:190px;font-size:15px}.certification-detail{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px}.certification-detail>view:nth-last-child(-n+2){border-bottom:0}.owner-job-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.profile-save-row button{width:230px}.security-note{padding:20px 24px}}
@media screen and (min-width:1200px){.owner-hero{min-height:300px;padding:42px 52px}.owner-hero__identity{left:52px}.state-card,.start-card,.certification-status,.certification-detail,.review-note,.owner-form,.consent-row,.certification-submit,.reapply-button,.approved-banner,.owner-tabs,.profile-save-row,.owner-job-list,.security-note{max-width:1120px;margin-left:auto;margin-right:auto}.section-head{max-width:1120px;margin-left:auto;margin-right:auto}.owner-form{padding-left:36px;padding-right:36px}.owner-job{padding:26px}}
@media screen and (max-width:360px){.owner-hero{padding-left:26rpx;padding-right:26rpx}.owner-hero__identity{left:26rpx}.certification-status{align-items:flex-start;flex-wrap:wrap}.certification-status button{width:100%}.profile-save-row{align-items:stretch;flex-direction:column}.profile-save-row button{width:100%}.owner-job__actions button{min-width:0;flex:1}.jobs-head{align-items:flex-start;flex-direction:column}.jobs-head button{width:100%}}
</style>
