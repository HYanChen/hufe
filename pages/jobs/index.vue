<template>
  <view class="page-shell jobs-page">
    <view class="jobs-hero">
      <view><text class="jobs-hero__eyebrow">ALUMNI CAREERS</text><text class="jobs-hero__title">可信连接，彼此成就</text><text class="jobs-hero__desc">校友岗位与人才连接 · 后台审核发布</text></view>
      <view class="jobs-hero__mark"><text>职</text><text>HUFE</text></view>
    </view>

    <view class="search-box surface"><text class="search-box__icon">⌕</text><input v-model="keyword" class="search-box__input" placeholder="搜索岗位、公司或技能" placeholder-class="search-placeholder" /><text v-if="keyword" class="search-box__clear" @tap="keyword = ''">×</text></view>
    <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false"><view class="filter-row"><view v-for="item in cities" :key="item" class="filter-chip" :class="{ 'filter-chip--active': city === item }" @tap="city = item">{{ item }}</view></view></scroll-view>

    <view class="result-head"><text>{{ filteredJobs.length }} 个在招岗位</text><text>岗位信息不构成招聘承诺</text></view>
    <view v-if="filteredJobs.length" class="job-list">
      <view v-for="job in filteredJobs" :key="job.id" class="job-card surface">
        <view class="job-card__top"><view><text class="job-card__type">{{ job.employmentType || '招聘岗位' }}</text><text class="job-card__title">{{ job.title }}</text></view><text class="job-deadline">{{ job.deadline ? `截止 ${job.deadline}` : '长期有效' }}</text></view>
        <view class="job-card__company"><view class="company-mark">{{ (job.company || '企').slice(0, 1) }}</view><view><text>{{ job.company || '招聘企业待确认' }}</text><text>湖财人招聘服务</text></view></view>
        <view class="job-card__facts"><text>{{ job.city }}</text><text>{{ job.salary || '薪资面议' }}</text><text>{{ job.experience || '经验不限' }}</text></view>
        <view class="job-card__tags"><text v-for="tag in job.tags" :key="tag">{{ tag }}</text></view>
        <view class="job-card__actions"><button class="ghost-button" @tap="showDetail(job)">查看详情</button><button class="primary-button" :class="{ 'job-card__applied': appliedIds.includes(job.id) }" @tap="apply(job)">{{ appliedIds.includes(job.id) ? '已提交申请' : '提交求职申请' }}</button></view>
      </view>
    </view>
    <view v-else class="empty-state surface"><view class="empty-state__icon">职</view><text>没有匹配的在招岗位</text><text class="empty-hint">换个城市或关键词试试</text></view>

    <view class="jobs-note"><text>服务说明</text><text>页面仅展示后台审核发布且未下架的岗位；申请记录由服务端保存，请勿在申请内容中提交不必要的敏感信息。</text></view>
    <BusinessDetailSheet
      :open="Boolean(selectedJob)"
      :title="selectedJob ? selectedJob.title : ''"
      :subtitle="selectedJobSubtitle"
      eyebrow="RECRUITMENT DETAILS"
      :show-actions="true"
      @close="selectedJob = null"
    >
      <template v-if="selectedJob">
        <view class="job-detail-facts">
          <text>{{ selectedJob.city || '城市待定' }}</text>
          <text>{{ selectedJob.salary || '薪资面议' }}</text>
          <text>{{ selectedJob.employmentType || '用工类型待定' }}</text>
        </view>
        <view class="business-detail-section">
          <text class="business-detail-title">岗位职责</text>
          <BusinessRichText :content="selectedJob.description" empty-text="暂无岗位职责" />
        </view>
        <view class="business-detail-section">
          <text class="business-detail-title">任职要求</text>
          <BusinessRichText :content="selectedJob.requirements" empty-text="暂无任职要求" />
        </view>
        <view class="business-detail-section">
          <text class="business-detail-title">投递说明</text>
          <text class="business-detail-plain">{{ plainText(selectedJob.applicationMethod, '通过本页提交申请') }}</text>
        </view>
      </template>
      <template #actions>
        <button class="secondary-button" @tap="selectedJob = null">关闭</button>
        <button class="primary-button" :class="{ 'job-card__applied': selectedJobApplied }" @tap="applyFromDetail">{{ selectedJobApplied ? '已提交申请' : '提交求职申请' }}</button>
      </template>
    </BusinessDetailSheet>
    <SupportFooter />
  </view>
</template>

<script>
import { loadAllPages } from '../../utils/authPagination'
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { applyForJob, getJobs, getMyJobApplications } from '../../services/business'
import { markdownToPlainText } from '../../services/businessMarkdown'
import { isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() {
    return { jobs: [], cities: ['全部'], city: '全部', keyword: '', appliedIds: [], selectedJob: null, loading: false }
  },
  computed: {
    filteredJobs() {
      const keyword = this.keyword.trim().toLowerCase()
      return this.jobs.filter((job) => {
        const matchesCity = this.city === '全部' || job.city === this.city
        const haystack = [job.title, job.company, job.city, ...job.tags].join(' ').toLowerCase()
        return matchesCity && (!keyword || haystack.includes(keyword))
      })
    },
    selectedJobSubtitle() {
      if (!this.selectedJob) return ''
      return `${this.selectedJob.company || '招聘单位待定'} · ${this.selectedJob.deadline ? `截止 ${this.selectedJob.deadline}` : '长期有效'}`
    },
    selectedJobApplied() {
      return Boolean(this.selectedJob && this.appliedIds.includes(this.selectedJob.id))
    }
  },
  onShow() { this.loadState() },
  methods: {
    async loadState() {
      if (this.loading) return
      this.loading = true
      try {
        const [publicResult, mine] = await Promise.all([loadAllPages(getJobs), isVerified() ? loadAllPages(getMyJobApplications) : Promise.resolve({items:[]})])
        this.jobs = publicResult.items.map((job) => ({ ...job, tags: Array.isArray(job.tags) ? job.tags : [] }))
        this.cities = ['全部', ...new Set(this.jobs.map((job) => job.city).filter(Boolean))]
        this.appliedIds = mine.items.filter((item) => !['cancelled','rejected'].includes(item.status)).map((item) => item.jobId)
      } catch (error) { this.jobs=[]; uni.showToast({title:error.message||'岗位加载失败',icon:'none'}) }
      finally { this.loading=false }
    },
    showDetail(job) {
      this.selectedJob = job
    },
    plainText(value, fallback = '') {
      return markdownToPlainText(value) || fallback
    },
    applyFromDetail() {
      if (!this.selectedJob) return
      const job = this.selectedJob
      this.selectedJob = null
      this.apply(job)
    },
    apply(job) {
      if (!isVerified()) { openPage('/pages/verify/index'); return }
      if (this.appliedIds.includes(job.id)) {
        uni.showToast({ title: '已提交过申请', icon: 'none' })
        return
      }
      uni.showModal({
        title: '确认提交申请',
        content: `确认向“${job.company} · ${job.title}”提交求职申请？后台将记录申请人与处理状态。`,
        confirmText: '确认提交',
        success: async (res) => {
          if (!res.confirm) return
          try { await applyForJob(job.id); await this.loadState(); uni.showToast({ title: '申请已提交' }) }
          catch(error){uni.showModal({title:'申请失败',content:error.message||'请稍后重试',showCancel:false})}
        }
      })
    }
  }
}
</script>

<style scoped>
.jobs-page{padding-top:14rpx}.jobs-hero{position:relative;height:240rpx;padding:36rpx 32rpx;overflow:hidden;border-radius:34rpx;color:#FFF;background:linear-gradient(135deg,#0A326F,#173C62);box-shadow:0 20rpx 44rpx rgba(11,58,130,.18)}.jobs-hero__eyebrow,.jobs-hero__title,.jobs-hero__desc{position:relative;z-index:1;display:block}.jobs-hero__eyebrow{color:#E0C48B;font-size:18rpx;font-weight:700;letter-spacing:4rpx}.jobs-hero__title{margin-top:15rpx;font-size:40rpx;font-weight:700}.jobs-hero__desc{width:450rpx;margin-top:12rpx;color:rgba(255,255,255,.62);font-size:20rpx;line-height:1.55}.jobs-hero__mark{position:absolute;right:28rpx;bottom:26rpx;width:118rpx;height:118rpx;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1rpx solid rgba(226,198,142,.5);border-radius:50%;color:#E2C68E}.jobs-hero__mark text:first-child{font-size:36rpx;font-weight:700}.jobs-hero__mark text:last-child{margin-top:3rpx;font-size:14rpx;letter-spacing:2rpx}.search-box{height:88rpx;margin-top:24rpx;padding:0 22rpx;display:flex;align-items:center}.search-box__icon{color:#033481;font-size:38rpx}.search-box__input{flex:1;height:88rpx;margin-left:14rpx;color:#263248;font-size:24rpx}.search-placeholder{color:#ABB2BD}.search-box__clear{padding:14rpx;color:#A5ADB9;font-size:36rpx}.filter-scroll{width:calc(100% + 56rpx);margin:22rpx -28rpx 0;white-space:nowrap}.filter-row{padding:0 28rpx;display:inline-flex}.filter-chip{height:58rpx;margin-right:13rpx;padding:0 24rpx;display:flex;align-items:center;border-radius:18rpx;color:#657187;background:#FFF;font-size:22rpx}.filter-chip--active{color:#FFF;background:#033481}.result-head{margin:30rpx 4rpx 16rpx;display:flex;justify-content:space-between;color:#384459;font-size:24rpx;font-weight:600}.result-head text:last-child{color:#9BA3AF;font-size:18rpx;font-weight:400}.job-list{display:flex;flex-direction:column}.job-card{margin-bottom:20rpx;padding:27rpx}.job-card__top{display:flex;align-items:flex-start;justify-content:space-between}.job-card__type,.job-card__title,.job-card__company text{display:block}.job-card__type{color:#9A7337;font-size:19rpx;font-weight:650}.job-card__title{margin-top:8rpx;font-size:32rpx;font-weight:700}.favorite-button{width:58rpx;height:58rpx;display:flex;align-items:center;justify-content:center;border-radius:19rpx;color:#8893A4;background:#F0F3F7;font-size:34rpx}.favorite-button--active{color:#A57B3B;background:#F8ECD8}.job-card__company{margin-top:24rpx;display:flex;align-items:center}.company-mark{width:58rpx;height:58rpx;margin-right:15rpx;display:flex;align-items:center;justify-content:center;border-radius:18rpx;color:#FFF;background:linear-gradient(145deg,#1B559C,#033481);font-size:24rpx;font-weight:700}.job-card__company text:first-child{font-size:24rpx;font-weight:600}.job-card__company text:last-child{margin-top:4rpx;color:#979FAC;font-size:18rpx}.job-card__facts{margin-top:20rpx;display:flex;color:#536177;font-size:21rpx}.job-card__facts text{padding:0 18rpx;border-right:1rpx solid #E5E9EF}.job-card__facts text:first-child{padding-left:0}.job-card__facts text:last-child{border-right:none}.job-card__tags{margin-top:18rpx;display:flex;flex-wrap:wrap}.job-card__tags text{margin:0 10rpx 8rpx 0;padding:8rpx 14rpx;border-radius:12rpx;color:#5E6C82;background:#F0F3F7;font-size:18rpx}.job-card__actions{margin-top:20rpx;padding-top:21rpx;display:flex;border-top:1rpx solid #EDF0F4}.job-card__actions button{height:70rpx;line-height:70rpx;border-radius:18rpx;font-size:22rpx}.job-card__actions .ghost-button{width:34%;margin:0 12rpx 0 0}.job-card__actions .primary-button{flex:1;margin:0}.job-card__applied{color:#176551;background:#E5F1ED;box-shadow:none}.empty-hint{display:block;margin-top:10rpx;font-size:20rpx}.jobs-note{margin-top:10rpx;padding:24rpx;border-radius:24rpx;color:#657288;background:#EAF0F8;font-size:20rpx;line-height:1.65}.jobs-note text{display:block}.jobs-note text:first-child{margin-bottom:5rpx;color:#033481;font-weight:700}
.job-deadline{max-width:200rpx;margin-left:12rpx;color:#8c96a5;font-size:18rpx;text-align:right;line-height:1.5}
.job-detail-facts{padding:18rpx 20rpx;display:flex;flex-wrap:wrap;gap:10rpx;border-radius:20rpx;background:#F1F4F8}.job-detail-facts text{max-width:100%;padding:7rpx 12rpx;border-radius:99rpx;color:#526078;background:#FFF;font-size:19rpx;overflow-wrap:anywhere;word-break:break-word}.business-detail-section{margin-top:28rpx;padding-top:24rpx;border-top:1rpx solid #E9EDF3}.business-detail-title,.business-detail-plain{display:block}.business-detail-title{margin-bottom:14rpx;color:#2D3A50;font-size:25rpx;font-weight:700}.business-detail-plain{color:#4B576A;font-size:23rpx;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
</style>
