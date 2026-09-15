import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { JsonDatabase } from '../src/storage/json-database.js'
import { BusinessService } from '../src/business/service.js'

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-anonymity-'))
  const config = createConfig({ env: 'test', dataFile: path.join(dir, 'data.json'), mediaDir: path.join(dir, 'media'), dataHashSecret: 'anonymity-tests-only' })
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  const contentService = { init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status, home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, status }), get: async () => null }
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService })
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }) })
  const users = {}, headers = {}
  for (const name of ['admin', 'author', 'reader']) {
    users[name] = await app.services.accounts.register({ schoolSubject: `anonymous-${name}`, name: name === 'author' ? '隐私探针真姓名' : name, department: name === 'author' ? '隐私探针学院' : '测试学院', personType: 'student', isAdmin: name === 'admin', verificationSource: 'school-registration-check' }, { username: name, password: `Anon-${name}-Test!2026` })
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: name, password: `Anon-${name}-Test!2026` } })
    headers[name] = { authorization: `Bearer ${res.json().data.accessToken}` }
  }
  const publish = async (payload = {}, who = 'author') => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: headers[who], payload: { content: '独立的校园讨论', anonymous: true, ...payload } })
    assert.equal(response.statusCode, 201, response.body); return response.json().data
  }
  return { app, config, users, headers, publish }
}

test('匿名图文全公开出口、搜索及提及消息不泄露身份，后台真实归属保留且持久', async t => {
  const { app, config, users, headers, publish } = await fixture(t)
  const upload = await app.inject({ method: 'POST', url: '/api/v1/business/community-media', headers: headers.author, payload: { filename: 'photo.png', mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } })
  assert.equal(upload.statusCode, 201)
  const photo = upload.json().data
  const post = await publish({ mediaIds: [photo.id], mentionAccountIds: [users.reader.id], location: '隐私探针住址' })
  await app.services.database.transaction(d=>d.business.reactions.push({id:'anonymous-highlight-like',type:'community-like',resourceId:post.id,accountId:users.reader.id}))
  const noIdentity = object => {
    const json = JSON.stringify(object)
    for (const forbidden of [users.author.id, '隐私探针真姓名', '隐私探针学院', '隐私探针住址', 'authorAccountId', 'actorSnapshot', 'anonymousIdentity']) assert.equal(json.includes(forbidden), false, forbidden)
  }
  noIdentity(post); assert.equal(post.anonymous, true); assert.ok(post.avatar); assert.notEqual(post.authorName, users.author.name)
  await app.services.database.transaction(data => { Object.assign(data.business.resources['community-posts'].find(item => item.id === post.id), { authorMeta: '隐私探针学院', avatarUrl: '隐私探针住址', actorSnapshot: { name: users.author.name } }) })
  for (const who of ['author', 'reader', 'admin']) {
    for (const url of ['/api/v1/business/community-posts', `/api/v1/business/community-posts/${post.id}`, '/api/v1/business/bootstrap', '/api/v1/business/community-highlights']) {
      const response = await app.inject({ url, headers: headers[who] }); assert.equal(response.statusCode, 200)
      const result = response.json().data
      if (url.endsWith('/bootstrap')) {
        // Automatic college organizations are independently public school data,
        // not author metadata attached to an anonymous community post.
        const { organizations, ...content } = result
        noIdentity(content)
        for (const organization of organizations) {
          if (organization.college === users.author.department) {
            assert.equal(organization.automatic, true)
            assert.equal(organization.name, `${users.author.department}校友组织`)
            const { name, college, ...publicOrganization } = organization
            noIdentity(publicOrganization)
          } else noIdentity(organization)
        }
        assert.ok(content.communityPosts.some(row => row.id === post.id))
      } else noIdentity(result)
      if(url.endsWith('community-highlights'))assert.ok(response.json().data.items.some(r=>r.id===post.id))
    }
  }
  for (const query of ['query=隐私探针真姓名', 'authorName=隐私探针真姓名', 'query=隐私探针学院', 'query=隐私探针住址']) {
    const list = await app.inject({ url: '/api/v1/business/community-posts?' + encodeURI(query), headers: headers.reader })
    assert.equal(list.json().data.items.some(item => item.id === post.id), false)
  }
  const inbox = await app.inject({ url: '/api/v1/business/me/inbox', headers: headers.reader }); noIdentity(inbox.json().data)
  assert.ok(inbox.body.includes(post.authorName))
  const admin = await app.inject({ url: `/api/v1/admin/business/community-posts/${post.id}`, headers: headers.admin })
  assert.equal(admin.json().data.authorAccountId, users.author.id); assert.equal(admin.json().data.authorName, users.author.name)
  assert.equal(admin.json().data.publicationMode, 'anonymous'); assert.equal(admin.json().data.anonymousNickname, post.authorName)
  assert.equal((await app.inject({ url: `/api/v1/admin/business/community-posts/${post.id}`, headers: headers.reader })).statusCode, 403)
  const persisted = await new JsonDatabase(config.dataFile).init()
  assert.equal(new BusinessService(persisted, config).getPublic('community-posts', post.id, users.reader.id).authorName, post.authorName)
  assert.equal((await app.inject({ url: photo.url, headers: headers.reader })).statusCode, 200)
  assert.equal((await app.inject({ url: photo.url })).statusCode, 401)
})

test('同帖匿名发言昵称头像一致，跨帖独立；实名评论不串用匿名，后台可追溯', async t => {
  const { app, users, headers, publish } = await fixture(t)
  const post = await publish(), secondPost = await publish()
  assert.notEqual(post.authorName, secondPost.authorName)
  const comment = async (id, anonymous, who = 'author', generic = false) => {
    const response = await app.inject({ method: 'POST', url: generic ? '/api/v1/business/submissions' : `/api/v1/business/community-posts/${id}/comments`, headers: headers[who], payload: generic ? { type: 'community-comment', resourceId: id, payload: { content: '匿名讨论内容', anonymous } } : { content: '匿名讨论内容', anonymous } })
    assert.equal(response.statusCode, 201, response.body); return response.json().data
  }
  const first = await comment(post.id, true), next = await comment(post.id, true, 'author', true)
  await comment(post.id, false)
  const readerComment = await comment(post.id, true, 'reader')
  const get = async who => (await app.inject({ url: `/api/v1/business/community-posts/${post.id}/comments`, headers: headers[who] })).json().data.items
  const items = await get('reader'), a = items.find(item => item.id === first.id), b = items.find(item => item.id === next.id)
  assert.equal(a.authorName, post.authorName); assert.equal(a.avatar, post.avatar); assert.equal(a.authorName, b.authorName); assert.equal(a.mine, false)
  assert.ok(items.some(item => item.authorName === users.author.name && !item.anonymous))
  assert.notEqual(items.find(item => item.id === readerComment.id).authorName, post.authorName)
  assert.equal((await get('author')).find(item => item.id === first.id).mine, true)
  assert.equal(JSON.stringify(a).includes(users.author.id), false)
  const admin = (await app.inject({ url: `/api/v1/admin/business/applications/${first.id}`, headers: headers.admin })).json().data
  assert.equal(admin.applicantName, users.author.name); assert.equal(admin.authorAccountId, users.author.id); assert.equal(admin.anonymousNickname, post.authorName)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/business/me/submissions/${first.id}/cancel`, headers: headers.reader, payload: {} })).statusCode, 404)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/business/me/submissions/${first.id}/cancel`, headers: headers.author, payload: {} })).statusCode, 200)
  assert.equal((await get('reader')).some(item => item.id === first.id), false)
})

test('匿名选项严格校验，伪造头像被拒绝，历史实名和组织留言不受影响', async t => {
  const { app, users, headers, publish } = await fixture(t)
  const post = await publish({ anonymous: false })
  assert.equal(post.authorName, users.author.name)
  for (const anonymous of ['true', 'false', 1, null, {}, []]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: headers.author, payload: { content: '无效选项', anonymous } })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/business/community-posts/${post.id}/comments`, headers: headers.author, payload: { content: '无效选项', anonymous } })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: headers.author, payload: { type: 'community-comment', resourceId: post.id, payload: { content: '无效选项', anonymous } } })).statusCode, 400)
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/business/community-posts', headers: headers.author, payload: { content: '伪造匿名形象', anonymous: true, anonymousIdentity: { name: '指定昵称' } } })).statusCode, 400)
  const legacy = await app.inject({ method: 'POST', url: `/api/v1/business/community-posts/${post.id}/comments`, headers: headers.author, payload: { content: '旧客户端实名评论' } })
  assert.equal(legacy.statusCode, 201); assert.equal(legacy.json().data.anonymous, false)
  await app.services.database.transaction(data => { data.business.resources.organizations.push({ id: 'org', status: 'published', name: '组织' }) })
  const org = await app.inject({ method: 'POST', url: '/api/v1/business/submissions', headers: headers.author, payload: { type: 'organization-message', resourceId: 'org', payload: { content: '组织实名留言', anonymous: true } } })
  assert.equal(org.statusCode, 201); assert.equal(org.json().data.anonymous, undefined)
  assert.equal((await app.inject({ url: '/api/v1/business/organizations/org/messages', headers: headers.reader })).json().data.items[0].authorName, users.author.name)
})

test('管理员不能把匿名内容改回实名或伪造真实姓名，下架同步详情与轮播', async t => {
  const { app, users, headers, publish } = await fixture(t)
  const post = await publish()
  const base = `/api/v1/admin/business/community-posts/${post.id}`
  for (const payload of [{ anonymous: false }, { anonymousIdentity: { name: '覆盖' } }, { authorName: '覆盖' }]) {
    assert.equal((await app.inject({ method: 'PATCH', url: base, headers: headers.admin, payload: { ...payload, expectedRevision: post.revision } })).statusCode, 400)
  }
  const comment = (await app.inject({ method: 'POST', url: `/api/v1/business/community-posts/${post.id}/comments`, headers: headers.author, payload: { content: '匿名评论', anonymous: true } })).json().data
  const commentUrl = `/api/v1/admin/business/applications/${comment.id}`
  for (const payload of [{ anonymous: false }, { anonymousIdentity: { name: '伪造' } }, ...['applicantName', 'submitterName', 'volunteerName', 'authorUsername'].map(key => ({ [key]: '伪造真实姓名' }))]) {
    assert.equal((await app.inject({ method: 'PATCH', url: commentUrl, headers: headers.admin, payload })).statusCode, 400)
  }
  await app.services.database.transaction(data => {
    Object.assign(data.business.submissions.find(item => item.id === comment.id).payload, { applicantName: '历史错误姓名', submitterName: '历史错误姓名', volunteerName: '历史错误姓名' })
  })
  const commentView = (await app.inject({ url: commentUrl, headers: headers.admin })).json().data
  for (const key of ['applicantName', 'submitterName', 'volunteerName']) assert.equal(commentView[key], users.author.name)
  const commentEdit = await app.inject({ method: 'PATCH', url: commentUrl, headers: headers.admin, payload: { content: '更正后的匿名评论', adminReply: '管理回复', adminNote: '内部备注', expectedRevision: commentView.revision } })
  assert.equal(commentEdit.statusCode, 200, commentEdit.body)
  const publicComment = (await app.inject({ url: `/api/v1/business/community-posts/${post.id}/comments`, headers: headers.reader })).json().data.items.find(item => item.id === comment.id)
  assert.equal(publicComment.content, '更正后的匿名评论'); assert.equal(publicComment.reply, '管理回复'); assert.equal(publicComment.authorName, post.authorName)
  assert.equal(JSON.stringify(publicComment).includes('内部备注'), false)
  const edit = await app.inject({ method: 'PATCH', url: base, headers: headers.admin, payload: { content: '更正正文但保留匿名', expectedRevision: post.revision } })
  assert.equal(edit.statusCode, 200, edit.body)
  assert.equal((await app.inject({ url: `/api/v1/business/community-posts/${post.id}`, headers: headers.reader })).json().data.authorName, post.authorName)
  const offline = await app.inject({ method: 'POST', url: base + '/actions', headers: headers.admin, payload: { action: 'unpublish', reason: '验收下架', expectedRevision: edit.json().data.revision } })
  assert.equal(offline.statusCode, 200, offline.body)
  assert.equal((await app.inject({ url: `/api/v1/business/community-posts/${post.id}`, headers: headers.reader })).statusCode, 404)
  assert.equal((await app.inject({ url: '/api/v1/business/community-highlights', headers: headers.reader })).json().data.items.some(item => item.id === post.id), false)
})
