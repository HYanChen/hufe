<script setup>
import { isManualVerification } from '../../../utils/identityVerification.js'
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { BadgeCheck, ChevronLeft, ChevronRight, CirclePause, FileUser, KeyRound, Power, Search, ShieldCheck, ShieldPlus, Trash2, UserPlus, UserRoundCog, X } from '@lucide/vue'
import AccountCreateDrawer from '../components/AccountCreateDrawer.vue'
import PersonnelImportDrawer from '../components/PersonnelImportDrawer.vue'
import AccountPermissionsDialog from '../components/AccountPermissionsDialog.vue'
import AccountPasswordDialog from '../components/AccountPasswordDialog.vue'
import AccountManualVerificationDialog from '../components/AccountManualVerificationDialog.vue'
import AccountAlumniNumberDialog from '../components/AccountAlumniNumberDialog.vue'
import {canManuallyVerifyAccount} from '../lib/manualVerificationEligibility.js'
import {canIssueAlumniNumber} from '../lib/alumniNumberEligibility.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import PageHeader from '../components/PageHeader.vue'
import PanelState from '../components/PanelState.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { api, accessToken } from '../lib/api.js'
import { auth } from '../lib/auth.js'
import { accountStatus, formatDateTime, personTypeLabel } from '../lib/format.js'

const loading = ref(true)
const error = ref('')
const query = ref('')
const status = ref('')
const page = ref(1)
const pageSize = 15
const result = ref({ items: [], total: 0, page: 1, pageSize })
const dialog = ref({ open: false, account: null, status: '', title: '', description: '', confirmText: '', tone: 'danger' })
const saving = ref(false)
const notice = ref('')
const permissionDialog = ref({ open: false, account: null })
const passwordDialog = ref({ open: false, account: null })
const manualDialog = ref({ open: false, account: null })
const alumniNumberDialog = ref({ open: false, account: null, mode: 'single' })
const manualCandidates = computed(() => auth.isSuperAdmin.value ? result.value.items.filter(canManuallyVerifyAccount) : [])
const createOpen = ref(false)
const personnelOpen = ref(false)
const personnelMode = ref('manual')
const filters = reactive({ department:'', major:'', className:'', enrollmentYear:'', graduationYear:'', expectedGraduationYear:'', personType:'', verification:'' })
const filterOptions = computed(() => result.value.filterOptions || {})
let loadVersion = 0

const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / pageSize)))
const rangeText = computed(() => {
  if (!result.value.total) return '0 条记录'
  const start = (page.value - 1) * pageSize + 1
  return `${start}–${Math.min(start + pageSize - 1, result.value.total)} / ${result.value.total}`
})

function statusTone(value) {
  return ({ active: 'success', suspended: 'warning', deactivated: 'neutral' })[value] || 'neutral'
}

function isProtectedSuperAdmin(account) {
  const permissions = account?.adminPermissions || account?.permissions || []
  return account?.isSuperAdmin === true || account?.adminRole === 'super_admin' || permissions.includes?.('*')
}

async function load(resetPage = false) {
  if (resetPage) page.value = 1
  loading.value = true
  error.value = ''
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (query.value.trim()) params.set('query', query.value.trim())
  if (status.value) params.set('status', status.value)
  for (const [key,value] of Object.entries(filters)) if (value) params.set(key,value)
  const version = ++loadVersion, token = accessToken()
  try { const response = await api(`/admin/accounts?${params}`); if (version === loadVersion && token === accessToken()) result.value = response }
  catch (cause) { if (version === loadVersion && token === accessToken()) { error.value = cause.message; if ([401,403].includes(cause.status)) result.value = {items:[],total:0} } }
  finally { if (version === loadVersion && token === accessToken()) loading.value = false }
}
function departmentChanged() { filters.major=''; filters.className=''; load(true) }
function majorChanged() { filters.className=''; load(true) }
function resetFilters() { query.value=''; status.value=''; for (const key of Object.keys(filters)) filters[key]=''; load(true) }
function openPersonnel(mode) { personnelMode.value=mode; personnelOpen.value=true }
async function personnelCreated(response) { notice.value=`已新增 ${response.created} 位普通人员，首次登录须修改密码`; await load(true) }
function clearPrivateState() { loadVersion++; result.value={items:[],total:0}; personnelOpen.value=false; createOpen.value=false; permissionDialog.value={open:false,account:null}; passwordDialog.value={open:false,account:null}; manualDialog.value={open:false,account:null}; alumniNumberDialog.value={open:false,account:null,mode:'single'}; dialog.value={open:false}; loading.value=false }
window.addEventListener('hufe:auth-expired',clearPrivateState)
onBeforeUnmount(() => {loadVersion++; window.removeEventListener('hufe:auth-expired',clearPrivateState)})

function requestStatus(account, nextStatus) {
  if (isProtectedSuperAdmin(account)) {
    error.value = '全局管理员账号受保护，不能在账号列表中暂停或注销'
    return
  }
  const copy = {
    active: { title: '启用账号', description: `确认恢复“${account.name}”的平台访问权限？系统会再次校验该学校身份是否存在其他有效账号。`, confirmText: '确认启用', tone: 'primary' },
    suspended: { title: '暂停账号', description: `暂停后，“${account.name}”将无法继续使用平台，但账号记录会保留。`, confirmText: '确认暂停', tone: 'danger' },
    deactivated: { title: '注销账号', description: `确认注销“${account.name}”的账号？本操作将记入审计日志，不会删除历史记录。`, confirmText: '确认注销', tone: 'danger' }
  }[nextStatus]
  dialog.value = { open: true, account, status: nextStatus, ...copy }
}

function openPermissions(account) {
  if (isProtectedSuperAdmin(account)) {
    error.value = '全局管理员权限不能通过板块授权弹窗修改'
    return
  }
  permissionDialog.value = { open: true, account }
}
function openPassword(account) { if(!auth.isSuperAdmin.value||account?.status!=='active')return; passwordDialog.value={open:true,account:{...account}} }
async function passwordSaved(response) { passwordDialog.value={open:false,account:null}; if(response.loginRequired)return; notice.value=`已修改“${response.name}”的平台密码，旧登录已退出，本人下次登录须修改临时密码`; await load() }
async function passwordStale() { passwordDialog.value={open:false,account:null}; await load(); error.value=error.value||'账号状态、密码或权限已变化，请刷新并重新确认后操作。' }
function openManualVerification(account) { if(!auth.isSuperAdmin.value||!canManuallyVerifyAccount(account))return; manualDialog.value={open:true,account:{...account}} }
async function manualVerified(response) { manualDialog.value={open:false,account:null}; notice.value=`“${response.name}”已通过管理员人工校验；原密码、首次改密要求和后台权限均未变更`; await load() }
async function manualStale(response) { manualDialog.value={open:false,account:null}; await load(); error.value=error.value||response?.message||'账号或权限已变化，请重新核对资料。' }
function openAlumniNumber(account=null) { if(!auth.isSuperAdmin.value||account&&!canIssueAlumniNumber(account))return; alumniNumberDialog.value={open:true,account:account?{...account}:null,mode:account?'single':'batch'} }
async function alumniNumberIssued(response) { alumniNumberDialog.value={open:false,account:null,mode:'single'}; notice.value=response.batch?`${response.alreadyApplied?'该批次此前已完成，本次未重复下发。':'批量下发完成。'}共为 ${response.issuedCount} 位已实名人员下发校友编号，已有编号保留。`:`已为“${response.name}”下发校友编号：${response.alumniNo}`; await load() }
async function alumniNumberStale(response) { alumniNumberDialog.value={open:false,account:null,mode:'single'}; await load(); error.value=error.value||response?.message||'账号或预览已变化，请刷新后重新核对下发范围。' }

async function permissionsSaved() {
  const name = permissionDialog.value.account?.name || permissionDialog.value.account?.displayName || permissionDialog.value.account?.username
  permissionDialog.value.open = false
  notice.value = `已更新“${name}”的后台管理范围`
  await load()
  window.setTimeout(() => { notice.value = '' }, 3500)
}

async function accountCreated(account) {
  notice.value = `平台运营账号“${account?.displayName || account?.name || account?.username || ''}”已创建，首次登录必须修改密码`
  await load(true)
  window.setTimeout(() => { notice.value = '' }, 4500)
}

async function confirmStatus() {
  saving.value = true
  try {
    await api(`/admin/accounts/${dialog.value.account.id}/status`, { method: 'PATCH', body: { status: dialog.value.status } })
    notice.value = `账号状态已更新为“${accountStatus(dialog.value.status)}”`
    dialog.value.open = false
    await load()
    window.setTimeout(() => { notice.value = '' }, 3200)
  } catch (cause) { error.value = cause.message; dialog.value.open = false }
  finally { saving.value = false }
}

function changePage(next) {
  page.value = Math.min(totalPages.value, Math.max(1, next))
  load()
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="账号管理" description="管理实名平台用户与后台运营账号，分配板块范围；所有创建、授权和状态变更都会留痕。">
      <template #actions><template v-if="auth.isSuperAdmin.value"><button class="button button-primary" type="button" @click="openPersonnel('manual')"><UserPlus :size="17" />新增普通人员</button><button class="button button-ghost" type="button" @click="openPersonnel('xlsx')">Excel 批量导入</button><button class="button button-ghost" type="button" @click="openAlumniNumber()"><BadgeCheck :size="17" />批量下发编号</button><button class="button button-ghost" type="button" @click="createOpen = true"><ShieldPlus :size="17" />新增运营账号</button></template></template>
    </PageHeader>

    <div v-if="notice" class="toast" role="status"><BadgeCheck :size="18" />{{ notice }}<button type="button" aria-label="关闭" @click="notice = ''"><X :size="15" /></button></div>
    <section class="panel table-panel">
      <form class="toolbar" @submit.prevent="load(true)">
        <label class="search-field"><Search :size="17" /><input v-model="query" type="search" placeholder="搜索用户名、姓名、专业或完整学工号" aria-label="搜索账号" /></label>
        <label class="select-field"><span>账号状态</span><select v-model="status" @change="load(true)"><option value="">全部状态</option><option value="active">正常</option><option value="suspended">已暂停</option><option value="deactivated">已注销</option></select></label>
        <button class="button button-primary" type="submit">查询</button>
        <button class="button button-ghost" type="button" @click="resetFilters">重置</button>
      </form>
      <div class="account-filters">
        <label><span>学院 / 部门</span><select v-model="filters.department" :disabled="loading" @change="departmentChanged"><option value="">全部学院 / 部门</option><option v-for="value in filterOptions.departments||[]" :key="value" :value="value">{{ value }}</option></select></label>
        <label><span>专业</span><select v-model="filters.major" :disabled="loading||!filters.department" @change="majorChanged"><option value="">{{ filters.department?'全部专业':'请先选择学院' }}</option><option v-for="value in filterOptions.majors||[]" :key="value" :value="value">{{ value }}</option></select></label>
        <label><span>班级</span><select v-model="filters.className" :disabled="loading||!filters.major" @change="load(true)"><option value="">{{ filters.major?'全部班级':'请先选择专业' }}</option><option v-for="value in filterOptions.classes||[]" :key="value" :value="value">{{ value }}</option></select></label>
        <label><span>身份类型</span><select v-model="filters.personType" @change="load(true)"><option value="">全部身份</option><option value="student">学生</option><option value="alumni">校友</option><option value="faculty">教师</option><option value="staff">教职工</option><option value="member">普通人员</option></select></label>
        <label><span>认证状态</span><select v-model="filters.verification" @change="load(true)"><option value="">全部认证状态</option><option value="school">学校校验已通过</option><option value="manual">人工核验已通过</option><option value="unverified">未实名校验</option></select></label>
        <label><span>入学年份</span><select v-model="filters.enrollmentYear" @change="load(true)"><option value="">全部入学年份</option><option v-for="value in filterOptions.enrollmentYears||[]" :key="value" :value="value">{{ value }}年</option></select></label>
        <label><span>毕业年份</span><select v-model="filters.graduationYear" @change="load(true)"><option value="">全部毕业年份</option><option v-for="value in filterOptions.graduationYears||[]" :key="value" :value="value">{{ value }}年</option></select></label>
        <label><span>预计毕业年份</span><select v-model="filters.expectedGraduationYear" @change="load(true)"><option value="">全部预计毕业年份</option><option v-for="value in filterOptions.expectedGraduationYears||[]" :key="value" :value="value">{{ value }}年</option></select></label>
      </div>

      <PanelState :loading="loading" :error="error" :empty="!result.items.length" empty-title="未找到匹配账号" empty-description="请调整关键词或账号状态后重试。" @retry="load" />
      <section v-if="!loading&&!error&&manualCandidates.length" class="manual-mobile-shortcuts" aria-label="本页待人工校验人员"><h3>本页待人工校验人员</h3><div v-for="account in manualCandidates" :key="account.id"><span>{{ account.name||account.username }}<small>{{ account.username }}</small></span><button class="button button-ghost" type="button" @click="openManualVerification(account)">人工校验</button></div></section>
      <div v-if="!loading && !error && result.items.length" class="table-scroll">
        <table>
          <thead><tr><th>平台账号</th><th>身份类型</th><th>学籍资料</th><th>认证状态</th><th>账号状态</th><th>最近登录</th><th class="align-right">操作</th></tr></thead>
          <tbody>
            <tr v-for="account in result.items" :key="account.id">
              <td><div class="identity-cell"><span>{{ (account.name || account.displayName)?.slice(0, 1) || '湖' }}</span><p><strong>{{ account.name || account.displayName || account.username }}</strong><small>用户名：{{ account.username }}</small><small>{{ account.department || '部门未填写' }}<template v-if="account.studentIdMasked"> · {{ account.studentIdMasked }}</template></small><small v-if="account.developmentSchoolIdentityFixture" class="account-source-label">本机开发 · 模拟学校实名</small><small v-else-if="account.accountSource === 'admin_personnel'" class="account-source-label">后台录入 · 普通人员</small><small v-else-if="account.accountSource === 'platform_member'" class="account-source-label">正式平台账号</small><small v-else-if="['admin_created','admin_provisioned'].includes(account.source) || ['admin_created','admin_provisioned'].includes(account.accountSource)" class="account-source-label">后台创建 · 平台运营账号</small><small class="account-alumni-number">校友编号：{{ account.alumniNo||'未下发' }}</small><button v-if="auth.isSuperAdmin.value&&canIssueAlumniNumber(account)" class="table-action action-positive alumni-number-inline-action" type="button" @click="openAlumniNumber(account)"><BadgeCheck :size="14" />下发编号</button></p></div></td>
              <td><span class="person-pill">{{ personTypeLabel(account.personType) }}</span></td>
              <td class="account-education"><span>{{ account.major||'专业未提供' }}</span><small>{{ account.className||'班级未提供' }}</small><small v-if="account.enrollmentYear">{{ account.enrollmentYear }}年入学</small><small v-if="account.graduationYear">{{ account.graduationYear }}年毕业</small><small v-else-if="account.expectedGraduationYear">预计{{ account.expectedGraduationYear }}年毕业</small></td>
              <td><div v-if="account.schoolIdentityVerified" class="verify-stack"><span><ShieldCheck :size="14" />{{ isManualVerification(account) ? '人工校验已通过' : '学校实名已验证' }}</span><small v-if="['platform-admin-confirmed','admin-personnel-review'].includes(account.verificationSource)">管理员人工确认</small><small v-if="account.alumniStatusVerified"><BadgeCheck :size="12" />校友身份已确认</small></div><div v-else-if="account.developmentSchoolIdentityFixture" class="verify-stack"><span><ShieldCheck :size="14" />学校实名已完成（开发演示）</span><small>正式环境仍须学校认证回调确认</small></div><div v-else-if="account.accountSource==='admin_personnel'" class="verify-stack"><span>待实名校验</span><small>后台录入普通人员</small><button v-if="auth.isSuperAdmin.value&&canManuallyVerifyAccount(account)" class="table-action action-positive manual-inline-action" type="button" @click="openManualVerification(account)"><ShieldCheck :size="14" />人工校验</button></div><div v-else class="verify-stack operations-account-status"><span><ShieldPlus :size="14" />平台运营账号</span><small>不等同学校实名账号</small></div><small v-if="account.mustChangePassword" class="date-secondary">首次登录待改密</small></td>
              <td><StatusBadge :tone="statusTone(account.status)" dot>{{ accountStatus(account.status) }}</StatusBadge></td>
              <td><span class="date-primary">{{ formatDateTime(account.lastLoginAt) }}</span><small class="date-secondary">更新 {{ formatDateTime(account.updatedAt) }}</small></td>
              <td class="align-right">
                <RouterLink v-if="auth.isSuperAdmin.value" class="table-action dossier-row-link" :to="{name:'accountDossier',params:{id:account.id}}"><FileUser :size="14"/>查看人员信息</RouterLink>
                <button v-if="auth.isSuperAdmin.value&&account.status==='active'" class="table-action" type="button" @click="openPassword(account)"><KeyRound :size="14" />修改密码</button>
                <span v-if="account.id === auth.state.user?.id" class="current-admin">当前管理员</span>
                <span v-else-if="isProtectedSuperAdmin(account)" class="current-admin">全局管理员 · 受保护</span>
                <div v-else class="row-actions">
                  <button class="table-action action-positive" type="button" @click="openPermissions(account)"><ShieldPlus :size="14" />授权板块</button>
                  <button v-if="account.status !== 'active'" class="table-action action-positive" type="button" @click="requestStatus(account, 'active')"><Power :size="14" />启用</button>
                  <button v-if="account.status === 'active'" class="table-action" type="button" @click="requestStatus(account, 'suspended')"><CirclePause :size="14" />暂停</button>
                  <button v-if="account.status !== 'deactivated'" class="table-action action-danger" type="button" @click="requestStatus(account, 'deactivated')"><Trash2 :size="14" />注销</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="!loading && !error && result.total" class="table-footer">
        <span>共 {{ result.total }} 个平台账号，当前显示 {{ rangeText }}</span>
        <div class="pagination"><button type="button" :disabled="page <= 1" aria-label="上一页" @click="changePage(page - 1)"><ChevronLeft :size="17" /></button><strong>{{ page }} / {{ totalPages }}</strong><button type="button" :disabled="page >= totalPages" aria-label="下一页" @click="changePage(page + 1)"><ChevronRight :size="17" /></button></div>
      </footer>
    </section>

    <ConfirmDialog :open="dialog.open" :title="dialog.title" :description="dialog.description" :confirm-text="dialog.confirmText" :tone="dialog.tone" :busy="saving" @cancel="dialog.open = false" @confirm="confirmStatus">
      <div class="dialog-account"><UserRoundCog :size="18" /><span>{{ dialog.account?.name }} · {{ dialog.account?.department || '部门未同步' }}</span></div>
    </ConfirmDialog>
    <AccountPermissionsDialog :open="permissionDialog.open" :account="permissionDialog.account" @cancel="permissionDialog.open = false" @saved="permissionsSaved" />
    <AccountPasswordDialog :open="passwordDialog.open" :account="passwordDialog.account" @cancel="passwordDialog={open:false,account:null}" @saved="passwordSaved" @stale="passwordStale" />
    <AccountManualVerificationDialog :open="manualDialog.open" :account="manualDialog.account" @cancel="manualDialog={open:false,account:null}" @verified="manualVerified" @stale="manualStale" />
    <AccountAlumniNumberDialog :open="alumniNumberDialog.open" :mode="alumniNumberDialog.mode" :account="alumniNumberDialog.account" @cancel="alumniNumberDialog={open:false,account:null,mode:'single'}" @issued="alumniNumberIssued" @stale="alumniNumberStale" />
    <AccountCreateDrawer :open="createOpen" @cancel="createOpen = false" @created="accountCreated" />
    <PersonnelImportDrawer :open="personnelOpen" :mode="personnelMode" @cancel="personnelOpen=false" @created="personnelCreated" />
  </div>
</template>

<style scoped>
.account-alumni-number{overflow-wrap:anywhere}.alumni-number-inline-action{margin-top:6px}
.manual-inline-action{margin-top:6px}.manual-mobile-shortcuts{display:none;padding:16px;border-top:1px solid #e2e8f0}.manual-mobile-shortcuts h3{font-size:14px;margin:0 0 12px;color:#334155}.manual-mobile-shortcuts>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px}.manual-mobile-shortcuts span{min-width:0;overflow-wrap:anywhere}.manual-mobile-shortcuts small{display:block;color:#64748b;font-size:12px;margin-top:5px}@media(max-width:700px){.manual-mobile-shortcuts{display:block}}
.account-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:0 20px 20px}.account-filters label{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;color:#64748b}.account-filters select{width:100%;min-width:0;border:1px solid #dbe2ea;border-radius:8px;padding:9px;background:#fff;color:#334155;text-overflow:ellipsis}.account-filters select:disabled{background:#f7f8fa;color:#94a3b8}.account-education{min-width:155px;max-width:250px;overflow-wrap:anywhere}.account-education small{display:block;color:#64748b;font-size:12px;margin-top:5px}@media(max-width:1000px){.account-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:550px){.account-filters{grid-template-columns:1fr;padding:0 12px 16px}}
</style>
