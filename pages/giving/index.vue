<template>
  <view class="page-shell giving-page">
    <view class="giving-hero">
      <view class="giving-hero__ring giving-hero__ring--one"></view><view class="giving-hero__ring giving-hero__ring--two"></view>
      <text class="giving-hero__eyebrow">GIVING BACK · HUFE</text><text class="giving-hero__title">把一份心意，留给更好的湖财</text><text class="giving-hero__desc">本页不接入支付，仅记录公益参与意向；真实捐赠和证书以学校确认数据为准。</text>
      <view class="giving-hero__promise"><text>0</text><text>页面支付</text><text>·</text><text>意向与学校确认记录</text></view>
    </view>

    <view class="section-head"><view><text class="section-title">公益服务</text><text class="section-kicker">PUBLISHED SERVICES</text></view><text class="section-more">{{ intentCount }} 份我的心愿</text></view>
    <view v-if="loading && !projects.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载公益项目</text></view>
    <view v-else-if="error && !projects.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ error }}</text><button class="secondary-button" @tap="loadState">重新加载</button></view>
    <view v-else-if="projects.length" class="project-list">
      <view v-for="project in projects" :key="project.id" class="project-card surface" :class="{ 'project-card--selected': selectedId === project.id }" @tap="selectedId = project.id">
        <view class="project-card__head"><view><text class="project-card__label">学校后台发布</text><text class="project-card__title">{{ project.title }}</text></view><view class="project-card__tools"><text class="project-detail" @tap.stop="detailProject = project">查看详情</text><view class="project-check">{{ selectedId === project.id ? '✓' : '＋' }}</view></view></view>
        <text class="project-card__summary">{{ project.summaryText }}</text>
      </view>
    </view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">爱</view><text>暂无已发布公益项目</text></view>
    <BusinessDetailSheet
      :open="Boolean(detailProject)"
      :title="detailProject ? detailProject.title : ''"
      :subtitle="detailProject ? (detailProject.organizer || '湖南财政经济学院') : ''"
      eyebrow="PUBLIC SERVICE DETAILS"
      :show-actions="true"
      @close="detailProject = null"
    >
      <template v-if="detailProject">
        <BusinessRichText :content="detailProject.summary" />
        <view class="giving-detail-description"><text>项目详情与合规说明</text><BusinessRichText :content="detailProject.description" empty-text="暂无项目详情" /></view>
        <view v-if="detailProject.officialUrl" class="official-channel" @tap="openOfficialChannel(detailProject.officialUrl)"><text>学校官方办理渠道</text><text>点击打开或复制链接 ›</text></view>
      </template>
      <template #actions>
        <button class="secondary-button" @tap="detailProject = null">关闭</button>
        <button class="primary-button" @tap="chooseDetailedProject">选择该项目</button>
      </template>
    </BusinessDetailSheet>

    <view class="section-head"><view><text class="section-title">记录公益心愿</text><text class="section-kicker">不会发起支付</text></view></view>
    <view class="intent-card surface">
      <text class="intent-card__project">{{ selectedProject ? selectedProject.title : '请选择公益服务' }}</text>
      <view class="amount-options"><view v-for="item in amounts" :key="item" class="amount-chip" :class="{ 'amount-chip--active': selectedAmount === item }" @tap="chooseAmount(item)"><text>¥</text>{{ item }}</view><view class="amount-chip" :class="{ 'amount-chip--active': selectedAmount === 'custom' }" @tap="chooseAmount('custom')">自定义</view></view>
      <view v-if="selectedAmount === 'custom'" class="custom-amount"><text>¥</text><input v-model="customAmount" type="number" maxlength="7" placeholder="输入意向金额" placeholder-class="form-placeholder" /></view>
      <view class="supporter-row"><view><text>心愿署名</text><text>{{ anonymous ? '匿名校友' : supporterName }}</text></view><view class="anonymous-switch" :class="{ 'anonymous-switch--on': anonymous }" @tap="anonymous = !anonymous"><text></text></view></view>
      <button class="primary-button intent-submit" :loading="submitting" :disabled="submitting" @tap="saveIntent">记录公益心愿</button>
    </view>

    <view id="my-giving-records" class="section-head"><view><text class="section-title">我的公益记录 / 证书</text><text class="section-kicker">MY GIVING RECORDS</text></view><text v-if="verified" class="section-more">{{ intentCount }} 条记录</text></view>
    <view v-if="!verified" class="record-guest surface">
      <view class="record-guest__icon">证</view>
      <view><text>登录后查看公益记录</text><text>只有学校后台已签发的公益证书才会显示证书入口。</text></view>
      <button class="secondary-button" @tap="openLogin">登录查看</button>
    </view>
    <view v-else-if="loading && !intents.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在同步我的公益记录</text></view>
    <view v-else-if="intents.length" class="record-list">
      <view v-for="record in intents" :key="record.id" class="record-card surface">
        <view class="record-card__head">
          <view><text class="record-card__eyebrow">公益参与记录</text><text class="record-card__title">{{ recordProjectTitle(record) }}</text></view>
          <text class="record-card__status">{{ recordStatus(record.status) }}</text>
        </view>
        <text class="record-card__time">{{ formatRecordTime(record.createdAt || record.submittedAt) }}</text>
        <view v-if="hasIssuedCertificate(record)" class="certificate-entry" @tap="openCertificate(record)">
          <view class="certificate-entry__seal">证</view>
          <view><text>学校已签发公益证书</text><text>证书金额以学校确认数据为准 · 非捐赠票据</text></view>
          <text>查看 ›</text>
        </view>
        <view v-else class="certificate-pending">
          <text>暂无已签发证书</text>
          <text>当前仅为公益参与意向或办理记录，不代表已完成捐赠。</text>
        </view>
      </view>
    </view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">爱</view><text>暂无公益参与记录</text></view>

    <view class="giving-notice surface"><text class="giving-notice__title">重要说明</text><text>平台不收款、也不生成捐赠票据。学校确认后可能签发公益参与证书，但证书不是捐赠票据；正式捐赠与合法票据请以学校官方渠道为准。</text></view>
    <SupportFooter />
  </view>
</template>

<script>
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { getGivingProjects, getMyGivingIntents, submitGivingIntent } from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { getUser, isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() {
    return {
      projects: [],
      selectedId: '',
      detailProject: null,
      amounts: ['50', '100', '300', '500'],
      selectedAmount: '100',
      customAmount: '',
      anonymous: false,
      supporterName: '湖财校友',
      intentCount: 0,
      intents: [],
      verified: false,
      focusMyRecords: false,
      didFocusMyRecords: false,
      submitting: false,
      loading: false,
      error: ''
    }
  },
  computed: {
    selectedProject() { return this.projects.find((project) => project.id === this.selectedId) },
    intentAmount() { return this.selectedAmount === 'custom' ? Number(this.customAmount) : Number(this.selectedAmount) }
  },
  onLoad(options = {}) {
    this.focusMyRecords = options.tab === 'mine'
  },
  onShow() {
    const user = getUser()
    this.supporterName = user.realName || user.nickName || '湖财校友'
    this.verified = isVerified()
    this.loadState()
  },
  methods: {
    async loadState() {
      if(this.loading)return
      this.loading=true;this.error=''
      try {
        const [published,mine]=await Promise.all([getGivingProjects({page:1,pageSize:100}),this.verified?getMyGivingIntents():Promise.resolve({items:[],total:0})])
        this.projects=published.items.map((item)=>({...item,summaryText:markdownToPlainText(item.summary,{singleLine:true,maxLength:100})||item.provider||''}))
        this.intentCount=mine.total||0
        this.intents=Array.isArray(mine.items)?mine.items:[]
        if(!this.projects.some((item)=>item.id===this.selectedId))this.selectedId=this.projects[0]?.id||''
      }catch(error){this.projects=[];this.intents=[];this.intentCount=0;this.error=error.message||'公益项目加载失败'}finally{
        this.loading=false
        this.focusMyRecordsIfNeeded()
      }
    },
    focusMyRecordsIfNeeded() {
      if (!this.focusMyRecords || this.didFocusMyRecords) return
      this.didFocusMyRecords = true
      this.$nextTick(() => {
        uni.pageScrollTo({ selector: '#my-giving-records', duration: 260 })
      })
    },
    openLogin() { openPage('/pages/verify/index') },
    hasIssuedCertificate(record) {
      const certificate = record && record.certificate
      return Boolean(certificate && typeof certificate === 'object' && !Array.isArray(certificate) && Object.keys(certificate).length)
    },
    openCertificate(record) {
      if (!this.hasIssuedCertificate(record)) return
      openPage(`/pages/giving-certificate/index?id=${encodeURIComponent(record.id)}`)
    },
    recordProjectTitle(record) {
      const project = this.projects.find((item) => String(item.id) === String(record.projectId || record.resourceId))
      return record.projectTitle || record.projectName || project?.title || '公益服务项目'
    },
    recordStatus(status) {
      return {
        submitted: '意向已记录',
        pending: '待学校确认',
        pending_review: '待学校确认',
        approved: '学校已确认',
        completed: '办理已完成',
        rejected: '未通过确认',
        cancelled: '已取消',
        canceled: '已取消'
      }[status] || '办理中'
    },
    formatRecordTime(value) {
      if (!value) return '记录时间待同步'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      const pad = (number) => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
    chooseAmount(amount) {
      this.selectedAmount = amount
      if (amount !== 'custom') this.customAmount = ''
    },
    chooseDetailedProject() {
      if (!this.detailProject) return
      this.selectedId = this.detailProject.id
      this.detailProject = null
    },
    openOfficialChannel(url) {
      if (!/^https?:\/\//i.test(url)) return
      // #ifdef H5
      window.open(url, '_blank', 'noopener,noreferrer')
      // #endif
      // #ifdef APP-PLUS
      plus.runtime.openURL(url)
      // #endif
      // #ifdef MP-WEIXIN || MP-ALIPAY
      uni.setClipboardData({ data: url, success: () => uni.showToast({ title: '学校官方链接已复制', icon: 'none' }) })
      // #endif
    },
    saveIntent() {
      if (!isVerified()) { openPage('/pages/verify/index'); return }
      if (!this.selectedProject) {
        uni.showToast({ title: '请选择公益服务', icon: 'none' })
        return
      }
      if (!this.intentAmount || this.intentAmount < 1) {
        uni.showToast({ title: '请输入有效的意向金额', icon: 'none' })
        return
      }
      uni.showModal({
        title: '记录公益心愿',
        content: `将记录“${this.selectedProject.title}”公益心愿 ¥${this.intentAmount}。本操作不会发起支付。`,
        confirmText: '仅记录',
        success: async (res) => {
          if (!res.confirm) return
          this.submitting=true
          try{await submitGivingIntent({projectId:this.selectedProject.id,amount:this.intentAmount,anonymous:this.anonymous,message:`意向服务：${this.selectedProject.title}`});await this.loadState();uni.showToast({title:'公益心愿已记录'})}
          catch(error){uni.showModal({title:'记录失败',content:error.message||'请稍后重试',showCancel:false})}
          finally{this.submitting=false}
        }
      })
    }
  }
}
</script>

<style scoped>
.giving-page{padding-top:14rpx}.giving-hero{position:relative;padding:38rpx 34rpx;overflow:hidden;border-radius:36rpx;color:#FFF;background:linear-gradient(145deg,#102D50,#0A397A);box-shadow:0 22rpx 48rpx rgba(11,58,130,.19)}.giving-hero__ring{position:absolute;border:1rpx solid rgba(225,197,141,.18);border-radius:50%}.giving-hero__ring--one{width:250rpx;height:250rpx;right:-70rpx;top:-100rpx}.giving-hero__ring--two{width:140rpx;height:140rpx;right:-10rpx;top:-44rpx}.giving-hero__eyebrow,.giving-hero__title,.giving-hero__desc{position:relative;z-index:1;display:block}.giving-hero__eyebrow{color:#E1C58D;font-size:18rpx;font-weight:700;letter-spacing:4rpx}.giving-hero__title{width:520rpx;margin-top:15rpx;font-size:39rpx;line-height:1.35;font-weight:700}.giving-hero__desc{width:540rpx;margin-top:12rpx;color:rgba(255,255,255,.7);font-size:20rpx;line-height:1.6}.giving-hero__promise{position:relative;z-index:1;margin-top:25rpx;display:flex;align-items:baseline;flex-wrap:wrap;color:rgba(255,255,255,.65);font-size:18rpx}.giving-hero__promise text{margin-right:10rpx}.giving-hero__promise text:first-child{color:#E1C58D;font-family:Georgia,serif;font-size:34rpx;font-weight:700}.project-list,.record-list{display:flex;flex-direction:column}.project-card{margin-bottom:18rpx;padding:27rpx;border:2rpx solid transparent}.project-card--selected{border-color:rgba(11,58,130,.25);box-shadow:0 16rpx 38rpx rgba(11,58,130,.1)}.project-card__head{display:flex;justify-content:space-between}.project-card__label,.project-card__title,.project-card__summary{display:block}.project-card__label{color:#9A7337;font-size:18rpx;font-weight:650}.project-card__title{margin-top:8rpx;font-size:29rpx;font-weight:700}.project-card__tools{margin-left:16rpx;display:flex;align-items:center;gap:10rpx}.project-detail{padding:7rpx 11rpx;border-radius:99rpx;color:#064A91;background:#E9F0F8;font-size:17rpx;font-weight:600}.project-check{width:52rpx;height:52rpx;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#033481;background:#E9EFF9;font-size:27rpx;font-weight:700}.project-card--selected .project-check{color:#FFF;background:#033481}.project-card__summary{margin-top:12rpx;color:#7F8999;font-size:21rpx}.intent-card{padding:28rpx}.intent-card__project{display:block;color:#243047;font-size:27rpx;font-weight:700}.amount-options{margin:22rpx -6rpx 0;display:flex;flex-wrap:wrap}.amount-chip{width:calc(33.333% - 12rpx);height:68rpx;margin:6rpx;display:flex;align-items:center;justify-content:center;border:1rpx solid #E0E5EC;border-radius:18rpx;color:#556277;background:#FFF;font-size:23rpx;font-weight:600}.amount-chip text{margin-right:2rpx;font-size:17rpx}.amount-chip--active{border-color:#033481;color:#033481;background:#EAF0F9}.custom-amount{height:80rpx;margin-top:14rpx;padding:0 20rpx;display:flex;align-items:center;border-radius:18rpx;background:#F4F6FA;color:#033481;font-size:25rpx}.custom-amount input{flex:1;height:80rpx;margin-left:10rpx;color:#243047;font-size:24rpx}.supporter-row{margin-top:22rpx;padding:22rpx 0;display:flex;align-items:center;justify-content:space-between;border-top:1rpx solid #EDF0F4}.supporter-row text{display:block}.supporter-row text:first-child{color:#4C596D;font-size:21rpx;font-weight:600}.supporter-row text:last-child{margin-top:5rpx;color:#929BA9;font-size:18rpx}.anonymous-switch{width:74rpx;height:40rpx;padding:5rpx;border-radius:99rpx;background:#D9DEE6}.anonymous-switch text{width:30rpx;height:30rpx;border-radius:50%;background:#FFF;box-shadow:0 3rpx 8rpx rgba(0,0,0,.12);transition:transform .2s}.anonymous-switch--on{background:#033481}.anonymous-switch--on text{transform:translateX(34rpx)}.intent-submit{margin:6rpx 0 0}.record-guest{padding:26rpx;display:flex;align-items:center;gap:18rpx}.record-guest__icon{width:66rpx;height:66rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:21rpx;color:#805E29;background:#F5EAD7;font-size:24rpx;font-weight:700}.record-guest>view:nth-child(2){min-width:0;flex:1}.record-guest text{display:block}.record-guest text:first-child{color:#2C3B52;font-size:23rpx;font-weight:700}.record-guest text:last-child{margin-top:6rpx;color:#8993A2;font-size:18rpx;line-height:1.55}.record-guest button{width:auto;margin:0;padding:0 18rpx;flex-shrink:0}.record-card{margin-bottom:18rpx;padding:26rpx}.record-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:18rpx}.record-card__head>view{min-width:0;flex:1}.record-card__eyebrow,.record-card__title,.record-card__time{display:block}.record-card__eyebrow{color:#9A7337;font-size:17rpx;font-weight:700;letter-spacing:1rpx}.record-card__title{margin-top:7rpx;color:#25364E;font-size:26rpx;font-weight:700}.record-card__status{padding:7rpx 12rpx;flex-shrink:0;border-radius:99rpx;color:#315C55;background:#E4F0EC;font-size:16rpx;font-weight:650}.record-card__time{margin-top:10rpx;color:#96A0AE;font-size:18rpx}.certificate-entry,.certificate-pending{margin-top:20rpx;padding:20rpx;border-radius:20rpx}.certificate-entry{display:flex;align-items:center;background:linear-gradient(105deg,#FFF8E9,#F3E7CF);border:1rpx solid #E8D4AD}.certificate-entry__seal{width:60rpx;height:60rpx;margin-right:16rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2rpx solid #A77A36;border-radius:50%;color:#8C652A;font-family:serif;font-size:23rpx;font-weight:700}.certificate-entry>view:nth-child(2){min-width:0;flex:1}.certificate-entry text{display:block}.certificate-entry>view:nth-child(2) text:first-child{color:#66491F;font-size:22rpx;font-weight:700}.certificate-entry>view:nth-child(2) text:last-child{margin-top:5rpx;color:#937A54;font-size:17rpx}.certificate-entry>text{margin-left:12rpx;color:#805E29;font-size:19rpx;font-weight:700}.certificate-pending{background:#F5F7FA}.certificate-pending text{display:block}.certificate-pending text:first-child{color:#626F81;font-size:20rpx;font-weight:650}.certificate-pending text:last-child{margin-top:5rpx;color:#98A0AC;font-size:17rpx;line-height:1.55}.giving-notice{margin-top:22rpx;padding:23rpx;color:#7F8998;background:#FFF;font-size:19rpx;line-height:1.65}.giving-notice text{display:block}.giving-notice__title{margin-bottom:5rpx;color:#805E29;font-size:21rpx;font-weight:700}.giving-detail-description{margin-top:24rpx;padding-top:22rpx;border-top:1rpx solid #E9EDF3}.giving-detail-description>text{display:block;margin-bottom:12rpx;color:#2F3D53;font-size:23rpx;font-weight:700}.official-channel{margin-top:24rpx;padding:20rpx;border-radius:20rpx;background:#EAF0F8}.official-channel text{display:block}.official-channel text:first-child{color:#033481;font-size:21rpx;font-weight:700}.official-channel text:last-child{margin-top:5rpx;color:#63748A;font-size:18rpx}
@media screen and (min-width:768px){.record-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.record-card{margin:0}.record-guest{padding:28px}.giving-hero__title,.giving-hero__desc{width:auto;max-width:700px}}
</style>
