<template>
  <view class="page-shell about-page">
    <view class="about-hero">
      <view class="about-hero__emblem"><image :src="logoUrl" mode="aspectFit" /></view>
      <text class="about-hero__eyebrow">HUFE OFFICIAL SERVICES</text>
      <text class="about-hero__title">让每一次连接都有回响</text>
      <text class="about-hero__desc">为湖财学生、教师、教职工与校友提供统一实名与校园服务。</text>
      <text class="about-hero__version">官方授权</text>
      <text class="about-hero__watermark">HUFE</text>
    </view>

    <view class="statement-card surface">
      <text class="statement-card__quote">“</text>
      <text class="statement-card__title">正德厚生 · 经世济用</text>
      <text class="statement-card__desc">系统已按学校授权使用官方品牌，官网资讯由服务端同步，新用户注册时通过学校官网校验实名身份。</text>
    </view>

    <view class="section-head"><view><text class="section-title">我们在做什么</text><text class="section-kicker">SERVICE LOOP</text></view></view>
    <view class="service-list surface">
      <view v-for="(item, index) in services" :key="item.title" class="service-row" :class="{ 'service-row--border': index !== services.length - 1 }">
        <view class="service-row__index">0{{ index + 1 }}</view>
        <view class="service-row__body"><text class="service-row__title">{{ item.title }}</text><text class="service-row__desc">{{ item.desc }}</text></view>
        <text class="service-row__en">{{ item.en }}</text>
      </view>
    </view>

    <view class="section-head"><view><text class="section-title">产品原则</text><text class="section-kicker">OUR PRINCIPLES</text></view></view>
    <view class="principle-grid">
      <view v-for="item in principles" :key="item.title" class="principle-card surface"><view class="principle-card__icon">{{ item.icon }}</view><text class="principle-card__title">{{ item.title }}</text><text class="principle-card__desc">{{ item.desc }}</text></view>
    </view>

    <view class="section-head"><view><text class="section-title">数据与隐私</text><text class="section-kicker">PRIVACY FIRST</text></view></view>
    <view class="privacy-section surface">
      <view class="privacy-summary" @tap="privacyExpanded = !privacyExpanded">
        <view class="privacy-summary__icon">安</view>
        <view class="privacy-summary__body"><text class="privacy-summary__title">平台注册与数据安全</text><text class="privacy-summary__desc">学校密码只在学校页面输入，实名资料只读</text></view>
        <text class="privacy-summary__arrow" :class="{ 'privacy-summary__arrow--open': privacyExpanded }">›</text>
      </view>
      <view v-if="privacyExpanded" class="privacy-detail">
        <text>· 日常登录使用湖财人平台账号，不跳转学校官网。</text>
        <text>· 只有新用户注册实名校验会打开学校官网，本应用不读取或保存学校密码。</text>
        <text>· 姓名、人员类型、部门及脱敏学工号、身份证号由学校系统返回，客户端不可编辑。</text>
        <text>· 业务申请、活动报名与动态发布保存在服务端，本机只保留未提交草稿。</text>
      </view>
    </view>

    <view class="action-grid">
      <button class="about-action" @tap="openVerify"><text class="about-action__icon">账</text><text>平台账号与实名资料</text></button>
      <button class="about-action" @tap="openVisit"><text class="about-action__icon">校</text><text>查看返校记录</text></button>
      <button class="about-action about-action--wide" @tap="inspectLocalData"><text class="about-action__icon">数</text><text>检查本机草稿</text></button>
      <button class="about-action about-action--wide" @tap="copyStatement"><text class="about-action__icon">复</text><text>复制服务说明</text></button>
    </view>

    <view class="legal-note">
      <text>湖南财政经济学院授权服务</text>
      <text>注册实名与账号唯一性校验由服务端执行</text>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import { appConfig } from '../../config/index'
import { isSchoolVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

const serviceStatement = '湖财人服务：面向学生、教师、教职工与校友；日常使用平台账号登录，新用户注册时由学校官网校验实名身份。'

export default {
  data() {
    return {
      privacyExpanded: false,
      logoUrl: appConfig.officialLogoUrl,
      services: [
        { title: '校友身份', desc: '认证资料与电子校友卡', en: 'IDENTITY' },
        { title: '回到母校', desc: '返校预约与校友活动', en: 'CAMPUS' },
        { title: '连接同行', desc: '校友圈、组织与职业资源', en: 'CONNECT' },
        { title: '共建湖财', desc: '志愿服务、建议与公益项目', en: 'TOGETHER' }
      ],
      principles: [
        { icon: '真', title: '真诚连接', desc: '服务真实校友需求' },
        { icon: '简', title: '简洁好用', desc: '降低获取服务的门槛' },
        { icon: '安', title: '安全克制', desc: '最小化采集与展示' },
        { icon: '长', title: '长期同行', desc: '让每次连接持续生长' }
      ]
    }
  },
  methods: {
    openVerify() {
      openPage('/pages/verify/index')
    },
    openVisit() {
      openPage('/pages/campus-visit/index')
    },
    inspectLocalData() {
      const lines = [
        `学校实名：${isSchoolVerified() ? '已校验' : '未校验'}`,
        `湖财圈草稿：${uni.getStorageSync('hufe_community_post_draft') ? '本机有草稿' : '无'}`,
        '活动、申请、反馈等正式记录均保存在服务端，可在对应业务页查看。'
      ]
      uni.showModal({ title: '本地数据概览', content: lines.join('\n'), showCancel: false, confirmText: '我知道了', confirmColor: '#033481' })
    },
    copyStatement() {
      uni.setClipboardData({
        data: serviceStatement,
        success: () => uni.showToast({ title: '说明已复制', icon: 'none' })
      })
    }
  }
}
</script>

<style scoped>
.about-page{padding-top:16rpx}.about-hero{position:relative;min-height:360rpx;padding:38rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(145deg,#033481 0%,#033481 56%,#18569e 100%);box-shadow:0 24rpx 54rpx rgba(9,47,105,.22)}.about-hero__emblem{width:270rpx;height:58rpx;padding:0;display:flex;align-items:center;justify-content:center;border-radius:15rpx;background:transparent}.about-hero__emblem image{width:100%;height:100%}.about-hero__eyebrow,.about-hero__title,.about-hero__desc,.about-hero__version{display:block}.about-hero__eyebrow{margin-top:28rpx;color:#dfc187;font-size:17rpx;font-weight:700;letter-spacing:3rpx}.about-hero__title{margin-top:10rpx;font-size:40rpx;font-weight:700}.about-hero__desc{width:82%;margin-top:13rpx;color:rgba(255,255,255,.62);font-size:21rpx;line-height:1.55}.about-hero__version{position:absolute;right:26rpx;top:26rpx;padding:8rpx 12rpx;border:1rpx solid rgba(255,255,255,.2);border-radius:99rpx;color:rgba(255,255,255,.7);font-size:15rpx;letter-spacing:2rpx}.about-hero__watermark{position:absolute;right:24rpx;bottom:2rpx;color:rgba(255,255,255,.08);font-family:Georgia,serif;font-size:82rpx;font-weight:700;letter-spacing:6rpx}.statement-card{position:relative;z-index:3;margin:-22rpx 18rpx 0;padding:30rpx;overflow:hidden}.statement-card__quote{position:absolute;right:24rpx;top:-14rpx;color:#f1e4ce;font-family:Georgia,serif;font-size:110rpx}.statement-card__title,.statement-card__desc{position:relative;z-index:2;display:block}.statement-card__title{color:#87652d;font-family:serif;font-size:27rpx;font-weight:700;letter-spacing:2rpx}.statement-card__desc{margin-top:12rpx;color:#7f8998;font-size:21rpx;line-height:1.7}
.service-list{padding:0 24rpx}.service-row{min-height:110rpx;display:flex;align-items:center}.service-row--border{border-bottom:1rpx solid #edf0f4}.service-row__index{width:52rpx;color:#c19c62;font-family:Georgia,serif;font-size:22rpx;font-weight:700}.service-row__body{flex:1}.service-row__title,.service-row__desc{display:block}.service-row__title{font-size:25rpx;font-weight:650}.service-row__desc{margin-top:5rpx;color:#949ca9;font-size:19rpx}.service-row__en{color:#c2c7d0;font-size:14rpx;font-weight:700;letter-spacing:2rpx}.principle-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16rpx}.principle-card{min-height:190rpx;padding:24rpx}.principle-card__icon{width:52rpx;height:52rpx;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#82602a;background:#f5e8d2;font-size:21rpx;font-weight:700}.principle-card__title,.principle-card__desc{display:block}.principle-card__title{margin-top:15rpx;font-size:24rpx;font-weight:650}.principle-card__desc{margin-top:7rpx;color:#919aa8;font-size:19rpx;line-height:1.45}
.privacy-section{padding:0 24rpx}.privacy-summary{min-height:106rpx;display:flex;align-items:center}.privacy-summary__icon{width:58rpx;height:58rpx;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#176551;background:#e4f1ec;font-size:22rpx;font-weight:700}.privacy-summary__body{flex:1;margin-left:17rpx}.privacy-summary__title,.privacy-summary__desc{display:block}.privacy-summary__title{font-size:24rpx;font-weight:650}.privacy-summary__desc{margin-top:5rpx;color:#929aa8;font-size:18rpx}.privacy-summary__arrow{color:#adb4be;font-size:38rpx;transition:transform .2s}.privacy-summary__arrow--open{transform:rotate(90deg)}.privacy-detail{padding:21rpx 0 24rpx;border-top:1rpx solid #edf0f4}.privacy-detail text{display:block;margin-top:8rpx;color:#7d8797;font-size:20rpx;line-height:1.65}.privacy-detail text:first-child{margin-top:0}
.action-grid{margin-top:24rpx;display:grid;grid-template-columns:repeat(2,1fr);gap:14rpx}.about-action{height:88rpx;margin:0;padding:0 18rpx;display:flex;align-items:center;justify-content:flex-start;border:1rpx solid #e5e9ef;border-radius:22rpx;color:#455269;background:#fff;font-size:21rpx;line-height:88rpx;text-align:left}.about-action--wide{grid-column:span 2}.about-action__icon{width:44rpx;height:44rpx;margin-right:11rpx;display:flex;align-items:center;justify-content:center;border-radius:14rpx;color:#033481;background:#e9eff9;font-size:18rpx;font-weight:700}.legal-note{margin:38rpx 0 6rpx;text-align:center}.legal-note text{display:block;color:#a0a7b2;font-size:17rpx}.legal-note text+text{margin-top:7rpx}
</style>
