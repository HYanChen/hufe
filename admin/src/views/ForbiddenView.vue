<script setup>
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ArrowRight, ShieldX } from '@lucide/vue'
import { auth } from '../lib/auth.js'

const route = useRoute()
const target = computed(() => String(route.query.target || '该管理板块'))
const nextRoute = computed(() => auth.firstAccessibleRoute())
</script>

<template>
  <section class="panel forbidden-panel" role="alert">
    <div class="forbidden-icon"><ShieldX :size="34" /></div>
    <p class="eyebrow">ACCESS RESTRICTED</p>
    <h1>当前账号无权访问{{ target }}</h1>
    <p>委派管理员只能查看和处理服务端已授权的板块与数据。若职责发生变化，请联系全局管理员调整管理范围。</p>
    <RouterLink v-if="nextRoute !== 'forbidden'" class="button button-primary" :to="{ name: nextRoute }">进入已授权板块<ArrowRight :size="16" /></RouterLink>
    <p v-else class="alert alert-warning">当前账号尚未获得任何板块权限，请联系全局管理员授权后重新登录。</p>
  </section>
</template>
