<template>
  <view class="page-shell personal-page">
    <view class="personal-heading"><view><text class="personal-title">个人资料</text><text class="personal-subtitle">学校学籍信息与个人资料</text></view><text class="personal-private">仅本人可见</text></view>
    <view v-if="loading" class="personal-state surface">正在读取资料…</view>
    <view v-else-if="!profile" class="personal-state surface"><text>{{ error || '登录后查看和完善本人资料' }}</text><button class="primary-button" @tap="error ? load() : open('/pages/verify/index')">{{ error ? '重新加载' : '去登录' }}</button></view>
    <template v-else>
      <view class="personal-identity surface"><view class="personal-name"><text class="personal-avatar">{{ profile.name.slice(-2) }}</text><view><text>{{ profile.name }}</text><text class="personal-subtitle">{{ roleLabel }} · {{ profile.schoolIdentityVerified ? '已通过实名校验' : '尚未完成实名校验' }}</text></view></view>
        <view class="personal-grid"><view v-for="row in identityRows" :key="row.label" class="personal-row"><text>{{ row.label }}</text><text>{{ row.value || '未提供' }}</text></view></view>
        <text class="personal-note">{{ schoolNote }} 专业、班级和年份为只读资料，不可自行修改。未确认实际毕业年份的在校生展示预计毕业年份；学号沿用脱敏展示。</text><button class="personal-link" @tap="open('/pages/register/index')">前往学校官网重新校验学籍 ›</button><button class="personal-link" @tap="open('/pages/feedback/index')">反馈学籍资料问题 ›</button>
      </view>
      <view class="personal-form surface"><text class="personal-section-title">个人补充信息</text><text class="personal-note">可修改联系方式、所在城市和个人简介，不会自动公开到校友名录。</text>
        <view class="personal-grid"><view v-for="field in fieldDefinitions" :key="field.key" class="personal-field" :class="{ 'personal-field--wide':field.key === 'bio' }"><text>{{ field.label }} <text class="personal-origin">{{ locked(field.key) ? '已校验 · 只读' : (field.key === 'city' ? '地区库选择' : '本人填写') }}</text></text><text v-if="locked(field.key)" class="personal-locked">{{ form[field.key] }}</text><RegionPicker v-else-if="field.key === 'city'" v-model="form.city" v-model:code="form.regionCode" :disabled="saving" /><textarea v-else-if="field.key === 'bio'" v-model="form.bio" :maxlength="500" placeholder="简单介绍自己" :disabled="saving" /><input v-else v-model="form[field.key]" :maxlength="field.max" :type="field.key.endsWith('Year') ? 'number' : 'text'" :placeholder="field.placeholder || '待完善'" :disabled="saving" /></view></view>
        <text v-if="error" class="personal-error" role="alert">{{ error }}</text><text v-if="saved" class="personal-success" role="status">资料已保存</text>
        <view class="personal-actions"><button class="secondary-button" :disabled="saving" @tap="load">重新加载</button><button class="primary-button" :disabled="saving" :loading="saving" @tap="save">保存资料</button></view>
      </view>
      <view class="personal-security surface"><view><text class="personal-section-title">账号安全</text><text class="personal-note">使用当前密码验证身份后修改个人密码，修改后需重新登录。</text></view><button class="secondary-button" @tap="open('/pages/change-password/index')">修改密码</button></view>
    </template><SupportFooter />
  </view>
</template>
<script>
import { request } from '../../services/http'
import { getAccessToken, identityLabel,clearAuthState } from '../../utils/store'
import { openPage } from '../../utils/nav'
import { isManualVerification } from '../../utils/identityVerification'
export default {
  data:()=>({ ownerToken:'',profile:null,form:{},loading:false,saving:false,error:'',saved:false,loadVersion:0,fieldDefinitions:[{key:'city',label:'所在城市',max:80},{key:'phone',label:'联系电话',max:32},{key:'email',label:'邮箱',max:160},{key:'bio',label:'个人简介',max:500}] }),
  computed:{
    roleLabel(){return identityLabel(this.profile?.personType)},
    manual(){return isManualVerification(this.profile||{})},
    schoolNote(){if(this.profile?.educationSupplementedFields?.length)return '部分学籍资料由平台管理员按本人提供的信息补录，非学校接口返回。';if(this.manual)return '身份与学籍资料来源：授权管理员人工复核，不是学校接口自动返回。';return '学籍信息由学校官网统一认证提供；学校暂未返回的信息不会推算或使用个人填写值。'},
    identityRows(){const p=this.profile,f=p.fields,missing=this.manual?'复核暂未提供':'学校暂未提供',expected=p.personType==='student'&&!p.graduationYearConfirmed;return [{label:'平台用户名',value:p.username},{label:'学院 / 部门',value:p.department},{label:'专业',value:f.major||missing},{label:'班级',value:f.className||missing},{label:'入学年份',value:f.enrollmentYear||missing},{label:expected?'预计毕业年份':'毕业年份',value:(expected?f.expectedGraduationYear:f.graduationYear)||missing},{label:'学号 / 工号（脱敏）',value:p.studentIdMasked},{label:'校友编号',value:p.alumniNo}]}
  },
  onShow(){this.load()},onHide(){this.stop()},onUnload(){this.stop()},
  methods:{
    open:openPage,locked(key){return this.profile.lockedFields.includes(key)},stop(){this.loadVersion++;this.loading=false;this.saving=false},
    async load(){const token=getAccessToken(),version=++this.loadVersion;this.ownerToken=token;this.error='';this.saved=false;this.profile=null;this.form={};this.loading=false;if(!token)return;this.loading=true;try{const value=await request({path:'/api/v1/me/profile',token});if(version===this.loadVersion&&token===getAccessToken()){this.profile=value;this.form={...value.fields}}}catch(e){if(version===this.loadVersion&&token===getAccessToken()){if(e.statusCode===401){clearAuthState();this.error=''}else this.error=e.message}}finally{if(version===this.loadVersion)this.loading=false}},
    async save(){if(getAccessToken()!==this.ownerToken){await this.load();return}if(this.saving||!this.profile)return;const token=getAccessToken(),version=this.loadVersion;this.saving=true;this.error='';this.saved=false;try{const fields=Object.fromEntries(Object.entries(this.form).filter(([key])=>!this.locked(key)));const value=await request({path:'/api/v1/me/profile',method:'PATCH',token,data:{revision:this.profile.revision,fields}});if(version===this.loadVersion&&token===getAccessToken()){this.profile=value;this.form={...value.fields};this.saved=true}}catch(e){if(version===this.loadVersion&&token===getAccessToken())this.error=e.message}finally{if(version===this.loadVersion&&token===getAccessToken())this.saving=false}}
  }
}
</script>
<style scoped>
.personal-security{padding:24px;margin-bottom:22px}.personal-security .secondary-button{width:100%;height:48px;font-size:16px;line-height:48px}
.personal-page{max-width:1050px;padding-top:24px}.personal-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.personal-title{display:block;font-size:28px;font-weight:700}.personal-subtitle{display:block;color:#718199;font-size:14px;line-height:1.6;margin-top:6px}.personal-private{flex-shrink:0;padding:7px 10px;background:#e6f1ec;border-radius:8px;color:#176551;font-size:13px}.personal-identity,.personal-form{padding:24px;margin-bottom:22px}.personal-name{display:flex;align-items:center;gap:15px;font-size:23px;font-weight:600;margin-bottom:20px}.personal-avatar{width:58px;height:58px;display:flex;align-items:center;justify-content:center;background:#033481;color:white;border-radius:18px;font-size:20px}.personal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 28px}.personal-row{padding:16px 0;border-bottom:1px solid #edf0f4;min-width:0}.personal-row>text{display:block;font-size:14px;color:#768397}.personal-row>text+text{margin-top:8px;font-size:16px;color:#17233b;overflow-wrap:anywhere}.personal-note{display:block;margin:16px 0;color:#768397;line-height:1.7;font-size:14px}.personal-section-title{font-size:21px;font-weight:700}.personal-field{min-width:0;margin:10px 0}.personal-field>text:first-child{display:block;font-size:16px;margin-bottom:10px}.personal-origin{font-size:12px;color:#8492a7;margin-left:6px}.personal-field input,.personal-field textarea,.personal-locked{display:block;width:100%;height:48px;line-height:24px;padding:12px;border:1px solid #dce4ef;border-radius:10px;background:#f8fafd;color:#263b56;font-size:16px}.personal-locked{height:auto;overflow-wrap:anywhere;background:#eef2f6}.personal-field textarea{height:115px}.personal-field--wide{grid-column:1/-1}.personal-actions{display:flex;gap:12px;margin-top:24px}.personal-actions button{flex:1;font-size:16px;height:48px;line-height:48px}.personal-error,.personal-success{display:block;margin:16px 0;color:#a13c35;font-size:15px}.personal-success{color:#176551}.personal-state{padding:36px 22px;font-size:16px;line-height:1.8}.personal-state button{margin-top:20px}.personal-link{background:none;padding:0;color:#033481;font-size:14px;text-align:left;line-height:24px;margin:0}@media(max-width:600px){.personal-grid{grid-template-columns:minmax(0,1fr)}.personal-identity,.personal-form{padding:20px}.personal-title{font-size:25px}}
</style>
