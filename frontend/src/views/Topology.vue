<template>
  <div class="page-shell topology-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">协作拓扑</h1>
        <p class="subtitle">
          Agent 舰队全景视图：消息渠道 → Agent → Subagent 调用链，一张图看清绑定关系
        </p>
      </div>
      <div class="header-actions">
        <n-button size="small" @click="load" :loading="loading">刷新</n-button>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">Agent 总数</div>
        <div class="metric-value">{{ agents.length }}</div>
        <div class="metric-meta">当前工作区可用 Agent</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">活跃渠道</div>
        <div class="metric-value">{{ distinctChannels.size }}</div>
        <div class="metric-meta">至少有一条绑定的渠道类型</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">路由绑定</div>
        <div class="metric-value">{{ totalBindings }}</div>
        <div class="metric-meta">渠道 → Agent 的路由条数</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Subagent 边</div>
        <div class="metric-value">{{ subagentEdges.length }}</div>
        <div class="metric-meta">Agent 间的委托调用关系</div>
      </div>
    </div>

    <section class="section-card topo-panel">
      <div class="section-header">
        <div class="section-head-row">
          <div>
            <h2 class="section-title">关系图</h2>
            <p class="section-desc">
              鼠标悬浮节点高亮相关连线。左列是消息渠道，右列是 Agent；Agent 之间的虚线表示 Subagent 委托。
            </p>
          </div>
          <label class="show-disabled-toggle">
            <input type="checkbox" v-model="showDisabled" />
            <span>显示已禁用 Agent</span>
          </label>
        </div>
      </div>

      <div v-if="loading && !agents.length" class="topo-empty">加载中…</div>
      <div v-else-if="!visibleAgents.length" class="topo-empty">暂无 Agent</div>

      <div v-else class="topo-canvas-wrap">
        <svg
          :viewBox="`0 0 ${canvasW} ${canvasH}`"
          class="topo-svg"
          :style="{ minHeight: canvasH + 'px' }"
          preserveAspectRatio="xMidYMid meet"
        >
          <!-- Column labels -->
          <text :x="colX.channel" y="24" class="col-label" text-anchor="middle">消息渠道</text>
          <text :x="colX.agent" y="24" class="col-label" text-anchor="middle">Agent 舰队</text>

          <!-- Arrow marker -->
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
            <marker id="arrow-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity="0.3" />
            </marker>
          </defs>

          <!-- Binding edges (channel → agent) -->
          <g class="edges">
            <path
              v-for="(e, i) in bindingEdges"
              :key="'b' + i"
              :d="edgePath(e)"
              :class="['edge', 'edge-binding', { highlight: isEdgeHighlighted(e), dim: hoveredNodeId && !isEdgeHighlighted(e) }]"
              fill="none"
            />
          </g>

          <!-- Subagent edges (agent → agent, curved to the right) -->
          <g class="edges">
            <path
              v-for="(e, i) in subagentEdges"
              :key="'s' + i"
              :d="subagentEdgePath(e)"
              :class="['edge', 'edge-subagent', { highlight: isEdgeHighlighted(e), dim: hoveredNodeId && !isEdgeHighlighted(e) }]"
              fill="none"
              marker-end="url(#arrow)"
            />
          </g>

          <!-- Channel nodes -->
          <g
            v-for="n in channelNodes"
            :key="n.id"
            :class="['node', 'node-channel', { highlight: isNodeHighlighted(n.id), dim: hoveredNodeId && !isNodeHighlighted(n.id) }]"
            @mouseenter="hoveredNodeId = n.id"
            @mouseleave="hoveredNodeId = null"
          >
            <rect :x="n.x - NODE_W.channel / 2" :y="n.y - NODE_H / 2" :width="NODE_W.channel" :height="NODE_H" rx="12" />
            <text :x="n.x" :y="n.y - 2" text-anchor="middle" class="node-title">{{ n.emoji }} {{ n.label }}</text>
            <text :x="n.x" :y="n.y + 14" text-anchor="middle" class="node-sub">{{ n.count }} 条绑定</text>
          </g>

          <!-- Agent nodes -->
          <g
            v-for="n in agentNodes"
            :key="n.id"
            :class="['node', 'node-agent', { highlight: isNodeHighlighted(n.id), dim: hoveredNodeId && !isNodeHighlighted(n.id), disabled: !n.enabled }]"
            @mouseenter="hoveredNodeId = n.id"
            @mouseleave="hoveredNodeId = null"
          >
            <rect :x="n.x - NODE_W.agent / 2" :y="n.y - NODE_H_AGENT / 2" :width="NODE_W.agent" :height="NODE_H_AGENT" rx="14" />
            <text :x="n.x" :y="n.y - 14" text-anchor="middle" class="node-title">{{ n.emoji }} {{ n.label }}</text>
            <text :x="n.x" :y="n.y + 4" text-anchor="middle" class="node-sub mono">{{ n.model }}</text>
            <text :x="n.x" :y="n.y + 20" text-anchor="middle" class="node-sub">
              <tspan v-if="n.isDefault" class="badge-default">默认 · </tspan>{{ n.bindings }} 渠道 · {{ n.subagentCount }} subagent
            </text>
          </g>
        </svg>

        <div class="legend">
          <span class="legend-item"><span class="swatch swatch-channel"></span>消息渠道</span>
          <span class="legend-item"><span class="swatch swatch-agent"></span>Agent</span>
          <span class="legend-item"><span class="line-sample line-binding"></span>路由绑定</span>
          <span class="legend-item"><span class="line-sample line-subagent"></span>Subagent 委托</span>
          <span class="legend-hint">共 {{ bindingEdges.length + subagentEdges.length }} 条连线</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton } from 'naive-ui'
import { api } from '../api/client.js'

const loading = ref(false)
const agents = ref<any[]>([])
const hoveredNodeId = ref<string | null>(null)
const showDisabled = ref(true)

// Layout constants
const canvasW = 900
const colX = { channel: 180, agent: 650 }
const NODE_W = { channel: 220, agent: 280 }
const NODE_H = 44
const NODE_H_AGENT = 74
const ROW_GAP = 22

const channelEmojiMap: Record<string, string> = {
  lansenger: '💬', wechat: '🟢', feishu: '📘', lark: '📘',
  telegram: '✈️', discord: '🎮', whatsapp: '📱', slack: '🧡',
  dingtalk: '🔷', qq: '🐧', email: '📧', api: '🔌',
}
function channelEmoji(ch: string) { return channelEmojiMap[ch?.toLowerCase()] ?? '🔗' }

const visibleAgents = computed(() =>
  showDisabled.value ? agents.value : agents.value.filter(a => a.enabled !== false),
)

const distinctChannels = computed(() => {
  const m = new Map<string, number>()
  for (const a of visibleAgents.value) {
    for (const b of (a.routeBindings ?? [])) {
      const ch = b?.match?.channel || 'unknown'
      m.set(ch, (m.get(ch) ?? 0) + 1)
    }
  }
  return m
})
const totalBindings = computed(() =>
  visibleAgents.value.reduce((s, a) => s + (a.routeBindings?.length ?? 0), 0),
)

// ── Nodes + layout ─────────────────────────────────────────────
interface Node {
  id: string
  kind: 'channel' | 'agent'
  label: string
  emoji?: string
  x: number
  y: number
  [k: string]: any
}

const channelNodes = computed<Node[]>(() => {
  const chs = [...distinctChannels.value.entries()]
  const step = NODE_H + ROW_GAP
  const startY = 80 + NODE_H / 2
  return chs.map(([ch, count], i) => ({
    id: `ch:${ch}`,
    kind: 'channel',
    label: ch,
    emoji: channelEmoji(ch),
    count,
    x: colX.channel,
    y: startY + i * step,
  }))
})

const agentNodes = computed<Node[]>(() => {
  const step = NODE_H_AGENT + ROW_GAP
  const startY = 80 + NODE_H_AGENT / 2
  return visibleAgents.value.map((a, i) => ({
    id: `agent:${a.id}`,
    kind: 'agent',
    label: a.identityName || a.id,
    emoji: a.identityEmoji || '🤖',
    model: typeof a.model === 'string' ? a.model : a.model?.primary || 'default',
    bindings: a.routeBindings?.length ?? 0,
    subagentCount: a._allowedSubagents?.length ?? 0,
    isDefault: Boolean(a.isDefault),
    enabled: a.enabled !== false,
    x: colX.agent,
    y: startY + i * step,
  }))
})

const canvasH = computed(() => {
  const chCount = channelNodes.value.length
  const agCount = agentNodes.value.length
  const hCh = 80 + chCount * (NODE_H + ROW_GAP)
  const hAg = 80 + agCount * (NODE_H_AGENT + ROW_GAP)
  return Math.max(hCh, hAg, 340) + 40
})

// ── Edges ──────────────────────────────────────────────────────
interface Edge {
  id: string
  fromId: string
  toId: string
  kind: 'binding' | 'subagent'
}
const bindingEdges = computed<Edge[]>(() => {
  const list: Edge[] = []
  for (const a of visibleAgents.value) {
    for (const b of (a.routeBindings ?? [])) {
      const ch = b?.match?.channel || 'unknown'
      list.push({
        id: `b-${ch}->${a.id}-${list.length}`,
        fromId: `ch:${ch}`,
        toId: `agent:${a.id}`,
        kind: 'binding',
      })
    }
  }
  return list
})
const subagentEdges = computed<Edge[]>(() => {
  const list: Edge[] = []
  const idSet = new Set(visibleAgents.value.map(a => a.id))
  for (const a of visibleAgents.value) {
    for (const sub of (a._allowedSubagents ?? [])) {
      if (sub === a.id || !idSet.has(sub)) continue
      list.push({
        id: `s-${a.id}->${sub}-${list.length}`,
        fromId: `agent:${a.id}`,
        toId: `agent:${sub}`,
        kind: 'subagent',
      })
    }
  }
  return list
})

function nodeById(id: string): Node | undefined {
  return channelNodes.value.find(n => n.id === id)
    ?? agentNodes.value.find(n => n.id === id)
}

function edgePath(e: Edge): string {
  const from = nodeById(e.fromId)
  const to = nodeById(e.toId)
  if (!from || !to) return ''
  const fromW = NODE_W[from.kind] ?? 200
  const toW = NODE_W[to.kind] ?? 200
  const sx = from.x + fromW / 2
  const sy = from.y
  const tx = to.x - toW / 2
  const ty = to.y
  const midX = (sx + tx) / 2
  return `M ${sx},${sy} C ${midX},${sy} ${midX},${ty} ${tx},${ty}`
}

// Curved path looping through the right edge of the canvas for agent->agent
function subagentEdgePath(e: Edge): string {
  const from = nodeById(e.fromId)
  const to = nodeById(e.toId)
  if (!from || !to) return ''
  const fromW = NODE_W.agent
  const sx = from.x + fromW / 2
  const sy = from.y
  const tx = to.x + fromW / 2
  const ty = to.y
  // Bow out to the right
  const midX = Math.max(sx, tx) + 90
  return `M ${sx},${sy} C ${midX},${sy} ${midX},${ty} ${tx},${ty}`
}

// ── Hover highlighting ─────────────────────────────────────────
const allEdges = computed(() => [...bindingEdges.value, ...subagentEdges.value])
const relatedSet = computed(() => {
  if (!hoveredNodeId.value) return null
  const set = new Set<string>([hoveredNodeId.value])
  for (const e of allEdges.value) {
    if (e.fromId === hoveredNodeId.value) { set.add(e.toId); set.add(e.id) }
    if (e.toId === hoveredNodeId.value) { set.add(e.fromId); set.add(e.id) }
  }
  return set
})
function isNodeHighlighted(id: string): boolean {
  if (!relatedSet.value) return false
  return relatedSet.value.has(id)
}
function isEdgeHighlighted(e: Edge): boolean {
  if (!relatedSet.value) return false
  return relatedSet.value.has(e.id)
}

// ── Data load ──────────────────────────────────────────────────
async function load() {
  loading.value = true
  try {
    const list = await api.agents.list()
    const enriched = await Promise.all(list.map(async (a: any) => {
      const sub = await api.agents.getSubagents(a.id).catch(() => null)
      return {
        ...a,
        _allowedSubagents: sub?.allowAgents ?? [],
      }
    }))
    agents.value = enriched
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.topology-page { height: 100%; display: flex; flex-direction: column; }
.show-disabled-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.topo-panel { flex: 1; display: flex; flex-direction: column; }
.topo-canvas-wrap {
  position: relative;
  overflow-x: auto;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  padding: 12px;
}
.topo-svg {
  width: 100%;
  min-width: 760px;
  display: block;
}

.col-label {
  fill: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ── Nodes ── */
.node { cursor: pointer; transition: opacity 0.15s ease; }
.node rect {
  fill: var(--surface);
  stroke: var(--border);
  stroke-width: 1;
  transition: stroke 0.12s, fill 0.12s, stroke-width 0.12s;
}
.node .node-title {
  fill: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
}
.node .node-sub {
  fill: var(--text-muted);
  font-size: 10px;
  pointer-events: none;
}
.node .node-sub.mono { font-family: var(--font-mono); }

.node-channel rect {
  fill: color-mix(in srgb, #3b82f6 6%, var(--surface));
  stroke: color-mix(in srgb, #3b82f6 30%, var(--border));
}

.node-agent rect {
  fill: var(--accent-subtle);
  stroke: var(--accent);
  stroke-width: 1.5;
}
.node-agent .node-title { fill: var(--text-primary); font-size: 14px; }
.node-agent.disabled rect { fill: var(--surface-2); stroke: var(--border); }
.node-agent.disabled .node-title { fill: var(--text-muted); }
.badge-default { fill: #10b981; font-weight: 700; font-size: 10px; }

.node.highlight rect { stroke-width: 2.5; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.18)); }
.node.dim { opacity: 0.28; }

/* ── Edges ── */
.edge {
  stroke: var(--border-strong);
  stroke-width: 1.4;
  opacity: 0.7;
  transition: stroke 0.12s, opacity 0.12s, stroke-width 0.12s;
}
.edge-subagent {
  stroke-dasharray: 5 4;
  stroke: color-mix(in srgb, var(--accent) 70%, var(--text-muted));
  color: color-mix(in srgb, var(--accent) 70%, var(--text-muted));
}
.edge.highlight {
  stroke: var(--accent);
  color: var(--accent);
  stroke-width: 2;
  opacity: 1;
}
.edge.dim { opacity: 0.15; }

/* ── Legend ── */
.legend {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.swatch {
  width: 14px; height: 14px; border-radius: 4px;
  border: 1px solid var(--border);
}
.swatch-channel { background: color-mix(in srgb, #3b82f6 12%, var(--surface)); }
.swatch-agent { background: var(--accent-subtle); border-color: var(--accent); }
.line-sample {
  width: 28px; height: 2px;
  background: var(--border-strong);
}
.line-sample.line-subagent {
  background: repeating-linear-gradient(
    to right,
    color-mix(in srgb, var(--accent) 70%, var(--text-muted)) 0 5px,
    transparent 5px 9px
  );
}
.legend-hint { margin-left: auto; color: var(--text-muted); font-family: var(--font-mono); }

.topo-empty {
  padding: 60px 20px;
  text-align: center;
  color: var(--text-muted);
}
</style>
