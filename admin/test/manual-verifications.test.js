import test from 'node:test'
import assert from 'node:assert/strict'
import {
  manualVerificationStatusLabel,
  normalizeManualVerification
} from '../src/lib/manualVerifications.js'
import { auditAction, auditActionCategory } from '../src/lib/format.js'

test('人工认证详情归一化保留审核所需完整字段且只使用脱敏编号', () => {
  const normalized = normalizeManualVerification({
    id: 'verification-1',
    applicationNo: 'MR202607190001',
    status: 'under_review',
    realName: '测试校友',
    formerName: '测试曾用名',
    personType: 'alumni',
    department: '信息技术与管理学院',
    major: '计算机科学与技术',
    enrollmentYear: 2001,
    graduationYear: 2005,
    studentIdMasked: '******0001',
    idCardMasked: '4301**********1234',
    phoneMasked: '138****8000',
    studentNumber: '200100000001',
    idCardNumber: '430102198001011234',
    phone: '13800008000',
    trackingToken: 'must-not-leak',
    source: 'manual_pre_registration',
    claimedAt: '2026-07-19T08:00:00.000Z',
    reviewedAt: '2026-07-19T09:00:00.000Z',
    trackingExpiresAt: '2026-10-17T08:00:00.000Z',
    materials: [{
      id: 'material-1',
      name: '毕业证书.png',
      label: '毕业证 / 学位证',
      materialType: 'graduation_certificate',
      mimeType: 'image/png',
      size: 2048,
      uploadedAt: '2026-07-19T07:00:00.000Z',
      url: '/api/v1/admin/manual-verifications/verification-1/materials/material-1'
    }],
    history: [{
      id: 'history-1',
      action: 'material_uploaded',
      status: 'submitted',
      operatorName: '申请人',
      createdAt: '2026-07-19T07:00:00.000Z'
    }]
  })

  assert.equal(normalized.formerName, '测试曾用名')
  assert.equal(normalized.graduationYear, 2005)
  assert.equal(normalized.claimedAt, '2026-07-19T08:00:00.000Z')
  assert.equal(normalized.trackingExpiresAt, '2026-10-17T08:00:00.000Z')
  assert.equal(normalized.studentNumberMasked, '******0001')
  assert.equal(normalized.identityNumberMasked, '4301**********1234')
  assert.equal(normalized.phoneMasked, '138****8000')
  assert.equal(normalized.materials[0].label, '毕业证 / 学位证')
  assert.equal(normalized.materials[0].materialType, 'graduation_certificate')
  assert.equal(normalized.history[0].action, 'material_uploaded')
  assert.equal(normalized.history[0].operator, '申请人')
  assert.equal(manualVerificationStatusLabel(normalized.status), '复核中')
  assert.equal('studentNumber' in normalized, false)
  assert.equal('idCardNumber' in normalized, false)
  assert.equal('phone' in normalized, false)
  assert.equal('trackingToken' in normalized, false)
})

test('组织管理员发布审计使用非开发人员可理解的中文', () => {
  assert.equal(
    auditAction('business.organization_content_published', { resource: 'activities' }),
    '组织管理员已发布活动'
  )
  assert.equal(
    auditAction('business.organization_content_published', { resource: 'announcements' }),
    '组织管理员已发布通知'
  )
  assert.equal(
    auditActionCategory('business.organization_content_published', { resource: 'activities' }),
    '校友组织运营'
  )
})
