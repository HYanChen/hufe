// Reproducible data-only build. No runtime calls to external geography providers.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {normalizeRegionImport} from '../server/src/regions/imports.js'
import {validateRegions} from '../server/src/regions/service.js'
const root=new URL('../server/src/regions/',import.meta.url)
const args=process.argv.slice(2)
if(args.includes('--pcas')){
  const option=name=>{const i=args.indexOf(name);if(i<0)return '';if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`${name} requires a path`);return args[i+1]}
  const input=option('--pcas'),raw=await fs.readFile(input,'utf8'),sha256=createHash('sha256').update(raw).digest('hex')
  const normalized=normalizeRegionImport(JSON.parse(raw));if(normalized.format!=='pcas')throw Error('--pcas requires a code/name/children tree')
  const imported=validateRegions(normalized.items),seed=JSON.parse(await fs.readFile(new URL('seed.json',root),'utf8'))
  const existing=validateRegions(seed.items),byCode=new Map(existing.map(row=>[row.code,row])),added=[],conflicts=[]
  for(const row of imported){const old=byCode.get(row.code);if(!old){byCode.set(row.code,row);added.push(row.code)}else if(JSON.stringify(old)!==JSON.stringify(row))conflicts.push({code:row.code,kept:old,incoming:row})}
  const items=validateRegions([...byCode.values()])
  const source='用户提供 pcas-code.json（数据截止日期未提供）'
  const sourceVersion=`pcas-code.json SHA256 ${sha256.slice(0,16)}；仅补充缺失区域`
  const importFile=option('--import-output')||`.local-runtime/regions-pcas-${sha256.slice(0,12)}.json`
  const reportFile=option('--report-output')||`.local-runtime/regions-pcas-${sha256.slice(0,12)}-report.json`
  const report={input:path.basename(input),sha256,sourceNodes:normalized.sourceNodes,normalizedNodes:imported.length,before:existing.length,after:items.length,added:added.length,keptExisting:imported.length-added.length,conflictsPreserved:conflicts.length,removed:0,addedCodes:added,conflicts,levels:Object.fromEntries(['country','province','city','district','street'].map(level=>[level,items.filter(row=>row.level===level).length]))}
  await fs.mkdir(path.dirname(importFile),{recursive:true});await fs.mkdir(path.dirname(reportFile),{recursive:true})
  await fs.writeFile(importFile,JSON.stringify({source,sourceVersion,mode:'merge',conflictPolicy:'preserve',inputSha256:sha256,items:imported}))
  await fs.writeFile(reportFile,JSON.stringify(report,null,2))
  const additions={input:path.basename(input),sha256,sourceNodes:normalized.sourceNodes,conflictPolicy:'preserve'}
  await fs.writeFile(option('--seed-output')||new URL('seed.json',root),JSON.stringify({...seed,source:seed.source.includes('用户提供 pcas-code.json')?seed.source:seed.source+'; 用户提供 pcas-code.json',sourceVersion:seed.sourceVersion.split('；补充 pcas ')[0]+'；补充 pcas '+sha256.slice(0,12),supplement:additions,items}))
  console.log(JSON.stringify({...report,addedCodes:undefined,conflicts:undefined,importFile,reportFile},null,2))
}else{
const fetchText=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`Source download failed: ${r.status}`);return r.text()}
const source='https://unpkg.com/zoningjs@3.2025.0/4.json'
const raw=await fetchText(source)
if(createHash('sha256').update(raw).digest('hex')!=='d743ba44b95f27d331e2f3e089ccb161a001c0f332277b92d234bf0786073790')throw Error('Source checksum changed')
const countries=JSON.parse(await fetchText('https://unpkg.com/i18n-iso-countries@7.14.0/langs/zh.json')).countries
// HK/MO/TW are already covered by the CN hierarchy; do not duplicate them as roots.
const items=Object.entries(countries).filter(([code])=>!['HK','MO','TW'].includes(code)).map(([code,name])=>({code,parentCode:'',name:Array.isArray(name)?name[0]:name,level:'country',enabled:true}))
const tree=JSON.parse(raw),codes=new Set(Object.values(tree).flat().map(r=>String(r.c)))
for(const [parent,rows] of Object.entries(tree))for(const r of rows){
  const code=String(r.c);let p=parent
  // Direct-administered cities have no county tier. Link streets to real cities.
  while(p!=='0'&&!codes.has(p))p=p.slice(0,p.length===6?4:2)
  items.push({code:'CN-'+code,parentCode:p==='0'?'CN':'CN-'+p,name:r.n,level:({2:'province',4:'city',6:'district',9:'street'})[code.length],enabled:true})
}
const seed={source:'netnr/zoning (MIT); i18n-iso-countries (MIT)',sourceVersion:'中国行政区 2025-12-31 / zoningjs 3.2025.0；国家地区 7.14.0',items}
// Refreshing the upstream baseline must not silently drop user-supplied codes.
const previous=await fs.readFile(new URL('seed.json',root),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error})
if(previous?.supplement){
  const known=new Set(items.map(row=>row.code))
  for(const row of validateRegions(previous.items))if(!known.has(row.code)){items.push(row);known.add(row.code)}
  seed.supplement=previous.supplement
  seed.source+='; 用户提供 pcas-code.json'
  seed.sourceVersion+='；补充 pcas '+previous.supplement.sha256.slice(0,12)
}
validateRegions(items)
await fs.writeFile(new URL('seed.json',root),JSON.stringify(seed))
await fs.writeFile(new URL('LICENSE-zoning.txt',root),await fetchText('https://unpkg.com/zoningjs@3.2025.0/LICENSE'))
await fs.writeFile(new URL('LICENSE-countries.txt',root),await fetchText('https://unpkg.com/i18n-iso-countries@7.14.0/LICENSE'))
console.log(`Built ${items.length} region nodes`)
}
