import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { prepareMysqlSnapshots } from '../server/src/cli/prepare-mysql-snapshots.js'
import { MySqlDatabase, readMysqlSnapshot } from '../server/src/storage/mysql-database.js'
import { canonicalSnapshotHash } from '../server/src/storage/mysql-snapshot.js'
import { createConfig } from '../server/src/config.js'
import { buildApp } from '../server/src/app.js'

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)))
const mysql=JSON.parse(await fs.readFile(path.join(root,'.local-runtime/mysql/qa.json'),'utf8'))
if(!/^hufe_mysql_qa_/.test(mysql.database))throw Error('Disposable QA database required')
const {createConnection}=await import('../server/node_modules/mysql2/promise.js')
const connection=await createConnection(mysql)
try {const [rows]=await connection.query('SHOW TABLES');await connection.query('SET FOREIGN_KEY_CHECKS=0');for(const row of rows){const name=Object.values(row)[0];if(!/^hufe_(?:[a-z_]+)?store_(?:meta|records|collections)$/.test(name))throw Error('Unexpected QA table');await connection.query(`DROP TABLE \`${name}\``)}}finally{await connection.end()}
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-mysql-flow-'))
let app
try{
  const dataDir=path.join(tmp,'data')
  // Copy, never migrate or edit the user's live JSON during acceptance.
  await fs.cp(path.join(root,'server/data'),dataDir,{recursive:true})
  const snapshots=path.join(tmp,'snapshots')
  const prepared=await prepareMysqlSnapshots(dataDir,snapshots)
  for(const namespace of prepared.namespaces){
    const source=JSON.parse(await fs.readFile(path.join(snapshots,`${namespace}.json`),'utf8'))
    const db=new MySqlDatabase({...mysql,namespace})
    try{await db.importSnapshot(source)}finally{await db.close()}
    assert.equal((await readMysqlSnapshot({...mysql,namespace})).hash,canonicalSnapshotHash(source))
  }
  const original=JSON.parse(await fs.readFile(path.join(snapshots,'application.json'),'utf8'))
  const config=createConfig({env:'test',databaseDriver:'mysql',mysql,dataFile:path.join(dataDir,'application-data.json'),mediaDir:path.join(dataDir,'media'),content:{cacheFile:path.join(dataDir,'content-cache.json')}})
  const create=()=>buildApp({config,logger:false,refreshContent:false,scheduleContent:false})
  app=await create()
  assert.equal((await app.inject('/health')).json().data.database.driver,'mysql')
  for(const route of ['/api/v1/admin/accounts','/api/v1/admin/audit-logs','/api/v1/admin/accounts/invalid/dossier'])assert.equal((await app.inject(route)).statusCode,401)
  assert.deepEqual(app.services.database.read(d=>d.accounts),original.accounts)
  const marker=`mysql-durability-${Date.now()}`
  await app.services.database.transaction(d=>{d.mysqlAcceptanceMarker=marker})
  await app.close();app=null
  app=await create()
  assert.equal(app.services.database.read(d=>d.mysqlAcceptanceMarker),marker)
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir,'application-data.json'),'utf8')).mysqlAcceptanceMarker,undefined)
  await app.close();app=null
  console.log(JSON.stringify({ok:true,...prepared,checks:['six namespaces exact hash','real API startup','mysql health','private route authorization','account equality','SQL persistence after restart','no JSON dual write']}))
}finally{await app?.close();await fs.rm(tmp,{recursive:true,force:true})}
