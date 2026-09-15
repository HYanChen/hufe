<template>
  <view class="page-shell discussion-page">
    <view class="discussion-heading"><text>HUFE COMMUNITY</text><text class="discussion-title">动态与评论</text></view>
    <view v-if="!verified" class="discussion-card"><text>登录已实名认证的平台账号后查看与参与讨论。</text><button class="primary-button" @tap="login">登录 / 实名认证</button></view>
    <template v-else>
      <view v-if="post" class="discussion-card"><view class="discussion-identity"><CommunityAvatar :anonymous="post.anonymous === true" :avatar="post.avatar || ''" :initials="post.initials || (post.authorName || '湖财').slice(-2)" /><view><text class="discussion-author">{{ post.authorName || '湖财人' }}</text><text v-if="post.anonymous" class="discussion-anonymous-badge">匿名发布</text></view></view><CommunityPostBody :post="post" /></view>
      <view v-if="error" class="discussion-card"><text>{{ error }}</text><button class="secondary-button" @tap="reload">重新加载</button></view>
      <view v-if="post" class="discussion-card">
        <text class="discussion-author">参与讨论</text><textarea v-model="draft" maxlength="500" placeholder="请友善交流，勿公开个人隐私（2–500 字）" :disabled="posting" />
        <view class="discussion-anonymous"><view><text>{{ anonymous ? '匿名评论' : '实名评论' }}</text><text>{{ anonymous ? '随机昵称与头像' : '将展示你的实名姓名，可开启匿名后提交。' }}</text></view><switch :checked="anonymous" :disabled="posting" color="#124789" aria-label="匿名评论" @change="anonymous = $event.detail.value" /></view>
        <view class="discussion-tools"><text>{{ draft.length }}/500</text><button class="primary-button" :disabled="posting || draft.trim().length < 2" @tap="submit">{{ posting ? '提交中…' : '提交评论' }}</button></view>
        <text v-if="actionError" class="discussion-error">{{ actionError }}</text>
      </view>
      <view v-for="item in items" :key="item.id" class="discussion-card">
        <view class="discussion-tools"><view class="discussion-identity"><CommunityAvatar :anonymous="item.anonymous === true" :avatar="item.avatar || ''" :initials="(item.authorName || '湖财').slice(-2)" /><view><text class="discussion-author">{{ item.authorName }}</text><text v-if="item.anonymous" class="discussion-anonymous-badge">匿名评论{{ item.mine ? ' · 我' : '' }}</text></view></view><text class="discussion-meta">{{ time(item.createdAt) }}</text></view>
        <text v-if="item.mine && !['approved','published','completed'].includes(item.status)" class="discussion-status">{{ item.status === 'rejected' ? '审核未通过 · 仅自己可见' : '等待审核 · 仅自己可见' }}</text>
        <text class="discussion-content">{{ item.content }}</text>
        <text v-if="item.reply" class="discussion-reply">管理回复：{{ item.reply }}</text>
        <button v-if="item.mine && !['completed','closed','rejected','cancelled'].includes(item.status)" class="secondary-button discussion-withdraw" :disabled="posting" @tap="withdraw(item)">撤回评论</button>
      </view>
      <view v-if="loading" class="discussion-empty">正在加载…</view>
      <view v-else-if="post && !items.length && !error" class="discussion-empty">暂无公开评论，欢迎参与讨论。</view>
      <button v-if="items.length < total && !loading" class="secondary-button" @tap="loadMore">加载更多评论</button>
    </template>
    <SupportFooter />
  </view>
</template>

<script>
import { getBusinessDetail, getCommunityComments, submitCommunityComment, withdrawCommunityComment } from '../../services/business'
import { getAccessToken, getUser, isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'
import CommunityPostBody from '../../components/CommunityPostBody.vue'
import CommunityAvatar from '../../components/CommunityAvatar.vue'

export default {
  components: { CommunityPostBody, CommunityAvatar },
  data() { return { postId: '', post: null, verified: false, anonymous: false, items: [], total: 0, page: 0, draft: '', owner: '', loading: false, posting: false, error: '', actionError: '', version: 0 } },
  onLoad(options = {}) { this.postId = String(options.id || ''); uni.$on('hufe-auth-changed', this.reload) },
  onShow() { this.reload() },
  onHide() { this.clear() },
  onUnload() { this.clear(); this.draft = ''; this.anonymous = false; uni.$off('hufe-auth-changed', this.reload) },
  onPullDownRefresh() { this.reload().finally(() => uni.stopPullDownRefresh()) },
  onShareAppMessage() { return { title: '湖财圈 · 动态与评论', path: `/pages/community-comments/index?id=${encodeURIComponent(this.postId)}` } },
  methods: {
    login() { openPage('/pages/verify/index') },
    time(value) { return String(value || '').replace('T', ' ').slice(0, 16) },
    clear() { this.version++; this.post = null; this.items = []; this.total = 0; this.page = 0; this.loading = false; this.posting = false },
    async reload() {
      this.clear(); this.error = ''; this.actionError = ''
      this.verified = isVerified() && Boolean(getAccessToken())
      const owner = getUser().id || ''
      if (!this.verified || owner !== this.owner) { this.draft = ''; this.anonymous = false }
      this.owner = owner
      if (!this.verified) return
      if (!this.postId) { this.error = '缺少动态编号，请返回湖财圈重新进入。'; return }
      const version = this.version; const token = getAccessToken()
      this.loading = true
      try {
        const post = await getBusinessDetail('community-posts', this.postId)
        if (version !== this.version || token !== getAccessToken()) return
        this.post = post; this.loading = false
        await this.loadMore()
      } catch (error) {
        if (version !== this.version || token !== getAccessToken()) return
        if ([401, 403].includes(error.statusCode)) { this.clear(); this.verified = false; this.draft = '' }
        else this.error = error.message || '动态加载失败'
      } finally { if (version === this.version) this.loading = false }
    },
    async loadMore() {
      if (this.loading || !this.verified || !this.post) return
      const version = this.version; const token = getAccessToken()
      this.loading = true; this.error = ''
      try {
        const result = await getCommunityComments(this.postId, { page: this.page + 1, pageSize: 20 })
        if (version !== this.version || token !== getAccessToken()) return
        this.items = [...new Map([...this.items, ...result.items].map((item) => [item.id, item])).values()]
        this.total = result.total; this.page++
      } catch (error) {
        if (version !== this.version || token !== getAccessToken()) return
        if ([401, 403].includes(error.statusCode)) { this.clear(); this.verified = false; this.draft = '' }
        else this.error = error.message || '评论加载失败'
      } finally { if (version === this.version) this.loading = false }
    },
    async submit() {
      if (this.posting || !this.verified || this.draft.trim().length < 2) return
      await this.mutate(() => submitCommunityComment(this.postId, this.draft.trim(), { anonymous: this.anonymous }), true)
    },
    withdraw(item) {
      uni.showModal({ title: '撤回评论', content: '撤回后其他用户将无法看到这条评论。', success: (result) => {
        if (result.confirm && !this.posting) this.mutate(() => withdrawCommunityComment(item.id))
      } })
    },
    async mutate(action, resetDraft = false) {
      const version = this.version; const token = getAccessToken()
      this.posting = true; this.actionError = ''
      try {
        await action()
        if (version !== this.version || token !== getAccessToken()) return
        if (resetDraft) this.draft = ''
        await this.reload()
      } catch (error) {
        if (version !== this.version || token !== getAccessToken()) return
        if ([401, 403].includes(error.statusCode)) { this.clear(); this.verified = false; this.draft = '' }
        else this.actionError = error.message || '操作失败，请重试'
      } finally { if (version === this.version) this.posting = false }
    }
  }
}
</script>

<style scoped>
.discussion-identity{display:flex;align-items:center;gap:10px;min-width:0;flex:1}.discussion-identity>view:last-child{min-width:0}.discussion-anonymous-badge{display:block;margin-top:4px;font-size:12px;color:#728299}.discussion-anonymous{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px;background:#f2f6fc;border-radius:12px;margin-bottom:16px}.discussion-anonymous>view{flex:1;min-width:0}.discussion-anonymous text{display:block;color:#24466f;font-size:14px}.discussion-anonymous text+text{font-size:12px;line-height:1.6;color:#74849a;margin-top:4px}.discussion-anonymous switch{flex-shrink:0}
.discussion-page{width:100%;max-width:960px;margin:0 auto;padding:20px 16px 40px;box-sizing:border-box}.discussion-heading{padding:25px;color:#fff;background:#063681;border-radius:22px}.discussion-heading>text{display:block;font-size:12px;letter-spacing:2px;color:#dec48f}.discussion-heading .discussion-title{margin-top:10px;font-size:26px;font-weight:700;letter-spacing:0;color:#fff}.discussion-card{margin-top:16px;padding:22px;border-radius:20px;background:#fff;overflow-wrap:anywhere}.discussion-author{font-size:16px;font-weight:600;color:#173653}.discussion-content{display:block;margin-top:14px;white-space:pre-wrap;font-size:16px;line-height:1.8}.discussion-card textarea{width:100%;height:120px;margin:16px 0;padding:12px;box-sizing:border-box;border-radius:12px;background:#f4f6fa;font-size:15px}.discussion-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.discussion-tools button{margin:0;padding:0 18px;font-size:15px}.discussion-meta,.discussion-tools>text{color:#7b8698;font-size:12px}.discussion-tools>.discussion-author{color:#173653;font-size:16px}.discussion-reply{display:block;padding:12px;margin-top:14px;background:#eef4fb;border-radius:10px;white-space:pre-wrap;font-size:14px;line-height:1.6}.discussion-status{display:block;margin-top:8px;color:#906f34;font-size:12px}.discussion-withdraw{margin:15px 0 0 auto;width:110px;font-size:13px}.discussion-empty{padding:30px;text-align:center;color:#788496;font-size:15px}.discussion-error{display:block;margin-top:12px;color:#a93737;font-size:14px}
</style>
