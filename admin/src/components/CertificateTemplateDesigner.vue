<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ImageUploadField from './ImageUploadField.vue'
import { api, accessToken } from '../lib/api.js'
import { auth } from '../lib/auth.js'
import { DEFAULT_CERTIFICATE_TEMPLATE, CERTIFICATE_VARIABLES, normalizeCertificateTemplate, certificateTemplateError, renderCertificateMessage, certificateTheme } from '../../../utils/certificateTemplate.js'

const props = defineProps({ open: Boolean, projectId: { type: String, default: '' } })
const emit = defineEmits(['cancel', 'saved'])
const form = reactive({ ...DEFAULT_CERTIFICATE_TEMPLATE })
const project = ref(null)
const loading = ref(false), saving = ref(false), error = ref(''), tab = ref('design'), discard = ref(false)
const uploading = ref(false)
const initial = ref(''), ownerToken = ref('')
const ownerAccountId = ref('')
let generation = 0
const valid = computed(() => certificateTemplateError(form))
const dirty = computed(() => initial.value && initial.value !== JSON.stringify(form))
const canSave = computed(() => project.value && auth.canRecord('giving-projects', project.value, 'update'))
const theme = computed(() => certificateTheme(form))
const previewMessage = computed(() => renderCertificateMessage(form.message, { recipientName: '校友姓名（示例）', projectTitle: project.value?.title || '公益项目', amount: '¥1,000.00', donatedAt: '2026-09-13' }))

async function load() {
  const run = ++generation, id = props.projectId, token = accessToken()
  loading.value = true; error.value = ''; project.value = null; initial.value = ''; ownerToken.value = token
  ownerAccountId.value = auth.state.user?.id || ''
  try {
    const result = await api(`/admin/business/giving-projects/${encodeURIComponent(id)}`, { token })
    if (run !== generation || !props.open || token !== accessToken()) return
    project.value = result
    Object.assign(form, normalizeCertificateTemplate(result.certificateTemplate))
    initial.value = JSON.stringify(form)
  } catch (cause) { if (run === generation) error.value = cause.message }
  finally { if (run === generation) loading.value = false }
}

function cancel() {
  if (saving.value || uploading.value) return
  if (dirty.value) { discard.value = true; return }
  emit('cancel')
}
function confirmDiscard() { discard.value = false; emit('cancel') }
function confirmNavigation() {
  if (!props.open) return true
  if (saving.value || uploading.value) return false
  if (dirty.value) { discard.value = true; return false }
  return true
}
function beforeUnload(event) {
  if (props.open && (dirty.value || saving.value || uploading.value)) { event.preventDefault(); event.returnValue = '' }
}
function clearChangedAccount() {
  if (!props.open || !ownerToken.value || ownerToken.value === accessToken() && ownerAccountId.value === auth.state.user?.id) return
  generation++
  Object.assign(form, DEFAULT_CERTIFICATE_TEMPLATE)
  project.value = null; initial.value = ''; saving.value = false; uploading.value = false
  emit('cancel')
}
defineExpose({ confirmNavigation })
function restore() { Object.assign(form, DEFAULT_CERTIFICATE_TEMPLATE) }
async function save() {
  if (loading.value || saving.value || uploading.value || !canSave.value || valid.value) return
  if (!ownerToken.value || ownerToken.value !== accessToken()) { error.value = '登录账号已变化，请关闭后重新打开模板设计器'; return }
  const run = generation, token = ownerToken.value
  saving.value = true; error.value = ''
  try {
    const result = await api(`/admin/business/giving-projects/${encodeURIComponent(project.value.id)}/certificate-template`, {
      method: 'POST', token, body: { expectedRevision: project.value.revision, certificateTemplate: { ...form } }
    })
    if (run !== generation || !props.open || token !== accessToken()) return
    initial.value = JSON.stringify(form)
    emit('saved', result)
  } catch (cause) {
    if (run !== generation || token !== accessToken()) return
    error.value = cause.status === 409 ? '项目已被其他管理员更新。请保留需要的文案，重新加载项目后再保存。' : cause.message
    await nextTick()
    document.querySelector('.certificate-designer-alert')?.scrollIntoView({ block: 'nearest' })
  } finally { if (run === generation) saving.value = false }
}
watch(() => [props.open, props.projectId], ([open]) => {
  discard.value = false; tab.value = 'design'; uploading.value = false
  if (open && props.projectId) load()
  else { generation++; saving.value = false; loading.value = false; project.value = null; initial.value = '' }
}, { immediate: true })
watch(() => auth.state.user?.id, clearChangedAccount)
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); window.addEventListener('storage', clearChangedAccount); window.addEventListener('hufe:auth-expired', clearChangedAccount) })
onBeforeUnmount(() => { generation++; window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('storage', clearChangedAccount); window.removeEventListener('hufe:auth-expired', clearChangedAccount) })
</script>

<template>
  <ConfirmDialog :open="open && !discard" wide title="设计项目证书模板" description="每个公益项目独立保存；修改仅用于之后签发的证书，已经签发的证书保留原样。" confirm-text="保存项目模板" tone="primary" :busy="saving || uploading" :confirm-disabled="loading || !canSave || Boolean(valid)" @cancel="cancel" @confirm="save">
    <p v-if="loading" role="status">正在读取项目模板…</p>
    <div v-if="error" class="alert alert-error certificate-designer-alert" role="alert">{{ error }} <button class="button button-ghost" type="button" :disabled="saving" @click="dirty ? discard = true : load()">{{ dirty ? '关闭并重新打开' : '重新加载' }}</button></div>
    <template v-if="project && !loading">
      <div class="designer-project"><strong>{{ project.title }}</strong><span>{{ project.certificateTemplate ? '自定义模板' : '系统默认模板' }} · 项目版本 {{ project.revision }}</span></div>
      <p v-if="!canSave" class="alert alert-warning">当前账号没有该项目的模板编辑权限。</p>
      <div class="designer-tabs" role="tablist" aria-label="模板设计与预览">
        <button type="button" role="tab" :aria-selected="tab === 'design'" @click="tab = 'design'">编辑模板</button>
        <button type="button" role="tab" :aria-selected="tab === 'preview'" @click="tab = 'preview'">查看预览</button>
      </div>
      <div class="designer-columns" :class="`designer-show-${tab}`">
        <fieldset class="designer-fields" :disabled="saving || !canSave">
          <legend class="sr-only">证书内容与样式</legend>
          <label>版式<select v-model="form.layout"><option value="classic">典雅边框</option><option value="modern">简约现代</option></select></label>
          <label>证书标题<input v-model="form.title" maxlength="60" /></label>
          <label>副标题<input v-model="form.subtitle" maxlength="120" placeholder="可留空" /></label>
          <label>感谢词<textarea v-model="form.message" maxlength="800" rows="5" /></label>
          <div class="designer-variables"><span>点击插入自动填充内容：</span><button v-for="(label, key) in CERTIFICATE_VARIABLES" :key="key" type="button" @click="form.message += `{${key}}`">{{ label }}</button></div>
          <label>签发单位<input v-model="form.issuer" maxlength="120" /></label>
          <label>落款寄语<input v-model="form.signature" maxlength="120" placeholder="例如：谨致谢忱" /></label>
          <div class="designer-colors"><label>文字颜色<input v-model="form.primaryColor" type="color" /></label><label>装饰颜色<input v-model="form.accentColor" type="color" /></label><label>纸张颜色<input v-model="form.paperColor" type="color" /></label></div>
          <div class="designer-background"><strong>证书背景图（可选）</strong><ImageUploadField v-model="form.backgroundUrl" managed-only label="证书背景" placeholder="上传后自动填入站内图片地址" @uploading="uploading = $event" /><small>请上传设计好的背景；背景以淡色衬底展示，文字保持清晰。仅接受本站已上传的图片。</small></div>
          <p v-if="valid" class="alert alert-warning">{{ valid }}</p>
          <button class="button button-ghost" type="button" @click="restore">恢复默认样式（保存后生效）</button>
        </fieldset>
        <section class="designer-preview" aria-label="证书实时预览">
          <p class="designer-preview-note">效果预览 · 示例姓名和金额，不会签发真实证书</p>
          <div class="template-paper" :class="`template-paper--${form.layout}`" :style="theme">
            <img v-if="normalizeCertificateTemplate(form).backgroundUrl" class="template-background" :src="form.backgroundUrl" alt="" />
            <div class="template-content">
              <div class="template-brand">湖南财政经济学院</div>
              <div v-if="form.subtitle" class="template-subtitle">{{ form.subtitle }}</div>
              <h3>{{ form.title }}</h3>
              <div class="template-divider"></div>
              <strong class="template-recipient">校友姓名（示例）</strong>
              <p class="template-message">{{ previewMessage }}</p>
              <div class="template-amount"><small>学校确认的实际金额</small><strong>¥1,000.00</strong></div>
              <dl><dt>公益项目</dt><dd>{{ project.title }}</dd><dt>捐赠日期</dt><dd>2026-09-13</dd><dt>证书编号</dt><dd>预览编号 · 保存模板不生成证书</dd><dt>签发单位</dt><dd>{{ form.issuer }}</dd></dl>
              <p v-if="form.signature" class="template-signature">{{ form.signature }}</p>
              <p class="template-disclaimer">本证书用于公益参与确认，不是捐赠票据。</p>
            </div>
          </div>
        </section>
      </div>
    </template>
  </ConfirmDialog>
  <ConfirmDialog :open="discard" title="放弃未保存的模板修改？" description="离开后，本次尚未保存的文案和样式不会生效。" confirm-text="放弃修改并关闭" @cancel="discard = false" @confirm="confirmDiscard" />
</template>

<style scoped>
.designer-project{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:16px 0;color:#173b62}.designer-project span,.designer-preview-note{color:#718098;font-size:12px}.designer-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:start}.designer-fields{border:0;margin:0;padding:0;min-width:0;display:grid;gap:16px}.designer-fields label{display:grid;gap:7px;font-size:13px;color:#294767}.designer-fields input,.designer-fields select,.designer-fields textarea{width:100%;min-width:0;box-sizing:border-box;border:1px solid #cedaeb;border-radius:9px;padding:10px;font:inherit;background:#fff;color:#203e61}.designer-fields textarea{resize:vertical;min-height:120px}.designer-colors{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.designer-colors input{height:42px;padding:4px}.designer-variables{display:flex;flex-wrap:wrap;gap:8px;font-size:12px}.designer-variables span{width:100%;color:#74849a}.designer-variables button{border:1px solid #d4dfee;border-radius:7px;background:#f1f6ff;color:#164773;padding:7px;cursor:pointer}.designer-background{display:grid;gap:8px;font-size:13px}.designer-background small{color:#77879b;line-height:1.6}.designer-preview{min-width:0;position:sticky;top:0}.designer-preview-note{margin:0 0 12px!important;line-height:1.6}.designer-tabs{display:none}.template-paper{position:relative;overflow:hidden;border:7px double var(--certificate-accent);border-radius:8px;background:var(--certificate-paper);color:var(--certificate-primary);padding:26px 22px;min-height:580px}.template-paper--modern{border-width:0;border-top:10px solid var(--certificate-accent);border-bottom:3px solid var(--certificate-accent);border-radius:0}.template-background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.16;pointer-events:none}.template-content{position:relative;overflow-wrap:anywhere}.template-brand{text-align:center;font:700 18px serif;letter-spacing:2px}.template-subtitle{text-align:center;margin-top:28px;font-size:10px;color:var(--certificate-accent);letter-spacing:2px}.template-paper h3{text-align:center;font:700 30px/1.4 serif;margin:16px 0;color:var(--certificate-primary)}.template-divider{width:64px;height:3px;background:var(--certificate-accent);margin:20px auto}.template-recipient{display:block;text-align:center;font-size:17px}.template-message{white-space:pre-wrap;font-size:13px;line-height:2;text-align:center;margin:18px 0}.template-amount{text-align:center;padding:18px 0;border-block:1px solid var(--certificate-accent)}.template-amount small,.template-amount strong{display:block}.template-amount strong{font:700 30px Georgia,serif;margin-top:8px}.template-paper dl{font-size:12px;display:grid;grid-template-columns:70px minmax(0,1fr);gap:12px;margin:24px 0}.template-paper dd{margin:0;font-weight:600}.template-signature{text-align:right;white-space:pre-wrap;font-size:14px;margin:22px 0}.template-disclaimer{border-top:1px solid var(--certificate-accent);padding-top:14px;font-size:10px;line-height:1.6}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
@media(max-width:760px){.designer-columns{grid-template-columns:minmax(0,1fr)}.designer-tabs{display:flex;gap:8px;margin:0 0 18px}.designer-tabs button{flex:1;padding:10px;border:1px solid #d3deee;background:#f4f7fc;color:#234566;border-radius:8px}.designer-tabs button[aria-selected=true]{background:#093d86;color:white}.designer-show-design .designer-preview,.designer-show-preview .designer-fields{display:none}.designer-preview{position:static}.template-paper{padding:24px 14px}.template-paper h3{font-size:26px}}
</style>
