<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BadgeCheck, CircleAlert, Clock3, ExternalLink, FileText, Image, RotateCcw,
  ShieldAlert, ShieldCheck, UserRound, X, XCircle
} from '@lucide/vue'
import StatusBadge from './StatusBadge.vue'
import { formatDateTime, personTypeLabel } from '../lib/format.js'
import {
  formatMaterialSize, manualVerificationStatusLabel, manualVerificationStatusTone,
  fetchManualVerificationMaterial, materialIsImage
} from '../lib/manualVerifications.js'
import { useOverlayScrollLock } from '../lib/overlayScrollLock.js'

const props = defineProps({
  open: Boolean,
  record: { type: Object, default: null },
  loading: Boolean,
  error: { type: String, default: '' },
  busy: Boolean
})
const emit = defineEmits(['close', 'retry', 'action'])
const drawerElement = ref(null)
const materialStates = ref({})
let previousFocus = null
let materialController = null

const status = computed(() => props.record?.status || 'pending_review')
const canStart = computed(() => status.value === 'pending_review')
const canDecide = computed(() => status.value === 'reviewing')
const identitySummary = computed(() => {
  const record = props.record || {}
  return [personTypeLabel(record.personType), record.college, record.major].filter(Boolean).join(' · ') || '身份信息待补充'
})

function historyActionLabel(item) {
  return ({
    created: '创建人工实名申请',
    updated: '更新申请资料',
    material_uploaded: '上传证明材料',
    material_removed: '移除证明材料',
    claim: '管理员认领申请',
    claimed: '管理员认领申请',
    start: '开始复核',
    review_started: '开始复核',
    release: '退回待复核队列',
    approve: '审核通过',
    approved: '审核通过',
    reject: '审核驳回',
    rejected: '审核驳回',
    request_more: '要求补充材料',
    request_supplement: '要求补充材料',
    supplement_requested: '要求补充材料',
    submit: '提交申请',
    submitted: '提交申请',
    resubmit: '重新提交',
    cancelled: '申请已取消',
    tracking_expired: '查询凭证到期并清理材料'
  })[String(item?.action || '').toLowerCase()] || manualVerificationStatusLabel(item?.status) || item?.action || '状态更新'
}

function materialTypeLabel(material) {
  return material?.label || ({
    graduation_certificate: '毕业证 / 学位证',
    student_record: '学生证 / 成绩单',
    identity_document: '身份证明',
    other_evidence: '其他校友证明'
  })[material?.materialType] || '证明材料'
}

function sourceLabel(value) {
  return ({
    manual_pre_registration: '平台人工认证入口',
    manual_verification: '平台人工认证入口',
    admin: '后台录入'
  })[String(value || '').toLowerCase()] || value || '平台人工认证入口'
}

function closureReasonLabel(value) {
  return ({
    tracking_expired: '申请查询凭证已到期'
  })[String(value || '').toLowerCase()] || value || ''
}

function requestAction(action) {
  if (!props.busy) emit('action', { action, record: props.record })
}

function close() {
  if (!props.busy) emit('close')
}

function releaseMaterialPreviews() {
  materialController?.abort()
  materialController = null
  Object.values(materialStates.value).forEach((state) => {
    if (state?.url) URL.revokeObjectURL(state.url)
  })
  materialStates.value = {}
}

async function loadMaterialPreviews() {
  releaseMaterialPreviews()
  if (!props.open || !props.record?.materials?.length) return
  const controller = new AbortController()
  materialController = controller
  const nextStates = {}
  await Promise.all(props.record.materials.map(async (material) => {
    const id = String(material.id || material.url || '')
    if (!id) return
    nextStates[id] = { loading: true, url: '', error: '' }
    try {
      const blob = await fetchManualVerificationMaterial(material, { signal: controller.signal })
      const url = URL.createObjectURL(blob)
      if (controller.signal.aborted || materialController !== controller) {
        URL.revokeObjectURL(url)
        return
      }
      nextStates[id] = { loading: false, url, error: '' }
    } catch (error) {
      if (error.name !== 'AbortError') {
        nextStates[id] = { loading: false, url: '', error: error.message || '材料读取失败' }
      }
    }
  }))
  if (!controller.signal.aborted && materialController === controller) materialStates.value = nextStates
}

function materialState(material) {
  return materialStates.value[String(material?.id || material?.url || '')] || { loading: true, url: '', error: '' }
}

function onKeydown(event) {
  if (!props.open || document.querySelector('.dialog-backdrop')) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...(drawerElement.value?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') || [])]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    previousFocus = document.activeElement
    await nextTick()
    drawerElement.value?.querySelector('button:not(:disabled)')?.focus()
  } else if (previousFocus?.focus) {
    releaseMaterialPreviews()
    previousFocus.focus()
  }
})
watch(
  () => [
    props.open,
    props.record?.id || '',
    (props.record?.materials || []).map((item) => `${item.id || ''}:${item.url || ''}`).join('|')
  ],
  () => loadMaterialPreviews()
)
useOverlayScrollLock(() => props.open)
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  releaseMaterialPreviews()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="open" class="resource-drawer-backdrop" @click.self="close">
        <aside ref="drawerElement" class="resource-drawer resource-drawer-wide manual-verification-drawer" role="dialog" aria-modal="true" aria-labelledby="manual-verification-title">
          <header class="resource-drawer-head">
            <div class="resource-drawer-title-icon"><ShieldCheck :size="22" /></div>
            <div>
              <p>MANUAL IDENTITY REVIEW</p>
              <h2 id="manual-verification-title">{{ record?.applicantName || '人工认证申请详情' }}</h2>
            </div>
            <button class="icon-button" type="button" :disabled="busy" aria-label="关闭" @click="close"><X :size="20" /></button>
          </header>

          <div v-if="record" class="resource-record-meta">
            <StatusBadge :tone="manualVerificationStatusTone(record.status)" dot>{{ manualVerificationStatusLabel(record.status) }}</StatusBadge>
            <span>申请编号：{{ record.applicationNo || record.id || '—' }}</span>
            <span>提交：{{ formatDateTime(record.submittedAt) }}</span>
            <span v-if="record.updatedAt">更新：{{ formatDateTime(record.updatedAt) }}</span>
          </div>

          <div v-if="loading" class="resource-drawer-loading"><span class="spinner"></span><p>正在读取申请详情与材料元信息…</p></div>
          <div v-else-if="error" class="manual-drawer-state">
            <CircleAlert :size="32" />
            <h3>详情加载失败</h3>
            <p>{{ error }}</p>
            <button class="button button-secondary" type="button" @click="emit('retry')"><RotateCcw :size="15" />重新加载</button>
          </div>

          <div v-else-if="record" class="resource-drawer-content manual-detail-content">
            <div class="manual-privacy-banner"><ShieldAlert :size="18" /><p><strong>敏感身份信息已脱敏</strong><span>学工号、身份证号和联系方式仅展示核验所需片段；访问与审核操作均应进入审计记录。</span></p></div>

            <section class="manual-detail-section">
              <header><div><UserRound :size="18" /></div><p><strong>申请人实名信息</strong><span>{{ identitySummary }}</span></p></header>
              <dl class="manual-identity-grid">
                <div><dt>真实姓名</dt><dd>{{ record.applicantName || '—' }}</dd></div>
                <div><dt>曾用名</dt><dd>{{ record.formerName || '无' }}</dd></div>
                <div><dt>身份类型</dt><dd>{{ personTypeLabel(record.personType) }}</dd></div>
                <div><dt>学院 / 部门</dt><dd>{{ record.college || '未填写' }}</dd></div>
                <div><dt>专业</dt><dd>{{ record.major || '未填写' }}</dd></div>
                <div><dt>入学年份</dt><dd>{{ record.enrollmentYear || '未填写' }}</dd></div>
                <div><dt>毕业年份</dt><dd>{{ record.graduationYear || '未填写' }}</dd></div>
                <div><dt>学工号（脱敏）</dt><dd class="sensitive-value">{{ record.studentNumberMasked || '未提供' }}</dd></div>
                <div><dt>身份证号（脱敏）</dt><dd class="sensitive-value">{{ record.identityNumberMasked || '未提供' }}</dd></div>
                <div><dt>手机号（脱敏）</dt><dd class="sensitive-value">{{ record.phoneMasked || '未提供' }}</dd></div>
                <div><dt>申请来源</dt><dd>{{ sourceLabel(record.source) }}</dd></div>
              </dl>
            </section>

            <section class="manual-detail-section">
              <header><div><FileText :size="18" /></div><p><strong>申请说明</strong><span>申请人提交的身份说明与补充文字</span></p></header>
              <p class="manual-statement">{{ record.statement || '申请人未填写补充说明。' }}</p>
            </section>

            <section class="manual-detail-section">
              <header>
                <div><Image :size="18" /></div>
                <p><strong>证明材料</strong><span>{{ record.materials?.length || 0 }} 份附件；使用当前管理员凭证临时读取，关闭详情后立即释放</span></p>
              </header>
              <div v-if="record.materials?.length" class="manual-material-grid">
                <article v-for="material in record.materials" :key="material.id" class="manual-material">
                  <a v-if="materialIsImage(material) && materialState(material).url" class="manual-material-preview" :href="materialState(material).url" target="_blank" rel="noopener noreferrer">
                    <img :src="materialState(material).url" :alt="`${material.name} 预览`" />
                  </a>
                  <div v-else class="manual-material-placeholder">
                    <span v-if="materialState(material).loading" class="spinner"></span>
                    <FileText v-else :size="27" />
                    <span>{{ materialState(material).loading ? '安全读取中' : (material.mimeType || '附件') }}</span>
                  </div>
                  <div class="manual-material-copy">
                    <strong :title="material.name">{{ material.name }}</strong>
                    <b>{{ materialTypeLabel(material) }}</b>
                    <span>{{ material.mimeType || '文件类型未返回' }} · {{ formatMaterialSize(material.size) }}</span>
                    <small>上传：{{ formatDateTime(material.uploadedAt) }}</small>
                  </div>
                  <a v-if="materialState(material).url" class="table-action" :href="materialState(material).url" target="_blank" rel="noopener noreferrer"><ExternalLink :size="13" />预览 / 打开</a>
                  <span v-else-if="materialState(material).error" class="manual-material-unavailable">{{ materialState(material).error }}</span>
                  <span v-else class="manual-material-unavailable">正在验证访问权限…</span>
                </article>
              </div>
              <div v-else class="manual-empty-copy"><FileText :size="24" /><p>当前申请没有可预览的证明材料。</p></div>
            </section>

            <section class="manual-detail-section">
              <header><div><Clock3 :size="18" /></div><p><strong>审核摘要与记录</strong><span>展示当前审核信息、申请流转与审核备注</span></p></header>
              <dl class="manual-review-summary">
                <div><dt>当前 / 最近审核人</dt><dd>{{ record.reviewerName || '尚未分配' }}</dd></div>
                <div><dt>认领时间</dt><dd>{{ formatDateTime(record.claimedAt) }}</dd></div>
                <div><dt>最近审核时间</dt><dd>{{ formatDateTime(record.reviewedAt) }}</dd></div>
                <div><dt>申请查询凭证到期</dt><dd>{{ formatDateTime(record.trackingExpiresAt) }}</dd></div>
                <div v-if="record.reviewNote" class="wide"><dt>最近审核备注</dt><dd>{{ record.reviewNote }}</dd></div>
                <div v-if="record.closureReason" class="wide"><dt>关闭原因</dt><dd>{{ closureReasonLabel(record.closureReason) }}</dd></div>
              </dl>
              <ol v-if="record.history?.length" class="manual-history">
                <li v-for="item in record.history" :key="item.id">
                  <span></span>
                  <div><strong>{{ historyActionLabel(item) }}</strong><p>{{ item.note || '无审核备注' }}</p><small>{{ item.operator || '系统' }} · {{ formatDateTime(item.createdAt) }}</small></div>
                </li>
              </ol>
              <div v-else class="manual-empty-copy"><Clock3 :size="24" /><p>当前申请暂无流转记录。</p></div>
            </section>
          </div>

          <footer class="resource-drawer-actions manual-drawer-actions">
            <p v-if="status === 'supplement_required'"><CircleAlert :size="14" />已要求申请人补充材料，待重新提交后可继续复核。</p>
            <p v-else-if="['approved', 'rejected', 'cancelled'].includes(status)"><BadgeCheck :size="14" />该申请已完成处理，当前状态不可再次变更。</p>
            <button class="button button-ghost" type="button" :disabled="busy" @click="close">关闭</button>
            <button v-if="canStart" class="button button-primary" type="button" :disabled="busy" @click="requestAction('start')"><ShieldCheck :size="16" />开始复核</button>
            <template v-if="canDecide">
              <button class="button button-secondary" type="button" :disabled="busy" @click="requestAction('request_supplement')"><CircleAlert :size="16" />要求补充</button>
              <button class="button button-danger" type="button" :disabled="busy" @click="requestAction('reject')"><XCircle :size="16" />驳回</button>
              <button class="button button-primary" type="button" :disabled="busy" @click="requestAction('approve')"><BadgeCheck :size="16" />通过</button>
            </template>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.manual-verification-drawer { background: #f4f7fa; }
.manual-detail-content { padding: 18px 22px 28px; display: grid; grid-auto-rows: max-content; align-content: start; gap: 14px; }
.manual-privacy-banner { padding: 12px 14px; display: flex; align-items: flex-start; gap: 10px; color: #765a27; background: #fff8e9; border: 1px solid #ead9b5; border-radius: 9px; }
.manual-privacy-banner > svg { flex: 0 0 auto; color: #aa761d; }
.manual-privacy-banner p { display: flex; flex-direction: column; gap: 3px; }
.manual-privacy-banner strong { color: #76531c; font-size: 11px; }
.manual-privacy-banner span { color: #8b7650; font-size: 9px; line-height: 1.55; }
.manual-detail-section { overflow: hidden; background: #fff; border: 1px solid #dfe6ed; border-radius: 11px; }
.manual-detail-section > header { padding: 13px 15px; display: flex; align-items: center; gap: 10px; background: #fbfcfe; border-bottom: 1px solid #e7ebf0; }
.manual-detail-section > header > div { width: 34px; height: 34px; flex: 0 0 auto; display: grid; place-items: center; color: #075298; background: #eaf3fc; border-radius: 8px; }
.manual-detail-section > header p { display: flex; flex-direction: column; gap: 2px; }
.manual-detail-section > header strong { color: #2d455e; font-size: 12px; }
.manual-detail-section > header span { color: #8a96a4; font-size: 9px; line-height: 1.45; }
.manual-identity-grid { padding: 3px 15px 15px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.manual-identity-grid > div { min-width: 0; padding: 12px 5px; border-bottom: 1px dashed #e6ebf0; }
.manual-identity-grid dt, .manual-review-summary dt { margin-bottom: 5px; color: #929dab; font-size: 9px; }
.manual-identity-grid dd, .manual-review-summary dd { color: #3a5169; font-size: 11px; line-height: 1.55; overflow-wrap: anywhere; }
.sensitive-value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; }
.manual-statement { padding: 16px; color: #4f6278; font-size: 11px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.manual-material-grid { padding: 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.manual-material { min-width: 0; padding: 10px; display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 9px 10px; border: 1px solid #e0e6ed; border-radius: 9px; background: #fbfcfd; }
.manual-material-preview, .manual-material-placeholder { width: 78px; height: 66px; grid-row: 1 / span 2; overflow: hidden; border-radius: 7px; }
.manual-material-preview img { width: 100%; height: 100%; object-fit: cover; }
.manual-material-placeholder { display: grid; place-items: center; align-content: center; gap: 4px; color: #6c7e91; background: #eef2f6; }
.manual-material-placeholder span { max-width: 66px; overflow: hidden; color: #8895a3; font-size: 7px; text-overflow: ellipsis; white-space: nowrap; }
.manual-material-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.manual-material-copy strong { color: #304860; font-size: 10px; line-height: 1.45; overflow-wrap: anywhere; }
.manual-material-copy b { width: max-content; max-width: 100%; padding: 3px 6px; color: #76531c; background: #f7ead2; border-radius: 99px; font-size: 8px; line-height: 1.35; overflow-wrap: anywhere; }
.manual-material-copy span, .manual-material-copy small { color: #8895a4; font-size: 8px; line-height: 1.45; overflow-wrap: anywhere; }
.manual-material .table-action { width: max-content; }
.manual-material-unavailable { color: #a04a4a; font-size: 8px; }
.manual-empty-copy { min-height: 104px; padding: 20px; display: flex; align-items: center; justify-content: center; gap: 9px; color: #8b98a7; font-size: 10px; }
.manual-history { margin: 0; padding: 15px 17px 17px; display: grid; gap: 0; list-style: none; }
.manual-history li { position: relative; min-height: 62px; padding: 0 0 15px 28px; }
.manual-history li:last-child { min-height: 0; padding-bottom: 0; }
.manual-history li::before { content: ""; position: absolute; left: 6px; top: 10px; bottom: -2px; width: 1px; background: #d9e2eb; }
.manual-history li:last-child::before { display: none; }
.manual-history li > span { position: absolute; left: 1px; top: 4px; width: 11px; height: 11px; border: 3px solid #dbeafa; border-radius: 50%; background: #1764ad; }
.manual-history div { display: flex; flex-direction: column; gap: 3px; }
.manual-history strong { color: #334b64; font-size: 10px; }
.manual-history p { color: #66788c; font-size: 9px; line-height: 1.6; white-space: pre-wrap; }
.manual-history small { color: #9aa4b1; font-size: 8px; }
.manual-review-summary { padding: 15px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; border-bottom: 1px solid #edf1f4; }
.manual-review-summary > div { padding: 11px; background: #f6f8fa; border-radius: 8px; }
.manual-review-summary .wide { grid-column: 1 / -1; }
.manual-drawer-state { flex: 1; padding: 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; color: #a23d3d; text-align: center; }
.manual-drawer-state h3 { color: #6d3d3d; font-size: 15px; }
.manual-drawer-state p { max-width: 430px; color: #8c6666; font-size: 10px; line-height: 1.6; }
.manual-drawer-actions { flex-wrap: wrap; }
.manual-drawer-actions > p { margin-right: auto; display: flex; align-items: center; gap: 6px; color: #7f6b42; font-size: 9px; }

@media (max-width: 760px) {
  .manual-detail-content { padding: 14px 15px 22px; }
  .manual-identity-grid, .manual-material-grid, .manual-review-summary { grid-template-columns: 1fr; }
  .manual-review-summary .wide { grid-column: auto; }
  .manual-drawer-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .manual-drawer-actions > p { width: auto; grid-column: 1 / -1; }
  .manual-drawer-actions > .button { width: 100%; min-width: 0; min-height: 44px; flex: none; line-height: 1.35; text-align: center; white-space: normal; }
  .manual-drawer-actions > .button:only-of-type { grid-column: 1 / -1; }
}

@media (max-width: 420px) {
  .manual-material { grid-template-columns: 60px minmax(0, 1fr); }
  .manual-material-preview, .manual-material-placeholder { width: 60px; }
}
</style>
