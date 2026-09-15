// A random installation label, not a hardware fingerprint or an authentication secret.
// H5 front/admin on the same origin deliberately share this exact plain storage key.
export const DEVICE_STORAGE_KEY = 'hufe.installation.device-id.v1'
let memoryId = ''
function newId() {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return 'device_' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
export function getDeviceId() {
  try {
    const browser = typeof window !== 'undefined' && window.localStorage
    const existing = browser ? browser.getItem(DEVICE_STORAGE_KEY) : typeof uni !== 'undefined' ? uni.getStorageSync(DEVICE_STORAGE_KEY) : memoryId
    if (/^device_[a-f0-9]{32}$/.test(existing || '')) return existing
    const id = memoryId || newId()
    if (browser) browser.setItem(DEVICE_STORAGE_KEY, id)
    else if (typeof uni !== 'undefined') uni.setStorageSync(DEVICE_STORAGE_KEY, id)
    memoryId = id
    return id
  } catch {
    // Storage denied: this running application still has a stable label; never collect UA/IP.
    return memoryId ||= newId()
  }
}
