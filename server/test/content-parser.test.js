import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverPaginationUrls, parseOfficialDetail, parseOfficialList } from '../src/content/parser.js'

const source = {
  id: 'notices', name: '通知公告', category: 'notices',
  url: 'https://www.hufe.edu.cn/index/tzgg.htm',
  pathIncludes: ['/info/1048/'], limit: 12
}

test('官网列表解析会规范化链接、日期与标题', () => {
  const html = `<ul class="txtlist"><li><a class="eclips" href="../info/1048/168161.htm">关于开展测试工作的通知</a><time>2026-07-15</time></li></ul>`
  const items = parseOfficialList(html, source, '2026-07-17T00:00:00.000Z')
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '关于开展测试工作的通知')
  assert.equal(items[0].publishedAt, '2026-07-15')
  assert.equal(items[0].sourceUrl, 'https://www.hufe.edu.cn/info/1048/168161.htm')
})

test('官网详情清洗脚本和事件属性并保留安全正文', () => {
  const item = parseOfficialList(`<li><a href="../info/1048/168161.htm">关于开展测试工作的通知</a></li>`, source)[0]
  const detail = parseOfficialDetail(`<form><div id="vsb_content"><div class="v_news_content"><script>alert(1)</script><p onclick="bad()">正文<strong>重点</strong></p><a href="javascript:alert(1)">危险</a><img data-src="/images/a.png" onerror="bad()"></div></div></form>`, item)
  assert.match(detail.contentHtml, /正文/)
  assert.match(detail.contentHtml, /https:\/\/www\.hufe\.edu\.cn\/images\/a\.png/)
  assert.doesNotMatch(detail.contentHtml, /script|onclick|onerror|javascript:/i)
  assert.ok(detail.contentHash)
})

test('官网详情移除固定宽高并为图片表格和长链接注入多端响应式样式', () => {
  const item = parseOfficialList(`<li><a href="../info/1048/168161.htm">关于开展测试工作的通知</a></li>`, source)[0]
  const detail = parseOfficialDetail(`<div id="vsb_content"><div class="v_news_content"><p style="width:1200px">长段落<a href="/very/long/link">链接</a></p><img src="/wide.jpg" width="1800" height="900"><table width="1200"><tr><th>列一</th><th>列二</th></tr><tr><td>很长很长的单元格内容</td><td>内容</td></tr></table></div></div>`, item)
  assert.doesNotMatch(detail.contentHtml, /1200px|width="1800"|height="900"/)
  assert.match(detail.contentHtml, /max-width:100%/)
  assert.match(detail.contentHtml, /table-layout:fixed/)
  assert.match(detail.contentHtml, /word-break:break-word/)
  assert.match(detail.contentHtml, /word-break:break-all/)
})

test('倒序分页每次从栏目首页发现下一页', () => {
  const html = `<a href="tzgg/95.htm">下页</a><a href="tzgg/1.htm">尾页</a>`
  assert.deepEqual(discoverPaginationUrls(html, source, 2), ['https://www.hufe.edu.cn/index/tzgg/95.htm'])
})
