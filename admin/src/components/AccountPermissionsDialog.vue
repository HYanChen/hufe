<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BadgeCheck, ShieldCheck, X } from '@lucide/vue'
import { getAccountPermissions, getDelegationResources, updateAccountPermissions } from '../lib/delegation.js'
import { useOverlayScrollLock } from '../lib/overlayScrollLock.js'

const props = defineProps({ open: Boolean, account: { type: Object, default: null } })
const emit = defineEmits(['cancel', 'saved'])
const resources = ref([])
const selected = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const dialogElement = ref(null)
let previousFocus = null

const groups = computed(() => {
  const result = new Map()
  for (const item of resources.value) {
    const key = item.group || '业务板块'
    if (!result.has(key)) result.set(key, [])
    result.get(key).push(item)
  }
  return [...result.entries()].map(([label, items]) => ({ label, items }))
})

function toggle(key) {
  selected.value = selected.value.includes(key)
    ? selected.value.filter((item) => item !== key)
    : [...selected.value, key]
}

async function load() {
  if (!props.open || !props.account?.id) return
  loading.value = true
  error.value = ''
  try {
    const [catalog, current] = await Promise.all([getDelegationResources(), getAccountPermissions(props.account.id)])
    resources.value = catalog
    selected.value = current.permissions || []
  } catch (cause) { error.value = cause.message || '管理范围加载失败' }
  finally { loading.value = false }
}

async function save() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const result = await updateAccountPermissions(props.account.id, selected.value)
    emit('saved', result)
  } catch (cause) { error.value = cause.message || '管理范围保存失败' }
  finally { saving.value = false }
}

function onKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape' && !saving.value) {
    emit('cancel')
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...(dialogElement.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || [])]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

watch(() => [props.open, props.account?.id], load, { immediate: true })
watch(() => props.open, async (open) => {
  if (open) {
    previousFocus = document.activeElement
    await nextTick()
    dialogElement.value?.querySelector('button:not(:disabled)')?.focus()
  } else if (previousFocus?.focus) previousFocus.focus()
})
useOverlayScrollLock(() => props.open)
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="open" class="dialog-backdrop" @click.self="!saving && emit('cancel')">
        <section ref="dialogElement" class="delegation-dialog" role="dialog" aria-modal="true" aria-labelledby="delegation-title">
          <header><div class="delegation-dialog-icon"><ShieldCheck :size="22" /></div><div><p>DELEGATED ADMIN</p><h2 id="delegation-title">设置板块管理范围</h2></div><button class="icon-button" type="button" :disabled="saving" aria-label="关闭" @click="emit('cancel')"><X :size="19" /></button></header>
          <div class="delegation-account"><span>{{ account?.name?.slice(0,1) || account?.displayName?.slice(0,1) || '湖' }}</span><div><strong>{{ account?.name || account?.displayName || account?.username }}</strong><small>{{ account?.department || '部门未填写' }} · {{ account?.username }}</small></div></div>
          <div class="delegation-policy"><BadgeCheck :size="16" /><p><strong>仅授予所选业务板块</strong><span>委派管理员登录后只显示已授权菜单；数据范围和每次操作仍由服务端校验。</span></p></div>
          <div v-if="error" class="alert alert-error delegation-error" role="alert">{{ error }}</div>
          <div v-if="loading" class="delegation-loading"><span class="spinner"></span><p>正在读取当前权限…</p></div>
          <div v-else class="delegation-groups">
            <section v-for="group in groups" :key="group.label"><h3>{{ group.label }}</h3><div>
              <button v-for="item in group.items" :key="item.key" class="delegation-option" :class="{ selected: selected.includes(item.key) }" type="button" :aria-pressed="selected.includes(item.key)" @click="toggle(item.key)"><span>{{ selected.includes(item.key) ? '✓' : '' }}</span><strong>{{ item.label }}</strong><small>{{ item.key }}</small></button>
            </div></section>
            <p v-if="!resources.length" class="delegation-empty">服务端暂未返回可授权板块。</p>
          </div>
          <footer><p>{{ selected.length ? `已选择 ${selected.length} 个板块` : '未选择板块：保存后将移除后台管理权限' }}</p><button class="button button-ghost" type="button" :disabled="saving" @click="emit('cancel')">取消</button><button class="button button-primary" type="button" :disabled="loading || saving" @click="save"><span v-if="saving" class="spinner small"></span>{{ saving ? '保存中…' : '保存管理范围' }}</button></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
