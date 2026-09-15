<template>
  <view class="page-shell register-page">
    <view class="register-hero">
      <image class="register-hero__logo" :src="logoUrl" mode="aspectFit" />
      <text class="register-hero__eyebrow">NEW USER REGISTRATION</text>
      <text class="register-hero__title">新用户实名注册</text>
      <text class="register-hero__desc">学校官网仅用于确认师生、教职工或校友实名身份；校验完成后返回本页设置独立的平台账号。</text>
      <view class="steps">
        <view v-for="(item,index) in steps" :key="item" class="step" :class="{ 'step--active': stepIndex >= index }"><text>{{ index + 1 }}</text><view></view><text>{{ item }}</text></view>
      </view>
    </view>

    <view v-if="!['registration_verified','account_exists'].includes(phase) && (!registrationReady || phase === 'configuration_pending')" class="phase-card configuration-card surface">
      <view class="phase-icon phase-icon--configuration">配</view>
      <text class="phase-title">{{ configurationCopy.title }}</text>
      <text class="phase-desc">{{ configurationCopy.description }}</text>
      <view class="configuration-note">
        <text>{{ configurationCopy.noteTitle }}</text>
        <text>{{ configurationCopy.note }}</text>
      </view>
      <button v-if="configurationCopy.canRetry" class="primary-button phase-button" :loading="loading" :disabled="loading" @tap="beginVerification">{{ configurationCopy.action }}</button>
      <button v-else class="primary-button phase-button" disabled>{{ configurationCopy.action }}</button>
      <button class="text-button" :loading="configurationLoading" :disabled="configurationLoading" @tap="refreshRegistrationConfiguration">重新检查配置状态</button>
      <button class="text-button" @tap="openLogin">已有平台账号，直接登录</button>
    </view>

    <view v-else-if="phase === 'idle' || phase === 'failed' || phase === 'expired'" class="phase-card surface">
      <view class="phase-icon">校</view>
      <text class="phase-title">先完成学校官网实名校验</text>
      <text class="phase-desc">系统将跳转湖南财政经济学院官方页面。请在学校页面完成登录校验，湖财人不会接触学校账号密码。</text>
      <view class="scope-row"><text v-for="item in roles" :key="item">{{ item }}</text></view>
      <view v-if="phase !== 'idle'" class="error-note">上次校验未完成或已过期，请重新发起。</view>
      <button class="primary-button phase-button" :loading="loading" :disabled="loading" @tap="beginVerification">前往学校官网校验</button>
      <button class="text-button" @tap="openLogin">已有平台账号，直接登录</button>
    </view>

    <view v-else-if="phase === 'pending'" class="phase-card surface">
      <view class="phase-icon phase-icon--pending">…</view>
      <text class="phase-title">等待官网校验结果</text>
      <text class="phase-desc">完成学校页面操作后请返回湖财人，再点击下方按钮获取实名校验结果。</text>
      <view class="pending-note"><text>注册校验中</text><text>校验结果仅可用于本次注册，不能直接登录平台。</text></view>
      <button class="primary-button phase-button" :loading="loading" :disabled="loading" @tap="checkVerification">我已完成官网校验</button>
      <button class="text-button" :disabled="loading" @tap="beginVerification">重新发起校验</button>
    </view>

    <view v-else-if="phase === 'account_exists'" class="phase-card surface">
      <view class="phase-icon phase-icon--exists">✓</view>
      <text class="phase-title">该实名身份已有平台账号</text>
      <text class="phase-desc">无需重复注册，请使用既有湖财人用户名和密码登录。忘记用户名或密码时请联系平台管理员处理。</text>
      <button class="primary-button phase-button" @tap="openLogin">返回平台账号登录</button>
      <button class="text-button" @tap="beginVerification">重新校验其他身份</button>
    </view>

    <template v-else-if="phase === 'registration_verified'">
      <view class="verified-card surface">
        <view class="verified-card__status">✓</view>
        <view class="verified-card__body"><text class="verified-card__title">学校实名校验通过</text><text class="verified-card__desc">一次性注册凭证已签发，请在有效期内完成平台账号注册。</text></view>
      </view>
      <view v-if="identity" class="identity-card surface">
        <view class="identity-card__head"><text>学校实名资料</text><text>由学校认证结果自动回填，不支持手工修改</text></view>
        <view v-for="row in identityRows" :key="row.label" class="identity-row" :class="{ 'identity-row--missing': row.required && !row.value }"><text>{{ row.label }}</text><text>{{ row.value || '学校未下发' }}</text></view>
      </view>
      <view v-if="!identityComplete" class="identity-warning surface">
        <text class="identity-warning__title">实名资料不完整，暂不能注册</text>
        <text>学校回调必须同时提供真实姓名和学院 / 部门。请联系平台管理员检查统一认证属性映射后重新校验。</text>
      </view>
      <view v-else class="identity-confirm surface" @tap="identityConfirmed = !identityConfirmed">
        <view class="identity-confirm__checkbox" :class="{ 'identity-confirm__checkbox--checked': identityConfirmed }">{{ identityConfirmed ? '✓' : '' }}</view>
        <text>我确认以上真实姓名与学院 / 部门信息属于本人</text>
      </view>

      <view v-if="identityComplete" class="section-head"><view><text class="section-title">设置平台账号</text><text class="section-kicker">CREATE HUCAIREN ACCOUNT</text></view></view>
      <view v-if="identityComplete" class="form-card surface">
        <view class="field-group"><text class="field-label">用户名</text><view class="field-box"><input v-model.trim="username" maxlength="32" placeholder="4–32 位字母、数字或 . _ -" autocomplete="username" /></view></view>
        <view class="field-group"><text class="field-label">平台密码</text><view class="field-box"><input v-model="password" :password="!showPassword" maxlength="72" placeholder="至少 8 位" autocomplete="new-password" /><text class="field-toggle" @tap="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</text></view></view>
        <view class="field-group"><text class="field-label">确认平台密码</text><view class="field-box"><input v-model="confirmPassword" :password="!showPassword" maxlength="72" placeholder="再次输入平台密码" autocomplete="new-password" @confirm="submitRegistration" /></view></view>
        <view class="password-tip" :class="{ 'password-tip--ok': passwordValid }"><text>{{ passwordValid ? '✓' : 'i' }}</text><text>密码至少 8 位，建议同时包含字母、数字和符号；请勿与学校官网密码相同。</text></view>
        <button class="primary-button register-button" :loading="loading" :disabled="loading || !formValid" @tap="submitRegistration">完成注册</button>
      </view>
    </template>
    <view v-if="phase !== 'registration_verified'" class="manual-entry surface" @tap="openManualVerification">
      <view class="manual-entry__icon">核</view>
      <view class="manual-entry__copy"><text>无法使用学校官网校验？</text><text>早期毕业、无学校数字账号的老校友，可提交材料申请人工复核。</text></view>
      <text class="manual-entry__arrow">申请 ›</text>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import { appConfig } from '../../config/index'
import { clearRegistrationVerification, identityLabel, readAuthState, readRegistrationVerification } from '../../utils/store'
import {
  isRegistrationBrowserBindingError,
  isRegistrationConfigurationError,
  isRegistrationPlatformBindingError,
  getRegistrationConfiguration,
  registerPlatformAccount,
  resumeRegistrationVerification,
  startRegistrationVerification
} from '../../services/schoolAuth'
import { clearManualVerificationTracking } from '../../services/manualVerification'
import { openPage } from '../../utils/nav'

export default {
  data() {
    return {
      logoUrl: appConfig.officialLogoUrl,
      phase: 'idle',
      identity: null,
      registrationToken: '',
      registrationExpiresAt: '',
      username: '',
      password: '',
      confirmPassword: '',
      showPassword: false,
      loading: false,
      registrationReady: false,
      configurationLoading: false,
      configurationIssueCode: '',
      configurationIssueMessage: '',
      identityConfirmed: false,
      returnHint: '',
      manualFlow: false,
      roles: ['在校学生', '教师', '教职工', '校友'],
      steps: ['官网校验', '设置账号', '完成注册']
    }
  },
  computed: {
    stepIndex() { return this.phase === 'registration_verified' ? 1 : 0 },
    passwordValid() { return this.password.length >= 8 },
    usernameValid() { return /^[A-Za-z0-9_][A-Za-z0-9_.-]{3,31}$/.test(this.username) },
    identityComplete() {
      const source = this.identity || {}
      return Boolean(String(source.name || source.realName || '').trim() && String(source.department || source.college || '').trim())
    },
    formValid() { return this.identityComplete && this.identityConfirmed && this.usernameValid && this.passwordValid && this.password === this.confirmPassword && Boolean(this.registrationToken) },
    configurationCopy() {
      if (this.configurationIssueCode === 'REGISTRATION_PLATFORM_BINDING_UNAVAILABLE') {
        return {
          title: '当前客户端尚未开通安全回跳',
          description: this.configurationIssueMessage || 'App / 小程序不能直接复用 H5 的浏览器绑定，当前服务端已停止创建该端注册事务。',
          noteTitle: '可行的处理方式',
          note: '请先使用学校正式 H5 站点完成首次实名注册，或联系管理员完成微信业务域名 / 小程序回跳、App Universal Link / App Link 验收后再开放。为避免实名身份错绑，系统不会降级到仅凭轮询令牌换票。',
          action: '请使用正式 H5 或联系管理员',
          canRetry: false
        }
      }
      if (['REGISTRATION_BROWSER_BINDING_REQUIRED', 'REGISTRATION_BROWSER_BINDING_MISMATCH'].includes(this.configurationIssueCode)) {
        return {
          title: '本次校验与当前浏览器不匹配',
          description: this.configurationIssueMessage || '发起实名校验时的安全 Cookie 已缺失或不一致，服务端已拒绝换取注册凭证。',
          noteTitle: '请在同一浏览器重新发起',
          note: '请允许本站点 Cookie，并从当前正式 H5 页重新开始。如果仍失败，请联系管理员确认 H5 与 API 使用同站 HTTPS 部署，且响应允许携带凭据。',
          action: '重新发起安全校验',
          canRetry: true
        }
      }
      return {
        title: this.configurationLoading ? '正在检查学校校验通道' : '学校实名校验暂未启用',
        description: this.configurationIssueMessage || '管理员需在后台“学校实名校验配置”中保存参数、检查并启用。localhost 不能作为学校正式回调地址。',
        noteTitle: '配置完成后的流程',
        note: '点击校验将直接进入湖南财政经济学院登录页；登录成功后返回本页，自动显示真实姓名、学院 / 部门及学校获准下发的脱敏学工号、身份证号。',
        action: '等待管理员完成配置',
        canRetry: false
      }
    },
    identityRows() {
      const source = this.identity || {}
      return [
        { label: '真实姓名', value: source.name || source.realName, required: true },
        { label: '学院 / 部门', value: source.department || source.college, required: true },
        { label: '人员类型', value: identityLabel(source.personType) },
        { label: '学号 / 工号（脱敏）', value: source.studentIdMasked },
        { label: '身份证号（脱敏）', value: source.idCardMasked },
        { label: '校友编号', value: source.alumniNo }
      ].filter((row) => row.required || row.value)
    }
  },
  onLoad(options = {}) {
    this.manualFlow = options.manual === '1'
    this.returnHint = options.registration_status || options.registration_session || options.sso_status || options.sso_session || ''
    uni.$on('hufe-registration-changed', this.handleRegistrationChanged)
  },
  onShow() {
    this.loadState()
    this.refreshRegistrationConfiguration()
    if (this.phase === 'pending') this.checkVerification(true)
  },
  onUnload() { uni.$off('hufe-registration-changed', this.handleRegistrationChanged) },
  methods: {
    async refreshRegistrationConfiguration() {
      if (this.configurationLoading) return
      this.configurationLoading = true
      try {
        const state = await getRegistrationConfiguration()
        this.registrationReady = state.ready === true
        if (this.registrationReady) {
          if (!['REGISTRATION_PLATFORM_BINDING_UNAVAILABLE', 'REGISTRATION_BROWSER_BINDING_REQUIRED', 'REGISTRATION_BROWSER_BINDING_MISMATCH'].includes(this.configurationIssueCode)) {
            this.configurationIssueCode = ''
            this.configurationIssueMessage = ''
            if (this.phase === 'configuration_pending') this.phase = 'idle'
          }
        } else {
          this.configurationIssueMessage = state.message || '学校实名校验通道尚未启用'
        }
      } catch {
        this.registrationReady = false
        this.configurationIssueMessage = '暂时无法读取学校校验配置，请检查网络后重试；人工实名认证入口仍可使用。'
      } finally { this.configurationLoading = false }
    },
    applyRegistrationConfigurationError(error) {
      this.phase = 'configuration_pending'
      this.configurationIssueCode = error?.code || 'REGISTRATION_AUTH_NOT_READY'
      this.configurationIssueMessage = error?.message || ''
      if (!isRegistrationPlatformBindingError(error) && !isRegistrationBrowserBindingError(error)) this.registrationReady = false
    },
    loadState() {
      const auth = readAuthState()
      const verification = readRegistrationVerification()
      this.registrationExpiresAt = verification?.expiresAt || ''
      if (verification?.status === 'registration_verified' && this.ticketExpired()) {
        this.expireVerification()
        return
      }
      if (auth.conflict?.context === 'registration') {
        openPage('/pages/account-conflict/index')
        return
      }
      this.phase = verification?.status || (auth.pendingSession ? 'pending' : 'idle')
      this.registrationToken = verification?.registrationToken || verification?.registrationTicket || ''
      const nextIdentity = verification?.identity || verification?.verifiedIdentity || null
      const currentSignature = `${this.identity?.schoolSubject || ''}|${this.identity?.name || this.identity?.realName || ''}|${this.identity?.department || this.identity?.college || ''}`
      const nextSignature = `${nextIdentity?.schoolSubject || ''}|${nextIdentity?.name || nextIdentity?.realName || ''}|${nextIdentity?.department || nextIdentity?.college || ''}`
      if (currentSignature !== nextSignature) this.identityConfirmed = false
      this.identity = nextIdentity
      if (!this.identityComplete) this.identityConfirmed = false
    },
    handleRegistrationChanged(result) {
      if (result?.status === 'account_conflict') {
        openPage('/pages/account-conflict/index')
        return
      }
      this.loadState()
    },
    ticketExpired() {
      return !this.registrationExpiresAt || !Number.isFinite(Date.parse(this.registrationExpiresAt)) || Date.parse(this.registrationExpiresAt) <= Date.now()
    },
    expireVerification() {
      clearRegistrationVerification()
      this.phase = 'expired'
      this.registrationToken = ''
      this.registrationExpiresAt = ''
      this.identity = null
      this.identityConfirmed = false
      this.password = ''
      this.confirmPassword = ''
      uni.showModal({
        title: '注册凭证已失效',
        content: this.manualFlow ? '人工审核结果仍然有效，请返回人工认证页面，点击“继续设置平台账号”重新领取凭证，无需重新提交材料。' : '请重新完成学校实名校验，再设置平台账号。',
        showCancel: false,
        success: () => { if (this.manualFlow) uni.redirectTo({ url: '/pages/manual-verification/index' }) }
      })
    },
    async beginVerification() {
      if (this.loading) return
      this.identityConfirmed = false
      this.loading = true
      try {
        await startRegistrationVerification()
        this.phase = 'pending'
      } catch (error) {
        if (isRegistrationConfigurationError(error)) {
          this.applyRegistrationConfigurationError(error)
          return
        }
        uni.showModal({ title: '无法发起实名校验', content: error.message || '请稍后重试', showCancel: false })
      } finally { this.loading = false }
    },
    async checkVerification(silent = false) {
      if (this.loading) return
      this.loading = !silent
      try {
        const result = await resumeRegistrationVerification()
        this.loadState()
        if (result.status === 'registration_verified') {
          uni.showToast({ title: '实名校验通过', icon: 'success' })
        } else if (result.status === 'account_exists') {
          uni.showToast({ title: '已有平台账号', icon: 'none' })
        } else if (result.status === 'account_conflict') {
          openPage('/pages/account-conflict/index')
        } else if (!silent && result.status === 'pending') {
          uni.showToast({ title: '官网校验尚未完成', icon: 'none' })
        } else if (['failed', 'expired'].includes(result.status)) {
          uni.showModal({ title: '校验未完成', content: result.error?.message || '请重新发起官网实名校验', showCancel: false })
        }
      } catch (error) {
        if (isRegistrationConfigurationError(error)) {
          this.applyRegistrationConfigurationError(error)
          return
        }
        if (!silent) uni.showModal({ title: '获取校验结果失败', content: error.message || '请稍后重试', showCancel: false })
      } finally { this.loading = false }
    },
    async submitRegistration() {
      if (this.loading) return
      if (!this.registrationToken || this.ticketExpired()) { this.expireVerification(); return }
      if (!this.usernameValid) {
        uni.showToast({ title: '用户名格式不正确', icon: 'none' })
        return
      }
      if (!this.passwordValid || this.password !== this.confirmPassword) {
        uni.showToast({ title: '请检查两次输入的密码', icon: 'none' })
        return
      }
      this.loading = true
      try {
        const result = await registerPlatformAccount({ username: this.username, password: this.password, registrationToken: this.registrationToken })
        if (result.status === 'account_conflict') {
          openPage('/pages/account-conflict/index')
          return
        }
        if (this.manualFlow) clearManualVerificationTracking()
        this.password = ''
        this.confirmPassword = ''
        uni.showToast({ title: '注册成功', icon: 'success' })
        setTimeout(() => {
          if (result.accessToken) uni.switchTab({ url: '/pages/mine/index' })
          else uni.redirectTo({ url: `/pages/verify/index?registered=1&username=${encodeURIComponent(this.username)}` })
        }, 550)
      } catch (error) {
        if (['REGISTRATION_TICKET_INVALID', 'REGISTRATION_TICKET_EXPIRED'].includes(error.code)) {
          this.expireVerification()
          return
        }
        const message = error.code === 'USERNAME_TAKEN' ? '该用户名已被使用，请更换' : (error.message || '请稍后重试')
        uni.showModal({ title: '注册失败', content: message, showCancel: false })
      } finally { this.loading = false }
    },
    openLogin() { uni.redirectTo({ url: '/pages/verify/index' }) },
    openManualVerification() { openPage('/pages/manual-verification/index') }
  }
}
</script>

<style scoped>
.register-page{padding-top:16rpx}.register-hero{position:relative;min-height:390rpx;padding:36rpx 34rpx;overflow:hidden;border-radius:36rpx;color:#fff;background:linear-gradient(140deg,#033481 0%,#0b407f 64%,#1c609f 100%);box-shadow:0 22rpx 48rpx rgba(11,58,130,.2)}.register-hero__logo{width:250rpx;height:56rpx}.register-hero__eyebrow,.register-hero__title,.register-hero__desc{display:block}.register-hero__eyebrow{margin-top:22rpx;color:#e2c68d;font-size:16rpx;font-weight:700;letter-spacing:2rpx}.register-hero__title{margin-top:9rpx;font-size:38rpx;font-weight:700}.register-hero__desc{max-width:610rpx;margin-top:9rpx;color:rgba(255,255,255,.7);font-size:20rpx;line-height:1.6}.steps{margin-top:28rpx;display:flex}.step{position:relative;flex:1;color:rgba(255,255,255,.42);font-size:17rpx;text-align:center}.step>text:first-child{width:38rpx;height:38rpx;margin:0 auto;display:flex;align-items:center;justify-content:center;border:1rpx solid rgba(255,255,255,.25);border-radius:50%;font-size:17rpx;font-weight:700}.step>view{position:absolute;top:18rpx;left:-50%;width:100%;height:1rpx;background:rgba(255,255,255,.18)}.step:first-child>view{display:none}.step>text:last-child{display:block;margin-top:7rpx}.step--active{color:#efd7a5}.step--active>text:first-child{border-color:#d8b56f;color:#674e24;background:#e3c581}.step--active>view{background:#d0ad6a}
.phase-card{position:relative;z-index:2;margin:-18rpx 18rpx 0;padding:42rpx 32rpx;text-align:center}.phase-icon{width:84rpx;height:84rpx;margin:0 auto;display:flex;align-items:center;justify-content:center;border-radius:28rpx;color:#033481;background:#e7eef9;font-size:30rpx;font-weight:700}.phase-icon--pending{color:#85632c;background:#f5ead7}.phase-icon--exists{color:#176551;background:#e4f1ec}.phase-icon--configuration{color:#85632c;background:#f5ead7}.phase-title,.phase-desc{display:block}.phase-title{margin-top:24rpx;font-size:30rpx;font-weight:700}.phase-desc{max-width:560rpx;margin:12rpx auto 0;color:#7d8899;font-size:21rpx;line-height:1.7}.scope-row{margin-top:22rpx;display:flex;justify-content:center;gap:10rpx}.scope-row text{padding:7rpx 13rpx;border-radius:99rpx;color:#586881;background:#f0f3f7;font-size:17rpx}.error-note{margin-top:20rpx;color:#974642;font-size:20rpx}.phase-button{margin-top:30rpx}.text-button{height:66rpx;margin:14rpx auto 0;padding:0 20rpx;color:#62738c;background:transparent;font-size:21rpx;line-height:66rpx}.pending-note,.configuration-note{margin-top:24rpx;padding:20rpx;border-radius:20rpx;background:#f8f4ec;text-align:left}.pending-note text,.configuration-note text{display:block}.pending-note text:first-child,.configuration-note text:first-child{color:#7a5b27;font-size:21rpx;font-weight:650}.pending-note text:last-child,.configuration-note text:last-child{margin-top:5rpx;color:#8b806d;font-size:18rpx;line-height:1.6}.configuration-card .phase-button[disabled]{color:#897c66;background:#e8dfcf;opacity:1}
.verified-card{position:relative;z-index:2;margin:-18rpx 18rpx 0;padding:25rpx;display:flex;align-items:center}.verified-card__status{width:62rpx;height:62rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:21rpx;color:#fff;background:#176551;font-size:25rpx;font-weight:700}.verified-card__body{margin-left:18rpx}.verified-card__title,.verified-card__desc{display:block}.verified-card__title{font-size:25rpx;font-weight:700}.verified-card__desc{margin-top:5rpx;color:#7e8999;font-size:19rpx;line-height:1.5}.identity-card{margin-top:20rpx;padding:0 25rpx}.identity-card__head{padding:22rpx 0 14rpx;border-bottom:1rpx solid #edf0f4}.identity-card__head text{display:block}.identity-card__head text:first-child{color:#314a64;font-size:23rpx;font-weight:700}.identity-card__head text:last-child{margin-top:5rpx;color:#8894a4;font-size:17rpx}.identity-row{min-height:78rpx;display:flex;align-items:center;justify-content:space-between;border-bottom:1rpx solid #edf0f4;font-size:21rpx}.identity-row:last-child{border-bottom:none}.identity-row text:first-child{color:#7b8697}.identity-row text:last-child{max-width:430rpx;color:#28364d;font-weight:600;text-align:right}.identity-row--missing text:last-child{color:#a24d47}.identity-warning,.identity-confirm{margin-top:18rpx;padding:22rpx 25rpx}.identity-warning{color:#8b4743;background:#fff4f2}.identity-warning text{display:block;font-size:19rpx;line-height:1.65}.identity-warning__title{margin-bottom:5rpx;font-size:22rpx!important;font-weight:700}.identity-confirm{display:flex;align-items:center;color:#45546a;font-size:20rpx;line-height:1.5}.identity-confirm__checkbox{width:34rpx;height:34rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2rpx solid #aab4c3;border-radius:9rpx;color:#fff;font-size:20rpx}.identity-confirm__checkbox--checked{border-color:#176551;background:#176551}.form-card{padding:28rpx}.field-group+.field-group{margin-top:22rpx}.field-label{display:block;margin:0 4rpx 10rpx;color:#59667a;font-size:21rpx;font-weight:600}.field-box{height:86rpx;padding:0 20rpx;display:flex;align-items:center;border:1rpx solid #dde3ec;border-radius:22rpx;background:#f8f9fb}.field-box:focus-within{border-color:#597caf;background:#fff;box-shadow:0 0 0 5rpx rgba(3,52,129,.06)}.field-box input{flex:1;height:84rpx;color:#243149;font-size:23rpx}.field-toggle{padding:16rpx 0 16rpx 20rpx;color:#6f7e93;font-size:20rpx}.password-tip{margin-top:18rpx;display:flex;align-items:flex-start;color:#8a7a61;font-size:18rpx;line-height:1.55}.password-tip text:first-child{width:30rpx;height:30rpx;margin-right:9rpx;display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;background:#aa8a52;font-size:16rpx}.password-tip--ok{color:#4e756a}.password-tip--ok text:first-child{background:#26725e}.register-button{margin-top:26rpx}.register-button[disabled]{opacity:.56}
.manual-entry{margin:22rpx 18rpx 0;padding:23rpx;display:flex;align-items:center}.manual-entry__icon{width:60rpx;height:60rpx;margin-right:16rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:20rpx;color:#7d5d29;background:#f3e6ce;font-size:22rpx;font-weight:700}.manual-entry__copy{min-width:0;flex:1}.manual-entry__copy text{display:block}.manual-entry__copy text:first-child{color:#354359;font-size:23rpx;font-weight:700}.manual-entry__copy text:last-child{margin-top:5rpx;color:#87919f;font-size:18rpx;line-height:1.5}.manual-entry__arrow{margin-left:12rpx;color:#033481;font-size:19rpx;font-weight:650}
</style>
