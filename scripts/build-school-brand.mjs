// Deterministic packaging of the school-supplied artwork. This never traces,
// redraws, recolors or changes the typography of either official source.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const args=process.argv.slice(2),get=key=>args[args.indexOf(key)+1]
for(const key of ['--pdf','--wordmark'])if(!args.includes(key))throw new Error(`Missing ${key} source file`)
const pdf=path.resolve(get('--pdf')),jpg=path.resolve(get('--wordmark')),converter=args.includes('--pdftocairo')?get('--pdftocairo'):'pdftocairo'
const target=path.join(root,'static/brand'),admin=path.join(root,'admin/public/static/brand'),sources=path.join(root,'assets/brand-sources')
await Promise.all([target,admin,sources].map(dir=>fs.mkdir(dir,{recursive:true})))
const crestPath=path.join(target,'school-crest-202609.svg')
execFileSync(converter,['-svg',pdf,crestPath])
const crest=await fs.readFile(crestPath,'utf8'),sourceJpg=await fs.readFile(jpg),sourcePdf=await fs.readFile(pdf)
const viewBox=crest.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number)
if(!viewBox||viewBox.length!==4||viewBox.some(n=>!Number.isFinite(n))||viewBox[2]<=0||viewBox[3]<=0)throw new Error('Invalid extracted crest viewBox')
if(/<(?:script|foreignObject)\b|(?:href|src)=["']https?:/i.test(crest))throw new Error('External or active content not permitted in school artwork')
// Keep the complete original PDF page, including its aspect ratio. The complete
// original wordmark JPEG is embedded byte-for-byte at its supplied 3766:852 ratio.
const crestHeight=200,crestWidth=viewBox[2]/viewBox[3]*crestHeight,gap=24,padding=20
const wordmarkWidth=3766/852*200,width=padding*2+crestWidth+gap+wordmarkWidth,height=240
const body=crest.replace(/^[\s\S]*?<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'')
const combined=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="brand-title"><title id="brand-title">湖南财政经济学院 - Hunan College of Finance and Economics</title><rect width="${width}" height="${height}" rx="12" fill="#fff"/><svg x="${padding}" y="${padding}" width="${crestWidth}" height="${crestHeight}" viewBox="${viewBox.join(' ')}" preserveAspectRatio="xMidYMid meet">${body}</svg><image x="${padding+crestWidth+gap}" y="${padding}" width="${wordmarkWidth}" height="200" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/jpeg;base64,${sourceJpg.toString('base64')}"/></svg>\n`
await fs.writeFile(path.join(target,'school-logo-202609.svg'),combined)
await fs.copyFile(jpg,path.join(target,'school-wordmark-202609.jpg'))
await fs.writeFile(path.join(sources,'official-crest.pdf'),sourcePdf)
await fs.writeFile(path.join(sources,'official-wordmark.jpg'),sourceJpg)
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const manifest={version:'202609',name:'湖南财政经济学院',englishName:'Hunan College of Finance and Economics',sources:{crest:{file:'official-crest.pdf',sha256:sha(sourcePdf)},wordmark:{file:'official-wordmark.jpg',sha256:sha(sourceJpg),width:3766,height:852}},output:{logo:'school-logo-202609.svg',crest:'school-crest-202609.svg',wordmark:'school-wordmark-202609.jpg'},treatment:'PDF paths retained; original JPEG embedded unchanged; proportional placement on a white background.'}
await fs.writeFile(path.join(sources,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
for(const file of Object.values(manifest.output))await fs.copyFile(path.join(target,file),path.join(admin,file))
console.log(`Packaged official school artwork (${Math.round(width)}:${height}); static assets mirrored for the independent admin app.`)
