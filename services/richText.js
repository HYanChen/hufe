const tagStyles = {
  p: 'display:block;max-width:100%;margin:0 0 1em;padding:0;color:#3d495e;font-size:16px;line-height:1.9;text-align:justify;word-break:break-word;overflow-wrap:anywhere;white-space:normal;',
  span: 'max-width:100%;color:inherit;font-size:inherit;line-height:inherit;word-break:break-word;overflow-wrap:anywhere;white-space:normal;',
  strong: 'font-weight:700;',
  b: 'font-weight:700;',
  em: 'font-style:italic;',
  i: 'font-style:italic;',
  h2: 'display:block;max-width:100%;margin:1.4em 0 .7em;color:#233149;font-size:21px;line-height:1.5;font-weight:700;word-break:break-word;',
  h3: 'display:block;max-width:100%;margin:1.25em 0 .65em;color:#29374d;font-size:19px;line-height:1.55;font-weight:700;word-break:break-word;',
  h4: 'display:block;max-width:100%;margin:1.1em 0 .6em;color:#314057;font-size:17px;line-height:1.6;font-weight:700;word-break:break-word;',
  blockquote: 'display:block;max-width:100%;margin:1em 0;padding:.8em 1em;border-left:3px solid #c2a26b;background:#f7f3eb;color:#58667b;line-height:1.8;word-break:break-word;',
  ul: 'display:block;max-width:100%;margin:.8em 0;padding-left:1.4em;',
  ol: 'display:block;max-width:100%;margin:.8em 0;padding-left:1.4em;',
  li: 'max-width:100%;margin:.35em 0;color:#3d495e;font-size:16px;line-height:1.8;word-break:break-word;overflow-wrap:anywhere;',
  a: 'max-width:100%;color:#064a9b;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;',
  img: 'display:block;width:auto;max-width:100%;height:auto;margin:12px auto;object-fit:contain;border:0;',
  table: 'display:table;width:100%;max-width:100%;margin:14px 0;border-collapse:collapse;border-spacing:0;table-layout:fixed;color:#3d495e;font-size:14px;line-height:1.6;',
  thead: 'display:table-header-group;',
  tbody: 'display:table-row-group;',
  tr: 'display:table-row;',
  th: 'display:table-cell;max-width:100%;padding:8px 6px;border:1px solid #dce2eb;background:#eef2f7;font-weight:700;text-align:left;vertical-align:top;white-space:normal;word-break:break-word;overflow-wrap:anywhere;',
  td: 'display:table-cell;max-width:100%;padding:8px 6px;border:1px solid #dce2eb;text-align:left;vertical-align:top;white-space:normal;word-break:break-word;overflow-wrap:anywhere;'
}

const allowedAttributes = Object.freeze({
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title']),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan'])
})

function decodeForScheme(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);?/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&colon;/gi, ':')
}

function isSafeUrl(value, tag) {
  const compact = decodeForScheme(value).trim().replace(/[\u0000-\u0020\u007f]+/g, '')
  if (!compact) return false
  if (/^(?:https?:)?\/\//i.test(compact) || /^(?:\/|\.\/|\.\.\/|#)/.test(compact)) return true
  if (tag === 'a' && /^(?:mailto|tel):/i.test(compact)) return true
  return !/^[a-z][a-z\d+.-]*:/i.test(compact)
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function cleanAttributes(attributes = '', tag = '') {
  const allowed = allowedAttributes[tag] || new Set()
  const cleaned = []
  String(attributes).replace(/([:\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, (_, rawName, rawValue) => {
    const name = String(rawName).toLowerCase()
    if (!allowed.has(name)) return ''
    const value = String(rawValue).replace(/^(?:"|')|(?:"|')$/g, '')
    if ((name === 'href' || name === 'src') && !isSafeUrl(value, tag)) return ''
    if ((name === 'colspan' || name === 'rowspan') && !/^\d{1,2}$/.test(value)) return ''
    cleaned.push(` ${name}="${escapeAttribute(value)}"`)
    return ''
  })
  return cleaned.join('')
}

function applyInlineStyle(html, tag, style) {
  const expression = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi')
  return html.replace(expression, (_, attributes = '') => `<${tag}${cleanAttributes(attributes, tag)} style="${style}">`)
}

export function normalizeOfficialHtml(value = '') {
  let html = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form|svg|math)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(input|button|video|audio|link|meta|base)[^>]*\/?\s*>/gi, '')
    .replace(/\s(?:style|class|id|width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  // 官网编辑器经常产生多层空 span/p，先压缩空节点，避免不同端出现大段空白。
  for (let index = 0; index < 3; index += 1) {
    html = html.replace(/<(span|strong|b|em|i|p)[^>]*>(?:\s|&nbsp;|<br\s*\/?\s*>)*<\/\1>/gi, '')
  }

  Object.entries(tagStyles).forEach(([tag, style]) => { html = applyInlineStyle(html, tag, style) })
  return html
}
