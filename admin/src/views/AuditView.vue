<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronDown, ChevronUp, Fingerprint, RefreshCw, Search, ShieldCheck } from '@lucide/vue'
import PageHeader from '../components/PageHeader.vue'
import PanelState from '../components/PanelState.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { api } from '../lib/api.js'
import { auditAction, auditActionCategory } from '../lib/format.js'

const route = useRoute(), router = useRouter()
const loading = ref(true), error = ref(''), logs = ref([]), total = ref(0), status = ref(null), options = ref([])
const query = ref(''), action = ref(''), targetId = ref(''), result = ref(''), kind = ref(''), from = ref(''), to = ref(''), page = ref(1), expanded = ref('')
const pageSize = 30
let version = 0, controller, appliedFilters = {}
const pages = computed(() => Math.max(1,Math.ceil(total.value/pageSize)))
const actionOptions = computed(() => options.value.map(item => ({ ...item, label: item.action === 'business.community_like_toggled' ? '点赞与取消点赞' : auditAction(item.action,item.details) })).sort((a,b) => a.label.localeCompare(b.label,'zh-CN')))
const resultText = log => ({success:'成功',failure:'失败',blocked:'已拦截'}[log.trace?.result] || '历史记录')
const tone = log => ({success:'success',failure:'danger',blocked:'warning'}[log.trace?.result] || 'info')
const time = value => value ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '未记录'
const accountName = log => log.trace?.actorName || (log.actor === 'visitor' ? '未登录 / 身份未确认' : String(log.actor).startsWith('system') ? '系统任务' : '历史执行人')
const locationSource = log => ({ip2region:'离线 IP 归属库（近似）','local-network':'本机 / 内网，不解析城市',unavailable:'未获取地区'}[log.trace?.location?.source] || '历史未记录')
function detailText(details = {}) {
  const labels = { label:'操作',resource:'业务板块',resourceId:'关联记录',type:'业务类型',status:'状态',action:'处理方式',reason:'处理原因',accountId:'账号编号',organizationId:'组织编号',fields:'修改字段',revision:'数据版本',liked:'点赞',topic:'话题',permissions:'权限',resources:'授权板块',errorCode:'错误码',context:'场景',applicationNo:'申请编号',materialId:'材料编号',count:'数量' }
  return Object.entries(details).map(([key,value]) => `${labels[key] || key}：${typeof value === 'boolean' ? value ? '是' : '否' : typeof value === 'object' ? JSON.stringify(value) : value ?? '—'}`).join('；') || '无附加参数'
}
async function load() {
  const current = ++version
  controller?.abort(); controller = new AbortController()
  loading.value = true; error.value = ''; logs.value = []; expanded.value = ''
  const params = new URLSearchParams({ page:String(page.value), pageSize:String(pageSize) })
  for (const [key,value] of Object.entries(appliedFilters)) if (value) params.set(key,value)
  try {
    const response = await api(`/admin/audit-logs?${params}`,{signal:controller.signal})
    if (current !== version) return
    logs.value = response.items; total.value = response.total; status.value = response.status; options.value = response.actions
    if (page.value > pages.value) { page.value = pages.value; await load() }
  } catch (cause) { if (current === version) error.value = cause.message }
  finally { if (current === version) loading.value = false }
}
function search() { appliedFilters = {query:query.value,action:action.value,targetId:targetId.value,result:result.value,kind:kind.value,from:from.value,to:to.value}; page.value = 1; load() }
function reset() {
  query.value = ''; action.value = ''; targetId.value = ''; result.value = ''; kind.value = ''; from.value = ''; to.value = ''; page.value = 1
  if (route.query.targetId) router.replace({ name:'audit' }); else search()
}
function turnPage(delta) { page.value = Math.min(pages.value,Math.max(1,page.value+delta)); load() }
watch(() => route.query.targetId, value => { targetId.value = typeof value === 'string' ? value : ''; search() },{immediate:true})
onBeforeUnmount(() => { version++; controller?.abort(); logs.value = [] })
</script>

<template>
  <div class="trace-page">
    <PageHeader title="操作追溯与审计" description="查询账号操作、发帖评论、管理处理及访问记录。匿名内容的真实账号仅向授权管理员展示。">
      <template #actions><button class="button button-secondary" :disabled="loading" @click="load"><RefreshCw :size="16" />刷新日志</button></template>
    </PageHeader>
    <section class="audit-summary">
      <div><span><ShieldCheck :size="22" /></span><p><strong>{{ status?.healthy ? '操作记录已启用' : status ? '发现审计写入异常' : '正在读取审计状态' }}</strong><small>IP 归属地为近似地区，不能证明具体地点；设备信息来自客户端声明，历史缺失数据不会补造。</small></p></div>
      <StatusBadge :tone="status?.healthy ? 'success' : 'warning'">{{ status?.healthy ? '记录正常' : status ? '请检查存储' : '检查中' }}</StatusBadge>
    </section>
    <p v-if="status?.location" class="trace-notice">地区数据：{{ status.location.provider }} · {{ status.location.databases.length ? status.location.databases.map(db => `IPv${db.version}（${time(db.createdAt)}）`).join(' / ') : '尚未安装离线归属库' }}。本机与内网地址不显示城市。</p>
    <p v-if="status?.damagedRecords" class="trace-notice" role="alert">发现 {{ status.damagedRecords }} 条不完整记录，原文件已保留待维护核查；下方仅展示可读取的完整记录，不代表异常期间记录完整。</p>
    <section class="panel table-panel">
      <form class="trace-filters" @submit.prevent="search">
        <label class="search-field"><Search :size="17" /><input v-model="query" type="search" placeholder="搜索真实姓名、用户名、IP、地区或请求编号" aria-label="搜索日志" /></label>
        <label class="select-field"><span>记录类别</span><select v-model="kind"><option value="">全部记录</option><option value="operation">操作与业务处理</option><option value="access">查看与访问</option></select></label>
        <label class="select-field"><span>操作结果</span><select v-model="result"><option value="">全部结果</option><option value="success">成功</option><option value="failure">失败</option><option value="blocked">已拦截</option><option value="unknown">历史未单独记录</option></select></label>
        <label class="select-field"><span>操作类型</span><select v-model="action"><option value="">全部操作</option><option v-for="option in actionOptions" :key="option.key" :value="option.key">{{ option.label }}</option></select></label>
        <label class="select-field"><span>目标记录（包含关联评论）</span><input v-model="targetId" placeholder="完整记录编号" /></label>
        <label class="select-field"><span>开始日期</span><input v-model="from" type="date" /></label>
        <label class="select-field"><span>结束日期</span><input v-model="to" type="date" /></label>
        <div class="trace-filter-actions"><button class="button button-primary" :disabled="loading">查询</button><button type="button" class="button button-secondary" :disabled="loading" @click="reset">重置</button></div>
      </form>
      <PanelState :loading="loading" :error="error" :empty="!logs.length" empty-title="没有符合条件的记录" empty-description="可调整日期、账号或操作类型后查询。" @retry="load" />
      <div v-if="!loading && !error" class="audit-list">
        <article v-for="log in logs" :key="log.id" class="audit-row">
          <button class="audit-row-main" type="button" :aria-expanded="expanded === log.id" @click="expanded = expanded === log.id ? '' : log.id">
            <span class="audit-icon"><Fingerprint :size="20" /></span>
            <span class="audit-action"><strong>{{ auditAction(log.action,log.details) }}</strong><small>{{ auditActionCategory(log.action,log.details) }} · {{ accountName(log) }}</small></span>
            <StatusBadge :tone="tone(log)">{{ resultText(log) }}</StatusBadge>
            <span class="audit-target"><strong>{{ log.ip || 'IP未记录' }}</strong><small>{{ log.trace?.location?.label || '地区未记录' }}</small></span>
            <span class="audit-time"><small>{{ time(log.createdAt) }}</small><b>{{ log.trace?.device?.browser || '设备未记录' }}</b></span>
            <ChevronUp v-if="expanded === log.id" :size="17" /><ChevronDown v-else :size="17" />
          </button>
          <div v-if="expanded === log.id" class="audit-detail">
            <dl>
              <div><dt>真实执行人</dt><dd>{{ accountName(log) }}</dd></div><div><dt>登录用户名</dt><dd>{{ log.trace?.actorUsername || '未记录' }}</dd></div>
              <div><dt>账号编号</dt><dd>{{ log.trace?.actorAccountId || log.actor || '未记录' }}</dd></div><div><dt>操作结果</dt><dd>{{ resultText(log) }} · {{ log.trace?.statusCode ? `HTTP ${log.trace.statusCode}` : '历史未单独记录状态码' }}</dd></div>
              <div><dt>客户端 IP</dt><dd>{{ log.ip || '未记录' }}</dd></div><div><dt>连接对端 IP</dt><dd>{{ log.trace?.peerIp || '未记录' }}</dd></div>
              <div><dt>IP 解析来源</dt><dd>{{ log.trace?.ipSource === 'trusted-proxy' ? '可信代理链' : log.trace?.ipSource === 'socket' ? '直接连接' : '历史未记录' }}</dd></div><div><dt>IP 归属地 / 运营商</dt><dd>{{ log.trace?.location?.label || '未记录' }} {{ log.trace?.location?.isp || '' }}<small>{{ locationSource(log) }}</small></dd></div>
              <div><dt>客户端声明的设备</dt><dd>{{ log.trace?.device ? `${log.trace.device.type} · ${log.trace.device.os}` : '未记录' }}</dd></div><div><dt>浏览器 / 版本</dt><dd>{{ log.trace?.device?.browser || '未记录' }} {{ log.trace?.device?.browserVersion || '' }}</dd></div>
              <div><dt>请求编号</dt><dd>{{ log.requestId || '历史未记录' }}</dd></div><div><dt>请求路由（不含查询参数）</dt><dd>{{ log.trace?.method || '' }} {{ log.trace?.route || '未记录' }}</dd></div>
              <div><dt>目标记录编号</dt><dd>{{ log.targetId || '无具体记录' }}</dd></div><div><dt>操作时间 / 处理耗时</dt><dd>{{ time(log.createdAt) }}<small>{{ log.trace?.durationMs != null ? `${log.trace.durationMs} 毫秒` : '耗时未记录' }}</small></dd></div>
              <div v-if="log.trace?.errorCode"><dt>错误代码</dt><dd>{{ log.trace.errorCode }}</dd></div><div><dt>原始操作码</dt><dd>{{ log.action }}</dd></div>
            </dl>
            <p><strong>业务参数</strong>{{ detailText(log.details) }}</p>
            <details v-if="log.userAgent"><summary>客户端原始声明（可被修改，仅供参考）</summary><p>{{ log.userAgent }}</p></details>
          </div>
        </article>
      </div>
      <footer v-if="!loading && !error" class="table-footer"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="trace-filter-actions"><button class="button button-secondary" :disabled="page <= 1" @click="turnPage(-1)">上一页</button><button class="button button-secondary" :disabled="page >= pages" @click="turnPage(1)">下一页</button></div></footer>
    </section>
  </div>
</template>

<style scoped>
.trace-page .audit-summary strong{font-size:15px}.trace-page .audit-summary small,.trace-notice{font-size:13px;line-height:1.7}.trace-notice{margin:0 0 18px;color:#718095}.trace-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:20px;border-bottom:1px solid #e5eaf2;align-items:end}.trace-filters .search-field{grid-column:span 2;min-width:0}.trace-filters input,.trace-filters select{font-size:14px;min-width:0}.trace-filters .select-field input{width:100%;height:40px;border:1px solid #cfd9e8;border-radius:7px;padding:0 10px;background:white;color:#203c60}.trace-filter-actions{display:flex;gap:10px}.trace-page .audit-row-main{grid-template-columns:auto minmax(180px,1.3fr) auto minmax(140px,1fr) minmax(150px,1fr) auto;gap:12px;padding:18px 0}.trace-page .audit-action strong{font-size:15px}.trace-page .audit-action small,.trace-page .audit-target small,.trace-page .audit-time small,.trace-page .audit-time b{font-size:13px;line-height:1.6;color:#748296}.trace-page .audit-target strong{font-size:14px;overflow-wrap:anywhere}.trace-page .audit-detail{font-size:14px;padding:20px;line-height:1.7}.trace-page .audit-detail dl{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.trace-page .audit-detail dt{color:#728197}.trace-page .audit-detail dd{margin:0}.trace-page .audit-detail small{display:block;font-size:12px;color:#718098}.trace-page .audit-detail p{display:block}.trace-page .audit-detail p strong{display:block}.trace-page .audit-detail details{margin-top:14px;overflow-wrap:anywhere}.trace-page .audit-detail summary{cursor:pointer}
@media(max-width:1100px){.trace-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.trace-page .audit-row-main{grid-template-columns:auto 1fr auto}.trace-page .audit-target{grid-column:2;display:flex}.trace-page .audit-time{grid-column:2;text-align:left}.trace-page .audit-row-main>.status-badge{display:inline-flex}.trace-page .audit-row-main>svg{grid-column:3;grid-row:1}.trace-page .audit-detail{margin-left:0}}@media(max-width:600px){.trace-filters{grid-template-columns:1fr}.trace-filters .search-field{grid-column:auto}.trace-page .audit-detail dl{grid-template-columns:1fr}.trace-page .table-footer{gap:14px;flex-wrap:wrap}}
</style>
