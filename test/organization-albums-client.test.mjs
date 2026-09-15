import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
const album = { id: 'album-1', title: '相册', description: '', canEdit: true }
async function component(overrides = {}) {
  const source = await fs.readFile(new URL('../components/OrganizationAlbums.vue', import.meta.url), 'utf8')
  const script = source.split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm, '').replace('export default', 'globalThis.options =')
  const routes = [], modals = []
  const context = { getAccessToken: () => 'token-a', isVerified: () => true, openPage: path => routes.push(path), albumImageUrl: value => value,
    uni: { showModal: value => modals.push(value), showToast() {}, $on() {}, $off() {} },
    listOrganizationAlbums: async () => ({ items: [album], total: 1 }), listAlbumPhotos: async () => ({ items: [], total: 0, album }),
    saveOrganizationAlbum: async () => album, chooseImageFiles: async () => [], uploadAlbumPhoto: async () => ({ id: 'photo' }), deleteAlbumContent: async () => ({}), ...overrides }
  vm.runInNewContext(script, context)
  const page = { ...context.options.data(), organizationId: 'org-1', active: true, legacyPhotos: [] }
  for (const [key, method] of Object.entries(context.options.methods)) page[key] = method.bind(page)
  return { page, context, routes, modals }
}
test('任何实名用户可创建相册，未实名时进入登录而非静态表单', async () => {
  const { page } = await component()
  page.beginCreate(); assert.equal(page.formOpen, true); assert.ok(page.createRequestId)
  page.title = '相册'; await page.saveAlbum(); assert.equal(page.selected.id, album.id)
  const guest = await component({ isVerified: () => false }); guest.page.beginCreate()
  assert.equal(guest.page.formOpen, false); assert.deepEqual(guest.routes, ['/pages/verify/index'])
})
test('编辑相册保留失败待重试照片，新建相册不静默清除照片', async () => {
  const { page, modals } = await component(); page.selected = album
  page.queue = [{ status: 'error', dataBase64: 'retained' }]
  page.beginEdit(); await page.saveAlbum()
  assert.equal(page.queue[0].dataBase64, 'retained')
  page.beginCreate(); assert.equal(modals.length, 1); assert.equal(page.queue.length, 1)
})
test('部分失败仅重试失败照片，成功项不重复上传', async () => {
  const calls = []; let fail = true
  const { page } = await component({ uploadAlbumPhoto: async (_org, _album, file) => { calls.push(file.clientRequestId); if (file.clientRequestId === 'two' && fail) throw new Error('网络中断'); return { id: file.clientRequestId } } })
  page.selected = album; page.queue = [{ clientRequestId: 'one', dataBase64: 'one', status: 'pending' }, { clientRequestId: 'two', dataBase64: 'two', status: 'pending' }]
  await page.uploadPhotos(); assert.equal(page.queue[0].status, 'done'); assert.equal(page.queue[1].status, 'error'); assert.equal(page.queue[1].dataBase64, 'two')
  fail = false; await page.uploadPhotos(); assert.deepEqual(calls, ['one', 'two', 'two']); assert.equal(page.queue.length, 0)
})
test('切换账号丢弃旧创建结果，切相册分页不继承旧页码', async () => {
  let resolve, token = 'token-a'
  const pending = new Promise(done => { resolve = done })
  const { page } = await component({ getAccessToken: () => token, saveOrganizationAlbum: () => pending, listAlbumPhotos: async () => { throw new Error('临时不可用') } })
  page.title = '旧账号'; const saving = page.saveAlbum(); token = 'token-b'; page.clear(); resolve(album); await saving
  assert.equal(page.selected, null); assert.equal(page.title, '')
  page.photoPage = 4; page.photoTotal = 60; page.selectAlbum(album)
  assert.equal(page.photoPage, 0); assert.equal(page.photoTotal, 0)
})
