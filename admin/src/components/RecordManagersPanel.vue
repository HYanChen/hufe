<script setup>
import { computed, ref, watch } from 'vue'
import { BadgeCheck, Search, ShieldCheck, Trash2, UserPlus, UsersRound, X } from '@lucide/vue'
import { addRecordManager, getRecordManagers, removeRecordManager, searchPlatformAccounts } from '../lib/delegation.js'

const props = defineProps({
  resource: { type: String, required: true },
  recordId: { type: [String, Number], default: '' },
  noun: { type: String, default: '记录' },
  canManage: Boolean
})

const managers = ref([])
const loading = ref(false)
const error = ref('')
const query = ref('')
const results = ref([])
const searching = ref(false)
const searched = ref(false)
const busyId = ref('')
const pendingRemove = ref(null)
const expiry = ref(defaultExpiryDateTime())
const expiryTouched = ref(false)

function localDateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
function defaultExpiryDateTime() {
  const value = new Date()
  value.setFullYear(value.getFullYear() + 1)
  value.setSeconds(0, 0)
  return localDateTimeValue(value)
}
function minimumExpiryDateTime() {
  return localDateTimeValue(new Date(Date.now() + 60_000))
}

const expiryInputId = computed(() => `record-manager-expiry-${String(props.resource).replace(/[^a-z0-9_-]/gi, '-')}-${String(props.recordId).replace(/[^a-z0-9_-]/gi, '-')}`)
const expiryHelpId = computed(() => `${expiryInputId.value}-help`)
const expiryValidation = computed(() => {
  const value = String(expiry.value || '').trim()
  if (!value) return { valid: false, message: '请选择授权有效期' }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return { valid: false, message: '授权有效期格式无效，请重新选择' }
  if (date.getTime() <= Date.now()) return { valid: false, message: '授权有效期必须晚于当前时间' }
  return { valid: true, message: '', iso: date.toISOString() }
})

const managerIds = computed(() => new Set(managers.value.map((item) => String(item.accountId || item.id))))
function isOperationsAccount(item) {
  return item.accountSource === 'admin_provisioned' || item.source === 'admin_created' || item.source === 'admin_provisioned'
}
function accountTypeText(item) {
  return isOperationsAccount(item) ? '平台运营账号（非学校实名）' : '学校实名平台用户'
}
const availableResults = computed(() => results.value.filter((item) => {
  const active = item.status === 'active' || item.accountStatus === 'active'
  const eligibleIdentity = item.schoolIdentityVerified === true || item.verificationStatus === 'verified' || isOperationsAccount(item)
  return active && eligibleIdentity && !managerIds.value.has(String(item.id))
}))

function managerName(item) { return item.name || item.displayName || item.username || '平台用户' }
function managerDepartment(item) { return item.department || item.college || '部门未填写' }
function operationLabel(value) {
  return ({ read: '查看', create: '新增', update: '编辑', moderate: '审核办理', manage_members: '管理人员', manageManagers: '管理人员' })[value] || value
}
function scopeText(item) {
  if (item.scopeLabel) return item.scopeLabel
  if (props.resource === 'organizations') return `仅限当前${props.noun}`
  return `仅限当前${props.noun}`
}
function permissionText(item) {
  const values = item.permissions || item.scope?.permissions || []
  return Array.isArray(values) && values.length ? values.map(operationLabel).join('、') : '按当前记录授权'
}
function expiryText(value) {
  if (!value) return '长期有效'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '到期时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date)
}
function addButtonLabel(account) {
  if (!expiryValidation.value.valid) return `添加 ${managerName(account)} 为管理人员，请先设置有效的授权期限`
  return `添加 ${managerName(account)} 为管理人员，有效期至 ${expiryText(expiryValidation.value.iso)}`
}

async function load() {
  managers.value = []
  results.value = []
  searched.value = false
  query.value = ''
  pendingRemove.value = null
  expiry.value = defaultExpiryDateTime()
  expiryTouched.value = false
  if (!props.recordId) return
  loading.value = true
  error.value = ''
  try { managers.value = await getRecordManagers(props.resource, props.recordId) }
  catch (cause) { error.value = cause.message || '管理人员加载失败' }
  finally { loading.value = false }
}

async function search() {
  const keyword = query.value.trim()
  if (keyword.length < 2) {
    error.value = '请至少输入 2 个字符搜索已有平台用户'
    results.value = []
    return
  }
  searching.value = true
  searched.value = true
  error.value = ''
  try { results.value = await searchPlatformAccounts(keyword) }
  catch (cause) { error.value = cause.message || '搜索平台用户失败' }
  finally { searching.value = false }
}

async function add(account) {
  if (!props.canManage || busyId.value) return
  expiryTouched.value = true
  if (!expiryValidation.value.valid) {
    error.value = expiryValidation.value.message
    return
  }
  busyId.value = String(account.id)
  error.value = ''
  try {
    await addRecordManager(props.resource, props.recordId, account.id, expiryValidation.value.iso)
    query.value = ''
    results.value = []
    searched.value = false
    await load()
  } catch (cause) { error.value = cause.message || '添加管理人员失败' }
  finally { busyId.value = '' }
}

async function remove(account) {
  if (!props.canManage || busyId.value) return
  busyId.value = String(account.accountId || account.id)
  error.value = ''
  try {
    await removeRecordManager(props.resource, props.recordId, account.accountId || account.id)
    pendingRemove.value = null
    await load()
  } catch (cause) { error.value = cause.message || '移除管理人员失败' }
  finally { busyId.value = '' }
}

watch(() => [props.resource, props.recordId], load, { immediate: true })
</script>

<template>
  <section v-if="recordId" class="record-managers">
    <header class="record-managers-head">
      <div class="record-managers-icon"><UsersRound :size="19" /></div>
      <div><h3>管理人员</h3><p>管理范围和操作权限由服务端逐条校验</p></div>
      <span>{{ managers.length }} 人</span>
    </header>

    <div v-if="error" class="record-manager-error" role="alert"><X :size="14" />{{ error }}</div>
    <div v-if="loading" class="record-manager-loading"><span class="spinner small"></span>正在加载管理人员…</div>
    <div v-else-if="managers.length" class="record-manager-list">
      <article v-for="manager in managers" :key="manager.accountId || manager.id" class="record-manager-item">
        <div class="record-manager-avatar">{{ managerName(manager).slice(0, 1) }}</div>
        <div class="record-manager-copy">
          <strong>{{ managerName(manager) }}<BadgeCheck v-if="manager.schoolIdentityVerified" :size="13" /></strong>
          <span>{{ managerDepartment(manager) }} · {{ accountTypeText(manager) }}</span>
          <small><ShieldCheck :size="12" />{{ scopeText(manager) }} · {{ permissionText(manager) }}</small>
          <small class="record-manager-expiry">授权到期：{{ expiryText(manager.expiresAt) }}</small>
        </div>
        <template v-if="canManage">
          <div v-if="pendingRemove?.id === (manager.accountId || manager.id)" class="record-manager-confirm">
            <button type="button" @click="pendingRemove = null">取消</button>
            <button type="button" :disabled="Boolean(busyId)" @click="remove(manager)">确认移除</button>
          </div>
          <button v-else class="record-manager-remove" type="button" title="移除管理人员" :aria-label="`移除管理人员 ${managerName(manager)}`" :disabled="Boolean(busyId)" @click="pendingRemove = { id: manager.accountId || manager.id }"><Trash2 :size="15" /></button>
        </template>
      </article>
    </div>
    <p v-else-if="!loading" class="record-manager-empty">暂未设置专属管理人员。</p>

    <form v-if="canManage" class="record-manager-search" @submit.prevent="search">
      <div><Search :size="16" /><input v-model="query" type="search" minlength="2" placeholder="输入姓名、用户名或部门（至少 2 个字符）" aria-label="搜索已有平台用户" :disabled="Boolean(busyId)" /></div>
      <button class="button button-secondary" type="submit" :disabled="searching || Boolean(busyId)"><span v-if="searching" class="spinner small"></span><template v-else>搜索</template></button>
    </form>
    <div v-if="canManage" class="record-manager-expiry-field">
      <label :for="expiryInputId">授权有效期 <b aria-hidden="true">*</b></label>
      <input
        :id="expiryInputId"
        v-model="expiry"
        type="datetime-local"
        required
        :min="minimumExpiryDateTime()"
        :disabled="Boolean(busyId)"
        :aria-invalid="expiryTouched && !expiryValidation.valid ? 'true' : 'false'"
        :aria-describedby="expiryHelpId"
        @input="error = ''"
        @blur="expiryTouched = true"
      />
      <p :id="expiryHelpId" :class="{ invalid: expiryTouched && !expiryValidation.valid }">
        {{ expiryTouched && !expiryValidation.valid ? expiryValidation.message : '默认一年；受委派管理员设置的时间不得晚于其上级授权到期时间。' }}
      </p>
    </div>
    <div v-if="canManage && availableResults.length" class="record-manager-results">
      <p>添加已有实名平台用户为管理人员，或选择后台运营账号</p>
      <article v-for="account in availableResults" :key="account.id">
        <div><strong>{{ managerName(account) }}</strong><span>{{ managerDepartment(account) }} · {{ accountTypeText(account) }} · {{ account.username || '平台用户' }}</span></div>
        <button class="button button-secondary" type="button" :disabled="Boolean(busyId) || !expiryValidation.valid" :aria-label="addButtonLabel(account)" @click="add(account)"><UserPlus :size="15" />添加</button>
      </article>
    </div>
    <p v-else-if="canManage && searched && !searching" class="record-manager-empty">未找到可添加的 active 学校实名用户或平台运营账号，请更换关键词。</p>
    <p v-if="canManage" class="record-manager-policy">只能选择 active 的学校实名用户或已创建的平台运营账号，不在此处新建或伪造学校实名身份。组织管理人员的权限固定限制在当前组织。</p>
  </section>
</template>
