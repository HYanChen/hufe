<template>
  <view class="page-shell volunteer-page">
    <view class="volunteer-hero">
      <view class="volunteer-hero__mark">愿</view>
      <view><text class="volunteer-hero__eyebrow">ALUMNI VOLUNTEERS</text><text class="volunteer-hero__title">以校友之名，为母校搭把手</text><text class="volunteer-hero__desc">活动协助、经验分享、返校接待 · 线上申请</text></view>
      <text class="volunteer-hero__seal">HUFE</text>
    </view>

    <view class="section-head"><view><text class="section-title">近期服务机会</text><text class="section-kicker">CHOOSE A MOMENT TO HELP</text></view></view>
    <view v-if="loading && !opportunities.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载志愿项目</text></view>
    <view v-else-if="error && !opportunities.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ error }}</text><button class="secondary-button" @tap="loadState">重新加载</button></view>
    <view v-else-if="opportunities.length" class="opportunity-list">
      <view v-for="item in opportunities" :key="item.id" class="opportunity-card surface" :class="{ 'opportunity-card--selected': selectedId === item.id }" @tap="selectOpportunity(item)">
        <view class="opportunity-date"><text>{{ item.month }}月</text><text>{{ item.day }}</text></view>
        <view class="opportunity-main"><view><text class="opportunity-tag">{{ item.volunteerTag }}</text><text v-if="appliedIds.includes(item.id)" class="opportunity-applied">已申请</text><text class="opportunity-detail" @tap.stop="detailOpportunity = item">查看详情</text></view><text class="opportunity-title">{{ item.title }}</text><text class="opportunity-meta">{{ item.time }} · {{ item.city }}</text><text class="opportunity-task">协助内容：{{ item.task }}</text></view>
        <text class="opportunity-check">{{ selectedId === item.id ? '✓' : '›' }}</text>
      </view>
    </view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">愿</view><text>暂无正在招募的志愿项目</text></view>
    <BusinessDetailSheet
      :open="Boolean(detailOpportunity)"
      :title="detailOpportunity ? detailOpportunity.title : ''"
      :subtitle="detailOpportunity ? `${detailOpportunity.time} · ${detailOpportunity.city}` : ''"
      eyebrow="VOLUNTEER DETAILS"
      :show-actions="true"
      @close="detailOpportunity = null"
    >
      <template v-if="detailOpportunity">
        <view class="volunteer-detail-meta"><text>{{ detailOpportunity.volunteerTag }}</text><text>招募 {{ detailOpportunity.quota || '不限' }} 人</text></view>
        <BusinessRichText :content="detailOpportunity.description" empty-text="暂无项目详情" />
      </template>
      <template #actions>
        <button class="secondary-button" @tap="detailOpportunity = null">关闭</button>
        <button class="primary-button" @tap="chooseDetailedOpportunity">选择该项目</button>
      </template>
    </BusinessDetailSheet>

    <view class="section-head"><view><text class="section-title">志愿申请</text><text class="section-kicker">SUBMIT TO REVIEW</text></view></view>
    <view class="form-card surface">
      <view class="form-row"><text class="form-label">服务项目</text><text class="form-control">{{ selectedOpportunity ? selectedOpportunity.title : '请选择' }}</text></view>
      <picker :range="roles" :value="roleIndex" @change="changeRole"><view class="form-row"><text class="form-label">服务角色</text><text class="form-control">{{ roles[roleIndex] }} ›</text></view></picker>
      <view class="form-row"><text class="form-label">联系电话</text><input v-model="phone" class="form-control" type="number" maxlength="11" placeholder="用于服务联络" placeholder-class="form-placeholder" /></view>
      <view class="volunteer-message"><text>想对组织者说</text><textarea v-model="message" maxlength="120" :show-confirm-bar="false" placeholder="可填写可服务时段或相关经验（选填）" placeholder-class="form-placeholder" /><text>{{ message.length }}/120</text></view>
    </view>
    <button class="primary-button submit-button" :class="{ 'submit-button--done': selectedId && appliedIds.includes(selectedId) }" :loading="submitting" :disabled="submitting" @tap="submit">{{ selectedId && appliedIds.includes(selectedId) ? '该项目已申请' : '提交志愿申请' }}</button>

    <view class="volunteer-note surface"><view class="volunteer-note__icon">i</view><view><text>服务说明</text><text>申请将由校友会或活动主办方审核确认。未收到正式通知前，请勿据此安排行程或到场服务。</text></view></view>
    <SupportFooter />
  </view>
</template>

<script>
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { applyForVolunteer, getMyVolunteerApplications, getVolunteerProjects } from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() {
    return {
      opportunities: [],
      selectedId: '',
      detailOpportunity: null,
      roles: ['活动接待', '签到引导', '摄影记录', '秩序协助'],
      roleIndex: 0,
      phone: '',
      message: '',
      appliedIds: [],
      loading: false,
      submitting: false,
      error: ''
    }
  },
  computed: {
    selectedOpportunity() { return this.opportunities.find((item) => item.id === this.selectedId) }
  },
  onShow() { this.loadState() },
  methods: {
    chooseDetailedOpportunity() {
      if (!this.detailOpportunity) return
      this.selectedId = this.detailOpportunity.id
      this.detailOpportunity = null
    },
    async loadState() {
      if (this.loading) return
      this.loading = true; this.error = ''
      try {
        const [publicResult, mine] = await Promise.all([getVolunteerProjects({page:1,pageSize:100}), isVerified() ? getMyVolunteerApplications() : Promise.resolve({items:[]})])
        this.opportunities = publicResult.items.map((item) => {
          const date = new Date(item.serviceDate || '')
          const valid = !Number.isNaN(date.getTime())
          return { ...item, title:item.projectTitle||item.title, month:valid?String(date.getMonth()+1).padStart(2,'0'):'--', day:valid?String(date.getDate()).padStart(2,'0'):'--', time:valid?item.serviceDate:'日期待定', city:item.location||'地点待定', volunteerTag:item.category||'志愿服务', task:markdownToPlainText(item.description,{singleLine:true,maxLength:120})||'以项目通知为准' }
        })
        this.appliedIds = mine.items.filter((item)=>!['cancelled','rejected'].includes(item.status)).map((item)=>item.volunteerId)
        if (!this.opportunities.some((item)=>item.id===this.selectedId)) this.selectedId=this.opportunities[0]?.id||''
      } catch(error){this.opportunities=[];this.error=error.message||'志愿项目加载失败'}
      finally{this.loading=false}
    },
    selectOpportunity(item) {
      this.selectedId = item.id
      if (this.appliedIds.includes(item.id)) uni.showToast({ title: '该项目已提交申请', icon: 'none' })
    },
    changeRole(event) { this.roleIndex = Number(event.detail.value) },
    async submit() {
      if (!isVerified()) { openPage('/pages/verify/index'); return }
      if (!this.selectedOpportunity) {
        uni.showToast({ title: '请先选择服务项目', icon: 'none' })
        return
      }
      if (this.appliedIds.includes(this.selectedId)) {
        uni.showToast({ title: '请勿重复提交申请', icon: 'none' })
        return
      }
      if (!/^1\d{10}$/.test(this.phone)) {
        uni.showToast({ title: '请输入 11 位联系电话', icon: 'none' })
        return
      }
      this.submitting=true
      try { await applyForVolunteer(this.selectedOpportunity.id,{role:this.roles[this.roleIndex],phone:this.phone,message:this.message.trim()}); await this.loadState(); uni.showToast({title:'申请已提交'}) }
      catch(error){uni.showModal({title:'提交失败',content:error.message||'请稍后重试',showCancel:false})}
      finally{this.submitting=false}
    }
  }
}
</script>

<style scoped>
.volunteer-page{padding-top:14rpx}.volunteer-hero{position:relative;height:252rpx;padding:36rpx 30rpx;overflow:hidden;display:flex;align-items:center;border-radius:36rpx;color:#FFF;background:linear-gradient(135deg,#033481,#195693);box-shadow:0 22rpx 48rpx rgba(11,58,130,.19)}.volunteer-hero__mark{width:92rpx;height:92rpx;margin-right:23rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:1rpx solid rgba(226,198,142,.55);border-radius:50%;color:#E2C68E;font-family:serif;font-size:34rpx;font-weight:700}.volunteer-hero__eyebrow,.volunteer-hero__title,.volunteer-hero__desc{display:block}.volunteer-hero__eyebrow{color:#E2C68E;font-size:17rpx;font-weight:700;letter-spacing:3rpx}.volunteer-hero__title{width:440rpx;margin-top:12rpx;font-size:34rpx;line-height:1.35;font-weight:700}.volunteer-hero__desc{margin-top:9rpx;color:rgba(255,255,255,.62);font-size:19rpx}.volunteer-hero__seal{position:absolute;right:22rpx;bottom:15rpx;color:rgba(255,255,255,.11);font-family:Georgia,serif;font-size:45rpx;font-weight:700;letter-spacing:4rpx}.opportunity-list{display:flex;flex-direction:column}.opportunity-card{position:relative;margin-bottom:18rpx;padding:22rpx;display:flex;align-items:center;border:2rpx solid transparent}.opportunity-card--selected{border-color:rgba(11,58,130,.25);box-shadow:0 16rpx 38rpx rgba(11,58,130,.1)}.opportunity-date{width:92rpx;height:108rpx;margin-right:20rpx;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:23rpx;color:#FFF;background:linear-gradient(145deg,#123F7F,#2462A4)}.opportunity-date text:first-child{font-size:18rpx;opacity:.76}.opportunity-date text:last-child{margin-top:3rpx;font-size:40rpx;font-weight:700}.opportunity-main{flex:1;min-width:0}.opportunity-tag,.opportunity-applied,.opportunity-detail{display:inline-flex;margin-right:10rpx;padding:6rpx 10rpx;border-radius:99rpx;color:#7C5A24;background:#F5E8CF;font-size:16rpx;font-weight:600}.opportunity-applied{color:#176551;background:#E3F0EB}.opportunity-detail{color:#064A91;background:#E9F0F8}.opportunity-title,.opportunity-meta,.opportunity-task{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.opportunity-title{margin-top:9rpx;font-size:26rpx;font-weight:650}.opportunity-meta{margin-top:6rpx;color:#8791A2;font-size:18rpx}.opportunity-task{margin-top:6rpx;color:#657187;font-size:18rpx}.opportunity-check{margin-left:10rpx;color:#033481;font-size:34rpx}.volunteer-message{padding:22rpx 0}.volunteer-message>text:first-child{display:block;color:#4B576A;font-size:25rpx;font-weight:600}.volunteer-message textarea{width:100%;height:150rpx;margin-top:14rpx;padding:18rpx;border-radius:18rpx;color:#243047;background:#F6F8FB;font-size:23rpx;line-height:1.6}.volunteer-message>text:last-child{display:block;margin-top:8rpx;color:#A3AAB5;font-size:18rpx;text-align:right}.submit-button{margin:24rpx 0 0}.submit-button--done{color:#176551;background:#E3F0EB;box-shadow:none}.volunteer-note{margin-top:22rpx;padding:22rpx;display:flex;align-items:flex-start}.volunteer-note__icon{width:48rpx;height:48rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:16rpx;color:#033481;background:#E8EFF9;font-size:20rpx;font-weight:700}.volunteer-note text{display:block}.volunteer-note text:first-child{color:#3C485D;font-size:21rpx;font-weight:650}.volunteer-note text:last-child{margin-top:5rpx;color:#8993A3;font-size:18rpx;line-height:1.6}.volunteer-detail-meta{margin-bottom:22rpx;display:flex;flex-wrap:wrap;gap:9rpx}.volunteer-detail-meta text{padding:8rpx 13rpx;border-radius:99rpx;color:#52637A;background:#EDF2F8;font-size:18rpx}
</style>
