<template>
  <Teleport to="body">
    <Transition name="palette-fade">
      <div
        v-if="open"
        class="palette-backdrop"
        @click="close"
        @keydown.esc.stop="close"
      >
        <div class="palette" @click.stop>
          <div class="palette-search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="palette-search-icon">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input
              ref="inputEl"
              v-model="query"
              placeholder="搜索页面、动作…"
              @keydown.down.prevent="moveFocus(1)"
              @keydown.up.prevent="moveFocus(-1)"
              @keydown.enter.prevent="runFocused"
              @keydown.esc.prevent="close"
            />
            <kbd class="palette-hint">esc</kbd>
          </div>

          <div v-if="grouped.length === 0" class="palette-empty">
            没有匹配项
          </div>
          <div v-else class="palette-list">
            <div v-for="group in grouped" :key="group.name" class="palette-group">
              <div class="palette-group-name">{{ group.name }}</div>
              <button
                v-for="(item, i) in group.items"
                :key="item.id"
                :ref="el => setItemRef(el as HTMLElement | null, group.offset + i)"
                :class="['palette-item', { focused: focusedIdx === group.offset + i }]"
                @mouseenter="focusedIdx = group.offset + i"
                @click="run(item)"
              >
                <span class="palette-item-label">{{ item.label }}</span>
                <span v-if="item.hint" class="palette-item-hint">{{ item.hint }}</span>
              </button>
            </div>
          </div>

          <div class="palette-footer">
            <span><kbd>↑↓</kbd> 导航</span>
            <span><kbd>↵</kbd> 跳转</span>
            <span><kbd>esc</kbd> 关闭</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'

interface Command {
  id: string
  label: string
  group: string
  path?: string
  hint?: string
  keywords?: string[]
  action?: () => void
}

const router = useRouter()
const open = ref(false)
const query = ref('')
const focusedIdx = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const itemRefs = ref<Array<HTMLElement | null>>([])

function setItemRef(el: HTMLElement | null, idx: number) {
  itemRefs.value[idx] = el
}

// All navigable destinations in the portal, grouped the same way as the sidebar.
const COMMANDS: Command[] = [
  { id: 'nav.dashboard', group: '工作台', label: '仪表盘', path: '/', hint: '服务状态总览', keywords: ['首页', 'home', 'dashboard', '概览'] },
  { id: 'nav.chat',      group: '工作台', label: '聊天',   path: '/chat', hint: '与 Agent 对话', keywords: ['对话', 'chat', '发消息'] },
  { id: 'nav.history',   group: '工作台', label: '对话历史', path: '/history', hint: '历史会话 · 实时活动', keywords: ['会话', '历史', 'history'] },
  { id: 'nav.sessions',  group: '工作台', label: '历史会话', path: '/history/sessions', keywords: ['session', '会话记录'] },
  { id: 'nav.activity',  group: '工作台', label: '实时活动', path: '/history/activity', keywords: ['activity', '工具调用', 'tool'] },
  { id: 'nav.topology',  group: '工作台', label: '协作拓扑', path: '/topology', hint: 'Agent 舰队全景', keywords: ['topology', '拓扑', '关系图', '舰队', 'graph', 'map', '可视化'] },

  { id: 'nav.models',    group: '配置', label: '模型',    path: '/models', keywords: ['model', 'provider', '供应商', 'api key', '密钥'] },
  { id: 'nav.agents',    group: '配置', label: 'Agent',   path: '/agents', keywords: ['代理', '机器人', 'bot'] },
  { id: 'nav.channels',  group: '配置', label: '消息渠道', path: '/channels', keywords: ['channel', '蓝信', '飞书', '微信', 'discord', 'telegram'] },
  { id: 'nav.skills',    group: '配置', label: '技能',    path: '/skills', keywords: ['skill', '能力', '工具'] },
  { id: 'nav.plugins',   group: '配置', label: '插件',    path: '/plugins', keywords: ['plugin', 'npm', '扩展'] },
  { id: 'nav.memory',    group: '配置', label: '记忆',    path: '/memory', keywords: ['memory', 'CLAUDE.md', '全局指令', 'soul'] },
  { id: 'nav.cron',      group: '配置', label: '定时任务', path: '/cron', keywords: ['定时', '计划任务', 'schedule', 'cron'] },
  { id: 'nav.mcp',       group: '配置', label: 'MCP 服务', path: '/mcp', hint: 'Model Context Protocol', keywords: ['mcp', 'model context protocol', '外部能力', 'tool server', 'filesystem', 'github'] },

  { id: 'nav.monitor',   group: '观测 & 运维', label: '系统监控', path: '/monitor', hint: 'CPU / 内存 / 磁盘', keywords: ['cpu', '内存', 'memory', '磁盘', 'disk', '资源', 'system'] },
  { id: 'nav.diagnose',  group: '观测 & 运维', label: '诊断中心', path: '/diagnose', hint: '日志 · 健康', keywords: ['diagnose', 'debug', '排障'] },
  { id: 'nav.logs',      group: '观测 & 运维', label: '运行日志', path: '/diagnose/logs', keywords: ['log', '错误', 'error', 'gateway'] },
  { id: 'nav.diagnosis', group: '观测 & 运维', label: '健康诊断', path: '/diagnose/health', keywords: ['health', '自检', 'doctor'] },
  { id: 'nav.insights',  group: '观测 & 运维', label: '留痕',    path: '/insights', hint: 'Token · 审计', keywords: ['audit', 'usage'] },
  { id: 'nav.usage',     group: '观测 & 运维', label: 'Token 用量', path: '/insights/usage', keywords: ['费用', 'cost', '消耗', '统计'] },
  { id: 'nav.audit',     group: '观测 & 运维', label: '操作审计', path: '/insights/audit', keywords: ['audit', '操作记录', '留痕', '合规'] },

  { id: 'nav.gateway-config', group: '系统', label: '网关 & 配置', path: '/gateway-config', hint: '端口 · JSON', keywords: ['gateway', 'port', '端口', 'openclaw.json', 'config'] },
  { id: 'nav.tools',     group: '系统', label: '系统工具', path: '/tools', hint: '终端 · 文件', keywords: ['tools', '工具箱'] },
  { id: 'nav.terminal',  group: '系统', label: '命令终端', path: '/tools/terminal', keywords: ['terminal', 'shell', 'cli', 'bash', 'command'] },
  { id: 'nav.filebrowser', group: '系统', label: '文件管理', path: '/tools/files', keywords: ['file', '文件浏览', 'browser'] },
  { id: 'nav.settings',  group: '系统', label: '系统设置', path: '/settings', hint: '密码 · 代理 · 备份', keywords: ['密码', 'password', '修改密码', '代理', 'proxy', '备份', 'backup', 'npm', '环境变量'] },
]

// Simple fuzzy match: all query chars must appear in order.
function fuzzyScore(text: string, q: string): number {
  if (!q) return 1
  const t = text.toLowerCase()
  const lower = q.toLowerCase()
  // Contiguous match gets highest score
  if (t.includes(lower)) {
    return t.startsWith(lower) ? 1000 : 500 - t.indexOf(lower)
  }
  let ti = 0
  let matched = 0
  for (const c of lower) {
    while (ti < t.length && t[ti] !== c) ti++
    if (ti >= t.length) return 0
    matched++
    ti++
  }
  return matched >= lower.length ? 100 : 0
}

const results = computed(() => {
  const q = query.value
  const scored = COMMANDS.map(c => {
    let score = Math.max(
      fuzzyScore(c.label, q),
      fuzzyScore(c.id, q),
      fuzzyScore(c.hint ?? '', q) * 0.7,  // hint matches rank slightly lower
    )
    for (const kw of c.keywords ?? []) {
      score = Math.max(score, fuzzyScore(kw, q) * 0.8)
    }
    return { cmd: c, score }
  }).filter(x => x.score > 0)
  scored.sort((a, b) => b.score - a.score)
  return scored.map(x => x.cmd)
})

const grouped = computed(() => {
  const map = new Map<string, Command[]>()
  for (const c of results.value) {
    if (!map.has(c.group)) map.set(c.group, [])
    map.get(c.group)!.push(c)
  }
  let offset = 0
  return [...map.entries()].map(([name, items]) => {
    const entry = { name, items, offset }
    offset += items.length
    return entry
  })
})

const flatResults = computed(() => results.value)

function moveFocus(delta: number) {
  const n = flatResults.value.length
  if (n === 0) return
  focusedIdx.value = (focusedIdx.value + delta + n) % n
  void nextTick(() => itemRefs.value[focusedIdx.value]?.scrollIntoView({ block: 'nearest' }))
}

function runFocused() {
  const cmd = flatResults.value[focusedIdx.value]
  if (cmd) run(cmd)
}

function run(cmd: Command) {
  close()
  if (cmd.path) router.push(cmd.path)
  else cmd.action?.()
}

function openPalette() {
  open.value = true
  query.value = ''
  focusedIdx.value = 0
  void nextTick(() => inputEl.value?.focus())
}

function close() {
  open.value = false
}

watch(query, () => { focusedIdx.value = 0 })

function onKeydown(ev: KeyboardEvent) {
  // ⌘K on mac, Ctrl+K on Windows/Linux
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
    ev.preventDefault()
    open.value ? close() : openPalette()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

defineExpose({ open: openPalette, close })
</script>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 10, 15, 0.55);
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.palette {
  width: 560px;
  max-width: 92vw;
  max-height: 70vh;
  /* bg-solid is fully opaque; no see-through */
  background: var(--bg-solid);
  background-image: var(--card-fill);
  border: 1px solid var(--card-border-strong);
  border-radius: 14px;
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.palette-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.palette-search-icon { color: var(--text-muted); flex-shrink: 0; }
.palette-search input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 14px;
  color: var(--text-primary);
}
.palette-search input::placeholder { color: var(--text-muted); }
.palette-hint {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
}

.palette-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.palette-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.palette-group-name {
  padding: 8px 14px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: var(--text-primary);
  transition: background 0.1s ease;
}
.palette-item.focused,
.palette-item:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.palette-item-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-item-hint {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.palette-footer {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-2);
}
.palette-footer kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
  margin-right: 4px;
}

.palette-fade-enter-active,
.palette-fade-leave-active {
  transition: opacity 0.15s ease;
}
.palette-fade-enter-from,
.palette-fade-leave-to {
  opacity: 0;
}
</style>
