<template>
  <div>
    <h1>Agent 概览</h1>
    <div class="grid">
      <div v-for="agent in agents" :key="agent.name" class="agent-card">
        <div class="agent-header">
          <span class="agent-name">{{ agent.name }}</span>
          <span class="skill-count">{{ agent.skillCount }} 个技能</span>
        </div>

        <div v-if="editing === agent.name" class="soul-editor">
          <textarea v-model="soulDraft" rows="6" />
          <div class="editor-actions">
            <button @click="cancelEdit" class="btn sm">取消</button>
            <button @click="saveSoul(agent.name)" class="btn sm primary">保存</button>
          </div>
        </div>
        <div v-else class="soul-preview">
          <p>{{ agent.soul || '(未配置 SOUL.md)' }}</p>
          <button @click="startEdit(agent)" class="btn sm">编辑 SOUL.md</button>
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
h1 { font-size: 22px; margin-bottom: 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.agent-card { background: white; border-radius: 10px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.07); }
.agent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.agent-name { font-weight: 700; font-size: 15px; text-transform: capitalize; }
.skill-count { font-size: 12px; background: #ede9fe; color: #5b21b6; padding: 2px 8px; border-radius: 10px; }
.soul-preview p { font-size: 13px; color: #4b5563; margin-bottom: 10px; line-height: 1.5; white-space: pre-wrap; max-height: 80px; overflow: hidden; }
.soul-editor textarea { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; font-size: 13px; resize: vertical; }
.editor-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer; font-size: 13px; background: white; }
.btn.primary { background: #2563eb; color: white; border-color: #2563eb; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
</style>
