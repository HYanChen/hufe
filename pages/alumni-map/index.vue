<template>
  <view class="page-shell alumni-map-page">
    <view class="map-hero">
      <text class="map-hero__eyebrow">HUFE ALUMNI CITY NETWORK</text>
      <text class="map-hero__title">同城地图</text>
      <text class="map-hero__desc">从城市分布看见身边的湖财人，连接同城校友与组织网络。</text>
      <view class="map-hero__stats"><view><text>{{ totalAlumni }}</text><text>公开统计校友</text></view><view><text>{{ totalCityCount }}</text><text>连接城市</text></view><view><text>{{ revision || '—' }}</text><text>数据版本</text></view></view>
      <text class="map-hero__mark">城</text>
    </view>

    <view class="map-policy surface"><text>隐</text><view><text>仅展示城市聚合统计</text><text>不展示个人实时位置、精确地址或联系方式。</text></view></view>

    <view class="section-head"><view><text class="section-title">同城街道地图</text><text class="section-kicker">EXPLORE THE CITY</text></view><text class="section-more">拖动 · 缩放</text></view>
    <view class="city-map surface">
      <view class="city-map__toolbar"><view><text>{{ mapView.located && activeCity ? activeCity.city : '湖南财政经济学院' }}</text><text>{{ locating ? '正在定位城市中心…' : mapView.located ? '已定位校友大致区域，可放大查看街道' : '以学校主校区为中心，点击区域标记查看校友' }}</text></view><button class="secondary-button" @tap="returnToSchool">回到学校</button></view>
      <scroll-view v-if="cities.length" scroll-x class="city-map__cities"><view class="city-map__city-strip"><button v-for="city in cities" :key="city.city" :class="['city-map__city',{'is-active':activeCity?.city===city.city}]" @tap="focusCity(city)">{{ city.city }} · {{ city.count }}</button></view></scroll-view>
      <!-- #ifdef H5 -->
      <iframe :key="mapView.embedUrl+mapReload" :src="mapView.embedUrl" class="city-map__frame" title="可拖动和缩放的本地街道地图" loading="lazy" referrerpolicy="same-origin" allowfullscreen @error="mapLoadError=true"></iframe>
      <view class="city-map__links"><a :href="mapView.fullUrl" target="_blank" rel="noopener noreferrer">打开完整地图 ↗</a><button @tap="mapReload++;mapLoadError=false">重新加载地图</button></view>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <view class="city-map__fallback"><text>在浏览器打开互动地图，可拖动、缩放至街道。</text><button class="secondary-button" @tap="openFullMap">打开互动地图</button></view>
      <!-- #endif -->
      <text v-if="centerError" class="city-map__message" role="status">{{ centerError }}</text>
      <text v-if="mapLoadError" class="city-map__message" role="alert">地图暂未加载成功，请重试或打开完整地图。</text>
      <view class="city-map__caption"><text>蓝色标记为学校主校区，绿色标记为公开城市资料汇总的校友人数。仅表示大致区域，不是个人实时位置；未安装底图的城市暂不显示区域标记。</text><view v-if="sourceUrl">
        <!-- #ifdef H5 -->
        <a :href="sourceUrl" target="_blank" rel="noopener noreferrer">城市中心：GeoNames</a><text> · </text><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>
        <!-- #endif -->
        <!-- #ifndef H5 -->
        <text @tap="openSource">城市中心：GeoNames · CC BY 4.0</text>
        <!-- #endif -->
      </view></view>
    </view>
    <view v-if="loading" class="empty-state surface"><view class="empty-state__icon">…</view><text>正在加载城市统计</text></view>
    <view v-else-if="error" class="empty-state surface"><view class="empty-state__icon">!</view><text>{{ error }}</text><button class="secondary-button retry-button" @tap="load">重新加载</button></view>
    <view v-else-if="!cities.length" class="empty-state surface"><view class="empty-state__icon">城</view><text>暂无可展示城市统计，你仍可浏览地图</text></view>

    <view v-if="cities.length" class="section-head"><view><text class="section-title">城市热力榜</text><text class="section-kicker">ALUMNI DISTRIBUTION</text></view></view>
    <view v-if="cities.length" class="city-list surface">
      <view v-for="(city,index) in cities" :key="city.city" class="city-row" @tap="focusCity(city)">
        <text class="city-rank">{{ String(index + 1).padStart(2, '0') }}</text>
        <view class="city-row__main"><view><text>{{ city.city }}</text><text>公开名录城市聚合</text></view><view class="city-progress"><text :style="{ width: `${city.ratio}%` }"></text></view></view>
        <view class="city-row__count"><text>{{ city.count }}</text><text>位</text></view>
        <text class="city-row__arrow">›</text>
      </view>
    </view>

    <BusinessDetailSheet
      :open="Boolean(selected)"
      :title="selected ? `${selected.city} · 湖财同城` : ''"
      :subtitle="selected ? `${selected.count} 位公开名录统计校友` : ''"
      eyebrow="CITY ALUMNI NETWORK"
      :show-actions="true"
      @close="selected = null"
    >
      <template v-if="selected">
        <view class="city-detail-stats"><view><text>{{ selected.count }}</text><text>校友统计</text></view><view><text>{{ selected.share }}%</text><text>公开统计占比</text></view><view><text>{{ revision || '—' }}</text><text>数据版本</text></view></view>
        <BusinessRichText :content="selected.detailMarkdown" />
      </template>
      <template #actions>
        <button class="secondary-button" @tap="selected = null">关闭</button>
        <button class="primary-button" @tap="openDirectory">查找同城校友</button>
      </template>
    </BusinessDetailSheet>
    <SupportFooter />
  </view>
</template>

<script>
import BusinessDetailSheet from '../../components/BusinessDetailSheet.vue'
import BusinessRichText from '../../components/BusinessRichText.vue'
import { getDirectoryCityStats, getDirectoryCityCenter } from '../../services/business'
import { openPage } from '../../utils/nav'
import { cityMapView, cityMapSourceUrl } from '../../utils/cityMap'

export default {
  components: { BusinessDetailSheet, BusinessRichText },
  data() { return { cities: [], selected: null, activeCity: null, cityCenter: null, locating: false, centerError: '', mapLoadError: false, mapReload: 0, requestVersion: 0, cityRequestVersion: 0, hidden: false, loading: false, error: '', totalProfiles: 0, totalCities: 0, revision: 0 } },
  computed: {
    totalAlumni() { return this.totalProfiles || this.cities.reduce((sum, city) => sum + city.count, 0) },
    totalCityCount() { return this.totalCities },
    mapView() { return cityMapView(this.cityCenter) },
    sourceUrl() { return cityMapSourceUrl(this.cityCenter) }
  },
  onShow() {
    this.hidden = false
    // #ifdef H5
    window.addEventListener('message', this.mapMessage)
    // #endif
    this.load()
  },
  onHide() { this.leavePage() },
  onUnload() { this.leavePage() },
  onPullDownRefresh() { this.load().finally(() => uni.stopPullDownRefresh()) },
  onShareAppMessage() { return { title: '湖财校友同城地图', path: '/pages/alumni-map/index' } },
  methods: {
    async load() {
      if (this.loading) return
      const version = ++this.requestVersion
      this.loading = true
      this.error = ''
      try {
        const result = await getDirectoryCityStats()
        if (this.hidden || version !== this.requestVersion) return
        const normalized = result.items.filter((item) => String(item.city || '').trim()).map((item) => ({
          city: String(item.city).trim(),
          count: Math.max(0, Number(item.count || 0))
        })).sort((a, b) => b.count - a.count)
        this.totalProfiles = Math.max(0, Number(result.totalProfiles || 0))
        this.totalCities = Math.max(0, Number(result.totalCities || 0))
        this.revision = Math.max(0, Number(result.revision || 0))
        const max = Math.max(1, ...normalized.map((item) => item.count))
        const total = Math.max(1, this.totalProfiles || normalized.reduce((sum, item) => sum + item.count, 0))
        this.cities = normalized.map((item) => ({
          ...item,
          ratio: Math.max(7, Math.round((item.count / max) * 100)),
          share: ((item.count / total) * 100).toFixed(1),
          detailMarkdown: `## ${item.city}校友统计\n当前公开名录中，共有 **${item.count} 位**校友将城市设置为${item.city}。\n\n> 本页仅展示城市级聚合数量，不提供个人实时位置、精确地址或联系方式。`
        }))
        const previous = this.activeCity?.city
        const city = this.cities.find(item => item.city === previous) || this.cities[0]
        if (city && previous && this.cityCenter) await this.focusCity(city)
        else if (city) { this.activeCity = city; this.cityCenter = null; this.centerError = ''; this.locating = false }
        else { this.cityRequestVersion++; this.activeCity = null; this.cityCenter = null; this.centerError = ''; this.locating = false }
      } catch (error) {
        if (this.hidden || version !== this.requestVersion) return
        this.cities = []
        this.totalProfiles = 0
        this.totalCities = 0
        this.revision = 0
        this.cityRequestVersion++
        this.activeCity = null
        this.cityCenter = null
        this.locating = false
        this.error = error.message || '城市统计加载失败'
      } finally { if (version === this.requestVersion) this.loading = false }
    },
    leavePage() {
      // #ifdef H5
      window.removeEventListener('message', this.mapMessage)
      // #endif
      this.hidden = true
      this.requestVersion++
      this.cityRequestVersion++
      this.loading = false
      this.locating = false
      this.selected = null
    },
    mapMessage(event) {
      // #ifdef H5
      const frame = this.$el?.querySelector?.('iframe.city-map__frame')
      if (this.hidden || !frame || event.origin !== window.location.origin || event.source !== frame.contentWindow || event.data?.type !== 'hufe-map-city-select') return
      const city = this.cities.find(item => item.city === event.data.city)
      if (city) { this.activeCity = city; this.selected = city }
      // #endif
    },
    returnToSchool() { this.cityRequestVersion++; this.cityCenter = null; this.activeCity = null; this.selected = null; this.locating = false; this.centerError = ''; this.mapReload++ },
    async focusCity(city) {
      if (!city || this.hidden) return
      this.activeCity = city
      this.selected = null
      this.centerError = ''
      if (this.cityCenter?.city === city.city && this.mapView.located) return
      const version = ++this.cityRequestVersion
      this.cityCenter = null
      this.locating = true
      this.mapLoadError = false
      try {
        const center = await getDirectoryCityCenter(city.city)
        if (this.hidden || version !== this.cityRequestVersion) return
        if (center?.city !== city.city || !cityMapView(center).located) {
          this.centerError = `暂未取得${city.city}的可靠城市中心，可直接拖动地图浏览；校友统计仍可查看。`
          return
        }
        this.cityCenter = center
      } catch (error) {
        if (this.hidden || version !== this.cityRequestVersion) return
        this.centerError = error.message || '城市定位暂不可用，请稍后重试。'
      } finally { if (version === this.cityRequestVersion) this.locating = false }
    },
    openFullMap() { openPage(this.mapView.fullUrl) },
    openSource() { if (this.sourceUrl) openPage(this.sourceUrl) },
    openDirectory() {
      const city = this.selected?.city || this.activeCity?.city || ''
      this.selected = null
      openPage(`/pages/directory/index?city=${encodeURIComponent(city)}`)
    },
  }
}
</script>

<style scoped>
.alumni-map-page{padding-top:14rpx}.map-hero{position:relative;min-height:380rpx;padding:37rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#102e4d,#073a78 66%,#1e5b9b);box-shadow:0 22rpx 49rpx rgba(11,58,115,.19)}.map-hero__eyebrow,.map-hero__title,.map-hero__desc{position:relative;z-index:2;display:block}.map-hero__eyebrow{color:#e1c58d;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.map-hero__title{margin-top:15rpx;font-size:40rpx;font-weight:700}.map-hero__desc{width:520rpx;margin-top:11rpx;color:rgba(255,255,255,.64);font-size:20rpx;line-height:1.65}.map-hero__stats{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:28rpx;padding-top:20rpx;display:flex;border-top:1rpx solid rgba(255,255,255,.15)}.map-hero__stats view{flex:1;border-right:1rpx solid rgba(255,255,255,.12);text-align:center}.map-hero__stats view:last-child{border-right:none}.map-hero__stats text{display:block}.map-hero__stats text:first-child{color:#ead3a4;font-family:Georgia,serif;font-size:31rpx;font-weight:700}.map-hero__stats text:last-child{margin-top:4rpx;color:rgba(255,255,255,.55);font-size:17rpx}.map-hero__mark{position:absolute;right:19rpx;top:-27rpx;color:rgba(255,255,255,.055);font-family:"STKaiti","KaiTi",serif;font-size:230rpx;font-weight:700}.map-policy{position:relative;z-index:3;margin:-14rpx 18rpx 0;padding:21rpx;display:flex;align-items:center}.map-policy>text{width:53rpx;height:53rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:18rpx;color:#7f602b;background:#f2e2c4;font-size:19rpx;font-weight:700}.map-policy view text{display:block}.map-policy view text:first-child{color:#3f4e64;font-size:21rpx;font-weight:700}.map-policy view text:last-child{margin-top:4rpx;color:#8d96a4;font-size:17rpx}.city-map{padding:0;overflow:hidden;border:1rpx solid #dfe6ee}.city-map__toolbar{display:flex;align-items:center;justify-content:space-between;gap:20rpx;padding:24rpx}.city-map__toolbar>view{min-width:0;flex:1}.city-map__toolbar text{display:block;overflow-wrap:anywhere}.city-map__toolbar text:first-child{font-size:29rpx;font-weight:700;color:#233e61}.city-map__toolbar text:last-child{margin-top:8rpx;font-size:21rpx;line-height:1.5;color:#748397}.city-map__toolbar button{font-size:22rpx;padding:0 22rpx;margin:0;flex-shrink:0;min-height:64rpx}.city-map__cities{width:100%;border-top:1rpx solid #eef1f5}.city-map__city-strip{display:flex;gap:14rpx;padding:18rpx 24rpx;width:max-content}.city-map__city{flex-shrink:0;margin:0;border:1rpx solid #d8e3ef;border-radius:40rpx;padding:0 22rpx;font-size:22rpx;line-height:2.4;color:#426180;background:#f7f9fc}.city-map__city.is-active{color:#fff;background:#033481;border-color:#033481}.city-map__frame{display:block;width:100%;height:clamp(350px,62vh,580px);border:0;background:#e7eef1}.city-map__links{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18rpx;padding:20rpx 24rpx}.city-map a{color:#174f8b;text-decoration:underline;font-size:22rpx}.city-map__links button{margin:0;padding:0;background:transparent;color:#174f8b;font-size:22rpx;line-height:1.6;border:0}.city-map__links button::after{border:0}.city-map__caption{padding:0 24rpx 24rpx;color:#7b8898;font-size:20rpx;line-height:1.7}.city-map__caption>text{display:block}.city-map__caption>view{margin-top:8rpx}.city-map__message{display:block;margin:0 24rpx 16rpx;color:#9b6b2a;font-size:23rpx;line-height:1.6}.city-map__fallback{padding:44rpx 24rpx;background:#edf3f8;text-align:center;font-size:24rpx;color:#5c6d81;line-height:1.8}.city-map__fallback button{margin-top:24rpx}.retry-button{width:230rpx;margin:22rpx auto 0}.city-list{padding:0 24rpx}.city-row{min-height:112rpx;padding:20rpx 0;display:flex;align-items:center;border-bottom:1rpx solid #edf0f4}.city-row:last-child{border-bottom:none}.city-rank{width:52rpx;color:#a37c3f;font-family:Georgia,serif;font-size:22rpx}.city-row__main{min-width:0;flex:1}.city-row__main>view:first-child{display:flex;align-items:baseline;justify-content:space-between}.city-row__main>view:first-child text:first-child{color:#344258;font-size:24rpx;font-weight:700}.city-row__main>view:first-child text:last-child{color:#929caa;font-size:17rpx}.city-progress{height:8rpx;margin-top:11rpx;overflow:hidden;border-radius:99rpx;background:#edf1f5}.city-progress text{display:block;height:100%;border-radius:99rpx;background:linear-gradient(90deg,#033481,#4f80b8)}.city-row__count{width:84rpx;margin-left:18rpx;text-align:right}.city-row__count text:first-child{color:#033481;font-family:Georgia,serif;font-size:27rpx;font-weight:700}.city-row__count text:last-child{margin-left:3rpx;color:#909aa8;font-size:16rpx}.city-row__arrow{margin-left:8rpx;color:#aab2bd;font-size:35rpx}.city-detail-stats{margin-bottom:23rpx;padding:20rpx 12rpx;display:flex;border-radius:20rpx;background:#eef3f8}.city-detail-stats view{min-width:0;flex:1;border-right:1rpx solid #dce4ed;text-align:center}.city-detail-stats view:last-child{border-right:none}.city-detail-stats text{display:block}.city-detail-stats text:first-child{overflow:hidden;color:#26496f;font-size:25rpx;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.city-detail-stats text:last-child{margin-top:4rpx;color:#8a96a4;font-size:17rpx}
</style>
