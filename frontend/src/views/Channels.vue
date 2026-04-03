<template>
  <div>
    <div class="page-header">
      <h1>Channel 管理</h1>
      <button @click="showAdd = true" class="btn primary">+ 添加 Channel</button>
    </div>

    <!-- Status panel -->
    <div v-if="store.statusRaw" class="status-panel">
      <pre>{{ store.statusRaw }}</pre>
    </div>
    <button @click="store.fetchStatus()" :disabled="store.loading" class="btn sm mb">
      {{ store.loading ? '查询中...' : '查询运行状态' }}
    </button>

    <!-- Configured channels -->
    <div v-if="Object.keys(store.channels).length === 0" class="empty">
      暂无已配置的 Channel。点击「添加 Channel」开始配置。
    </div>

    <div class="channel-list">
      <div v-for="(cfg, name) in store.channels" :key="name" class="channel-card">
        <div class="ch-header">
          <div class="ch-name-row">
            <span class="ch-icon">{{ channelIcon(name as string) }}</span>
            <span class="ch-name">{{ name }}</span>
          </div>
          <div class="ch-controls">
            <span :class="['badge', cfg.enabled ? 'on' : 'off']">{{ cfg.enabled ? '已启用' : '已禁用' }}</span>
            <button @click="toggleEnabled(name as string, cfg)" class="btn sm">
              {{ cfg.enabled ? '禁用' : '启用' }}
            </button>
            <button @click="startEdit(name as string, cfg)" class="btn sm">编辑</button>
            <button @click="remove(name as string)" class="btn sm danger">删除</button>
          </div>
        </div>
        <div class="ch-fields">
          <span v-for="(v, k) in displayFields(cfg)" :key="k" class="field-chip">
            <b>{{ k }}</b>: {{ maskSecret(k as string, v as string) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Add / Edit modal -->
    <div v-if="showAdd || editName" class="modal-overlay" @click.self="closeModal">
      <div class="modal">
        <h2>{{ editName ? `编辑 ${editName}` : '添加 Channel' }}</h2>

        <div v-if="!editName" class="form-row">
          <label>Channel 类型</label>
          <select v-model="form.name" @change="applyTemplate">
            <option value="">请选择...</option>
            <option v-for="t in CHANNEL_TEMPLATES" :key="t.name" :value="t.name">{{ t.label }}</option>
          </select>
        </div>

        <div v-for="field in currentFields" :key="field.key" class="form-row">
          <label>{{ field.label }}</label>
          <select v-if="field.type === 'select'" v-model="(form.config as any)[field.key]">
            <option v-for="o in field.options" :key="o" :value="o">{{ o }}</option>
          </select>
          <input v-else-if="field.type === 'password'" type="password" v-model="(form.config as any)[field.key]" :placeholder="field.placeholder ?? ''" />
          <input v-else v-model="(form.config as any)[field.key]" :placeholder="field.placeholder ?? ''" />
        </div>

        <div class="modal-actions">
          <button @click="closeModal" class="btn">取消</button>
          <button @click="saveChannel" :disabled="!form.name && !editName" class="btn primary">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { useChannelsStore } from '../stores/channels.js'

const store = useChannelsStore()
onMounted(() => store.load())

const showAdd = ref(false)
const editName = ref<string | null>(null)
const form = reactive<{ name: string; config: Record<string, any> }>({ name: '', config: { enabled: true, dmPolicy: 'pairing' } })

interface ChannelField { key: string; label: string; type?: string; options?: string[]; placeholder?: string }
interface ChannelTemplate { name: string; label: string; fields: ChannelField[] }

const CHANNEL_TEMPLATES: ChannelTemplate[] = [
  {
    name: 'telegram',
    label: '📱 Telegram',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', placeholder: '从 @BotFather 获取' },
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
  {
    name: 'slack',
    label: '💬 Slack',
    fields: [
      { key: 'appToken', label: 'App Token', type: 'password', placeholder: 'xapp-...' },
      { key: 'botToken', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...' },
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
  {
    name: 'discord',
    label: '🎮 Discord',
    fields: [
      { key: 'token', label: 'Bot Token', type: 'password' },
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
  {
    name: 'feishu',
    label: '🐦 飞书',
    fields: [
      { key: 'appId', label: 'App ID' },
      { key: 'appSecret', label: 'App Secret', type: 'password' },
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
  {
    name: 'dingtalk',
    label: '📎 钉钉',
    fields: [
      { key: 'robotCode', label: 'Robot Code' },
      { key: 'appKey', label: 'App Key' },
      { key: 'appSecret', label: 'App Secret', type: 'password' },
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
  {
    name: 'wechat-work',
    label: '💼 企业微信',
    fields: [
      { key: 'corpId', label: 'Corp ID' },
      { key: 'agentId', label: 'Agent ID' },
      { key: 'secret', label: 'Secret', type: 'password' },
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
  {
    name: 'matrix',
    label: '🔷 Matrix',
    fields: [
      { key: 'homeserver', label: 'Homeserver URL', placeholder: 'https://matrix.example.org' },
      { key: 'accessToken', label: 'Access Token', type: 'password' },
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
  {
    name: 'whatsapp',
    label: '📱 WhatsApp',
    fields: [
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
]

const currentFields = computed<ChannelField[]>(() => {
  const name = editName.value ?? form.name
  return CHANNEL_TEMPLATES.find(t => t.name === name)?.fields ?? []
})

function applyTemplate() {
  form.config = { enabled: true, dmPolicy: 'pairing' }
}

function startEdit(name: string, cfg: any) {
  editName.value = name
  form.name = name
  form.config = { ...cfg }
}

function closeModal() {
  showAdd.value = false
  editName.value = null
  form.name = ''
  form.config = { enabled: true, dmPolicy: 'pairing' }
}

async function saveChannel() {
  const name = editName.value ?? form.name
  if (!name) return
  await store.save(name, form.config)
  closeModal()
}

async function toggleEnabled(name: string, cfg: any) {
  await store.save(name, { ...cfg, enabled: !cfg.enabled })
}

async function remove(name: string) {
  if (confirm(`确认删除 channel: ${name}？`)) await store.remove(name)
}

function channelIcon(name: string): string {
  const icons: Record<string, string> = {
    telegram: '📱',
    slack: '💬',
    discord: '🎮',
    feishu: '🐦',
    dingtalk: '📎',
    'wechat-work': '💼',
    matrix: '🔷',
    whatsapp: '📱',
    signal: '🔒',
  }
  return icons[name] ?? '📡'
}

const SECRET_KEYS = new Set(['token', 'secret', 'password', 'apikey', 'appkey', 'appsecret', 'bottoken', 'apptoken', 'accesstoken'])
function maskSecret(key: string, val: string): string {
  if (SECRET_KEYS.has(key.toLowerCase()) && val?.length > 4) return val.slice(0, 4) + '••••'
  return String(val ?? '')
}

function displayFields(cfg: any): Record<string, any> {
  const { enabled, ...rest } = cfg
  return rest
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
h1 { font-size: 22px; }
.mb { margin-bottom: 20px; }
.empty { color: #9ca3af; font-size: 14px; margin-top: 8px; }
.channel-list { display: flex; flex-direction: column; gap: 12px; }
.channel-card { background: white; border-radius: 10px; padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,.07); }
.ch-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }
.ch-name-row { display: flex; align-items: center; gap: 8px; }
.ch-icon { font-size: 20px; }
.ch-name { font-weight: 700; font-size: 15px; }
.ch-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 500; }
.badge.on { background: #d1fae5; color: #065f46; }
.badge.off { background: #f3f4f6; color: #9ca3af; }
.ch-fields { display: flex; flex-wrap: wrap; gap: 6px; }
.field-chip { font-size: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 2px 8px; color: #374151; }
.status-panel { background: #1e1e2e; color: #a6e3a1; font-family: monospace; font-size: 13px; padding: 14px; border-radius: 8px; margin-bottom: 12px; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
.btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer; font-size: 14px; background: white; }
.btn.primary { background: #2563eb; color: white; border-color: #2563eb; }
.btn.danger { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
.btn:disabled { opacity: .4; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: white; border-radius: 12px; padding: 28px; min-width: 420px; max-width: 520px; max-height: 80vh; overflow-y: auto; }
.modal h2 { margin-bottom: 20px; font-size: 16px; }
.form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
.form-row label { font-size: 13px; font-weight: 500; color: #374151; }
.form-row input, .form-row select { padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
