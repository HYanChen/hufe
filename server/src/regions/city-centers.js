import fs from 'node:fs/promises'

const key = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase()
let catalogPromise
function catalog() {
  if (!catalogPromise) catalogPromise = fs.readFile(new URL('./city-centers.json', import.meta.url), 'utf8').then(raw => {
    const data = JSON.parse(raw), aliases = new Map()
    for (const row of data.rows) for (const name of new Set(row.aliases.map(key))) {
      if (!aliases.has(name)) aliases.set(name, [])
      aliases.get(name).push(row)
    }
    return { data, aliases }
  }).catch(error => { catalogPromise = null; throw error })
  return catalogPromise
}

export class CityCenterService {
  constructor(business, regions) { this.business = business; this.regions = regions }

  async center(city) {
    if (typeof city !== 'string' || !city.trim() || city.length > 80 || /[\u0000-\u001f]/.test(city)) throw Object.assign(new Error('请选择公开城市列表中的城市'), { statusCode: 400, code: 'CITY_INVALID' })
    city = city.trim()
    const allowed = () => this.business.directoryCityStats().items.some(row => row.city === city)
    if (!allowed()) throw Object.assign(new Error('此城市暂无公开统计'), { statusCode: 404, code: 'CITY_NOT_PUBLIC' })
    const { data, aliases } = await catalog()
    // Resolve legacy short names such as 长沙 via the existing administrative
    // catalog first so town/street namesakes never replace the actual city.
    let selected
    try { selected = this.regions.selection({ city }) } catch {}
    const canonical = selected?.city || city
    let candidates = aliases.get(key(canonical)) || []
    if (!candidates.length && canonical !== city) candidates = aliases.get(key(city)) || []
    if (selected?.regionCode?.startsWith('CN-')) {
      candidates = candidates.filter(row => ['CN', 'HK', 'MO', 'TW'].includes(row.country))
      const code = selected.regionCode.slice(3)
      const byCode = code.length === 4 ? candidates.filter(row => row.admin2 === code && ['PPLC', 'PPLA', 'PPLA2'].includes(row.featureCode)) : []
      if (byCode.length) candidates = byCode
    }
    // Recheck public membership after asynchronous I/O to honour an intervening
    // moderation or visibility change. No profile, ID or address leaves here.
    if (!allowed()) throw Object.assign(new Error('此城市暂无公开统计'), { statusCode: 404, code: 'CITY_NOT_PUBLIC' })
    const common = { city, source: data.source, license: data.license, precision: 'city' }
    if (candidates.length !== 1) return { ...common, available: false, reason: candidates.length ? 'ambiguous' : 'not_found' }
    const row = candidates[0]
    return { ...common, available: true, latitude: row.latitude, longitude: row.longitude, coordinateSystem: 'WGS84', sourceUrl: `https://www.geonames.org/${row.id}/` }
  }
}
