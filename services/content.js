import { publicRequest } from './http'

export const contentCategories = [
  { key: '', label: '全部' },
  { key: 'news', label: '学校要闻' },
  { key: 'notices', label: '通知公告' },
  { key: 'academic', label: '学术动态' },
  { key: 'alumni', label: '校友活动' },
  { key: 'alumniStories', label: '校友风采' },
  { key: 'alumniServices', label: '校友服务' }
]

export function getBrand() {
  return publicRequest({ path: '/api/v1/brand' })
}

export function getOfficialHome() {
  return publicRequest({ path: '/api/v1/content/home' })
}

export function getOfficialContent({ category = '', page = 1, pageSize = 12 } = {}) {
  return publicRequest({
    path: '/api/v1/content',
    data: { ...(category ? { category } : {}), page, pageSize }
  })
}

export function getOfficialContentDetail(id) {
  return publicRequest({ path: `/api/v1/content/${encodeURIComponent(id)}` })
}

export function getSyncStatus() {
  return publicRequest({ path: '/api/v1/sync/status' })
}

export function formatOfficialItem(item, index = 0) {
  const published = String(item.publishedAt || '')
  return {
    ...item,
    id: item.id,
    category: item.categoryLabel || item.sourceSection || '官网资讯',
    date: published ? published.slice(5).replace('-', '.') : '',
    summary: item.summary || '来源：湖南财政经济学院官网',
    tone: ['blue', 'gold', 'green', 'red'][index % 4],
    official: true
  }
}
