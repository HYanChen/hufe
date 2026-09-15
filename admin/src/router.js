import { createRouter, createWebHashHistory } from 'vue-router'
import { auth } from './lib/auth.js'
import {isAdminRouteEnabled,refreshModuleConfig} from './lib/modules.js'

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/change-password', name: 'changePassword', component: () => import('./views/ChangePasswordView.vue'), meta: { title: '首次登录修改密码', passwordChange: true } },
  {
    path: '/',
    component: () => import('./layouts/AdminLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: '运营总览' } },
      { path: 'accounts', name: 'accounts', component: () => import('./views/AccountsView.vue'), meta: { title: '账号管理', superOnly: true } },
      { path: 'accounts/:id/dossier', name: 'accountDossier', component: () => import('./views/AccountDossierView.vue'), meta: { title: '人员档案', superOnly: true, nav: 'accounts' } },
      { path: 'modules', name: 'modules', component: () => import('./views/ModulesView.vue'), meta: { title: '模块管理', superOnly: true, moduleCore: true } },
      { path: 'school-auth-config', name: 'schoolAuthConfig', component: () => import('./views/SchoolAuthConfigView.vue'), meta: { title: '学校实名校验配置', superOnly: true } },
      { path: 'manual-verifications', name: 'manualVerifications', component: () => import('./views/ManualVerificationsView.vue'), meta: { title: '人工认证审核', superOnly: true } },
      { path: 'conflicts', name: 'conflicts', component: () => import('./views/ConflictsView.vue'), meta: { title: '重复账号处理', superOnly: true } },
      { path: 'applications', name: 'applications', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '申请与报名中心', resourceKey: 'applications', permission: 'applications' } },
      { path: 'giving-certificates', name: 'givingCertificates', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '公益捐赠与证书', resourceKey: 'givingCertificates', permission: 'applications' } },
      { path: 'community', name: 'community', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '湖财圈内容管理', resourceKey: 'community', permission: 'community-posts' } },
      { path: 'announcements', name: 'announcements', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '公告与消息运营', resourceKey: 'announcements', permission: 'announcements' } },
      { path: 'academic-calendar', name: 'academicCalendar', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '校历管理', resourceKey: 'academicCalendar', permission: 'academic-calendar' } },
      { path: 'service-catalog', name: 'serviceCatalog', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '服务目录管理', resourceKey: 'serviceCatalog', permission: 'service-catalog' } },
      { path: 'service-applications', name: 'serviceApplications', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '服务申请管理', resourceKey: 'serviceApplications', permission: 'service-applications' } },
      { path: 'activities', name: 'activities', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '活动管理', resourceKey: 'activities', permission: 'activities' } },
      { path: 'campus-visits', name: 'campusVisits', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '返校与进校预约', resourceKey: 'campusVisits', permission: 'campus-visits' } },
      { path: 'alumni-enterprises', name: 'alumniEnterprises', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '校友企业认证与名录', resourceKey: 'alumniEnterprises', permission: 'alumni-enterprises' } },
      { path: 'enterprise-lookup', name: 'enterpriseLookup', component: () => import('./views/EnterpriseLookupView.vue'), meta: { title: '企业资料自动补全', superOnly: true } },
      { path: 'collaboration-opportunities', name: 'collaborationOpportunities', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '合作广场管理', resourceKey: 'collaborationOpportunities', permission: 'collaboration-opportunities' } },
      { path: 'alumni-academy', name: 'alumniAcademy', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '校友课堂管理', resourceKey: 'alumniAcademy', permission: 'alumni-academy' } },
      { path: 'alumni-benefits', name: 'alumniBenefits', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '校友权益中心', resourceKey: 'alumniBenefits', permission: 'alumni-benefits' } },
      { path: 'organizations', name: 'organizations', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '校友组织管理', resourceKey: 'organizations', permission: 'organizations' } },
      { path: 'directory', name: 'directory', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '校友名录管理', resourceKey: 'directory', permission: 'directory' } },
      { path: 'jobs', name: 'jobs', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '企业岗位审核与招聘', resourceKey: 'jobs', permission: 'jobs' } },
      { path: 'mentors', name: 'mentors', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '校友导师管理', resourceKey: 'mentors', permission: 'mentors' } },
      { path: 'volunteers', name: 'volunteers', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '志愿者与项目管理', resourceKey: 'volunteers', permission: 'volunteers' } },
      { path: 'giving-projects', name: 'givingProjects', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '回馈母校与公益项目', resourceKey: 'givingProjects', permission: 'giving-projects' } },
      { path: 'feedback', name: 'feedback', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '意见与反馈管理', resourceKey: 'feedback', permission: 'feedback' } },
      { path: 'home-config', name: 'homeConfig', component: () => import('./views/ResourceManagementView.vue'), meta: { title: '首页运营配置', resourceKey: 'homeConfig', permission: 'home-config' } },
      { path: 'sync', name: 'sync', component: () => import('./views/SyncView.vue'), meta: { title: '官网同步', superOnly: true } },
      { path: 'audit', name: 'audit', component: () => import('./views/AuditView.vue'), meta: { title: '审计日志', superOnly: true } },
      { path: 'gate-management', name: 'gateManagement', component: () => import('./views/GateManagementView.vue'), meta: { title: '返校身份核验', superOnly: true } },
      { path: 'chat-management', name: 'chatManagement', component: () => import('./views/ChatManagementView.vue'), meta: { title: '对话管理', superOnly: true } },
      { path: 'chat-stickers', name: 'chatStickers', component: () => import('./views/ChatStickersView.vue'), meta: { title: '聊天表情包', superOnly: true } },
      { path: 'sensitive-words', name: 'sensitiveWords', component: () => import('./views/SensitiveWordsView.vue'), meta: { title: '敏感词库', superOnly: true } },
      { path: 'regions', name: 'regions', component: () => import('./views/RegionsView.vue'), meta: { title: '行政区域库', superOnly: true } },
      { path: 'maps', name: 'maps', component: () => import('./views/MapsView.vue'), meta: { title: '本地地图管理', superOnly: true } },
      { path: 'forbidden', name: 'forbidden', component: () => import('./views/ForbiddenView.vue'), meta: { title: '无权访问' } }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach(async (to) => {
  await auth.bootstrap()
  if (to.meta.public) {
    if (to.name === 'login' && auth.isAdmin.value) return { name: auth.state.user?.mustChangePassword ? 'changePassword' : auth.firstAccessibleRoute() }
    return true
  }
  if (!auth.isAdmin.value) return { name: 'login', query: { redirect: to.fullPath } }
  if (auth.state.user?.mustChangePassword && to.name !== 'changePassword') return { name: 'changePassword' }
  if (!auth.state.user?.mustChangePassword && to.name === 'changePassword') return { name: auth.firstAccessibleRoute() }
  if (to.meta.superOnly && !auth.isSuperAdmin.value) return { name: 'forbidden', query: { target: to.meta.title } }
  if (to.meta.permission && !auth.canAccess(to.meta.permission)) return { name: 'forbidden', query: { target: to.meta.title } }
  await refreshModuleConfig()
  if (!isAdminRouteEnabled(to.meta.nav || to.name)) return { name: 'forbidden', query: { target: to.meta.title } }
  return true
})

router.afterEach((to) => {
  document.title = `${to.meta.title || '管理员登录'}｜湖财人管理后台`
})

export default router
