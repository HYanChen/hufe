<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BookOpenCheck, BriefcaseBusiness, Building2, CalendarDays, ChevronRight, ClipboardList,
  ContactRound, ExternalLink, GalleryHorizontalEnd, GraduationCap, Handshake, HeartHandshake,
  Gift, LayoutDashboard, LibraryBig, ListTree, LogOut, Menu, MessageSquareText,
  MessagesSquare, Network, RefreshCw, School, ScrollText, ShieldCheck, UserRoundX, Users, X, MapPin
} from '@lucide/vue'
import { api } from '../lib/api.js'
import { auth } from '../lib/auth.js'
import {isAdminRouteEnabled,refreshModuleConfig} from '../lib/modules.js'
import { schoolBrand } from '../../../server/src/brand.js'

const route = useRoute()
const router = useRouter()
const mobileOpen = ref(false)
const loggingOut = ref(false)
const imageProgress = ref(null)
const onImageProgress = event => { imageProgress.value = event.detail }
const brand = ref({
  name: '湖南财政经济学院', appName: '湖财人', motto: '正德厚生 经世济用',
  ...schoolBrand
})

const navigation = [
  { label: '工作台', items: [{ name: 'dashboard', label: '运营总览', icon: LayoutDashboard }] },
  { label: '用户与身份', items: [
    { name: 'accounts', label: '账号管理', icon: Users },
    { name: 'schoolAuthConfig', label: '学校实名校验配置', icon: ShieldCheck },
    { name: 'manualVerifications', label: '人工认证审核', icon: ShieldCheck },
    { name: 'conflicts', label: '重复账号', icon: UserRoundX }
  ] },
  { label: '内容与运营', items: [
    { name: 'community', label: '湖财圈管理', icon: MessagesSquare },
    { name: 'chatManagement', label: '对话管理', icon: MessagesSquare },
    { name: 'chatStickers', label: '聊天表情包', icon: GalleryHorizontalEnd },
    { name: 'sensitiveWords', label: '敏感词库', icon: ShieldCheck },
    { name: 'regions', label: '行政区域库', icon: MapPin },
    { name: 'maps', label: '本地地图管理', icon: MapPin },
    { name: 'announcements', label: '公告与消息', icon: MessageSquareText },
    { name: 'academicCalendar', label: '校历管理', icon: CalendarDays },
    { name: 'activities', label: '活动管理', icon: CalendarDays },
    { name: 'homeConfig', label: '首页运营', icon: GalleryHorizontalEnd },
    { name: 'sync', label: '官网同步', icon: RefreshCw }
  ] },
  { label: '服务与办理', items: [
    { name: 'applications', label: '申请与报名', icon: ClipboardList },
    { name: 'givingCertificates', label: '公益捐赠与证书', icon: Gift },
    { name: 'serviceCatalog', label: '服务目录', icon: ListTree },
    { name: 'serviceApplications', label: '服务申请', icon: ClipboardList },
    { name: 'campusVisits', label: '返校预约', icon: School },
    { name: 'gateManagement', label: '返校身份核验', icon: ShieldCheck },
    { name: 'feedback', label: '意见反馈', icon: MessageSquareText }
  ] },
  { label: '生态运营', items: [
    { name: 'alumniEnterprises', label: '企业认证与名录', icon: Building2 },
    { name: 'enterpriseLookup', label: '企业资料自动补全', icon: Building2 },
    { name: 'collaborationOpportunities', label: '合作广场', icon: Handshake },
    { name: 'alumniAcademy', label: '校友课堂', icon: LibraryBig },
    { name: 'alumniBenefits', label: '校友权益', icon: Gift }
  ] },
  { label: '校友连接', items: [
    { name: 'organizations', label: '校友组织', icon: Network },
    { name: 'directory', label: '校友名录', icon: ContactRound },
    { name: 'jobs', label: '岗位招聘审核', icon: BriefcaseBusiness },
    { name: 'mentors', label: '校友导师', icon: GraduationCap },
    { name: 'volunteers', label: '志愿者', icon: HeartHandshake },
    { name: 'givingProjects', label: '回馈母校', icon: Gift }
  ] },
  { label: '系统与审计', items: [{ name: 'modules', label: '模块管理', icon: ListTree }, { name: 'audit', label: '审计日志', icon: ScrollText }] }
]

const currentTitle = computed(() => route.meta.title || '管理后台')
const userInitial = computed(() => (auth.state.user?.name || auth.state.user?.displayName || auth.state.user?.username)?.slice(0, 1) || '湖')
const visibleNavigation = computed(() => navigation.map((section) => ({
  ...section,
  items: section.items.filter((item) => {
    if (!isAdminRouteEnabled(item.name)) return false
    const meta = router.resolve({ name: item.name }).meta
    if (meta.superOnly) return auth.isSuperAdmin.value
    return !meta.permission || auth.canAccess(meta.permission)
  })
})).filter((section) => section.items.length))
const roleLabel = computed(() => auth.isSuperAdmin.value ? '全局管理员' : '委派管理员')

async function logout() {
  loggingOut.value = true
  try { await auth.logout() } finally {
    loggingOut.value = false
    router.replace({ name: 'login' })
  }
}

function closeMobile() { mobileOpen.value = false }
function onExpired(event) { router.replace({ name: 'login', query: { reason: event.detail?.code === 'SESSION_REPLACED' ? 'replaced' : 'expired' } }) }
function refreshModules() { refreshModuleConfig({force:true}) }

onMounted(async () => {
  window.addEventListener('hufe:auth-expired', onExpired)
  window.addEventListener('hufe:image-progress', onImageProgress)
  window.addEventListener('focus',refreshModules)
  refreshModuleConfig()
  try { brand.value = { ...brand.value, ...await api('/brand', { token: '' }), ...schoolBrand } } catch { /* 本地正式品牌图稿不依赖官网网络或旧服务端品牌缓存 */ }
})
onBeforeUnmount(() => {window.removeEventListener('hufe:auth-expired', onExpired);window.removeEventListener('hufe:image-progress', onImageProgress);window.removeEventListener('focus',refreshModules)})
</script>

<template>
  <div class="admin-shell">
    <div v-if="imageProgress" role="status" style="position:fixed;right:24px;bottom:24px;z-index:9999;background:#083b80;color:white;padding:16px 24px;border-radius:12px;max-width:80vw;overflow-wrap:anywhere">图片上传 {{ imageProgress.percent }}% · {{ imageProgress.name }}</div>
    <button v-if="mobileOpen" class="mobile-scrim" type="button" aria-label="关闭导航" @click="closeMobile"></button>
    <aside class="sidebar" :class="{ 'sidebar-open': mobileOpen }">
      <div class="sidebar-brand">
        <a class="brand-logo" :href="brand.homepage" target="_blank" rel="noopener noreferrer" aria-label="访问湖南财政经济学院官网">
          <img :src="brand.logoUrl" :alt="brand.name" />
        </a>
        <button class="icon-button sidebar-close" type="button" aria-label="关闭导航" @click="closeMobile"><X :size="20" /></button>
        <div class="admin-brand-copy">
          <span class="admin-brand-name">{{ brand.appName }}管理后台</span>
          <span>Unified Service Console</span>
        </div>
      </div>

      <nav class="sidebar-nav" aria-label="后台主导航">
        <section v-for="section in visibleNavigation" :key="section.label" class="nav-section">
          <p class="nav-label">{{ section.label }}</p>
          <RouterLink v-for="item in section.items" :key="item.name" :to="{ name: item.name }" class="nav-link" :class="{'router-link-active':route.meta.nav===item.name}" @click="closeMobile">
            <component :is="item.icon" :size="18" aria-hidden="true" />
            <span>{{ item.label }}</span>
            <ChevronRight :size="14" class="nav-chevron" aria-hidden="true" />
          </RouterLink>
        </section>
      </nav>

      <div class="sidebar-policy">
        <BookOpenCheck :size="20" />
        <div><strong>学校实名数据</strong><span>仅用于授权的身份校验与平台运营</span></div>
      </div>
      <p class="sidebar-motto">{{ brand.motto }}</p>
    </aside>

    <div class="admin-main">
      <header class="topbar">
        <div class="topbar-left">
          <button class="icon-button menu-button" type="button" aria-label="打开导航" @click="mobileOpen = true"><Menu :size="21" /></button>
          <div><span class="topbar-kicker">{{ brand.name }}</span><strong>{{ currentTitle }}</strong></div>
        </div>
        <div class="topbar-right">
          <a class="official-link" :href="brand.homepage" target="_blank" rel="noopener noreferrer"><ExternalLink :size="16" />学校官网</a>
          <div class="topbar-divider"></div>
          <div class="admin-avatar" aria-hidden="true">{{ userInitial }}</div>
          <div class="admin-user-copy">
            <strong>{{ auth.state.user?.name || auth.state.user?.displayName || auth.state.user?.username || '管理员' }}</strong>
            <span><ShieldCheck :size="13" />{{ roleLabel }}·权限已校验</span>
          </div>
          <button class="icon-button logout-button" type="button" :disabled="loggingOut" aria-label="退出登录" title="退出登录" @click="logout"><LogOut :size="18" /></button>
        </div>
      </header>

      <main class="content-area">
        <RouterView />
      </main>
      <footer class="admin-footer">
        <span>© {{ new Date().getFullYear() }} {{ brand.name }}</span>
        <span>开发团队：长沙宸古科技有限责任公司</span>
        <span>湖财人平台账号·操作全程留痕</span>
      </footer>
    </div>
  </div>
</template>
