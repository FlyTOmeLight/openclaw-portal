<template>
  <section v-if="health" :class="['health-card', `health-${health.rating}`]">
    <!-- Score side -->
    <div class="health-score-side">
      <div class="health-rating-pill">
        <span class="health-rating-dot"></span>
        {{ ratingLabel }}
      </div>
      <div class="health-score-num">
        <span class="health-score-big">{{ health.score }}</span>
        <span class="health-score-max">/ {{ health.maxScore }}</span>
      </div>
      <div class="health-score-sub">系统健康度 · 每 60s 自动更新</div>
    </div>

    <!-- Dimensions side -->
    <div class="health-dims">
      <RouterLink
        v-for="d in health.dimensions"
        :key="d.key"
        :to="d.link ?? ''"
        :class="['health-dim', `dim-${d.status}`, { 'no-link': !d.link }]"
      >
        <div class="dim-head">
          <span class="dim-icon">{{ dimIcon(d.key, d.status) }}</span>
          <span class="dim-label">{{ d.label }}</span>
          <span class="dim-score">{{ d.score }}/{{ d.maxScore }}</span>
        </div>
        <div class="dim-bar">
          <div class="dim-bar-fill" :style="{ width: (d.score / d.maxScore * 100) + '%' }"></div>
        </div>
        <div class="dim-msg">{{ d.message }}</div>
      </RouterLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api/client.js'

const health = ref<any>(null)
let timer: ReturnType<typeof setInterval> | null = null

const ratingLabel = computed(() => {
  if (!health.value) return '—'
  return health.value.rating === 'ok' ? '健康'
    : health.value.rating === 'warn' ? '注意'
    : '异常'
})

function dimIcon(key: string, status: string): string {
  if (status === 'fail') return '🔴'
  if (status === 'warn') return '🟡'
  const map: Record<string, string> = {
    gateway: '⚡', errors: '📋', memory: '💾',
    audit: '🛡️', keys: '🔑', activity: '📡',
  }
  return map[key] ?? '🟢'
}

async function load() {
  try {
    health.value = await api.system.health()
  } catch { /* silent */ }
}

onMounted(() => {
  load()
  timer = setInterval(load, 60_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.health-card {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: var(--space-5);
  padding: var(--space-5);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  background: var(--card-fill);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--space-5);
}
@media (max-width: 900px) {
  .health-card { grid-template-columns: 1fr; }
}

.health-ok   { border-left: 4px solid #10b981; }
.health-warn { border-left: 4px solid #f59e0b; }
.health-fail { border-left: 4px solid #ef4444; }

/* Score side */
.health-score-side {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 8px;
}
.health-rating-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.health-ok .health-rating-pill   { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }
.health-warn .health-rating-pill { background: color-mix(in srgb, #f59e0b 15%, transparent); color: #f59e0b; }
.health-fail .health-rating-pill { background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444; }
.health-rating-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 25%, transparent);
}
.health-score-num {
  display: flex;
  align-items: baseline;
  gap: 6px;
  line-height: 1;
}
.health-score-big {
  font-size: 56px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.health-ok   .health-score-big { color: #10b981; }
.health-warn .health-score-big { color: #f59e0b; }
.health-fail .health-score-big { color: #ef4444; }
.health-score-max {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-muted);
}
.health-score-sub {
  font-size: 11px;
  color: var(--text-muted);
}

/* Dimensions grid */
.health-dims {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.health-dim {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.12s, background 0.12s;
}
.health-dim:hover:not(.no-link) {
  border-color: var(--accent);
  background: var(--accent-subtle);
}
.health-dim.no-link { cursor: default; }

.dim-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dim-icon { font-size: 14px; flex-shrink: 0; }
.dim-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dim-score {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.dim-bar {
  height: 4px;
  background: var(--surface-2);
  border-radius: 2px;
  overflow: hidden;
}
.dim-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
}
.dim-ok   .dim-bar-fill { background: #10b981; }
.dim-warn .dim-bar-fill { background: #f59e0b; }
.dim-fail .dim-bar-fill { background: #ef4444; }

.dim-msg {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
