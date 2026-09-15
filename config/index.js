import { schoolBrand } from '../server/src/brand.js'

export const appConfig = {
  appName: '湖财人',
  englishName: 'HUFE',
  schoolName: schoolBrand.name,
  schoolEnglishName: schoolBrand.englishName,
  officialHomepage: 'https://www.hufe.edu.cn/',
  officialLogoUrl: schoolBrand.logoUrl,
  officialCrestUrl: schoolBrand.crestUrl,
  officialWordmarkUrl: schoolBrand.wordmarkUrl,
  authStorageKey: 'hufe_alumni_auth_state',
  // 仅 Vite 开发服务器为 true，用于本机演示账号；生产构建不会启用。
  localDevelopment: Boolean(import.meta.env.DEV),
  // 生产 H5 默认走同源 /api；App/小程序发布时必须显式配置正式 HTTPS 网关。
  apiBaseUrl: String(import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:8787' : '')).replace(/\/$/, ''),
  requestTimeout: Number(import.meta.env.VITE_API_TIMEOUT || 10000),
  identityFreshTtlMs: Number(import.meta.env.VITE_IDENTITY_FRESH_TTL_MS || 5 * 60 * 1000),
  // 只有学校已将正式 HTTPS service/callback 加入统一认证白名单后才可开启。
  // 默认关闭可以避免本地演示地址被带到 CAS 后出现“应用未接入”页面。
  schoolRegistrationReady: String(import.meta.env.VITE_SCHOOL_REGISTRATION_READY || '').trim().toLowerCase() === 'true',
  theme: {
    primary: '#033481',
    gold: '#C2A26B',
    background: '#F4F6FA'
  }
}
