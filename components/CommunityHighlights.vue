<template>
  <view class="wall-highlights surface" role="region" aria-label="校园墙焦点轮播">
    <view class="wall-highlights__heading"><text>校园墙焦点</text><text class="wall-highlights__caption">置顶消息 · 热门动态</text></view>
    <swiper v-if="items.length" class="wall-highlights__swiper" :current="current" :autoplay="active && !paused && !selectedNotice && !opening && items.length > 1" :circular="items.length > 1" :interval="5000" :duration="350" @change="current = $event.detail.current">
      <swiper-item v-for="item in items" :key="item.kind + ':' + item.id">
        <button class="wall-highlight" :disabled="opening" @tap="openItem(item)">
          <view class="wall-highlight__tags"><text class="wall-highlight__badge" :class="'wall-highlight__badge--' + item.placement">{{ placementLabel(item.placement) }}</text><text>{{ item.kind === 'announcement' ? '公告' : '湖财圈' }}</text></view>
          <text class="wall-highlight__title">{{ item.title }}</text>
          <text class="wall-highlight__summary">{{ item.summary }}</text>
          <view class="wall-highlight__bottom"><text>{{ item.kind === 'post' ? item.likeCount + ' 赞 · ' + item.commentCount + ' 评论' : '以公告正文为准' }}</text><text class="wall-highlight__link">{{ opening ? '正在打开…' : '查看详情 ›' }}</text></view>
        </button>
      </swiper-item>
    </swiper>
    <view v-else class="wall-highlights__empty">
      <text>{{ loading ? '正在读取校园焦点…' : error ? '校园焦点暂时无法加载' : '暂时没有可展示的校园焦点' }}</text>
      <text v-if="!loading && !error">管理员置顶消息和热度前五的帖子会在这里轮播。</text>
      <button v-if="error" @tap="refresh">重新加载</button>
    </view>
    <view v-if="items.length" class="wall-highlights__controls">
      <view class="wall-highlights__dots" aria-hidden="true"><view v-for="(item, index) in items" :key="item.kind + ':' + item.id" :class="{ 'is-current': current === index }" /></view>
      <text>{{ current + 1 }} / {{ items.length }}</text>
      <template v-if="items.length > 1"><button aria-label="上一条焦点" @tap="step(-1)">‹</button><button @tap="paused = !paused">{{ paused ? '继续轮播' : '暂停轮播' }}</button><button aria-label="下一条焦点" @tap="step(1)">›</button></template>
    </view>
    <BusinessDetailSheet :open="Boolean(selectedNotice)" :title="selectedNotice ? selectedNotice.title : ''" :show-actions="Boolean(selectedNotice && selectedNotice.target)" eyebrow="CAMPUS NOTICE" @close="selectedNotice = null">
      <BusinessRichText v-if="selectedNotice" :content="selectedNotice.content || selectedNotice.summary" empty-text="暂无更多正文" />
      <template #actions><button v-if="selectedNotice && selectedNotice.target" class="primary-button" @tap="openNoticeTarget">查看相关事项</button></template>
    </BusinessDetailSheet>
  </view>
</template>

<script>
import { getCommunityHighlights, getBusinessDetail } from '../services/business'
import { getAccessToken } from '../utils/store'
import { openPage } from '../utils/nav'
import BusinessDetailSheet from './BusinessDetailSheet.vue'
import BusinessRichText from './BusinessRichText.vue'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  props: { active: { type: Boolean, default: true }, refreshKey: { type: Number, default: 0 } },
  data() { return { items: [], current: 0, paused: false, loading: false, error: '', selectedNotice: null, opening: false, version: 0, detailVersion: 0 } },
  watch: {
    active(value) { if (value) this.refresh(); else this.clear() },
    refreshKey() { if (this.active) this.refresh() }
  },
  mounted() { uni.$on('hufe-auth-changed', this.accountChanged); if (this.active) this.refresh() },
  beforeUnmount() { this.clear(); uni.$off('hufe-auth-changed', this.accountChanged) },
  methods: {
    placementLabel(value) { return ({ pinned: '管理员置顶', hot: '热门帖子' })[value] || '校园动态' },
    clear() { this.version++; this.detailVersion++; this.items = []; this.current = 0; this.loading = false; this.opening = false; this.selectedNotice = null; this.error = '' },
    accountChanged() { this.clear(); if (this.active) this.refresh() },
    step(delta) { this.paused = true; this.current = (this.current + delta + this.items.length) % this.items.length },
    async openNoticeTarget() {
      if (!this.selectedNotice || this.opening) return
      const id = this.selectedNotice.id, version = ++this.detailVersion, token = getAccessToken()
      this.opening = true
      try {
        const detail = await getBusinessDetail('announcements', id)
        if (version !== this.detailVersion || token !== getAccessToken() || !this.active) return
        this.selectedNotice = null
        if (detail.target) openPage(detail.target)
      } catch (error) {
        if (version === this.detailVersion && token === getAccessToken()) { this.selectedNotice = null; uni.showToast({ title: error.message || '公告已失效', icon: 'none' }); this.refresh() }
      } finally { if (version === this.detailVersion) this.opening = false }
    },
    async refresh() {
      const version = ++this.version, token = getAccessToken()
      this.loading = true; this.error = ''
      try {
        const result = await getCommunityHighlights()
        if (version !== this.version || token !== getAccessToken() || !this.active) return
        this.items = (result.items || []).filter(item=>['pinned','hot'].includes(item.placement)); this.current = 0
      } catch (error) {
        if (version === this.version && token === getAccessToken()) { this.items = []; this.current = 0; this.error = error.message || '暂时无法读取' }
      } finally { if (version === this.version) this.loading = false }
    },
    async openItem(item) {
      if (this.opening) return
      const version = ++this.detailVersion, token = getAccessToken()
      this.opening = true
      try {
        // Recheck live visibility, including announcement expiry and administrator takedowns.
        const detail = await getBusinessDetail(item.kind === 'announcement' ? 'announcements' : 'community-posts', item.id)
        if (version !== this.detailVersion || token !== getAccessToken() || !this.active) return
        if (item.kind === 'announcement') this.selectedNotice = detail
        else openPage(`/pages/community-comments/index?id=${encodeURIComponent(item.id)}`)
      } catch (error) {
        if (version === this.detailVersion && token === getAccessToken()) { uni.showToast({ title: error.message || '内容已失效，请刷新', icon: 'none' }); this.refresh() }
      } finally { if (version === this.detailVersion) this.opening = false }
    }
  }
}
</script>

<style scoped>
.wall-highlights{margin:18px auto 0;padding:18px 18px 10px;max-width:860px;box-sizing:border-box;border:1px solid #e4eaf3;border-radius:20px;background:#fff;overflow:hidden}
.wall-highlights__heading{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:16px;font-weight:700;color:#132d50}.wall-highlights__caption{font-size:11px;font-weight:400;color:#8290a4}
.wall-highlights__swiper{height:173px;margin-top:14px}.wall-highlight{display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:100%;margin:0;padding:0;background:transparent;border:0;border-radius:0;text-align:left;line-height:1.5;white-space:normal;color:#1c3453}.wall-highlight::after,.wall-highlights__controls button::after,.wall-highlights__empty button::after{border:0}
.wall-highlight__tags{display:flex;align-items:center;gap:10px;font-size:11px;color:#8390a1}.wall-highlight__badge{padding:3px 8px;border-radius:5px;font-weight:600;color:#23569b;background:#eaf1fc}.wall-highlight__badge--pinned{color:#856027;background:#f6edda}.wall-highlight__badge--hot{color:#a34238;background:#fbece9}
.wall-highlight__title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;margin-top:10px;font-size:18px;font-weight:700;line-height:1.5;max-height:54px}.wall-highlight__summary{display:block;max-width:100%;margin-top:7px;font-size:12px;color:#7e8b9e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wall-highlight__bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;margin-top:auto;padding-bottom:8px;font-size:11px;color:#8a96a7}.wall-highlight__link{color:#174985;font-size:12px;font-weight:600}
.wall-highlights__controls{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-height:32px;border-top:1px solid #edf1f6;font-size:11px;color:#8a96a7}.wall-highlights__controls button{display:block;min-width:28px;height:30px;padding:0 4px;margin:0;line-height:30px;background:transparent;color:#526b8c;font-size:11px}.wall-highlights__controls button:first-of-type,.wall-highlights__controls button:last-of-type{font-size:22px}.wall-highlights__dots{display:flex;gap:4px;margin-right:auto}.wall-highlights__dots view{width:4px;height:4px;border-radius:5px;background:#dae2ed}.wall-highlights__dots .is-current{width:16px;background:#174985}
.wall-highlights__empty{display:flex;flex-direction:column;justify-content:center;gap:8px;min-height:118px;color:#6d7e94;font-size:14px;line-height:1.6}.wall-highlights__empty text+text{font-size:12px;color:#8a96a7}.wall-highlights__empty button{margin:0 auto 0 0;padding:4px 14px;line-height:24px;color:#174985;background:#eaf1fc;font-size:12px}
@media(min-width:961px){.wall-highlights{padding:22px 26px 12px}.wall-highlight__title{font-size:21px;max-height:63px}.wall-highlights__caption{font-size:12px}}
</style>
