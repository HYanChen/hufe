import qrcode from './vendor/qrcode.mjs'

export function normalizeGatePayload(value) {
  const text = String(value || '').trim()
  if (!/^HUFE-GATE-V1:[A-Za-z0-9_-]{20,200}$/.test(text)) throw new Error('请使用身份卡中当前有效的平台返校身份核验二维码或核验码')
  return text
}
export function gateQrDataUrl(payload) {
  const qr = qrcode(0, 'M')
  qr.addData(normalizeGatePayload(payload), 'Byte')
  qr.make()
  return qr.createDataURL(6, 24)
}
export function gateSeconds(expiresAt, now = Date.now()) {
  const expires = Date.parse(expiresAt)
  return Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - now) / 1000)) : 0
}
