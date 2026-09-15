import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const image = { filename: '校园.png', mimeType: 'image/png', dataBase64: png }
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-wall-'))
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  const contentService = { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status, home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, status }), get: async () => null }
  const app = await buildApp({ config: createConfig({ env: 'test', dataFile: path.join(dir, 'data.json'), mediaDir: path.join(dir, 'media'), dataHashSecret: 'wall-tests-only' }), logger: false, refreshContent: false, scheduleContent: false, contentService })
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }) })
  const users = {}; const headers = {}
  for (const [username, name, personType, isAdmin] of [['admin', '内容管理员', 'staff', true], ['author', '测试作者', 'student', false], ['reader', '测试读者', 'student', false], ['alumni', '测试校友', 'alumni', false]]) {
    users[username] = await app.services.accounts.register({ schoolSubject: `wall-${username}`, name, department: '信息技术学院', personType, isAdmin, verificationSource: 'school-registration-check' }, { username, password: `Wall-${username}-Test!2026` })
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: `Wall-${username}-Test!2026` } })
    headers[username] = { authorization: `Bearer ${response.json().data.accessToken}` }
  }
  const upload = async (who = 'author') => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/business/community-media', headers: headers[who], payload: image })
    assert.equal(response.statusCode, 201, response.body); return response.json().data
  }
  const publish = (payload, who = 'author') => app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: headers[who], payload })
  return { app, users, headers, upload, publish }
}

test('校园墙图文、自建多话题、真实提及与站内通知贯通前后台', async (t) => {
  const { app, users, headers, upload, publish } = await fixture(t)
  const photo = await upload()
  assert.equal((await app.inject({ url: photo.url })).statusCode, 401)
  assert.equal((await app.inject({ url: photo.url, headers: headers.reader })).statusCode, 404)
  assert.equal((await app.inject({ url: photo.url, headers: headers.author })).statusCode, 200)
  assert.equal((await app.inject({ url: `/api/v1/media/${photo.id}.png` })).statusCode, 404)
  const result = await publish({ content: '今天的校园晚霞 #一起散步 #摄影', topics: ['#摄影#', '一起散步'], mediaIds: [photo.id], mentionAccountIds: [users.reader.id, users.reader.id], mentions: [{ id: users.reader.id, name: '伪造名字' }], visibility: 'campus' })
  assert.equal(result.statusCode, 201, result.body)
  const post = result.json().data
  assert.equal(post.status, 'published')
  assert.deepEqual(post.topics, ['摄影', '一起散步'])
  assert.deepEqual(post.mentions, [{ id: users.reader.id, name: '测试读者' }])
  assert.deepEqual(post.images, [{ id: photo.id, url: photo.url }])
  assert.equal((await app.inject({ url: photo.url, headers: headers.reader })).statusCode, 200)
  assert.equal((await app.inject({ url: photo.url, headers: headers.alumni })).statusCode, 404)
  const readPhoto = await app.inject({ url: photo.url, headers: headers.reader })
  assert.equal(readPhoto.headers['cache-control'], 'private, no-store')
  assert.deepEqual(readPhoto.rawPayload, Buffer.from(png, 'base64'))
  const list = await app.inject({ url: '/api/v1/business/community-posts?topic=' + encodeURIComponent('一起散步'), headers: headers.reader })
  assert.equal(list.json().data.items[0].id, post.id)
  const details = await app.inject({ url: `/api/v1/business/community-posts/${post.id}`, headers: headers.reader })
  assert.deepEqual(details.json().data.images, post.images)
  const inbox = app.services.business.inbox(users.reader)
  const mentions = inbox.items.filter(item => item.type === 'community.mention')
  assert.equal(mentions.length, 1)
  assert.equal(mentions[0].kind, 'interaction')
  assert.equal(app.services.business.inbox(users.reader, { kind: 'interaction' }).items[0].id, mentions[0].id)
  assert.equal(app.services.business.inbox(users.reader, { kind: 'progress' }).items.some(item => item.type === 'community.mention'), false)
  assert.equal(mentions[0].target, `/pages/community-comments/index?id=${post.id}`)
  assert.doesNotMatch(JSON.stringify(inbox), /伪造名字/)
  const edit = await app.inject({ method: 'PATCH', url: `/api/v1/admin/business/community-posts/${post.id}`, headers: headers.admin, payload: { content: '更新校园晚霞', topics: ['#新摄影话题'] } })
  assert.equal(edit.statusCode, 200, edit.body)
  assert.deepEqual(edit.json().data.topics, ['新摄影话题'])
  assert.deepEqual(edit.json().data.images, post.images)
  for (const field of ['images', 'mediaIds', 'mentions', 'mentionAccountIds']) assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/admin/business/community-posts/${post.id}`, headers: headers.admin, payload: { [field]: [] } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'DELETE', url: photo.url, headers: headers.author })).statusCode, 409)
  const actionUrl = `/api/v1/admin/business/community-posts/${post.id}/actions`
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: headers.admin, payload: { action: 'unpublish', reason: '图片内容需核实' } })).statusCode, 200)
  for (const who of ['author', 'reader', 'alumni']) assert.equal((await app.inject({ url: photo.url, headers: headers[who] })).statusCode, 404)
  assert.equal((await app.inject({ url: photo.url, headers: headers.admin })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: headers.admin, payload: { action: 'publish' } })).statusCode, 200)
  assert.equal((await app.inject({ url: photo.url, headers: headers.reader })).statusCode, 200)
})

test('图片归属、并发绑定、非法图片、未实名及过期草稿安全边界', async (t) => {
  const { app, users, headers, upload, publish } = await fixture(t)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/business/community-media', payload: image })).statusCode, 401)
  for (const payload of [{ ...image, mimeType: 'image/svg+xml' }, { ...image, dataBase64: Buffer.from('<script>bad</script>').toString('base64') }]) assert.equal((await app.inject({ method: 'POST', url: '/api/v1/business/community-media', headers: headers.author, payload })).statusCode, 400)
  const photo = await upload()
  assert.equal((await publish({ content: '他人不能绑定照片', mediaIds: [photo.id] }, 'reader')).statusCode, 409)
  assert.equal((await publish({ content: '不能伪造外部图片', images: ['https://example.com/photo.png'] })).statusCode, 400)
  assert.equal((await publish({ content: '不能冒用私有材料', mediaIds: ['manual-material-id'] })).statusCode, 409)
  const results = await Promise.all([publish({ mediaIds: [photo.id] }), publish({ mediaIds: [photo.id] })])
  assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409])
  const staged = await upload()
  assert.equal((await app.inject({ method: 'DELETE', url: staged.url, headers: headers.reader })).statusCode, 404)
  assert.equal((await app.inject({ method: 'DELETE', url: staged.url, headers: headers.author })).statusCode, 200)
  assert.equal((await app.inject({ url: staged.url, headers: headers.author })).statusCode, 404)
  const expired = await upload()
  await app.services.database.transaction(data => { data.communityMedia.find(item => item.id === expired.id).expiresAt = '2020-01-01' })
  assert.equal((await publish({ mediaIds: [expired.id] })).statusCode, 409)
  await app.services.media.cleanupCommunityDrafts()
  assert.equal((await app.inject({ url: expired.url, headers: headers.author })).statusCode, 404)
  await app.services.database.transaction(data => { data.accounts.find(item => item.id === users.author.id).schoolIdentityVerified = false })
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/business/community-media', headers: headers.author, payload: image })).statusCode, 403)
})

test('话题和提及上限、无效账号、受众限制及候选搜索隐私', async (t) => {
  const { app, users, headers, publish } = await fixture(t)
  assert.equal((await app.inject({ url: '/api/v1/business/community-people?query=测试' })).statusCode, 401)
  assert.deepEqual((await app.inject({ url: '/api/v1/business/community-people', headers: headers.author })).json().data.items, [])
  const search = await app.inject({ url: '/api/v1/business/community-people?query=' + encodeURIComponent('测试'), headers: headers.author })
  for (const person of search.json().data.items) assert.deepEqual(Object.keys(person).sort(), ['department','id','name','personType'])
  assert.doesNotMatch(search.body, /username|phone|studentId|identity|password/)
  for (const payload of [
    { topics: '不接受字符串' }, { topics: ['空 格'] }, { topics: ['a','b','c','d','e','f'] }, { topics: ['字'.repeat(21)] },
    { mentionAccountIds: ['not-an-account'] }, { mentionAccountIds: Array.from({ length: 11 }, (_, i) => 'id-' + i) },
    { mediaIds: Array.from({ length: 10 }, (_, i) => 'id-' + i) }, { content: '字'.repeat(2001) },
    { mentionAccountIds: [users.alumni.id], visibility: 'campus' }
  ]) assert.equal((await publish({ content: '有效的正文', ...payload })).statusCode, 400, JSON.stringify(payload).slice(0, 120))
  await app.services.database.transaction(data => { data.accounts.find(item => item.id === users.reader.id).schoolIdentityVerified = false })
  assert.equal((await publish({ content: '不能提及已失效人员', mentionAccountIds: [users.reader.id] })).statusCode, 400)
  const legacy = await publish({ content: '兼容旧话题字段', topic: '校园记忆' })
  assert.equal(legacy.statusCode, 201)
  assert.deepEqual(legacy.json().data.topics, ['校园记忆'])
  assert.equal((await publish({ content: '' })).statusCode, 400)
})

test('过期图片清理逐文件容错并可重试，孤儿宽限期保护新上传和已发布图片', async (t) => {
  const { app, upload, publish } = await fixture(t)
  const first = await upload(); const second = await upload(); const bound = await upload()
  assert.equal((await publish({ mediaIds: [bound.id] })).statusCode, 201)
  await app.services.database.transaction(data => {
    for (const item of data.communityMedia) if (item.id !== bound.id) item.expiresAt = '2020-01-01'
  })
  const media = app.services.media; const remove = media.removePrivateFrom.bind(media)
  media.removePrivateFrom = (directory, filename) => filename.startsWith(first.id) ? Promise.reject(Object.assign(new Error('临时删除失败'), { code: 'EACCES' })) : remove(directory, filename)
  const orphan = `${randomUUID()}.png`; const recent = `${randomUUID()}.png`
  for (const file of [orphan, recent]) await fs.writeFile(path.join(media.communityDirectory, file), Buffer.from(png, 'base64'))
  const old = new Date(Date.now() - 2 * 86400000)
  await fs.utimes(path.join(media.communityDirectory, orphan), old, old)
  await fs.utimes(path.join(media.communityDirectory, `${bound.id}.png`), old, old)
  const result = await media.cleanupCommunityDrafts()
  assert.deepEqual(result.failed, [`${first.id}.png`])
  await fs.access(path.join(media.communityDirectory, `${first.id}.png`))
  for (const file of [`${second.id}.png`, orphan]) await assert.rejects(fs.access(path.join(media.communityDirectory, file)), { code: 'ENOENT' })
  for (const file of [recent, `${bound.id}.png`]) await fs.access(path.join(media.communityDirectory, file))
  media.removePrivateFrom = remove
  assert.deepEqual((await media.cleanupCommunityDrafts()).failed, [])
  await assert.rejects(fs.access(path.join(media.communityDirectory, `${first.id}.png`)), { code: 'ENOENT' })
  assert.ok(media.communityCleanupTimer)
  await media.stopCommunityCleanupScheduler(); assert.equal(media.communityCleanupTimer, null)
})

test('服务端相对依赖均留在 server 发行目录内，兼容独立容器挂载', async () => {
  const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
  async function check(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { await check(file); continue }
      if (!file.endsWith('.js')) continue
      const source = await fs.readFile(file, 'utf8')
      for (const match of source.matchAll(/(?:from\s*|import\s*\()['"](\.[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(file), match[1])
        assert.ok(target.startsWith(root + path.sep), `${file} 引用了发行目录外的 ${match[1]}`)
        await fs.access(target)
      }
    }
  }
  await check(path.join(root, 'src'))
})

test('图片读取中途下架，晚到文件不能越过最新权限校验', async (t) => {
  const { app, upload, publish, headers } = await fixture(t)
  const photo = await upload(); const post = (await publish({ mediaIds: [photo.id] })).json().data
  const media = app.services.media; const read = media.readPrivateFrom.bind(media)
  let ready, release
  const entered = new Promise(resolve => { ready = resolve }); const held = new Promise(resolve => { release = resolve })
  media.readPrivateFrom = async (...args) => { const file = await read(...args); ready(); await held; return file }
  const pending = app.inject({ url: photo.url, headers: headers.reader }).then(response => response)
  await entered
  try {
    const result = await app.inject({ method: 'POST', url: `/api/v1/admin/business/community-posts/${post.id}/actions`, headers: headers.admin, payload: { action: 'unpublish', reason: '测试读取时同步下架' } })
    assert.equal(result.statusCode, 200)
  } finally { release() }
  assert.equal((await pending).statusCode, 404)
})
