<template>
  <view v-if="article" class="page-shell news-detail-page">
    <view class="article-hero" :class="`article-hero--${article.tone}`">
      <view class="article-hero__orbit article-hero__orbit--one"></view>
      <view class="article-hero__orbit article-hero__orbit--two"></view>
      <view class="article-hero__topline">
        <text class="article-category">{{ article.category }}</text>
        <text class="article-date">{{ article.publishedAt || article.date }}</text>
      </view>
      <text class="article-title">{{ article.title }}</text>
      <text class="article-summary">{{ article.summary }}</text>
      <view class="article-hero__footer"><text>{{ article.sourceName || '湖南财政经济学院官网' }}</text><text>HUFE OFFICIAL</text></view>
    </view>

    <view class="article-card surface">
      <view v-if="article.summary" class="article-lead">
        <text class="article-lead__mark">“</text>
        <text>{{ article.summary }}</text>
      </view>
      <view class="article-body">
        <rich-text v-if="article.contentHtml" class="official-richtext" :nodes="richNodes" :selectable="true" />
        <text v-for="(paragraph, index) in paragraphs" v-else :key="index" class="article-paragraph">{{ paragraph }}</text>
      </view>
      <view v-if="article.attachments && article.attachments.length" class="attachment-list">
        <text class="attachment-list__title">附件</text>
        <view v-for="attachment in article.attachments" :key="attachment.url" class="attachment-item" @tap="openExternal(attachment.url)"><text>{{ attachment.title }}</text><text>打开 ›</text></view>
      </view>
      <view class="article-signature">
        <view></view>
        <text>来源：{{ article.sourceName || '湖南财政经济学院官网' }}</text>
        <text v-if="article.sourceSection">栏目：{{ article.sourceSection }}</text>
      </view>
    </view>

    <view class="article-actions">
      <button v-if="article.sourceUrl" class="article-action" @tap="openExternal(article.sourceUrl)">
        <text>官</text><text>查看官网原文</text>
      </button>
      <button class="article-action" open-type="share" @tap="share"><text>↗</text><text>分享给湖财人</text></button>
    </view>

    <view class="source-note" @tap="article.sourceUrl && openExternal(article.sourceUrl)">
      <view class="source-note__icon">i</view>
      <text>{{ article.official ? '本页内容由服务端从学校官网同步并安全清洗。点击可打开官网原文核对。' : '官网内容暂时无法读取，本页未使用本地模拟内容替代。' }}</text>
    </view>

    <view v-if="relatedNews.length" class="section-head"><view><text class="section-title">更多湖财新鲜事</text><text class="section-kicker">KEEP READING</text></view></view>
    <view v-if="relatedNews.length" class="related-list surface">
      <view v-for="(item, index) in relatedNews" :key="item.id" class="related-item" :class="{ 'related-item--border': index !== relatedNews.length - 1 }" @tap="openNews(item.id)">
        <view class="related-thumb" :class="`related-thumb--${item.tone}`"><text>湖财</text></view>
        <view class="related-item__body"><text class="related-item__meta">{{ item.category }} · {{ item.date }}</text><text class="related-item__title">{{ item.title }}</text><text class="related-item__summary">{{ item.summary }}</text></view>
        <text class="related-item__arrow">›</text>
      </view>
    </view>
    <SupportFooter />
  </view>
</template>

<script>
import { sharePage } from '../../utils/share'
import { formatOfficialItem, getOfficialContent, getOfficialContentDetail } from '../../services/content'
import { normalizeOfficialHtml } from '../../services/richText'

export default {
  data() {
    return { articleId: '', article: null, officialRequested: false, relatedItems: [] }
  },
  computed: {
    relatedNews() {
      return this.relatedItems
    },
    paragraphs() {
      if (Array.isArray(this.article?.content)) return this.article.content
      return String(this.article?.contentText || this.article?.summary || '').split(/\n+/).filter(Boolean)
    },
    richNodes() {
      return normalizeOfficialHtml(this.article?.contentHtml || '')
    }
  },
  onLoad(options) {
    this.articleId = options.id || ''
    this.officialRequested = true
    this.loadArticle()
  },
  onShareAppMessage() {
    const article = this.article || { id: this.articleId, title: '湖财官网资讯', official: true }
    return { title: article.title, path: `/pages/news-detail/index?id=${article.id}${article.official ? '&official=1' : ''}` }
  },
  methods: {
    share() { return sharePage(`/pages/news-detail/index?id=${encodeURIComponent(this.articleId)}`, this.article?.title || '湖财官网资讯') },
    async loadArticle() {
      uni.showNavigationBarLoading()
      try {
        if (!this.articleId) throw new Error('内容标识缺失')
        const official = await getOfficialContentDetail(this.articleId)
        this.article = { ...formatOfficialItem(official), ...official, category: official.categoryLabel, tone: 'blue', official: true }
        await this.loadRelatedOfficial(official.category)
      } catch (error) {
        uni.showModal({ title: '内容加载失败', content: error.message || '请稍后重试', showCancel: false })
        this.article = { id: this.articleId, title: '官网内容暂时无法加载', category: '湖财官网资讯', summary: '请稍后重试，或返回官网资讯列表查看其他内容。', content: ['当前没有可用的官网缓存，本页不会替换为无关内容。'], tone: 'blue', official: false }
      } finally {
        this.articleId = this.article.id
        uni.setNavigationBarTitle({ title: this.article.category || '湖财资讯' })
        uni.hideNavigationBarLoading()
      }
    },
    async loadRelatedOfficial(category) {
      try {
        const result = await getOfficialContent({ category, page: 1, pageSize: 4 })
        this.relatedItems = (result.items || []).filter((item) => item.id !== this.articleId).slice(0, 3).map((item, index) => ({ ...formatOfficialItem(item, index), category: item.categoryLabel, official: true }))
      } catch { this.relatedItems = [] }
    },
    openNews(id) {
      this.articleId = id
      this.officialRequested = true
      this.loadArticle()
      uni.pageScrollTo({ scrollTop: 0, duration: 220 })
    },
    openExternal(url) {
      if (!url) return
      // #ifdef H5
      window.open(url, '_blank', 'noopener,noreferrer')
      return
      // #endif
      // #ifdef APP-PLUS
      plus.runtime.openURL(url)
      return
      // #endif
      // #ifdef MP-WEIXIN || MP-ALIPAY
      uni.setClipboardData({ data: url, success: () => uni.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' }) })
      // #endif
    }
  }
}
</script>

<style scoped>
.news-detail-page { padding-top: 12rpx; }
.article-hero { position: relative; min-width:0; min-height: 380rpx; padding: 38rpx 34rpx 30rpx; overflow: hidden; border-radius: 38rpx; color: #FFFFFF; box-shadow: 0 24rpx 54rpx rgba(9, 47, 105, .2); }
.article-hero--blue { background: linear-gradient(140deg, #082D69, #033481 60%, #235FA4); }
.article-hero--gold { background: linear-gradient(140deg, #5D4625, #92703A 62%, #C1A268); }
.article-hero--green { background: linear-gradient(140deg, #124D43, #216D5C 62%, #4A8C79); }
.article-hero--red { background: linear-gradient(140deg, #6B3637, #964A47 62%, #BA6A61); }
.article-hero__orbit { position: absolute; border: 1rpx solid rgba(255, 255, 255, .15); border-radius: 50%; }
.article-hero__orbit--one { width: 320rpx; height: 320rpx; right: -120rpx; top: -125rpx; }
.article-hero__orbit--two { width: 170rpx; height: 170rpx; right: -43rpx; top: -50rpx; box-shadow: 0 0 0 30rpx rgba(255, 255, 255, .025); }
.article-hero__topline { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; }
.article-category { padding: 8rpx 17rpx; border-radius: 99rpx; color: #725321; background: #E5C98F; font-size: 18rpx; font-weight: 700; }
.article-date { color: rgba(255, 255, 255, .55); font-family: Georgia, serif; font-size: 19rpx; letter-spacing: 1rpx; }
.article-title, .article-summary, .related-item__meta, .related-item__title, .related-item__summary { display: block; }
.article-title { position: relative; z-index: 1; width:100%; max-width:100%; margin-top: 38rpx; font-size: 46rpx; line-height: 1.38; font-weight: 700; letter-spacing: 1rpx; overflow-wrap:anywhere; word-break:break-word; }
.article-summary { position: relative; z-index: 1; width:100%; max-width:100%; margin-top: 18rpx; color: rgba(255, 255, 255, .72); font-size: 23rpx; line-height: 1.7; overflow-wrap:anywhere; word-break:break-word; }
.article-hero__footer { position:relative; z-index:1; width:100%; min-width:0; margin-top:30rpx; padding-top: 18rpx; display: flex; align-items: flex-start; justify-content: space-between; gap:18rpx; border-top: 1rpx solid rgba(255, 255, 255, .14); color: rgba(255, 255, 255, .52); font-size: 17rpx; line-height:1.5; }
.article-hero__footer text:first-child{min-width:0;flex:1;overflow-wrap:anywhere;word-break:break-word}.article-hero__footer text:last-child{flex-shrink:0}
.article-hero__footer text:last-child { color: rgba(229, 201, 143, .68); font-family: Georgia, serif; letter-spacing: 2rpx; }
.article-card { position: relative; z-index: 2; min-width:0; margin: -18rpx 14rpx 0; padding: 34rpx 30rpx; overflow:hidden; }
.article-lead { position: relative; padding: 23rpx 25rpx 23rpx 48rpx; border-left: 5rpx solid #C2A26B; border-radius: 0 22rpx 22rpx 0; color: #526078; background: #F5F1E9; font-size: 23rpx; line-height: 1.75; }
.article-lead__mark { position: absolute; left: 15rpx; top: 10rpx; color: #C2A26B; font-family: Georgia, serif; font-size: 46rpx; font-weight: 700; }
.article-body { width:100%; min-width:0; max-width:100%; margin-top: 30rpx; overflow:hidden; }
.article-paragraph { display: block; margin-bottom: 25rpx; color: #3D495E; font-size: 25rpx; line-height: 2; text-align: justify; }
.article-paragraph:last-child { margin-bottom: 0; }
.official-richtext { display: block; width:100%; min-width:0; max-width:100%; overflow:hidden; color: #3D495E; font-size: 25rpx; line-height: 2; word-break:break-word; overflow-wrap:anywhere; }
.attachment-list { margin-top: 30rpx; padding-top: 24rpx; border-top: 1rpx solid #EDF0F4; }
.attachment-list__title { display: block; margin-bottom: 10rpx; color: #26344A; font-size: 24rpx; font-weight: 650; }
.attachment-item { min-width:0; min-height: 72rpx; padding:10rpx 0; display: flex; align-items: flex-start; justify-content: space-between; gap:16rpx; color: #52627D; font-size: 21rpx; line-height:1.55; }
.attachment-item text:first-child { min-width:0; flex:1; overflow-wrap:anywhere; word-break:break-all; }
.attachment-item text:last-child { flex-shrink:0; color: #033481; }
.article-signature { margin-top: 34rpx; padding-top: 24rpx; display: flex; flex-direction: column; align-items: flex-end; color: #9AA2AF; font-size: 18rpx; line-height: 1.8; }
.article-signature view { width: 62rpx; height: 3rpx; margin-bottom: 11rpx; background: #C2A26B; }
.article-actions { margin: 22rpx 14rpx 0; display: flex; }
.article-action { height: 76rpx; flex: 1; margin: 0 7rpx; padding: 0; display: flex; align-items: center; justify-content: center; border: 1rpx solid #DDE3EC; border-radius: 22rpx; color: #59667A; background: #FFFFFF; font-size: 22rpx; line-height: 76rpx; }
.article-action text:first-child { margin-right: 9rpx; color: #033481; font-size: 27rpx; }
.article-action--active { color: #176551; border-color: #CFE2DB; background: #E7F1ED; }
.article-action--active text:first-child { color: #176551; }
.source-note { margin-top: 22rpx; padding: 23rpx 24rpx; display: flex; align-items: flex-start; border-radius: 24rpx; color: #7E8999; background: #E9EDF4; font-size: 19rpx; line-height: 1.6; }
.source-note__icon { width: 34rpx; height: 34rpx; margin-right: 12rpx; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 2rpx solid #9A7A45; border-radius: 50%; color: #8A6935; font-size: 17rpx; font-weight: 700; }
.related-list { padding: 0 24rpx; }
.related-item { min-height: 150rpx; padding: 24rpx 0; display: flex; align-items: center; }
.related-item--border { border-bottom: 1rpx solid #EDF0F4; }
.related-thumb { width: 92rpx; height: 92rpx; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 27rpx; color: rgba(255, 255, 255, .9); font-size: 20rpx; font-weight: 700; letter-spacing: 2rpx; }
.related-thumb--blue { background: linear-gradient(145deg, #033481, #537FB8); }.related-thumb--gold { background: linear-gradient(145deg, #89642D, #CEAC6B); }.related-thumb--green { background: linear-gradient(145deg, #155948, #55917F); }.related-thumb--red { background: linear-gradient(145deg, #7E3F3F, #B86760); }
.related-item__body { flex: 1; min-width: 0; margin-left: 19rpx; }
.related-item__meta { color: #9A793F; font-size: 18rpx; }
.related-item__title, .related-item__summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.related-item__title { margin-top: 6rpx; color: #2E3A4F; font-size: 24rpx; font-weight: 650; }
.related-item__summary { margin-top: 7rpx; color: #929BA8; font-size: 18rpx; }
.related-item__arrow { margin-left: 10rpx; color: #B0B7C2; font-size: 36rpx; }
@media screen and (max-width:360px){.news-detail-page{padding-left:18rpx;padding-right:18rpx}.article-hero{padding:30rpx 26rpx 26rpx;border-radius:30rpx}.article-title{margin-top:30rpx;font-size:40rpx}.article-summary{font-size:21rpx}.article-card{margin-left:8rpx;margin-right:8rpx;padding:28rpx 22rpx}.article-lead{padding-right:18rpx}.related-thumb{width:78rpx;height:78rpx}}
</style>
