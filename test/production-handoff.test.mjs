import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {allowedSourcePath,copySource} from '../scripts/package-production-handoff.mjs'
import verifier from '../scripts/verify-production-handoff.cjs'

test('handoff excludes private paths and stale source duplicates, but preserves template and test sources',()=>{
  for(const name of ['.env','.env.production','node_modules/a.js','server/data/a.jsonl','backup.sql','foo 2.vue','.local-runtime/application-data.json','old.zip'])assert.equal(allowedSourcePath(name),false,name)
  for(const name of ['.env.example','.env.production.example','server/src/config.js','test/case.test.mjs','school-logo.svg'])assert.equal(allowedSourcePath(name),true,name)
})
test('source copier rejects symlinks and destination overwrite',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-handoff-copy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  await fs.writeFile(path.join(dir,'source'),'original')
  await copySource(path.join(dir,'source'),path.join(dir,'target'))
  await assert.rejects(copySource(path.join(dir,'source'),path.join(dir,'target')))
  await fs.symlink(path.join(dir,'source'),path.join(dir,'link'))
  await assert.rejects(copySource(path.join(dir,'link'),path.join(dir,'other')),/symlink/)
})
test('standalone manifest rejects added, modified, missing files',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-handoff-manifest-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  await fs.writeFile(path.join(dir,'app.js'),'content')
  await fs.writeFile(path.join(dir,'handoff-manifest.json'),JSON.stringify({version:1,release:'test',files:verifier.inventory(dir)}))
  assert.equal(verifier.verify(dir).ok,true)
  await fs.writeFile(path.join(dir,'extra'),'bad');assert.throws(()=>verifier.verify(dir));await fs.unlink(path.join(dir,'extra'))
  await fs.writeFile(path.join(dir,'app.js'),'changed');assert.throws(()=>verifier.verify(dir))
  await fs.unlink(path.join(dir,'app.js'));assert.throws(()=>verifier.verify(dir))
})
