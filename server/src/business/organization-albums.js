import { auditRecord } from '../audit/metadata.js'
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { prepareImage, writePreparedImage } from '../media/service.js'

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode, code: 'ORGANIZATION_ALBUM_ERROR' }) }
const text = (value, maximum, required = false) => {
  const result = String(value || '').trim()
  if ((required && !result) || result.length > maximum) fail(`请填写${required ? '有效的' : ''}文字，最多 ${maximum} 字`)
  return result
}
const pageOf = (rows, query = {}) => {
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 12)
  if (!Number.isInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) fail('分页参数无效')
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize }
}

export class OrganizationAlbumService {
  constructor(database, config, delegations, media) {
    this.database = database
    this.delegations = delegations
    this.media = media
    this.directory = path.join(config.mediaDir, 'private', 'organization-albums')
  }
  async init() { await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); await this.cleanup(); return this }
  startCleanup(onError) { this.cleanupTimer = setInterval(() => { this.cleanupTask = this.cleanup().catch(onError) }, 3600000); this.cleanupTimer.unref?.() }
  async stopCleanup() { clearInterval(this.cleanupTimer); await this.cleanupTask }
  async cleanup() {
    const records = this.database.read(state => state.organizationAlbumPhotos || [])
    const files = await fs.readdir(this.directory, { withFileTypes: true })
    for (const entry of files) {
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(entry.name)) continue
      const record = records.find(item => item.filename === entry.name)
      if (record && record.status !== 'deleted') continue
      try {
        if (!record && (await fs.stat(path.join(this.directory, entry.name))).mtimeMs > Date.now() - 86400000) continue
        await fs.unlink(path.join(this.directory, entry.name))
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  account(state, id) {
    const account = state.accounts.find(item => item.id === id && item.status === 'active' && item.schoolIdentityVerified)
    if (!account) fail('请先登录并完成实名认证', 403)
    return account
  }
  organization(state, id, actorId = '', manage = false) {
    const organization = (state.business?.resources?.organizations || []).find(item => item.id === id)
    if (!organization) fail('组织不存在', 404)
    if (manage) {
      const account = state.accounts.find(item => item.id === actorId && item.status === 'active')
      if (!account || account.mustChangePassword || !this.delegations.canRecordIn(state, account, 'organizations', 'moderate', organization)) fail('没有该组织相册的管理权限', 403)
    } else if (organization.status !== 'published') fail('组织未公开或已下架', 404)
    return organization
  }
  album(state, organizationId, albumId, actorId = '', manage = false) {
    this.organization(state, organizationId, actorId, manage)
    const album = (state.organizationAlbums || []).find(item => item.id === albumId && item.organizationId === organizationId && item.status !== 'deleted')
    if (!album || (!manage && album.status !== 'published')) fail('相册不存在或已下架', 404)
    return album
  }
  audit(state, action, id, metadata, details = {}) {
    state.auditLogs.unshift(auditRecord(`organization_album.${action}`, id, metadata, details))
  }
  photoView(state, photo, actorId, manage) {
    return { id: photo.id, albumId: photo.albumId, caption: photo.caption, authorName: state.accounts.find(item => item.id === photo.ownerAccountId)?.name || '湖财人', createdAt: photo.createdAt, status: photo.status, canDelete: photo.ownerAccountId === actorId, url: `/api/v1/business/organization-album-photos/${photo.id}`, ...(manage ? { moderationReason: photo.moderationReason || '' } : {}) }
  }
  albumView(state, album, actorId, manage) {
    const photos = (state.organizationAlbumPhotos || []).filter(item => item.albumId === album.id && (manage ? item.status !== 'deleted' : item.status === 'published'))
    return { id: album.id, organizationId: album.organizationId, title: album.title, description: album.description, authorName: state.accounts.find(item => item.id === album.ownerAccountId)?.name || '湖财人', createdAt: album.createdAt, status: album.status, canEdit: album.ownerAccountId === actorId, photoCount: photos.length, cover: photos.find(item => item.status === 'published') ? this.photoView(state, photos.find(item => item.status === 'published'), actorId, manage).url : '', ...(manage ? { moderationReason: album.moderationReason || '' } : {}) }
  }
  list(organizationId, actorId, query, manage = false) {
    return this.database.read(state => {
      this.organization(state, organizationId, actorId, manage)
      return pageOf((state.organizationAlbums || []).filter(item => item.organizationId === organizationId && (manage ? item.status !== 'deleted' : item.status === 'published')).map(item => this.albumView(state, item, actorId, manage)), query)
    })
  }
  photos(organizationId, albumId, actorId, query, manage = false) {
    return this.database.read(state => {
      const album = this.album(state, organizationId, albumId, actorId, manage)
      return { ...pageOf((state.organizationAlbumPhotos || []).filter(item => item.albumId === albumId && (manage ? item.status !== 'deleted' : item.status === 'published')).map(item => this.photoView(state, item, actorId, manage)), query), album: this.albumView(state, album, actorId, manage) }
    })
  }
  create(organizationId, input, metadata) {
    const title = text(input.title, 60, true), description = text(input.description, 300)
    const clientRequestId = text(input.clientRequestId, 100)
    return this.database.transaction(state => {
      this.account(state, metadata.actor); this.organization(state, organizationId)
      state.organizationAlbums ||= []
      const previous = clientRequestId && state.organizationAlbums.find(item => item.ownerAccountId === metadata.actor && item.organizationId === organizationId && item.clientRequestId === clientRequestId)
      if (previous) {
        if (previous.status !== 'published' || previous.title !== title || previous.description !== description) fail('此创建请求已处理，请刷新相册后重试', 409)
        return this.albumView(state, previous, metadata.actor, false)
      }
      if (state.organizationAlbums.filter(item => item.ownerAccountId === metadata.actor && Date.parse(item.createdAt) > Date.now() - 86400000).length >= 10) fail('每天最多新建 10 个相册', 429)
      const album = { id: randomUUID(), organizationId, ownerAccountId: metadata.actor, clientRequestId, title, description, status: 'published', createdAt: new Date().toISOString() }
      state.organizationAlbums.unshift(album)
      this.audit(state, 'created', album.id, metadata, { organizationId })
      return this.albumView(state, album, metadata.actor, false)
    })
  }
  update(organizationId, albumId, input, metadata) {
    const title = text(input.title, 60, true), description = text(input.description, 300)
    return this.database.transaction(state => {
      this.account(state, metadata.actor)
      const album = this.album(state, organizationId, albumId)
      if (album.ownerAccountId !== metadata.actor) fail('只能编辑自己创建的相册', 403)
      Object.assign(album, { title, description, updatedAt: new Date().toISOString() })
      this.audit(state, 'updated', albumId, metadata, { organizationId })
      return this.albumView(state, album, metadata.actor, false)
    })
  }
  async upload(organizationId, albumId, input, metadata) {
    const caption = text(input.caption || input.filename, 120)
    const prepared = prepareImage(input)
    const clientRequestId = text(input.clientRequestId, 100)
    const uploadHash = createHash('sha256').update(prepared.hash||prepared.buffer).update(caption).digest('hex')
    const id = randomUUID(), filename = `${id}.${prepared.extension}`
    // Do not store photos in the community draft directory: its expiry worker
    // intentionally removes files which are not community post attachments.
    try {
      await writePreparedImage(path.join(this.directory,filename),prepared)
      const result = await this.database.transaction(state => {
        this.account(state, metadata.actor); this.album(state, organizationId, albumId)
        state.organizationAlbumPhotos ||= []
        const photos = state.organizationAlbumPhotos
        const previous = clientRequestId && photos.find(item => item.ownerAccountId === metadata.actor && item.albumId === albumId && item.clientRequestId === clientRequestId)
        if (previous) {
          if (previous.status !== 'published' || previous.uploadHash !== uploadHash) fail('此上传请求已处理，请刷新相册查看结果', 409)
          return this.photoView(state, previous, metadata.actor, false)
        }
        if (photos.filter(item => item.albumId === albumId && item.status !== 'deleted').length >= 200) fail('每个相册最多 200 张照片', 409)
        if (photos.filter(item => item.ownerAccountId === metadata.actor && Date.parse(item.createdAt) > Date.now() - 86400000).length >= 90) fail('每天最多上传 90 张照片', 429)
        const photo = { id, albumId, organizationId, ownerAccountId: metadata.actor, clientRequestId, uploadHash, filename, mimeType: prepared.mimeType, size: prepared.size, caption, status: 'published', createdAt: new Date().toISOString() }
        photos.unshift(photo)
        this.audit(state, 'photo_uploaded', id, metadata, { organizationId, albumId })
        return this.photoView(state, photo, metadata.actor, false)
      })
      if (result.id !== id) await fs.unlink(path.join(this.directory, filename)).catch(() => {})
      return result
    } catch (error) { await fs.unlink(path.join(this.directory, filename)).catch(() => {}); throw error }
  }
  async action(organizationId, kind, id, input, metadata, manage = false) {
    const action = input.action
    if (!(manage ? ['unpublish', 'publish'] : ['delete']).includes(action)) fail('不支持的相册操作')
    const reason = manage ? text(input.reason, 300, true) : ''
    const result = await this.database.transaction(state => {
      if (!manage) this.account(state, metadata.actor)
      this.organization(state, organizationId, metadata.actor, manage)
      const collection = kind === 'photo' ? state.organizationAlbumPhotos : state.organizationAlbums
      const record = (collection || []).find(item => item.id === id && item.organizationId === organizationId && item.status !== 'deleted')
      if (!record) fail('内容不存在', 404)
      if (!manage && record.ownerAccountId !== metadata.actor) fail('只能删除自己的相册或照片', 403)
      if (kind === 'photo' && !manage) {
        const parent = (state.organizationAlbums || []).find(item => item.id === record.albumId && item.organizationId === organizationId && item.status !== 'deleted')
        if (!parent) fail('相册不存在', 404)
      }
      record.status = action === 'delete' ? 'deleted' : action === 'unpublish' ? 'offline' : 'published'
      if (kind === 'album' && action === 'delete') {
        for (const photo of state.organizationAlbumPhotos || []) if (photo.albumId === id && photo.organizationId === organizationId) photo.status = 'deleted'
      }
      if (manage) record.moderationReason = reason
      record.updatedAt = new Date().toISOString()
      this.audit(state, `${kind}_${action}`, id, metadata, { organizationId, reason })
      return { id, status: record.status }
    })
    if (action === 'delete') await this.cleanup().catch(() => {}) // Tombstones remain for the hourly retry.
    return result
  }
  descriptor(id, actorId, manage) {
    return this.database.read(state => {
      const photo = (state.organizationAlbumPhotos || []).find(item => item.id === id && item.status !== 'deleted')
      if (!photo || (!manage && photo.status !== 'published')) fail('照片不存在或已下架', 404)
      this.album(state, photo.organizationId, photo.albumId, actorId, manage)
      return photo
    })
  }
  async readPhoto(id, actorId = '', manage = false) {
    const descriptor = this.descriptor(id, actorId, manage)
    const file = await this.media.readPrivateFrom(this.directory, descriptor.filename)
    this.descriptor(id, actorId, manage)
    return file
  }
}
