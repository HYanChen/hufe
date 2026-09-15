import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const filename = process.argv[2]
if (!filename) throw new Error('Usage: node scripts/build-city-centers.mjs <GeoNames cities15000.zip>')
const zip = await fs.readFile(filename)
const raw = execFileSync('unzip', ['-p', filename, 'cities15000.txt'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const rows = raw.trim().split('\n').map(line => {
  const fields = line.split('\t')
  const [id, name, ascii, alternates, lat, lon, featureClass, featureCode, country] = fields
  const latitude = Number(lat), longitude = Number(lon)
  if (!/^\d+$/.test(id) || featureClass !== 'P' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Invalid GeoNames city row')
  return { id, aliases: [...new Set([name, ascii, ...alternates.split(',')].map(value => value.trim()).filter(Boolean))], latitude, longitude, country, featureCode, admin2: fields[11], modifiedAt: fields[18] }
})
const data = { source: 'GeoNames', sourceUrl: 'https://download.geonames.org/export/dump/cities15000.zip', license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', coordinateSystem: 'WGS84', generatedAt: new Date().toISOString(), archiveSha256: createHash('sha256').update(zip).digest('hex'), textSha256: createHash('sha256').update(raw).digest('hex'), rows }
await fs.writeFile(new URL('../server/src/regions/city-centers.json', import.meta.url), JSON.stringify(data))
console.log(JSON.stringify({ cities: rows.length, archiveSha256: data.archiveSha256, textSha256: data.textSha256, output: 'server/src/regions/city-centers.json' }, null, 2))
