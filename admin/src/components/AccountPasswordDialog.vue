<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import ConfirmDialog from './ConfirmDialog.vue'
import {api,accessToken,saveAccessToken} from '../lib/api.js'
import {auth} from '../lib/auth.js'

const props=defineProps({open:Boolean,account:Object})
const emit=defineEmits(['cancel','saved','stale'])
const router=useRouter()
const target=ref(null),stage=ref('edit'),newPassword=ref(''),confirmPassword=ref(''),currentPassword=ref(''),reason=ref(''),error=ref(''),busy=ref(false)
let epoch=0,ownerToken='',alive=true,controller
const self=computed(()=>target.value?.id===auth.state.user?.id)
const passwordValid=computed(()=>newPassword.value.length>=8&&new TextEncoder().encode(newPassword.value).length<=128&&/[A-Za-z]/.test(newPassword.value)&&/[0-9]/.test(newPassword.value))
const formValid=computed(()=>passwordValid.value&&newPassword.value===confirmPassword.value&&reason.value.trim().length>=5&&reason.value.trim().length<=300&&(!self.value||!!currentPassword.value))
function clearSecrets(){newPassword.value='';confirmPassword.value='';currentPassword.value='';reason.value=''}
function current(run=epoch,token=ownerToken){return alive&&props.open&&!!token&&run===epoch&&token===accessToken()&&auth.isSuperAdmin.value&&target.value?.status==='active'}
function reset(){epoch++;controller?.abort();controller=null;clearSecrets();target.value=null;stage.value='edit';error.value='';busy.value=false}
function close(){reset();emit('cancel')}
function start(){reset();if(!props.open)return;if(!auth.isSuperAdmin.value||props.account?.status!=='active'){emit('cancel');return}ownerToken=accessToken();target.value={id:props.account.id,name:props.account.name||props.account.displayName||props.account.username,username:props.account.username,status:props.account.status,revision:Number(props.account.revision||0)}}
watch(()=>[props.open,props.account?.id],start,{immediate:true})
watch(()=>auth.isSuperAdmin.value,allowed=>{if(!allowed&&props.open)close()})
function check(){if(current())return true;close();return false}
async function confirm(){
  if(busy.value||!check()||!formValid.value)return
  error.value=''
  if(reason.value.includes(newPassword.value)||(currentPassword.value&&reason.value.includes(currentPassword.value))){error.value='请勿在操作原因中填写密码';return}
  if(stage.value==='edit'){stage.value='confirm';return}
  const run=epoch,token=ownerToken,account=target.value,abort=new AbortController();controller=abort;busy.value=true
  const body={newPassword:newPassword.value,confirmPassword:confirmPassword.value,reason:reason.value.trim(),expectedRevision:account.revision,confirmation:'确认修改该账号密码',...(self.value?{currentPassword:currentPassword.value}:{})}
  try{
    const result=await api(`/admin/accounts/${account.id}/password`,{method:'POST',token,signal:abort.signal,body})
    if(!current(run,token))return
    clearSecrets();emit('saved',{...result,name:account.name})
    if(result.loginRequired&&accessToken()===token){saveAccessToken('');auth.state.user=null;window.dispatchEvent(new CustomEvent('hufe:auth-expired'));await router.replace({name:'login'})}
    else close()
  }catch(cause){
    if(!current(run,token))return
    clearSecrets();stage.value='edit';error.value=cause.status===404?'密码管理接口正在更新，尚未修改密码，请稍后刷新后台重试。':cause.message||'密码修改失败'
    if([401,403].includes(cause.status)){close();emit('stale')}
    else if(cause.status===409){close();emit('stale')}
  }finally{
    // Never retain submitted passwords in retry objects, notices or modal state.
    body.newPassword='';body.confirmPassword='';if(body.currentPassword)body.currentPassword=''
    if(alive&&run===epoch&&!current(run,token))close()
    if(current(run,token))busy.value=false
    if(controller===abort)controller=null
  }
}
window.addEventListener('hufe:auth-expired',close)
onBeforeUnmount(()=>{alive=false;reset();window.removeEventListener('hufe:auth-expired',close)})
</script>
<template>
  <ConfirmDialog :open="open&&!!target" :title="stage==='edit'?'修改平台账号密码':'再次确认修改密码'" :description="stage==='edit'?'仅修改当前选中账号，不会批量重置其他账号，也不影响学校统一认证密码。':'请再次核对目标账号。确认后原密码立即失效，所有旧登录会话将退出。'" :confirm-text="stage==='edit'?'下一步，核对修改':'确认修改密码'" :busy="busy" :confirm-disabled="!formValid" @cancel="close" @confirm="confirm">
    <div class="password-reset-content">
      <div class="password-target"><strong>{{ target?.name }}</strong><span>平台用户名：{{ target?.username }}</span><span>{{ self?'当前登录的全局管理员':'单个目标账号' }}</span></div>
      <p v-if="error" class="password-error" role="alert">{{ error }}</p>
      <template v-if="stage==='edit'">
        <label v-if="self">当前平台密码<input v-model="currentPassword" type="password" autocomplete="current-password" :disabled="busy" maxlength="128" /></label>
        <label>新平台密码<input v-model="newPassword" type="password" autocomplete="new-password" :disabled="busy" maxlength="128" placeholder="至少8位，同时包含字母和数字" /></label>
        <label>再次输入新密码<input v-model="confirmPassword" type="password" autocomplete="new-password" :disabled="busy" maxlength="128" /></label>
        <label>操作原因<textarea v-model="reason" :disabled="busy" maxlength="300" rows="3" placeholder="请填写5至300字原因，不要填写任何密码" /></label>
        <p class="password-help">新密码须为8至128字节，包含字母和数字。请通过安全渠道告知本人；系统不会显示、回读或记录明文密码。</p>
      </template>
      <template v-else><p>操作原因：{{ reason }}</p><button class="button button-ghost" type="button" :disabled="busy" @click="stage='edit'">返回修改</button></template>
      <p class="password-warning">{{ self?'修改自己的密码后，将立即退出当前后台，请使用新密码重新登录。':'新密码作为临时密码。该用户重新登录后必须先修改密码，才能继续使用平台。' }}</p>
    </div>
  </ConfirmDialog>
</template>
<style scoped>
.password-reset-content{min-width:0;overflow-wrap:anywhere}.password-target{padding:12px 14px;border:1px solid #dbe5ef;border-radius:10px;background:#f6f9fc;display:flex;flex-direction:column;gap:6px;font-size:14px}.password-target span{font-size:12px;color:#64748b}.password-reset-content label{display:block;margin:16px 0;color:#334155;font-size:14px}.password-reset-content input,.password-reset-content textarea{display:block;box-sizing:border-box;width:100%;min-width:0;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit;margin-top:8px}.password-reset-content textarea{resize:vertical}.password-help,.password-warning{font-size:12px;line-height:1.8;color:#64748b}.password-warning{padding:12px;background:#fff7e9;color:#925b1b;border-radius:8px}.password-error{color:#b91c1c;font-size:13px;line-height:1.7}
</style>
