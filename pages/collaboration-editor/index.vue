<template>
  <view class="page-shell collaboration-editor-page" :class="{ 'with-sticky-action': accessState === 'ready' }">
    <view class="editor-hero">
      <text class="editor-hero__eyebrow">REAL-NAME COLLABORATION</text>
      <text class="editor-hero__title">实名发布合作</text>
      <text class="editor-hero__desc">清晰描述需求，提交后由学校后台审核；审核通过前不会公开展示。</text>
      <view class="editor-hero__identity"><text>{{ user.realName || '湖财人' }}</text><text>{{ user.department || '湖南财政经济学院' }}</text></view>
      <text class="editor-hero__mark">合</text>
    </view>

    <view v-if="accessState !== 'ready'" class="access-card surface">
      <view class="access-card__icon">{{ accessState === 'guest' ? '登' : '验' }}</view>
      <text class="access-card__title">{{ accessState === 'guest' ? '登录后才能发布合作' : '当前账号不是学校实名账号' }}</text>
      <text class="access-card__desc">{{ accessState === 'guest' ? '合作发布会绑定本人账号并进入后台审核，请先使用湖财人平台账号登录。' : '只有通过学校官网实名注册的账号可以发布。平台运营账号和本地演示账号不具备实名发布权限。' }}</text>
      <button class="primary-button access-card__button" @tap="openAccessPage">{{ accessState === 'guest' ? '去登录' : '了解实名注册' }}</button>
    </view>

    <template v-else>
      <view class="section-head"><view><text class="section-title">基本信息</text><text class="section-kicker">REQUIRED INFORMATION</text></view><text class="required-note">* 必填</text></view>
      <view class="form-card surface">
        <picker mode="selector" :range="categoryOptions" :value="categoryIndex" @change="chooseCategory">
          <view class="picker-row"><view><text>合作类型 *</text><text>选择最符合需求的分类</text></view><text>{{ form.category || '请选择' }} ›</text></view>
        </picker>
        <label class="field-block">
          <text class="field-label">合作标题 *</text>
          <input v-model.trim="form.title" maxlength="80" placeholder="用一句话说明希望达成的合作" placeholder-class="field-placeholder" />
          <text class="field-count">{{ form.title.length }}/80</text>
        </label>
        <label class="field-block">
          <text class="field-label">组织 / 单位 *</text>
          <input v-model.trim="form.organization" maxlength="100" placeholder="请输入发起组织、企业或团队名称" placeholder-class="field-placeholder" />
          <text class="field-count">{{ form.organization.length }}/100</text>
        </label>
        <label class="field-block">
          <text class="field-label">所在城市 *</text>
          <RegionPicker v-model="form.city" v-model:code="form.regionCode" allow-remote />

        </label>
        <picker mode="date" :value="form.deadline" :start="today" @change="form.deadline = $event.detail.value">
          <view class="picker-row"><view><text>截止日期 *</text><text>到期后公开列表将停止展示</text></view><text>{{ form.deadline || '请选择' }} ›</text></view>
        </picker>
        <label class="field-block">
          <text class="field-label">合作标签</text>
          <input v-model="form.tagsText" maxlength="120" placeholder="多个标签请用逗号分隔" placeholder-class="field-placeholder" />
          <view v-if="tags.length" class="tag-preview"><text v-for="tag in tags.slice(0, 6)" :key="tag">{{ tag }}</text></view>
          <text class="field-hint">最多 6 个标签，每个不超过 16 个字。</text>
        </label>
      </view>

      <view class="section-head"><view><text class="section-title">合作内容</text><text class="section-kicker">SUMMARY & DETAILS</text></view></view>
      <view class="form-card surface">
        <label class="field-block field-block--textarea">
          <text class="field-label">合作摘要 *</text>
          <textarea v-model="form.summary" maxlength="300" :show-confirm-bar="false" placeholder="简要说明背景、资源与期望，建议 30–150 字" placeholder-class="field-placeholder" />
          <view class="textarea-meta"><text>列表将展示该摘要</text><text>{{ form.summary.length }}/300</text></view>
        </label>
        <label class="field-block field-block--textarea">
          <text class="field-label">合作详情 *</text>
          <textarea v-model="form.description" maxlength="12000" :show-confirm-bar="false" placeholder="说明合作背景、已有条件、期望资源、合作方式和交付边界。支持 Markdown 标题与列表。" placeholder-class="field-placeholder" />
          <view class="textarea-meta"><text>请提供足够信息便于后台审核</text><text>{{ form.description.length }}/12000</text></view>
        </label>
        <label class="field-block field-block--textarea">
          <text class="field-label">联系说明 *</text>
          <textarea v-model="form.contactMethod" maxlength="1000" :show-confirm-bar="false" placeholder="例如：意向方可通过平台提交说明，由工作人员协助对接。请勿直接公开私人手机号或微信号。" placeholder-class="field-placeholder" />
          <view class="textarea-meta"><text>说明对接流程，不要公开敏感信息</text><text>{{ form.contactMethod.length }}/1000</text></view>
        </label>
      </view>

      <view class="privacy-warning">
        <text>隐</text>
        <view><text>禁止公开个人敏感信息</text><text>请勿填写身份证号、学工号、家庭住址、账号密码、私人手机号或私人社交账号。公开内容请使用必要的组织级联系说明。</text></view>
      </view>
    </template>

    <SupportFooter />

    <view v-if="accessState === 'ready'" class="sticky-action editor-actions">
      <button class="secondary-button" :disabled="submitting" @tap="saveDraft">暂存草稿</button>
      <button class="primary-button" :loading="submitting" :disabled="submitting || !dirty" @tap="submit">{{ submitting ? '提交中' : '提交审核' }}</button>
    </view>
  </view>
</template>

<script>
import { publishCollaborationOpportunity } from '../../services/business'
import { getUser, isSchoolVerified, isVerified } from '../../utils/store'
import { openPage } from '../../utils/nav'

const draftKey = 'hufe_collaboration_draft'
const createForm = () => ({
  category: '',
  title: '',
  organization: '',
  city: '',
  regionCode: '',
  deadline: '',
  tagsText: '',
  summary: '',
  description: '',
  contactMethod: ''
})

export default {
  data() {
    return {
      user: {},
      accessState: 'guest',
      categoryOptions: ['资源对接', '项目合作', '技术需求', '人才合作', '场地共享', '行业交流', '其他'],
      form: createForm(),
      submitting: false,
      initialSnapshot: '',
      allowBack: false
    }
  },
  computed: {
    today() {
      const date = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    },
    categoryIndex() { return Math.max(0, this.categoryOptions.indexOf(this.form.category)) },
    tags() {
      return this.form.tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
    },
    snapshot() {
      return JSON.stringify({
        category: this.form.category,
        title: this.form.title.trim(),
        organization: this.form.organization.trim(),
        city: this.form.city.trim(),
        regionCode: String(this.form.regionCode || ''),
        deadline: this.form.deadline,
        tags: this.tags,
        summary: this.form.summary.trim(),
        description: this.form.description.trim(),
        contactMethod: this.form.contactMethod.trim()
      })
    },
    dirty() { return this.snapshot !== this.initialSnapshot }
  },
  onLoad() {
    this.refreshAccess()
    if (this.accessState === 'ready') this.restoreDraft()
  },
  onShow() {
    const previous = this.accessState
    this.refreshAccess()
    if (previous !== 'ready' && this.accessState === 'ready') this.restoreDraft()
  },
  onBackPress() {
    if (!this.dirty || this.allowBack || this.accessState !== 'ready') return false
    uni.showModal({
      title: '有未保存的合作内容',
      content: '可以先暂存本机草稿，或直接离开并放弃本次修改。',
      confirmText: '直接离开',
      confirmColor: '#9A403B',
      success: (result) => {
        if (!result.confirm) return
        this.allowBack = true
        uni.navigateBack()
      }
    })
    return true
  },
  methods: {
    refreshAccess() {
      this.user = getUser()
      this.accessState = !isVerified() ? 'guest' : (isSchoolVerified() ? 'ready' : 'unverified')
      if (!this.initialSnapshot) this.initialSnapshot = this.snapshot
    },
    openAccessPage() { openPage(this.accessState === 'guest' ? '/pages/verify/index' : '/pages/register/index') },
    chooseCategory(event) { this.form.category = this.categoryOptions[Number(event.detail.value)] || '' },
    restoreDraft() {
      this.form = createForm()
      this.initialSnapshot = this.snapshot
      try {
        const draft = uni.getStorageSync(draftKey)
        if (draft && typeof draft === 'object') {
          this.form = { ...createForm(), ...draft }
          uni.showToast({ title: '已恢复本机草稿', icon: 'none' })
        }
      } catch (error) {}
    },
    saveDraft() {
      if (!this.dirty) {
        uni.showToast({ title: '还没有可暂存的内容', icon: 'none' })
        return
      }
      uni.setStorageSync(draftKey, { ...this.form })
      uni.showToast({ title: '草稿已保存在本机', icon: 'none' })
    },
    validate() {
      if (!this.form.category) return '请选择合作类型'
      if (this.form.title.trim().length < 6) return '合作标题至少填写 6 个字'
      if (!this.form.organization.trim()) return '请填写组织或单位'
      if (!this.form.city.trim()) return '请选择所在地区'
      if (!this.form.deadline) return '请选择截止日期'
      if (this.tags.length > 6) return '合作标签最多 6 个'
      if (this.tags.some((tag) => tag.length > 16)) return '每个合作标签不能超过 16 个字'
      if (this.form.summary.trim().length < 20) return '合作摘要至少填写 20 个字'
      if (this.form.description.trim().length < 40) return '合作详情至少填写 40 个字'
      if (this.form.contactMethod.trim().length < 10) return '请填写清晰的联系说明'
      const sensitive = /(?:身份证|密码|微信|手机号)\s*[:：]?\s*[A-Za-z0-9+_-]{5,}/i
      if (sensitive.test(`${this.form.summary}\n${this.form.description}\n${this.form.contactMethod}`)) return '内容疑似包含个人敏感信息，请删除后提交'
      return ''
    },
    async submit() {
      if (this.submitting) return
      if (!isSchoolVerified()) {
        this.refreshAccess()
        return
      }
      const message = this.validate()
      if (message) {
        uni.showToast({ title: message, icon: 'none' })
        return
      }
      this.submitting = true
      try {
        await publishCollaborationOpportunity({
          category: this.form.category,
          title: this.form.title.trim(),
          organization: this.form.organization.trim(),
          city: this.form.city.trim(),
          regionCode: String(this.form.regionCode || ''),
          deadline: this.form.deadline,
          summary: this.form.summary.trim(),
          description: this.form.description.trim(),
          contactMethod: this.form.contactMethod.trim(),
          tags: this.tags
        })
        uni.removeStorageSync(draftKey)
        this.form = createForm()
        this.initialSnapshot = this.snapshot
        uni.showModal({
          title: '合作机会已提交',
          content: '学校后台审核通过后将在合作广场公开展示，您可在“我的发布”查看处理状态。',
          showCancel: false,
          confirmText: '查看我的发布',
          confirmColor: '#033481',
          success: () => {
            this.allowBack = true
            uni.redirectTo({ url: '/pages/collaboration/index?tab=mine' })
          }
        })
      } catch (error) {
        if (['SCHOOL_IDENTITY_REQUIRED', 'VERIFIED_IDENTITY_REQUIRED'].includes(error.code) || error.statusCode === 403) {
          this.refreshAccess()
          uni.showModal({ title: '实名校验已失效', content: '请重新登录学校实名账号后再提交。', showCancel: false })
          return
        }
        uni.showModal({ title: '提交失败', content: error.message || '请稍后重试', showCancel: false })
      } finally { this.submitting = false }
    }
  }
}
</script>

<style scoped>
.collaboration-editor-page{padding-top:14rpx}.editor-hero{position:relative;min-height:315rpx;padding:37rpx 34rpx;overflow:hidden;border-radius:38rpx;color:#fff;background:linear-gradient(140deg,#15304e,#073a78 65%,#1d5b9b);box-shadow:0 22rpx 49rpx rgba(11,58,115,.19)}.editor-hero__eyebrow,.editor-hero__title,.editor-hero__desc{position:relative;z-index:2;display:block}.editor-hero__eyebrow{color:#e1c58d;font-size:17rpx;font-weight:700;letter-spacing:4rpx}.editor-hero__title{margin-top:15rpx;font-size:40rpx;font-weight:700}.editor-hero__desc{width:530rpx;margin-top:11rpx;color:rgba(255,255,255,.65);font-size:20rpx;line-height:1.65}.editor-hero__identity{position:absolute;z-index:2;left:34rpx;right:34rpx;bottom:28rpx;padding-top:18rpx;display:flex;justify-content:space-between;border-top:1rpx solid rgba(255,255,255,.15);color:rgba(255,255,255,.6);font-size:18rpx}.editor-hero__identity text:first-child{color:#ead4a7;font-weight:650}.editor-hero__mark{position:absolute;right:20rpx;top:-27rpx;color:rgba(255,255,255,.055);font-family:"STKaiti","KaiTi",serif;font-size:230rpx;font-weight:700}.access-card{margin-top:24rpx;padding:58rpx 34rpx;text-align:center}.access-card__icon{width:84rpx;height:84rpx;margin:0 auto 21rpx;display:flex;align-items:center;justify-content:center;border-radius:27rpx;color:#fff;background:#033481;font-size:27rpx;font-weight:700}.access-card__title,.access-card__desc{display:block}.access-card__title{color:#2e3c52;font-size:29rpx;font-weight:700}.access-card__desc{max-width:560rpx;margin:12rpx auto 0;color:#7d8899;font-size:21rpx;line-height:1.7}.access-card__button{width:300rpx;margin:28rpx auto 0}.required-note{color:#9a443f;font-size:18rpx}.form-card{padding:0 27rpx}.picker-row{min-height:105rpx;padding:21rpx 0;display:flex;align-items:center;border-bottom:1rpx solid #edf0f4}.picker-row>view{min-width:0;flex:1}.picker-row>view text{display:block}.picker-row>view text:first-child{color:#455368;font-size:23rpx;font-weight:650}.picker-row>view text:last-child{margin-top:5rpx;color:#9aa2ae;font-size:17rpx}.picker-row>text{max-width:250rpx;margin-left:20rpx;color:#033481;font-size:21rpx;font-weight:600}.field-block{position:relative;padding:23rpx 0;display:block;border-bottom:1rpx solid #edf0f4}.field-block:last-child{border-bottom:none}.field-label{display:block;color:#455368;font-size:23rpx;font-weight:650}.field-block input{width:100%;height:72rpx;margin-top:6rpx;padding-right:80rpx;color:#27354a;font-size:24rpx}.field-count{position:absolute;right:0;top:64rpx;color:#a0a8b3;font-size:17rpx}.field-hint{display:block;margin-top:8rpx;color:#929caa;font-size:17rpx}.field-placeholder{color:#afb6c0}.tag-preview{margin-top:8rpx;display:flex;flex-wrap:wrap;gap:8rpx}.tag-preview text{padding:7rpx 11rpx;border-radius:99rpx;color:#586b82;background:#eef2f7;font-size:17rpx}.field-block--textarea textarea{width:100%;height:270rpx;margin-top:13rpx;color:#27354a;font-size:24rpx;line-height:1.75}.field-block--textarea:nth-child(2) textarea{height:380rpx}.textarea-meta{padding-top:12rpx;display:flex;justify-content:space-between;gap:18rpx;border-top:1rpx solid #eef1f5;color:#9aa3af;font-size:17rpx}.textarea-meta text:first-child{flex:1}.privacy-warning{margin-top:22rpx;padding:23rpx;display:flex;align-items:flex-start;border-radius:24rpx;color:#786f64;background:#f7f1e7}.privacy-warning>text{width:50rpx;height:50rpx;margin-right:14rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:17rpx;color:#845f27;background:#ead5aa;font-size:19rpx;font-weight:700}.privacy-warning view text{display:block}.privacy-warning view text:first-child{color:#6f542b;font-size:21rpx;font-weight:700}.privacy-warning view text:last-child{margin-top:5rpx;font-size:18rpx;line-height:1.6}.editor-actions{display:flex;gap:14rpx}.editor-actions button{margin:0}.editor-actions .secondary-button{width:38%}.editor-actions .primary-button{flex:1}.editor-actions button[disabled]{opacity:.5}
</style>
