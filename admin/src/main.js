import { createApp } from 'vue'
import App from './App.vue'
import router from './router.js'
import { auth } from './lib/auth.js'
import './styles.css'

auth.bootstrap().finally(() => {
  createApp(App).use(router).mount('#app')
  const checkSession = async () => {
    if(document.hidden)return
    const user=await auth.bootstrap(true)
    if(user&&router.currentRoute.value.name==='login')router.replace({name:user.mustChangePassword?'changePassword':auth.firstAccessibleRoute()})
  }
  setInterval(checkSession,30000)
  document.addEventListener('visibilitychange',checkSession)
})
