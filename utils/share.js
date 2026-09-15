export async function sharePage(path, title) {
  // Mini-program buttons keep their native open-type="share" behavior.
  // #ifdef H5
  const url = `${window.location.origin}${window.location.pathname}#${path}`
  if (navigator.share) {
    try { await navigator.share({ title, url }); return }
    catch (error) { if (error.name === 'AbortError') return }
  }
  uni.setClipboardData({ data: url, success: () => uni.showToast({ title: '分享链接已复制', icon: 'none' }), fail: () => uni.showModal({ title: '分享链接', content: url, showCancel: false }) })
  // #endif
  // #ifdef APP-PLUS
  uni.shareWithSystem({ summary: title, href: `https://hufe.pla.wiki/#${path}`, fail: () => uni.showToast({ title: '暂时无法唤起分享，请重试', icon: 'none' }) })
  // #endif
}
