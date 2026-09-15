<script setup>
import {
  Fragment, computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted,
  reactive, ref, watch
} from 'vue'
import {
  Bold, Eye, Heading2, Image, Italic, Link, List, ListOrdered,
  PencilLine, Quote, RotateCcw, Trash2, Upload, X
} from '@lucide/vue'
import { IMAGE_ACCEPT, isManagedMediaUrl, uploadAdminImage, validateImageFile } from '../lib/media.js'

const DRAFT_PREFIX = 'hufe-admin-editor:draft:'

const props = defineProps({
  modelValue: { type: String, default: '' },
  id: { type: String, default: '' },
  label: { type: String, default: '正文' },
  placeholder: { type: String, default: '请输入正文，支持 Markdown 排版' },
  maxLength: { type: Number, default: 20000 },
  draftKey: { type: String, default: '' },
  readonly: Boolean
})

const emit = defineEmits(['update:modelValue', 'validity'])
const textarea = ref(null)
const imageInput = ref(null)
const mode = ref('edit')
const insertKind = ref('')
const insertionError = ref('')
const uploadNotice = ref('')
const uploading = ref(false)
const draftCandidate = ref(null)
const initialValue = ref('')
const insertForm = reactive({ text: '', url: '' })
let draftTimer = 0
let pendingDraft = null

const value = computed(() => String(props.modelValue || ''))
const storageKey = computed(() => props.draftKey ? `${DRAFT_PREFIX}${props.draftKey}` : '')
const characterCount = computed(() => value.value.length)
const contentCount = computed(() => value.value
  .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
  .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
  .replace(/[*_`#>+\-\d.)]/g, '')
  .replace(/\s/g, '').length)

function isSafeUrl(rawUrl, kind = 'link') {
  const url = String(rawUrl || '').trim()
  if (!url || /\s/.test(url)) return false
  if (kind === 'image' && isManagedMediaUrl(url)) return true
  if (kind === 'link' && /^\/pages\/[A-Za-z0-9/_-]+(?:[?#][^\s]*)?$/.test(url) && !url.includes('..')) return true
  if (kind === 'link' && /^#[A-Za-z][\w:.-]{0,127}$/.test(url)) return true
  if (kind === 'link' && /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(url)) return true
  if (kind === 'link' && /^tel:\+?[0-9 ()-]{5,30}$/i.test(url)) return true
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
  } catch {
    return false
  }
}

function validateMarkdown(markdown) {
  const text = String(markdown || '')
  if (props.maxLength && text.length > props.maxLength) {
    return `正文不能超过 ${props.maxLength.toLocaleString('zh-CN')} 个字符`
  }
  if (/<\/?[a-z][^>]*>/i.test(text)) {
    return '正文仅保存 Markdown 纯文本，不支持 HTML 标签'
  }
  const linkPattern = /(!?)\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
  let match
  while ((match = linkPattern.exec(text))) {
    if (!isSafeUrl(match[2], match[1] ? 'image' : 'link')) {
      return `正文中包含不安全或无效的${match[1] ? '图片' : '链接'}地址`
    }
  }
  return ''
}

const validationMessage = computed(() => validateMarkdown(value.value))

watch(validationMessage, (message) => {
  emit('validity', { valid: !message, message })
}, { immediate: true })

function parseInline(text) {
  const source = String(text || '')
  const tokens = []
  const pattern = /(!?\[([^\]]*)]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|_([^_\n]+)_|`([^`\n]+)`)/g
  let offset = 0
  let match
  while ((match = pattern.exec(source))) {
    if (match.index > offset) tokens.push({ type: 'text', text: source.slice(offset, match.index) })
    if (match[1]) {
      const image = match[1].startsWith('!')
      if (isSafeUrl(match[3], image ? 'image' : 'link')) {
        tokens.push({ type: image ? 'image' : 'link', text: match[2] || (image ? '图片' : match[3]), url: match[3] })
      } else {
        tokens.push({ type: 'text', text: match[0] })
      }
    } else if (match[4]) {
      tokens.push({ type: 'strong', text: match[4] })
    } else if (match[5]) {
      tokens.push({ type: 'em', text: match[5] })
    } else {
      tokens.push({ type: 'code', text: match[6] })
    }
    offset = pattern.lastIndex
  }
  if (offset < source.length) tokens.push({ type: 'text', text: source.slice(offset) })
  return tokens
}

function isBlockStart(line) {
  return /^(#{1,3})\s+/.test(line)
    || /^>\s?/.test(line)
    || /^[-*+]\s+/.test(line)
    || /^\d+[.)]\s+/.test(line)
    || /^```/.test(line)
}

function parseBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }
    if (/^```/.test(line)) {
      const language = line.slice(3).trim()
      const code = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++])
      if (index < lines.length) index += 1
      blocks.push({ type: 'code-block', language, text: code.join('\n') })
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, tokens: parseInline(heading[2]) })
      index += 1
      continue
    }
    if (/^>\s?/.test(line)) {
      const quoteLines = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', tokens: parseInline(quoteLines.join('\n')) })
      continue
    }
    if (/^[-*+]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(parseInline(lines[index].replace(/^[-*+]\s+/, '')))
        index += 1
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index])) {
        items.push(parseInline(lines[index].replace(/^\d+[.)]\s+/, '')))
        index += 1
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }
    const paragraph = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push({ type: 'paragraph', tokens: parseInline(paragraph.join('\n')) })
  }
  return blocks
}

const previewBlocks = computed(() => parseBlocks(value.value))

const InlinePreview = defineComponent({
  name: 'InlinePreview',
  props: { tokens: { type: Array, default: () => [] } },
  setup(inlineProps) {
    return () => h(Fragment, null, inlineProps.tokens.map((token, index) => {
      const key = `${token.type}-${index}`
      if (token.type === 'strong') return h('strong', { key }, token.text)
      if (token.type === 'em') return h('em', { key }, token.text)
      if (token.type === 'code') return h('code', { key }, token.text)
      if (token.type === 'link') {
        const external = /^https?:/i.test(token.url)
        return h('a', {
          key,
          href: token.url,
          ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})
        }, token.text)
      }
      if (token.type === 'image') {
        return h('img', { key, src: token.url, alt: token.text, loading: 'lazy' })
      }
      return h('span', { key }, token.text)
    }))
  }
})

function updateValue(nextValue, selection = null) {
  emit('update:modelValue', nextValue)
  scheduleDraft(nextValue)
  if (selection) {
    nextTick(() => {
      textarea.value?.focus()
      textarea.value?.setSelectionRange(selection.start, selection.end)
    })
  }
}

function selectedRange() {
  const element = textarea.value
  const end = value.value.length
  return {
    start: element?.selectionStart ?? end,
    end: element?.selectionEnd ?? end
  }
}

function insertAround(before, after, fallback) {
  const range = selectedRange()
  const selected = value.value.slice(range.start, range.end) || fallback
  const next = `${value.value.slice(0, range.start)}${before}${selected}${after}${value.value.slice(range.end)}`
  if (props.maxLength && next.length > props.maxLength) {
    insertionError.value = `插入后将超过 ${props.maxLength.toLocaleString('zh-CN')} 个字符`
    return
  }
  insertionError.value = ''
  updateValue(next, {
    start: range.start + before.length,
    end: range.start + before.length + selected.length
  })
}

function prefixLines(kind) {
  const range = selectedRange()
  const lineStart = value.value.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1
  const nextNewline = value.value.indexOf('\n', range.end)
  const lineEnd = nextNewline === -1 ? value.value.length : nextNewline
  const selected = value.value.slice(lineStart, lineEnd) || '正文'
  const lines = selected.split('\n')
  const prefixed = lines.map((line, index) => {
    if (kind === 'heading') return `## ${line.replace(/^#{1,3}\s+/, '')}`
    if (kind === 'quote') return `> ${line.replace(/^>\s?/, '')}`
    if (kind === 'ordered') return `${index + 1}. ${line.replace(/^\d+[.)]\s+/, '')}`
    return `- ${line.replace(/^[-*+]\s+/, '')}`
  }).join('\n')
  const next = `${value.value.slice(0, lineStart)}${prefixed}${value.value.slice(lineEnd)}`
  if (props.maxLength && next.length > props.maxLength) {
    insertionError.value = `插入后将超过 ${props.maxLength.toLocaleString('zh-CN')} 个字符`
    return
  }
  insertionError.value = ''
  updateValue(next, { start: lineStart, end: lineStart + prefixed.length })
}

function openInsert(kind) {
  const range = selectedRange()
  insertKind.value = kind
  insertForm.text = value.value.slice(range.start, range.end) || (kind === 'image' ? '' : '链接文字')
  insertForm.url = ''
  insertionError.value = ''
  uploadNotice.value = ''
}

function closeInsert() {
  insertKind.value = ''
  insertionError.value = ''
  uploadNotice.value = ''
}

function chooseImage() {
  if (!uploading.value) imageInput.value?.click()
}

async function uploadImage(event) {
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  uploadNotice.value = ''
  insertionError.value = ''
  if (!file) return
  const validationError = validateImageFile(file)
  if (validationError) {
    insertionError.value = validationError
    return
  }
  uploading.value = true
  try {
    const result = await uploadAdminImage(file)
    insertForm.url = String(result?.url || '')
    if (!insertForm.text.trim()) insertForm.text = file.name.replace(/\.[^.]+$/, '') || '正文图片'
    uploadNotice.value = '图片已安全上传，确认替代文字后即可插入正文'
  } catch (error) {
    insertionError.value = error.message || '图片上传失败，请稍后重试'
  } finally {
    uploading.value = false
  }
}

function confirmInsert() {
  const kind = insertKind.value
  const url = insertForm.url.trim()
  const text = insertForm.text.trim()
  if (!text) {
    insertionError.value = kind === 'image' ? '请填写图片替代文字' : '请填写链接文字'
    return
  }
  if (!isSafeUrl(url, kind)) {
    insertionError.value = kind === 'image'
      ? '请输入有效的 http(s) 或站内相对图片地址'
      : '请输入有效的 http(s)、站内相对、锚点、mailto 或 tel 地址'
    return
  }
  const range = selectedRange()
  const markdown = `${kind === 'image' ? '!' : ''}[${text}](${url})`
  const next = `${value.value.slice(0, range.start)}${markdown}${value.value.slice(range.end)}`
  if (props.maxLength && next.length > props.maxLength) {
    insertionError.value = `插入后将超过 ${props.maxLength.toLocaleString('zh-CN')} 个字符`
    return
  }
  updateValue(next, { start: range.start + markdown.length, end: range.start + markdown.length })
  closeInsert()
}

function storageAvailable() {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function readDraft() {
  draftCandidate.value = null
  initialValue.value = value.value
  if (!storageAvailable() || !storageKey.value || props.readonly) return
  try {
    const raw = window.localStorage.getItem(storageKey.value)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (typeof saved?.value !== 'string') throw new Error('invalid draft')
    if (saved.value === value.value) {
      window.localStorage.removeItem(storageKey.value)
      return
    }
    draftCandidate.value = saved
  } catch {
    window.localStorage.removeItem(storageKey.value)
  }
}

function persistDraft(nextValue, key, baseline) {
  if (!storageAvailable() || !key || props.readonly) return
  window.clearTimeout(draftTimer)
  draftTimer = 0
  try {
    if (nextValue === baseline) {
      window.localStorage.removeItem(key)
      return
    }
    window.localStorage.setItem(key, JSON.stringify({
      value: nextValue,
      updatedAt: new Date().toISOString()
    }))
  } catch {
    // Storage can be unavailable in private mode. Editing must remain usable.
  }
}

function scheduleDraft(nextValue) {
  window.clearTimeout(draftTimer)
  pendingDraft = { value: nextValue, key: storageKey.value, baseline: initialValue.value }
  draftTimer = window.setTimeout(() => {
    const draft = pendingDraft
    pendingDraft = null
    if (draft) persistDraft(draft.value, draft.key, draft.baseline)
  }, 500)
}

function flushDraft() {
  window.clearTimeout(draftTimer)
  draftTimer = 0
  const draft = pendingDraft
  pendingDraft = null
  if (draft) persistDraft(draft.value, draft.key, draft.baseline)
}

function restoreDraft() {
  if (!draftCandidate.value) return
  updateValue(draftCandidate.value.value)
  draftCandidate.value = null
  nextTick(() => textarea.value?.focus())
}

function discardDraft() {
  if (storageAvailable() && storageKey.value) window.localStorage.removeItem(storageKey.value)
  draftCandidate.value = null
}

function clearDraft() {
  window.clearTimeout(draftTimer)
  draftTimer = 0
  pendingDraft = null
  discardDraft()
  initialValue.value = value.value
}

function formatDraftTime(valueToFormat) {
  const parsed = new Date(valueToFormat)
  if (Number.isNaN(parsed.getTime())) return '稍早'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(parsed)
}

watch(() => props.draftKey, () => {
  flushDraft()
  readDraft()
})

onMounted(readDraft)
onBeforeUnmount(flushDraft)

defineExpose({ clearDraft, flushDraft, focus: () => textarea.value?.focus() })
</script>

<template>
  <section
    class="structured-editor"
    :class="{ 'structured-editor-invalid': validationMessage, 'structured-editor-readonly': readonly }"
    :aria-label="`${label}${readonly ? '只读预览' : '编辑器'}`"
  >
    <template v-if="!readonly">
      <div v-if="draftCandidate" class="draft-recovery" role="status">
        <RotateCcw :size="16" />
        <p>
          <strong>发现未提交草稿</strong>
          <span>保存于 {{ formatDraftTime(draftCandidate.updatedAt) }}，可恢复后继续编辑。</span>
        </p>
        <button type="button" @click="restoreDraft">恢复</button>
        <button type="button" class="draft-discard" @click="discardDraft"><Trash2 :size="14" />放弃</button>
      </div>

      <div class="editor-toolbar" role="toolbar" :aria-label="`${label}排版工具`">
        <div class="editor-tools">
          <button type="button" title="二级标题" aria-label="插入二级标题" @click="prefixLines('heading')"><Heading2 :size="17" /></button>
          <button type="button" title="加粗" aria-label="加粗选中文字" @click="insertAround('**', '**', '重点文字')"><Bold :size="17" /></button>
          <button type="button" title="斜体" aria-label="将选中文字设为斜体" @click="insertAround('_', '_', '强调文字')"><Italic :size="17" /></button>
          <span></span>
          <button type="button" title="无序列表" aria-label="插入无序列表" @click="prefixLines('unordered')"><List :size="17" /></button>
          <button type="button" title="有序列表" aria-label="插入有序列表" @click="prefixLines('ordered')"><ListOrdered :size="17" /></button>
          <button type="button" title="引用" aria-label="插入引用" @click="prefixLines('quote')"><Quote :size="17" /></button>
          <span></span>
          <button type="button" title="链接" aria-label="插入链接" @click="openInsert('link')"><Link :size="17" /></button>
          <button type="button" title="图片" aria-label="插入图片" @click="openInsert('image')"><Image :size="17" /></button>
        </div>
        <div class="editor-mode-switch">
          <button type="button" :class="{ active: mode === 'edit' }" :aria-pressed="mode === 'edit'" @click="mode = 'edit'"><PencilLine :size="15" />编辑</button>
          <button type="button" :class="{ active: mode === 'preview' }" :aria-pressed="mode === 'preview'" @click="mode = 'preview'"><Eye :size="15" />预览</button>
        </div>
      </div>

      <div v-if="insertKind" class="editor-insert-panel">
        <div class="editor-insert-head">
          <strong>{{ insertKind === 'image' ? '插入图片' : '插入链接' }}</strong>
          <button type="button" aria-label="关闭插入面板" @click="closeInsert"><X :size="16" /></button>
        </div>
        <label>
          <span>{{ insertKind === 'image' ? '替代文字' : '链接文字' }}</span>
          <input v-model.trim="insertForm.text" type="text" :placeholder="insertKind === 'image' ? '用于无障碍访问和加载失败提示' : '请输入链接文字'" />
        </label>
        <label>
          <span>URL 地址</span>
          <input v-model.trim="insertForm.url" type="url" placeholder="https:// 或 /站内路径" @keydown.enter.prevent="confirmInsert" />
        </label>
        <div v-if="insertKind === 'image'" class="image-upload-row">
          <input ref="imageInput" class="image-file-input" type="file" :accept="IMAGE_ACCEPT" @change="uploadImage" />
          <button type="button" class="image-upload-button" :disabled="uploading" @click="chooseImage">
            <span v-if="uploading" class="spinner small"></span>
            <Upload v-else :size="15" />
            {{ uploading ? '上传中…' : '上传本地图片' }}
          </button>
          <small>JPEG / PNG / WebP / GIF，单张不超过 500MB</small>
        </div>
        <p v-if="uploadNotice" class="upload-notice" role="status">{{ uploadNotice }}</p>
        <p v-if="insertionError" role="alert">{{ insertionError }}</p>
        <button type="button" class="insert-confirm" @click="confirmInsert">确认插入</button>
      </div>
    </template>

    <textarea
      v-if="!readonly && mode === 'edit'"
      :id="id"
      ref="textarea"
      :value="value"
      :maxlength="maxLength || undefined"
      :placeholder="placeholder"
      :aria-invalid="Boolean(validationMessage)"
      :aria-describedby="`${id}-editor-help`"
      @input="updateValue($event.target.value)"
    ></textarea>

    <div v-else class="markdown-preview" :class="{ 'markdown-preview-empty': !previewBlocks.length }">
      <p v-if="!previewBlocks.length">暂无正文内容</p>
      <template v-for="(block, blockIndex) in previewBlocks" :key="`${block.type}-${blockIndex}`">
        <component :is="`h${block.level}`" v-if="block.type === 'heading'"><InlinePreview :tokens="block.tokens" /></component>
        <p v-else-if="block.type === 'paragraph'"><InlinePreview :tokens="block.tokens" /></p>
        <blockquote v-else-if="block.type === 'quote'"><InlinePreview :tokens="block.tokens" /></blockquote>
        <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.type === 'list'">
          <li v-for="(item, itemIndex) in block.items" :key="itemIndex"><InlinePreview :tokens="item" /></li>
        </component>
        <pre v-else-if="block.type === 'code-block'"><code :data-language="block.language">{{ block.text }}</code></pre>
      </template>
    </div>

    <footer v-if="!readonly" :id="`${id}-editor-help`" class="editor-status">
      <span>Markdown 纯文本 · 正文字数 {{ contentCount.toLocaleString('zh-CN') }}</span>
      <span :class="{ limit: maxLength && characterCount > maxLength * 0.9 }">{{ characterCount.toLocaleString('zh-CN') }}<template v-if="maxLength"> / {{ maxLength.toLocaleString('zh-CN') }}</template> 字符</span>
    </footer>
    <p v-if="validationMessage && !readonly" class="editor-validation" role="alert">{{ validationMessage }}</p>
  </section>
</template>

<style scoped>
.structured-editor {
  overflow: hidden;
  width: 100%;
  color: #273e57;
  background: #fff;
  border: 1px solid #c8d4e0;
  border-radius: 10px;
  transition: border-color .18s ease, box-shadow .18s ease;
}
.structured-editor:focus-within { border-color: #719bc5; box-shadow: 0 0 0 3px rgba(0, 63, 135, .08); }
.structured-editor-invalid { border-color: #c55a5a; }
.draft-recovery {
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: #7b591e;
  background: #fff7e6;
  border-bottom: 1px solid #ead8af;
}
.draft-recovery > svg { flex: 0 0 auto; }
.draft-recovery p { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.draft-recovery strong { font-size: 11px; }
.draft-recovery span { color: #8d7855; font-size: 9px; line-height: 1.45; }
.draft-recovery button {
  min-height: 30px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #fff;
  background: #8b651f;
  border-radius: 6px;
  cursor: pointer;
  font-size: 9px;
  font-weight: 700;
}
.draft-recovery .draft-discard { color: #7b6750; background: transparent; border: 1px solid #d8c9aa; }
.editor-toolbar {
  min-height: 46px;
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: #f7f9fb;
  border-bottom: 1px solid #dfe6ed;
}
.editor-tools, .editor-mode-switch { display: flex; align-items: center; gap: 3px; }
.editor-tools > span { width: 1px; height: 22px; margin: 0 3px; background: #dce3ea; }
.editor-toolbar button {
  min-width: 31px;
  height: 31px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #526a83;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 9px;
}
.editor-toolbar button:hover { color: #063f82; background: #e8f1fa; }
.editor-mode-switch { padding: 2px; background: #e9eef3; border-radius: 7px; }
.editor-mode-switch button { min-width: 62px; }
.editor-mode-switch button.active { color: #fff; background: #164f89; box-shadow: 0 2px 6px rgba(4, 49, 98, .17); }
.editor-insert-panel {
  padding: 11px 12px;
  display: grid;
  grid-template-columns: minmax(150px, .8fr) minmax(220px, 1.2fr) auto;
  align-items: end;
  gap: 8px;
  background: #f1f6fb;
  border-bottom: 1px solid #d9e3ed;
}
.editor-insert-head { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; }
.editor-insert-head strong { color: #294b6e; font-size: 11px; }
.editor-insert-head button { width: 27px; height: 27px; display: grid; place-items: center; color: #6f8194; background: transparent; border-radius: 5px; cursor: pointer; }
.editor-insert-panel label { display: flex; flex-direction: column; gap: 4px; }
.editor-insert-panel label span { color: #62758a; font-size: 9px; font-weight: 650; }
.editor-insert-panel input {
  width: 100%;
  height: 36px;
  padding: 0 9px;
  color: #28425d;
  background: #fff;
  border: 1px solid #c5d2df;
  border-radius: 6px;
  outline: 0;
  font-size: 10px;
}
.editor-insert-panel input:focus { border-color: #7399c0; box-shadow: 0 0 0 2px rgba(0, 63, 135, .07); }
.editor-insert-panel > p { grid-column: 1 / -1; color: #a23c3c; font-size: 9px; }
.editor-insert-panel > p.upload-notice { color: #17634f; }
.image-upload-row {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 9px;
}
.image-file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
.image-upload-button {
  min-height: 34px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #07518f;
  background: #fff;
  border: 1px solid #b8cce0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
}
.image-upload-button:disabled { opacity: .58; cursor: wait; }
.image-upload-row small { color: #7f8d9d; font-size: 9px; }
.insert-confirm {
  height: 36px;
  padding: 0 12px;
  color: #fff;
  background: #064585;
  border-radius: 6px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
}
textarea {
  width: 100%;
  min-height: 280px;
  padding: 15px 16px;
  display: block;
  resize: vertical;
  color: #253c55;
  background: #fff;
  border: 0;
  border-radius: 0;
  outline: 0;
  font: 12px/1.8 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  tab-size: 2;
}
textarea::placeholder { color: #a2adba; }
.markdown-preview {
  min-height: 280px;
  padding: 18px 20px;
  color: #334a61;
  background: #fff;
  font-size: 12px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.markdown-preview-empty { display: grid; place-items: center; color: #9aa6b3; }
.markdown-preview :deep(h1), .markdown-preview :deep(h2), .markdown-preview :deep(h3) { color: #183b61; line-height: 1.4; }
.markdown-preview :deep(h1) { margin: 0 0 15px; font-size: 22px; }
.markdown-preview :deep(h2) { margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e4eaf0; font-size: 18px; }
.markdown-preview :deep(h3) { margin: 17px 0 8px; font-size: 15px; }
.markdown-preview > :deep(h2:first-child), .markdown-preview > :deep(h3:first-child) { margin-top: 0; }
.markdown-preview :deep(p) { margin: 0 0 12px; white-space: pre-wrap; }
.markdown-preview :deep(blockquote) { margin: 12px 0; padding: 8px 13px; color: #526b83; background: #f4f7fa; border-left: 3px solid #8ba9c8; white-space: pre-wrap; }
.markdown-preview :deep(ul), .markdown-preview :deep(ol) { margin: 10px 0 14px; padding-left: 24px; }
.markdown-preview :deep(li + li) { margin-top: 5px; }
.markdown-preview :deep(a) { color: #075ca8; text-decoration: underline; text-underline-offset: 2px; }
.markdown-preview :deep(img) { max-width: 100%; height: auto; margin: 13px auto; border-radius: 8px; box-shadow: 0 5px 18px rgba(13, 47, 82, .1); }
.markdown-preview :deep(code) { padding: 2px 4px; color: #81421d; background: #fff2e9; border-radius: 4px; font-size: .92em; }
.markdown-preview :deep(pre) { margin: 12px 0; padding: 13px; overflow-x: auto; color: #dfeaf6; background: #14283e; border-radius: 8px; }
.markdown-preview :deep(pre code) { padding: 0; color: inherit; background: transparent; }
.editor-status {
  min-height: 33px;
  padding: 7px 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #8a97a6;
  background: #fafbfd;
  border-top: 1px solid #e4e9ef;
  font-size: 9px;
}
.editor-status .limit { color: #a36b16; font-weight: 700; }
.editor-validation { padding: 8px 11px; color: #9e3636; background: #fff0f0; border-top: 1px solid #edcece; font-size: 9px; }
.structured-editor-readonly { border-color: #e0e6ed; }
.structured-editor-readonly .markdown-preview { min-height: 0; padding: 4px 0; background: transparent; }

@media (max-width: 760px) {
  .editor-toolbar { align-items: stretch; flex-direction: column; }
  .editor-tools { flex-wrap: wrap; }
  .editor-mode-switch { width: 100%; }
  .editor-mode-switch button { flex: 1; }
  .editor-insert-panel { grid-template-columns: 1fr; }
  .editor-insert-panel > div, .editor-insert-panel > p { grid-column: auto; }
  .insert-confirm { width: 100%; }
  .draft-recovery { align-items: flex-start; flex-wrap: wrap; }
  .draft-recovery p { width: calc(100% - 30px); flex: none; }
  textarea, .markdown-preview { min-height: 230px; }
}
</style>
