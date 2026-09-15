<template>
  <view class="page-shell manual-page">
    <view class="manual-hero">
      <image class="manual-hero__logo" :src="logoUrl" mode="aspectFit" />
      <text class="manual-hero__eyebrow">MANUAL IDENTITY REVIEW</text>
      <text class="manual-hero__title">老校友人工实名认证</text>
      <text class="manual-hero__desc">适用于学校早期尚未建立数字账号、无法通过学校官网完成自动校验的校友。</text>
      <view class="manual-hero__steps"><text>提交资料</text><text>授权复核</text><text>实名注册</text></view>
      <text class="manual-hero__seal">核</text>
    </view>

    <view class="policy-card surface">
      <view class="policy-card__icon">护</view>
      <view><text>材料仅用于湖财人身份复核</text><text>申请由学校授权管理员处理；身份证号只用于校验，列表与回执仅显示脱敏结果。</text></view>
    </view>

    <template v-if="application">
      <view class="status-card surface">
        <view class="status-card__badge" :class="`status-card__badge--${statusTone}`">{{ statusShort }}</view>
        <view class="status-card__copy">
          <text>{{ statusTitle }}</text>
          <text>{{ statusDescription }}</text>
        </view>
        <button class="refresh-button" :loading="loading" :disabled="loading" @tap="loadApplication">刷新</button>
      </view>

      <view class="application-card surface">
        <view class="application-card__head"><text>申请进度</text><text>{{ application.applicationNo || application.id }}</text></view>
        <view v-for="row in applicationRows" :key="row.label" class="application-row"><text>{{ row.label }}</text><text>{{ row.value || '—' }}</text></view>
      </view>

      <view v-if="reviewNote" class="review-note surface" :class="{ 'review-note--danger': application.status === 'rejected' }">
        <text>{{ application.status === 'needs_more' ? '需要补充材料' : '审核说明' }}</text>
        <text>{{ reviewNote }}</text>
      </view>

      <view v-if="waitingForReview" class="result-guide surface">
        <view class="result-guide__icon">查</view>
        <view>
          <text>审核结果会显示在本页</text>
          <text>保持本机申请记录后，重新进入“人工实名认证”即可继续查询；停留本页时系统也会自动刷新。审核通过前不会生成平台账号。</text>
        </view>
      </view>

      <view v-if="application.status === 'draft'" class="draft-recovery surface">
        <view>
          <text>上次提交未完成</text>
          <text>可能在读取或上传材料时中断。为避免隐藏材料累积，请清理旧草稿后重新填写并提交。</text>
        </view>
        <button class="secondary-button" :disabled="loading" @tap="startAgain">清理草稿并重新填写</button>
      </view>

      <view v-if="application.status === 'needs_more'" class="supplement-card surface">
        <view class="form-section-head"><text>补充证明材料</text><text>根据审核说明补充后再次提交</text></view>
        <view class="material-toolbar">
          <picker :range="materialTypeLabels" :value="materialTypeIndex" @change="materialTypeIndex = Number($event.detail.value)">
            <view class="picker-box">{{ materialTypeLabels[materialTypeIndex] }}<text>⌄</text></view>
          </picker>
          <button class="secondary-button choose-button" :disabled="uploading || materials.length >= 4" @tap="chooseMaterials">{{ uploading ? '处理中…' : '选择图片' }}</button>
        </view>
        <view v-if="materials.length" class="material-grid">
          <view v-for="(material,index) in materials" :key="material.localPath" class="material-preview">
            <image :src="material.localPath" mode="aspectFill" />
            <text>{{ material.label }}</text>
            <text @tap="materials.splice(index, 1)">移除</text>
          </view>
        </view>
        <button class="primary-button submit-button" :loading="loading" :disabled="loading || !materials.length" @tap="submitSupplement">提交补充材料</button>
      </view>

      <view v-if="application.status === 'approved'" class="approved-next surface">
        <view class="approved-next__mark">✓</view>
        <view class="approved-next__copy">
          <text>审核已通过，还需创建平台账号</text>
          <text>下一步会先校验实名身份是否已有平台账号：没有账号时设置用户名和密码；已有账号时直接引导登录，不会重复创建。</text>
        </view>
        <button class="primary-button register-action" :loading="loading" :disabled="loading" @tap="continueRegistration">继续设置平台账号</button>
        <button class="secondary-button login-action" :disabled="loading" @tap="openLogin">已有平台账号，直接登录</button>
      </view>
      <button v-if="['rejected','cancelled'].includes(application.status)" class="secondary-button register-action" @tap="startAgain">重新提交申请</button>
    </template>

    <view v-else class="form-card surface">
      <view class="form-section-head"><text>填写本人校友信息</text><text>带 * 的项目为人工复核必填项</text></view>

      <view class="form-grid">
        <view class="field-group"><text class="field-label">真实姓名 *</text><view class="field-box"><input v-model.trim="form.realName" maxlength="40" placeholder="请输入毕业时使用的姓名" /></view></view>
        <view class="field-group"><text class="field-label">曾用名</text><view class="field-box"><input v-model.trim="form.formerName" maxlength="40" placeholder="如在校期间使用过其他姓名" /></view></view>
        <view class="field-group field-group--wide"><text class="field-label">学院 / 系部 *</text><view class="field-box"><input v-model.trim="form.department" maxlength="80" placeholder="请输入在校时所属学院或系部" /></view></view>
        <view class="field-group field-group--wide"><text class="field-label">专业 *</text><view class="field-box"><input v-model.trim="form.major" maxlength="80" placeholder="请输入专业名称" /></view></view>
        <view class="field-group"><text class="field-label">入学年份 *</text><view class="field-box"><input v-model.trim="form.enrollmentYear" type="number" maxlength="4" placeholder="例如 1998" /></view></view>
        <view class="field-group"><text class="field-label">毕业年份 *</text><view class="field-box"><input v-model.trim="form.graduationYear" type="number" maxlength="4" placeholder="例如 2002" /></view></view>
        <view class="field-group"><text class="field-label">原学号</text><view class="field-box"><input v-model.trim="form.studentId" maxlength="32" placeholder="忘记可不填" /></view></view>
        <view class="field-group"><text class="field-label">联系电话 *</text><view class="field-box"><input v-model.trim="form.phone" type="number" maxlength="20" placeholder="用于必要的复核联系" /></view></view>
        <view class="field-group field-group--wide"><text class="field-label">身份证号 *</text><view class="field-box"><input v-model.trim="form.idCardNo" :password="!showIdCard" maxlength="18" placeholder="仅用于身份比对，不在前后台列表明文显示" /><text class="field-toggle" @tap="showIdCard = !showIdCard">{{ showIdCard ? '隐藏' : '显示' }}</text></view></view>
        <view class="field-group field-group--wide"><text class="field-label">情况说明 *</text><view class="textarea-box"><textarea v-model.trim="form.description" maxlength="500" placeholder="请说明就读时间、班级、班主任或无法官网校验的原因（至少 10 个字）" /></view></view>
      </view>

      <view class="form-section-head material-head"><text>上传证明材料 *</text><text>最多 4 张，每张不超过 500MB</text></view>
      <view class="material-hints"><text>毕业证 / 学位证</text><text>学生证 / 成绩单</text><text>身份证明</text><text>其他校友证明</text></view>
      <view class="material-toolbar">
        <picker :range="materialTypeLabels" :value="materialTypeIndex" @change="materialTypeIndex = Number($event.detail.value)">
          <view class="picker-box">{{ materialTypeLabels[materialTypeIndex] }}<text>⌄</text></view>
        </picker>
        <button class="secondary-button choose-button" :disabled="uploading || materials.length >= 4" @tap="chooseMaterials">{{ uploading ? '处理中…' : '选择图片' }}</button>
      </view>
      <view v-if="materials.length" class="material-grid">
        <view v-for="(material,index) in materials" :key="material.localPath" class="material-preview">
          <image :src="material.localPath" mode="aspectFill" />
          <text>{{ material.label }}</text>
          <text @tap="materials.splice(index, 1)">移除</text>
        </view>
      </view>

      <view class="consent-row" @tap="consent = !consent">
        <view :class="{ 'consent-check--active': consent }">{{ consent ? '✓' : '' }}</view>
        <text>我确认以上资料属于本人，并同意学校授权管理员仅为湖财人实名复核使用。</text>
      </view>
      <button class="primary-button submit-button" :loading="loading" :disabled="loading || uploading || !formValid" @tap="submitApplication">提交人工认证申请</button>
      <button v-if="tracking" class="text-button" :disabled="loading" @tap="restoreApplication">查看本机已有申请</button>
    </view>

    <view class="login-guide surface">
      <view class="login-guide__step"><text>1</text><view><text>提交后查看进度</text><text>本机会安全保存申请查询凭证，重新进入本页即可查看待复核、补充材料或审核结果。</text></view></view>
      <view class="login-guide__step"><text>2</text><view><text>通过后设置账号</text><text>点击“继续设置平台账号”，创建独立的湖财人用户名和密码。</text></view></view>
      <view class="login-guide__step"><text>3</text><view><text>以后直接登录</text><text>使用湖财人平台账号登录，不再提交人工材料，也不使用学校官网密码。</text></view></view>
      <button class="text-button login-guide__button" @tap="openLogin">已有湖财人账号，直接登录</button>
    </view>

    <SupportFooter />
  </view>
</template>

<script>
import { appConfig } from '../../config/index'
import { chooseImageFiles } from '../../services/privateMaterials'
import {
  applyManualVerificationExchange,
  cancelManualVerificationApplication,
  clearManualVerificationTracking,
  createManualVerificationDraft,
  exchangeManualVerificationApplication,
  getManualVerificationApplication,
  readManualVerificationTracking,
  saveManualVerificationTracking,
  submitManualVerificationApplication,
  uploadManualVerificationMaterial
} from '../../services/manualVerification'
import { openPage } from '../../utils/nav'

const materialTypes = [
  { value: 'graduation_certificate', label: '毕业证 / 学位证' },
  { value: 'student_record', label: '学生证 / 成绩单' },
  { value: 'identity_document', label: '身份证明' },
  { value: 'other_evidence', label: '其他校友证明' }
]

function mimeTypeFor(path = '', fallback = '') {
  if (fallback) return fallback
  const extension = String(path).split('?')[0].split('.').pop()?.toLowerCase()
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[extension] || 'image/jpeg'
}

function base64FromPath(path, file) {
  // #ifdef H5
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '')
    reader.onerror = () => reject(new Error('无法读取所选图片'))
    if (file instanceof Blob) reader.readAsDataURL(file)
    else fetch(path).then((response) => response.blob()).then((blob) => reader.readAsDataURL(blob)).catch(reject)
  })
  // #endif

  // #ifndef H5
  return new Promise((resolve, reject) => {
    uni.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: (result) => resolve(result.data),
      fail: () => reject(new Error('无法读取所选图片'))
    })
  })
  // #endif
}

export default {
  data() {
    return {
      logoUrl: appConfig.officialLogoUrl,
      form: {
        realName: '', formerName: '', department: '', major: '', enrollmentYear: '',
        graduationYear: '', studentId: '', idCardNo: '', phone: '', description: ''
      },
      application: null,
      tracking: readManualVerificationTracking(),
      materials: [],
      materialTypeIndex: 0,
      loading: false,
      uploading: false,
      consent: false,
      showIdCard: false,
      statusPollTimer: null,
      statusRefreshPending: false,
      pageActive: false,
      pageLifecycleId: 0,
      approvalNoticeShown: false
    }
  },
  computed: {
    materialTypeLabels() { return materialTypes.map((item) => item.label) },
    formValid() {
      return Boolean(
        this.form.realName && this.form.department
        && this.form.major
        && /^\d{4}$/.test(this.form.enrollmentYear)
        && /^\d{4}$/.test(this.form.graduationYear)
        && /^1[3-9]\d{9}$/.test(this.form.phone)
        && /^\d{17}[0-9Xx]$/.test(this.form.idCardNo)
        && this.form.description.length >= 10
        && this.materials.length
        && this.consent
      )
    },
    statusShort() {
      return ({ draft:'草稿', submitted:'已提交', under_review:'复核中', needs_more:'补充', approved:'通过', rejected:'驳回', cancelled:'取消' })[this.application?.status] || '申请'
    },
    statusTone() {
      return ({ approved:'success', rejected:'danger', cancelled:'danger', needs_more:'warning', under_review:'blue', submitted:'blue', draft:'neutral' })[this.application?.status] || 'neutral'
    },
    statusTitle() {
      return ({ submitted:'申请已提交', under_review:'管理员正在复核', needs_more:'请补充证明材料', approved:'人工实名认证已通过', rejected:'本次申请未通过', cancelled:'申请已取消' })[this.application?.status] || '人工认证申请'
    },
    statusDescription() {
      return ({ draft:'申请尚未完整提交，请清理草稿后重新填写。', submitted:'材料已进入后台待复核队列，可在本页查看进度。', under_review:'授权管理员已开始核验您提交的校友资料。', needs_more:'请根据审核说明上传补充材料并重新提交。', approved:'请检查实名身份的账号状态，并完成账号创建或直接登录。', rejected:'您可以根据审核说明完善资料后重新提交新申请。', cancelled:'如仍需认证，可重新填写并提交申请。' })[this.application?.status] || '请查看当前申请状态。'
    },
    waitingForReview() {
      return ['submitted', 'under_review'].includes(this.application?.status)
    },
    reviewNote() { return this.application?.reviewNote || this.application?.review?.note || '' },
    applicationRows() {
      const source = this.application || {}
      return [
        { label: '申请人', value: source.realName || source.name },
        { label: '学院 / 系部', value: source.department },
        { label: '毕业年份', value: source.graduationYear },
        { label: '联系电话', value: source.phoneMasked },
        { label: '身份证号', value: source.idCardMasked },
        { label: '材料数量', value: `${source.materialCount ?? source.materials?.length ?? 0} 份` },
        { label: '提交时间', value: this.formatTime(source.submittedAt || source.createdAt) }
      ]
    }
  },
  onShow() {
    this.pageActive = true
    this.tracking = readManualVerificationTracking()
    if (this.tracking) this.loadApplication(true)
  },
  onHide() {
    this.pageActive = false
    this.pageLifecycleId += 1
    this.stopStatusPolling()
  },
  onUnload() {
    this.pageActive = false
    this.pageLifecycleId += 1
    this.stopStatusPolling()
  },
  methods: {
    formatTime(value) {
      if (!value) return ''
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
    },
    async chooseMaterials() {
      if (this.uploading || this.materials.length >= 4) return
      this.uploading = true
      try {
        const type = materialTypes[this.materialTypeIndex]
        this.materials.push(...await chooseImageFiles({count:4-this.materials.length,materialType:type.value,label:type.label}))
      } catch (error) {
        uni.showModal({title:'材料读取失败',content:error.message||'请重新选择图片',showCancel:false})
      } finally { this.uploading = false }
    },
    async uploadPendingMaterials(applicationId, trackingToken) {
      const uploaded = []
      for (let index = 0; index < this.materials.length; index += 1) {
        const material = this.materials[index]
        uni.showLoading({ title: `上传材料 ${index + 1}/${this.materials.length}`, mask: true })
        const result = await uploadManualVerificationMaterial(applicationId, trackingToken, {
          filename: material.filename,
          mimeType: material.mimeType,
          dataBase64: material.dataBase64,
          fileSource: material.fileSource,
          materialType: material.materialType,
          label: material.label
        })
        if (result?.application) {
          this.application = result.application
          if (this.tracking) {
            this.tracking = saveManualVerificationTracking({
              ...this.tracking,
              status: result.application.status
            })
          }
        }
        uploaded.push(result)
      }
      uni.hideLoading()
      return uploaded
    },
    async submitApplication() {
      if (!this.formValid || this.loading) return
      this.loading = true
      try {
        const { idCardNo, ...profile } = this.form
        const draft = await createManualVerificationDraft({
          ...profile,
          idCardNumber: idCardNo,
          personType: 'alumni',
          consent: true
        })
        const tracking = saveManualVerificationTracking(draft)
        this.tracking = tracking
        this.application = draft.application || draft
        await this.uploadPendingMaterials(tracking.applicationId, tracking.trackingToken)
        const application = await submitManualVerificationApplication(tracking.applicationId, tracking.trackingToken)
        this.tracking = saveManualVerificationTracking({ ...tracking, status: application.status })
        this.application = application
        this.materials = []
        this.startStatusPolling()
        uni.showToast({ title: '申请已提交', icon: 'success' })
      } catch (error) {
        uni.hideLoading()
        uni.showModal({ title: '提交失败', content: error.message || '请稍后重试', showCancel: false })
      } finally { this.loading = false }
    },
    async submitSupplement() {
      if (!this.tracking || !this.materials.length || this.loading) return
      this.loading = true
      try {
        await this.uploadPendingMaterials(this.tracking.applicationId, this.tracking.trackingToken)
        this.application = await submitManualVerificationApplication(this.tracking.applicationId, this.tracking.trackingToken)
        this.tracking = saveManualVerificationTracking({ ...this.tracking, status: this.application.status })
        this.materials = []
        this.startStatusPolling()
        uni.showToast({ title: '补充材料已提交', icon: 'success' })
      } catch (error) {
        uni.hideLoading()
        uni.showModal({ title: '提交失败', content: error.message || '请稍后重试', showCancel: false })
      } finally { this.loading = false }
    },
    async loadApplication(silent = false) {
      if (!this.tracking || this.loading || this.statusRefreshPending) return
      const lifecycleId = this.pageLifecycleId
      if (silent) this.statusRefreshPending = true
      else this.loading = true
      try {
        const previousStatus = this.application?.status || ''
        const application = await getManualVerificationApplication(this.tracking.applicationId, this.tracking.trackingToken)
        if (!this.pageActive || lifecycleId !== this.pageLifecycleId) return
        this.application = application
        this.tracking = saveManualVerificationTracking({ ...this.tracking, status: this.application.status })
        this.startStatusPolling()
        if (
          this.application.status === 'approved'
          && previousStatus !== 'approved'
          && !this.approvalNoticeShown
        ) {
          this.approvalNoticeShown = true
          uni.showModal({
            title: '人工实名认证已通过',
            content: '系统会先检查该实名身份是否已有平台账号：没有账号时继续设置用户名和密码；已有账号时直接引导登录。',
            confirmText: '继续注册',
            cancelText: '稍后处理',
            confirmColor: '#176551',
            success: (result) => { if (result.confirm) this.continueRegistration() }
          })
        }
      } catch (error) {
        if (!this.pageActive || lifecycleId !== this.pageLifecycleId) return
        if (['MANUAL_VERIFICATION_TRACKING_EXPIRED', 'MANUAL_VERIFICATION_TRACKING_INVALID'].includes(error.code)) {
          clearManualVerificationTracking()
          this.tracking = null
          this.application = null
          this.stopStatusPolling()
        }
        if (!silent) uni.showModal({ title: '查询失败', content: error.message || '请稍后重试', showCancel: false })
      } finally {
        if (silent) this.statusRefreshPending = false
        else this.loading = false
        if (this.pageActive && lifecycleId !== this.pageLifecycleId && this.tracking) {
          this.$nextTick(() => this.loadApplication(true))
        }
      }
    },
    startStatusPolling() {
      this.stopStatusPolling()
      if (!this.pageActive || !this.tracking || !['submitted', 'under_review'].includes(this.application?.status)) return
      this.statusPollTimer = setInterval(() => this.loadApplication(true), 20000)
    },
    stopStatusPolling() {
      if (this.statusPollTimer) clearInterval(this.statusPollTimer)
      this.statusPollTimer = null
    },
    restoreApplication() { this.loadApplication() },
    async continueRegistration() {
      if (this.loading) return
      if (!this.tracking) {
        uni.showModal({
          title: '无法继续注册',
          content: '本机申请查询凭证已失效，请重新进入人工实名认证页面恢复申请；仍无法恢复时请联系平台管理员。',
          showCancel: false
        })
        return
      }
      this.loading = true
      let redirectPending = false
      try {
        const result = applyManualVerificationExchange(await exchangeManualVerificationApplication(this.tracking.applicationId, this.tracking.trackingToken))
        if (result.status === 'account_conflict') {
          openPage('/pages/account-conflict/index')
          return
        }
        if (result.status === 'account_exists') {
          clearManualVerificationTracking()
          this.tracking = null
          uni.showModal({ title: '实名身份已有账号', content: '无需重复注册，请直接使用已有湖财人账号登录。', showCancel: false, success: () => openPage('/pages/verify/index') })
          return
        }
        if (result.status === 'registration_verified') {
          this.stopStatusPolling()
          uni.showToast({ title: '审核凭证已领取', icon: 'success' })
          redirectPending = true
          setTimeout(() => uni.redirectTo({
            url: '/pages/register/index?manual=1',
            fail: () => {
              redirectPending = false
              this.loading = false
              uni.showModal({
                title: '页面跳转失败',
                content: '审核凭证已经领取，请重新进入人工实名认证页面继续设置平台账号。',
                showCancel: false
              })
            }
          }), 450)
          return
        }
        throw new Error('审核凭证返回状态无效，请刷新申请后重试')
      } catch (error) {
        uni.showModal({ title: '领取凭证失败', content: error.message || '请稍后重试', showCancel: false })
      } finally {
        if (!redirectPending) this.loading = false
      }
    },
    openLogin() { openPage('/pages/verify/index') },
    startAgain() {
      uni.showModal({
        title: '重新提交人工认证',
        content: '上一份申请及其证明材料将被安全清理，请确认已阅读审核说明。',
        confirmText: '重新填写',
        confirmColor: '#033481',
        success: async (result) => {
          if (!result.confirm) return
          this.loading = true
          try {
            if (this.application?.status !== 'cancelled' && this.tracking) {
              await cancelManualVerificationApplication(
                this.tracking.applicationId,
                this.tracking.trackingToken
              )
            }
            clearManualVerificationTracking()
            this.stopStatusPolling()
            this.tracking = null
            this.application = null
            this.materials = []
          } catch (error) {
            uni.showModal({ title: '清理旧申请失败', content: error.message || '请稍后重试', showCancel: false })
          } finally {
            this.loading = false
          }
        }
      })
    }
  }
}
</script>

<style scoped>
.manual-page{padding-top:16rpx}
.manual-hero{position:relative;min-height:370rpx;padding:36rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#0b315f,#073d7c 62%,#20609d);box-shadow:0 22rpx 48rpx rgba(11,58,130,.2)}
.manual-hero__logo{width:250rpx;height:56rpx}
.manual-hero__eyebrow,.manual-hero__title,.manual-hero__desc{position:relative;z-index:2;display:block}
.manual-hero__eyebrow{margin-top:22rpx;color:#e3c88f;font-size:16rpx;font-weight:700;letter-spacing:3rpx}
.manual-hero__title{margin-top:9rpx;font-size:39rpx;font-weight:700}
.manual-hero__desc{max-width:590rpx;margin-top:10rpx;color:rgba(255,255,255,.7);font-size:20rpx;line-height:1.65}
.manual-hero__steps{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:27rpx;padding-top:18rpx;display:flex;justify-content:space-between;border-top:1rpx solid rgba(255,255,255,.15);color:#ead6aa;font-size:18rpx}
.manual-hero__seal{position:absolute;right:20rpx;top:-44rpx;color:rgba(255,255,255,.055);font-family:"STKaiti","KaiTi",serif;font-size:270rpx;font-weight:700}
.policy-card{position:relative;z-index:3;margin:-16rpx 18rpx 20rpx;padding:23rpx;display:flex;align-items:flex-start}
.policy-card__icon{width:58rpx;height:58rpx;margin-right:16rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#176551;background:#e4f1ec;font-size:20rpx;font-weight:700}
.policy-card>view:last-child{min-width:0;flex:1}
.policy-card text{display:block}
.policy-card text:first-child{color:#354359;font-size:22rpx;font-weight:700}
.policy-card text:last-child{margin-top:6rpx;color:#8791a0;font-size:18rpx;line-height:1.6}
.form-card,.supplement-card{padding:28rpx}
.form-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18rpx;padding-bottom:18rpx;border-bottom:1rpx solid #edf0f4}
.form-section-head text:first-child{color:#2d3c52;font-size:26rpx;font-weight:700}
.form-section-head text:last-child{color:#929aa6;font-size:17rpx}
.form-grid{margin-top:22rpx;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20rpx 16rpx}
.field-group{min-width:0}
.field-group--wide{grid-column:1/-1}
.field-label{display:block;margin:0 4rpx 9rpx;color:#59667a;font-size:20rpx;font-weight:600}
.field-box{height:82rpx;padding:0 18rpx;display:flex;align-items:center;border:1rpx solid #dde3ec;border-radius:20rpx;background:#f8f9fb}
.field-box:focus-within,.textarea-box:focus-within{border-color:#597caf;background:#fff;box-shadow:0 0 0 5rpx rgba(3,52,129,.06)}
.field-box input{min-width:0;flex:1;height:80rpx;color:#243149;font-size:22rpx}
.field-toggle{padding:14rpx 0 14rpx 18rpx;color:#64758d;font-size:19rpx}
.textarea-box{padding:16rpx 18rpx;border:1rpx solid #dde3ec;border-radius:20rpx;background:#f8f9fb}
.textarea-box textarea{width:100%;height:150rpx;color:#243149;font-size:21rpx;line-height:1.65}
.material-head{margin-top:32rpx}
.material-hints{margin-top:18rpx;display:flex;flex-wrap:wrap;gap:9rpx}
.material-hints text{padding:7rpx 12rpx;border-radius:99rpx;color:#66748a;background:#eff3f7;font-size:17rpx}
.material-toolbar{margin-top:18rpx;display:grid;grid-template-columns:minmax(0,1fr) 220rpx;gap:12rpx}
.picker-box{height:76rpx;padding:0 18rpx;display:flex;align-items:center;justify-content:space-between;border:1rpx solid #dde3ec;border-radius:19rpx;color:#49576d;background:#f8f9fb;font-size:20rpx}
.choose-button{height:76rpx;margin:0;line-height:76rpx}
.material-grid{margin-top:16rpx;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12rpx}
.material-preview{position:relative;min-width:0;padding:10rpx;border-radius:18rpx;background:#f3f6fa}
.material-preview image{width:100%;height:170rpx;border-radius:13rpx;background:#e6ebf1}
.material-preview text:nth-child(2){display:block;margin:8rpx 3rpx 2rpx;overflow:hidden;color:#4c5a70;font-size:17rpx;text-overflow:ellipsis;white-space:nowrap}
.material-preview text:last-child{position:absolute;right:16rpx;top:16rpx;padding:6rpx 10rpx;border-radius:99rpx;color:#fff;background:rgba(125,48,45,.85);font-size:15rpx}
.consent-row{margin-top:24rpx;display:flex;align-items:flex-start;color:#657286;font-size:18rpx;line-height:1.6}
.consent-row view{width:34rpx;height:34rpx;margin:1rpx 12rpx 0 0;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2rpx solid #aab4c3;border-radius:9rpx;color:#fff}
.consent-row .consent-check--active{border-color:#176551;background:#176551}
.submit-button{margin-top:25rpx}
.text-button{height:66rpx;margin:10rpx auto 0;padding:0 20rpx;color:#62738c;background:transparent;font-size:20rpx;line-height:66rpx}
.status-card{padding:24rpx;display:flex;align-items:center}
.status-card__badge{min-width:76rpx;height:58rpx;padding:0 12rpx;display:flex;align-items:center;justify-content:center;border-radius:18rpx;font-size:18rpx;font-weight:700}
.status-card__badge--success{color:#176551;background:#e4f1ec}
.status-card__badge--danger{color:#984740;background:#f8e5e3}
.status-card__badge--warning{color:#876327;background:#f5e9d1}
.status-card__badge--blue{color:#033481;background:#e7eef9}
.status-card__badge--neutral{color:#647286;background:#edf1f5}
.status-card__copy{min-width:0;flex:1;margin-left:16rpx}
.status-card__copy text{display:block}
.status-card__copy text:first-child{color:#344258;font-size:24rpx;font-weight:700}
.status-card__copy text:last-child{margin-top:5rpx;color:#8b95a4;font-size:18rpx;line-height:1.5}
.refresh-button{width:110rpx;height:58rpx;margin:0 0 0 12rpx;padding:0;border-radius:17rpx;color:#033481;background:#e9eff8;font-size:18rpx;line-height:58rpx}
.application-card{margin-top:18rpx;padding:0 24rpx}
.application-card__head{padding:21rpx 0 14rpx;display:flex;justify-content:space-between;border-bottom:1rpx solid #edf0f4}
.application-card__head text:first-child{font-size:23rpx;font-weight:700}
.application-card__head text:last-child{color:#8994a3;font-size:16rpx}
.application-row{min-height:74rpx;display:flex;align-items:center;justify-content:space-between;border-bottom:1rpx solid #edf0f4;font-size:20rpx}
.application-row:last-child{border-bottom:none}
.application-row text:first-child{color:#7c8798}
.application-row text:last-child{max-width:430rpx;color:#2e3b50;font-weight:600;text-align:right}
.review-note{margin-top:18rpx;padding:22rpx;color:#816029;background:#fffaf0}
.review-note--danger{color:#934a45;background:#fff5f3}
.review-note text{display:block}
.review-note text:first-child{font-size:22rpx;font-weight:700}
.review-note text:last-child{margin-top:7rpx;font-size:19rpx;line-height:1.65}
.supplement-card{margin-top:18rpx}
.register-action{margin-top:22rpx}
.result-guide,.login-guide{margin-top:18rpx;padding:23rpx}.result-guide{display:flex;align-items:flex-start;background:linear-gradient(105deg,#fff,#edf4fb)}.result-guide__icon{width:54rpx;height:54rpx;margin-right:15rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:18rpx;color:#033481;background:#dfeaf7;font-size:19rpx;font-weight:700}.result-guide>view:last-child{min-width:0;flex:1}.result-guide text,.approved-next__copy text,.login-guide__step view text{display:block}.result-guide text:first-child{color:#304159;font-size:22rpx;font-weight:700}.result-guide text:last-child{margin-top:6rpx;color:#758297;font-size:18rpx;line-height:1.65}.approved-next{margin-top:20rpx;padding:28rpx;border:2rpx solid rgba(23,101,81,.18);text-align:center}.approved-next__mark{width:68rpx;height:68rpx;margin:0 auto;display:flex;align-items:center;justify-content:center;border-radius:23rpx;color:#fff;background:#176551;font-size:30rpx;font-weight:700}.approved-next__copy{margin-top:17rpx}.approved-next__copy text:first-child{color:#2c3f4e;font-size:26rpx;font-weight:700}.approved-next__copy text:last-child{max-width:610rpx;margin:8rpx auto 0;color:#728195;font-size:19rpx;line-height:1.7}.approved-next .register-action{margin-top:22rpx}.login-action{margin-top:12rpx}.login-guide{background:#f7f9fc}.login-guide__step{display:flex;align-items:flex-start;padding:15rpx 0}.login-guide__step>text{width:44rpx;height:44rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:15rpx;color:#80602c;background:#f1e3c8;font-size:17rpx;font-weight:700}.login-guide__step view{min-width:0;flex:1}.login-guide__step view text:first-child{color:#37465b;font-size:21rpx;font-weight:700}.login-guide__step view text:last-child{margin-top:4rpx;color:#8490a0;font-size:17rpx;line-height:1.6}.login-guide__button{margin-top:8rpx;color:#033481}
.draft-recovery{margin-top:18rpx;padding:23rpx;display:flex;align-items:center;gap:18rpx}.draft-recovery>view{min-width:0;flex:1}.draft-recovery text{display:block}.draft-recovery text:first-child{color:#5f4824;font-size:22rpx;font-weight:700}.draft-recovery text:last-child{margin-top:5rpx;color:#887a68;font-size:18rpx;line-height:1.6}.draft-recovery button{width:240rpx;margin:0;flex-shrink:0}
@media screen and (min-width:768px){.form-card,.supplement-card{padding:36px}.form-grid{gap:22px 18px}.material-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.material-preview image{height:150px}.manual-hero__title{font-size:46px}.manual-hero__desc{max-width:760px}.policy-card{margin-left:28px;margin-right:28px}}
@media screen and (min-width:1200px){.manual-hero{min-height:330px;padding:42px 48px}.manual-hero__logo{width:250px;height:56px}.manual-hero__eyebrow{margin-top:20px;font-size:14px}.manual-hero__title{margin-top:10px;font-size:44px}.manual-hero__desc{margin-top:12px;font-size:17px}.manual-hero__steps{left:48px;right:48px;bottom:30px;padding-top:18px;font-size:15px}.policy-card{margin:-18px 36px 24px;padding:20px 24px}.form-card,.supplement-card,.status-card,.application-card,.review-note,.result-guide,.draft-recovery,.approved-next,.login-guide{max-width:980px;margin-left:auto;margin-right:auto}.status-card{margin-top:0}.form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.field-label{font-size:15px}.field-box{height:58px}.field-box input{height:56px;font-size:16px}.textarea-box textarea{height:120px;font-size:15px}.form-section-head text:first-child{font-size:20px}.form-section-head text:last-child{font-size:13px}}
@media screen and (max-width:360px){.manual-hero{padding-left:26rpx;padding-right:26rpx}.manual-hero__steps{left:26rpx;right:26rpx}.form-card,.supplement-card{padding:23rpx}.form-grid{grid-template-columns:1fr}.field-group--wide{grid-column:auto}.material-toolbar{grid-template-columns:1fr}.material-grid{grid-template-columns:1fr}.status-card{align-items:flex-start;flex-wrap:wrap}.refresh-button{margin-top:12rpx}.draft-recovery{align-items:stretch;flex-direction:column}.draft-recovery button{width:100%}}
</style>
