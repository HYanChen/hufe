import { requestDesktopChat } from './desktopChat'
import { enforceInitialPasswordChange, INITIAL_PASSWORD_PAGE } from './passwordChange'
import { isPageModuleEnabled } from '../services/modules'

const tabPages = [
  '/pages/home/index',
  '/pages/services/index',
  '/pages/conversations/index',
  '/pages/community/index',
  '/pages/mine/index'
]
const tabQueryStorageKey = 'hufe_pending_tab_query'

function parseQuery(target) {
  const query = String(target || '').split('?')[1] || ''
  if (!query) return {}
  return query.split('&').reduce((result, pair) => {
    const [rawKey, ...rawValue] = pair.split('=')
    if (!rawKey) return result
    try {
      result[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.join('=') || '')
    } catch {
      result[rawKey] = rawValue.join('=')
    }
    return result
  }, {})
}

function launchExternalUrl(url) {
  // #ifdef H5
  window.open(url, '_blank', 'noopener,noreferrer')
  // #endif
  // #ifdef APP-PLUS
  plus.runtime.openURL(url)
  // #endif
  // #ifdef MP-WEIXIN || MP-ALIPAY
  uni.setClipboardData({ data: url, success: () => uni.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' }) })
  // #endif
}

export function openPage(url) {
  const target = String(url || '').trim()
  if (!target) return
  if (!isPageModuleEnabled(target)) { uni.showToast({title:'该功能暂未启用',icon:'none'}); return }
  if (target.split('?')[0] !== INITIAL_PASSWORD_PAGE && enforceInitialPasswordChange()) return
  if (/^https?:\/\//i.test(target)) {
    let hostname = '外部网站'
    try { hostname = new URL(target).hostname || hostname } catch {}
    uni.showModal({
      title: '即将离开湖财人',
      content: `将打开外部网站：${hostname}\n请勿在非学校官方页面输入湖财人或学校账号密码。`,
      confirmText: '继续打开',
      cancelText: '取消',
      confirmColor: '#033481',
      success: (result) => {
        if (result.confirm) launchExternalUrl(target)
      }
    })
    return
  }
  const purePath = target.split('?')[0]
  if (purePath === '/pages/chat/index' && requestDesktopChat(parseQuery(target).id || '')) return
  if (purePath === '/pages/conversations/index' && requestDesktopChat()) return
  if (tabPages.includes(purePath)) {
    const query = parseQuery(target)
    if (Object.keys(query).length) {
      uni.setStorageSync(tabQueryStorageKey, { path: purePath, query, createdAt: Date.now() })
    }
    uni.switchTab({ url: purePath })
    return
  }
  uni.navigateTo({ url: target })
}

export function consumeTabPageQuery(path) {
  const pending = uni.getStorageSync(tabQueryStorageKey)
  if (!pending || pending.path !== path || Date.now() - Number(pending.createdAt || 0) > 30_000) return {}
  uni.removeStorageSync(tabQueryStorageKey)
  return pending.query && typeof pending.query === 'object' ? pending.query : {}
}
