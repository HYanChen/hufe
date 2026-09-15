<template>
  <view class="page-shell with-sticky-action conflict-page">
    <view class="conflict-hero">
      <view class="conflict-hero__icon">!</view>
      <text class="conflict-hero__eyebrow">ACCOUNT UNIQUENESS CHECK</text>
      <text class="conflict-hero__title">发现多个有效账号</text>
      <text class="conflict-hero__desc">学校实名身份必须与平台账号一一对应。本次新用户注册已暂停，请先完成账号清理。</text>
    </view>

    <view v-if="conflict" class="conflict-summary surface">
      <text class="conflict-summary__number">{{ conflict.accountCount || accounts.length }}</text>
      <view><text class="conflict-summary__title">个同身份有效账号</text><text class="conflict-summary__desc">唯一性校验未通过，当前不会创建新账号</text></view>
    </view>

    <view class="section-head"><view><text class="section-title">选择保留的账号</text><text class="section-kicker">KEEP ONE ACCOUNT</text></view></view>
    <view v-if="accounts.length" class="account-list">
      <view v-for="account in accounts" :key="account.id" class="account-card surface" :class="{ 'account-card--selected': selectedId === account.id }" @tap="selectedId = account.id">
        <view class="account-radio">{{ selectedId === account.id ? '✓' : '' }}</view>
        <view class="account-card__body">
          <view class="account-card__title-row"><text class="account-card__title">{{ account.maskedName }}</text><text class="account-card__role">{{ roleLabel(account.personType) }}</text></view>
          <text class="account-card__meta">{{ account.department || '部门信息未下发' }} · {{ account.studentIdMasked || '学工号未下发' }}</text>
          <text class="account-card__time">上次登录：{{ formatTime(account.lastLoginAt) }}</text>
        </view>
      </view>
    </view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">!</view><text>冲突信息已失效，请返回重新发起注册实名校验。</text></view>

    <view class="resolution-note surface">
      <text class="resolution-note__title">处理规则</text>
      <text class="resolution-note__item">1. 保留一个：注销其余账号，然后使用保留账号的用户名和密码登录。</text>
      <text class="resolution-note__item">2. 重新注册：注销全部旧账号，返回注册页设置新的平台用户名和密码。</text>
      <text class="resolution-note__warning">注销操作不可撤销，后台将保留完整审计记录。</text>
    </view>

    <view class="secondary-actions">
      <button class="recreate-button" :loading="saving === 'recreate'" :disabled="Boolean(saving)" @tap="confirmRecreate">注销全部旧账号并重新注册</button>
    </view>

    <SupportFooter />
    <view class="sticky-action">
      <button class="primary-button" :loading="saving === 'keep_existing'" :disabled="Boolean(saving) || !selectedId" @tap="confirmKeep">保留选中账号，注销其余账号</button>
    </view>
  </view>
</template>

<script>
import { identityLabel, readAuthState } from '../../utils/store'
import { resolveAccountConflict } from '../../services/schoolAuth'

export default {
  data() { return { conflict: null, accounts: [], selectedId: '', saving: '' } },
  onShow() {
    const conflict = readAuthState().conflict
    this.conflict = conflict
    this.accounts = conflict?.accounts || []
    if (!this.accounts.some((item) => item.id === this.selectedId)) this.selectedId = this.accounts[0]?.id || ''
  },
  methods: {
    roleLabel(type) { return identityLabel(type) },
    formatTime(value) {
      if (!value) return '无记录'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      const pad = (number) => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
    confirmKeep() {
      if (!this.selectedId || this.saving) return
      uni.showModal({
        title: '确认注销多余账号',
        content: '除选中账号外，其他有效账号将立即注销且不可撤销。',
        confirmText: '确认处理', confirmColor: '#9A403B',
        success: (result) => { if (result.confirm) this.resolve('keep_existing', this.selectedId) }
      })
    },
    confirmRecreate() {
      if (this.saving) return
      uni.showModal({
        title: '确认重新注册',
        content: '全部旧账号将注销，处理完成后需返回注册页设置新的平台用户名和密码。',
        confirmText: '注销并新建', confirmColor: '#9A403B',
        success: (result) => { if (result.confirm) this.resolve('recreate') }
      })
    },
    async resolve(action, keepAccountId = '') {
      this.saving = action
      try {
        const result = await resolveAccountConflict({ action, keepAccountId })
        uni.showToast({ title: '账号唯一性已恢复', icon: 'success' })
        setTimeout(() => {
          const url = result.status === 'registration_verified' ? '/pages/register/index' : '/pages/verify/index'
          uni.redirectTo({ url })
        }, 600)
      } catch (error) {
        uni.showModal({ title: '处理失败', content: error.message || '请重新登录后再试', showCancel: false })
      } finally { this.saving = '' }
    }
  }
}
</script>

<style scoped>
.conflict-page{padding-top:16rpx}.conflict-hero{padding:42rpx 34rpx;border-radius:36rpx;color:#fff;background:linear-gradient(140deg,#612f31,#8b3e3e 60%,#a4564d);box-shadow:0 22rpx 48rpx rgba(105,43,43,.2)}.conflict-hero__icon{width:66rpx;height:66rpx;display:flex;align-items:center;justify-content:center;border:1rpx solid rgba(255,255,255,.35);border-radius:22rpx;color:#6d3b28;background:#efd19c;font-size:34rpx;font-weight:800}.conflict-hero__eyebrow,.conflict-hero__title,.conflict-hero__desc{display:block}.conflict-hero__eyebrow{margin-top:24rpx;color:#eccf9d;font-size:17rpx;font-weight:700;letter-spacing:3rpx}.conflict-hero__title{margin-top:10rpx;font-size:40rpx;font-weight:700}.conflict-hero__desc{margin-top:12rpx;color:rgba(255,255,255,.7);font-size:21rpx;line-height:1.7}
.conflict-summary{position:relative;z-index:2;margin:-18rpx 18rpx 0;padding:24rpx;display:flex;align-items:center}.conflict-summary__number{width:68rpx;color:#943f3c;font-family:Georgia,serif;font-size:48rpx;font-weight:700;text-align:center}.conflict-summary__title,.conflict-summary__desc{display:block}.conflict-summary__title{font-size:25rpx;font-weight:650}.conflict-summary__desc{margin-top:5rpx;color:#8791a0;font-size:19rpx}.account-list{display:flex;flex-direction:column;gap:18rpx}.account-card{padding:24rpx;display:flex;align-items:center}.account-card--selected{border-color:rgba(11,58,130,.45);box-shadow:0 12rpx 34rpx rgba(11,58,130,.13)}.account-radio{width:42rpx;height:42rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2rpx solid #b7bfcb;border-radius:50%;color:#fff;font-size:20rpx}.account-card--selected .account-radio{border-color:#033481;background:#033481}.account-card__body{flex:1;margin-left:18rpx}.account-card__title-row{display:flex;align-items:center}.account-card__title{font-size:27rpx;font-weight:650}.account-card__role{margin-left:12rpx;padding:5rpx 12rpx;border-radius:99rpx;color:#755722;background:#f5e8d0;font-size:17rpx}.account-card__meta,.account-card__time{display:block}.account-card__meta{margin-top:9rpx;color:#667287;font-size:20rpx}.account-card__time{margin-top:6rpx;color:#9aa2ae;font-size:18rpx}
.resolution-note{margin-top:28rpx;padding:26rpx}.resolution-note__title,.resolution-note__item,.resolution-note__warning{display:block}.resolution-note__title{font-size:25rpx;font-weight:650}.resolution-note__item{margin-top:13rpx;color:#657187;font-size:20rpx;line-height:1.65}.resolution-note__warning{margin-top:17rpx;padding-top:16rpx;border-top:1rpx solid #eceff4;color:#994541;font-size:19rpx}.secondary-actions{margin-top:22rpx}.recreate-button{height:82rpx;border:1rpx solid #e1c3c0;border-radius:22rpx;color:#94433f;background:#f9ecea;font-size:23rpx;line-height:82rpx}.primary-button[disabled],.recreate-button[disabled]{opacity:.55}
</style>
