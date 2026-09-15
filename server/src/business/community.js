// 纯函数同时用于 API 与 uni-app，放在服务端发行目录内以支持独立部署。
export const communityLimits = Object.freeze({ content: 2000, images: 9, topics: 5, mentions: 10 })
export const anonymousAvatars = Object.freeze([
  { key: 'moon', symbol: '🌙', background: '#e9e6fa' },
  { key: 'leaf', symbol: '🌿', background: '#e0f2e9' },
  { key: 'wave', symbol: '🌊', background: '#e1effb' },
  { key: 'flower', symbol: '🌻', background: '#fcf0d5' },
  { key: 'kite', symbol: '🪁', background: '#fbe4ea' },
  { key: 'rainbow', symbol: '🌈', background: '#e8f2f5' }
])
export const suggestedCommunityTopics = ['校园表白', '校园日常', '失物招领', '校友互助', '同城活动', '行业交流', '校园记忆']

export function normalizeCommunityTopics(value = []) {
  if (!Array.isArray(value)) throw new Error('话题必须是列表')
  const topics = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('话题名称必须是文字')
    const name = item.normalize('NFKC').trim().replace(/^#+|#+$/g, '').trim()
    if (!name) continue
    if (!/^[\p{L}\p{N}_\-\u00b7]{1,20}$/u.test(name)) throw new Error('话题限 1–20 字，可用中英文、数字、下划线，不含空格')
    if (!topics.some((topic) => topic.toLocaleLowerCase() === name.toLocaleLowerCase())) topics.push(name)
  }
  if (topics.length > communityLimits.topics) throw new Error('每条动态最多添加 5 个话题')
  return topics
}

export function extractCommunityTopics(content = '') {
  return [...String(content).matchAll(/#([\p{L}\p{N}_\-\u00b7]+)/gu)].map((match) => match[1])
}

export function postTopics(post = {}) { return Array.isArray(post.topics) ? post.topics : (post.topic ? [post.topic] : []) }

export function communityDraftKey(accountId) { return `hufe_wall_draft_v2:${accountId}` }
