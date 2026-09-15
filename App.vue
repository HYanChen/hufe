<script>
import { refreshPlatformProfile } from './services/schoolAuth'
import { syncStoredSession } from './utils/store'
import { appConfig } from './config/index'
import { enforceInitialPasswordChange } from './utils/passwordChange'
import {refreshModuleConfig} from './services/modules'
import {guardModulePage,updateModuleTabs} from './utils/moduleNavigation'

export default {
  data() { return { authBootstrapping: false, authHeartbeat:null } },
  onLaunch() {
    this.startAuthHeartbeat()
    // #ifdef H5
    window.addEventListener('storage', this.onAuthStorage)
    window.addEventListener('hashchange', this.guardInitialPassword)
    // #endif
  },
  onShow() { this.startAuthHeartbeat() },
  onHide() { clearInterval(this.authHeartbeat); this.authHeartbeat = null },
  beforeUnmount() {
    clearInterval(this.authHeartbeat)
    // #ifdef H5
    window.removeEventListener('storage', this.onAuthStorage)
    window.removeEventListener('hashchange', this.guardInitialPassword)
    // #endif
  },
  methods: {
    guardInitialPassword() { enforceInitialPasswordChange(); guardModulePage(); updateModuleTabs() },
    startAuthHeartbeat() { clearInterval(this.authHeartbeat); this.bootstrapAuth(); this.refreshModules(); this.authHeartbeat = setInterval(() => {this.bootstrapAuth();this.refreshModules()}, 15000) },
    async refreshModules(){await refreshModuleConfig();guardModulePage();updateModuleTabs()},
    onAuthStorage(event) { if (event.key === appConfig.authStorageKey || event.key === null) { syncStoredSession(); this.bootstrapAuth() } },
    async bootstrapAuth() {
      if (this.authBootstrapping) return
      this.authBootstrapping = true
      try {
        await refreshPlatformProfile()
        enforceInitialPasswordChange()
      } catch (error) {
        // 网络不可用时不把持久化缓存当作可信实名资料，由用户在平台登录页主动重试。
      } finally { this.authBootstrapping = false }
    }
  }
}
</script>

<style>
.uni-tabbar__item[data-hufe-module-hidden] {display:none !important;}
/* The desktop chat entry is the global floating dock; phones keep the centre tab. */
@media screen and (min-width: 1024px) and (pointer: fine) {
  .uni-tabbar__item[data-hufe-chat-tab] { display: none !important; }
}

page {
  --hufe-page-gutter: 28rpx;
  --hufe-content-bottom: 48rpx;
  --hufe-tabbar-height: 58px;
  --hufe-safe-bottom: env(safe-area-inset-bottom);
  --hufe-content-max: 750px;
  min-height: 100%;
  overflow-x: hidden;
  background: #F4F6FA;
  color: #17233B;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 28rpx;
}

view,
text,
scroll-view,
swiper,
swiper-item,
button,
input,
textarea,
picker {
  box-sizing: border-box;
}

button {
  font-family: inherit;
}

button::after {
  border: none;
}

.page-shell {
  width: 100%;
  min-height: 100vh;
  padding: 24rpx var(--hufe-page-gutter) calc(var(--hufe-content-bottom) + var(--hufe-safe-bottom));
  max-width: var(--hufe-content-max);
  margin: 0 auto;
}

.page-shell--tab {
  padding-bottom: calc(42rpx + var(--hufe-safe-bottom));
}

.surface {
  background: #FFFFFF;
  border: 1rpx solid rgba(11, 58, 130, 0.06);
  border-radius: 28rpx;
  box-shadow: 0 14rpx 40rpx rgba(20, 45, 86, 0.07);
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20rpx;
  margin: 42rpx 4rpx 22rpx;
}

.section-head > view {
  min-width: 0;
  flex: 1;
}

.section-title {
  display: block;
  font-size: 34rpx;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 1rpx;
}

.section-kicker {
  display: block;
  margin-top: 8rpx;
  color: #8A93A4;
  font-size: 22rpx;
  letter-spacing: 2rpx;
  line-height: 1.35;
}

.section-more {
  flex-shrink: 0;
  color: #52627D;
  font-size: 24rpx;
  white-space: nowrap;
}

.primary-button,
.secondary-button {
  height: 88rpx;
  border-radius: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 88rpx;
}

.primary-button {
  color: #FFFFFF;
  background: linear-gradient(135deg, #033481 0%, #164F9D 100%);
  box-shadow: 0 12rpx 26rpx rgba(11, 58, 130, 0.22);
}

.secondary-button {
  color: #033481;
  background: #EAF0FA;
}

.ghost-button {
  height: 74rpx;
  border: 1rpx solid #DDE3EC;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #56647A;
  background: #FFFFFF;
  font-size: 24rpx;
}

.badge {
  display: inline-flex;
  align-items: center;
  min-height: 42rpx;
  padding: 0 18rpx;
  border-radius: 99rpx;
  color: #7A5A25;
  background: #F7E9CC;
  font-size: 20rpx;
  font-weight: 600;
}

.muted {
  color: #8892A3;
}

.divider {
  height: 1rpx;
  background: #EDF0F5;
}

.empty-state {
  padding: 88rpx 32rpx;
  text-align: center;
  color: #8A93A4;
}

.empty-state__icon {
  width: 84rpx;
  height: 84rpx;
  margin: 0 auto 20rpx;
  border-radius: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #B18A4F;
  background: #F7EBD6;
  font-size: 40rpx;
}

.form-card {
  padding: 0 28rpx;
}

.form-row {
  min-height: 106rpx;
  padding: 22rpx 0;
  display: flex;
  align-items: center;
  border-bottom: 1rpx solid #EDF0F4;
}

.form-row:last-child {
  border-bottom: none;
}

.form-label {
  width: 174rpx;
  color: #4B576A;
  font-size: 25rpx;
  font-weight: 600;
}

.form-control {
  flex: 1;
  color: #202C40;
  font-size: 25rpx;
  text-align: right;
}

.form-placeholder {
  color: #AFB5BF;
}

.sticky-action {
  position: fixed;
  z-index: 50;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 18rpx var(--hufe-page-gutter) calc(18rpx + var(--hufe-safe-bottom));
  background: rgba(255, 255, 255, 0.96);
  border-top: 1rpx solid rgba(15, 48, 94, 0.08);
  box-shadow: 0 -12rpx 34rpx rgba(20, 42, 77, 0.06);
}

.with-sticky-action {
  padding-bottom: calc(142rpx + var(--hufe-safe-bottom));
}

@media screen and (max-width: 360px) {
  page {
    --hufe-page-gutter: 22rpx;
    --hufe-content-bottom: 38rpx;
  }

  .section-head {
    gap: 14rpx;
  }

  .section-title {
    font-size: 31rpx;
  }

  .section-kicker {
    font-size: 19rpx;
  }
}

@media screen and (min-width: 768px) {
  page {
    --hufe-content-max: 1200px;
    --hufe-page-gutter: 32px;
    --hufe-content-bottom: 56px;
  }

  .page-shell {
    max-width: 1200px;
    padding-top: 28px;
  }

  .uni-tabbar-bottom {
    left: 50% !important;
    width: 1200px !important;
    max-width: 100% !important;
    transform: translateX(-50%);
    border-radius: 24px 24px 0 0;
    box-shadow: 0 -8px 28px rgba(20, 45, 86, 0.08);
  }
}

@media screen and (min-width: 1200px) {
  page {
    --hufe-content-max: 1440px;
    --hufe-page-gutter: 48px;
    --hufe-content-bottom: 72px;
  }

  .page-shell {
    max-width: 1440px;
    padding-top: 40px;
  }

  .uni-app--showtabbar .uni-page-head {
    display: none !important;
  }

  .uni-app--showtabbar uni-page-wrapper {
    top: 76px !important;
    bottom: 0 !important;
    height: calc(100% - 76px) !important;
  }

  .uni-app--showtabbar .uni-tabbar-bottom {
    z-index: 999 !important;
    top: 0 !important;
    bottom: auto !important;
    left: 50% !important;
    width: 1440px !important;
    height: 76px !important;
    max-width: calc(100% - 64px) !important;
    overflow: hidden;
    transform: translateX(-50%);
    border-radius: 0 0 24px 24px;
    background: rgba(255, 255, 255, 0.97);
    box-shadow: 0 10px 34px rgba(20, 45, 86, 0.11);
    backdrop-filter: blur(18px);
  }

  .uni-app--showtabbar .uni-tabbar-bottom .uni-placeholder {
    display: none !important;
  }

  .uni-app--showtabbar .uni-tabbar {
    height: 76px !important;
    padding: 0 34px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    background: transparent !important;
  }

  .uni-app--showtabbar .uni-tabbar::before {
    content: "湖财人 · HUFE ALUMNI";
    margin-right: auto;
    color: #12365f;
    font-family: Georgia, "PingFang SC", serif;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 1px;
  }

  .uni-app--showtabbar .uni-tabbar__item {
    max-width: 130px;
    flex: 0 0 130px !important;
  }

  .uni-app--showtabbar .uni-tabbar__bd {
    flex-direction: row !important;
    justify-content: center;
  }

  .uni-app--showtabbar .uni-tabbar__icon {
    width: 24px !important;
    height: 24px !important;
    margin: 0 9px 0 0 !important;
  }

  .uni-app--showtabbar .uni-tabbar__label {
    margin: 0 !important;
    font-size: 15px !important;
  }
}
</style>
