<template>
  <div v-if="visibleJobs.length" class="gantt-section section-card">
    <div class="section-header">
      <div class="section-head-row">
        <div>
          <h2 class="section-title">未来 24 小时调度</h2>
          <p class="section-desc">
            {{ totalTriggers }} 次触发 · 鼠标悬浮查看精确时间 · 圆点颜色越深表示越早触发
          </p>
        </div>
        <div class="gantt-legend">
          <span class="legend-chip legend-soon"></span><span class="legend-text">1 小时内</span>
          <span class="legend-chip legend-later"></span><span class="legend-text">稍晚</span>
        </div>
      </div>
    </div>

    <!-- Timeline header (hour labels) -->
    <div class="gantt-header">
      <div class="gantt-name-col"></div>
      <div class="gantt-timeline-col">
        <div
          v-for="(h, i) in hourMarks"
          :key="h"
          class="gantt-hour-mark"
          :style="{ left: (i / (hourMarks.length - 1) * 100) + '%' }"
        >
          <div class="gantt-hour-tick"></div>
          <div class="gantt-hour-label">{{ formatHour(h) }}</div>
        </div>
      </div>
    </div>

    <!-- Job rows -->
    <div class="gantt-rows">
      <div v-for="j in visibleJobs" :key="j.id" class="gantt-row">
        <div class="gantt-name-col">
          <div class="gantt-name">{{ j.name || j.id }}</div>
          <div class="gantt-sched mono">{{ j.schedule }}</div>
        </div>
        <div class="gantt-timeline-col">
          <div class="gantt-track"></div>
          <div
            v-for="(t, idx) in j.triggers"
            :key="idx"
            :class="['gantt-dot', { 'dot-soon': t.soon }]"
            :style="{ left: t.pct + '%' }"
            :title="`${j.name || j.id} · ${formatAbsTime(t.ts)}（${t.relLabel}）`"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CronExpressionParser } from 'cron-parser'

const props = defineProps<{ jobs: Array<{ id: string; name?: string; schedule?: string; enabled?: boolean }> }>()

const WINDOW_MS = 24 * 60 * 60 * 1000
const SOON_MS = 60 * 60 * 1000   // within 1h is "soon"

const hourMarks = computed(() => {
  const now = Date.now()
  const marks: number[] = []
  for (let i = 0; i <= 8; i++) {
    marks.push(now + (i * 3 * 60 * 60 * 1000))  // every 3h
  }
  return marks
})

interface Trigger { ts: number; pct: number; soon: boolean; relLabel: string }

const visibleJobs = computed(() => {
  const now = Date.now()
  const until = now + WINDOW_MS
  const out: Array<{ id: string; name?: string; schedule: string; triggers: Trigger[] }> = []
  for (const j of props.jobs) {
    if (j.enabled === false) continue
    if (!j.schedule) continue
    const triggers = computeTriggers(j.schedule, now, until)
    if (triggers.length === 0) continue
    out.push({ id: j.id, name: j.name, schedule: j.schedule, triggers })
  }
  return out
})

const totalTriggers = computed(() => visibleJobs.value.reduce((s, j) => s + j.triggers.length, 0))

function computeTriggers(expr: string, now: number, until: number): Trigger[] {
  const triggers: Trigger[] = []
  try {
    const interval = CronExpressionParser.parse(expr, {
      currentDate: new Date(now),
      endDate: new Date(until),
    })
    // Cap at 200 to avoid runaway (e.g. `* * * * *` would be 1440 in 24h)
    for (let i = 0; i < 200; i++) {
      try {
        const next = interval.next()
        const ts = next.getTime()
        if (ts > until) break
        const diff = ts - now
        triggers.push({
          ts,
          pct: Math.min(100, (diff / WINDOW_MS) * 100),
          soon: diff <= SOON_MS,
          relLabel: formatRel(diff),
        })
      } catch { break }
    }
  } catch { /* bad expression, skip */ }
  return triggers
}

function formatHour(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isTomorrow = d.getDate() !== now.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  return isTomorrow ? `明 ${h}:00` : `${h}:00`
}

function formatAbsTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatRel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s 后`
  if (s < 3600) return `${Math.floor(s / 60)}m 后`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return m > 0 ? `${h}h ${m}m 后` : `${h}h 后`
}
</script>

<style scoped>
.gantt-section { margin-bottom: var(--space-5); }

.gantt-legend { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); }
.legend-chip {
  width: 8px; height: 8px; border-radius: 50%;
  display: inline-block;
}
.legend-soon { background: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent); }
.legend-later { background: color-mix(in srgb, var(--accent) 40%, transparent); }
.legend-text { margin-right: 8px; }

.gantt-header,
.gantt-row {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 12px;
  align-items: center;
}

.gantt-header {
  padding: 8px 0 12px;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 8px;
}

.gantt-name-col {
  min-width: 0;
  overflow: hidden;
}
.gantt-timeline-col {
  position: relative;
  height: 32px;
}

/* Header hour ticks */
.gantt-hour-mark {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  text-align: center;
}
.gantt-hour-tick {
  width: 1px; height: 6px;
  background: var(--border-strong);
  margin: 0 auto;
}
.gantt-hour-label {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
}

/* Row */
.gantt-row {
  padding: 6px 0;
}
.gantt-row + .gantt-row { border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent); }

.gantt-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gantt-sched {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gantt-track {
  position: absolute;
  left: 0; right: 0;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
  background: var(--surface-2);
  border-radius: 1px;
}

.gantt-dot {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 40%, transparent);
  cursor: pointer;
  transition: all 0.15s;
  z-index: 1;
}
.gantt-dot:hover {
  width: 12px;
  height: 12px;
  z-index: 2;
}
.gantt-dot.dot-soon {
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  animation: gantt-pulse 2s ease-in-out infinite;
}
@keyframes gantt-pulse {
  0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
  50%      { box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 10%, transparent); }
}

@media (max-width: 760px) {
  .gantt-header, .gantt-row { grid-template-columns: 120px 1fr; gap: 6px; }
}
</style>
