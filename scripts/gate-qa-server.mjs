// Disposable, loopback-only browser acceptance. NEVER points at a real database.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { createConfig } from '../server/src/config.js'
import { hmac } from '../server/src/auth/crypto.js'

const args=process.argv.slice(2),resume=args.includes('--resume')?args[args.indexOf('--resume')+1]:''
const tempRoot=await fs.realpath(os.tmpdir())
if(resume&&!path.isAbsolute(resume))throw Error('只能恢复系统临时目录内的独立 Gate 验收数据')
const directory = resume ? await fs.realpath(resume) : await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-gate-browser-qa-'))
if(resume){if(!directory.startsWith(path.join(tempRoot,'hufe-gate-browser-qa-')))throw Error('不允许恢复真实或符号链接数据库');await fs.access(path.join(directory,'data.json'))}
const keepData=args.includes('--keep-data')
const status = { stale: false, itemCount: 0, sourceStatuses: [] }
let app, closing = false
async function close(code = 0) {
  if (closing) return
  closing = true
  await app?.close()
  if(!keepData)await fs.rm(directory, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => close())
process.on('SIGTERM', () => close())
try {
  app = await buildApp({ config: createConfig({ env: 'test', dataFile: path.join(directory, 'data.json'), mediaDir: path.join(directory, 'media'), auditGeoDir: path.join(directory, 'ip-region'), cacheFile: path.join(directory, 'content-cache.json'), dataHashSecret: 'isolated-gate-browser-qa-not-for-production', publicBaseUrl: 'http://127.0.0.1:8879', corsOrigins: ['http://127.0.0.1:4273', 'http://localhost:4273', 'http://127.0.0.1:5273', 'http://localhost:5273'], returnUrlOrigins: ['http://127.0.0.1:5273', 'http://localhost:5273'], trustProxy: false }), logger: false, refreshContent: false, scheduleContent: false, contentService: { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status, home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, status }), get: async () => null } })
  const users = {}, password = 'Isolated-QA-2026!'
  let station
  if(!resume){
  for (const [username, name] of [['qa_admin', '隔离验收管理员'], ['qa_manager', '隔离验收保卫负责人'], ['qa_guard', '隔离验收保安'], ['qa_member', '隔离验收校友']]) {
    // Eligibility is simulated solely in this disposable test database; none of
    // these fixtures is an attestation about real school identity or people.
    const studentId = username === 'qa_member' ? '990000000001' : ''
    users[username] = await app.services.accounts.register({ schoolSubject: `isolated-gate-browser-${username}`, name, personType: 'alumni', department: '信息技术与管理学院', major: '计算机科学与技术', className: '2022级专升本计算机科学与技术一班', enrollmentYear: '2022', graduationYear: '2024', studentId, studentIdKey: studentId ? hmac(`student-id:${studentId}`, 'isolated-gate-browser-qa-not-for-production') : '', isAdmin: username === 'qa_admin', verificationSource: 'isolated-gate-browser-qa' }, { username, password })
  }
  await app.services.database.transaction(state => {
    for (const username of ['qa_guard', 'qa_manager']) Object.assign(state.accounts.find(row => row.id === users[username].id), { schoolIdentityVerified: false, accountSource: 'admin_provisioned', verificationSource: 'isolated-gate-operator-qa', personType: 'staff' })
  })
  await app.services.gate.grant(users.qa_admin.id, { accountId: users.qa_manager.id, role: 'manager' })
  await app.services.gate.grant(users.qa_manager.id, { accountId: users.qa_guard.id, role: 'guard' })
  station = await app.services.gate.saveStation(users.qa_admin.id, { name: '隔离验收 · 南门', description: '仅供临时浏览器验收，不是实际门岗' })
  await app.services.business.syncAutomaticOrganizations()
  await app.services.chat.syncSchoolGroups()
  } else {
    for(const account of app.services.database.read(s=>s.accounts))users[account.username]=account
  }
  app.get('/__qa__/gate-fixture', (_request, reply) => reply.header('cache-control', 'no-store').send({ fixture: 'gate-browser', environment: 'test', temporaryDatabase: directory }))
  await app.listen({ host: '127.0.0.1', port: 8879 })
  console.log(JSON.stringify({ qa: 'gate-ready', url: 'http://127.0.0.1:8879', temporaryDatabase: directory, accounts: Object.keys(users), password, stationId: station?.id||'',resumed:Boolean(resume),teardown:keepData?'SIGINT/SIGTERM closes service and preserves this temporary QA directory':'SIGINT or SIGTERM removes the disposable database' }))
} catch (cause) {
  console.error(cause.message)
  await close(1)
}
