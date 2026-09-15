import test from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword } from '../src/auth/crypto.js'

test('scrypt 密码哈希使用随机盐且可以安全校验', async () => {
  const first = await hashPassword('StrongPass!2026')
  const second = await hashPassword('StrongPass!2026')
  assert.match(first, /^scrypt\$16384\$8\$1\$/)
  assert.notEqual(first, second)
  assert.equal(await verifyPassword('StrongPass!2026', first), true)
  assert.equal(await verifyPassword('WrongPass!2026', first), false)
  assert.equal(await verifyPassword('StrongPass!2026', 'invalid-hash'), false)
})
