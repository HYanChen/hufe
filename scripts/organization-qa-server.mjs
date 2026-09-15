// Disposable, loopback-only data for browser acceptance. Never opens the real database.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { createConfig } from '../server/src/config.js'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-browser-qa-'))
const status = { stale: false, itemCount: 0, sourceStatuses: [] }
const app = await buildApp({
  logger: false, refreshContent: false, scheduleContent: false,
  config: createConfig({ env: 'test', dataFile: path.join(directory, 'data.json'), mediaDir: path.join(directory, 'media'), dataHashSecret: 'isolated-browser-qa-only',
    corsOrigins: ['http://localhost:5273', 'http://127.0.0.1:5273', 'http://localhost:4273', 'http://127.0.0.1:4273'],
    content: { cacheFile: path.join(directory, 'content.json') }
  }),
  contentService: { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status, home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, status }), get: async () => null, refresh: async () => status }
})
const users = {}
for (const username of ['qa_admin', 'qa_member']) {
  users[username] = await app.services.accounts.register({ schoolSubject: `isolated-${username}`, name: username === 'qa_admin' ? '验收组织管理员' : '验收校友', personType: 'alumni', department: '信息技术与管理学院', schoolIdentityVerified: true, verificationSource: 'school-registration-check', isAdmin: username === 'qa_admin' }, { username, password: 'Isolated-QA-2026!' })
}
const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'qa_admin', password: 'Isolated-QA-2026!' } })
const headers = { authorization: `Bearer ${admin.json().data.accessToken}` }
const created = await app.inject({ method: 'POST', url: '/api/v1/admin/business/organizations', headers, payload: { name: '信息学院校友会（隔离验收）', type: '同专业校友', city: '长沙', college: '信息技术与管理学院', summary: '本组织仅用于隔离浏览器验收，不写入真实业务数据库。', joinInstructions: '欢迎已实名认证的校友申请加入。' } })
const organization = created.json().data
if (!organization?.id) throw new Error('QA organization creation failed')
const mediaResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/media', headers, payload: { filename: '隔离验收图片.png', mimeType: 'image/png', dataBase64: (await fs.readFile(new URL('../static/tabbar/home-active.png', import.meta.url))).toString('base64') } })
if (mediaResponse.statusCode !== 201) throw new Error('QA media upload failed')
await app.inject({ method: 'PATCH', url: `/api/v1/admin/business/organizations/${organization.id}`, headers, payload: { contactName: '隔离验收联系人', contactPhone: '13800000000', photoAlbumContent: `![隔离验收图片](${mediaResponse.json().data.url})` } })
const postResponse = await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers, payload: { content: '隔离验收动态：用于评论审核与前后台同步测试。', topic: '校园记忆' } })
if (postResponse.statusCode !== 201 || postResponse.json().data.status !== 'published') throw new Error('实名动态未直接发布')
await app.inject({ method: 'POST', url: `/api/v1/admin/business/organizations/${organization.id}/actions`, headers, payload: { action: 'publish' } })
await app.services.database.transaction((data) => {
  const timestamp = new Date().toISOString()
  for (let i = 1; i <= 25; i++) {
    const id = `isolated-member-${i}`
    data.accounts.push({ id, name: i === 1 ? '测试超长姓名展示与自动换行' : `验收成员${i}`, department: i === 1 ? '信息技术与管理学院计算机科学与技术系校友分会' : (i % 2 ? '信息技术与管理学院' : '会计学院'), personType: 'alumni', status: 'active', schoolIdentityVerified: true })
    data.business.submissions.push({ id: `isolated-membership-${i}`, type: 'organization-membership', resourceType: 'organizations', resourceId: organization.id, accountId: id, status: 'approved', createdAt: timestamp })
  }
  data.business.submissions.push({ id: 'isolated-approved-message', type: 'organization-message', resourceType: 'organizations', resourceId: organization.id, accountId: users.qa_admin.id, payload: { content: '欢迎各位校友回家！' }, status: 'approved', adminReply: '期待下一次相聚。', adminNote: '此内部备注不得显示在前台', createdAt: timestamp })
})
await app.listen({ host: '127.0.0.1', port: 8879 })
console.log(`Isolated QA ready. Organization: ${organization.id}. Post: ${postResponse.json().data.id}`)
let closing = false
async function close() { if (closing) return; closing = true; await app.close(); await fs.rm(directory, { recursive: true, force: true }); process.exit(0) }
process.on('SIGINT', close)
process.on('SIGTERM', close)
