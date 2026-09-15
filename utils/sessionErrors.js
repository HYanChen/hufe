export const REVOKED_SESSION_CODES = Object.freeze(['SESSION_REPLACED', 'SESSION_REVOKED', 'SESSION_DEVICE_REPLACED', 'CREDENTIALS_CHANGED', 'ACCESS_TOKEN_EXPIRED', 'ACCOUNT_INACTIVE', 'UNAUTHORIZED'])
export function isRevokedSession(error) {
  return REVOKED_SESSION_CODES.includes(error?.code)
}
export function sessionEndMessage(error) {
  if (['SESSION_REPLACED', 'SESSION_DEVICE_REPLACED'].includes(error?.code)) return '账号已在其他设备登录，当前设备已退出。'
  if (error?.code === 'CREDENTIALS_CHANGED') return '密码已更新，请使用新密码重新登录。'
  if (error?.code === 'ACCOUNT_INACTIVE') return '账号当前不可用，请联系管理员。'
  return error?.message || '登录状态已失效，请重新登录。'
}
