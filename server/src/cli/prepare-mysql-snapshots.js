import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalSnapshotHash } from '../storage/mysql-snapshot.js'

const base = () => ({version:1,accounts:[],adminDelegations:[],identityConflicts:[],manualIdentityVerifications:[],manualVerificationMediaOrphans:[],auditLogs:[],contentRules:[]})
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback
    throw new Error(`迁移源文件无法读取或格式损坏：${path.basename(file)}`)
  }
}
export async function prepareMysqlSnapshots(dataDir, output) {
  if (!path.isAbsolute(dataDir) || !path.isAbsolute(output)) throw new Error('迁移目录必须为绝对路径')
  // Caller must freeze all API writers first; destination is always a new private directory.
  const application = await readJson(path.join(dataDir, 'application-data.json'))
  if (!Array.isArray(application.accounts)) throw new Error('账号数据结构无效，停止迁移')
  const chat = await readJson(path.join(dataDir,'chat/index.json'), {...base(),conversations:[],messages:[],uploads:[],stickers:[],chatGroupEvents:[]})
  const transfers = await readJson(path.join(dataDir,'media/private/image-transfers/uploads.json'), {...base(),imageUploads:[]})
  const content = await readJson(path.join(dataDir,'content-cache.json'), {version:1,items:[],sourceStatuses:[],generatedAt:null,lastAttemptAt:null,lastSuccessAt:null,stale:true})
  const catalogs = {}
  for (const name of await fs.readdir(path.join(dataDir,'region-catalogs')).catch(e=>{if(e.code==='ENOENT')return [];throw e})) {
    if (/^catalog-[a-f0-9-]+\.json$/.test(name)) catalogs[name] = await readJson(path.join(dataDir,'region-catalogs',name))
  }
  if (application.regionCatalog?.filename && !catalogs[application.regionCatalog.filename]) throw new Error('当前行政区域库缺失，停止迁移')
  const requests = []
  for (const name of (await fs.readdir(path.join(dataDir,'audit-requests')).catch(e=>{if(e.code==='ENOENT')return [];throw e})).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue
    const lines = (await fs.readFile(path.join(dataDir,'audit-requests',name),'utf8')).split('\n')
    for (let i=0;i<lines.length;i++) {
      if (!lines[i].trim()) continue
      try { const row=JSON.parse(lines[i]); if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id||typeof row.action!=='string'||!row.action||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw Error(); requests.push(row) }
      catch { throw new Error(`审计日志 ${name} 第 ${i+1} 行损坏，停止迁移；原日志保留`) }
    }
  }
  const sources = {application,chat,'image-transfers':transfers,audit:{requests},regions:{catalogs},content}
  await fs.mkdir(output,{mode:0o700})
  const manifest = {createdAt:new Date().toISOString(),namespaces:{}}
  for (const [namespace,snapshot] of Object.entries(sources)) {
    const file=path.join(output,`${namespace}.json`)
    await fs.writeFile(file,JSON.stringify(snapshot),{mode:0o600,flag:'wx'})
    manifest.namespaces[namespace]={file:path.basename(file),sha256:canonicalSnapshotHash(snapshot)}
  }
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'})
  return {namespaces:Object.keys(sources),accounts:application.accounts.length,chatMessages:chat.messages?.length||0,auditRequests:requests.length,regionCatalogs:Object.keys(catalogs).length}
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2)
  if(args.length!==4||args[0]!=='--data-dir'||args[2]!=='--output')throw new Error('用法：--data-dir /冻结的数据目录 --output /新的备份目录')
  console.log(JSON.stringify(await prepareMysqlSnapshots(args[1],args[3])))
}
