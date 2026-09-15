// #ifdef H5
import jsQR from './vendor/jsqr.mjs'
// #endif
import { normalizeGatePayload } from './gateQr'

// The scanner processes pixels locally. Camera access starts only from an explicit user action.
export function startGateCamera(container, onResult, onError) {
  // #ifdef H5
  let stopped = false, stream, timer, video
  const stop = () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); if (video) { video.pause(); video.srcObject = null; video.remove() } }
  const capture = () => {
    if (stopped) return
    try {
      if (video.videoWidth) {
        const scale = Math.min(1, 1000 / Math.max(video.videoWidth, video.videoHeight)), canvas = document.createElement('canvas')
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), result = jsQR(pixels.data, canvas.width, canvas.height)
        if (result) { const payload = normalizeGatePayload(result.data); stop(); onResult(payload); return }
      }
      timer = setTimeout(capture, 180)
    } catch (error) { stop(); onError(error) }
  }
  ;(async () => {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('相机需要 HTTPS 安全连接和浏览器授权；可改用识别二维码图片')
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (stopped) { stream.getTracks().forEach(track => track.stop()); return }
      video = document.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.setAttribute('aria-label', '二维码扫码相机'); video.style.cssText = 'display:block;width:100%;max-height:360px;object-fit:cover;border-radius:12px'; container.appendChild(video); video.srcObject = stream
      await video.play(); if (!stopped) capture()
    } catch (error) { if (!stopped) { stop(); onError(new Error(error.name === 'NotAllowedError' ? '相机权限未获允许，请开启权限或改用识别二维码图片' : error.message)) } }
  })()
  return stop
  // #endif
  // #ifndef H5
  let stopped = false
  uni.scanCode({ scanType: ['qrCode'], success: result => { if (!stopped) { try { onResult(normalizeGatePayload(result.result)) } catch (error) { onError(error) } } }, fail: () => { if (!stopped) onError(new Error('扫码已取消或相机不可用')) } })
  return () => { stopped = true }
  // #endif
}

export function pickGateQrImage() {
  // #ifdef H5
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif'; input.oncancel = () => resolve(null)
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return resolve(null)
      let bitmap
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('请选择20MB以内的二维码图片')
        bitmap = await createImageBitmap(file)
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), result = jsQR(pixels.data, canvas.width, canvas.height)
        if (!result) throw new Error('没有识别到二维码，请选择清晰完整的身份卡二维码图片')
        resolve(normalizeGatePayload(result.data))
      } catch (error) { reject(error) } finally { bitmap?.close() }
    }
    input.click()
  })
  // #endif
  // #ifndef H5
  return new Promise((resolve, reject) => uni.scanCode({ onlyFromCamera: false, scanType: ['qrCode'], success: result => { try { resolve(normalizeGatePayload(result.result)) } catch (error) { reject(error) } }, fail: () => reject(new Error('图片识别已取消或不可用')) }))
  // #endif
}
