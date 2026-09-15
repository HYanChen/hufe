export const businessResourceKeys = [
  'community-posts',
  'applications',
  'service-catalog',
  'service-applications',
  'activities',
  'campus-visits',
  'organizations',
  'directory',
  'jobs',
  'mentors',
  'volunteers',
  'giving-projects',
  'alumni-enterprises',
  'collaboration-opportunities',
  'alumni-academy',
  'announcements',
  'alumni-benefits',
  'academic-calendar',
  'feedback',
  'home-config'
]

export const ecosystemResourceKeys = [
  'alumni-enterprises',
  'collaboration-opportunities',
  'alumni-academy',
  'announcements',
  'alumni-benefits'
]

// 开发环境升级已有数据时，为后续新增的独立业务板块补入明确标注的
// 演示数据；与“校友生态圈”业务分组分开维护，避免混淆产品归属。
export const developmentBackfillResourceKeys = [
  ...ecosystemResourceKeys,
  'academic-calendar'
]

export const storedResourceKeys = businessResourceKeys.filter((key) => ![
  'applications', 'service-applications', 'campus-visits', 'feedback'
].includes(key))

export const publicStatuses = {
  'community-posts': ['published'],
  'service-catalog': ['published'],
  activities: ['published', 'closed', 'completed'],
  organizations: ['published'],
  directory: ['visible'],
  jobs: ['published'],
  mentors: ['published'],
  volunteers: ['recruiting', 'published'],
  'giving-projects': ['published'],
  'alumni-enterprises': ['published'],
  'collaboration-opportunities': ['published'],
  'alumni-academy': ['published'],
  announcements: ['published'],
  'alumni-benefits': ['published'],
  'academic-calendar': ['published'],
  'home-config': ['published']
}

export const defaultStatuses = {
  'community-posts': 'draft',
  'service-catalog': 'draft',
  activities: 'draft',
  organizations: 'draft',
  directory: 'hidden',
  jobs: 'draft',
  mentors: 'draft',
  volunteers: 'draft',
  'giving-projects': 'draft',
  'alumni-enterprises': 'draft',
  'collaboration-opportunities': 'draft',
  'alumni-academy': 'draft',
  announcements: 'draft',
  'alumni-benefits': 'draft',
  'academic-calendar': 'draft',
  'home-config': 'draft'
}

export const mentorVerificationStatuses = ['unverified', 'pending', 'verified', 'rejected']

// 导师本人只能维护公开职业资料；实名姓名、所属学院、归属账号、认证与发布状态
// 均由学校身份和后台审核流程控制。
export const mentorSelfEditableFields = [
  'title',
  'company',
  'availableSlots',
  'topics',
  'bio',
  'availability'
]

export const allowedSubmissionTypes = [
  'event-registration',
  'campus-visit',
  'organization-membership',
  'organization-message',
  'job-application',
  'job-favorite',
  'mentor-application',
  'volunteer-application',
  'giving-intent',
  'feedback',
  'service-application',
  'news-favorite',
  'community-comment',
  'community-report',
  'benefit-claim'
]

export const submissionBackedResources = {
  applications: ['event-registration', 'organization-membership', 'organization-message', 'community-comment', 'job-application', 'mentor-application', 'volunteer-application', 'giving-intent', 'service-application', 'benefit-claim'],
  'service-applications': ['service-application'],
  'campus-visits': ['campus-visit'],
  feedback: ['feedback', 'community-report']
}

export const resourceRequiredFields = {
  'community-posts': ['content', 'topic'],
  'service-catalog': ['title', 'category', 'summary'],
  activities: ['title', 'category', 'organizer', 'venue', 'startAt', 'description'],
  organizations: ['name', 'type'],
  directory: ['name'],
  jobs: ['title', 'company', 'city'],
  mentors: ['name', 'company'],
  volunteers: ['projectTitle'],
  'giving-projects': ['title'],
  'alumni-enterprises': ['name', 'industry', 'city', 'summary'],
  'collaboration-opportunities': ['title', 'category', 'summary'],
  'alumni-academy': ['title', 'category', 'lecturer', 'summary'],
  announcements: ['title', 'category', 'audience', 'priority', 'startAt', 'endAt', 'targetType', 'summary', 'content'],
  'alumni-benefits': ['title', 'category', 'provider', 'audience', 'value', 'startAt', 'endAt', 'claimInstructions'],
  'academic-calendar': ['title', 'academicYear', 'term', 'category', 'startDate', 'endDate', 'audience', 'summary', 'priority'],
  'home-config': ['title', 'slot', 'target']
}

const text = (maxLength, extra = {}) => ({ type: 'text', maxLength, ...extra })
const markdown = (maxLength) => ({ type: 'markdown', maxLength })
const number = (extra = {}) => ({ type: 'number', ...extra })
const date = { type: 'date' }
const datetime = { type: 'datetime' }
const url = { type: 'url', maxLength: 2048 }
const audience = text(30, { values: ['all', 'student', 'faculty', 'staff', 'faculty_staff', 'campus', 'alumni', 'member'] })

// 服务端字段规则是管理后台表单的安全边界。未列出的历史扩展字段仍按通用
// JSON 规则保留，避免破坏已有数据；列出的公开展示字段会被严格规范化。
export const resourceFieldRules = {
  'community-posts': {
    content: markdown(2000),
    topic: text(30),
    visibility: text(20, { values: ['all', 'alumni', 'campus'] }),
    carouselPlacement: text(10, { values: ['none', 'pinned'] }),
    carouselSortOrder: number({ integer: true, min: -10000, max: 10000 }),
    moderationNote: text(1000)
  },
  'service-catalog': {
    title: text(120),
    category: text(30),
    provider: text(120),
    audience: text(200),
    summary: markdown(12000),
    route: { type: 'route', maxLength: 500 },
    externalUrl: url,
    sortOrder: number({ integer: true, min: -10000, max: 10000 }),
    icon: text(20)
  },
  activities: {
    organizationId: text(80),
    title: text(160),
    category: text(50),
    organizer: text(160),
    city: text(80),
    regionCode: text(50),
    venue: text(200),
    startAt: datetime,
    endAt: datetime,
    registrationDeadline: datetime,
    quota: number({ integer: true, min: 0, max: 1000000 }),
    summary: markdown(2000),
    description: markdown(30000)
  },
  organizations: {
    name: text(160),
    type: text(40),
    city: text(80),
    regionCode: text(50),
    college: text(120),
    grade: text(40),
    major: text(120),
    className: text(80),
    interestTags: { type: 'tags', maxItems: 12, itemMaxLength: 30 },
    industry: text(120),
    contactName: text(80),
    contactPhone: text(80),
    memberCount: number({ integer: true, min: 0, max: 100000000 }),
    summary: markdown(12000),
    joinInstructions: markdown(12000),
    coverUrl: { type: 'asset-url', maxLength: 2048 },
    photoAlbumContent: markdown(30000)
  },
  directory: {
    name: text(80),
    graduationYear: number({ integer: true, min: 1900, max: 2200 }),
    college: text(120),
    major: text(120),
    city: text(80),
    regionCode: text(50),
    industry: text(120),
    title: text(120),
    organization: text(160),
    bio: markdown(8000)
  },
  jobs: {
    title: text(160),
    company: text(160),
    city: text(80),
    regionCode: text(50),
    salary: text(80),
    employmentType: text(80),
    headcount: number({ integer: true, min: 1, max: 999 }),
    experience: text(60),
    education: text(60),
    tags: { type: 'tags', maxItems: 8, itemMaxLength: 16 },
    deadline: date,
    description: markdown(20000),
    requirements: markdown(20000),
    applicationMethod: markdown(8000)
  },
  mentors: {
    name: text(80),
    department: text(120),
    title: text(120),
    company: text(160),
    availableSlots: number({ integer: true, min: 0, max: 100000 }),
    topics: { type: 'tags', maxItems: 30, itemMaxLength: 50 },
    bio: markdown(12000),
    availability: markdown(8000),
    ownerAccountId: text(80),
    verificationStatus: text(20, { values: mentorVerificationStatuses })
  },
  volunteers: {
    projectTitle: text(160),
    volunteerName: text(80),
    serviceDate: date,
    hours: number({ min: 0, max: 100000 }),
    quota: number({ integer: true, min: 0, max: 1000000 }),
    location: text(200),
    description: markdown(20000),
    adminNote: text(2000)
  },
  'giving-projects': {
    title: text(160),
    organizer: text(160),
    officialUrl: url,
    goalAmount: number({ min: 0, max: 1000000000000 }),
    raisedAmount: number({ min: 0, max: 1000000000000 }),
    startAt: date,
    endAt: date,
    summary: markdown(2000),
    description: markdown(30000)
  },
  'alumni-enterprises': {
    name: text(160),
    industry: text(120),
    city: text(80),
    regionCode: text(50),
    foundedYear: number({ integer: true, min: 1900, max: 2200 }),
    scale: text(80),
    address: text(240),
    logoUrl: { type: 'asset-url', maxLength: 2048 },
    website: url,
    contactName: text(80),
    contactMethod: text(200),
    summary: markdown(3000),
    description: markdown(20000),
    tags: { type: 'tags', maxItems: 30, itemMaxLength: 50 },
    sortOrder: number({ integer: true, min: -10000, max: 10000 })
  },
  'collaboration-opportunities': {
    title: text(160),
    category: text(60),
    city: text(80),
    regionCode: text(50),
    organization: text(160),
    deadline: date,
    cooperationMode: text(120),
    targetAudience: text(200),
    budget: text(100),
    contactMethod: text(200),
    summary: markdown(3000),
    description: markdown(20000),
    tags: { type: 'tags', maxItems: 30, itemMaxLength: 50 }
  },
  'alumni-academy': {
    title: text(180),
    category: text(60),
    lecturer: text(100),
    lecturerTitle: text(180),
    coverUrl: { type: 'asset-url', maxLength: 2048 },
    videoUrl: url,
    sourceUrl: url,
    duration: text(50),
    summary: markdown(3000),
    content: markdown(30000),
    tags: { type: 'tags', maxItems: 30, itemMaxLength: 50 },
    sortOrder: number({ integer: true, min: -10000, max: 10000 })
  },
  announcements: {
    organizationId: text(80),
    title: text(180),
    category: text(60),
    audience,
    priority: text(20, { values: ['urgent', 'high', 'normal', 'low'] }),
    carouselPlacement: text(10, { values: ['none', 'pinned'] }),
    startAt: datetime,
    endAt: datetime,
    targetType: text(20, { values: ['route', 'url', 'none'] }),
    target: text(2048),
    summary: markdown(3000),
    content: markdown(30000),
    sortOrder: number({ integer: true, min: -10000, max: 10000 })
  },
  'alumni-benefits': {
    title: text(180),
    category: text(60),
    provider: text(160),
    audience,
    value: text(200),
    startAt: datetime,
    endAt: datetime,
    quota: number({ integer: true, min: 0, max: 100000000 }),
    claimInstructions: markdown(12000),
    terms: markdown(20000),
    coverUrl: { type: 'asset-url', maxLength: 2048 },
    externalUrl: url,
    tags: { type: 'tags', maxItems: 30, itemMaxLength: 50 },
    sortOrder: number({ integer: true, min: -10000, max: 10000 })
  },
  'academic-calendar': {
    title: text(180),
    academicYear: text(9),
    term: text(20, { values: ['first', 'second', 'summer'] }),
    category: text(30, { values: ['term', 'registration', 'teaching', 'exam', 'holiday', 'activity', 'other'] }),
    startDate: date,
    endDate: date,
    weekNumber: number({ integer: true, min: 1, max: 53 }),
    audience,
    campus: text(120),
    summary: markdown(3000),
    sourceUrl: url,
    priority: text(20, { values: ['important', 'normal'] }),
    sortOrder: number({ integer: true, min: -10000, max: 10000 })
  },
  'home-config': {
    title: text(120),
    slot: text(40, { values: ['hero', 'quick-service', 'featured', 'announcement'] }),
    subtitle: text(300),
    imageUrl: url,
    targetType: text(40, { values: ['route', 'url', 'activity', 'service', 'official-content'] }),
    target: text(2048),
    sortOrder: number({ integer: true, min: -10000, max: 10000 }),
    startAt: datetime,
    endAt: datetime,
    audience: text(200)
  }
}

export const publicCreateResources = ['community-posts', 'collaboration-opportunities']

export const strictBusinessResources = [...ecosystemResourceKeys, 'academic-calendar']

export function isBusinessResource(value) {
  return businessResourceKeys.includes(String(value || ''))
}

export function isStoredResource(value) {
  return storedResourceKeys.includes(String(value || ''))
}
