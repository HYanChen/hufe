<template>
  <view class="business-rich-text">
    <rich-text v-if="nodes.length" class="business-rich-text__content" :nodes="nodes" :selectable="true" />
    <text v-else-if="emptyText" class="business-rich-text__empty">{{ emptyText }}</text>
  </view>
</template>

<script>
import { markdownToNodes } from '../services/businessMarkdown'

export default {
  name: 'BusinessRichText',
  props: {
    content: { type: [String, Number], default: '' },
    emptyText: { type: String, default: '' }
  },
  computed: {
    nodes() {
      return markdownToNodes(this.content)
    }
  }
}
</script>

<style scoped>
.business-rich-text {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.business-rich-text__content {
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: #3D495E;
  font-size: 25rpx;
  line-height: 1.9;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.business-rich-text__empty {
  display: block;
  color: #929BA8;
  font-size: 23rpx;
  line-height: 1.7;
}

@media screen and (min-width: 768px) {
  .business-rich-text__content {
    font-size: 16px;
    line-height: 1.85;
  }

  .business-rich-text__empty {
    font-size: 15px;
  }
}

</style>
