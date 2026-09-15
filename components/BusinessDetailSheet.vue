<template>
  <view v-if="open" class="detail-sheet-mask" @tap.self="$emit('close')">
    <view class="detail-sheet-panel" @tap.stop>
      <view class="detail-sheet-head">
        <view class="detail-sheet-head__copy">
          <text v-if="eyebrow" class="detail-sheet-eyebrow">{{ eyebrow }}</text>
          <text class="detail-sheet-title">{{ title }}</text>
          <text v-if="subtitle" class="detail-sheet-subtitle">{{ subtitle }}</text>
        </view>
        <view class="detail-sheet-close" aria-label="关闭详情" @tap="$emit('close')">×</view>
      </view>
      <scroll-view class="detail-sheet-scroll" scroll-y :show-scrollbar="false">
        <view class="detail-sheet-body"><slot /></view>
      </scroll-view>
      <view v-if="showActions" class="detail-sheet-actions"><slot name="actions" /></view>
    </view>
  </view>
</template>

<script>
export default {
  name: 'BusinessDetailSheet',
  props: {
    open: Boolean,
    title: { type: String, default: '详情' },
    subtitle: { type: String, default: '' },
    eyebrow: { type: String, default: '' },
    showActions: Boolean
  },
  emits: ['close']
}
</script>

<style scoped>
.detail-sheet-mask {
  position: fixed;
  z-index: 1000;
  inset: 0;
  padding: 32rpx 20rpx 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(12, 25, 45, .55);
}

.detail-sheet-panel {
  width: 100%;
  max-width: 710px;
  max-height: 88vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: 34rpx 34rpx 0 0;
  background: #FFFFFF;
  box-shadow: 0 -20rpx 60rpx rgba(12, 31, 61, .18);
}

.detail-sheet-head {
  padding: 28rpx 28rpx 22rpx;
  display: flex;
  align-items: flex-start;
  border-bottom: 1rpx solid #E9EDF3;
}

.detail-sheet-head__copy {
  min-width: 0;
  flex: 1;
}

.detail-sheet-eyebrow,
.detail-sheet-title,
.detail-sheet-subtitle {
  display: block;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.detail-sheet-eyebrow {
  color: #9A743A;
  font-size: 17rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
}

.detail-sheet-title {
  margin-top: 6rpx;
  color: #25334A;
  font-size: 32rpx;
  line-height: 1.45;
  font-weight: 700;
}

.detail-sheet-subtitle {
  margin-top: 7rpx;
  color: #8791A0;
  font-size: 20rpx;
  line-height: 1.55;
}

.detail-sheet-close {
  width: 58rpx;
  height: 58rpx;
  margin-left: 18rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18rpx;
  color: #647085;
  background: #F0F3F7;
  font-size: 38rpx;
  line-height: 1;
}

.detail-sheet-scroll {
  min-height: 260rpx;
  max-height: 68vh;
  flex: 1;
}

.detail-sheet-body {
  padding: 26rpx 28rpx 34rpx;
}

.detail-sheet-actions {
  padding: 18rpx 28rpx calc(18rpx + env(safe-area-inset-bottom));
  display: flex;
  gap: 16rpx;
  border-top: 1rpx solid #E9EDF3;
  background: #FFFFFF;
}

.detail-sheet-actions :deep(button) {
  min-width: 0;
  flex: 1;
  margin: 0;
}

@media screen and (min-width: 760px) {
  .detail-sheet-mask {
    padding: 40px;
    align-items: center;
  }

  .detail-sheet-panel {
    max-width: 680px;
    border-radius: 28rpx;
  }
}
</style>
