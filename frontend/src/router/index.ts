import { createRouter, createWebHistory } from 'vue-router'
import { getAuthCache, setAuthCache } from './auth-cache.js'

// Re-export for backward compatibility with existing imports.
export { clearAuthCache } from './auth-cache.js'

// All views are lazy-loaded except Login (needed on first paint for unauth users)
// and Dashboard (the default landing page). Keeping these two static avoids an
// extra network hop on the critical path.
import Login from '../views/Login.vue'
import Dashboard from '../views/Dashboard.vue'

async function checkAuth(): Promise<boolean> {
  const cached = getAuthCache()
  if (cached !== null) return cached
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const res = await fetch(`${base}/api/auth/check`)
    setAuthCache(res.ok)
    return res.ok
  } catch {
    setAuthCache(false)
    return false
  }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login',      component: Login, meta: { public: true } },
    { path: '/',           component: Dashboard },

    // ── Core ───────────────────────────────────────────────
    { path: '/chat',       component: () => import('../views/Chat.vue') },
    { path: '/topology',   component: () => import('../views/Topology.vue') },

    // ── Configuration ──────────────────────────────────────
    { path: '/models',     component: () => import('../views/ModelWizard.vue') },
    { path: '/agents',     component: () => import('../views/Agents.vue') },
    { path: '/agents/:id', component: () => import('../views/AgentDetail.vue') },
    { path: '/channels',   component: () => import('../views/Channels.vue') },
    { path: '/skills',     component: () => import('../views/Skills.vue') },
    { path: '/plugins',    component: () => import('../views/Plugins.vue') },
    { path: '/memory',     component: () => import('../views/Memory.vue') },
    { path: '/cron',       component: () => import('../views/Cron.vue') },

    // ── Observe & Operate ──────────────────────────────────
    { path: '/monitor',    component: () => import('../views/Monitor.vue') },

    // Dialogue history (sessions + real-time activity)
    {
      path: '/history',
      component: () => import('../views/shells/HistoryShell.vue'),
      redirect: '/history/sessions',
      children: [
        { path: 'sessions', component: () => import('../views/Sessions.vue') },
        { path: 'activity', component: () => import('../views/Activity.vue') },
      ],
    },

    // Diagnose center (logs + health)
    {
      path: '/diagnose',
      component: () => import('../views/shells/DiagnoseShell.vue'),
      redirect: '/diagnose/logs',
      children: [
        { path: 'logs',   component: () => import('../views/Logs.vue') },
        { path: 'health', component: () => import('../views/Diagnosis.vue') },
        // Legacy route — old bookmark redirects to the merged page
        { path: 'env',    redirect: '/diagnose/health' },
      ],
    },

    // Insights (usage + audit)
    {
      path: '/insights',
      component: () => import('../views/shells/InsightsShell.vue'),
      redirect: '/insights/usage',
      children: [
        { path: 'usage', component: () => import('../views/Usage.vue') },
        { path: 'audit', component: () => import('../views/Audit.vue') },
      ],
    },

    // ── System ─────────────────────────────────────────────
    {
      path: '/gateway-config',
      component: () => import('../views/shells/GatewayShell.vue'),
      redirect: '/gateway-config/gateway',
      children: [
        { path: 'gateway', component: () => import('../views/Gateway.vue') },
        { path: 'raw',     component: () => import('../views/ConfigEditor.vue') },
      ],
    },

    {
      path: '/tools',
      component: () => import('../views/shells/ToolsShell.vue'),
      redirect: '/tools/terminal',
      children: [
        { path: 'terminal', component: () => import('../views/Terminal.vue') },
        { path: 'files',    component: () => import('../views/FileBrowser.vue') },
      ],
    },

    { path: '/mcp',        component: () => import('../views/Mcp.vue') },
    { path: '/settings',   component: () => import('../views/Settings.vue') },

    // ── Back-compat redirects (bookmarks, docs, old URLs) ──
    { path: '/sessions',   redirect: '/history/sessions' },
    { path: '/activity',   redirect: '/history/activity' },
    { path: '/logs',       redirect: '/diagnose/logs' },
    { path: '/diagnosis',  redirect: '/diagnose/health' },
    { path: '/usage',      redirect: '/insights/usage' },
    { path: '/audit',      redirect: '/insights/audit' },
    { path: '/gateway',    redirect: '/gateway-config/gateway' },
    { path: '/config',     redirect: '/gateway-config/raw' },
    { path: '/terminal',   redirect: '/tools/terminal' },
    { path: '/filebrowser', redirect: '/tools/files' },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  const authed = await checkAuth()
  if (!authed) return '/login'
  return true
})
