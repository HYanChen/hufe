import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('../server/src/maps/assets/',import.meta.url)),manifestPath=path.join(root,'asset-manifest.json')
const files=[]
async function walk(directory,relative=''){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const key=path.posix.join(relative,entry.name);if(entry.isDirectory())await walk(path.join(directory,entry.name),key);else if(key!=='asset-manifest.json'){const data=await fs.readFile(path.join(root,key));files.push({path:key,size:data.length,sha256:createHash('sha256').update(data).digest('hex')})}}}
await walk(root);files.sort((a,b)=>a.path.localeCompare(b.path,'en'))
const packages=[{name:'maplibre-gl',version:'6.9.0',source:'https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-6.9.0.tgz',license:'BSD-3-Clause'},{name:'pmtiles',version:'4.5.0',source:'https://registry.npmjs.org/pmtiles/-/pmtiles-4.5.0.tgz',license:'BSD-3-Clause'},{name:'@protomaps/basemaps',version:'5.7.2',source:'https://cdn.jsdelivr.net/npm/@protomaps/basemaps@5.7.2/dist/basemaps.js',license:'BSD-3-Clause; map design CC0'},{name:'protomaps/basemaps-assets',source:'https://github.com/protomaps/basemaps-assets',license:'Fonts SIL-OFL; sprites MIT',note:'Noto Sans Regular 0-255, 256-511, 8192-8447; CJK ideographs rendered locally from device fonts, with no runtime network font source.'}]
if(process.argv.includes('--write'))await fs.writeFile(manifestPath,JSON.stringify({schemaVersion:1,packages,files},null,2)+'\n')
const expected=JSON.parse(await fs.readFile(manifestPath,'utf8'))
if(JSON.stringify(expected.files)!==JSON.stringify(files))throw Error('Local map asset SHA manifest mismatch; review changes and regenerate explicitly')
console.log(`Map assets verified: ${files.length} files; ${files.reduce((sum,row)=>sum+row.size,0)} bytes; no runtime CDN dependencies.`)
