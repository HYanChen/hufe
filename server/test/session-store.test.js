import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthSessionStore } from '../src/auth/session-store.js'
import { createConfig } from '../src/config.js'

test('注册身份校验一次性换票不能重放', () => {
  const store = new AuthSessionStore(createConfig({ env: 'test' }))
  const { session, pollToken } = store.create({ platform: 'h5', returnUrl: '', protocol: 'cas' })
  const exchangeCode = store.complete(session.id, { status: 'registration_verified', identity: { schoolSubject: 'subject-1' } })
  assert.equal(store.poll(session.id, pollToken).exchangeCode, exchangeCode)
  assert.equal(store.exchange(session.id, pollToken, exchangeCode).identity.schoolSubject, 'subject-1')
  assert.throws(() => store.exchange(session.id, pollToken, exchangeCode), /已使用/)
})

test('认证完成后重复 OIDC 回调不能把终态改写为失败', () => {
  const store = new AuthSessionStore(createConfig({ env: 'test' }))
  const { session } = store.create({ platform: 'h5', returnUrl: '', protocol: 'oidc' })
  store.complete(session.id, { status: 'registration_verified', identity: { schoolSubject: 'subject-1' } })

  assert.throws(() => store.byState(session.state), /状态不可继续/)
  store.fail(session.id, new Error('重复回调'))
  assert.equal(store.sessions.get(session.id).status, 'complete')
})

test('registrationTicket 只保存服务端身份且成功使用后失效', () => {
  const store = new AuthSessionStore(createConfig({ env: 'test' }))
  const identity = { schoolSubject: 'subject-1', name: '测试用户' }
  const issued = store.issueRegistrationTicket(identity)
  assert.equal(issued.registrationToken, issued.registrationTicket)
  assert.equal(store.authenticateRegistrationTicket(issued.registrationTicket).schoolSubject, 'subject-1')
  store.consumeRegistrationTicket(issued.registrationTicket)
  assert.throws(() => store.authenticateRegistrationTicket(issued.registrationTicket), /无效或已过期/)
})

test('registration session 与 ticket 均不会保存完整学号或身份证', () => {
  const store = new AuthSessionStore(createConfig({ env: 'test', dataHashSecret: 'session-privacy-secret' }))
  const { session, pollToken } = store.create({ platform: 'h5', returnUrl: '', protocol: 'cas' })
  const rawStudentId = '2026123456'
  const rawIdCard = '430102199901011234'
  const exchangeCode = store.complete(session.id, {
    status: 'registration_verified',
    identity: {
      schoolSubject: 'subject-private', studentId: rawStudentId, idNumber: rawIdCard,
      studentIdMasked: 'FORGED-STUDENT', studentIdKey: 'FORGED-STUDENT-KEY',
      idCardMasked: 'FORGED-ID', idCardKey: 'FORGED-ID-KEY',
      profile: { studentId: 'NESTED-STUDENT', idCard: 'NESTED-ID' }
    }
  })
  const outcome = store.exchange(session.id, pollToken, exchangeCode)
  assert.equal(outcome.identity.studentId, undefined)
  assert.equal(outcome.identity.idNumber, undefined)
  const serializedSession = JSON.stringify([...store.sessions.values()])
  assert.equal(serializedSession.includes(rawStudentId), false)
  assert.equal(serializedSession.includes(rawIdCard), false)
  assert.notEqual(outcome.identity.studentIdKey, 'FORGED-STUDENT-KEY')
  assert.notEqual(outcome.identity.idCardKey, 'FORGED-ID-KEY')
  const issued = store.issueRegistrationTicket(outcome.identity)
  const ticketIdentity = store.authenticateRegistrationTicket(issued.registrationTicket)
  assert.equal(ticketIdentity.studentIdMasked, '******3456')
  assert.equal(ticketIdentity.idCardMasked, '4301**********1234')
  assert.equal(ticketIdentity.studentIdKey, outcome.identity.studentIdKey)
  assert.equal(ticketIdentity.idCardKey, outcome.identity.idCardKey)
  assert.equal(JSON.stringify(ticketIdentity).includes(rawIdCard), false)

  const forged = store.issueRegistrationTicket({
    schoolSubject: 'forged-subject', studentIdMasked: 'FORGED-STUDENT', studentIdKey: 'A'.repeat(43),
    idCardMasked: 'FORGED-ID', idCardKey: 'B'.repeat(43), idCardVerified: true,
    profile: { studentId: rawStudentId, idCard: rawIdCard }
  })
  const forgedIdentity = store.authenticateRegistrationTicket(forged.registrationTicket)
  assert.equal(forgedIdentity.studentIdMasked, undefined)
  assert.equal(forgedIdentity.studentIdKey, undefined)
  assert.equal(forgedIdentity.idCardMasked, undefined)
  assert.equal(forgedIdentity.idCardKey, undefined)
  assert.equal(forgedIdentity.idCardVerified, undefined)
})

test('注册事务浏览器绑定只保存哈希并拒绝错误绑定', () => {
  const store = new AuthSessionStore(createConfig({ env: 'test' }))
  const { session, browserBinding } = store.create({ platform: 'h5', returnUrl: '', protocol: 'cas' })
  assert.equal(JSON.stringify(session).includes(browserBinding), false)
  assert.equal(store.verifyBrowserBinding(session.id, browserBinding).id, session.id)
  assert.throws(
    () => store.verifyBrowserBinding(session.id, 'attacker-browser-binding'),
    (error) => error.code === 'REGISTRATION_BROWSER_BINDING_REQUIRED'
  )
})
