<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { BadgeCheck, Save, ShieldAlert, UserPlus, X } from '@lucide/vue'
import { api } from '../lib/api.js'
import { getDelegationResources } from '../lib/delegation.js'
import { useOverlayScrollLock } from '../lib/overlayScrollLock.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['cancel', 'created'])
const form = reactive({ username: '', displayName: '', department: '', temporaryPassword: '', adminPermissions: [] })
const resources = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const created = ref(null)
const drawerElement = ref(null)
let previousFocus = null
const usernameValid = computed(() => /^[A-Za-z0-9_][A-Za-z0-9_.-]{3,31}$/.test(form.username))
const passwordValid = computed(() => form.temporaryPassword.length >= 8 && /[A-Za-z]/.test(form.temporaryPassword) && /\d/.test(form.temporaryPassword))
const formValid = computed(() => usernameValid.value && form.displayName.trim() && form.department.trim() && passwordValid.value && form.adminPermissions.length)

function reset() {
  Object.assign(form, { username: '', displayName: '', department: '', temporaryPassword: '', adminPermissions: [] })
  created.value = null
  error.value = ''
}
function toggle(key) {
  form.adminPermissions = form.adminPermissions.includes(key)
    ? form.adminPermissions.filter((item) => item !== key)
    : [...form.adminPermissions, key]
}
async function initialize() {
  if (!props.open) return
  reset()
  loading.value = true
  try { resources.value = await getDelegationResources() }
  catch (cause) { error.value = cause.message || '可授权板块加载失败' }
  finally { loading.value = false }
}
async function submit() {
  if (!formValid.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const result = await api('/admin/accounts', {
      method: 'POST',
      body: {
        username: form.username.trim(), displayName: form.displayName.trim(), department: form.department.trim(),
        temporaryPassword: form.temporaryPassword, adminPermissions: form.adminPermissions, accountType: 'operations'
      }
    })
    created.value = result?.account || result?.user || result
    emit('created', created.value)
  } catch (cause) { error.value = cause.message || '平台运营账号创建失败' }
  finally { saving.value = false }
}
function onKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape' && !saving.value) { emit('cancel'); return }
  if (event.key !== 'Tab') return
  const focusable = [...(drawerElement.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || [])]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
watch(() => props.open, initialize, { immediate: true })
watch(() => props.open, async (open) => {
  if (open) {
    previousFocus = document.activeElement
    await nextTick()
    drawerElement.value?.querySelector('input:not(:disabled),button:not(:disabled)')?.focus()
  } else if (previousFocus?.focus) previousFocus.focus()
})
useOverlayScrollLock(() => props.open)
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="open" class="resource-drawer-backdrop" @click.self="!saving && emit('cancel')">
        <aside ref="drawerElement" class="resource-drawer account-create-drawer" role="dialog" aria-modal="true" aria-labelledby="create-account-title">
          <header class="resource-drawer-head"><div class="resource-drawer-title-icon"><UserPlus :size="21" /></div><div><p>PLATFORM OPERATIONS ACCOUNT</p><h2 id="create-account-title">新增平台运营账号</h2></div><button class="icon-button" type="button" :disabled="saving" aria-label="关闭" @click="emit('cancel')"><X :size="20" /></button></header>
          <div class="account-create-content">
            <div class="account-create-warning"><ShieldAlert :size="19" /><p><strong>后台创建的平台运营账号，不等同学校实名账号</strong><span>不得填写或伪造学校身份、学工号及实名认证状态。该账号只用于已授权的后台运营工作。</span></p></div>
            <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
            <div v-if="created" class="account-created-result"><BadgeCheck :size="28" /><div><h3>平台运营账号已创建</h3><p>{{ created.displayName || created.name || created.username }} · 来源：后台创建</p><span>{{ created.mustChangePassword !== false ? '已启用首次登录强制改密' : '请检查服务端是否启用首次登录强制改密' }}</span></div></div>
            <form v-else class="account-create-form" @submit.prevent="submit">
              <label><span>登录用户名 *</span><input v-model.trim="form.username" maxlength="32" autocomplete="off" placeholder="4–32 位字母、数字或 . _ -" /><small v-if="form.username && !usernameValid">用户名格式不正确</small></label>
              <label><span>显示姓名 *</span><input v-model.trim="form.displayName" maxlength="40" autocomplete="off" placeholder="运营人员真实姓名" /></label>
              <label class="wide"><span>所属部门 *</span><input v-model.trim="form.department" maxlength="80" autocomplete="off" placeholder="例：校友工作办公室" /></label>
              <label class="wide"><span>临时密码 *</span><input v-model="form.temporaryPassword" type="password" maxlength="72" autocomplete="new-password" placeholder="至少 8 位，包含字母和数字" /><small :class="{ valid: passwordValid }">首次登录必须使用此临时密码完成改密</small></label>
              <fieldset class="wide"><legend>初始管理范围 *</legend><p>只允许选择业务板块；账号、冲突、审计等全局权限不会委派。</p><div class="account-create-scopes"><button v-for="item in resources" :key="item.key" type="button" :class="{ selected: form.adminPermissions.includes(item.key) }" :aria-pressed="form.adminPermissions.includes(item.key)" @click="toggle(item.key)"><span>{{ form.adminPermissions.includes(item.key) ? '✓' : '' }}</span>{{ item.label }}</button></div></fieldset>
            </form>
          </div>
          <footer class="resource-drawer-actions"><button class="button button-ghost" type="button" :disabled="saving" @click="emit('cancel')">{{ created ? '关闭' : '取消' }}</button><button v-if="!created" class="button button-primary" type="button" :disabled="loading || saving || !formValid" @click="submit"><span v-if="saving" class="spinner small"></span><Save v-else :size="16" />{{ saving ? '创建中…' : '创建账号' }}</button></footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
