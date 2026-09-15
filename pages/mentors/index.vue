<template>
  <view class="page-shell mentors-page">
    <view class="mentor-hero">
      <view class="mentor-hero__line"><text>HUFE MENTORSHIP</text><text>校友导师</text></view>
      <text class="mentor-hero__title">走过的路，也能照亮后来者</text>
      <text class="mentor-hero__desc">由优秀校友分享职业经验，为成长中的湖财人提供一对一方向建议</text>
      <view class="mentor-hero__steps"><view><text>01</text><text>选择导师</text></view><view class="mentor-hero__arrow">→</view><view><text>02</text><text>提交主题</text></view><view class="mentor-hero__arrow">→</view><view><text>03</text><text>等待联络</text></view></view>
    </view>

    <view class="mentor-profile-entry surface" @tap="openMentorProfile">
      <view class="mentor-profile-entry__icon">师</view>
      <view><text>导师工作台 · 完善我的资料</text><text>已绑定并认证的导师可完善简介、辅导主题和可约安排</text></view>
      <text class="mentor-profile-entry__arrow">›</text>
    </view>

    <view class="section-head"><view><text class="section-title">本期校友导师</text><text class="section-kicker">CAREER COMPANIONS</text></view><text class="section-more">{{ mentors.length }} 位</text></view>
    <view v-if="loading && !mentors.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载导师资料</text></view>
    <view v-else-if="error && !mentors.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ error }}</text><button class="secondary-button" @tap="loadState">重新加载</button></view>
    <view v-else-if="mentors.length" class="mentor-list">
      <view v-for="(mentor, index) in mentors" :key="mentor.id" class="mentor-card surface">
        <view class="mentor-card__head"><view class="mentor-avatar" :class="`mentor-avatar--${index % 3}`">{{ mentor.initials }}</view><view class="mentor-card__main"><view class="mentor-name-row"><text class="mentor-name">{{ mentor.name }}</text><text class="mentor-badge">审核发布</text></view><text class="mentor-role">{{ mentor.role }}</text><text class="mentor-company">{{ mentor.company }}</text></view></view>
        <view class="mentor-topics"><text v-for="topic in mentor.topics" :key="topic">{{ topic }}</text></view>
        <view class="mentor-card__foot"><view class="mentor-card__availability"><text class="mentor-slot">本期可约 {{ mentor.slots }} 个名额</text><text class="mentor-note">{{ plainAvailability(mentor.availability) }}</text></view><view class="mentor-card__actions"><button class="mentor-detail" @tap="selectedMentor = mentor">查看详情</button><button class="mentor-action" :class="{ 'mentor-action--applied': appliedIds.includes(mentor.id) }" @tap="requestMentor(mentor)">{{ appliedIds.includes(mentor.id) ? '已提交申请' : '申请咨询' }}</button></view></view>
      </view>
    </view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">师</view><text>暂无已发布导师</text></view>
    <BusinessDetailSheet
      :open="Boolean(selectedMentor)"
      :title="selectedMentor ? selectedMentor.name : ''"
      :subtitle="selectedMentor ? `${selectedMentor.role} · ${selectedMentor.company}` : ''"
      eyebrow="MENTOR PROFILE"
      :show-actions="true"
      @close="selectedMentor = null"
    >
      <template v-if="selectedMentor">
        <view class="mentor-detail-topics"><text v-for="topic in selectedMentor.topics" :key="topic">{{ topic }}</text></view>
        <BusinessRichText :content="selectedMentor.bio" empty-text="暂无导师简介" />
        <view class="mentor-detail-availability">
          <text>可约说明</text>
          <BusinessRichText :content="selectedMentor.availability" empty-text="交流时间由双方确认" />
        </view>
      </template>
      <template #actions>
        <button class="secondary-button" @tap="selectedMentor = null">关闭</button>
        <button class="primary-button" :disabled="!selectedMentor" @tap="requestSelectedMentor">{{ selectedMentor && appliedIds.includes(selectedMentor.id) ? '已提交申请' : '申请咨询' }}</button>
      </template>
    </BusinessDetailSheet>

    <view class="mentor-notice surface"><view class="mentor-notice__icon">师</view><view><text>导师计划说明</text><text>导师资料仅展示后台审核发布内容，申请提交后进入服务端办理流程，联系方式不会在公开列表中展示。</text></view></view>
    <SupportFooter />
  </view>
</template>

<script>
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { applyForMentor, getMentors, getMyMentorApplications } from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() { return { mentors: [], selectedMentor: null, appliedIds: [], loading: false, error: '' } },
  onShow() { this.loadState() },
  methods: {
    openMentorProfile() {
      openPage('/pages/mentor-profile/index')
    },
    plainAvailability(value) {
      return markdownToPlainText(value, { singleLine: true, maxLength: 52 }) || '交流时间由双方确认'
    },
    requestSelectedMentor() {
      const mentor = this.selectedMentor
      if (!mentor) return
      this.selectedMentor = null
      this.requestMentor(mentor)
    },
    async loadState() {
      if (this.loading) return
      this.loading = true; this.error = ''
      try {
        const [publicResult, mine] = await Promise.all([getMentors({page:1,pageSize:100}), isVerified() ? getMyMentorApplications() : Promise.resolve({items:[]})])
        this.mentors = publicResult.items.map((mentor) => ({ ...mentor, role: mentor.role || mentor.title || '校友导师', slots: Number(mentor.availableSlots ?? mentor.slots ?? 0), topics: Array.isArray(mentor.topics) ? mentor.topics : [], initials: mentor.initials || String(mentor.name || '导师').slice(-2) }))
        this.appliedIds = mine.items.filter((item) => !['cancelled','rejected'].includes(item.status)).map((item) => item.mentorId)
      } catch(error){this.mentors=[];this.error=error.message||'导师加载失败'}
      finally{this.loading=false}
    },
    requestMentor(mentor) {
      if (!isVerified()) { openPage('/pages/verify/index'); return }
      if (this.appliedIds.includes(mentor.id)) {
        uni.showToast({ title: '已提交过申请', icon: 'none' })
        return
      }
      uni.showActionSheet({
        itemList: mentor.topics.length ? mentor.topics : ['职业成长交流'],
        success: async (res) => {
          const options = mentor.topics.length ? mentor.topics : ['职业成长交流']
          const topic = options[res.tapIndex]
          try { await applyForMentor(mentor.id, {topic}); await this.loadState(); uni.showToast({ title: '申请已提交' }) }
          catch(error){uni.showModal({title:'申请失败',content:error.message||'请稍后重试',showCancel:false})}
        }
      })
    }
  }
}
</script>

<style scoped>
.mentors-page{padding-top:14rpx}.mentor-hero{position:relative;padding:34rpx 32rpx;overflow:hidden;border-radius:36rpx;color:#FFF;background:linear-gradient(145deg,#133250,#0A3A7A);box-shadow:0 22rpx 48rpx rgba(11,58,130,.19)}.mentor-hero::after{content:"M";position:absolute;right:18rpx;top:-28rpx;color:rgba(255,255,255,.055);font-family:Georgia,serif;font-size:260rpx;font-weight:700}.mentor-hero__line{position:relative;z-index:1;display:flex;justify-content:space-between;color:#E1C58D;font-size:17rpx;font-weight:700;letter-spacing:3rpx}.mentor-hero__line text:last-child{padding:7rpx 13rpx;border:1rpx solid rgba(225,197,141,.36);border-radius:99rpx;letter-spacing:1rpx}.mentor-hero__title,.mentor-hero__desc{position:relative;z-index:1;display:block}.mentor-hero__title{width:520rpx;margin-top:18rpx;font-size:38rpx;line-height:1.3;font-weight:700}.mentor-hero__desc{width:550rpx;margin-top:12rpx;color:rgba(255,255,255,.62);font-size:20rpx;line-height:1.65}.mentor-hero__steps{position:relative;z-index:1;margin-top:28rpx;padding-top:23rpx;display:flex;align-items:center;justify-content:space-between;border-top:1rpx solid rgba(255,255,255,.13)}.mentor-hero__steps view:not(.mentor-hero__arrow){display:flex;flex-direction:column}.mentor-hero__steps view text:first-child{color:#E1C58D;font-family:Georgia,serif;font-size:22rpx}.mentor-hero__steps view text:last-child{margin-top:3rpx;color:rgba(255,255,255,.66);font-size:18rpx}.mentor-hero__arrow{color:rgba(255,255,255,.28);font-size:24rpx}.mentor-profile-entry{margin:20rpx 10rpx 0;padding:21rpx 22rpx;display:flex;align-items:center}.mentor-profile-entry__icon{width:58rpx;height:58rpx;margin-right:16rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#80602d;background:#f4e7ce;font-size:21rpx;font-weight:700}.mentor-profile-entry>view:nth-child(2){min-width:0;flex:1}.mentor-profile-entry>view:nth-child(2) text{display:block}.mentor-profile-entry>view:nth-child(2) text:first-child{color:#36445a;font-size:23rpx;font-weight:700}.mentor-profile-entry>view:nth-child(2) text:last-child{margin-top:5rpx;color:#8a94a3;font-size:18rpx;line-height:1.5}.mentor-profile-entry__arrow{margin-left:12rpx;color:#aab2bd;font-size:38rpx}.mentor-list{display:flex;flex-direction:column}.mentor-card{margin-bottom:20rpx;padding:27rpx}.mentor-card__head{display:flex;align-items:center}.mentor-avatar{width:92rpx;height:92rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:30rpx;color:#FFF;font-size:25rpx;font-weight:700}.mentor-avatar--0{background:linear-gradient(145deg,#033481,#4777B2)}.mentor-avatar--1{background:linear-gradient(145deg,#876333,#C3A066)}.mentor-avatar--2{background:linear-gradient(145deg,#175D4E,#55917D)}.mentor-card__main{flex:1;min-width:0;margin-left:20rpx}.mentor-name-row{display:flex;align-items:center}.mentor-name,.mentor-role,.mentor-company,.mentor-slot,.mentor-note,.mentor-notice text{display:block}.mentor-name{font-size:29rpx;font-weight:700}.mentor-badge{margin-left:12rpx;padding:6rpx 10rpx;border-radius:99rpx;color:#7C5A24;background:#F6E8CE;font-size:16rpx}.mentor-role{margin-top:7rpx;color:#3D4960;font-size:22rpx;font-weight:600}.mentor-company{margin-top:5rpx;color:#949DAA;font-size:19rpx}.mentor-topics{margin-top:22rpx;display:flex;flex-wrap:wrap}.mentor-topics text{margin:0 10rpx 8rpx 0;padding:9rpx 15rpx;border-radius:13rpx;color:#50627C;background:#EDF2F8;font-size:18rpx}.mentor-card__foot{margin-top:22rpx;padding-top:21rpx;display:flex;align-items:center;gap:14rpx;border-top:1rpx solid #EDF0F4}.mentor-card__availability{min-width:0;flex:1}.mentor-card__actions{display:flex;gap:9rpx}.mentor-slot{color:#033481;font-size:21rpx;font-weight:650}.mentor-note{max-width:270rpx;margin-top:5rpx;overflow:hidden;color:#9AA2AE;font-size:17rpx;text-overflow:ellipsis;white-space:nowrap}.mentor-detail,.mentor-action{height:66rpx;margin:0;display:flex;align-items:center;justify-content:center;border-radius:18rpx;font-size:20rpx;font-weight:600;line-height:66rpx}.mentor-detail{width:128rpx;color:#033481;background:#E9EFF8}.mentor-action{width:168rpx;color:#FFF;background:#033481}.mentor-action--applied{color:#176551;background:#E4F1EC}.mentor-notice{padding:24rpx;display:flex;align-items:flex-start}.mentor-notice__icon{width:58rpx;height:58rpx;margin-right:16rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#7A5A25;background:#F5E8CF;font-size:23rpx;font-weight:700}.mentor-notice text:first-child{color:#3B475C;font-size:22rpx;font-weight:650}.mentor-notice text:last-child{margin-top:6rpx;color:#8B95A4;font-size:19rpx;line-height:1.6}.mentor-detail-topics{margin-bottom:22rpx;display:flex;flex-wrap:wrap;gap:9rpx}.mentor-detail-topics text{padding:8rpx 13rpx;border-radius:99rpx;color:#50627C;background:#EDF2F8;font-size:18rpx}.mentor-detail-availability{margin-top:26rpx;padding-top:22rpx;border-top:1rpx solid #E9EDF3}.mentor-detail-availability>text{display:block;margin-bottom:12rpx;color:#2F3D53;font-size:23rpx;font-weight:700}
</style>
