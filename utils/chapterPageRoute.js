export const chapterPageRoute = {
  data() { return { organizationId: '' } },
  onLoad(options = {}) { this.organizationId = String(options.id || '') },
  onShow() { const page = this.$refs.chapter; if (page) { page.active = true; page.loadHome() } },
  onHide() {
    const page = this.$refs.chapter
    if (!page) return
    page.active = false; page.clearMembers(); page.clearMessages(); page.activities = []; page.announcements = []; page.selectedNotice = null; page.homeVersion += 1; page.loading = false
  },
  onPullDownRefresh() { Promise.resolve(this.$refs.chapter?.loadHome()).finally(() => uni.stopPullDownRefresh()) },
  onShareAppMessage() {
    return { title: `${this.$refs.chapter?.organization?.name || '湖财校友组织'}｜组织主页`, path: `/pages/chapter-detail/index?id=${encodeURIComponent(this.organizationId)}` }
  }
}
