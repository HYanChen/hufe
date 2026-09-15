import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { JsonDatabase } from '../src/storage/json-database.js'

const image = { filename: '重逢.png', mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-albums-'))
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  const contentService = { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status, home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, status }), get: async () => null }
  const app = await buildApp({ config: createConfig({ env: 'test', dataFile: path.join(dir, 'data.json'), mediaDir: path.join(dir, 'media'), dataHashSecret: 'albums-tests-only' }), logger: false, refreshContent: false, scheduleContent: false, contentService })
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }) })
  const users = {}, headers = {}
  for (const username of ['admin', 'author', 'other', 'manager']) {
    users[username] = await app.services.accounts.register({ schoolSubject: `album-${username}`, name: `${username}测试校友`, department: '测试学院', personType: 'alumni', isAdmin: username === 'admin', verificationSource: 'school-registration-check' }, { username, password: `Album-${username}-Test!2026` })
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: `Album-${username}-Test!2026` } })
    headers[username] = { authorization: `Bearer ${login.json().data.accessToken}` }
  }
  await app.services.database.transaction(state => { state.business.resources.organizations.push({ id: 'org-one', name: '相册组织', status: 'published', photoAlbumContent: '历史相册保持原状' }, { id: 'org-two', name: '其他组织', status: 'published' }) })
  return { app, users, headers, dir, base: '/api/v1/business/organizations/org-one/albums' }
}

test('实名非成员建相册与共同上传、所有权、持久化、删除和分页', async t => {
  const { app, users, headers, dir, base } = await fixture(t)
  assert.equal((await app.inject({ method: 'POST', url: base, payload: { title: '相册' } })).statusCode, 401)
  assert.equal((await app.inject({ method: 'POST', url: base, headers: headers.author, payload: { title: ' '.repeat(5) } })).statusCode, 400)
  const created = await app.inject({ method: 'POST', url: base, headers: headers.author, payload: { title: '毕业重逢', description: '共同记忆', ownerAccountId: users.admin.id, status: 'offline' } })
  assert.equal(created.statusCode, 201, created.body)
  const album = created.json().data
  assert.equal(album.authorName, users.author.name); assert.equal(album.status, 'published')
  const second = await app.inject({ method: 'POST', url: base, headers: headers.other, payload: { title: '另一位校友的相册' } })
  assert.equal(second.statusCode, 201)
  assert.equal((await app.inject({ url: base + '?page=2&pageSize=1' })).json().data.items[0].id, album.id)
  assert.equal((await app.inject({ url: base + '?pageSize=51' })).statusCode, 400)
  const upload = await app.inject({ method: 'POST', url: `${base}/${album.id}/photos`, headers: headers.other, payload: { ...image, caption: '同窗合照', ownerAccountId: users.author.id } })
  assert.equal(upload.statusCode, 201, upload.body)
  const photo = upload.json().data
  assert.equal(photo.authorName, users.other.name)
  const fetched = await app.inject({ url: photo.url })
  assert.equal(fetched.statusCode, 200); assert.deepEqual(fetched.rawPayload, Buffer.from(image.dataBase64, 'base64'))
  assert.equal(fetched.headers['cache-control'], 'private, no-store')
  assert.equal(fetched.headers['cross-origin-resource-policy'], 'cross-origin')
  assert.equal((await app.inject({ url: `/api/v1/media/${photo.id}.png` })).statusCode, 404)
  const list = await app.inject({ url: `${base}/${album.id}/photos`, headers: headers.author })
  assert.equal(list.json().data.items[0].canDelete, false)
  assert.doesNotMatch(list.body, /ownerAccountId|studentId|filename|dataBase64/)
  assert.equal((await app.inject({ method: 'PATCH', url: `${base}/${album.id}`, headers: headers.other, payload: { title: '篡改' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/business/organizations/org-one/album-photos/${photo.id}`, headers: headers.author })).statusCode, 403)
  const edit = await app.inject({ method: 'PATCH', url: `${base}/${album.id}`, headers: headers.author, payload: { title: '更新相册名', organizationId: 'org-two' } })
  assert.equal(edit.statusCode, 200); assert.equal(edit.json().data.organizationId, 'org-one')
  const persisted = await new JsonDatabase(path.join(dir, 'data.json')).init()
  assert.equal(persisted.read(state => state.organizationAlbumPhotos[0].id), photo.id)
  assert.equal(persisted.read(state => state.business.resources.organizations.find(item => item.id === 'org-one').photoAlbumContent), '历史相册保持原状')
  const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/business/organizations/org-one/album-photos/${photo.id}`, headers: headers.other })
  assert.equal(deleted.statusCode, 200)
  assert.equal((await fs.readdir(app.services.organizationAlbums.directory)).length, 0)
  assert.equal((await app.inject({ url: photo.url })).statusCode, 404)
  assert.equal((await app.inject({ url: `${base}/${album.id}/photos` })).json().data.total, 0)
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/${album.id}`, headers: headers.author })).statusCode, 200)
  assert.equal((await app.inject({ url: `${base}/${album.id}/photos` })).statusCode, 404)
})

test('下架、恢复、组织权限范围与读取中途状态变化均在服务端校验', async t => {
  const { app, headers, users, base } = await fixture(t)
  const album = (await app.inject({ method: 'POST', url: base, headers: headers.author, payload: { title: '审核相册' } })).json().data
  const photo = (await app.inject({ method: 'POST', url: `${base}/${album.id}/photos`, headers: headers.other, payload: image })).json().data
  const actionUrl = `/api/v1/admin/organizations/org-one/album-photos/${photo.id}/actions`
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: headers.other, payload: { action: 'unpublish', reason: '无权限' } })).statusCode, 403)
  const grant = await app.inject({ method: 'POST', url: '/api/v1/admin/business/organizations/org-two/managers', headers: headers.admin, payload: { accountId: users.manager.id } })
  assert.equal(grant.statusCode, 201, grant.body)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: headers.manager, payload: { action: 'unpublish', reason: '其他组织管理人员' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: headers.admin, payload: { action: 'unpublish' } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: headers.admin, payload: { action: 'unpublish', reason: '不合适照片' } })).statusCode, 200)
  assert.equal((await app.inject({ url: photo.url })).statusCode, 404)
  assert.equal((await app.inject({ url: `${base}/${album.id}/photos` })).json().data.total, 0)
  assert.equal((await app.inject({ url: `/api/v1/admin/organization-album-photos/${photo.id}`, headers: headers.admin })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: actionUrl, headers: headers.admin, payload: { action: 'publish', reason: '核实后恢复' } })).statusCode, 200)
  const albumAction = `/api/v1/admin/organizations/org-one/albums/${album.id}/actions`
  assert.equal((await app.inject({ method: 'POST', url: albumAction, headers: headers.admin, payload: { action: 'unpublish', reason: '相册待核实' } })).statusCode, 200)
  assert.equal((await app.inject({ url: photo.url })).statusCode, 404)
  assert.equal((await app.inject({ method: 'PATCH', url: `${base}/${album.id}`, headers: headers.author, payload: { title: '不能自行解除下架', status: 'published' } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${album.id}/photos`, headers: headers.other, payload: image })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: albumAction, headers: headers.admin, payload: { action: 'publish', reason: '恢复' } })).statusCode, 200)
  const originalRead = app.services.media.readPrivateFrom.bind(app.services.media)
  app.services.media.readPrivateFrom = async (...args) => { const file = await originalRead(...args); await app.services.database.transaction(state => { state.business.resources.organizations.find(item => item.id === 'org-one').status = 'offline' }); return file }
  assert.equal((await app.inject({ url: photo.url })).statusCode, 404)
  assert.equal((await app.inject({ url: base })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: base, headers: headers.author, payload: { title: '未公开组织' } })).statusCode, 404)
  assert.ok(app.services.database.read(state => state.auditLogs.some(item => item.action === 'organization_album.photo_unpublish' && item.details.reason === '不合适照片')))
})

test('上传格式、账号失效及事务失败不会遗留可访问照片', async t => {
  const { app, headers, users, base } = await fixture(t)
  const album = (await app.inject({ method: 'POST', url: base, headers: headers.author, payload: { title: '安全相册' } })).json().data
  const url = `${base}/${album.id}/photos`
  assert.equal((await app.inject({ method: 'POST', url, headers: headers.author, payload: { ...image, mimeType: 'image/jpeg' } })).statusCode, 400)
  await app.services.database.transaction(state => { state.accounts.find(item => item.id === users.author.id).schoolIdentityVerified = false })
  assert.equal((await app.inject({ method: 'POST', url, headers: headers.author, payload: image })).statusCode, 403)
  await app.services.database.transaction(state => { state.accounts.find(item => item.id === users.author.id).schoolIdentityVerified = true })
  const persist = app.services.database.persist
  app.services.database.persist = async () => { throw new Error('simulated disk failure') }
  assert.equal((await app.inject({ method: 'POST', url, headers: headers.author, payload: image })).statusCode, 500)
  app.services.database.persist = persist
  assert.equal((await fs.readdir(app.services.organizationAlbums.directory)).length, 0)
  assert.equal((await app.inject({ url: `${base}/${album.id}/photos` })).json().data.total, 0)
})

test('模块级后台运营账号无需学校实名即可管理，重试不会产生重复相册和照片', async t => {
  const { app, users, headers, base } = await fixture(t)
  const createInput = { title: '幂等相册', clientRequestId: 'create-once' }
  const first = (await app.inject({ method: 'POST', url: base, headers: headers.author, payload: createInput })).json().data
  const again = (await app.inject({ method: 'POST', url: base, headers: headers.author, payload: createInput })).json().data
  assert.equal(first.id, again.id)
  const uploaded = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `${base}/${first.id}/photos`, headers: headers.other, payload: { ...image, clientRequestId: 'upload-once' } })))
  assert.equal(uploaded[0].json().data.id, uploaded[1].json().data.id)
  assert.equal((await fs.readdir(app.services.organizationAlbums.directory)).length, 1)
  await app.services.database.transaction(state => {
    state.accounts.find(item => item.id === users.manager.id).schoolIdentityVerified = false
    state.adminDelegations.push({ id: 'module-grant', accountId: users.manager.id, resource: 'organizations', resourceId: null, status: 'active', permissions: ['read', 'moderate'], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() })
  })
  const adminBase = '/api/v1/admin/organizations/org-one/albums'
  const management = await app.inject({ url: adminBase, headers: headers.manager })
  assert.equal(management.statusCode, 200, management.body)
  assert.equal((await app.inject({ method: 'POST', url: `${adminBase}/${first.id}/actions`, headers: headers.manager, payload: { action: 'unpublish', reason: '模块级相册管理' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `${adminBase}/${first.id}/actions`, headers: headers.manager, payload: { action: 'publish', reason: '恢复' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/${first.id}`, headers: headers.author })).statusCode, 200)
  assert.equal((await fs.readdir(app.services.organizationAlbums.directory)).length, 0)
})
