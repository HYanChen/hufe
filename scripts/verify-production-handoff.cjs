// Standalone, read-only verifier. No dependencies, network or server access.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function inventory(root) {
  const result = []
  function walk(relative = '') {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const item = relative ? `${relative}/${name}` : name
      if (item === 'handoff-manifest.json') continue
      const stat = fs.lstatSync(path.join(root, item))
      if (stat.isSymbolicLink()) throw Error(`Symlink is not allowed: ${item}`)
      if (stat.isDirectory()) walk(item)
      else if (stat.isFile()) result.push({path:item, bytes:stat.size, sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,item))).digest('hex')})
      else throw Error(`Unexpected file type: ${item}`)
    }
  }
  walk()
  return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
}
function verify(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'handoff-manifest.json'),'utf8'))
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('Invalid handoff manifest')
  const actual=inventory(root)
  if (JSON.stringify(actual)!==JSON.stringify(manifest.files)) throw Error('Handoff SHA/inventory mismatch: stop deployment; do not ignore or regenerate the manifest')
  return {ok:true, release:manifest.release, files:actual.length, businessDataIncluded:false}
}
module.exports={inventory,verify}
if(require.main===module){
  try {console.log(JSON.stringify(verify(path.resolve(process.argv[2]||__dirname))))}
  catch(error){console.error(error.message);process.exitCode=1}
}
