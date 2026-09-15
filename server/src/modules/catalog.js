// Pure shared catalog: the API, admin navigation and uni-app use identical keys.
export const MODULE_CATALOG = Object.freeze([
  { id:'community', name:'湖财圈', group:'内容与互动', description:'校园墙、话题、发帖、评论及焦点轮播', resources:['community-posts'], submissions:['community-comment','community-report'], pages:['community','community-comments','post-editor'], adminRoutes:['community'] },
  { id:'chat', name:'对话', group:'内容与互动', description:'私聊、群聊、聊天文件和表情包', resources:[], submissions:[], pages:['conversations','chat'], adminRoutes:['chatManagement','chatStickers'] },
  { id:'announcements', name:'公告与消息运营', group:'内容与互动', description:'管理员公告与组织公告；个人办理记录不受影响', resources:['announcements'], submissions:[], pages:['announcements','announcement-detail'], adminRoutes:['announcements'] },
  { id:'official-content', name:'官网资讯同步', group:'内容与互动', description:'学校官网资讯、详情及后台同步', resources:[], submissions:['news-favorite'], pages:['official-news','news-detail'], adminRoutes:['sync'] },
  { id:'organizations', name:'校友组织', group:'校友连接', description:'组织主页、成员、相册、留言及管理', resources:['organizations'], submissions:['organization-membership','organization-message'], pages:['chapters','chapter-detail','chapter-about','chapter-contact','chapter-members','chapter-album','chapter-messages','chapter-manager','chapter-publish'], adminRoutes:['organizations'] },
  { id:'directory', name:'校友名录', group:'校友连接', description:'校友信息名录；账号管理不受影响', resources:['directory'], submissions:[], pages:['directory'], adminRoutes:['directory'] },
  { id:'maps', name:'同城地图', group:'校友连接', description:'地图浏览、校友区域分布及后台地图维护', resources:[], submissions:[], pages:['alumni-map'], adminRoutes:['maps'] },
  { id:'activities', name:'活动', group:'校园服务', description:'活动发布、详情和报名', resources:['activities'], submissions:['event-registration'], pages:['events','event-detail'], adminRoutes:['activities'] },
  { id:'campus-visits', name:'返校预约', group:'校园服务', description:'校友返校预约与后台办理', resources:['campus-visits'], submissions:['campus-visit'], pages:['campus-visit'], adminRoutes:['campusVisits'] },
  { id:'gate', name:'返校身份核验', group:'校园服务', description:'动态核验码、保卫人员扫码及门岗管理', resources:[], submissions:[], pages:['gate'], adminRoutes:['gateManagement'] },
  { id:'services', name:'服务办理', group:'校园服务', description:'服务项目目录与服务申请；全部服务导航保留', resources:['service-catalog','service-applications'], submissions:['service-application'], pages:['service-detail','service-apply','service-progress'], adminRoutes:['serviceCatalog','serviceApplications'] },
  { id:'calendar', name:'校历', group:'校园服务', description:'学校校历与日程', resources:['academic-calendar'], submissions:[], pages:['calendar'], adminRoutes:['academicCalendar'] },
  { id:'feedback', name:'意见反馈', group:'校园服务', description:'反馈提交和后台处理', resources:['feedback'], submissions:['feedback'], pages:['feedback'], adminRoutes:['feedback'] },
  { id:'enterprises', name:'校友企业', group:'资源与发展', description:'企业认证、企业名录、企业主工作台与资料查询', resources:['alumni-enterprises'], submissions:[], pages:['enterprises','enterprise-detail','enterprise-owner'], adminRoutes:['alumniEnterprises','enterpriseLookup'] },
  { id:'jobs', name:'岗位招聘', group:'资源与发展', description:'招聘信息发布、岗位申请和收藏', resources:['jobs'], submissions:['job-application','job-favorite'], pages:['jobs','enterprise-job-editor'], adminRoutes:['jobs'] },
  { id:'collaboration', name:'合作广场', group:'资源与发展', description:'校友资源供需与合作信息', resources:['collaboration-opportunities'], submissions:[], pages:['collaboration','collaboration-detail','collaboration-editor'], adminRoutes:['collaborationOpportunities'] },
  { id:'mentors', name:'校友导师', group:'资源与发展', description:'导师名录、本人导师资料及申请', resources:['mentors'], submissions:['mentor-application'], pages:['mentors','mentor-profile'], adminRoutes:['mentors'] },
  { id:'academy', name:'校友课堂', group:'资源与发展', description:'校友课堂课程及学习内容', resources:['alumni-academy'], submissions:[], pages:['academy','academy-detail'], adminRoutes:['alumniAcademy'] },
  { id:'benefits', name:'校友权益', group:'资源与发展', description:'专属权益及领取记录', resources:['alumni-benefits'], submissions:['benefit-claim'], pages:['benefits','benefit-detail'], adminRoutes:['alumniBenefits'] },
  { id:'volunteers', name:'志愿服务', group:'公益与回馈', description:'志愿项目和服务申请', resources:['volunteers'], submissions:['volunteer-application'], pages:['volunteer'], adminRoutes:['volunteers'] },
  { id:'giving', name:'回馈母校', group:'公益与回馈', description:'公益项目、捐赠意向及捐赠证书', resources:['giving-projects'], submissions:['giving-intent'], pages:['giving','giving-certificate'], adminRoutes:['givingProjects','givingCertificates'] }
])
export const CORE_MODULES = Object.freeze([
  {id:'accounts',name:'账号与身份',description:'账号管理、个人资料、实名校验和密码管理'},
  {id:'audit',name:'系统与审计',description:'审计记录、模块管理与恢复入口'},
  {id:'infrastructure',name:'基础能力',description:'首页导航、行政区域库、敏感词保护和本人通知'}
])
export function moduleForResource(resource) { return MODULE_CATALOG.find(row=>row.resources.includes(String(resource||'')))?.id || '' }
export function moduleForSubmission(type) { return MODULE_CATALOG.find(row=>row.submissions.includes(String(type||'')))?.id || '' }
export function moduleForAdminRoute(name) { return MODULE_CATALOG.find(row=>row.adminRoutes.includes(String(name||'')))?.id || '' }
export function moduleForPage(value) {
  const raw=String(value||''),match=raw.match(/(?:^|[#/])pages\/([^/?#]+)(?:\/|$)/)
  if(!match)return ''
  return MODULE_CATALOG.find(row=>row.pages.includes(match[1]))?.id || ''
}
export function moduleEnabled(flags,id) { return !id || flags?.[id] !== false }
export function normalizeModuleFlags(value) { return Object.fromEntries(MODULE_CATALOG.map(row=>[row.id,value?.[row.id] !== false])) }

// Used before pagination or aggregation. It only changes visibility; stored
// records and membership data are never edited when a module is turned off.
export function moduleRecordEnabled(flags,resource,record,state={}) {
  const linkedResource=record.resourceType||resource
  const type=record.submissionType||record.type
  const ids=[moduleForResource(resource),moduleForResource(linkedResource),moduleForSubmission(type),moduleForSubmission(record.resourceType),moduleForPage(record.path||record.route||record.target||record.url)]
  if(String(type||'').startsWith('community.'))ids.push('community')
  if(record.organizationId)ids.push('organizations')
  if(linkedResource==='activities'||type==='event-registration'){
    const activity=(state.business?.resources?.activities||[]).find(row=>row.id===(record.resourceId||record.id))
    if(activity?.organizationId)ids.push('organizations')
  }
  return ids.every(id=>moduleEnabled(flags,id))
}
export function filterModuleRecords(state,resource,rows) {
  return (Array.isArray(rows)?rows:[]).filter(record=>moduleRecordEnabled(state.moduleSettings?.flags,resource,record,state))
}
