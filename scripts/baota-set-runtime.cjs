const fs = require('node:fs')
const file = '/shared/runtime.env'
let content = fs.readFileSync(file, 'utf8')
const gateway = process.argv[2]
if (require('node:net').isIP(gateway) !== 4) throw Error('A validated Docker bridge gateway is required')
for (const [key,value] of Object.entries({ TRUST_PROXY:'true', TRUSTED_PROXY_CIDRS:`${gateway}/32,127.0.0.1/32,::1/128`, AUDIT_GEO_DIR:'/app/ip-region' })) {
  const pattern = new RegExp(`^${key}=.*$`, 'gm')
  content = pattern.test(content) ? content.replace(pattern, `${key}=${value}`) : content.trimEnd()+`\n${key}=${value}\n`
}
const temporary = `${file}.${process.pid}.next`
fs.writeFileSync(temporary, content, {mode:0o600,flag:'wx'})
fs.renameSync(temporary, file)
console.log('Trusted proxy allowlist and offline geo directory configured; existing secrets preserved.')
