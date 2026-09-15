import 'dotenv/config'
import { AuditService } from './audit/service.js'
import { requestMetadata, trustedProxyPolicy } from './audit/metadata.js'
import Fastify, { LogController } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { buildCasRegistrationServiceUrl, createConfig, resolveSsoProtocol } from './config.js'
import { ContentService } from './content/service.js'
import { openDatabase } from './storage/database.js'
import { AccountService } from './accounts/service.js'
import { registerPersonnelRoutes } from './accounts/personnel-routes.js'
import { registerDossierRoutes } from './accounts/dossier-routes.js'
import { registerModuleRoutes } from './modules/routes.js'
import { schoolBrand } from './brand.js'
import { registerPasswordResetRoutes } from './accounts/password-reset-routes.js'
import {registerDirectVerificationRoutes} from './accounts/direct-verification-routes.js'
import {registerGivingTemplateRoutes} from './business/giving-template-routes.js'
import {registerAlumniNumberRoutes} from './accounts/alumni-number-routes.js'
import {selfStudentNumber} from './accounts/student-number.js'
import { EnterpriseLookupService } from './enterprise-lookup/service.js'
import { registerEnterpriseLookupRoutes } from './enterprise-lookup/routes.js'
import { registerMapRoutes } from './maps/routes.js'
import {GateService} from './gate/service.js'
import {registerGateRoutes} from './gate/routes.js'
import { educationSnapshot, selfProfile, updateSelfProfile } from './accounts/profile.js'
import { BusinessService } from './business/service.js'
import { businessResourceKeys } from './business/definitions.js'
import { DelegationService } from './admin/delegation-service.js'
import { AuthSessionStore, bearerToken } from './auth/session-store.js'
import {requestLimitKey,rateLimitResponse} from './auth/request-limits.js'
import { CasClient } from './auth/cas.js'
import { OidcClient } from './auth/oidc.js'
import { mapSchoolIdentity } from './auth/identity.js'
import { SchoolAuthSettings } from './auth/settings.js'
import { hmac, safeEqual } from './auth/crypto.js'
import { MAX_MEDIA_BYTES, MediaService } from './media/service.js'
import { ManualVerificationService } from './manual-verification/service.js'
import { OrganizationAlbumService } from './business/organization-albums.js'
import { ChatService } from './chat/service.js'
import { chatRoutes } from './chat/routes.js'
import { ModerationService } from './moderation/service.js'
import { RegionService } from './regions/service.js'
import { CityCenterService } from './regions/city-centers.js'
import { ImageTransfers,uploadedImage } from './media/transfers.js'
import { imageTransferRoutes } from './media/transfer-routes.js'

function data(value) { return { code: 0, message: 'ok', data: value } }

function allowedReturnUrl(input, origins) {
  if (!input) return ''
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || !origins.includes(url.origin)) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function withSession(url, sessionId, status = 'complete') {
  if (!url) return ''
  const marker = `registration_session=${encodeURIComponent(sessionId)}&registration_status=${encodeURIComponent(status)}&sso_session=${encodeURIComponent(sessionId)}&sso_status=${encodeURIComponent(status)}`
  const hashAt = url.indexOf('#')
  if (hashAt >= 0) {
    const prefix = url.slice(0, hashAt + 1)
    const route = url.slice(hashAt + 1)
    return `${prefix}${route}${route.includes('?') ? '&' : '?'}${marker}`
  }
  return `${url}${url.includes('?') ? '&' : '?'}${marker}`
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character])
}

function browserResult(reply, session, { ok, message }) {
  if (session.returnUrl) return reply.redirect(withSession(session.returnUrl, session.id, ok ? 'complete' : 'failed'))
  reply.type('text/html; charset=utf-8')
  return reply.send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>新用户注册实名校验</title><style>body{margin:0;background:#f3f6fb;color:#17233b;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.card{max-width:460px;margin:12vh auto;padding:36px 30px;border-radius:22px;background:#fff;box-shadow:0 18px 60px rgba(11,58,130,.12);text-align:center}.mark{width:68px;height:68px;margin:auto;display:grid;place-items:center;border-radius:20px;color:#fff;background:#033481;font-size:30px}.ok{background:#176551}.title{margin:22px 0 10px;font-size:24px}.desc{color:#748096;line-height:1.7}.hint{margin-top:26px;color:#9a7a45;font-size:14px}</style></head><body><main class="card"><div class="mark ${ok ? 'ok' : ''}">${ok ? '✓' : '!'}</div><h1 class="title">${ok ? '新用户注册实名校验完成' : '新用户注册实名校验未完成'}</h1><p class="desc">${escapeHtml(message)}</p><p class="hint">请返回湖财人完成注册</p></main><script>setTimeout(function(){window.close()},1800)</script></body></html>`)
}

function requestMeta(request, actor = 'system') {
  return requestMetadata(request, actor)
}

function maskStudentId(studentId = '') {
  const value = String(studentId || '')
  if (!value) return ''
  if (value.length <= 4) return '****'
  return `${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`
}

function verifiedIdentityView(identity = {}) {
  const department = String(identity.department || '')
  return {
    name: String(identity.name || ''),
    department,
    college: department,
    ...educationSnapshot(identity),
    personType: String(identity.personType || 'member'),
    studentIdMasked: String(identity.studentIdMasked || maskStudentId(identity.studentId)),
    idCardMasked: String(identity.idCardMasked || ''),
    idCardVerified: Boolean(identity.idCardVerified)
  }
}

const registrationCookieName = 'hufe_registration_verification'

function registrationCookie(session, browserBinding, config) {
  const payload = `${session.id}.${browserBinding}`
  const signature = hmac(payload, config.dataHashSecret)
  const maxAge = Math.max(1, Math.floor(config.auth.sessionTtlMs / 1000))
  return `${registrationCookieName}=${payload}.${signature}; Path=/api/v1/auth; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
}

function clearRegistrationCookie() {
  return `${registrationCookieName}=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

function safeSchoolFailure(error) {
  const messages = {
    SCHOOL_AUTH_CONFIG_CHANGED: '学校校验配置已更新，请重新发起',
    REGISTRATION_AUTH_NOT_READY: '学校校验通道未启用，请联系管理员或选择人工认证',
    SCHOOL_NAME_MISSING: '学校未返回真实姓名，请管理员核对属性映射',
    SCHOOL_DEPARTMENT_MISSING: '学校未返回学院 / 部门，请管理员核对属性映射',
    REGISTRATION_PROTOCOL_MISMATCH: '学校回调协议与本次事务不一致，请重新发起',
    CAS_TICKET_MISSING: '学校未返回校验票据，请重新发起'
  }
  const known = Object.hasOwn(messages, error.code)
  return Object.assign(new Error(known ? messages[error.code] : '学校身份校验未完成，请重新发起；如仍失败请联系管理员核对通道配置'), { code: known ? error.code : 'REGISTRATION_VERIFICATION_FAILED', statusCode: 502 })
}

function registrationHint(request, config) {
  const cookies = String(request.headers.cookie || '').split(';').map((item) => item.trim())
  const raw = cookies.find((item) => item.startsWith(`${registrationCookieName}=`))?.slice(registrationCookieName.length + 1) || ''
  const parts = raw.split('.')
  if (parts.length !== 3) return { id: '', browserBinding: '' }
  const [id, browserBinding, signature] = parts
  if (!safeEqual(signature, hmac(`${id}.${browserBinding}`, config.dataHashSecret))) return { id: '', browserBinding: '' }
  return { id, browserBinding }
}

function requireRegistrationBinding(request, config) {
  const hint = registrationHint(request, config)
  if (!hint.id || !hint.browserBinding) {
    throw Object.assign(new Error('注册身份校验必须在发起校验的同一浏览器中继续'), {
      code: 'REGISTRATION_BROWSER_BINDING_REQUIRED', statusCode: 401
    })
  }
  return hint
}

export async function buildApp(options = {}) {
  const config = options.config || createConfig()
  const logger = options.logger === undefined
    ? (config.env !== 'test' ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] } : false)
    : options.logger
  // CAS ticket 位于回调查询参数；关闭框架默认请求日志，避免完整 URL 或凭证进入日志。
  const app = Fastify({ logger, logController: new LogController({ disableRequestLogging: true }), trustProxy: trustedProxyPolicy(config.trustProxy, config.trustedProxyCidrs), bodyLimit: 1024 * 1024 })
  const database = options.database || await openDatabase(config)
  const accounts = new AccountService(database, config)
  const business = new BusinessService(database, config)
  const regions = await new RegionService(database, config).init()
  const cityCenters = new CityCenterService(business, regions)
  business.normalizationOptions.regions = regions
  await business.init()
  const media = await new MediaService(config, database).init()
  const imageTransfers = await new ImageTransfers(config).init()
  const onCommunityCleanupError = (error) => app.log.warn({ err: error }, 'community image cleanup will retry')
  try {
    const result = await media.cleanupCommunityDrafts()
    if (result.failed.length) onCommunityCleanupError(new Error(`校园墙图片清理暂未完成 ${result.failed.length} 项`))
  } catch (error) { onCommunityCleanupError(error) }
  const removeEnterprisePrivateFiles = async (filenames, metadata = {}) => {
    const failed = []
    for (const filename of [...new Set((filenames || []).filter(Boolean))]) {
      try {
        await media.removeEnterprisePrivate(filename)
      } catch (error) {
        failed.push(filename)
        await business.queueEnterpriseMediaOrphans([filename], metadata, error)
      }
    }
    return { removed: (filenames || []).length - failed.length, failed }
  }
  const resolvedEnterpriseOrphans = []
  for (const orphan of business.enterpriseMediaOrphans()) {
    try {
      await media.removeEnterprisePrivate(orphan.filename)
      resolvedEnterpriseOrphans.push(orphan.filename)
    } catch {
      // 保留孤儿队列，待下一次服务启动继续重试。
    }
  }
  await business.resolveEnterpriseMediaOrphans(
    resolvedEnterpriseOrphans,
    { actor: 'system:enterprise-media-cleanup' }
  )
  const manualVerifications = new ManualVerificationService(database, config, media)
  const manualCleanupMetadata = { actor: 'system:manual-verification-expiry' }
  await manualVerifications.cleanupExpired(manualCleanupMetadata)
  const delegations = new DelegationService(database)
  const organizationAlbums = await new OrganizationAlbumService(database, config, delegations, media).init()
  organizationAlbums.startCleanup(error => app.log.error({ err: error }, 'organization album cleanup failed'))
  const content = options.contentService || new ContentService(config)
  await content.init({ refresh: options.refreshContent ?? config.env !== 'test' })
  if (options.scheduleContent ?? config.env !== 'test') content.startScheduler()
  manualVerifications.startCleanupScheduler({
    metadata: manualCleanupMetadata,
    onError: (error) => {
      app.log.error({ err: error, code: error.code }, 'manual verification expiry cleanup failed')
    }
  })
  media.startCommunityCleanupScheduler(onCommunityCleanupError)
  const sessions = new AuthSessionStore(config,{database})
  const audit = await new AuditService(database, config).init()
  const chat = await new ChatService(database, config).init()
  const moderation = new ModerationService(database)
  app.addHook('preValidation', async request => {
    const route=request.routeOptions.url || ''
    const userWrite=['POST','PUT','PATCH'].includes(request.method) && (route.startsWith('/api/v1/business/') || route==='/api/v1/me/profile' || /^\/api\/v1\/chat\/conversations(?:\/:id)?(?:\/(?:messages|uploads))?$/.test(route))
    if(userWrite)moderation.assert(request.body)
    if(route==='/api/v1/chat/conversations/:id/messages'&&request.method==='POST'&&request.user&&request.body?.attachmentId){
      const upload=chat.ownedUpload(request.user.id,request.body.attachmentId)
      moderation.assert({filename:upload.name})
    }
  })
  app.addHook('onRequest', async request => {
    audit.begin(request)
    audit.assertAvailable(request)
    try { request.user = accounts.getActiveAccount(sessions.authenticate(bearerToken(request)).id) } catch { /* 未认证访问仍保留网络事件，不推测账号。 */ }
    modules.assertRequest(request)
    const route = request.routeOptions.url || ''
    if (route.startsWith('/api/v1/business/') || route.startsWith('/api/v1/admin/business/')) await business.syncAutomaticOrganizations()
  })
  app.addHook('onSend', async (request, reply, payload) => {
    await audit.capture(request, reply)
    return payload
  })
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) callback(null, true)
      else callback(Object.assign(new Error('CORS origin 未授权'), { statusCode: 403, code: 'CORS_ORIGIN_DENIED' }), false)
    },
    credentials: true,
    // Editors and withdrawals use PATCH as well as the plugin's default methods.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  })
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute', keyGenerator:requestLimitKey, errorResponseBuilder:rateLimitResponse })
  const cas = options.casClient || new CasClient(config.auth.cas)
  const oidc = options.oidcClient || new OidcClient(config.auth.oidc)
  const identityMapper = options.identityMapper || mapSchoolIdentity
  const schoolAuth = new SchoolAuthSettings(database, config)
  let schoolClients
  const registrationRuntime = (revision) => {
    const current = schoolAuth.requireReady(revision)
    if (!schoolClients || schoolClients.revision !== current.revision) {
      schoolClients = {
        ...current,
        cas: options.casClient || new CasClient(current.config.auth.cas),
        oidc: options.oidcClient || new OidcClient(current.config.auth.oidc)
      }
    }
    return schoolClients
  }

  app.decorate('services', { config, database, accounts, business, media, organizationAlbums, manualVerifications, delegations, content, sessions, cas, oidc, schoolAuth, audit, chat, moderation })
  app.addHook('onClose', async () => {
    await imageTransfers.close()
    await chat.close()
    await audit.close()
    await organizationAlbums.stopCleanup()
    manualVerifications.stopCleanupScheduler()
    await media.stopCommunityCleanupScheduler()
    content.stopScheduler()
    await content.close?.()
    await regions.close?.()
    await database.close?.()
  })

  app.setErrorHandler((error, request, reply) => {
    request.auditFailure = /^[A-Z][A-Z0-9_]{0,99}$/.test(String(error.code || '')) ? error.code : 'REQUEST_FAILED'
    request.log.warn({ requestId: request.auditTrace?.requestId, code: request.auditFailure }, 'request failed')
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
    reply.code(statusCode).send({ code: error.code || (statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'), message: statusCode === 500 ? '服务暂时不可用' : error.message, data: null })
  })

  const requireUser = (request) => {
    const token = bearerToken(request)
    const tokenAccount = sessions.authenticate(token)
    const current = accounts.getActiveAccount(tokenAccount.id)
    if (!current) {
      sessions.revoke(token)
      throw Object.assign(new Error('账号已停用或注销'), { statusCode: 401, code: 'ACCOUNT_INACTIVE' })
    }
    if (Number(tokenAccount.credentialRevision || 0) !== Number(current.credentialRevision || 0)) {
      sessions.revoke(token)
      throw Object.assign(new Error('密码已更新，请重新登录'), { statusCode: 401, code: 'CREDENTIALS_CHANGED' })
    }
    request.accessToken = token
    request.user = current
    return current
  }
  const requireSuperAdmin = (request) => {
    const user = requireUser(request)
    if (user.mustChangePassword) throw Object.assign(new Error('首次登录必须先修改临时密码'), { statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED' })
    if (user.isAdmin !== true || [user.role,user.adminRole].some(role=>role&&!['admin','super_admin'].includes(role))) throw Object.assign(new Error('需要有效全局管理员权限'), { statusCode: 403, code: 'ADMIN_REQUIRED' })
    return user
  }
  const schoolConfigGuard = (admin) => (state) => {
    const current = state.accounts.find(account => account.id === admin.id && account.status === 'active')
    if (!current?.isAdmin || current.mustChangePassword) throw Object.assign(new Error('仅全局管理员可配置学校实名校验'), { code: 'ADMIN_REQUIRED', statusCode: 403 })
  }
  const modules = registerModuleRoutes(app, {database, requireSuperAdmin, requestMeta, data})
  app.services.modules = modules
  app.addHook('preHandler', async request => modules.assertRequest(request))
  app.services.regions = regions
  app.services.maps = await registerMapRoutes(app, {database, config, requireSuperAdmin, requestMeta, data})
  app.get('/api/v1/regions',async(request,reply)=>{reply.header('cache-control','no-store');return data(regions.list({...request.query,admin:false}))})
  app.get('/api/v1/regions/:code',async(request,reply)=>{reply.header('cache-control','no-store');const row=regions.describe(request.params.code);if(!row)throw Object.assign(new Error('地区不存在'),{statusCode:404,code:'REGION_NOT_FOUND'});return data(row)})
  app.get('/api/v1/admin/regions',async(request,reply)=>{requireSuperAdmin(request);reply.header('cache-control','no-store');return data({...regions.list({...request.query,admin:true}),stats:regions.stats()})})
  app.get('/api/v1/admin/regions/export',async(request,reply)=>{requireSuperAdmin(request);reply.header('cache-control','no-store');return data({...regions.meta(),items:regions.current().items})})
  app.post('/api/v1/admin/regions/preview',{bodyLimit:20*1024*1024},async request=>{const admin=requireSuperAdmin(request);return data(regions.preview(admin,request.body))})
  app.post('/api/v1/admin/regions/apply',async request=>{const admin=requireSuperAdmin(request);return data(await regions.apply(admin,request.body?.token,requestMeta(request,admin.id),schoolConfigGuard(admin)))})
  app.get('/api/v1/admin/sensitive-words', async(request,reply)=>{requireSuperAdmin(request);reply.header('cache-control','private, no-store');return data(moderation.rules())})
  app.post('/api/v1/admin/sensitive-words', async request=>{const admin=requireSuperAdmin(request);return data(await moderation.save(request.body,requestMeta(request,admin.id),schoolConfigGuard(admin)))})
  app.patch('/api/v1/admin/sensitive-words/:id', async request=>{const admin=requireSuperAdmin(request);return data(await moderation.toggle(request.params.id,request.body,requestMeta(request,admin.id),schoolConfigGuard(admin)))})
  app.get('/api/v1/auth/registration/config', async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return data(schoolAuth.publicStatus())
  })
  app.get('/api/v1/admin/school-auth-config', async (request, reply) => {
    requireSuperAdmin(request)
    reply.header('cache-control', 'private, no-store')
    return data(schoolAuth.view())
  })
  app.put('/api/v1/admin/school-auth-config', { bodyLimit: 32768 }, async (request, reply) => {
    const admin = requireSuperAdmin(request)
    reply.header('cache-control', 'private, no-store')
    return data(await schoolAuth.save(request.body || {}, requestMeta(request, admin.id), schoolConfigGuard(admin)))
  })
  app.post('/api/v1/admin/school-auth-config/:action', async (request, reply) => {
    const admin = requireSuperAdmin(request)
    reply.header('cache-control', 'private, no-store')
    return data(await schoolAuth.action(request.params.action, request.body || {}, requestMeta(request, admin.id), schoolConfigGuard(admin)))
  })
  const requireBackendUser = (request) => {
    const user = requireUser(request)
    if (user.mustChangePassword) throw Object.assign(new Error('首次登录必须先修改临时密码'), { statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED' })
    if (!delegations.hasBackendAccess(user)) throw Object.assign(new Error('当前账号没有后台管理授权'), { statusCode: 403, code: 'ADMIN_REQUIRED' })
    return user
  }
  const requireBusinessPermission = (request, resource, permission, resourceId = null) => {
    const user = requireBackendUser(request)
    const allowed = resourceId
      ? delegations.can(user, resource, permission, resourceId)
      : delegations.canRoute(user, resource, permission)
    if (!allowed) throw Object.assign(new Error('没有该业务范围的管理权限'), { statusCode: 403, code: 'ADMIN_SCOPE_REQUIRED' })
    return user
  }
  const transactionRouteGuard = (admin, resource, permission) => (databaseState) => {
    const current = databaseState.accounts.find((account) => account.id === admin.id && account.status === 'active')
    if (!current || !delegations.canRouteIn(databaseState, current, resource, permission)) {
      throw Object.assign(new Error('没有该业务范围的管理权限'), { statusCode: 403, code: 'ADMIN_SCOPE_REQUIRED' })
    }
  }
  const transactionRecordGuard = (admin, resource, permission) => (databaseState, record) => {
    const current = databaseState.accounts.find((account) => account.id === admin.id && account.status === 'active')
    if (!current || !delegations.canRecordIn(databaseState, current, resource, permission, record)) {
      throw Object.assign(new Error('没有该记录的管理权限'), { statusCode: 403, code: 'ADMIN_SCOPE_REQUIRED' })
    }
  }
  const isOrganizationContentResource = (resource) => (
    resource === 'activities' || resource === 'announcements'
  )
  const assertAdminOrganizationContentScope = (admin, resource, organizationId, databaseState = null) => {
    if (!isOrganizationContentResource(resource) || !organizationId || admin.isAdmin) return
    const hasScope = (currentState) => ['update', 'moderate'].every((permission) => (
        delegations.canOrganizationIn(currentState, admin, organizationId, permission)
      ))
    const allowed = databaseState ? hasScope(databaseState) : database.read(hasScope)
    if (!allowed) {
      throw Object.assign(new Error('没有关联校友组织的管理权限'), {
        statusCode: 403,
        code: 'ADMIN_SCOPE_REQUIRED'
      })
    }
  }
  const transactionRouteAndOrganizationGuard = (
    admin,
    resource,
    permission,
    organizationId
  ) => (databaseState) => {
    transactionRouteGuard(admin, resource, permission)(databaseState)
    const current = databaseState.accounts.find((account) => (
      account.id === admin.id && account.status === 'active'
    ))
    assertAdminOrganizationContentScope(
      current || admin,
      resource,
      organizationId,
      databaseState
    )
  }
  const transactionRecordAndOrganizationGuard = (
    admin,
    resource,
    permission
  ) => (databaseState, record) => {
    transactionRecordGuard(admin, resource, permission)(databaseState, record)
    const current = databaseState.accounts.find((account) => (
      account.id === admin.id && account.status === 'active'
    ))
    assertAdminOrganizationContentScope(
      current || admin,
      resource,
      record?.organizationId,
      databaseState
    )
  }
  const requireVerifiedUser = (request) => {
    const user = requireUser(request)
    if(user.mustChangePassword)throw Object.assign(new Error('首次登录必须先修改临时密码'),{statusCode:403,code:'PASSWORD_CHANGE_REQUIRED'})
    if (!user.schoolIdentityVerified) throw Object.assign(new Error('该操作仅限已完成学校实名校验的账号'), { statusCode: 403, code: 'SCHOOL_IDENTITY_REQUIRED' })
    return user
  }
  const authorizeImageUpload = (request,target,method='POST') => {
    modules.assertRequest({url:target,method})
    const denied=()=>{throw Object.assign(new Error('不支持的图片上传用途'),{statusCode:403,code:'IMAGE_PURPOSE_INVALID'})}
    if(typeof target!=='string'||!['POST','PUT'].includes(method))return denied()
    if(target==='/api/v1/admin/media'&&method==='POST')return requireBackendUser(request).id
    if(/^\/api\/v1\/admin\/chat-stickers(?:\/[a-f0-9-]{36})?$/.test(target))return requireSuperAdmin(request).id
    const manual=target.match(/^\/api\/v1\/auth\/(?:manual-verifications|manual-verification\/applications)\/([a-f0-9-]{36})\/materials$/)
    if(manual&&method==='POST'){manualVerifications.assertCanUpload(manual[1],bearerToken(request));return 'manual:'+manual[1]}
    const album=target.match(/^\/api\/v1\/business\/organizations\/([a-f0-9-]{36})\/albums\/([a-f0-9-]{36})\/photos$/)
    if(album&&method==='POST'){const user=requireVerifiedUser(request);database.read(d=>organizationAlbums.album(d,album[1],album[2]));return user.id}
    if(['/api/v1/business/community-media','/api/v1/business/enterprise-certifications/materials'].includes(target)&&method==='POST')return requireVerifiedUser(request).id
    return denied()
  }
  app.services.imageTransfers=imageTransfers
  await app.register(imageTransferRoutes,{transfers:imageTransfers,authorize:authorizeImageUpload})
  app.addHook('preValidation',async(request,reply)=>{
    if(!request.body?.uploadId)return
    const target=request.url.split('?')[0],owner=authorizeImageUpload(request,target,request.method)
    const claim=await imageTransfers.claim(request.body.uploadId,owner,target,request.method,request.body)
    if(claim.result)return reply.code(claim.status).send(claim.result)
    request.body[uploadedImage]=claim.image;request.imageTransferClaim=request.body.uploadId
  })
  app.addHook('onSend',async(request,reply,payload)=>{if(request.imageTransferClaim){const id=request.imageTransferClaim;request.imageTransferClaim=null;try{await imageTransfers.finish(id,reply.statusCode,payload)}catch(error){request.log.error({err:error,uploadId:id},'Image binding result could not be recorded; replay remains blocked')}}return payload})
  await app.register(chatRoutes, {chat, requireUser, requireSuperAdmin})
  const gate = await new GateService(database).init()
  app.services.gate = gate
  await app.register(registerGateRoutes,{gate,requireUser,requestMeta})
  const requireManagedOrganizationUser = (request) => {
    const user = requireUser(request)
    if (user.mustChangePassword) {
      throw Object.assign(new Error('首次登录必须先修改临时密码'), {
        statusCode: 403,
        code: 'PASSWORD_CHANGE_REQUIRED'
      })
    }
    return user
  }
  const requireOrganizationScope = (request, organizationId, permissions) => {
    const user = requireManagedOrganizationUser(request)
    const required = Array.isArray(permissions) ? permissions : [permissions]
    const allowed = database.read((databaseState) => required.every((permission) => (
      delegations.canOrganizationIn(databaseState, user, organizationId, permission)
    )))
    if (!allowed) {
      throw Object.assign(new Error('没有该校友组织的管理权限'), {
        statusCode: 403,
        code: 'ORGANIZATION_SCOPE_REQUIRED'
      })
    }
    return user
  }
  const transactionOrganizationGuard = (manager, organizationId, permissions) => (databaseState) => {
    const current = databaseState.accounts.find((account) => (
      account.id === manager.id && account.status === 'active'
    ))
    const required = Array.isArray(permissions) ? permissions : [permissions]
    if (!current || current.mustChangePassword || !required.every((permission) => (
      delegations.canOrganizationIn(databaseState, current, organizationId, permission)
    ))) {
      throw Object.assign(new Error('没有该校友组织的管理权限'), {
        statusCode: 403,
        code: 'ORGANIZATION_SCOPE_REQUIRED'
      })
    }
  }
  const optionalUser = (request) => {
    const token = bearerToken(request)
    if (!token) return null
    try {
      const tokenAccount = sessions.authenticate(token)
      return accounts.getActiveAccount(tokenAccount.id)
    } catch {
      return null
    }
  }

  app.get('/health', async () => {
    await database.health?.()
    await chat.db?.health?.()
    await imageTransfers.db?.health?.()
    await audit.requestDatabase?.health?.()
    await regions.store?.health?.()
    await content.store?.health?.()
    return data({ status: 'ok', database: { driver: config.databaseDriver || 'json' }, content: content.status(), time: new Date().toISOString() })
  })
  app.get('/api/v1/brand', async () => data({
    ...schoolBrand,
    appName: '湖财人',
    shortEnglishName: 'HUFE',
    motto: '正德厚生 经世济用',
    homepage: 'https://www.hufe.edu.cn/',
    colors: { primary: '#033481', secondary: '#1D3B85', gold: '#C2A26B', goldLight: '#DFC095', background: '#F4F6FA' },
    authorizedUse: true,
    sourceSyncedAt: content.status().lastAttemptAt
  }))

  app.get('/api/v1/content/home', async () => data(content.home()))
  app.get('/api/v1/content', async (request) => data(content.list(request.query)))
  app.get('/api/v1/content/:id', async (request, reply) => {
    const item = await content.get(request.params.id)
    if (!item) return reply.code(404).send({ code: 'CONTENT_NOT_FOUND', message: '官网内容不存在或尚未同步', data: null })
    return data(item)
  })
  app.get('/api/v1/sync/status', async () => data(content.status()))

  app.get('/api/v1/media/:filename', async (request, reply) => {
    const file = await media.read(request.params.filename)
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('content-disposition', 'inline')
      .type(file.mimeType)
      .send(file.buffer)
  })

  const trackingToken = (request) => bearerToken(request)
  const applicantMeta = (request) => requestMeta(request, 'manual-verification-applicant')
  const applicantReadOptions = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }
  const manualApplicationBases = [
    '/api/v1/auth/manual-verifications',
    '/api/v1/auth/manual-verification/applications'
  ]
  const createManualApplication = async (request, reply) => {
    const result = await manualVerifications.create(request.body || {}, applicantMeta(request))
    reply.code(201)
    return data(result)
  }
  const getManualApplication = async (request) => {
    return data(manualVerifications.get(request.params.id, trackingToken(request)))
  }
  const updateManualApplication = async (request) => {
    return data(await manualVerifications.update(
      request.params.id,
      trackingToken(request),
      request.body || {},
      applicantMeta(request)
    ))
  }
  const uploadManualMaterial = async (request, reply) => {
    const token = trackingToken(request)
    manualVerifications.assertCanUpload(request.params.id, token)
    const upload = await media.savePrivate(request.body || {}, {
      ...applicantMeta(request),
      applicationId: request.params.id
    })
    try {
      const result = await manualVerifications.attachMaterial(
        request.params.id,
        token,
        upload,
        request.body || {},
        applicantMeta(request)
      )
      reply.code(201)
      return data(result)
    } catch (error) {
      await media.removePrivate(upload.filename)
      throw error
    }
  }
  const readManualMaterial = async (request, reply) => {
    const material = manualVerifications.materialForApplicant(
      request.params.id,
      trackingToken(request),
      request.params.materialId
    )
    const file = await media.readPrivate(material.filename)
    return reply
      .header('cache-control', 'private, no-store')
      .header('content-disposition', 'inline')
      .type(file.mimeType)
      .send(file.buffer)
  }
  const deleteManualMaterial = async (request) => {
    const result = await manualVerifications.removeMaterial(
      request.params.id,
      trackingToken(request),
      request.params.materialId,
      applicantMeta(request)
    )
    await media.removePrivate(result.filename)
    return data(result.application)
  }
  const submitManualApplication = async (request) => {
    return data(await manualVerifications.submit(
      request.params.id,
      trackingToken(request),
      request.body || {},
      applicantMeta(request)
    ))
  }
  const cancelManualApplication = async (request) => {
    const result = await manualVerifications.cancel(
      request.params.id,
      trackingToken(request),
      request.body || {},
      applicantMeta(request)
    )
    await Promise.all(result.filenames.map((filename) => media.removePrivate(filename)))
    return data(result.application)
  }
  const exchangeManualApplication = async (request) => {
    const token = trackingToken(request)
    const identity = manualVerifications.approvedIdentity(request.params.id, token)
    const outcome = await accounts.checkRegistrationEligibility(
      identity,
      requestMeta(request, `manual-verification:${request.params.id}`)
    )
    await manualVerifications.recordExchange(request.params.id, token, outcome.status, applicantMeta(request))
    if (outcome.status === 'registration_verified') {
      const safeIdentity = verifiedIdentityView(outcome.identity)
      return data({
        status: 'registration_verified',
        ...sessions.issueRegistrationTicket(outcome.identity, { trustSafeFields: true }),
        identity: safeIdentity,
        verifiedIdentity: safeIdentity
      })
    }
    if (outcome.status === 'account_exists') return data({ status: 'account_exists', loginRequired: true })
    if (outcome.status === 'account_conflict') {
      const issued = sessions.issueConflict(outcome.conflict, outcome.identity, { trustSafeFields: true })
      return data({ status: 'account_conflict', conflict: outcome.conflict, ...issued })
    }
    throw Object.assign(new Error('人工实名复核换票结果无效'), { statusCode: 409, code: 'REGISTRATION_RESULT_INVALID' })
  }
  for (const base of manualApplicationBases) {
    app.post(base, { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, createManualApplication)
    app.get(`${base}/:id`, applicantReadOptions, getManualApplication)
    app.patch(`${base}/:id`, applicantReadOptions, updateManualApplication)
    app.post(`${base}/:id/materials`, {
      bodyLimit: Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 64 * 1024,
      config: { rateLimit: { max: 15, timeWindow: '1 hour' } }
    }, uploadManualMaterial)
    app.get(`${base}/:id/materials/:materialId`, applicantReadOptions, readManualMaterial)
    app.delete(`${base}/:id/materials/:materialId`, applicantReadOptions, deleteManualMaterial)
    app.post(`${base}/:id/submit`, {
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } }
    }, submitManualApplication)
    app.post(`${base}/:id/cancel`, {
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } }
    }, cancelManualApplication)
    app.post(`${base}/:id/exchange`, {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, exchangeManualApplication)
  }

  app.get('/api/v1/business/bootstrap', async (request, reply) => {
    reply.header('cache-control','private, no-store')
    return data(modules.filterBootstrap(business.bootstrap(optionalUser(request)?.id || '')))
  })
  app.get('/api/v1/business/community-highlights', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    return data(business.communityHighlights(optionalUser(request)?.id || ''))
  })
  app.get('/api/v1/business/me/submissions', async (request) => {
    const user = requireUser(request)
    return data(business.mySubmissions(user.id, request.query, rows => modules.filterSubmissions(rows)))
  })
  app.get('/api/v1/business/me/summary', async (request) => {
    const user = requireUser(request)
    return data(business.mySummary(user.id))
  })
  app.get('/api/v1/business/me/inbox', async (request) => {
    const user = requireUser(request)
    return data(business.inbox(user, request.query))
  })
  app.patch('/api/v1/business/me/inbox/:id/read', async (request) => {
    const user = requireUser(request)
    return data(await business.markInboxRead(user, request.params.id))
  })
  app.post('/api/v1/business/me/inbox/read-all', async (request) => {
    const user = requireUser(request)
    return data(await business.markAllInboxRead(user))
  })
  app.get('/api/v1/business/me/collaboration-opportunities', async (request) => {
    const user = requireUser(request)
    return data(business.myCollaborationOpportunities(user.id, request.query))
  })
  app.patch('/api/v1/business/me/collaboration-opportunities/:id/cancel', async (request) => {
    const user = requireVerifiedUser(request)
    return data(await business.cancelCollaborationOpportunity(
      user.id,
      request.params.id,
      requestMeta(request, user.id)
    ))
  })
  app.get('/api/v1/business/me/mentor-profile', async (request) => {
    const user = requireUser(request)
    return data(business.mentorAccess(user))
  })
  app.put('/api/v1/business/me/mentor-profile', async (request) => {
    const user = requireVerifiedUser(request)
    return data(await business.saveMyMentorProfile(user, request.body || {}, requestMeta(request, user.id)))
  })
  app.get('/api/v1/business/me/enterprise-profile', async (request) => {
    const user = requireUser(request)
    return data(business.enterpriseAccess(user))
  })
  app.put('/api/v1/business/me/enterprise-profile', async (request) => {
    const user = requireVerifiedUser(request)
    return data(await business.saveMyEnterpriseProfile(
      user,
      request.body || {},
      requestMeta(request, user.id)
    ))
  })
  app.get('/api/v1/business/enterprise-certifications', async (request) => {
    const user = requireUser(request)
    return data(business.enterpriseCertification(user))
  })
  app.post('/api/v1/business/enterprise-certifications/materials', {
    bodyLimit: Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 64 * 1024,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const user = requireVerifiedUser(request)
    const metadata = requestMeta(request, user.id)
    const prepared = await business.prepareEnterpriseCertificationMaterial(user, metadata)
    const upload = await media.saveEnterprisePrivate(request.body || {}, {
      ...metadata,
      applicationId: prepared.enterpriseId
    })
    try {
      const result = await business.attachEnterpriseCertificationMaterial(
        user,
        prepared.enterpriseId,
        upload,
        request.body || {},
        metadata
      )
      reply.code(201)
      return data(result)
    } catch (error) {
      await removeEnterprisePrivateFiles([upload.filename], metadata)
      throw error
    }
  })
  app.delete('/api/v1/business/enterprise-certifications/materials/:materialId', async (request) => {
    const user = requireVerifiedUser(request)
    const metadata = requestMeta(request, user.id)
    const result = await business.removeEnterpriseCertificationMaterial(
      user,
      request.params.materialId,
      metadata
    )
    await removeEnterprisePrivateFiles([result.filename], metadata)
    return data(result.certification)
  })
  app.post('/api/v1/business/enterprise-certifications', async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await business.submitEnterpriseCertification(
      user,
      request.body || {},
      requestMeta(request, user.id)
    )
    reply.code(201)
    return data(result)
  })
  app.patch('/api/v1/business/enterprise-certifications/:id/cancel', async (request) => {
    const user = requireVerifiedUser(request)
    const metadata = requestMeta(request, user.id)
    const result = await business.cancelEnterpriseCertification(
      user,
      request.params.id,
      request.body || {},
      metadata
    )
    await removeEnterprisePrivateFiles(result.filenames, metadata)
    return data(result.certification)
  })
  app.get('/api/v1/business/me/jobs', async (request) => {
    const user = requireVerifiedUser(request)
    return data(business.myEnterpriseJobs(user, request.query))
  })
  app.post('/api/v1/business/me/jobs', async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await business.createMyEnterpriseJob(
      user,
      request.body || {},
      requestMeta(request, user.id)
    )
    reply.code(201)
    return data(result)
  })
  app.put('/api/v1/business/me/jobs/:id', async (request) => {
    const user = requireVerifiedUser(request)
    return data(await business.updateMyEnterpriseJob(
      user,
      request.params.id,
      request.body || {},
      requestMeta(request, user.id)
    ))
  })
  app.patch('/api/v1/business/me/jobs/:id/cancel', async (request) => {
    const user = requireVerifiedUser(request)
    return data(await business.cancelMyEnterpriseJob(
      user,
      request.params.id,
      request.body || {},
      requestMeta(request, user.id)
    ))
  })
  app.patch('/api/v1/business/me/submissions/:id/cancel', async (request) => {
    const user = requireVerifiedUser(request)
    return data(await business.cancelSubmission(user.id, request.params.id, requestMeta(request, user.id)))
  })
  app.post('/api/v1/business/submissions', async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await business.createSubmission(user, request.body || {}, requestMeta(request, user.id))
    reply.code(201)
    return data(result)
  })
  app.get('/api/v1/business/community-people', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireVerifiedUser(request)
    reply.header('cache-control', 'private, no-store')
    return data(business.communityPeople(user, request.query))
  })
  app.post('/api/v1/business/community-media', { bodyLimit: Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 65536, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await media.saveCommunity(request.body || {}, user.id, requestMeta(request, user.id))
    reply.code(201)
    return data(result)
  })
  app.get('/api/v1/business/community-media/:id', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request)
    const canRead = (state, account, post) => !account.mustChangePassword && delegations.canRecordIn(state, account, 'community-posts', 'read', post)
    const descriptor = business.communityImage(user, request.params.id, canRead)
    const file = await media.readPrivateFrom(media.communityDirectory, descriptor.filename)
    business.communityImage(requireUser(request), request.params.id, canRead)
    return reply.header('cache-control', 'private, no-store').header('content-disposition', 'inline').type(file.mimeType).send(file.buffer)
  })
  app.delete('/api/v1/business/community-media/:id', async (request) => {
    const user = requireVerifiedUser(request)
    return data(await media.removeCommunityDraft(request.params.id, user.id))
  })
  app.post('/api/v1/business/community-posts', async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await business.createCommunityPost(user, request.body || {}, requestMeta(request, user.id))
    reply.code(201)
    return data(result)
  })
  app.post('/api/v1/business/collaboration-opportunities', async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await business.createCollaborationOpportunity(
      user,
      request.body || {},
      requestMeta(request, user.id)
    )
    reply.code(201)
    return data(result)
  })
  app.post('/api/v1/business/community-posts/:id/like', async (request) => {
    const user = requireVerifiedUser(request)
    return data(await business.toggleCommunityLike(user, request.params.id, requestMeta(request, user.id)))
  })
  app.post('/api/v1/business/community-posts/:id/comments', async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await business.createSubmission(user, {
      type: 'community-comment', resourceId: request.params.id,
      payload: { content: request.body?.content || '', anonymous: request.body?.anonymous === undefined ? false : request.body.anonymous }
    }, requestMeta(request, user.id))
    reply.code(201)
    return data(result)
  })
  app.get('/api/v1/business/organizations/:id/home', async (request) => {
    const user = optionalUser(request)
    const result = business.organizationHome(request.params.id, user?.id || '')
    if (!user) return data(result)
    const capabilities = delegations.organizationCapabilities(user, request.params.id)
    return data(capabilities.read ? { ...result, capabilities } : result)
  })
  app.get('/api/v1/business/organizations/:id/albums', async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    return data(organizationAlbums.list(request.params.id, optionalUser(request)?.id || '', request.query))
  })
  app.get('/api/v1/business/organizations/:id/albums/:albumId/photos', async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    return data(organizationAlbums.photos(request.params.id, request.params.albumId, optionalUser(request)?.id || '', request.query))
  })
  app.post('/api/v1/business/organizations/:id/albums', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await organizationAlbums.create(request.params.id, request.body || {}, requestMeta(request, user.id))
    return reply.code(201).send(data(result))
  })
  app.patch('/api/v1/business/organizations/:id/albums/:albumId', async (request) => {
    const user = requireVerifiedUser(request)
    return data(await organizationAlbums.update(request.params.id, request.params.albumId, request.body || {}, requestMeta(request, user.id)))
  })
  app.post('/api/v1/business/organizations/:id/albums/:albumId/photos', { bodyLimit: Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 65536, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await organizationAlbums.upload(request.params.id, request.params.albumId, request.body || {}, requestMeta(request, user.id))
    return reply.code(201).send(data(result))
  })
  for (const [segment, kind] of [['albums', 'album'], ['album-photos', 'photo']]) {
    app.delete(`/api/v1/business/organizations/:id/${segment}/:itemId`, async request => {
      const user = requireVerifiedUser(request)
      return data(await organizationAlbums.action(request.params.id, kind, request.params.itemId, { action: 'delete' }, requestMeta(request, user.id)))
    })
    app.post(`/api/v1/admin/organizations/:id/${segment}/:itemId/actions`, async request => {
      const user = requireBusinessPermission(request, 'organizations', 'moderate', request.params.id)
      return data(await organizationAlbums.action(request.params.id, kind, request.params.itemId, request.body || {}, requestMeta(request, user.id), true))
    })
  }
  app.get('/api/v1/admin/organizations/:id/albums', async (request, reply) => {
    const user = requireBusinessPermission(request, 'organizations', 'moderate', request.params.id)
    reply.header('cache-control', 'private, no-store')
    return data(organizationAlbums.list(request.params.id, user.id, request.query, true))
  })
  app.get('/api/v1/admin/organizations/:id/albums/:albumId/photos', async (request, reply) => {
    const user = requireBusinessPermission(request, 'organizations', 'moderate', request.params.id)
    reply.header('cache-control', 'private, no-store')
    return data(organizationAlbums.photos(request.params.id, request.params.albumId, user.id, request.query, true))
  })
  for (const manage of [false, true]) {
    app.get(`/api/v1/${manage ? 'admin' : 'business'}/organization-album-photos/:photoId`, { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
      const user = manage ? requireBackendUser(request) : null
      const file = await organizationAlbums.readPhoto(request.params.photoId, user?.id || '', manage)
      if (!manage) reply.header('cross-origin-resource-policy', 'cross-origin')
      return reply.header('cache-control', 'private, no-store').header('content-disposition', 'inline').type(file.mimeType).send(file.buffer)
    })
  }
  const organizationListOptions = {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          page: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          query: { type: 'string', maxLength: 120 }
        }
      }
    }
  }
  app.get('/api/v1/business/organizations/:id/members', organizationListOptions, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const user = requireVerifiedUser(request)
    return data(business.organizationMembers(request.params.id, user.id, request.query, (state, member, organizationId) => (
      delegations.grantsFor(state, member.id).some((grant) => (
        grant.resource === 'organizations' && grant.resourceId === organizationId
        && grant.permissions.some((permission) => ['update', 'moderate', 'manage_members'].includes(permission))
      )) ? 'manager' : 'member'
    )))
  })
  app.get('/api/v1/business/community-posts/:id/comments', organizationListOptions, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const user = requireVerifiedUser(request)
    return data(business.communityComments(request.params.id, user.id, request.query))
  })
  app.get('/api/v1/business/organizations/:id/messages', organizationListOptions, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const user = requireVerifiedUser(request)
    return data(business.organizationMessages(request.params.id, user.id, request.query))
  })
  app.get('/api/v1/business/organizations/:id/contact', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const user = requireVerifiedUser(request)
    return data(business.organizationContact(request.params.id, user.id))
  })
  app.post('/api/v1/business/organizations/:id/messages', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const user = requireVerifiedUser(request)
    const result = await business.createSubmission(user, {
      type: 'organization-message', resourceId: request.params.id, payload: { content: request.body?.content }
    }, requestMeta(request, user.id))
    reply.code(201)
    return data(result)
  })
  app.get('/api/v1/business/me/managed-organizations', async (request) => {
    const manager = requireManagedOrganizationUser(request)
    const result = business.listAdmin(
      'organizations',
      request.query,
      (record, databaseState) => delegations.canOrganizationIn(
        databaseState,
        manager,
        record.id,
        'read'
      )
    )
    result.items = result.items.map((organization) => ({
      ...organization,
      capabilities: delegations.organizationCapabilities(manager, organization.id)
    }))
    return data(result)
  })
  app.get('/api/v1/business/me/managed-organizations/:id', async (request) => {
    const manager = requireOrganizationScope(request, request.params.id, 'read')
    return data({
      ...business.managedOrganizationDetail(request.params.id),
      capabilities: delegations.organizationCapabilities(manager, request.params.id)
    })
  })
  const createManagedOrganizationContent = (resource) => async (request, reply) => {
    const organizationId = request.params.id
    const manager = requireOrganizationScope(request, organizationId, ['update', 'moderate'])
    const result = await business.createOrganizationContent(
      resource,
      organizationId,
      request.body || {},
      requestMeta(request, manager.id),
      transactionOrganizationGuard(manager, organizationId, ['update', 'moderate'])
    )
    reply.code(201)
    return data(result)
  }
  const managedOrganizationPublishOptions = {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }
  app.post(
    '/api/v1/business/me/managed-organizations/:id/activities',
    managedOrganizationPublishOptions,
    createManagedOrganizationContent('activities')
  )
  app.post(
    '/api/v1/business/me/managed-organizations/:id/announcements',
    managedOrganizationPublishOptions,
    createManagedOrganizationContent('announcements')
  )
  const assertManagedOrganizationContentOwnership = (resource, organizationId, contentId) => {
    const record = business.getAdmin(resource, contentId)
    if (record.recordKind !== 'resource' || record.organizationId !== organizationId) {
      throw Object.assign(new Error('组织事项不存在'), {
        statusCode: 404,
        code: 'BUSINESS_ITEM_NOT_FOUND'
      })
    }
    return record
  }
  const updateManagedOrganizationContent = (resource) => async (request) => {
    const organizationId = request.params.id
    const manager = requireOrganizationScope(request, organizationId, ['update', 'moderate'])
    assertManagedOrganizationContentOwnership(
      resource,
      organizationId,
      request.params.contentId
    )
    const result = await business.updateOrganizationContent(
      resource,
      organizationId,
      request.params.contentId,
      request.body || {},
      requestMeta(request, manager.id),
      transactionOrganizationGuard(manager, organizationId, ['update', 'moderate'])
    )
    return data(result)
  }
  const actManagedOrganizationContent = (resource) => async (request) => {
    const organizationId = request.params.id
    const manager = requireOrganizationScope(request, organizationId, ['update', 'moderate'])
    assertManagedOrganizationContentOwnership(
      resource,
      organizationId,
      request.params.contentId
    )
    const result = await business.actOrganizationContent(
      resource,
      organizationId,
      request.params.contentId,
      request.body || {},
      requestMeta(request, manager.id),
      transactionOrganizationGuard(manager, organizationId, ['update', 'moderate'])
    )
    return data(result)
  }
  app.patch(
    '/api/v1/business/me/managed-organizations/:id/activities/:contentId',
    managedOrganizationPublishOptions,
    updateManagedOrganizationContent('activities')
  )
  app.patch(
    '/api/v1/business/me/managed-organizations/:id/announcements/:contentId',
    managedOrganizationPublishOptions,
    updateManagedOrganizationContent('announcements')
  )
  app.post(
    '/api/v1/business/me/managed-organizations/:id/activities/:contentId/actions',
    managedOrganizationPublishOptions,
    actManagedOrganizationContent('activities')
  )
  app.post(
    '/api/v1/business/me/managed-organizations/:id/announcements/:contentId/actions',
    managedOrganizationPublishOptions,
    actManagedOrganizationContent('announcements')
  )
  app.get('/api/v1/business/directory/city-stats', async () => data(business.directoryCityStats()))
  app.get('/api/v1/business/directory/city-center', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    return data(await cityCenters.center(request.query.city))
  })
  app.get('/api/v1/business/:resource', async (request) => {
    const user = request.params.resource === 'directory' ? requireVerifiedUser(request) : optionalUser(request)
    return data(business.listPublic(request.params.resource, request.query, user?.id || ''))
  })
  app.get('/api/v1/business/:resource/:id', async (request) => {
    const user = request.params.resource === 'directory' ? requireVerifiedUser(request) : optionalUser(request)
    return data(business.getPublic(request.params.resource, request.params.id, user?.id || ''))
  })

  const createRegistrationVerificationSession = async (request, reply) => {
    const body = request.body || {}
    const platform = String(body.platform || 'h5')
    if (!['h5', 'mp-weixin', 'mp-alipay', 'app'].includes(platform)) return reply.code(400).send({ code: 'INVALID_PLATFORM', message: '不支持的客户端平台', data: null })
    if (platform !== 'h5') {
      return reply.code(400).send({
        code: 'REGISTRATION_PLATFORM_BINDING_UNAVAILABLE',
        message: '当前客户端尚未启用安全的注册回跳设备绑定，请在 H5 同一浏览器内完成学校实名校验',
        data: null
      })
    }
    const authConfig = schoolAuth.snapshot().config
    const returnUrl = allowedReturnUrl(body.returnUrl, authConfig.returnUrlOrigins)
    if (body.returnUrl && !returnUrl) return reply.code(400).send({ code: 'RETURN_URL_NOT_ALLOWED', message: '回跳地址不在白名单', data: null })
    const runtime = registrationRuntime()
    const protocol = resolveSsoProtocol(authConfig)
    // 不创建无法完成的注册事务，更不能将 localhost、HTTP 或占位 service 发送给学校 CAS。
    if (protocol === 'cas') buildCasRegistrationServiceUrl(authConfig)
    const { session, pollToken, browserBinding } = sessions.create({ platform, returnUrl, protocol })
    session.schoolAuthRevision = runtime.revision
    const authorizeUrl = new URL('/api/v1/auth/registration/start', authConfig.publicBaseUrl)
    authorizeUrl.searchParams.set('session', session.id)
    authorizeUrl.searchParams.set('state', session.state)
    reply.header('set-cookie', registrationCookie(session, browserBinding, config)).code(201)
    return data({ purpose: 'new_user_registration', sessionId: session.id, pollToken, authorizeUrl: authorizeUrl.toString(), protocol, expiresAt: new Date(session.expiresAt).toISOString() })
  }
  const registrationSessionOptions = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }
  app.post('/api/v1/auth/registration/verification-sessions', registrationSessionOptions, createRegistrationVerificationSession)
  app.post('/api/v1/auth/registration/sessions', registrationSessionOptions, createRegistrationVerificationSession)
  // 旧路径保留为兼容别名；事务用途始终是新用户注册实名校验，不是平台登录。
  app.post('/api/v1/auth/sso/sessions', registrationSessionOptions, createRegistrationVerificationSession)

  const startRegistrationVerification = async (request, reply) => {
    const hint = requireRegistrationBinding(request, config)
    if (!request.query.session || hint.id !== request.query.session) {
      throw Object.assign(new Error('注册身份校验浏览器绑定与事务不匹配'), { code: 'REGISTRATION_BROWSER_BINDING_MISMATCH', statusCode: 401 })
    }
    sessions.verifyBrowserBinding(hint.id, hint.browserBinding)
    const session = sessions.forStart(request.query.session, request.query.state)
    const runtime = registrationRuntime(session.schoolAuthRevision)
    if (session.protocol === 'oidc') {
      const redirectUri = new URL('/api/v1/auth/registration/oidc/callback', runtime.config.publicBaseUrl).toString()
      const authorization = await runtime.oidc.authorization({ redirectUri, state: session.state })
      schoolAuth.requireReady(session.schoolAuthRevision)
      sessions.setOidc(session.id, { redirectUri, nonce: authorization.nonce, codeVerifier: authorization.codeVerifier })
      return reply.redirect(authorization.url)
    }
    const serviceUrl = buildCasRegistrationServiceUrl(runtime.config)
    return reply.redirect(runtime.cas.loginUrl(serviceUrl))
  }
  const registrationStartOptions = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }
  app.get('/api/v1/auth/registration/start', registrationStartOptions, startRegistrationVerification)
  app.get('/api/v1/auth/sso/start', registrationStartOptions, startRegistrationVerification)

  const registrationCasCallback = async (request, reply) => {
    let session
    try {
      if (request.query.session || request.query.state) {
        throw Object.assign(new Error('CAS 回调不得通过查询参数指定注册事务'), { code: 'REGISTRATION_CALLBACK_CONTEXT_FORBIDDEN', statusCode: 400 })
      }
      const hint = requireRegistrationBinding(request, config)
      const bound = sessions.verifyBrowserBinding(hint.id, hint.browserBinding)
      session = sessions.forStart(bound.id, bound.state)
      if (session.protocol !== 'cas') throw Object.assign(new Error('学校回调协议与本次事务不一致，请重新发起'), { code: 'REGISTRATION_PROTOCOL_MISMATCH', statusCode: 400 })
      const runtime = registrationRuntime(session.schoolAuthRevision)
      if (!request.query.ticket) throw Object.assign(new Error('学校未返回 CAS ticket'), { code: 'CAS_TICKET_MISSING', statusCode: 400 })
      const serviceUrl = buildCasRegistrationServiceUrl(runtime.config)
      const result = await runtime.cas.validate(request.query.ticket, serviceUrl)
      const identity = await identityMapper(result, runtime.config)
      schoolAuth.requireReady(session.schoolAuthRevision)
      const outcome = await accounts.checkRegistrationEligibility(identity, requestMeta(request, accounts.subjectKey(identity.schoolSubject)))
      schoolAuth.requireReady(session.schoolAuthRevision)
      sessions.complete(session.id, outcome)
      const message = outcome.status === 'account_conflict'
        ? '检测到同一学校身份存在多个账号，请返回湖财人注销多余账号。'
        : outcome.status === 'account_exists'
          ? '该学校身份已注册，请返回湖财人使用平台用户名和密码登录。'
          : '学校身份已确认，请返回湖财人设置平台用户名和密码。'
      return browserResult(reply, session, { ok: true, message })
    } catch (error) {
      request.auditFailure = 'SCHOOL_VERIFICATION_FAILED'
      if (session) sessions.fail(session.id, safeSchoolFailure(error))
      if (session) {
        reply.header('set-cookie', clearRegistrationCookie())
        return browserResult(reply, session, { ok: false, message: '学校票据校验失败，请返回湖财人重新发起注册身份校验。' })
      }
      throw error
    }
  }
  app.get('/api/v1/auth/registration/callback', registrationCasCallback)
  app.get('/api/v1/auth/sso/callback', registrationCasCallback)

  const registrationOidcCallback = async (request, reply) => {
    let session
    try {
      const hint = requireRegistrationBinding(request, config)
      session = sessions.byState(request.query.state)
      if (session.protocol !== 'oidc') throw Object.assign(new Error('学校回调协议与本次事务不一致，请重新发起'), { code: 'REGISTRATION_PROTOCOL_MISMATCH', statusCode: 400 })
      if (session.id !== hint.id) throw Object.assign(new Error('注册身份校验浏览器绑定与事务不匹配'), { code: 'REGISTRATION_BROWSER_BINDING_MISMATCH', statusCode: 401 })
      sessions.verifyBrowserBinding(session.id, hint.browserBinding)
      const runtime = registrationRuntime(session.schoolAuthRevision)
      if (request.query.error) throw Object.assign(new Error(request.query.error_description || 'OIDC 授权被拒绝'), { code: request.query.error, statusCode: 400 })
      if (!request.query.code || !session.oidc) throw Object.assign(new Error('OIDC 回调参数不完整'), { code: 'OIDC_CALLBACK_INVALID', statusCode: 400 })
      const result = await runtime.oidc.exchange({ code: request.query.code, ...session.oidc })
      const identity = await identityMapper(result, runtime.config)
      schoolAuth.requireReady(session.schoolAuthRevision)
      const outcome = await accounts.checkRegistrationEligibility(identity, requestMeta(request, accounts.subjectKey(identity.schoolSubject)))
      schoolAuth.requireReady(session.schoolAuthRevision)
      sessions.complete(session.id, outcome)
      const message = outcome.status === 'account_conflict'
        ? '检测到同一学校身份存在多个账号，请返回湖财人注销多余账号。'
        : outcome.status === 'account_exists'
          ? '该学校身份已注册，请返回湖财人使用平台用户名和密码登录。'
          : '学校身份已确认，请返回湖财人设置平台用户名和密码。'
      return browserResult(reply, session, { ok: true, message })
    } catch (error) {
      request.auditFailure = 'SCHOOL_VERIFICATION_FAILED'
      if (session) sessions.fail(session.id, safeSchoolFailure(error))
      if (session) {
        reply.header('set-cookie', clearRegistrationCookie())
        return browserResult(reply, session, { ok: false, message: '学校身份校验失败，请返回湖财人重试。' })
      }
      throw error
    }
  }
  app.get('/api/v1/auth/registration/oidc/callback', registrationOidcCallback)
  app.get('/api/v1/auth/sso/oidc/callback', registrationOidcCallback)

  const pollRegistrationVerification = async (request) => {
    const session = sessions.authorizePoll(request.params.id, bearerToken(request))
    if (session.status !== 'failed') schoolAuth.requireReady(session.schoolAuthRevision)
    return data(sessions.poll(request.params.id, bearerToken(request)))
  }
  app.get('/api/v1/auth/registration/verification-sessions/:id', pollRegistrationVerification)
  app.get('/api/v1/auth/registration/sessions/:id', pollRegistrationVerification)
  app.get('/api/v1/auth/sso/sessions/:id', pollRegistrationVerification)

  const exchangeRegistrationVerification = async (request, reply) => {
    const body = request.body || {}
    const hint = requireRegistrationBinding(request, config)
    if (!body.sessionId || body.sessionId !== hint.id) {
      throw Object.assign(new Error('注册身份校验浏览器绑定与事务不匹配'), { code: 'REGISTRATION_BROWSER_BINDING_MISMATCH', statusCode: 401 })
    }
    const bound = sessions.verifyBrowserBinding(body.sessionId, hint.browserBinding)
    schoolAuth.requireReady(bound.schoolAuthRevision)
    const outcome = sessions.exchange(body.sessionId, bearerToken(request), body.exchangeCode)
    reply.header('set-cookie', clearRegistrationCookie())
    if (outcome.status === 'registration_verified') {
      const identity = verifiedIdentityView(outcome.identity)
      return data({ status: 'registration_verified', ...sessions.issueRegistrationTicket(outcome.identity), identity, verifiedIdentity: identity })
    }
    if (outcome.status === 'account_exists') return data({ status: 'account_exists', loginRequired: true })
    if (outcome.status === 'account_conflict') {
      const issued = sessions.issueConflict(outcome.conflict, outcome.identity)
      return data({ status: 'account_conflict', conflict: outcome.conflict, ...issued })
    }
    throw Object.assign(new Error('注册身份校验结果无效'), { statusCode: 409, code: 'REGISTRATION_RESULT_INVALID' })
  }
  app.post('/api/v1/auth/registration/exchange', exchangeRegistrationVerification)
  app.post('/api/v1/auth/sso/exchange', exchangeRegistrationVerification)

  const resolveRegistrationConflict = async (request) => {
    const token = bearerToken(request)
    const conflictSession = sessions.authenticateConflict(token, request.params.id)
    const result = await accounts.resolveConflict(request.params.id, request.body || {}, requestMeta(request, 'self-service'))
    sessions.consumeConflict(token)
    if (result.status === 'registration_required') {
      const identity = verifiedIdentityView(conflictSession.identity)
      return data({ status: 'registration_verified', ...sessions.issueRegistrationTicket(conflictSession.identity), identity, verifiedIdentity: identity })
    }
    return data({ status: 'account_kept', loginRequired: true })
  }
  app.post('/api/v1/auth/registration/conflicts/:id/resolve', resolveRegistrationConflict)
  app.post('/api/v1/auth/conflicts/:id/resolve', resolveRegistrationConflict)

  app.post('/api/v1/auth/register', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body || {}
    const registrationTicket = String(body.registrationTicket || body.registrationToken || '')
    const identity = sessions.authenticateRegistrationTicket(registrationTicket)
    const account = await accounts.register(identity, body, requestMeta(request, 'new-registration'))
    request.user = account
    sessions.consumeRegistrationTicket(registrationTicket)
    reply.code(201)
    return data({ status: 'registered', loginRequired: true, user: account })
  })

  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (request,reply) => {
    const attempt=sessions.beginLogin()
    const account = await accounts.login(request.body || {}, requestMeta(request, 'local-login'))
    request.user = account
    const issued = await sessions.issueLogin(account,request.body?.deviceId,requestMeta(request,account.id),attempt)
    reply.header('cache-control','private, no-store')
    const mentorAccess = business.mentorAccess(account)
    return data({
      status: 'authenticated',
      ...issued,
      user: {
        ...delegations.decorateAccount(account),
        mentorAccess: {
          eligible: mentorAccess.eligible,
          verificationStatus: mentorAccess.verificationStatus,
          profileId: mentorAccess.profile?.id || null
        },
        canEditMentorProfile: mentorAccess.eligible,
        mentorProfileId: mentorAccess.profile?.id || null,
        mentorVerificationStatus: mentorAccess.verificationStatus
      }
    })
  })

  app.get('/api/v1/me/identity-card', async (request, reply) => {
    const user = requireUser(request)
    reply.header('cache-control', 'private, no-store')
    if (Object.keys(request.query || {}).length) throw Object.assign(new Error('只能查看本人身份卡'), {statusCode:400,code:'SELF_IDENTITY_ONLY'})
    return data(database.read(state => {
      const account=state.accounts.find(row=>row.id===user.id)
      return {studentIdDisplay:selfStudentNumber(account,config.dataHashSecret),alumniNo:account?.alumniNo||''}
    }))
  })
  app.get('/api/v1/me/profile', async (request, reply) => {
    const user = requireUser(request)
    reply.header('cache-control', 'private, no-store')
    return data(database.read(state => selfProfile(state.accounts.find(row => row.id === user.id))))
  })
  app.patch('/api/v1/me/profile', async (request, reply) => {
    const user = requireUser(request)
    reply.header('cache-control', 'private, no-store')
    return data(await updateSelfProfile(database, user.id, request.body, requestMeta(request,user.id), regions))
  })
  app.get('/api/v1/me', async (request,reply) => {
    const user = requireUser(request)
    reply.header('cache-control','private, no-store')
    const mentorAccess = business.mentorAccess(user)
    return data({
      ...delegations.decorateAccount(user),
      mentorAccess: {
        eligible: mentorAccess.eligible,
        verificationStatus: mentorAccess.verificationStatus,
        profileId: mentorAccess.profile?.id || null
      },
      canEditMentorProfile: mentorAccess.eligible,
      mentorProfileId: mentorAccess.profile?.id || null,
      mentorVerificationStatus: mentorAccess.verificationStatus
    })
  })
  app.post('/api/v1/auth/change-password', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request) => {
    const user = requireUser(request)
    await accounts.changePassword(user.id, request.body?.currentPassword, request.body?.newPassword, requestMeta(request, user.id))
    await sessions.revokeAccount(user.id)
    return data({ passwordChanged: true, loginRequired: true })
  })
  app.delete('/api/v1/me', async (request) => {
    const user = requireUser(request)
    await accounts.deactivateSelf(user.id, request.body?.confirmation, requestMeta(request, user.id))
    await sessions.revoke(request.accessToken,requestMeta(request,user.id))
    return data({ deactivated: true })
  })
  app.post('/api/v1/auth/logout', async (request) => {
    requireUser(request)
    await sessions.revoke(request.accessToken,requestMeta(request,request.user.id))
    return data({ loggedOut: true })
  })

  app.get('/api/v1/admin/dashboard', async (request) => {
    const user = requireBackendUser(request)
    if (user.isAdmin) return data({ ...accounts.dashboard(), content: content.status(), business: business.summary(), restricted: false })
    const summary = business.summary((record, data, resource) => delegations.canRecordIn(data, user, resource, 'read', record))
    summary.revision = null
    return data({ accounts: 0, activeAccounts: 0, students: 0, facultyAndStaff: 0, alumni: 0, openConflicts: 0, content: null, business: summary, restricted: true })
  })
  registerPersonnelRoutes(app,{accounts,requireSuperAdmin,requestMeta,data})
  registerDossierRoutes(app,{accounts,regions,requireSuperAdmin,requestMeta,data})
  registerPasswordResetRoutes(app,{accounts,sessions,requireSuperAdmin,requestMeta,data})
  registerDirectVerificationRoutes(app,{accounts,requireSuperAdmin,requestMeta,data})
  registerAlumniNumberRoutes(app,{accounts,requireSuperAdmin,requestMeta,data})
  registerEnterpriseLookupRoutes(app,{lookup:new EnterpriseLookupService(database,config,regions),requireUser,requireSuperAdmin,requestMeta,data})
  app.get('/api/v1/admin/accounts', async (request) => { requireSuperAdmin(request); return data(accounts.listAccounts(request.query)) })
  app.post('/api/v1/admin/accounts', async (request, reply) => {
    const admin = requireSuperAdmin(request)
    const requested = Array.isArray(request.body?.adminPermissions) ? [...new Set(request.body.adminPermissions.map(String))] : []
    if (!requested.length || requested.some((resource) => !businessResourceKeys.includes(resource))) throw Object.assign(new Error('请选择有效的初始管理板块'), { statusCode: 400, code: 'DELEGATION_SCOPE_INVALID' })
    const account = await accounts.provisionOperator(request.body || {}, requestMeta(request, admin.id))
    await delegations.replaceModulePermissions(admin, account.id, requested, requestMeta(request, admin.id))
    reply.code(201)
    return data({ account: delegations.decorateAccount(account) })
  })
  app.get('/api/v1/admin/accounts/search', async (request) => {
    const admin = requireBackendUser(request)
    return data(delegations.searchAccounts(admin, request.query))
  })
  app.get('/api/v1/admin/accounts/:id/permissions', async (request) => {
    requireSuperAdmin(request)
    return data(delegations.modulePermissions(request.params.id))
  })
  app.put('/api/v1/admin/accounts/:id/permissions', async (request) => {
    const admin = requireSuperAdmin(request)
    return data(await delegations.replaceModulePermissions(admin, request.params.id, request.body?.resources, requestMeta(request, admin.id)))
  })
  app.patch('/api/v1/admin/accounts/:id/status', async (request) => {
    const admin = requireSuperAdmin(request)
    return data(await accounts.setAccountStatus(request.params.id, request.body?.status, requestMeta(request, admin.id)))
  })
  app.get('/api/v1/admin/conflicts', async (request) => { requireSuperAdmin(request); return data(accounts.listConflicts(request.query)) })
  app.post('/api/v1/admin/conflicts/:id/resolve', async (request) => {
    const admin = requireSuperAdmin(request)
    return data(await accounts.resolveConflict(request.params.id, request.body || {}, requestMeta(request, admin.id)))
  })
  app.get('/api/v1/admin/audit-logs', async (request, reply) => {
    requireSuperAdmin(request)
    reply.header('cache-control', 'private, no-store')
    return data(await audit.list(request.query))
  })
  app.get('/api/v1/admin/manual-verifications', async (request) => {
    requireSuperAdmin(request)
    return data(manualVerifications.listAdmin(request.query))
  })
  app.get('/api/v1/admin/manual-verifications/:id', async (request) => {
    requireSuperAdmin(request)
    return data(manualVerifications.getAdmin(request.params.id))
  })
  app.post('/api/v1/admin/manual-verifications/:id/actions', async (request) => {
    const admin = requireSuperAdmin(request)
    return data(await manualVerifications.action(
      request.params.id,
      admin,
      request.body || {},
      requestMeta(request, admin.id)
    ))
  })
  app.get('/api/v1/admin/manual-verifications/:id/materials/:materialId', async (request, reply) => {
    requireSuperAdmin(request)
    const material = manualVerifications.materialForAdmin(request.params.id, request.params.materialId)
    const file = await media.readPrivate(material.filename)
    return reply
      .header('cache-control', 'private, no-store')
      .header('content-disposition', 'inline')
      .type(file.mimeType)
      .send(file.buffer)
  })
  app.post('/api/v1/admin/content/sync', async (request) => {
    const admin = requireSuperAdmin(request)
    request.log.info({ actor: admin.id }, 'manual content sync')
    await content.refresh()
    return data(content.status())
  })
  app.post('/api/v1/admin/media', {
    bodyLimit: Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 64 * 1024,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const admin = requireBackendUser(request)
    const result = await media.save(request.body || {}, requestMeta(request, admin.id))
    reply.code(201)
    return data(result)
  })
  app.get('/api/v1/admin/delegation/resources', async (request) => { requireBackendUser(request); return data(delegations.resources()) })
  app.get('/api/v1/admin/delegations', async (request) => {
    const admin = requireBackendUser(request)
    return data(delegations.list(admin, request.query))
  })
  app.post('/api/v1/admin/delegations', async (request, reply) => {
    const admin = requireBackendUser(request)
    const result = await delegations.create(admin, request.body || {}, requestMeta(request, admin.id))
    reply.code(201)
    return data(result)
  })
  app.delete('/api/v1/admin/delegations/:id', async (request) => {
    const admin = requireBackendUser(request)
    return data(await delegations.revoke(admin, request.params.id, requestMeta(request, admin.id), request.body?.reason))
  })
  app.get('/api/v1/admin/business/summary', async (request) => {
    const admin = requireBackendUser(request)
    if (admin.isAdmin) return data(business.summary())
    const summary = business.summary((record, data, resource) => delegations.canRecordIn(data, admin, resource, 'read', record))
    summary.revision = null
    return data(summary)
  })
  app.get('/api/v1/admin/business/mentors/:id/owner', async (request) => {
    requireBusinessPermission(request, 'mentors', 'read', request.params.id)
    return data(business.getMentorOwner(request.params.id))
  })
  app.put('/api/v1/admin/business/mentors/:id/owner', async (request) => {
    const admin = requireBackendUser(request)
    return data(await business.bindMentorOwner(
      request.params.id,
      request.body?.accountId,
      requestMeta(request, admin.id),
      transactionRecordGuard(admin, 'mentors', 'moderate')
    ))
  })
  app.delete('/api/v1/admin/business/mentors/:id/owner', async (request) => {
    const admin = requireBackendUser(request)
    return data(await business.unbindMentorOwner(
      request.params.id,
      requestMeta(request, admin.id),
      transactionRecordGuard(admin, 'mentors', 'moderate')
    ))
  })
  app.get('/api/v1/admin/business/alumni-enterprises/:id/materials/:materialId', async (request, reply) => {
    const admin = requireBackendUser(request)
    const record = business.getAdmin('alumni-enterprises', request.params.id)
    if (!delegations.canRecord(admin, 'alumni-enterprises', 'read', record)) {
      throw Object.assign(new Error('企业证明材料不存在'), {
        statusCode: 404,
        code: 'ENTERPRISE_MATERIAL_NOT_FOUND'
      })
    }
    const material = business.enterpriseMaterialForAdmin(
      request.params.id,
      request.params.materialId
    )
    const file = await media.readEnterprisePrivate(material.filename)
    return reply
      .header('cache-control', 'private, no-store')
      .header('content-disposition', 'inline')
      .type(file.mimeType)
      .send(file.buffer)
  })
  app.get('/api/v1/admin/business/:resource/:id/managers', async (request) => {
    const admin = requireBackendUser(request)
    return data(delegations.recordManagers(admin, request.params.resource, request.params.id))
  })
  app.post('/api/v1/admin/business/:resource/:id/managers', async (request, reply) => {
    const admin = requireBackendUser(request)
    const result = await delegations.create(admin, {
      accountId: request.body?.accountId, resource: request.params.resource, resourceId: request.params.id,
      permissions: request.body?.permissions, expiresAt: request.body?.expiresAt
    }, requestMeta(request, admin.id))
    reply.code(201)
    return data(result)
  })
  app.delete('/api/v1/admin/business/:resource/:id/managers/:accountId', async (request) => {
    const admin = requireBackendUser(request)
    return data(await delegations.revokeRecordManager(admin, request.params.resource, request.params.id, request.params.accountId, requestMeta(request, admin.id)))
  })
  registerGivingTemplateRoutes(app,{business,requireBackendUser,delegations,transactionRecordGuard,requestMeta,data})
  app.get('/api/v1/admin/business/:resource', async (request) => {
    const admin = requireBusinessPermission(request, request.params.resource, 'read')
    const result = business.listAdmin(request.params.resource, request.query, delegations.adminRecordFilter(admin, request.params.resource, 'read'))
    result.items = result.items.map((record) => ({ ...record, capabilities: delegations.recordCapabilities(admin, request.params.resource, record) }))
    return data(result)
  })
  app.get('/api/v1/admin/business/:resource/:id', async (request) => {
    const admin = requireBackendUser(request)
    const record = business.getAdmin(request.params.resource, request.params.id)
    if (!delegations.canRecord(admin, request.params.resource, 'read', record)) throw Object.assign(new Error('业务记录不存在'), { statusCode: 404, code: 'BUSINESS_ITEM_NOT_FOUND' })
    return data({ ...record, capabilities: delegations.recordCapabilities(admin, request.params.resource, record) })
  })
  app.post('/api/v1/admin/business/:resource', async (request, reply) => {
    const resource = request.params.resource
    const admin = requireBusinessPermission(request, resource, 'create')
    const organizationId = isOrganizationContentResource(resource)
      ? String(request.body?.organizationId || '').trim()
      : ''
    assertAdminOrganizationContentScope(admin, resource, organizationId)
    const result = await business.createAdmin(
      resource,
      request.body || {},
      requestMeta(request, admin.id),
      transactionRouteAndOrganizationGuard(admin, resource, 'create', organizationId)
    )
    reply.code(201)
    return data({ ...result, capabilities: delegations.recordCapabilities(admin, resource, result) })
  })
  app.patch('/api/v1/admin/business/:resource/:id', async (request) => {
    const resource = request.params.resource
    const admin = requireBackendUser(request)
    const record = business.getAdmin(resource, request.params.id)
    if (!delegations.canRecord(admin, resource, 'update', record)) {
      throw Object.assign(new Error('没有该记录的管理权限'), {
        statusCode: 403,
        code: 'ADMIN_SCOPE_REQUIRED'
      })
    }
    assertAdminOrganizationContentScope(admin, resource, record.organizationId)
    const result = await business.updateAdmin(
      resource,
      request.params.id,
      request.body || {},
      requestMeta(request, admin.id),
      transactionRecordAndOrganizationGuard(admin, resource, 'update')
    )
    return data({ ...result, capabilities: delegations.recordCapabilities(admin, resource, result) })
  })
  app.post('/api/v1/admin/business/:resource/:id/actions', async (request) => {
    const resource = request.params.resource
    const admin = requireBackendUser(request)
    const record = business.getAdmin(resource, request.params.id)
    if (!delegations.canRecord(admin, resource, 'moderate', record)) {
      throw Object.assign(new Error('没有该记录的管理权限'), {
        statusCode: 403,
        code: 'ADMIN_SCOPE_REQUIRED'
      })
    }
    assertAdminOrganizationContentScope(admin, resource, record.organizationId)
    const result = await business.actAdmin(
      resource,
      request.params.id,
      request.body || {},
      requestMeta(request, admin.id),
      transactionRecordAndOrganizationGuard(admin, resource, 'moderate')
    )
    return data({ ...result, capabilities: delegations.recordCapabilities(admin, resource, result) })
  })
  app.post('/api/v1/admin/ops/content/sync', async (request) => {
    const supplied = String(request.headers['x-sync-key'] || '')
    if (!config.adminSyncKey || !safeEqual(supplied, config.adminSyncKey)) throw Object.assign(new Error('运维同步密钥无效'), { statusCode: 401, code: 'SYNC_KEY_INVALID' })
    await content.refresh()
    return data(content.status())
  })

  return app
}
