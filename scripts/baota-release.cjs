const fs = require('node:fs')
const path = require('node:path')
const {createHash} = require('node:crypto')

function validateStamp(stamp) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$/.test(stamp) || stamp.includes('..')) throw Error('Invalid release stamp')
  return stamp
}
function inventory(root) {
  const files = []
  function walk(relative = '') {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const entry = relative ? `${relative}/${name}` : name
      if (entry === 'release-manifest.json') continue
      if (/(?:^|\/)(?:\.env(?:\..*)?|node_modules|\.git|\.DS_Store|application-data\.json)$|\.jsonl$|(?:^|\/)media\/private\//i.test(entry)) throw Error(`Private or unapproved release file: ${entry}`)
      const filename = path.join(root, entry), stat = fs.lstatSync(filename)
      if (stat.isSymbolicLink()) throw Error(`Release symlinks are not allowed: ${entry}`)
      if (stat.isDirectory()) walk(entry)
      else if (stat.isFile()) files.push({path: entry, bytes: stat.size, sha256: createHash('sha256').update(fs.readFileSync(filename)).digest('hex')})
      else throw Error(`Unsupported release entry: ${entry}`)
    }
  }
  walk()
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}
function verifyRelease(root, stamp) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8'))
  validateStamp(manifest.stamp)
  if (manifest.version !== 1 || manifest.stamp !== stamp || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('Release manifest or stamp mismatch')
  if (JSON.stringify(inventory(root)) !== JSON.stringify(manifest.files)) throw Error('Release file SHA/inventory mismatch; re-upload the complete matching archive')
  return manifest
}
module.exports = {validateStamp, inventory, verifyRelease}
if (require.main === module) {
  const result = verifyRelease(process.argv[2] || '/release', process.argv[3])
  console.log(`Release ${result.stamp}: ${result.files.length} file hashes verified`)
}
