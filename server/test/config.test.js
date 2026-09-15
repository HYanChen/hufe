import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCasRegistrationServiceUrl, createConfig } from '../src/config.js'

test('生产环境拒绝默认 HTTP 域名和弱数据哈希密钥', () => {
  assert.throws(() => createConfig({ env: 'production' }), /生产配置校验失败/)
})

test('生产配置满足 HTTPS 与强密钥时可以通过前置校验', () => {
  const config = createConfig({
    env: 'production',
    publicBaseUrl: 'https://api.alumni.hufe.edu.cn',
    corsOrigins: ['https://alumni.hufe.edu.cn'],
    returnUrlOrigins: ['https://alumni.hufe.edu.cn'],
    dataHashSecret: 'a-production-secret-with-more-than-32-characters'
  })
  assert.equal(config.publicBaseUrl, 'https://api.alumni.hufe.edu.cn')
  assert.equal(config.trustProxy, false)
})

test('生产 CAS 回调拒绝 HTTP、占位域名和内网地址', () => {
  const base = {
    env: 'production', publicBaseUrl: 'https://api.alumni.hufe.edu.cn',
    corsOrigins: ['https://alumni.hufe.edu.cn'], returnUrlOrigins: ['https://alumni.hufe.edu.cn'],
    dataHashSecret: 'a-production-secret-with-more-than-32-characters', auth: { protocol: 'cas', managedInAdmin: false }
  }
  for (const serviceUrl of [
    'http://api.alumni.hufe.edu.cn/api/v1/auth/registration/callback',
    'https://localhost:8787/api/v1/auth/registration/callback',
    'https://192.168.1.8/api/v1/auth/registration/callback',
    'https://169.254.10.2/api/v1/auth/registration/callback',
    'https://[fd00::1]/api/v1/auth/registration/callback',
    'https://[fe80::1]/api/v1/auth/registration/callback',
    'https://registration.example/api/v1/auth/registration/callback',
    'https://registration.invalid/api/v1/auth/registration/callback'
  ]) {
    assert.throws(() => createConfig({ ...base, auth: { ...base.auth, cas: { serviceUrl } } }), /CAS 必须配置/)
  }
})

test('CAS service 必须和公网 PUBLIC_BASE_URL 同源', () => {
  const base = {
    env: 'production', publicBaseUrl: 'https://api.alumni.hufe.edu.cn',
    corsOrigins: ['https://alumni.hufe.edu.cn'], returnUrlOrigins: ['https://alumni.hufe.edu.cn'],
    dataHashSecret: 'a-production-secret-with-more-than-32-characters', auth: { protocol: 'cas', managedInAdmin: false }
  }
  assert.throws(() => createConfig({
    ...base,
    auth: { ...base.auth, cas: { serviceUrl: 'https://callback.alumni.hufe.edu.cn/api/v1/auth/registration/callback' } }
  }), /CAS 必须配置/)
})

test('CAS service 必须精确为无 query 和 hash 的注册回调路径', () => {
  const config = createConfig({
    env: 'test', publicBaseUrl: 'https://api.alumni.hufe.edu.cn',
    auth: { protocol: 'cas', cas: { serviceUrl: 'https://api.alumni.hufe.edu.cn/api/v1/auth/registration/callback' } }
  })
  assert.equal(buildCasRegistrationServiceUrl(config), 'https://api.alumni.hufe.edu.cn/api/v1/auth/registration/callback')
  for (const serviceUrl of [
    'https://api.alumni.hufe.edu.cn/api/v1/auth/registration/callback/',
    'https://api.alumni.hufe.edu.cn/api/v1/auth/sso/callback',
    'https://api.alumni.hufe.edu.cn/api/v1/auth/registration/callback?session=attacker',
    'https://api.alumni.hufe.edu.cn/api/v1/auth/registration/callback#attacker'
  ]) {
    const invalid = createConfig({ ...config, auth: { ...config.auth, cas: { ...config.auth.cas, serviceUrl } } })
    assert.throws(
      () => buildCasRegistrationServiceUrl(invalid),
      (error) => error.code === 'CAS_SERVICE_URL_INVALID' && error.statusCode === 503
    )
  }
})
