// Offline xdb reader following the ip2region format (Apache-2.0 / MIT):
// https://github.com/lionsoul2014/ip2region/tree/master/binding/javascript
import fs from 'node:fs/promises'
import path from 'node:path'
import { isIP } from 'node:net'
import { nonPublicIp, normalizeIp } from './metadata.js'

function ipBytes(ip, version) {
  if (version === 4) return Buffer.from(ip.split('.').map(Number))
  if (ip.includes('.')) {
    const at = ip.lastIndexOf(':'); const tail = ip.slice(at + 1).split('.').map(Number)
    ip = ip.slice(0, at + 1) + ((tail[0] << 8) | tail[1]).toString(16) + ':' + ((tail[2] << 8) | tail[3]).toString(16)
  }
  const [left, right] = ip.split('::').map(part => part ? part.split(':') : [])
  const groups = right ? [...left, ...Array(8-left.length-right.length).fill('0'), ...right] : left
  const bytes = Buffer.alloc(16); groups.forEach((part,i) => bytes.writeUInt16BE(parseInt(part,16),i*2)); return bytes
}

export function verifyXdb(buffer, version) {
  const size = version === 4 ? 14 : 38
  if (buffer.length < 524544) throw new Error('IP归属库文件不完整')
  const format = buffer.readUInt16LE(0), ipVersion = format === 2 ? 4 : buffer.readUInt16LE(16)
  const pointer = format === 2 ? 4 : buffer.readUInt16LE(18)
  const start = buffer.readUInt32LE(8), end = buffer.readUInt32LE(12)
  if (![2,3].includes(format) || buffer.readUInt16LE(2) !== 1 || ipVersion !== version || pointer !== 4 || start < 524544 || end < start || (end-start)%size || end+size > buffer.length) throw new Error('IP归属库格式不匹配')
  return { buffer, format, version, size, start, end, createdAt: new Date(buffer.readUInt32LE(4)*1000).toISOString() }
}

export function searchXdb(db, ip) {
  const { buffer, version, size, start, end } = db, bytes = ipBytes(ip, version)
  const vector = 256 + (bytes[0]*256+bytes[1])*8
  const s = buffer.readUInt32LE(vector), e = buffer.readUInt32LE(vector+4)
  if (!s && !e) return ''
  if (s < start || s > end || e < s || e > end + size || (s-start)%size || (e-start)%size) throw new Error('IP归属索引损坏')
  let low = 0, high = Math.floor((Math.min(e,end)-s)/size)
  const compare = offset => version === 4 ? bytes.readUInt32BE(0) - buffer.readUInt32LE(offset) : Buffer.compare(bytes, buffer.subarray(offset,offset+16))
  while (low <= high) {
    const mid = (low+high) >>> 1, offset = s+mid*size, width = version === 4 ? 4 : 16
    if (compare(offset) < 0) high = mid-1
    else if (compare(offset+width) > 0) low = mid+1
    else {
      const length = buffer.readUInt16LE(offset+width*2), pointer = buffer.readUInt32LE(offset+width*2+2)
      if (pointer < 524544 || pointer+length > start || length > 2048) throw new Error('IP归属数据损坏')
      return buffer.toString('utf8',pointer,pointer+length)
    }
  }
  return ''
}

export class GeoLocator {
  constructor(dir) { this.dir = dir; this.databases = new Map(); this.errors = [] }
  async init() {
    for (const version of [4,6]) {
      try { this.databases.set(version, verifyXdb(await fs.readFile(path.join(this.dir,`ip2region_v${version}.xdb`)), version)) }
      catch (error) { this.errors.push({ version, reason: error.code === 'ENOENT' ? '未安装' : '文件不可用' }) }
    }
  }
  status() { return { provider: 'ip2region（离线库）', databases: [...this.databases.values()].map(({version,createdAt}) => ({version,createdAt})), errors: this.errors } }
  lookup(value) {
    const ip = normalizeIp(value)
    if (!ip) return { label: 'IP未记录', source: 'unavailable', approximate: true }
    if (nonPublicIp(ip)) return { label: '本机 / 内网 / 保留地址', source: 'local-network', approximate: true }
    const db = this.databases.get(isIP(ip))
    if (!db) return { label: '归属库未配置', source: 'unavailable', approximate: true }
    try {
      const result = searchXdb(db,ip)
      if (!result) return { label: '归属地未知', source: 'ip2region', approximate: true, databaseDate: db.createdAt }
      const parts = result.split('|').map(part => !part || part === '0' ? '' : part.slice(0,100))
      const [country, province, city, isp] = db.format === 2 ? [parts[0], parts[2], parts[3], parts[4]] : parts
      return { label: [...new Set([country,province,city].filter(Boolean))].join(' · ') || '归属地未知', country, province, city, isp, source: 'ip2region', approximate: true, databaseDate: db.createdAt }
    } catch { return { label: '归属库查询失败', source: 'unavailable', approximate: true } }
  }
}
