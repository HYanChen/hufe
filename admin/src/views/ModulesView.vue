<script setup>
import { computed,onMounted,ref,watch } from 'vue'
import { api } from '../lib/api.js'
import { auth } from '../lib/auth.js'
import { applyModuleConfig } from '../lib/modules.js'
import PageHeader from '../components/PageHeader.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const items=ref([]),core=ref([]),revision=ref(0),query=ref(''),status=ref('all')
const loading=ref(false),saving=ref(false),loaded=ref(false),error=ref(''),notice=ref(''),target=ref(null),reason=ref(''),dialogError=ref('')
const enabledCount=computed(()=>items.value.filter(row=>row.enabled).length)
const groups=computed(()=>{
  const matches=items.value.filter(row=>(status.value==='all'||row.enabled===(status.value==='enabled'))&&`${row.name} ${row.description} ${row.group}`.includes(query.value.trim()))
  return [...new Set(matches.map(row=>row.group))].map(name=>({name,items:matches.filter(row=>row.group===name)}))
})
async function load(){
  if(loading.value)return
  loading.value=true;error.value=''
  try{const result=await api('/admin/modules');items.value=result.items;core.value=result.core;revision.value=result.revision;applyModuleConfig(result);loaded.value=true}
  catch(e){error.value=e.message||'模块配置读取失败，请重试'}finally{loading.value=false}
}
function prepare(row){target.value={...row,revision:revision.value,actorId:auth.state.user?.id};reason.value='';dialogError.value='';notice.value=''}
function cancel(){if(!saving.value){target.value=null;dialogError.value=''}}
async function save(){
  if(!target.value||saving.value||reason.value.trim().length<5)return
  if(!auth.isSuperAdmin.value||target.value.actorId!==auth.state.user?.id){target.value=null;error.value='登录账号或权限已变化，请重新进入模块管理。';return}
  saving.value=true;dialogError.value=''
  try{
    const row=target.value
    const result=await api(`/admin/modules/${encodeURIComponent(row.id)}`,{method:'PATCH',body:{revision:row.revision,enabled:!row.enabled,reason:reason.value.trim()}})
    applyModuleConfig(result);notice.value=`${row.name}已${row.enabled?'关闭':'启用'}，历史数据保持不变。`
    target.value=null;await load()
  }catch(e){
    dialogError.value=e.message||'保存失败，配置未更改'
    if(e.code==='MODULE_REVISION_CONFLICT'){await load();target.value=null;error.value='配置已被其他管理员修改，已重新读取。请核对最新状态后再次操作。'}
  }finally{saving.value=false}
}
onMounted(load)
watch(()=>auth.state.user?.id,()=>{target.value=null;reason.value='';dialogError.value=''})
</script>

<template>
  <div class="modules-page">
    <PageHeader title="模块管理" description="按需开启或关闭业务模块。关闭后，前后台入口隐藏，旧链接和业务接口停止访问；再次启用即可恢复，已有数据不会删除。">
      <template #actions><button class="button button-secondary" type="button" :disabled="loading||saving" @click="load">{{ loading?'正在读取…':'刷新配置' }}</button></template>
    </PageHeader>
    <p v-if="error" class="modules-alert modules-alert--error" role="alert">{{ error }}</p>
    <p v-if="notice" class="modules-alert modules-alert--success" role="status">{{ notice }}</p>
    <section class="modules-overview" aria-label="模块状态概览">
      <div><strong>{{ loaded?enabledCount:'—' }}</strong><span>已启用</span></div>
      <div><strong>{{ loaded?items.length-enabledCount:'—' }}</strong><span>已关闭</span></div>
      <p>仅全局管理员可以操作。每次变更均需填写原因，并记录在审计日志中。</p>
    </section>
    <div class="modules-filters">
      <label><span>搜索模块</span><input v-model="query" type="search" placeholder="输入模块名称或功能" maxlength="100" /></label>
      <label><span>启用状态</span><select v-model="status"><option value="all">全部模块</option><option value="enabled">已启用</option><option value="disabled">已关闭</option></select></label>
    </div>
    <p v-if="loading&&!loaded" role="status" class="modules-empty">正在加载模块配置…</p>
    <p v-else-if="loaded&&!groups.length" class="modules-empty">没有匹配的模块，请调整搜索条件。</p>
    <section v-for="group in groups" :key="group.name" class="module-group">
      <h2>{{ group.name }}</h2>
      <div class="modules-grid">
        <article v-for="row in group.items" :key="row.id" class="module-card" :class="{'module-card--disabled':!row.enabled}">
          <div class="module-card__heading"><h3>{{ row.name }}</h3><span class="module-status" :class="{'module-status--disabled':!row.enabled}">{{ row.enabled?'已启用':'已关闭' }}</span></div>
          <p>{{ row.description }}</p>
          <div class="module-card__footer"><span>{{ row.enabled?'前后台可用':'入口已隐藏 · 数据保留' }}</span><button class="button button-secondary" type="button" :disabled="loading||saving" :aria-label="`${row.enabled?'关闭':'启用'}${row.name}`" @click="prepare(row)">{{ row.enabled?'关闭模块':'启用模块' }}</button></div>
        </article>
      </div>
    </section>
    <section v-if="loaded" class="modules-core">
      <h2>始终保留的基础能力</h2><p>基础模块不提供关闭开关，确保身份验证、系统安全及恢复入口始终可用。</p>
      <div v-for="row in core" :key="row.id"><strong>{{ row.name }}</strong><span>{{ row.description }}</span><small>始终启用</small></div>
    </section>
    <ConfirmDialog :open="!!target" :title="`${target?.enabled?'关闭':'启用'}${target?.name||'模块'}`" :description="target?.enabled?'关闭后，用户和后台人员将无法访问该模块；已有记录及文件仍会保留，稍后可重新启用。':'启用后恢复前后台入口和业务接口，原有记录继续保留。'" :confirm-text="target?.enabled?'确认关闭':'确认启用'" :confirm-disabled="reason.trim().length<5" :busy="saving" @cancel="cancel" @confirm="save">
      <label class="module-reason"><span>操作原因（必填）</span><textarea v-model="reason" rows="3" minlength="5" maxlength="300" placeholder="请填写5至300字操作原因" /></label>
      <p v-if="dialogError" class="modules-alert--error" role="alert">{{ dialogError }}</p>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.modules-page{min-width:0}.modules-overview{display:flex;align-items:center;gap:32px;padding:24px;background:#fff;border:1px solid #dfe6f0;border-radius:16px;margin:24px 0}.modules-overview>div{display:flex;align-items:baseline;gap:8px;white-space:nowrap}.modules-overview strong{font-size:28px;color:#073a82}.modules-overview span,.modules-overview p{font-size:14px;color:#60738e}.modules-overview p{margin:0 0 0 auto;max-width:420px;line-height:1.7}.modules-filters{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:16px;margin-bottom:28px}.modules-filters label,.module-reason{display:grid;gap:8px;font-size:14px;color:#506787}.modules-filters input,.modules-filters select,.module-reason textarea{width:100%;min-width:0;box-sizing:border-box;padding:12px 14px;background:white;border:1px solid #cfdaeb;border-radius:10px;color:#183756;font:inherit}.module-group{margin-bottom:28px}.module-group h2,.modules-core h2{font-size:18px;margin:0 0 14px}.modules-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.module-card{min-width:0;display:flex;flex-direction:column;background:white;border:1px solid #dbe4f0;border-radius:16px;padding:20px}.module-card--disabled{background:#f8f9fc}.module-card__heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.module-card h3{margin:0;font-size:17px;overflow-wrap:anywhere}.module-status{flex-shrink:0;font-size:12px;border-radius:14px;color:#12664f;background:#e7f4ee;padding:4px 8px}.module-status--disabled{color:#6b788d;background:#e9edf3}.module-card p{color:#718197;font-size:14px;line-height:1.7;flex:1;margin:14px 0 20px}.module-card__footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.module-card__footer span{color:#8090a3;font-size:12px}.module-card .button{white-space:nowrap;padding:8px 12px;font-size:13px}.modules-core{background:#eef3fa;border-radius:16px;padding:24px;margin-top:36px}.modules-core>p{font-size:14px;color:#6d7e96;line-height:1.7}.modules-core>div{display:grid;grid-template-columns:130px minmax(0,1fr) 70px;gap:16px;padding:16px 0;border-top:1px solid #dce5f1;font-size:14px}.modules-core span{color:#677b97;line-height:1.6}.modules-core small{color:#457e6d;text-align:right}.modules-alert{padding:12px 16px;border-radius:10px;font-size:14px;line-height:1.7}.modules-alert--error{color:#a23232;background:#fff1f0}.modules-alert--success{color:#21674e;background:#edf8f1}.modules-empty{text-align:center;padding:40px;color:#7c8ba0}.module-reason{margin-top:20px}.module-reason textarea{resize:vertical;max-height:240px}@media(max-width:1300px){.modules-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.modules-overview{gap:24px;flex-wrap:wrap}.modules-overview p{flex-basis:100%;max-width:none;margin:0}}@media(max-width:650px){.modules-grid{grid-template-columns:minmax(0,1fr)}.modules-filters{grid-template-columns:minmax(0,1fr)}.modules-core>div{grid-template-columns:minmax(0,1fr) auto;gap:6px}.modules-core span{grid-column:1/-1;grid-row:2}.modules-core{padding:20px}.module-card__footer{flex-wrap:wrap;row-gap:12px}}
</style>
