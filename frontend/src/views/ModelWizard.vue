<template>
  <div class="page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">模型配置</h1>
        <p class="subtitle">统一维护 Provider、模型入口和主模型切换策略。</p>
      </div>
      <n-button type="primary" @click="openAdd">+ 添加 Provider</n-button>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">Provider 总数</div>
        <div class="metric-value">{{ sortedProviderEntries.length }}</div>
        <div class="metric-meta">已配置的模型服务提供商</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">模型总数</div>
        <div class="metric-value">{{ totalModelCount }}</div>
        <div class="metric-meta">所有 Provider 下的模型数量</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">默认主模型</div>
        <div class="metric-value metric-value-sm">{{ primarySummaryLabel }}</div>
        <div class="metric-meta mono">{{ primarySummaryHint }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Fallback 模型</div>
        <div class="metric-value">{{ fallbackSummaries.length }}</div>
        <div v-if="fallbackSummaries.length" class="fallback-chips">
          <button
            v-for="fallback in fallbackSummaries"
            :key="fallback.ref"
            class="fallback-chip"
            type="button"
            @click="removeFallbackRef(fallback.ref)"
            :title="`点击移除 ${fallback.ref}`"
          >
            {{ fallback.label }} ×
          </button>
        </div>
        <div v-else class="metric-meta">主模型失败时按顺序切换</div>
      </div>
    </div>

    <!-- Provider cards -->
    <section class="section-card">
      <div class="section-header">
        <h2 class="section-title">Provider 列表</h2>
        <p class="section-desc">按 Provider 聚合展示模型入口，点击模型可设为主/ Fallback。</p>
      </div>
    <div class="provider-grid">
      <div
        v-for="entry in sortedProviderEntries"
        :key="entry.id"
        class="provider-card"
        :class="{ 'is-primary': isPrimary(entry.id) }"
      >
        <template v-if="entry.prov">

        <div class="prov-header">
          <div class="prov-identity">
            <div class="prov-model-name">{{ sortedProviderModels(entry.id, entry.prov)[0]?.name || sortedProviderModels(entry.id, entry.prov)[0]?.id || entry.id }}</div>
            <div class="prov-id-row">
              <span class="prov-id">{{ entry.id }}</span>
              <span class="prov-api-badge">{{ apiLabel(entry.prov.api) }}</span>
            </div>
          </div>
          <div class="prov-badges">
            <span v-if="isPrimary(entry.id)" class="primary-badge">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1l1.5 3 3.5.5-2.5 2.4.6 3.5L6 9 2.9 10.4l.6-3.5L1 4.5 4.5 4z"/></svg>
              主模型
            </span>
            <span
              v-if="testStates[entry.id]"
              class="conn-dot"
              :class="'dot-' + testStates[entry.id]?.status"
              :title="testStates[entry.id]?.status === 'ok' ? '连通正常' : testStates[entry.id]?.status === 'fail' ? testStates[entry.id]?.error : '测试中'"
            />
          </div>
        </div>

        <div class="prov-meta">
          <div class="meta-item">
            <span class="meta-icon">🔗</span>
            <span class="meta-text mono" :title="entry.prov.baseUrl">{{ entry.prov.baseUrl }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-icon">🔑</span>
            <span class="meta-text mono">{{ maskKey(entry.prov.apiKey) }}</span>
          </div>
          <div v-if="providerModels(entry.prov).length" class="meta-chips">
            <span class="chip">{{ providerModels(entry.prov).length }} 个模型</span>
            <span v-if="providerModels(entry.prov).some((model) => isFallback(entry.id, model.id))" class="chip">
              {{ providerModels(entry.prov).filter((model) => isFallback(entry.id, model.id)).length }} 个 fallback
            </span>
          </div>
        </div>

        <div v-if="providerModels(entry.prov).length" class="provider-model-list">
          <div
            v-for="model in visibleProviderModels(entry.id, entry.prov)"
            :key="model.id"
            class="provider-model-item"
            :class="{ 'is-selected': isPrimary(entry.id, model.id) }"
          >
            <div class="provider-model-main">
              <div class="provider-model-title-row">
                <span class="provider-model-title">{{ model.name || model.id }}</span>
                <span v-if="isPrimary(entry.id, model.id)" class="chip chip-accent">当前主模型</span>
                <span v-else-if="isFallback(entry.id, model.id)" class="chip">Fallback</span>
              </div>
              <div class="provider-model-sub">{{ model.id }}</div>
              <div class="meta-chips">
                <span v-if="model.contextWindow" class="chip">
                  {{ (model.contextWindow / 1024).toFixed(0) }}K ctx
                </span>
                <span v-if="model.maxTokens" class="chip">
                  {{ model.maxTokens }} out
                </span>
                <span v-if="model.reasoning" class="chip chip-accent">思维链</span>
              </div>
            </div>
            <div class="provider-model-actions">
              <button class="act-btn act-inline act-quiet" @click="testCard(entry.id, model.id)" :disabled="testStates[entry.id]?.status === 'testing'">
                测试
              </button>
              <button
                v-if="!isPrimary(entry.id, model.id)"
                class="act-btn act-inline act-primary"
                @click="setPrimary(entry.id, model.id)"
              >
                设为主模型
              </button>
              <button
                v-if="!isPrimary(entry.id, model.id)"
                class="act-btn act-inline act-quiet"
                :class="{ 'act-danger': isFallback(entry.id, model.id) }"
                @click="toggleFallback(entry.id, model.id)"
              >
                {{ isFallback(entry.id, model.id) ? '移除 fallback' : '设为 fallback' }}
              </button>
            </div>
          </div>
          <button
            v-if="providerModels(entry.prov).length > collapsedModelCount"
            class="expand-models-btn"
            type="button"
            @click="toggleProviderExpanded(entry.id)"
          >
            {{ isProviderExpanded(entry.id)
              ? `收起模型列表`
              : `展开查看更多（还有 ${providerModels(entry.prov).length - collapsedModelCount} 个）` }}
          </button>
        </div>

        <div v-if="testStates[entry.id]" class="test-bar" :class="'bar-' + testStates[entry.id]?.status">
          <template v-if="testStates[entry.id]?.status === 'testing'">
            <span class="spin">⟳</span> 测试中…
          </template>
          <template v-else-if="testStates[entry.id]?.status === 'ok'">
            <span class="bar-icon">✓</span> 连通正常
            <span class="latency-pill" :class="'lp-' + latencyTagType(testStates[entry.id]!.latency!)">
              {{ testStates[entry.id]!.latency }}ms
            </span>
          </template>
          <template v-else>
            <span class="bar-icon">✗</span>
            <span class="bar-err">{{ testStates[entry.id]?.error }}</span>
          </template>
        </div>

        <div class="prov-actions">
          <button class="act-btn act-quiet" @click="openEdit(entry.id)">编辑</button>
          <button class="act-btn act-quiet act-danger" @click="del(entry.id)">删除</button>
        </div>
        </template>
      </div>

      <div v-if="Object.keys(store.providers).length === 0" class="empty-state">
        暂无 Provider，点击右上角"添加"开始配置
      </div>
    </div>
    </section>

    <Transition name="dialog">
      <div v-if="modal.open" class="dialog-overlay" @click.self="closeModal">
      <div class="dialog-panel" role="dialog" aria-modal="true">
        <!-- stripe matching card -->
        <div class="drawer-stripe" :class="{ 'stripe-edit': modal.isEdit }" />

        <div class="drawer-header">
          <div>
            <div class="drawer-title">{{ modal.isEdit ? '编辑 Provider' : '添加 Provider' }}</div>
            <div class="drawer-subtitle">填写模型服务入口、密钥和默认模型参数</div>
          </div>
          <button class="close-btn" @click="closeModal" aria-label="关闭">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="drawer-body">
          <!-- 基本信息 -->
          <div class="form-section">
            <div class="section-label">基本信息</div>
            <div class="form-group">
              <label class="form-label">厂商预设</label>
              <select class="form-select" :value="selectedPresetKey" @change="onPresetChange">
                <option value="custom">自定义</option>
                <option v-for="preset in providerPresets" :key="preset.key" :value="preset.key">
                  {{ preset.label }}
                </option>
              </select>
              <div class="form-hint">
                {{ presetDescription }}
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Provider ID</label>
              <input
                class="form-input"
                :class="{ 'is-disabled': modal.isEdit }"
                v-model="form.id"
                :disabled="modal.isEdit"
                placeholder="如 qwen3-235b"
                autocomplete="off"
              />
            </div>
            <div class="form-group">
              <label class="form-label">API 类型</label>
              <select class="form-select" v-model="form.api">
                <option v-for="option in apiOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>

          <!-- 连接配置 -->
          <div class="form-section">
            <div class="section-label">连接配置</div>
            <div class="form-group">
              <label class="form-label">Base URL</label>
              <input class="form-input mono" v-model="form.baseUrl" placeholder="https://api.example.com/v1" autocomplete="off" />
              <div class="form-hint">{{ baseUrlHint }}</div>
            </div>
            <div class="form-group">
              <label class="form-label">
                API Key
                <span v-if="isApiKeyOptional" class="label-opt">可选</span>
              </label>
              <div class="input-wrap">
                <input
                  :type="showKey ? 'text' : 'password'"
                  class="form-input mono"
                  v-model="form.apiKey"
                  :placeholder="apiKeyPlaceholder"
                  autocomplete="new-password"
                />
                <button class="show-key-btn" type="button" @click="showKey = !showKey">
                  {{ showKey ? '隐藏' : '显示' }}
                </button>
              </div>
            </div>
          </div>

          <!-- 模型参数 -->
          <div class="form-section form-section-full">
            <div class="section-label">模型参数</div>
            <div v-if="configuredModels.length" class="form-group">
              <div class="form-inline-head">
                <label class="form-label">已配置模型</label>
                <button class="act-btn act-inline" type="button" @click="startNewModelDraft">
                  新增模型
                </button>
              </div>
              <div class="configured-model-list">
                <div
                  v-for="(model, index) in configuredModels"
                  :key="model.id + '-' + index"
                  class="configured-model-item"
                  :class="{ 'is-selected': modelEditor.activeIndex === index }"
                >
                  <button class="configured-model-main" type="button" @click="editConfiguredModel(index)">
                    <span class="configured-model-title">{{ model.name || model.id }}</span>
                    <span class="configured-model-sub">{{ model.id }}</span>
                  </button>
                  <div class="provider-model-actions">
                    <button class="act-btn act-inline act-quiet" type="button" @click="moveConfiguredModel(index, -1)" :disabled="index === 0">上移</button>
                    <button class="act-btn act-inline act-quiet" type="button" @click="moveConfiguredModel(index, 1)" :disabled="index === configuredModels.length - 1">下移</button>
                    <button class="act-btn act-inline act-quiet" type="button" @click="editConfiguredModel(index)">编辑</button>
                    <button class="act-btn act-inline act-quiet act-danger" type="button" @click="removeConfiguredModel(index)">删除</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="form-group">
              <div class="form-inline-head">
                <label class="form-label">
                  {{ modelEditor.activeIndex >= 0 ? '编辑当前模型' : '模型草稿' }}
                </label>
                <button class="act-btn act-inline" type="button" @click="upsertDraftModel(true)">
                  {{ modelEditor.activeIndex >= 0 ? '更新到列表' : '加入列表' }}
                </button>
              </div>
              <div class="form-hint">
                一个 Provider 现在可以配置多个模型；保存 Provider 前可先逐个加入列表。
              </div>
            </div>
            <div v-if="suggestedModels.length" class="form-group">
              <label class="form-label">
                常见模型
                <span class="label-opt">自动填充</span>
              </label>
              <select class="form-select" :value="selectedModelPresetId" @change="onModelPresetChange">
                <option value="">选择常见模型</option>
                <option v-for="model in suggestedModels" :key="model.id" :value="model.id">
                  {{ model.name }} · {{ model.id }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <div class="form-inline-head">
                <label class="form-label">远程模型列表</label>
                <button class="act-btn act-inline" @click="fetchRemoteModels" :disabled="remoteModels.loading">
                  {{ remoteModels.loading ? '拉取中…' : '主动拉取' }}
                </button>
              </div>
              <div class="form-hint">
                默认使用上面的预设模型；如需厂商实时返回的模型列表，再手动拉取。
              </div>
              <div v-if="remoteModels.error" class="form-hint form-hint-error">{{ remoteModels.error }}</div>
              <template v-else-if="remoteModels.items.length">
                <input
                  class="form-input mono"
                  v-model="remoteModels.search"
                  placeholder="搜索远程模型，如 gpt / qwen / claude"
                  autocomplete="off"
                />
                <div class="form-hint">
                  已拉取 {{ remoteModels.items.length }} 个模型，当前显示 {{ visibleRemoteModels.length }} 个。
                </div>
                <div class="remote-model-list">
                  <div
                    v-for="modelId in visibleRemoteModels"
                    :key="modelId"
                    class="remote-model-item"
                    :class="{ 'is-selected': form.modelId === modelId }"
                  >
                    <button class="remote-model-name" type="button" @click="applyRemoteModel(modelId)">
                      {{ modelId }}
                    </button>
                    <button class="act-btn act-inline" type="button" @click="applyRemoteModel(modelId)">
                      应用
                    </button>
                  </div>
                </div>
                <div v-if="filteredRemoteModels.length === 0" class="form-hint">
                  没有匹配“{{ remoteModels.search }}”的远程模型。
                </div>
                <div v-else-if="filteredRemoteModels.length > visibleRemoteModels.length" class="form-hint">
                  结果较多，仅展示前 {{ visibleRemoteModels.length }} 个，请继续缩小搜索范围。
                </div>
              </template>
              <div v-else class="form-hint">
                尚未拉取远程模型列表。
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Model ID</label>
              <input class="form-input mono" v-model="form.modelId" :placeholder="modelIdPlaceholder" autocomplete="off" />
            </div>
            <div class="form-group">
              <label class="form-label">
                显示名称
                <span class="label-opt">可选</span>
              </label>
              <input class="form-input" v-model="form.modelName" placeholder="留空则同 Model ID" autocomplete="off" />
            </div>
            <div class="form-row-2">
              <div class="form-group">
                <label class="form-label">Context Window</label>
                <input class="form-input" type="number" v-model.number="form.contextWindow" placeholder="131072" min="1" />
              </div>
              <div class="form-group">
                <label class="form-label">Max Tokens</label>
                <input class="form-input" type="number" v-model.number="form.maxTokens" placeholder="8192" min="1" />
              </div>
            </div>
            <label class="form-toggle">
              <input type="checkbox" v-model="form.reasoning" class="toggle-checkbox" />
              <span class="toggle-track"><span class="toggle-thumb" /></span>
              <span class="toggle-label">支持 Reasoning（思维链）</span>
              <span v-if="form.reasoning" class="chip chip-accent">思维链</span>
            </label>
          </div>

          <!-- 测试结果 -->
          <div v-if="modal.testStatus" class="test-bar form-section-full" :class="'bar-' + modal.testStatus">
            <template v-if="modal.testStatus === 'testing'"><span class="spin">⟳</span> 测试中…</template>
            <template v-else-if="modal.testStatus === 'ok'"><span class="bar-icon">✓</span> 连通性测试通过</template>
            <template v-else><span class="bar-icon">✗</span><span class="bar-err">{{ modal.testError }}</span></template>
          </div>
        </div>

        <div class="drawer-footer">
          <button class="act-btn" @click="testModal" :disabled="modal.testStatus === 'testing'">测试连通性</button>
          <div class="footer-right">
            <button class="act-btn" @click="closeModal">取消</button>
            <button class="act-btn act-save" @click="save" :disabled="store.loading">
              {{ store.loading ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import { useModelsStore } from '../stores/models.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'
import { api } from '../api/client.js'
import {
  API_OPTIONS,
  PROVIDER_PRESETS,
  detectProviderPreset,
  getProviderPreset,
  type ModelPreset,
  type PortalModelApi,
} from '../lib/model-presets.js'

const store = useModelsStore()
const toast = useNaiveToast()
onMounted(() => store.load())
const apiOptions = API_OPTIONS
const providerPresets = PROVIDER_PRESETS
const selectedPresetKey = ref('custom')

interface TestState { status: 'testing' | 'ok' | 'fail'; latency?: number; error?: string }
const testStates = reactive<Record<string, TestState>>({})
const showKey = ref(false)
const remoteModelCache = new Map<string, string[]>()
const modelEditor = reactive({ activeIndex: -1 })
const expandedProviders = reactive<Record<string, boolean>>({})
const collapsedModelCount = 2

const modal = reactive({
  open: false,
  isEdit: false,
  testStatus: '' as '' | 'testing' | 'ok' | 'fail',
  testError: '',
})
const remoteModels = reactive({
  loading: false,
  items: [] as string[],
  error: '',
  search: '',
})
const configuredModels = ref<ModelPreset[]>([])

const form = reactive({
  id: '', api: 'openai-completions' as PortalModelApi, baseUrl: '', apiKey: '',
  modelId: '', modelName: '', contextWindow: 131072, maxTokens: 8192, reasoning: false,
})

const selectedPreset = computed(() => getProviderPreset(selectedPresetKey.value))
const suggestedModels = computed(() => selectedPreset.value?.models ?? [])
const sortedProviderEntries = computed(() =>
  Object.entries(store.providers)
    .map(([id, prov]) => ({ id, prov }))
    .sort((a, b) => {
      const aPrimary = isPrimary(a.id) ? 1 : 0
      const bPrimary = isPrimary(b.id) ? 1 : 0
      if (aPrimary !== bPrimary) return bPrimary - aPrimary
      return a.id.localeCompare(b.id)
    }))
const totalModelCount = computed(() =>
  sortedProviderEntries.value.reduce((sum, entry) =>
    sum + (entry.prov?.models?.length ?? 0), 0)
)
const primarySummaryLabel = computed(() => describeModelRef(store.primary).label)
const primarySummaryHint = computed(() => describeModelRef(store.primary).ref || '尚未设置默认主模型')
const fallbackSummaries = computed(() => store.fallbacks.map((ref) => describeModelRef(ref)))
const selectedModelPresetId = computed(() =>
  suggestedModels.value.some((model) => model.id === form.modelId) ? form.modelId : '')
const filteredRemoteModels = computed(() => {
  const keyword = remoteModels.search.trim().toLowerCase()
  if (!keyword) return remoteModels.items
  return remoteModels.items.filter((modelId) => modelId.toLowerCase().includes(keyword))
})
const visibleRemoteModels = computed(() => filteredRemoteModels.value.slice(0, 120))
const isApiKeyOptional = computed(() => form.api === 'ollama')
const apiKeyPlaceholder = computed(() => {
  if (selectedPreset.value?.apiKeyPlaceholder) return selectedPreset.value.apiKeyPlaceholder
  if (form.api === 'anthropic-messages') return 'sk-ant-…'
  if (form.api === 'google-generative-ai') return 'AIza…'
  if (form.api === 'ollama') return '可留空'
  return 'sk-…'
})
const modelIdPlaceholder = computed(() => {
  if (selectedPreset.value?.models?.[0]?.id) return `如 ${selectedPreset.value.models[0].id}`
  if (form.api === 'anthropic-messages') return '如 claude-sonnet-4-5-20250514'
  if (form.api === 'google-generative-ai') return '如 gemini-2.5-pro'
  if (form.api === 'ollama') return '如 qwen2.5:7b'
  return '如 Qwen3-235B-A22B'
})
const presetDescription = computed(() =>
  selectedPreset.value?.desc ?? '选择厂商后会自动填充协议、入口地址和常见模型，也可以保留自定义手动填写。')
const baseUrlHint = computed(() => {
  if (selectedPreset.value) return `已按 ${selectedPreset.value.label} 预填，可继续手动调整。`
  if (form.api === 'anthropic-messages') return 'Anthropic 会自动补齐 /v1；Base URL 可填 https://api.anthropic.com'
  if (form.api === 'google-generative-ai') return 'Gemini 通常填写 https://generativelanguage.googleapis.com/v1beta'
  if (form.api === 'ollama') return 'Ollama 原生 API 通常填写 http://127.0.0.1:11434'
  return '大多数 OpenAI 兼容服务可直接填写厂商提供的 Base URL'
})

function emptyForm() {
  selectedPresetKey.value = 'custom'
  remoteModels.loading = false
  remoteModels.items = []
  remoteModels.error = ''
  remoteModels.search = ''
  configuredModels.value = []
  modelEditor.activeIndex = -1
  Object.keys(expandedProviders).forEach((key) => { delete expandedProviders[key] })
  Object.assign(form, { id: '', api: 'openai-completions', baseUrl: '', apiKey: '', modelId: '', modelName: '', contextWindow: 131072, maxTokens: 8192, reasoning: false })
}

function openAdd() {
  emptyForm()
  modal.isEdit = false
  modal.testStatus = ''
  modal.testError = ''
  showKey.value = false
  modal.open = true
}

function openEdit(id: string) {
  const prov = store.providers[id]
  const models = providerModels(prov)
  const m = models[0] ?? {}
  selectedPresetKey.value = detectProviderPreset(id, prov)?.key ?? 'custom'
  remoteModels.loading = false
  remoteModels.items = []
  remoteModels.error = ''
  remoteModels.search = ''
  configuredModels.value = models.map((model) => ({ ...model }))
  modelEditor.activeIndex = models.length ? 0 : -1
  Object.assign(form, {
    id,
    api: (prov.api ?? 'openai-completions') as PortalModelApi,
    baseUrl: prov.baseUrl ?? '',
    apiKey: prov.apiKey ?? '',
    modelId: m.id ?? '',
    modelName: m.name ?? '',
    contextWindow: m.contextWindow ?? 131072,
    maxTokens: m.maxTokens ?? 8192,
    reasoning: m.reasoning ?? false,
  })
  modal.isEdit = true
  modal.testStatus = ''
  modal.testError = ''
  showKey.value = false
  modal.open = true
}

function closeModal() { modal.open = false }

function buildDraftModel(): ModelPreset {
  return {
    id: form.modelId.trim(),
    name: form.modelName.trim() || form.modelId.trim(),
    contextWindow: Number(form.contextWindow) || 131072,
    maxTokens: Number(form.maxTokens) || 8192,
    reasoning: !!form.reasoning,
  }
}

function resetModelDraft() {
  modelEditor.activeIndex = -1
  form.modelId = ''
  form.modelName = ''
  form.contextWindow = 131072
  form.maxTokens = 8192
  form.reasoning = false
}

function startNewModelDraft() {
  if (form.modelId.trim()) upsertDraftModel(false)
  resetModelDraft()
}

function applyModelPreset(modelId: string) {
  const model = suggestedModels.value.find((item) => item.id === modelId)
  if (!model) return
  applyModelFields(model)
}

function applyModelFields(model: ModelPreset) {
  form.modelId = model.id
  form.modelName = model.name ?? model.id
  form.contextWindow = model.contextWindow ?? 131072
  form.maxTokens = model.maxTokens ?? 8192
  form.reasoning = model.reasoning ?? false
}

function loadDraftFromModel(model: ModelPreset, index: number) {
  modelEditor.activeIndex = index
  applyModelFields(model)
}

function isProviderExpanded(id: string) {
  return !!expandedProviders[id]
}

function toggleProviderExpanded(id: string) {
  expandedProviders[id] = !expandedProviders[id]
}

function upsertDraftModel(notify = false): boolean {
  const modelId = form.modelId.trim()
  if (!modelId) return false

  const draft = buildDraftModel()
  const duplicateIndex = configuredModels.value.findIndex((model, index) =>
    model.id === draft.id && index !== modelEditor.activeIndex)
  const wasExisting = modelEditor.activeIndex >= 0 || duplicateIndex >= 0
  const targetIndex = modelEditor.activeIndex >= 0
    ? modelEditor.activeIndex
    : duplicateIndex >= 0
      ? duplicateIndex
      : configuredModels.value.length

  if (targetIndex === configuredModels.value.length) {
    configuredModels.value.push(draft)
  } else {
    configuredModels.value[targetIndex] = draft
  }
  modelEditor.activeIndex = targetIndex
  if (notify) toast.success(wasExisting ? '模型已更新' : '模型已加入列表')
  return true
}

function editConfiguredModel(index: number) {
  upsertDraftModel(false)
  const model = configuredModels.value[index]
  if (!model) return
  loadDraftFromModel(model, index)
}

function removeConfiguredModel(index: number) {
  configuredModels.value.splice(index, 1)
  if (modelEditor.activeIndex === index) {
    resetModelDraft()
  } else if (modelEditor.activeIndex > index) {
    modelEditor.activeIndex -= 1
  }
}

function moveConfiguredModel(index: number, direction: -1 | 1) {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= configuredModels.value.length) return
  const next = [...configuredModels.value]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  configuredModels.value = next
  if (modelEditor.activeIndex === index) modelEditor.activeIndex = nextIndex
  else if (direction === -1 && modelEditor.activeIndex === nextIndex) modelEditor.activeIndex = index
  else if (direction === 1 && modelEditor.activeIndex === nextIndex) modelEditor.activeIndex = index
}

function applyProviderPreset(presetKey: string) {
  selectedPresetKey.value = presetKey
  remoteModels.items = []
  remoteModels.error = ''
  remoteModels.search = ''
  const preset = getProviderPreset(presetKey)
  if (!preset) return

  const shouldAutofillId = !modal.isEdit && (!form.id || providerPresets.some((item) => item.key === form.id))
  if (shouldAutofillId) form.id = preset.key

  form.api = preset.api
  form.baseUrl = preset.baseUrl
  if (preset.models?.[0]) applyModelFields(preset.models[0])
}

function onPresetChange(event: Event) {
  applyProviderPreset((event.target as HTMLSelectElement).value)
}

function onModelPresetChange(event: Event) {
  applyModelPreset((event.target as HTMLSelectElement).value)
}

function applyRemoteModel(modelId: string) {
  const previousModelId = form.modelId
  form.modelId = modelId
  if (!form.modelName || form.modelName === previousModelId) form.modelName = modelId
  const knownModel = suggestedModels.value.find((model) => model.id === modelId)
    ?? providerPresets.flatMap((preset) => preset.models ?? []).find((model) => model.id === modelId)
    ?? configuredModels.value.find((model) => model.id === modelId)
  if (knownModel) {
    form.modelName = knownModel.name ?? modelId
    form.contextWindow = knownModel.contextWindow ?? form.contextWindow
    form.maxTokens = knownModel.maxTokens ?? form.maxTokens
    form.reasoning = knownModel.reasoning ?? form.reasoning
  }
}

async function fetchRemoteModels() {
  if (!form.baseUrl) {
    remoteModels.error = '请先填写 Base URL'
    return
  }

  remoteModels.loading = true
  remoteModels.error = ''
  try {
    const cacheKey = `${form.api}::${form.baseUrl.trim()}::${form.apiKey}`
    const cached = remoteModelCache.get(cacheKey)
    const models = cached ?? (await api.models.listRemote(form.baseUrl, form.apiKey, form.api)).models
    if (!cached) remoteModelCache.set(cacheKey, models)
    remoteModels.items = models
    remoteModels.search = ''
    toast.success(cached ? `已使用会话缓存中的 ${models.length} 个模型` : `已拉取 ${models.length} 个远程模型`)
  } catch (e: any) {
    remoteModels.items = []
    remoteModels.error = e.message
  } finally {
    remoteModels.loading = false
  }
}

async function testModal() {
  const targetModelId = form.modelId.trim() || configuredModels.value[0]?.id
  if (!targetModelId) {
    toast.error('请先填写或加入至少一个模型')
    return
  }
  modal.testStatus = 'testing'
  modal.testError = ''
  try {
    await api.models.test(form.baseUrl, form.apiKey, targetModelId, form.api)
    modal.testStatus = 'ok'
  } catch (e: any) {
    modal.testStatus = 'fail'
    modal.testError = e.message
  }
}

async function save() {
  if (!form.id || !form.baseUrl || (!form.modelId.trim() && configuredModels.value.length === 0)) {
    toast.error('Provider ID、Base URL 和至少一个 Model ID 为必填项')
    return
  }
  upsertDraftModel(false)
  if (!configuredModels.value.length) {
    toast.error('请至少加入一个模型到列表')
    return
  }
  await store.saveProvider(form.id, {
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    api: form.api,
    models: configuredModels.value.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      reasoning: !!model.reasoning,
      input: ['text'],
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  })
  toast.success(modal.isEdit ? 'Provider 已更新' : 'Provider 已添加')
  closeModal()
}

async function testCard(id: string, selectedModelId?: string) {
  const prov = store.providers[id]
  const modelId = selectedModelId ?? prov.models?.[0]?.id ?? ''
  testStates[id] = { status: 'testing' }
  const t0 = Date.now()
  try {
    await api.models.test(prov.baseUrl, prov.apiKey, modelId, prov.api)
    testStates[id] = { status: 'ok', latency: Date.now() - t0 }
  } catch (e: any) {
    testStates[id] = { status: 'fail', error: e.message }
  }
}

async function del(id: string) {
  if (!confirm(`确认删除 Provider「${id}」？`)) return
  await store.deleteProvider(id)
  toast.success('Provider 已删除')
}

async function setPrimary(id: string, modelId?: string) {
  const prov = store.providers[id]
  const targetModelId = modelId ?? prov.models?.[0]?.id ?? id
  const modelRef = `${id}/${targetModelId}`
  if (store.fallbacks.includes(modelRef)) {
    await store.setFallbacks(store.fallbacks.filter((item) => item !== modelRef))
  }
  await store.setPrimary(`${id}/${targetModelId}`)
  toast.success(`「${id}/${targetModelId}」已设为主模型`)
}

function isPrimary(id: string, modelId?: string) {
  if (!modelId) return store.primary.startsWith(id + '/') || store.primary === id
  return store.primary === `${id}/${modelId}`
}

function isFallback(id: string, modelId: string) {
  return store.fallbacks.includes(`${id}/${modelId}`)
}

async function toggleFallback(id: string, modelId: string) {
  const modelRef = `${id}/${modelId}`
  const removing = isFallback(id, modelId)
  const next = removing
    ? store.fallbacks.filter((item) => item !== modelRef)
    : [modelRef, ...store.fallbacks.filter((item) => item !== modelRef)]
  await store.setFallbacks(next)
  toast.success(removing ? 'Fallback 模型已移除' : 'Fallback 模型已设置')
}

async function removeFallbackRef(modelRef: string) {
  await store.setFallbacks(store.fallbacks.filter((item) => item !== modelRef))
  toast.success('Fallback 模型已移除')
}

function providerModels(prov: any): ModelPreset[] {
  return Array.isArray(prov?.models)
    ? prov.models.map((model: any) => ({
      id: model.id,
      name: model.name ?? model.id,
      contextWindow: model.contextWindow ?? 131072,
      maxTokens: model.maxTokens ?? 8192,
      reasoning: !!model.reasoning,
    }))
    : []
}

function sortedProviderModels(providerId: string, prov: any): ModelPreset[] {
  const models = providerModels(prov)
  return models.sort((a, b) => {
    const aPrimary = isPrimary(providerId, a.id) ? 1 : 0
    const bPrimary = isPrimary(providerId, b.id) ? 1 : 0
    if (aPrimary !== bPrimary) return bPrimary - aPrimary
    const aFallback = isFallback(providerId, a.id) ? 1 : 0
    const bFallback = isFallback(providerId, b.id) ? 1 : 0
    if (aFallback !== bFallback) return bFallback - aFallback
    return a.id.localeCompare(b.id)
  })
}

function visibleProviderModels(providerId: string, prov: any): ModelPreset[] {
  const models = sortedProviderModels(providerId, prov)
  return isProviderExpanded(providerId) ? models : models.slice(0, collapsedModelCount)
}

function describeModelRef(modelRef: string): { ref: string; label: string } {
  if (!modelRef) return { ref: '', label: '未设置' }
  const slashIdx = modelRef.indexOf('/')
  if (slashIdx < 0) return { ref: modelRef, label: modelRef }
  const providerId = modelRef.slice(0, slashIdx)
  const modelId = modelRef.slice(slashIdx + 1)
  const provider = store.providers[providerId]
  const model = providerModels(provider).find((item) => item.id === modelId)
  return {
    ref: modelRef,
    label: model?.name ? `${providerId} / ${model.name}` : modelRef,
  }
}

function maskKey(key?: string) {
  if (!key) return '(未设置)'
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••' + key.slice(-4)
}

function latencyTagType(ms: number): 'success' | 'warning' | 'error' {
  if (ms < 3000) return 'success'
  if (ms < 8000) return 'warning'
  return 'error'
}

function apiLabel(api?: string) {
  const map: Record<string, string> = {
    'openai-completions': 'Chat',
    'openai-responses': 'Responses',
    'anthropic-messages': 'Anthropic',
    'google-generative-ai': 'Gemini',
    'ollama': 'Ollama',
  }
  return map[api ?? 'openai-completions'] ?? api ?? 'Chat'
}

watch(() => [form.baseUrl, form.api] as const, ([nextBaseUrl, nextApi], [prevBaseUrl, prevApi]) => {
  if (nextBaseUrl !== prevBaseUrl || nextApi !== prevApi) {
    remoteModels.items = []
    remoteModels.error = ''
    remoteModels.search = ''
  }
})
</script>

<style scoped>
/* Use global .metric-grid / .metric-card. Local tweaks only. */
.metric-value-sm {
  font-size: var(--text-md);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.fallback-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.fallback-chip {
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.fallback-chip:hover {
  border-color: var(--error-text);
  color: var(--error-text);
  background: var(--error-bg);
}
.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}

/* ── Provider card — aligned with global section-card ── */
.provider-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--card-fill);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.provider-card:hover {
  border-color: var(--card-border-strong);
  box-shadow: var(--shadow-md);
}
.provider-card.is-primary {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-subtle), var(--shadow-sm);
}

/* ── Card header ── */
.prov-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}
.prov-identity { flex: 1; min-width: 0; }
.prov-model-name {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.prov-id-row { display: flex; align-items: center; gap: 6px; }
.prov-id {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-muted);
}
.prov-api-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--accent-text);
  background: var(--accent-subtle);
  padding: 2px 7px;
  border-radius: var(--radius-full);
}
.prov-badges { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.primary-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: var(--radius-full);
  background: var(--surface-2);
  color: #bf5af2;
  border: 1px solid rgba(191,90,242,.2);
}
.conn-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-ok      { background: #30d158; box-shadow: 0 0 6px rgba(48,209,88,.5); }
.dot-fail    { background: #ff453a; box-shadow: 0 0 6px rgba(255,69,58,.4); }
.dot-testing { background: #ffd60a; box-shadow: 0 0 6px rgba(255,214,10,.4); }

/* ── Meta ── */
.prov-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--space-3) var(--space-4);
  background: var(--surface-2);
  border-radius: var(--radius);
  border: 1px solid var(--border-soft);
}
.meta-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-xs);
  min-width: 0;
}
.meta-icon { flex-shrink: 0; font-size: 13px; line-height: 1; }
.meta-text {
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mono { font-family: var(--font-mono); }
.meta-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.chip {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--surface-3);
  color: var(--text-muted);
  border: 1px solid var(--border-soft);
  letter-spacing: .02em;
}
.chip-accent {
  background: rgba(48,209,88,.1);
  color: #248a3d;
  border-color: rgba(48,209,88,.2);
}

/* ── Test bar ── */
.test-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 7px 12px;
  border-radius: var(--radius);
  border: 1px solid transparent;
}
.bar-ok      { background: rgba(48,209,88,.08); color: #248a3d; border-color: rgba(48,209,88,.18); }
.bar-fail    { background: rgba(255,69,58,.07); color: #d23f31; border-color: rgba(255,69,58,.16); }
.bar-testing { background: var(--muted-bg); color: var(--text-secondary); }
.bar-icon { font-size: 13px; }
.bar-err { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.latency-pill {
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: var(--radius-full);
}
.lp-success { background: rgba(48,209,88,.15);  color: #248a3d; }
.lp-warning { background: rgba(255,159,10,.15); color: #b57f10; }
.lp-error   { background: rgba(255,69,58,.12);  color: #d23f31; }

/* ── Actions ── */
.prov-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: var(--space-2);
  justify-content: flex-end;
  border-top: 1px solid var(--border-soft);
}
.act-btn {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 5px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
}
.act-btn:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.act-btn:disabled { opacity: .45; cursor: not-allowed; }
.act-quiet {
  background: var(--surface-2);
  border-color: var(--border-soft);
  color: var(--text-secondary);
}
.act-quiet:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--border);
  color: var(--text-primary);
}
.act-primary {
  background: var(--accent-subtle);
  color: var(--accent-text);
  border-color: rgba(99,102,241,.18);
}
.act-primary:hover:not(:disabled) {
  background: rgba(99,102,241,.14);
  color: var(--accent);
}
.act-inline {
  padding: 4px 10px;
  font-size: 11px;
  white-space: nowrap;
}
.act-save {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.act-save:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.act-danger { color: var(--error-text); }
.act-danger:hover:not(:disabled) {
  background: var(--error-bg);
  border-color: rgba(210,63,49,.2);
  color: var(--error-text);
}

/* ══ Dialog ══════════════════════════════════════════════════════ */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  padding: 16px;
  background: var(--tint-strong);
  backdrop-filter: blur(8px);
}

.dialog-panel {
  position: relative;
  width: min(920px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  margin: 0;
  display: flex;
  flex-direction: column;
  background: var(--card-fill);
  border: 1px solid var(--card-border);
  border-radius: calc(var(--radius-lg) + 4px);
  box-shadow: 0 24px 80px var(--tint-stronger), 0 8px 24px var(--tint-strong);
  overflow: hidden;
}

/* stripe at the very top of the drawer */
.drawer-stripe {
  height: 3px;
  flex-shrink: 0;
  background: linear-gradient(90deg, var(--accent) 0%, #5ac8fa 100%);
}
.drawer-stripe.stripe-edit {
  background: linear-gradient(90deg, #bf5af2 0%, #ff375f 40%, #ff9f0a 100%);
}

/* ── Drawer header ── */
.drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface);
  flex-shrink: 0;
}
.drawer-title {
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin-bottom: 2px;
}
.drawer-subtitle {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}
.close-btn {
  flex-shrink: 0;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}
.close-btn:hover { background: var(--surface-3); color: var(--text-primary); }

/* ── Drawer body (scrollable) ── */
.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-4);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-3);
  align-content: start;
}

/* ── Form sections ── */
.form-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--border-soft);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.65);
  min-width: 0;
}
.form-section-full { grid-column: 1 / -1; }
.section-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 2px;
}
.form-inline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.form-group { display: flex; flex-direction: column; gap: 5px; }
.form-hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}
.form-hint-error { color: var(--error-text); }
.remote-model-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.remote-model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  border: 1px solid transparent;
}
.remote-model-item.is-selected {
  border-color: rgba(99,102,241,.2);
  background: var(--accent-subtle);
}
.remote-model-name {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.remote-model-name:hover {
  color: var(--accent);
}
.provider-model-list,
.configured-model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
}
.provider-model-list {
  padding-top: 2px;
}
.provider-model-item,
.configured-model-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border-soft);
}
.provider-model-item {
  flex-direction: column;
  gap: 12px;
}
.configured-model-item {
  flex-direction: column;
  gap: 10px;
  justify-content: flex-start;
}
.provider-model-item.is-selected,
.configured-model-item.is-selected {
  border-color: rgba(99,102,241,.2);
  background: var(--accent-subtle);
}
.provider-model-main,
.configured-model-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.configured-model-main {
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.provider-model-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.provider-model-title,
.configured-model-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.4;
  word-break: break-word;
}
.provider-model-sub,
.configured-model-sub {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  white-space: normal;
  overflow-wrap: anywhere;
}
.provider-model-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  flex-wrap: wrap;
  width: 100%;
}
.provider-model-actions .act-btn {
  min-height: 30px;
}
.configured-model-item .provider-model-actions {
  width: 100%;
  justify-content: flex-start;
}
.expand-models-btn {
  align-self: flex-start;
  border: none;
  background: none;
  padding: 2px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
}
.expand-models-btn:hover {
  color: var(--accent-hover);
  text-decoration: underline;
}

@media (max-width: 1100px) {
  .provider-grid {
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  }
}

@media (max-width: 820px) {
  .model-summary-grid,
  .provider-grid {
    grid-template-columns: 1fr;
  }

  .dialog-overlay {
    padding: 12px;
  }

  .dialog-panel {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    margin: 0;
  }

  .drawer-body {
    grid-template-columns: 1fr;
  }

  .form-inline-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .drawer-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .footer-right {
    justify-content: flex-end;
  }
}
.form-label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 5px;
}
.label-opt {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--surface-3);
  border: 1px solid var(--border-soft);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}
.form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }

/* ── Inputs ── */
.form-input,
.form-select {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 11px;
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
  appearance: none;
  -webkit-appearance: none;
}
.form-input::placeholder { color: var(--text-muted); }
.form-input:focus,
.form-select:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.form-input.is-disabled {
  opacity: .5;
  cursor: not-allowed;
  background: var(--surface-2);
}
.form-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239ba3af' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 11px center;
  padding-right: 32px;
  cursor: pointer;
}
.form-input[type="number"] { -moz-appearance: textfield; }
.form-input[type="number"]::-webkit-inner-spin-button,
.form-input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; }

/* API key */
.input-wrap { position: relative; }
.input-wrap .form-input { padding-right: 52px; }
.show-key-btn {
  position: absolute;
  right: 8px; top: 50%; transform: translateY(-50%);
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-text);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  opacity: .75;
  transition: opacity var(--duration-fast);
}
.show-key-btn:hover { opacity: 1; }

/* ── Reasoning toggle ── */
.form-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-weight: 500;
}
.toggle-checkbox { display: none; }
.toggle-track {
  position: relative;
  width: 34px; height: 19px;
  background: var(--border);
  border-radius: var(--radius-full);
  transition: background var(--duration-fast);
  flex-shrink: 0;
}
.toggle-checkbox:checked + .toggle-track { background: var(--accent); }
.toggle-thumb {
  position: absolute;
  top: 2px; left: 2px;
  width: 15px; height: 15px;
  background: var(--surface);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,.18);
  transition: transform var(--duration-fast);
}
.toggle-checkbox:checked + .toggle-track .toggle-thumb { transform: translateX(15px); }
.toggle-label { flex: 1; }

/* ── Drawer footer ── */
.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border-soft);
  background: var(--surface);
  flex-shrink: 0;
}
.footer-right { display: flex; gap: var(--space-2); }

/* ── Animations ── */
@keyframes spin { to { transform: rotate(360deg); } }
.spin { display: inline-block; animation: spin .7s linear infinite; }

/* Center dialog pop-in */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity .18s ease;
}
.dialog-enter-active .dialog-panel,
.dialog-leave-active .dialog-panel {
  transition: transform .2s var(--ease-out), opacity .2s var(--ease-out);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
.dialog-enter-from .dialog-panel,
.dialog-leave-to .dialog-panel {
  opacity: 0;
  transform: translateY(10px) scale(.98);
}
</style>
