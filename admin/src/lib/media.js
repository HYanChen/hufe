import { api } from './api.js'

export const MAX_IMAGE_BYTES = 500 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')

const acceptedImageTypes = new Set(ACCEPTED_IMAGE_TYPES)

export function isManagedMediaUrl(value) {
  return /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp|gif)$/i.test(String(value || '').trim())
}

export function isSafeImageUrl(value) {
  const url = String(value || '').trim()
  if (!url) return true
  if (isManagedMediaUrl(url)) return true
  if (/\s/.test(url)) return false
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
  } catch {
    return false
  }
}

export function validateImageFile(file) {
  if (!file) return '请选择图片'
  if (!acceptedImageTypes.has(file.type)) return '仅支持 JPEG、PNG、WebP 或 GIF 图片'
  if (!file.size || file.size > MAX_IMAGE_BYTES) return '图片大小不能超过 500MB'
  return ''
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败，请重新选择'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      if (comma < 0) reject(new Error('图片内容格式无效'))
      else resolve(result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

export async function uploadAdminImage(file) {
  const validationError = validateImageFile(file)
  if (validationError) throw new Error(validationError)
  const result = await api('/admin/media', {
    method: 'POST',
    body: { filename: file.name, mimeType: file.type, fileSource:file }
  })
  const url = String(result?.url || '').trim()
  if (!isManagedMediaUrl(url)) throw new Error('图片服务返回了无效地址，请联系系统管理员')
  return { ...result, url }
}
