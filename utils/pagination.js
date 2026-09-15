// Client-filtered catalogues must not silently omit records beyond the first page.
export async function loadAllPages(fetchPage, query = {}, stillCurrent = () => true) {
  const items = []
  const seen = new Set()
  let first
  for (let page = 1; ; page++) {
    if (!stillCurrent()) throw new Error('登录状态已变化，请重新加载')
    const result = await fetchPage({ ...query, page, pageSize: 100 })
    if (!stillCurrent()) throw new Error('登录状态已变化，请重新加载')
    if (!first) first = result
    const rows = result.items || []
    const previousCount = items.length
    for (const row of rows) {
      if (!seen.has(row.id)) { seen.add(row.id); items.push(row) }
    }
    if (page * Number(result.pageSize || 100) >= Number(result.total || 0)) return { ...first, items, total: items.length }
    if (!rows.length || items.length === previousCount || page >= 10000) throw new Error('列表数据已变化，请刷新后重试')
  }
}
