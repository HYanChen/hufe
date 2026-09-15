<script setup>
import {computed,nextTick,onBeforeUnmount,reactive,ref,watch} from 'vue'
import {X,Download,Upload,UserPlus,CheckCircle} from '@lucide/vue'
import {api,apiBlob,accessToken} from '../lib/api.js'
import {useOverlayScrollLock} from '../lib/overlayScrollLock.js'
import {personTypeLabel} from '../lib/format.js'

const props=defineProps({open:Boolean,mode:{type:String,default:'manual'}})
const emit=defineEmits(['cancel','created'])
const empty=()=>({username:'',name:'',personType:'alumni',department:'',major:'',className:'',studentId:'',enrollmentYear:'',graduationYear:'',expectedGraduationYear:''})
const form=reactive(empty()),preview=ref(null),file=ref(null),fileName=ref(''),busy=ref(false),error=ref(''),result=ref(null),verificationMode=ref('unverified'),confirmed=ref(false),basis=ref(''),drawer=ref(null),page=ref(1)
let version=0,owner='',previousFocus=null
const isExcel=computed(()=>props.mode==='xlsx')
const visibleRows=computed(()=>preview.value?.items.slice((page.value-1)*20,page.value*20)||[])
const canApply=computed(()=>preview.value&&!preview.value.invalid&&!busy.value&&(verificationMode.value==='unverified'||preview.value.canVerify&&confirmed.value&&basis.value.trim().length>=5))
function current(token,id){return props.open&&token===accessToken()&&token===owner&&id===version}
function reset(){version++;owner=accessToken();Object.assign(form,empty());preview.value=null;file.value=null;fileName.value='';busy.value=false;error.value='';result.value=null;verificationMode.value='unverified';confirmed.value=false;basis.value='';page.value=1}
watch(()=>[props.open,props.mode],async()=>{reset();if(props.open){previousFocus=document.activeElement;await nextTick();drawer.value?.querySelector('input,button')?.focus()}else previousFocus?.focus?.()},{immediate:true})
useOverlayScrollLock(()=>props.open)
watch(()=>form.personType,type=>{if(type==='student')form.graduationYear='';else form.expectedGraduationYear=''})
function close(){if(!busy.value)emit('cancel')}
function choose(event){const selected=event.target.files?.[0];event.target.value='';version++;file.value=null;fileName.value='';preview.value=null;error.value='';page.value=1;if(!selected)return;if(!/\.xlsx$/i.test(selected.name)||!selected.size||selected.size>5*1024*1024){error.value='请选择5MB以内的.xlsx文件';return}file.value=selected;fileName.value=selected.name}
function invalidate(){preview.value=null;page.value=1;error.value=''}
async function inspect(){
  if(busy.value||isExcel.value&&!file.value)return
  const token=owner,id=++version;busy.value=true;error.value='';preview.value=null
  try{
    let response
    if(isExcel.value){const bytes=new Uint8Array(await file.value.arrayBuffer());if(!current(token,id))return;let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));response=await api('/admin/personnel/import-preview',{method:'POST',token,body:{filename:fileName.value,contentBase64:btoa(binary)}})}
    else response=await api('/admin/personnel/preview',{method:'POST',token,body:{...form}})
    if(current(token,id)){preview.value=response;page.value=1;file.value=null;confirmed.value=false;await nextTick();if(current(token,id))drawer.value?.querySelector('.personnel-preview')?.scrollIntoView?.({block:'start'})}
  }catch(cause){if(current(token,id))error.value=cause.message}finally{if(current(token,id))busy.value=false}
}
async function apply(){
  if(!canApply.value)return
  const token=owner,id=++version;busy.value=true;error.value=''
  try{const response=await api('/admin/personnel/apply',{method:'POST',token,body:{token:preview.value.token,verificationMode:verificationMode.value,manualVerificationConfirmed:confirmed.value,verificationBasis:basis.value.trim()}});if(current(token,id)){result.value=response;preview.value=null;emit('created',response)}}catch(cause){if(current(token,id))error.value=cause.message}finally{if(current(token,id))busy.value=false}
}
async function download(){
  const token=owner,id=version
  try{const blob=await apiBlob('/admin/personnel/template',{token});if(!current(token,id))return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='人员导入模板.xlsx';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(cause){if(current(token,id))error.value=cause.message}
}
function keyboard(event){if(!props.open)return;if(event.key==='Escape')close();if(event.key!=='Tab')return;const elements=[...(drawer.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')||[])],first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
function expire(){reset();emit('cancel')}
window.addEventListener('keydown',keyboard);window.addEventListener('hufe:auth-expired',expire)
onBeforeUnmount(()=>{version++;window.removeEventListener('keydown',keyboard);window.removeEventListener('hufe:auth-expired',expire)})
</script>

<template>
  <Teleport to="body"><div v-if="open" class="resource-drawer-backdrop" @click.self="close">
    <aside ref="drawer" class="resource-drawer personnel-drawer" role="dialog" aria-modal="true" aria-labelledby="personnel-title">
      <header class="resource-drawer-header"><div><h2 id="personnel-title">{{ isExcel?'Excel 批量导入人员':'新增普通人员' }}</h2><p>普通人员不具有后台权限。先检查资料，再确认创建。</p></div><button type="button" class="icon-button" aria-label="关闭" :disabled="busy" @click="close"><X :size="20" /></button></header>
      <div class="resource-drawer-body personnel-body">
        <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
        <div v-if="result" class="personnel-success"><CheckCircle :size="32" /><h3>已新增 {{ result.created }} 位普通人员</h3><p>初始密码为各自用户名后加 123456，首次登录必须修改密码。</p><p>已存在账号的资料、密码和权限均未修改。</p></div>
        <template v-else>
          <div v-if="isExcel" class="personnel-upload"><h3>1. 填写并选择人员模板</h3><p>仅支持 .xlsx，文件最大5MB，每次最多1000人。用户名和学号须按文本填写，表内不能包含公式、宏或外部链接。</p><div class="personnel-file-actions"><button class="button button-ghost" type="button" :disabled="busy" @click="download"><Download :size="16" />下载 Excel 模板</button><label class="button button-ghost"><Upload :size="16" />选择 Excel 文件<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="busy" @change="choose" /></label></div><p v-if="fileName" class="personnel-filename">{{ fileName }}</p></div>
          <form v-else class="personnel-form" @submit.prevent="inspect" @input="invalidate" @change="invalidate">
            <label><span>用户名 *</span><input v-model.trim="form.username" maxlength="32" :disabled="busy" placeholder="支持中文，2–32位" autocomplete="off" /></label>
            <label><span>姓名 *</span><input v-model.trim="form.name" maxlength="80" :disabled="busy" autocomplete="off" /></label>
            <label><span>身份类型 *</span><select v-model="form.personType" :disabled="busy"><option value="student">学生</option><option value="alumni">校友</option><option value="faculty">教师</option><option value="staff">教职工</option><option value="member">普通人员</option></select></label>
            <label><span>学院 / 部门</span><input v-model.trim="form.department" maxlength="160" :disabled="busy" /></label>
            <label><span>专业</span><input v-model.trim="form.major" maxlength="120" :disabled="busy" /></label>
            <label><span>班级</span><input v-model.trim="form.className" maxlength="80" :disabled="busy" /></label>
            <label><span>学号 / 工号</span><input v-model.trim="form.studentId" maxlength="40" :disabled="busy" inputmode="text" autocomplete="off" /><small>用于校对重复人员，前导零须保留。</small></label>
            <label><span>入学年份</span><input v-model.trim="form.enrollmentYear" maxlength="4" :disabled="busy" inputmode="numeric" /></label>
            <label v-if="form.personType!=='student'"><span>毕业年份</span><input v-model.trim="form.graduationYear" maxlength="4" :disabled="busy" inputmode="numeric" /></label>
            <label v-else><span>预计毕业年份</span><input v-model.trim="form.expectedGraduationYear" maxlength="4" :disabled="busy" inputmode="numeric" /></label>
          </form>
          <p class="personnel-rule">初始密码：用户名后加 123456。首次登录必须改密。姓名相同可以分别建号；用户名或学号重复会阻止整批创建。</p>
          <section v-if="preview" class="personnel-preview"><h3>{{ isExcel?'2.':'1.' }} 预检结果：{{ preview.total }} 人</h3><p :class="preview.invalid?'personnel-errors':'personnel-valid'">{{ preview.valid }} 行通过，{{ preview.invalid }} 行需修正。预检尚未创建任何账号。</p>
            <div class="personnel-preview-scroll"><table><thead><tr><th>行</th><th>人员</th><th>学籍</th><th>检查结果</th></tr></thead><tbody><tr v-for="row in visibleRows" :key="row.rowNumber"><td>{{ row.rowNumber }}</td><td><strong>{{ row.name||'未填写姓名' }}</strong><small>{{ row.username }} · {{ personTypeLabel(row.personType) }}</small><small>{{ row.studentIdMasked||'未填写学号/工号' }}</small></td><td>{{ row.department }}<small>{{ [row.major,row.className].filter(Boolean).join(' · ') }}</small><small>{{ row.enrollmentYear }}<template v-if="row.graduationYear"> — {{ row.graduationYear }}</template><template v-else-if="row.expectedGraduationYear"> — 预计 {{ row.expectedGraduationYear }}</template></small></td><td><ul v-if="row.errors.length" class="personnel-errors"><li v-for="message in row.errors" :key="message">{{ message }}</li></ul><span v-else class="personnel-valid">可以创建</span></td></tr></tbody></table></div>
            <div v-if="preview.total>20" class="personnel-pages"><button type="button" :disabled="page===1||busy" @click="page--">上一页</button><span>{{ page }} / {{ Math.ceil(preview.total/20) }}</span><button type="button" :disabled="page*20>=preview.total||busy" @click="page++">下一页</button></div>
            <fieldset v-if="!preview.invalid" class="personnel-verification"><legend>{{ isExcel?'3.':'2.' }} 选择核验状态并确认</legend><label><input v-model="verificationMode" type="radio" value="unverified" :disabled="busy" />待实名校验（默认）</label><label><input v-model="verificationMode" type="radio" value="manual" :disabled="busy||!preview.canVerify" />管理员已完成人工核验</label><p v-if="!preview.canVerify">人工核验需要每人都有学院/部门和学号/工号。</p><template v-if="verificationMode==='manual'"><p>本次将记录为管理员人工核验，身份与学籍资料不是学校接口自动返回。</p><label class="personnel-checkbox"><input v-model="confirmed" type="checkbox" :disabled="busy" />我已逐人核对本人身份及有效学籍证明，并确认上述资料真实一致。</label><label class="personnel-basis"><span>核验依据（5–500字）</span><textarea v-model="basis" maxlength="500" rows="3" :disabled="busy" placeholder="填写核验材料类型或授权依据，不要填写完整身份证号或密码" /></label></template></fieldset>
          </section>
        </template>
      </div>
      <footer class="resource-drawer-actions"><button class="button button-ghost" type="button" :disabled="busy" @click="close">{{ result?'完成':'取消' }}</button><button v-if="!result&&!preview" class="button button-primary" type="button" :disabled="busy||(isExcel&&!file)" @click="inspect">{{ busy?'正在检查…':'预检资料与重复项' }}</button><button v-if="preview?.invalid" class="button button-ghost" type="button" :disabled="busy" @click="preview=null">返回修正</button><button v-if="preview&&!preview.invalid" class="button button-primary" type="button" :disabled="!canApply" @click="apply"><UserPlus :size="16" />{{ busy?'正在创建，请勿关闭…':`确认创建 ${preview.total} 人` }}</button></footer>
    </aside>
  </div></Teleport>
</template>

<style scoped>
.resource-drawer-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:24px;border-bottom:1px solid #dae3f1;background:#fff;flex-shrink:0}.resource-drawer-header h2{margin:0;font-size:23px;color:#153453;line-height:1.4}.resource-drawer-header p{margin:9px 0 0}.resource-drawer-header .icon-button{display:grid;place-items:center;flex:0 0 36px;width:36px;height:36px;border:1px solid #d6e0ed;border-radius:10px;background:#f5f8fc}.personnel-body{flex:1;padding:24px}.personnel-upload h3{margin:0 0 10px;font-size:17px}.personnel-upload p{margin:0 0 16px}.resource-drawer-actions{padding:18px 24px;border-top:1px solid #dae3f1;background:#fff}.personnel-drawer .alert{margin-bottom:18px;overflow-wrap:anywhere}.personnel-drawer{height:100dvh}
.personnel-drawer{width:min(960px,calc(100vw - 24px));max-width:none;display:flex;flex-direction:column;max-height:100dvh}.personnel-body{overflow-y:auto;min-height:0}.personnel-drawer .resource-drawer-header p{font-size:13px;color:#64748b;line-height:1.6}.personnel-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.personnel-form label,.personnel-basis{display:flex;flex-direction:column;gap:7px;min-width:0}.personnel-form input,.personnel-form select,.personnel-basis textarea{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:9px;padding:11px;font:inherit;background:white}.personnel-form small,.personnel-rule,.personnel-upload p,.personnel-verification p{font-size:13px;color:#64748b;line-height:1.7}.personnel-rule{padding:13px;background:#f3f6fa;border-radius:10px;margin:18px 0}.personnel-file-actions{display:flex;flex-wrap:wrap;gap:10px}.personnel-file-actions input{position:absolute;width:1px;height:1px;opacity:0}.personnel-filename{overflow-wrap:anywhere}.personnel-preview-scroll{overflow:auto;border:1px solid #e2e8f0;border-radius:10px;max-height:340px}.personnel-preview table{min-width:560px;width:100%;border-collapse:collapse}.personnel-preview th,.personnel-preview td{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid #edf0f4}.personnel-preview td small{display:block;font-size:12px;color:#64748b;margin-top:5px}.personnel-errors{color:#b42318;font-size:13px}.personnel-errors ul,.personnel-errors{padding-left:0;list-style:none}.personnel-errors li+li{margin-top:6px}.personnel-valid{color:#18794e;font-size:13px}.personnel-pages{display:flex;justify-content:center;align-items:center;gap:16px;padding:12px}.personnel-pages button{border:1px solid #dbe2ea;border-radius:6px;padding:6px 12px;background:white}.personnel-verification{margin:22px 0 0;border:1px solid #dbe2ea;border-radius:10px;padding:16px}.personnel-verification>label{display:flex;align-items:flex-start;gap:8px;margin:12px 0}.personnel-verification input{flex:0 0 auto;margin-top:4px}.personnel-verification .personnel-basis{display:flex;flex-direction:column}.personnel-success{text-align:center;padding:40px 16px;line-height:1.8;color:#18794e}.personnel-success p{color:#64748b}.personnel-drawer footer{flex-shrink:0;flex-wrap:wrap}@media(max-width:600px){.personnel-drawer{width:100vw;height:100dvh}.personnel-form{grid-template-columns:1fr}.personnel-preview th,.personnel-preview td{padding:9px}.personnel-file-actions .button{width:100%}}
</style>
