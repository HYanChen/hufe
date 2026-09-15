import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { auditRecord } from '../audit/metadata.js'
import { normalizeRegionImport } from './imports.js'
import { openDatabase } from '../storage/database.js'

export const LEVELS = ['country','province','city','district','street']
const fail=(message,code='REGION_INVALID',statusCode=400)=>Object.assign(new Error(message),{code,statusCode})
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f<>]/.test(value)
export function validateRegions(items){
  if(!Array.isArray(items)||!items.length||items.length>100000)throw fail('地区库须包含1至100000条记录')
  const map=new Map()
  for(const r of items){
    if(!r||!text(r.code,50)||!/^[-A-Za-z0-9_]+$/.test(r.code)||!text(r.name,80)||!r.name.trim()||!text(r.parentCode,50)||!LEVELS.includes(r.level)||typeof r.enabled!=='boolean')throw fail('地区记录须包含有效的 code、parentCode、name、level 和 enabled')
    if(map.has(r.code))throw fail(`地区代码重复：${r.code}`)
    map.set(r.code,{code:r.code,parentCode:r.parentCode,name:r.name.trim(),level:r.level,enabled:r.enabled})
  }
  for(const r of map.values()){
    const parent=map.get(r.parentCode),rank=LEVELS.indexOf(r.level)
    if(rank===0?r.parentCode!=='':!parent||LEVELS.indexOf(parent.level)>=rank)throw fail(`地区 ${r.code} 的上级缺失或层级不正确`)
  }
  return [...map.values()]
}
function compile(items){
  const byCode=new Map(items.map(r=>[r.code,r])),children=new Map(),names=new Map()
  for(const r of items){if(!children.has(r.parentCode))children.set(r.parentCode,[]);children.get(r.parentCode).push(r);if(!names.has(r.name))names.set(r.name,[]);names.get(r.name).push(r)}
  const lineage=code=>{const result=[];for(let r=byCode.get(code);r;r=byCode.get(r.parentCode))result.unshift(r);return result}
  return {items,byCode,children,names,lineage,active:code=>{const p=lineage(code);return p.length>0&&p.every(r=>r.enabled)}}
}
export class RegionService{
  constructor(database,config){this.database=database;this.config=config;this.directory=path.join(path.dirname(config.dataFile),'region-catalogs');this.catalogs=new Map();this.previews=new Map()}
  async init(){
    if(this.config.databaseDriver==='mysql')this.store=await openDatabase(this.config,{namespace:'regions'})
    const seed=JSON.parse(await fs.readFile(new URL('./seed.json',import.meta.url),'utf8'))
    this.seedMeta={revision:0,source:seed.source,sourceVersion:seed.sourceVersion,updatedAt:null,filename:''}
    this.catalogs.set(0,compile(validateRegions(seed.items)))
    const meta=this.meta()
    if(meta.filename){if(!/^catalog-[a-f0-9-]+\.json$/.test(meta.filename))throw fail('地区库文件无效');const items=this.store?this.store.read(d=>d.catalogs?.[meta.filename]):JSON.parse(await fs.readFile(path.join(this.directory,meta.filename),'utf8'));this.catalogs.set(meta.revision,compile(validateRegions(items)))}
    return this
  }
  async close(){await this.store?.close()}
  meta(){return this.database.read(d=>d.regionCatalog||this.seedMeta)}
  current(){return this.catalogs.get(this.meta().revision)}
  describe(code,c=this.current()){const row=c.byCode.get(code);if(!row)return null;const p=c.lineage(code);const city=p.find(r=>r.level==='city');const cityName=city&&['市辖区','县'].includes(city.name)?p.find(r=>r.level==='province')?.name:city?.name==='省直辖县级行政单位'?p.find(r=>r.level==='district')?.name:city?.name;return {...row,path:p,label:p.map(r=>r.name).join(' / '),city:cityName||row.name,available:c.active(code),hasChildren:(c.children.get(code)||[]).some(r=>c.active(r.code))}}
  list({parentCode='',query='',page=1,admin=false}={}){
    const c=this.current(),q=String(query).trim().slice(0,80);page=Math.max(1,Number(page)||1)
    const rows=(q?c.items.filter(r=>r.name.includes(q)||r.code.includes(q)):(c.children.get(String(parentCode))||[])).filter(r=>admin||c.active(r.code))
    const size=q?50:500
    return {...this.meta(),items:rows.slice((page-1)*size,page*size).map(r=>this.describe(r.code,c)),total:rows.length,page,hasMore:rows.length>page*size}
  }
  stats(){const c=this.current();return {...this.meta(),total:c.items.length,enabled:c.items.filter(r=>c.active(r.code)).length,levels:Object.fromEntries(LEVELS.map(l=>[l,c.items.filter(r=>r.level===l).length]))}}
  selection(input,current={},allowRemote=false){
    if(!Object.hasOwn(input,'city')&&!Object.hasOwn(input,'regionCode'))return {}
    const city=String(input.city??current.city??'').trim()
    let code=Object.hasOwn(input,'regionCode')?String(input.regionCode??''):Object.hasOwn(input,'city')&&city!==String(current.city??'').trim()?'':String(current.regionCode??'')
    if(code===String(current.regionCode||'')&&city===String(current.city||''))return {city,regionCode:code,...(current.region?{region:current.region}:{})}
    if(!code&&!city)return {city:'',regionCode:'',region:null}
    if(allowRemote&&(code==='REMOTE'||(!code&&['线上','远程','线上 / 远程'].includes(city))))return {city:'线上 / 远程',regionCode:'REMOTE',region:null}
    // Older clients may send a known city name. Resolve only a unique library
    // city (never guess a province/district/street from arbitrary free text).
    if(!code){const c=this.current();const matches=[...(c.names.get(city)||[]),...(c.names.get(city+'市')||[])].filter(r=>c.active(r.code)&&(r.level==='city'||['CN-11','CN-12','CN-31','CN-50'].includes(r.code)||r.name===city&&r.level==='district'&&c.byCode.get(r.parentCode)?.name==='省直辖县级行政单位'));const unique=[...new Set(matches.map(r=>r.code))];if(unique.length===1)code=unique[0]}
    if(!code)throw fail('请从地区库重新选择所在地区','REGION_SELECTION_REQUIRED')
    const item=this.describe(code)
    if(!item?.available)throw fail('该地区已停用或不存在，请重新选择','REGION_UNAVAILABLE',409)
    if(item.name==='省直辖县级行政单位')throw fail('请继续选择具体市县','REGION_SELECTION_REQUIRED')
    return {city:item.city,regionCode:code,region:{code,path:item.path.map(({code,name,level})=>({code,name,level})),label:item.label,version:this.meta().revision}}
  }
  preview(admin,input){
    if(input?.expectedRevision!==this.meta().revision)throw fail('地区库已被更新，请刷新后重新编辑或导入','REGION_CONFLICT',409)
    if(!input||!text(input.source,300)||!input.source.trim()||!text(input.sourceVersion,80)||!input.sourceVersion.trim()||!['merge','replace'].includes(input.mode))throw fail('请填写来源、版本，并选择合并或整库更新')
    const normalized=normalizeRegionImport(input.items)
    const conflictPolicy=input.conflictPolicy||(normalized.format==='pcas'?'preserve':'replace')
    if(!['preserve','replace'].includes(conflictPolicy))throw fail('同代码地区处理方式无效')
    if(normalized.format==='pcas'&&input.mode!=='merge')throw fail('中国行政区文件请使用合并更新，以保留其他国家地区','REGION_MERGE_REQUIRED')
    const rows=validateRegionsInput(normalized.items),c=this.current(),merged=new Map(c.items.map(r=>[r.code,{...r}])),codes=new Set(rows.map(r=>r.code))
    if(input.mode==='replace')for(const r of merged.values())if(!codes.has(r.code))r.enabled=false
    for(const r of rows)if(conflictPolicy!=='preserve'||!merged.has(r.code))merged.set(r.code,r)
    const items=validateRegions([...merged.values()]);let added=0,changed=0,disabled=0
    for(const r of items){const old=c.byCode.get(r.code);if(!old)added++;else if(JSON.stringify(old)!==JSON.stringify(r))changed++;if(old?.enabled&&!r.enabled)disabled++}
    for(const [k,v] of this.previews)if(v.expiresAt<Date.now()||v.adminId===admin.id)this.previews.delete(k)
    if(this.previews.size>=20)throw fail('同时处理的更新过多，请稍后再试')
    const token=randomUUID(),summary={added,changed,disabled,total:items.length,source:input.source,sourceVersion:input.sourceVersion,mode:input.mode,format:normalized.format,conflictPolicy,keptExisting:conflictPolicy==='preserve'?rows.filter(r=>c.byCode.has(r.code)).length:0}
    this.previews.set(token,{adminId:admin.id,revision:this.meta().revision,expiresAt:Date.now()+15*60*1000,items,summary})
    return {token,revision:this.meta().revision,...summary,expiresInMinutes:15}
  }
  async apply(admin,token,metadata,guard){
    const p=this.previews.get(token)
    if(!p||p.adminId!==admin.id||p.expiresAt<Date.now())throw fail('更新预览已过期或不属于当前账号，请重新预览','REGION_PREVIEW_EXPIRED',409)
    if(p.busy)throw fail('更新正在处理，请勿重复提交','REGION_CONFLICT',409)
    p.busy=true
    const filename=`catalog-${randomUUID()}.json`,index=compile(p.items)
    try{
      if(this.store)await this.store.transaction(d=>{d.catalogs||={};d.catalogs[filename]=p.items})
      else{await fs.mkdir(this.directory,{recursive:true});await fs.writeFile(path.join(this.directory,filename),JSON.stringify(p.items),{mode:0o600,flag:'wx'})}
      const result=await this.database.transaction(d=>{
        guard(d)
        if((d.regionCatalog?.revision||0)!==p.revision)throw fail('地区库已被更新，请重新预览','REGION_CONFLICT',409)
        const revision=p.revision+1
        this.catalogs.set(revision,index)
        d.regionCatalog={revision,filename,source:p.summary.source,sourceVersion:p.summary.sourceVersion,updatedAt:new Date().toISOString()}
        d.auditLogs.unshift(auditRecord('regions.updated','region-catalog',metadata,p.summary))
        return d.regionCatalog
      })
      this.previews.delete(token);for(const revision of this.catalogs.keys())if(revision!==0&&revision!==result.revision)this.catalogs.delete(revision);return {...result,...p.summary}
    }catch(e){if(!this.store)await fs.rm(path.join(this.directory,filename),{force:true}).catch(()=>{});throw e}finally{p.busy=false}
  }
}
// A partial merge may reference parents already in the live catalog.
function validateRegionsInput(items){
  if(!Array.isArray(items)||!items.length||items.length>100000)throw fail('一次更新须包含1至100000条地区')
  const seen=new Set()
  return items.map(r=>{if(!r||!text(r.code,50)||!/^[-A-Za-z0-9_]+$/.test(r.code)||!text(r.parentCode,50)||!text(r.name,80)||!r.name.trim()||!LEVELS.includes(r.level)||typeof r.enabled!=='boolean'||seen.has(r.code))throw fail('地区字段格式错误或存在重复代码');seen.add(r.code);return {code:r.code,parentCode:r.parentCode,name:r.name.trim(),level:r.level,enabled:r.enabled}})
}
