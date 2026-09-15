<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { BadgeCheck, CalendarClock, CheckCircle2, Fingerprint, RefreshCw, ShieldAlert, UserRoundX, X } from '@lucide/vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import PageHeader from '../components/PageHeader.vue'
import PanelState from '../components/PanelState.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { api } from '../lib/api.js'
import { formatDateTime, personTypeLabel } from '../lib/format.js'

const loading = ref(true)
const error = ref('')
const conflicts = ref([])
const selected = reactive({})
const dialogOpen = ref(false)
const activeConflict = ref(null)
const confirmation = ref('')
const saving = ref(false)
const notice = ref('')
const exactConfirmation = '确认注销多余账号'
const canConfirm = computed(() => confirmation.value === exactConfirmation && Boolean(selected[activeConflict.value?.id]))

async function load() {
  loading.value = true
  error.value = ''
  try {
    conflicts.value = await api('/admin/conflicts?status=open')
    for (const conflict of conflicts.value) if (!selected[conflict.id] && conflict.accounts?.[0]) selected[conflict.id] = conflict.accounts[0].id
  } catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}

function openResolve(conflict) {
  activeConflict.value = conflict
  confirmation.value = ''
  dialogOpen.value = true
}

async function resolveConflict() {
  if (!canConfirm.value) return
  saving.value = true
  try {
    await api(`/admin/conflicts/${activeConflict.value.id}/resolve`, {
      method: 'POST',
      body: { action: 'keep_existing', keepAccountId: selected[activeConflict.value.id], confirmation: exactConfirmation }
    })
    notice.value = '重复账号已处理：已保留选定账号并注销其他有效账号。'
    dialogOpen.value = false
    await load()
    window.setTimeout(() => { notice.value = '' }, 4200)
  } catch (cause) { error.value = cause.message; dialogOpen.value = false }
  finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="重复账号处理" description="同一学校实名身份只能保留一个有效账号；冲突处理前，该身份无法完成新用户注册。">
      <template #actions><button class="button button-secondary" type="button" :disabled="loading" @click="load"><RefreshCw :size="16" />刷新冲突</button></template>
    </PageHeader>
    <div class="policy-banner"><Fingerprint :size="24" /><div><strong>新注册唯一身份规则</strong><p>新用户注册时才跳转学校官方页面进行实名校验。发现重复账号时，需选定一个保留，其余账号注销后才能继续注册。</p></div></div>
    <div v-if="notice" class="toast" role="status"><BadgeCheck :size="18" />{{ notice }}<button type="button" aria-label="关闭" @click="notice = ''"><X :size="15" /></button></div>

    <PanelState :loading="loading" :error="error" :empty="!conflicts.length" empty-title="当前无待处理的重复账号" empty-description="已发起新注册校验的学校身份均保持唯一有效账号。" @retry="load" />

    <section v-if="!loading && !error && conflicts.length" class="conflict-list">
      <article v-for="conflict in conflicts" :key="conflict.id" class="panel conflict-card">
        <header class="conflict-header">
          <div class="conflict-title"><span><UserRoundX :size="22" /></span><div><p>学校身份冲突</p><h2>检测到 {{ conflict.accountCount }} 个有效账号</h2></div></div>
          <div class="conflict-meta"><StatusBadge tone="danger" dot>阻止新注册</StatusBadge><span><CalendarClock :size="14" />{{ formatDateTime(conflict.createdAt) }}</span></div>
        </header>
        <p class="conflict-instruction">请根据创建时间、最近登录和所属部门，选择需要保留的唯一账号。</p>
        <div class="conflict-accounts">
          <label v-for="account in conflict.accounts" :key="account.id" class="conflict-account" :class="{ selected: selected[conflict.id] === account.id }">
            <input v-model="selected[conflict.id]" type="radio" :name="`keep-${conflict.id}`" :value="account.id" />
            <span class="radio-mark"><CheckCircle2 :size="19" /></span>
            <div class="conflict-avatar">{{ account.maskedName?.slice(0, 1) || '湖' }}</div>
            <div class="conflict-account-copy"><strong>{{ account.maskedName }}</strong><span>{{ personTypeLabel(account.personType) }} · {{ account.department || '部门未同步' }}</span><small>{{ account.studentIdMasked || '学工号未返回' }}</small></div>
            <dl><div><dt>创建时间</dt><dd>{{ formatDateTime(account.createdAt) }}</dd></div><div><dt>最近校验</dt><dd>{{ formatDateTime(account.lastLoginAt) }}</dd></div></dl>
            <b>{{ selected[conflict.id] === account.id ? '将保留此账号' : '选择保留' }}</b>
          </label>
        </div>
        <footer class="conflict-footer"><p><ShieldAlert :size="16" />未选中的 {{ Math.max(0, conflict.accountCount - 1) }} 个账号将被注销，历史操作和审计记录保留。</p><button class="button button-danger" type="button" :disabled="!selected[conflict.id]" @click="openResolve(conflict)">确认保留并处理</button></footer>
      </article>
    </section>

    <ConfirmDialog :open="dialogOpen" title="确认注销多余账号" description="此操作将保留选中的唯一账号，并注销同一学校身份下其他所有有效账号。" confirm-text="注销多余账号" tone="danger" :busy="saving" :confirm-disabled="!canConfirm" @cancel="dialogOpen = false" @confirm="resolveConflict">
      <div class="confirmation-field"><label for="conflict-confirmation">请输入“{{ exactConfirmation }}”以继续</label><input id="conflict-confirmation" v-model="confirmation" autocomplete="off" :placeholder="exactConfirmation" /><small :class="{ valid: canConfirm }">{{ canConfirm ? '确认语句已匹配' : '本操作不可直接撤销，请仔细核对保留账号。' }}</small></div>
    </ConfirmDialog>
  </div>
</template>
