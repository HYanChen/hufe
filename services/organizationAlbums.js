import { request } from './http'
import { appConfig } from '../config/index'
const root = id => `/api/v1/business/organizations/${encodeURIComponent(id)}`
export const listOrganizationAlbums = (id, page = 1) => request({ path: `${root(id)}/albums?page=${page}&pageSize=12` })
export const listAlbumPhotos = (id, albumId, page = 1) => request({ path: `${root(id)}/albums/${encodeURIComponent(albumId)}/photos?page=${page}&pageSize=12` })
export const saveOrganizationAlbum = (id, albumId, data, token) => request({ path: `${root(id)}/albums${albumId ? '/' + encodeURIComponent(albumId) : ''}`, method: albumId ? 'PATCH' : 'POST', data, token })
export const uploadAlbumPhoto = (id, albumId, file, token) => request({ path: `${root(id)}/albums/${encodeURIComponent(albumId)}/photos`, method: 'POST', data: { filename: file.filename, caption: file.caption, mimeType: file.mimeType, dataBase64: file.dataBase64, fileSource: file.fileSource, clientRequestId: file.clientRequestId }, token, timeout: 60000 })
export const deleteAlbumContent = (id, kind, itemId, token) => request({ path: `${root(id)}/${kind === 'photo' ? 'album-photos' : 'albums'}/${encodeURIComponent(itemId)}`, method: 'DELETE', token })
export function albumImageUrl(value) {
  return /^\/api\/v1\/business\/organization-album-photos\/[a-f0-9-]{36}$/.test(value || '') ? `${appConfig.apiBaseUrl}${value}` : ''
}
