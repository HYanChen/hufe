import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import {isRevokedSession,sessionEndMessage} from '../../utils/sessionErrors.js'

test('后台旧账号的 JSON 与图片请求 401 不得清除新账号会话', async () => {
  const source = (await fs.readFile(new URL('../src/lib/api.js', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/gm, '')
    .replace(/import\.meta\.env\?\.VITE_API_BASE_URL/g, "'/api/v1'").replace(/^export /gm, '')
  for (const method of ['api', 'apiBlob']) {
    let token = 'account-a'; let resolve; let expired = 0
    const context = { URL, Headers, isRevokedSession, sessionEndMessage, CustomEvent: class {}, uploadImageRequest: () => assert.fail('普通 API 和图片读取不应进入分片上传流程'), localStorage: { getItem: () => token, removeItem: () => { token = '' }, setItem: (key, value) => { token = value } }, sessionStorage: {getItem:()=>'',removeItem(){}}, window: { location: { origin: 'http://localhost:4180' }, dispatchEvent: () => expired++ }, fetch: () => new Promise(done => { resolve = done }) }
    vm.runInNewContext(`${source}\nglobalThis.run = ${method}`, context)
    const pending = context.run('/business/community-media/photo')
    token = 'account-b'; resolve({ status: 401, ok: false, json: async () => ({ code: 'UNAUTHORIZED', message: '已过期' }) })
    await assert.rejects(pending, /已过期/); assert.equal(token, 'account-b'); assert.equal(expired, 0)
    const current = context.run('/business/community-media/photo')
    resolve({ status: 401, ok: false, json: async () => ({ code: 'UNAUTHORIZED', message: '已过期' }) })
    await assert.rejects(current); assert.equal(token, ''); assert.equal(expired, 1)
  }
})
