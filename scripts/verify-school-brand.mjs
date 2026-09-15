// Read-only source/build/online verification. Does not publish files or alter
// accounts, module switches, runtime configuration or business data.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { schoolBrand } from '../server/src/brand.js'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2)
const get=key=>args.includes(key)?args[args.indexOf(key)+1]:''
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const manifest=JSON.parse(await fs.readFile(path.join(root,'assets/brand-sources/manifest.json'),'utf8'))
const expected=new Map()
for(const file of Object.values(manifest.output)){
  const source=await fs.readFile(path.join(root,'static/brand',file));expected.set(file,source)
  assert.deepEqual(await fs.readFile(path.join(root,'admin/public/static/brand',file)),source,`Admin source mismatch: ${file}`)
}
for(const key of ['--h5-dir','--admin-dir']){
  const folder=get(key);if(!folder)continue
  for(const [file,source] of expected)assert.deepEqual(await fs.readFile(path.resolve(folder,'static/brand',file)),source,`Built asset missing/mismatched: ${key}/${file}`)
}
const base=get('--base-url')
if(base){
  const origin=new URL(base);assert.ok(['https:','http:'].includes(origin.protocol))
  const result=await fetch(new URL('/api/v1/brand',origin),{signal:AbortSignal.timeout(15000),cache:'no-store'})
  assert.equal(result.status,200,'Brand API failed')
  const payload=await result.json();assert.equal(payload.code,0,'Brand API response failed')
  assert.equal(payload.data.englishName,schoolBrand.englishName,'Old/wrong English school name')
  assert.equal(payload.data.logoUrl,schoolBrand.logoUrl,'Old/remote logo configured')
  for(const [file,source] of expected){
    const response=await fetch(new URL(`/static/brand/${file}`,origin),{signal:AbortSignal.timeout(15000),cache:'no-store'})
    assert.equal(response.status,200,`Asset unavailable: ${file}`)
    assert.match(response.headers.get('content-type')||'',file.endsWith('.svg')?/image\/svg\+xml/:/image\/jpeg/,'Asset route returned non-image content (possibly SPA HTML)')
    assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(source),`Online artwork SHA mismatch: ${file}`)
  }
}
console.log(JSON.stringify({ok:true,englishName:schoolBrand.englishName,assets:[...expected.keys()],buildsChecked:args.filter(arg=>['--h5-dir','--admin-dir'].includes(arg)).length,onlineChecked:Boolean(base)}))
