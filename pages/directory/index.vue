<template>
  <view class="page-shell directory-page">
    <view class="directory-hero">
      <view class="directory-hero__map"><text v-for="n in 5" :key="n"></text></view>
      <text class="directory-hero__eyebrow">HUFE ALUMNI DIRECTORY</text>
      <text class="directory-hero__title">湖财人，始终在彼此身边</text>
      <text class="directory-hero__desc">按城市、行业、学院与年级寻找校友。</text>
      <view class="directory-hero__privacy"><text>隐</text><text>仅展示校友授权公开字段</text></view>
    </view>

    <view v-if="!verified" class="empty-state surface"><text class="empty-state__title">登录后查看校友名录</text><text class="empty-state__desc">名录仅向已实名认证用户展示公开资料。</text><button class="primary-button" @tap="login">登录 / 实名认证</button></view>
    <view v-else-if="loading" class="empty-state surface">正在读取校友名录…</view>
    <view v-else-if="error" class="empty-state surface"><text>{{ error }}</text><button class="secondary-button" @tap="loadState">重新加载</button></view>
    <template v-else>
    <view class="search-box surface">
      <text class="search-box__icon"></text>
      <input v-model="keyword" class="search-box__input" placeholder="搜索姓名、学院、行业或城市" placeholder-class="search-placeholder" confirm-type="search" />
      <text v-if="keyword" class="search-box__clear" @tap="keyword = ''">×</text>
    </view>

    <scroll-view class="scope-scroll" scroll-x :show-scrollbar="false">
      <view class="scope-row">
        <template v-for="scope in scopes" :key="scope">
          <picker v-if="scope === '同行'" mode="selector" :range="industryOptions" @change="chooseIndustry">
            <view class="scope-chip" :class="{ 'scope-chip--active': activeScope === scope }">
              {{ scope }}<text v-if="activeScope === '同行'"> · {{ selectedIndustry }}</text>
            </view>
          </picker>
          <view v-else class="scope-chip" :class="{ 'scope-chip--active': activeScope === scope }" @tap="activeScope = scope">{{ scope }}</view>
        </template>
      </view>
    </scroll-view>

    <view class="result-head">
      <view><text class="result-head__title">{{ scopeTitle }}</text><text class="result-head__desc">找到 {{ filteredAlumni.length }} 位校友</text></view>
      <text class="result-head__favorite">后台审核公开</text>
    </view>

    <view v-if="filteredAlumni.length" class="alumni-list">
      <view v-for="(person, index) in filteredAlumni" :key="person.id" class="alumni-card surface" @tap="showProfile(person)">
        <view class="alumni-avatar" :class="`alumni-avatar--${index % 4}`">{{ person.initials }}</view>
        <view class="alumni-card__body">
          <view class="alumni-card__name-row"><text class="alumni-name">{{ person.name }}</text><text class="alumni-year">{{ person.year }}级</text></view>
          <text class="alumni-college">{{ person.college }}</text>
          <view class="alumni-tags"><text>{{ person.industry }}</text><text>◉ {{ person.city }}</text></view>
        </view>
        <text class="alumni-card__arrow">›</text>
      </view>
    </view>
    <view v-else class="empty-state surface">
      <view class="empty-state__icon">友</view>
      <text class="empty-state__title">暂未找到匹配校友</text>
      <text class="empty-state__desc">尝试更换关键词或筛选范围。</text>
      <button class="secondary-button empty-state__button" @tap="resetFilter">重置筛选</button>
    </view>

    </template>
    <view class="privacy-card">
      <view class="privacy-card__icon">隐</view>
      <view><text class="privacy-card__title">隐私与联系说明</text><text class="privacy-card__desc">名录接口不会返回手机号、邮箱、学号或平台账号 ID；下架、隐藏资料会立即停止展示。</text></view>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import { loadAllPages } from '../../utils/authPagination'
import { getDirectory } from '../../services/business'
import { getUser, isVerified, getAccessToken } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  data() {
    return {
      alumni: [],
      user: {},
      keyword: '',
      scopes: ['全部', '同城', '同行', '同院', '同级'],
      activeScope: '全部',
      selectedIndustry: '',
      loading: false, error: '', verified: false, loadVersion: 0
    }
  },
  computed: {
    industryOptions() {
      return [...new Set(this.alumni.map((person) => person.industry))]
    },
    scopeTitle() {
      return this.activeScope === '同行' ? `同行 · ${this.selectedIndustry}` : this.activeScope
    },
    filteredAlumni() {
      const keyword = this.keyword.trim().toLowerCase()
      return this.alumni.filter((person) => {
        let matchesScope = true
        if (this.activeScope === '同城') matchesScope = person.city === this.user.city
        if (this.activeScope === '同行') matchesScope = person.industry === this.selectedIndustry
        if (this.activeScope === '同院') matchesScope = person.college === this.user.college
        if (this.activeScope === '同级') matchesScope = person.year === this.user.graduationYear
        const searchable = `${person.name}${person.year}${person.college}${person.industry}${person.city}`.toLowerCase()
        return matchesScope && (!keyword || searchable.includes(keyword))
      })
    }
  },
  onLoad(options = {}) {
    this.keyword = String(options.city || options.keyword || '').slice(0, 40)
    uni.$on('hufe-auth-changed', this.loadState)
  },
  onHide() { this.loadVersion++; this.alumni = []; this.loading = false },
  onUnload() { this.loadVersion++; this.alumni = []; uni.$off('hufe-auth-changed', this.loadState) },
  onShow() {
    this.loadState()
  },
  onShareAppMessage() {
    return { title: '湖财校友名录', path: '/pages/directory/index' }
  },
  methods: {
    login() { openPage('/pages/verify/index') },
    async loadState() {
      this.user = getUser()
      this.verified = isVerified()
      const version = ++this.loadVersion
      const token = getAccessToken()
      this.alumni = []; this.error = ''; this.loading = false
      if (!this.verified) return
      this.loading = true
      try {
        const result = await loadAllPages(getDirectory, {}, () => version === this.loadVersion && token === getAccessToken())
        this.alumni = result.items.map((person) => ({ ...person, year: String(person.graduationYear || ''), initials: person.initials || String(person.name || '湖财').slice(-2) }))
        if (!this.selectedIndustry) this.selectedIndustry = this.industryOptions[0] || ''
      } catch (error) { if (version !== this.loadVersion) return; this.alumni = []; this.error = error.message || '名录加载失败'; if ([401, 403].includes(error.statusCode)) this.verified = false }
      finally { if (version === this.loadVersion) this.loading = false }
    },
    chooseIndustry(event) {
      this.selectedIndustry = this.industryOptions[Number(event.detail.value)] || this.industryOptions[0]
      this.activeScope = '同行'
    },
    resetFilter() {
      this.keyword = ''
      this.activeScope = '全部'
    },
    showProfile(person) {
      uni.showModal({
        title: `${person.name} · ${person.year}级`,
        content: `${person.college || '学院未公开'}\n${person.industry || '行业未公开'} · ${person.city || '城市未公开'}\n${person.title || ''}${person.organization ? ` · ${person.organization}` : ''}\n\n${person.bio || '暂无公开简介'}\n\n联系方式依法隐藏。`,
        showCancel: false,
        confirmText: '我知道了',
        confirmColor: '#033481'
      })
    }
  }
}
</script>

<style scoped>
.directory-page { padding-top: 12rpx; }
.directory-hero { position: relative; min-height: 310rpx; padding: 38rpx 34rpx; overflow: hidden; border-radius: 38rpx; color: #FFFFFF; background: linear-gradient(140deg, #102F55, #033481 64%, #1B5799); box-shadow: 0 24rpx 54rpx rgba(9, 47, 105, .2); }
.directory-hero__map { position: absolute; right: 24rpx; top: 34rpx; width: 230rpx; height: 160rpx; opacity: .18; }
.directory-hero__map text { position: absolute; width: 18rpx; height: 18rpx; border: 4rpx solid #E4C990; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); }
.directory-hero__map text:nth-child(1) { left: 20rpx; top: 70rpx; }.directory-hero__map text:nth-child(2) { left: 84rpx; top: 20rpx; }.directory-hero__map text:nth-child(3) { left: 118rpx; top: 104rpx; }.directory-hero__map text:nth-child(4) { right: 18rpx; top: 48rpx; }.directory-hero__map text:nth-child(5) { right: 52rpx; bottom: 4rpx; }
.directory-hero__eyebrow, .directory-hero__title, .directory-hero__desc, .alumni-name, .alumni-college, .result-head__title, .result-head__desc, .empty-state__title, .empty-state__desc, .privacy-card__title, .privacy-card__desc { display: block; }
.directory-hero__eyebrow { color: #DFC287; font-size: 17rpx; font-weight: 700; letter-spacing: 4rpx; }
.directory-hero__title { position: relative; z-index: 1; width: 500rpx; margin-top: 16rpx; font-size: 40rpx; line-height: 1.3; font-weight: 700; }
.directory-hero__desc { position: relative; z-index: 1; margin-top: 11rpx; color: rgba(255, 255, 255, .61); font-size: 21rpx; }
.directory-hero__privacy { position: absolute; left: 34rpx; bottom: 28rpx; display: flex; align-items: center; color: rgba(255, 255, 255, .55); font-size: 18rpx; }
.directory-hero__privacy text:first-child { width: 38rpx; height: 38rpx; margin-right: 11rpx; display: flex; align-items: center; justify-content: center; border-radius: 12rpx; color: #8B682F; background: #E1C58D; font-size: 16rpx; font-weight: 700; }
.search-box { position: relative; z-index: 2; height: 88rpx; margin: -12rpx 18rpx 0; padding: 0 22rpx; display: flex; align-items: center; }
.search-box__icon { position: relative; width: 30rpx; height: 30rpx; margin-right: 16rpx; border: 3rpx solid #8E98A8; border-radius: 50%; }
.search-box__icon::after { content: ''; position: absolute; width: 14rpx; height: 3rpx; right: -10rpx; bottom: -5rpx; border-radius: 2rpx; background: #8E98A8; transform: rotate(45deg); }
.search-box__input { flex: 1; height: 72rpx; color: #263247; font-size: 24rpx; }
.search-box__clear { width: 44rpx; height: 44rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: #788397; background: #EEF1F5; font-size: 30rpx; }
.scope-scroll { width: calc(100% + 56rpx); margin: 27rpx -28rpx 0; white-space: nowrap; }
.scope-row { padding: 0 28rpx 9rpx; display: inline-flex; }
.scope-chip { height: 62rpx; margin-right: 13rpx; padding: 0 23rpx; display: flex; align-items: center; border: 1rpx solid rgba(11, 58, 130, .06); border-radius: 21rpx; color: #69758A; background: #FFFFFF; font-size: 22rpx; }
.scope-chip--active { color: #FFFFFF; background: #033481; box-shadow: 0 10rpx 22rpx rgba(11, 58, 130, .2); }
.scope-chip text { margin-left: 2rpx; color: #E6CD9C; font-size: 17rpx; }
.result-head { margin: 24rpx 4rpx 20rpx; display: flex; align-items: flex-end; justify-content: space-between; }
.result-head__title { font-size: 31rpx; font-weight: 700; }
.result-head__desc { margin-top: 5rpx; color: #929BA9; font-size: 20rpx; }
.result-head__favorite { color: #9A783F; font-size: 20rpx; font-weight: 600; }
.alumni-list { display: flex; flex-direction: column; }
.alumni-card { min-height: 154rpx; margin-bottom: 17rpx; padding: 24rpx; display: flex; align-items: center; }
.alumni-avatar { width: 86rpx; height: 86rpx; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 28rpx; color: #FFFFFF; font-size: 24rpx; font-weight: 700; }
.alumni-avatar--0 { background: linear-gradient(145deg, #033481, #4F7CB7); }.alumni-avatar--1 { background: linear-gradient(145deg, #8C672E, #D0AE6E); }.alumni-avatar--2 { background: linear-gradient(145deg, #155948, #55917F); }.alumni-avatar--3 { background: linear-gradient(145deg, #814340, #BB6B62); }
.alumni-card__body { flex: 1; min-width: 0; margin-left: 20rpx; }
.alumni-card__name-row { display: flex; align-items: center; }
.alumni-name { font-size: 28rpx; font-weight: 650; }
.alumni-year { margin-left: 12rpx; padding: 5rpx 11rpx; border-radius: 99rpx; color: #765724; background: #F4E6CA; font-size: 16rpx; }
.alumni-college { margin-top: 6rpx; overflow: hidden; color: #7D8798; font-size: 20rpx; text-overflow: ellipsis; white-space: nowrap; }
.alumni-tags { margin-top: 9rpx; display: flex; color: #59667A; font-size: 18rpx; }
.alumni-tags text { margin-right: 16rpx; }
.alumni-card__arrow{margin-left:14rpx;color:#aab2be;font-size:40rpx}
.follow-button { width: 116rpx; height: 62rpx; margin: 0; padding: 0; border-radius: 19rpx; color: #033481; background: #E8EEF8; font-size: 20rpx; line-height: 62rpx; font-weight: 600; }
.follow-button--active { color: #176551; background: #E4F1EC; }
.empty-state__title { color: #344056; font-size: 27rpx; font-weight: 650; }
.empty-state__desc { margin-top: 9rpx; font-size: 21rpx; }
.empty-state__button { width: 220rpx; height: 70rpx; margin: 24rpx auto 0; line-height: 70rpx; font-size: 22rpx; }
.privacy-card { margin-top: 16rpx; padding: 24rpx; display: flex; align-items: flex-start; border-radius: 24rpx; background: #E9EDF4; }
.privacy-card__icon { width: 54rpx; height: 54rpx; margin-right: 16rpx; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 18rpx; color: #86652F; background: #F0DFC0; font-size: 19rpx; font-weight: 700; }
.privacy-card__title { color: #536077; font-size: 22rpx; font-weight: 700; }
.privacy-card__desc { margin-top: 6rpx; color: #7D8798; font-size: 19rpx; line-height: 1.6; }
</style>
