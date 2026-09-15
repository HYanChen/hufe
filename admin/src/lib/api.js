import {uploadImageRequest} from './imageUploads.js'
import {isRevokedSession,sessionEndMessage} from '../../../utils/sessionErrors.js'
const API_BASE = String(import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
const TOKEN_KEY = 'hufe.admin.access-token'

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', data = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.data = data
  }
}

export function accessToken() {
  // Migrate the previous per-tab session once; never persist usernames or passwords here.
  const saved = localStorage.getItem(TOKEN_KEY)
  if (saved) return saved
  const legacy = sessionStorage.getItem(TOKEN_KEY) || ''
  if (legacy) { localStorage.setItem(TOKEN_KEY,legacy); sessionStorage.removeItem(TOKEN_KEY) }
  return legacy
}

export function saveAccessToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

export function clearRejectedSession(error, requestToken) {
  if (!requestToken || accessToken() !== requestToken || !isRevokedSession(error)) return false
  saveAccessToken('')
  window.dispatchEvent(new CustomEvent('hufe:auth-expired', {detail:{code:error.code,message:sessionEndMessage(error)}}))
  return true
}

export function apiUrl(path) {
  const text = String(path || '').trim()
  if (!text) throw new ApiError('请求地址无效', { code: 'REQUEST_URL_INVALID' })
  const base = new URL(
    API_BASE.startsWith('http://') || API_BASE.startsWith('https://')
      ? `${API_BASE}/`
      : `${window.location.origin}${API_BASE.startsWith('/') ? '' : '/'}${API_BASE}/`
  )
  if (text.startsWith('/api/')) return new URL(text, base.origin).href
  if (text.startsWith('http://') || text.startsWith('https://')) {
    const absolute = new URL(text)
    if (absolute.origin !== base.origin) throw new ApiError('材料地址不属于当前后台服务', { code: 'REQUEST_URL_FORBIDDEN' })
    return absolute.href
  }
  return new URL(text.replace(/^\//, ''), base).href
}

function handleExpiredAuthorization(response, payload, requestToken) {
  if (response.status === 401) clearRejectedSession(payload,requestToken)
}

export async function api(path, options = {}) {
  if(options.body?.fileSource)return uploadImageRequest(path,options,{api,apiUrl,accessToken})
  const headers = new Headers(options.headers || {})
  const token = options.token === undefined ? accessToken() : options.token
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  let response
  try {
    response = await fetch(apiUrl(path), {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError('无法连接服务端，请检查网络或稍后重试', { code: 'NETWORK_ERROR' })
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || payload.code !== 0) {
    handleExpiredAuthorization(response, payload, token)
    const fallbackMessage = response.status === 403
      ? '您没有访问或操作该管理板块的权限'
      : `请求失败（${response.status}）`
    throw new ApiError(payload?.message || fallbackMessage, {
      status: response.status,
      code: payload?.code || 'REQUEST_FAILED',
      data: payload?.data
    })
  }
  return payload.data
}

export async function apiBlob(path, options = {}) {
  const headers = new Headers(options.headers || {})
  const token = options.token === undefined ? accessToken() : options.token
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response
  try {
    response = await fetch(apiUrl(path), {
      method: 'GET',
      headers,
      signal: options.signal,
      cache: 'no-store'
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError('无法读取受保护的证明材料', { code: 'NETWORK_ERROR' })
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    handleExpiredAuthorization(response, payload, token)
    throw new ApiError(payload?.message || `材料读取失败（${response.status}）`, {
      status: response.status,
      code: payload?.code || 'MATERIAL_REQUEST_FAILED',
      data: payload?.data
    })
  }
  return response.blob()
}
