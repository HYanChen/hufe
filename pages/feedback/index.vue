<template>
  <view class="page-shell feedback-page">
    <view class="feedback-head"><view><text class="feedback-head__eyebrow">LISTEN & IMPROVE</text><text class="feedback-head__title">每一条建议，都值得认真回应</text><text class="feedback-head__desc">帮助“湖财人”服务持续变好 · 在线工单</text></view><view class="feedback-head__quote">“</view></view>

    <view class="section-head"><view><text class="section-title">建议类型</text><text class="section-kicker">CHOOSE A CATEGORY</text></view></view>
    <view class="type-grid"><view v-for="item in types" :key="item" class="type-chip" :class="{ 'type-chip--active': type === item }" @tap="type = item"><text>{{ typeIcons[item] }}</text><text>{{ item }}</text></view></view>

    <view class="feedback-form surface">
      <view class="rating-row"><view><text class="rating-title">当前体验评分</text><text class="rating-desc">点击圆点选择 1—5 分</text></view><view class="rating-list"><text v-for="value in 5" :key="value" :class="{ 'rating-dot--active': value <= rating }" @tap="rating = value">{{ value <= rating ? '●' : '○' }}</text></view></view>
      <view class="feedback-input-wrap"><textarea v-model="content" maxlength="500" :show-confirm-bar="false" placeholder="请尽量描述使用场景、遇到的问题和你的建议……" placeholder-class="form-placeholder" /><text>{{ content.length }}/500</text></view>
      <view class="form-row"><text class="form-label">联系方式</text><input v-model="contact" class="form-control" maxlength="50" :disabled="anonymous" :placeholder="anonymous ? '匿名提交无需填写' : '手机或邮箱（选填）'" placeholder-class="form-placeholder" /></view>
      <view class="anonymous-row" @tap="anonymous = !anonymous"><view><text>匿名提交</text><text>公开及办理界面不显示提交人身份</text></view><view class="anonymous-check" :class="{ 'anonymous-check--on': anonymous }">{{ anonymous ? '✓' : '' }}</view></view>
      <button class="primary-button feedback-submit" :class="{ 'feedback-submit--disabled': !canSubmit }" :loading="submitting" :disabled="submitting || !canSubmit" @tap="submit">提交建议</button>
    </view>

    <view v-if="feedbackItems.length" class="section-head"><view><text class="section-title">我的提交记录</text><text class="section-kicker">最近 {{ Math.min(feedbackItems.length, 3) }} 条</text></view></view>
    <view v-if="feedbackItems.length" class="feedback-history surface">
      <view v-for="(item, index) in feedbackItems.slice(0, 3)" :key="item.id" class="history-item" :class="{ 'history-item--border': index !== Math.min(feedbackItems.length, 3) - 1 }"><view class="history-item__top"><text>{{ item.type }}</text><text>{{ formatTime(item.createdAt) }}</text></view><text class="history-item__content">{{ item.content }}</text><view class="history-item__status"><text>{{ item.rating }} 分体验</text><text>{{ statusLabel(item.status) }}</text></view><text v-if="item.adminReply" class="history-reply">回复：{{ item.adminReply }}</text></view>
    </view>

    <view class="privacy-note"><text>隐私提示</text><text>反馈通过服务端工单保存，仅本人和授权管理员可查看；匿名提交也不会公开提交人身份。</text></view>
    <SupportFooter />
  </view>
</template>

<script>
import { getMyFeedback, submitFeedback } from '../../services/business'
import { isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  data() {
    return {
      types: ['功能建议', '使用问题', '内容举报', '服务投诉', '其他'],
      typeIcons: { 功能建议: '新', 使用问题: '问', 内容举报: '报', 服务投诉: '诉', 其他: '言' },
      type: '功能建议',
      rating: 5,
      content: '',
      contact: '',
      anonymous: false,
      feedbackItems: [], submitting: false
    }
  },
  computed: {
    canSubmit() { return this.content.trim().length >= 5 }
  },
  onShow() { this.loadState() },
  methods: {
    async loadState() {
      if (!isVerified()) { this.feedbackItems=[]; return }
      try { this.feedbackItems=(await getMyFeedback()).items }
      catch(error){this.feedbackItems=[]}
    },
    async submit() {
      if (!isVerified()) { openPage('/pages/verify/index'); return }
      if (!this.canSubmit) {
        uni.showToast({ title: '请至少填写 5 个字', icon: 'none' })
        return
      }
      this.submitting=true
      try { await submitFeedback({type:this.type,rating:this.rating,content:this.content.trim(),contact:this.anonymous?'':this.contact.trim(),anonymous:this.anonymous}); this.content='';this.contact='';await this.loadState();uni.showToast({title:'反馈已提交'}) }
      catch(error){uni.showModal({title:'提交失败',content:error.message||'请稍后重试',showCancel:false})}
      finally{this.submitting=false}
    },
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${month}.${day}`
    },
    statusLabel(status){return({submitted:'待受理',processing:'处理中',resolved:'已回复',closed:'已关闭'})[status]||status||'已提交'}
  }
}
</script>

<style scoped>
.feedback-page{padding-top:14rpx}.feedback-head{position:relative;padding:36rpx 32rpx;overflow:hidden;border-radius:36rpx;color:#FFF;background:linear-gradient(135deg,#18324F,#033481);box-shadow:0 22rpx 48rpx rgba(11,58,130,.19)}.feedback-head__eyebrow,.feedback-head__title,.feedback-head__desc{position:relative;z-index:1;display:block}.feedback-head__eyebrow{color:#E1C58D;font-size:18rpx;font-weight:700;letter-spacing:4rpx}.feedback-head__title{width:520rpx;margin-top:15rpx;font-size:38rpx;line-height:1.35;font-weight:700}.feedback-head__desc{margin-top:11rpx;color:rgba(255,255,255,.62);font-size:20rpx}.feedback-head__quote{position:absolute;right:28rpx;top:-28rpx;color:rgba(225,197,141,.12);font-family:Georgia,serif;font-size:230rpx}.type-grid{margin:-6rpx;display:flex;flex-wrap:wrap}.type-chip{width:calc(50% - 12rpx);height:86rpx;margin:6rpx;padding:0 18rpx;display:flex;align-items:center;border:1rpx solid #E4E8EE;border-radius:22rpx;color:#657187;background:#FFF;font-size:23rpx}.type-chip text:first-child{width:44rpx;height:44rpx;margin-right:13rpx;display:flex;align-items:center;justify-content:center;border-radius:14rpx;color:#033481;background:#E9EFF8;font-size:18rpx;font-weight:700}.type-chip--active{border-color:#033481;color:#033481;background:#EEF3FA;font-weight:650}.type-chip--active text:first-child{color:#FFF;background:#033481}.feedback-form{margin-top:24rpx;padding:27rpx}.rating-row{padding-bottom:22rpx;display:flex;align-items:center;justify-content:space-between;border-bottom:1rpx solid #EDF0F4}.rating-title,.rating-desc{display:block}.rating-title{color:#3B475C;font-size:24rpx;font-weight:650}.rating-desc{margin-top:5rpx;color:#9AA2AF;font-size:17rpx}.rating-list{display:flex}.rating-list text{margin-left:8rpx;color:#C4CBD4;font-size:30rpx}.rating-list .rating-dot--active{color:#B18A4F}.feedback-input-wrap{padding:22rpx 0;border-bottom:1rpx solid #EDF0F4}.feedback-input-wrap textarea{width:100%;height:250rpx;color:#263248;font-size:25rpx;line-height:1.7}.feedback-input-wrap>text{display:block;color:#A2AAB5;font-size:18rpx;text-align:right}.anonymous-row{padding:22rpx 0;display:flex;align-items:center;justify-content:space-between}.anonymous-row text{display:block}.anonymous-row text:first-child{color:#4C586C;font-size:23rpx;font-weight:600}.anonymous-row text:last-child{margin-top:5rpx;color:#9AA2AE;font-size:17rpx}.anonymous-check{width:44rpx;height:44rpx;display:flex;align-items:center;justify-content:center;border:2rpx solid #D4D9E1;border-radius:14rpx;color:#FFF;font-size:22rpx;font-weight:700}.anonymous-check--on{border-color:#033481;background:#033481}.feedback-submit{margin:5rpx 0 0}.feedback-submit--disabled{opacity:.48;box-shadow:none}.feedback-history{padding:0 25rpx}.history-item{padding:23rpx 0}.history-item--border{border-bottom:1rpx solid #EDF0F4}.history-item__top,.history-item__status{display:flex;align-items:center;justify-content:space-between}.history-item__top text:first-child{color:#9A7337;font-size:19rpx;font-weight:650}.history-item__top text:last-child{color:#A1A9B4;font-size:17rpx}.history-item__content{display:-webkit-box;margin-top:10rpx;overflow:hidden;color:#354157;font-size:23rpx;line-height:1.6;-webkit-box-orient:vertical;-webkit-line-clamp:2}.history-item__status{margin-top:12rpx;color:#929BA8;font-size:17rpx}.history-item__status text:last-child{padding:6rpx 10rpx;border-radius:99rpx;color:#176551;background:#E4F1EC}.privacy-note{margin-top:22rpx;padding:22rpx;border-radius:22rpx;color:#7F8A9B;background:#EAF0F8;font-size:18rpx;line-height:1.6}.privacy-note text{display:block}.privacy-note text:first-child{margin-bottom:4rpx;color:#033481;font-size:20rpx;font-weight:700}
.history-reply{display:block;margin-top:12rpx;padding:13rpx 15rpx;border-radius:14rpx;color:#536178;background:#f0f3f7;font-size:18rpx;line-height:1.6}
</style>
