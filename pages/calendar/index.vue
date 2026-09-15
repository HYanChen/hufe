<template>
  <view class="page-shell calendar-page">
    <view class="calendar-hero">
      <view class="calendar-hero__ring calendar-hero__ring--large"></view>
      <view class="calendar-hero__ring calendar-hero__ring--small"></view>
      <text class="calendar-hero__eyebrow">HUFE ACADEMIC CALENDAR</text>
      <text class="calendar-hero__title">学校校历</text>
      <text class="calendar-hero__desc">按学年与学期查看教学、考试、注册及放假等学校日程。</text>
      <view class="calendar-hero__stats">
        <view><text>{{ selectedYear || '全部' }}</text><text>筛选学年</text></view>
        <view><text>{{ termLabel(selectedTerm) }}</text><text>筛选学期</text></view>
        <view><text>{{ filteredEntries.length }}</text><text>校历事项</text></view>
      </view>
      <text class="calendar-hero__mark">历</text>
    </view>

    <view class="source-strip surface">
      <text class="source-strip__icon">校</text>
      <view>
        <text>学校授权发布校历</text>
        <text>仅展示后台已发布事项，不推测或补齐缺失日期；如有调整，以学校最新正式通知和来源链接为准。</text>
      </view>
    </view>

    <view class="calendar-filters surface">
      <view class="filter-block">
        <view class="filter-block__head"><text>学年</text><text>{{ yearOptions.length - 1 }} 个可选学年</text></view>
        <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false">
          <view class="filter-row">
            <view
              v-for="item in yearOptions"
              :key="item.value || 'all-year'"
              class="filter-chip"
              :class="{ 'filter-chip--active': selectedYear === item.value }"
              @tap="selectedYear = item.value"
            >{{ item.label }}</view>
          </view>
        </scroll-view>
      </view>
      <view class="filter-block">
        <view class="filter-block__head"><text>学期</text><text>按教学周期筛选</text></view>
        <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false">
          <view class="filter-row">
            <view
              v-for="item in termOptions"
              :key="item.value || 'all-term'"
              class="filter-chip"
              :class="{ 'filter-chip--active': selectedTerm === item.value }"
              @tap="selectedTerm = item.value"
            >{{ item.label }}</view>
          </view>
        </scroll-view>
      </view>
      <view class="filter-result">
        <text>{{ selectedYear || '全部学年' }} · {{ termLabel(selectedTerm) }}</text>
        <text>{{ filteredEntries.length }} 项日程</text>
      </view>
    </view>

    <view v-if="loading && !entries.length" class="empty-state surface calendar-state">
      <view class="empty-state__icon">…</view>
      <text class="calendar-state__title">正在加载学校校历</text>
      <text class="calendar-state__desc">从学校公开业务资源读取日程。</text>
    </view>
    <view v-else-if="error && !entries.length" class="empty-state surface calendar-state">
      <view class="empty-state__icon">!</view>
      <text class="calendar-state__title">学校校历暂时无法加载</text>
      <text class="calendar-state__desc">{{ error }}</text>
      <button class="secondary-button calendar-state__button" @tap="load">重新加载</button>
    </view>
    <view v-else-if="monthGroups.length" class="calendar-months">
      <view v-for="group in monthGroups" :key="group.key" class="month-group">
        <view class="month-heading">
          <view class="month-heading__badge"><text>{{ group.monthNumber }}</text><text>{{ group.monthUnit }}</text></view>
          <view><text>{{ group.title }}</text><text>{{ group.items.length }} 项校历安排</text></view>
          <view class="month-heading__line"></view>
        </view>

        <view class="calendar-list">
          <view
            v-for="item in group.items"
            :key="item.id"
            class="calendar-card surface"
            :class="{ 'calendar-card--important': item.priority === 'important' }"
          >
            <view class="calendar-card__date">
              <text>{{ item.startMonth }}</text>
              <text>{{ item.startDay }}</text>
              <text>{{ item.endBadge }}</text>
            </view>
            <view class="calendar-card__body">
              <view class="calendar-card__top">
                <view class="calendar-card__tags">
                  <text :class="`category--${item.category}`">{{ categoryLabel(item.category) }}</text>
                  <text v-if="item.priority === 'important'" class="priority-tag">重要</text>
                </view>
                <text class="date-status" :class="`date-status--${item.dateStatus.tone}`">{{ item.dateStatus.label }}</text>
              </view>
              <text class="calendar-card__title">{{ item.title }}</text>
              <text class="calendar-card__range">{{ dateRangeText(item) }}</text>
              <text v-if="item.summary" class="calendar-card__summary">{{ item.summary }}</text>
              <view class="calendar-card__facts">
                <text v-if="item.weekNumber">{{ weekText(item.weekNumber) }}</text>
                <text v-if="item.audienceLabel">{{ item.audienceLabel }}</text>
                <text v-if="item.campus">{{ item.campus }}</text>
              </view>
              <view class="calendar-card__foot">
                <text>{{ termAcademicLabel(item) }}</text>
                <text v-if="item.sourceUrl" class="calendar-card__source" @tap.stop="openSource(item)">查看来源 ›</text>
                <text v-else>来源链接未配置</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>
    <view v-else class="empty-state surface calendar-state">
      <view class="empty-state__icon">历</view>
      <text class="calendar-state__title">{{ entries.length ? '当前筛选条件下暂无日程' : '暂无已发布学校校历' }}</text>
      <text class="calendar-state__desc">{{ entries.length ? '可切换学年或学期查看其他日程。' : '后台发布校历后会在此按月展示，页面不会填充演示日期。' }}</text>
      <button v-if="entries.length" class="secondary-button calendar-state__button" @tap="resetFilters">查看全部日程</button>
    </view>

    <view v-if="entries.length" class="calendar-note">
      <text>i</text>
      <view><text>日期说明</text><text>跨月事项归入开始日期所在月份；“进行中 / 即将开始 / 已结束”由设备当前日期与公开起止日期计算。</text></view>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import { getAcademicCalendar } from '../../services/business'
import { openPage } from '../../utils/nav'

const termOptions = [
  { value: '', label: '全部学期' },
  { value: 'first', label: '第一学期' },
  { value: 'second', label: '第二学期' },
  { value: 'summer', label: '暑期' }
]

const termLabels = {
  first: '第一学期',
  second: '第二学期',
  summer: '暑期'
}

const categoryLabels = {
  term: '学期节点',
  registration: '注册报到',
  teaching: '教学安排',
  exam: '考试安排',
  holiday: '放假安排',
  activity: '校园活动',
  other: '其他事项'
}

const audienceLabels = {
  all: '全体用户',
  student: '学生',
  students: '学生',
  faculty: '教师',
  teacher: '教师',
  staff: '教职工',
  faculty_staff: '教师与教职工',
  campus: '在校师生员工',
  member: '学校实名用户',
  alumni: '校友',
  undergraduate: '本科生',
  graduate: '研究生'
}

function parseCalendarDate(value) {
  const text = String(value || '').trim().slice(0, 10)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return { date, year, month, day, key: `${match[1]}-${match[2]}-${match[3]}` }
}

function normalizedSourceUrl(value) {
  const text = String(value || '').trim()
  if (/^https?:\/\//i.test(text)) return text
  if (/^\/\//.test(text)) return `https:${text}`
  return ''
}

export default {
  data() {
    return {
      termOptions,
      entries: [],
      selectedYear: '',
      selectedTerm: '',
      loading: false,
      error: ''
    }
  },
  computed: {
    yearOptions() {
      const years = [...new Set(this.entries.map((item) => item.academicYear).filter(Boolean))]
        .sort((left, right) => right.localeCompare(left, 'zh-CN', { numeric: true }))
      return [{ value: '', label: '全部学年' }, ...years.map((year) => ({ value: year, label: year }))]
    },
    filteredEntries() {
      return this.entries.filter((item) =>
        (!this.selectedYear || item.academicYear === this.selectedYear)
        && (!this.selectedTerm || item.term === this.selectedTerm)
      )
    },
    monthGroups() {
      const groups = new Map()
      this.filteredEntries.forEach((item) => {
        const dated = Boolean(item._start)
        const key = dated ? `${item._start.year}-${String(item._start.month).padStart(2, '0')}` : 'undated'
        if (!groups.has(key)) {
          groups.set(key, dated ? {
            key,
            title: `${item._start.year}年${item._start.month}月`,
            monthNumber: String(item._start.month).padStart(2, '0'),
            monthUnit: '月',
            items: []
          } : {
            key,
            title: '日期待确认',
            monthNumber: '--',
            monthUnit: '日期',
            items: []
          })
        }
        groups.get(key).items.push(item)
      })
      return [...groups.values()]
    }
  },
  onLoad(options = {}) {
    this.selectedYear = String(options.academicYear || '')
    this.selectedTerm = termOptions.some((item) => item.value === options.term) ? options.term : ''
    this.load()
  },
  onPullDownRefresh() {
    this.load().finally(() => uni.stopPullDownRefresh())
  },
  onShareAppMessage() {
    return { title: '湖南财政经济学院学校校历', path: '/pages/calendar/index' }
  },
  methods: {
    termLabel(value) {
      return termLabels[value] || (value ? String(value) : '全部学期')
    },
    categoryLabel(value) {
      return categoryLabels[value] || categoryLabels.other
    },
    normalizeEntry(item = {}, index) {
      const start = parseCalendarDate(item.startDate)
      const end = parseCalendarDate(item.endDate)
      const category = Object.prototype.hasOwnProperty.call(categoryLabels, item.category) ? item.category : 'other'
      const term = Object.prototype.hasOwnProperty.call(termLabels, item.term) ? item.term : String(item.term || '')
      const order = Number(item.sortOrder)
      return {
        id: String(item.id || `calendar-${index}`),
        title: String(item.title || '校历事项（标题待完善）'),
        academicYear: String(item.academicYear || ''),
        term,
        category,
        startDate: start?.key || '',
        endDate: end?.key || '',
        weekNumber: item.weekNumber === null || item.weekNumber === undefined ? '' : String(item.weekNumber),
        audience: String(item.audience || ''),
        audienceLabel: this.audienceLabel(item.audience),
        campus: String(item.campus || ''),
        summary: String(item.summary || ''),
        sourceUrl: normalizedSourceUrl(item.sourceUrl),
        priority: item.priority === 'important' ? 'important' : 'normal',
        sortOrder: Number.isFinite(order) ? order : 0,
        status: String(item.status || '').toLowerCase(),
        _start: start,
        _end: end,
        startMonth: start ? `${String(start.month).padStart(2, '0')}月` : '日期',
        startDay: start ? String(start.day).padStart(2, '0') : '--',
        endBadge: start && end && start.key !== end.key
          ? `至 ${String(end.month).padStart(2, '0')}.${String(end.day).padStart(2, '0')}`
          : (start && end ? '单日' : '起始日'),
        dateStatus: this.dateStatus(start, end)
      }
    },
    dateStatus(start, end) {
      if (!start) return { label: '日期待确认', tone: 'neutral' }
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const startTime = start.date.getTime()
      const endTime = end?.date?.getTime()
      if (today < startTime) return { label: '即将开始', tone: 'upcoming' }
      if (!endTime) return today === startTime
        ? { label: '今日开始', tone: 'today' }
        : { label: '结束待确认', tone: 'neutral' }
      if (endTime < startTime) return { label: '日期待核对', tone: 'neutral' }
      if (today > endTime) return { label: '已结束', tone: 'ended' }
      if (startTime === endTime) return { label: '今日', tone: 'today' }
      return { label: '进行中', tone: 'ongoing' }
    },
    dateRangeText(item) {
      if (!item._start) return '日期待学校确认'
      const start = `${item._start.year}年${item._start.month}月${item._start.day}日`
      if (!item._end || item._end.key === item._start.key) return start
      return `${start} — ${item._end.year}年${item._end.month}月${item._end.day}日`
    },
    weekText(value) {
      const text = String(value || '').trim()
      if (!text) return ''
      return /^第.+周$/.test(text) ? text : `第${text}周`
    },
    audienceLabel(value) {
      if (Array.isArray(value)) return value.map((item) => this.audienceLabel(item)).filter(Boolean).join('、')
      const text = String(value || '').trim()
      if (!text) return ''
      const parts = text.split(/[,，/|]/).map((item) => item.trim()).filter(Boolean)
      return parts.map((item) => audienceLabels[item.toLowerCase()] || item).join('、')
    },
    termAcademicLabel(item) {
      return [this.termLabel(item.term), item.academicYear].filter(Boolean).join(' · ')
    },
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const result = await getAcademicCalendar({ page: 1, pageSize: 300 })
        this.entries = result.items
          .filter((item) => !item.status || String(item.status).toLowerCase() === 'published')
          .map((item, index) => this.normalizeEntry(item, index))
          .sort((left, right) => {
            const leftTime = left._start?.date?.getTime() ?? Number.MAX_SAFE_INTEGER
            const rightTime = right._start?.date?.getTime() ?? Number.MAX_SAFE_INTEGER
            if (leftTime !== rightTime) return leftTime - rightTime
            if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
            return left.title.localeCompare(right.title, 'zh-CN')
          })
      } catch (error) {
        this.entries = []
        this.error = error.message || '学校校历加载失败'
      } finally {
        this.loading = false
      }
    },
    resetFilters() {
      this.selectedYear = ''
      this.selectedTerm = ''
    },
    openSource(item) {
      if (item.sourceUrl) openPage(item.sourceUrl)
    }
  }
}
</script>

<style scoped>
.calendar-page{padding-top:14rpx}.calendar-hero{position:relative;min-height:390rpx;padding:38rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#062d65,#063b80 58%,#1b5d9f);box-shadow:0 24rpx 52rpx rgba(8,48,106,.2)}.calendar-hero__ring{position:absolute;border:1rpx solid rgba(255,255,255,.13);border-radius:50%}.calendar-hero__ring--large{width:300rpx;height:300rpx;right:-110rpx;top:-126rpx}.calendar-hero__ring--small{width:144rpx;height:144rpx;right:8rpx;top:-50rpx;background:rgba(226,194,132,.07)}.calendar-hero__eyebrow,.calendar-hero__title,.calendar-hero__desc{position:relative;z-index:2;display:block}.calendar-hero__eyebrow{color:#e2c58c;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.calendar-hero__title{margin-top:16rpx;font-size:42rpx;font-weight:700;line-height:1.25}.calendar-hero__desc{width:525rpx;margin-top:12rpx;color:rgba(255,255,255,.67);font-size:20rpx;line-height:1.65}.calendar-hero__stats{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:28rpx;padding-top:20rpx;display:flex;border-top:1rpx solid rgba(255,255,255,.15)}.calendar-hero__stats view{min-width:0;flex:1;padding:0 15rpx;border-right:1rpx solid rgba(255,255,255,.12);text-align:center}.calendar-hero__stats view:first-child{padding-left:0}.calendar-hero__stats view:last-child{padding-right:0;border-right:0}.calendar-hero__stats text{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.calendar-hero__stats text:first-child{color:#ead2a1;font-size:25rpx;font-weight:700}.calendar-hero__stats text:last-child{margin-top:5rpx;color:rgba(255,255,255,.53);font-size:16rpx}.calendar-hero__mark{position:absolute;right:16rpx;bottom:-75rpx;color:rgba(255,255,255,.045);font-family:"STKaiti","KaiTi",serif;font-size:260rpx;font-weight:700}.source-strip{position:relative;z-index:3;margin:-15rpx 18rpx 0;padding:21rpx;display:flex;align-items:center}.source-strip__icon{width:54rpx;height:54rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:18rpx;color:#765623;background:#f3e3c5;font-size:19rpx;font-weight:700}.source-strip view{min-width:0}.source-strip view text{display:block}.source-strip view text:first-child{color:#3d4d63;font-size:21rpx;font-weight:700}.source-strip view text:last-child{margin-top:4rpx;color:#8a94a2;font-size:17rpx;line-height:1.55}.calendar-filters{margin-top:24rpx;padding:24rpx 0 0;overflow:hidden}.filter-block{padding:0 22rpx 17rpx}.filter-block+.filter-block{padding-top:17rpx;border-top:1rpx solid #edf0f4}.filter-block__head{margin-bottom:13rpx;display:flex;align-items:center;justify-content:space-between}.filter-block__head text:first-child{color:#3c4c61;font-size:22rpx;font-weight:700}.filter-block__head text:last-child{color:#9aa2ad;font-size:17rpx}.filter-scroll{width:100%;white-space:nowrap}.filter-row{display:inline-flex;padding:2rpx 2rpx 7rpx}.filter-chip{height:58rpx;margin-right:12rpx;padding:0 21rpx;display:flex;align-items:center;justify-content:center;border:1rpx solid #dfe5ec;border-radius:20rpx;color:#647287;background:#f9fafc;font-size:20rpx}.filter-chip--active{color:#fff;border-color:#033481;background:#033481;box-shadow:0 8rpx 18rpx rgba(3,52,129,.18)}.filter-result{min-height:62rpx;padding:0 22rpx;display:flex;align-items:center;justify-content:space-between;color:#617086;background:#f4f7fa;border-top:1rpx solid #e6ebf0;font-size:18rpx}.filter-result text:last-child{color:#94713a}.calendar-state{margin-top:26rpx}.calendar-state__title,.calendar-state__desc{display:block}.calendar-state__title{color:#35445a;font-size:27rpx;font-weight:650}.calendar-state__desc{max-width:540rpx;margin:10rpx auto 0;color:#8b95a3;font-size:20rpx;line-height:1.6}.calendar-state__button{width:240rpx;margin:24rpx auto 0}.calendar-months{margin-top:30rpx}.month-group+.month-group{margin-top:34rpx}.month-heading{margin:0 4rpx 17rpx;display:flex;align-items:center}.month-heading__badge{width:60rpx;height:60rpx;margin-right:14rpx;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:18rpx;color:#fff;background:#033481}.month-heading__badge text:first-child{font-family:Georgia,serif;font-size:22rpx;font-weight:700;line-height:1}.month-heading__badge text:last-child{margin-top:3rpx;color:rgba(255,255,255,.67);font-size:13rpx}.month-heading>view:nth-child(2) text{display:block}.month-heading>view:nth-child(2) text:first-child{color:#34445a;font-size:27rpx;font-weight:700}.month-heading>view:nth-child(2) text:last-child{margin-top:3rpx;color:#929ca8;font-size:17rpx}.month-heading__line{height:1rpx;margin-left:18rpx;flex:1;background:#dfe5ec}.calendar-list{display:flex;flex-direction:column;gap:17rpx}.calendar-card{position:relative;padding:24rpx;display:flex;overflow:hidden}.calendar-card--important{border-color:rgba(177,132,61,.32);box-shadow:0 14rpx 40rpx rgba(115,80,28,.08)}.calendar-card--important::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6rpx;background:#b58a45}.calendar-card__date{width:92rpx;min-height:112rpx;margin-right:19rpx;flex-shrink:0;display:flex;flex-direction:column;align-items:center;border-right:1rpx solid #e5e9ef}.calendar-card__date text{display:block}.calendar-card__date text:first-child{color:#9a7438;font-size:17rpx}.calendar-card__date text:nth-child(2){margin-top:4rpx;color:#173e6b;font-family:Georgia,serif;font-size:41rpx;font-weight:700;line-height:1}.calendar-card__date text:last-child{margin-top:10rpx;color:#9ba4af;font-size:14rpx;white-space:nowrap}.calendar-card__body{min-width:0;flex:1}.calendar-card__top{display:flex;align-items:center;justify-content:space-between;gap:12rpx}.calendar-card__tags{display:flex;flex-wrap:wrap;gap:7rpx}.calendar-card__tags text,.date-status{padding:6rpx 11rpx;border-radius:99rpx;font-size:15rpx;white-space:nowrap}.category--term{color:#315d8c;background:#e8f0f8}.category--registration{color:#765521;background:#f5ead5}.category--teaching{color:#176552;background:#e5f2ed}.category--exam{color:#914843;background:#f7e8e6}.category--holiday{color:#7c5f8e;background:#f0e9f4}.category--activity{color:#846128;background:#f8efdE}.category--other{color:#637084;background:#eef1f5}.priority-tag{color:#fff!important;background:#a87b36!important}.date-status{flex-shrink:0}.date-status--today,.date-status--ongoing{color:#14634f;background:#e6f3ee}.date-status--upcoming{color:#805e28;background:#f7eddc}.date-status--ended{color:#758195;background:#edf0f4}.date-status--neutral{color:#8b6a37;background:#f5ede0}.calendar-card__title,.calendar-card__range,.calendar-card__summary{display:block}.calendar-card__title{margin-top:12rpx;color:#2a3b52;font-size:26rpx;line-height:1.45;font-weight:700}.calendar-card__range{margin-top:7rpx;color:#4e6c8c;font-size:18rpx}.calendar-card__summary{margin-top:8rpx;color:#7c8898;font-size:19rpx;line-height:1.6}.calendar-card__facts{margin-top:12rpx;display:flex;flex-wrap:wrap;gap:8rpx}.calendar-card__facts text{padding:6rpx 10rpx;border-radius:10rpx;color:#69778b;background:#f0f3f7;font-size:15rpx}.calendar-card__foot{margin-top:15rpx;padding-top:13rpx;display:flex;align-items:center;justify-content:space-between;gap:14rpx;border-top:1rpx solid #edf0f4;color:#9aa2ae;font-size:16rpx}.calendar-card__foot text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.calendar-card__source{flex-shrink:0;color:#033481!important;font-weight:650}.calendar-note{margin-top:28rpx;padding:21rpx 23rpx;display:flex;align-items:flex-start;border-radius:22rpx;color:#7b8798;background:#e9edf3}.calendar-note>text{width:32rpx;height:32rpx;margin-right:12rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2rpx solid #a58249;border-radius:50%;color:#8d6a35;font-size:16rpx;font-weight:700}.calendar-note view text{display:block}.calendar-note view text:first-child{color:#55647a;font-size:19rpx;font-weight:700}.calendar-note view text:last-child{margin-top:4rpx;font-size:17rpx;line-height:1.6}

@media screen and (max-width:360px){.calendar-hero{padding-left:27rpx;padding-right:27rpx}.calendar-hero__stats{left:27rpx;right:27rpx}.calendar-card{padding:20rpx}.calendar-card__date{width:75rpx;margin-right:15rpx}.calendar-card__top{align-items:flex-start}.date-status{font-size:13rpx}.calendar-card__foot{align-items:flex-start;flex-direction:column}}

@media screen and (min-width:768px){.calendar-hero{min-height:310px;padding:42px 46px;border-radius:32px}.calendar-hero__eyebrow{font-size:15px}.calendar-hero__title{margin-top:14px;font-size:46px}.calendar-hero__desc{width:auto;max-width:720px;margin-top:12px;font-size:17px}.calendar-hero__stats{left:46px;right:46px;bottom:30px;padding-top:18px}.calendar-hero__stats text:first-child{font-size:22px}.calendar-hero__stats text:last-child{font-size:13px}.source-strip{max-width:860px;margin:-18px 28px 0;padding:18px 22px}.source-strip__icon{width:46px;height:46px;margin-right:13px}.source-strip view text:first-child{font-size:16px}.source-strip view text:last-child{font-size:13px}.calendar-filters{margin-top:26px;padding:24px 24px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.filter-block{padding:0}.filter-block+.filter-block{padding-top:0;border-top:0}.filter-block__head text:first-child{font-size:16px}.filter-block__head text:last-child{font-size:12px}.filter-chip{height:42px;margin-right:9px;padding:0 16px;border-radius:14px;font-size:14px}.filter-result{grid-column:1/-1;margin:0 -24px;padding:0 24px;font-size:13px}.calendar-months{margin-top:34px}.month-heading{margin-bottom:18px}.month-heading__badge{width:52px;height:52px;margin-right:12px}.month-heading__badge text:first-child{font-size:20px}.month-heading>view:nth-child(2) text:first-child{font-size:21px}.month-heading>view:nth-child(2) text:last-child{font-size:13px}.calendar-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.calendar-card{height:100%;padding:22px}.calendar-card__date{width:72px;min-height:104px;margin-right:16px}.calendar-card__date text:first-child{font-size:13px}.calendar-card__date text:nth-child(2){font-size:34px}.calendar-card__date text:last-child{font-size:11px}.calendar-card__tags text,.date-status{padding:5px 9px;font-size:11px}.calendar-card__title{margin-top:10px;font-size:19px}.calendar-card__range{font-size:13px}.calendar-card__summary{font-size:14px}.calendar-card__facts text{font-size:11px}.calendar-card__foot{font-size:12px}.calendar-note{padding:18px 22px}.calendar-note view text:first-child{font-size:14px}.calendar-note view text:last-child{font-size:13px}}

@media screen and (min-width:1200px){.calendar-hero{min-height:300px;padding:40px 52px}.calendar-hero__title{font-size:44px}.calendar-hero__mark{right:52px;bottom:-130px;font-size:310px}.calendar-filters{padding-left:30px;padding-right:30px}.filter-result{margin-left:-30px;margin-right:-30px;padding-left:30px;padding-right:30px}.calendar-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.calendar-card{padding:24px}}
</style>
