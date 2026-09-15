import { getAccessToken, getPlatformUser } from './store'

export const INITIAL_PASSWORD_PAGE = '/pages/change-password/index'
let navigatingToken = ''

export function requiresInitialPasswordChange() {
  return Boolean(getAccessToken() && getPlatformUser().mustChangePassword === true)
}

// 登录态与实名态分开判断。未实名人员同样需要先修改临时密码。
export function enforceInitialPasswordChange() {
  if (!requiresInitialPasswordChange()) return false
  const token = getAccessToken()
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const route = String(pages[pages.length - 1]?.route || '').replace(/^\//, '')
  if (route === INITIAL_PASSWORD_PAGE.slice(1) || navigatingToken === token) return true
  navigatingToken = token
  uni.reLaunch({
    url: INITIAL_PASSWORD_PAGE,
    complete: () => { if (navigatingToken === token) navigatingToken = '' }
  })
  return true
}

function utf8Length(value) {
  let size = 0
  for (const character of value) {
    const point = character.codePointAt(0)
    size += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
  }
  return size
}

export function initialPasswordError({ currentPassword = '', newPassword = '', confirmPassword = '' } = {}) {
  if (!currentPassword) return '请输入当前密码'
  if (typeof newPassword !== 'string' || newPassword.length < 8 || utf8Length(newPassword) > 128) return '新密码至少 8 位，且不超过 128 字节（中文通常占 3 字节）'
  if (newPassword === currentPassword) return '新密码不能与当前密码相同'
  if (newPassword !== confirmPassword) return '两次输入的新密码不一致'
  return ''
}
