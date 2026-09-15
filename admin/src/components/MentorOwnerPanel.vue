<script setup>
import { computed, ref, watch } from 'vue'
import { BadgeCheck, Link2, Search, ShieldCheck, Unlink, UserRoundCheck } from '@lucide/vue'
import { bindMentorOwner, getMentorOwner, searchPlatformAccounts, unbindMentorOwner } from '../lib/delegation.js'

const props = defineProps({
  recordId: { type: [String, Number], default: '' },
  canManage: Boolean
})
const emit = defineEmits(['changed'])

const ownerState = ref(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const query = ref('')
const results = ref([])
const searched = ref(false)
const pendingUnbind = ref(false)

const owner = computed(() => ownerState.value?.owner || ownerState.value?.account || ownerState.value?.profileOwner || null)
const verificationStatus = computed(() => ownerState.value?.verificationStatus || ownerState.value?.profile?.verificationStatus || (owner.value ? 'verified' : 'unverified'))
const eligibleResults = computed(() => results.value.filter((account) => (
  account.status === 'active'
  && account.schoolIdentityVerified === true
  && account.id !== owner.value?.id
)))

function statusText(value) {
  return ({ verified: '导师资格已认证', pending: '待认证', rejected: '认证未通过', unverified: '未绑定实名导师' })[value] || value || '未绑定实名导师'
}

async function load() {
  ownerState.value = null
  error.value = ''
  pendingUnbind.value = false
  query.value = ''
  results.value = []
  searched.value = false
  if (!props.recordId) return
  loading.value = true
  try { ownerState.value = await getMentorOwner(props.recordId) }
  catch (cause) { error.value = cause.message || '导师实名账号加载失败' }
  finally { loading.value = false }
}

async function search() {
  const keyword = query.value.trim()
  if (keyword.length < 2) {
    error.value = '请至少输入 2 个字符搜索实名账号'
    return
  }
  busy.value = true
  searched.value = true
  error.value = ''
  try { results.value = await searchPlatformAccounts(keyword, 12) }
  catch (cause) { error.value = cause.message || '实名账号搜索失败' }
  finally { busy.value = false }
}

async function bind(account) {
  if (!props.canManage || busy.value || account.schoolIdentityVerified !== true) return
  busy.value = true
  error.value = ''
  try {
    ownerState.value = await bindMentorOwner(props.recordId, account.id)
    query.value = ''
    results.value = []
    searched.value = false
    emit('changed', ownerState.value)
  } catch (cause) { error.value = cause.message || '导师实名账号绑定失败' }
  finally { busy.value = false }
}

async function unbind() {
  if (!props.canManage || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await unbindMentorOwner(props.recordId)
    pendingUnbind.value = false
    await load()
    emit('changed', ownerState.value)
  } catch (cause) { error.value = cause.message || '撤销导师编辑权限失败' }
  finally { busy.value = false }
}

watch(() => props.recordId, load, { immediate: true })
</script>

<template>
  <section class="mentor-owner-panel" aria-labelledby="mentor-owner-title">
    <header class="record-managers-head">
      <div class="record-managers-icon"><UserRoundCheck :size="19" /></div>
      <div><h3 id="mentor-owner-title">导师实名账号与本人编辑权</h3><p>绑定学校实名账号并完成导师认证，只开放该导师自己的前台资料编辑权限。</p></div>
      <span>{{ statusText(verificationStatus) }}</span>
    </header>

    <div v-if="loading" class="record-manager-loading"><span class="spinner small"></span>正在读取导师认证信息…</div>
    <div v-else-if="error" class="record-manager-error" role="alert">{{ error }}</div>

    <article v-if="!loading && owner" class="mentor-owner-current">
      <div class="record-manager-avatar">{{ String(owner.name || owner.displayName || '导师').slice(-2) }}</div>
      <div class="record-manager-copy">
        <strong>{{ owner.name || owner.displayName || owner.username }}<BadgeCheck :size="13" /></strong>
        <span>{{ owner.department || '学院 / 部门未返回' }} · {{ owner.personType || '湖财成员' }}</span>
        <small><ShieldCheck :size="12" />学校实名账号 · 仅可编辑本导师档案</small>
      </div>
      <template v-if="canManage">
        <div v-if="pendingUnbind" class="record-manager-confirm">
          <button type="button" :disabled="busy" @click="pendingUnbind = false">取消</button>
          <button type="button" :disabled="busy" @click="unbind">确认撤销</button>
        </div>
        <button v-else class="record-manager-remove" type="button" title="撤销导师本人编辑权" :disabled="busy" @click="pendingUnbind = true"><Unlink :size="15" /></button>
      </template>
    </article>

    <div v-else-if="!loading" class="record-manager-empty">尚未绑定导师本人的学校实名账号</div>

    <template v-if="canManage">
      <form class="record-manager-search" @submit.prevent="search">
        <div><Search :size="16" /><input v-model="query" type="search" placeholder="搜索真实姓名、用户名或学院 / 部门" aria-label="搜索导师实名账号" /></div>
        <button class="button button-secondary" type="submit" :disabled="busy"><span v-if="busy" class="spinner small"></span><template v-else>搜索实名账号</template></button>
      </form>

      <div v-if="searched" class="record-manager-results">
        <p v-if="eligibleResults.length">只能选择状态正常且已通过学校实名校验的账号</p>
        <p v-else>没有找到可绑定的学校实名账号；平台运营账号和本地演示账号不能认证为导师本人。</p>
        <article v-for="account in eligibleResults" :key="account.id">
          <div><strong>{{ account.name || account.displayName || account.username }}</strong><span>{{ account.department || '学院 / 部门未填写' }} · {{ account.username }}</span></div>
          <button class="button button-primary" type="button" :disabled="busy" @click="bind(account)"><Link2 :size="14" />认证并绑定</button>
        </article>
      </div>
    </template>

    <p class="record-manager-policy">绑定即表示平台管理员已核验该用户的导师资格。该权限不包含后台登录、内容审核、人员管理或其他导师档案访问权限；解绑后前台编辑权立即失效。</p>
  </section>
</template>
