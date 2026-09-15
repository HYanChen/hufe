import { hmac } from './crypto.js'

const sensitiveIdentityRaw = Symbol('hufeSensitiveIdentityRaw')

export function readSensitiveIdentityRaw(identity) {
  const value = identity?.[sensitiveIdentityRaw]
  return value && typeof value === 'object'
    ? { studentId: String(value.studentId || ''), idCard: String(value.idCard || '') }
    : { studentId: '', idCard: '' }
}

function array(value) {
  if (Array.isArray(value)) return value.flatMap(array)
  if (value == null || value === '') return []
  if (typeof value === 'string' && /[,;，；]/.test(value)) return value.split(/[,;，；]/).map((item) => item.trim()).filter(Boolean)
  return [String(value)]
}

function claimLookup(claims) {
  return new Map(Object.entries(claims || {}).map(([key, value]) => [String(key).toLowerCase(), value]))
}

function candidates(...values) {
  return values.flatMap(array).map((value) => String(value).trim()).filter(Boolean)
}

function values(claims, ...keys) {
  const lookup = claimLookup(claims)
  for (const candidate of candidates(...keys)) {
    const value = lookup.get(candidate.toLowerCase())
    if (value != null && value !== '') return array(value)
  }
  return []
}

function first(claims, ...keys) {
  for (const candidate of candidates(...keys)) {
    const value = values(claims, candidate)[0]
    if (value) return value
  }
  return ''
}

function safeScalar(input, aliases) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const lookup = new Map(Object.entries(input).map(([key, value]) => [String(key).toLowerCase(), value]))
  for (const alias of aliases) {
    const value = lookup.get(String(alias).toLowerCase())
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim()
      if (text) return text
    }
  }
  return ''
}

function approved(value) {
  return value === true || value === 1 || ['true', '1', 'yes', 'approved', 'verified', '通过', '已认证'].includes(String(value || '').trim().toLowerCase())
}

function inferPersonType(values) {
  const text = values.join(' ').toLowerCase()
  if (/alumni|校友|毕业/.test(text)) return 'alumni'
  if (/faculty|teacher|教师|老师|教员/.test(text)) return 'faculty'
  if (/staff|employee|职工|教职工|员工|行政/.test(text)) return 'staff'
  if (/student|学生|本科生|研究生|博士生|留学生/.test(text)) return 'student'
  return 'member'
}

function identityError(message, code) {
  return Object.assign(new Error(message), { code, statusCode: 502 })
}

function maskStudentId(value = '') {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 4) return '****'
  return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`
}

function maskIdCard(value = '') {
  const text = String(value || '').replace(/\s+/g, '')
  if (!text) return ''
  if (text.length <= 8) return '*'.repeat(Math.max(8, text.length))
  return `${text.slice(0, 4)}${'*'.repeat(Math.max(8, text.length - 8))}${text.slice(-4)}`
}

async function verifyAgainstSchoolApi(identity, config) {
  if (!config.auth.alumniVerifyApiUrl) return null
  const requestIdentity = {
    schoolSubject: identity.schoolSubject,
    name: identity.name,
    department: identity.department,
    personType: identity.personType,
    affiliation: identity.affiliation,
    roles: identity.roles,
    studentIdMasked: identity.studentIdMasked,
    idCardVerified: Boolean(identity.idCardVerified)
  }
  const response = await fetch(config.auth.alumniVerifyApiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(config.auth.alumniVerifyApiToken ? { authorization: `Bearer ${config.auth.alumniVerifyApiToken}` } : {})
    },
    body: JSON.stringify(requestIdentity),
    signal: AbortSignal.timeout(8_000)
  })
  if (!response.ok) throw new Error(`学校身份主数据接口返回 HTTP ${response.status}`)
  return response.json()
}

export async function mapSchoolIdentity(result, config) {
  const claims = result.claims || {}
  const keys = config.auth.attributes
  const roles = values(claims, keys.roles, ['roles', 'role', 'groups', 'authorities'])
  const affiliation = values(claims, keys.affiliation, ['affiliation', 'eduPersonAffiliation', 'eduPersonPrimaryAffiliation'])
  const rawPersonTypes = values(claims, keys.personType, ['personType', 'userType', 'identityType', 'memberType', 'employeeType', 'category', '人员类型', '身份类型'])
  const alumniStatuses = values(claims, keys.alumniStatus, ['alumniStatus', 'alumni_status']).map((value) => value.toLowerCase())
  const rawStudentId = first(claims, keys.studentId, ['studentId', 'studentNo', 'student_no', 'employeeNumber', 'employeeNo', 'uid', '学号', '工号']).replace(/\s+/g, '')
  const rawIdCard = first(claims, keys.idCard, ['idCard', 'idCardNo', 'idNumber', 'nationalId', 'certificateNumber', 'sfzh', '身份证号', '证件号码']).replace(/\s+/g, '')
  const schoolSubject = String(result.subject || claims.sub || '')
  if (!schoolSubject) throw new Error('统一认证未返回稳定学校身份 ID')

  const identity = {
    schoolSubject,
    name: first(claims, keys.name, ['cn', 'name', 'displayName', 'realName', 'real_name', 'xm', '姓名']),
    studentIdMasked: maskStudentId(rawStudentId),
    studentIdKey: rawStudentId ? hmac(`student-id:${rawStudentId}`, config.dataHashSecret) : '',
    idCardMasked: maskIdCard(rawIdCard),
    idCardKey: rawIdCard ? hmac(`id-card:${rawIdCard.toUpperCase()}`, config.dataHashSecret) : '',
    idCardVerified: Boolean(rawIdCard),
    department: first(claims, keys.department, ['department', 'departmentName', 'dept', 'deptName', 'organization', 'organizationName', 'orgName', 'college', 'collegeName', 'unitName', '院系', '学院', '部门']),
    affiliation,
    major: first(claims, keys.major, ['major', 'majorName', '专业']).slice(0,120),
    className: first(claims, keys.className, ['className', '班级']).slice(0,80),
    enrollmentYear: first(claims, keys.enrollmentYear, ['enrollmentYear', 'admissionYear', '入学年份']).slice(0,4),
    graduationYear: first(claims, keys.graduationYear, ['graduationYear', '毕业年份']).slice(0,4),
    expectedGraduationYear: first(claims, keys.expectedGraduationYear, ['expectedGraduationYear', 'expectedGraduationDate', '预计毕业年份', '预计毕业时间']).slice(0,4),
    roles,
    personType: inferPersonType([...rawPersonTypes, ...affiliation, ...roles, ...alumniStatuses]),
    schoolIdentityVerified: true,
    alumniStatusVerified: alumniStatuses.some((status) => config.auth.alumniStatusValues.includes(status)),
    verificationSource: alumniStatuses.length ? 'sso-claim' : 'school-sso',
    verifiedAt: new Date().toISOString()
  }

  const authoritative = await verifyAgainstSchoolApi(identity, config)
  let finalStudentId = rawStudentId
  let finalIdCard = rawIdCard
  if (authoritative) {
    const profile = authoritative.profile && typeof authoritative.profile === 'object' && !Array.isArray(authoritative.profile) ? authoritative.profile : {}
    const profileName = safeScalar(profile, ['name', 'realName', 'displayName', 'cn', '姓名'])
    const profileDepartment = safeScalar(profile, ['department', 'departmentName', 'dept', 'deptName', 'college', 'collegeName', 'organizationName', 'orgName', '学院', '院系', '部门'])
    const profilePersonType = safeScalar(profile, ['personType', 'userType', 'identityType', 'employeeType', '人员类型', '身份类型'])
    const profileAlumniNo = safeScalar(profile, ['alumniNo', 'alumniNumber', '校友编号'])
    const profileStudentId = safeScalar(profile, ['studentId', 'studentNo', 'student_no', 'employeeNumber', 'employeeNo', 'uid', '学号', '工号']).replace(/\s+/g, '')
    const profileIdCard = safeScalar(profile, ['idCard', 'idCardNo', 'idNumber', 'nationalId', 'certificateNumber', 'sfzh', '身份证号', '证件号码']).replace(/\s+/g, '')
    identity.alumniStatusVerified = approved(authoritative.verified ?? authoritative.approved)
    identity.alumniNo = safeScalar(authoritative, ['alumniNo', 'alumniNumber']) || profileAlumniNo
    identity.name = profileName || identity.name
    identity.department = profileDepartment || identity.department
    for (const key of ['major', 'className', 'enrollmentYear', 'graduationYear', 'expectedGraduationYear']) identity[key] = safeScalar(profile, [key]).slice(0, key.endsWith('Year') ? 4 : 120) || identity[key]
    identity.personType = safeScalar(authoritative, ['personType']) || profilePersonType || identity.personType
    finalStudentId = profileStudentId || finalStudentId
    finalIdCard = profileIdCard || finalIdCard
    identity.verificationSource = 'school-master-data-api'
  }

  // 可选主数据接口也不得把完整学号/身份证带入注册 session、票据、数据库或 API。
  if (finalStudentId) {
    identity.studentIdMasked = maskStudentId(finalStudentId)
    identity.studentIdKey = hmac(`student-id:${finalStudentId}`, config.dataHashSecret)
  }
  if (finalIdCard) {
    identity.idCardMasked = maskIdCard(finalIdCard)
    identity.idCardKey = hmac(`id-card:${finalIdCard.toUpperCase()}`, config.dataHashSecret)
    identity.idCardVerified = true
  }
  for (const key of ['studentId', 'studentNo', 'student_no', 'idCard', 'idCardNo', 'idNumber', 'nationalId', 'certificateNumber', 'sfzh', '身份证号', '证件号码']) delete identity[key]
  Object.defineProperty(identity, sensitiveIdentityRaw, { value: { studentId: finalStudentId, idCard: finalIdCard }, enumerable: false, configurable: false })

  identity.name = String(identity.name || '').trim()
  identity.department = String(identity.department || identity.college || '').trim()
  identity.personType = inferPersonType([identity.personType, ...rawPersonTypes, ...affiliation, ...roles, ...alumniStatuses])
  if (!identity.name) throw identityError('学校统一认证未返回真实姓名，请联系学校信息中心补充属性映射', 'SCHOOL_NAME_MISSING')
  if (!identity.department) throw identityError('学校统一认证未返回学院或部门，请联系学校信息中心补充属性映射', 'SCHOOL_DEPARTMENT_MISSING')

  identity.isAdmin = config.auth.adminSubjects.includes(schoolSubject) || roles.some((role) => config.auth.adminRoleValues.includes(role.toLowerCase()))
  return identity
}
