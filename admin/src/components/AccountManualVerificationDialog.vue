<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import {api,accessToken} from '../lib/api.js'
import {auth} from '../lib/auth.js'
import {personTypeLabel} from '../lib/format.js'
import {canManuallyVerifyAccount} from '../lib/manualVerificationEligibility.js'

const props=defineProps({open:Boolean,account:Object})
const emit=defineEmits(['cancel','verified','stale'])
const fieldKeys=['name','personType','department','studentId','major','className','enrollmentYear','graduationYear','expectedGraduationYear']
const empty=()=>Object.fromEntries(fieldKeys.map(key=>[key,'']))
const target=ref(null),fields=ref(empty()),basis=ref(''),attested=ref(false),stage=ref('edit'),busy=ref(false),error=ref('')
const content=ref(null)
let version=0,ownerToken='',alive=true,controller
const retainedNumber=computed(()=>!!target.value?.studentIdMasked)
const formValid=computed(()=>{
  const f=fields.value,year=value=>!value||/^\d{4}$/.test(value)&&Number(value)>=1900&&Number(value)<=new Date().getFullYear()+10
  return !!(f.name.trim()&&f.department.trim()&&['student','alumni','faculty','staff'].includes(f.personType)&&(f.studentId.trim()?/^[A-Za-z0-9_.-]{4,40}$/.test(f.studentId.trim()):retainedNumber.value)&&(!f.className||f.major)&&['enrollmentYear','graduationYear','expectedGraduationYear'].every(key=>year(f[key]))&&(!f.enrollmentYear||[f.graduationYear,f.expectedGraduationYear].every(value=>!value||value>=f.enrollmentYear))&&basis.value.trim().length>=5&&basis.value.trim().length<=500&&attested.value)
})
function current(run=version,token=ownerToken){return alive&&props.open&&run===version&&!!token&&token===accessToken()&&auth.isSuperAdmin.value&&canManuallyVerifyAccount(props.account)&&target.value?.id===props.account?.id&&target.value?.revision===Number(props.account?.revision||0)}
function clear(){version++;controller?.abort();controller=null;fields.value=empty();basis.value='';attested.value=false;target.value=null;stage.value='edit';busy.value=false;error.value=''}
function close(){clear();emit('cancel')}
function start(){
  clear();if(!props.open)return
  if(!auth.isSuperAdmin.value||!canManuallyVerifyAccount(props.account)){emit('cancel');return}
  ownerToken=accessToken();target.value={id:props.account.id,username:props.account.username,name:props.account.name,studentIdMasked:props.account.studentIdMasked||'',revision:Number(props.account.revision||0),mustChangePassword:props.account.mustChangePassword===true}
  fields.value=Object.fromEntries(fieldKeys.map(key=>[key,key==='studentId'?'':String(props.account[key]||'')]))
  if(!['student','alumni','faculty','staff'].includes(fields.value.personType))fields.value.personType=''
  normalizeIdentity()
}
function normalizeIdentity(){if(fields.value.personType==='student')fields.value.graduationYear='';else fields.value.expectedGraduationYear=''}
watch(()=>[props.open,props.account?.id],start,{immediate:true})
watch(()=>auth.isSuperAdmin.value,allowed=>{if(!allowed&&props.open)close()})
watch(()=>props.account?.revision,()=>{if(props.open&&target.value&&target.value.revision!==Number(props.account?.revision||0)){close();emit('stale',{message:'账号已更新，请重新核对资料。'})}})
function check(){if(current())return true;close();return false}
async function revealStart(){const run=version,token=ownerToken;await nextTick();if(current(run,token))content.value?.closest?.('.dialog-scroll')?.scrollTo?.({top:0})}
function editAgain(){if(busy.value)return;stage.value='edit';revealStart()}
async function confirm(){
  if(busy.value||!check()||!formValid.value)return
  error.value=''
  if(fields.value.studentId.trim()&&basis.value.includes(fields.value.studentId.trim())){error.value='核验依据只填写材料类型和核对过程，请勿抄写完整学工号';await revealStart();return}
  if(stage.value==='edit'){stage.value='confirm';await revealStart();return}
  const token=ownerToken,run=version,account=target.value,abort=new AbortController();controller=abort;busy.value=true
  const body={expectedRevision:account.revision,fields:Object.fromEntries(fieldKeys.map(key=>[key,fields.value[key].trim()])),verificationBasis:basis.value.trim(),confirmation:'确认人工实名校验通过'}
  try{
    const result=await api(`/admin/accounts/${account.id}/manual-verification`,{method:'POST',token,signal:abort.signal,body})
    if(!current(run,token))return
    const name=body.fields.name;clear();emit('verified',{...result,name})
  }catch(cause){
    if(!current(run,token))return
    if([401,403,409].includes(cause.status)){close();emit('stale',{message:cause.message,status:cause.status})}
    else{stage.value='edit';attested.value=false;error.value=cause.status===404?'人工校验接口正在更新，尚未变更认证状态，请稍后刷新重试。':cause.message||'人工校验未完成，请核对资料后重试';await revealStart()}
  }finally{
    body.fields.studentId='';body.verificationBasis=''
    if(alive&&run===version&&!current(run,token))close()
    if(current(run,token))busy.value=false
    if(controller===abort)controller=null
  }
}
window.addEventListener('hufe:auth-expired',close)
onBeforeUnmount(()=>{alive=false;clear();window.removeEventListener('hufe:auth-expired',close)})
</script>
<template>
  <ConfirmDialog :open="open&&!!target" :title="stage==='edit'?'管理员人工校验':'确认人工实名校验通过'" :description="stage==='edit'?'核对本人有效身份与学籍或任职证明后，补全真实资料。此处记录为管理员人工校验，不是学校官网接口校验。':'请再次核对下列人员及核验依据。通过后原账号立即成为已实名账号，未知学籍信息不会自动推算。'" :confirm-text="stage==='edit'?'下一步，核对通过信息':'确认人工校验通过'" tone="primary" :busy="busy" :confirm-disabled="!formValid" @confirm="confirm" @cancel="close">
    <div ref="content" class="account-manual-content">
      <div class="manual-target"><strong>{{ target?.name||target?.username }}</strong><span>平台用户名：{{ target?.username }}</span><span>后台录入普通人员 · 待实名校验</span></div>
      <p v-if="error" class="manual-error" role="alert">{{ error }}</p>
      <template v-if="stage==='edit'">
        <div class="manual-fields">
          <label>真实姓名 *<input v-model="fields.name" maxlength="80" :disabled="busy" autocomplete="off" /></label>
          <label>校内身份 *<select v-model="fields.personType" :disabled="busy" @change="normalizeIdentity"><option value="">请选择核实后的身份</option><option value="student">学生</option><option value="alumni">校友</option><option value="faculty">教师</option><option value="staff">教职工</option></select></label>
          <label>学院 / 部门 *<input v-model="fields.department" maxlength="120" :disabled="busy" /></label>
          <label>学号 / 工号 *<input v-model="fields.studentId" maxlength="40" :disabled="busy" inputmode="text" autocomplete="off" :placeholder="retainedNumber?'保留原学工号请留空':'按有效证明填写，保留前导零'" /><small v-if="retainedNumber">已存：{{ target?.studentIdMasked }}。留空保留原有效学工号；重新核对可填写完整原号码，既有学工号不能在此更换。</small><small v-else>须核对有效学籍或任职证明，不可填写脱敏星号。</small></label>
          <label>专业<input v-model="fields.major" maxlength="120" :disabled="busy" placeholder="证明未提供可留空" /></label>
          <label>班级<input v-model="fields.className" maxlength="80" :disabled="busy" placeholder="填写班级时须同时填写专业" /></label>
          <label>入学年份<input v-model="fields.enrollmentYear" maxlength="4" :disabled="busy" inputmode="numeric" placeholder="未知可留空，不从班级推算" /></label>
          <label v-if="fields.personType==='student'">预计毕业年份<input v-model="fields.expectedGraduationYear" maxlength="4" :disabled="busy" inputmode="numeric" placeholder="在校生填写预计毕业年份" /></label>
          <label v-else>实际毕业年份<input v-model="fields.graduationYear" maxlength="4" :disabled="busy" inputmode="numeric" placeholder="以有效证明为准，未知可留空" /></label>
        </div>
        <label class="manual-basis">核验依据 *（5–500字）<textarea v-model="basis" rows="3" maxlength="500" :disabled="busy" placeholder="填写已核对的材料类型或授权依据，不要填写完整身份证号或密码" /></label>
        <label class="manual-attestation"><input v-model="attested" type="checkbox" :disabled="busy" />我已核对本人身份及有效学籍或任职证明，确认以上资料真实一致。</label>
        <p class="manual-help">姓名、校内身份、学院/部门及有效学工号必须齐全；学籍未知字段可留空。通过后资料会注明人工复核来源。</p>
      </template>
      <template v-else>
        <dl class="manual-summary"><div><dt>姓名 / 身份</dt><dd>{{ fields.name }} · {{ personTypeLabel(fields.personType) }}</dd></div><div><dt>学院 / 部门</dt><dd>{{ fields.department }}</dd></div><div><dt>学号 / 工号</dt><dd>{{ fields.studentId||target?.studentIdMasked+'（保留原号）' }}</dd></div><div><dt>专业 / 班级</dt><dd>{{ fields.major||'未提供' }} / {{ fields.className||'未提供' }}</dd></div><div><dt>入学年份</dt><dd>{{ fields.enrollmentYear||'未提供' }}</dd></div><div><dt>{{ fields.personType==='student'?'预计毕业年份':'毕业年份' }}</dt><dd>{{ (fields.personType==='student'?fields.expectedGraduationYear:fields.graduationYear)||'未提供' }}</dd></div><div><dt>核验依据</dt><dd>{{ basis }}</dd></div></dl>
        <button class="button button-ghost" type="button" :disabled="busy" @click="editAgain">返回修改</button>
      </template>
      <p class="manual-effect">仅更新实名校验及核实的身份资料，不修改用户名或密码，不取消首次登录改密要求，不授予后台管理权限。</p>
    </div>
  </ConfirmDialog>
</template>
<style scoped>
.account-manual-content{min-width:0;overflow-wrap:anywhere}.manual-target{display:flex;flex-direction:column;gap:6px;padding:13px;background:#f3f8fc;border:1px solid #dbe5ef;border-radius:10px;font-size:14px}.manual-target span{color:#64748b;font-size:12px}.manual-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:18px 0}.manual-fields label,.manual-basis{display:flex;flex-direction:column;gap:8px;color:#334155;font-size:13px;min-width:0}.manual-fields input,.manual-fields select,.manual-basis textarea{box-sizing:border-box;width:100%;min-width:0;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;background:white}.manual-fields small,.manual-help{font-size:12px;color:#64748b;line-height:1.7}.manual-basis textarea{resize:vertical}.manual-attestation{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.7;margin:18px 0;color:#334155}.manual-attestation input{flex:0 0 auto;margin-top:4px}.manual-effect{padding:12px;background:#edf7ef;color:#286b43;border-radius:8px;font-size:12px;line-height:1.8}.manual-error{color:#b91c1c;font-size:13px}.manual-summary div{margin:14px 0;font-size:13px;line-height:1.7}.manual-summary dt{color:#64748b}.manual-summary dd{margin:4px 0;color:#243a51}@media(max-width:600px){.manual-fields{grid-template-columns:minmax(0,1fr)}}
</style>
