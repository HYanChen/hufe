const fs = require('node:fs')
const marker = '# HUFE bounded update maintenance'
function apiBlock(content, transform) {
  const pattern = /(location\s+\^~\s+\/api\/\s*\{)([^{}]*)(\})/g
  if ([...content.matchAll(pattern)].length !== 1) throw Error('Expected one simple API location; refusing unexpected Nginx configuration')
  return content.replace(pattern, (_all, opening, body, closing) => opening + transform(body) + closing)
}
function maintenanceConfig(content) {
  if (content.includes(marker)) throw Error('An existing maintenance gate needs reconciliation before another deployment')
  return apiBlock(content, body => `\n  return 503; ${marker}\n${body}`)
}
function activateConfig(original, oldPort, newPort) {
  if (!['8787', '8788'].includes(String(oldPort)) || !['8787', '8788'].includes(String(newPort)) || String(oldPort) === String(newPort)) throw Error('Expected distinct known deployment ports')
  if (original.includes(marker)) throw Error('Original config must not contain a maintenance gate')
  const proxies = [...original.matchAll(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)\s*;/g)]
  if (proxies.length !== 2 || proxies.some(match => match[1] !== String(oldPort))) throw Error('API and health proxies do not match the running container port')
  let candidate = original.replace(/proxy_pass\s+http:\/\/127\.0\.0\.1:\d+\s*;/g, `proxy_pass http://127.0.0.1:${newPort};`)
  candidate = apiBlock(candidate, body => {
    const settings = {client_max_body_size: '20m', client_body_timeout: '300s', proxy_request_buffering: 'off', proxy_buffering: 'off', proxy_read_timeout: '300s', proxy_send_timeout: '300s'}
    for (const [directive, value] of Object.entries(settings)) {
      const expression = new RegExp(`(^|\\n)[ \\t]*${directive}\\s+[^;\\n]+;`, 'g')
      body = body.replace(expression, '')
      body += `\n  ${directive} ${value};`
    }
    return `${body}\n`
  })
  return candidate
}
function atomicWrite(file, content, mode = 0o644) {
  const temporary = `${file}.${process.pid}.next`
  fs.writeFileSync(temporary, content, {mode, flag: 'wx'})
  fs.renameSync(temporary, file)
}
module.exports = {maintenanceConfig, activateConfig, atomicWrite}
