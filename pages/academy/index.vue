<template>
  <view class="page-shell academy-page">
    <view class="academy-hero">
      <text class="academy-hero__eyebrow">HUFE ALUMNI ACADEMY</text>
      <text class="academy-hero__title">校友课堂</text>
      <text class="academy-hero__desc">把实践经验带回湖财，让行业方法、职业选择与成长故事持续传递。</text>
      <view class="academy-hero__seal"><text>课</text><text>HUFE</text></view>
    </view>

    <view class="search-box surface"><text>⌕</text><input v-model="keyword" placeholder="搜索课程、讲师、分类或标签" placeholder-class="field-placeholder" /><text v-if="keyword" @tap="keyword = ''">×</text></view>
    <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false"><view class="filter-row"><view v-for="item in categories" :key="item" class="filter-chip" :class="{ 'filter-chip--active': category === item }" @tap="category = item">{{ item }}</view></view></scroll-view>

    <view class="result-head"><text>{{ filteredCourses.length }} 节校友课堂</text><text>审核发布内容</text></view>
    <view v-if="loading && !courses.length" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载校友课堂</text></view>
    <view v-else-if="error && !courses.length" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ error }}</text><button class="secondary-button retry-button" @tap="load">重新加载</button></view>
    <view v-else-if="filteredCourses.length" class="course-list">
      <view v-for="(course,index) in filteredCourses" :key="course.id" class="course-card surface" @tap="selected = course">
        <image v-if="course.coverUrl" class="course-cover" :src="course.coverUrl" mode="aspectFill" />
        <view v-else class="course-cover course-cover--placeholder" :class="`course-cover--${index % 3}`"><text>{{ course.category.slice(0, 2) }}</text><text>HUFE ACADEMY</text></view>
        <view class="course-card__body">
          <view class="course-card__meta"><text>{{ course.category }}</text><text>{{ durationText(course.duration) }}</text></view>
          <text class="course-title">{{ course.title }}</text>
          <text class="course-summary">{{ course.summaryText }}</text>
          <view class="lecturer-row"><view>{{ course.lecturer.slice(-2) }}</view><view><text>{{ course.lecturer }}</text><text>{{ course.lecturerTitle || '湖财校友讲师' }}</text></view><text>查看 ›</text></view>
        </view>
      </view>
    </view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">课</view><text>暂无匹配课程</text><text class="empty-hint">尝试更换关键词或课程分类</text></view>

    <BusinessDetailSheet
      :open="Boolean(selected)"
      :title="selected ? selected.title : ''"
      :subtitle="selected ? `${selected.lecturer} · ${selected.lecturerTitle || '湖财校友讲师'}` : ''"
      eyebrow="ALUMNI ACADEMY"
      :show-actions="true"
      @close="selected = null"
    >
      <template v-if="selected">
        <image v-if="selected.coverUrl" class="detail-cover" :src="selected.coverUrl" mode="aspectFill" />
        <view class="detail-facts"><text>{{ selected.category }}</text><text>{{ durationText(selected.duration) }}</text></view>
        <view v-if="selected.tags.length" class="detail-tags"><text v-for="tag in selected.tags" :key="tag">{{ tag }}</text></view>
        <BusinessRichText :content="selected.summary" empty-text="暂无课程摘要" />
        <view class="detail-section"><text>课程内容</text><BusinessRichText :content="selected.content" empty-text="暂无课程内容介绍" /></view>
      </template>
      <template #actions>
        <button class="secondary-button" @tap="selected = null">关闭</button>
        <button class="primary-button" :disabled="!selected || !selected.contentUrl" @tap="openVideo">打开课程内容</button>
      </template>
    </BusinessDetailSheet>

    <view class="academy-note"><text>学</text><view><text>知识共享说明</text><text>课程内容由学校后台审核发布，仅供学习交流；版权、引用与外部链接以发布说明为准。</text></view></view>
    <SupportFooter />
  </view>
</template>

<script>
import { loadAllPages } from '../../utils/authPagination'
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { getAlumniAcademy } from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { resolveMediaUrl } from '../../services/media'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() {
    return { courses: [], keyword: '', category: '全部', selected: null, loading: false, error: '' }
  },
  computed: {
    categories() { return ['全部', ...new Set(this.courses.map((item) => item.category).filter(Boolean))] },
    filteredCourses() {
      const keyword = this.keyword.trim().toLowerCase()
      return this.courses.filter((item) => {
        const matchesCategory = this.category === '全部' || item.category === this.category
        const searchable = [item.title, item.category, item.lecturer, item.lecturerTitle, item.summaryText, ...item.tags].join(' ').toLowerCase()
        return matchesCategory && (!keyword || searchable.includes(keyword))
      })
    }
  },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => uni.stopPullDownRefresh()) },
  onShareAppMessage() { return { title: '湖财校友课堂', path: '/pages/academy/index' } },
  methods: {
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const result = await loadAllPages(getAlumniAcademy)
        this.courses = result.items
          .map((item) => ({
            ...item,
            title: String(item.title || '校友课堂'),
            category: String(item.category || '成长分享'),
            lecturer: String(item.lecturer || '湖财校友'),
            coverUrl: resolveMediaUrl(item.coverUrl),
            contentUrl: String(item.videoUrl || item.sourceUrl || ''),
            tags: Array.isArray(item.tags) ? item.tags : [],
            summaryText: markdownToPlainText(item.summary, { singleLine: true, maxLength: 100 }) || '暂无课程摘要'
          }))
          .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
      } catch (error) {
        this.courses = []
        this.error = error.message || '校友课堂加载失败'
      } finally { this.loading = false }
    },
    durationText(value) {
      if (!value) return '时长待定'
      const number = Number(value)
      if (Number.isFinite(number) && number > 0) return `${number} 分钟`
      return String(value)
    },
    openVideo() {
      const url = this.selected?.contentUrl || ''
      if (!url) return
      this.selected = null
      openPage(url)
    }
  }
}
</script>

<style scoped>
.academy-page{padding-top:14rpx}.academy-hero{position:relative;min-height:285rpx;padding:37rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#102e4d,#093b76 67%,#1d5a98);box-shadow:0 22rpx 49rpx rgba(11,58,115,.19)}.academy-hero__eyebrow,.academy-hero__title,.academy-hero__desc{position:relative;z-index:2;display:block}.academy-hero__eyebrow{color:#e1c58d;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.academy-hero__title{margin-top:15rpx;font-size:40rpx;font-weight:700}.academy-hero__desc{width:510rpx;margin-top:11rpx;color:rgba(255,255,255,.64);font-size:20rpx;line-height:1.65}.academy-hero__seal{position:absolute;right:28rpx;bottom:25rpx;width:112rpx;height:112rpx;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1rpx solid rgba(226,198,142,.47);border-radius:50%;color:#e2c68e}.academy-hero__seal text:first-child{font-size:35rpx;font-weight:700}.academy-hero__seal text:last-child{font-size:13rpx;letter-spacing:2rpx}.search-box{height:84rpx;margin-top:22rpx;padding:0 20rpx;display:flex;align-items:center}.search-box>text:first-child{color:#033481;font-size:34rpx}.search-box input{min-width:0;flex:1;height:82rpx;margin-left:13rpx;color:#27354a;font-size:23rpx}.search-box>text:last-child{padding:12rpx;color:#a1a9b4;font-size:34rpx}.field-placeholder{color:#abb2bd}.filter-scroll{width:calc(100% + 56rpx);margin:20rpx -28rpx 0;white-space:nowrap}.filter-row{padding:0 28rpx;display:inline-flex}.filter-chip{height:58rpx;margin-right:12rpx;padding:0 22rpx;display:flex;align-items:center;border-radius:19rpx;color:#657187;background:#fff;font-size:21rpx}.filter-chip--active{color:#fff;background:#033481}.result-head{margin:27rpx 4rpx 16rpx;display:flex;justify-content:space-between;color:#37455a;font-size:24rpx;font-weight:650}.result-head text:last-child{color:#9a733b;font-size:18rpx}.course-list{display:flex;flex-direction:column}.course-card{margin-bottom:20rpx;overflow:hidden}.course-cover{width:100%;height:260rpx;background:#e8edf4}.course-cover--placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff}.course-cover--placeholder text:first-child{font-size:48rpx;font-weight:700}.course-cover--placeholder text:last-child{margin-top:8rpx;color:rgba(255,255,255,.62);font-size:15rpx;letter-spacing:3rpx}.course-cover--0{background:linear-gradient(145deg,#0a3979,#4c78ac)}.course-cover--1{background:linear-gradient(145deg,#75552b,#b89457)}.course-cover--2{background:linear-gradient(145deg,#175d4d,#54917e)}.course-card__body{padding:25rpx}.course-card__meta{display:flex;justify-content:space-between;color:#8a94a3;font-size:18rpx}.course-card__meta text:first-child{color:#906b32;font-weight:650}.course-title,.course-summary{display:block}.course-title{margin-top:11rpx;color:#29374d;font-size:30rpx;font-weight:700}.course-summary{margin-top:10rpx;color:#6e7b8f;font-size:20rpx;line-height:1.65}.lecturer-row{margin-top:20rpx;padding-top:18rpx;display:flex;align-items:center;border-top:1rpx solid #edf0f4}.lecturer-row>view:first-child{width:54rpx;height:54rpx;margin-right:13rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:18rpx;color:#fff;background:#033481;font-size:18rpx;font-weight:700}.lecturer-row>view:nth-child(2){min-width:0;flex:1}.lecturer-row>view:nth-child(2) text{display:block}.lecturer-row>view:nth-child(2) text:first-child{color:#405068;font-size:21rpx;font-weight:650}.lecturer-row>view:nth-child(2) text:last-child{margin-top:3rpx;color:#949dab;font-size:17rpx}.lecturer-row>text{color:#033481;font-size:18rpx;font-weight:650}.retry-button{width:230rpx;margin:22rpx auto 0}.empty-hint{display:block;margin-top:9rpx;font-size:19rpx}.detail-cover{width:100%;height:270rpx;margin-bottom:20rpx;border-radius:22rpx;background:#edf1f5}.detail-facts,.detail-tags{display:flex;flex-wrap:wrap;gap:8rpx}.detail-facts text,.detail-tags text{padding:7rpx 12rpx;border-radius:99rpx;color:#586a81;background:#eef2f7;font-size:18rpx}.detail-tags{margin:13rpx 0 21rpx}.detail-section{margin-top:25rpx;padding-top:22rpx;border-top:1rpx solid #e9edf3}.detail-section>text{display:block;margin-bottom:12rpx;color:#2e3c52;font-size:24rpx;font-weight:700}.academy-note{margin-top:7rpx;padding:23rpx;display:flex;align-items:flex-start;border-radius:24rpx;color:#768195;background:#e9eef5}.academy-note>text{width:50rpx;height:50rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#80602c;background:#f1dfbd;font-size:19rpx;font-weight:700}.academy-note view text{display:block}.academy-note view text:first-child{color:#4b5a70;font-size:21rpx;font-weight:700}.academy-note view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}
</style>
