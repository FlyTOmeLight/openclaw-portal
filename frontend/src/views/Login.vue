<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="login-brand-kicker">OpenClaw</div>
        <div class="login-brand-title">控制中心</div>
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <div class="input-group" :class="{ error: errorMsg }">
          <input
            ref="passwordInput"
            v-model="password"
            :type="showPw ? 'text' : 'password'"
            placeholder="输入访问密码"
            autocomplete="current-password"
            :disabled="loading"
            @input="errorMsg = ''"
          />
          <button type="button" class="eye-btn" @click="showPw = !showPw" tabindex="-1" aria-label="Toggle password visibility">
            <svg v-if="!showPw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
              <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
              <path d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>
            </svg>
          </button>
        </div>
        <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>
        <button type="submit" class="login-btn" :disabled="loading || !password">
          {{ loading ? '验证中…' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { clearAuthCache } from '../router/auth-cache.js'

const router = useRouter()
const password = ref('')
const showPw = ref(false)
const errorMsg = ref('')
const loading = ref(false)
const passwordInput = ref<HTMLInputElement>()

onMounted(async () => {
  // If auth is disabled server-side, this page should never be visible.
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const res = await fetch(`${base}/api/auth/status`)
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      if (data && data.enabled === false) {
        router.replace('/')
        return
      }
    }
  } catch {}
  passwordInput.value?.focus()
})

async function handleLogin() {
  if (!password.value || loading.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    })
    if (res.ok) {
      clearAuthCache()
      router.replace('/')
    } else {
      const data = await res.json().catch(() => ({}))
      errorMsg.value = data.error || '密码错误'
    }
  } catch {
    errorMsg.value = '网络连接失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(99, 102, 241, 0.06), transparent 50%),
    radial-gradient(ellipse at 70% 80%, rgba(168, 162, 158, 0.05), transparent 40%),
    linear-gradient(180deg, #fafaf9 0%, #f5f5f4 50%, #f0efed 100%);
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 380px;
  background: var(--surface, rgba(255, 255, 255, 0.98));
  border: 1px solid var(--card-border, rgba(28, 25, 23, 0.07));
  border-radius: var(--radius-xl, 20px);
  padding: 40px 36px;
  box-shadow:
    0 8px 28px rgba(28, 25, 23, 0.06),
    0 2px 6px rgba(28, 25, 23, 0.03);
}

.login-brand {
  text-align: center;
  margin-bottom: 32px;
}

.login-brand-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 9999px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  color: var(--accent, #6366f1);
  background: var(--accent-subtle, rgba(99, 102, 241, 0.08));
  text-transform: uppercase;
}

.login-brand-title {
  font-size: 24px;
  font-weight: 720;
  color: var(--text-primary, #1c1917);
  letter-spacing: -0.03em;
  margin-top: 12px;
  line-height: 1.1;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input-group {
  position: relative;
}

.input-group input {
  width: 100%;
  padding: 12px 42px 12px 16px;
  font-size: 15px;
  font-family: inherit;
  border: 1px solid var(--border, rgba(28, 25, 23, 0.08));
  border-radius: var(--radius, 12px);
  background: var(--input-bg, rgba(255, 255, 255, 0.96));
  color: var(--text-primary, #1c1917);
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease;
  box-sizing: border-box;
}

.input-group input:focus {
  border-color: var(--accent, #6366f1);
  box-shadow: 0 0 0 3px var(--accent-glow, rgba(99, 102, 241, 0.14));
}

.eye-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-muted, #a8a29e);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 160ms ease;
}
.eye-btn:hover {
  color: var(--text-secondary, #57534e);
}

.input-group.error input {
  border-color: var(--error-text, #b91c1c);
  box-shadow: 0 0 0 3px rgba(185, 28, 28, 0.1);
}

.error-text {
  margin: -8px 0 0;
  font-size: 13px;
  color: var(--error-text, #b91c1c);
}

.login-btn {
  width: 100%;
  padding: 12px 20px;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  border: none;
  border-radius: var(--radius, 12px);
  background: var(--accent, #6366f1);
  color: #fff;
  cursor: pointer;
  transition: background 160ms ease, transform 100ms ease, opacity 160ms ease;
}

.login-btn:hover:not(:disabled) {
  background: var(--accent-hover, #4f46e5);
}

.login-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
