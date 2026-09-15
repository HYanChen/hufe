<template>
  <view class="page-shell page-shell--tab services-page">
    <view class="service-hero">
      <view class="service-hero__brand"><image :src="logoUrl" mode="aspectFit" /><text>HUFE SERVICE HUB</text></view>
      <text class="service-hero__title">从需求出发，找到真正要办的事</text>
      <text class="service-hero__desc">按“找、办、联、学、享”组织全校师生、教职工与校友服务。</text>
      <text class="service-hero__seal">服务</text>
    </view>

    <view class="service-tools">
      <view class="workbench-entry surface" @tap="open('/pages/inbox/index?filter=progress')">
        <view class="workbench-entry__icon">办<text v-if="pendingCount">{{ pendingCount > 99 ? '99+' : pendingCount }}</text></view>
        <view class="workbench-entry__body"><text>我的办理与进度</text><text>{{ verified ? (pendingCount ? `有 ${pendingCount} 项待处理事项` : '查看申请、审核和服务通知') : '登录后查看本人办理记录' }}</text></view>
        <text>进入 ›</text>
      </view>

      <view class="search-box surface">
        <text>⌕</text>
        <input v-model="keyword" placeholder="搜索服务名称、场景或服务单位" placeholder-class="field-placeholder" />
        <text v-if="keyword" @tap="keyword = ''">×</text>
      </view>

      <view class="task-scroll">
        <view class="task-row">
          <view v-for="task in taskOptions" :key="task.key" class="task-chip" :class="{ 'task-chip--active': activeTask === task.key }" @tap="activeTask = task.key">
            <text>{{ task.icon }}</text><view><text>{{ task.label }}</text><text>{{ task.hint }}</text></view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="catalogError" class="catalog-warning surface"><text>!</text><view><text>后台服务目录暂不可用</text><text>核心服务仍可正常查找，恢复后将自动补充最新服务。</text></view><text @tap="load">重试</text></view>

    <template v-for="group in visibleGroups" :key="group.key">
      <view class="section-head"><view><text class="section-title">{{ group.icon }} · {{ group.label }}</text><text class="section-kicker">{{ group.description }}</text></view><text class="section-more">{{ group.items.length }} 项</text></view>
      <view class="service-grid surface">
        <view v-for="service in group.items" :key="service.key" class="service-item" @tap="selectedService = service">
          <view class="service-item__icon" :class="`service-item__icon--${service.tone}`">{{ service.icon }}</view>
          <view class="service-item__body"><text class="service-item__title">{{ service.title }}</text><text class="service-item__desc">{{ service.desc }}</text><text class="service-item__provider">{{ service.provider }}</text></view>
          <text class="service-item__arrow">›</text>
        </view>
      </view>
    </template>

    <view v-if="loading && !allServices.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载服务目录</text></view>
    <view v-else-if="!visibleGroups.length" class="empty-state surface"><view class="empty-state__icon">服</view><text>没有匹配的服务</text><button class="secondary-button reset-button" @tap="resetSearch">清除筛选</button></view>

    <BusinessDetailSheet
      :open="Boolean(selectedService)"
      :title="selectedService ? selectedService.title : ''"
      :subtitle="selectedService ? selectedService.provider : ''"
      eyebrow="SERVICE DETAILS"
      :show-actions="true"
      @close="selectedService = null"
    >
      <template v-if="selectedService">
        <view class="service-detail-meta"><text>{{ taskLabel(selectedService.task) }}</text><text>{{ selectedService.category }}</text><text>{{ selectedService.audience }}</text></view>
        <BusinessRichText :content="selectedService.summary || selectedService.desc" empty-text="暂无服务说明" />
        <view class="service-detail-note"><text>办</text><text>实际办理条件和处理结果以对应业务页面及学校后台审核记录为准。</text></view>
      </template>
      <template #actions>
        <button class="secondary-button" @tap="selectedService = null">继续查找</button>
        <button class="primary-button" :disabled="!selectedService || !selectedService.url" @tap="openSelectedService">进入服务</button>
      </template>
    </BusinessDetailSheet>

    <view class="service-note"><view></view><text>核心服务持续可达 · 后台目录动态补充</text><view></view></view>
    <SupportFooter />
  </view>
</template>

<script>
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { appConfig } from '../../config/index'
import { getMyDashboardSummary, getServiceCatalog } from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { isVerified } from '../../utils/store'
import { consumeTabPageQuery, openPage } from '../../utils/nav'

const taskOptions = [
  { key: 'all', icon: '全', label: '全部', hint: '服务总览', description: '覆盖身份、连接、成长与回馈场景' },
  { key: 'find', icon: '找', label: '找资源', hint: '校友与组织', description: '找校友、组织、活动与身边资源' },
  { key: 'handle', icon: '办', label: '办服务', hint: '校园事项', description: '身份、返校、报名与意见办理' },
  { key: 'connect', icon: '联', label: '联机会', hint: '人脉与合作', description: '企业、合作、导师与湖财圈连接' },
  { key: 'learn', icon: '学', label: '学成长', hint: '课堂与职业', description: '资讯、课堂与职业成长内容' },
  { key: 'enjoy', icon: '享', label: '享权益', hint: '专属与回馈', description: '专属权益、志愿服务与公益回馈' }
]

const coreServices = [
  { task:'find',icon:'录',title:'校友名录',desc:'按学院、年级与地区寻找校友',provider:'湖财人平台',url:'/pages/directory/index',category:'校友连接',audience:'学校实名用户' },
  { task:'find',icon:'城',title:'同城地图',desc:'查看校友城市分布与同城网络',provider:'湖财人平台',url:'/pages/alumni-map/index',category:'校友连接',audience:'全体用户' },
  { task:'find',icon:'组',title:'校友组织',desc:'连接同级、同班、同专业与同兴趣校友',provider:'校友工作办公室',url:'/pages/chapters/index',category:'校友组织',audience:'学校实名用户' },
  { task:'find',icon:'会',title:'校友活动',desc:'发现近期活动并查看报名记录',provider:'湖南财政经济学院',url:'/pages/events/index',category:'活动服务',audience:'全体用户' },
  { task:'handle',icon:'证',title:'账号与实名',desc:'登录并查看学校实名资料',provider:'湖财人平台',url:'/pages/verify/index',category:'账号服务',audience:'全体用户' },
  { task:'handle',icon:'核',title:'人工实名认证',desc:'老校友提交证明材料，由学校授权管理员人工复核',provider:'湖南财政经济学院',url:'/pages/manual-verification/index',category:'身份服务',audience:'无法使用学校官网校验的老校友' },
  { task:'handle',icon:'卡',title:'湖财身份卡',desc:'展示本人学校实名身份',provider:'湖财人平台',url:'/pages/card/index',category:'身份服务',audience:'学校实名用户' },
  { task:'handle',icon:'返',title:'返校预约',desc:'提交返校来访计划并跟踪审核',provider:'湖南财政经济学院',url:'/pages/campus-visit/index',category:'校园服务',audience:'学校实名用户' },
  { task:'handle',icon:'议',title:'意见建议',desc:'提交问题建议并查看处理进度',provider:'湖财人平台',url:'/pages/feedback/index',category:'校园服务',audience:'登录用户' },
  { task:'connect',icon:'圈',title:'湖财圈',desc:'发布动态，连接师生与校友',provider:'湖财人平台',url:'/pages/community/index',category:'互动社区',audience:'全体用户' },
  { task:'connect',icon:'企',title:'校友企业馆',desc:'发现校友企业与专业能力',provider:'湖财人平台',url:'/pages/enterprises/index',category:'资源合作',audience:'全体用户' },
  { task:'connect',icon:'主',title:'企业主工作台',desc:'企业认证、资料维护与招聘管理',provider:'湖财人平台',url:'/pages/enterprise-owner/index',category:'企业服务',audience:'学校实名企业负责人' },
  { task:'connect',icon:'合',title:'合作广场',desc:'发现或实名发布合作需求',provider:'湖财人平台',url:'/pages/collaboration/index',category:'资源合作',audience:'学校实名用户' },
  { task:'connect',icon:'师',title:'校友导师',desc:'连接行业导师与成长经验',provider:'湖财人平台',url:'/pages/mentors/index',category:'成长连接',audience:'学校实名用户' },
  { task:'learn',icon:'闻',title:'湖财官网资讯',desc:'同步学校要闻、通知与学术动态',provider:'湖南财政经济学院官网',url:'/pages/official-news/index',category:'官方资讯',audience:'全体用户' },
  { task:'learn',icon:'历',title:'学校校历',desc:'按学年学期查看教学、考试与放假安排',provider:'湖南财政经济学院',url:'/pages/calendar/index',category:'校务信息',audience:'全体用户' },
  { task:'learn',icon:'课',title:'校友课堂',desc:'学习校友经验与行业方法',provider:'湖财人平台',url:'/pages/academy/index',category:'学习成长',audience:'全体用户' },
  { task:'learn',icon:'职',title:'校友招聘',desc:'寻找校友企业与合作单位岗位',provider:'湖财人平台',url:'/pages/jobs/index',category:'职业发展',audience:'学校实名用户' },
  { task:'enjoy',icon:'享',title:'权益中心',desc:'实名领取校友专属服务与福利',provider:'湖南财政经济学院',url:'/pages/benefits/index',category:'校友权益',audience:'学校实名用户' },
  { task:'enjoy',icon:'志',title:'校友志愿者',desc:'参与学校与校友公益志愿项目',provider:'校友工作办公室',url:'/pages/volunteer/index',category:'志愿公益',audience:'学校实名用户' },
  { task:'enjoy',icon:'爱',title:'回馈母校',desc:'查看公益项目并提交捐赠意向',provider:'湖南财政经济学院',url:'/pages/giving/index',category:'志愿公益',audience:'学校实名用户' }
]

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() {
    return {
      logoUrl: appConfig.officialLogoUrl, taskOptions, coreServices, remoteServices: [],
      activeTask: 'all', keyword: '', selectedService: null, loading: false, catalogError: '',
      verified: false, pendingCount: 0
    }
  },
  computed: {
    servicesEnabled() { return this.isModuleEnabled('services') },
    selectedServiceAvailable() { return !this.selectedService || ((this.selectedService._core || this.servicesEnabled) && this.isPageModuleEnabled(this.selectedService.url)) },
    allServices() {
      const items = this.coreServices.map((item, index) => this.normalizeService(item, index, true))
      ;(this.isModuleEnabled('services') ? this.remoteServices : []).forEach((service, index) => {
        const normalized = this.normalizeService(service, items.length + index, false)
        const found = items.findIndex((item) => item.url && item.url === normalized.url)
        if (found >= 0) items[found] = { ...items[found], ...normalized, task: items[found].task, icon: normalized.icon || items[found].icon }
        else items.push(normalized)
      })
      return this.filterModuleEntries(items)
    },
    visibleGroups() {
      const keyword = this.keyword.trim().toLowerCase()
      return this.taskOptions.slice(1).filter((task) => this.activeTask === 'all' || this.activeTask === task.key).map((task) => ({
        ...task,
        items: this.allServices.filter((item) => {
          const searchable = [item.title, item.desc, item.provider, item.category, item.audience].join(' ').toLowerCase()
          return item.task === task.key && (!keyword || searchable.includes(keyword))
        })
      })).filter((group) => group.items.length)
    }
  },
  watch: {
    servicesEnabled(enabled) { if(!enabled){this.selectedService=null;this.remoteServices=[];this.catalogError=''} },
    selectedServiceAvailable(available) { if(!available)this.selectedService=null }
  },
  onLoad(options = {}) {
    this.applyTaskOption(options)
  },
  onShow() {
    this.applyTaskOption(consumeTabPageQuery('/pages/services/index'))
    this.load()
  },
  methods: {
    applyTaskOption(options = {}) {
      if (this.taskOptions.some((item) => item.key === options.task)) this.activeTask = options.task
    },
    async load() {
      if (this.loading) return
      this.loading = true
      this.catalogError = ''
      this.verified = isVerified()
      const catalogTask = this.servicesEnabled ? getServiceCatalog() : Promise.resolve({items:[]})
      const summaryTask = this.verified ? getMyDashboardSummary() : Promise.resolve(null)
      const [catalog, summary] = await Promise.allSettled([catalogTask, summaryTask])
      if (!this.servicesEnabled) { this.remoteServices=[];this.catalogError='' }
      else if (catalog.status === 'fulfilled') this.remoteServices = catalog.value.items
      else this.catalogError = catalog.reason?.message || '服务目录暂时无法加载'
      if (summary.status === 'fulfilled' && summary.value) this.pendingCount = Number(summary.value.pending || 0)
      else if (!this.verified) this.pendingCount = 0
      this.loading = false
    },
    inferTask(service = {}) {
      const text = [service.category, service.title, service.provider].join(' ')
      if (/权益|福利|志愿|公益|捐赠|回馈/.test(text)) return 'enjoy'
      if (/课堂|学习|资讯|新闻|招聘|就业|职业|学术/.test(text)) return 'learn'
      if (/企业|合作|导师|社区|湖财圈|资源/.test(text)) return 'connect'
      if (/账号|身份|返校|报名|预约|反馈|办理|校园/.test(text)) return 'handle'
      return 'find'
    },
    normalizeService(service, index, core) {
      const task = service.task || this.inferTask(service)
      const url = service.url || service.route || service.externalUrl || ''
      return {
        ...service,
        key: service.id || `${task}-${index}-${service.title}`,
        task,
        icon: service.icon || taskOptions.find((item) => item.key === task)?.icon || '服',
        title: service.title || '湖财服务',
        desc: markdownToPlainText(service.summary || service.desc, { singleLine: true, maxLength: 70 }) || '查看服务说明与办理要求',
        provider: service.provider || '湖财人平台',
        category: service.category || '综合服务',
        audience: service.audience || '学生、教师、教职工及校友',
        url,
        tone: ['blue', 'gold', 'green', 'red'][index % 4],
        _core: core
      }
    },
    taskLabel(key) { return taskOptions.find((item) => item.key === key)?.label || '服务' },
    resetSearch() { this.keyword = ''; this.activeTask = 'all' },
    open(url) { openPage(url) },
    openSelectedService() {
      if(!this.selectedServiceAvailable){this.selectedService=null;return}
      const url = this.selectedService?.url
      if (!url) {
        uni.showToast({ title: '该服务暂未配置办理入口', icon: 'none' })
        return
      }
      this.selectedService = null
      openPage(url)
    }
  }
}
</script>

<style scoped>
.services-page{padding-top:14rpx}.service-hero{position:relative;min-height:310rpx;padding:36rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#092f70,#14539b);box-shadow:0 22rpx 48rpx rgba(11,58,130,.2)}.service-hero__brand{position:relative;z-index:2;display:flex;align-items:center;gap:18rpx}.service-hero__brand image{width:210rpx;height:50rpx}.service-hero__brand text{color:#e0c489;font-size:15rpx;font-weight:700;letter-spacing:2rpx}.service-hero__title,.service-hero__desc{position:relative;z-index:2;display:block}.service-hero__title{max-width:560rpx;margin-top:24rpx;font-size:38rpx;line-height:1.35;font-weight:700}.service-hero__desc{max-width:550rpx;margin-top:10rpx;color:rgba(255,255,255,.66);font-size:20rpx;line-height:1.6}.service-hero__seal{position:absolute;right:22rpx;bottom:-54rpx;color:rgba(255,255,255,.055);font-family:"STKaiti","KaiTi",serif;font-size:230rpx;font-weight:700}.workbench-entry{position:relative;z-index:3;margin:-18rpx 18rpx 0;padding:23rpx;display:flex;align-items:center}.workbench-entry__icon{position:relative;width:62rpx;height:62rpx;margin-right:17rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:20rpx;color:#fff;background:#033481;font-size:22rpx;font-weight:700}.workbench-entry__icon text{position:absolute;right:-10rpx;top:-10rpx;min-width:32rpx;height:32rpx;padding:0 6rpx;display:flex;align-items:center;justify-content:center;border:3rpx solid #fff;border-radius:99rpx;color:#fff;background:#a64f4a;font-size:13rpx}.workbench-entry__body{min-width:0;flex:1}.workbench-entry__body text{display:block}.workbench-entry__body text:first-child{color:#344258;font-size:23rpx;font-weight:700}.workbench-entry__body text:last-child{margin-top:5rpx;color:#8b95a4;font-size:18rpx}.workbench-entry>text{margin-left:12rpx;color:#033481;font-size:19rpx;font-weight:650}.search-box{height:84rpx;margin-top:22rpx;padding:0 20rpx;display:flex;align-items:center}.search-box>text:first-child{color:#033481;font-size:34rpx}.search-box input{min-width:0;flex:1;height:82rpx;margin-left:13rpx;color:#27354a;font-size:23rpx}.search-box>text:last-child{padding:12rpx;color:#a1a9b4;font-size:34rpx}.field-placeholder{color:#abb2bd}.task-scroll{width:100%;margin-top:20rpx}.task-row{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10rpx}.task-chip{min-width:0;height:76rpx;padding:0 12rpx;display:flex;align-items:center;border:1rpx solid #edf0f4;border-radius:22rpx;color:#526177;background:#fff}.task-chip>text{width:40rpx;height:40rpx;margin-right:9rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:14rpx;color:#033481;background:#e8eef8;font-size:19rpx;font-weight:700}.task-chip view{min-width:0}.task-chip view text{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.task-chip view text:first-child{font-size:21rpx;font-weight:700}.task-chip view text:last-child{margin-top:2rpx;color:#9aa2ae;font-size:14rpx}.task-chip--active{border-color:#033481;color:#fff;background:#033481}.task-chip--active>text{color:#033481;background:#fff}.task-chip--active view text:last-child{color:rgba(255,255,255,.66)}.catalog-warning{margin-top:20rpx;padding:19rpx;display:flex;align-items:center}.catalog-warning>text:first-child{width:46rpx;height:46rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:15rpx;color:#876225;background:#f5e9d1;font-weight:700}.catalog-warning view{min-width:0;flex:1}.catalog-warning view text{display:block}.catalog-warning view text:first-child{color:#4e5b6f;font-size:20rpx;font-weight:700}.catalog-warning view text:last-child{margin-top:4rpx;color:#8d96a3;font-size:17rpx}.catalog-warning>text:last-child{margin-left:12rpx;color:#033481;font-size:18rpx;font-weight:650}.service-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));overflow:hidden}.service-item{position:relative;min-height:190rpx;padding:25rpx 22rpx;display:flex;align-items:flex-start;border-right:1rpx solid #edf0f4;border-bottom:1rpx solid #edf0f4}.service-item:nth-child(2n){border-right:none}.service-item__icon{width:58rpx;height:58rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:18rpx;font-size:22rpx;font-weight:700}.service-item__icon--blue{color:#033481;background:#e7eef9}.service-item__icon--gold{color:#846129;background:#f7ebd7}.service-item__icon--green{color:#176551;background:#e5f2ed}.service-item__icon--red{color:#974a46;background:#f7e8e6}.service-item__body{min-width:0;flex:1}.service-item__title,.service-item__desc,.service-item__provider{display:block}.service-item__title{color:#2e3c51;font-size:24rpx;font-weight:700}.service-item__desc{margin-top:6rpx;color:#7d8999;font-size:18rpx;line-height:1.5}.service-item__provider{margin-top:7rpx;overflow:hidden;color:#a0a7b1;font-size:15rpx;text-overflow:ellipsis;white-space:nowrap}.service-item__arrow{position:absolute;right:13rpx;top:20rpx;color:#b2b9c3;font-size:30rpx}.reset-button{width:240rpx;margin:22rpx auto 0}.service-detail-meta{margin-bottom:24rpx;display:flex;flex-wrap:wrap;gap:9rpx}.service-detail-meta text{padding:7rpx 12rpx;border-radius:99rpx;color:#536177;background:#eef2f7;font-size:18rpx}.service-detail-note{margin-top:24rpx;padding:18rpx;display:flex;align-items:flex-start;border-radius:19rpx;color:#758195;background:#f1f4f8;font-size:18rpx;line-height:1.6}.service-detail-note text:first-child{margin-right:12rpx;color:#033481;font-weight:700}.service-note{margin:44rpx 12rpx 4rpx;display:flex;align-items:center;justify-content:center;color:#a0a6b0;font-size:18rpx}.service-note view{width:30rpx;height:1rpx;margin:0 10rpx;background:#d9dde4}
@media screen and (min-width:768px){.service-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.service-item:nth-child(2n){border-right:1rpx solid #edf0f4}.service-item:nth-child(3n){border-right:none}.service-item{min-height:150px}.task-row{grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.task-chip{height:82px;padding:0 14px}.service-hero__title{max-width:720px}}
@media screen and (min-width:1200px){.service-hero{min-height:380px;padding:48px 52px;border-radius:34px}.service-hero__brand image{width:260px;height:62px}.service-hero__brand text{font-size:15px}.service-hero__title{max-width:900px;margin-top:34px;font-size:50px}.service-hero__desc{max-width:900px;margin-top:14px;font-size:18px}.service-hero__seal{right:50px;bottom:-120px;font-size:330px}.workbench-entry{max-width:760px;margin:-28px 38px 0;padding:22px 26px}.search-box{height:70px;margin-top:28px;padding:0 26px}.search-box input{height:68px;font-size:17px}.task-row{gap:14px}.task-chip{height:90px;border-radius:20px}.task-chip>text{width:46px;height:46px}.task-chip view text:first-child{font-size:17px}.task-chip view text:last-child{font-size:13px}.service-item{min-height:160px;padding:28px}.service-item__title{font-size:20px}.service-item__desc{font-size:15px}.service-item__provider{font-size:13px}}
@media screen and (max-width:360px){.task-row{grid-template-columns:repeat(2,minmax(0,1fr))}.service-grid{grid-template-columns:1fr}.service-item,.service-item:nth-child(2n){border-right:none}.service-hero{padding-left:26rpx;padding-right:26rpx}.service-hero__brand text{display:none}.workbench-entry{margin-left:8rpx;margin-right:8rpx}}
.service-tools{position:relative;z-index:3;margin-top:-18rpx}.service-tools .workbench-entry{margin:0 18rpx}
.service-item__body{padding-right:24rpx}
@media screen and (min-width:768px) and (max-width:1199px){.service-tools .task-row{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media screen and (min-width:1200px){.service-hero{min-height:300px;padding:40px 48px}.service-hero__brand image{width:238px;height:54px}.service-hero__title{max-width:820px;margin-top:26px;font-size:44px;line-height:1.24}.service-hero__desc{margin-top:12px;font-size:17px}.service-hero__seal{right:42px;bottom:-96px;font-size:280px}.service-tools{margin-top:22px;padding:18px;display:grid;grid-template-columns:minmax(360px,.82fr) minmax(0,1.18fr);gap:14px;border:1px solid rgba(11,58,130,.06);border-radius:24px;background:#fff;box-shadow:0 14px 38px rgba(20,45,86,.07)}.service-tools .workbench-entry{max-width:none;min-height:64px;margin:0;padding:12px 18px;border-color:#e8edf5;border-radius:17px;background:#f6f8fc;box-shadow:none}.service-tools .workbench-entry__icon{width:44px;height:44px;margin-right:12px;border-radius:13px;font-size:16px}.service-tools .workbench-entry__body text:first-child{font-size:16px}.service-tools .workbench-entry__body text:last-child{margin-top:3px;font-size:13px}.service-tools .workbench-entry>text{font-size:14px}.service-tools .search-box{height:64px;margin:0;padding:0 20px;border-color:#e8edf5;border-radius:17px;background:#f6f8fc;box-shadow:none}.service-tools .search-box input{height:62px;font-size:16px}.service-tools .task-scroll{grid-column:1/-1;margin-top:0}.service-tools .task-row{gap:10px}.service-tools .task-chip{height:72px;padding:0 12px;border-color:#e8edf5;border-radius:16px;background:#f9fafc}.service-tools .task-chip>text{width:40px;height:40px;margin-right:10px;border-radius:12px}.service-tools .task-chip view text:first-child{font-size:16px}.service-tools .task-chip view text:last-child{font-size:12px}.service-tools .task-chip--active{border-color:#033481;background:#033481}}
</style>
