// Real HTTP regression against the explicitly isolated browser QA harness.
// Never resets SQL and never logs in as the browser administrator.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { readMysqlSnapshot } from '../server/src/storage/mysql-database.js'
import { canonicalSnapshotHash } from '../server/src/storage/mysql-snapshot.js'

const root = path.resolve(import.meta.dirname, '..')
const mysql = JSON.parse(await fs.readFile(path.join(root, '.local-runtime/mysql/qa.json'), 'utf8'))
assert.match(mysql.database, /^hufe_mysql_qa_/, 'Only an isolated QA database is permitted')
const origin = 'http://127.0.0.1:8893'
const maxMs = Number(process.env.HUFE_QA_HTTP_MAX_MS || 5000)
assert(Number.isFinite(maxMs) && maxMs >= 100 && maxMs <= 60000)
const timings = []
let token = ''
let auditedRequests = 0
async function request(label, url, { method = 'GET', body, status = 200 } = {}) {
  const started = performance.now()
  const response = await fetch(origin + url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(maxMs + 1000)
  })
  const result = await response.json()
  const durationMs = Math.round((performance.now() - started) * 10) / 10
  if (url.startsWith('/api/v1/') && !url.startsWith('/api/v1/health')) auditedRequests++
  timings.push({ label, status: response.status, durationMs })
  assert.equal(response.status, status, `${label}: HTTP ${response.status}; ${String(result.error?.code || result.code || 'unknown error')}`)
  assert(durationMs <= maxMs, `${label} exceeded ${maxMs} ms (${durationMs} ms)`)
  return result.data ?? result
}

try {
  const identity = await request('isolated-harness', '/__qa/identity')
  assert.equal(identity.isolated, true)
  assert.equal(identity.database, mysql.database, 'HTTP API must point to the same isolated database')
  assert.match(identity.httpAdministrator, /^[a-f0-9-]{36}$/)
  const before = await readMysqlSnapshot({ ...mysql, namespace: 'audit' })
  assert(before.data.requests.length >= 10000, 'Keep the existing 10k+ request audit fixture; do not reset it for this regression')
  const originalApplication = (await readMysqlSnapshot({ ...mysql, namespace: 'application' })).data
  const storedDossier = originalApplication.accountDossiers?.find(row => row.accountId === identity.person)
  const credentialDigest = data => canonicalSnapshotHash({ accounts: data.accounts.map(row => ({ id: row.id, passwordHash: row.passwordHash })) })
  if (process.env.HUFE_QA_EXPECT_DOSSIER_SHA) assert.equal(canonicalSnapshotHash(storedDossier), process.env.HUFE_QA_EXPECT_DOSSIER_SHA, 'The saved browser dossier must survive restart unchanged')
  if (process.env.HUFE_QA_EXPECT_PASSWORD_SHA) assert.equal(credentialDigest(originalApplication), process.env.HUFE_QA_EXPECT_PASSWORD_SHA, 'All account password hashes must survive restart unchanged')
  if (process.env.HUFE_QA_EXPECT_CHAT_DISABLED === '1') assert.equal(originalApplication.moduleSettings?.flags?.chat, false)
  assert.equal(originalApplication.auditRecoveryRequests?.length || 0, 0, 'Audit recovery outbox must have drained before acceptance')

  await request('health-before', '/health')
  const modules = await request('public-modules', '/api/v1/modules')
  if (process.env.HUFE_QA_EXPECT_CHAT_DISABLED === '1') assert.equal(modules.flags.chat, false)
  await request('unauthenticated-accounts-denied', '/api/v1/admin/accounts', { status: 401 })
  const login = await request('login-http-only-account', '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'mysql_qa_http_admin', password: 'MySqlHttpQA2026!', deviceId: 'isolated_mysql_http_regression_device' }
  })
  assert.equal(login.user.id, identity.httpAdministrator)
  assert.equal(login.user.username, 'mysql_qa_http_admin')
  assert.equal(typeof login.accessToken, 'string')
  token = login.accessToken
  const accounts = await request('account-list', '/api/v1/admin/accounts')
  assert(Array.isArray(accounts.items), 'Account list must expose real records')
  assert(accounts.items.some(account => account.id === identity.person))
  await request('admin-modules', '/api/v1/admin/modules')
  const dossier = await request('person-dossier', `/api/v1/admin/accounts/${identity.person}/dossier`)
  assert.equal(dossier.account.id, identity.person)
  assert.equal(dossier.tabs.analysis.mode, 'facts')
  if (storedDossier) {
    assert.equal(dossier.supplement.profile.notes, storedDossier.profile.notes)
    assert.equal(dossier.supplement.revision, storedDossier.revision)
    assert.equal(dossier.tabs.followups.total, storedDossier.followups.length)
    for (const row of dossier.tabs.followups.items) {
      const saved = storedDossier.followups.find(item => item.id === row.id)
      assert(saved, 'Displayed follow-up must be a persisted record')
      assert.equal(row.status, saved.status)
      assert.equal(row.content, saved.content)
    }
  }
  for (const section of ['resources', 'enterprises', 'activities', 'giving', 'followups', 'relations']) {
    const result = await request(`dossier-${section}`, `/api/v1/admin/accounts/${identity.person}/dossier/${section}`)
    assert(Array.isArray(result.items))
    assert(Number.isSafeInteger(result.total))
  }
  await Promise.all(Array.from({ length: 5 }, (_, i) => request(`concurrent-modules-${i + 1}`, '/api/v1/modules')))
  if (modules.flags.chat === false) {
    const rejection = await request('disabled-chat-denied', '/api/v1/chat/conversations', { status: 404 })
    assert.equal(rejection.error?.code || rejection.code, 'MODULE_DISABLED')
  }
  const audit = await request('audit-status', '/api/v1/admin/audit-logs?pageSize=1')
  assert.equal(audit.status.available, true)
  assert.equal(audit.status.healthy, true)
  assert.equal(audit.status.recoveryPending, 0)
  assert.equal(audit.status.recoveryUncertainFailures, 0)
  await request('health-after', '/health')

  // This independently reads committed SQL and validates every record and the
  // full canonical snapshot hash. A fast response without durable logs fails.
  const after = await readMysqlSnapshot({ ...mysql, namespace: 'audit' })
  assert(after.data.requests.length >= before.data.requests.length + auditedRequests, 'All HTTP API audit appends must remain durable')
  for (let i = 0; i < before.data.requests.length; i++) assert.deepEqual(after.data.requests[i], before.data.requests[i], `Historical audit record ${i} changed`)
  const finalApplication = (await readMysqlSnapshot({ ...mysql, namespace: 'application' })).data
  assert.deepEqual(finalApplication.moduleSettings, originalApplication.moduleSettings)
  assert.deepEqual(finalApplication.accountDossiers, originalApplication.accountDossiers)
  assert.equal(credentialDigest(finalApplication), credentialDigest(originalApplication))
  assert.equal(finalApplication.auditRecoveryRequests?.length || 0, 0)
  console.log(JSON.stringify({ ok: true, database: mysql.database, auditBefore: before.data.requests.length, auditAfter: after.data.requests.length, historyPreserved: true, committedSnapshotVerified: true, savedDossierPreserved: !!storedDossier, passwordsUnchanged: true, moduleSettingsUnchanged: true, chatEnabled: modules.flags.chat, auditAvailable: audit.status.available, auditOutbox: audit.status.recoveryPending, maxAllowedMs: maxMs, timings }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, message: error.message, timings }, null, 2))
  process.exitCode = 1
}
