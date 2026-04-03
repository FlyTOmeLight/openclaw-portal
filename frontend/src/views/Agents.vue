<template>
  <div>
    <h1>Agent 概览</h1>
    <div class="grid">
      <div v-for="agent in agents" :key="agent.name" class="card agent-card">
        <div class="agent-header">
          <span class="agent-name">{{ agent.name }}</span>
          <span class="skill-count">{{ agent.skillCount }} 个技能</span>
        </div>

        <div v-if="editing === agent.name" class="soul-editor">
          <textarea v-model="soulDraft" rows="6" class="form-textarea" />
          <div class="editor-actions">
            <button @click="cancelEdit" class="btn btn-sm">取消</button>
            <button @click="saveSoul(agent.name)" class="btn btn-sm btn-primary">保存</button>
          </div>
        </div>
        <div v-else class="soul-preview">
          <p>{{ agent.soul || '(未配置 SOUL.md)' }}</p>
          <button @click="startEdit(agent)" class="btn btn-sm">编辑 SOUL.md</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '../api/client.js'

const agents = ref<any[]>([])
const editing = ref<string | null>(null)
const soulDraft = ref('')

onMounted(async () => {
  agents.value = await api.agents.list()
})

function startEdit(agent: any) {
  editing.value = agent.name
  soulDraft.value = agent.soul
}

function cancelEdit() {
  editing.value = null
}

async function saveSoul(name: string) {
  await api.agents.updateSoul(name, soulDraft.value)
  const agent = agents.value.find(a => a.name === name)
  if (agent) {
    agent.soul = soulDraft.value
  }
  editing.value = null
}
</script>

<style scoped>
h1 { font-size: var(--text-xl); font-weight: 700; margin-bottom: var(--space-6); letter-spacing: -.3px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-4); }
.agent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4); }
.agent-name { font-weight: 700; font-size: var(--text-md); text-transform: capitalize; }
.skill-count { font-size: var(--text-xs); background: var(--accent-subtle); color: var(--accent-text); padding: 2px 8px; border-radius: var(--radius-full); }
.soul-preview p { font-size: var(--text-sm); color: var(--text-secondary); margin-bottom: var(--space-3); line-height: 1.55; white-space: pre-wrap; max-height: 80px; overflow: hidden; }
.editor-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: var(--space-2); }
.soul-editor .form-textarea { width: 100%; }
</style>
