<script setup>
import { computed, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ShieldCheck, Save, ClipboardCheck, RefreshCw } from '@lucide/vue'
import PageHeader from '../components/PageHeader.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { api } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'

const model = ref(null)
const form = ref(null)
const origins = ref('')
const baseline = ref('')
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const message = ref('')
const clearSecret = ref(false)
const confirmation = ref('')
const schoolConfirmed = ref(false)
const attributes = [
  ['name', '真实姓名 *'], ['department', '学院 / 部门 *'], ['studentId', '学号 / 工号'],
  ['major', '专业'], ['className', '班级'], ['enrollmentYear', '入学年份'], ['graduationYear', '毕业年份'],
  ['expectedGraduationYear', '预计毕业年份（在校生）'],
  ['idCard', '身份证号（可选）'], ['personType', '人员类型'], ['affiliation', '师生类别'], ['alumniStatus', '校友状态']
]
const snapshot = () => JSON.stringify([form.value, origins.value, clearSecret.value])
const dirty = computed(() => Boolean(form.value) && snapshot() !== baseline.value)
const checkPassed = computed(() => !dirty.value && model.value?.lastCheck?.valid && model.value.lastCheck.revision === model.value.revision)
const statusLabel = computed(() => ({ enabled: '校验入口已启用', disabled: '校验入口已停用', configuration_required: '等待配置完成' })[model.value?.status.status] || '正在读取配置')
const callback = computed(() => {
  try { return new URL(form.value.protocol === 'oidc' ? '/api/v1/auth/registration/oidc/callback' : '/api/v1/auth/registration/callback', form.value.publicBaseUrl).toString() }
  catch { return '填写正式 API 域名后自动生成' }
})

function apply(value) {
  model.value = value
  form.value = structuredClone(value.settings)
  origins.value = value.settings.returnUrlOrigins.join('\n')
  clearSecret.value = false
  schoolConfirmed.value = false
  baseline.value = snapshot()
}
async function load() {
  if (dirty.value && !window.confirm('重新加载会放弃尚未保存的配置，是否继续？')) return
  loading.value = true
  error.value = ''
  try { apply(await api('/admin/school-auth-config')) }
  catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}
async function save() {
  busy.value = true
  error.value = ''; message.value = ''
  try {
    apply(await api('/admin/school-auth-config', {
      method: 'PUT', body: { expectedRevision: model.value.revision, clearOidcSecret: clearSecret.value,
        settings: { ...form.value, returnUrlOrigins: origins.value.split(/[\n,，]/).map(value => value.trim()).filter(Boolean) } }
    }))
    message.value = '草稿已保存，当前生效配置不变。下一步请检查配置。'
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
async function act(action) {
  busy.value = true
  error.value = ''; message.value = ''
  try {
    const result = await api(`/admin/school-auth-config/${action}`, {
      method: 'POST', body: { expectedRevision: model.value.revision, schoolConfirmed: schoolConfirmed.value }
    })
    apply(result)
    confirmation.value = ''
    message.value = action === 'activate' ? '已启用当前配置，前台重新进入注册页即可读取。实际实名结果仍由学校校验。'
      : action === 'disable' ? '已停用学校自动校验，人工认证和平台账号登录不受影响。'
        : result.lastCheck.valid ? '配置检查通过；请确认学校登记信息后启用。此检查不等于学校联调成功。' : '发现配置问题，请根据下方检查结果修改。'
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
onBeforeRouteLeave(() => !dirty.value || window.confirm('还有未保存的学校配置，确定离开吗？'))
onMounted(load)
</script>

<template>
  <div class="school-config">
    <PageHeader title="学校实名校验配置" description="配置新用户注册的学校身份核验通道。平台账号仍使用独立用户名和密码登录。">
      <template #actions><button class="button button-secondary" :disabled="loading || busy" @click="load"><RefreshCw :size="16" />重新加载</button></template>
    </PageHeader>
    <p v-if="error" class="config-alert config-alert--error" role="alert">{{ error }}</p>
    <p v-if="message" class="config-alert" role="status">{{ message }}</p>
    <p v-if="loading" class="config-card">正在读取学校实名校验配置…</p>
    <template v-else-if="model && form">
      <section class="config-card config-status">
        <ShieldCheck :size="28" />
        <div><h2>{{ statusLabel }}</h2><p>{{ model.status.message }}</p><small>配置来源：{{ model.source === 'admin' ? '后台配置' : '服务器初始配置' }} · 草稿版本 {{ model.revision }} · 生效版本 {{ model.activeRevision }}</small></div>
        <button v-if="model.status.ready" class="button button-secondary" :disabled="busy" @click="confirmation = 'disable'">停用校验</button>
      </section>
      <ol class="config-steps"><li>1. 填写并保存草稿</li><li>2. 检查参数与部署条件</li><li>3. 学校登记后启用</li></ol>
      <form @submit.prevent="save">
        <fieldset :disabled="busy" class="config-fields">
          <section class="config-card">
            <h2>通道与回调</h2>
            <p>回调地址必须先由学校信息部门登记。本机可配置草稿，但不能用 localhost 完成学校回调。当前服务部署地址：{{ model.deployedApiBaseUrl }}</p>
            <div class="config-grid">
              <label>学校认证方式<select v-model="form.protocol"><option value="cas">CAS（学校统一身份认证）</option><option value="oidc">OIDC（学校分配应用编号）</option></select></label>
              <label>正式 API 域名<input v-model.trim="form.publicBaseUrl" type="text" inputmode="url" placeholder="https://实际部署的API域名" maxlength="300" /><small>只填域名及协议，不填 /api 等路径。</small></label>
              <label class="config-wide">需向学校登记的回调地址<input :value="callback" readonly aria-label="学校回调地址" @focus="$event.target.select()" /><small>点击后可复制。登记地址须完全一致；CAS 回调不附加 session 或 state 查询参数。</small></label>
              <label class="config-wide">注册完成后允许返回的前台域名（每行一项）<textarea v-model="origins" rows="3" /><small>仅可使用服务器已许可的域名：{{ model.corsOrigins.join('、') }}。新增部署域名需先加入服务器跨域白名单。</small></label>
            </div>
          </section>
          <section class="config-card">
            <h2>{{ form.protocol === 'cas' ? 'CAS 接口参数' : 'OIDC 应用参数' }}</h2>
            <p>学校地址限服务器许可域名：{{ model.allowedSchoolHosts.join('、') }}。如学校更换认证域名，需先由部署管理员加入许可名单。</p>
            <div v-if="form.protocol === 'cas'" class="config-grid">
              <label class="config-wide">学校认证基础地址<input v-model.trim="form.casBaseUrl" type="text" inputmode="url" maxlength="500" /></label>
              <label>登录接口路径<input v-model.trim="form.casLoginPath" placeholder="/login" maxlength="100" /></label>
              <label>票据验证接口路径<input v-model.trim="form.casValidatePath" placeholder="/serviceValidate" maxlength="100" /></label>
            </div>
            <div v-else class="config-grid">
              <label class="config-wide">学校颁发者地址（Issuer）<input v-model.trim="form.oidcIssuer" type="text" inputmode="url" maxlength="500" /><small>当前适配学校 CAS OIDC：从此地址下的 /oidc/.well-known/openid-configuration 读取配置。</small></label>
              <label>应用编号（Client ID）<input v-model.trim="form.oidcClientId" maxlength="300" /></label>
              <label>客户端密钥<input v-model="form.oidcClientSecret" type="password" autocomplete="new-password" :placeholder="model.secretConfigured ? '已设置，留空保留原密钥' : '尚未设置'" maxlength="4096" /></label>
              <label>密钥提交方式<select v-model="form.oidcTokenAuthMethod"><option value="client_secret_basic">HTTP Basic</option><option value="client_secret_post">请求体</option><option value="none">无客户端密钥（学校明确允许时）</option></select></label>
              <label>授权范围（Scope）<input v-model.trim="form.oidcScopes" maxlength="500" /></label>
              <label class="config-check config-wide"><input v-model="clearSecret" type="checkbox" />明确清除已保存的客户端密钥</label>
            </div>
          </section>
          <section class="config-card">
            <h2>实名字段映射</h2>
            <p>填写学校实际返回的字段名，不是用户的身份资料。姓名与学院 / 部门必须由学校下发；学号和身份证仅在获授权时接收并脱敏显示。</p>
            <div class="config-grid"><label v-for="[key, label] in attributes" :key="key">{{ label }}<input v-model.trim="form.attributes[key]" maxlength="100" /></label></div>
            <p class="config-security">管理员身份授权、数据密钥、服务器路径和监听端口不在此处配置。保存参数不会授予任何用户实名资格。</p>
          </section>
          <div class="config-save"><span>{{ dirty ? '有未保存的更改' : model.hasUnpublishedChanges ? '草稿尚未启用' : '配置已保存' }}</span><button class="button button-primary" type="submit" :disabled="busy"><Save :size="16" />{{ busy ? '处理中…' : '保存草稿' }}</button></div>
        </fieldset>
      </form>
      <section class="config-card">
        <div class="config-heading"><h2>检查与启用</h2><button class="button button-secondary" :disabled="busy || dirty || !model.revision" @click="act('check')"><ClipboardCheck :size="16" />检查已保存配置</button></div>
        <p>检查不访问学校账号，不执行登录，也不保证学校已完成对接。启用前请学校确认回调登记、属性下发和正式 HTTPS 部署。</p>
        <ul v-if="model.lastCheck" class="config-checks"><li v-for="item in model.lastCheck.checks" :key="item.key" :class="{ failed: !item.ok }"><strong>{{ item.ok ? '通过' : '待处理' }} · {{ item.label }}</strong><span>{{ item.message }}</span></li></ul>
        <p v-else>保存草稿后执行检查，将逐项列出需要处理的问题。</p>
        <label class="config-check"><input v-model="schoolConfirmed" type="checkbox" :disabled="busy || !checkPassed" />我已与学校确认：上述回调已登记，应用已获准接收实名属性。</label>
        <div class="config-enable"><small>上次保存：{{ formatDateTime(model.updatedAt) }}<br />上次启用：{{ formatDateTime(model.activatedAt) }}</small><button class="button button-primary" :disabled="busy || !checkPassed || !schoolConfirmed" @click="confirmation = 'activate'">启用已保存配置</button></div>
        <p class="config-security">配置切换或停用后，正在进行的旧学校校验需重新发起；已注册账号的登录、既有实名状态和人工复核流程不受影响。</p>
      </section>
    </template>
    <ConfirmDialog :open="Boolean(confirmation)" :title="confirmation === 'activate' ? '启用学校实名校验配置' : '停用学校自动实名校验'" :description="confirmation === 'activate' ? '将使用已保存参数开启前台校验入口。此操作不代表学校登录已实测通过。进行中的旧校验将失效。' : '前台将停止发起学校自动校验，用户仍可登录已有账号或申请人工复核。进行中的旧校验将失效。'" :tone="confirmation === 'activate' ? 'primary' : 'danger'" :busy="busy" @cancel="confirmation = ''" @confirm="act(confirmation)" />
  </div>
</template>

<style scoped>
.school-config{max-width:1180px}.config-card{background:#fff;border:1px solid #dce4ef;border-radius:18px;padding:26px;margin:18px 0;min-width:0}.config-card h2{font-size:19px;margin:0 0 10px;color:#102e55}.config-card p{font-size:15px;line-height:1.7;color:#65748b;margin:8px 0 20px}.config-card small{font-size:13px;color:#76859b;line-height:1.65;overflow-wrap:anywhere}.config-status{display:flex;align-items:center;gap:18px;border-left:4px solid #033481}.config-status>svg{color:#033481;flex-shrink:0}.config-status>div{flex:1;min-width:0}.config-status p{margin-bottom:8px}.config-steps{list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:0;margin:22px 0;color:#284a76;font-size:15px}.config-steps li{padding:14px 16px;background:#eaf0f8;border-radius:10px}.config-fields{border:0;padding:0;margin:0;min-width:0}.config-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.config-grid label{display:flex;flex-direction:column;gap:8px;font-size:15px;font-weight:600;color:#374c69;min-width:0}.config-wide{grid-column:1/-1}.config-grid input,.config-grid select,.config-grid textarea{width:100%;min-width:0;box-sizing:border-box;border:1px solid #cbd8e9;border-radius:9px;padding:12px;font:400 16px/1.5 inherit;color:#1f3658;background:#fff;font-size:16px;font-weight:400}.config-grid input:focus,.config-grid select:focus,.config-grid textarea:focus{outline:2px solid #2563b9;outline-offset:2px}.config-grid input[readonly]{background:#f3f6fb}.config-grid textarea{resize:vertical;min-height:92px}.config-grid label small{font-weight:400}.config-save,.config-enable,.config-heading{display:flex;justify-content:space-between;gap:18px;align-items:center;flex-wrap:wrap}.config-save{padding:4px 0 10px;font-size:14px;color:#66778f}.config-heading h2{margin:0}.config-check,.config-grid .config-check{display:flex;flex-direction:row;align-items:flex-start;gap:10px;font-size:15px;line-height:1.7;color:#3d5371;margin:20px 0}.config-check input,.config-grid .config-check input{width:18px;height:18px;flex-shrink:0;margin:4px 0;accent-color:#033481}.config-checks{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.config-checks li{padding:16px;border-radius:10px;background:#eff7f4;color:#235c4b;font-size:14px}.config-checks .failed{background:#fff3e1;color:#805814}.config-checks strong,.config-checks span{display:block;line-height:1.7;overflow-wrap:anywhere}.config-alert{padding:16px 20px;background:#e8f4ee;border:1px solid #c6e1d1;border-radius:12px;color:#245a46;line-height:1.7}.config-alert--error{background:#fff1ee;border-color:#edc8c2;color:#8f3326}.config-card .config-security{font-size:14px;margin:20px 0 0;padding-top:18px;border-top:1px solid #e8edf4}.config-enable{margin:20px 0}.school-config button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:700px){.config-grid,.config-steps,.config-checks{grid-template-columns:1fr}.config-card{padding:20px 16px}.config-status{flex-wrap:wrap}.config-status>div{flex-basis:70%}.config-save .button,.config-enable .button{width:100%}}
</style>
