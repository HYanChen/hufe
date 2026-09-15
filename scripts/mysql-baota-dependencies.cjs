const fs = require('node:fs')

function validatePaths(listing) {
  const entries = listing.split('\n').filter(Boolean)
  if (!entries.length) throw Error('Production dependency archive is empty')
  for (const raw of entries) {
    const name = raw.startsWith('./') ? raw.slice(2) : raw
    if (!(name === 'node_modules/' || name.startsWith('node_modules/')) || name.includes('\\') || name.split('/').some(p => p === '..' || p === '.') || /[\r\0]/.test(name)) throw Error('Production dependency archive contains an unsafe path')
  }
  if (!entries.some(entry => /^(?:\.\/)?node_modules\/mysql2\/package\.json$/.test(entry))) throw Error('Production dependency archive lacks mysql2')
  return true
}

function validateTypes(listing) {
  const entries = listing.split('\n').filter(Boolean)
  if (!entries.length || entries.some(line => !/^[-d]/.test(line))) throw Error('Production dependency archive must contain regular files/directories only; materialize dependencies and exclude .bin links')
  return true
}

module.exports = {validatePaths, validateTypes}
if (require.main === module) {
  const content = fs.readFileSync(0, 'utf8')
  if (process.argv[2] === 'paths') validatePaths(content)
  else if (process.argv[2] === 'types') validateTypes(content)
  else throw Error('Expected paths or types')
  console.log('Production dependency archive validated')
}
