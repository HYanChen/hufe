export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date).replaceAll('/', '-')
}

export function personTypeLabel(value) {
  return ({ student: '学生', faculty: '教师', staff: '教职工', alumni: '校友', member: '湖财成员' })[value] || value || '未分类'
}

export function accountStatus(value) {
  return ({ active: '正常', suspended: '已暂停', deactivated: '已注销' })[value] || value || '未知'
}

export function resourceStatus(value) {
  return ({
    active: '启用中', inactive: '已停用', draft: '草稿', unpublished: '未发布',
    published: '已发布', offline: '已下架', pending: '待审核', pending_review: '待审核',
    submitted: '已提交', processing: '处理中', approved: '已通过', rejected: '已驳回',
    completed: '已完成', closed: '已关闭', cancelled: '已取消', visible: '已公开',
    hidden: '已隐藏', expired: '已过期', recruiting: '招募中', resolved: '已回复',
    verified: '导师已认证', unverified: '未绑定导师', pending: '待认证'
  })[value] || value || '未设置'
}

export function resourceStatusTone(value) {
  if (['published', 'active', 'approved', 'completed', 'visible', 'resolved', 'recruiting', 'verified'].includes(value)) return 'success'
  if (['pending', 'pending_review', 'submitted', 'processing', 'draft', 'unverified'].includes(value)) return 'warning'
  if (['rejected', 'offline', 'cancelled', 'expired'].includes(value)) return 'danger'
  return 'neutral'
}

export function submissionTypeLabel(value) {
  return ({
    'event-registration': '活动报名', 'organization-membership': '组织加入',
    'organization-message': '组织留言',
    'job-application': '岗位投递', 'mentor-application': '导师申请',
    'volunteer-application': '志愿报名', 'giving-intent': '公益意向',
    'service-application': '服务申请', 'campus-visit': '返校预约',
    feedback: '意见反馈', 'community-report': '湖财圈举报',
    'community-comment': '湖财圈评论'
  })[value] || value || '未分类'
}

const auditActionLabels = Object.freeze({
  'system.module_status_changed': '管理员启用或关闭业务模块',
  'account.dossier_updated': '管理员维护人员补充档案',
  'account.dossier_followup_added': '管理员新增人员跟进记录',
  'account.dossier_followup_status_changed': '管理员更新人员跟进状态',
  'account.dossier_student_number_viewed': '管理员按原因查看完整学工号',
  'account.dossier_record_added': '新增学校内部人员档案记录',
  'account.dossier_record_updated': '修改学校内部人员档案记录',
  'account.dossier_record_archived': '归档学校内部人员档案记录',
  'gate.staff_granted': '授予保卫负责人或保安核验权限',
  'gate.staff_revoked': '撤销保卫人员核验权限及下级授权',
  'gate.station_updated': '维护返校身份核验门岗',
  'gate.pass_issued': '生成平台返校动态身份核验码',
  'gate.pass_previewed': '保安扫码预览返校身份',
  'gate.check_confirmed': '保安确认返校核验通过或拒绝并留档',
  'account.personnel_created': '管理员新增普通人员账号',
  'account.personnel_manually_verified': '后台录入人员人工实名校验通过',
  'account.alumni_number_issued': '管理员下发校友编号',
  'account.alumni_numbers_batch_issued': '管理员批量下发校友编号',
  'account.personnel_imported': '管理员确认普通人员导入与核验方式',
  'maps.builtin_installed': '安装内置长沙地图',
  'maps.upload_started': '开始上传新底图',
  'maps.upload_cancelled': '取消地图上传并清理分片',
  'maps.basemap_uploaded': '底图上传完成且校验通过',
  'maps.basemap_published': '发布或切换前台底图',
  'maps.layer_saved': '保存地图绘制草稿',
  'maps.layer_publish': '发布地图标注图层',
  'maps.layer_unpublish': '下架地图标注图层',
  'maps.layer_delete': '删除地图标注图层',
  'account.profile_updated': '用户更新本人补充资料',
  'account.education_synced': '学校统一认证更新学籍信息',
  'account.education_supplemented': '管理员补录学籍资料',
  'regions.updated': '管理员更新行政区域库',
  'moderation.words_saved': '管理员添加或更新敏感词',
  'moderation.word_status_changed': '管理员启用或停用敏感词',
  'account.auto_registered': '实名账号自动注册',
  'account.registered': '实名账号注册完成',
  'account.account_exists': '发现已有平台账号',
  'account.login_revalidated': '历史账号身份复验',
  'account.login_succeeded': '平台账号登录成功',
  'account.local_login': '平台账号登录成功',
  'session.device_authenticated': '当前设备登录成功（保持登录）',
  'session.device_replaced': '新设备登录，其他设备已退出',
  'session.logged_out': '退出当前设备登录',
  'account.password_changed': '平台账号密码已修改',
  'account.admin_password_reset': '全局管理员修改账号密码并撤销旧登录',
  'account.identity_confirmed': '管理员人工确认身份校验通过',
  'school_auth.draft_saved': '学校实名校验配置草稿已保存',
  'school_auth.check': '学校实名校验配置已检查',
  'school_auth.activate': '学校实名校验通道配置已启用',
  'school_auth.disable': '学校实名校验通道已停用',
  'account.status_changed': '平台账号状态已调整',
  'account.self_deactivated': '用户主动注销平台账号',
  'account.admin_provisioned': '后台创建运营账号',
  'account.local_dev_admin_created': '创建本地开发管理员',
  'account.local_dev_user_created': '创建本地开发用户',
  'account.suspended_login_blocked': '已停用账号登录被拦截',
  'auth.login_succeeded': '后台登录成功',
  'auth.login_failed': '后台登录失败',
  'auth.logout': '平台账号退出登录',
  'auth.session_expired': '登录会话已过期',
  'auth.password_changed': '登录密码已修改',
  'registration.identity_verified': '新用户学校身份校验通过',
  'registration.suspended_identity_blocked': '已停用身份注册被拦截',
  'registration.account_exists': '注册时发现已有平台账号',
  'identity.duplicate_blocked': '重复账号已拦截',
  'identity.duplicate_resolved': '重复账号已处理',
  'manual_verification.created': '人工实名申请已创建',
  'manual_verification.updated': '人工实名申请已更新',
  'manual_verification.material_uploaded': '人工实名证明材料已上传',
  'manual_verification.material_removed': '人工实名证明材料已移除',
  'manual_verification.submitted': '人工实名申请已提交',
  'manual_verification.cancelled': '人工实名申请已取消',
  'manual_verification.claim': '人工实名申请已认领',
  'manual_verification.request_more': '人工实名申请要求补充材料',
  'manual_verification.approve': '人工实名申请审核通过',
  'manual_verification.reject': '人工实名申请审核驳回',
  'manual_verification.exchanged': '人工实名审核结果已兑换注册凭证',
  'manual_verification.tracking_expired_cleanup': '人工实名过期申请已清理',
  'manual_verification.expired_material_delete_failed': '人工实名过期材料清理失败',
  'business.development_seeded': '开发环境业务示例已初始化',
  'business.development_ecosystem_backfilled': '开发环境生态示例已补齐',
  'business.community_post_submitted': '湖财圈动态已提交审核',
  'business.community_post_published': '实名用户发布湖财圈动态',
  'media.community_uploaded': '用户上传校园墙图片',
  'organization_album.created': '用户新建组织相册',
  'organization_album.updated': '用户编辑组织相册',
  'organization_album.photo_uploaded': '用户上传组织照片',
  'organization_album.album_delete': '创建者删除组织相册',
  'organization_album.photo_delete': '上传者删除组织照片',
  'organization_album.album_unpublish': '管理员下架组织相册',
  'organization_album.album_publish': '管理员恢复组织相册',
  'organization_album.photo_unpublish': '管理员下架组织照片',
  'organization_album.photo_publish': '管理员恢复组织照片',
  'business.community_like_toggled': '湖财圈点赞状态已更新',
  'business.collaboration_submitted': '合作信息已提交审核',
  'business.collaboration_cancelled': '合作信息已取消',
  'business.submission_created': '业务申请已提交',
  'business.submission_cancelled': '业务申请已取消',
  'business.organization_content_published': '组织管理员已发布活动或通知',
  'business.automatic_organizations_synced': '已按实名资料关联校友组织与成员',
  'business.organization_member_removed': '管理员已将成员移出校友组织',
  'business.giving_certificate_issued': '公益捐赠到账已确认并签发证书',
  'business.giving_template_updated': '公益项目证书模板设计已更新',
  'business.mentor_self_updated': '导师本人资料已更新',
  'business.mentor_owner_verified': '导师实名所有者已认证绑定',
  'business.mentor_owner_unbound': '导师本人编辑权已撤销',
  'business.admin_created': '后台新增业务内容',
  'business.admin_updated': '后台更新业务内容',
  'business.admin_publish': '后台发布业务内容',
  'business.admin_unpublish': '后台下架业务内容',
  'business.admin_approve': '后台审核通过业务内容',
  'business.admin_reject': '后台驳回业务内容',
  'business.admin_start': '后台开始办理业务',
  'business.admin_complete': '后台完成业务办理',
  'business.admin_resolve': '后台完成问题处理',
  'business.admin_close': '后台关闭业务记录',
  'business.admin_show': '后台公开业务资料',
  'business.admin_hide': '后台隐藏业务资料',
  'admin.delegation_created': '新增后台管理授权',
  'admin.delegation_revoked': '后台管理授权已撤销',
  'admin.delegation_expired': '后台管理授权已到期',
  'admin.delegation_revoked_cascade': '下级管理授权已同步撤销',
  'admin.delegation_expired_cascade': '下级管理授权已同步到期',
  'admin.module_permissions_replaced': '账号管理板块权限已更新',
  'media.uploaded': '公开业务图片已上传',
  'media.private_uploaded': '私密证明材料已上传',
  'content.sync_started': '学校官网内容同步已开始',
  'content.synced': '学校官网内容同步完成',
  'content.sync_succeeded': '学校官网内容同步成功',
  'content.sync_failed': '学校官网内容同步失败',
  'enterprise.submitted': '校友企业认证申请已提交',
  'enterprise_lookup.configured': '企业资料查询接口配置已更新',
  'enterprise_lookup.queried': '用户查询企业登记资料以辅助填写',
  'enterprise.updated': '校友企业认证申请已更新',
  'enterprise.material_uploaded': '校友企业认证材料已上传',
  'enterprise.approved': '校友企业认证审核通过',
  'enterprise.verified': '校友企业已完成认证',
  'enterprise.rejected': '校友企业认证审核驳回',
  'business.enterprise_submitted': '校友企业认证申请已提交',
  'business.enterprise_updated': '校友企业认证申请已更新',
  'business.enterprise_approved': '校友企业认证审核通过',
  'business.enterprise_verified': '校友企业已完成认证',
  'business.enterprise_rejected': '校友企业认证审核驳回',
  'business.enterprise_certification_draft_created': '校友企业认证草稿已创建',
  'business.enterprise_certification_reopened': '校友企业认证申请已重新开启',
  'business.enterprise_certification_submitted': '校友企业认证申请已提交',
  'business.enterprise_certification_cancelled': '校友企业认证申请已取消',
  'business.enterprise_material_uploaded': '校友企业认证材料已上传',
  'business.enterprise_material_removed': '校友企业认证材料已移除',
  'business.enterprise_material_orphan_queued': '企业认证材料清理任务已登记',
  'business.enterprise_material_orphan_resolved': '企业认证材料清理任务已完成',
  'business.enterprise_owner_updated': '校友企业资料修改已提交审核',
  'business.enterprise_profile_approved': '校友企业资料修改审核通过',
  'business.enterprise_profile_rejected': '校友企业资料修改审核驳回',
  'business.enterprise_job_submitted': '企业岗位已提交审核',
  'business.enterprise_job_resubmitted': '企业岗位修改后已重新提交审核',
  'business.enterprise_job_cancelled': '企业岗位已由发布人取消',
  'business.job_submitted': '企业岗位已提交审核',
  'business.job_updated': '企业岗位信息已更新',
  'business.job_approved': '企业岗位审核通过并发布',
  'business.job_published': '企业岗位已发布',
  'business.job_rejected': '企业岗位审核驳回',
  'business.job_unpublished': '企业岗位已下架',
  'business.job_offline': '企业岗位已下架'
})

const auditDomainLabels = Object.freeze({
  account: '账号与登录',
  auth: '账号与登录',
  registration: '注册与身份',
  identity: '注册与身份',
  manual_verification: '人工实名认证',
  business: '业务运营',
  enterprise: '校友企业认证',
  job: '岗位招聘审核',
  admin: '后台权限',
  media: '文件与材料',
  content: '学校官网同步'
})

const enterpriseActionLabels = Object.freeze({
  created: '校友企业认证申请已创建',
  submitted: '校友企业认证申请已提交',
  updated: '校友企业认证申请已更新',
  material_uploaded: '校友企业认证材料已上传',
  approved: '校友企业认证审核通过',
  verified: '校友企业已完成认证',
  rejected: '校友企业认证审核驳回',
  published: '已认证校友企业已发布',
  unpublished: '校友企业已下架',
  offline: '校友企业已下架'
})

const jobActionLabels = Object.freeze({
  created: '企业岗位已创建',
  submitted: '企业岗位已提交审核',
  updated: '企业岗位信息已更新',
  approved: '企业岗位审核通过并发布',
  published: '企业岗位已发布',
  rejected: '企业岗位审核驳回',
  unpublished: '企业岗位已下架',
  offline: '企业岗位已下架'
})

const adminResourceActionLabels = Object.freeze({
  'alumni-enterprises': {
    'business.admin_created': '后台新增校友企业',
    'business.admin_updated': '后台更新校友企业资料',
    'business.admin_approve': '校友企业认证审核通过',
    'business.admin_reject': '校友企业认证审核驳回',
    'business.admin_publish': '校友企业已发布',
    'business.admin_unpublish': '校友企业已下架'
  },
  jobs: {
    'business.admin_created': '后台新增企业岗位',
    'business.admin_updated': '后台更新企业岗位',
    'business.admin_approve': '企业岗位审核通过并发布',
    'business.admin_reject': '企业岗位审核驳回',
    'business.admin_publish': '企业岗位已发布',
    'business.admin_unpublish': '企业岗位已下架'
  }
})

export function auditAction(value, details = {}) {
  const action = String(value || '').trim()
  if (!action) return '未标明的系统操作'
  if (action.startsWith('request.')) return details.label || (action === 'request.accessed' ? '查看平台服务' : '执行平台操作')
  if (details.type === 'community-comment' && action === 'business.submission_created') return '发表评论'
  if (details.type === 'community-comment' && action === 'business.submission_cancelled') return '撤回评论'
  if (details.type === 'organization-message' && action === 'business.submission_created') return '发表组织留言'
  if (action === 'business.community_like_toggled') return details.liked ? '点赞动态' : '取消动态点赞'
  if (action === 'business.organization_content_published') {
    return String(details?.resource || '') === 'activities'
      ? '组织管理员已发布活动'
      : '组织管理员已发布通知'
  }
  const contextual = adminResourceActionLabels[String(details?.resource || '')]?.[action]
  if (contextual) return contextual
  if (auditActionLabels[action]) return auditActionLabels[action]
  const enterpriseAction = action.match(/^(?:enterprise\.|business\.enterprise_)([a-z_]+)$/)?.[1]
  if (enterpriseAction && enterpriseActionLabels[enterpriseAction]) return enterpriseActionLabels[enterpriseAction]
  const jobAction = action.match(/^(?:job\.|business\.job_)([a-z_]+)$/)?.[1]
  if (jobAction && jobActionLabels[jobAction]) return jobActionLabels[jobAction]
  const domain = action.split('.')[0]
  return `${auditDomainLabels[domain] || '系统'}的其他已记录操作`
}

export function auditActionCategory(value, details = {}) {
  const action = String(value || '')
  if (action.startsWith('request.')) return action === 'request.accessed' ? '访问记录' : '操作记录'
  if (action.startsWith('business.community_') || details.type === 'community-comment' || details.resource === 'community-posts') return '湖财圈'
  if (action.startsWith('organization_album.')) return '组织相册'
  if (action.startsWith('school_auth.')) return '学校认证配置'
  if (['business.organization_content_published', 'business.automatic_organizations_synced', 'business.organization_member_removed'].includes(action)) return '校友组织运营'
  if (action === 'business.giving_certificate_issued') return '公益捐赠与证书'
  if (String(details?.resource || '') === 'jobs') return '岗位招聘审核'
  if (String(details?.resource || '') === 'alumni-enterprises') return '校友企业认证'
  if (/^business\.enterprise_job_/.test(action)) return '岗位招聘审核'
  if (/^(?:enterprise\.|business\.enterprise_)/.test(action)) return '校友企业认证'
  if (/^(?:job\.|business\.job_)/.test(action)) return '岗位招聘审核'
  const domain = action.split('.')[0]
  return auditDomainLabels[domain] || '其他系统操作'
}
