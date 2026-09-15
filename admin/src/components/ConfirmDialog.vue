<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, X } from '@lucide/vue'
import { useOverlayScrollLock } from '../lib/overlayScrollLock.js'

const props = defineProps({
  open: Boolean,
  title: { type: String, default: '确认操作' },
  description: { type: String, default: '' },
  confirmText: { type: String, default: '确认' },
  tone: { type: String, default: 'danger' },
  confirmDisabled: Boolean,
  busy: Boolean,
  wide: Boolean
})
const emit = defineEmits(['confirm', 'cancel'])
const dialogElement = ref(null)
let previousFocus = null

function focusableElements() {
  return [...(dialogElement.value?.querySelectorAll(
    'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])'
  ) || [])]
}

function onKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!props.busy) emit('cancel')
    return
  }
  if (event.key !== 'Tab') return
  event.stopImmediatePropagation()
  const focusable = focusableElements()
  if (!focusable.length) {
    event.preventDefault()
    dialogElement.value?.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!dialogElement.value?.contains(document.activeElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    previousFocus = document.activeElement
    await nextTick()
    const focusable = focusableElements()
    ;(focusable[0] || dialogElement.value)?.focus()
  } else if (previousFocus?.focus) {
    previousFocus.focus()
    previousFocus = null
  }
}, { immediate: true })
useOverlayScrollLock(() => props.open)
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="open" class="dialog-backdrop" @click.self="!busy && emit('cancel')">
        <section ref="dialogElement" class="dialog-card" :class="{ 'dialog-card--wide': wide }" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1">
          <button class="icon-button dialog-close" type="button" aria-label="关闭" :disabled="busy" @click="emit('cancel')"><X :size="18" /></button>
          <div class="dialog-scroll">
            <div class="dialog-icon" :class="`dialog-${tone}`"><AlertTriangle :size="24" /></div>
            <h2 id="dialog-title">{{ title }}</h2>
            <p>{{ description }}</p>
            <slot />
          </div>
          <footer class="dialog-actions">
            <button class="button button-ghost" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
            <button class="button" :class="tone === 'danger' ? 'button-danger' : 'button-primary'" type="button" :disabled="busy || confirmDisabled" @click="emit('confirm')">
              <span v-if="busy" class="spinner small" aria-hidden="true"></span>{{ busy ? '处理中…' : confirmText }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-card--wide { width: min(100%, 1100px); }
</style>
