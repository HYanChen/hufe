import { appConfig } from '../config/index'
import { getAccessToken, invalidateAuthenticatedSession } from '../utils/store'
import { isRevokedSession, sessionEndMessage } from '../utils/sessionErrors'
import {uploadImageRequest} from './imageUploads'

export class ApiError extends Error {
  constructor(message, { code = 'REQUEST_FAILED', statusCode = 0, data = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
    this.data = data
  }
}

function urlFor(path) {
  if (/^https?:\/\//i.test(path)) return path
  return `${appConfig.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

export function request({ path, method = 'GET', data, token, header = {}, timeout } = {}) {
  if(data?.fileSource)return uploadImageRequest({path,method,data,token,header,timeout},request)
  const bearer = token === undefined ? getAccessToken() : token
  const normalizedMethod = String(method || 'GET').toUpperCase()
  const carriesJsonBody = !['GET', 'HEAD'].includes(normalizedMethod)
  return new Promise((resolve, reject) => {
    // #ifndef H5
    if (!/^https:\/\//i.test(appConfig.apiBaseUrl)) {
      reject(new ApiError('当前平台尚未配置正式 HTTPS API 网关', { code: 'API_BASE_URL_REQUIRED' }))
      return
    }
    // #endif
    uni.request({
      url: urlFor(path),
      method: normalizedMethod,
      data: carriesJsonBody ? (data ?? {}) : data,
      timeout: timeout || appConfig.requestTimeout,
      // #ifdef H5
      // 注册实名事务使用服务端下发的 HttpOnly Cookie 绑定发起浏览器。
      // 跨域 H5 不显式携带凭据时，浏览器会忽略创建事务响应的 Set-Cookie。
      withCredentials: true,
      // #endif
      header: {
        accept: 'application/json',
        ...(carriesJsonBody ? { 'content-type': 'application/json' } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...header
      },
      success(response) {
        const payload = response.data || {}
        if (response.statusCode >= 200 && response.statusCode < 300 && payload.code === 0) {
          resolve(payload.data)
          return
        }
        const error = new ApiError(payload.message || `请求失败（${response.statusCode}）`, {
          code: payload.code || 'REQUEST_FAILED',
          statusCode: response.statusCode,
          data: payload.data
        })
        if (response.statusCode === 401 && isRevokedSession(error)) invalidateAuthenticatedSession(bearer, sessionEndMessage(error))
        reject(error)
      },
      fail(error) {
        reject(new ApiError(error.errMsg || '网络暂时不可用', { code: 'NETWORK_ERROR' }))
      }
    })
  })
}

export function publicRequest(options) {
  return request({ ...options, token: '' })
}
