<template>
  <Teleport to="body">
    <div v-if="show" class="ui-modal-overlay" @click.self="close">
      <div class="ui-modal sd-modal" role="dialog" aria-modal="true">
        <div class="ui-modal-header">
          <div class="ui-modal-copy">
            <div class="ui-modal-title">
              依赖检查 · {{ skill?.name }}
              <span v-if="skill?.agent" class="badge badge-accent" style="margin-left: 8px;">{{ skill.agent }}</span>
            </div>
            <div class="ui-modal-subtitle">
              <template v-if="report">
                共声明 {{ totalDeclared }} 项 · <span :class="['sd-summary', report.totalMissing ? 'sd-bad' : 'sd-ok']">缺 {{ report.totalMissing }}</span>
                · 扫描于 {{ scannedAtLabel }}
              </template>
              <template v-else-if="loading">扫描中…</template>
              <template v-else-if="error">{{ error }}</template>
              <template v-else>—</template>
            </div>
          </div>
          <div class="sd-header-actions">
            <button class="btn btn-sm" :disabled="loading" @click="reload(true)" title="忽略缓存,强制重新扫描">↻ 刷新</button>
            <button class="ui-modal-close" @click="close">✕</button>
          </div>
        </div>

        <div class="sd-body">
          <div v-if="loading" class="sd-hint">正在扫描依赖…</div>
          <div v-else-if="error" class="sd-empty">{{ error }}</div>
          <template v-else-if="report">
            <DepSection title="openclaw 注册" :result="report.openclaw"
              empty-hint="openclaw CLI 不可用或没返回结果(忽略此维度)" />
            <DepSection title="Python 依赖" :result="report.python"
              empty-hint="未发现 requirements.txt / pyproject.toml" />
            <DepSection title="Node 依赖" :result="report.node"
              empty-hint="未发现 package.json" />
            <DepSection title="系统命令" :result="report.system"
              empty-hint="脚本里未识别到外部命令(扫描器为启发式,可能漏报)" />
            <div class="sd-foot">
              <span class="sd-foot-label">技能路径</span>
              <code class="sd-foot-path">{{ report.path }}</code>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed, defineComponent, h } from 'vue'
import { api, type SkillDepsReport, type DepCategoryResult } from '../api/client'

const props = defineProps<{ show: boolean; skill: { name: string; agent: string | null } | null }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()

const report = ref<SkillDepsReport | null>(null)
const loading = ref(false)
const error = ref('')

const totalDeclared = computed(() =>
  report.value
    ? report.value.openclaw.declared + report.value.system.declared +
      report.value.node.declared + report.value.python.declared
    : 0
)

const scannedAtLabel = computed(() => {
  if (!report.value) return ''
  const d = new Date(report.value.scannedAt)
  return d.toLocaleTimeString()
})

watch(() => props.show, (v) => {
  if (v && props.skill) {
    void reload(false)
  } else {
    report.value = null
    error.value = ''
  }
})

async function reload(refresh: boolean) {
  if (!props.skill) return
  loading.value = true
  error.value = ''
  try {
    report.value = await api.skillDeps.checkSkill(props.skill.agent, props.skill.name, refresh)
  } catch (e: any) {
    error.value = e?.message ?? '扫描失败'
    report.value = null
  } finally {
    loading.value = false
  }
}

function close() { emit('update:show', false) }

// Inlined section component — keeps the modal self-contained.
const DepSection = defineComponent({
  props: {
    title: { type: String, required: true },
    result: { type: Object as () => DepCategoryResult, required: true },
    emptyHint: { type: String, default: '—' },
  },
  setup(p) {
    return () => {
      const r = p.result
      const isEmpty = r.declared === 0
      const missingBadge = r.missing > 0
        ? h('span', { class: 'sd-pill sd-bad' }, `缺 ${r.missing}`)
        : (r.present > 0 ? h('span', { class: 'sd-pill sd-ok' }, `全 ${r.present}`) : null)
      return h('section', { class: 'sd-section' }, [
        h('div', { class: 'sd-section-head' }, [
          h('span', { class: 'sd-section-title' }, p.title),
          missingBadge,
        ]),
        isEmpty
          ? h('div', { class: 'sd-section-empty' }, p.emptyHint)
          : h('ul', { class: 'sd-items' }, r.items.map(it =>
              h('li', { class: ['sd-item', it.present ? 'sd-item-ok' : 'sd-item-bad'] }, [
                h('span', { class: 'sd-item-icon' }, it.present ? '✓' : '✗'),
                h('span', { class: 'sd-item-name' }, it.name),
                it.declaredIn ? h('span', { class: 'sd-item-src' }, it.declaredIn) : null,
                it.detail ? h('span', { class: 'sd-item-detail' }, it.detail) : null,
              ]),
            )),
      ])
    }
  },
})
</script>

<style scoped>
.sd-modal {
  width: min(720px, 92vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
}
.sd-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sd-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 22px 22px;
  min-height: 0;
}
.sd-hint, .sd-empty {
  color: var(--text-muted);
  font-size: var(--text-sm);
  padding: 24px 8px;
  text-align: center;
}

.sd-summary { font-weight: 600; }
.sd-ok { color: var(--success, #16a34a); }
.sd-bad { color: var(--danger, #dc2626); }

.sd-section { margin-bottom: 18px; }
.sd-section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.sd-section-title {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
}
.sd-section-empty {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-style: italic;
  padding: 4px 0 8px;
}
.sd-pill {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid currentColor;
}

.sd-items {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.sd-item {
  display: grid;
  grid-template-columns: 18px minmax(120px, 1fr) auto auto;
  gap: 10px;
  align-items: baseline;
  padding: 6px 12px;
  font-size: var(--text-xs);
  border-bottom: 1px solid var(--border);
}
.sd-item:last-child { border-bottom: none; }
.sd-item-ok { background: var(--surface-1, transparent); }
.sd-item-bad { background: rgba(220, 38, 38, 0.06); }
.sd-item-icon { font-weight: 700; }
.sd-item-ok .sd-item-icon { color: var(--success, #16a34a); }
.sd-item-bad .sd-item-icon { color: var(--danger, #dc2626); }
.sd-item-name {
  font-family: var(--font-mono);
  color: var(--text-primary);
  word-break: break-word;
}
.sd-item-src {
  color: var(--text-muted);
  font-size: 11px;
  font-style: italic;
}
.sd-item-detail {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.sd-foot {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.sd-foot-label { color: var(--text-muted); }
.sd-foot-path {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  word-break: break-all;
}
</style>
