<script setup>
import { computed, ref, watch } from 'vue'
import { Image, Trash2, Upload } from '@lucide/vue'
import { IMAGE_ACCEPT, isManagedMediaUrl, isSafeImageUrl, uploadAdminImage, validateImageFile } from '../lib/media.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  id: { type: String, default: '' },
  label: { type: String, default: '图片' },
  placeholder: { type: String, default: '请输入 HTTPS 或站内媒体地址' },
  maxLength: { type: Number, default: 2048 },
  managedOnly: Boolean
})
const emit = defineEmits(['update:modelValue', 'validity', 'uploading'])

const fileInput = ref(null)
const uploading = ref(false)
const error = ref('')
const notice = ref('')

const value = computed(() => String(props.modelValue || ''))
const previewUrl = computed(() => value.value.trim() && (props.managedOnly ? isManagedMediaUrl(value.value) : isSafeImageUrl(value.value)) ? value.value.trim() : '')

function validateUrl(nextValue = value.value) {
  const message = props.managedOnly
    ? (!nextValue.trim() || isManagedMediaUrl(nextValue) ? '' : '请先上传图片，仅接受站内 /api/v1/media 图片地址')
    : (isSafeImageUrl(nextValue) ? '' : '仅支持不含账号信息的 HTTP/HTTPS 地址或站内 /api/v1/media 图片地址')
  error.value = message
  emit('validity', { valid: !message, message })
}

function updateValue(event) {
  notice.value = ''
  const nextValue = event.target.value
  emit('update:modelValue', nextValue)
  validateUrl(nextValue)
}

function chooseImage() {
  if (!uploading.value) fileInput.value?.click()
}

async function uploadImage(event) {
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  notice.value = ''
  if (!file) return
  const validationError = validateImageFile(file)
  if (validationError) {
    error.value = validationError
    return
  }
  uploading.value = true
  emit('uploading', true)
  error.value = ''
  try {
    const result = await uploadAdminImage(file)
    emit('update:modelValue', result.url)
    notice.value = '图片已安全上传并写入站内媒体地址'
    emit('validity', { valid: true, message: '' })
  } catch (cause) {
    error.value = cause.message || '图片上传失败，请稍后重试'
  } finally {
    uploading.value = false
    emit('uploading', false)
  }
}

function clearImage() {
  notice.value = ''
  error.value = ''
  emit('update:modelValue', '')
  emit('validity', { valid: true, message: '' })
}

watch(() => props.modelValue, (nextValue) => validateUrl(nextValue), { immediate: true })
</script>

<template>
  <div class="image-upload-field">
    <div class="image-upload-input-row">
      <input
        :id="id"
        :aria-label="label"
        :value="value"
        type="text"
        :maxlength="maxLength"
        :placeholder="placeholder"
        :aria-invalid="Boolean(error)"
        @input="updateValue"
      />
      <input ref="fileInput" class="image-upload-file" type="file" :accept="IMAGE_ACCEPT" @change="uploadImage" />
      <button class="button button-secondary image-upload-trigger" type="button" :disabled="uploading" @click="chooseImage">
        <span v-if="uploading" class="spinner small"></span>
        <Upload v-else :size="15" />
        {{ uploading ? '上传中…' : '上传图片' }}
      </button>
    </div>
    <div v-if="previewUrl" class="image-upload-preview">
      <img :src="previewUrl" :alt="`${label}预览`" />
      <div>
        <span><Image :size="14" />图片预览</span>
        <button type="button" @click="clearImage"><Trash2 :size="14" />清除</button>
      </div>
    </div>
    <p v-if="error" class="image-upload-error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="image-upload-notice" role="status">{{ notice }}</p>
    <small>支持 JPEG、PNG、WebP、GIF，单张不超过 500MB；{{ managedOnly ? '仅使用本站已上传的图片。' : '也可保留 HTTPS 或站内媒体地址。' }}</small>
  </div>
</template>

<style scoped>
.image-upload-field { display: grid; gap: 8px; }
.image-upload-input-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: stretch; }
.image-upload-input-row > input[type='text'] { min-width: 0; }
.image-upload-file { display: none; }
.image-upload-trigger { white-space: nowrap; padding-inline: 14px; }
.image-upload-preview {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  border: 1px solid #dce6f0;
  border-radius: 10px;
  padding: 8px;
  background: #f8fafc;
}
.image-upload-preview img { width: 92px; height: 64px; border-radius: 7px; object-fit: cover; background: #eef2f6; }
.image-upload-preview > div { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.image-upload-preview span,
.image-upload-preview button { display: inline-flex; align-items: center; gap: 5px; }
.image-upload-preview span { color: #64748b; font-size: 12px; }
.image-upload-preview button { border: 0; background: transparent; color: #b42318; cursor: pointer; font-size: 12px; }
.image-upload-error,
.image-upload-notice { margin: 0; font-size: 12px; line-height: 1.5; }
.image-upload-error { color: #b42318; }
.image-upload-notice { color: #18794e; }
.image-upload-field > small { color: #7f8d9d; font-size: 11px; }
@media (max-width: 620px) {
  .image-upload-input-row { grid-template-columns: 1fr; }
  .image-upload-trigger { justify-content: center; }
}
</style>
