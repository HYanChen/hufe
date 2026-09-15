import path from 'node:path'
import { trustedProxyPolicy } from './audit/metadata.js'
import { isIP } from 'node:net'
import { fileURLToPath } from 'node:url'

const serverRoot = fileURLToPath(new URL('..', import.meta.url))

function list(value, fallback = []) {
  const values = String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
  return values.length ? values : fallback
}

function number(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function url(value, fallback) {
  return String(value || fallback).replace(/\/$/, '')
}

function boolean(value, fallback = false) {
  if (value == null || value === '') return fallback
  return String(value).toLowerCase() === 'true'
}

function nonPublicIpv4(host) {
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function nonPublicHost(hostname = '') {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === 'example.com' || host === 'example.net' || host === 'example.org' || /(?:^|\.)example$/.test(host) || /(?:^|\.)invalid$/.test(host)) return true
  const ipVersion = isIP(host)
  if (ipVersion === 4) return nonPublicIpv4(host)
  if (ipVersion === 6) return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
  return !host.includes('.')
}

export function isPublicHttpsUrl(value) {
  try {
    const candidate = new URL(String(value || ''))
    return candidate.protocol === 'https:' && !candidate.username && !candidate.password && !nonPublicHost(candidate.hostname)
  } catch {
    return false
  }
}

export function buildCasRegistrationServiceUrl(config) {
  const configured = String(config.auth.cas.serviceUrl || '').trim()
  const candidate = configured || new URL('/api/v1/auth/registration/callback', config.publicBaseUrl).toString()
  if (!isPublicHttpsUrl(candidate)) {
    throw Object.assign(new Error('学校注册校验尚未配置已登记的公网 HTTPS 回调地址'), {
      code: 'CAS_PUBLIC_SERVICE_URL_REQUIRED',
      statusCode: 503
    })
  }
  if (!isPublicHttpsUrl(config.publicBaseUrl)) {
    throw Object.assign(new Error('PUBLIC_BASE_URL 必须是承载学校回调的公网 HTTPS 地址'), {
      code: 'CAS_PUBLIC_BASE_URL_REQUIRED',
      statusCode: 503
    })
  }
  const serviceUrl = new URL(candidate)
  if (serviceUrl.origin !== new URL(config.publicBaseUrl).origin) {
    throw Object.assign(new Error('CAS_SERVICE_URL 必须与 PUBLIC_BASE_URL 同源，以安全关联注册事务'), {
      code: 'CAS_SERVICE_ORIGIN_MISMATCH',
      statusCode: 503
    })
  }
  if (serviceUrl.pathname !== '/api/v1/auth/registration/callback' || serviceUrl.search || serviceUrl.hash) {
    throw Object.assign(new Error('CAS_SERVICE_URL 必须精确指向注册回调且不得包含查询参数或片段'), {
      code: 'CAS_SERVICE_URL_INVALID',
      statusCode: 503
    })
  }
  return serviceUrl.toString()
}

function validateProduction(config) {
  if (config.env !== 'production') return config
  const errors = []
  if (!config.publicBaseUrl.startsWith('https://')) errors.push('PUBLIC_BASE_URL 必须使用 HTTPS')
  if (config.dataHashSecret === 'development-only-change-me' || config.dataHashSecret.length < 32) errors.push('DATA_HASH_SECRET 必须是至少 32 位的生产随机密钥')
  if ([...config.corsOrigins, ...config.returnUrlOrigins].some((origin) => !origin.startsWith('https://') || /localhost|127\.0\.0\.1/.test(origin))) errors.push('CORS_ORIGINS 与 RETURN_URL_ORIGINS 必须全部为正式 HTTPS 域名')
  if (!config.auth.managedInAdmin && config.auth.protocol === 'oidc' && !config.auth.oidc.clientId) errors.push('OIDC 模式必须配置 OIDC_CLIENT_ID')
  if (!config.auth.cas.baseUrl.startsWith('https://') || !config.auth.oidc.issuer.startsWith('https://')) errors.push('学校统一认证地址必须使用 HTTPS')
  if (!config.auth.managedInAdmin && (config.auth.protocol === 'cas' || (config.auth.protocol === 'auto' && !config.auth.oidc.clientId))) {
    try {
      buildCasRegistrationServiceUrl(config)
    } catch {
      errors.push('CAS 必须配置学校已登记的公网 HTTPS service 回调地址')
    }
  }
  if (errors.length) throw new Error(`生产配置校验失败：${errors.join('；')}`)
  return config
}

export function createConfig(overrides = {}) {
  const publicBaseUrl = url(process.env.PUBLIC_BASE_URL, 'http://localhost:8787')
  const cacheSetting = process.env.CONTENT_CACHE_FILE || './data/content-cache.json'
  const dataSetting = process.env.DATA_FILE || './data/application-data.json'
  const mediaSetting = process.env.MEDIA_DIR || './data/media'
  const config = {
    env: process.env.NODE_ENV || 'development',
    host: process.env.HOST || '127.0.0.1',
    port: number(process.env.PORT, 8787),
    publicBaseUrl,
    trustProxy: process.env.TRUST_PROXY || false,
    trustedProxyCidrs: process.env.TRUSTED_PROXY_CIDRS || '',
    auditGeoDir: process.env.AUDIT_GEO_DIR || '',
    chatStorageLimit: number(process.env.CHAT_STORAGE_LIMIT_BYTES, 20 * 1024 ** 3),
    corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:4180', 'http://127.0.0.1:4180']),
    returnUrlOrigins: list(process.env.RETURN_URL_ORIGINS, ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174']),
    adminSyncKey: process.env.ADMIN_SYNC_KEY || '',
    dataFile: path.isAbsolute(dataSetting) ? dataSetting : path.resolve(serverRoot, dataSetting),
    databaseDriver: process.env.DATABASE_DRIVER || 'json',
    mysql: {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: number(process.env.MYSQL_PORT, 3306),
      user: process.env.MYSQL_USER || '',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || '',
      ...(process.env.MYSQL_SOCKET_PATH ? { socketPath: process.env.MYSQL_SOCKET_PATH } : {})
    },
    mediaDir: path.isAbsolute(mediaSetting) ? mediaSetting : path.resolve(serverRoot, mediaSetting),
    dataHashSecret: process.env.DATA_HASH_SECRET || 'development-only-change-me',
    content: {
      syncIntervalMs: number(process.env.CONTENT_SYNC_INTERVAL_MS, 15 * 60 * 1000),
      requestTimeoutMs: number(process.env.CONTENT_REQUEST_TIMEOUT_MS, 10_000),
      pageSize: number(process.env.CONTENT_PAGE_SIZE, 12),
      syncPages: number(process.env.CONTENT_SYNC_PAGES, 2),
      detailLimitPerSource: number(process.env.CONTENT_DETAIL_LIMIT_PER_SOURCE, 8),
      cacheFile: path.isAbsolute(cacheSetting) ? cacheSetting : path.resolve(serverRoot, cacheSetting)
    },
    auth: {
      managedInAdmin: boolean(process.env.SSO_MANAGED_IN_ADMIN, true),
      allowedHosts: list(process.env.SCHOOL_AUTH_ALLOWED_HOSTS, ['uia.hufe.edu.cn']).map(value => value.toLowerCase()),
      protocol: String(process.env.SSO_PROTOCOL || 'auto').toLowerCase(),
      sessionTtlMs: number(process.env.SSO_SESSION_TTL_MS, 10 * 60 * 1000),
      registrationTicketTtlMs: number(process.env.REGISTRATION_TICKET_TTL_MS, 10 * 60 * 1000),
      accessTokenTtlMs: number(process.env.ACCESS_TOKEN_TTL_MS, 8 * 60 * 60 * 1000),
      cas: {
        baseUrl: url(process.env.CAS_BASE_URL, 'https://uia.hufe.edu.cn/cas'),
        loginPath: process.env.CAS_LOGIN_PATH || '/login',
        validatePath: process.env.CAS_VALIDATE_PATH || '/serviceValidate',
        serviceUrl: process.env.CAS_SERVICE_URL || '',
        requestTimeoutMs: number(process.env.CAS_REQUEST_TIMEOUT_MS, 8_000)
      },
      oidc: {
        issuer: url(process.env.OIDC_ISSUER, 'https://uia.hufe.edu.cn/cas'),
        clientId: process.env.OIDC_CLIENT_ID || '',
        clientSecret: process.env.OIDC_CLIENT_SECRET || '',
        scopes: process.env.OIDC_SCOPES || 'openid profile email phone',
        tokenAuthMethod: process.env.OIDC_TOKEN_AUTH_METHOD || 'client_secret_basic',
        requestTimeoutMs: number(process.env.OIDC_REQUEST_TIMEOUT_MS, 8_000)
      },
      attributes: {
        name: process.env.CAS_ATTRIBUTE_NAME || 'cn',
        studentId: process.env.CAS_ATTRIBUTE_STUDENT_ID || 'studentId',
        idCard: process.env.CAS_ATTRIBUTE_ID_CARD || 'idCard',
        department: process.env.CAS_ATTRIBUTE_DEPARTMENT || 'department',
        major: process.env.CAS_ATTRIBUTE_MAJOR || 'major',
        className: process.env.CAS_ATTRIBUTE_CLASS_NAME || 'className',
        enrollmentYear: process.env.CAS_ATTRIBUTE_ENROLLMENT_YEAR || 'enrollmentYear',
        graduationYear: process.env.CAS_ATTRIBUTE_GRADUATION_YEAR || 'graduationYear',
        expectedGraduationYear: process.env.CAS_ATTRIBUTE_EXPECTED_GRADUATION_YEAR || 'expectedGraduationYear',
        affiliation: process.env.CAS_ATTRIBUTE_AFFILIATION || 'affiliation',
        alumniStatus: process.env.CAS_ATTRIBUTE_ALUMNI_STATUS || 'alumniStatus',
        personType: process.env.CAS_ATTRIBUTE_PERSON_TYPE || 'personType',
        roles: process.env.CAS_ATTRIBUTE_ROLES || 'roles'
      },
      alumniStatusValues: list(process.env.CAS_ALUMNI_STATUS_VALUES, ['alumni', 'verified', '校友', '已认证']).map((value) => value.toLowerCase()),
      adminSubjects: list(process.env.ADMIN_SUBJECTS),
      adminRoleValues: list(process.env.ADMIN_ROLE_VALUES, ['hufe-alumni-admin', '校友平台管理员']).map((value) => value.toLowerCase()),
      alumniVerifyApiUrl: process.env.ALUMNI_VERIFY_API_URL || '',
      alumniVerifyApiToken: process.env.ALUMNI_VERIFY_API_TOKEN || ''
    }
  }

  const merged = {
    ...config,
    ...overrides,
    mysql: { ...config.mysql, ...(overrides.mysql || {}) },
    content: { ...config.content, ...(overrides.content || {}) },
    auth: {
      ...config.auth,
      ...(overrides.auth || {}),
      cas: { ...config.auth.cas, ...(overrides.auth?.cas || {}) },
      oidc: { ...config.auth.oidc, ...(overrides.auth?.oidc || {}) },
      attributes: { ...config.auth.attributes, ...(overrides.auth?.attributes || {}) }
    }
  }
  merged.trustProxy = trustedProxyPolicy(merged.trustProxy, merged.trustedProxyCidrs)
  if (!['json', 'mysql'].includes(merged.databaseDriver)) throw new Error('DATABASE_DRIVER 仅支持 json 或 mysql')
  if (merged.databaseDriver === 'mysql' && (!merged.mysql.user || !merged.mysql.password || !merged.mysql.database)) throw new Error('MySQL 模式必须配置 MYSQL_USER、MYSQL_PASSWORD 和 MYSQL_DATABASE；不会回退到 JSON')
  return validateProduction(merged)
}

export function resolveSsoProtocol(config) {
  if (config.auth.protocol === 'auto') return config.auth.oidc.clientId ? 'oidc' : 'cas'
  if (!['cas', 'oidc'].includes(config.auth.protocol)) throw new Error('SSO_PROTOCOL 仅支持 auto、cas 或 oidc')
  return config.auth.protocol
}
