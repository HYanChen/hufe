import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function contentStub() {
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  return {
    init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status,
    home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, page: 1, pageSize: 12, status }),
    get: async () => null, refresh: async () => status
  }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-media-test-'))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    mediaDir: path.join(directory, 'media'),
    dataHashSecret: 'media-flow-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  await app.services.accounts.register({
    schoolSubject: 'media-admin', name: '媒体管理员', personType: 'staff', department: '宣传部',
    verificationSource: 'school-registration-check', isAdmin: true
  }, { username: 'media_admin', password: 'StrongMedia!2026' })
  await app.services.accounts.register({
    schoolSubject: 'media-user', name: '媒体普通用户', personType: 'student', department: '财政金融学院',
    verificationSource: 'school-registration-check', isAdmin: false
  }, { username: 'media_user', password: 'StrongUser!2026' })

  const login = async (username, password) => (await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { username, password }
  })).json().data.accessToken
  return {
    app,
    adminToken: await login('media_admin', 'StrongMedia!2026'),
    userToken: await login('media_user', 'StrongUser!2026')
  }
}

test('后台图片上传校验真实格式并可通过公开只读地址访问', async (t) => {
  const { app, adminToken } = await fixture(t)
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/media',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { filename: '活动封面.png', mimeType: 'image/png', dataBase64: onePixelPng }
  })
  assert.equal(uploaded.statusCode, 201)
  const result = uploaded.json().data
  assert.match(result.url, /^\/api\/v1\/media\/[0-9a-f-]+\.png$/)
  assert.equal(result.mimeType, 'image/png')
  assert.ok(result.size > 0)

  const image = await app.inject({ method: 'GET', url: result.url })
  assert.equal(image.statusCode, 200)
  assert.equal(image.headers['content-type'], 'image/png')
  assert.match(image.headers['cache-control'], /immutable/)
  assert.equal(image.headers['cross-origin-resource-policy'], 'cross-origin')
  assert.deepEqual(image.rawPayload, Buffer.from(onePixelPng, 'base64'))
})

test('图片上传只允许后台账号并拒绝伪造类型和 SVG', async (t) => {
  const { app, adminToken, userToken } = await fixture(t)
  const noSession = await app.inject({
    method: 'POST', url: '/api/v1/admin/media',
    payload: { filename: 'x.png', mimeType: 'image/png', dataBase64: onePixelPng }
  })
  assert.equal(noSession.statusCode, 401)

  const normalUser = await app.inject({
    method: 'POST', url: '/api/v1/admin/media',
    headers: { authorization: `Bearer ${userToken}` },
    payload: { filename: 'x.png', mimeType: 'image/png', dataBase64: onePixelPng }
  })
  assert.equal(normalUser.statusCode, 403)

  const svg = await app.inject({
    method: 'POST', url: '/api/v1/admin/media',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { filename: 'x.svg', mimeType: 'image/svg+xml', dataBase64: Buffer.from('<svg/>').toString('base64') }
  })
  assert.equal(svg.statusCode, 400)
  assert.equal(svg.json().code, 'MEDIA_TYPE_UNSUPPORTED')

  const mismatch = await app.inject({
    method: 'POST', url: '/api/v1/admin/media',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { filename: 'x.gif', mimeType: 'image/gif', dataBase64: onePixelPng }
  })
  assert.equal(mismatch.statusCode, 400)
  assert.equal(mismatch.json().code, 'MEDIA_SIGNATURE_MISMATCH')
})

test('媒体读取接口拒绝未知文件名和路径穿越', async (t) => {
  const { app } = await fixture(t)
  const missing = await app.inject({ method: 'GET', url: '/api/v1/media/not-a-media-file.png' })
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.json().code, 'MEDIA_NOT_FOUND')
})
