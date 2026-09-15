const stamp = '2026-07-17T00:00:00.000Z'

function record(resource, id, status, fields) {
  return {
    id,
    resource,
    status,
    revision: 1,
    isDemoSeed: true,
    createdAt: stamp,
    updatedAt: stamp,
    ...fields
  }
}

export function developmentBusinessSeeds() {
  return {
    'community-posts': [
      record('community-posts', 'seed-post-career', 'published', {
        authorName: '湖财人示例账号', initials: '湖财', meta: '平台功能演示', location: '长沙',
        topic: '行业交流', content: '这是一条由开发种子提供的湖财圈示例动态，可在管理后台审核、编辑或下架。',
        likeCount: 0, commentCount: 0, publishedAt: stamp
      })
    ],
    'service-catalog': [
      record('service-catalog', 'service-card', 'published', { title: '湖财身份卡', category: '校园服务', provider: '湖财人平台', audience: '学生、教师、职工、校友', summary: '查看当前湖财人平台实名状态。', route: '/pages/card/index', icon: '证', tone: 'blue', sortOrder: 10 }),
      record('service-catalog', 'service-visit', 'published', { title: '进校预约', category: '校园服务', provider: '学校相关部门', audience: '师生员工与校友', summary: '提交返校或进校预约并查看审核进度。', route: '/pages/campus-visit/index', icon: '校', tone: 'gold', sortOrder: 20 }),
      record('service-catalog', 'service-events', 'published', { title: '校园活动', category: '校园服务', provider: '学校及校友组织', audience: '师生员工与校友', summary: '查看活动并提交报名。', route: '/pages/events/index', icon: '会', tone: 'green', sortOrder: 30 }),
      record('service-catalog', 'service-news', 'published', { title: '官网资讯', category: '校园服务', provider: '湖南财政经济学院官网', audience: '所有用户', summary: '查看学校官网同步资讯。', route: '/pages/official-news/index', icon: '闻', tone: 'red', sortOrder: 40 }),
      record('service-catalog', 'service-academic-calendar-demo', 'published', { title: '学校校历（开发示例入口）', category: '校园服务', provider: '湖财人开发演示', audience: '所有用户', summary: '仅用于验证校历入口与后台发布流程；正式日期以学校授权发布内容为准。', route: '/pages/calendar/index', icon: '历', tone: 'blue', sortOrder: 45 }),
      record('service-catalog', 'service-directory', 'published', { title: '校友名录', category: '成长与连接', provider: '校友联络服务', audience: '实名用户', summary: '按城市、学院与行业查找公开校友资料。', route: '/pages/directory/index', icon: '友', tone: 'blue', sortOrder: 50 }),
      record('service-catalog', 'service-organizations', 'published', { title: '校友组织', category: '成长与连接', provider: '校友联络服务', audience: '实名用户', summary: '查看地方、行业和兴趣校友组织。', route: '/pages/chapters/index', icon: '组', tone: 'gold', sortOrder: 60 }),
      record('service-catalog', 'service-mentors', 'published', { title: '校友导师', category: '成长与连接', provider: '校友联络服务', audience: '实名用户', summary: '申请职业成长与经验辅导。', route: '/pages/mentors/index', icon: '师', tone: 'green', sortOrder: 70 }),
      record('service-catalog', 'service-jobs', 'published', { title: '校友招聘', category: '成长与连接', provider: '湖财人平台', audience: '实名用户', summary: '查看经后台审核的校友企业岗位。', route: '/pages/jobs/index', icon: '职', tone: 'red', sortOrder: 80 }),
      record('service-catalog', 'service-community', 'published', { title: '湖财圈', category: '共建湖财', provider: '湖财人平台', audience: '实名用户', summary: '实名用户直接发布动态、参与讨论，管理员可下架不当内容。', route: '/pages/community/index', icon: '忆', tone: 'blue', sortOrder: 90 }),
      record('service-catalog', 'service-volunteer', 'published', { title: '志愿服务', category: '共建湖财', provider: '学校及校友组织', audience: '实名用户', summary: '查看志愿项目并提交申请。', route: '/pages/volunteer/index', icon: '愿', tone: 'gold', sortOrder: 100 }),
      record('service-catalog', 'service-giving', 'published', { title: '回馈母校', category: '共建湖财', provider: '学校授权项目', audience: '实名用户', summary: '查看公益项目并登记参与意向，不直接处理支付。', route: '/pages/giving/index', icon: '爱', tone: 'green', sortOrder: 110 }),
      record('service-catalog', 'service-feedback', 'published', { title: '意见建议', category: '共建湖财', provider: '湖财人平台', audience: '所有用户', summary: '提交意见、问题、投诉或内容举报。', route: '/pages/feedback/index', icon: '言', tone: 'red', sortOrder: 120 })
    ],
    activities: [
      record('activities', 'activity-career-2026', 'published', {
        theme: 'career', category: '职业成长', tag: '职业成长', month: '08', day: '23',
        title: '湘江校友职业发展分享会（示例）', subtitle: '从校园到产业，共话新财经人的成长路径',
        city: '长沙', venue: '湖南财政经济学院', startAt: '2026-08-23T14:00:00+08:00', time: '2026.08.23 14:00',
        registrationDeadline: '2026-08-20T18:00:00+08:00', deadline: '2026.08.20 18:00', quota: 120,
        organizer: '湖财人开发演示', summary: '用于验证后台发布与前台同步的示例活动。',
        description: '该活动为开发种子，正式活动以学校审核发布为准。', highlights: ['后台可编辑', '前台实时读取', '报名进入审核流程']
      })
    ],
    organizations: [
      record('organizations', 'organization-changsha', 'published', { name: '长沙校友联络站（示例）', type: '地方组织', city: '长沙', memberCount: 0, members: 0, activity: '待正式发布', initials: 'CS', summary: '用于演示组织管理与加入申请。', joinInstructions: '提交后由后台审核。' })
    ],
    directory: [
      record('directory', 'directory-demo-1', 'visible', { name: '示例校友甲', initials: '甲', graduationYear: '2012', year: '2012', college: '财政金融学院', industry: '金融科技', city: '长沙', bio: '仅用于开发环境界面与权限测试。' })
    ],
    jobs: [
      record('jobs', 'job-demo-1', 'published', { title: '战略分析师（示例岗位）', company: '湖财人开发演示企业', city: '长沙', salary: '15-25K', type: '校友企业', employmentType: '全职', tags: ['战略规划', '数据分析'], publisher: '平台演示', description: '用于验证岗位发布、下架与申请流程。', requirements: '本岗位不构成真实招聘承诺。', applicationMethod: '请在平台提交意向。', deadline: '2026-12-31' })
    ],
    mentors: [
      record('mentors', 'mentor-demo-1', 'published', { name: '示例导师甲', initials: '甲', title: '金融科技产品负责人', role: '金融科技产品负责人', company: '湖财人开发演示企业', topics: ['职业规划', '产品方向'], availableSlots: 3, slots: 3, bio: '仅用于验证导师管理和申请流程。', availability: '每次约 30 分钟，具体时间待确认。' })
    ],
    volunteers: [
      record('volunteers', 'volunteer-demo-1', 'recruiting', { projectTitle: '校友返校接待志愿服务（示例）', title: '校友返校接待志愿服务（示例）', volunteerTag: '返校服务', serviceDate: '2026-09-12', time: '2026.09.12 09:00', location: '湖南财政经济学院', city: '长沙', quota: 20, task: '协助签到、路线引导与现场服务', description: '用于验证志愿项目发布和申请审核。' })
    ],
    'giving-projects': [
      record('giving-projects', 'giving-demo-1', 'published', { title: '“新财经”学子成长计划（示例）', summary: '支持学生实践、竞赛与职业启蒙。', progress: 0, raised: '0', goal: '200000', provider: '学校授权后正式发布' })
    ],
    'alumni-enterprises': [
      record('alumni-enterprises', 'enterprise-demo-1', 'published', {
        name: '湖财校友创新企业（示例）',
        industry: '数字科技',
        city: '长沙',
        foundedYear: 2022,
        scale: '成长型企业',
        summary: '用于演示校友企业馆的公开展示、筛选和后台维护能力。',
        description: '该企业资料为开发环境示例，不构成真实企业认证或商业推荐。',
        tags: ['校友企业', '数字科技'],
        sortOrder: 10
      })
    ],
    'collaboration-opportunities': [
      record('collaboration-opportunities', 'collaboration-demo-1', 'published', {
        title: '产学研项目合作征集（示例）',
        category: '项目合作',
        city: '长沙',
        organization: '湖财人开发演示',
        cooperationMode: '联合共建',
        targetAudience: '实名师生、教职工及校友',
        summary: '用于演示资源合作信息提交、审核与公开展示闭环。',
        description: '该合作信息为开发环境示例，正式合作以双方尽调和书面协议为准。',
        tags: ['产学研', '资源对接']
      })
    ],
    'alumni-academy': [
      record('alumni-academy', 'academy-demo-1', 'published', {
        title: '新财经人的职业成长方法（示例）',
        category: '职业成长',
        lecturer: '湖财校友导师（示例）',
        lecturerTitle: '行业实践导师',
        duration: '30 分钟',
        summary: '用于演示校友课堂的课程列表、详情和后台发布能力。',
        content: '本课程内容为开发环境示例，正式课程由学校和平台审核后发布。',
        tags: ['职业规划', '校友课堂'],
        sortOrder: 10
      })
    ],
    announcements: [
      record('announcements', 'announcement-platform-welcome', 'published', {
        title: '湖财人平台服务公告（示例）',
        category: '平台公告',
        audience: 'all',
        priority: 'normal',
        startAt: '2026-07-01T00:00:00+08:00',
        endAt: '2027-06-30T23:59:59+08:00',
        targetType: 'none',
        target: '',
        summary: '用于演示公告发布、受众过滤和消息中心已读状态。',
        content: '该公告为开发环境示例，正式通知以学校审核发布内容为准。',
        sortOrder: 10
      })
    ],
    'alumni-benefits': [
      record('alumni-benefits', 'benefit-campus-memory', 'published', {
        title: '校友文化纪念权益（示例）',
        category: '校友专享',
        provider: '湖财人开发演示',
        audience: 'all',
        value: '示例权益，不构成真实兑换承诺',
        startAt: '2026-07-01T00:00:00+08:00',
        endAt: '2027-06-30T23:59:59+08:00',
        quota: 100,
        claimInstructions: '点击领取后进入后台审核流程，正式权益以学校公告为准。',
        terms: '仅用于开发环境验证权益领取、重复限制和审核通知。',
        coverUrl: '',
        externalUrl: '',
        tags: ['校友专享', '开发示例'],
        sortOrder: 10
      })
    ],
    'academic-calendar': [
      record('academic-calendar', 'academic-calendar-development-example', 'published', {
        title: '第一学期教学安排（开发示例）',
        academicYear: '2099-2100',
        term: 'first',
        category: 'teaching',
        startDate: '2099-09-01',
        endDate: '2099-09-07',
        weekNumber: 1,
        audience: 'all',
        campus: '开发演示环境',
        summary: '本事项仅用于开发环境验证校历筛选、排序、发布与下架流程，不代表学校正式校历日期。',
        sourceUrl: '',
        priority: 'normal',
        sortOrder: 10
      })
    ],
    'home-config': [
      record('home-config', 'home-services', 'published', { title: '湖财服务', subtitle: '师生员工与校友共同使用', slot: 'quick-service', targetType: 'route', target: '/pages/services/index', sortOrder: 10, audience: 'all' }),
      record('home-config', 'home-activity', 'published', { title: '近期活动', subtitle: '后台发布后同步展示', slot: 'featured', targetType: 'activity', target: 'activity-career-2026', sortOrder: 20, audience: 'all' })
    ]
  }
}
