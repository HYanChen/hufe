import fs from 'node:fs/promises'
import path from 'node:path'
import { officialContentSources } from './sources.js'
import { discoverPaginationUrls, parseOfficialDetail, parseOfficialList } from './parser.js'
import { openDatabase } from '../storage/database.js'

const emptySnapshot = () => ({
  version: 1,
  generatedAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  stale: true,
  sourceStatuses: [],
  items: []
})

function publicSummaryItem(item) {
  const { contentHtml, contentText, attachments, contentHash, detailSyncedAt, ...summary } = item
  return summary
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'HUFE-Alumni-Official-Content-Sync/0.2 (+school integration; public pages only)',
      accept: 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`)
  return response.text()
}

export class ContentService {
  constructor(config, options = {}) {
    this.config = config
    this.sources = options.sources || officialContentSources
    this.fetchText = options.fetchText || fetchText
    this.snapshot = emptySnapshot()
    this.timer = null
    this.refreshPromise = null
  }

  async init({ refresh = true } = {}) {
    if (this.config.databaseDriver === 'mysql') this.store = await openDatabase(this.config, { namespace: 'content' })
    await this.loadCache()
    if (refresh) {
      try { await this.refresh() } catch (error) { console.warn('[content] 首次同步失败，将使用缓存：', error.message) }
    }
    return this.snapshot
  }

  startScheduler() {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.refresh().catch((error) => console.warn('[content] 定时同步失败：', error.message))
    }, this.config.content.syncIntervalMs)
    this.timer.unref?.()
  }

  stopScheduler() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async close() {
    this.stopScheduler()
    await this.refreshPromise?.catch(() => {})
    await this.store?.close()
  }

  async loadCache() {
    try {
      const parsed = this.store ? this.store.read() : JSON.parse(await fs.readFile(this.config.content.cacheFile, 'utf8'))
      if (Array.isArray(parsed.items)) {
        const items = parsed.items.map((item) => {
          if (!item.contentHtml || !item.sourceUrl) return item
          // 旧缓存可能带有官网编辑器固定宽高。每次启动都重新经过当前清洗器，
          // 确保升级响应式规则后无需等待上游文章变化即可在各端生效。
          const normalized = parseOfficialDetail(
            `<div id="vsb_content"><div class="v_news_content">${item.contentHtml}</div></div>`,
            item,
            item.detailSyncedAt || parsed.generatedAt || new Date().toISOString()
          )
          return { ...item, contentHtml: normalized.contentHtml }
        })
        this.snapshot = { ...emptySnapshot(), ...parsed, items, stale: true }
      } else if (this.store) throw Object.assign(new Error('MySQL 官网内容缓存结构无效，请核查迁移快照'), { code: 'MYSQL_CONTENT_NOT_MIGRATED', statusCode: 503 })
    } catch (error) {
      if (this.store) throw error
      if (error.code !== 'ENOENT') console.warn('[content] 缓存读取失败：', error.message)
    }
    return this.snapshot
  }

  async writeCache(value = this.snapshot) {
    if (this.store) {
      const snapshot = structuredClone(value)
      await this.store.transaction(d => { for (const key of Object.keys(d)) delete d[key]; Object.assign(d, snapshot) })
      return
    }
    await fs.mkdir(path.dirname(this.config.content.cacheFile), { recursive: true })
    const temporary = `${this.config.content.cacheFile}.${process.pid}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, this.config.content.cacheFile)
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.performRefresh().finally(() => { this.refreshPromise = null })
    return this.refreshPromise
  }

  async performRefresh() {
    const attemptedAt = new Date().toISOString()
    const results = await Promise.all(this.sources.map(async (source) => {
      try {
        const html = await this.fetchText(source.url, this.config.content.requestTimeoutMs)
        const pageUrls = discoverPaginationUrls(html, source, this.config.content.syncPages)
        const extraPages = await Promise.all(pageUrls.map((url) => this.fetchText(url, this.config.content.requestTimeoutMs).catch(() => '')))
        let items = [html, ...extraPages].flatMap((pageHtml) => pageHtml ? parseOfficialList(pageHtml, { ...source, limit: source.limit }, attemptedAt) : [])
        items = [...new Map(items.map((item) => [item.id, item])).values()]
        if (!items.length) throw new Error('页面结构未匹配到内容')
        const cachedByUrl = new Map(this.snapshot.items.map((item) => [item.sourceUrl, item]))
        items = await Promise.all(items.map(async (item, index) => {
          const cached = cachedByUrl.get(item.sourceUrl)
          if (cached?.contentHash) return { ...cached, ...item, summary: item.summary || cached.summary, contentHtml: cached.contentHtml, contentText: cached.contentText, attachments: cached.attachments, contentHash: cached.contentHash, detailSyncedAt: cached.detailSyncedAt }
          if (index >= this.config.content.detailLimitPerSource) return item
          try {
            const detailUrl = new URL(item.sourceUrl)
            if (!['www.hufe.edu.cn', 'news.hufe.edu.cn'].includes(detailUrl.hostname)) return item
            const detailHtml = await this.fetchText(item.sourceUrl, this.config.content.requestTimeoutMs)
            return parseOfficialDetail(detailHtml, item, attemptedAt)
          } catch {
            return item
          }
        }))
        return { source, items, ok: true }
      } catch (error) {
        return { source, items: [], ok: false, error: error.message }
      }
    }))

    const previousBySource = new Map()
    for (const item of this.snapshot.items) {
      const bucket = previousBySource.get(item.listUrl) || []
      bucket.push(item)
      previousBySource.set(item.listUrl, bucket)
    }

    const merged = []
    const sourceStatuses = []
    let successCount = 0
    for (const result of results) {
      if (result.ok) {
        successCount += 1
        merged.push(...result.items)
      } else {
        merged.push(...(previousBySource.get(result.source.url) || []))
      }
      sourceStatuses.push({
        id: result.source.id,
        name: result.source.name,
        category: result.source.category,
        url: result.source.url,
        ok: result.ok,
        itemCount: result.ok ? result.items.length : (previousBySource.get(result.source.url) || []).length,
        error: result.error || null,
        syncedAt: result.ok ? attemptedAt : null
      })
    }

    const unique = [...new Map(merged.map((item) => [item.id, item])).values()]
    const anySuccess = successCount > 0
    const nextSnapshot = {
      ...this.snapshot,
      version: 1,
      generatedAt: attemptedAt,
      lastAttemptAt: attemptedAt,
      lastSuccessAt: anySuccess ? attemptedAt : this.snapshot.lastSuccessAt,
      stale: successCount !== this.sources.length,
      sourceStatuses,
      items: unique
    }
    if (anySuccess) await this.writeCache(nextSnapshot)
    this.snapshot = nextSnapshot
    if (!anySuccess && !this.snapshot.items.length) throw new Error('所有官网内容源同步失败，且没有可用缓存')
    return this.snapshot
  }

  status() {
    const { items, ...status } = this.snapshot
    return { ...status, itemCount: items.length }
  }

  home() {
    const take = (category, limit = 4) => this.snapshot.items
      .filter((item) => item.category === category)
      .slice(0, limit)
      .map(publicSummaryItem)
    return {
      status: this.status(),
      sections: {
        news: take('news'),
        notices: take('notices'),
        academic: take('academic'),
        alumni: take('alumni'),
        alumniStories: take('alumniStories')
      }
    }
  }

  list({ category, page = 1, pageSize = this.config.content.pageSize } = {}) {
    const filtered = category ? this.snapshot.items.filter((item) => item.category === category) : this.snapshot.items
    const safePage = Math.max(1, Number(page) || 1)
    const safeSize = Math.min(50, Math.max(1, Number(pageSize) || this.config.content.pageSize))
    const start = (safePage - 1) * safeSize
    return { items: filtered.slice(start, start + safeSize).map(publicSummaryItem), total: filtered.length, page: safePage, pageSize: safeSize, status: this.status() }
  }

  find(id) {
    return this.snapshot.items.find((item) => item.id === id) || null
  }

  async get(id) {
    const item = this.find(id)
    if (!item || item.contentHash) return item
    const url = new URL(item.sourceUrl)
    if (!['www.hufe.edu.cn', 'news.hufe.edu.cn'].includes(url.hostname)) return item
    try {
      const html = await this.fetchText(item.sourceUrl, this.config.content.requestTimeoutMs)
      const enriched = parseOfficialDetail(html, item, new Date().toISOString())
      const nextSnapshot = { ...this.snapshot, items: this.snapshot.items.map((candidate) => candidate.id === id ? enriched : candidate) }
      await this.writeCache(nextSnapshot)
      this.snapshot = nextSnapshot
      return enriched
    } catch {
      return item
    }
  }
}
