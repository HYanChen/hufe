import test from 'node:test'
import assert from 'node:assert/strict'
import { ContentService } from '../src/content/service.js'
import { parseOfficialList } from '../src/content/parser.js'

const source = { id: 'notices', name: '通知公告', category: 'notices', url: 'https://www.hufe.edu.cn/index/tzgg.htm', pathIncludes: ['/info/1048/'], limit: 12 }
const listHtml = '<li><a href="../info/1048/168161.htm">关于开展测试工作的通知</a></li>'
function service() {
  return new ContentService({ content: { requestTimeoutMs: 100, syncPages: 1, detailLimitPerSource: 0, pageSize: 12 } }, { sources: [source], fetchText: async () => listHtml })
}

test('官网缓存持久化失败时不发布未提交的新列表，成功后保留未知字段', async () => {
  const content = service(), original = { ...content.snapshot, migrationExtension: { opaque: '必须保留' } }
  content.snapshot = structuredClone(original)
  content.store = { async transaction() { throw new Error('commit failure') } }
  await assert.rejects(content.refresh(), /commit failure/)
  assert.deepEqual(content.snapshot, original)
  let committed
  content.store.transaction = async mutator => { committed = structuredClone(original); mutator(committed) }
  await content.refresh()
  assert.deepEqual(content.snapshot, committed)
  assert.equal(content.snapshot.migrationExtension.opaque, '必须保留')
  assert.equal(content.snapshot.items.length, 1)
})

test('官网详情写入失败不会将未提交的正文放进公开读取缓存', async () => {
  const content = service(), item = parseOfficialList(listHtml, source)[0]
  content.snapshot.items = [item]
  content.fetchText = async () => '<div id="vsb_content"><div class="v_news_content"><p>新加载正文</p></div></div>'
  content.store = { async transaction() { throw new Error('commit failure') } }
  const result = await content.get(item.id)
  assert.deepEqual(result, item)
  assert.equal(content.find(item.id).contentHtml, undefined)
})

test('MySQL 官网缓存结构错误不会默默启动成空页面', async () => {
  const content = service()
  content.store = { read: () => ({ items: 'invalid' }) }
  await assert.rejects(content.loadCache(), { code: 'MYSQL_CONTENT_NOT_MIGRATED' })
})
