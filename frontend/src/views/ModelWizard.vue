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
          <button @click="setPrimary(id as string)" class="btn btn-sm" :disabled="id === store.primary">设为主模型</button>
          <button @click="deleteProvider(id as string)" class="btn btn-sm btn-danger">删除</button>
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
        <button @click="saveProvider" class="btn btn-primary" :disabled="store.loading">保存</button>
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
h1 { font-size: var(--text-xl); font-weight: 700; margin-bottom: var(--space-6); letter-spacing: -.3px; }
h2 { font-size: var(--text-md); font-weight: 600; margin-bottom: var(--space-4); }
.section { margin-bottom: var(--space-8); }
.provider-row { display: flex; justify-content: space-between; align-items: center; padding: var(--space-3) var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-2); }
.prov-info { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.primary-badge { background: var(--accent-subtle); color: var(--accent-text); padding: 2px 8px; border-radius: var(--radius-full); font-size: var(--text-xs); font-weight: 500; }
.url { color: var(--text-secondary); font-size: var(--text-xs); font-family: var(--font-mono); }
.prov-actions { display: flex; gap: 6px; }
.form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.form-row label { font-size: var(--text-sm); color: var(--text-primary); font-weight: 500; }
.form-row input { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); font-size: var(--text-base); font-family: var(--font-sans); background: var(--surface); color: var(--text-primary); outline: none; transition: border-color .15s; }
.form-row input:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px rgba(217,119,6,.1); }
.form-actions { display: flex; gap: var(--space-2); margin-top: var(--space-4); }
.test-ok   { margin-top: var(--space-3); color: var(--success-text); font-size: var(--text-sm); font-weight: 500; }
.test-fail { margin-top: var(--space-3); color: var(--error-text); font-size: var(--text-sm); }
.empty { color: var(--text-muted); font-size: var(--text-sm); }
</style>
