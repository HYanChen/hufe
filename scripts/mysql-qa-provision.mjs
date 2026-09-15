import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const dir=path.resolve(fileURLToPath(new URL('../.local-runtime/mysql/',import.meta.url)))
const password=randomBytes(32).toString('base64url')
if(process.argv.length>3||(process.argv[2]&&process.argv[2]!=='--append-tests'))throw new Error('Unsupported isolated QA database')
const append=process.argv[2]==='--append-tests'
const database=append?'hufe_mysql_qa_append':'hufe_mysql_qa_migration',user=append?'hufe_qa_append':'hufe_mysql_qa'
const target=path.join(dir,append?'qa-append.json':'qa.json')
if(await fs.access(target).then(()=>true,()=>false))throw new Error('QA configuration already exists; no database changed')
try { execFileSync('docker',['exec','-i','hufe-mysql-local','mysql','--defaults-extra-file=/run/secrets/client.cnf'],{input:`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON ${database}.* TO '${user}'@'%';`,stdio:['pipe','ignore','pipe']}) }
catch { throw new Error('QA database provisioning failed; existing databases were not overwritten') }
await fs.writeFile(target,JSON.stringify({host:'127.0.0.1',port:13306,user,password,database}),{mode:0o600,flag:'wx'})
console.log('Isolated QA database ready; private configuration saved.')
