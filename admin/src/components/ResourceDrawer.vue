<script setup>
import RegionSelect from './RegionSelect.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FileText, Pencil, Save, X } from '@lucide/vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ImageUploadField from './ImageUploadField.vue'
import CommunityMediaPanel from './CommunityMediaPanel.vue'
import OrganizationAlbumsPanel from './OrganizationAlbumsPanel.vue'
import { auth } from '../lib/auth.js'
import MentorOwnerPanel from './MentorOwnerPanel.vue'
import RecordManagersPanel from './RecordManagersPanel.vue'
import StatusBadge from './StatusBadge.vue'
import StructuredTextEditor from './StructuredTextEditor.vue'
import { formatDateTime, resourceStatus, resourceStatusTone, submissionTypeLabel } from '../lib/format.js'
import { useOverlayScrollLock } from '../lib/overlayScrollLock.js'
import { postTopics } from '../../../server/src/business/community.js'

const props = defineProps({
  open: Boolean,
  config: { type: Object, required: true },
  mode: { type: String, default: 'view' },
  record: { type: Object, default: () => ({}) },
  loading: Boolean,
  saving: Boolean,
  error: { type: String, default: '' },
  canEdit: { type: Boolean, default: true },
  canManageManagers: Boolean,
  canManageMentorOwner: Boolean
})
const emit = defineEmits(['cancel', 'save', 'edit', 'mentor-owner-changed', 'design-certificate'])
const router = useRouter()
function openAudit() { emit('cancel'); router.push({ name: 'audit', query: { targetId: props.record.id } }) }
const form = reactive({})
const fieldValidation = reactive({})
const validationError = ref('')
const initialFormSnapshot = ref('')
const closeConfirmOpen = ref(false)
const editorRefs = new Map()

const title = computed(() => {
  if (props.mode === 'create') return `新增${props.config.noun}`
  if (props.mode === 'edit') return `编辑${props.config.noun}`
  return `${props.config.noun}详情`
})
const editable = computed(() => props.mode === 'create' || props.mode === 'edit')
const hasStructuredText = computed(() => (props.config.fields || []).some((item) => item.type === 'structured-text'))
const isDirty = computed(() => editable.value && initialFormSnapshot.value !== formSnapshot())
const visibleFields = computed(() => (props.config.fields || []).filter((item) => !(props.mode === 'create' && item.hideOnCreate)))
const extraEntries = computed(() => {
  const configured = new Set((props.config.fields || []).flatMap((item) => [item.key, String(item.key).split('.')[0]]))
  const system = new Set(['id', 'status', 'revision', 'createdAt', 'updatedAt', 'recordKind', 'resource', 'capabilities', '_permissions', 'managers', 'managementScopes', 'owner', 'ownerAccountId', 'authorAccountId', 'verificationStatus'])
  const hidden = new Set(props.config.hiddenDetailKeys || [])
  return Object.entries(props.record || {}).filter(([key, value]) => !configured.has(key) && !system.has(key) && !hidden.has(key) && value !== '' && value !== null && value !== undefined)
})

function optionValue(option) { return typeof option === 'object' ? option.value : option }
function optionLabel(option) { return typeof option === 'object' ? option.label : option }
function recordValue(record, key) {
  if (props.config.resource === 'community-posts' && key === 'topics') return postTopics(record)
  return String(key).split('.').reduce((value, part) => value?.[part], record)
}
function fieldReadonly(item) { return item.type === 'readonly' || item.type === 'readonly-textarea' || item.key === 'status' || (item.readonlyWhenOwned && Boolean(props.record?.ownerAccountId)) }
function fieldId(item) { return `resource-${props.config.key}-${item.key}` }
function editorDraftKey(item, forceNew = false) {
  const recordKey = forceNew || props.mode === 'create' ? 'new' : (props.record?.id || 'new')
  return `${props.config.resource}:${recordKey}:${item.key}`
}
function setEditorRef(key, instance) {
  if (instance) editorRefs.set(key, instance)
  else editorRefs.delete(key)
}
function updateFieldValidation(key, result) {
  fieldValidation[key] = result?.valid === false ? String(result.message || '正文格式有误') : ''
}
function tagValues(value) {
  return String(value || '').split(/[,，]/).map((entry) => entry.trim()).filter(Boolean)
}
function fieldRuleError(item) {
  if (fieldReadonly(item)) return ''
  const value = form[item.key]
  if (value === '' || value === null || value === undefined) return ''
  if (item.type === 'number') {
    const number = Number(value)
    if (!Number.isFinite(number)) return '必须填写有效数字'
    if (item.integer && !Number.isInteger(number)) return '必须填写整数'
    if (item.min !== undefined && number < Number(item.min)) return `不能小于 ${item.min}`
    if (item.max !== undefined && number > Number(item.max)) return `不能大于 ${item.max}`
  }
  if (item.type === 'tags') {
    const tags = tagValues(value)
    if (item.maxItems && tags.length > item.maxItems) return `最多填写 ${item.maxItems} 个标签`
    const oversized = item.itemMaxLength && tags.find((tag) => tag.length > item.itemMaxLength)
    if (oversized) return `每个标签不能超过 ${item.itemMaxLength} 个字`
  } else if (item.maxLength && String(value).length > item.maxLength) {
    return `不能超过 ${item.maxLength} 个字符`
  }
  return ''
}
function readonlyFormValue(item) {
  const value = form[item.key]
  if (item.key === 'status') return resourceStatus(value)
  if (item.options?.length) {
    const match = (item.options || []).find((option) => optionValue(option) === value)
    return match ? optionLabel(match) : String(value || '')
  }
  return value
}

function normalizedPayload() {
  const payload = {}
  for (const item of props.config.fields || []) {
    if (fieldReadonly(item)) continue
    let value = form[item.key]
    if(item.type==='region')payload.regionCode=form.regionCode||''
    if (item.type === 'number') value = value === '' ? null : Number(value)
    if (item.type === 'tags') value = tagValues(value)
    payload[item.key] = value
  }
  return payload
}

function formSnapshot() {
  return JSON.stringify(normalizedPayload())
}

function resetForm() {
  validationError.value = ''
  closeConfirmOpen.value = false
  for (const key of Object.keys(fieldValidation)) delete fieldValidation[key]
  for (const key of Object.keys(form)) delete form[key]
  form.regionCode=props.record?.regionCode||''
  for (const item of props.config.fields || []) {
    let value = recordValue(props.record, item.key)
    if (item.type === 'tags' && Array.isArray(value)) value = value.join('，')
    if (item.type === 'boolean') value = Boolean(value)
    if (item.type === 'datetime-local' && value) {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) value = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    }
    if (item.type === 'date' && value) value = String(value).slice(0, 10)
    form[item.key] = value ?? item.default ?? (item.type === 'boolean' ? false : '')
  }
  initialFormSnapshot.value = formSnapshot()
}

function displayValue(item) {
  const value = recordValue(props.record, item.key)
  if (value === null || value === undefined || value === '') return '—'
  if (item.format === 'datetime') return formatDateTime(value)
  if (item.format === 'date') return String(value).slice(0, 10)
  if (item.format === 'currency') {
    const amount = Number(value)
    return Number.isFinite(amount)
      ? `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : String(value)
  }
  if (item.type === 'boolean') return value ? '是' : '否'
  if (item.key === 'submissionType') return submissionTypeLabel(value)
  if (item.type === 'datetime-local') return formatDateTime(value)
  if (item.type === 'date') return String(value).slice(0, 10)
  if (Array.isArray(value)) return value.join('、')
  if (item.options?.length) {
    const match = (item.options || []).find((option) => optionValue(option) === value)
    return match ? optionLabel(match) : String(value)
  }
  return String(value)
}

function extraValue(value) {
  if (Array.isArray(value)) return value.join('、')
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function submit() {
  validationError.value = ''
  const missing = (props.config.fields || []).find((item) => item.required && !String(form[item.key] ?? '').trim())
  if (missing) {
    validationError.value = `请填写“${missing.label}”`
    return
  }
  const invalidRule = (props.config.fields || [])
    .map((item) => ({ item, message: fieldRuleError(item) }))
    .find((entry) => entry.message)
  if (invalidRule) {
    validationError.value = `${invalidRule.item.label}：${invalidRule.message}`
    return
  }
  const invalidField = (props.config.fields || []).find((item) => fieldValidation[item.key])
  if (invalidField) {
    validationError.value = `${invalidField.label}：${fieldValidation[invalidField.key]}`
    return
  }
  flushEditorDrafts()
  const payload = normalizedPayload()
  if (props.mode === 'edit' && props.record?.revision !== undefined && props.record?.revision !== null) {
    payload.expectedRevision = props.record.revision
  }
  emit('save', payload)
}

function flushEditorDrafts() {
  for (const editor of editorRefs.values()) editor?.flushDraft?.()
}

function clearEditorDrafts() {
  for (const editor of editorRefs.values()) editor?.clearDraft?.()
  if (typeof window === 'undefined') return
  for (const item of props.config.fields || []) {
    if (item.type !== 'structured-text') continue
    window.localStorage.removeItem(`hufe-admin-editor:draft:${editorDraftKey(item)}`)
    window.localStorage.removeItem(`hufe-admin-editor:draft:${editorDraftKey(item, true)}`)
  }
}

function confirmClose() {
  closeConfirmOpen.value = false
  emit('cancel')
}

function requestClose() {
  if (props.saving) return
  flushEditorDrafts()
  if (isDirty.value) {
    closeConfirmOpen.value = true
    return
  }
  emit('cancel')
}

function confirmNavigation() {
  flushEditorDrafts()
  if (!isDirty.value) return true
  return window.confirm('当前有未保存的修改。离开后本地草稿仍会保留，确定继续吗？')
}

function onKeydown(event) {
  if (!props.open || document.querySelector('.dialog-backdrop')) return
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (editable.value && !props.saving) submit()
    return
  }
  if (event.key === 'Escape' && !props.saving) {
    if (closeConfirmOpen.value) closeConfirmOpen.value = false
    else requestClose()
  }
}

function onBeforeUnload(event) {
  if (!props.open || !isDirty.value) return
  flushEditorDrafts()
  event.preventDefault()
  event.returnValue = ''
}

watch(() => [props.open, props.mode, props.record], resetForm, { deep: true })
watch(() => props.mode, (mode, previousMode) => {
  if ((previousMode === 'create' || previousMode === 'edit') && mode === 'view') clearEditorDrafts()
})
useOverlayScrollLock(() => props.open)
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})

defineExpose({ confirmNavigation, hasUnsavedChanges: () => isDirty.value })
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="open" class="resource-drawer-backdrop" @click.self="requestClose">
        <aside class="resource-drawer" :class="{ 'resource-drawer-wide': hasStructuredText }" role="dialog" aria-modal="true" :aria-labelledby="`resource-drawer-${config.key}`">
          <header class="resource-drawer-head">
            <div class="resource-drawer-title-icon"><FileText :size="22" /></div>
            <div><p>{{ config.title }}</p><h2 :id="`resource-drawer-${config.key}`">{{ title }}</h2></div>
            <button class="icon-button" type="button" aria-label="关闭" :disabled="saving" @click="requestClose"><X :size="20" /></button>
          </header>

          <div v-if="loading" class="resource-drawer-loading"><span class="spinner"></span><p>正在加载详情…</p></div>
          <template v-else>
            <div v-if="mode === 'view'" class="resource-record-meta">
              <StatusBadge :tone="resourceStatusTone(record.status)" dot>{{ resourceStatus(record.status) }}</StatusBadge>
              <span>ID：{{ record.id || '—' }}</span>
              <span>更新：{{ formatDateTime(record.updatedAt || record.createdAt) }}</span>
            </div>

            <div v-if="error || validationError" class="alert alert-error resource-drawer-error" role="alert">{{ validationError || error }}</div>

            <div class="resource-drawer-content">
              <form v-if="editable" class="resource-form" @submit.prevent="submit">
                <div v-for="item in visibleFields" :key="item.key" class="resource-field" :class="{ 'resource-field-wide': item.span === 2 }">
                  <label :for="fieldId(item)">{{ item.label }}<b v-if="item.required">*</b></label>
                  <RegionSelect v-if="item.type==='region'" :id="fieldId(item)" v-model="form[item.key]" v-model:code="form.regionCode" :disabled="saving" :allow-remote="['jobs','collaboration-opportunities'].includes(config.resource)" />
                  <StructuredTextEditor
                    v-else-if="item.type === 'structured-text'"
                    :id="fieldId(item)"
                    :ref="(instance) => setEditorRef(item.key, instance)"
                    v-model="form[item.key]"
                    :label="item.label"
                    :max-length="item.maxLength || 20000"
                    :placeholder="item.placeholder || `请输入${item.label}`"
                    :draft-key="editorDraftKey(item)"
                    @validity="updateFieldValidation(item.key, $event)"
                  />
                  <ImageUploadField
                    v-else-if="item.type === 'image-url'"
                    :id="fieldId(item)"
                    v-model="form[item.key]"
                    :label="item.label"
                    :max-length="item.maxLength || 2048"
                    :placeholder="item.placeholder || `请输入${item.label}地址`"
                    @validity="updateFieldValidation(item.key, $event)"
                  />
                  <textarea v-else-if="item.type === 'textarea' || item.type === 'readonly-textarea'" :id="fieldId(item)" v-model="form[item.key]" :readonly="fieldReadonly(item)" :maxlength="item.maxLength || undefined" :placeholder="item.placeholder || `请输入${item.label}`"></textarea>
                  <input v-else-if="fieldReadonly(item)" :id="fieldId(item)" :value="readonlyFormValue(item)" type="text" readonly />
                  <select v-else-if="item.type === 'select'" :id="fieldId(item)" v-model="form[item.key]">
                    <option value="">请选择</option>
                    <option v-for="option in item.options" :key="optionValue(option)" :value="optionValue(option)">{{ optionLabel(option) }}</option>
                  </select>
                  <label v-else-if="item.type === 'boolean'" class="resource-switch"><input :id="fieldId(item)" v-model="form[item.key]" type="checkbox" /><span></span><b>{{ form[item.key] ? '是' : '否' }}</b></label>
                  <input v-else :id="fieldId(item)" v-model="form[item.key]" :type="item.type === 'tags' || item.type === 'readonly' ? 'text' : item.type" :readonly="item.type === 'readonly'" :maxlength="item.maxLength || undefined" :min="item.min ?? undefined" :max="item.max ?? undefined" :step="item.step ?? undefined" :placeholder="item.placeholder || `请输入${item.label}`" />
                  <small v-if="item.type === 'tags'">多个值请用逗号分隔<template v-if="item.maxItems">，最多 {{ item.maxItems }} 个</template><template v-if="item.itemMaxLength">，每个不超过 {{ item.itemMaxLength }} 个字</template></small>
                </div>
              </form>

              <p v-if="mode === 'view' && config.detailNotice" class="alert alert-warning">{{ config.detailNotice }}</p>
              <dl v-if="mode === 'view'" class="resource-detail-grid">
                <div v-for="item in visibleFields" :key="item.key" :class="{ 'resource-field-wide': item.span === 2 || item.type.includes('textarea') }">
                  <dt>{{ item.label }}</dt>
                  <dd v-if="item.type === 'structured-text'"><StructuredTextEditor :model-value="String(recordValue(record, item.key) || '')" :label="item.label" readonly /></dd>
                  <dd v-else>{{ displayValue(item) }}</dd>
                </div>
                <div v-for="[key, value] in extraEntries" :key="key">
                  <dt>{{ key }}</dt><dd>{{ extraValue(value) }}</dd>
                </div>
              </dl>

              <CommunityMediaPanel v-if="config.resource === 'community-posts' && mode !== 'create'" :key="record.id" :images="record.images || []" :mentions="record.mentions || []" />
              <OrganizationAlbumsPanel v-if="mode === 'view' && config.resource === 'organizations' && record.id && auth.canRecord('organizations', record, 'moderate')" :key="record.id" :organization-id="record.id" />
              <MentorOwnerPanel v-if="mode === 'view' && config.resource === 'mentors' && record.id" :record-id="record.id" :can-manage="canManageMentorOwner" @changed="emit('mentor-owner-changed', $event)" />
              <div v-if="mode === 'view' && config.resource === 'giving-projects' && record.id && canEdit" class="alert"><p>该项目的证书可自定义标题、感谢词、配色、背景及落款。</p><button class="button button-primary" type="button" @click="emit('design-certificate')">设计证书模板</button></div>
              <RecordManagersPanel v-if="mode !== 'create' && record.id && record.recordKind !== 'submission' && canManageManagers" :resource="config.resource" :record-id="record.id" :noun="config.noun" :can-manage="canManageManagers" />
            </div>
          </template>

          <footer v-if="!loading" class="resource-drawer-actions">
            <button v-if="mode === 'view' && record.id && auth.isSuperAdmin.value" class="button button-secondary" type="button" @click="openAudit">操作追溯</button>
            <span v-if="editable && isDirty" class="resource-unsaved-indicator">有未保存修改 · Ctrl/⌘ S 保存</span>
            <button class="button button-ghost" type="button" :disabled="saving" @click="requestClose">关闭</button>
            <button v-if="mode === 'view' && canEdit" class="button button-secondary" type="button" @click="emit('edit')"><Pencil :size="16" />编辑</button>
            <button v-else-if="mode === 'create' || canEdit" class="button button-primary" type="button" :disabled="saving" @click="submit"><span v-if="saving" class="spinner small"></span><Save v-else :size="16" />{{ saving ? '保存中…' : '保存' }}</button>
          </footer>
        </aside>
      </div>
    </Transition>

    <ConfirmDialog
      :open="closeConfirmOpen"
      title="尚有未保存的修改"
      description="离开后修改不会提交到服务器，但编辑器已将正文保存为本地草稿，下次打开同一条记录时可以恢复。"
      confirm-text="放弃本次修改"
      tone="danger"
      @cancel="closeConfirmOpen = false"
      @confirm="confirmClose"
    />
  </Teleport>
</template>
