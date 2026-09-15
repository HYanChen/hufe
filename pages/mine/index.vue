<template>
  <view class="page-shell page-shell--tab mine-page">
    <view class="mine-dashboard-layout">
      <view class="profile-card">
        <view class="profile-card__top">
          <view class="profile-avatar"><image :src="logoUrl" mode="aspectFit" /></view>
          <view class="profile-main">
            <view class="profile-name-row"><text class="profile-name">{{ user.realName || '湖财人' }}</text><text v-if="signedIn" class="profile-verified">{{ identityBadge }}</text></view>
            <text class="profile-meta">{{ signedIn ? `${roleLabel} · ${user.department || '平台账号已登录'}` : '尚未登录湖财人平台账号' }}</text>
            <text class="profile-meta">{{ identityDescription }}</text>
          </view>
        </view>
        <view class="profile-card__id"><view><text class="profile-card__id-label">{{ identityLabelText }}</text><text class="profile-card__id-value">{{ identityNumber }}</text></view><text class="profile-card__seal">HUFE</text></view>
      </view>

      <view class="mine-workbench-pane">
        <view class="section-head workbench-head"><view><text class="section-title">我的办理</text><text class="section-kicker">APPLICATIONS & PROGRESS</text></view><text class="section-more" @tap="open('/pages/inbox/index?filter=progress')">全部进度 ›</text></view>
        <view class="workbench-grid">
          <view v-for="item in filterModuleEntries(workbenchCards)" :key="item.key" class="workbench-card surface" @tap="open(item.url)">
            <view class="workbench-card__head"><view :class="`workbench-card__icon workbench-card__icon--${item.tone}`">{{ item.icon }}</view><text v-if="item.badge">{{ item.badge }}</text></view>
            <text class="workbench-card__value">{{ displayCount(item.value) }}</text>
            <text class="workbench-card__title">{{ item.title }}</text>
            <text class="workbench-card__desc">{{ item.desc }}</text>
          </view>
        </view>
        <view v-if="dashboardError && verified" class="dashboard-warning surface"><text>!</text><text>{{ dashboardError }}</text><text @tap="load">重试</text></view>

        <view class="progress-entry surface" @tap="open('/pages/inbox/index')">
          <view class="progress-entry__icon">信<text v-if="dashboard.inbox">{{ dashboard.inbox > 99 ? '99+' : dashboard.inbox }}</text></view>
          <view><text>{{ dashboard.pending ? `还有 ${dashboard.pending} 项办理待处理` : '消息与办理进度中心' }}</text><text>集中查看通知、审核结果与服务状态变化</text></view>
          <text>›</text>
        </view>
      </view>
    </view>

    <view class="mine-menu-columns">
      <view v-if="filterModuleEntries(businessMenus).length" class="mine-menu-section">
        <view class="section-head"><view><text class="section-title">我的业务</text><text class="section-kicker">PERSONAL SERVICES</text></view></view>
        <view class="menu-list surface">
          <view v-for="(item,index) in filterModuleEntries(businessMenus)" :key="item.title" class="menu-item" :class="{ 'menu-item--border': index !== filterModuleEntries(businessMenus).length - 1 }" @tap="open(item.url)">
            <view class="menu-item__icon">{{ item.icon }}</view><view class="menu-item__body"><text class="menu-item__title">{{ item.title }}</text><text class="menu-item__desc">{{ item.desc }}</text></view><text class="menu-item__arrow">›</text>
          </view>
        </view>
      </view>

      <view class="mine-menu-section">
        <view class="section-head"><view><text class="section-title">账号与平台</text><text class="section-kicker">ACCOUNT & PLATFORM</text></view></view>
        <view class="menu-list surface">
          <view v-for="(item,index) in filterModuleEntries(accountMenus)" :key="item.title" class="menu-item" :class="{ 'menu-item--border': index !== filterModuleEntries(accountMenus).length - 1 }" @tap="open(item.url)">
            <view class="menu-item__icon menu-item__icon--muted">{{ item.icon }}</view><view class="menu-item__body"><text class="menu-item__title">{{ item.title }}</text><text class="menu-item__desc">{{ item.desc }}</text></view><text class="menu-item__arrow">›</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="isModuleEnabled('gate') && gateRole?.canScan" class="progress-entry surface" @tap="open('/pages/gate/index')"><view class="progress-entry__icon">核</view><view><text>返校身份核验工作台</text><text>{{ gateRole.canManage ? '管理核验人员、站点并查看办理记录' : '扫码核对身份，确认放行并保留记录' }}</text></view><text>›</text></view>
    <view class="utility-list surface">
      <view class="utility-item" @tap="signedIn ? signOut() : open('/pages/verify/index')"><text>{{ signedIn ? '退出当前账号' : '登录湖财人账号' }}</text><text>›</text></view>
      <template v-if="verified"><view class="divider"></view><view class="utility-item utility-item--danger" @tap="deactivateAccount"><text>注销平台账号</text><text>›</text></view></template>
      <view class="divider"></view><view class="utility-item" @tap="reset"><text>清理本机业务缓存</text><text>›</text></view>
    </view>
    <text class="version-note">湖财人 · 师生员工与校友实名服务平台</text>
    <SupportFooter />
  </view>
</template>

<script>
import { isManualVerification, manualVerificationDescription } from '../../utils/identityVerification'
import { appConfig } from '../../config/index'
import { clearLocalUiCache, getPlatformUser, isSignedIn, identityLabel, isVerified, getAccessToken } from '../../utils/store'
import { getMyBenefitClaims, getMyDashboardSummary, getMyInbox } from '../../services/business'
import { deactivatePlatformAccount, logoutPlatformAccount, refreshPlatformProfile } from '../../services/schoolAuth'
import { openPage } from '../../utils/nav'
import { gateApi } from '../../services/gate'

const emptyDashboard = () => ({ activities: null, posts: null, collaborations: null, organizations: null, applications: null, pending: null, benefits: null, inbox: null })

export default {
  data() {
    return {
      user: {}, verified: false, signedIn: false, logoUrl: appConfig.officialLogoUrl, dashboard: emptyDashboard(), dashboardError: '', gateRole: null, gateVersion: 0,
      businessMenus: [
        { icon:'会',title:'活动与报名',desc:'发现活动并查看本人报名记录',url:'/pages/events/index' },
        { icon:'合',title:'我的合作发布',desc:'查看合作需求的审核与公开状态',url:'/pages/collaboration/index?tab=mine' },
        { icon:'爱',title:'公益回馈与证书',desc:'查看公益意向、学校确认记录与已签发证书',url:'/pages/giving/index?tab=mine' },
        { icon:'企',title:'企业主工作台',desc:'企业认证、资料维护与招聘管理',url:'/pages/enterprise-owner/index' },
        { icon:'组',title:'组织与校友网络',desc:'加入校友组织并寻找同城校友',url:'/pages/chapters/index' },
        { icon:'师',title:'我的导师服务',desc:'申请导师或维护本人导师资料',url:'/pages/mentors/index' }
      ],
      accountMenus: [
        { icon:'我',title:'我的资料',desc:'学院、专业、班级、学号与个人资料',url:'/pages/profile/index' },
        { icon:'聊',title:'我的对话',desc:'私聊、群聊与文件分享',url:'/pages/conversations/index' },
        { icon:'账',title:'平台账号与实名资料',desc:'查看当前账号和只读身份资料',url:'/pages/verify/index' },
        { icon:'卡',title:'我的湖财身份卡',desc:'实名身份展示与平台动态核验码',url:'/pages/card/index' },
        { icon:'服',title:'全部服务',desc:'按找、办、联、学、享查找服务',url:'/pages/services/index' },
        { icon:'关',title:'关于湖财人',desc:'平台说明、隐私边界与技术支持',url:'/pages/about/index' }
      ]
    }
  },
  computed: {
    roleLabel() { return this.gateRole?.role === 'guard' ? '核验人员' : this.gateRole?.role === 'manager' ? '保卫负责人' : identityLabel(this.user.personType) },
    developmentVerifiedFixture() {
      return this.user.localDevelopmentOnly === true && this.user.developmentSchoolIdentityFixture === true
    },
    identityBadge() {
      if (!this.verified) return '✓ 平台已登录'
      if (this.developmentVerifiedFixture) return '✓ 模拟实名'
      if (isManualVerification(this.user)) return '✓ 已通过校验'
      return this.user.schoolIdentityVerified === true ? '✓ 学校实名' : '✓ 本机演示'
    },
    identityDescription() {
      if (!this.signedIn) return '登录后使用实名校园服务'
      if (!this.verified) return this.gateRole?.canScan ? '已获授权进行平台返校身份核验' : '平台账号已登录；学校实名校验尚未完成'
      if (this.developmentVerifiedFixture) return '学校实名校验已完成（开发演示）'
      if (isManualVerification(this.user)) return manualVerificationDescription(this.user)
      if (this.user.schoolIdentityVerified === true) return '实名信息已从学校系统同步'
      return '当前为本机开发演示账号'
    },
    identityLabelText() {
      if (!this.verified) return 'HUCAIREN ACCOUNT'
      return this.developmentVerifiedFixture ? 'SIMULATED SCHOOL IDENTITY' : 'SCHOOL IDENTITY'
    },
    identityNumber() {
      if (!this.signedIn) return '尚未登录平台账号'
      if (!this.verified) return this.user.username || this.user.realName || '平台账号已登录'
      return this.user.alumniNo || this.user.studentIdDisplay || this.user.studentIdMasked || '学校身份已确认'
    },
    workbenchCards() {
      return [
        { key:'pending',icon:'待',title:'待处理',desc:'等待审核或需要补充',value:this.dashboard.pending,tone:'gold',badge:this.dashboard.pending ? '需关注' : '',url:'/pages/inbox/index?filter=progress' },
        { key:'applications',icon:'办',title:'全部办理',desc:'报名、申请与意向',value:this.dashboard.applications,tone:'blue',url:'/pages/inbox/index?filter=progress' },
        { key:'benefits',icon:'享',title:'我的权益',desc:'领取记录与核销说明',value:this.dashboard.benefits,tone:'green',url:'/pages/benefits/index?tab=mine' },
        { key:'inbox',icon:'信',title:'未读消息',desc:'通知和状态变化',value:this.dashboard.inbox,tone:'red',badge:this.dashboard.inbox ? '新消息' : '',url:'/pages/inbox/index?filter=unread' }
      ]
    }
  },
  onLoad() { uni.$on('hufe-auth-changed', this.load) },
  onShow() { this.load(); this.refreshLogin() },
  onUnload() { this.gateVersion++; uni.$off('hufe-auth-changed', this.load) },
  methods: {
    async refreshLogin() {
      if (!getAccessToken() || isSignedIn()) return
      try { await refreshPlatformProfile() } catch { /* 验证失败时不将持久化令牌当成已登录；可由登录页重试 */ }
    },
    async loadGate() {
      const version = ++this.gateVersion, token = getAccessToken(); this.gateRole = null
      if (!token) return
      try { const role = await gateApi('/me', { token }); if (version === this.gateVersion && token === getAccessToken()) this.gateRole = role } catch { /* 普通人员不展示工作台入口；服务端仍逐次校验权限 */ }
    },
    displayCount(value) {
      if (!this.verified || value === null || value === undefined) return '—'
      return value > 999 ? '999+' : String(value)
    },
    async load() {
      this.loadGate()
      this.user = getPlatformUser()
      this.signedIn = isSignedIn()
      this.verified = isVerified()
      this.dashboardError = ''
      if (!this.verified) {
        this.dashboard = emptyDashboard()
        return
      }
      const results = await Promise.allSettled([
        getMyDashboardSummary(),
        getMyInbox({ page: 1, pageSize: 1 }),
        getMyBenefitClaims({ page: 1, pageSize: 1 })
      ])
      const next = { ...this.dashboard }
      if (results[0].status === 'fulfilled') Object.assign(next, results[0].value)
      if (results[1].status === 'fulfilled') next.inbox = Number(results[1].value.unread || 0)
      if (results[2].status === 'fulfilled') next.benefits = Number(results[2].value.total ?? results[2].value.items?.length ?? 0)
      this.dashboard = next
      if (results.some((item) => item.status === 'rejected')) this.dashboardError = '部分办理数据暂未同步，可稍后重试'
    },
    open(url) { openPage(url) },
    signOut() {
      uni.showModal({
        title:'退出账号', content:'退出后可使用平台用户名和密码重新登录，无需再次前往学校官网校验。', confirmColor:'#033481',
        success:async(res)=>{ if(res.confirm){await logoutPlatformAccount();this.load();uni.showToast({title:'已退出'})} }
      })
    },
    deactivateAccount() {
      uni.showModal({
        title:'注销平台账号', content:'账号将立即停用并退出。若再次注册，需重新通过学校官网实名校验；该操作不会注销学校账号。', confirmText:'确认注销', confirmColor:'#9A403B',
        success:async(res)=>{ if(!res.confirm)return;try{await deactivatePlatformAccount();this.load();uni.showToast({title:'平台账号已注销',icon:'none'})}catch(error){uni.showModal({title:'注销失败',content:error.message||'请稍后重试',showCancel:false})} }
      })
    },
    reset() {
      uni.showModal({
        title:'清理本机缓存', content:'将清理本机草稿和兼容缓存，不会删除服务端报名、申请、动态或学校实名资料。', confirmColor:'#033481',
        success:(res)=>{ if(res.confirm){clearLocalUiCache();uni.removeStorageSync('hufe_community_post_draft');this.load();uni.showToast({title:'已清理'})} }
      })
    }
  }
}
</script>

<style scoped>
.mine-page{padding-top:12rpx}.mine-dashboard-layout,.mine-workbench-pane,.mine-menu-section{min-width:0}.profile-card{position:relative;min-height:420rpx;padding:36rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#033481 0%,#033481 54%,#1e5ca3 100%);box-shadow:0 24rpx 54rpx rgba(10,50,108,.22)}.profile-card__top{position:relative;z-index:2;display:flex;flex-direction:column;align-items:flex-start}.profile-avatar{width:270rpx;height:60rpx;display:flex;align-items:center;justify-content:center}.profile-avatar image{width:100%;height:100%}.profile-main{min-width:0;margin-top:20rpx}.profile-name-row{display:flex;align-items:center}.profile-name{font-size:38rpx;font-weight:700}.profile-verified{margin-left:14rpx;padding:7rpx 13rpx;border-radius:99rpx;color:#765723;background:#e3c68b;font-size:17rpx;font-weight:700}.profile-meta{display:block;max-width:540rpx;margin-top:9rpx;overflow:hidden;color:rgba(255,255,255,.64);font-size:21rpx;text-overflow:ellipsis;white-space:nowrap}.profile-card__id{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:34rpx;padding-top:24rpx;display:flex;align-items:flex-end;justify-content:space-between;border-top:1rpx solid rgba(255,255,255,.16)}.profile-card__id-label,.profile-card__id-value{display:block}.profile-card__id-label{color:rgba(255,255,255,.46);font-size:17rpx;letter-spacing:3rpx}.profile-card__id-value{margin-top:8rpx;color:#e8d2a7;font-family:Georgia,serif;font-size:22rpx;letter-spacing:1rpx}.profile-card__seal{color:rgba(255,255,255,.18);font-family:Georgia,serif;font-size:50rpx;font-weight:700;letter-spacing:4rpx}.workbench-head{margin-top:32rpx}.workbench-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16rpx}.workbench-card{min-width:0;padding:23rpx}.workbench-card__head{height:50rpx;display:flex;align-items:center;justify-content:space-between}.workbench-card__head>text{padding:5rpx 9rpx;border-radius:99rpx;color:#93423f;background:#f7e5e3;font-size:15rpx}.workbench-card__icon{width:50rpx;height:50rpx;display:flex;align-items:center;justify-content:center;border-radius:16rpx;font-size:19rpx;font-weight:700}.workbench-card__icon--blue{color:#033481;background:#e7eef9}.workbench-card__icon--gold{color:#846129;background:#f7ebd7}.workbench-card__icon--green{color:#176551;background:#e5f2ed}.workbench-card__icon--red{color:#974a46;background:#f7e8e6}.workbench-card__value,.workbench-card__title,.workbench-card__desc{display:block}.workbench-card__value{margin-top:18rpx;color:#173754;font-size:38rpx;font-weight:700}.workbench-card__title{margin-top:4rpx;color:#334157;font-size:22rpx;font-weight:700}.workbench-card__desc{margin-top:5rpx;color:#9099a6;font-size:17rpx}.dashboard-warning{margin-top:16rpx;padding:18rpx;display:flex;align-items:center;color:#7b6a50;font-size:18rpx}.dashboard-warning text:first-child{width:42rpx;height:42rpx;margin-right:12rpx;display:flex;align-items:center;justify-content:center;border-radius:14rpx;color:#876225;background:#f5e9d1;font-weight:700}.dashboard-warning text:nth-child(2){min-width:0;flex:1}.dashboard-warning text:last-child{color:#033481;font-weight:650}.progress-entry{margin-top:20rpx;padding:23rpx;display:flex;align-items:center;background:linear-gradient(105deg,#fff,#eef4fa)}.progress-entry__icon{position:relative;width:64rpx;height:64rpx;margin-right:17rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:21rpx;color:#fff;background:#033481;font-weight:700}.progress-entry__icon>text{position:absolute;right:-9rpx;top:-9rpx;min-width:30rpx;height:30rpx;padding:0 6rpx;display:flex;align-items:center;justify-content:center;border:3rpx solid #fff;border-radius:99rpx;color:#fff;background:#a64f4a;font-size:12rpx}.progress-entry>view:nth-child(2){min-width:0;flex:1}.progress-entry>view:nth-child(2) text{display:block}.progress-entry>view:nth-child(2) text:first-child{color:#334157;font-size:23rpx;font-weight:700}.progress-entry>view:nth-child(2) text:last-child{margin-top:5rpx;color:#8c96a4;font-size:18rpx}.progress-entry>text{color:#033481;font-size:36rpx}.menu-list{padding:0 24rpx}.menu-item{padding:24rpx 0;display:flex;align-items:center}.menu-item--border{border-bottom:1rpx solid #edf0f4}.menu-item__icon{width:64rpx;height:64rpx;display:flex;align-items:center;justify-content:center;border-radius:20rpx;color:#033481;background:#e9eff9;font-size:23rpx;font-weight:700}.menu-item__icon--muted{color:#755a31;background:#f4e9d6}.menu-item__body{flex:1;margin-left:20rpx}.menu-item__title,.menu-item__desc{display:block}.menu-item__title{font-size:26rpx;font-weight:600}.menu-item__desc{margin-top:6rpx;color:#939ba8;font-size:19rpx}.menu-item__arrow{color:#b0b7c2;font-size:38rpx}.utility-list{margin-top:24rpx;padding:0 24rpx}.utility-item{height:86rpx;display:flex;align-items:center;justify-content:space-between;color:#4a566a;font-size:24rpx}.utility-item text:last-child{color:#b0b7c2;font-size:36rpx}.utility-item--danger{color:#963f3b}.version-note{display:block;margin:30rpx 0 10rpx;color:#abb1bc;font-size:18rpx;text-align:center}
@media screen and (min-width:768px){.workbench-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.profile-card__top{flex-direction:row;align-items:flex-start}.profile-main{margin:0 0 0 24px}.menu-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px}.menu-item:nth-child(odd){border-bottom:1rpx solid #edf0f4}.profile-card{min-height:360px}}
@media screen and (min-width:1200px){.mine-dashboard-layout{display:grid;grid-template-columns:minmax(390px,.78fr) minmax(0,1.22fr);gap:28px;align-items:stretch}.profile-card{min-height:100%;padding:44px 40px;border-radius:34px}.profile-card__top{display:block}.profile-avatar{width:320px;height:72px}.profile-main{margin:30px 0 0}.profile-name{font-size:38px}.profile-meta{max-width:520px;margin-top:11px;font-size:17px}.profile-card__id{left:40px;right:40px;bottom:40px;padding-top:28px}.profile-card__id-label{font-size:14px}.profile-card__id-value{font-size:20px}.profile-card__seal{font-size:62px}.mine-workbench-pane{display:flex;flex-direction:column}.mine-workbench-pane .workbench-head{margin:4px 4px 20px}.mine-workbench-pane .workbench-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.workbench-card{min-height:170px;padding:22px}.workbench-card__value{font-size:34px}.workbench-card__title{font-size:17px}.workbench-card__desc{font-size:14px}.progress-entry{margin-top:16px;padding:20px}.mine-menu-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}.mine-menu-section .menu-list{display:block}.mine-menu-section .menu-item{border-bottom:1px solid #edf0f4}.mine-menu-section .menu-item:last-child{border-bottom:none}.mine-menu-section .section-head{margin-top:44px}.menu-item{padding:24px}.menu-item__title{font-size:18px}.menu-item__desc{font-size:14px}.utility-list{max-width:720px;margin:32px auto 0}}
@media screen and (max-width:360px){.profile-card{padding-left:26rpx;padding-right:26rpx}.workbench-card{padding:19rpx}.workbench-card__desc{min-height:48rpx}}
</style>
