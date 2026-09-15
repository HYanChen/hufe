import { randomBytes } from 'node:crypto'
import { anonymousAvatars } from './community.js'

export function anonymousFlag(value) {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw Object.assign(new Error('匿名选项必须为是或否'), { statusCode: 400, code: 'COMMUNITY_ANONYMOUS_INVALID' })
  return value
}

export function createAnonymousIdentity() {
  const bytes = randomBytes(8)
  const adjectives = ['追光的', '听风的', '慢游的', '快乐的', '温柔的', '勇敢的', '漫步的', '闪亮的']
  const nouns = ['白鹭', '星河', '小鹿', '云朵', '橘子', '山雀', '海风', '蒲公英']
  return { name: `${adjectives[bytes[0] % 8]}${nouns[bytes[1] % 8]}·${bytes.subarray(2, 5).toString('hex').toUpperCase()}`, avatar: anonymousAvatars[bytes[5] % anonymousAvatars.length].key }
}

export function anonymousPresentation(record) {
  const identity = record.anonymousIdentity || {}
  const avatar = anonymousAvatars.find(item => item.key === identity.avatar) || anonymousAvatars[0]
  return { authorName: identity.name || '匿名湖财人', avatar: avatar.key, initials: avatar.symbol, anonymous: true }
}

export function anonymousPostView(record) {
  // Whitelist: additional legacy or future profile fields cannot escape through anonymous APIs.
  const safe = {}
  for (const key of ['id', 'resource', 'status', 'revision', 'content', 'topic', 'topics', 'images', 'mentions', 'visibility', 'createdAt', 'updatedAt', 'publishedAt', 'carouselPlacement', 'carouselSortOrder']) {
    if (record[key] !== undefined) safe[key] = record[key]
  }
  return { ...safe, ...anonymousPresentation(record), meta: '匿名发布', location: '身份已隐藏' }
}

export function anonymityAdminFields(record) {
  return { publicationMode: record.anonymous === true ? 'anonymous' : 'named', anonymousNickname: record.anonymous === true ? anonymousPresentation(record).authorName : '' }
}
