<template>
  <view class="page-shell password-page">
    <view class="password-heading">
      <text class="password-kicker">ACCOUNT SECURITY</text>
      <text class="password-title">{{ required ? '先设置你自己的密码' : '修改账号密码' }}</text>
      <text class="password-description">{{ required ? '当前账号使用临时密码。无论是否已通过实名校验，都需先修改密码，再继续使用湖财人。' : '验证当前密码后，设置新的个人密码。请不要使用学校统一认证密码。' }}</text>
    </view>
    <view class="surface password-card">
      <text class="password-account">当前账号：{{ user.username || user.realName || '正在确认登录状态' }}</text>
      <template v-if="ready">
        <view class="password-field"><text>{{ required ? '当前临时密码' : '当前密码' }}</text><input v-model="currentPassword" password maxlength="128" autocomplete="current-password" placeholder="请输入当前密码" :disabled="saving" /></view>
        <view class="password-field"><text>新密码</text><input v-model="newPassword" password maxlength="128" autocomplete="new-password" placeholder="至少 8 位，建议混合字母、数字与符号" :disabled="saving" /></view>
        <view class="password-field"><text>再次输入新密码</text><input v-model="confirmPassword" password maxlength="128" autocomplete="new-password" placeholder="请再输入一次新密码" :disabled="saving" confirm-type="done" @confirm="submit" /></view>
        <text class="password-note">修改成功后，所有设备上的旧登录状态将失效，请使用新密码重新登录。密码仅用于本次请求，不会保存在本机。</text>
      </template>
      <text v-if="error" class="password-error" role="alert">{{ error }}</text>
      <button v-if="ready" class="primary-button" :loading="saving" :disabled="saving" @tap="submit">确认修改密码</button>
      <button v-else class="primary-button" :loading="loading" :disabled="loading" @tap="load">{{ loading ? '确认登录状态中' : '重新确认登录状态' }}</button>
      <button v-if="ready && !required" class="ghost-button password-signout" :disabled="saving" @tap="returnToProfile">取消并返回个人资料</button>
      <button class="ghost-button password-signout" :disabled="saving" @tap="signOut">退出并返回登录</button>
    </view>
  </view>
</template>

<script>
import { getAccessToken, getPlatformUser } from '../../utils/store'
import { initialPasswordError } from '../../utils/passwordChange'
import { openPage } from '../../utils/nav'
import { refreshPlatformProfile, changeInitialPassword, completeInitialPasswordChange, logoutPlatformAccount } from '../../services/schoolAuth'

export default {
  data() { return { user: {}, currentPassword: '', newPassword: '', confirmPassword: '', error: '', ready: false, loading: false, saving: false, ownerToken: '', generation: 0, active: false, completing: false } },
  computed: { required() { return this.user.mustChangePassword === true } },
  onLoad() { uni.$on('hufe-auth-changed', this.authChanged); uni.$on('hufe:auth-changed', this.authChanged) },
  onShow() { this.active = true; this.load() },
  onBackPress() { return this.required || this.saving },
  onHide() { this.stop() },
  onUnload() { this.stop(); uni.$off('hufe-auth-changed', this.authChanged); uni.$off('hufe:auth-changed', this.authChanged) },
  methods: {
    clearPasswords() { this.currentPassword = ''; this.newPassword = ''; this.confirmPassword = '' },
    stop() { this.active = false; this.generation++; this.clearPasswords(); this.saving = false; this.loading = false },
    authChanged() {
      if (this.completing || !this.active || getAccessToken() === this.ownerToken) return
      this.generation++; this.clearPasswords(); this.ready = false; this.saving = false; this.loading = false
      this.load()
    },
    async load() {
      if (!this.active || this.loading) return
      const token = getAccessToken()
      if (!token) { this.clearPasswords(); this.ready = false; uni.reLaunch({ url: '/pages/verify/index' }); return }
      if (this.ownerToken !== token) this.clearPasswords()
      this.ownerToken = token
      const generation = ++this.generation
      this.loading = true; this.error = ''; this.ready = false
      try {
        await refreshPlatformProfile()
        if (!this.active || generation !== this.generation || token !== getAccessToken()) return
        this.user = getPlatformUser()
        this.ready = true
      } catch (error) {
        if (this.active && generation === this.generation && token === getAccessToken()) this.error = error.message || '暂时无法确认账号状态，请重试。'
      } finally { if (generation === this.generation) this.loading = false }
    },
    async submit() {
      if (this.saving || !this.ready || !this.active) return
      const token = this.ownerToken
      if (!token || token !== getAccessToken()) { this.authChanged(); return }
      const values = { currentPassword: this.currentPassword, newPassword: this.newPassword, confirmPassword: this.confirmPassword }
      this.error = initialPasswordError(values)
      if (this.error) return
      const generation = this.generation
      this.saving = true
      try {
        await changeInitialPassword({ ...values, token })
        if (!this.active || generation !== this.generation || token !== getAccessToken()) return
        this.completing = true
        this.clearPasswords()
        if (completeInitialPasswordChange(token)) uni.reLaunch({ url: '/pages/verify/index?changed=1' })
      } catch (error) {
        if (this.active && generation === this.generation && token === getAccessToken()) {
          this.error = error.message || '修改未完成，请核对当前密码后重试。'
          this.clearPasswords()
        }
      } finally { if (generation === this.generation) { this.saving = false; this.completing = false } }
    },
    returnToProfile() { if (this.saving || this.required) return; this.clearPasswords(); openPage('/pages/profile/index') },
    async signOut() {
      if (this.saving) return
      if (getAccessToken() !== this.ownerToken) { this.authChanged(); return }
      this.completing = true; this.generation++; this.clearPasswords()
      const signingOut = logoutPlatformAccount()
      // 本地退出立即完成，不等待网络，也不让迟到响应打断后来登录的新账号。
      uni.reLaunch({ url: '/pages/verify/index' })
      await signingOut
      this.completing = false
    }
  }
}
</script>

<style scoped>
.password-page{max-width:680px;padding-top:36rpx}.password-heading{padding:22rpx 8rpx 30rpx}.password-kicker,.password-title,.password-description{display:block}.password-kicker{color:#947747;font-size:20rpx;letter-spacing:3rpx}.password-title{margin-top:12rpx;font-size:40rpx;font-weight:700;color:#12376c}.password-description{margin-top:16rpx;font-size:25rpx;line-height:1.7;color:#69758a}.password-card{padding:32rpx}.password-account{display:block;padding-bottom:24rpx;border-bottom:1rpx solid #edf0f5;font-size:26rpx;font-weight:650;overflow-wrap:anywhere}.password-field{margin-top:26rpx}.password-field>text{display:block;color:#55637a;font-size:24rpx;margin-bottom:12rpx}.password-field input{width:100%;height:88rpx;border:1rpx solid #dce3ef;border-radius:18rpx;padding:0 22rpx;background:#f8fafe;font-size:25rpx}.password-note{display:block;margin:26rpx 0;color:#6f7b8f;font-size:22rpx;line-height:1.7}.password-error{display:block;margin:24rpx 0;padding:18rpx;border-radius:14rpx;color:#a73535;background:#fff1f0;font-size:24rpx;line-height:1.6;overflow-wrap:anywhere}.password-signout{margin-top:22rpx;width:100%}.password-card>.primary-button{margin-top:24rpx}.primary-button[disabled]{opacity:.6}@media(min-width:1024px){.password-page{padding-top:40px}.password-card{padding:32px}.password-heading{padding-bottom:28px}}
</style>
