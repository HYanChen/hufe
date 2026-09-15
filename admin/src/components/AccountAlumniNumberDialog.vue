<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import {api,accessToken} from '../lib/api.js'
import {auth} from '../lib/auth.js'
import {personTypeLabel} from '../lib/format.js'
import {canIssueAlumniNumber} from '../lib/alumniNumberEligibility.js'

const props=defineProps({open:Boolean,account:Object,mode:{type:String,default:'single'}})
const emit=defineEmits(['cancel','issued','stale'])
const target=ref(null),preview=ref(null),reason=ref(''),attested=ref(false),stage=ref('edit'),busy=ref(false),error=ref(''),now=ref(Date.now()),content=ref(null)
let version=0,ownerToken='',ownerMode='',alive=true,controller,timer
const batch=computed(()=>props.mode==='batch')
const validReason=computed(()=>reason.value.trim().length>=5&&reason.value.trim().length<=300&&!/[\u0000-\u001f<>]/.test(reason.value))
const previewExpired=computed(()=>!preview.value||!Number.isFinite(Date.parse(preview.value.expiresAt))||Date.parse(preview.value.expiresAt)<=now.value)
const formValid=computed(()=>validReason.value&&attested.value&&(batch.value?!!preview.value&&preview.value.eligible>0&&!previewExpired.value:!!target.value))
const remainingSeconds=computed(()=>preview.value?Math.max(0,Math.ceil((Date.parse(preview.value.expiresAt)-now.value)/1000)):0)
function current(run=version,token=ownerToken){
  return alive&&props.open&&run===version&&!!token&&token===accessToken()&&auth.isSuperAdmin.value&&ownerMode===props.mode&&(batch.value||canIssueAlumniNumber(props.account)&&target.value?.id===props.account?.id&&target.value?.revision===Number(props.account?.revision||0))
}
function clear(){version++;controller?.abort();controller=null;window.clearInterval(timer);timer=null;target.value=null;preview.value=null;reason.value='';attested.value=false;stage.value='edit';busy.value=false;error.value=''}
function close(){clear();emit('cancel')}
function check(){if(current())return true;close();return false}
async function revealStart(){const run=version,token=ownerToken;await nextTick();if(current(run,token))content.value?.closest?.('.dialog-scroll')?.scrollTo?.({top:0})}
function resetConfirmation(){stage.value='edit';attested.value=false}
function tick(){now.value=Date.now();if(!current()){close();return}if(batch.value&&preview.value&&previewExpired.value&&!busy.value){resetConfirmation();error.value='预览已过期，请重新预览后核对人数；尚未执行本次下发。'}}
function start(){
  clear();if(!props.open)return
  if(!auth.isSuperAdmin.value||!['single','batch'].includes(props.mode)||props.mode==='single'&&!canIssueAlumniNumber(props.account)){emit('cancel');return}
  ownerToken=accessToken();ownerMode=props.mode;now.value=Date.now()
  if(!batch.value)target.value={id:props.account.id,name:props.account.name,username:props.account.username,department:props.account.department,personType:props.account.personType,revision:Number(props.account.revision||0)}
  timer=window.setInterval(tick,1000)
  if(batch.value)loadPreview()
}
function validPreview(value){
  const count=value=>Number.isInteger(value)&&value>=0
  return value?.scope==='all_verified'&&typeof value.token==='string'&&!!value.token&&Number.isFinite(Date.parse(value.expiresAt))&&['total','eligible','skipped'].every(key=>count(value[key]))&&value.total===value.eligible+value.skipped&&['alreadyAssigned','unverified','inactive','demo'].every(key=>count(value.skippedReasons?.[key]))&&Object.values(value.skippedReasons).reduce((a,b)=>a+b,0)===value.skipped
}
async function loadPreview(){
  if(busy.value||!batch.value||!check())return
  const run=version,token=ownerToken,abort=new AbortController();controller=abort;busy.value=true;preview.value=null;resetConfirmation();error.value=''
  try{
    const result=await api('/admin/accounts/alumni-numbers/preview',{method:'POST',token,signal:abort.signal,body:{}})
    if(!current(run,token))return
    if(!validPreview(result))throw new Error('预览数据不完整，不能执行批量下发，请重新预览。')
    preview.value={...result,sample:Array.isArray(result.sample)?result.sample.slice(0,50):[]};now.value=Date.now()
  }catch(cause){if(!current(run,token))return;if([401,403].includes(cause.status)){close();emit('stale',{message:cause.message,status:cause.status})}else error.value=cause.status===404?'校友编号接口正在更新，请稍后重新预览。':cause.message||'预览失败，请重试'}
  finally{if(alive&&run===version&&!current(run,token))close();if(current(run,token))busy.value=false;if(controller===abort)controller=null}
}
function editAgain(){if(busy.value||!check())return;stage.value='edit';revealStart()}
async function confirm(){
  now.value=Date.now()
  if(busy.value||!check()||!formValid.value)return
  error.value=''
  if(stage.value==='edit'){stage.value='confirm';await revealStart();return}
  const run=version,token=ownerToken,isBatch=batch.value,account=target.value,abort=new AbortController();controller=abort;busy.value=true
  const body=isBatch?{token:preview.value.token,reason:reason.value.trim(),confirmation:'确认批量下发校友编号'}:{expectedRevision:account.revision,reason:reason.value.trim(),confirmation:'确认下发校友编号'}
  try{
    const result=await api(isBatch?'/admin/accounts/alumni-numbers/apply':`/admin/accounts/${account.id}/alumni-number`,{method:'POST',token,signal:abort.signal,body})
    if(!current(run,token))return
    const name=account?.name||account?.username||'';clear();emit('issued',{...result,batch:isBatch,name})
  }catch(cause){
    if(!current(run,token))return
    if([401,403,409].includes(cause.status)){close();emit('stale',{message:cause.message,status:cause.status})}
    else{resetConfirmation();error.value=cause.status===404?'校友编号接口正在更新，尚未确认下发结果，请刷新账号列表后重试。':cause.message||'未能确认下发结果，请刷新账号列表核对；已有编号不会覆盖。';await revealStart()}
  }finally{body.reason='';if(alive&&run===version&&!current(run,token))close();if(current(run,token))busy.value=false;if(controller===abort)controller=null}
}
watch(()=>[props.open,props.mode,props.account?.id],start,{immediate:true})
watch(()=>auth.isSuperAdmin.value,allowed=>{if(!allowed&&props.open)close()})
watch(()=>props.account?.revision,()=>{if(props.open&&!batch.value&&target.value&&target.value.revision!==Number(props.account?.revision||0)){close();emit('stale',{message:'账号已更新，请刷新后重新核对。'})}})
window.addEventListener('hufe:auth-expired',close)
onBeforeUnmount(()=>{alive=false;clear();window.removeEventListener('hufe:auth-expired',close)})
</script>

<template>
  <ConfirmDialog :open="open&&(batch||!!target)" :title="stage==='confirm'?(batch?'确认批量下发校友编号':'确认下发校友编号'):(batch?'批量下发校友编号':'下发校友编号')" :description="batch?'固定范围：全平台所有已实名人员，包含学生、校友、教师与教职工，不受当前搜索、筛选或分页影响。':'仅给此正常、已实名且尚无编号的账号下发唯一校友编号。'" :confirm-text="stage==='edit'?'下一步，核对下发信息':(batch?'确认批量下发':'确认下发编号')" tone="primary" :busy="busy" :confirm-disabled="!formValid" @cancel="close" @confirm="confirm">
    <div ref="content" class="alumni-number-content">
      <p v-if="error" class="number-error" role="alert">{{ error }}</p>
      <template v-if="batch">
        <p v-if="busy&&!preview" role="status">正在读取全部账号的真实统计，尚未下发编号…</p>
        <template v-if="preview">
          <dl class="number-counts" aria-label="校友编号批量下发统计"><div><dt>平台账号总数</dt><dd>{{ preview.total }} 人</dd></div><div class="number-eligible"><dt>待下发（已实名）</dt><dd>{{ preview.eligible }} 人</dd></div><div><dt>已有编号 · 保留原号</dt><dd>{{ preview.skippedReasons.alreadyAssigned }} 人</dd></div><div><dt>未实名 · 跳过</dt><dd>{{ preview.skippedReasons.unverified }} 人</dd></div><div><dt>暂停 / 注销 · 跳过</dt><dd>{{ preview.skippedReasons.inactive }} 人</dd></div><div><dt>模拟账号 · 跳过</dt><dd>{{ preview.skippedReasons.demo }} 人</dd></div></dl>
          <p class="number-help">共 {{ preview.skipped }} 人不作变更。统计按互斥类别计数，已有编号永不覆盖。{{ previewExpired?'预览已过期':`本预览还剩 ${remainingSeconds} 秒有效` }}。</p>
          <p v-if="!preview.eligible" class="number-empty">当前没有需要下发的人员，未执行任何下发。</p>
          <details v-if="preview.sample.length&&stage==='edit'" class="number-sample"><summary>查看待下发人员（前 {{ preview.sample.length }} 人）</summary><ul><li v-for="person in preview.sample" :key="person.id"><strong>{{ person.name||person.username }}</strong><span>{{ person.username }} · {{ personTypeLabel(person.personType) }} · {{ person.department||'部门未提供' }}</span></li></ul></details>
        </template>
        <button v-if="stage==='edit'" class="button button-ghost" type="button" :disabled="busy" @click="loadPreview">{{ preview?'重新预览全部人员':'重新获取预览' }}</button>
      </template>
      <dl v-else class="number-person"><div><dt>下发对象</dt><dd>{{ target?.name||target?.username }}</dd></div><div><dt>平台用户名</dt><dd>{{ target?.username }}</dd></div><div><dt>身份 / 部门</dt><dd>{{ personTypeLabel(target?.personType) }} · {{ target?.department||'部门未提供' }}</dd></div><div><dt>当前校友编号</dt><dd>未下发</dd></div></dl>
      <template v-if="stage==='edit'">
        <label class="number-reason">下发原因 *（5–300字）<textarea v-model="reason" rows="3" maxlength="300" :disabled="busy" placeholder="填写本次下发的业务原因，不要填写身份证号、密码等敏感信息" /></label>
        <label class="number-attestation"><input v-model="attested" type="checkbox" :disabled="busy" />我已核对{{ batch?'以上批量范围及人数':'下发对象' }}，确认仅给符合条件且尚无编号的人员下发。</label>
      </template>
      <template v-else>
        <p class="number-final">{{ batch?`本次将给 ${preview?.eligible||0} 位已实名人员下发编号。`:'本次仅给上述 1 位人员下发编号。' }}点击下方确认按钮后才会执行。</p>
        <dl class="number-person"><div><dt>下发原因</dt><dd>{{ reason }}</dd></div></dl>
        <button class="button button-ghost" type="button" :disabled="busy" @click="editAgain">返回核对</button>
      </template>
      <p class="number-effect">编号由系统生成并保持唯一；已有编号保留，不改实名结论、在校 / 毕业身份、密码或后台权限。批量预览后人员状态若有变化，须重新预览确认。</p>
    </div>
  </ConfirmDialog>
</template>

<style scoped>
.alumni-number-content{min-width:0;overflow-wrap:anywhere;font-size:14px;color:#334155}.number-error{color:#b91c1c;line-height:1.7}.number-counts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0}.number-counts>div{padding:12px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc;min-width:0}.number-counts dt{font-size:12px;color:#64748b}.number-counts dd{font-size:20px;font-weight:650;margin:8px 0 0}.number-counts .number-eligible{background:#eef7f1;border-color:#b9dbc5;color:#237040}.number-person{display:grid;gap:12px;margin:18px 0}.number-person dt{font-size:12px;color:#64748b}.number-person dd{margin:5px 0 0;line-height:1.6}.number-help,.number-effect{font-size:12px;line-height:1.8;color:#64748b}.number-effect{padding:12px;border-radius:8px;background:#edf4fc;color:#355677}.number-empty,.number-final{padding:12px;line-height:1.7;background:#edf7ef;color:#286b43;border-radius:8px}.number-reason{display:flex;flex-direction:column;gap:9px;margin-top:18px}.number-reason textarea{box-sizing:border-box;width:100%;min-width:0;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;background:#fff;resize:vertical}.number-attestation{display:flex;align-items:flex-start;gap:8px;line-height:1.7;margin:18px 0}.number-attestation input{flex:0 0 auto;margin-top:5px}.number-sample{margin:14px 0}.number-sample summary{cursor:pointer}.number-sample ul{list-style:none;padding:0;max-height:200px;overflow:auto}.number-sample li{display:flex;flex-direction:column;gap:5px;padding:9px 0;border-bottom:1px solid #e2e8f0}.number-sample span{font-size:12px;color:#64748b}@media(max-width:380px){.number-counts{grid-template-columns:minmax(0,1fr)}}
</style>
