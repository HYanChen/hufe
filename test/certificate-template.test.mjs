import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DEFAULT_CERTIFICATE_TEMPLATE, normalizeCertificateTemplate, certificateTemplateError, renderCertificateMessage, issuedCertificateTemplate, certificateTheme } from '../utils/certificateTemplate.js'

test('模板字段、颜色、站内背景与变量验证', () => {
  assert.equal(certificateTemplateError({ ...DEFAULT_CERTIFICATE_TEMPLATE }), '')
  assert.match(certificateTemplateError({ ...DEFAULT_CERTIFICATE_TEMPLATE, title: '' }), /标题/)
  assert.match(certificateTemplateError({ ...DEFAULT_CERTIFICATE_TEMPLATE, message: '{unknown}' }), /未知变量/)
  assert.match(certificateTemplateError({ ...DEFAULT_CERTIFICATE_TEMPLATE, backgroundUrl: 'https://external.example/bg.png' }), /本站/)
  assert.match(certificateTemplateError({ ...DEFAULT_CERTIFICATE_TEMPLATE, primaryColor: 'red;url(x)' }), /颜色/)
  assert.match(certificateTemplateError({ ...DEFAULT_CERTIFICATE_TEMPLATE, message: '<script>alert(1)</script>' }), /纯文本/)
  assert.equal(certificateTemplateError({ ...DEFAULT_CERTIFICATE_TEMPLATE, backgroundUrl: '/api/v1/media/12345678-1234-4234-8234-123456789012.png' }), '')
})

test('自动变量严格单次插值，不执行 HTML 或代码', () => {
  assert.equal(renderCertificateMessage('感谢{recipientName}参与{projectTitle}，{amount}，{donatedAt}', {
    recipientName: '{amount}', projectTitle: '项目A', amount: '¥1,000.00', donatedAt: '2026-09-13'
  }), '感谢{amount}参与项目A，¥1,000.00，2026-09-13')
})

test('新证书按自身快照渲染，旧证书标题与单位兼容', () => {
  const snapshot = { ...DEFAULT_CERTIFICATE_TEMPLATE, title: '项目A荣誉证书', issuer: '项目A签发单位' }
  const certificate = { title: '旧标题', issuer: '旧单位', templateSnapshot: structuredClone(snapshot) }
  snapshot.title = '项目更新后的标题'
  assert.equal(issuedCertificateTemplate(certificate).title, '项目A荣誉证书')
  assert.equal(issuedCertificateTemplate({ title: '既有捐赠证书', issuer: '原签发单位' }).title, '既有捐赠证书')
  assert.equal(issuedCertificateTemplate({ issuer: '原签发单位' }).issuer, '原签发单位')
  assert.equal(issuedCertificateTemplate({}).signature, '')
})

test('渲染主题拒绝注入CSS或外链', () => {
  const normalized = normalizeCertificateTemplate({ primaryColor: 'url(https://evil)', backgroundUrl: '//evil/a.png', layout: 'unknown' })
  assert.deepEqual(certificateTheme(normalized), { '--certificate-primary': DEFAULT_CERTIFICATE_TEMPLATE.primaryColor, '--certificate-accent': DEFAULT_CERTIFICATE_TEMPLATE.accentColor, '--certificate-paper': DEFAULT_CERTIFICATE_TEMPLATE.paperColor })
  assert.equal(normalized.backgroundUrl, '')
  assert.equal(normalized.layout, 'classic')
})

test('前台证书只使用签发快照，未引入实时项目模板或HTML渲染', async () => {
  const source = await readFile(new URL('../pages/giving-certificate/index.vue', import.meta.url), 'utf8')
  assert.match(source, /issuedCertificateTemplate\(this\.issuedCertificate/)
  assert.match(source, /resolveMediaUrl\(this\.template\.backgroundUrl\)/)
  assert.match(source, /\{\{ templateMessage \}\}/)
  assert.doesNotMatch(source, /v-html|getGivingProject/)
  assert.match(source, /非捐赠票据/)
})
