import { DEFAULT_CERTIFICATE_TEMPLATE } from '../server/src/business/giving-template-defaults.js'
export { DEFAULT_CERTIFICATE_TEMPLATE }

export const CERTIFICATE_VARIABLES = Object.freeze({
  recipientName: '受赠人姓名', projectTitle: '公益项目', amount: '确认金额', donatedAt: '捐赠日期'
})

export function isCertificateBackground(value) {
  return !value || /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp|gif)$/i.test(value)
}

export function normalizeCertificateTemplate(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const result = { ...DEFAULT_CERTIFICATE_TEMPLATE }
  for (const key of ['title', 'subtitle', 'message', 'issuer', 'signature']) {
    if (typeof source[key] === 'string') result[key] = source[key]
  }
  for (const key of ['primaryColor', 'accentColor', 'paperColor']) {
    if (/^#[0-9a-f]{6}$/i.test(source[key])) result[key] = source[key]
  }
  if (typeof source.backgroundUrl === 'string' && isCertificateBackground(source.backgroundUrl)) result.backgroundUrl = source.backgroundUrl
  if (['classic', 'modern'].includes(source.layout)) result.layout = source.layout
  return result
}

export function certificateTemplateError(value) {
  for (const [key, label, max, required] of [
    ['title', '证书标题', 60, true], ['subtitle', '副标题', 120, false],
    ['message', '感谢词', 800, true], ['issuer', '签发单位', 120, true], ['signature', '落款寄语', 120, false]
  ]) {
    const text = String(value[key] || '')
    if (required && !text.trim()) return `请填写${label}`
    if (text.length > max) return `${label}不能超过 ${max} 字`
    if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return `${label}只能使用纯文本，不能包含 HTML 或控制字符`
  }
  const tokens = String(value.message || '').match(/\{[^{}]*\}/g) || []
  if (tokens.some(token => !Object.hasOwn(CERTIFICATE_VARIABLES, token.slice(1, -1)))) return '感谢词中包含未知变量，请使用下方提供的变量'
  if (['primaryColor', 'accentColor', 'paperColor'].some(key => !/^#[0-9a-f]{6}$/i.test(value[key]))) return '配色需要是六位十六进制颜色'
  if (!isCertificateBackground(value.backgroundUrl)) return '背景图请先上传到本站，不能使用外部图片地址'
  if (!['classic', 'modern'].includes(value.layout)) return '请选择有效的版式'
  return ''
}

export function renderCertificateMessage(message, values = {}) {
  return String(message || '').replace(/\{(recipientName|projectTitle|amount|donatedAt)\}/g, (_, key) => String(values[key] ?? ''))
}

export function issuedCertificateTemplate(certificate = {}) {
  if (certificate.templateSnapshot && typeof certificate.templateSnapshot === 'object') return normalizeCertificateTemplate(certificate.templateSnapshot)
  return normalizeCertificateTemplate({
    title: certificate.title || DEFAULT_CERTIFICATE_TEMPLATE.title,
    issuer: typeof certificate.issuer === 'string' ? certificate.issuer : DEFAULT_CERTIFICATE_TEMPLATE.issuer,
    message: '经学校公益办理记录确认，参与以下公益项目。相关信息以学校后台签发数据为准，特此记录。',
    signature: ''
  })
}

export function certificateTheme(template) {
  const safe = normalizeCertificateTemplate(template)
  return { '--certificate-primary': safe.primaryColor, '--certificate-accent': safe.accentColor, '--certificate-paper': safe.paperColor }
}
