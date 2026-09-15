// Relative map, font and tile URLs must reach the API instead of Vite's SPA fallback.
export function developmentApiProxy(env = {}) {
  const configured = env.HUFE_API_PROXY || (/^https?:\/\//i.test(env.VITE_API_BASE_URL || '') ? env.VITE_API_BASE_URL : 'http://127.0.0.1:8787')
  const url = new URL(configured)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid development API proxy origin')
  return { '/api': { target: url.origin, changeOrigin: true }, '/health': { target: url.origin, changeOrigin: true } }
}
