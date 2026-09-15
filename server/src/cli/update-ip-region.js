import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createConfig } from '../config.js'
import { verifyXdb } from '../audit/geo-location.js'

// Only fetch public reference data. No account information or client IP is sent.
const config = createConfig()
const dir = config.auditGeoDir || path.join(path.dirname(config.dataFile), 'ip-region')
let sha = process.argv[2]
if (!sha) {
  const response = await fetch('https://api.github.com/repos/lionsoul2014/ip2region/commits/master', { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`公开数据版本读取失败：${response.status}；可传入官方仓库的完整 commit SHA 后重试`)
  sha = (await response.json()).sha
}
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('公开数据版本无效')
await fs.mkdir(dir, { recursive: true, mode: 0o700 })
const manifest = { source: 'https://github.com/lionsoul2014/ip2region', revision: sha, downloadedAt: new Date().toISOString(), files: [] }
for (const version of [4,6]) {
  const name = `ip2region_v${version}.xdb`
  const url = `https://raw.githubusercontent.com/lionsoul2014/ip2region/${sha}/data/${name}`
  const result = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!result.ok) throw new Error(`归属库下载失败：${result.status}`)
  const buffer = Buffer.from(await result.arrayBuffer())
  if (buffer.length > 100*1024*1024) throw new Error('归属库超出大小限制')
  const verified = verifyXdb(buffer,version)
  const file = path.join(dir,name)
  await fs.writeFile(`${file}.tmp`, buffer, { mode: 0o600 }); await fs.rename(`${file}.tmp`,file)
  manifest.files.push({ name, sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length, databaseDate: verified.createdAt })
  console.log(`IPv${version} 离线归属库安装完成（${buffer.length} 字节）`)
}
await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n', { mode:0o600 })
console.log('离线库已更新；重启 API 后生效。IP 地区仅供参考，不代表精确位置。')
