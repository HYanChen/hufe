<template>
  <view class="page-shell certificate-page">
    <view v-if="loading" class="certificate-state surface screen-only">
      <view class="certificate-state__icon">…</view>
      <text>正在核验学校签发记录</text>
    </view>

    <view v-else-if="loginRequired" class="certificate-state surface screen-only">
      <view class="certificate-state__icon">证</view>
      <text class="certificate-state__title">请先登录湖财人平台账号</text>
      <text class="certificate-state__desc">公益证书仅向本人展示，登录后将重新读取学校已签发记录。</text>
      <button class="primary-button" @tap="openLogin">登录查看</button>
    </view>

    <view v-else-if="error || !issuedCertificate" class="certificate-state surface screen-only">
      <view class="certificate-state__icon">证</view>
      <text class="certificate-state__title">{{ error || '该公益记录尚未签发证书' }}</text>
      <text class="certificate-state__desc">公益参与意向不等于实际捐赠，只有学校后台已签发的证书才会在这里展示。</text>
      <button class="secondary-button" @tap="openGivingRecords">返回我的公益记录</button>
    </view>

    <template v-else>
      <view class="certificate-toolbar screen-only">
        <view><text>已核验学校签发记录</text><text>证书数据来自本人公益办理记录</text></view>
        <text class="certificate-toolbar__badge">已签发</text>
      </view>

      <view class="certificate-paper" :class="`certificate-paper--${template.layout}`" :style="templateStyle">
        <view class="certificate-paper__frame">
          <image v-if="backgroundUrl" class="certificate-background" :src="backgroundUrl" mode="aspectFill" />
          <view class="certificate-brand">
            <text class="certificate-brand__school">湖南财政经济学院</text>
            <text class="certificate-brand__en">HUNAN COLLEGE OF FINANCE AND ECONOMICS</text>
          </view>

          <view class="certificate-heading">
            <text v-if="template.subtitle" class="certificate-heading__eyebrow">{{ template.subtitle }}</text>
            <text class="certificate-heading__title">{{ template.title }}</text>
            <view class="certificate-heading__line"></view>
          </view>

          <view class="certificate-statement">
            <text v-if="recipientName" class="certificate-statement__recipient">{{ recipientName }}</text>
            <text>{{ templateMessage }}</text>
          </view>

          <view class="certificate-amount">
            <text>学校确认的实际金额</text>
            <text>{{ confirmedAmountText }}</text>
          </view>

          <view class="certificate-fields">
            <view class="certificate-field certificate-field--wide">
              <text>公益项目</text>
              <text>{{ projectTitle }}</text>
            </view>
            <view class="certificate-field">
              <text>捐赠日期</text>
              <text>{{ donationDate }}</text>
            </view>
            <view class="certificate-field">
              <text>签发时间</text>
              <text>{{ issuedAt }}</text>
            </view>
            <view class="certificate-field">
              <text>证书编号</text>
              <text class="certificate-field__number">{{ certificateNumber || '待学校同步' }}</text>
            </view>
            <view class="certificate-field">
              <text>签发单位</text>
              <text>{{ issuer }}</text>
            </view>
          </view>

          <text v-if="template.signature" class="certificate-signature">{{ template.signature }}</text>
          <text v-if="issuedCertificate.note" class="certificate-note">{{ issuedCertificate.note }}</text>
          <view class="certificate-disclaimer">
            <text>非捐赠票据</text>
            <text>本证书仅用于公益参与确认，不是捐赠票据，不能作为财务、税务、抵扣或报销凭证。</text>
          </view>
        </view>
      </view>

      <view class="certificate-actions screen-only">
        <button class="secondary-button" :disabled="!certificateNumber" @tap="copyCertificateNumber">复制证书编号</button>
        <!-- #ifdef H5 -->
        <button class="primary-button" @tap="printCertificate">打印证书</button>
        <!-- #endif -->
      </view>
      <!-- #ifndef H5 -->
      <text class="screenshot-tip screen-only">可使用设备系统截图保存当前证书；如需核验，请同时提供证书编号。</text>
      <!-- #endif -->

      <view class="certificate-help surface screen-only">
        <text>证书说明</text>
        <text>意向金额不会用于证书展示；本页金额、日期、编号、签发单位和项目均只读取学校已签发证书的数据。</text>
      </view>
    </template>

    <view class="screen-only"><SupportFooter /></view>
  </view>
</template>

<script>
import { getMyGivingIntents } from '../../services/business'
import { isVerified, getAccessToken } from '../../utils/store'
import { loadAllPages } from '../../utils/authPagination'
import { openPage } from '../../utils/nav'
import { issuedCertificateTemplate, renderCertificateMessage, certificateTheme } from '../../utils/certificateTemplate'
import { resolveMediaUrl } from '../../services/media'

function firstPresent(values) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function displayEntity(value, fallback) {
  if (value && typeof value === 'object') return value.name || value.title || fallback
  return value || fallback
}

export default {
  data() {
    return {
      submissionId: '',
      submission: null,
      issuedCertificate: null,
      loading: true,
      loginRequired: false,
      error: '', generation: 0, ownerToken: '', visible: false
    }
  },
  computed: {
    template() { return issuedCertificateTemplate(this.issuedCertificate || {}) },
    templateStyle() { return certificateTheme(this.template) },
    backgroundUrl() { return resolveMediaUrl(this.template.backgroundUrl) },
    templateMessage() {
      return renderCertificateMessage(this.template.message, { recipientName: this.recipientName, projectTitle: this.projectTitle, amount: this.confirmedAmountText, donatedAt: this.donationDate })
    },
    recipientName() {
      return firstPresent([
        this.issuedCertificate?.recipientName,
        this.issuedCertificate?.donorName,
        this.issuedCertificate?.participantName
      ]) || ''
    },
    certificateNumber() {
      return String(firstPresent([
        this.issuedCertificate?.certificateNumber,
        this.issuedCertificate?.certificateNo,
        this.issuedCertificate?.number,
        this.issuedCertificate?.no
      ]) || '')
    },
    confirmedAmountText() {
      const certificate = this.issuedCertificate || {}
      const cents = firstPresent([certificate.actualAmountCents, certificate.confirmedAmountCents])
      if (cents !== undefined) return this.formatMoney(Number(cents) / 100)
      const amount = firstPresent([certificate.actualAmount, certificate.confirmedAmount, certificate.amount])
      if (amount === undefined) return '待学校同步'
      return this.formatMoney(amount)
    },
    donationDate() {
      return this.formatDate(firstPresent([
        this.issuedCertificate?.donationDate,
        this.issuedCertificate?.donatedAt,
        this.issuedCertificate?.confirmedAt
      ]), false)
    },
    issuedAt() {
      return this.formatDate(firstPresent([
        this.issuedCertificate?.issuedAt,
        this.issuedCertificate?.issueDate,
        this.issuedCertificate?.signedAt
      ]), true)
    },
    issuer() {
      return displayEntity(firstPresent([
        this.issuedCertificate?.issuer,
        this.issuedCertificate?.issuingOrganization,
        this.issuedCertificate?.issuedBy,
        this.issuedCertificate?.issuingUnit
      ]), '待学校同步')
    },
    projectTitle() {
      const certificate = this.issuedCertificate || {}
      return displayEntity(firstPresent([
        certificate.projectTitle,
        certificate.projectName,
        certificate.project
      ]), '项目名称待学校同步')
    }
  },
  onLoad(options = {}) {
    uni.$on('hufe-auth-changed', this.handleAuthChanged)
    uni.$on('hufe:auth-changed', this.handleAuthChanged)
    try {
      this.submissionId = decodeURIComponent(options.id || '')
    } catch (_) {
      this.submissionId = ''
    }
  },
  onShow() {
    this.visible = true
    this.loadCertificate()
  },
  onHide() { this.stop() },
  onUnload() { this.stop(); uni.$off('hufe-auth-changed', this.handleAuthChanged); uni.$off('hufe:auth-changed', this.handleAuthChanged) },
  methods: {
    stop() { this.visible = false; this.generation++; this.loading = false; this.submission = null; this.issuedCertificate = null },
    current(version, token, id = this.submissionId) { return this.visible && version === this.generation && token === getAccessToken() && token === this.ownerToken && id === this.submissionId },
    handleAuthChanged() {
      if (!this.visible) return
      if (getAccessToken() !== this.ownerToken || !isVerified() || this.loginRequired) this.loadCertificate()
    },
    async loadCertificate() {
      const version = ++this.generation, token = getAccessToken(), id = this.submissionId
      this.ownerToken = token
      this.loading = true
      this.error = ''
      this.loginRequired = false
      this.submission = null
      this.issuedCertificate = null
      if (!this.visible) { this.loading = false; return }
      if (!token || !isVerified()) {
        this.loginRequired = true
        this.loading = false
        return
      }
      if (!this.submissionId) {
        this.error = '缺少公益记录编号'
        this.loading = false
        return
      }
      try {
        const result = await loadAllPages(query => getMyGivingIntents(query, token), {}, () => this.current(version, token, id))
        if (!this.current(version, token, id)) return
        const submission = (result.items || []).find((item) => String(item.id) === String(id))
        if (!submission) {
          this.error = '未找到本人的公益记录'
          return
        }
        const certificate = submission.certificate
        const issued = certificate && typeof certificate === 'object' && !Array.isArray(certificate) && Object.keys(certificate).length
        if (!issued) {
          this.error = '该公益记录尚未签发证书'
          return
        }
        this.submission = submission
        this.issuedCertificate = certificate
      } catch (error) {
        if (this.current(version, token, id)) this.error = error.message || '公益证书读取失败，请稍后重试'
      } finally {
        if (this.current(version, token, id)) this.loading = false
      }
    },
    formatMoney(value) {
      const normalized = typeof value === 'string' ? value.replace(/,/g, '').trim() : value
      const amount = Number(normalized)
      if (!Number.isFinite(amount) || amount < 0) return '待学校同步'
      return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    },
    formatDate(value, includeTime) {
      if (!value) return '待学校同步'
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value)
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      const pad = (number) => String(number).padStart(2, '0')
      const dateText = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      return includeTime ? `${dateText} ${pad(date.getHours())}:${pad(date.getMinutes())}` : dateText
    },
    openLogin() { openPage('/pages/verify/index') },
    openGivingRecords() { openPage('/pages/giving/index?tab=mine') },
    copyCertificateNumber() {
      if (!this.visible || this.ownerToken !== getAccessToken() || !isVerified() || !this.issuedCertificate) return
      if (!this.certificateNumber) {
        uni.showToast({ title: '证书编号尚未同步', icon: 'none' })
        return
      }
      uni.setClipboardData({
        data: this.certificateNumber,
        success: () => uni.showToast({ title: '证书编号已复制', icon: 'none' })
      })
    },
    printCertificate() {
      if (!this.visible || this.ownerToken !== getAccessToken() || !isVerified() || !this.issuedCertificate) return
      // #ifdef H5
      if (typeof window !== 'undefined' && typeof window.print === 'function') window.print()
      // #endif
    }
  }
}
</script>

<style scoped>
.certificate-paper{background:var(--certificate-accent)!important}.certificate-paper__frame{isolation:isolate;overflow:hidden;background:var(--certificate-paper)!important;border-color:var(--certificate-accent)!important}.certificate-paper__frame:before,.certificate-paper__frame:after{border-color:var(--certificate-accent)!important}.certificate-background{position:absolute;inset:0;width:100%;height:100%;opacity:.16;z-index:-1;pointer-events:none}.certificate-brand__school,.certificate-heading__title,.certificate-statement__recipient,.certificate-amount text:last-child,.certificate-field text:last-child{color:var(--certificate-primary)!important}.certificate-heading__eyebrow,.certificate-brand__en,.certificate-field text:first-child{color:var(--certificate-accent)!important}.certificate-heading__line{background:var(--certificate-accent)!important}.certificate-heading__title,.certificate-heading__eyebrow,.certificate-brand__school{overflow-wrap:anywhere}.certificate-statement{white-space:pre-wrap;overflow-wrap:anywhere}.certificate-signature,.certificate-note{position:relative;display:block;margin-top:28rpx;color:var(--certificate-primary);white-space:pre-wrap;overflow-wrap:anywhere;font-size:22rpx;line-height:1.8}.certificate-signature{text-align:right;font-weight:600}.certificate-note{font-size:18rpx}.certificate-paper--modern{padding:0!important;padding-top:16rpx!important;border-radius:0!important}.certificate-paper--modern .certificate-paper__frame{border:0!important;border-radius:0!important;border-bottom:5rpx solid var(--certificate-accent)!important}.certificate-paper--modern .certificate-paper__frame:before,.certificate-paper--modern .certificate-paper__frame:after{display:none}
.certificate-page{padding-top:18rpx}.certificate-state{min-height:470rpx;padding:52rpx 34rpx;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.certificate-state__icon{width:94rpx;height:94rpx;display:flex;align-items:center;justify-content:center;border-radius:30rpx;color:#86632F;background:#F3E7D3;font-family:serif;font-size:34rpx;font-weight:700}.certificate-state>text{display:block}.certificate-state__title{margin-top:26rpx;color:#24364E;font-size:29rpx;font-weight:700}.certificate-state__desc{max-width:560rpx;margin-top:12rpx;color:#8993A2;font-size:20rpx;line-height:1.7}.certificate-state button{width:320rpx;margin-top:30rpx}.certificate-toolbar{margin-bottom:18rpx;padding:20rpx 24rpx;display:flex;align-items:center;justify-content:space-between;border-radius:22rpx;background:#E9F0F8}.certificate-toolbar text{display:block}.certificate-toolbar>view text:first-child{color:#154A82;font-size:22rpx;font-weight:700}.certificate-toolbar>view text:last-child{margin-top:4rpx;color:#71839A;font-size:17rpx}.certificate-toolbar__badge{padding:7rpx 13rpx;border-radius:99rpx;color:#246054;background:#D9EDE7;font-size:17rpx;font-weight:700}.certificate-paper{padding:16rpx;border-radius:32rpx;background:linear-gradient(145deg,#B58A43,#E0C58D,#9F7432);box-shadow:0 24rpx 60rpx rgba(63,48,23,.2)}.certificate-paper__frame{position:relative;min-height:980rpx;padding:48rpx 38rpx;border:2rpx solid rgba(173,129,57,.48);border-radius:22rpx;background:linear-gradient(155deg,#FFFEFA,#FBF7EC)}.certificate-paper__frame:before,.certificate-paper__frame:after{content:"";position:absolute;width:74rpx;height:74rpx;border-color:#C39C5C;border-style:solid}.certificate-paper__frame:before{left:18rpx;top:18rpx;border-width:2rpx 0 0 2rpx}.certificate-paper__frame:after{right:18rpx;bottom:18rpx;border-width:0 2rpx 2rpx 0}.certificate-brand{text-align:center}.certificate-brand text{display:block}.certificate-brand__school{color:#153C68;font-family:serif;font-size:25rpx;font-weight:700;letter-spacing:4rpx}.certificate-brand__en{margin-top:7rpx;color:#A28559;font-size:12rpx;letter-spacing:1rpx}.certificate-heading{margin-top:48rpx;text-align:center}.certificate-heading text{display:block}.certificate-heading__eyebrow{color:#A17B41;font-size:14rpx;font-weight:700;letter-spacing:4rpx}.certificate-heading__title{margin-top:14rpx;color:#15395F;font-family:serif;font-size:50rpx;font-weight:700;letter-spacing:5rpx}.certificate-heading__line{width:110rpx;height:4rpx;margin:22rpx auto 0;background:#B48A4A}.certificate-statement{max-width:560rpx;margin:40rpx auto 0;color:#4E5A69;font-size:21rpx;line-height:1.9;text-align:center}.certificate-statement text{display:block}.certificate-statement__recipient{margin-bottom:8rpx;color:#203C59;font-family:serif;font-size:28rpx;font-weight:700}.certificate-amount{margin-top:34rpx;padding:24rpx;text-align:center;border-top:1rpx solid #E7D8BD;border-bottom:1rpx solid #E7D8BD}.certificate-amount text{display:block}.certificate-amount text:first-child{color:#8A744F;font-size:17rpx;letter-spacing:2rpx}.certificate-amount text:last-child{margin-top:8rpx;color:#174575;font-family:Georgia,serif;font-size:42rpx;font-weight:700}.certificate-fields{margin-top:28rpx;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18rpx}.certificate-field{min-width:0;padding:20rpx;border-radius:16rpx;background:rgba(245,239,225,.62)}.certificate-field--wide{grid-column:1/-1}.certificate-field text{display:block}.certificate-field text:first-child{color:#9A8157;font-size:16rpx}.certificate-field text:last-child{margin-top:7rpx;overflow-wrap:anywhere;color:#34475B;font-size:21rpx;font-weight:650;line-height:1.45}.certificate-field__number{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1rpx}.certificate-disclaimer{margin-top:30rpx;padding:20rpx 22rpx;display:flex;align-items:flex-start;border:1rpx solid #E5C4A1;border-radius:18rpx;background:#FFF7ED}.certificate-disclaimer text{display:block}.certificate-disclaimer text:first-child{margin-right:15rpx;padding:5rpx 9rpx;flex-shrink:0;border-radius:8rpx;color:#985237;background:#F5DDD2;font-size:16rpx;font-weight:700}.certificate-disclaimer text:last-child{color:#826B55;font-size:17rpx;line-height:1.6}.certificate-actions{margin-top:24rpx;display:flex;gap:16rpx}.certificate-actions button{min-width:0;flex:1}.screenshot-tip{display:block;margin-top:18rpx;color:#7E8998;font-size:18rpx;line-height:1.6;text-align:center}.certificate-help{margin-top:22rpx;padding:23rpx}.certificate-help text{display:block}.certificate-help text:first-child{color:#74572C;font-size:21rpx;font-weight:700}.certificate-help text:last-child{margin-top:7rpx;color:#7E8998;font-size:18rpx;line-height:1.7}
@media screen and (min-width:768px){.certificate-page{max-width:860px}.certificate-paper{padding:12px;border-radius:26px}.certificate-paper__frame{min-height:800px;padding:58px 64px}.certificate-heading{margin-top:58px}.certificate-heading__title{font-size:48px}.certificate-fields{gap:16px}.certificate-field{padding:18px}.certificate-actions{max-width:620px;margin:24px auto 0}}
</style>

<style>
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  :global(html), :global(body), :global(uni-page-wrapper), :global(uni-page-body) { background: #fff !important; }
  :global(uni-page-head), :global(uni-tabbar), .screen-only { display: none !important; }
  .certificate-page { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
  .certificate-paper { padding: 8px !important; border-radius: 0 !important; box-shadow: none !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .certificate-paper__frame { min-height: 250mm !important; padding: 18mm 16mm !important; border-radius: 0 !important; box-sizing: border-box !important; }
}
</style>
