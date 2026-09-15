import crypto from 'node:crypto'
import * as cheerio from 'cheerio'
import sanitizeHtml from 'sanitize-html'
import { categoryLabels } from './sources.js'

function clean(value = '') {
  return String(value).replace(/[\u00a0\s]+/g, ' ').trim()
}

function absoluteUrl(value, baseUrl) {
  if (!value || /^(javascript:|mailto:|tel:|#)/i.test(value)) return ''
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return ''
  }
}

function dateFrom(text) {
  const match = clean(text).match(/(?:20\d{2})[./年-](?:1[0-2]|0?[1-9])[./月-](?:3[01]|[12]\d|0?[1-9])日?(?!\d)/)
  return match ? match[0].replace(/[./年月]/g, '-').replace(/日$/, '') : ''
}

function publishedFor($context) {
  const direct = dateFrom($context.find('time,.date,.dtime,.time,.fbt').first().text()) || dateFrom($context.text())
  if (direct) return direct
  const year = clean($context.find('.tx-date b').first().text()).match(/20\d{2}/)?.[0]
  const monthDay = clean($context.find('.tx-date span').first().text()).match(/(1[0-2]|0?[1-9])[./月-](3[01]|[12]\d|0?[1-9])/)
  if (!year || !monthDay) return ''
  return `${year}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`
}

function titleFor($, anchor) {
  const $anchor = $(anchor)
  const nested = clean($anchor.find('h1,h2,h3,h4,h5,.title,.tit').first().text())
  const title = clean($anchor.attr('title')) || nested || clean($anchor.clone().find('time,.date,.dtime,img').remove().end().text())
  return title.replace(/^[-—·|\s]+|[-—·|\s]+$/g, '')
}

function contextFor($, anchor) {
  const $anchor = $(anchor)
  const $context = $anchor.closest('li,article,.item,.news-item,.a').first()
  return $context.length ? $context : $anchor.parent()
}

function summaryFor($, anchor, title) {
  const $context = contextFor($, anchor)
  const candidate = clean($context.find('p,.summary,.desc,.intro,.text,.txt').first().text())
  if (!candidate || candidate === title || candidate.length > 260) return ''
  return candidate.slice(0, 160)
}

function imageFor($, anchor, baseUrl) {
  const $context = contextFor($, anchor)
  const $image = $(anchor).find('img').first().length ? $(anchor).find('img').first() : $context.find('img').first()
  const source = $image.attr('data-src') || $image.attr('data-original') || $image.attr('src') || ''
  return absoluteUrl(source, baseUrl)
}

function sourceId(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 20)
}

function matchesSource(url, source) {
  let pathname = ''
  try { pathname = new URL(url).pathname } catch { return false }
  if (!pathname.includes('/info/')) return false
  if (source.pathIncludes.some((part) => pathname.includes(part))) return true
  return Boolean(source.allowAnyInfoPath)
}

export function parseOfficialList(html, source, syncedAt = new Date().toISOString()) {
  const $ = cheerio.load(html)
  const seen = new Set()
  const items = []

  $('a[href]').each((_, anchor) => {
    if (items.length >= source.limit) return false
    const url = absoluteUrl($(anchor).attr('href'), source.url)
    if (!url || seen.has(url) || !matchesSource(url, source)) return

    const title = titleFor($, anchor)
    if (title.length < 4 || title.length > 120) return

    const $context = contextFor($, anchor)
    const publishedAt = publishedFor($context)
    seen.add(url)
    items.push({
      id: sourceId(url),
      category: source.category,
      categoryLabel: categoryLabels[source.category] || source.name,
      title,
      summary: summaryFor($, anchor, title),
      publishedAt,
      imageUrl: imageFor($, anchor, source.url),
      sourceName: '湖南财政经济学院官网',
      sourceSection: source.name,
      sourceUrl: url,
      listUrl: source.url,
      syncedAt
    })
  })

  return items
}

export function discoverPaginationUrls(html, source, pageCount = 2) {
  if (pageCount <= 1) return []
  const $ = cheerio.load(html)
  const base = new URL(source.url)
  const candidates = []
  $('a[href]').each((_, anchor) => {
    const value = absoluteUrl($(anchor).attr('href'), source.url)
    if (!value) return
    const url = new URL(value)
    if (url.origin !== base.origin) return
    const match = url.pathname.match(/\/(\d+)\.htm$/)
    if (!match) return
    candidates.push({ url: url.toString(), page: Number(match[1]) })
  })
  return [...new Map(candidates.map((item) => [item.url, item])).values()]
    .sort((left, right) => right.page - left.page)
    .slice(0, pageCount - 1)
    .map((item) => item.url)
}

const allowedTags = ['p', 'span', 'strong', 'b', 'em', 'i', 'u', 'br', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'h2', 'h3', 'h4']

export function parseOfficialDetail(html, item, syncedAt = new Date().toISOString()) {
  const $ = cheerio.load(html)
  $('script,style,iframe,input,button,object,embed').remove()
  const $content = $('#vsb_content .v_news_content').first().length
    ? $('#vsb_content .v_news_content').first()
    : $('.v_news_content').first().length
      ? $('.v_news_content').first()
      : $('.art-main #vsb_content').first()

  if (!$content.length) return { ...item, detailSyncedAt: null }
  $content.find('a[href],img').each((_, node) => {
    const $node = $(node)
    const attribute = node.tagName === 'a' ? 'href' : 'src'
    const value = $node.attr(attribute) || $node.attr('data-src') || $node.attr('data-original')
    const resolved = absoluteUrl(value, item.sourceUrl)
    if (resolved) $node.attr(attribute, resolved)
    else $node.removeAttr(attribute)
    $node.removeAttr('style').removeAttr('id').removeAttr('class')
  })
  $content.find('[style],[class],[id],[width],[height],[align],[cellspacing],[cellpadding]').each((_, node) => {
    $(node)
      .removeAttr('style').removeAttr('class').removeAttr('id')
      .removeAttr('width').removeAttr('height').removeAttr('align')
      .removeAttr('cellspacing').removeAttr('cellpadding')
  })
  const rawHtml = $content.html() || ''
  const contentHtml = sanitizeHtml(rawHtml, {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'style'], img: ['src', 'alt', 'style'],
      p: ['style'], span: ['style'], blockquote: ['style'], ul: ['style'], ol: ['style'], li: ['style'],
      h2: ['style'], h3: ['style'], h4: ['style'], table: ['style'], tr: ['style'],
      th: ['colspan', 'rowspan', 'style'], td: ['colspan', 'rowspan', 'style']
    },
    allowedSchemes: ['https', 'http'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { href: attribs.href || '', title: attribs.title || '', rel: 'noopener noreferrer', style: 'max-width:100%;color:#064a9b;word-break:break-all;overflow-wrap:anywhere;' } }),
      p: (tagName) => ({ tagName, attribs: { style: 'display:block;max-width:100%;margin:0 0 1em;line-height:1.9;text-align:justify;word-break:break-word;overflow-wrap:anywhere;white-space:normal;' } }),
      span: (tagName) => ({ tagName, attribs: { style: 'max-width:100%;word-break:break-word;overflow-wrap:anywhere;white-space:normal;' } }),
      img: (tagName, attribs) => ({ tagName, attribs: { src: attribs.src || '', alt: attribs.alt || '', style: 'display:block;width:auto;max-width:100%;height:auto;margin:12px auto;object-fit:contain;border:0;' } }),
      table: (tagName) => ({ tagName, attribs: { style: 'display:table;width:100%;max-width:100%;margin:14px 0;border-collapse:collapse;border-spacing:0;table-layout:fixed;' } }),
      th: (tagName, attribs) => ({ tagName, attribs: { colspan: attribs.colspan || '', rowspan: attribs.rowspan || '', style: 'padding:8px 6px;border:1px solid #dce2eb;background:#eef2f7;text-align:left;vertical-align:top;white-space:normal;word-break:break-word;overflow-wrap:anywhere;' } }),
      td: (tagName, attribs) => ({ tagName, attribs: { colspan: attribs.colspan || '', rowspan: attribs.rowspan || '', style: 'padding:8px 6px;border:1px solid #dce2eb;text-align:left;vertical-align:top;white-space:normal;word-break:break-word;overflow-wrap:anywhere;' } })
    }
  })
  const contentText = clean($content.text()).slice(0, 20_000)
  const attachments = []
  $content.find('a[href]').each((_, anchor) => {
    const href = absoluteUrl($(anchor).attr('href'), item.sourceUrl)
    if (/\/system\/_content\/download\.jsp|\.(pdf|docx?|xlsx?|pptx?|zip)(?:$|\?)/i.test(href)) {
      attachments.push({ title: clean($(anchor).text()) || '附件', url: href })
    }
  })
  return {
    ...item,
    summary: item.summary || contentText.slice(0, 120),
    contentHtml,
    contentText,
    attachments,
    contentHash: crypto.createHash('sha256').update(`${item.title}\n${contentText}`).digest('hex'),
    detailSyncedAt: syncedAt
  }
}
