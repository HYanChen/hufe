<template>
  <view class="page-shell account-page">
    <view class="account-hero">
      <image class="account-hero__logo" :src="logoUrl" mode="aspectFit" />
      <text class="account-hero__eyebrow">HUFE PEOPLE ACCOUNT</text>
      <text class="account-hero__title">{{ verified ? '湖财人账号' : '登录湖财人' }}</text>
      <text class="account-hero__desc">{{ verified ? signedInDescription : '使用湖财人平台用户名和密码登录，不跳转学校官网。' }}</text>
      <text class="account-hero__watermark">HUFE</text>
    </view>

    <template v-if="verified">
      <view class="signed-card surface">
        <view class="signed-card__status">✓</view>
        <view class="signed-card__body">
          <text class="signed-card__label">当前登录账号</text>
          <text class="signed-card__name">{{ user.realName }}</text>
          <text class="signed-card__meta">{{ roleLabel }} · {{ user.department || '湖南财政经济学院' }}</text>
        </view>
      </view>
      <view class="section-head"><view><text class="section-title">{{ developmentVerifiedFixture ? '模拟实名资料' : (localDemoUser ? '演示账号资料' : '实名资料') }}</text><text class="section-kicker">{{ developmentVerifiedFixture ? 'DEVELOPMENT VERIFIED FIXTURE' : (localDemoUser ? 'LOCAL DEVELOPMENT ONLY' : (manualVerified ? 'VERIFIED BY REVIEW' : 'VERIFIED AT REGISTRATION')) }}</text></view><text class="readonly-tag">{{ localDemoUser ? '本机演示' : '已通过校验' }}</text></view>
      <view class="profile-card surface">
        <view v-for="row in profileRows" :key="row.label" class="profile-row">
          <text class="profile-row__label">{{ row.label }}</text><text class="profile-row__value">{{ row.value || '学校未下发' }}</text>
        </view>
      </view>
      <button class="primary-button action-button" @tap="openCard">查看湖财身份卡</button>
      <button class="ghost-button action-button" :loading="loading" :disabled="loading" @tap="signOut">退出当前账号</button>
    </template>

    <template v-else>
      <view class="login-card surface">
        <view class="field-group">
          <text class="field-label">用户名</text>
          <view class="field-box"><text class="field-icon">账</text><input v-model.trim="username" maxlength="32" placeholder="请输入湖财人平台用户名" confirm-type="next" autocomplete="username" /></view>
        </view>
        <view class="field-group">
          <text class="field-label">密码</text>
          <view class="field-box"><text class="field-icon">密</text><input v-model="password" :password="!showPassword" maxlength="72" placeholder="请输入平台账号密码" confirm-type="done" autocomplete="current-password" @confirm="submit" /><text class="field-toggle" @tap="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</text></view>
        </view>
        <button class="primary-button login-button" :loading="loading" :disabled="loading || !canSubmit" @tap="submit">登录</button>
      </view>

      <view class="register-entry surface">
        <view class="register-entry__icon">新</view>
        <view class="register-entry__body"><text class="register-entry__title">第一次使用湖财人？</text><text class="register-entry__desc">新用户需先跳转学校官网完成一次实名校验，再设置平台用户名和密码。</text></view>
        <button class="register-entry__button" @tap="openRegister">注册</button>
      </view>

      <view class="security-note">
        <text class="security-note__title">两套密码互不混用</text>
        <text class="security-note__desc">日常登录只使用湖财人平台账号。学校官网账号和密码仅在新用户注册实名校验时由学校页面处理，本应用不会读取或保存学校密码。</text>
      </view>
    </template>
    <SupportFooter />
  </view>
</template>

<script>
import { appConfig } from '../../config/index'
import { isManualVerification, manualVerificationDescription } from '../../utils/identityVerification'
import { getUser, getAccessToken, identityLabel, isVerified } from '../../utils/store'
import { enforceInitialPasswordChange } from '../../utils/passwordChange'
import { loginPlatformAccount, logoutPlatformAccount } from '../../services/schoolAuth'
import { openPage } from '../../utils/nav'

export default {
  data() {
    return {
      logoUrl: appConfig.officialLogoUrl,
      user: {},
      verified: false,
      username: '',
      password: '',
      showPassword: false,
      loading: false,
      localDevelopment: appConfig.localDevelopment
    }
  },
  computed: {
    manualVerified() { return isManualVerification(this.user) },
    roleLabel() { return identityLabel(this.user.personType) },
    localDemoUser() { return this.localDevelopment && this.user.localDevelopmentOnly === true },
    developmentVerifiedFixture() {
      return this.localDemoUser && this.user.developmentSchoolIdentityFixture === true
    },
    signedInDescription() {
      if (this.developmentVerifiedFixture) return '学校实名校验已完成（开发演示），以下资料为本机模拟同步数据。'
      if (this.manualVerified) return manualVerificationDescription(this.user)
      if (this.user.schoolIdentityVerified === true) return '学校实名校验已完成，以下资料由学校身份信息同步。'
      return this.localDemoUser
        ? '本地演示账号已登录，仅用于功能体验，不代表学校实名已校验。'
        : '当前平台账号已登录。'
    },
    canSubmit() {
      const username = this.username.trim()
      const formal = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]{1,31}$/u.test(username) && this.password.length >= 8
      const localDemo = this.localDevelopment
        && /^[\p{L}\p{N}_][\p{L}\p{N}_.-]{1,31}$/u.test(username)
        && (/^\d{6}$/.test(this.password) || this.password.length >= 8)
      return formal || localDemo
    },
    profileRows() {
      return [
        { label: '姓名', value: this.user.realName },
        { label: '人员类型', value: this.roleLabel },
        { label: '学院 / 部门', value: this.user.department },
        { label: '学工号', value: this.user.studentIdDisplay || this.user.studentIdMasked },
        { label: '校友编号', value: this.user.alumniNo }
      ]
    }
  },
  onLoad(options = {}) {
    this.username = String(options.username || '').slice(0, 32)
    uni.$on('hufe-auth-changed', this.handleAuthChanged)
    if (options.registered === '1') setTimeout(() => uni.showToast({ title: '注册成功，请登录', icon: 'none' }), 250)
    if (options.changed === '1') setTimeout(() => uni.showToast({ title: '密码已修改，请使用新密码登录', icon: 'none' }), 250)
  },
  onShow() { this.load(); enforceInitialPasswordChange() },
  onUnload() { uni.$off('hufe-auth-changed', this.handleAuthChanged) },
  methods: {
    load() { this.user = getUser(); this.verified = isVerified() },
    handleAuthChanged(result) {
      this.load()
      if (result?.status === 'account_conflict') openPage('/pages/account-conflict/index')
    },
    async submit() {
      if (this.loading) return
      if (!this.canSubmit) {
        uni.showToast({ title: this.localDevelopment ? '请输入有效账号；演示密码可为 6 位数字' : '请输入有效用户名和至少 8 位密码', icon: 'none' })
        return
      }
      this.loading = true
      try {
        const result = await loginPlatformAccount({ username: this.username, password: this.password })
        if (result.status === 'account_conflict') {
          openPage('/pages/account-conflict/index')
          return
        }
        this.password = ''
        this.load()
        if (enforceInitialPasswordChange()) return
        const token = getAccessToken()
        uni.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => { if (token === getAccessToken() && !enforceInitialPasswordChange()) uni.switchTab({ url: '/pages/mine/index' }) }, 450)
      } catch (error) {
        if (error.code === 'ACCOUNT_CONFLICT') {
          uni.showModal({
            title: '账号唯一性校验未通过',
            content: '该实名身份存在多个有效平台账号，当前登录已阻止。请通过注册实名校验入口确认本人身份并注销多余账号。',
            confirmText: '去处理', confirmColor: '#9A403B',
            success: (result) => { if (result.confirm) this.openRegister() }
          })
          return
        }
        const message = ['INVALID_CREDENTIALS', 'ACCOUNT_OR_PASSWORD_INVALID'].includes(error.code)
          ? '用户名或密码错误'
          : (error.message || '请稍后重试')
        uni.showModal({ title: '登录失败', content: message, showCancel: false })
      } finally { this.loading = false }
    },
    openRegister() { openPage('/pages/register/index') },
    openCard() { openPage('/pages/card/index') },
    signOut() {
      uni.showModal({
        title: '退出账号', content: '退出后可使用平台用户名和密码重新登录，无需再次前往学校官网校验。', confirmColor: '#033481',
        success: async (result) => {
          if (!result.confirm) return
          this.loading = true
          await logoutPlatformAccount()
          this.load()
          this.loading = false
          uni.showToast({ title: '已退出' })
        }
      })
    }
  }
}
</script>

<style scoped>
.account-page{padding-top:16rpx}.account-hero{position:relative;min-height:310rpx;padding:38rpx 34rpx;overflow:hidden;border-radius:36rpx;color:#fff;background:linear-gradient(140deg,#033481 0%,#033481 58%,#18579e 100%);box-shadow:0 22rpx 48rpx rgba(11,58,130,.2)}.account-hero__logo{width:250rpx;height:56rpx}.account-hero__eyebrow,.account-hero__title,.account-hero__desc{position:relative;z-index:2;display:block}.account-hero__eyebrow{margin-top:24rpx;color:#e2c68d;font-size:16rpx;font-weight:700;letter-spacing:2rpx}.account-hero__title{margin-top:10rpx;font-size:40rpx;font-weight:700}.account-hero__desc{max-width:570rpx;margin-top:10rpx;color:rgba(255,255,255,.72);font-size:20rpx;line-height:1.65}.account-hero__watermark{position:absolute;right:24rpx;bottom:10rpx;color:rgba(255,255,255,.08);font-family:Georgia,serif;font-size:64rpx;font-weight:700;letter-spacing:4rpx}
.login-card{position:relative;z-index:3;margin:-20rpx 18rpx 0;padding:30rpx}.field-group+.field-group{margin-top:24rpx}.field-label{display:block;margin:0 4rpx 10rpx;color:#59667a;font-size:21rpx;font-weight:600}.field-box{height:88rpx;padding:0 20rpx;display:flex;align-items:center;border:1rpx solid #dde3ec;border-radius:22rpx;background:#f8f9fb}.field-box:focus-within{border-color:#597caf;background:#fff;box-shadow:0 0 0 5rpx rgba(3,52,129,.06)}.field-icon{width:45rpx;color:#033481;font-size:20rpx;font-weight:700}.field-box input{flex:1;height:86rpx;color:#243149;font-size:24rpx}.field-toggle{padding:16rpx 0 16rpx 20rpx;color:#6f7e93;font-size:20rpx}.login-button{margin-top:32rpx}.login-button[disabled]{opacity:.58}
.register-entry{margin-top:24rpx;padding:24rpx;display:flex;align-items:center}.register-entry__icon{width:60rpx;height:60rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:20rpx;color:#87632b;background:#f5ead6;font-size:22rpx;font-weight:700}.register-entry__body{flex:1;min-width:0;margin-left:18rpx}.register-entry__title,.register-entry__desc{display:block}.register-entry__title{font-size:24rpx;font-weight:650}.register-entry__desc{margin-top:5rpx;color:#858f9e;font-size:19rpx;line-height:1.55}.register-entry__button{width:100rpx;height:58rpx;margin:0 0 0 14rpx;padding:0;border-radius:18rpx;color:#033481;background:#e9eff9;font-size:21rpx;line-height:58rpx;font-weight:650}.security-note{margin:28rpx 10rpx;padding:22rpx 24rpx;border-left:5rpx solid #c2a26b;color:#737e8f;background:#f8f4ec;border-radius:0 20rpx 20rpx 0}.security-note__title,.security-note__desc{display:block}.security-note__title{color:#6e552d;font-size:22rpx;font-weight:650}.security-note__desc{margin-top:8rpx;font-size:19rpx;line-height:1.7}
.signed-card{position:relative;z-index:3;margin:-18rpx 18rpx 0;padding:26rpx;display:flex;align-items:center}.signed-card__status{width:62rpx;height:62rpx;display:flex;align-items:center;justify-content:center;border-radius:21rpx;color:#fff;background:#176551;font-size:26rpx;font-weight:700}.signed-card__body{margin-left:18rpx}.signed-card__label,.signed-card__name,.signed-card__meta{display:block}.signed-card__label{color:#949caa;font-size:18rpx}.signed-card__name{margin-top:3rpx;font-size:28rpx;font-weight:700}.signed-card__meta{margin-top:5rpx;color:#748095;font-size:20rpx}.readonly-tag{padding:7rpx 14rpx;border-radius:99rpx;color:#176551;background:#e7f2ed;font-size:18rpx}.profile-card{padding:0 28rpx}.profile-row{min-height:92rpx;padding:18rpx 0;display:flex;align-items:center;border-bottom:1rpx solid #edf0f4}.profile-row:last-child{border-bottom:none}.profile-row__label{width:180rpx;color:#778296;font-size:21rpx}.profile-row__value{flex:1;color:#26344a;font-size:23rpx;font-weight:600;text-align:right}.action-button{margin-top:24rpx}.ghost-button.action-button{width:100%;height:80rpx;line-height:80rpx}
</style>
