<template>
  <view class="page-shell ecosystem-page">
    <view class="ecosystem-hero">
      <view class="ecosystem-hero__orbit ecosystem-hero__orbit--one"></view>
      <view class="ecosystem-hero__orbit ecosystem-hero__orbit--two"></view>
      <text class="ecosystem-hero__eyebrow">HUFE ALUMNI ECOSYSTEM</text>
      <text class="ecosystem-hero__title">一张可信网络，连接湖财人的每一种可能</text>
      <text class="ecosystem-hero__desc">从找到彼此，到共同成长、协作与回馈，校友生态服务集中抵达。</text>
      <view class="ecosystem-hero__stats">
        <view v-for="item in metrics" :key="item.label"><text>{{ item.value }}</text><text>{{ item.label }}</text></view>
      </view>
      <text class="ecosystem-hero__mark">ECO</text>
    </view>

    <view class="ecosystem-principle surface">
      <view class="ecosystem-principle__icon">信</view>
      <view><text>学校实名 · 后台审核 · 合规连接</text><text>公开内容只展示必要业务信息，联系、申请与合作通过平台流程留痕。</text></view>
    </view>

    <view v-if="metricsError" class="metrics-warning surface"><text>!</text><view><text>部分生态数据暂未同步</text><text>入口仍可使用，统计恢复后会自动更新，不会用 0 代替未知数据。</text></view><text @tap="loadMetrics">重试</text></view>

    <template v-for="group in visibleNavigationGroups" :key="group.key">
      <view class="section-head"><view><text class="section-title">{{ group.title }}</text><text class="section-kicker">{{ group.subtitle }}</text></view></view>
      <view class="ecosystem-grid">
        <view v-for="item in group.items" :key="item.title" class="ecosystem-card surface" @tap="open(item.url)">
          <view class="ecosystem-card__top"><view class="ecosystem-card__icon" :class="`ecosystem-card__icon--${item.tone}`">{{ item.icon }}</view><text>{{ item.english }}</text></view>
          <text class="ecosystem-card__title">{{ item.title }}</text>
          <text class="ecosystem-card__desc">{{ item.desc }}</text>
          <view class="ecosystem-card__foot"><text>{{ cardMetric(item) }}</text><text>进入 ›</text></view>
        </view>
      </view>
    </template>

    <view class="section-head"><view><text class="section-title">生态公约</text><text class="section-kicker">TRUST · PRIVACY · VALUE</text></view></view>
    <view class="promise-card">
      <view v-for="(item,index) in promises" :key="item.title">
        <text>{{ String(index + 1).padStart(2, '0') }}</text>
        <view><text>{{ item.title }}</text><text>{{ item.desc }}</text></view>
      </view>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import {
  getAlumniAcademy,
  getAlumniEnterprises,
  getCollaborationOpportunities,
  getDirectoryCityStats
} from '../../services/business'
import { openPage } from '../../utils/nav'

export default {
  data() {
    return {
      counts: { enterprises: null, collaborations: null, academy: null, cities: null },
      metricsError: '',
      navigationGroups: [
        {
          key: 'people', title: '找人与归属', subtitle: 'FIND PEOPLE & COMMUNITY',
          items: [
            { icon:'组',title:'校友组织',english:'CHAPTERS',desc:'连接同级、同班、同专业与同兴趣校友。',tone:'blue',metric:'年级 · 班级 · 专业 · 兴趣',url:'/pages/chapters/index' },
            { icon:'录',title:'校友名录',english:'DIRECTORY',desc:'按学院、年级和地区寻找校友。',tone:'gold',metric:'学校实名可用',url:'/pages/directory/index' },
            { icon:'会',title:'校友活动',english:'EVENTS',desc:'发现近期活动并管理本人报名。',tone:'green',metric:'线上 · 线下活动',url:'/pages/events/index' },
            { icon:'城',title:'同城地图',english:'ALUMNI MAP',desc:'查看城市分布，找到身边的湖财连接。',tone:'red',metricKey:'cities',unit:'座城市',url:'/pages/alumni-map/index' }
          ]
        },
        {
          key: 'cooperate', title: '资源与协作', subtitle: 'RESOURCE & COLLABORATION',
          items: [
            { icon:'企',title:'校友企业馆',english:'ENTERPRISES',desc:'发现校友企业、能力与合作方向。',tone:'blue',metricKey:'enterprises',unit:'家企业',url:'/pages/enterprises/index' },
            { icon:'合',title:'合作广场',english:'COLLABORATION',desc:'查看或实名发布资源、项目与人才需求。',tone:'gold',metricKey:'collaborations',unit:'个机会',url:'/pages/collaboration/index' },
            { icon:'师',title:'校友导师',english:'MENTORS',desc:'连接行业导师，获得成长建议。',tone:'green',metric:'实名申请 · 状态可查',url:'/pages/mentors/index' }
          ]
        },
        {
          key: 'growth', title: '学习与成长', subtitle: 'LEARNING & GROWTH',
          items: [
            { icon:'课',title:'校友课堂',english:'ACADEMY',desc:'分享校友经验、职业与行业方法。',tone:'blue',metricKey:'academy',unit:'节内容',url:'/pages/academy/index' },
            { icon:'职',title:'校友招聘',english:'CAREERS',desc:'发现校友企业与合作单位岗位。',tone:'gold',metric:'岗位申请 · 进度可查',url:'/pages/jobs/index' },
            { icon:'志',title:'校友志愿者',english:'VOLUNTEER',desc:'参与学校、社区和校友公益项目。',tone:'green',metric:'志愿项目 · 服务记录',url:'/pages/volunteer/index' }
          ]
        },
        {
          key: 'share', title: '共享与回馈', subtitle: 'BENEFITS & GIVING',
          items: [
            { icon:'享',title:'校友权益',english:'BENEFITS',desc:'实名领取学校和校友企业专属权益。',tone:'blue',metric:'实名领取 · 全程留痕',url:'/pages/benefits/index' },
            { icon:'爱',title:'公益回馈',english:'GIVING',desc:'了解公益项目并提交回馈意向。',tone:'red',metric:'公开透明 · 意向可查',url:'/pages/giving/index' }
          ]
        }
      ],
      promises: [
        { title:'可信发布', desc:'组织、企业、岗位、课堂与权益均由学校后台审核后公开。' },
        { title:'隐私最小化', desc:'页面不公开学号、身份证等敏感信息，个体联系通过平台流程完成。' },
        { title:'进度可追踪', desc:'报名、申请、领取和合作发布统一进入消息与办理进度中心。' }
      ]
    }
  },
  computed: {
    visibleNavigationGroups(){return this.navigationGroups.map(group=>({...group,items:this.filterModuleEntries(group.items)})).filter(group=>group.items.length)},
    metrics() {
      return [
        { value: this.metricValue('enterprises'), label: '校友企业', module:'enterprises' },
        { value: this.metricValue('collaborations'), label: '合作机会', module:'collaboration' },
        { value: this.metricValue('cities'), label: '连接城市', module:'maps' }
      ].filter(item => this.isModuleEnabled(item.module))
    }
  },
  onShow() { this.loadMetrics() },
  onPullDownRefresh() { this.loadMetrics().finally(() => uni.stopPullDownRefresh()) },
  onShareAppMessage() { return { title: '湖财校友生态圈', path: '/pages/ecosystem/index' } },
  methods: {
    open(url) { openPage(url) },
    metricValue(key) {
      const value = this.counts[key]
      return value === null || value === undefined ? '—' : String(value)
    },
    cardMetric(item) {
      if (!item.metricKey) return item.metric
      const value = this.counts[item.metricKey]
      return value === null || value === undefined ? '数据待获取' : `${value} ${item.unit}`
    },
    async loadMetrics() {
      this.metricsError = ''
      const requests = [
        ['enterprises', 'enterprises', () => getAlumniEnterprises({ page: 1, pageSize: 1 })],
        ['collaborations', 'collaboration', () => getCollaborationOpportunities({ page: 1, pageSize: 1 })],
        ['academy', 'academy', () => getAlumniAcademy({ page: 1, pageSize: 1 })],
        ['cities', 'maps', () => getDirectoryCityStats()]
      ].filter(([, module]) => this.isModuleEnabled(module))
      const results = await Promise.allSettled(requests.map(([, , request]) => request()))
      const next = { ...this.counts }
      const states = results.map((result, index) => {
        const [key, module] = requests[index]
        if (!this.isModuleEnabled(module)) return true
        if (result.status !== 'fulfilled') { next[key] = null; return false }
        next[key] = Number((key === 'cities' ? result.value?.totalCities : undefined) ?? result.value?.total ?? result.value?.items?.length ?? 0)
        return true
      })
      this.counts = next
      if (states.some((success) => !success)) this.metricsError = '部分生态统计暂时无法获取'
    }
  }
}
</script>

<style scoped>
.ecosystem-page{padding-top:14rpx}.ecosystem-hero{position:relative;min-height:440rpx;padding:38rpx 34rpx;overflow:hidden;border-radius:40rpx;color:#fff;background:linear-gradient(140deg,#062c67,#033481 55%,#1c5d9f);box-shadow:0 24rpx 54rpx rgba(9,47,105,.22)}.ecosystem-hero__orbit{position:absolute;border:1rpx solid rgba(226,198,142,.16);border-radius:50%}.ecosystem-hero__orbit--one{width:340rpx;height:340rpx;right:-135rpx;top:-130rpx}.ecosystem-hero__orbit--two{width:210rpx;height:210rpx;right:-25rpx;top:-25rpx}.ecosystem-hero__eyebrow,.ecosystem-hero__title,.ecosystem-hero__desc{position:relative;z-index:2;display:block}.ecosystem-hero__eyebrow{color:#e2c68e;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.ecosystem-hero__title{max-width:600rpx;margin-top:18rpx;font-size:42rpx;line-height:1.35;font-weight:700}.ecosystem-hero__desc{max-width:560rpx;margin-top:13rpx;color:rgba(255,255,255,.66);font-size:21rpx;line-height:1.65}.ecosystem-hero__stats{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:30rpx;padding-top:22rpx;display:flex;border-top:1rpx solid rgba(255,255,255,.15)}.ecosystem-hero__stats view{min-width:0;flex:1;border-right:1rpx solid rgba(255,255,255,.13);text-align:center}.ecosystem-hero__stats view:last-child{border-right:none}.ecosystem-hero__stats text{display:block}.ecosystem-hero__stats text:first-child{color:#ead3a4;font-family:Georgia,serif;font-size:34rpx;font-weight:700}.ecosystem-hero__stats text:last-child{margin-top:4rpx;color:rgba(255,255,255,.55);font-size:18rpx}.ecosystem-hero__mark{position:absolute;right:24rpx;bottom:100rpx;color:rgba(255,255,255,.07);font-family:Georgia,serif;font-size:76rpx;font-weight:700;letter-spacing:4rpx}.ecosystem-principle{position:relative;z-index:3;margin:-16rpx 18rpx 0;padding:23rpx;display:flex;align-items:center}.ecosystem-principle__icon{width:56rpx;height:56rpx;margin-right:16rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#7d5d29;background:#f3e5ca;font-size:20rpx;font-weight:700}.ecosystem-principle view text{display:block}.ecosystem-principle view text:first-child{color:#344257;font-size:22rpx;font-weight:700}.ecosystem-principle view text:last-child{margin-top:5rpx;color:#8993a2;font-size:18rpx;line-height:1.5}.metrics-warning{margin-top:20rpx;padding:19rpx;display:flex;align-items:center}.metrics-warning>text:first-child{width:46rpx;height:46rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:15rpx;color:#876225;background:#f5e9d1;font-weight:700}.metrics-warning view{min-width:0;flex:1}.metrics-warning view text{display:block}.metrics-warning view text:first-child{color:#4e5b6f;font-size:20rpx;font-weight:700}.metrics-warning view text:last-child{margin-top:4rpx;color:#8d96a3;font-size:17rpx}.metrics-warning>text:last-child{margin-left:12rpx;color:#033481;font-size:18rpx;font-weight:650}.ecosystem-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17rpx}.ecosystem-card{min-width:0;padding:25rpx}.ecosystem-card__top{display:flex;align-items:center;justify-content:space-between;gap:10rpx}.ecosystem-card__top>text{overflow:hidden;color:#a0a8b4;font-size:14rpx;letter-spacing:1rpx;text-overflow:ellipsis;white-space:nowrap}.ecosystem-card__icon{width:60rpx;height:60rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:20rpx;font-size:22rpx;font-weight:700}.ecosystem-card__icon--blue{color:#033481;background:#e8eef8}.ecosystem-card__icon--gold{color:#82602a;background:#f5e8d1}.ecosystem-card__icon--green{color:#176551;background:#e4f1ec}.ecosystem-card__icon--red{color:#97443f;background:#f7e5e3}.ecosystem-card__title,.ecosystem-card__desc{display:block}.ecosystem-card__title{margin-top:18rpx;color:#2d3b51;font-size:27rpx;font-weight:700}.ecosystem-card__desc{min-height:83rpx;margin-top:8rpx;color:#8892a1;font-size:19rpx;line-height:1.55}.ecosystem-card__foot{margin-top:17rpx;padding-top:15rpx;display:flex;justify-content:space-between;gap:8rpx;border-top:1rpx solid #edf0f4;color:#8c96a4;font-size:17rpx}.ecosystem-card__foot text:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ecosystem-card__foot text:last-child{flex-shrink:0;color:#033481;font-weight:650}.promise-card{padding:6rpx 25rpx;border-radius:28rpx;color:#fff;background:linear-gradient(140deg,#17324e,#244d70)}.promise-card>view{padding:23rpx 0;display:flex;align-items:flex-start;border-bottom:1rpx solid rgba(255,255,255,.1)}.promise-card>view:last-child{border-bottom:none}.promise-card>view>text{width:54rpx;color:#dfc48c;font-family:Georgia,serif;font-size:25rpx}.promise-card view view{flex:1}.promise-card view view text{display:block}.promise-card view view text:first-child{font-size:22rpx;font-weight:700}.promise-card view view text:last-child{margin-top:6rpx;color:rgba(255,255,255,.56);font-size:18rpx;line-height:1.55}
@media screen and (min-width:800px){.ecosystem-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.ecosystem-card__desc{min-height:76px}.ecosystem-hero__title,.ecosystem-hero__desc{max-width:760px}}
@media screen and (max-width:360px){.ecosystem-grid{grid-template-columns:1fr}.ecosystem-card__desc{min-height:0}.ecosystem-hero{padding-left:26rpx;padding-right:26rpx}.ecosystem-principle{margin-left:8rpx;margin-right:8rpx}}
</style>
