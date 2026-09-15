<template>
  <view class="page-shell visit-page">
    <view class="visit-hero">
      <view class="visit-hero__copy">
        <text class="visit-hero__eyebrow">BACK TO CAMPUS</text>
        <text class="visit-hero__title">欢迎回家看看</text>
        <text class="visit-hero__desc">提前登记到校信息，便于查看与管理返校计划。</text>
      </view>
      <view class="visit-hero__art"><view class="visit-hero__sun"></view><view class="visit-hero__roof"></view><view class="visit-hero__hall"></view></view>
      <text class="visit-hero__stamp">线上申请</text>
    </view>

    <view v-if="!verified" class="verify-gate surface">
      <view class="verify-gate__icon">证</view>
      <view class="verify-gate__body"><text class="verify-gate__title">请先登录湖财人账号</text><text class="verify-gate__desc">返校预约需使用已实名注册的平台账号。</text></view>
      <button class="gate-button" @tap="openVerify">去登录</button>
    </view>

    <template v-else>
      <view class="identity-strip surface">
        <view class="identity-strip__avatar">{{ user.initials }}</view>
        <view class="identity-strip__body"><text class="identity-strip__name">{{ user.realName }}</text><text class="identity-strip__meta">{{ user.graduationYear }}级 · {{ user.college }}</text></view>
        <text class="identity-strip__status">✓ 已认证</text>
      </view>

      <view class="section-head"><view><text class="section-title">填写返校计划</text><text class="section-kicker">VISIT APPLICATION</text></view></view>
      <view class="form-card surface">
        <picker mode="date" :value="form.date" :start="minDate" :end="maxDate" @change="selectDate">
          <view class="form-row">
            <text class="form-label">到校日期 *</text>
            <view class="form-picker"><text>{{ form.date }}</text><text class="form-arrow">›</text></view>
          </view>
        </picker>
        <picker mode="selector" :range="reasons" :value="reasonIndex" @change="selectReason">
          <view class="form-row">
            <text class="form-label">返校事由 *</text>
            <view class="form-picker"><text>{{ form.reason }}</text><text class="form-arrow">›</text></view>
          </view>
        </picker>
        <view class="slot-row">
          <text class="slot-row__label">预计时段 *</text>
          <view class="slot-list">
            <view v-for="slot in timeSlots" :key="slot" class="slot-item" :class="{ 'slot-item--active': form.timeSlot === slot }" @tap="form.timeSlot = slot">{{ slot }}</view>
          </view>
        </view>
        <view class="form-row">
          <text class="form-label">同行人数</text>
          <view class="stepper">
            <button class="stepper__button" :disabled="form.companions <= 0" @tap="changeCompanions(-1)">−</button>
            <text>{{ form.companions }}</text>
            <button class="stepper__button" :disabled="form.companions >= 5" @tap="changeCompanions(1)">+</button>
          </view>
        </view>
        <view class="form-row"><text class="form-label">联系电话 *</text><input v-model.trim="form.contact" class="contact-input" type="number" maxlength="11" placeholder="用于接收审核通知" /></view>
        <view class="note-row">
          <text class="note-row__label">备注</text>
          <textarea v-model="form.note" class="note-row__textarea" maxlength="100" placeholder="可填写希望参访的地点（选填）" placeholder-class="form-placeholder" />
          <text class="note-row__count">{{ form.note.length }}/100</text>
        </view>
      </view>
      <button class="primary-button submit-button" :loading="submitting" :disabled="submitting" @tap="submitVisit">提交返校预约</button>

      <view class="section-head">
        <view><text class="section-title">我的预约</text><text class="section-kicker">VISIT RECORDS</text></view>
        <text class="record-count">{{ records.length }} 条记录</text>
      </view>
      <view v-if="records.length" class="record-list">
        <view v-for="record in records" :key="record.id" class="record-card surface">
          <view class="record-card__date"><text class="record-card__day">{{ dayOf(record.date) }}</text><text class="record-card__month">{{ monthOf(record.date) }}月</text></view>
          <view class="record-card__body">
            <view class="record-card__head"><text class="record-card__reason">{{ record.reason }}</text><text class="record-status" :class="{ 'record-status--cancelled': ['cancelled','rejected'].includes(record.status) }">{{ statusLabel(record.status) }}</text></view>
            <text class="record-card__meta">{{ record.date }} · {{ record.timeSlot }}</text>
            <text class="record-card__meta">同行 {{ record.companions || 0 }} 人 · {{ createdText(record.createdAt) }}提交</text>
            <button v-if="!['cancelled','rejected','completed','closed'].includes(record.status)" class="cancel-button" @tap="cancelVisit(record)">取消预约</button>
          </view>
        </view>
      </view>
      <view v-else class="empty-state surface"><view class="empty-state__icon">校</view><text>还没有返校记录</text></view>
    </template>

    <view class="visit-note"><text>提醒</text><text>预约提交后由学校相关部门审核，办理状态与审核意见以本页服务端记录为准。</text></view>
    <SupportFooter />
  </view>
</template>

<script>
import { cancelCampusVisit, createCampusVisit, getCampusVisits } from '../../services/business'
import { getUser } from '../../utils/store'
import { openPage } from '../../utils/nav'

function toDateString(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export default {
  data() {
    const today = new Date()
    const defaultDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3)
    const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 180)
    return {
      user: {},
      verified: false,
      records: [],
      minDate: toDateString(today),
      maxDate: toDateString(maxDate),
      reasons: ['参加校友活动', '校园故地重游', '访问老师', '校友企业交流', '其他'],
      timeSlots: ['09:00–11:00', '14:00–16:00', '16:00–18:00'],
      form: { date: toDateString(defaultDate), reason: '参加校友活动', timeSlot: '09:00–11:00', companions: 0, contact: '', note: '' },
      loading: false,
      submitting: false
    }
  },
  computed: {
    reasonIndex() {
      const index = this.reasons.indexOf(this.form.reason)
      return index > -1 ? index : 0
    }
  },
  onShow() {
    this.loadData()
  },
  methods: {
    async loadData() {
      this.user = getUser()
      this.verified = this.user.verificationStatus === 'verified'
      if (!this.verified || this.loading) { this.records = []; return }
      this.loading = true
      try {
        const result = await getCampusVisits()
        this.records = result.items.map((item) => ({ ...item, date: item.visitDate, companions: Math.max(Number(item.visitorCount || 1) - 1, 0) }))
      } catch (error) { this.records = []; uni.showToast({ title: error.message || '预约记录加载失败', icon: 'none' }) }
      finally { this.loading = false }
    },
    selectDate(event) {
      this.form.date = event.detail.value
    },
    selectReason(event) {
      this.form.reason = this.reasons[Number(event.detail.value)]
    },
    changeCompanions(amount) {
      this.form.companions = Math.max(0, Math.min(5, this.form.companions + amount))
    },
    async submitVisit() {
      const duplicate = this.records.some((record) => record.status !== 'cancelled' && record.date === this.form.date && record.timeSlot === this.form.timeSlot)
      if (duplicate) {
        uni.showToast({ title: '该日期时段已有预约', icon: 'none' })
        return
      }
      if (!/^1\d{10}$/.test(this.form.contact)) { uni.showToast({ title: '请输入 11 位联系电话', icon: 'none' }); return }
      this.submitting = true
      try {
        const record = await createCampusVisit({ visitDate: this.form.date, timeSlot: this.form.timeSlot, visitorCount: this.form.companions + 1, reason: [this.form.reason, this.form.note.trim()].filter(Boolean).join('：'), contact: this.form.contact })
        await this.loadData(); this.form.note = ''
        uni.showModal({ title: '预约已提交', content: `${record.visitDate || this.form.date} ${record.timeSlot || this.form.timeSlot}\n请留意后台审核状态。`, showCancel: false, confirmText: '我知道了', confirmColor: '#033481' })
      } catch (error) { uni.showModal({ title: '提交失败', content: error.message || '请稍后重试', showCancel: false }) }
      finally { this.submitting = false }
    },
    cancelVisit(record) {
      uni.showModal({
        title: '取消返校预约？',
        content: `${record.date} ${record.timeSlot}\n取消后保留记录，也可重新提交。`,
        confirmText: '确认取消',
        confirmColor: '#9B554D',
        success: async (res) => {
          if (!res.confirm) return
          try { await cancelCampusVisit(record.id, record.revision); await this.loadData(); uni.showToast({ title: '预约已取消', icon: 'none' }) }
          catch (error) { uni.showModal({ title: '取消失败', content: error.message || '请稍后重试', showCancel: false }) }
        }
      })
    },
    dayOf(date) {
      return String(date || '').slice(8, 10)
    },
    monthOf(date) {
      return String(date || '').slice(5, 7)
    },
    createdText(timestamp) {
      if (!timestamp) return ''
      const date = new Date(timestamp)
      return `${date.getMonth() + 1}月${date.getDate()}日`
    },
    statusLabel(status) { return ({ submitted:'待审核', approved:'已通过', rejected:'已驳回', completed:'已完成', cancelled:'已取消' })[status] || status || '待处理' },
    openVerify() {
      openPage('/pages/verify/index')
    }
  }
}
</script>

<style scoped>
.visit-page{padding-top:16rpx}.visit-hero{position:relative;height:286rpx;padding:40rpx 34rpx;overflow:hidden;border-radius:36rpx;color:#fff;background:linear-gradient(135deg,#092f70,#14539b);box-shadow:0 22rpx 48rpx rgba(11,58,130,.2)}.visit-hero__copy{position:relative;z-index:3;width:67%}.visit-hero__eyebrow,.visit-hero__title,.visit-hero__desc{display:block}.visit-hero__eyebrow{color:#dfc187;font-size:18rpx;font-weight:700;letter-spacing:4rpx}.visit-hero__title{margin-top:14rpx;font-size:42rpx;font-weight:700}.visit-hero__desc{margin-top:12rpx;color:rgba(255,255,255,.64);font-size:21rpx;line-height:1.55}.visit-hero__stamp{position:absolute;right:20rpx;top:18rpx;padding:7rpx 12rpx;border:1rpx solid rgba(255,255,255,.22);border-radius:99rpx;color:rgba(255,255,255,.55);font-size:16rpx}.visit-hero__art{position:absolute;right:16rpx;bottom:24rpx;width:230rpx;height:210rpx}.visit-hero__sun{position:absolute;right:20rpx;top:12rpx;width:92rpx;height:92rpx;border-radius:50%;background:linear-gradient(135deg,#d4ae69,#f2dcad);box-shadow:0 0 0 18rpx rgba(224,189,125,.08)}.visit-hero__roof{position:absolute;left:38rpx;bottom:94rpx;width:0;height:0;border-left:78rpx solid transparent;border-right:78rpx solid transparent;border-bottom:48rpx solid rgba(255,255,255,.9)}.visit-hero__hall{position:absolute;left:54rpx;bottom:20rpx;width:124rpx;height:80rpx;border-radius:5rpx 5rpx 0 0;background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(225,205,168,.8));box-shadow:0 9rpx 0 rgba(255,255,255,.14)}
.identity-strip{position:relative;z-index:4;margin:-18rpx 18rpx 0;padding:22rpx;display:flex;align-items:center}.identity-strip__avatar{width:58rpx;height:58rpx;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#033481;background:linear-gradient(145deg,#fff,#ead7b1);font-size:20rpx;font-weight:700}.identity-strip__body{flex:1;margin-left:16rpx}.identity-strip__name,.identity-strip__meta{display:block}.identity-strip__name{font-size:24rpx;font-weight:650}.identity-strip__meta{margin-top:4rpx;color:#969eac;font-size:18rpx}.identity-strip__status{color:#176551;font-size:19rpx;font-weight:650}.verify-gate{position:relative;z-index:3;margin:-18rpx 18rpx 0;padding:24rpx;display:flex;align-items:center}.verify-gate__icon{width:58rpx;height:58rpx;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#846129;background:#f5e8d2;font-size:22rpx;font-weight:700}.verify-gate__body{flex:1;margin-left:16rpx}.verify-gate__title,.verify-gate__desc{display:block}.verify-gate__title{font-size:24rpx;font-weight:650}.verify-gate__desc{margin-top:5rpx;color:#929aa8;font-size:18rpx}.gate-button{height:58rpx;margin:0;padding:0 20rpx;border-radius:17rpx;color:#fff;background:#033481;font-size:20rpx;line-height:58rpx}
.form-picker{flex:1;display:flex;align-items:center;justify-content:flex-end;color:#202c40;font-size:25rpx}.form-arrow{margin-left:14rpx;color:#aeb5c0;font-size:34rpx}.slot-row{padding:24rpx 0;border-bottom:1rpx solid #edf0f4}.slot-row__label{display:block;color:#4b576a;font-size:25rpx;font-weight:600}.slot-list{margin-top:18rpx;display:flex;gap:12rpx}.slot-item{flex:1;height:66rpx;display:flex;align-items:center;justify-content:center;border:1rpx solid #e0e5ed;border-radius:18rpx;color:#737e8f;background:#f8f9fb;font-size:19rpx}.slot-item--active{border-color:#033481;color:#033481;background:#e9eff9;font-weight:650}.stepper{display:flex;align-items:center;justify-content:flex-end}.stepper text{width:58rpx;color:#202c40;text-align:center;font-size:25rpx;font-weight:650}.stepper__button{width:54rpx;height:54rpx;margin:0;padding:0;border-radius:17rpx;color:#033481;background:#e9eff9;font-size:29rpx;line-height:54rpx}.stepper__button[disabled]{color:#b3bac4;background:#f0f2f5}.note-row{position:relative;padding:24rpx 0}.note-row__label{display:block;color:#4b576a;font-size:25rpx;font-weight:600}.note-row__textarea{width:100%;height:150rpx;margin-top:14rpx;padding:18rpx;border-radius:18rpx;color:#202c40;background:#f6f8fa;font-size:23rpx;line-height:1.55}.note-row__count{position:absolute;right:12rpx;bottom:34rpx;color:#a4abb5;font-size:17rpx}.submit-button{margin-top:24rpx}
.contact-input{flex:1;height:72rpx;color:#202c40;font-size:23rpx;text-align:right}
.record-count{color:#9a7a46;font-size:20rpx}.record-list{display:flex;flex-direction:column;gap:16rpx}.record-card{padding:24rpx;display:flex}.record-card__date{width:82rpx;height:88rpx;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:22rpx;color:#fff;background:linear-gradient(145deg,#033481,#3166a7)}.record-card__day,.record-card__month{display:block}.record-card__day{font-family:Georgia,serif;font-size:32rpx;font-weight:700}.record-card__month{margin-top:2rpx;color:rgba(255,255,255,.66);font-size:16rpx}.record-card__body{flex:1;min-width:0;margin-left:20rpx}.record-card__head{display:flex;align-items:center;justify-content:space-between}.record-card__reason{font-size:25rpx;font-weight:650}.record-status{padding:6rpx 11rpx;border-radius:99rpx;color:#176551;background:#e3f1eb;font-size:16rpx;font-weight:650}.record-status--cancelled{color:#858e9c;background:#edf0f4}.record-card__meta{display:block;margin-top:7rpx;color:#8d96a5;font-size:19rpx}.cancel-button{width:128rpx;height:48rpx;margin:14rpx 0 0;padding:0;border:1rpx solid #e2d3d0;border-radius:15rpx;color:#96534c;background:#fff;font-size:18rpx;line-height:46rpx}.visit-note{margin:30rpx 4rpx 8rpx;padding:18rpx 20rpx;display:flex;align-items:flex-start;border-radius:18rpx;color:#8c95a2;background:#eceff4;font-size:18rpx;line-height:1.55}.visit-note text:first-child{margin-right:10rpx;padding:3rpx 9rpx;flex-shrink:0;border-radius:99rpx;color:#80602d;background:#f2e3ca}
</style>
