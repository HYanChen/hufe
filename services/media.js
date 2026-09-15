import { appConfig } from '../config/index'

const managedMediaPattern = /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp|gif)$/i

export function resolveMediaUrl(value = '') {
  const candidate = String(value || '').trim()
  if (!candidate || candidate.length > 2048 || /[\u0000-\u0020\u007f<>"'\\]/.test(candidate)) return ''
  if (/^https?:\/\//i.test(candidate)) {
    const authority = candidate.match(/^https?:\/\/([^/?#]+)/i)?.[1] || ''
    return authority && !authority.includes('@') ? candidate : ''
  }
  if (!managedMediaPattern.test(candidate)) return ''
  return appConfig.apiBaseUrl ? `${appConfig.apiBaseUrl}${candidate}` : candidate
}
