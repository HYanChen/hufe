import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

async function comments(overrides = {}) {
  const source = await fs.readFile(new URL('../pages/community-comments/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm, '').replace('export default', 'globalThis.options =')
  const context = {
    CommunityAvatar: {}, CommunityPostBody: {}, isVerified: () => true,
    getUser: () => ({ id: 'account-a' }), getAccessToken: () => 'token-a',
    getBusinessDetail: async () => ({ id: 'post-a', content: '正文' }),
    getCommunityComments: async () => ({ items: [], total: 0 }),
    submitCommunityComment: async () => ({}), uni: { $on() {}, $off() {} }, ...overrides
  }
  vm.runInNewContext(script, context)
  const options = context.options; const page = { ...options.data(), postId: 'post-a' }
  for (const [name, method] of Object.entries(options.methods)) page[name] = method.bind(page)
  return { page, options }
}

test('匿名评论失败可重试，成功后保留选择以免下一条意外实名', async () => {
  let fail = true; const payloads = []
  const { page } = await comments({ submitCommunityComment: async (...args) => { payloads.push(args); if (fail) throw new Error('网络中断') } })
  await page.reload(); page.draft = '匿名评论内容'; page.anonymous = true
  await page.submit(); assert.equal(page.draft, '匿名评论内容'); assert.equal(page.anonymous, true); assert.equal(page.posting, false)
  fail = false; await page.submit()
  assert.equal(payloads.length, 2)
  for (const [postId, content, options] of payloads) {
    assert.equal(postId, 'post-a'); assert.equal(content, '匿名评论内容'); assert.equal(options.anonymous, true)
  }
  assert.equal(page.draft, ''); assert.equal(page.anonymous, true)
})

test('评论匿名选择随同账号返回保留，换账号或退出实名状态清除', async () => {
  let id = 'account-a'; let verified = true
  const { page, options } = await comments({ getUser: () => ({ id }), isVerified: () => verified })
  await page.reload(); page.draft = '未提交的评论'; page.anonymous = true
  options.onHide.call(page); await page.reload()
  assert.equal(page.draft, '未提交的评论'); assert.equal(page.anonymous, true)
  id = 'account-b'; await page.reload(); assert.equal(page.draft, ''); assert.equal(page.anonymous, false)
  page.draft = '另一个账号'; page.anonymous = true; verified = false; await page.reload()
  assert.equal(page.draft, ''); assert.equal(page.anonymous, false); assert.equal(page.post, null)
})

test('旧账号评论提交晚到不能清除新账号的匿名草稿', async () => {
  let id = 'account-a'; let token = 'token-a'; let resolve
  const pending = new Promise(done => { resolve = done })
  const { page } = await comments({ getUser: () => ({ id }), getAccessToken: () => token, submitCommunityComment: () => pending })
  await page.reload(); page.draft = '甲的匿名评论'; page.anonymous = true
  const posting = page.submit()
  id = 'account-b'; token = 'token-b'; await page.reload(); page.draft = '乙的匿名草稿'; page.anonymous = true
  resolve(); await posting
  assert.equal(page.draft, '乙的匿名草稿'); assert.equal(page.anonymous, true); assert.equal(page.owner, 'account-b')
})
