import { appConfig } from '../config/index'
import { getAccessToken } from '../utils/store'
import { request } from './http'

export function uploadCommunityImage(file, token = getAccessToken()) {
  return request({ path: '/api/v1/business/community-media', method: 'POST', token, data: { filename: file.filename, mimeType: file.mimeType, dataBase64: file.dataBase64, fileSource: file.fileSource } })
}
export function removeCommunityImage(id) { return request({ path: `/api/v1/business/community-media/${encodeURIComponent(id)}`, method: 'DELETE' }) }

export async function loadCommunityImage(id, token = getAccessToken()) {
  if (!token || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('请登录后查看图片')
  const url = `${appConfig.apiBaseUrl}/api/v1/business/community-media/${encodeURIComponent(id)}`
  // #ifdef H5
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!response.ok) throw new Error('图片已下架、已过期或暂无查看权限')
  const src = URL.createObjectURL(await response.blob())
  return { src, dispose: () => URL.revokeObjectURL(src) }
  // #endif
  // #ifndef H5
  if (!/^https:\/\//i.test(url)) throw new Error('当前平台尚未配置正式 HTTPS 图片服务')
  return new Promise((resolve, reject) => uni.downloadFile({
    url, header: { Authorization: `Bearer ${token}` },
    success: (result) => result.statusCode === 200 ? resolve({ src: result.tempFilePath, dispose() {} }) : reject(new Error('图片暂无查看权限')),
    fail: () => reject(new Error('图片加载失败'))
  }))
  // #endif
}
