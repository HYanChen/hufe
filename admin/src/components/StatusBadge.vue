<script setup>
defineProps({
  tone: { type: String, default: 'neutral' },
  dot: { type: Boolean, default: false }
})
</script>

<template>
  <span class="status-badge" :class="`status-${tone}`">
    <span v-if="dot" class="status-dot" aria-hidden="true"></span>
    <slot />
  </span>
</template>
