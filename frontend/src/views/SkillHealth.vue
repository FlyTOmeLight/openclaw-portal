<template>
  <div class="page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">技能健康</h1>
        <p class="page-desc">扫描每个已装技能的依赖完整度。点击行查看四维详情:openclaw 注册、Python、Node、系统命令。</p>
      </div>
      <div class="header-actions">
        <n-button :loading="loading" @click="reload(true)">↻ 重扫</n-button>
      </div>
    </div>

    <!-- Stats -->
    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">技能总数</div>
        <div class="metric-value">{{ skills.length }}</div>
        <div class="metric-meta">workspace + 全局</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">健康</div>
        <div class="metric-value sh-ok">{{ okCount }}</div>
        <div class="metric-meta">所有声明依赖均已满足</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">缺包</div>
        <div class="metric-value sh-bad">{{ missingCount }}</div>
        <div class="metric-meta">{{ totalMissingItems }} 个依赖项缺失</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">未知</div>
        <div class="metric-value sh-muted">{{ unknownCount }}</div>
        <div class="metric-meta">未声明任何依赖</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="sh-filters">
      <n-input v-model:value="search" placeholder="按技能名搜索…" clearable size="small" style="max-width: 240px;" />
      <n-select
        v-model:value="agentFilter"
        :options="agentOptions"
        placeholder="所有 Agent"
        clearable
        size="small"
        style="width: 200px;"
      />
      <n-select
        v-model:value="statusFilter"
        :options="statusOptions"
        placeholder="所有状态"
        clearable
        size="small"
        style="width: 160px;"
      />
      <span class="sh-filter-hint" v-if="filtered.length !== skills.length">
        筛后 {{ filtered.length }} / {{ skills.length }}
      </span>
    </div>

    <!-- Table -->
    <div v-if="loading && skills.length === 0" class="sh-hint">扫描中…</div>
    <div v-else-if="error" class="sh-empty">{{ error }}</div>
    <div v-else-if="skills.length === 0" class="sh-empty">没有已装技能。</div>
    <table v-else class="sh-table">
      <thead>
        <tr>
          <th>技能</th>
          <th>Agent</th>
          <th class="sh-col-num">声明</th>
          <th class="sh-col-num">缺</th>
          <th>状态</th>
          <th class="sh-col-action">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in filtered" :key="(s.agent ?? '_global') + '/' + s.name" class="sh-row">
          <td class="sh-name">{{ s.name }}</td>
          <td>
            <span v-if="s.agent" class="badge badge-accent">{{ s.agent }}</span>
            <span v-else class="sh-global">全局</span>
          </td>
          <td class="sh-col-num">{{ s.totalDeclared }}</td>
          <td class="sh-col-num" :class="{ 'sh-bad': s.totalMissing > 0 }">{{ s.totalMissing }}</td>
          <td>
            <span :class="['sh-status', 'sh-status-' + s.status]">{{ statusLabel(s.status) }}</span>
          </td>
          <td class="sh-col-action">
            <n-button size="tiny" @click="openDetails(s)">查看</n-button>
          </td>
        </tr>
      </tbody>
    </table>

    <SkillDepsModal v-model:show="depsModal.show" :skill="depsModal.skill" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { api, type SkillHealthSummary } from '../api/client'
import SkillDepsModal from '../components/SkillDepsModal.vue'

const skills = ref<SkillHealthSummary[]>([])
const loading = ref(false)
const error = ref('')

const search = ref('')
const agentFilter = ref<string | null>(null)
const statusFilter = ref<'ok' | 'missing' | 'unknown' | null>(null)

const statusOptions = [
  { label: '健康', value: 'ok' },
  { label: '缺包', value: 'missing' },
  { label: '未知', value: 'unknown' },
]

const agentOptions = computed(() => {
  const set = new Set<string>()
  for (const s of skills.value) if (s.agent) set.add(s.agent)
  return [...set].sort().map(a => ({ label: a, value: a }))
})

const okCount = computed(() => skills.value.filter(s => s.status === 'ok').length)
const missingCount = computed(() => skills.value.filter(s => s.status === 'missing').length)
const unknownCount = computed(() => skills.value.filter(s => s.status === 'unknown').length)
const totalMissingItems = computed(() =>
  skills.value.reduce((acc, s) => acc + s.totalMissing, 0))

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return skills.value.filter(s => {
    if (q && !s.name.toLowerCase().includes(q)) return false
    if (agentFilter.value && s.agent !== agentFilter.value) return false
    if (statusFilter.value && s.status !== statusFilter.value) return false
    return true
  })
})

function statusLabel(s: 'ok' | 'missing' | 'unknown') {
  return s === 'ok' ? '健康' : s === 'missing' ? '缺包' : '未知'
}

async function reload(refresh: boolean) {
  loading.value = true
  error.value = ''
  try {
    const r = await api.skillDeps.health(refresh)
    skills.value = r.skills
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
  } finally {
    loading.value = false
  }
}

const depsModal = reactive<{ show: boolean; skill: { name: string; agent: string | null } | null }>({
  show: false, skill: null,
})

function openDetails(s: SkillHealthSummary) {
  depsModal.skill = { name: s.name, agent: s.agent }
  depsModal.show = true
}

onMounted(() => { void reload(false) })
</script>

<style scoped>
.sh-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 12px;
  flex-wrap: wrap;
}
.sh-filter-hint { color: var(--text-muted); font-size: var(--text-xs); }

.sh-hint, .sh-empty {
  color: var(--text-muted);
  font-size: var(--text-sm);
  padding: 30px;
  text-align: center;
}

.sh-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface-1, transparent);
}
.sh-table th,
.sh-table td {
  padding: 9px 12px;
  text-align: left;
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--border);
}
.sh-table th {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.sh-row:hover { background: var(--surface-2, rgba(0,0,0,0.02)); }
.sh-name { font-family: var(--font-mono); color: var(--text-primary); font-weight: 500; }
.sh-col-num { text-align: right; font-variant-numeric: tabular-nums; }
.sh-col-action { text-align: right; }
.sh-global { color: var(--text-muted); font-size: var(--text-xs); }

.sh-status {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid currentColor;
}
.sh-status-ok { color: var(--success, #16a34a); }
.sh-status-missing { color: var(--danger, #dc2626); }
.sh-status-unknown { color: var(--text-muted); }

.sh-ok { color: var(--success, #16a34a); }
.sh-bad { color: var(--danger, #dc2626); }
.sh-muted { color: var(--text-muted); }
</style>
