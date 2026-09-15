import { appConfig } from '../config/index'

const BLOCK_STYLES = Object.freeze({
  p: 'display:block;max-width:100%;margin:0 0 1em;padding:0;color:#3d495e;font-size:16px;line-height:1.9;text-align:justify;word-break:break-word;overflow-wrap:anywhere;white-space:normal;',
  h2: 'display:block;max-width:100%;margin:1.35em 0 .65em;color:#233149;font-size:21px;line-height:1.5;font-weight:700;word-break:break-word;overflow-wrap:anywhere;',
  h3: 'display:block;max-width:100%;margin:1.2em 0 .6em;color:#29374d;font-size:19px;line-height:1.55;font-weight:700;word-break:break-word;overflow-wrap:anywhere;',
  h4: 'display:block;max-width:100%;margin:1.05em 0 .55em;color:#314057;font-size:17px;line-height:1.6;font-weight:700;word-break:break-word;overflow-wrap:anywhere;',
  blockquote: 'display:block;max-width:100%;margin:1em 0;padding:.8em 1em;border-left:3px solid #c2a26b;background:#f7f3eb;color:#58667b;font-size:16px;line-height:1.8;word-break:break-word;overflow-wrap:anywhere;',
  ul: 'display:block;max-width:100%;margin:.8em 0;padding-left:1.4em;',
  ol: 'display:block;max-width:100%;margin:.8em 0;padding-left:1.55em;',
  li: 'max-width:100%;margin:.35em 0;color:#3d495e;font-size:16px;line-height:1.8;word-break:break-word;overflow-wrap:anywhere;'
})

const INLINE_STYLES = Object.freeze({
  strong: 'font-weight:700;',
  em: 'font-style:italic;',
  a: 'color:#064a9b;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;',
  img: 'display:block;width:100%;max-width:100%;height:auto;margin:12px auto;object-fit:contain;border:0;border-radius:8px;'
})

function textNode(text) {
  return { type: 'text', text: String(text || '') }
}

function elementNode(name, children = [], attrs = {}) {
  return { name, attrs, children }
}

function safeHttpUrl(value) {
  const candidate = String(value || '').trim()
  if (!/^https?:\/\//i.test(candidate) || candidate.length > 2048 || /[\u0000-\u0020\u007f<>"'\\]/.test(candidate)) return ''
  const authority = candidate.match(/^https?:\/\/([^/?#]+)/i)?.[1] || ''
  if (!authority || authority.includes('@')) return ''
  return candidate
}

function safePlatformRoute(value) {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/pages/') || candidate.includes('..') || /[\u0000-\u0020\u007f<>"'\\]/.test(candidate)) return ''
  return /^\/pages\/[A-Za-z0-9/_-]+(?:[?#][A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/.test(candidate) ? candidate : ''
}

function safeLinkUrl(value) {
  const candidate = String(value || '').trim()
  const httpUrl = safeHttpUrl(candidate)
  if (httpUrl) return httpUrl
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(candidate)) return candidate
  if (/^tel:\+?[0-9 ()-]{5,30}$/i.test(candidate)) return candidate
  if (/^#[A-Za-z][\w:.-]{0,127}$/.test(candidate)) return candidate
  return safePlatformRoute(candidate)
}

function safeImageUrl(value) {
  const candidate = String(value || '').trim()
  const httpUrl = safeHttpUrl(candidate)
  if (httpUrl) return httpUrl
  if (!/^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp|gif)$/i.test(candidate)) return ''
  return appConfig.apiBaseUrl ? `${appConfig.apiBaseUrl}${candidate}` : candidate
}

function destinationFrom(value) {
  const source = String(value || '').trim()
  const titled = source.match(/^(\S+?)(?:\s+["'][^"']*["'])?$/)
  return titled ? titled[1] : source
}

function closingParenthesis(source, start) {
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1
      continue
    }
    if (source[index] === '(') depth += 1
    if (source[index] === ')') {
      if (depth === 0) return index
      depth -= 1
    }
  }
  return -1
}

function bracketToken(source, start, image = false) {
  const labelStart = start + (image ? 2 : 1)
  const labelEnd = source.indexOf('](', labelStart)
  if (labelEnd < 0) return null
  const targetStart = labelEnd + 2
  const targetEnd = closingParenthesis(source, targetStart)
  if (targetEnd < 0) return null
  return {
    label: source.slice(labelStart, labelEnd),
    target: destinationFrom(source.slice(targetStart, targetEnd)),
    end: targetEnd + 1
  }
}

function appendText(nodes, buffer) {
  if (!buffer.value) return
  nodes.push(textNode(buffer.value))
  buffer.value = ''
}

function parseInline(source, depth = 0) {
  const input = String(source || '')
  if (!input || depth > 8) return input ? [textNode(input)] : []
  const nodes = []
  const buffer = { value: '' }
  let index = 0

  while (index < input.length) {
    if (input[index] === '\\' && index + 1 < input.length && /[\\`*_[\]()!]/.test(input[index + 1])) {
      buffer.value += input[index + 1]
      index += 2
      continue
    }

    if (input.startsWith('![', index)) {
      const token = bracketToken(input, index, true)
      if (token) {
        appendText(nodes, buffer)
        const url = safeImageUrl(token.target)
        if (url) {
          nodes.push(elementNode('img', [], {
            src: url,
            alt: token.label || '正文图片',
            style: INLINE_STYLES.img
          }))
        } else if (token.label) {
          nodes.push(textNode(`【图片：${token.label}】`))
        }
        index = token.end
        continue
      }
    }

    if (input[index] === '[') {
      const token = bracketToken(input, index)
      if (token) {
        appendText(nodes, buffer)
        const url = safeLinkUrl(token.target)
        const labelNodes = parseInline(token.label || token.target, depth + 1)
        if (url) {
          const external = /^https?:/i.test(url)
          nodes.push(elementNode('a', labelNodes, {
            href: url,
            ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
            style: INLINE_STYLES.a
          }))
        } else {
          nodes.push(...labelNodes)
        }
        index = token.end
        continue
      }
    }

    const boldMarker = input.startsWith('**', index) ? '**' : (input.startsWith('__', index) ? '__' : '')
    if (boldMarker) {
      const end = input.indexOf(boldMarker, index + 2)
      if (end > index + 2) {
        appendText(nodes, buffer)
        nodes.push(elementNode('strong', parseInline(input.slice(index + 2, end), depth + 1), { style: INLINE_STYLES.strong }))
        index = end + 2
        continue
      }
    }

    const italicMarker = input[index] === '*' || input[index] === '_' ? input[index] : ''
    if (italicMarker && input[index + 1] && !/\s/.test(input[index + 1])) {
      const end = input.indexOf(italicMarker, index + 1)
      if (end > index + 1) {
        appendText(nodes, buffer)
        nodes.push(elementNode('em', parseInline(input.slice(index + 1, end), depth + 1), { style: INLINE_STYLES.em }))
        index = end + 1
        continue
      }
    }

    buffer.value += input[index]
    index += 1
  }

  appendText(nodes, buffer)
  return nodes
}

function linesToInline(lines) {
  const children = []
  lines.forEach((line, index) => {
    if (index) children.push(elementNode('br'))
    children.push(...parseInline(line))
  })
  return children
}

function isBlockStart(line) {
  return /^(?:#{1,4}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/.test(line)
}

export function markdownToNodes(value = '') {
  const source = String(value || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim()
  if (!source) return []
  const lines = source.split('\n')
  const nodes = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4)
      const name = `h${level}`
      nodes.push(elementNode(name, parseInline(heading[2]), { style: BLOCK_STYLES[name] }))
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      nodes.push(elementNode('blockquote', linesToInline(quoteLines), { style: BLOCK_STYLES.blockquote }))
      continue
    }

    const unordered = line.match(/^[-+*]\s+(.+)$/)
    const ordered = line.match(/^\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      const name = unordered ? 'ul' : 'ol'
      const matcher = unordered ? /^[-+*]\s+(.+)$/ : /^\d+[.)]\s+(.+)$/
      const items = []
      while (index < lines.length) {
        const item = lines[index].match(matcher)
        if (!item) break
        items.push(elementNode('li', parseInline(item[1]), { style: BLOCK_STYLES.li }))
        index += 1
      }
      nodes.push(elementNode(name, items, { style: BLOCK_STYLES[name] }))
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index])
      index += 1
    }
    nodes.push(elementNode('p', linesToInline(paragraphLines), { style: BLOCK_STYLES.p }))
  }

  return nodes
}

function nodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.name === 'br') return '\n'
  if (node.name === 'img') return node.attrs?.alt ? `图片：${node.attrs.alt}` : ''
  const content = (node.children || []).map(nodeText).join('')
  return ['p', 'h2', 'h3', 'h4', 'blockquote', 'li'].includes(node.name) ? `${content}\n` : content
}

export function markdownToPlainText(value = '', options = {}) {
  const { maxLength = 0, singleLine = false } = options
  let text = markdownToNodes(value).map(nodeText).join('').replace(/\n{3,}/g, '\n\n').trim()
  if (singleLine) text = text.replace(/\s+/g, ' ').trim()
  if (maxLength > 0 && text.length > maxLength) text = `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
  return text
}

export function isSafeBusinessUrl(value = '') {
  return Boolean(safeLinkUrl(value))
}

export function markdownImages(value = '') {
  const images = new Map()
  function visit(node) {
    if (node.name === 'img' && node.attrs?.src && !images.has(node.attrs.src)) {
      images.set(node.attrs.src, { url: node.attrs.src, caption: node.attrs.alt || '组织照片' })
    }
    for (const child of node.children || []) visit(child)
  }
  for (const node of markdownToNodes(value)) visit(node)
  return [...images.values()]
}
