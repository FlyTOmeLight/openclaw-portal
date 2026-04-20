<template>
  <section class="envprobe-card section-card">
    <div class="section-header">
      <div class="section-head-row">
        <div>
          <h2 class="section-title">环境自检</h2>
          <p class="section-desc">Node.js / 二进制 / 端口 / 权限 / 资源 / 网络连通性</p>
        </div>
        <div class="envprobe-actions">
          <div v-if="data" class="envprobe-summary">
            <span class="probe-chip chip-ok">{{ data.counts.ok }} 通过</span>
            <span v-if="data.counts.warn > 0" class="probe-chip chip-warn">{{ data.counts.warn }} 警告</span>
            <span v-if="data.counts.fail > 0" class="probe-chip chip-fail">{{ data.counts.fail }} 失败</span>
          </div>
          <n-button size="small" @click="run" :loading="loading">重新检查</n-button>
        </div>
      </div>
    </div>

    <div v-if="loading && !data" class="envprobe-empty">检查中…</div>
    <div v-else-if="!data" class="envprobe-empty">无数据</div>

    <div v-else class="envprobe-grid">
      <div
        v-for="group in groupedProbes"
        :key="group.category"
        class="envprobe-col"
      >
        <div class="envprobe-col-title">{{ group.category }}</div>
        <div
          v-for="p in group.items"
          :key="p.id"
          :class="['probe-line', `probe-${p.status}`]"
          :title="p.message"
        >
          <span class="probe-dot">{{ statusIcon(p.status) }}</span>
          <span class="probe-title-small">{{ p.title }}</span>
          <span class="probe-msg-small">{{ p.message }}</span>
          <n-button
            v-if="p.fix"
            size="tiny"
            :loading="fixing[p.fix.actionId]"
            @click="runFix(p)"
          >{{ p.fix.label }}</n-button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { NButton } from 'naive-ui'
import { api } from '../api/client.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'

const toast = useNaiveToast()
const loading = ref(false)
const data = ref<any>(null)
const fixing = reactive<Record<string, boolean>>({})

const groupedProbes = computed(() => {
  if (!data.value) return []
  const m = new Map<string, any[]>()
  for (const p of data.value.probes) {
    if (!m.has(p.category)) m.set(p.category, [])
    m.get(p.category)!.push(p)
  }
  const order = ['运行时', '依赖', '网络', '权限', '资源']
  return [...m.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0])
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    .map(([category, items]) => ({ category, items }))
})

async function run() {
  loading.value = true
  try { data.value = await api.envcheck.probes() }
  catch (err: any) { toast.error(`环境检查失败: ${err.message}`) }
  finally { loading.value = false }
}

async function runFix(probe: any) {
  if (!probe.fix) return
  const id = probe.fix.actionId
  fixing[id] = true
  try {
    const res = await api.envcheck.runFix(id)
    if (res.ok) { toast.success(res.message || '修复已执行'); setTimeout(run, 1500) }
    else toast.error(res.error || '修复失败')
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    fixing[id] = false
  }
}

function statusIcon(status: string): string {
  return status === 'ok' ? '✓' : status === 'warn' ? '⚠' : status === 'fail' ? '✗' : '–'
}

onMounted(run)
</script>

<style scoped>
.envprobe-card { margin-bottom: var(--space-4); }
.envprobe-actions { display: flex; align-items: center; gap: 12px; }
.envprobe-summary { display: flex; align-items: center; gap: 4px; }
.probe-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}
.chip-ok   { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }
.chip-warn { background: color-mix(in srgb, #f59e0b 15%, transparent); color: #f59e0b; }
.chip-fail { background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444; }

.envprobe-empty { padding: 40px 0; text-align: center; color: var(--text-muted); font-size: 13px; }

.envprobe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.envprobe-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.envprobe-col-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}

.probe-line {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  transition: background 0.1s;
}
.probe-line:hover { background: var(--surface-2); }

.probe-dot {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.probe-ok   .probe-dot { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }
.probe-warn .probe-dot { background: color-mix(in srgb, #f59e0b 15%, transparent); color: #f59e0b; }
.probe-fail .probe-dot { background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444; }

.probe-title-small {
  font-size: 12px;
  color: var(--text-primary);
  font-weight: 500;
  white-space: nowrap;
}
.probe-msg-small {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  grid-column: 2;
  grid-row: 2;
  margin-top: -2px;
}
.probe-line { grid-template-rows: auto auto; }
</style>
