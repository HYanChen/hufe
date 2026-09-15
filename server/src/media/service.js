import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream, constants } from 'node:fs'
import { uploadedImage } from './transfers.js'
import path from 'node:path'
import { auditRecord } from '../audit/metadata.js'

export const MAX_MEDIA_BYTES = 2 * 1024 * 1024

const imageTypes = Object.freeze({
  'image/jpeg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
  'image/gif': { extension: 'gif' }
})

function mediaError(message, code = 'MEDIA_INVALID', statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode })
}

function normalizedMimeType(value) {
  const mimeType = String(value || '').trim().toLowerCase()
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType
}

export function detectedMimeType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif'
  return ''
}

function decodeBase64(value) {
  const raw = String(value || '').trim()
  const maximumCharacters = Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 4
  if (!raw || raw.length > maximumCharacters || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw mediaError('图片数据不是有效的 Base64 内容', 'MEDIA_BASE64_INVALID')
  }
  const buffer = Buffer.from(raw, 'base64')
  if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) {
    throw mediaError('图片大小不能超过 2MB', 'MEDIA_TOO_LARGE', 413)
  }
  return buffer
}

function safeStoredFilename(value) {
  const filename = String(value || '')
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/i.test(filename)
    ? filename
    : ''
}

export function prepareImage(input = {}) {
  if(input[uploadedImage])return input[uploadedImage]
  const mimeType = normalizedMimeType(input.mimeType)
  if (!imageTypes[mimeType]) {
    throw mediaError('仅支持 JPEG、PNG、WebP 或 GIF 图片', 'MEDIA_TYPE_UNSUPPORTED')
  }
  const buffer = decodeBase64(input.dataBase64)
  const detected = detectedMimeType(buffer)
  if (!detected || detected !== mimeType) {
    throw mediaError('图片实际格式与声明格式不一致', 'MEDIA_SIGNATURE_MISMATCH')
  }
  return { mimeType, buffer, size:buffer.length, extension: imageTypes[mimeType].extension }
}
export async function writePreparedImage(filename,image,mode=0o600){
  if(image.filePath){await fs.copyFile(image.filePath,filename,constants.COPYFILE_EXCL);await fs.chmod(filename,mode)}
  else await fs.writeFile(filename,image.buffer,{flag:'wx',mode})
}

export class MediaService {
  constructor(config, database) {
    this.directory = config.mediaDir
    this.privateDirectory = path.join(config.mediaDir, 'private', 'manual-verifications')
    this.enterprisePrivateDirectory = path.join(config.mediaDir, 'private', 'enterprise-certifications')
    this.communityDirectory = path.join(config.mediaDir, 'private', 'community')
    this.database = database
    this.communityCleanupPromise = null
    this.communityCleanupTimer = null
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o750 })
    await fs.mkdir(this.privateDirectory, { recursive: true, mode: 0o700 })
    await fs.mkdir(this.enterprisePrivateDirectory, { recursive: true, mode: 0o700 })
    await fs.mkdir(this.communityDirectory, { recursive: true, mode: 0o700 })
    await fs.chmod(this.privateDirectory, 0o700)
    await fs.chmod(this.enterprisePrivateDirectory, 0o700)
    await fs.chmod(this.communityDirectory, 0o700)
    return this
  }

  async saveCommunity(input, accountId, metadata = {}) {
    const image=prepareImage(input),{mimeType,size,extension}=image
    const id = randomUUID()
    const filename = `${id}.${extension}`
    await writePreparedImage(path.join(this.communityDirectory,filename),image)
    try {
      return await this.database.transaction((data) => {
        const account = data.accounts.find((item) => item.id === accountId && item.status === 'active' && item.schoolIdentityVerified)
        if (!account) throw mediaError('请先完成实名认证', 'SCHOOL_IDENTITY_REQUIRED', 403)
        data.communityMedia ||= []
        const owned = data.communityMedia.filter((item) => item.ownerAccountId === accountId)
        if (owned.filter((item) => item.state === 'staged' && Date.parse(item.expiresAt) > Date.now()).length >= 30
          || owned.filter((item) => Date.parse(item.createdAt) > Date.now() - 86400000).length >= 90) {
          throw mediaError('上传图片过多，请先发布或删除草稿图片后再试', 'COMMUNITY_MEDIA_LIMIT', 429)
        }
        const createdAt = new Date().toISOString()
        data.communityMedia.push({ id, filename, mimeType, size, ownerAccountId: accountId, purpose: 'community-post', state: 'staged', postId: '', createdAt, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() })
        data.auditLogs.unshift(auditRecord('media.community_uploaded', id, { ...metadata, actor: accountId }, { mimeType, size }))
        return { id, mimeType, size, url: `/api/v1/business/community-media/${id}` }
      })
    } catch (error) { await this.removePrivateFrom(this.communityDirectory, filename).catch(() => {}); throw error }
  }

  async removeCommunityDraft(id, accountId) {
    const filename = await this.database.transaction((data) => {
      if (!data.accounts.some((item) => item.id === accountId && item.status === 'active' && item.schoolIdentityVerified)) throw mediaError('请先完成实名认证', 'SCHOOL_IDENTITY_REQUIRED', 403)
      const media = (data.communityMedia || []).find((item) => item.id === id && item.ownerAccountId === accountId)
      if (!media) throw mediaError('图片不存在', 'MEDIA_NOT_FOUND', 404)
      if (media.state === 'bound') throw mediaError('图片已随动态发布，不能删除草稿图片', 'COMMUNITY_MEDIA_BOUND', 409)
      media.state = 'deleted'
      return media.filename
    })
    await this.removePrivateFrom(this.communityDirectory, filename)
    return { deleted: true }
  }

  cleanupCommunityDrafts() {
    if (!this.communityCleanupPromise) this.communityCleanupPromise = this.performCommunityCleanup().finally(() => { this.communityCleanupPromise = null })
    return this.communityCleanupPromise
  }

  async performCommunityCleanup() {
    const files = await this.database.transaction((data) => {
      const expired = (data.communityMedia || []).filter((item) => item.state === 'deleted' || (item.state === 'staged' && Date.parse(item.expiresAt) <= Date.now()))
      for (const item of expired) item.state = 'deleted'
      return expired.map((item) => item.filename)
    })
    const pending = new Set(files)
    const failed = []
    // 事务失败或进程中断可能留下未登记文件；宽限 24 小时，避开正在上传的文件。
    try {
      for (const entry of await fs.readdir(this.communityDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !safeStoredFilename(entry.name) || pending.has(entry.name)) continue
        try {
          const stat = await fs.stat(path.join(this.communityDirectory, entry.name))
          if (stat.mtimeMs > Date.now() - 86400000) continue
          const registered = this.database.read(data => (data.communityMedia || []).some(item => item.filename === entry.name))
          if (!registered) pending.add(entry.name)
        } catch (error) { if (error.code !== 'ENOENT') failed.push(entry.name) }
      }
    } catch (error) { if (error.code !== 'ENOENT') failed.push('directory-scan') }
    for (const filename of pending) {
      try { await this.removePrivateFrom(this.communityDirectory, filename) }
      catch { failed.push(filename) } // 登记的 deleted 状态和未登记文件均留给下轮重试。
    }
    return { attempted: pending.size, failed }
  }

  startCommunityCleanupScheduler(onError = () => {}) {
    if (this.communityCleanupTimer) return
    this.communityCleanupTimer = setInterval(() => {
      this.cleanupCommunityDrafts().then(result => {
        if (result.failed.length) onError(new Error(`校园墙图片清理暂未完成 ${result.failed.length} 项，将自动重试`))
      }).catch(onError)
    }, 60 * 60 * 1000)
    this.communityCleanupTimer.unref?.()
  }

  async stopCommunityCleanupScheduler() {
    clearInterval(this.communityCleanupTimer)
    this.communityCleanupTimer = null
    await this.communityCleanupPromise?.catch(() => {})
  }

  async save(input = {}, metadata = {}) {
    const image=prepareImage(input),{mimeType,size,extension}=image
    const filename = `${randomUUID()}.${extension}`
    const filePath = path.join(this.directory, filename)
    await writePreparedImage(filePath,image,0o640)

    if (this.database) {
      await this.database.transaction((data) => {
        data.auditLogs ||= []
        data.auditLogs.unshift(auditRecord('media.uploaded', filename, metadata, {
            originalName: String(input.filename || '').trim().slice(0, 160),
            mimeType,
            size
          }))
      })
    }

    return {
      filename,
      mimeType,
      size,
      url: `/api/v1/media/${filename}`
    }
  }

  async savePrivateTo(directory, input = {}, metadata = {}, auditAction = 'media.private_uploaded') {
    const image=prepareImage(input),{mimeType,size,extension}=image
    const filename = `${randomUUID()}.${extension}`
    await writePreparedImage(path.join(directory,filename),image)

    if (this.database) {
      await this.database.transaction((data) => {
        data.auditLogs ||= []
        data.auditLogs.unshift(auditRecord(auditAction, metadata.applicationId || filename, { ...metadata, actor: metadata.actor || 'manual-verification-applicant' }, {
            materialId: metadata.materialId || '',
            mimeType,
            size
          }))
      })
    }

    return { filename, mimeType, size }
  }

  async savePrivate(input = {}, metadata = {}) {
    return this.savePrivateTo(this.privateDirectory, input, metadata, 'media.private_uploaded')
  }

  async saveEnterprisePrivate(input = {}, metadata = {}) {
    return this.savePrivateTo(
      this.enterprisePrivateDirectory,
      input,
      metadata,
      'media.enterprise_private_uploaded'
    )
  }

  async read(filename) {
    const safeFilename = safeStoredFilename(filename)
    if (!safeFilename) throw mediaError('图片不存在', 'MEDIA_NOT_FOUND', 404)
    const extension = path.extname(safeFilename).slice(1).toLowerCase()
    const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`
    try {
      await fs.access(path.join(this.directory,safeFilename))
      const buffer = createReadStream(path.join(this.directory,safeFilename))
      return { buffer, mimeType }
    } catch (error) {
      if (error?.code === 'ENOENT') throw mediaError('图片不存在', 'MEDIA_NOT_FOUND', 404)
      throw error
    }
  }

  async readPrivateFrom(directory, filename) {
    const safeFilename = safeStoredFilename(filename)
    if (!safeFilename) throw mediaError('证明材料不存在', 'MEDIA_NOT_FOUND', 404)
    const extension = path.extname(safeFilename).slice(1).toLowerCase()
    const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`
    try {
      await fs.access(path.join(directory,safeFilename))
      const buffer = createReadStream(path.join(directory,safeFilename))
      return { buffer, mimeType }
    } catch (error) {
      if (error?.code === 'ENOENT') throw mediaError('证明材料不存在', 'MEDIA_NOT_FOUND', 404)
      throw error
    }
  }

  async readPrivate(filename) {
    return this.readPrivateFrom(this.privateDirectory, filename)
  }

  async readEnterprisePrivate(filename) {
    return this.readPrivateFrom(this.enterprisePrivateDirectory, filename)
  }

  async removePrivateFrom(directory, filename) {
    const safeFilename = safeStoredFilename(filename)
    if (!safeFilename) return false
    try {
      await fs.unlink(path.join(directory, safeFilename))
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw error
    }
  }

  async removePrivate(filename) {
    return this.removePrivateFrom(this.privateDirectory, filename)
  }

  async removeEnterprisePrivate(filename) {
    return this.removePrivateFrom(this.enterprisePrivateDirectory, filename)
  }
}
