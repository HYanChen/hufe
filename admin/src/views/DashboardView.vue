<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, BadgeCheck, Boxes, Clock3, GraduationCap, RefreshCw, ShieldAlert, UserRound, UsersRound } from '@lucide/vue'
import PageHeader from '../components/PageHeader.vue'
import PanelState from '../components/PanelState.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { api } from '../lib/api.js'
import { auth } from '../lib/auth.js'
import { formatDateTime } from '../lib/format.js'

const loading = ref(true)
const error = ref('')
const dashboard = ref(null)
const businessSummary = ref({ resources: {}, submissions: 0, revision: 0 })
const businessSummaryError = ref('')

const businessModules = [
  { name: 'applications', resource: 'applications', label: '申请与报名' },
  { name: 'community', resource: 'community-posts', label: '湖财圈' },
  { name: 'announcements', resource: 'announcements', label: '公告与消息' },
  { name: 'academicCalendar', resource: 'academic-calendar', label: '校历管理' },
  { name: 'serviceCatalog', resource: 'service-catalog', label: '服务目录' },
  { name: 'serviceApplications', resource: 'service-applications', label: '服务申请' },
  { name: 'activities', resource: 'activities', label: '活动' },
  { name: 'campusVisits', resource: 'campus-visits', label: '返校预约' },
  { name: 'alumniEnterprises', resource: 'alumni-enterprises', label: '企业认证与名录' },
  { name: 'collaborationOpportunities', resource: 'collaboration-opportunities', label: '合作广场' },
  { name: 'alumniAcademy', resource: 'alumni-academy', label: '校友课堂' },
  { name: 'alumniBenefits', resource: 'alumni-benefits', label: '校友权益' },
  { name: 'organizations', resource: 'organizations', label: '校友组织' },
  { name: 'directory', resource: 'directory', label: '校友名录' },
  { name: 'jobs', resource: 'jobs', label: '岗位招聘审核' },
  { name: 'mentors', resource: 'mentors', label: '校友导师' },
  { name: 'volunteers', resource: 'volunteers', label: '志愿者' },
  { name: 'givingProjects', resource: 'giving-projects', label: '回馈母校' },
  { name: 'feedback', resource: 'feedback', label: '意见反馈' },
  { name: 'homeConfig', resource: 'home-config', label: '首页运营' }
]

const stats = computed(() => {
  const data = dashboard.value || {}
  return [
    { label: '全部平台账号', value: data.accounts || 0, note: `${data.activeAccounts || 0} 个正常使用 · ${data.operationsAccounts || 0} 个运营/演示账号`, icon: UsersRound, tone: 'blue' },
    { label: '在校学生', value: data.students || 0, note: '学籍身份已校验', icon: GraduationCap, tone: 'cyan' },
    { label: '教师及教职工', value: data.facultyAndStaff || 0, note: '校内在职身份', icon: UserRound, tone: 'gold' },
    { label: '实名校友', value: data.alumni || 0, note: '校友身份已确认', icon: BadgeCheck, tone: 'green' },
    { label: '待处理重复账号', value: data.openConflicts || 0, note: data.openConflicts ? '需及时保留唯一账号' : '当前无账号冲突', icon: ShieldAlert, tone: data.openConflicts ? 'red' : 'slate' }
  ]
})

const content = computed(() => dashboard.value?.content || {})
const sourceSuccess = computed(() => content.value.sourceStatuses?.filter((item) => item.ok).length || 0)

function count(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function workflowMetrics(summary = {}) {
  const processing = count(summary.processing ?? summary.inProgress ?? summary.in_progress)
  const pending = count(summary.pending)
  const todo = count(summary.todo ?? summary.awaiting ?? summary.pendingReview ?? summary.pending_review)
    ?? (pending === null ? 0 : Math.max(0, pending - (processing || 0)))
  const publicCount = count(summary.public ?? summary.published ?? summary.visible) || 0
  const completed = count(summary.completed ?? summary.finished)
  return {
    todo,
    processing: processing ?? 0,
    processingKnown: processing !== null,
    outcome: publicCount + (completed || 0)
  }
}

const businessCards = computed(() => businessModules
  .filter((item) => auth.canAccess(item.resource))
  .map((item) => {
    const summary = businessSummary.value.resources?.[item.resource] || { total: 0, pending: 0, public: 0 }
    return { ...item, ...summary, ...workflowMetrics(summary) }
  }))
const workflowTotals = computed(() => businessCards.value.reduce((totals, item) => ({
  todo: totals.todo + item.todo,
  processing: totals.processing + item.processing,
  outcome: totals.outcome + item.outcome,
  processingKnown: totals.processingKnown || item.processingKnown
}), { todo: 0, processing: 0, outcome: 0, processingKnown: false }))

async function load() {
  loading.value = true
  error.value = ''
  businessSummaryError.value = ''
  try {
    const [dashboardResult, businessResult] = await Promise.allSettled([api('/admin/dashboard'), api('/admin/business/summary')])
    if (dashboardResult.status === 'rejected') throw dashboardResult.reason
    dashboard.value = dashboardResult.value
    if (businessResult.status === 'fulfilled') businessSummary.value = businessResult.value
    else if (dashboardResult.value?.business) businessSummary.value = dashboardResult.value.business
    else businessSummaryError.value = businessResult.reason?.message || '业务概览暂时不可用'
  }
  catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="运营总览" :description="auth.isSuperAdmin.value ? '查看全校平台账号、学校实名分类、业务板块待办、唯一性校验和官网内容同步状态。' : '仅展示当前账号获授权板块的业务待办与数据。'">
      <template #actions><button class="button button-secondary" type="button" :disabled="loading" @click="load"><RefreshCw :size="16" />刷新数据</button></template>
    </PageHeader>

    <PanelState :loading="loading" :error="error" @retry="load" />
    <template v-if="!loading && !error && dashboard">
      <section v-if="auth.isSuperAdmin.value" class="stats-grid" aria-label="核心数据">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <div class="stat-icon" :class="`stat-${item.tone}`"><component :is="item.icon" :size="23" /></div>
          <div class="stat-copy"><p>{{ item.label }}</p><strong>{{ item.value.toLocaleString('zh-CN') }}</strong><span>{{ item.note }}</span></div>
        </article>
      </section>

      <section class="panel business-overview-panel">
        <header class="panel-header"><div><p class="eyebrow">{{ auth.isSuperAdmin.value ? '全板块运营' : '授权板块运营' }}</p><h2>待办 → 办理中 → 公开 / 完成</h2><p>按业务生命周期查看当前工作量，点击板块直接进入对应列表。</p></div><StatusBadge tone="info"><Boxes :size="13" />{{ businessSummary.revision === null ? '授权视图' : `版本 ${businessSummary.revision || 0}` }}</StatusBadge></header>
        <div v-if="businessSummaryError" class="alert alert-error business-summary-error">{{ businessSummaryError }}</div>
        <div class="workflow-total" aria-label="授权板块业务工作流汇总">
          <div><span>待办</span><strong>{{ workflowTotals.todo }}</strong><small>待受理 / 待审核</small></div>
          <ArrowRight :size="18" aria-hidden="true" />
          <div><span>办理中</span><strong>{{ workflowTotals.processingKnown ? workflowTotals.processing : '—' }}</strong><small>{{ workflowTotals.processingKnown ? '正在跟进处理' : '汇总接口暂未单列' }}</small></div>
          <ArrowRight :size="18" aria-hidden="true" />
          <div><span>公开 / 完成</span><strong>{{ workflowTotals.outcome }}</strong><small>已公开或已办结</small></div>
        </div>
        <div class="workflow-grid">
          <RouterLink v-for="item in businessCards" :key="item.resource" :to="{ name: item.name }" class="workflow-card">
            <header><div><strong>{{ item.label }}</strong><span>共 {{ item.total || 0 }} 条</span></div><ArrowRight :size="15" /></header>
            <div class="workflow-card-stages">
              <p :class="{ active: item.todo }"><b>{{ item.todo }}</b><small>待办</small></p>
              <span>→</span>
              <p :class="{ active: item.processing }"><b>{{ item.processingKnown ? item.processing : '—' }}</b><small>办理中</small></p>
              <span>→</span>
              <p :class="{ complete: item.outcome }"><b>{{ item.outcome }}</b><small>公开/完成</small></p>
            </div>
          </RouterLink>
        </div>
      </section>

      <section v-if="auth.isSuperAdmin.value" class="dashboard-grid">
        <article class="panel sync-summary-panel">
          <header class="panel-header">
            <div><p class="eyebrow">官网同步健康度</p><h2>官方内容源</h2></div>
            <StatusBadge :tone="content.stale ? 'warning' : 'success'" dot>{{ content.stale ? '部分延迟' : '同步正常' }}</StatusBadge>
          </header>
          <div class="sync-hero">
            <div class="sync-ring" :style="{ '--progress': `${content.sourceStatuses?.length ? (sourceSuccess / content.sourceStatuses.length) * 360 : 0}deg` }">
              <div><strong>{{ sourceSuccess }}</strong><span>/ {{ content.sourceStatuses?.length || 0 }}</span></div>
            </div>
            <div><h3>{{ content.itemCount || 0 }} 条官网内容</h3><p>已按学校官网新闻、通知、学术活动与校友栏目同步。</p><span><Clock3 :size="14" />最后成功：{{ formatDateTime(content.lastSuccessAt) }}</span></div>
          </div>
          <div class="source-mini-list">
            <div v-for="source in content.sourceStatuses?.slice(0, 5)" :key="source.id">
              <span class="source-dot" :class="source.ok ? 'source-ok' : 'source-fail'"></span><strong>{{ source.name }}</strong><span>{{ source.itemCount }} 条</span>
            </div>
          </div>
          <RouterLink class="panel-link" :to="{ name: 'sync' }">查看全部同步源<ArrowRight :size="16" /></RouterLink>
        </article>

        <article class="panel governance-panel">
          <header class="panel-header"><div><p class="eyebrow">身份与账号治理</p><h2>唯一性校验</h2></div></header>
          <div class="governance-status" :class="dashboard.openConflicts ? 'has-conflict' : ''">
            <ShieldAlert :size="28" />
            <div><strong>{{ dashboard.openConflicts ? `${dashboard.openConflicts} 个冲突待处理` : '当前无开放冲突' }}</strong><span>{{ dashboard.openConflicts ? '重复账号已阻止该学校身份完成新注册。' : '已校验的学校身份均满足新注册唯一性规则。' }}</span></div>
          </div>
          <ol class="governance-flow">
            <li><span>1</span><div><strong>学校官方实名校验</strong><small>仅在新用户注册时跳转完成</small></div></li>
            <li><span>2</span><div><strong>学校身份唯一性比对</strong><small>发现多个有效账号立即拦截</small></div></li>
            <li><span>3</span><div><strong>保留一个并注销多余账号</strong><small>处理完成后才可继续新注册</small></div></li>
          </ol>
          <RouterLink class="button button-primary button-block" :to="{ name: 'conflicts' }">进入重复账号处理<ArrowRight :size="16" /></RouterLink>
        </article>
      </section>
    </template>
  </div>
</template>

<style scoped>
.workflow-total {
  margin-top: 18px;
  padding: 15px 18px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  color: #6c7f93;
  background: linear-gradient(135deg, #f8fbfe, #f2f7fb);
  border: 1px solid #dfe8f0;
  border-radius: 11px;
}
.workflow-total > div { min-width: 0; display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 3px 10px; }
.workflow-total span { color: #526a82; font-size: 10px; font-weight: 800; }
.workflow-total strong { justify-self: end; color: #173e67; font-size: 21px; line-height: 1; }
.workflow-total small { grid-column: 1 / -1; color: #8d9baa; font-size: 8px; }
.workflow-total > svg { color: #91a8be; }
.workflow-grid { margin-top: 11px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.workflow-card { min-width: 0; padding: 12px 13px; color: inherit; background: #fff; border: 1px solid #dfe7ef; border-radius: 9px; transition: .18s ease; }
.workflow-card:hover { transform: translateY(-1px); border-color: #adc3da; box-shadow: 0 7px 18px rgba(7, 52, 99, .07); }
.workflow-card header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.workflow-card header > div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.workflow-card header strong { overflow: hidden; color: #2d4660; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.workflow-card header span { color: #96a1ad; font-size: 8px; }
.workflow-card header svg { flex: 0 0 auto; color: #9aa8b7; }
.workflow-card-stages { margin-top: 11px; display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: center; gap: 5px; }
.workflow-card-stages > span { color: #afbbc7; font-size: 10px; }
.workflow-card-stages p { min-width: 0; padding: 7px 4px; display: flex; flex-direction: column; align-items: center; gap: 2px; background: #f6f8fa; border-radius: 7px; }
.workflow-card-stages b { color: #63778e; font-size: 14px; }
.workflow-card-stages small { color: #9aa6b2; font-size: 7px; white-space: nowrap; }
.workflow-card-stages p.active { background: #fff5e6; }.workflow-card-stages p.active b { color: #ad6d12; }
.workflow-card-stages p.complete { background: #edf8f4; }.workflow-card-stages p.complete b { color: #147052; }
@media (max-width: 1120px) { .workflow-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) {
  .workflow-total { grid-template-columns: 1fr; gap: 8px; }
  .workflow-total > svg { justify-self: center; transform: rotate(90deg); }
  .workflow-grid { grid-template-columns: 1fr; }
}
</style>
