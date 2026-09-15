// This helper is intentionally fixed to the disposable loopback fixture only.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { qrcode } from '../utils/vendor/qrcode.mjs'

const origin = 'http://127.0.0.1:8879'
if (process.argv.slice(2).some(value => value !== '--watch')) throw new Error('Only --watch is supported; the target is fixed to the disposable fixture')
const watch = process.argv.includes('--watch')
let stopped = false, wake = null
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; wake?.() })
async function call(route, options = {}) {
  const response = await fetch(origin + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`Isolated fixture request failed: HTTP ${response.status}`)
  return response.json()
}
const proof = await call('/__qa__/gate-fixture')
if (proof.fixture !== 'gate-browser' || proof.environment !== 'test' || typeof proof.temporaryDatabase !== 'string' || !path.basename(proof.temporaryDatabase).startsWith('hufe-gate-browser-qa-') || path.dirname(path.resolve(proof.temporaryDatabase)) !== path.resolve(os.tmpdir())) throw new Error('Refusing: port 8879 is not the disposable gate test fixture')
const session = (await call('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'qa_member', password: 'Isolated-QA-2026!' }) })).data
const token = session?.accessToken
if (!token) throw new Error('Disposable fixture did not return a login token')
async function updateImage() {
  const pass = (await call('/api/v1/gate/passes', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' })).data
  if (!/^HUFE-GATE-V1:[A-Za-z0-9_-]{43}$/.test(pass.qrPayload)) throw new Error('Fixture returned an invalid QR payload')
  const qr = qrcode(0, 'M')
  qr.addData(pass.qrPayload, 'Byte')
  qr.make()
  const encoded = qr.createDataURL(10, 40)
  const output = fileURLToPath(new URL('../.local-runtime/gate-qa-code.gif', import.meta.url))
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output + '.next', Buffer.from(encoded.slice('data:image/gif;base64,'.length), 'base64'), { mode: 0o600 })
  await fs.rename(output + '.next', output)
  console.log(JSON.stringify({ expiresAt: pass.expiresAt, refreshIntervalSeconds: pass.refreshIntervalSeconds, file: output, fixture: 'disposable-loopback-only' }))
}
try {
  const deadline = Date.now() + 120000
  do {
    await updateImage()
    if (!watch || stopped || Date.now() >= deadline) break
    await new Promise(resolve => {
      const timer = setTimeout(() => { wake = null; resolve() }, 5000)
      wake = () => { clearTimeout(timer); wake = null; resolve() }
    })
  } while (!stopped && Date.now() < deadline)
} finally {
  await call('/api/v1/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' }).catch(() => {})
}
