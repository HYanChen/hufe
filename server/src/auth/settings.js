import { auditRecord } from '../audit/metadata.js'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { buildCasRegistrationServiceUrl, isPublicHttpsUrl, resolveSsoProtocol } from '../config.js'

const fields = ['protocol', 'publicBaseUrl', 'returnUrlOrigins', 'casBaseUrl', 'casLoginPath', 'casValidatePath', 'oidcIssuer', 'oidcClientId', 'oidcClientSecret', 'oidcScopes', 'oidcTokenAuthMethod', 'attributes']
const attributeKeys = ['name', 'department', 'major', 'className', 'enrollmentYear', 'graduationYear', 'expectedGraduationYear', 'studentId', 'idCard', 'personType', 'affiliation', 'alumniStatus']
const fail = (message, code = 'SCHOOL_AUTH_CONFIG_INVALID', statusCode = 400) => Object.assign(new Error(message), { code, statusCode })

export function assertSchoolEndpoint(value, allowedHosts) {
  let parsed
  try { parsed = new URL(value) } catch { throw fail('学校认证地址格式无效') }
  if (!isPublicHttpsUrl(value) || parsed.port && parsed.port !== '443' || parsed.search || parsed.hash || !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw fail('学校地址必须是服务器许可域名下的 HTTPS 地址，不得包含查询参数、账号或非标准端口')
  }
  return parsed
}

export class SchoolAuthSettings {
  constructor(database, config) {
    this.database = database
    this.base = config
    this.key = createHash('sha256').update(`hufe-school-auth-settings-v1:${config.dataHashSecret}`).digest()
    this.allowedHosts = config.auth.allowedHosts || ['uia.hufe.edu.cn']
  }

  defaults() {
    const { auth } = this.base
    return {
      protocol: resolveSsoProtocol(this.base), publicBaseUrl: this.base.publicBaseUrl,
      returnUrlOrigins: [...this.base.returnUrlOrigins], casBaseUrl: auth.cas.baseUrl,
      casLoginPath: auth.cas.loginPath, casValidatePath: auth.cas.validatePath,
      oidcIssuer: auth.oidc.issuer, oidcClientId: auth.oidc.clientId,
      oidcClientSecret: auth.oidc.clientSecret, oidcScopes: auth.oidc.scopes,
      oidcTokenAuthMethod: auth.oidc.tokenAuthMethod,
      attributes: Object.fromEntries(attributeKeys.map(key => [key, auth.attributes[key] || '']))
    }
  }

  seal(settings) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from('hufe-school-auth-settings-v1'))
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(settings), 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString('base64')).join('.')
  }

  unseal(value) {
    try {
      const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64'))
      const cipher = createDecipheriv('aes-256-gcm', this.key, iv)
      cipher.setAAD(Buffer.from('hufe-school-auth-settings-v1'))
      cipher.setAuthTag(tag)
      return JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8'))
    } catch { throw fail('学校配置无法解密，请核对服务器数据密钥；未恢复前不能启用校验', 'SCHOOL_AUTH_CONFIG_UNREADABLE', 503) }
  }

  row() { return this.database.read(data => data.schoolAuthSettings || null) }
  draft(row = this.row()) { return row?.draft ? this.unseal(row.draft) : this.defaults() }
  runtime(settings) {
    return {
      ...this.base, publicBaseUrl: settings.publicBaseUrl, returnUrlOrigins: settings.returnUrlOrigins,
      auth: {
        ...this.base.auth, protocol: settings.protocol,
        attributes: { ...this.base.auth.attributes, ...settings.attributes },
        cas: { ...this.base.auth.cas, baseUrl: settings.casBaseUrl, loginPath: settings.casLoginPath, validatePath: settings.casValidatePath, serviceUrl: '', allowedHosts: this.allowedHosts },
        oidc: { ...this.base.auth.oidc, issuer: settings.oidcIssuer, clientId: settings.oidcClientId, clientSecret: settings.oidcClientSecret, scopes: settings.oidcScopes, tokenAuthMethod: settings.oidcTokenAuthMethod, allowedHosts: this.allowedHosts }
      }
    }
  }

  inspect(settings) {
    const checks = []
    const add = (key, label, fn) => {
      try { fn(); checks.push({ key, label, ok: true, message: '检查通过' }) }
      catch (error) { checks.push({ key, label, ok: false, message: error.message }) }
    }
    add('callback', '正式 HTTPS 回调地址', () => {
      if (!isPublicHttpsUrl(settings.publicBaseUrl) || new URL(settings.publicBaseUrl).origin !== settings.publicBaseUrl) throw fail('请填写正式公网 HTTPS API 域名，不包含路径；localhost 不能接收学校回调')
      if (settings.protocol === 'cas') buildCasRegistrationServiceUrl(this.runtime(settings))
    })
    add('deployment', '当前 API 部署地址一致性', () => {
      if (settings.publicBaseUrl !== this.base.publicBaseUrl || !isPublicHttpsUrl(this.base.publicBaseUrl)) throw fail('正式 API 域名须与当前服务 PUBLIC_BASE_URL 完全一致；请先部署 HTTPS API，本机只可保存草稿')
    })
    add('school', '学校认证通道', () => {
      if (!['cas', 'oidc'].includes(settings.protocol)) throw fail('请选择 CAS 或 OIDC')
      if (settings.protocol === 'cas') {
        assertSchoolEndpoint(settings.casBaseUrl, this.allowedHosts)
        for (const value of [settings.casLoginPath, settings.casValidatePath]) {
          if (!/^\/[a-zA-Z0-9_/-]+$/.test(value) || value.includes('//') || value.includes('..')) throw fail('CAS 接口路径必须以 / 开头且不得包含查询参数或相对跳转')
        }
      } else {
        assertSchoolEndpoint(settings.oidcIssuer, this.allowedHosts)
        if (!settings.oidcClientId) throw fail('请填写学校分配的 OIDC 应用编号')
        if (!settings.oidcScopes.split(/\s+/).includes('openid')) throw fail('OIDC 授权范围必须包含 openid')
        if (!['none', 'client_secret_basic', 'client_secret_post'].includes(settings.oidcTokenAuthMethod)) throw fail('OIDC 密钥提交方式无效')
        if (settings.oidcTokenAuthMethod !== 'none' && !settings.oidcClientSecret) throw fail('该 OIDC 应用需要填写客户端密钥')
      }
    })
    add('returnOrigins', '前台返回地址白名单', () => {
      if (!settings.returnUrlOrigins.length) throw fail('至少填写一个前台返回域名')
      for (const origin of settings.returnUrlOrigins) {
        let parsed
        try { parsed = new URL(origin) } catch { throw fail('前台返回域名格式无效') }
        const local = this.base.env !== 'production' && ['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.protocol === 'http:'
        if (parsed.origin !== origin || (!isPublicHttpsUrl(origin) && !local)) throw fail('前台返回地址只填写 HTTPS 域名，不包含路径或通配符；开发环境可使用本机 HTTP')
        if (!this.base.corsOrigins.includes(origin)) throw fail('前台返回域名尚未加入服务器 CORS_ORIGINS 白名单，请先配置部署环境')
      }
    })
    add('attributes', '学校返回字段映射', () => {
      for (const key of attributeKeys) {
        if (['name', 'department'].includes(key) && !settings.attributes[key]) throw fail('真实姓名和学院 / 部门的字段映射不能为空')
        if (settings.attributes[key] && !/^[\p{L}\p{N}_.:-]+$/u.test(settings.attributes[key])) throw fail('字段映射只能使用字段名称，不支持表达式')
      }
    })
    return { valid: checks.every(item => item.ok), checks, networkVerified: false, message: '仅检查参数完整性与安全规则；未执行学校登录，不能证明学校已登记回调或已下发身份属性。' }
  }

  snapshot() {
    const row = this.row()
    if (!row?.active) return { revision: row?.generation || 0, enabled: row?.enabled !== false && !this.base.auth.managedInAdmin, config: this.base, managed: false }
    return { revision: row.generation || 0, enabled: row.enabled, config: this.runtime(this.unseal(row.active)), managed: true }
  }

  publicStatus() {
    try {
      const current = this.snapshot()
      if (!current.enabled) return { ready: false, status: this.row()?.enabled === false ? 'disabled' : 'configuration_required', message: '学校自动实名校验暂未启用，请管理员在后台完成配置；也可使用人工实名认证申请。', revision: current.revision }
      if (current.managed) {
        const result = this.inspect(this.unseal(this.row().active))
        if (!result.valid) return { ready: false, status: 'configuration_required', message: '学校实名校验配置需要管理员检查，请使用人工实名认证或稍后重试。', revision: current.revision }
      } else {
        if (resolveSsoProtocol(current.config) === 'cas') buildCasRegistrationServiceUrl(current.config)
        else if (!isPublicHttpsUrl(current.config.publicBaseUrl) || !current.config.auth.oidc.clientId) throw fail('尚未配置正式学校回调')
      }
      return { ready: true, status: 'enabled', protocol: resolveSsoProtocol(current.config), revision: current.revision, message: '学校实名校验入口已启用，实际结果以学校登录及属性校验为准。' }
    } catch { return { ready: false, status: 'configuration_required', message: '学校实名校验通道尚未完成后台配置，可先提交人工实名认证。' } }
  }

  requireReady(revision) {
    const current = this.snapshot()
    if (revision !== undefined && revision !== current.revision) throw fail('学校校验配置已更新，请重新发起实名校验', 'SCHOOL_AUTH_CONFIG_CHANGED', 409)
    // Preserve legacy CAS diagnostics for environment-configured deployments.
    if (!current.managed && current.enabled && resolveSsoProtocol(current.config) === 'cas') buildCasRegistrationServiceUrl(current.config)
    if (!this.publicStatus().ready) throw fail('学校实名校验通道未启用或配置未完成，请联系管理员或选择人工实名认证', 'REGISTRATION_AUTH_NOT_READY', 503)
    return current
  }

  view() {
    const row = this.row()
    const settings = this.draft(row)
    const secretConfigured = Boolean(settings.oidcClientSecret)
    settings.oidcClientSecret = ''
    let callbackUrl = ''
    try { callbackUrl = new URL(settings.protocol === 'oidc' ? '/api/v1/auth/registration/oidc/callback' : '/api/v1/auth/registration/callback', settings.publicBaseUrl).toString() } catch { /* editable draft */ }
    return {
      revision: row?.revision || 0, activeRevision: row?.activeRevision || 0,
      settings, secretConfigured, callbackUrl, allowedSchoolHosts: this.allowedHosts,
      deployedApiBaseUrl: this.base.publicBaseUrl,
      corsOrigins: this.base.corsOrigins, status: this.publicStatus(),
      updatedAt: row?.updatedAt || null, activatedAt: row?.activatedAt || null,
      lastCheck: row?.lastCheck || null, source: row?.active ? 'admin' : 'environment',
      hasUnpublishedChanges: Boolean(row?.draft && row.draft !== row.active)
    }
  }

  assertRevision(row, input) {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== (row?.revision || 0)) throw fail('配置已被其他管理员修改，请重新加载后再操作', 'SCHOOL_AUTH_CONFIG_CONFLICT', 409)
  }

  audit(data, action, row, meta) {
    data.auditLogs.unshift(auditRecord(action, 'school-auth', meta, { revision: row.revision, activeRevision: row.activeRevision || 0 }))
  }

  async save(input, meta, authorize) {
    const raw = input.settings
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !fields.includes(key))) throw fail('配置字段无效')
    await this.database.transaction(data => {
      authorize(data)
      const row = data.schoolAuthSettings
      this.assertRevision(row, input)
      const settings = this.draft(row)
      for (const [key, value] of Object.entries(raw)) {
        if (key === 'oidcClientSecret' && value === '') continue
        if (key === 'returnUrlOrigins') {
          if (!Array.isArray(value) || value.length > 20 || value.some(item => typeof item !== 'string' || item.length > 300)) throw fail('前台域名最多填写 20 项')
          settings[key] = [...new Set(value.map(item => item.trim()).filter(Boolean))]
        } else if (key === 'attributes') {
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(name => !attributeKeys.includes(name))) throw fail('身份字段映射无效')
          for (const [name, field] of Object.entries(value)) {
            if (typeof field !== 'string' || field.length > 100) throw fail('身份映射字段过长')
            settings.attributes[name] = field.trim()
          }
        } else {
          if (typeof value !== 'string' || value.length > (key === 'oidcClientSecret' ? 4096 : 500)) throw fail('配置值格式或长度无效')
          settings[key] = key === 'oidcClientSecret' ? value : value.trim()
          if (['casBaseUrl', 'oidcIssuer', 'publicBaseUrl'].includes(key)) settings[key] = settings[key].replace(/\/+$/, '')
        }
      }
      if (input.clearOidcSecret === true) settings.oidcClientSecret = ''
      const next = { ...row, revision: (row?.revision || 0) + 1, draft: this.seal(settings), lastCheck: null, updatedAt: new Date().toISOString(), updatedBy: meta.actor }
      data.schoolAuthSettings = next
      this.audit(data, 'school_auth.draft_saved', next, meta)
    })
    return this.view()
  }

  async action(action, input, meta, authorize) {
    if (!['check', 'activate', 'disable'].includes(action)) throw fail('不支持的配置操作')
    await this.database.transaction(data => {
      authorize(data)
      const row = data.schoolAuthSettings || { revision: 0 }
      this.assertRevision(row, input)
      if (action !== 'disable' && !row.draft) throw fail('请先保存配置草稿')
      const timestamp = new Date().toISOString()
      if (action === 'check' || action === 'activate') {
        const check = { ...this.inspect(this.draft(row)), checkedAt: timestamp, revision: row.revision }
        if (action === 'activate') {
          if (!check.valid) throw fail('配置检查未通过，请修正后再启用')
          if (input.schoolConfirmed !== true) throw fail('请确认学校已登记页面列出的回调地址并授权身份属性下发')
          row.active = row.draft
          row.activeRevision = row.revision
          row.generation = (row.generation || 0) + 1
          row.enabled = true
          row.activatedAt = timestamp
        }
        row.lastCheck = check
      } else {
        row.enabled = false
        row.revision += 1
        row.generation = (row.generation || 0) + 1
      }
      data.schoolAuthSettings = row
      this.audit(data, `school_auth.${action}`, row, meta)
    })
    return this.view()
  }
}
