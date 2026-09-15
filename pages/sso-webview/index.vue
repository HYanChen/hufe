<template>
  <view class="sso-page">
    <web-view v-if="authorizeUrl" :src="authorizeUrl" />
    <view v-else class="sso-error">
      <view class="sso-error__icon">!</view>
      <text>学校实名校验通道尚未完成正式配置或地址无效，系统已停止跳转，请返回注册页。</text>
      <SupportFooter />
    </view>
  </view>
</template>

<script>
import { appConfig } from '../../config/index'
import { isOfficialRegistrationAuthorizeUrl } from '../../services/schoolAuth'

export default {
  data() { return { authorizeUrl: '' } },
  onLoad(options) {
    const value = decodeURIComponent(options.url || '')
    const allowedPrefixes = [
      `${appConfig.apiBaseUrl}/api/v1/auth/registration/start`,
      `${appConfig.apiBaseUrl}/api/v1/auth/sso/start`
    ]
    const allowed = appConfig.schoolRegistrationReady
      && isOfficialRegistrationAuthorizeUrl(value)
      && allowedPrefixes.some((prefix) => prefix && value.startsWith(prefix))
    this.authorizeUrl = allowed ? value : ''
  }
}
</script>

<style scoped>
.sso-page{min-height:100vh;background:#f4f6fa}.sso-error{padding:180rpx 50rpx calc(48rpx + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;color:#758095;font-size:24rpx}.sso-error__icon{width:80rpx;height:80rpx;margin-bottom:24rpx;display:flex;align-items:center;justify-content:center;border-radius:26rpx;color:#fff;background:#954a47;font-size:38rpx;font-weight:700}
</style>
