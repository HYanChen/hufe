<template>
  <view class="page-shell card-page">
    <template v-if="verified">
      <view class="alumni-card">
        <view class="alumni-card__ring alumni-card__ring--one"></view>
        <view class="alumni-card__ring alumni-card__ring--two"></view>
        <view class="alumni-card__head">
          <view class="alumni-card__brand">
            <view class="alumni-card__emblem"><image :src="logoUrl" mode="aspectFit" /></view>
            
          </view>
          <text class="card-status">● {{ developmentVerifiedFixture ? '模拟实名档案' : '实名已验证' }}</text>
        </view>
        <view class="alumni-card__identity">
          <text class="alumni-card__label">SCHOOL IDENTITY</text>
          <text class="alumni-card__name">{{ user.realName }}</text>
          <text class="alumni-card__meta">{{ roleLabel }} · {{ user.department || '湖南财政经济学院' }}</text>
          <text class="alumni-card__meta">{{ verificationDescription }}</text>
        </view>
        <view class="alumni-card__foot">
          <view><text class="alumni-card__number-label">本人学工号</text><text class="alumni-card__number">{{ identityNumber }}</text><text v-if="user.alumniNo" class="alumni-card__number-label card-alumni-number">校友编号：{{ user.alumniNo }}</text></view>
          <text class="alumni-card__initials">{{ user.initials }}</text>
        </view>
      </view>

      <view v-if="isModuleEnabled('gate')" class="verify-panel surface">
        <view class="verify-panel__head">
          <view><text class="verify-panel__title">平台返校身份核验</text><text class="verify-panel__desc">二维码每5秒自动更新，请向核验人员出示本页</text></view>
          <view class="live-dot" :class="{'live-dot--paused':!qrUrl}"><text></text>{{ qrUrl ? '动态更新' : '待生成' }}</view>
        </view>
        <view class="gate-code-zone">
          <image v-if="qrUrl && remaining > 0" class="gate-qr" :src="qrUrl" mode="aspectFit" aria-label="平台返校身份动态二维码" />
          <view v-else class="gate-qr-empty">{{ issuing ? '正在生成安全核验码…' : '暂无有效二维码' }}</view>
          <text class="gate-countdown">{{ qrUrl ? `${refreshRemaining} 秒后更新` : developmentVerifiedFixture ? '演示档案不签发正式核验码' : '核验码仅向正式实名账号签发' }}</text>
          <text class="gate-hint">扫码后还需核验人员现场核对本人身份并明确确认。</text>
        </view>
        <text v-if="gateError" class="gate-card-error" role="alert">{{ gateError }}</text>
        <button class="secondary-button refresh-button" :disabled="issuing || !canIssue" @tap="issuePass">{{ issuing ? '正在更新…' : '刷新动态二维码' }}</button>
        <button v-if="qrUrl && remaining > 0" class="gate-copy" @tap="copyPass">无法扫码？复制临时核验码</button>
      </view>

      <view class="section-head"><view><text class="section-title">身份卡管理</text><text class="section-kicker">CARD CONTROLS</text></view></view>
      <view class="control-list surface">
        <view class="control-row">
          <view class="control-row__icon">验</view>
          <view class="control-row__body"><text class="control-row__title">实名资料</text><text class="control-row__desc">{{ verificationDescription }}</text></view>
          <button class="mini-action" @tap="openVerify">查看</button>
        </view>
        <view v-if="isModuleEnabled('campus-visits')" class="divider"></view>
        <view v-if="isModuleEnabled('campus-visits')" class="control-row">
          <view class="control-row__icon control-row__icon--gold">校</view>
          <view class="control-row__body"><text class="control-row__title">返校服务</text><text class="control-row__desc">提前填写来校日期与事由</text></view>
          <button class="mini-action mini-action--gold" @tap="openVisit">去预约</button>
        </view>
      </view>

      <view v-if="isModuleEnabled('gate')" class="demo-note"><text>安全</text><text>二维码仅包含随机临时令牌，不含姓名学号；请勿转发。请由核验人员现场核对本人并明确确认。</text></view>
    </template>

    <view v-else class="unverified-card surface">
      <view class="unverified-card__icon">证</view>
      <text class="unverified-card__title">登录后查看湖财身份卡</text>
      <text class="unverified-card__desc">请使用湖财人平台用户名和密码登录；新用户注册时才需要前往学校官网完成实名校验。</text>
      <button class="primary-button unverified-card__button" @tap="openVerify">登录湖财人账号</button>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import { appConfig } from '../../config/index'
import { isManualVerification, manualVerificationDescription } from '../../utils/identityVerification'
import { getUser, identityLabel, getAccessToken } from '../../utils/store'
import { openPage } from '../../utils/nav'
import { gateApi } from '../../services/gate'
import { gateQrDataUrl, gateSeconds } from '../../utils/gateQr'
import { request } from '../../services/http'

export default {
  data() {
    return {
      user: {},
      logoUrl: appConfig.officialLogoUrl,
      verified: false, canIssue: false, issuing: false, pass: null, qrUrl: '', gateError: '', now: Date.now(), refreshAt: 0, selfStudentNumber: '', studentNumberLoading: false, visible: false, generation: 0, ownerToken: '', timer: null
    }
  },
  computed: {
    remaining() { return gateSeconds(this.pass?.expiresAt, this.now) },
    refreshRemaining() { return this.pass ? Math.max(0, Math.ceil((this.refreshAt - this.now) / 1000)) : 0 },
    verificationDescription() {
      if (this.developmentVerifiedFixture) return '学校实名校验已完成（本机开发演示）'
      return isManualVerification(this.user) ? manualVerificationDescription(this.user) : '实名身份已在注册时经学校官网校验'
    },
    roleLabel() { return identityLabel(this.user.personType) },
    developmentVerifiedFixture() {
      return this.user.localDevelopmentOnly === true
        && this.user.developmentSchoolIdentityFixture === true
    },
    identityNumber() {
      if (this.studentNumberLoading) return '正在读取本人学工号…'
      return this.selfStudentNumber || '暂未提供完整学工号'
    }
  },
  onLoad() { uni.$on('hufe-auth-changed', this.load) },
  onShow() {
    this.visible = true
    this.load()
    clearInterval(this.timer)
    this.timer = setInterval(() => { this.now = Date.now(); if (this.ownerToken !== getAccessToken()) { this.load(); return } if (this.pass && (!this.remaining || this.now >= this.refreshAt)) { this.pass = null; this.qrUrl = ''; this.issuePass() } }, 1000)
  },
  onHide() { this.stop() },
  onUnload() { this.stop(); uni.$off('hufe-auth-changed', this.load) },
  methods: {
    stop() { this.visible = false; this.generation++; clearInterval(this.timer); this.timer = null; this.pass = null; this.qrUrl = ''; this.issuing = false; this.selfStudentNumber = ''; this.studentNumberLoading = false },
    current(version, token) { return this.visible && version === this.generation && token === getAccessToken() && token === this.ownerToken },
    async load() {
      const version = ++this.generation, token = getAccessToken(); this.ownerToken = token; this.pass = null; this.qrUrl = ''; this.canIssue = false; this.gateError = ''; this.issuing = false; this.selfStudentNumber = ''; this.studentNumberLoading = false
      this.user = getUser()
      this.verified = this.user.schoolIdentityVerified === true
        || this.user.developmentSchoolIdentityFixture === true
      if (!this.visible || !token || !this.verified || this.developmentVerifiedFixture) return
      this.loadStudentNumber(version, token)
      if(!this.isModuleEnabled('gate'))return
      try { const role = await gateApi('/me', { token }); if (!this.current(version, token)) return; this.canIssue = role.canIssuePass === true; if (this.canIssue) await this.issuePass(); else this.gateError = '当前账号暂不具备正式核验码签发资格' } catch (error) { if (this.current(version, token)) this.gateError = error.message }
    },
    async loadStudentNumber(version, token) {
      if (!this.current(version, token)) return
      this.studentNumberLoading = true
      try { const result = await request({ path: '/api/v1/me/identity-card', token }); if (!this.current(version, token)) return; const number = String(result.studentIdDisplay || '').trim(); this.selfStudentNumber = number.includes('*') ? '' : number; if (Object.prototype.hasOwnProperty.call(result, 'alumniNo')) this.user = { ...this.user, alumniNo: String(result.alumniNo || '') } } catch { if (this.current(version, token)) this.selfStudentNumber = '' } finally { if (this.current(version, token)) this.studentNumberLoading = false }
    },
    async issuePass() {
      if(!this.isModuleEnabled('gate')){this.pass=null;this.qrUrl='';return}
      if (!this.visible || this.issuing || !this.canIssue || this.ownerToken !== getAccessToken()) return
      const version = this.generation, token = this.ownerToken; this.issuing = true; this.pass = null; this.qrUrl = ''; this.gateError = ''
      try { const pass = await gateApi('/passes', { method: 'POST', token, data: {} }); if (!this.current(version, token)) return; if (!gateSeconds(pass.expiresAt)) throw new Error('核验码已过期，请重试'); const image = gateQrDataUrl(pass.qrPayload); this.pass = pass; this.qrUrl = image; this.now = Date.now(); this.refreshAt = Math.min(Date.parse(pass.expiresAt), this.now + Math.min(5, Math.max(1, Number(pass.refreshIntervalSeconds) || 5)) * 1000) } catch (error) { if (this.current(version, token)) { this.gateError = error.message; if ([401,403].includes(error.statusCode)) this.canIssue = false } } finally { if (this.current(version, token)) this.issuing = false }
    },
    copyPass() {
      if (!this.visible || this.ownerToken !== getAccessToken() || !this.pass || !this.remaining) return
      uni.setClipboardData({ data: this.pass.qrPayload })
    },
    openVisit() {
      openPage('/pages/campus-visit/index')
    },
    openVerify() {
      openPage('/pages/verify/index')
    }
  }
}
</script>

<style scoped>
.card-page{padding-top:18rpx}.alumni-card{position:relative;min-height:430rpx;padding:34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(145deg,#033481 0%,#033481 54%,#1b5da5 100%);box-shadow:0 26rpx 58rpx rgba(9,47,105,.25);transition:filter .2s}.alumni-card--paused{filter:saturate(.62)}.alumni-card__ring{position:absolute;border:1rpx solid rgba(255,255,255,.12);border-radius:50%}.alumni-card__ring--one{width:390rpx;height:390rpx;right:-170rpx;top:-190rpx}.alumni-card__ring--two{width:240rpx;height:240rpx;right:40rpx;bottom:-160rpx}.alumni-card__head{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between}.alumni-card__brand{display:flex;align-items:center}.alumni-card__emblem{width:240rpx;height:52rpx;padding:0;display:flex;align-items:center;justify-content:center;border-radius:14rpx;background:transparent}.alumni-card__emblem image{width:100%;height:100%}.alumni-card__cn,.alumni-card__en{display:block;margin-left:15rpx}.alumni-card__cn{font-size:26rpx;font-weight:650}.alumni-card__en{margin-top:3rpx;color:rgba(255,255,255,.48);font-size:14rpx;letter-spacing:3rpx}.card-status{padding:8rpx 14rpx;border-radius:99rpx;color:#e9cf99;background:rgba(255,255,255,.11);font-size:17rpx;font-weight:650}.card-status--paused{color:rgba(255,255,255,.7)}
.alumni-card__identity{position:relative;z-index:2;margin-top:56rpx}.alumni-card__label,.alumni-card__name,.alumni-card__meta{display:block}.alumni-card__label{color:#dfc183;font-size:16rpx;font-weight:700;letter-spacing:4rpx}.alumni-card__name{margin-top:10rpx;font-family:serif;font-size:46rpx;font-weight:700;letter-spacing:4rpx}.alumni-card__meta{margin-top:8rpx;color:rgba(255,255,255,.62);font-size:20rpx}.alumni-card__foot{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:30rpx;padding-top:22rpx;display:flex;align-items:flex-end;justify-content:space-between;border-top:1rpx solid rgba(255,255,255,.14)}.alumni-card__number-label,.alumni-card__number{display:block}.alumni-card__number-label{color:rgba(255,255,255,.42);font-size:15rpx}.alumni-card__number{margin-top:6rpx;color:#ead4a9;font-family:Georgia,serif;font-size:22rpx;letter-spacing:2rpx}.alumni-card__initials{color:rgba(255,255,255,.16);font-family:serif;font-size:52rpx;font-weight:700}.alumni-card__mask{position:absolute;z-index:5;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(7,29,64,.58);backdrop-filter:blur(4rpx)}.alumni-card__mask text{padding:16rpx 28rpx;border:1rpx solid rgba(255,255,255,.34);border-radius:99rpx;color:#fff;font-size:25rpx;font-weight:650;letter-spacing:2rpx}
.verify-panel{margin-top:24rpx;padding:28rpx}.verify-panel__head{display:flex;align-items:flex-start;justify-content:space-between}.verify-panel__title,.verify-panel__desc{display:block}.verify-panel__title{font-size:28rpx;font-weight:700}.verify-panel__desc{margin-top:7rpx;color:#929aa8;font-size:19rpx}.live-dot{display:flex;align-items:center;color:#176551;font-size:19rpx;font-weight:650}.live-dot text{width:12rpx;height:12rpx;margin-right:8rpx;border-radius:50%;background:#21a179;box-shadow:0 0 0 7rpx rgba(33,161,121,.11)}.live-dot--paused{color:#929aa8}.live-dot--paused text{background:#a6adb8;box-shadow:none}.code-zone{margin-top:26rpx;padding:24rpx;display:flex;align-items:center;border-radius:24rpx;background:#f4f6fa}.code-zone--disabled{opacity:.72}.credential-placeholder{width:144rpx;height:144rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:1rpx dashed #b9c1cd;border-radius:16rpx;color:#8d96a4;background:#fff;font-size:42rpx;font-weight:700}.credential-placeholder text{width:74rpx;height:74rpx;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#edf0f4}.code-copy{margin-left:28rpx}.code-copy__label,.code-copy__value,.code-copy__time{display:block}.code-copy__label{color:#9a7b48;font-size:16rpx;font-weight:700;letter-spacing:3rpx}.code-copy__value{margin-top:7rpx;color:#132744;font-family:Georgia,serif;font-size:31rpx;font-weight:700;letter-spacing:2rpx}.code-copy__time{max-width:340rpx;margin-top:7rpx;color:#959dab;font-size:18rpx;line-height:1.5}.refresh-button{margin-top:22rpx}.refresh-button[disabled]{color:#9ca4b0;background:#eef1f5}
.control-list{padding:0 24rpx}.control-row{min-height:112rpx;display:flex;align-items:center}.control-row__icon{width:60rpx;height:60rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#033481;background:#e8eef8;font-size:22rpx;font-weight:700}.control-row__icon--gold{color:#846129;background:#f6ead5}.control-row__body{flex:1;margin-left:18rpx}.control-row__title,.control-row__desc{display:block}.control-row__title{font-size:24rpx;font-weight:650}.control-row__desc{margin-top:6rpx;color:#929aa7;font-size:19rpx}.mini-action{min-width:104rpx;height:58rpx;margin:0;padding:0 20rpx;border-radius:17rpx;color:#033481;background:#e9eff9;font-size:21rpx;line-height:58rpx;font-weight:650}.mini-action--gold{color:#765622;background:#f5e7cf}.demo-note{margin:30rpx 8rpx 10rpx;padding:18rpx 20rpx;display:flex;align-items:center;justify-content:center;color:#9aa1ad;font-size:18rpx}.demo-note text:first-child{margin-right:10rpx;padding:5rpx 10rpx;border-radius:99rpx;color:#87652d;background:#f4e8d4}.unverified-card{margin-top:70rpx;padding:62rpx 36rpx;text-align:center}.unverified-card__icon{width:96rpx;height:96rpx;margin:0 auto;display:flex;align-items:center;justify-content:center;border-radius:30rpx;color:#87642a;background:#f5e7cf;font-size:34rpx;font-weight:700}.unverified-card__title,.unverified-card__desc{display:block}.unverified-card__title{margin-top:26rpx;font-size:31rpx;font-weight:700}.unverified-card__desc{margin:14rpx auto 0;max-width:520rpx;color:#818b9b;font-size:22rpx;line-height:1.7}.unverified-card__button{margin-top:34rpx}
</style>
<style scoped>
.alumni-card{min-height:510rpx}.card-alumni-number{margin-top:12rpx}.alumni-card__number{max-width:100%;overflow-wrap:anywhere;letter-spacing:1rpx}.alumni-card__foot>view{min-width:0;flex:1}.alumni-card__initials{flex-shrink:0;margin-left:12rpx}
</style>
<style scoped>
.gate-code-zone{display:flex;flex-direction:column;align-items:center;margin-top:24rpx;padding:24rpx;border-radius:20rpx;background:#f4f7fb}.gate-qr{width:360rpx;height:360rpx;max-width:100%;background:#fff;image-rendering:pixelated}.gate-qr-empty{min-height:240rpx;display:flex;align-items:center;color:#7c8798;font-size:24rpx}.gate-countdown{margin-top:16rpx;font-size:24rpx;color:#184873;font-weight:650}.gate-hint{display:block;margin-top:14rpx;color:#738096;font-size:21rpx;line-height:1.7;text-align:center}.gate-card-error{display:block;margin-top:18rpx;color:#a83737;font-size:23rpx;line-height:1.6}.gate-copy{margin:18rpx 0 0;background:transparent;color:#42658b;font-size:22rpx;line-height:1.6}.gate-copy::after{border:0}.verify-panel__head>view:first-child{min-width:0;flex:1}.verify-panel__head .live-dot{flex-shrink:0;margin-left:14rpx}@media(min-width:900px){.card-page{max-width:850px;margin:auto}.gate-qr{width:280px;height:280px}}
</style>
