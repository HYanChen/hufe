import { createHash } from 'node:crypto'

export const MYSQL_STORE_SCHEMA_VERSION = 1

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export const sha256 = value => createHash('sha256').update(value).digest('hex')

export function normalizeSnapshot(value) {
  const normalized = JSON.parse(JSON.stringify(value))
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') throw new Error('数据库快照必须为 JSON 对象')
  return normalized
}

export const canonicalSnapshotHash = value => sha256(canonicalJson(normalizeSnapshot(value)))

// Retain SHA-256's streaming state immediately before an append-only array's
// closing bracket. Hash.copy() lets an append produce the EXACT ordinary
// canonical snapshot hash without re-serializing historical records. The suffix
// retains all later root properties, so unknown metadata remains covered too.
export function createArrayAppendHash(snapshot, field) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot[field]) || !Object.hasOwn(snapshot, field)) throw new Error('追加集合必须为快照顶层数组')
  const keys = Object.keys(snapshot).sort(), position = keys.indexOf(field)
  const property = key => `${JSON.stringify(key)}:${canonicalJson(snapshot[key])}`
  const before = keys.slice(0, position).map(property)
  const after = keys.slice(position + 1).map(property)
  const prefix = createHash('sha256').update(`{${before.length ? before.join(',') + ',' : ''}${JSON.stringify(field)}:[`)
  for (let index = 0; index < snapshot[field].length; index++) {
    if (index) prefix.update(',')
    prefix.update(canonicalJson(snapshot[field][index]))
  }
  const suffix = `]${after.length ? ',' + after.join(',') : ''}}`
  return { prefix, suffix, count: snapshot[field].length }
}

export function advanceArrayAppendHash(state, canonicalPayload) {
  const prefix = state.prefix.copy()
  if (state.count) prefix.update(',')
  prefix.update(canonicalPayload)
  const next = { prefix, suffix: state.suffix, count: state.count + 1 }
  return { state: next, hash: prefix.copy().update(next.suffix).digest('hex') }
}

// Each logical array is a SQL collection; each account/message/business record is
// a separate SQL row. Nested fields inside a record remain lossless JSON. The
// structural layout retains empty collections, scalar settings and unknown keys.
export function decomposeSnapshot(input) {
  const data = normalizeSnapshot(input)
  const collections = new Map()
  const visit = (value, pointer) => {
    if (Array.isArray(value)) {
      const id = sha256(pointer)
      const counts = new Map()
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item) && ['string', 'number'].includes(typeof item.id)) {
          const key = canonicalJson(item.id)
          counts.set(key, (counts.get(key) || 0) + 1)
        }
      }
      const rows = value.map((item, ordinal) => {
        const naturalId = item && typeof item === 'object' && !Array.isArray(item) && ['string', 'number'].includes(typeof item.id) ? canonicalJson(item.id) : null
        const key = sha256(naturalId !== null && counts.get(naturalId) === 1 ? `id:${naturalId}` : `ordinal:${ordinal}`)
        const payload = canonicalJson(item)
        return { key, ordinal, payload, hash: sha256(payload) }
      })
      collections.set(id, { id, path: pointer, rows })
      return { kind: 'collection', id }
    }
    if (value && typeof value === 'object') return { kind: 'object', entries: Object.entries(value).map(([key, item]) => [key, visit(item, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)]) }
    return { kind: 'value', value }
  }
  const layout = visit(data, '')
  return { data, layout, collections, hash: canonicalSnapshotHash(data) }
}

export function reconstructSnapshot(layout, collections) {
  const used = new Set()
  const visit = node => {
    if (!node || typeof node !== 'object') throw new Error('数据库结构损坏')
    if (node.kind === 'value') return node.value
    if (node.kind === 'collection') {
      const collection = collections.get(node.id)
      if (!collection || used.has(node.id)) throw new Error('数据库集合缺失或重复')
      used.add(node.id)
      return collection.rows.map((row, index) => {
        if (!Number.isSafeInteger(row.ordinal) || (index > 0 && row.ordinal <= collection.rows[index - 1].ordinal) || sha256(row.payload) !== row.hash) throw new Error('数据库记录顺序或校验值不一致')
        return JSON.parse(row.payload)
      })
    }
    if (node.kind === 'object' && Array.isArray(node.entries)) {
      const result = Object.create(null)
      for (const [key, child] of node.entries) {
        if (Object.hasOwn(result, key)) throw new Error('数据库对象属性重复')
        result[key] = visit(child)
      }
      return result
    }
    throw new Error('数据库结构版本不受支持')
  }
  const result = normalizeSnapshot(visit(layout))
  if (used.size !== collections.size) throw new Error('数据库存在未引用的集合')
  return result
}

// Sparse, signed order keys keep audit-log prepends and message appends to a
// single INSERT instead of rewriting every existing row's array index.
export function allocateRecordOrder(rows, previous = new Map()) {
  const step = 1024
  const rebalance = () => new Map(rows.map((row, index) => [row.key, index * step]))
  const known = rows.map((row, index) => previous.has(row.key) ? { index, rank: previous.get(row.key) } : null).filter(Boolean)
  if (!known.length) return rebalance()
  if (known.some((item, index) => !Number.isSafeInteger(item.rank) || (index > 0 && item.rank <= known[index - 1].rank))) return rebalance()
  const result = new Map()
  let start = 0, left = null
  for (let anchor = 0; anchor <= known.length; anchor++) {
    const right = known[anchor]
    const end = right ? right.index : rows.length
    const count = end - start
    const gap = left !== null && right ? Math.floor((right.rank - left) / (count + 1)) : step
    if (count && gap < 1) return rebalance()
    for (let index = start; index < end; index++) {
      const rank = left === null ? right.rank - step * (end - index) : left + gap * (index - start + 1)
      if (!Number.isSafeInteger(rank)) return rebalance()
      result.set(rows[index].key, rank)
    }
    if (right) { result.set(rows[right.index].key, right.rank); left = right.rank; start = right.index + 1 }
  }
  return result
}

export function snapshotSummary(snapshot) {
  const split = decomposeSnapshot(snapshot)
  return { sha256: split.hash, collections: split.collections.size, records: [...split.collections.values()].reduce((sum, collection) => sum + collection.rows.length, 0), accounts: Array.isArray(snapshot.accounts) ? snapshot.accounts.length : 0 }
}
