<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import {
  Award, BadgeCheck, Ban, Check, ChevronLeft, ChevronRight, CircleCheckBig,
  CircleOff, Eye, Pencil, Plus, Search, Send, X, XCircle
} from '@lucide/vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import CertificateTemplateDesigner from '../components/CertificateTemplateDesigner.vue'
import PageHeader from '../components/PageHeader.vue'
import PanelState from '../components/PanelState.vue'
import ResourceDrawer from '../components/ResourceDrawer.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { resourceDefinition } from '../config/resourceDefinitions.js'
import { api } from '../lib/api.js'
import { auth } from '../lib/auth.js'
import { formatDateTime, resourceStatus, resourceStatusTone, submissionTypeLabel } from '../lib/format.js'

const route = useRoute()
const config = computed(() => resourceDefinition(route.meta.resourceKey))
const query = ref('')
const filterValues = reactive({})
const page = ref(1)
const pageSize = 15
const result = ref({ items: [], total: 0, page: 1, pageSize })
const loading = ref(true)
const loadError = ref('')
const operationError = ref('')
const notice = ref('')
const drawerComponent = ref(null)
const certificateDesigner = reactive({ open: false, projectId: '' })
const certificateDesignerComponent = ref(null)
const drawer = reactive({ open: false, mode: 'view', record: {}, loading: false, saving: false, error: '' })
const dialog = reactive({ open: false, record: null, action: null, saving: false, reason: '', values: {} })

const basePath = computed(() => `/admin/business/${config.value.resource}`)
const canCreate = computed(() => Boolean(config.value?.allowCreate && auth.canCreate(config.value.resource)))
const canManageMentorOwner = computed(() => config.value?.resource === 'mentors' && auth.isSuperAdmin.value)
const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / pageSize)))
const rangeText = computed(() => {
  if (!result.value.total) return '0 条记录'
  const start = (page.value - 1) * pageSize + 1
  return `${start}–${Math.min(start + pageSize - 1, result.value.total)} / ${result.value.total}`
})

const actionIcons = { approve: Check, reject: XCircle, publish: Send, unpublish: CircleOff, close: Ban, complete: CircleCheckBig, start: Send, resolve: Check, show: Eye, hide: CircleOff, certificate: Award, issue_certificate: Award }
const actionFields = computed(() => (dialog.action?.fields || []).map(item =>
  dialog.action?.key === 'issue_certificate' && dialog.record?.certificateTemplate && ['title', 'issuer'].includes(item.key)
    ? { ...item, type: 'readonly' } : item
))
const actionValidationMessage = computed(() => {
  for (const item of actionFields.value) {
    if (item.type === 'readonly') continue
    const value = dialog.values[item.key]
    if (item.required && (value === null || value === undefined || String(value).trim() === '')) return `请填写“${item.label}”`
    if (item.type === 'number' && value !== '' && value !== null && value !== undefined) {
      const number = Number(value)
      if (!Number.isFinite(number)) return `“${item.label}”必须是有效数字`
      if (item.min !== undefined && number < Number(item.min)) return `“${item.label}”不能小于 ${item.min}`
      if (item.max !== undefined && number > Number(item.max)) return `“${item.label}”不能大于 ${item.max}`
      if (item.decimalPlaces !== undefined && Math.abs(number * (10 ** item.decimalPlaces) - Math.round(number * (10 ** item.decimalPlaces))) > 1e-8) {
        return `“${item.label}”最多保留 ${item.decimalPlaces} 位小数`
      }
    }
    if (item.minLength && String(value || '').trim().length < item.minLength) return `“${item.label}”至少需要 ${item.minLength} 个字符`
    if (item.maxLength && String(value || '').length > item.maxLength) return `“${item.label}”不能超过 ${item.maxLength} 个字符`
  }
  return ''
})
const actionConfirmDisabled = computed(() => Boolean(
  (dialog.action?.requiresReason && !dialog.reason.trim()) || actionValidationMessage.value
))

function optionValue(option) { return typeof option === 'object' ? option.value : option }
function optionLabel(option) { return typeof option === 'object' ? option.label : option }

function normalizeList(data) {
  if (Array.isArray(data)) return { items: data, total: data.length, page: 1, pageSize: data.length || pageSize }
  const items = Array.isArray(data?.items) ? data.items : []
  return { items, total: Number(data?.total ?? items.length), page: Number(data?.page || page.value), pageSize: Number(data?.pageSize || pageSize) }
}

async function load(resetPage = false) {
  if (!config.value) return
  if (resetPage) page.value = 1
  loading.value = true
  loadError.value = ''
  operationError.value = ''
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (query.value.trim()) params.set('query', query.value.trim())
  for (const filter of config.value.filters || []) if (filterValues[filter.key]) params.set(filter.key, filterValues[filter.key])
  for (const [key, value] of Object.entries(config.value.fixedFilters || {})) params.set(key, String(value))
  try { result.value = normalizeList(await api(`${basePath.value}?${params}`)) }
  catch (cause) { loadError.value = cause.message }
  finally { loading.value = false }
}

function resetFilters() {
  query.value = ''
  for (const key of Object.keys(filterValues)) filterValues[key] = ''
  load(true)
}

function getValue(record, key) {
  return String(key).split('.').reduce((value, part) => value?.[part], record)
}

function columnValue(record, column) {
  for (const key of [column.key, ...(column.fallbackKeys || [])]) {
    const value = getValue(record, key)
    if (value !== null && value !== undefined && value !== '') return value
  }
  return getValue(record, column.key)
}

function columnText(record, column) {
  const value = columnValue(record, column)
  if (column.template === 'quota') return `${record.registrationCount || record.joined || 0} / ${record.quota || '不限'}`
  if (value === null || value === undefined || value === '') return '—'
  if (column.type === 'submission-type') return submissionTypeLabel(value)
  if (column.type === 'datetime') return formatDateTime(value)
  if (column.type === 'date') return String(value).slice(0, 10)
  if (column.type === 'currency') {
    const amount = Number(value)
    return Number.isFinite(amount)
      ? `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : String(value)
  }
  if (column.options?.length) {
    const match = column.options.find((option) => optionValue(option) === value)
    if (match) return optionLabel(match)
  }
  if (column.type === 'status') return resourceStatus(value)
  if (Array.isArray(value)) return value.join('、')
  const text = String(value)
  return column.truncate && text.length > column.truncate ? `${text.slice(0, column.truncate)}…` : text
}

function visibleActions(record) {
  return (config.value.actions || []).filter((action) => (!action.statuses?.length || action.statuses.includes(record.status))
    && (!action.submissionTypes?.length || action.submissionTypes.includes(record.submissionType))
    && (!action.excludedSubmissionTypes?.length || !action.excludedSubmissionTypes.includes(record.submissionType))
    && (typeof action.when !== 'function' || action.when(record))
    && auth.canRecord(config.value.resource, record, action.key))
}

async function openRecord(record, mode = 'view') {
  if (drawer.open && drawer.record?.id !== record.id && drawerComponent.value?.confirmNavigation?.() === false) return
  const operation = mode === 'edit' ? 'update' : 'read'
  if (!auth.canRecord(config.value.resource, record, operation)) {
    operationError.value = `您没有${mode === 'edit' ? '编辑' : '查看'}该${config.value.noun}的权限`
    return
  }
  drawer.open = true
  drawer.mode = mode
  drawer.record = { ...record }
  drawer.error = ''
  drawer.loading = true
  try {
    drawer.record = await api(`${basePath.value}/${encodeURIComponent(record.id)}`)
    if (mode === 'edit' && !auth.canRecord(config.value.resource, drawer.record, 'update')) {
      drawer.mode = 'view'
      drawer.error = '服务端未授予当前账号编辑该记录的权限'
    }
  }
  catch (cause) { drawer.error = cause.message }
  finally { drawer.loading = false }
}

function createRecord() {
  if (drawer.open && drawerComponent.value?.confirmNavigation?.() === false) return
  if (!canCreate.value) {
    operationError.value = `当前账号只有记录级权限，不能新增${config.value.noun}`
    return
  }
  drawer.open = true
  drawer.mode = 'create'
  drawer.record = {}
  drawer.loading = false
  drawer.saving = false
  drawer.error = ''
}

async function saveRecord(payload) {
  const allowed = drawer.mode === 'create'
    ? canCreate.value
    : auth.canRecord(config.value.resource, drawer.record, 'update')
  if (!allowed) {
    drawer.error = '服务端未授予当前账号新增或编辑权限'
    return
  }
  drawer.saving = true
  drawer.error = ''
  try {
    const created = drawer.mode === 'create'
    const saved = await api(created ? basePath.value : `${basePath.value}/${encodeURIComponent(drawer.record.id)}`, {
      method: created ? 'POST' : 'PATCH', body: payload
    })
    drawer.record = saved?.item || saved || drawer.record
    drawer.mode = 'view'
    notice.value = `${config.value.noun}已${created ? '创建' : '更新'}`
    await load()
    window.setTimeout(() => { notice.value = '' }, 3500)
  } catch (cause) {
    drawer.error = cause.status === 409
      ? '内容已被他人更新，请重新加载后合并。您的本地草稿已保留。'
      : cause.message
  }
  finally { drawer.saving = false }
}

async function refreshMentorOwner() {
  await load()
  if (!drawer.record?.id) return
  drawer.loading = true
  drawer.error = ''
  try { drawer.record = await api(`${basePath.value}/${encodeURIComponent(drawer.record.id)}`) }
  catch (cause) { drawer.error = cause.message }
  finally { drawer.loading = false }
}

function designCertificate(record) {
  if (!auth.canRecord('giving-projects', record, 'update')) return
  if (drawer.open && drawerComponent.value?.confirmNavigation?.() === false) return
  drawer.open = false
  certificateDesigner.projectId = record.id
  certificateDesigner.open = true
}
async function certificateTemplateSaved() {
  certificateDesigner.open = false
  notice.value = '项目证书模板已保存；已签发证书保持原样'
  await load()
}

function requestAction(record, action) {
  if (!auth.canRecord(config.value.resource, record, action.key)) {
    operationError.value = '您没有执行该操作的权限'
    return
  }
  dialog.open = true
  dialog.record = record
  dialog.action = action
  dialog.reason = ''
  dialog.values = {}
  for (const item of action.fields || []) {
    dialog.values[item.key] = typeof item.default === 'function'
      ? item.default(record)
      : (item.default ?? '')
  }
  if (action.key === 'issue_certificate' && record.certificateTemplate) {
    dialog.values.title = record.certificateTemplate.title
    dialog.values.issuer = record.certificateTemplate.issuer
  }
  operationError.value = ''
}

async function confirmAction() {
  if (actionConfirmDisabled.value) return
  dialog.saving = true
  try {
    const body = {
      action: dialog.action.key,
      ...(dialog.reason.trim() ? { reason: dialog.reason.trim() } : {}),
      ...(dialog.action.includeExpectedRevision && dialog.record?.revision !== undefined
        ? { expectedRevision: dialog.record.revision }
        : {})
    }
    if (dialog.action.key === 'issue_certificate' && dialog.record?.certificateProjectRevision !== undefined) {
      body.expectedProjectRevision = dialog.record.certificateProjectRevision
      if (dialog.record.certificateTemplate) body.title = dialog.record.certificateTemplate.title
    }
    for (const item of actionFields.value) {
      if (item.type === 'readonly') continue
      let value = dialog.values[item.key]
      if (item.type === 'number') value = Number(value)
      else if (typeof value === 'string') value = value.trim()
      if (!item.required && (value === '' || value === null || value === undefined)) continue
      body[item.key] = value
    }
    await api(`${basePath.value}/${encodeURIComponent(dialog.record.id)}/actions`, {
      method: 'POST', body
    })
    notice.value = `已完成“${dialog.action.label}”操作`
    dialog.open = false
    await load()
    window.setTimeout(() => { notice.value = '' }, 3500)
  } catch (cause) {
    operationError.value = cause.message
    dialog.open = false
  } finally { dialog.saving = false }
}

function changePage(next) {
  page.value = Math.min(totalPages.value, Math.max(1, next))
  load()
}

function initializeResource() {
  certificateDesigner.open = false
  query.value = ''
  for (const key of Object.keys(filterValues)) delete filterValues[key]
  for (const filter of config.value?.filters || []) filterValues[filter.key] = ''
  page.value = 1
  drawer.open = false
  dialog.open = false
  load()
}

watch(() => route.meta.resourceKey, initializeResource)
function confirmResourceNavigation() {
  if (certificateDesignerComponent.value?.confirmNavigation?.() === false) return false
  return drawerComponent.value?.confirmNavigation?.() ?? true
}
onBeforeRouteUpdate(confirmResourceNavigation)
onBeforeRouteLeave(confirmResourceNavigation)
onMounted(initializeResource)
</script>

<template>
  <div v-if="config">
    <PageHeader :title="config.title" :description="config.description">
      <template v-if="canCreate" #actions><button class="button button-primary" type="button" @click="createRecord"><Plus :size="17" />新增{{ config.noun }}</button></template>
    </PageHeader>

    <div v-if="notice" class="toast" role="status"><BadgeCheck :size="18" />{{ notice }}<button type="button" aria-label="关闭" @click="notice = ''"><X :size="15" /></button></div>
    <div v-if="operationError" class="alert alert-error resource-operation-error" role="alert">{{ operationError }}</div>

    <section class="panel resource-table-panel">
      <form class="toolbar resource-toolbar" @submit.prevent="load(true)">
        <label class="search-field"><Search :size="17" /><input v-model="query" type="search" :placeholder="config.searchPlaceholder" :aria-label="config.searchPlaceholder" /></label>
        <label v-for="filter in config.filters" :key="filter.key" class="select-field"><span>{{ filter.label }}</span><select v-model="filterValues[filter.key]" @change="load(true)"><option value="">全部{{ filter.label }}</option><option v-for="option in filter.options" :key="optionValue(option)" :value="optionValue(option)">{{ optionLabel(option) }}</option></select></label>
        <button class="button button-primary" type="submit">查询</button>
        <button class="button button-ghost" type="button" @click="resetFilters">重置</button>
      </form>

      <PanelState :loading="loading" :error="loadError" :empty="!result.items.length" :empty-title="`暂无${config.noun}`" empty-description="请调整搜索和筛选条件，或创建新记录。" @retry="load" />
      <div v-if="!loading && !loadError && result.items.length" class="table-scroll">
        <table class="resource-table">
          <thead><tr><th v-for="column in config.columns" :key="column.key">{{ column.label }}</th><th class="align-right">操作</th></tr></thead>
          <tbody>
            <tr v-for="record in result.items" :key="record.id">
              <td v-for="column in config.columns" :key="column.key">
                <StatusBadge v-if="column.type === 'status'" :tone="resourceStatusTone(columnValue(record, column))" dot>{{ columnText(record, column) }}</StatusBadge>
                <template v-else-if="column.primary"><strong class="resource-primary-value" :title="String(columnValue(record, column) || '')">{{ columnText(record, column) }}</strong><button v-if="config.resource === 'giving-projects' && auth.canRecord(config.resource, record, 'update')" type="button" class="table-action certificate-template-entry" @click="designCertificate(record)"><Award :size="14" />{{ record.certificateTemplate ? '编辑证书模板' : '设计证书模板' }}</button></template>
                <span v-else class="resource-cell-value" :title="String(columnValue(record, column) || '')">{{ columnText(record, column) }}</span>
              </td>
              <td class="align-right">
                <div class="row-actions resource-row-actions">
                  <button v-if="auth.canRecord(config.resource, record, 'read')" class="table-action" type="button" @click="openRecord(record)"><Eye :size="14" />详情</button>
                  <button v-if="config.allowEdit !== false && auth.canRecord(config.resource, record, 'update')" class="table-action" type="button" @click="openRecord(record, 'edit')"><Pencil :size="14" />编辑</button>
                  <button v-for="action in visibleActions(record)" :key="action.key" class="table-action" :class="action.tone === 'danger' ? 'action-danger' : 'action-positive'" type="button" @click="requestAction(record, action)"><component :is="actionIcons[action.icon || action.key] || Check" :size="14" />{{ action.label }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="!loading && !loadError && result.total" class="table-footer">
        <span>共 {{ result.total }} 条{{ config.noun }}记录，当前显示 {{ rangeText }}</span>
        <div class="pagination"><button type="button" :disabled="page <= 1" aria-label="上一页" @click="changePage(page - 1)"><ChevronLeft :size="17" /></button><strong>{{ page }} / {{ totalPages }}</strong><button type="button" :disabled="page >= totalPages" aria-label="下一页" @click="changePage(page + 1)"><ChevronRight :size="17" /></button></div>
      </footer>
    </section>

    <ResourceDrawer ref="drawerComponent" :open="drawer.open" :config="config" :mode="drawer.mode" :record="drawer.record" :loading="drawer.loading" :saving="drawer.saving" :error="drawer.error" :can-edit="config.allowEdit !== false && auth.canRecord(config.resource, drawer.record, 'update')" :can-manage-managers="auth.canRecord(config.resource, drawer.record, 'manageManagers')" :can-manage-mentor-owner="canManageMentorOwner" @cancel="drawer.open = false" @edit="drawer.mode = 'edit'" @save="saveRecord" @mentor-owner-changed="refreshMentorOwner" @design-certificate="designCertificate(drawer.record)" />
    <CertificateTemplateDesigner ref="certificateDesignerComponent" :open="certificateDesigner.open" :project-id="certificateDesigner.projectId" @cancel="certificateDesigner.open = false" @saved="certificateTemplateSaved" />

    <ConfirmDialog :open="dialog.open" :title="dialog.action?.dialogTitle || `${dialog.action?.label || '处理'}${config.noun}`" :description="dialog.action?.confirm || `确认对该${config.noun}执行“${dialog.action?.label || ''}”？`" :confirm-text="dialog.action?.confirmText || dialog.action?.label || '确认'" :tone="dialog.action?.tone === 'danger' ? 'danger' : 'primary'" :busy="dialog.saving" :confirm-disabled="actionConfirmDisabled" @cancel="dialog.open = false" @confirm="confirmAction">
      <label v-if="dialog.action?.requiresReason" class="confirmation-field"><span>处理原因</span><textarea v-model="dialog.reason" rows="3" placeholder="请输入原因，将写入审计记录"></textarea></label>
      <div v-if="actionFields.length" class="action-confirmation-form">
        <p v-if="dialog.action?.formNotice" class="alert alert-warning">{{ dialog.action.formNotice }}</p>
        <p v-if="dialog.action?.key === 'issue_certificate' && dialog.record?.certificateTemplate" class="alert">本次使用该项目已保存的证书模板：{{ dialog.record.certificateTemplate.title }}。标题与签发单位由模板确定；如模板已被修改，请重新加载后签发。</p>
        <div v-if="dialog.record?.submissionType === 'giving-intent'" class="giving-intent-reference">
          <span>本次公益意向</span>
          <strong>{{ dialog.record.projectTitle || '未命名公益项目' }}</strong>
          <small>意向人：{{ dialog.record.applicantName || '未填写' }} · 用户意向金额：{{ columnText(dialog.record, { key: 'amount', type: 'currency' }) }}（仅供参考）</small>
        </div>
        <div class="action-confirmation-grid">
          <label v-for="item in actionFields" :key="item.key" class="confirmation-field" :class="{ 'confirmation-field-wide': item.span === 2 }">
            <span>{{ item.label }}<b v-if="item.required">*</b></span>
            <textarea v-if="item.type === 'textarea'" v-model="dialog.values[item.key]" :maxlength="item.maxLength || undefined" :placeholder="item.placeholder || `请输入${item.label}`"></textarea>
            <input v-else-if="item.type === 'readonly'" :value="dialog.values[item.key]" type="text" readonly />
            <input v-else v-model="dialog.values[item.key]" :type="item.type || 'text'" :min="item.min ?? undefined" :max="item.max ?? undefined" :step="item.step ?? undefined" :minlength="item.minLength || undefined" :maxlength="item.maxLength || undefined" :placeholder="item.placeholder || `请输入${item.label}`" />
          </label>
        </div>
        <p v-if="actionValidationMessage" class="action-confirmation-error">{{ actionValidationMessage }}</p>
      </div>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.certificate-template-entry{display:flex;margin-top:10px;white-space:normal;text-align:left}
</style>
