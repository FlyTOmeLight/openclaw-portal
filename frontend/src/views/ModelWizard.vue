<template>
  <div>
    <h1>模型配置</h1>

    <!-- Current providers -->
    <div class="section">
      <h2>已配置的 Provider</h2>
      <div v-for="(prov, id) in store.providers" :key="id" class="provider-row">
        <div class="prov-info">
          <strong>{{ id }}</strong>
          <span class="url">{{ prov.baseUrl }}</span>
          <span v-if="id === store.primary" class="primary-badge">主模型</span>
        </div>
        <div class="prov-actions">
          <button @click="setPrimary(id as string)" class="btn sm" :disabled="id === store.primary">设为主模型</button>
          <button @click="deleteProvider(id as string)" class="btn sm danger">删除</button>
        </div>
      </div>
      <p v-if="Object.keys(store.providers).length === 0" class="empty">暂无配置，请添加下方</p>
    </div>

    <!-- Add/edit form -->
    <div class="section card">
      <h2>添加 Provider</h2>
      <div class="form-row">
        <label>Provider ID</label>
        <input v-model="form.id" placeholder="如 qwen3-235b" />
      </div>
      <div class="form-row">
        <label>Base URL</label>
        <input v-model="form.baseUrl" placeholder="https://api.example.com/v1" />
      </div>
      <div class="form-row">
        <label>API Key</label>
        <input v-model="form.apiKey" type="password" placeholder="sk-..." />
      </div>
      <div class="form-row">
        <label>Model ID</label>
        <input v-model="form.modelId" placeholder="如 Qwen3-235B" />
      </div>
      <div class="form-row">
        <label>Model Name</label>
        <input v-model="form.modelName" placeholder="显示名称" />
      </div>
      <div class="form-actions">
        <button @click="testConnection" class="btn">测试连通性</button>
        <button @click="saveProvider" class="btn primary" :disabled="store.loading">保存</button>
      </div>
      <div v-if="store.testResult === 'ok'" class="test-ok">✓ 连通性测试通过</div>
      <div v-if="store.testResult === 'fail'" class="test-fail">✗ {{ store.testError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue'
import { useModelsStore } from '../stores/models.js'

const store = useModelsStore()
onMounted(() => store.load())

const form = reactive({ id: '', baseUrl: '', apiKey: '', modelId: '', modelName: '' })

async function testConnection() {
  await store.testProvider(form.baseUrl, form.apiKey, form.modelId)
}

async function saveProvider() {
  await store.saveProvider(form.id, {
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    api: 'openai-completions',
    models: [{ id: form.modelId, name: form.modelName, reasoning: false, input: ['text'], contextWindow: 131072, maxTokens: 8192 }],
  })
  Object.assign(form, { id: '', baseUrl: '', apiKey: '', modelId: '', modelName: '' })
}

async function deleteProvider(id: string) {
  if (confirm(`确认删除 ${id}？`)) await store.deleteProvider(id)
}

async function setPrimary(id: string) {
  const prov = store.providers[id]
  await store.setPrimary(`${id}/${prov.models[0].id}`)
}
</script>

<style scoped>
h1 { font-size: 22px; margin-bottom: 24px; }
h2 { font-size: 16px; margin-bottom: 16px; }
.section { margin-bottom: 32px; }
.card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); max-width: 560px; }
.provider-row { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: white; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.prov-info { display: flex; align-items: center; gap: 12px; }
.url { color: #6b7280; font-size: 13px; }
.primary-badge { background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.prov-actions { display: flex; gap: 6px; }
.form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.form-row label { font-size: 13px; color: #374151; font-weight: 500; }
.form-row input { padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
.form-actions { display: flex; gap: 8px; margin-top: 16px; }
.btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer; font-size: 14px; background: white; }
.btn.primary { background: #2563eb; color: white; border-color: #2563eb; }
.btn.danger  { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
.btn:disabled { opacity: .4; }
.test-ok   { margin-top: 10px; color: #059669; font-size: 13px; }
.test-fail { margin-top: 10px; color: #dc2626; font-size: 13px; }
.empty { color: #9ca3af; font-size: 14px; }
</style>
