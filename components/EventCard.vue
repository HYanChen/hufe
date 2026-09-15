<template>
  <view class="event-card surface" @tap="$emit('select', event.id)">
    <view class="event-date" :class="`event-date--${event.theme}`">
      <text class="event-date__month">{{ event.month }}月</text>
      <text class="event-date__day">{{ event.day }}</text>
    </view>
    <view class="event-card__body">
      <view class="event-card__topline">
        <text class="badge">{{ event.tag }}</text>
        <text class="event-card__city">◉ {{ event.city }}</text>
      </view>
      <text class="event-card__title">{{ event.title }}</text>
      <text class="event-card__meta">{{ event.time }} · 已报名 {{ event.joined + (event.registered ? 1 : 0) }} 人</text>
    </view>
    <text class="event-card__arrow">›</text>
  </view>
</template>

<script>
export default {
  name: 'EventCard',
  props: {
    event: {
      type: Object,
      required: true
    }
  },
  emits: ['select']
}
</script>

<style scoped>
.event-card {
  min-height: 176rpx;
  padding: 22rpx;
  display: flex;
  align-items: center;
}

.event-date {
  width: 104rpx;
  height: 122rpx;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 24rpx;
}

.event-date--career { color: #FFFFFF; background: linear-gradient(145deg, #033481, #1D5BA5); }
.event-date--homecoming { color: #6E4E21; background: linear-gradient(145deg, #F5E2B9, #D4AE68); }
.event-date--finance { color: #FFFFFF; background: linear-gradient(145deg, #176551, #2D8B73); }

.event-date__month {
  font-size: 20rpx;
  opacity: 0.82;
}

.event-date__day {
  margin-top: 2rpx;
  font-size: 46rpx;
  line-height: 1;
  font-weight: 700;
}

.event-card__body {
  flex: 1;
  min-width: 0;
  margin-left: 22rpx;
}

.event-card__topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.event-card__city {
  color: #929BAA;
  font-size: 20rpx;
}

.event-card__title,
.event-card__meta {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-card__title {
  margin-top: 14rpx;
  font-size: 28rpx;
  font-weight: 650;
}

.event-card__meta {
  margin-top: 10rpx;
  color: #8A93A2;
  font-size: 20rpx;
}

.event-card__arrow {
  margin-left: 14rpx;
  color: #B0B7C2;
  font-size: 40rpx;
}
</style>
