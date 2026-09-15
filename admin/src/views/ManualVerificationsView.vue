<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  BadgeCheck, ChevronLeft, ChevronRight, CircleAlert, Eye, FileText,
  RefreshCw, Search, ShieldCheck, UserRound, X
} from '@lucide/vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ManualVerificationDrawer from '../components/ManualVerificationDrawer.vue'
import PageHeader from '../components/PageHeader.vue'
import PanelState from '../components/PanelState.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { formatDateTime, personTypeLabel } from '../lib/format.js'
import {
  getManualVerification, listManualVerifications, manualVerificationStatusLabel,
  manualVerificationStatuses, manualVerificationStatusTone, performManualVerificationAction
} from '../lib/manualVerifications.js'

const pageSize = 15
const loading = ref(true)
const error = ref('')
const operationError = ref('')
const query = ref('')
const status = ref('')
const page = ref(1)
const result = ref({ items: [], total: 0, page: 1, pageSize })
const drawerOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const selectedRecord = ref(null)
const notice = ref('')
const saving = ref(false)
const reviewNote = ref('')
const dialog = ref({ open: false, action: '', record: null })
let noticeTimer = null

const actionDefinitions = {
  start: {
    title: '确认开始复核',
    description: '开始后，该申请会进入“复核中”，其他审核人员将看到当前处理状态。',
    confirmText: '确认开始复核',
    tone: 'primary',
    noteLabel: '复核备注（选填）',
    notePlaceholder: '可填写初步核验情况或需要重点检查的内容',
    noteRequired: false,
    success: '已开始复核该人工认证申请'
  },
  approve: {
    title: '确认通过人工认证',
    description: '通过后，申请人的认证状态将更新，系统应记录审核人员、时间和备注。',
    confirmText: '确认通过',
    tone: 'primary',
    noteLabel: '审核备注（选填）',
    notePlaceholder: '可填写通过依据与材料核验结果',
    noteRequired: false,
    success: '人工认证申请已通过'
  },
  reject: {
    title: '确认驳回人工认证',
    description: '驳回后本次申请将结束；请填写清晰、可追溯的驳回原因。',
    confirmText: '确认驳回',
    tone: 'danger',
    noteLabel: '驳回原因（必填）',
    notePlaceholder: '请说明材料或身份信息不符合要求的具体原因',
    noteRequired: true,
    success: '人工认证申请已驳回'
  },
  request_supplement: {
    title: '确认要求补充材料',
    description: '申请将进入“待补充”，申请人重新提交后才能继续复核。',
    confirmText: '发送补充要求',
    tone: 'primary',
    noteLabel: '补充要求（必填）',
    notePlaceholder: '请明确需要补充的材料、信息与可接受格式',
    noteRequired: true,
    success: '补充材料要求已发送'
  }
}

const activeAction = computed(() => actionDefinitions[dialog.value.action] || actionDefinitions.start)
const noteValid = computed(() => !activeAction.value.noteRequired || reviewNote.value.trim().length >= 3)
const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / pageSize)))
const rangeText = computed(() => {
  if (!result.value.total) return '0 条记录'
  const start = (page.value - 1) * pageSize + 1
  return `${start}–${Math.min(start + pageSize - 1, result.value.total)} / ${result.value.total}`
})

function showNotice(message) {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.value = '' }, 4200)
}

async function load(resetPage = false) {
  if (resetPage) page.value = 1
  loading.value = true
  error.value = ''
  try {
    result.value = await listManualVerifications({
      page: page.value,
      pageSize,
      query: query.value,
      status: status.value
    })
  } catch (cause) {
    error.value = cause.message || '人工认证申请加载失败'
  } finally {
    loading.value = false
  }
}

async function loadDetail(record = selectedRecord.value) {
  if (!record?.id) {
    detailError.value = '申请记录缺少唯一编号，无法读取详情'
    return
  }
  const expectedId = record.id
  detailLoading.value = true
  detailError.value = ''
  try {
    const detail = await getManualVerification(expectedId)
    if (drawerOpen.value && selectedRecord.value?.id === expectedId) selectedRecord.value = { ...record, ...detail }
  } catch (cause) {
    detailError.value = cause.message || '申请详情加载失败'
  } finally {
    if (selectedRecord.value?.id === expectedId) detailLoading.value = false
  }
}

function openDetail(record) {
  selectedRecord.value = record
  drawerOpen.value = true
  loadDetail(record)
}

function closeDetail() {
  if (saving.value) return
  drawerOpen.value = false
  detailError.value = ''
}

function requestAction({ action, record }) {
  if (!actionDefinitions[action] || !record?.id) return
  reviewNote.value = ''
  operationError.value = ''
  dialog.value = { open: true, action, record }
}

async function confirmAction() {
  if (!noteValid.value || saving.value) return
  saving.value = true
  operationError.value = ''
  const action = dialog.value.action
  const record = dialog.value.record
  try {
    const updated = await performManualVerificationAction(record.id, {
      action,
      reviewNote: reviewNote.value,
      expectedRevision: record.version
    })
    dialog.value.open = false
    showNotice(activeAction.value.success)
    await load()
    if (drawerOpen.value && selectedRecord.value?.id === record.id) {
      selectedRecord.value = updated?.id ? { ...selectedRecord.value, ...updated } : selectedRecord.value
      await loadDetail(selectedRecord.value)
    } else if (action === 'start') {
      const current = result.value.items.find((item) => item.id === record.id) || updated || record
      openDetail(current)
    }
  } catch (cause) {
    operationError.value = cause.status === 409
      ? `${cause.message || '申请状态已被其他审核人员更新'}，请关闭确认框并刷新详情后重试。`
      : (cause.message || '审核操作失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

function closeDialog() {
  if (saving.value) return
  dialog.value.open = false
  operationError.value = ''
}

function changePage(next) {
  page.value = Math.min(totalPages.value, Math.max(1, next))
  load()
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="人工认证审核" description="复核无法通过学校统一身份校验的实名申请，核验申请资料并记录完整审核意见。">
      <template #actions>
        <button class="button button-secondary" type="button" :disabled="loading" @click="load()"><RefreshCw :size="16" :class="{ spinning: loading }" />刷新队列</button>
      </template>
    </PageHeader>

    <div class="policy-banner manual-review-policy">
      <ShieldCheck :size="23" />
      <div><strong>最小必要访问与全程留痕</strong><p>身份证号、学工号和联系方式只显示脱敏片段。开始复核、通过、驳回及要求补充均需二次确认，并由服务端写入审核记录。</p></div>
    </div>

    <div v-if="notice" class="toast" role="status"><BadgeCheck :size="18" />{{ notice }}<button type="button" aria-label="关闭" @click="notice = ''"><X :size="15" /></button></div>
    <div v-if="operationError && !dialog.open" class="alert alert-error manual-operation-error" role="alert"><CircleAlert :size="17" />{{ operationError }}</div>

    <section class="panel table-panel manual-review-panel">
      <form class="toolbar manual-review-toolbar" @submit.prevent="load(true)">
        <label class="search-field"><Search :size="17" /><input v-model="query" type="search" placeholder="搜索姓名、学院、申请编号或脱敏学工号" aria-label="搜索人工认证申请" /></label>
        <label class="select-field"><span>审核状态</span><select v-model="status" @change="load(true)"><option v-for="item in manualVerificationStatuses" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        <button class="button button-primary" type="submit">查询</button>
      </form>

      <PanelState :loading="loading" :error="error" :empty="!result.items.length" empty-title="未找到人工认证申请" empty-description="请调整关键词或审核状态；新提交的人工认证申请会显示在这里。" @retry="load" />

      <div v-if="!loading && !error && result.items.length" class="table-scroll">
        <table class="manual-review-table">
          <thead><tr><th>申请人</th><th>学校身份</th><th>敏感编号（脱敏）</th><th>证明材料</th><th>审核状态</th><th>提交时间</th><th class="align-right">操作</th></tr></thead>
          <tbody>
            <tr v-for="record in result.items" :key="record.id">
              <td>
                <div class="manual-applicant">
                  <span>{{ record.applicantName?.slice(0, 1) || '湖' }}</span>
                  <p><strong>{{ record.applicantName }}</strong><small>{{ record.applicationNo || record.id || '申请编号未返回' }}</small></p>
                </div>
              </td>
              <td><span class="person-pill">{{ personTypeLabel(record.personType) }}</span><small class="manual-secondary-value">{{ record.college || '学院 / 部门未填写' }}</small></td>
              <td><span class="manual-sensitive">{{ record.studentNumberMasked || '学工号未提供' }}</span><small class="manual-secondary-value">{{ record.identityNumberMasked || '身份证号未提供' }}</small></td>
              <td><span class="manual-material-count"><FileText :size="14" />{{ record.materials?.length || 0 }} 份</span></td>
              <td><StatusBadge :tone="manualVerificationStatusTone(record.status)" dot>{{ manualVerificationStatusLabel(record.status) }}</StatusBadge><small v-if="record.reviewerName" class="manual-secondary-value">审核人：{{ record.reviewerName }}</small></td>
              <td><span class="date-primary">{{ formatDateTime(record.submittedAt) }}</span><small class="date-secondary">更新 {{ formatDateTime(record.updatedAt) }}</small></td>
              <td class="align-right">
                <div class="row-actions manual-row-actions">
                  <button class="table-action" type="button" @click="openDetail(record)"><Eye :size="14" />查看详情</button>
                  <button v-if="record.status === 'pending_review'" class="table-action action-positive" type="button" @click="requestAction({ action: 'start', record })"><ShieldCheck :size="14" />开始复核</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="!loading && !error && result.total" class="table-footer">
        <span>共 {{ result.total }} 份申请，当前显示 {{ rangeText }}</span>
        <div class="pagination"><button type="button" :disabled="page <= 1" aria-label="上一页" @click="changePage(page - 1)"><ChevronLeft :size="17" /></button><strong>{{ page }} / {{ totalPages }}</strong><button type="button" :disabled="page >= totalPages" aria-label="下一页" @click="changePage(page + 1)"><ChevronRight :size="17" /></button></div>
      </footer>
    </section>

    <ManualVerificationDrawer
      :open="drawerOpen"
      :record="selectedRecord"
      :loading="detailLoading"
      :error="detailError"
      :busy="saving"
      @close="closeDetail"
      @retry="loadDetail()"
      @action="requestAction"
    />

    <ConfirmDialog
      :open="dialog.open"
      :title="activeAction.title"
      :description="activeAction.description"
      :confirm-text="activeAction.confirmText"
      :tone="activeAction.tone"
      :busy="saving"
      :confirm-disabled="!noteValid"
      @cancel="closeDialog"
      @confirm="confirmAction"
    >
      <div class="manual-confirm-subject"><UserRound :size="18" /><p><strong>{{ dialog.record?.applicantName || '申请人' }}</strong><span>{{ dialog.record?.college || '学院 / 部门未填写' }} · {{ manualVerificationStatusLabel(dialog.record?.status) }}</span></p></div>
      <label class="manual-review-note"><span>{{ activeAction.noteLabel }}</span><textarea v-model="reviewNote" maxlength="500" :placeholder="activeAction.notePlaceholder"></textarea><small :class="{ invalid: activeAction.noteRequired && !noteValid }">{{ reviewNote.length }} / 500<template v-if="activeAction.noteRequired">，至少填写 3 个字符</template></small></label>
      <div v-if="operationError" class="alert alert-error manual-dialog-error" role="alert"><CircleAlert :size="16" />{{ operationError }}</div>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.manual-review-policy { border-left-color: #0f7b62; background: linear-gradient(90deg, #edf8f4, #f9fbfc); }
.manual-review-policy > svg { color: #0f7b62; }
.manual-operation-error { margin-bottom: 14px; }
.manual-review-panel { overflow: hidden; }
.manual-review-toolbar { flex-wrap: wrap; }
.manual-review-toolbar .search-field { flex: 1 1 390px; }
.manual-review-toolbar .select-field { flex: 0 1 180px; }
.manual-review-table { min-width: 1050px; }
.manual-applicant { display: flex; align-items: center; gap: 9px; min-width: 175px; }
.manual-applicant > span { width: 35px; height: 35px; flex: 0 0 auto; display: grid; place-items: center; color: #fff; background: linear-gradient(145deg, #0c559f, #063b79); border-radius: 8px; font-weight: 700; }
.manual-applicant p { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.manual-applicant strong { color: #263c54; font-size: 11px; }
.manual-applicant small { max-width: 165px; overflow: hidden; color: #929ca8; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.manual-secondary-value { max-width: 180px; margin-top: 5px; display: block; overflow: hidden; color: #8d98a6; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.manual-sensitive { display: block; color: #405872; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; letter-spacing: .03em; white-space: nowrap; }
.manual-material-count { display: flex; align-items: center; gap: 5px; color: #526b83; font-size: 9px; white-space: nowrap; }
.manual-row-actions { min-width: 174px; }
.manual-confirm-subject { margin-top: 16px; padding: 11px 12px; display: flex; align-items: center; gap: 9px; color: #405873; background: #f5f8fb; border-radius: 8px; }
.manual-confirm-subject > svg { flex: 0 0 auto; color: #0b579d; }
.manual-confirm-subject p { display: flex; flex-direction: column; gap: 3px; }
.manual-confirm-subject strong { font-size: 11px; }
.manual-confirm-subject span { color: #8491a1; font-size: 9px; }
.manual-review-note { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
.manual-review-note > span { color: #50637a; font-size: 10px; font-weight: 650; }
.manual-review-note textarea { width: 100%; min-height: 105px; padding: 10px 11px; color: #2f455d; border: 1px solid #cbd6e1; border-radius: 8px; outline: 0; resize: vertical; font: inherit; font-size: 11px; line-height: 1.6; }
.manual-review-note textarea:focus { border-color: #7fa4c9; box-shadow: 0 0 0 3px rgba(0,63,135,.08); }
.manual-review-note small { color: #98a2ae; font-size: 8px; text-align: right; }
.manual-review-note small.invalid { color: #a54141; }
.manual-dialog-error { margin-top: 12px; }

@media (max-width: 760px) {
  .manual-review-toolbar .search-field, .manual-review-toolbar .select-field { flex-basis: auto; }
  .manual-review-toolbar .select-field select { width: 100%; }
}
</style>
