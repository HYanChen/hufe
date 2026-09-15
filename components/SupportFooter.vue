<template>
  <view class="support-footer" role="contentinfo">
    <view class="support-footer__line"></view>
    <text class="support-footer__copyright">© 2026 湖南财政经济学院</text>
    <text class="support-footer__text">开发团队&技术支持：长沙宸古科技有限责任公司</text>
  </view>
</template>

<style scoped>
.support-footer {
  width: 100%;
  padding: 58rpx 8rpx 8rpx;
  text-align: center;
}

.support-footer__line {
  width: 48rpx;
  height: 2rpx;
  margin: 0 auto 18rpx;
  border-radius: 2rpx;
  background: rgba(3, 52, 129, .18);
}

.support-footer__copyright,
.support-footer__text {
  display: block;
  color: #929CAA;
  font-size: 18rpx;
  line-height: 1.65;
  word-break: break-all;
}

.support-footer__copyright {
  margin-bottom: 4rpx;
  color: #748297;
}

@media screen and (min-width: 800px) {
  .support-footer__copyright,
  .support-footer__text {
    font-size: 13px;
  }
}
</style>
