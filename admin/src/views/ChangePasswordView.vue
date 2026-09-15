<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff, KeyRound, LockKeyhole, LogOut, ShieldCheck } from '@lucide/vue'
import { auth } from '../lib/auth.js'
import { schoolBrand } from '../../../server/src/brand.js'

const router = useRouter()
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const saving = ref(false)
const error = ref('')
const passwordValid = computed(() => newPassword.value.length >= 8 && /[A-Za-z]/.test(newPassword.value) && /\d/.test(newPassword.value))
const formValid = computed(() => currentPassword.value && passwordValid.value && newPassword.value === confirmPassword.value && currentPassword.value !== newPassword.value)

async function submit() {
  if (!formValid.value || saving.value) return
  saving.value = true
  error.value = ''
  const username = auth.state.user?.username || ''
  try {
    await auth.changePassword(currentPassword.value, newPassword.value)
    await router.replace({ name: 'login', query: { changed: '1', ...(username ? { username } : {}) } })
  } catch (cause) {
    if (cause.status === 401 || !auth.isAdmin.value) {
      await router.replace({ name: 'login', query: { reason: 'expired', ...(username ? { username } : {}) } })
      return
    }
    error.value = cause.message || '密码修改失败，请检查临时密码后重试'
  } finally { saving.value = false }
}

async function switchAccount() {
  if (saving.value) return
  saving.value = true
  try { await auth.logout() } finally {
    saving.value = false
    await router.replace({ name: 'login' })
  }
}
</script>

<template>
  <main class="password-change-page">
    <section class="password-change-card">
      <header>
        <img :src="schoolBrand.logoUrl" :alt="schoolBrand.name" />
        <div class="password-change-icon"><KeyRound :size="26" /></div>
        <p>FIRST LOGIN SECURITY</p>
        <h1>首次登录必须修改密码</h1>
        <span>该账号使用全局管理员签发的临时密码。完成修改并重新登录前，不能进入任何业务板块。</span>
      </header>

      <div class="password-change-user"><ShieldCheck :size="18" /><div><strong>{{ auth.state.user?.name || auth.state.user?.displayName || auth.state.user?.username }}</strong><span>{{ auth.state.user?.department || '平台运营账号' }}</span></div></div>
      <div v-if="error" class="alert alert-error" role="alert"><LockKeyhole :size="18" />{{ error }}</div>

      <form @submit.prevent="submit">
        <label><span>当前临时密码</span><div><input v-model="currentPassword" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="输入管理员提供的临时密码" /></div></label>
        <label><span>新密码</span><div><input v-model="newPassword" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" placeholder="至少 8 位，包含字母和数字" /></div></label>
        <label><span>确认新密码</span><div><input v-model="confirmPassword" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" placeholder="再次输入新密码" /></div></label>
        <button class="password-visibility" type="button" :aria-pressed="showPassword" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="16" /><Eye v-else :size="16" />{{ showPassword ? '隐藏密码' : '显示密码' }}</button>
        <p class="password-rule" :class="{ valid: passwordValid }">{{ passwordValid ? '✓' : 'i' }} 新密码至少 8 位，并同时包含字母和数字，且不能与临时密码相同。</p>
        <button class="button button-primary button-block" type="submit" :disabled="!formValid || saving"><span v-if="saving" class="spinner small"></span>{{ saving ? '正在修改…' : '修改密码并重新登录' }}</button>
        <button class="password-switch-account" type="button" :disabled="saving" @click="switchAccount"><LogOut :size="16" />退出并更换账号</button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.password-change-page{min-height:100vh;padding:32px 18px;display:grid;place-items:center;background:radial-gradient(circle at 18% 12%,rgba(198,161,91,.12),transparent 32%),linear-gradient(145deg,#052d60,#071a36)}
.password-change-card{width:min(500px,100%);padding:32px;border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.28)}
header{text-align:center}header img{width:min(300px,80%);height:52px;margin:0 auto 24px;object-fit:contain}.password-change-icon{width:58px;height:58px;margin:0 auto 13px;display:grid;place-items:center;border-radius:17px;color:#775a24;background:#f7f0e2}header p{color:#a17c37;font-size:10px;font-weight:800;letter-spacing:.13em}header h1{margin:6px 0 10px;color:#193653;font-size:25px}header>span{display:block;color:#718095;font-size:12px;line-height:1.75}
.password-change-user{margin:23px 0 17px;padding:13px 14px;display:flex;align-items:center;gap:11px;border-radius:10px;color:#16456f;background:#eef5fc}.password-change-user div{display:flex;flex-direction:column;gap:2px}.password-change-user strong{font-size:13px}.password-change-user span{color:#71849a;font-size:10px}
form{display:grid;gap:15px}label>span{display:block;margin:0 2px 7px;color:#405870;font-size:11px;font-weight:700}label>div{height:44px;border:1px solid #cbd6e2;border-radius:9px;background:#fbfcfe}label input{width:100%;height:100%;padding:0 12px;border:0;outline:0;background:transparent;color:#233c55;font-size:13px}label>div:focus-within{border-color:#739bc5;box-shadow:0 0 0 3px rgba(0,63,135,.08)}.password-visibility{justify-self:end;display:flex;align-items:center;gap:6px;color:#526a84;background:transparent;cursor:pointer;font-size:11px}.password-rule{padding:10px 12px;border-radius:8px;color:#8b6d36;background:#fbf5e8;font-size:10px;line-height:1.55}.password-rule.valid{color:#22705b;background:#eaf6f1}
.password-switch-account{min-height:40px;display:flex;align-items:center;justify-content:center;gap:7px;color:#60738a;background:transparent;cursor:pointer;font-size:12px}
@media(max-width:520px){.password-change-page{padding:0;background:#fff}.password-change-card{min-height:100vh;padding:30px 20px;border-radius:0;box-shadow:none}header h1{font-size:22px}}
</style>
