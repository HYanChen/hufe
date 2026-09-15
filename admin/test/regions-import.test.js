import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

async function regionsPage() {
  const vue = await fs.readFile(new URL('../src/views/RegionsView.vue', import.meta.url), 'utf8')
  const script = vue.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  const calls = []
  const context = {
    ref: value => ({ value }), onMounted() {}, onBeforeUnmount() {}, accessToken: () => 'test-session',
    api: async (path, options) => { calls.push({ path, options }); return { token: 'preview-only' } }
  }
  vm.runInNewContext(`${script}\nglobalThis.page = { importFile, importMode, stats, source, sourceVersion, error, preview }`, context)
  context.page.stats.value = { revision: 7 }
  context.page.source.value = '原地区库来源'
  context.page.sourceVersion.value = '原地区库版本'
  return { page: context.page, calls }
}

for (const format of ['pcas', 'flat']) {
  test(`行政区域 ${format} 文件导入只预览新增，同码保留且不执行应用`, async () => {
    const { page, calls } = await regionsPage()
    const items = format === 'pcas'
      ? [{ code: '43', name: '湖南省', children: [] }]
      : [{ code: 'CN-43', parentCode: 'CN', name: '湖南省', level: 'province', enabled: true }]
    const data = format === 'pcas' ? items : { items, source: '补充来源', sourceVersion: '补充版本', mode: 'replace', conflictPolicy: 'replace' }
    const event = { target: { value: 'selected', files: [{ name: 'regions.json', size: 200, text: async () => JSON.stringify(data) }] } }
    await page.importFile(event)
    assert.equal(event.target.value, '')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].path, '/admin/regions/preview')
    const body = JSON.parse(JSON.stringify(calls[0].options.body))
    assert.deepEqual(body.items, items)
    assert.equal(body.expectedRevision, 7)
    assert.equal(body.mode, 'merge')
    assert.equal(body.conflictPolicy, 'preserve')
    assert.equal(body.source, format === 'pcas' ? '上传行政区域补充文件：regions.json' : '补充来源')
    assert.equal(body.sourceVersion, format === 'pcas' ? 'regions.json' : '补充版本')
    assert.equal(page.preview.value.token, 'preview-only')
  })
}

test('地区导入无有效数组时给出格式说明，不请求后台', async () => {
  for (const data of [null, {}, { items: 'invalid' }]) {
    const { page, calls } = await regionsPage()
    await page.importFile({ target: { files: [{ name: 'invalid.json', size: 30, text: async () => JSON.stringify(data) }] } })
    assert.match(page.error.value, /items 数组.*pcas/)
    assert.equal(calls.length, 0)
  }
})

test('超出20MB的地区导入文件不读取正文，不请求后台', async () => {
  const { page, calls } = await regionsPage()
  await page.importFile({ target: { files: [{ size: 20 * 1024 * 1024 + 1, text: () => assert.fail('不应读取超限文件') }] } })
  assert.match(page.error.value, /20MB/)
  assert.equal(calls.length, 0)
})

test('标准化地区文件允许明确选择合并修改或整库更新，pcas 始终仅新增', async () => {
  for (const selectedMode of ['merge', 'replace']) {
    for (const pcas of [false, true]) {
      const { page, calls } = await regionsPage()
      page.importMode.value = selectedMode
      const items = pcas ? [{ code: '43', name: '湖南省', children: [] }] : [{ code: 'CN-43', parentCode: 'CN', name: '湖南省', level: 'province', enabled: true }]
      await page.importFile({ target: { files: [{ name: 'regions.json', size: 200, text: async () => JSON.stringify(items) }] } })
      assert.equal(calls[0].options.body.mode, pcas ? 'merge' : selectedMode)
      assert.equal(calls[0].options.body.conflictPolicy, pcas ? 'preserve' : 'replace')
      assert.equal(calls.length, 1)
    }
  }
})
