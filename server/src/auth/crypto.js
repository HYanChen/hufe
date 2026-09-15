import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(crypto.scrypt)
const SCRYPT_PARAMETERS = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64 })

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url')
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function codeChallenge(verifier) {
  return sha256(verifier)
}

export function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('base64url')
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const derivedKey = await scryptAsync(String(password), salt, SCRYPT_PARAMETERS.keyLength, {
    N: SCRYPT_PARAMETERS.N,
    r: SCRYPT_PARAMETERS.r,
    p: SCRYPT_PARAMETERS.p,
    maxmem: 64 * 1024 * 1024
  })
  return [
    'scrypt',
    SCRYPT_PARAMETERS.N,
    SCRYPT_PARAMETERS.r,
    SCRYPT_PARAMETERS.p,
    salt.toString('base64url'),
    Buffer.from(derivedKey).toString('base64url')
  ].join('$')
}

export async function verifyPassword(password, encodedHash) {
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue, ...rest] = String(encodedHash || '').split('$')
  if (algorithm !== 'scrypt' || rest.length || !saltValue || !hashValue) return false
  const N = Number(nValue)
  const r = Number(rValue)
  const p = Number(pValue)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 2 || r < 1 || p < 1) return false
  try {
    const expected = Buffer.from(hashValue, 'base64url')
    if (!expected.length) return false
    const actual = await scryptAsync(String(password), Buffer.from(saltValue, 'base64url'), expected.length, {
      N, r, p, maxmem: 64 * 1024 * 1024
    })
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
