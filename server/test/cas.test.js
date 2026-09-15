import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCasResponse } from '../src/auth/cas.js'

test('解析 CAS 成功响应和属性', () => {
  const result = parseCasResponse(`<?xml version="1.0"?><cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>20260001</cas:user><cas:attributes><cas:cn>测试用户</cas:cn><cas:affiliation>student</cas:affiliation></cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`)
  assert.equal(result.subject, '20260001')
  assert.equal(result.claims.cn, '测试用户')
  assert.equal(result.claims.affiliation, 'student')
})

test('CAS 失败响应必须拒绝', () => {
  assert.throws(() => parseCasResponse(`<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="INVALID_TICKET">Ticket invalid</cas:authenticationFailure></cas:serviceResponse>`), /Ticket invalid/)
})
