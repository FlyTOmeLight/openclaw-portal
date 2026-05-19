<template>
  <div class="login-page">
    <!-- ── 左:品牌分屏 ── -->
    <aside class="brand-side">
      <div class="mesh m1"></div>
      <div class="mesh m2"></div>
      <div class="mesh m3"></div>
      <div class="ring r1"></div>
      <div class="ring r2"></div>

      <div class="brand-top">
        <div class="brand-mark">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 4c0 6 2 9 7 9"/><path d="M12 4c0 7 0 11 0 11"/><path d="M19 4c0 6-2 9-7 9"/>
            <path d="M7 15c1.5 3 3.2 5 5 5s3.5-2 5-5"/>
          </svg>
        </div>
        <div class="brand-name">OpenClaw</div>
      </div>

      <div class="brand-mid">
        <div class="brand-eyebrow">控制中心</div>
        <h1 class="brand-h">统一管理你的<br><em>智能体网关</em></h1>
        <p class="brand-sub">渠道、技能、插件、模型与会话 —— 一个面板,全部掌控。</p>
        <div class="brand-chip"><span class="chip-dot"></span>网关在线 · 全操作审计留痕</div>
      </div>

      <div class="brand-foot">
        <span><b>安全</b> nginx + loopback 边界</span>
        <span><b>审计</b> 操作可追溯</span>
      </div>
    </aside>

    <!-- ── 右:玻璃表单 ── -->
    <main class="form-side">
      <div class="fog fog-a"></div>
      <div class="fog fog-b"></div>

      <div class="login-card">
        <div class="card-kicker">欢迎回来</div>
        <h2 class="card-h">登录控制中心</h2>
        <p class="card-desc">输入访问密码,或使用蓝信账号登录。</p>

        <form v-if="pwEnabled" class="login-form" @submit.prevent="handleLogin">
          <div class="field">
            <label class="field-label">访问密码</label>
            <div class="input-wrap" :class="{ error: errorMsg }">
              <input
                ref="passwordInput"
                v-model="password"
                :type="showPw ? 'text' : 'password'"
                placeholder="输入访问密码"
                autocomplete="current-password"
                :disabled="loading"
                @input="errorMsg = ''"
              />
              <button type="button" class="eye-btn" @click="showPw = !showPw" tabindex="-1" aria-label="切换密码可见">
                <svg v-if="!showPw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                  <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                  <path d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>
                </svg>
              </button>
            </div>
          </div>
          <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>
          <button type="submit" class="btn btn-primary" :disabled="loading || !password">
            {{ loading ? '验证中…' : '登录' }}
          </button>
        </form>

        <p v-if="errorMsg && !pwEnabled" class="error-text solo">{{ errorMsg }}</p>

        <div v-if="pwEnabled && ssoEnabled" class="divider"><span>或</span></div>

        <button
          v-if="ssoEnabled"
          type="button"
          class="btn btn-ghost"
          :disabled="loading"
          @click="handleSsoLogin"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 12h8M12 8v8"/>
          </svg>
          {{ loading ? '跳转中…' : '蓝信登录' }}
        </button>

        <p class="card-legal">高权限操作均被审计记录</p>
      </div>
    </main>
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
const pwEnabled = ref(false)
const ssoEnabled = ref(false)
const passwordInput = ref<HTMLInputElement>()

const apiBase = () => import.meta.env.BASE_URL.replace(/\/$/, '')

onMounted(async () => {
  const base = apiBase()
  // 1. 蓝信回跳:URL 带 cestcToken 直接走 SSO 登录,不再渲染登录表单。
  const cestcToken = new URLSearchParams(window.location.search).get('cestcToken')
  if (cestcToken) {
    await handleSsoCallback(base, cestcToken)
    return
  }
  // 2. 探测 auth / sso 开关。
  try {
    const res = await fetch(`${base}/api/auth/status`)
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      pwEnabled.value = data.enabled === true
      ssoEnabled.value = data.ssoEnabled === true
      // 两者都关 → portal 全开放,登录页不该出现。
      if (!pwEnabled.value && !ssoEnabled.value) {
        router.replace('/')
        return
      }
    }
  } catch { /* 网络异常:仍渲染页面,让用户重试 */ }
  if (pwEnabled.value) passwordInput.value?.focus()
})

async function handleLogin() {
  if (!password.value || loading.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${apiBase()}/api/auth/login`, {
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

async function handleSsoLogin() {
  if (loading.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${apiBase()}/api/auth/sso/login-url`)
    if (!res.ok) throw new Error()
    const data = await res.json()
    if (!data.loginUrl) throw new Error()
    window.location.href = data.loginUrl
  } catch {
    errorMsg.value = '无法获取蓝信登录地址'
    loading.value = false
  }
}

async function handleSsoCallback(base: string, rawToken: string) {
  loading.value = true
  // 网关可能把 token 里的 '+' 转成空格,还原(与后端 normalizeCestcToken 对称)。
  const cestcToken = rawToken.replace(/ /g, '+')
  try {
    const res = await fetch(`${base}/api/auth/sso/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cestcToken }),
    })
    // 清掉 URL 上的 cestcToken,避免刷新重复提交。
    window.history.replaceState({}, '', `${base}/login`)
    if (res.ok) {
      clearAuthCache()
      router.replace('/')
    } else {
      const data = await res.json().catch(() => ({}))
      errorMsg.value = data.error || '蓝信登录失败'
      loading.value = false
      // 回跳失败后需探测开关以决定是否渲染密码表单。
      await refreshAuthStatus(base)
    }
  } catch {
    errorMsg.value = '蓝信登录失败:网络错误'
    loading.value = false
    await refreshAuthStatus(base)
  }
}

async function refreshAuthStatus(base: string) {
  try {
    const res = await fetch(`${base}/api/auth/status`)
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      pwEnabled.value = data.enabled === true
      ssoEnabled.value = data.ssoEnabled === true
    }
  } catch { /* 保持当前状态 */ }
}
</script>

<style scoped>
/* ── 局部主题变量:浅色默认 ── */
.login-page {
  --lp-brand-grad: linear-gradient(152deg, #3f37c9 0%, #5b54e0 38%, #6366f1 66%, #7c83f4 100%);
  --lp-m1: rgba(255, 255, 255, 0.34);
  --lp-m2: rgba(56, 189, 248, 0.34);
  --lp-m3: rgba(167, 139, 250, 0.40);
  --lp-form-bg: linear-gradient(180deg, #fafaf9 0%, #f3f2f0 100%);
  --lp-fog-a: rgba(99, 102, 241, 0.20);
  --lp-fog-b: rgba(168, 162, 158, 0.30);
  --lp-card-bg: rgba(255, 255, 255, 0.62);
  --lp-card-border: rgba(255, 255, 255, 0.75);
  --lp-card-shadow: 0 18px 44px rgba(28, 25, 23, 0.13), 0 4px 12px rgba(28, 25, 23, 0.05);
  --lp-card-sheen: rgba(255, 255, 255, 0.85);
  --lp-card-topline: transparent;
  --lp-text: #1c1917;
  --lp-text-2: #57534e;
  --lp-text-mut: #a8a29e;
  --lp-input-bg: rgba(255, 255, 255, 0.78);
  --lp-input-bg-focus: #fff;
  --lp-input-border: rgba(28, 25, 23, 0.13);
  --lp-ghost-bg: rgba(255, 255, 255, 0.6);
  --lp-ghost-bg-hover: rgba(255, 255, 255, 0.92);
  --lp-ghost-border: rgba(28, 25, 23, 0.13);
  --lp-divider: rgba(28, 25, 23, 0.16);

  display: flex;
  min-height: 100dvh;
}

/* ── 深色主题覆盖 ── */
:global(body.theme-dark) .login-page {
  --lp-brand-grad: linear-gradient(152deg, #1e1b4b 0%, #312e81 36%, #4338ca 66%, #5b54e0 100%);
  --lp-m1: rgba(129, 140, 248, 0.46);
  --lp-m2: rgba(56, 189, 248, 0.26);
  --lp-m3: rgba(124, 58, 237, 0.42);
  --lp-form-bg: linear-gradient(180deg, #0c0c10 0%, #141419 100%);
  --lp-fog-a: rgba(99, 102, 241, 0.30);
  --lp-fog-b: rgba(56, 189, 248, 0.12);
  --lp-card-bg: rgba(30, 30, 38, 0.58);
  --lp-card-border: rgba(255, 255, 255, 0.10);
  --lp-card-shadow: 0 26px 60px rgba(0, 0, 0, 0.6), 0 4px 14px rgba(0, 0, 0, 0.4);
  --lp-card-sheen: rgba(255, 255, 255, 0.08);
  --lp-card-topline: rgba(255, 255, 255, 0.2);
  --lp-text: #f4f4f5;
  --lp-text-2: #d4d4d8;
  --lp-text-mut: #8a8a94;
  --lp-input-bg: rgba(12, 12, 16, 0.55);
  --lp-input-bg-focus: rgba(12, 12, 16, 0.8);
  --lp-input-border: rgba(255, 255, 255, 0.14);
  --lp-ghost-bg: rgba(255, 255, 255, 0.05);
  --lp-ghost-bg-hover: rgba(129, 140, 248, 0.16);
  --lp-ghost-border: rgba(255, 255, 255, 0.14);
  --lp-divider: rgba(255, 255, 255, 0.16);
}

/* ── 左:品牌分屏 ── */
.brand-side {
  flex: 1.05;
  position: relative;
  overflow: hidden;
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 54px 56px;
  background: var(--lp-brand-grad);
}
.mesh {
  position: absolute;
  border-radius: 50%;
  filter: blur(72px);
  pointer-events: none;
}
.m1 { width: 460px; height: 460px; background: var(--lp-m1); left: -150px; top: -170px; }
.m2 { width: 400px; height: 400px; background: var(--lp-m2); right: -120px; top: 24%; }
.m3 { width: 420px; height: 420px; background: var(--lp-m3); left: 6%; bottom: -200px; }
.ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.r1 { width: 560px; height: 560px; right: -240px; top: -150px; }
.r2 { width: 340px; height: 340px; right: -80px; top: -10px; border-color: rgba(255, 255, 255, 0.22); }
.brand-side::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.5;
  background-image: radial-gradient(rgba(255, 255, 255, 0.5) 0.5px, transparent 0.5px);
  background-size: 7px 7px;
  -webkit-mask-image: linear-gradient(180deg, #000, transparent 70%);
  mask-image: linear-gradient(180deg, #000, transparent 70%);
}

.brand-top { position: relative; display: flex; align-items: center; gap: 12px; }
.brand-mark {
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.3);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32);
}
.brand-name { font-size: 16px; font-weight: 680; letter-spacing: -0.01em; }

.brand-mid { position: relative; }
.brand-eyebrow {
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6); margin-bottom: 20px;
}
.brand-h { font-size: 38px; line-height: 1.18; font-weight: 720; letter-spacing: -0.032em; }
.brand-h em { font-style: normal; color: #d3d8ff; }
.brand-sub {
  margin-top: 20px; font-size: 15px; line-height: 1.66;
  color: rgba(255, 255, 255, 0.76); max-width: 30ch;
}
.brand-chip {
  position: relative; margin-top: 30px;
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(14px) saturate(1.4); -webkit-backdrop-filter: blur(14px) saturate(1.4);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
  font-size: 12.5px; color: rgba(255, 255, 255, 0.92);
}
.chip-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #86efac;
  box-shadow: 0 0 0 4px rgba(134, 239, 172, 0.26);
}
.brand-foot {
  position: relative; display: flex; gap: 24px;
  font-size: 12.5px; color: rgba(255, 255, 255, 0.62);
}
.brand-foot b { color: #fff; font-weight: 600; }

/* ── 右:玻璃表单 ── */
.form-side {
  flex: 0.95;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 32px;
  background: var(--lp-form-bg);
}
.fog { position: absolute; border-radius: 50%; filter: blur(74px); pointer-events: none; }
.fog-a { width: 370px; height: 370px; background: var(--lp-fog-a); right: -125px; top: -115px; }
.fog-b { width: 310px; height: 310px; background: var(--lp-fog-b); left: -105px; bottom: -125px; }

.login-card {
  position: relative;
  width: 100%;
  max-width: 356px;
  background: var(--lp-card-bg);
  border: 1px solid var(--lp-card-border);
  border-radius: var(--radius-lg, 16px);
  padding: 34px 32px 26px;
  backdrop-filter: blur(22px) saturate(1.7);
  -webkit-backdrop-filter: blur(22px) saturate(1.7);
  box-shadow: inset 0 1px 0 var(--lp-card-sheen), var(--lp-card-shadow);
}
.login-card::before {
  content: "";
  position: absolute;
  left: 22px; right: 22px; top: 0; height: 1px;
  background: linear-gradient(90deg, transparent, var(--lp-card-topline), transparent);
}

.card-kicker {
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  color: var(--accent, #6366f1); margin-bottom: 8px;
}
.card-h { font-size: 22px; font-weight: 720; letter-spacing: -0.025em; color: var(--lp-text); }
.card-desc { margin-top: 7px; font-size: 13px; color: var(--lp-text-2); }

.login-form { display: block; }
.field { margin-top: 24px; }
.field-label {
  display: block; font-size: 12.5px; font-weight: 600;
  color: var(--lp-text-2); margin-bottom: 7px;
}
.input-wrap { position: relative; }
.input-wrap input {
  width: 100%;
  padding: 12px 42px 12px 14px;
  font-size: 15px; font-family: inherit;
  border: 1px solid var(--lp-input-border);
  border-radius: var(--radius, 12px);
  background: var(--lp-input-bg);
  color: var(--lp-text);
  outline: none;
  transition: border-color 0.16s, box-shadow 0.16s, background 0.16s;
  box-sizing: border-box;
}
.input-wrap input:focus {
  border-color: var(--accent, #6366f1);
  background: var(--lp-input-bg-focus);
  box-shadow: 0 0 0 3px var(--accent-glow, rgba(99, 102, 241, 0.16));
}
.input-wrap.error input {
  border-color: var(--error-text, #b91c1c);
  box-shadow: 0 0 0 3px rgba(185, 28, 28, 0.12);
}
.eye-btn {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: none; border: none; padding: 6px; cursor: pointer;
  color: var(--lp-text-mut); display: flex;
  align-items: center; justify-content: center;
  transition: color 0.16s;
}
.eye-btn:hover { color: var(--lp-text-2); }

.error-text {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--error-text, #b91c1c);
}
.error-text.solo { margin-top: 18px; }

.btn {
  width: 100%;
  padding: 12px 18px;
  font-size: 15px; font-weight: 600; font-family: inherit;
  border-radius: var(--radius, 12px);
  cursor: pointer; border: none;
  transition: background 0.16s, transform 0.08s, box-shadow 0.16s, opacity 0.16s;
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-primary {
  margin-top: 20px;
  color: #fff;
  background: linear-gradient(180deg, #818cf8, #6366f1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 5px 14px rgba(99, 102, 241, 0.32);
}
.btn-primary:hover:not(:disabled) {
  background: linear-gradient(180deg, #a5b4fc, #818cf8);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 9px 24px rgba(99, 102, 241, 0.4);
}
.btn-primary:active:not(:disabled) { transform: scale(0.985); }

.divider {
  display: flex; align-items: center; gap: 12px;
  margin: 16px 0; color: var(--lp-text-mut); font-size: 11.5px;
}
.divider::before, .divider::after {
  content: ""; flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, var(--lp-divider), transparent);
}

.btn-ghost {
  background: var(--lp-ghost-bg);
  color: var(--lp-text);
  border: 1px solid var(--lp-ghost-border);
  display: flex; align-items: center; justify-content: center; gap: 9px;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--lp-ghost-bg-hover);
  border-color: rgba(99, 102, 241, 0.34);
}
.btn-ghost svg { color: var(--accent, #6366f1); }

.card-legal {
  margin-top: 22px;
  font-size: 11px;
  color: var(--lp-text-mut);
  line-height: 1.6;
  font-family: var(--font-mono, monospace);
}

/* ── 响应式:窄屏隐藏品牌墙 ── */
@media (max-width: 880px) {
  .brand-side { display: none; }
  .form-side { flex: 1; }
}
</style>
