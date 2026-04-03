<template>
  <div>
    <div class="page-header">
      <h1>技能管理</h1>
      <button @click="showUpload = true" class="btn primary">安装技能包</button>
    </div>

    <!-- Upload modal -->
    <div v-if="showUpload" class="modal-overlay" @click.self="showUpload = false">
      <div class="modal">
        <h2>安装 .skill 包</h2>
        <div class="form-row">
          <label>选择文件 (.skill zip)</label>
          <input type="file" @change="onFileChange" accept=".skill,.zip" />
        </div>
        <div class="form-row">
          <label>所属 Agent (可选)</label>
          <select v-model="uploadAgent">
            <option value="">全局 (main agent)</option>
            <option v-for="a in agents" :key="a" :value="a">{{ a }}</option>
          </select>
        </div>
        <div class="modal-actions">
          <button @click="showUpload = false" class="btn">取消</button>
          <button @click="doInstall" :disabled="!uploadFile" class="btn primary">安装</button>
        </div>
      </div>
    </div>

    <!-- Skills grouped by agent -->
    <div v-for="group in groups" :key="group.label" class="group">
      <h2>{{ group.label }} <span class="count">({{ group.skills.length }})</span></h2>
      <div class="grid">
        <SkillCard
          v-for="skill in group.skills"
          :key="skill.name"
          :skill="skill"
          @disable="store.disable"
          @enable="store.enable"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSkillsStore } from '../stores/skills.js'
import SkillCard from '../components/SkillCard.vue'

const store = useSkillsStore()
onMounted(() => store.load())

const showUpload = ref(false)
const uploadFile = ref<File | null>(null)
const uploadAgent = ref('')
const agents = ['finance', 'bioinfo', 'medical', 'legal', 'frontend']

function onFileChange(e: Event) {
  uploadFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function doInstall() {
  if (!uploadFile.value) return
  await store.install(uploadFile.value, uploadAgent.value || null)
  showUpload.value = false
  uploadFile.value = null
}

const groups = computed(() => {
  const map: Record<string, any[]> = { '全局': [] }
  for (const a of agents) map[a] = []
  for (const s of store.skills) {
    const key = s.agent ?? '全局'
    if (!map[key]) map[key] = []
    map[key].push(s)
  }
  return Object.entries(map)
    .filter(([, skills]) => skills.length > 0)
    .map(([label, skills]) => ({ label, skills }))
})
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
h1 { font-size: 22px; }
h2 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.count { font-size: 13px; color: #9ca3af; font-weight: 400; }
.group { margin-bottom: 32px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer; font-size: 14px; background: white; }
.btn.primary { background: #2563eb; color: white; border-color: #2563eb; }
.btn:disabled { opacity: .4; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: white; border-radius: 12px; padding: 28px; min-width: 400px; }
.modal h2 { margin-bottom: 20px; font-size: 16px; }
.form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
.form-row label { font-size: 13px; font-weight: 500; }
.form-row input, .form-row select { padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
