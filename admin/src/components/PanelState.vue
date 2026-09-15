<script setup>
import { AlertCircle, Inbox } from '@lucide/vue'

defineProps({
  loading: Boolean,
  error: { type: String, default: '' },
  empty: Boolean,
  emptyTitle: { type: String, default: '暂无数据' },
  emptyDescription: { type: String, default: '当前没有需要显示的记录。' }
})
defineEmits(['retry'])
</script>

<template>
  <div v-if="loading" class="panel-state" aria-live="polite">
    <span class="spinner" aria-hidden="true"></span><p>正在加载数据…</p>
  </div>
  <div v-else-if="error" class="panel-state panel-error" role="alert">
    <AlertCircle :size="28" /><p>{{ error }}</p><button class="button button-secondary" type="button" @click="$emit('retry')">重新加载</button>
  </div>
  <div v-else-if="empty" class="panel-state">
    <Inbox :size="34" /><h3>{{ emptyTitle }}</h3><p>{{ emptyDescription }}</p>
  </div>
</template>
