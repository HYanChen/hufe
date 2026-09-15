<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Building2, ExternalLink, KeyRound, LockKeyhole, LogIn,
  ScrollText, ShieldCheck, UserCog, UserRound
} from '@lucide/vue'
import { auth } from '../lib/auth.js'
import { schoolBrand } from '../../../server/src/brand.js'

const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const notice = ref('')
const busy = ref(false)
const logoUrl = schoolBrand.logoUrl

function safeRedirect(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard'
}

async function submitLogin() {
  const normalizedUsername = username.value.trim()
  if (!normalizedUsername || !password.value) {
    error.value = '请输入管理员账号和密码'
    return
  }
  error.value = ''
  busy.value = true
  try {
    await auth.login(normalizedUsername, password.value)
    password.value = ''
    await router.replace(safeRedirect(route.query.redirect))
  } catch (cause) {
    password.value = ''
    error.value = cause.message || '登录失败，请检查账号和密码'
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  if (route.query.reason === 'expired') error.value = auth.state.sessionError || '后台会话已失效，请重新登录。'
  if (route.query.reason === 'replaced') error.value = '账号已在其他设备登录，当前设备已退出。'
  if (!error.value && auth.state.sessionError) error.value = auth.state.sessionError
  if (route.query.changed === '1') notice.value = '密码修改成功，旧会话已安全退出，请使用新密码重新登录。'
  if (typeof route.query.username === 'string') username.value = route.query.username
})
</script>

<template>
  <main class="login-page">
    <section class="login-brand-panel">
      <div class="login-brand-inner">
        <a class="login-logo" href="https://www.hufe.edu.cn/" target="_blank" rel="noopener noreferrer">
          <img :src="logoUrl" alt="湖南财政经济学院" />
        </a>
        <p class="login-product-label">HUFE UNIFIED SERVICE PLATFORM</p>
        <h1>连接湖财每一位<br />师生、教职工与校友</h1>
        <p class="login-brand-lead">学校官网实名校验仅用于新用户注册；注册完成后，日常使用湖财人平台账号登录。</p>
        <div class="login-features">
          <div><span><Building2 :size="20" /></span><p><strong>注册实名校验</strong><small>仅新用户注册时跳转学校官方页面</small></p></div>
          <div><span><UserCog :size="20" /></span><p><strong>独立管理账号</strong><small>后台登录不使用学校统一认证</small></p></div>
          <div><span><ScrollText :size="20" /></span><p><strong>权限与审计</strong><small>服务端校验管理员权限并记录操作</small></p></div>
        </div>
        <blockquote>“正德厚生 经世济用”</blockquote>
      </div>
    </section>

    <section class="login-form-panel">
      <div class="login-form-wrap">
        <div class="login-mobile-logo"><img :src="logoUrl" alt="湖南财政经济学院" /></div>
        <div class="login-title-row">
          <div class="login-title-icon"><KeyRound :size="25" /></div>
          <div><p>湖财人管理后台</p><h2>管理员账号登录</h2></div>
        </div>
        <p class="login-intro">请使用湖财人平台账号和密码。登录成功后，服务端将校验全局或委派管理范围。</p>

        <div v-if="notice" class="alert login-success" role="status"><ShieldCheck :size="19" /><span>{{ notice }}</span></div>
        <div v-if="error" class="alert alert-error" role="alert"><LockKeyhole :size="19" /><span>{{ error }}</span></div>

        <form class="login-credentials" @submit.prevent="submitLogin">
          <label class="login-field">
            <span class="login-field-label">管理员账号</span>
            <span class="login-input-wrap"><UserRound :size="18" /><input v-model="username" type="text" name="username" autocomplete="username" inputmode="text" autofocus :disabled="busy" placeholder="请输入平台账号" /></span>
          </label>
          <label class="login-field">
            <span class="login-field-label">密码</span>
            <span class="login-input-wrap"><LockKeyhole :size="18" /><input v-model="password" type="password" name="password" autocomplete="current-password" :disabled="busy" placeholder="请输入平台密码" /></span>
          </label>
          <button class="admin-login-button" type="submit" :disabled="busy">
            <span>{{ busy ? '正在安全登录…' : '登录管理后台' }}</span>
            <LogIn :size="20" />
          </button>
        </form>

        <div class="login-security-note">
          <ShieldCheck :size="20" />
          <p><strong>学校官网校验不是后台登录</strong><span>学校账号只在新用户注册时于学校官方页面输入，不得填入本页。</span></p>
        </div>
        <div class="login-links">
          <a href="https://www.hufe.edu.cn/" target="_blank" rel="noopener noreferrer">学校官网<ExternalLink :size="14" /></a>
          <span>·</span><span>后台操作全程记入审计日志</span>
        </div>
      </div>
      <footer>© {{ new Date().getFullYear() }} 湖南财政经济学院 · 开发团队：长沙宸古科技有限责任公司</footer>
    </section>
  </main>
</template>
