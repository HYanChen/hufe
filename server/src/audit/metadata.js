import { randomUUID } from 'node:crypto'
import { isIP, BlockList } from 'node:net'

export function normalizeIp(value) {
  let ip = String(value || '')
  if (isIP(ip) === 6) { try { ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1) } catch {} }
  ip = ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1')
  const mapped = ip.match(/^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/i)
  if (mapped) { const a = parseInt(mapped[1],16), b = parseInt(mapped[2],16); ip = `${a>>>8}.${a&255}.${b>>>8}.${b&255}` }
  return isIP(ip) ? ip : ''
}

export function trustedProxyPolicy(value, configured = '') {
  if (value === false || value === 'false' || value == null) return false
  const entries = value === true || value === 'true' ? String(configured).split(',') : Array.isArray(value) ? value : String(value).split(',')
  const ranges = entries.map(entry => String(entry).trim()).filter(Boolean)
  if (!ranges.length) throw new Error('启用代理必须设置 TRUSTED_PROXY_CIDRS，不能信任所有来源')
  for (const entry of ranges) {
    const [ip, prefix, extra] = entry.split('/')
    const version = isIP(ip)
    if (!version || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) throw new Error('TRUSTED_PROXY_CIDRS 必须为具体代理 IP 或非全网 CIDR')
  }
  return ranges
}

const privateNetworks = new BlockList()
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) privateNetworks.addSubnet(ip, prefix, 'ipv4')
for (const [ip, prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32]]) privateNetworks.addSubnet(ip, prefix, 'ipv6')
export function nonPublicIp(ip) { const version = isIP(ip); return !version || privateNetworks.check(ip, version === 4 ? 'ipv4' : 'ipv6') }

export function deviceInfo(value = '') {
  const ua = String(value).slice(0, 500)
  const browser = [/MicroMessenger\/([\d.]+)/, /Edg(?:e|A|iOS)?\/([\d.]+)/, /(?:Chrome|CriOS)\/([\d.]+)/, /(?:Firefox|FxiOS)\/([\d.]+)/, /Version\/([\d.]+).*Safari/]
  const names = ['微信', 'Edge', 'Chrome', 'Firefox', 'Safari']
  const i = browser.findIndex(pattern => pattern.test(ua))
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS / iPadOS' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '未识别'
  return { browser: i < 0 ? '未识别' : names[i], browserVersion: i < 0 ? '' : ua.match(browser[i])[1], os, type: /iPad|Tablet/.test(ua) ? '平板' : /Mobile|Android|iPhone/.test(ua) ? '手机' : os === '未识别' ? '未识别' : '电脑', source: 'user-agent' }
}

export function auditRecord(action, targetId, metadata = {}, details = {}) {
  return { id: randomUUID(), action, targetId, details, actor: metadata.actor || 'system', ip: metadata.ip || '', userAgent: metadata.userAgent || '', createdAt: new Date().toISOString(), ...(metadata.trace ? { trace: structuredClone(metadata.trace), requestId: metadata.trace.requestId } : {}) }
}

export function requestMetadata(request, actor = 'system') {
  return { actor, ip: normalizeIp(request.ip), userAgent: String(request.headers['user-agent'] || '').replace(/[\r\n\0]/g, '').slice(0, 500), ...(request.auditTrace ? { trace: { ...request.auditTrace, actorAccountId: request.user?.id || '', actorName: request.user?.name || '', actorUsername: request.user?.username || '' } } : {}) }
}
