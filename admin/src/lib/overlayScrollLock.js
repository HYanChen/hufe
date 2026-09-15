import { onBeforeUnmount, watch } from 'vue'

let activeLocks = 0

function syncScrollLock() {
  if (typeof document === 'undefined') return
  const method = activeLocks > 0 ? 'add' : 'remove'
  document.documentElement.classList[method]('overlay-scroll-locked')
  document.body.classList[method]('overlay-scroll-locked')
}

function acquireScrollLock() {
  activeLocks += 1
  syncScrollLock()
  let released = false
  return () => {
    if (released) return
    released = true
    activeLocks = Math.max(0, activeLocks - 1)
    syncScrollLock()
  }
}

export function useOverlayScrollLock(source) {
  let release = null
  const stop = watch(source, (open) => {
    if (open && !release) release = acquireScrollLock()
    if (!open && release) {
      release()
      release = null
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    stop()
    release?.()
    release = null
  })
}
