<template>
  <view class="secure-material-picker">
    <view class="secure-material-picker__head">
      <view><text>{{ title }}</text><text>{{ hint }}</text></view>
      <button class="secondary-button" :disabled="choosing || modelValue.length >= maximum" @tap="choose">
        {{ choosing ? '读取中…' : `选择图片（${modelValue.length}/${maximum}）` }}
      </button>
    </view>
    <view v-if="modelValue.length" class="secure-material-grid">
      <view v-for="(material,index) in modelValue" :key="material.localPath" class="secure-material">
        <image :src="material.localPath" mode="aspectFill" />
        <text>{{ material.label || '证明材料' }}</text>
        <text @tap="remove(index)">移除</text>
      </view>
    </view>
    <view class="secure-material-policy">
      <text>护</text>
      <text>图片只在本机临时预览，提交后进入受保护材料存储；不会进入企业馆公开图片库。</text>
    </view>
  </view>
</template>

<script>
import { choosePrivateImageMaterials } from '../services/privateMaterials'

export default {
  props: {
    modelValue: { type: Array, default: () => [] },
    maximum: { type: Number, default: 4 },
    materialType: { type: String, default: 'business_license' },
    materialLabel: { type: String, default: '企业证明材料' },
    title: { type: String, default: '企业证明材料 *' },
    hint: { type: String, default: '最多 4 张，每张不超过 500MB' }
  },
  emits: ['update:modelValue'],
  data() { return { choosing: false } },
  methods: {
    async choose() {
      const remaining = this.maximum - this.modelValue.length
      if (this.choosing || remaining <= 0) return
      this.choosing = true
      try {
        const next = await choosePrivateImageMaterials({
          count: remaining,
          materialType: this.materialType,
          label: this.materialLabel
        })
        if (next.length) this.$emit('update:modelValue', [...this.modelValue, ...next].slice(0, this.maximum))
      } catch (error) {
        uni.showModal({ title: '材料读取失败', content: error.message || '请重新选择图片', showCancel: false })
      } finally {
        this.choosing = false
      }
    },
    remove(index) {
      const next = [...this.modelValue]
      next.splice(index, 1)
      this.$emit('update:modelValue', next)
    }
  }
}
</script>

<style scoped>
.secure-material-picker__head{display:flex;align-items:center;justify-content:space-between;gap:18rpx}.secure-material-picker__head>view{min-width:0;flex:1}.secure-material-picker__head text{display:block}.secure-material-picker__head text:first-child{color:#455368;font-size:23rpx;font-weight:650}.secure-material-picker__head text:last-child{margin-top:5rpx;color:#929caa;font-size:17rpx}.secure-material-picker__head button{width:250rpx;height:66rpx;margin:0;flex-shrink:0;border-radius:18rpx;font-size:19rpx;line-height:66rpx}.secure-material-grid{margin-top:18rpx;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12rpx}.secure-material{position:relative;overflow:hidden;border:1rpx solid #e1e7ee;border-radius:20rpx;background:#f7f9fb}.secure-material image{width:100%;height:180rpx}.secure-material>text:nth-child(2){display:block;padding:11rpx 72rpx 11rpx 12rpx;overflow:hidden;color:#56667b;font-size:16rpx;text-overflow:ellipsis;white-space:nowrap}.secure-material>text:last-child{position:absolute;right:10rpx;bottom:10rpx;color:#994742;font-size:16rpx}.secure-material-policy{margin-top:17rpx;padding:15rpx 17rpx;display:flex;align-items:flex-start;border-radius:17rpx;color:#7b7266;background:#f6f1e8;font-size:17rpx;line-height:1.55}.secure-material-policy text:first-child{width:35rpx;height:35rpx;margin-right:10rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:12rpx;color:#805d28;background:#e8d4ad;font-size:14rpx;font-weight:700}
@media screen and (min-width:768px){.secure-material-picker__head text:first-child{font-size:16px}.secure-material-picker__head text:last-child{font-size:13px}.secure-material-picker__head button{width:190px;height:48px;font-size:14px;line-height:48px}.secure-material-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.secure-material image{height:140px}.secure-material-policy{font-size:13px}}
@media screen and (max-width:360px){.secure-material-picker__head{align-items:stretch;flex-direction:column}.secure-material-picker__head button{width:100%}.secure-material-grid{grid-template-columns:1fr}}
</style>
