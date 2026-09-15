<script setup>
import { computed, onMounted, ref } from 'vue'
import { BadgeCheck, CircleAlert, Clock3, ExternalLink, FileText, Globe2, RefreshCw, Server, X } from '@lucide/vue'
import PageHeader from '../components/PageHeader.vue'
import PanelState from '../components/PanelState.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { api } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'

const loading = ref(true)
const syncing = ref(false)
const error = ref('')
const status = ref(null)
const brand = ref(null)
const notice = ref('')

const healthyCount = computed(() => status.value?.sourceStatuses?.filter((source) => source.ok).length || 0)
const totalSources = computed(() => status.value?.sourceStatuses?.length || 0)
const healthRate = computed(() => totalSources.value ? Math.round((healthyCount.value / totalSources.value) * 100) : 0)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [dashboard, officialBrand] = await Promise.all([api('/admin/dashboard'), api('/brand', { token: '' })])
    status.value = dashboard.content
    brand.value = officialBrand
  } catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}

async function syncNow() {
  syncing.value = true
  error.value = ''
  try {
    status.value = await api('/admin/content/sync', { method: 'POST' })
    notice.value = '官网内容已完成手动同步，前台将使用最新缓存数据。'
    window.setTimeout(() => { notice.value = '' }, 4200)
  } catch (cause) { error.value = cause.message }
  finally { syncing.value = false }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="学校官网同步" description="从湖南财政经济学院官方公开页面同步新闻、通知、学术活动与校友资讯。">
      <template #actions><button class="button button-primary" type="button" :disabled="loading || syncing" @click="syncNow"><RefreshCw :size="16" :class="{ spinning: syncing }" />{{ syncing ? '正在同步…' : '立即同步官网' }}</button></template>
    </PageHeader>
    <div v-if="notice" class="toast" role="status"><BadgeCheck :size="18" />{{ notice }}<button type="button" aria-label="关闭" @click="notice = ''"><X :size="15" /></button></div>
    <PanelState :loading="loading" :error="error" @retry="load" />

    <template v-if="!loading && !error && status">
      <section class="sync-overview-grid">
        <article class="panel sync-health-card">
          <div class="health-gauge" :style="{ '--health': `${healthRate * 3.6}deg` }"><div><strong>{{ healthRate }}</strong><span>%</span></div></div>
          <div><p class="eyebrow">同步源健康度</p><h2>{{ healthyCount }} / {{ totalSources }} 个内容源正常</h2><p>{{ status.stale ? '部分栏目当前使用上次成功缓存，不影响已同步内容展示。' : '全部官方内容源均已成功连接。' }}</p><StatusBadge :tone="status.stale ? 'warning' : 'success'" dot>{{ status.stale ? '存在延迟' : '实时状态正常' }}</StatusBadge></div>
        </article>
        <article class="panel sync-metrics-card">
          <div><span><FileText :size="20" /></span><p><strong>{{ status.itemCount || 0 }}</strong><small>已同步内容</small></p></div>
          <div><span><Clock3 :size="20" /></span><p><strong>{{ formatDateTime(status.lastSuccessAt) }}</strong><small>最后成功同步</small></p></div>
          <div><span><Server :size="20" /></span><p><strong>{{ formatDateTime(status.lastAttemptAt) }}</strong><small>最近尝试时间</small></p></div>
        </article>
      </section>

      <section class="panel source-panel">
        <header class="panel-header"><div><p class="eyebrow">OFFICIAL CONTENT SOURCES</p><h2>官网栏目状态</h2><p>数据来源、同步时间与失败原因全部可查。</p></div><a v-if="brand?.homepage" class="button button-secondary" :href="brand.homepage" target="_blank" rel="noopener noreferrer"><Globe2 :size="16" />访问学校官网</a></header>
        <div class="source-grid">
          <article v-for="source in status.sourceStatuses" :key="source.id" class="source-card" :class="{ 'source-card-error': !source.ok }">
            <div class="source-card-top"><span class="source-icon"><Globe2 v-if="source.ok" :size="20" /><CircleAlert v-else :size="20" /></span><StatusBadge :tone="source.ok ? 'success' : 'danger'" dot>{{ source.ok ? '同步正常' : '同步异常' }}</StatusBadge></div>
            <h3>{{ source.name }}</h3><p class="source-category">{{ source.category }} · {{ source.itemCount }} 条内容</p>
            <dl><div><dt>最近同步</dt><dd>{{ formatDateTime(source.syncedAt) }}</dd></div><div v-if="source.error"><dt>异常说明</dt><dd class="source-error-text">{{ source.error }}</dd></div></dl>
            <a :href="source.url" target="_blank" rel="noopener noreferrer">打开官方栏目<ExternalLink :size="14" /></a>
          </article>
        </div>
      </section>

      <section class="sync-notes">
        <article><strong>01</strong><div><h3>定时同步与手动刷新</h3><p>服务端按设定周期自动检查官网；重要新闻发布后，管理员可手动触发。</p></div></article>
        <article><strong>02</strong><div><h3>优先使用成功缓存</h3><p>官网短暂不可达时，平台继续提供最近一次成功同步内容并标记延迟。</p></div></article>
        <article><strong>03</strong><div><h3>官方来源可追溯</h3><p>每条内容保留官网来源链接、发布时间和同步时间，方便核对。</p></div></article>
      </section>
    </template>
  </div>
</template>
