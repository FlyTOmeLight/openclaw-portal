<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" style="display:contents">
  <n-message-provider style="display:contents">
  <n-notification-provider style="display:contents">
  <div v-if="route.path === '/login'" class="login-shell">
    <RouterView />
  </div>
  <div v-else class="app-shell" :class="{ 'sidebar-open': sidebarOpen }">
    <!-- Mobile hamburger -->
    <button class="sidebar-toggle" @click="sidebarOpen = !sidebarOpen" aria-label="Toggle sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
    <div class="sidebar-backdrop" @click="sidebarOpen = false" />
    <nav class="sidebar">
      <!-- Brand -->
      <div class="brand">
        <div class="brand-bar">
          <div class="brand-kicker">
            <span class="brand-dot" :class="svc.state" />
            OpenClaw
          </div>
        </div>
        <div class="brand-title">控制中心</div>
        <div class="brand-meta">{{ svc.state === 'running' ? 'Gateway 运行中' : svc.state === 'restarting' ? 'Gateway 重启中…' : svc.state === 'error' ? 'Gateway 异常' : 'Gateway 已停止' }}</div>
      </div>

      <!-- Nav -->
      <div class="nav-links">
        <div class="nav-group-label">工作台</div>
        <RouterLink to="/" class="nav-link" exact-active-class="active">
          <span>仪表盘</span>
          <small>服务状态总览</small>
        </RouterLink>
        <RouterLink to="/chat" class="nav-link">
          <span>聊天</span>
          <small>与 Agent 对话</small>
        </RouterLink>
        <RouterLink to="/history" class="nav-link">
          <span>对话历史</span>
          <small>历史会话 · 实时活动</small>
        </RouterLink>
        <RouterLink to="/topology" class="nav-link">
          <span>协作拓扑</span>
          <small>Agent 舰队全景</small>
        </RouterLink>

        <div class="nav-group-label">配置</div>
        <RouterLink to="/models" class="nav-link">
          <span>模型</span>
          <small>Provider 与模型</small>
        </RouterLink>
        <RouterLink to="/agents" class="nav-link">
          <span>Agent</span>
          <small>Agent 舰队</small>
        </RouterLink>
        <RouterLink to="/channels" class="nav-link">
          <span>消息渠道</span>
          <small>接入渠道</small>
        </RouterLink>
        <RouterLink to="/skills" class="nav-link">
          <span>技能</span>
          <small>技能仓库</small>
        </RouterLink>
        <RouterLink to="/plugins" class="nav-link">
          <span>插件</span>
          <small>npm 插件</small>
        </RouterLink>
        <RouterLink to="/memory" class="nav-link">
          <span>记忆</span>
          <small>全局指令</small>
        </RouterLink>
        <RouterLink to="/cron" class="nav-link">
          <span>定时任务</span>
          <small>调度器</small>
        </RouterLink>
        <RouterLink to="/mcp" class="nav-link">
          <span>MCP 服务</span>
          <small>外部能力接入</small>
        </RouterLink>

        <div class="nav-group-label">观测 & 运维</div>
        <RouterLink to="/monitor" class="nav-link">
          <span>系统监控</span>
          <small>CPU / 内存 / 磁盘</small>
        </RouterLink>
        <RouterLink to="/diagnose" class="nav-link">
          <span>诊断中心</span>
          <small>日志 · 健康检查</small>
        </RouterLink>
        <RouterLink to="/insights" class="nav-link">
          <span>留痕</span>
          <small>Token 用量 · 操作审计</small>
        </RouterLink>

        <div class="nav-group-label">系统</div>
        <RouterLink to="/gateway-config" class="nav-link">
          <span>网关 & 配置</span>
          <small>端口 · JSON 编辑器</small>
        </RouterLink>
        <RouterLink to="/tools" class="nav-link">
          <span>系统工具</span>
          <small>终端 · 文件</small>
        </RouterLink>
      </div>

      <!-- Footer -->
      <div class="sidebar-footer">
        <button v-if="authEnabled" class="logout-btn" @click="handleLogout">退出登录</button>
        <NotificationBell />
        <button class="icon-btn-footer" @click="themeStore.toggle()" :title="themeStore.mode === 'dark' ? '切到浅色' : '切到深色'">
          <svg v-if="themeStore.mode === 'dark'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>
        <RouterLink to="/settings" class="icon-btn-footer" title="系统设置">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </RouterLink>
        <span class="sidebar-version">v2026.4 · <kbd class="sidebar-kbd">⌘K</kbd></span>
      </div>
    </nav>

    <main class="main-panel">
      <RouterView v-slot="{ Component }">
        <KeepAlive include="Chat">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>
  </div>

  <ToastContainer />
  <CommandPalette />
  </n-notification-provider>
  </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NConfigProvider, NMessageProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useThemeStore } from './stores/theme.js'
import ToastContainer from './components/ToastContainer.vue'
import CommandPalette from './components/CommandPalette.vue'
import NotificationBell from './components/NotificationBell.vue'
import { useServiceStore } from './stores/service.js'
import { clearAuthCache } from './router/auth-cache.js'

const svc = useServiceStore()
const themeStore = useThemeStore()
const naiveTheme = computed(() => themeStore.mode === 'dark' ? darkTheme : null)
const routerInstance = useRouter()
const sidebarOpen = ref(false)
const route = useRoute()

const authEnabled = ref(false)

async function refreshAuthStatus() {
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const res = await fetch(`${base}/api/auth/status`)
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      authEnabled.value = Boolean(data.enabled)
    }
  } catch {}
}

onMounted(() => {
  if (route.path !== '/login') svc.refresh()
  refreshAuthStatus()
})

// Close sidebar on route change (mobile)
watch(() => route.path, () => { sidebarOpen.value = false })

async function handleLogout() {
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    await fetch(`${base}/api/auth/logout`, { method: 'POST' })
  } catch { /* ignore */ }
  clearAuthCache()
  routerInstance.replace('/login')
}

const themeOverrides = {
  common: {
    primaryColor: '#6366f1',
    primaryColorHover: '#818cf8',
    primaryColorPressed: '#4f46e5',
    primaryColorSuppl: '#6366f1',
    borderRadius: '8px',
    fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
  },
}
</script>

<style scoped>
.login-shell {
  min-height: 100dvh;
}

.app-shell {
  display: grid;
  grid-template-columns: 256px minmax(0, 1fr);
  gap: 0;
  min-height: 100dvh;
  height: 100dvh;
  max-width: 1800px;
  margin: 0 auto;
  overflow: hidden;
}

/* ── Dark Sidebar ── */
.sidebar {
  background:
    linear-gradient(180deg, #1e1b3a 0%, #18181b 40%, #111113 100%);
  padding: 20px 14px 14px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}

/* ── Brand (dark variant) ── */
.brand {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
  padding: 16px;
  margin-bottom: 8px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
    radial-gradient(circle at 80% 10%, rgba(99, 102, 241, 0.08), transparent 56%);
}
.brand-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(99, 102, 241, 0.35);
  border-radius: var(--radius-full);
  padding: 3px 9px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.15);
  text-transform: uppercase;
}
.brand-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.3);
  transition: background .3s;
}
.brand-dot.running {
  background: #34d399;
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.5);
  animation: pulse-dot 1.6s ease-in-out infinite;
}
.brand-dot.error      { background: #f87171; box-shadow: 0 0 6px rgba(248, 113, 113, 0.4); }
.brand-dot.restarting { background: #fbbf24; box-shadow: 0 0 8px rgba(251, 191, 36, 0.5); animation: pulse-dot 0.8s ease-in-out infinite; }
.brand-dot.stopped    { background: rgba(255, 255, 255, 0.3); }
.brand-title {
  font-size: 20px;
  font-weight: 720;
  color: #fff;
  letter-spacing: -0.03em;
  margin-top: 8px;
  line-height: 1.1;
}
.brand-meta {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 4px;
  line-height: 1.4;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* ── Nav ── */
.nav-links {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
}

.nav-group-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.28);
  padding: 16px 12px 6px;
}
.nav-group-label:first-child {
  padding-top: 8px;
}

.nav-link {
  display: block;
  border: none;
  border-radius: var(--radius);
  text-decoration: none;
  padding: 8px 12px;
  background: transparent;
  transition: background 160ms ease, transform 160ms ease;
  position: relative;
}
.nav-link:hover {
  background: rgba(255, 255, 255, 0.06);
}
.nav-link span {
  display: block;
  font-size: 13.5px;
  font-weight: 580;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.3;
  transition: color 160ms ease;
}
.nav-link small {
  display: block;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 2px;
  line-height: 1.3;
  transition: color 160ms ease;
}
.nav-link:hover span {
  color: rgba(255, 255, 255, 0.92);
}
.nav-link:hover small {
  color: rgba(255, 255, 255, 0.45);
}

/* ── Active nav state ── */
.nav-link.router-link-active,
.nav-link.active {
  background: rgba(99, 102, 241, 0.12);
  box-shadow: inset 3px 0 0 #818cf8;
}
.nav-link.router-link-active span,
.nav-link.active span {
  color: #c7d2fe;
  font-weight: 640;
}
.nav-link.router-link-active small,
.nav-link.active small {
  color: rgba(129, 140, 248, 0.6);
}

/* ── Footer ── */
.sidebar-footer {
  padding-top: 12px;
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.logout-btn {
  display: block;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius);
  cursor: pointer;
  transition: color 160ms ease, background 160ms ease, border-color 160ms ease;
}
.logout-btn:hover {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.14);
}
.icon-btn-footer {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 6px;
  cursor: pointer;
  color: rgba(255,255,255,0.55);
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}
.icon-btn-footer:hover {
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.9);
  border-color: rgba(255,255,255,0.18);
}
.icon-btn-footer + .icon-btn-footer { margin-left: 4px; }
.icon-btn-footer + .sidebar-version { margin-left: 8px; }
.sidebar-kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--text-secondary);
}
.sidebar-version {
  font-size: 10px;
  font-family: var(--font-mono);
  color: rgba(255, 255, 255, 0.22);
  letter-spacing: .05em;
}

/* ── Main Panel (warm canvas) ── */
.main-panel {
  border-left: none;
  padding: 32px 36px 36px;
  background: transparent;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(150, 143, 133, 0.3) transparent;
}

/* ── Page transitions ── */
.page-enter-active,
.page-leave-active { transition: opacity .18s var(--ease-out), transform .18s var(--ease-out); }
.page-enter-from { opacity: 0; transform: translateY(10px); }
.page-leave-to   { opacity: 0; transform: translateY(-4px); }

/* ── Hamburger toggle (hidden on desktop) ── */
.sidebar-toggle {
  display: none;
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 310;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--radius);
  background: #1e1b3a;
  color: rgba(255,255,255,0.8);
  cursor: pointer;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  transition: background 160ms ease;
}
.sidebar-toggle:hover { background: #28274a; }

.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 299;
}

/* ── Responsive: tablet / mobile ── */
@media (max-width: 860px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .sidebar-toggle {
    display: flex;
  }

  .sidebar {
    position: fixed;
    inset: 0;
    right: auto;
    width: 280px;
    z-index: 300;
    transform: translateX(-100%);
    transition: transform 280ms var(--ease-out);
    border-right: 1px solid rgba(255,255,255,0.06);
    border-radius: 0;
  }

  .sidebar-open .sidebar {
    transform: translateX(0);
  }

  .sidebar-open .sidebar-backdrop {
    display: block;
  }

  .main-panel {
    padding: 20px 16px 24px;
    padding-top: 60px; /* room for hamburger */
  }
}
</style>
