<template>
  <div>
    <h1>仪表盘</h1>

    <!-- Row 1: Service control card -->
    <div class="row">
      <div class="card wide">
        <div class="card-header">
          <span class="card-title">OpenClaw 服务</span>
          <StatusBadge :state="svc.state" />
        </div>
        <p v-if="svc.pid" class="meta">PID: {{ svc.pid }}</p>
        <p v-if="svc.error" class="err">{{ svc.error }}</p>
        <div class="actions">
          <button @click="svc.start()" :disabled="svc.state === 'running' || svc.loading" class="btn primary">启动</button>
          <button @click="svc.stop()" :disabled="svc.state !== 'running' || svc.loading" class="btn danger">停止</button>
          <button @click="svc.restart()" :disabled="svc.loading" class="btn">重启</button>
          <RouterLink to="/chat" class="btn chat">进入聊天 →</RouterLink>
        </div>
      </div>
    </div>

    <!-- Row 2: Stats grid -->
    <div v-if="sys.stats" class="row">
      <!-- Model -->
      <div class="card stat-card">
        <div class="stat-icon">🤖</div>
        <div class="stat-body">
          <div class="stat-label">当前模型</div>
          <div class="stat-value small">{{ sys.stats.model ?? '未配置' }}</div>
        </div>
      </div>

      <!-- Memory -->
      <div class="card stat-card">
        <div class="stat-icon">💾</div>
        <div class="stat-body">
          <div class="stat-label">内存使用</div>
          <div class="stat-value">{{ sys.stats.system.memory.usedPercent }}%</div>
          <div class="stat-sub">{{ sys.stats.system.memory.freeMb }} MB 可用 / {{ sys.stats.system.memory.totalMb }} MB</div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: sys.stats.system.memory.usedPercent + '%' }" />
          </div>
        </div>
      </div>

      <!-- CPU -->
      <div class="card stat-card">
        <div class="stat-icon">⚙️</div>
        <div class="stat-body">
          <div class="stat-label">CPU 核数</div>
          <div class="stat-value">{{ sys.stats.system.cpuCount }}</div>
          <div class="stat-sub">{{ sys.stats.system.platform }}</div>
        </div>
      </div>

      <!-- Channels -->
      <div class="card stat-card">
        <div class="stat-icon">📡</div>
        <div class="stat-body">
          <div class="stat-label">已启用 Channel</div>
          <div class="stat-value">{{ sys.stats.channelCount }}</div>
          <RouterLink to="/channels" class="stat-link">管理 →</RouterLink>
        </div>
      </div>

      <!-- Uptime -->
      <div class="card stat-card">
        <div class="stat-icon">⏱️</div>
        <div class="stat-body">
          <div class="stat-label">系统运行时间</div>
          <div class="stat-value small">{{ formatUptime(sys.stats.system.uptimeSeconds) }}</div>
        </div>
      </div>
    </div>

    <div v-else-if="!sys.loading" class="hint">OpenClaw 未运行，无法获取统计信息</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useServiceStore } from '../stores/service.js'
import { useSystemStore } from '../stores/system.js'
import StatusBadge from '../components/StatusBadge.vue'

const svc = useServiceStore()
const sys = useSystemStore()

onMounted(async () => {
  await svc.refresh()
  if (svc.state === 'running') await sys.load()
})

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}天 ${h}小时`
  if (h > 0) return `${h}小时 ${m}分钟`
  return `${m}分钟`
}
</script>

<style scoped>
h1 { font-size: 22px; margin-bottom: 24px; }
.row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.wide { flex: 1; min-width: 320px; }
.stat-card { display: flex; align-items: flex-start; gap: 14px; min-width: 180px; flex: 1; }
.stat-icon { font-size: 24px; line-height: 1; margin-top: 2px; }
.stat-body { flex: 1; min-width: 0; }
.stat-label { font-size: 12px; color: #9ca3af; margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 700; color: #111; line-height: 1.1; }
.stat-value.small { font-size: 14px; font-weight: 600; word-break: break-all; }
.stat-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
.stat-link { font-size: 12px; color: #2563eb; text-decoration: none; margin-top: 4px; display: block; }
.progress-bar { height: 6px; background: #f3f4f6; border-radius: 3px; margin-top: 8px; overflow: hidden; }
.progress-fill { height: 100%; background: #2563eb; border-radius: 3px; transition: width .3s; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.card-title { font-size: 16px; font-weight: 600; }
.meta { color: #6b7280; font-size: 13px; margin: 0 0 12px; }
.err { color: #ef4444; font-size: 13px; margin-bottom: 10px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer; font-size: 14px; background: white; text-decoration: none; display: inline-flex; align-items: center; }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn.primary { background: #2563eb; color: white; border-color: #2563eb; }
.btn.danger  { background: #ef4444; color: white; border-color: #ef4444; }
.btn.chat    { background: #059669; color: white; border-color: #059669; }
.hint { color: #9ca3af; font-size: 14px; }
</style>
