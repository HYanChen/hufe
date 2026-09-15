import { organizationTypes } from '../../../server/src/business/organization-categories.js'

const publishActions = [
  { key: 'publish', label: '发布', icon: 'publish', statuses: ['draft', 'offline', 'unpublished'], confirm: '发布后将在对应客户端公开展示。' },
  { key: 'unpublish', label: '下架', icon: 'unpublish', statuses: ['published', 'active'], tone: 'danger', confirm: '下架后客户端将不再展示该内容。' }
]

const reviewActions = [
  { key: 'approve', label: '通过', icon: 'approve', statuses: ['pending', 'pending_review', 'submitted'], confirm: '确认审核通过该记录？' },
  { key: 'reject', label: '驳回', icon: 'reject', statuses: ['pending', 'pending_review', 'submitted'], tone: 'danger', requiresReason: true, confirm: '驳回后将向申请人展示审核意见。' }
]
const speechSubmissionTypes = ['organization-message', 'community-comment']
const speechUnpublishAction = { key: 'unpublish', label: '下架', icon: 'unpublish', statuses: ['published', 'approved', 'completed'], tone: 'danger', requiresReason: true, includeExpectedRevision: true, confirm: '下架后前台不再展示，并将下架原因通知作者。' }

const statusFilter = (...values) => ({
  key: 'status', label: '状态', options: values.map(([value, label]) => ({ value, label }))
})

const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra })
const column = (key, label, extra = {}) => ({ key, label, ...extra })
const carouselOptions = [{ value: 'none', label: '不置顶' }, { value: 'pinned', label: '校园墙置顶' }]
const carouselField = () => field('carouselPlacement', '校园墙轮播', 'select', { default: 'none', options: carouselOptions })
const publicationOptions = [{ value: 'anonymous', label: '匿名展示（后台实名可查）' }, { value: 'named', label: '实名展示' }]
const anonymityFields = () => [field('publicationMode', '前台发布方式', 'readonly', { options: publicationOptions, hideOnCreate: true }), field('anonymousNickname', '前台匿名昵称', 'readonly', { hideOnCreate: true }), field('authorUsername', '真实平台用户名', 'readonly', { hideOnCreate: true }), field('authorAccountId', '真实账号编号', 'readonly', { hideOnCreate: true })]

const academicTermOptions = [
  { value: 'first', label: '第一学期' },
  { value: 'second', label: '第二学期' },
  { value: 'summer', label: '暑期学期' }
]

const academicCalendarCategoryOptions = [
  { value: 'term', label: '学期安排' },
  { value: 'registration', label: '报到注册' },
  { value: 'teaching', label: '教学安排' },
  { value: 'exam', label: '考试安排' },
  { value: 'holiday', label: '假期与节假日' },
  { value: 'activity', label: '校园活动' },
  { value: 'other', label: '其他' }
]

const academicCalendarPriorityOptions = [
  { value: 'important', label: '重要' },
  { value: 'normal', label: '普通' }
]

const academicCalendarAudienceOptions = [
  { value: 'all', label: '全部用户' },
  { value: 'student', label: '学生' },
  { value: 'faculty', label: '教师' },
  { value: 'staff', label: '教职工' },
  { value: 'faculty_staff', label: '教师及教职工' },
  { value: 'campus', label: '在校师生及教职工' },
  { value: 'alumni', label: '校友' },
  { value: 'member', label: '其他学校实名成员' }
]

const enterpriseVerificationOptions = [
  { value: 'unverified', label: '未认证' },
  { value: 'pending', label: '认证待审核' },
  { value: 'verified', label: '已认证' },
  { value: 'rejected', label: '认证未通过' }
]

const personTypeOptions = [
  { value: 'student', label: '学生' },
  { value: 'faculty', label: '教师' },
  { value: 'staff', label: '教职工' },
  { value: 'alumni', label: '校友' },
  { value: 'member', label: '其他学校实名成员' }
]

export const resourceDefinitions = {
  applications: {
    key: 'applications', resource: 'applications', title: '申请与报名中心', noun: '业务申请',
    hiddenDetailKeys: ['submitterName', 'volunteerName', 'bookingNo', 'feedbackNo'],
    description: '管理各类业务申请及实名评论、组织留言。实名发言直接发布，管理员可回复或下架；业务申请仍需审核。', searchPlaceholder: '搜索申请编号、申请人或关联项目', allowCreate: false,
    filters: [
      statusFilter(['published', '已发布'], ['offline', '已下架'], ['submitted', '待受理'], ['pending_review', '待审核'], ['processing', '办理中'], ['approved', '已通过'], ['rejected', '已驳回'], ['completed', '已完成'], ['cancelled', '已取消']),
      { key: 'submissionType', label: '申请类型', options: [
        { value: 'event-registration', label: '活动报名' }, { value: 'organization-membership', label: '组织加入' },
        { value: 'organization-message', label: '组织留言' },
        { value: 'community-comment', label: '湖财圈评论' },
        { value: 'job-application', label: '岗位投递' }, { value: 'mentor-application', label: '导师申请' },
        { value: 'volunteer-application', label: '志愿报名' }, { value: 'giving-intent', label: '公益意向' },
        { value: 'service-application', label: '服务申请' }, { value: 'benefit-claim', label: '权益领取' }
      ] }
    ],
    columns: [column('applicationNo', '申请编号', { primary: true }), column('submissionType', '申请类型', { type: 'submission-type' }), column('applicantName', '真实申请人/评论人'), column('publicationMode', '发言方式', { options: publicationOptions }), column('projectTitle', '关联项目'), column('status', '状态', { type: 'status' }), column('createdAt', '提交时间', { type: 'datetime' })],
    fields: [field('applicationNo', '申请编号', 'readonly'), field('submissionType', '申请类型', 'readonly'), field('applicantName', '真实申请人/评论人', 'readonly'), ...anonymityFields(), field('applicantContact', '联系方式', 'readonly'), field('projectTitle', '关联项目', 'readonly', { span: 2 }), field('resourceId', '关联资源 ID', 'readonly', { span: 2 }), field('content', '申请内容', 'readonly-textarea', { span: 2 }), field('adminReply', '办理回复', 'textarea', { span: 2 }), field('adminNote', '内部备注', 'textarea', { span: 2 })],
    actions: [
      { ...reviewActions[0], excludedSubmissionTypes: ['giving-intent', ...speechSubmissionTypes] },
      { ...reviewActions[1], excludedSubmissionTypes: speechSubmissionTypes },
      { ...reviewActions[0], label: '发布历史发言', statuses: ['submitted', 'pending_review', 'processing'], submissionTypes: speechSubmissionTypes, includeExpectedRevision: true, confirm: '这是旧规则下尚未公开的发言，确认现在发布？' },
      { ...reviewActions[1], label: '驳回历史发言', statuses: ['submitted', 'pending_review', 'processing'], submissionTypes: speechSubmissionTypes, includeExpectedRevision: true },
      { key: 'start', label: '开始办理', statuses: ['submitted', 'pending_review'], excludedSubmissionTypes: speechSubmissionTypes },
      { key: 'complete', label: '标记完成', statuses: ['approved', 'processing'], excludedSubmissionTypes: ['giving-intent', ...speechSubmissionTypes] },
      { ...speechUnpublishAction, submissionTypes: speechSubmissionTypes },
      { key: 'publish', label: '恢复展示', icon: 'publish', statuses: ['offline'], submissionTypes: speechSubmissionTypes, includeExpectedRevision: true, confirm: '确认恢复这条发言？恢复后符合查看权限的用户将重新看到内容。' }
    ]
  },
  givingCertificates: {
    key: 'givingCertificates', resource: 'applications', title: '公益捐赠与证书', noun: '公益捐赠意向',
    description: '仅处理公益意向的实际到账确认与学校证书签发。意向金额只供核对，必须按学校真实到账记录重新填写。',
    searchPlaceholder: '搜索意向人、公益项目、申请编号或证书编号', allowCreate: false, allowEdit: false,
    fixedFilters: { submissionType: 'giving-intent' },
    filters: [
      statusFilter(
        ['submitted', '待确认到账'],
        ['pending_review', '待复核'],
        ['processing', '办理中'],
        ['approved', '历史待签发'],
        ['completed', '证书已签发'],
        ['rejected', '已驳回'],
        ['cancelled', '已取消']
      )
    ],
    columns: [
      column('applicantName', '意向人', { primary: true }),
      column('projectTitle', '公益项目'),
      column('amount', '意向金额', { type: 'currency' }),
      column('status', '办理状态', { type: 'status' }),
      column('certificate.certificateNo', '证书编号')
    ],
    fields: [
      field('applicationNo', '申请编号', 'readonly'),
      field('applicantName', '意向人', 'readonly'),
      field('applicantContact', '联系方式', 'readonly'),
      field('projectTitle', '公益项目', 'readonly'),
      field('amount', '意向金额（用户填写，仅供参考）', 'readonly', { format: 'currency' }),
      field('message', '公益意向留言', 'readonly-textarea', { span: 2 }),
      field('certificate.certificateNo', '证书编号', 'readonly'),
      field('certificate.confirmedAmount', '实际到账金额（元）', 'readonly', { format: 'currency' }),
      field('certificate.donatedAt', '实际捐赠日期', 'readonly', { format: 'date' }),
      field('certificate.officialReceiptNo', '学校回执号', 'readonly'),
      field('certificate.title', '证书标题', 'readonly', { span: 2 }),
      field('certificate.recipientName', '证书受赠人', 'readonly'),
      field('certificate.issuer', '签发单位', 'readonly'),
      field('certificate.issuedAt', '签发时间', 'readonly', { format: 'datetime' }),
      field('certificate.note', '证书说明', 'readonly-textarea', { span: 2 })
    ],
    actions: [{
      key: 'issue_certificate',
      label: '确认到账并签发证书',
      icon: 'certificate',
      statuses: ['submitted', 'pending_review', 'processing', 'approved'],
      submissionTypes: ['giving-intent'],
      includeExpectedRevision: true,
      dialogTitle: '确认实际到账并签发公益证书',
      confirmText: '确认到账并签发',
      confirm: '请逐项核对学校财务到账与回执记录。确认后将由服务端生成唯一证书编号并完成办理。',
      formNotice: '重要：意向金额不是到账凭证。实际到账金额必须依据学校财务或回执记录重新填写，系统不会自动带入用户意向金额。',
      fields: [
        field('confirmedAmount', '实际到账金额（元）', 'number', { required: true, min: 0.01, max: 1000000000000, step: 0.01, decimalPlaces: 2, placeholder: '请按真实到账记录填写' }),
        field('donatedAt', '实际捐赠日期', 'date', { required: true }),
        field('officialReceiptNo', '学校回执号', 'text', { required: true, minLength: 2, maxLength: 120, placeholder: '请输入学校正式回执编号' }),
        field('title', '证书标题', 'text', { required: true, maxLength: 180, default: (record) => `${record.projectTitle || '公益捐赠'}证书` }),
        field('issuer', '签发单位', 'readonly', { default: '湖南财政经济学院' }),
        field('note', '证书说明', 'textarea', { span: 2, maxLength: 1000, placeholder: '可填写捐赠用途、致谢或其他证书说明' })
      ]
    }]
  },
  announcements: {
    key: 'announcements', resource: 'announcements', title: '公告与消息运营', noun: '公告',
    description: '面向不同身份人群发布平台公告、服务提醒与校友组织通知，统一管理归属组织、优先级、生效时段、跳转目标和正文。',
    searchPlaceholder: '搜索公告标题、分类、摘要或正文', allowCreate: true,
    hiddenDetailKeys: ['organizationId'],
    filters: [
      statusFilter(['draft', '草稿'], ['published', '已发布'], ['offline', '已下架']),
      { key: 'audience', label: '受众', options: [
        { value: 'all', label: '全部用户' }, { value: 'student', label: '学生' },
        { value: 'faculty', label: '教师' }, { value: 'staff', label: '教职工' },
        { value: 'faculty_staff', label: '教师及教职工' }, { value: 'campus', label: '在校师生及教职工' },
        { value: 'alumni', label: '校友' }, { value: 'member', label: '其他学校实名成员' }
      ] },
      { key: 'priority', label: '优先级', options: [
        { value: 'urgent', label: '紧急' }, { value: 'high', label: '高' },
        { value: 'normal', label: '普通' }, { value: 'low', label: '低' }
      ] }
    ],
    columns: [
      column('title', '公告标题', { primary: true }),
      column('organization.name', '归属组织'),
      column('category', '分类'),
      column('audience', '受众'),
      column('priority', '优先级'),
      column('carouselPlacement', '校园墙轮播', { options: carouselOptions }),
      column('startAt', '生效时间', { type: 'datetime' }),
      column('endAt', '失效时间', { type: 'datetime' }),
      column('status', '状态', { type: 'status' })
    ],
    fields: [
      field('title', '公告标题', 'text', { required: true, span: 2, maxLength: 180 }),
      field('organization.name', '归属校友组织', 'readonly', { span: 2, hideOnCreate: true }),
      field('category', '公告分类', 'select', { required: true, options: ['平台公告', '学校通知', '服务提醒', '活动提醒', '系统消息'] }),
      field('audience', '发布受众', 'select', { required: true, default: 'all', options: [
        { value: 'all', label: '全部用户' }, { value: 'student', label: '学生' },
        { value: 'faculty', label: '教师' }, { value: 'staff', label: '教职工' },
        { value: 'faculty_staff', label: '教师及教职工' }, { value: 'campus', label: '在校师生及教职工' },
        { value: 'alumni', label: '校友' }, { value: 'member', label: '其他学校实名成员' }
      ] }),
      field('priority', '优先级', 'select', { required: true, default: 'normal', options: [
        { value: 'urgent', label: '紧急' }, { value: 'high', label: '高' },
        { value: 'normal', label: '普通' }, { value: 'low', label: '低' }
      ] }),
      field('startAt', '生效时间', 'datetime-local', { required: true }),
      carouselField(),
      field('endAt', '失效时间', 'datetime-local', { required: true }),
      field('targetType', '跳转类型', 'select', { required: true, default: 'none', options: [
        { value: 'none', label: '不跳转' }, { value: 'route', label: '平台页面' }, { value: 'url', label: '外部链接' }
      ] }),
      field('target', '跳转目标', 'text', { span: 2, maxLength: 2048, placeholder: '页面路由或 HTTPS 地址；不跳转时留空' }),
      field('summary', '公告摘要', 'textarea', { required: true, span: 2, maxLength: 3000 }),
      field('content', '公告正文', 'structured-text', { required: true, span: 2, maxLength: 30000, placeholder: '请输入公告正文，可使用标题、列表、链接和图片进行排版' }),
      field('sortOrder', '排序值（置顶数值越小越靠前）', 'number', { min: -10000, max: 10000, step: 1 })
    ],
    actions: publishActions
  },
  academicCalendar: {
    key: 'academicCalendar', resource: 'academic-calendar', title: '校历管理', noun: '校历事项',
    description: '维护学年、学期、教学周、考试、假期与校园活动安排，统一控制校历事项的发布状态和展示顺序。',
    searchPlaceholder: '搜索校历标题、学年、适用对象、校区或摘要', allowCreate: true,
    filters: [
      statusFilter(['draft', '草稿'], ['published', '已发布'], ['offline', '已下架']),
      { key: 'term', label: '学期', options: academicTermOptions },
      { key: 'category', label: '事项类别', options: academicCalendarCategoryOptions },
      { key: 'priority', label: '优先级', options: academicCalendarPriorityOptions },
      { key: 'audience', label: '适用对象', options: academicCalendarAudienceOptions }
    ],
    columns: [
      column('title', '校历事项', { primary: true }),
      column('academicYear', '学年'),
      column('term', '学期', { options: academicTermOptions }),
      column('category', '事项类别', { options: academicCalendarCategoryOptions }),
      column('startDate', '开始日期', { type: 'date' }),
      column('endDate', '结束日期', { type: 'date' }),
      column('weekNumber', '教学周', { type: 'number' }),
      column('audience', '适用对象', { options: academicCalendarAudienceOptions }),
      column('campus', '校区'),
      column('priority', '优先级', { options: academicCalendarPriorityOptions }),
      column('sortOrder', '排序', { type: 'number' }),
      column('status', '状态', { type: 'status' })
    ],
    fields: [
      field('title', '校历事项标题', 'text', { required: true, span: 2, maxLength: 180 }),
      field('academicYear', '学年', 'text', { required: true, maxLength: 20, placeholder: '如：2026-2027' }),
      field('term', '学期', 'select', { required: true, options: academicTermOptions }),
      field('category', '事项类别', 'select', { required: true, options: academicCalendarCategoryOptions }),
      field('priority', '优先级', 'select', { required: true, default: 'normal', options: academicCalendarPriorityOptions }),
      field('startDate', '开始日期', 'date', { required: true }),
      field('endDate', '结束日期', 'date', { required: true }),
      field('weekNumber', '教学周次', 'number', { min: 1, max: 53, step: 1, placeholder: '非教学周事项可留空' }),
      field('audience', '适用对象', 'select', { required: true, default: 'all', options: academicCalendarAudienceOptions }),
      field('campus', '适用校区', 'text', { maxLength: 120, placeholder: '如：主校区；不区分校区可留空' }),
      field('summary', '事项说明', 'textarea', { required: true, span: 2, maxLength: 3000, placeholder: '说明事项内容、时间要求和注意事项' }),
      field('sourceUrl', '学校官方来源地址', 'url', { span: 2, maxLength: 2048, placeholder: '可填写学校官网通知或校历文件的 HTTPS 地址' }),
      field('sortOrder', '排序值', 'number', { default: 0, min: -10000, max: 10000, step: 1 })
    ],
    actions: publishActions
  },
  alumniBenefits: {
    key: 'alumniBenefits', resource: 'alumni-benefits', title: '校友权益中心', noun: '校友权益',
    description: '统一维护学校与合作方提供的校友权益，管理适用对象、权益价值、有效期、名额和领取说明。',
    searchPlaceholder: '搜索权益名称、类别、提供方或标签', allowCreate: true,
    filters: [
      statusFilter(['draft', '草稿'], ['published', '已发布'], ['offline', '已下架']),
      { key: 'category', label: '权益类别', options: ['校园服务', '学习成长', '职业发展', '生活福利', '医疗健康', '商旅出行', '校友专享'].map((value) => ({ value, label: value })) },
      { key: 'audience', label: '适用对象', options: [
        { value: 'all', label: '全部用户' }, { value: 'student', label: '学生' },
        { value: 'faculty', label: '教师' }, { value: 'staff', label: '教职工' },
        { value: 'faculty_staff', label: '教师及教职工' }, { value: 'campus', label: '在校师生及教职工' },
        { value: 'alumni', label: '校友' }, { value: 'member', label: '其他学校实名成员' }
      ] }
    ],
    columns: [
      column('title', '权益名称', { primary: true }),
      column('category', '类别'),
      column('provider', '提供方'),
      column('audience', '适用对象'),
      column('value', '权益价值'),
      column('quota', '名额', { type: 'number' }),
      column('endAt', '有效期至', { type: 'datetime' }),
      column('status', '状态', { type: 'status' })
    ],
    fields: [
      field('title', '权益名称', 'text', { required: true, span: 2, maxLength: 180 }),
      field('category', '权益类别', 'select', { required: true, options: ['校园服务', '学习成长', '职业发展', '生活福利', '医疗健康', '商旅出行', '校友专享'] }),
      field('provider', '权益提供方', 'text', { required: true, maxLength: 160 }),
      field('audience', '适用对象', 'select', { required: true, default: 'alumni', options: [
        { value: 'all', label: '全部用户' }, { value: 'student', label: '学生' },
        { value: 'faculty', label: '教师' }, { value: 'staff', label: '教职工' },
        { value: 'faculty_staff', label: '教师及教职工' }, { value: 'campus', label: '在校师生及教职工' },
        { value: 'alumni', label: '校友' }, { value: 'member', label: '其他学校实名成员' }
      ] }),
      field('value', '权益价值', 'text', { required: true, maxLength: 200, placeholder: '如：免费、八折、价值 200 元' }),
      field('startAt', '生效时间', 'datetime-local', { required: true }),
      field('endAt', '失效时间', 'datetime-local', { required: true }),
      field('quota', '领取名额', 'number', { min: 0, max: 100000000, step: 1, placeholder: '0 表示不限名额' }),
      field('claimInstructions', '领取说明', 'structured-text', { required: true, span: 2, maxLength: 12000, placeholder: '说明领取流程、所需材料、审核方式和使用方式' }),
      field('terms', '使用条件与规则', 'structured-text', { span: 2, maxLength: 20000, placeholder: '说明适用范围、限制条件、退款或失效规则' }),
      field('coverUrl', '权益封面', 'image-url', { span: 2, maxLength: 2048 }),
      field('externalUrl', '官方领取地址', 'url', { span: 2, maxLength: 2048 }),
      field('tags', '权益标签', 'tags', { span: 2, placeholder: '用逗号分隔，如：校友专享，健康服务，限时' }),
      field('sortOrder', '排序值', 'number', { min: -10000, max: 10000, step: 1 })
    ],
    actions: publishActions
  },
  community: {
    key: 'community', resource: 'community-posts', title: '湖财圈内容管理', noun: '动态',
    hiddenDetailKeys: ['images', 'mentions', 'topic'],
    description: '实名动态直接发布；编辑中可设置校园墙轮播置顶。未置顶帖子按近 30 天实际点赞和有效评论自动选入热门轮播，管理员可下架不当内容。',
    searchPlaceholder: '搜索内容、作者或话题', allowCreate: true,
    filters: [
      statusFilter(['pending_review', '待审核'], ['published', '已发布'], ['rejected', '已驳回'], ['offline', '已下架']),
      { key: 'topic', label: '话题', options: ['校园表白', '校园日常', '失物招领', '行业交流', '同城活动', '校友互助', '校园记忆'].map((value) => ({ value, label: value })) }
    ],
    columns: [column('content', '动态内容', { primary: true, truncate: 48 }), column('authorName', '真实发布人'), column('publicationMode', '发布方式', { options: publicationOptions }), column('topic', '话题'), column('carouselPlacement', '校园墙轮播', { options: carouselOptions }), column('status', '发布状态', { type: 'status' }), column('createdAt', '提交时间', { type: 'datetime' })],
    fields: [field('authorName', '真实发布人', 'readonly', { hideOnCreate: true }), ...anonymityFields(), field('content', '动态内容', 'textarea', { span: 2, maxLength: 2000 }), field('topics', '话题', 'tags', { maxItems: 5, itemMaxLength: 20, span: 2 }), field('visibility', '可见范围', 'select', { options: [{ value: 'all', label: '全体实名用户' }, { value: 'alumni', label: '仅校友' }, { value: 'campus', label: '仅在校师生' }] }), carouselField(), field('carouselSortOrder', '置顶排序（越小越靠前）', 'number', { default: 0, min: -10000, max: 10000, step: 1 }), field('moderationNote', '处理备注', 'textarea', { span: 2 })],
    actions: [...reviewActions, { ...publishActions[0], includeExpectedRevision: true }, { ...speechUnpublishAction, statuses: ['published'] }]
  },
  serviceCatalog: {
    key: 'serviceCatalog', resource: 'service-catalog', title: '服务目录管理', noun: '服务',
    description: '统一配置服务分类、办理方式、可用人群、排序和发布状态。', searchPlaceholder: '搜索服务名称或提供部门', allowCreate: true,
    filters: [statusFilter(['draft', '草稿'], ['published', '已发布'], ['offline', '已下架']), { key: 'category', label: '分类', options: ['校园服务', '成长与连接', '共建湖财'].map((value) => ({ value, label: value })) }],
    columns: [column('title', '服务名称', { primary: true }), column('category', '分类'), column('provider', '提供部门'), column('status', '状态', { type: 'status' }), column('sortOrder', '排序', { type: 'number' })],
    fields: [field('title', '服务名称', 'text', { required: true }), field('category', '服务分类', 'select', { required: true, options: ['校园服务', '成长与连接', '共建湖财'] }), field('provider', '提供部门', 'text', { required: true }), field('audience', '可用人群', 'text', { placeholder: '例：学生、教师、职工、校友' }), field('summary', '服务说明', 'structured-text', { required: true, span: 2, maxLength: 12000, placeholder: '请输入服务说明，可使用标题、列表、链接和图片进行排版' }), field('route', '客户端路由', 'text'), field('externalUrl', '官方办理地址', 'url'), field('sortOrder', '排序值', 'number'), field('icon', '图标标识', 'text')],
    actions: publishActions
  },
  serviceApplications: {
    key: 'serviceApplications', resource: 'service-applications', title: '服务申请管理', noun: '服务申请',
    description: '查看用户服务申请、审核材料、更新办理进度并记录回复。', searchPlaceholder: '搜索申请人、服务或申请编号', allowCreate: false,
    filters: [statusFilter(['submitted', '待受理'], ['processing', '办理中'], ['approved', '已通过'], ['rejected', '已驳回'], ['completed', '已完成'])],
    columns: [column('applicationNo', '申请编号', { primary: true }), column('serviceTitle', '服务'), column('applicantName', '申请人'), column('status', '办理状态', { type: 'status' }), column('createdAt', '申请时间', { type: 'datetime' })],
    fields: [field('applicationNo', '申请编号', 'readonly'), field('serviceTitle', '申请服务', 'readonly'), field('applicantName', '申请人', 'readonly'), field('applicantContact', '联系方式', 'readonly'), field('content', '申请内容', 'readonly-textarea', { span: 2 }), field('adminReply', '办理回复', 'textarea', { span: 2 }), field('status', '办理状态', 'select', { options: [{ value: 'submitted', label: '待受理' }, { value: 'processing', label: '办理中' }, { value: 'approved', label: '已通过' }, { value: 'rejected', label: '已驳回' }, { value: 'completed', label: '已完成' }] })],
    actions: [...reviewActions, { key: 'start', label: '开始办理', statuses: ['submitted'] }, { key: 'complete', label: '完成', statuses: ['approved', 'processing'] }]
  },
  activities: {
    key: 'activities', resource: 'activities', title: '活动管理', noun: '活动',
    description: '管理全校师生校友活动以及各校友组织发布的活动，统一维护时间、场地、名额、报名期和发布状态。', searchPlaceholder: '搜索活动、归属组织、场地或主办方', allowCreate: true,
    hiddenDetailKeys: ['organizationId'],
    filters: [statusFilter(['draft', '草稿'], ['published', '报名中'], ['closed', '已截止'], ['completed', '已结束'], ['offline', '已下架'])],
    columns: [column('title', '活动名称', { primary: true }), column('organization.name', '归属组织'), column('organizer', '主办方'), column('startAt', '开始时间', { type: 'datetime' }), column('registrationCount', '报名/名额', { template: 'quota' }), column('status', '状态', { type: 'status' })],
    fields: [field('title', '活动名称', 'text', { required: true, span: 2 }), field('organization.name', '归属校友组织', 'readonly', { span: 2, hideOnCreate: true }), field('category', '活动类型', 'text', { required: true }), field('organizer', '主办方', 'text', { required: true }), field('venue', '活动场地', 'text', { required: true, span: 2 }), field('startAt', '开始时间', 'datetime-local', { required: true }), field('endAt', '结束时间', 'datetime-local'), field('registrationDeadline', '报名截止', 'datetime-local'), field('quota', '报名名额', 'number'), field('summary', '活动摘要', 'textarea', { span: 2 }), field('description', '活动详情', 'structured-text', { required: true, span: 2, maxLength: 30000, placeholder: '请输入活动详情，可使用标题、列表、链接和图片进行排版' })],
    actions: [...publishActions, { key: 'close', label: '截止报名', statuses: ['published'], tone: 'danger' }, { key: 'complete', label: '标记结束', statuses: ['published', 'closed'] }]
  },
  campusVisits: {
    key: 'campusVisits', resource: 'campus-visits', title: '返校与进校预约', noun: '返校预约',
    description: '审核返校与访客预约，核对日期、同行人数、事由和联系方式。', searchPlaceholder: '搜索预约编号、姓名或事由', allowCreate: true,
    filters: [statusFilter(['submitted', '待审核'], ['approved', '已通过'], ['rejected', '已驳回'], ['completed', '已完成'], ['cancelled', '已取消'])],
    columns: [column('bookingNo', '预约编号', { primary: true }), column('applicantName', '预约人'), column('visitDate', '返校日期', { type: 'date' }), column('visitorCount', '人数', { type: 'number' }), column('status', '状态', { type: 'status' })],
    fields: [field('applicantName', '预约人', 'text', { required: true }), field('contact', '联系方式', 'text', { required: true }), field('visitDate', '返校日期', 'date', { required: true }), field('timeSlot', '时段', 'text'), field('visitorCount', '进校人数', 'number', { required: true }), field('transport', '交通方式', 'text'), field('reason', '返校事由', 'textarea', { required: true, span: 2 }), field('adminNote', '审核意见', 'textarea', { span: 2 })],
    actions: [...reviewActions, { key: 'complete', label: '完成访问', statuses: ['approved'] }]
  },
  alumniEnterprises: {
    key: 'alumniEnterprises', resource: 'alumni-enterprises', title: '校友企业认证与名录', noun: '校友企业',
    description: '复核校友企业认证申请与私密证明材料，并维护通过认证或由后台录入的企业公开资料。',
    searchPlaceholder: '搜索企业名称、申请人、所有者、行业、城市或审核备注', allowCreate: true,
    hiddenDetailKeys: ['materials', 'materialIds', 'unifiedSocialCreditCodeMasked', 'applicantAccountId', 'certificationApplicantId'],
    detailNotice: '认证材料仅在列表和详情中显示数量。营业执照等原件必须通过受保护的后台材料接口核验，不会在公开列、公开媒体地址或普通详情字段中展示。',
    filters: [
      statusFilter(['draft', '后台草稿'], ['pending_review', '认证待审核'], ['approved', '认证已通过待发布'], ['published', '已发布'], ['rejected', '认证未通过'], ['offline', '已下架']),
      { key: 'verificationStatus', label: '认证状态', options: enterpriseVerificationOptions },
      { key: 'industry', label: '行业', options: ['金融', '科技', '制造', '建筑地产', '商贸服务', '文化教育', '其他'].map((value) => ({ value, label: value })) }
    ],
    columns: [
      column('name', '企业名称', { primary: true }),
      column('verificationStatus', '认证状态', { type: 'status', options: enterpriseVerificationOptions }),
      column('applicant.name', '认证申请人'),
      column('owner.name', '认证所有者'),
      column('unifiedSocialCreditCodeMasked', '统一信用代码'),
      column('materialCount', '材料数', { type: 'number' }),
      column('industry', '行业'),
      column('city', '城市'),
      column('rejectionReason', '审核备注', { fallbackKeys: ['adminNote'], truncate: 28 }),
      column('status', '发布状态', { type: 'status' })
    ],
    fields: [
      field('name', '企业名称', 'text', { required: true, span: 2, maxLength: 160 }),
      field('industry', '所属行业', 'text', { required: true, maxLength: 120 }),
      field('city', '所在城市', 'region', { required: true, maxLength: 80 }),
      field('foundedYear', '成立年份', 'number', { min: 1900, max: 2200, step: 1 }),
      field('scale', '企业规模', 'text', { maxLength: 80 }),
      field('address', '企业地址', 'text', { span: 2, maxLength: 240 }),
      field('logoUrl', '企业标识', 'image-url', { span: 2, maxLength: 2048 }),
      field('website', '企业官网', 'url', { span: 2, maxLength: 2048 }),
      field('contactName', '联系人', 'text', { maxLength: 80 }),
      field('contactMethod', '联系方式', 'text', { maxLength: 200 }),
      field('summary', '企业摘要', 'textarea', { required: true, span: 2, maxLength: 3000 }),
      field('description', '企业详情', 'structured-text', { span: 2, maxLength: 20000, placeholder: '介绍企业业务、校友背景、合作方向和代表成果，可使用 Markdown 排版' }),
      field('tags', '企业标签', 'tags', { span: 2, maxItems: 30, itemMaxLength: 50, placeholder: '用逗号分隔，如：校友创办，数字经济，产教融合' }),
      field('sortOrder', '排序值', 'number', { min: -10000, max: 10000, step: 1 }),
      field('verificationStatus', '企业认证状态', 'readonly', { options: enterpriseVerificationOptions, hideOnCreate: true }),
      field('unifiedSocialCreditCode', '统一社会信用代码', 'readonly', { hideOnCreate: true }),
      field('materialCount', '认证材料数量（份）', 'readonly', { hideOnCreate: true }),
      field('applicant.name', '认证申请人', 'readonly', { hideOnCreate: true }),
      field('applicant.department', '申请人学院 / 部门', 'readonly', { hideOnCreate: true }),
      field('applicant.personType', '申请人身份', 'readonly', { options: personTypeOptions, hideOnCreate: true }),
      field('owner.name', '认证企业所有者', 'readonly', { hideOnCreate: true }),
      field('owner.department', '所有者学院 / 部门', 'readonly', { hideOnCreate: true }),
      field('owner.personType', '所有者身份', 'readonly', { options: personTypeOptions, hideOnCreate: true }),
      field('rejectionReason', '认证驳回原因', 'readonly-textarea', { span: 2, hideOnCreate: true }),
      field('adminNote', '认证通过备注 / 内部备注', 'readonly-textarea', { span: 2, hideOnCreate: true })
    ],
    actions: [
      { key: 'approve', label: '认证通过', icon: 'approve', statuses: ['pending_review'], requiresReason: true, confirm: '确认申请人与企业材料核验一致，并将企业标记为已认证？' },
      { key: 'reject', label: '认证驳回', icon: 'reject', statuses: ['pending_review'], tone: 'danger', requiresReason: true, confirm: '请填写明确的驳回原因，申请人将看到该审核意见。' },
      { key: 'publish', label: '发布企业', icon: 'publish', statuses: ['draft', 'approved', 'offline', 'unpublished'], when: (record) => record.verificationStatus === 'verified' || (!record.applicant && record.verificationStatus === 'unverified'), confirm: '发布后企业公开资料将在客户端展示；用户认证企业必须已完成认证。' },
      { key: 'unpublish', label: '下架企业', icon: 'unpublish', statuses: ['published'], tone: 'danger', confirm: '下架后企业资料将不再公开展示。' }
    ]
  },
  collaborationOpportunities: {
    key: 'collaborationOpportunities', resource: 'collaboration-opportunities', title: '合作广场管理', noun: '合作机会',
    description: '审核师生校友提交的合作需求，并维护项目类型、发布主体、有效期和对外说明。',
    searchPlaceholder: '搜索合作标题、分类、机构、城市、发布人或标签', allowCreate: true,
    filters: [
      statusFilter(['draft', '草稿'], ['pending_review', '待审核'], ['published', '已发布'], ['rejected', '已驳回'], ['offline', '已下架']),
      { key: 'category', label: '合作分类', options: ['项目合作', '产学研合作', '人才合作', '资源共享', '招商合作', '公益合作', '其他'].map((value) => ({ value, label: value })) }
    ],
    columns: [
      column('title', '合作主题', { primary: true }),
      column('category', '分类'),
      column('organization', '发布机构'),
      column('cooperationMode', '合作方式'),
      column('authorName', '提交人'),
      column('deadline', '有效期', { type: 'date' }),
      column('status', '状态', { type: 'status' })
    ],
    fields: [
      field('title', '合作主题', 'text', { required: true, span: 2, maxLength: 160 }),
      field('category', '合作分类', 'text', { required: true, maxLength: 60 }),
      field('city', '合作城市', 'region', { maxLength: 80 }),
      field('organization', '发布机构', 'text', { maxLength: 160 }),
      field('deadline', '有效期', 'date'),
      field('cooperationMode', '合作方式', 'text', { maxLength: 120 }),
      field('targetAudience', '面向对象', 'text', { span: 2, maxLength: 200 }),
      field('budget', '预算说明', 'text', { maxLength: 100 }),
      field('contactMethod', '联系方式', 'text', { maxLength: 200 }),
      field('summary', '合作摘要', 'textarea', { required: true, span: 2, maxLength: 3000 }),
      field('description', '合作详情', 'structured-text', { span: 2, maxLength: 20000, placeholder: '说明合作背景、资源条件、合作方式和预期成果，可使用 Markdown 排版' }),
      field('tags', '合作标签', 'tags', { span: 2, placeholder: '用逗号分隔，如：人工智能，实习基地，联合研发' }),
      field('authorName', '用户提交人', 'readonly')
    ],
    actions: [...reviewActions, ...publishActions]
  },
  alumniAcademy: {
    key: 'alumniAcademy', resource: 'alumni-academy', title: '校友课堂管理', noun: '课堂内容',
    description: '管理校友课堂、公开课和经验分享，维护讲师、媒体地址、排序与发布状态。',
    searchPlaceholder: '搜索课堂标题、分类、讲师、摘要或标签', allowCreate: true,
    filters: [
      statusFilter(['draft', '草稿'], ['pending_review', '待审核'], ['published', '已发布'], ['rejected', '已驳回'], ['offline', '已下架']),
      { key: 'category', label: '课堂分类', options: ['职业成长', '职业发展', '创业创新', '行业洞察', '财经素养', '校友分享', '校园公开课', '其他'].map((value) => ({ value, label: value })) }
    ],
    columns: [
      column('title', '课堂标题', { primary: true }),
      column('category', '分类'),
      column('lecturer', '讲师'),
      column('duration', '时长'),
      column('sortOrder', '排序', { type: 'number' }),
      column('status', '状态', { type: 'status' })
    ],
    fields: [
      field('title', '课堂标题', 'text', { required: true, span: 2, maxLength: 180 }),
      field('category', '课堂分类', 'text', { required: true, maxLength: 60 }),
      field('lecturer', '讲师姓名', 'text', { required: true, maxLength: 100 }),
      field('lecturerTitle', '讲师职务 / 简介', 'text', { maxLength: 180 }),
      field('coverUrl', '课堂封面', 'image-url', { span: 2, maxLength: 2048 }),
      field('videoUrl', '课堂视频地址', 'url', { span: 2, maxLength: 2048 }),
      field('sourceUrl', '内容来源地址', 'url', { span: 2, maxLength: 2048 }),
      field('duration', '课堂时长', 'text', { maxLength: 50, placeholder: '如：30 分钟、2 小时 15 分' }),
      field('summary', '课堂摘要', 'textarea', { required: true, span: 2, maxLength: 3000 }),
      field('content', '课堂正文', 'structured-text', { span: 2, maxLength: 30000, placeholder: '填写课堂介绍、学习要点、讲师背景和补充资料，可使用 Markdown 排版' }),
      field('tags', '课堂标签', 'tags', { span: 2, placeholder: '用逗号分隔，如：职业规划，金融科技，创业实践' }),
      field('sortOrder', '排序值', 'number', { min: -10000, max: 10000, step: 1 })
    ],
    actions: [...reviewActions, ...publishActions]
  },
  organizations: {
    key: 'organizations', resource: 'organizations', title: '校友组织管理', noun: '组织',
    description: '按同年级、同班、同专业、同兴趣及地方、学院、行业维护组织，填写对应的组织资料后发布。', searchPlaceholder: '搜索组织、年级、班级、专业、兴趣或城市', allowCreate: true,
    filters: [statusFilter(['draft', '草稿'], ['published', '已发布'], ['offline', '已下架']), { key: 'type', label: '类型', options: organizationTypes.map((value) => ({ value, label: value })) }],
    columns: [column('name', '组织名称', { primary: true }), column('type', '类型'), column('city', '所在地'), column('memberCount', '成员数', { type: 'number' }), column('status', '状态', { type: 'status' })],
    fields: [
      field('name', '组织名称', 'text', { required: true, span: 2, maxLength: 160 }),
      field('type', '组织类型', 'select', { required: true, options: organizationTypes }),
      field('city', '所在城市', 'region', { maxLength: 80 }),
      field('college', '学院 / 系部', 'text', { maxLength: 120, placeholder: '按组织情况填写，可使用历史院系名称' }),
      field('grade', '入学年级', 'text', { maxLength: 40, placeholder: '例如：2022级（以入学年份为准）' }),
      field('major', '专业', 'text', { maxLength: 120, placeholder: '例如：计算机科学与技术' }),
      field('className', '班级', 'text', { maxLength: 80, placeholder: '例如：2022级计算机1班' }),
      field('interestTags', '共同兴趣', 'tags', { span: 2, maxItems: 12, itemMaxLength: 30, placeholder: '用逗号分隔，如：摄影，篮球，读书；最多12项' }),
      field('contactName', '联系人', 'text'), field('contactPhone', '联系方式', 'text'),
      field('coverUrl', '组织封面', 'image-url', { span: 2, maxLength: 2048 }),
      field('photoAlbumContent', '组织公开相册', 'structured-text', { span: 2, maxLength: 30000, placeholder: '通过编辑器的图片按钮上传公开组织照片，图片说明将作为相册标题。请勿上传身份证等私密材料。' }),
      field('summary', '组织简介', 'structured-text', { required: true, span: 2, maxLength: 12000, placeholder: '介绍组织定位、工作内容和特色，可使用 Markdown 排版' }),
      field('joinInstructions', '加入说明', 'structured-text', { span: 2, maxLength: 12000, placeholder: '说明加入条件、申请流程和联系方式' })
    ],
    actions: publishActions
  },
  directory: {
    key: 'directory', resource: 'directory', title: '校友名录管理', noun: '名录资料',
    description: '管理校友名录公开状态和可检索字段，不对外暴露学号、联系方式等敏感信息。', searchPlaceholder: '搜索姓名、学院、年级、城市或行业', allowCreate: true,
    filters: [statusFilter(['visible', '已公开'], ['hidden', '已隐藏'], ['pending_review', '待审核'])],
    columns: [column('name', '校友', { primary: true }), column('graduationYear', '年级'), column('college', '学院'), column('city', '城市'), column('status', '公开状态', { type: 'status' })],
    fields: [field('name', '姓名', 'text', { required: true }), field('graduationYear', '年级', 'number'), field('college', '学院', 'text'), field('major', '专业', 'text'), field('city', '所在城市', 'region'), field('industry', '行业', 'text'), field('title', '职务/身份', 'text'), field('organization', '工作单位', 'text'), field('bio', '公开简介', 'textarea', { span: 2 }), field('status', '公开状态', 'select', { options: [{ value: 'visible', label: '已公开' }, { value: 'hidden', label: '已隐藏' }, { value: 'pending_review', label: '待审核' }] })],
    actions: [{ key: 'show', label: '公开', statuses: ['hidden', 'pending_review'] }, { key: 'hide', label: '隐藏', statuses: ['visible'], tone: 'danger', confirm: '隐藏后用户端名录将不再显示该资料。' }]
  },
  jobs: {
    key: 'jobs', resource: 'jobs', title: '企业岗位审核与招聘', noun: '岗位',
    description: '审核已认证校友企业所有者提交的岗位，同时维护后台录入岗位、招聘详情、发布人和有效期。',
    searchPlaceholder: '搜索岗位、所属企业、发布人、城市或招聘要求', allowCreate: true,
    hiddenDetailKeys: ['ownerEnterpriseId', 'authorAccountId'],
    filters: [statusFilter(['draft', '草稿'], ['pending_review', '待审核'], ['published', '招聘中'], ['rejected', '已驳回'], ['offline', '已下架'], ['expired', '已过期'])],
    columns: [
      column('title', '岗位', { primary: true }),
      column('company', '发布单位'),
      column('enterprise.name', '所属认证企业'),
      column('enterprise.verificationStatus', '企业认证', { type: 'status', options: enterpriseVerificationOptions }),
      column('publisher.name', '发布人'),
      column('city', '城市'),
      column('deadline', '招聘截止', { type: 'date' }),
      column('status', '审核 / 发布状态', { type: 'status' })
    ],
    fields: [
      field('title', '岗位名称', 'text', { required: true }),
      field('company', '企业 / 发布单位', 'text', { required: true }),
      field('city', '工作城市', 'region', { required: true }),
      field('salary', '薪资范围', 'text'),
      field('employmentType', '用工类型', 'text'),
      field('headcount', '招聘人数', 'number', { min: 1, max: 999, step: 1, integer: true }),
      field('experience', '经验要求', 'text', { maxLength: 60 }),
      field('education', '学历要求', 'text', { maxLength: 60 }),
      field('tags', '岗位标签', 'tags', { span: 2, maxItems: 8, itemMaxLength: 16, placeholder: '用逗号分隔，如：双休，五险一金' }),
      field('deadline', '有效期', 'date'),
      field('description', '职位描述', 'structured-text', { required: true, span: 2, maxLength: 20000, placeholder: '请输入职位职责和岗位介绍，可使用 Markdown 排版' }),
      field('requirements', '任职要求', 'structured-text', { span: 2, maxLength: 15000, placeholder: '请分条说明学历、经验和能力要求' }),
      field('applicationMethod', '投递方式', 'textarea', { required: true, span: 2 }),
      field('enterprise.id', '认证企业 ID', 'readonly', { hideOnCreate: true }),
      field('enterprise.name', '所属认证企业', 'readonly', { hideOnCreate: true }),
      field('enterprise.verificationStatus', '企业认证状态', 'readonly', { options: enterpriseVerificationOptions, hideOnCreate: true }),
      field('publisher.name', '岗位发布人', 'readonly', { hideOnCreate: true }),
      field('publisher.department', '发布人学院 / 部门', 'readonly', { hideOnCreate: true }),
      field('publisher.personType', '发布人身份', 'readonly', { options: personTypeOptions, hideOnCreate: true }),
      field('rejectionReason', '岗位驳回原因', 'readonly-textarea', { span: 2, hideOnCreate: true }),
      field('adminNote', '审核通过备注 / 内部备注', 'readonly-textarea', { span: 2, hideOnCreate: true })
    ],
    actions: [
      { key: 'approve', label: '审核并发布', icon: 'approve', statuses: ['pending_review'], confirm: '确认岗位属于已认证企业、内容真实完整并公开发布？' },
      { key: 'reject', label: '审核驳回', icon: 'reject', statuses: ['pending_review'], tone: 'danger', requiresReason: true, confirm: '请填写明确的驳回原因，岗位发布人将看到该审核意见。' },
      ...publishActions
    ]
  },
  mentors: {
    key: 'mentors', resource: 'mentors', title: '校友导师管理', noun: '导师',
    description: '审核导师资料、绑定学校实名导师账号，并维护本人编辑权限、辅导主题和对外展示状态。', searchPlaceholder: '搜索导师、实名账号、企业、职务或辅导主题', allowCreate: true,
    filters: [statusFilter(['pending_review', '待审核'], ['published', '已发布'], ['rejected', '已驳回'], ['offline', '已下架']), { key: 'verificationStatus', label: '导师认证', options: [{ value: 'verified', label: '已认证' }, { value: 'unverified', label: '未绑定' }, { value: 'pending', label: '待认证' }, { value: 'rejected', label: '未通过' }] }],
    columns: [column('name', '导师', { primary: true }), column('owner.name', '实名账号'), column('title', '职务'), column('company', '单位'), column('verificationStatus', '导师认证', { type: 'status' }), column('status', '发布状态', { type: 'status' })],
    fields: [field('name', '导师姓名', 'text', { required: true, readonlyWhenOwned: true }), field('department', '学校学院 / 部门', 'text', { readonlyWhenOwned: true }), field('title', '职务', 'text', { required: true }), field('company', '工作单位', 'text', { required: true }), field('availableSlots', '可约名额', 'number'), field('topics', '辅导主题', 'tags', { required: true, span: 2, placeholder: '用逗号分隔' }), field('bio', '导师简介', 'structured-text', { required: true, span: 2, maxLength: 12000, placeholder: '介绍导师经历、专业方向和辅导特色' }), field('availability', '可约时间说明', 'textarea', { span: 2 })],
    actions: [...reviewActions, ...publishActions]
  },
  volunteers: {
    key: 'volunteers', resource: 'volunteers', title: '志愿者与项目管理', noun: '志愿记录',
    description: '管理志愿项目、报名信息、服务时间与审核状态。', searchPlaceholder: '搜索项目、志愿者或服务内容', allowCreate: true,
    filters: [statusFilter(['draft', '草稿'], ['recruiting', '招募中'], ['submitted', '申请待审核'], ['pending_review', '待审核'], ['approved', '已通过'], ['completed', '已完成'], ['offline', '已下架']), { key: 'recordKind', label: '记录类型', options: [{ value: 'resource', label: '志愿项目' }, { value: 'submission', label: '志愿申请' }] }],
    columns: [column('projectTitle', '志愿项目', { primary: true }), column('volunteerName', '志愿者'), column('serviceDate', '服务日期', { type: 'date' }), column('hours', '时长', { type: 'number' }), column('status', '状态', { type: 'status' })],
    fields: [field('projectTitle', '项目名称', 'text', { required: true, span: 2 }), field('volunteerName', '志愿者', 'text'), field('serviceDate', '服务日期', 'date'), field('hours', '服务时长', 'number'), field('quota', '招募名额', 'number'), field('location', '服务地点', 'text'), field('description', '服务内容', 'structured-text', { required: true, span: 2, maxLength: 20000, placeholder: '说明服务内容、流程、注意事项和保障措施' }), field('adminNote', '审核/认定备注', 'textarea', { span: 2 })],
    actions: [...reviewActions, { key: 'publish', label: '开始招募', statuses: ['draft', 'offline'] }, { key: 'complete', label: '标记完成', statuses: ['recruiting', 'approved'] }, { key: 'unpublish', label: '下架', statuses: ['recruiting'], tone: 'danger' }]
  },
  givingProjects: {
    key: 'givingProjects', resource: 'giving-projects', title: '回馈母校与公益项目', noun: '公益项目',
    hiddenDetailKeys: ['certificateTemplate'],
    description: '维护学校审批的公益项目、目标、进度和官方说明；平台只记录意向，款项必须经学校正式渠道办理。', searchPlaceholder: '搜索项目名称、主办单位或说明', allowCreate: true,
    filters: [statusFilter(['draft', '草稿'], ['published', '已发布'], ['completed', '已完成'], ['offline', '已下架'])],
    columns: [column('title', '项目名称', { primary: true }), column('organizer', '主办单位'), column('raisedAmount', '已完成金额', { type: 'number' }), column('goalAmount', '目标金额', { type: 'number' }), column('status', '状态', { type: 'status' })],
    fields: [field('title', '项目名称', 'text', { required: true, span: 2 }), field('organizer', '主办单位', 'text', { required: true }), field('officialUrl', '学校官方办理地址', 'url'), field('goalAmount', '目标金额', 'number'), field('raisedAmount', '已完成金额', 'number'), field('startAt', '开始日期', 'date'), field('endAt', '结束日期', 'date'), field('summary', '项目摘要', 'textarea', { required: true, span: 2 }), field('description', '项目详情与合规说明', 'structured-text', { required: true, span: 2, maxLength: 30000, placeholder: '说明项目用途、学校审批信息、办理渠道与合规事项' })],
    actions: [...publishActions, { key: 'complete', label: '标记完成', statuses: ['published'] }]
  },
  feedback: {
    key: 'feedback', resource: 'feedback', title: '意见与反馈管理', noun: '反馈',
    description: '分类受理意见建议、故障与举报，维护办理回复并保留状态流转。', searchPlaceholder: '搜索反馈编号、内容或提交人', allowCreate: true,
    filters: [statusFilter(['submitted', '待受理'], ['pending_review', '举报待审核'], ['processing', '处理中'], ['resolved', '已回复'], ['closed', '已关闭']), { key: 'submissionType', label: '来源', options: [{ value: 'feedback', label: '意见反馈' }, { value: 'community-report', label: '湖财圈举报' }] }, { key: 'type', label: '类型', options: ['功能建议', '使用问题', '内容举报', '服务投诉', '其他'].map((value) => ({ value, label: value })) }],
    columns: [column('feedbackNo', '反馈编号', { primary: true }), column('type', '类型'), column('content', '内容', { truncate: 36 }), column('status', '状态', { type: 'status' }), column('createdAt', '提交时间', { type: 'datetime' })],
    fields: [field('type', '反馈类型', 'select', { required: true, options: ['功能建议', '使用问题', '内容举报', '服务投诉', '其他'] }), field('submitterName', '提交人', 'readonly'), field('rating', '评分', 'number'), field('anonymous', '匿名', 'boolean'), field('content', '反馈内容', 'readonly-textarea', { span: 2 }), field('adminReply', '办理回复', 'textarea', { required: true, span: 2 }), field('status', '办理状态', 'select', { options: [{ value: 'submitted', label: '待受理' }, { value: 'processing', label: '处理中' }, { value: 'resolved', label: '已回复' }, { value: 'closed', label: '已关闭' }] })],
    actions: [{ key: 'start', label: '开始处理', statuses: ['submitted', 'pending_review'] }, { key: 'resolve', label: '回复并完成', statuses: ['submitted', 'pending_review', 'processing'] }, { key: 'close', label: '关闭', statuses: ['resolved', 'processing'], tone: 'danger', requiresReason: true }]
  },
  homeConfig: {
    key: 'homeConfig', resource: 'home-config', title: '首页运营配置', noun: '首页配置',
    description: '管理首页焦点位、快捷服务、运营栏目和排序；官网资讯仍由官网同步模块提供。', searchPlaceholder: '搜索配置标题、位置或关联业务', allowCreate: true,
    filters: [statusFilter(['draft', '草稿'], ['published', '已发布'], ['offline', '已下架']), { key: 'slot', label: '位置', options: [{ value: 'hero', label: '首屏焦点' }, { value: 'quick-service', label: '快捷服务' }, { value: 'featured', label: '精选栏目' }, { value: 'announcement', label: '公告位' }] }],
    columns: [column('title', '配置标题', { primary: true }), column('slot', '首页位置'), column('targetType', '关联类型'), column('sortOrder', '排序', { type: 'number' }), column('status', '状态', { type: 'status' })],
    fields: [field('title', '展示标题', 'text', { required: true }), field('slot', '首页位置', 'select', { required: true, options: [{ value: 'hero', label: '首屏焦点' }, { value: 'quick-service', label: '快捷服务' }, { value: 'featured', label: '精选栏目' }, { value: 'announcement', label: '公告位' }] }), field('subtitle', '副标题', 'text', { span: 2 }), field('imageUrl', '图片地址', 'url', { span: 2 }), field('targetType', '关联类型', 'select', { options: ['route', 'url', 'activity', 'service', 'official-content'] }), field('target', '跳转目标', 'text', { required: true }), field('sortOrder', '排序值', 'number'), field('startAt', '生效时间', 'datetime-local'), field('endAt', '失效时间', 'datetime-local'), field('audience', '可见人群', 'text')],
    actions: publishActions
  }
}

export function resourceDefinition(key) {
  return resourceDefinitions[key] || null
}
