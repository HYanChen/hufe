import test from 'node:test'
import assert from 'node:assert/strict'
import { createConfig } from '../src/config.js'
import { mapSchoolIdentity } from '../src/auth/identity.js'

const config = createConfig({
  env: 'test',
  auth: {
    attributes: {
      name: 'realName,cn',
      studentId: 'studentNo,studentId',
      idCard: 'certificateNumber,idCard',
      department: 'collegeName,department',
      personType: 'identityType,personType'
    }
  }
})

test('学校 CAS 属性可按配置与常见别名映射真实姓名、学院和人员类型', async () => {
  const identity = await mapSchoolIdentity({
    subject: 'stable-subject',
    claims: {
      REALNAME: '张三', STUDENTNO: '2026123456', CERTIFICATENUMBER: '430102199901011234', CollegeName: '财政金融学院', identityType: '本科生'
    }
  }, config)

  assert.equal(identity.schoolSubject, 'stable-subject')
  assert.equal(identity.name, '张三')
  assert.equal(identity.studentId, undefined)
  assert.equal(identity.studentIdMasked, '******3456')
  assert.ok(identity.studentIdKey)
  assert.equal(identity.idCard, undefined)
  assert.equal(identity.idNumber, undefined)
  assert.equal(identity.idCardMasked, '4301**********1234')
  assert.equal(identity.idCardVerified, true)
  assert.ok(identity.idCardKey)
  assert.equal(identity.department, '财政金融学院')
  assert.equal(identity.personType, 'student')
  assert.equal(identity.schoolIdentityVerified, true)
  assert.equal(JSON.stringify(identity).includes('430102199901011234'), false)
  assert.equal(JSON.stringify(identity).includes('2026123456'), false)
})

test('CAS 未返回真实姓名或学院部门时拒绝生成注册身份', async () => {
  await assert.rejects(
    () => mapSchoolIdentity({ subject: 'subject-no-name', claims: { department: '信息工程学院', affiliation: 'student' } }, config),
    (error) => error.code === 'SCHOOL_NAME_MISSING' && error.statusCode === 502
  )
  await assert.rejects(
    () => mapSchoolIdentity({ subject: 'subject-no-department', claims: { cn: '李四', affiliation: 'staff' } }, config),
    (error) => error.code === 'SCHOOL_DEPARTMENT_MISSING' && error.statusCode === 502
  )
})

test('学校主数据响应只采纳白名单字段并由原始别名重新计算脱敏值与 HMAC', async (t) => {
  const originalFetch = globalThis.fetch
  let requestBody = null
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return {
      ok: true,
      json: async () => ({
        verified: true,
        alumniNo: 'A-2026-001',
        personType: '教职工',
        isAdmin: true,
        unknownTopLevel: 'must-not-survive',
        studentIdMasked: 'FORGED-STUDENT-MASK',
        studentIdKey: 'FORGED-STUDENT-KEY',
        idCardMasked: 'FORGED-ID-MASK',
        idCardKey: 'FORGED-ID-KEY',
        profile: {
          name: '主数据实名', collegeName: '会计学院', identityType: '教师',
          studentNo: '2026998877', certificateNumber: '430102198812123456',
          studentIdMasked: 'PROFILE-FORGED-MASK', studentIdKey: 'PROFILE-FORGED-KEY',
          nested: { studentId: 'NESTED-STUDENT', idCard: 'NESTED-ID' },
          roles: ['hufe-alumni-admin'], isAdmin: true, unknown: 'must-not-survive'
        }
      })
    }
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const identity = await mapSchoolIdentity({
    subject: 'master-data-subject',
    claims: { cn: 'CAS 姓名', studentNo: '2026000001', certificateNumber: '430102199901011234', department: '原学院', affiliation: 'student' }
  }, createConfig({
    env: 'test', dataHashSecret: 'identity-master-data-secret',
    auth: { alumniVerifyApiUrl: 'https://master-data.hufe.edu.cn/verify', adminSubjects: [], adminRoleValues: [] }
  }))

  assert.equal(identity.name, '主数据实名')
  assert.equal(identity.department, '会计学院')
  assert.equal(identity.personType, 'staff')
  assert.equal(identity.alumniStatusVerified, true)
  assert.equal(identity.alumniNo, 'A-2026-001')
  assert.equal(identity.studentIdMasked, '******8877')
  assert.equal(identity.idCardMasked, '4301**********3456')
  assert.notEqual(identity.studentIdKey, 'FORGED-STUDENT-KEY')
  assert.notEqual(identity.idCardKey, 'FORGED-ID-KEY')
  assert.equal(identity.isAdmin, false)
  assert.equal(identity.profile, undefined)
  assert.equal(identity.unknownTopLevel, undefined)
  assert.equal(identity.nested, undefined)
  assert.equal(JSON.stringify(identity).includes('2026998877'), false)
  assert.equal(JSON.stringify(identity).includes('430102198812123456'), false)

  assert.equal(requestBody.schoolSubject, 'master-data-subject')
  assert.equal(requestBody.studentId, undefined)
  assert.equal(requestBody.studentIdKey, undefined)
  assert.equal(requestBody.idCard, undefined)
  assert.equal(requestBody.idCardKey, undefined)
  assert.equal(JSON.stringify(requestBody).includes('430102199901011234'), false)
  assert.equal(JSON.stringify(requestBody).includes('2026000001'), false)
})
