const fs = require('node:fs')
const {createHash} = require('node:crypto')

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function accountDigest(state) {
  if (!Array.isArray(state.accounts) || state.accounts.some(account => !account || typeof account !== 'object' || Array.isArray(account))) throw Error('Production account collection is unavailable')
  return createHash('sha256').update(canonical(state.accounts)).digest('hex')
}

module.exports = {canonical, accountDigest}
if (require.main === module) {
  const state = JSON.parse(fs.readFileSync('/data/application-data.json', 'utf8'))
  const hash = accountDigest(state), file = '/backup/mysql-accounts.sha256'
  if (process.argv[2] === 'snapshot') fs.writeFileSync(file, hash, {flag: 'wx', mode: 0o600})
  else if (process.argv[2] === 'verify') {
    if (fs.readFileSync(file, 'utf8') !== hash) throw Error('MySQL account state differs from the stopped production source; cutover cannot proceed')
    console.log(`MySQL account integrity checked: ${state.accounts.length} complete accounts unchanged, including passwords, identity state, roles, identifiers and sessions.`)
  } else throw Error('Expected snapshot or verify')
}
