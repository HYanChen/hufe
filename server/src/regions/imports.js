const invalid = (message) => Object.assign(new Error(message), { code: 'REGION_INVALID', statusCode: 400 })
const levels = { 2: 'province', 4: 'city', 6: 'district', 9: 'street' }

// pcas-code.json is a nested Chinese administrative-code tree. Keep its codes
// stable and use the same CN prefix as the platform's existing region catalog.
export function normalizeRegionImport(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100000) throw invalid('一次更新须包含1至100000条地区')
  if (input.some((row) => row && (Object.hasOwn(row, 'level') || Object.hasOwn(row, 'parentCode')))) {
    return { format: 'flat', items: input }
  }
  const items = [{ code: 'CN', parentCode: '', name: '中国', level: 'country', enabled: true }]
  const seen = new Set()
  const visit = (rows, parent = null, depth = 0) => {
    if (depth > 3 || !Array.isArray(rows)) throw invalid('中国行政区层级须为省、市、区县、街道乡镇')
    for (const row of rows) {
      const code = typeof row?.code === 'number' && Number.isSafeInteger(row.code) ? String(row.code) : row?.code
      const name = typeof row?.name === 'string' ? row.name.trim() : ''
      const level = levels[code?.length]
      if (!row || typeof code !== 'string' || !/^\d+$/.test(code) || !level || !name || name.length > 80 || /[\u0000-\u001f<>]/.test(name)) throw invalid('中国行政区须包含有效的 code、name 和 children')
      if ((!parent && level !== 'province') || (parent && (!code.startsWith(parent.code) || code.length <= parent.code.length))) throw invalid(`地区 ${code} 与上级代码或层级不一致`)
      if (seen.has(code) || seen.size >= 99999) throw invalid('中国行政区存在重复代码或超过100000条上限')
      seen.add(code)
      if (Object.hasOwn(row, 'children') && !Array.isArray(row.children)) throw invalid(`地区 ${code} 的 children 必须是数组`)
      // Dongguan/Zhongshan/Danzhou source trees include a synthetic county
      // duplicating the city. Keep real streets attached directly to the city.
      const redundantCounty = parent?.code.length === 4 && code === parent.code + '00' && name === parent.name
      if (!redundantCounty) items.push({ code: 'CN-' + code, parentCode: parent ? 'CN-' + parent.code : 'CN', name, level, enabled: true })
      if (row.children?.length) visit(row.children, redundantCounty ? parent : { code, name }, depth + 1)
    }
  }
  visit(input)
  return { format: 'pcas', sourceNodes: seen.size, items }
}
