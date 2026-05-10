<template>
  <div class="page-shell page-shell-wide channels-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">消息渠道</h1>
        <p class="subtitle">渠道列表管理接入；在 Agent 对接页为每个 Agent 绑定多条渠道路由，配置相互独立。</p>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">已接入平台</div>
        <div class="metric-value">{{ configuredPlatforms.length }}</div>
        <div class="metric-meta">当前已写入配置的渠道平台数量</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">渠道绑定</div>
        <div class="metric-value">{{ bindings.length }}</div>
        <div class="metric-meta">所有 Agent 的已保存消息路由</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">待审批设备</div>
        <div class="metric-value">{{ pendingRequests.length }}</div>
        <div class="metric-meta">需要运营确认的配对请求</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">缺失插件</div>
        <div class="metric-value">{{ missingPluginCount }}</div>
        <div class="metric-meta">仍需安装插件的渠道平台</div>
      </div>
    </div>

    <div class="ui-tabbar">
      <button type="button" class="ui-tab" :class="{ 'is-active': activeTab === 'channels' }" @click="activeTab = 'channels'">渠道列表</button>
      <button type="button" class="ui-tab" :class="{ 'is-active': activeTab === 'agents' }" @click="activeTab = 'agents'">Agent 对接</button>
    </div>

    <section v-if="activeTab === 'channels'" class="channels-panel">
      <div v-if="!hasLoaded && loading" class="channels-loading">
        <div class="channels-loading-bar" />
        <div class="channels-loading-label">加载渠道数据…</div>
      </div>
      <div v-if="hasLoaded && configuredPlatforms.length" class="config-section">
        <div class="section-heading">
          <div>
            <div class="config-section-title">已接入</div>
            <div class="section-subtitle">统一管理现有渠道配置、设备审批与 Agent 路由。</div>
          </div>
        </div>
        <div class="platforms-grid">
          <div
            v-for="platform in configuredPlatforms"
            :key="platform.id"
            class="platform-card"
            :class="platform.enabled ? 'active' : 'inactive'"
          >
            <div class="platform-card-header">
              <span class="platform-emoji">{{ platformGlyph(platform.id) }}</span>
              <div class="platform-head-copy">
                <div class="platform-head-title-row">
                  <span class="platform-name">{{ platformLabel(platform.id) }}</span>
                  <span class="platform-status-dot" :class="platform.enabled ? 'on' : 'off'" />
                </div>
                <div class="platform-head-meta">
                  <span v-if="platform.accounts.length" class="account-count">{{ platform.accounts.length }} 个账号</span>
                  <span
                    v-if="pluginChecked && pluginRequired(platform.id) && pluginInstalled(platform.id)"
                    class="platform-pick-badge badge-plugin-ok"
                  >插件已安装</span>
                  <span
                    v-if="pluginChecked && pluginRequired(platform.id) && !pluginInstalled(platform.id)"
                    class="platform-pick-badge badge-accent"
                  >需安装插件</span>
                  <span
                    v-if="pendingForPlatform(platform.id).length"
                    class="platform-pick-badge badge-warn"
                  >待审批 {{ pendingForPlatform(platform.id).length }}</span>
                </div>
              </div>
            </div>

            <div v-if="platform.accounts.length" class="platform-accounts">
              <div v-for="account in platform.accounts" :key="account.accountId" class="account-item">
                <span class="account-id">{{ account.accountId || 'default' }}</span>
                <span v-if="account.appId" class="account-appid">{{ account.appId }}</span>
                <span
                  v-for="agentId in agentsForChannel(getChannelBindingKey(platform.id), account.accountId)"
                  :key="`${platform.id}-${account.accountId}-${agentId}`"
                  class="agent-badge"
                >→ {{ agentId }}</span>
                <div class="account-actions">
                  <button type="button" class="btn btn-xs btn-secondary" @click="openConfigDialog(platform.id, account.accountId)">编辑</button>
                  <button type="button" class="btn btn-xs btn-secondary" @click="openBindingDialog(undefined, platform.id, account.accountId)">绑定</button>
                  <button type="button" class="btn btn-xs btn-danger" @click="removePlatformAccount(platform.id, account.accountId)">删除</button>
                </div>
              </div>
            </div>

            <div v-else class="platform-summary-row">
              <div class="binding-badges-inline" v-if="agentsForChannel(getChannelBindingKey(platform.id)).length">
                <span
                  v-for="agentId in agentsForChannel(getChannelBindingKey(platform.id))"
                  :key="`${platform.id}-${agentId}`"
                  class="agent-badge"
                >→ {{ agentId }}</span>
              </div>
              <span v-else class="form-hint">尚未绑定 Agent</span>
            </div>

            <div class="platform-card-actions">
              <button
                v-if="templateFor(platform.id)?.multiAccount"
                type="button"
                class="btn btn-sm btn-secondary"
                @click="openConfigDialog(platform.id, '')"
              >+ 添加账号</button>
              <button type="button" class="btn btn-sm btn-secondary" @click="openConfigDialog(platform.id)">编辑</button>
              <button type="button" class="btn btn-sm btn-secondary" @click="openBindingDialog(undefined, platform.id)">绑定 Agent</button>
              <button
                v-if="pluginChecked && pluginRequired(platform.id) && !pluginInstalled(platform.id)"
                type="button"
                class="btn btn-sm btn-secondary"
                :disabled="pluginInstalling[platform.id]"
                @click="installPlugin(platform.id)"
              >{{ pluginInstalling[platform.id] ? '安装中…' : '安装插件' }}</button>
              <button type="button" class="btn btn-sm btn-secondary" :disabled="diagnoseLoading[platform.id]" @click="runDiagnose(platform.id)">
                {{ diagnoseExpanded[platform.id] ? '收起诊断' : '联通诊断' }}
              </button>
              <button
                v-if="supportsPairing(platform.id)"
                type="button"
                class="btn btn-sm btn-secondary"
                :class="{ 'btn-active': pairingExpanded[platform.id] }"
                @click="togglePairing(platform.id)"
              >配对审批</button>
              <button v-if="platform.id === 'weixin'" type="button" class="btn btn-sm btn-secondary" @click="runPlatformAction(platform.id, 'login')">扫码登录</button>
              <button type="button" class="btn btn-sm btn-secondary" @click="togglePlatform(platform)">{{ platform.enabled ? '禁用' : '启用' }}</button>
              <button type="button" class="btn btn-sm btn-danger" @click="removePlatform(platform.id)">移除</button>
            </div>

            <div v-if="diagnoseExpanded[platform.id]" class="inline-panel">
              <div class="inline-panel-title">诊断结果</div>
              <div v-if="diagnoseLoading[platform.id]" class="form-hint">诊断中…</div>
              <template v-else-if="diagnoseResults[platform.id]">
                <div
                  v-for="check in diagnoseResults[platform.id].checks"
                  :key="`${platform.id}-${check.id}`"
                  class="diag-row"
                >
                  <span class="diag-indicator" :class="check.ok ? 'diag-ok' : 'diag-fail'" />
                  <span class="diag-title">{{ check.title }}</span>
                  <span class="diag-detail">{{ check.detail }}</span>
                </div>
                <div v-if="diagnoseResults[platform.id].hints?.length" class="diag-hints">
                  <code v-for="hint in diagnoseResults[platform.id].hints" :key="hint" class="guide-cmd">{{ hint }}</code>
                </div>
              </template>
            </div>

            <div v-if="pairingExpanded[platform.id]" class="inline-panel">
              <div class="inline-panel-title">
                配对审批
                <button type="button" class="btn btn-xs btn-secondary" :disabled="devicesLoading" @click="loadDevices">刷新</button>
              </div>
              <div v-if="devicesLoading" class="form-hint">设备列表加载中…</div>
              <template v-else>
                <div class="pairing-group">
                  <div class="pairing-group-title">待审批</div>
                  <div v-if="!pendingForPlatform(platform.id).length" class="form-hint">暂无待审批请求</div>
                  <div v-else class="pairing-list">
                    <div v-for="request in pendingForPlatform(platform.id)" :key="request.requestId" class="pairing-row">
                      <div class="pairing-main">
                        <div class="pairing-id">{{ request.deviceId || request.requestId }}</div>
                        <div class="form-hint">{{ formatTimeLabel(request.requestedAtMs) }}</div>
                      </div>
                      <div class="pairing-actions">
                        <button type="button" class="btn btn-xs btn-primary" :disabled="deviceActionBusy[request.requestId]" @click="approveDevice(request.requestId)">通过</button>
                        <button type="button" class="btn btn-xs btn-danger" :disabled="deviceActionBusy[request.requestId]" @click="rejectDevice(request.requestId)">拒绝</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="pairing-group">
                  <div class="pairing-group-title">已配对</div>
                  <div v-if="!pairedForPlatform(platform.id).length" class="form-hint">暂无已配对设备</div>
                  <div v-else class="pairing-list">
                    <div v-for="device in pairedForPlatform(platform.id)" :key="device.deviceId" class="pairing-row">
                      <div class="pairing-main">
                        <div class="pairing-id">{{ device.deviceId }}</div>
                        <div class="form-hint">{{ formatTimeLabel(device.approvedAtMs) }}</div>
                      </div>
                      <div class="pairing-actions">
                        <button type="button" class="btn btn-xs btn-danger" :disabled="deviceActionBusy[device.deviceId]" @click="removeDevice(device.deviceId)">移除</button>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="section-heading">
          <div>
            <div class="config-section-title">可接入平台</div>
            <div class="section-subtitle">按平台向导接入，自动补全常用配置与插件依赖。</div>
          </div>
        </div>

        <div class="platform-group-label">国内平台</div>
        <div class="platforms-grid">
          <button
            v-for="platform in domesticTemplates"
            :key="platform.name"
            type="button"
            class="platform-pick"
            :class="{ configured: isConfigured(platform.name) }"
            @click="openConfigDialog(platform.name)"
          >
            <div class="platform-pick-top">
              <span class="platform-emoji">{{ platformGlyph(platform.name) }}</span>
              <div class="platform-pick-copy">
                <span class="platform-pick-name">{{ platform.label }}</span>
                <span class="platform-pick-desc">{{ platform.desc }}</span>
              </div>
            </div>
            <div class="platform-pick-footer">
              <span v-if="pluginChecked && platform.pluginPkg && pluginInstalled(platform.name)" class="platform-pick-badge badge-plugin-ok">插件已安装</span>
              <span v-else-if="pluginChecked && platform.pluginPkg && !pluginInstalled(platform.name)" class="platform-pick-badge badge-accent">需安装插件</span>
              <span v-if="isConfigured(platform.name)" class="platform-pick-badge">已接入</span>
            </div>
          </button>
        </div>

        <button type="button" class="overseas-toggle" @click="overseasExpanded = !overseasExpanded">
          <span>海外平台</span>
          <span class="overseas-toggle-count">{{ overseasTemplates.length }} 个</span>
          <svg class="overseas-toggle-arrow" :class="{ expanded: overseasExpanded }" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div v-if="overseasExpanded" class="platforms-grid platforms-grid-overseas">
          <button
            v-for="platform in overseasTemplates"
            :key="platform.name"
            type="button"
            class="platform-pick"
            :class="{ configured: isConfigured(platform.name) }"
            @click="openConfigDialog(platform.name)"
          >
            <div class="platform-pick-top">
              <span class="platform-emoji">{{ platformGlyph(platform.name) }}</span>
              <div class="platform-pick-copy">
                <span class="platform-pick-name">{{ platform.label }}</span>
                <span class="platform-pick-desc">{{ platform.desc }}</span>
              </div>
            </div>
            <div class="platform-pick-footer">
              <span v-if="pluginChecked && platform.pluginPkg && pluginInstalled(platform.name)" class="platform-pick-badge badge-plugin-ok">插件已安装</span>
              <span v-else-if="pluginChecked && platform.pluginPkg && !pluginInstalled(platform.name)" class="platform-pick-badge badge-accent">需安装插件</span>
              <span v-if="isConfigured(platform.name)" class="platform-pick-badge">已接入</span>
            </div>
          </button>
        </div>
      </div>
    </section>

    <section v-else class="channels-panel">
      <p class="form-hint channels-agent-hint">每个 Agent 可绑定多条路由（例如不同账号或匹配条件）；绑定之间互不影响。请先在「渠道列表」中完成渠道接入。</p>

      <div v-if="!agents.length" class="empty-state">暂无 Agent</div>

      <div v-else>
        <div v-for="agent in agents" :key="agent.id" class="agent-binding-card" :data-agent-id="agent.id">
          <div class="agent-binding-card-head">
            <div>
              <div class="agent-binding-title">{{ agent.identityEmoji || '🤖' }} {{ agent.id }}</div>
              <div class="form-hint">{{ agent.identityName || '未配置身份' }}</div>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="!configuredPlatforms.length"
              :title="configuredPlatforms.length ? '' : '请先在渠道列表中接入并启用至少一个渠道'"
              @click="openBindingDialog(agent.id)"
            >+ 添加渠道绑定</button>
          </div>

          <div v-if="bindingsForAgent(agent.id).length" class="agent-binding-list">
            <div
              v-for="binding in bindingsForAgent(agent.id)"
              :key="bindingKey(binding)"
              class="agent-binding-row"
            >
              <div class="agent-binding-row-main">
                <div class="agent-binding-channel">{{ formatBindingSummary(binding.match) }}</div>
                <div class="form-hint mono">{{ binding.match.channel }}<span v-if="binding.match.accountId"> · {{ binding.match.accountId }}</span></div>
              </div>
              <div class="agent-binding-row-actions">
                <button type="button" class="btn btn-xs btn-danger" @click="deleteBinding(binding)">移除</button>
              </div>
            </div>
          </div>
          <div v-else class="form-hint">尚未绑定任何渠道</div>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="showConfigModal" class="ui-modal-overlay" @click.self="closeConfigDialog">
        <div class="ui-modal channels-modal" role="dialog" aria-modal="true">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">{{ configModalTitle }}</div>
              <div v-if="currentTemplate?.desc" class="ui-modal-subtitle">{{ currentTemplate?.desc }}</div>
            </div>
            <button class="ui-modal-close" @click="closeConfigDialog">✕</button>
          </div>
          <div class="ui-modal-body">
          <div v-if="configLoading" class="config-loading-bar">
          <div class="config-loading-inner" />
        </div>

        <div v-if="currentTemplate?.guide" class="guide-panel">
          <div class="guide-title">接入步骤</div>
          <div class="guide-content" v-html="currentTemplate.guide"></div>
        </div>

        <div v-if="currentTemplate?.actionOnly" class="action-only-shell">
          <p class="form-hint action-only-desc">{{ currentTemplate.actionDesc }}</p>
          <div class="config-action-row">
            <button type="button" class="btn btn-secondary" :disabled="configBusy" @click="runPlatformAction(currentTemplate.name, 'install')">安装插件</button>
            <button type="button" class="btn btn-primary" :disabled="configBusy" @click="runPlatformAction(currentTemplate.name, 'login')">扫码登录</button>
          </div>
          <div v-if="actionQrImageUrl" class="login-qr-box">
            <img :src="actionQrImageUrl" alt="微信登录二维码" class="login-qr-img">
            <p class="login-qr-hint">用手机微信扫描上方二维码</p>
          </div>
          <div v-if="actionOutput" class="action-output"><pre>{{ actionOutput }}</pre></div>
          <div v-if="currentTemplate.commands?.length" class="manual-commands">
            <div class="guide-title">手动命令</div>
            <code v-for="cmd in currentTemplate.commands" :key="cmd" class="guide-cmd" @click="copyCommand(cmd)">{{ cmd }}</code>
          </div>
        </div>

        <div v-else>
          <div v-if="currentTemplate?.multiAccount" class="form-group">
            <label class="form-label">账号标识</label>
            <input v-model="configAccountId" class="form-input" :placeholder="currentTemplate.accountIdPlaceholder || '留空为默认账号；修改会创建新账号'">
            <div class="form-hint">{{ currentTemplate.accountIdHint || '每个账号对应一个独立机器人。不同账号可绑定不同 Agent。' }}</div>
          </div>

          <div v-for="field in visibleConfigFields" :key="field.key" class="form-group">
            <label class="form-label">{{ field.label }}<span v-if="isFieldRequired(field)" class="required-mark">*</span></label>
            <select v-if="field.type === 'select'" v-model="configForm[field.key]" class="form-select">
              <option v-for="option in field.options || []" :key="`${field.key}-${option.value}`" :value="option.value">{{ option.label }}</option>
            </select>
            <PasswordInput
              v-else-if="field.type === 'password'"
              v-model="configForm[field.key]"
              :placeholder="field.placeholder || ''"
            />
            <input
              v-else
              v-model="configForm[field.key]"
              class="form-input"
              type="text"
              :placeholder="field.placeholder || ''"
            >
            <div v-if="field.hint" class="form-hint">{{ field.hint }}</div>
          </div>

          <div class="form-group">
            <label class="form-label">绑定 Agent</label>
            <select v-model="configAgentId" class="form-select">
              <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.id }}{{ agent.identityName ? ` — ${agent.identityName}` : '' }}</option>
            </select>
            <div class="form-hint">该账号收到的消息路由到哪个 Agent（可在「Agent 对接」页添加更多绑定）。</div>
          </div>

          <div v-if="currentTemplate?.commands?.length" class="manual-commands">
            <div class="guide-title">手动命令</div>
            <code v-for="cmd in currentTemplate.commands" :key="cmd" class="guide-cmd" @click="copyCommand(cmd)">{{ cmd }}</code>
          </div>

          <div v-if="verifyMessage" class="verify-result" :class="verifySuccess ? 'verify-success' : 'verify-error'">
            {{ verifyMessage }}
          </div>

          <div v-if="modalDiagnoseResult" class="modal-diag-panel">
            <div class="guide-title">诊断结果</div>
            <div
              v-for="check in modalDiagnoseResult.checks"
              :key="check.id"
              class="diag-row"
            >
              <span class="diag-indicator" :class="check.ok ? 'diag-ok' : 'diag-fail'" />
              <span class="diag-title">{{ check.title }}</span>
              <span class="diag-detail">{{ check.detail }}</span>
            </div>
            <div v-if="modalDiagnoseResult.hints?.length" class="diag-hints">
              <code v-for="hint in modalDiagnoseResult.hints" :key="hint" class="guide-cmd">{{ hint }}</code>
            </div>
          </div>
        </div>

          </div><!-- /ui-modal-body -->
          <div class="ui-modal-footer">
            <button type="button" class="btn btn-secondary" @click="closeConfigDialog">关闭</button>
            <button v-if="!currentTemplate?.actionOnly" type="button" class="btn btn-secondary" :disabled="configBusy" @click="verifyCurrentPlatform">校验凭证</button>
            <button
              v-if="currentTemplate?.pluginPkg && configMode === 'edit'"
              type="button"
              class="btn btn-secondary"
              :disabled="modalDiagnoseLoading"
              @click="runModalDiagnose"
            >{{ modalDiagnoseLoading ? '诊断中…' : '联通诊断' }}</button>
            <button v-if="currentTemplate?.actionOnly" type="button" class="btn btn-primary" :disabled="configBusy" @click="saveActionOnlyPlatform">保存渠道</button>
            <button v-else type="button" class="btn btn-primary" :disabled="configBusy" @click="saveConfigPlatform">{{ configMode === 'edit' ? '保存' : '接入并保存' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showBindingModal" class="ui-modal-overlay" @click.self="closeBindingDialog">
        <div class="ui-modal ui-modal-sm" role="dialog" aria-modal="true">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">添加渠道绑定</div>
            </div>
            <button class="ui-modal-close" @click="closeBindingDialog">✕</button>
          </div>
          <div class="ui-modal-body">
            <div class="form-group">
              <label class="form-label">目标 Agent</label>
              <select v-model="bindingForm.agentId" class="form-select">
                <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.id }}{{ agent.identityName ? ` — ${agent.identityName}` : '' }}</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">渠道</label>
              <select v-model="bindingForm.platform" class="form-select" @change="syncBindingAccountOptions">
                <option v-for="platform in configuredPlatforms" :key="platform.id" :value="platform.id">{{ platformLabel(platform.id) }}</option>
              </select>
              <div class="form-hint">每条绑定独立生效，可为同一渠道添加多条不同匹配规则。</div>
            </div>

            <div class="form-group">
              <label class="form-label">子账号</label>
              <select v-model="bindingForm.accountId" class="form-select" :disabled="!currentBindingAccounts.length">
                <option value="">默认账号</option>
                <option v-for="account in currentBindingAccounts" :key="account.accountId" :value="account.accountId">
                  {{ account.accountId }}{{ account.appId ? ` · ${account.appId}` : '' }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">匹配范围</label>
              <select v-model="bindingForm.peerKind" class="form-select">
                <option value="">全部（私聊+群聊）</option>
                <option value="direct">仅私聊</option>
                <option value="group">仅群聊</option>
              </select>
              <div class="form-hint">{{ bindingPeerHint }}</div>
            </div>

            <div v-if="bindingForm.peerKind" class="form-group">
              <label class="form-label">目标 ID</label>
              <input v-model="bindingForm.peerId" class="form-input" :placeholder="bindingForm.peerKind === 'direct' ? 'ou_xxxxxxxxxxxxxxxx' : 'oc_xxxxxxxxxxxxxxxx'">
              <div class="form-hint">限定特定群/用户 ID，留空则匹配所有。</div>
            </div>
          </div>
          <div class="ui-modal-footer">
            <button type="button" class="btn btn-secondary" @click="closeBindingDialog">取消</button>
            <button type="button" class="btn btn-primary" :disabled="bindingBusy || !configuredPlatforms.length" @click="saveBinding">保存绑定</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import QRCode from 'qrcode'
import { api } from '../api/client.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'
import PasswordInput from '../components/PasswordInput.vue'

// strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '').replace(/\x1B[()][AB012]/g, '')
}

// extract the first https URL from terminal output (WeChat qrcode login URL)
function extractUrl(str: string): string {
  const m = str.match(/https?:\/\/[^\s]+/)
  return m ? m[0].trim().replace(/[.,;)]+$/, '') : ''
}

async function buildQrDataUrl(url: string): Promise<string> {
  try {
    return await QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
  } catch {
    return ''
  }
}

type FieldOption = { value: string; label: string }
type ChannelField = {
  key: string
  label: string
  type?: 'text' | 'password' | 'select'
  required?: boolean
  requiredWhen?: Record<string, string>
  placeholder?: string
  hint?: string
  options?: FieldOption[]
}
type PlatformTemplate = {
  name: string
  label: string
  desc: string
  initial: string
  multiAccount?: boolean
  accountIdPlaceholder?: string
  accountIdHint?: string
  pluginPkg?: string
  actionOnly?: boolean
  actionDesc?: string
  fields: ChannelField[]
  guide?: string
  commands?: string[]
}
type ConfiguredPlatform = { id: string; enabled: boolean; accounts: Array<{ accountId: string; appId?: string }> }
type AgentBinding = { type?: string; agentId: string; match: Record<string, any> }

const toast = useNaiveToast()
const route = useRoute()
const activeTab = ref<'channels' | 'agents'>('channels')
const loading = ref(false)
const hasLoaded = ref(false)
const configuredPlatforms = ref<ConfiguredPlatform[]>([])
const bindings = ref<AgentBinding[]>([])
const agents = ref<any[]>([])
const pluginStatus = ref<Record<string, { required: string; installed: boolean }>>({})
const pluginChecked = ref(false)
const diagnoseExpanded = reactive<Record<string, boolean>>({})
const diagnoseLoading = reactive<Record<string, boolean>>({})
const diagnoseResults = reactive<Record<string, any>>({})
const pairingExpanded = reactive<Record<string, boolean>>({})
const devicesLoading = ref(false)
const pendingRequests = ref<any[]>([])
const pairedDevices = ref<any[]>([])
const deviceActionBusy = reactive<Record<string, boolean>>({})
const pluginInstalling = reactive<Record<string, boolean>>({})
const lastIntentKey = ref('')
const configLoading = ref(false)
const overseasExpanded = ref(false)

const showConfigModal = ref(false)
const configMode = ref<'create' | 'edit'>('create')
const configPlatform = ref('telegram')
const configAccountId = ref('')
const configBusy = ref(false)
const configForm = reactive<Record<string, any>>({})
const configAgentId = ref('main')
const verifyMessage = ref('')
const verifySuccess = ref(false)
const actionOutput = ref('')
const modalDiagnoseLoading = ref(false)
const modalDiagnoseResult = ref<any>(null)
const actionQrImageUrl = ref('')

const showBindingModal = ref(false)
const bindingBusy = ref(false)
const bindingForm = reactive<{ agentId: string; platform: string; accountId: string; peerKind: string; peerId: string }>({
  agentId: 'main',
  platform: '',
  accountId: '',
  peerKind: '',
  peerId: '',
})

const DM_POLICY_OPTIONS: FieldOption[] = [
  { value: 'pairing', label: 'pairing — 需配对才能私信' },
  { value: 'allowlist', label: 'allowlist — 仅白名单用户' },
  { value: 'open', label: 'open — 任何人可私信' },
  { value: 'disabled', label: 'disabled — 禁止私信' },
]
const GROUP_POLICY_OPTIONS: FieldOption[] = [
  { value: '', label: '默认' },
  { value: 'all', label: 'all — 所有群消息' },
  { value: 'mentioned', label: 'mentioned — 仅 @ 时响应' },
  { value: 'allowlist', label: 'allowlist — 仅白名单群' },
]

const platformTemplates: PlatformTemplate[] = [
  {
    name: 'telegram',
    label: 'Telegram',
    desc: '通过 Telegram Bot 接入，支持私聊和群聊。',
    initial: 'TG',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF…', hint: '在 @BotFather 创建 Bot 后获得' },
      { key: 'allowedUsers', label: 'Allow From', placeholder: '可选，逗号分隔用户 ID' },
      { key: 'dmPolicy', label: '私信策略', type: 'select', options: DM_POLICY_OPTIONS },
    ],
    guide: '<ol><li>前往 Telegram 搜索 <code>@BotFather</code>。</li><li>执行 <code>/newbot</code> 创建机器人并复制 Token。</li><li>将 Bot 拉入目标群组后即可开始使用。</li></ol>',
    commands: ['openclaw channels status'],
  },
  {
    name: 'discord',
    label: 'Discord',
    desc: '接入 Discord Bot，支持频道和私信。',
    initial: 'DC',
    fields: [
      { key: 'token', label: 'Bot Token', type: 'password', required: true, placeholder: 'MTExxxxx…', hint: 'Discord Developer Portal → Bot' },
      { key: 'guildId', label: 'Guild ID', placeholder: '可选，指定服务器 ID' },
      { key: 'dmPolicy', label: '私信策略', type: 'select', options: DM_POLICY_OPTIONS },
      { key: 'groupPolicy', label: '群组策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    ],
    guide: '<ol><li>访问 Discord Developer Portal 创建应用。</li><li>在 Bot 页面复制 Token，并开启 Message Content Intent。</li><li>邀请 Bot 加入服务器。</li></ol>',
    commands: ['openclaw channels status'],
  },
  {
    name: 'slack',
    label: 'Slack',
    desc: '接入 Slack App，支持频道与私信。',
    initial: 'SK',
    fields: [
      { key: 'mode', label: '连接模式', type: 'select', required: true, options: [{ value: 'socket', label: 'Socket Mode（推荐）' }, { value: 'http', label: 'HTTP Mode' }] },
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: 'xoxb-…' },
      { key: 'appToken', label: 'App Token', type: 'password', requiredWhen: { mode: 'socket' }, placeholder: 'xapp-…', hint: 'Socket Mode 需要 App-Level Token' },
      { key: 'signingSecret', label: 'Signing Secret', type: 'password', requiredWhen: { mode: 'http' }, hint: 'HTTP Mode 专用' },
      { key: 'teamId', label: 'Team ID', placeholder: 'T0XXXXXXX' },
      { key: 'dmPolicy', label: '私信策略', type: 'select', options: DM_POLICY_OPTIONS },
      { key: 'groupPolicy', label: '群组策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    ],
    guide: '<ol><li>访问 <code>api.slack.com/apps</code> 创建应用。</li><li>开启 Socket Mode 或配置 Events 回调。</li><li>复制 Bot Token / App Token 后填入保存。</li></ol>',
    commands: ['openclaw channels status'],
  },
  {
    name: 'Lansenger',
    label: '蓝信',
    desc: '通过蓝信企业即时通讯平台接入，支持多账号。',
    initial: '蓝',
    multiAccount: true,
    accountIdPlaceholder: '留空将自动派生为 bot_<AppID 后缀>',
    accountIdHint: '每个账号对应一个独立机器人。留空时会按插件约定从 AppID 自动生成（例如 123123-456789 → bot_456789），也可手工指定。',
    pluginPkg: '@lansenger/openclaw-channel-lansenger@latest',
    fields: [
      { key: 'appId', label: 'App ID', required: true, placeholder: '10485760-XXXXXXX', hint: '蓝信开放平台应用的 App ID' },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: true },
      { key: 'apiGatewayUrl', label: 'API 网关地址', required: true, placeholder: 'https://open.lanxin.cn/open/apigw', hint: '私有化部署请填写对应域名，标准云环境使用默认地址' },
    ],
    guide: '<ol><li>登录蓝信开放平台，进入「应用管理」→「创建应用」，获取 <strong>App ID</strong> 与 <strong>App Secret</strong>。</li><li>确认 <strong>API 网关地址</strong>：标准云环境使用 <code>https://open.lanxin.cn/open/apigw</code>，私有化部署填写对应域名（如 <code>https://open-beta22.t.lanxin.cn/open/apigw</code>）。</li><li>在应用的「机器人配置」中开启消息接收能力；消息回调地址由系统自动管理，无需手动填写。</li><li>保存后将机器人添加至目标群聊或通过企业通讯录添加好友，即可收发消息。</li></ol>',
    commands: ['openclaw plugins install @lansenger/openclaw-channel-lansenger@latest', 'openclaw channels status'],
  },
  {
    name: 'feishu',
    label: '飞书',
    desc: '通过飞书 / Lark 应用接入，支持多账号。',
    initial: '飞',
    multiAccount: true,
    accountIdPlaceholder: '留空为默认账号；修改会创建新账号',
    accountIdHint: '每个账号对应一个独立机器人。不同账号可绑定不同 Agent。',
    pluginPkg: '@larksuite/openclaw-lark@latest',
    fields: [
      { key: 'appId', label: 'App ID', required: true },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: true },
      { key: 'domain', label: 'Domain', type: 'select', options: [{ value: '', label: '飞书（feishu.cn）' }, { value: 'lark', label: 'Lark（larksuite.com）' }] },
    ],
    guide: '<ol><li>访问 <code>open.feishu.cn</code>，进入「开发者后台」→「创建企业自建应用」，填写应用名称，记录 <strong>App ID</strong> 与 <strong>App Secret</strong>。</li><li>在左侧导航栏选择「机器人」，开启机器人功能并配置名称与头像。</li><li>进入「权限管理」，申请以下权限：<code>im:message</code>、<code>im:message:send_as_bot</code>、<code>im:chat</code>、<code>im:chat.member:read</code>。</li><li>进入「事件订阅」，开启 <code>im.message.receive_v1</code> 事件；Webhook 地址由保存后系统自动配置，无需手动填写。</li><li>在「版本管理与发布」中创建版本，提交审批或由企业管理员在后台直接启用应用。</li><li>将机器人加入目标群聊或通过企业通讯录添加，即可收发消息。</li></ol>',
    commands: ['openclaw plugins install @larksuite/openclaw-lark@latest', 'openclaw channels status'],
  },
  {
    name: 'dingtalk',
    label: '钉钉',
    desc: '通过钉钉企业内部应用接入，支持多账号。',
    initial: '钉',
    multiAccount: true,
    accountIdPlaceholder: '留空为默认账号；修改会创建新账号',
    accountIdHint: '每个账号对应一个独立机器人。不同账号可绑定不同 Agent。',
    pluginPkg: '@dingtalk-real-ai/dingtalk-connector@latest',
    fields: [
      { key: 'clientId', label: 'Client ID', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
    ],
    guide: '<ol><li>访问 <code>open.dingtalk.com</code>，登录后选择「应用开发」→「企业内部开发」→「机器人」，填写应用名称与描述。</li><li>进入应用「基础信息」页，复制 <strong>Client ID</strong>（AppKey）与 <strong>Client Secret</strong>（AppSecret）填入下方。</li><li>在「消息推送」→「消息接收模式」中选择 <strong>Stream 模式</strong>（推荐，无需公网地址）；有公网 IP 也可选 HTTP 模式并填写回调地址。</li><li>进入「权限管理」，申请 <code>qyapi.chat.message.send</code>、<code>qyapi.robot.info.query</code> 等消息相关权限。</li><li>回到应用首页，点击「发布」，审核通过后员工可搜索并将机器人加入群聊。</li></ol>',
    commands: ['openclaw plugins install @dingtalk-real-ai/dingtalk-connector@latest', 'openclaw channels status'],
  },
  {
    name: 'qqbot',
    label: 'QQ 机器人',
    desc: '通过 QQ 开放平台接入，支持多账号。',
    initial: 'QQ',
    multiAccount: true,
    accountIdPlaceholder: '留空为 default；修改会创建新账号',
    accountIdHint: '每个账号对应一个独立机器人。不同账号可绑定不同 Agent。',
    pluginPkg: '@tencent-connect/openclaw-qqbot@latest',
    fields: [
      { key: 'appId', label: 'AppID', required: true },
      { key: 'clientSecret', label: 'ClientSecret', type: 'password', required: true },
    ],
    guide: '<ol><li>访问 <code>q.qq.com</code> 注册 QQ 开放平台账号，进入「机器人」→「创建机器人」，填写名称并完成资质认证。</li><li>审核通过后，在「开发设置」页面获取 <strong>AppID</strong> 与 <strong>ClientSecret</strong> 填入下方。</li><li>在「沙箱配置」中添加开发者 QQ 号用于本地测试；正式使用需在「发布管理」提交审核。</li><li>将机器人添加至目标 QQ 频道（官方频道）；如需接入 QQ 群聊，须在开放平台单独申请「群消息」能力。</li><li>保存后系统自动安装插件并重载 Gateway；可使用下方「联通诊断」检查各环节状态。</li></ol>',
    commands: ['openclaw plugins install @tencent-connect/openclaw-qqbot@latest', 'openclaw channels status', 'openclaw channels diagnose qqbot'],
  },
  {
    name: 'weixin',
    label: '微信',
    desc: '通过 @tencent-weixin/openclaw-weixin-cli 插件接入个人微信（iPad 协议）。',
    initial: '微',
    actionOnly: true,
    actionDesc: '微信渠道需先安装 @tencent-weixin/openclaw-weixin-cli 插件（约 30–60 秒），安装完成后点击「扫码登录」，用手机微信扫描终端输出的二维码，登录成功后点击「保存渠道」。',
    fields: [],
    guide: '<ol><li>点击下方「安装插件」，系统将运行 <code>npx -y @tencent-weixin/openclaw-weixin-cli@latest install</code>，等待安装完成（约 30–60 秒），安装输出会显示在下方区域。</li><li>安装成功后点击「扫码登录」，用手机微信扫描输出区域中显示的二维码。</li><li>手机确认登录后终端提示成功，点击「保存渠道」完成接入。</li><li>如登录态过期，直接点击「扫码登录」重新授权，无需重复安装插件。</li></ol>',
    commands: ['npx -y @tencent-weixin/openclaw-weixin-cli@latest install', 'openclaw channels login --channel openclaw-weixin', 'openclaw channels status'],
  },
  {
    name: 'msteams',
    label: 'Microsoft Teams',
    desc: '接入 Microsoft Teams Bot。',
    initial: 'MS',
    pluginPkg: '@openclaw/msteams@latest',
    fields: [
      { key: 'appId', label: 'App ID', required: true },
      { key: 'appPassword', label: 'App Password', type: 'password', required: true },
      { key: 'tenantId', label: 'Tenant ID' },
      { key: 'botEndpoint', label: 'Bot Endpoint' },
      { key: 'dmPolicy', label: '私信策略', type: 'select', options: DM_POLICY_OPTIONS },
      { key: 'groupPolicy', label: '群组策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    ],
    guide: '<ol><li>在 Azure Portal 注册 Teams Bot。</li><li>复制 App ID 与 App Password。</li><li>配置消息端点后保存。</li></ol>',
    commands: ['openclaw plugins install @openclaw/msteams@latest', 'openclaw channels status'],
  },
  {
    name: 'matrix',
    label: 'Matrix',
    desc: '接入 Matrix 协议。',
    initial: 'MX',
    pluginPkg: '@openclaw/matrix@latest',
    fields: [
      { key: 'homeserver', label: 'Homeserver', required: true, placeholder: 'https://matrix.org' },
      { key: 'accessToken', label: 'Access Token', type: 'password' },
      { key: 'userId', label: 'User ID', placeholder: '@bot:matrix.org' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'deviceId', label: 'Device ID' },
      { key: 'dmPolicy', label: '私信策略', type: 'select', options: DM_POLICY_OPTIONS },
      { key: 'groupPolicy', label: '群组策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    ],
    guide: '<ol><li>在 Matrix 服务器上注册 Bot 账号。</li><li>填写 Homeserver 与 Access Token，或使用 User ID + Password。</li><li>邀请 Bot 加入目标房间。</li></ol>',
    commands: ['openclaw plugins install @openclaw/matrix@latest', 'openclaw channels status'],
  },
  {
    name: 'signal',
    label: 'Signal',
    desc: '接入 Signal Messenger。',
    initial: 'SG',
    fields: [
      { key: 'account', label: 'Signal 账号', required: true, placeholder: '+1234567890' },
      { key: 'cliPath', label: 'signal-cli 路径' },
      { key: 'httpUrl', label: 'HTTP URL' },
      { key: 'dmPolicy', label: '私信策略', type: 'select', options: DM_POLICY_OPTIONS },
      { key: 'groupPolicy', label: '群组策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    ],
    guide: '<ol><li>安装 <code>signal-cli</code> 并完成账号注册。</li><li>确认本机可正常收发 Signal 消息。</li><li>填写账号信息并保存。</li></ol>',
    commands: ['openclaw channels status'],
  },
]

const DOMESTIC_PLATFORMS = ['Lansenger', 'feishu', 'dingtalk', 'qqbot', 'weixin']
const domesticTemplates = computed(() => platformTemplates.filter(p => DOMESTIC_PLATFORMS.includes(p.name)))
const overseasTemplates = computed(() => platformTemplates.filter(p => !DOMESTIC_PLATFORMS.includes(p.name)))

const templateMap = new Map(platformTemplates.map(item => [item.name, item]))
const currentTemplate = computed(() => templateMap.get(configPlatform.value))
const visibleConfigFields = computed(() => (currentTemplate.value?.fields || []).filter(field => !field.requiredWhen || Object.entries(field.requiredWhen).every(([k, expected]) => `${configForm[k] ?? ''}` === expected)))
const configModalTitle = computed(() => `${configMode.value === 'edit' ? '编辑' : '接入'} ${currentTemplate.value?.label || ''}`)
const currentBindingAccounts = computed(() => configuredPlatforms.value.find(item => item.id === bindingForm.platform)?.accounts || [])
const bindingPeerHint = computed(() => {
  if (bindingForm.peerKind === 'direct') return '仅接收一对一私聊消息。'
  if (bindingForm.peerKind === 'group') return '仅接收群组 / 频道消息。'
  return '接收该渠道全部消息。'
})
const missingPluginCount = computed(() => configuredPlatforms.value.filter(platform => pluginRequired(platform.id) && !pluginInstalled(platform.id)).length)

onMounted(() => {
  void refreshPage()
})

watch(
  () => route.query,
  () => {
    applyRouteIntent()
  },
  { deep: true },
)

function templateFor(platform: string): PlatformTemplate | undefined {
  return templateMap.get(platform)
}

function platformLabel(platform: string): string {
  return templateFor(platform)?.label || platform
}

function platformGlyph(platform: string): string {
  return templateFor(platform)?.initial || platform.slice(0, 2).toUpperCase()
}

function getChannelBindingKey(pid: string): string {
  const map: Record<string, string> = {
    qqbot: 'qqbot',
    telegram: 'telegram',
    discord: 'discord',
    feishu: 'feishu',
    dingtalk: 'dingtalk-connector',
    weixin: 'openclaw-weixin',
    lansenger: 'Lansenger',
  }
  return map[pid] || pid
}

function resetRecord(record: Record<string, any>) {
  Object.keys(record).forEach(key => delete record[key])
}

function isFieldRequired(field: ChannelField): boolean {
  if (field.required) return true
  if (!field.requiredWhen) return false
  return Object.entries(field.requiredWhen).every(([key, expected]) => `${configForm[key] ?? ''}` === expected)
}

async function refreshPage() {
  loading.value = true
  try {
    const [platforms, bindingRes, agentList] = await Promise.all([
      api.channels.listConfiguredPlatforms(),
      api.channels.listAllBindings(),
      api.agents.list(),
    ])
    configuredPlatforms.value = platforms
    bindings.value = Array.isArray(bindingRes.bindings) ? bindingRes.bindings : []
    agents.value = Array.isArray(agentList) ? agentList : []
  } catch (error: any) {
    toast.error(error?.message || '加载渠道数据失败')
  } finally {
    loading.value = false
    hasLoaded.value = true
  }
  // Non-blocking: pluginStatus (slow npm scan) and devices load after UI renders
  api.channels.pluginStatus().then(res => { pluginStatus.value = res; pluginChecked.value = true }).catch(() => {})
  void loadDevices()
  applyRouteIntent()
}

function applyRouteIntent() {
  const tab = typeof route.query.tab === 'string' ? route.query.tab : ''
  const action = typeof route.query.action === 'string' ? route.query.action : ''
  const agentId = typeof route.query.agent === 'string' ? route.query.agent : ''
  const intentKey = JSON.stringify({ tab, action, agentId })
  if (action === 'bind' && agentId) {
    activeTab.value = 'agents'
    if (lastIntentKey.value !== intentKey && agents.value.some(agent => agent.id === agentId) && configuredPlatforms.value.length) {
      lastIntentKey.value = intentKey
      openBindingDialog(agentId)
    }
    return
  }
  if (tab === 'agents' || tab === 'channels') {
    activeTab.value = tab
  }
  lastIntentKey.value = intentKey
}

function isConfigured(platform: string): boolean {
  return configuredPlatforms.value.some(item => item.id === platform)
}

function agentsForChannel(channel: string, accountId = ''): string[] {
  return bindings.value
    .filter(binding => binding.match?.channel === channel && (binding.match?.accountId || '') === (accountId || ''))
    .map(binding => binding.agentId || 'main')
}

function bindingsForAgent(agentId: string): AgentBinding[] {
  return bindings.value.filter(binding => (binding.agentId || 'main') === agentId)
}

function bindingKey(binding: AgentBinding): string {
  return JSON.stringify([binding.agentId || 'main', binding.match || {}])
}

function formatBindingSummary(match: Record<string, any>): string {
  const parts = [platformLabel(reverseChannelKey(match.channel || ''))]
  if (match.accountId) parts.push(`账号 ${match.accountId}`)
  const peer = match.peer
  if (peer?.id) {
    if (peer.kind === 'group') parts.push(`群聊 ${peer.id}`)
    else parts.push(`私聊 ${peer.id}`)
  }
  return parts.join(' · ')
}

function reverseChannelKey(channel: string): string {
  const reverse: Record<string, string> = {
    'dingtalk-connector': 'dingtalk',
    'openclaw-weixin': 'weixin',
  }
  return reverse[channel] || channel
}

async function installPlugin(platform: string) {
  const template = templateFor(platform)
  if (!template?.pluginPkg) return
  try {
    pluginInstalling[platform] = true
    await api.plugins.install(template.pluginPkg)
    pluginStatus.value = await api.channels.pluginStatus()
    toast.success(`${template.label} 插件安装完成，Gateway 正在重启以加载插件…`)
  } catch (error: any) {
    toast.error(error?.message || '插件安装失败')
  } finally {
    pluginInstalling[platform] = false
  }
}

async function runPlatformAction(platform: string, action: string) {
  try {
    configBusy.value = true
    actionQrImageUrl.value = ''
    const result = await api.channels.action(platform, action)
    const cleaned = stripAnsi(result.output || '')
    actionOutput.value = cleaned || '(无输出)'
    if (action === 'login') {
      const url = extractUrl(cleaned)
      if (url) actionQrImageUrl.value = await buildQrDataUrl(url)
    }
    if (action === 'install') {
      pluginStatus.value = await api.channels.pluginStatus()
    }
    toast.success(action === 'install' ? '插件安装完成' : '操作已完成')
  } catch (error: any) {
    toast.error(error?.message || '操作失败')
  } finally {
    configBusy.value = false
  }
}

async function openConfigDialog(platform: string, accountId?: string) {
  const isNewMultiAccount = accountId === '' && !!templateFor(platform)?.multiAccount
  configMode.value = !isNewMultiAccount && (accountId !== undefined || isConfigured(platform)) ? 'edit' : 'create'
  configPlatform.value = platform
  configAccountId.value = accountId ?? ''
  configAgentId.value = agents.value[0]?.id || 'main'
  verifyMessage.value = ''
  verifySuccess.value = false
  actionOutput.value = ''
  actionQrImageUrl.value = ''
  resetRecord(configForm)

  // Seed defaults immediately so modal has values on open
  const template = templateFor(platform)
  if (template?.fields.length) {
    for (const field of template.fields) {
      configForm[field.key] = field.type === 'select' ? field.options?.[0]?.value ?? '' : ''
    }
  }

  // Show modal right away — no waiting for API
  showConfigModal.value = true

  if (!isNewMultiAccount) {
    try {
      configLoading.value = true
      const res = await api.channels.readPlatformConfig(platform, accountId || null)
      if (res?.values) Object.assign(configForm, res.values)
      if (res?.exists) configMode.value = 'edit'
    } catch {
      // ignore — config may not exist yet for new platforms
    } finally {
      configLoading.value = false
    }
  }

  const existingAgent = agentsForChannel(getChannelBindingKey(platform), accountId || '')[0]
  if (existingAgent) configAgentId.value = existingAgent

  // Fill any fields still missing after config load
  if (template?.fields.length) {
    for (const field of template.fields) {
      if (!(field.key in configForm)) {
        configForm[field.key] = field.type === 'select' ? field.options?.[0]?.value ?? '' : ''
      }
    }
  }
}

function closeConfigDialog() {
  showConfigModal.value = false
  verifyMessage.value = ''
  actionOutput.value = ''
  actionQrImageUrl.value = ''
  modalDiagnoseResult.value = null
}

async function runModalDiagnose() {
  try {
    modalDiagnoseLoading.value = true
    modalDiagnoseResult.value = null
    modalDiagnoseResult.value = await api.channels.diagnose(configPlatform.value, { ...configForm })
  } catch (error: any) {
    toast.error(error?.message || '诊断失败')
  } finally {
    modalDiagnoseLoading.value = false
  }
}

async function verifyCurrentPlatform() {
  const template = currentTemplate.value
  if (!template) return
  for (const field of template.fields) {
    if (isFieldRequired(field) && !String(configForm[field.key] ?? '').trim()) {
      toast.warning(`请填写 ${field.label}`)
      return
    }
  }
  try {
    configBusy.value = true
    const result = await api.channels.verify(template.name, { ...configForm })
    verifySuccess.value = !!result.valid
    verifyMessage.value = result.valid
      ? ['凭证校验通过', ...(result.details || [])].join(' · ')
      : (result.errors || ['校验失败']).join('；')
  } catch (error: any) {
    verifySuccess.value = false
    verifyMessage.value = error?.message || '校验失败'
  } finally {
    configBusy.value = false
  }
}

async function saveActionOnlyPlatform() {
  try {
    configBusy.value = true
    await api.channels.saveMessagingPlatform(configPlatform.value, {}, null)
    await refreshPage()
    toast.success('渠道已保存')
    closeConfigDialog()
  } catch (error: any) {
    toast.error(error?.message || '保存失败')
  } finally {
    configBusy.value = false
  }
}

async function saveConfigPlatform() {
  const template = currentTemplate.value
  if (!template) return
  for (const field of template.fields) {
    if (isFieldRequired(field) && !String(configForm[field.key] ?? '').trim()) {
      toast.warning(`请填写 ${field.label}`)
      return
    }
  }
  try {
    configBusy.value = true
    if (template.pluginPkg && pluginStatus.value[template.name]?.installed !== true) {
      await installPlugin(template.name)
    }
    const saveResult = await api.channels.saveMessagingPlatform(
      template.name,
      { ...configForm },
      template.multiAccount ? (configAccountId.value.trim() || null) : null,
    )
    // The backend can derive an accountId (e.g. Lansenger → bot_<suffix>);
    // reuse it for the binding so match.accountId lines up with the config.
    const bindingAccountId = template.multiAccount
      ? (saveResult.accountId || configAccountId.value.trim() || null)
      : null
    await api.channels.saveAgentBinding(
      configAgentId.value || 'main',
      getChannelBindingKey(template.name),
      bindingAccountId,
      {},
    )
    await refreshPage()
    toast.success(`${template.label} 配置已保存`)
    closeConfigDialog()
  } catch (error: any) {
    toast.error(error?.message || '保存失败')
  } finally {
    configBusy.value = false
  }
}

async function togglePlatform(platform: ConfiguredPlatform) {
  try {
    await api.channels.toggleMessagingPlatform(platform.id, !platform.enabled)
    await refreshPage()
    toast.success(`${platformLabel(platform.id)} 已${platform.enabled ? '禁用' : '启用'}`)
  } catch (error: any) {
    toast.error(error?.message || '操作失败')
  }
}

async function removePlatform(platform: string) {
  if (!window.confirm(`确定移除 ${platformLabel(platform)} 及其所有配置吗？`)) return
  try {
    await api.channels.removeMessagingPlatform(platform)
    await refreshPage()
    toast.success('已移除')
  } catch (error: any) {
    toast.error(error?.message || '移除失败')
  }
}

async function removePlatformAccount(platform: string, accountId: string) {
  if (!window.confirm(`确定移除账号 ${accountId || 'default'} 及其所有配置吗？`)) return
  try {
    await api.channels.removeMessagingPlatform(platform, accountId)
    await refreshPage()
    toast.success('已移除')
  } catch (error: any) {
    toast.error(error?.message || '移除失败')
  }
}

function syncBindingAccountOptions() {
  if (!currentBindingAccounts.value.some(item => item.accountId === bindingForm.accountId)) {
    bindingForm.accountId = ''
  }
}

function openBindingDialog(agentId?: string, platform?: string, accountId?: string) {
  bindingForm.agentId = agentId || agents.value[0]?.id || 'main'
  bindingForm.platform = platform || configuredPlatforms.value[0]?.id || ''
  bindingForm.accountId = accountId || ''
  bindingForm.peerKind = ''
  bindingForm.peerId = ''
  syncBindingAccountOptions()
  showBindingModal.value = true
}

function closeBindingDialog() {
  showBindingModal.value = false
}

function buildBindingConfig() {
  if (!bindingForm.peerKind || !bindingForm.peerId.trim()) return {}
  return { peer: { kind: bindingForm.peerKind, id: bindingForm.peerId.trim() } }
}

async function saveBinding() {
  if (!bindingForm.agentId || !bindingForm.platform) {
    toast.warning('请选择 Agent 和渠道')
    return
  }
  const channel = getChannelBindingKey(bindingForm.platform)
  const bindingConfig = buildBindingConfig()
  const exists = bindings.value.some(binding => {
    const peer = binding.match?.peer || {}
    const nextPeer = (bindingConfig as any).peer || {}
    return (binding.agentId || 'main') === bindingForm.agentId &&
      binding.match?.channel === channel &&
      (binding.match?.accountId || '') === (bindingForm.accountId || '') &&
      (peer.kind || '') === (nextPeer.kind || '') &&
      (peer.id || '') === (nextPeer.id || '')
  })
  if (exists) {
    toast.warning('已存在相同的绑定配置')
    return
  }
  try {
    bindingBusy.value = true
    await api.channels.saveAgentBinding(bindingForm.agentId, channel, bindingForm.accountId || null, bindingConfig)
    await refreshPage()
    toast.success('绑定已保存')
    closeBindingDialog()
  } catch (error: any) {
    toast.error(error?.message || '保存失败')
  } finally {
    bindingBusy.value = false
  }
}

function extractBindingConfig(match: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  if (match.peer?.id) result.peer = match.peer
  for (const [key, value] of Object.entries(match)) {
    if (key !== 'channel' && key !== 'accountId' && key !== 'peer') result[key] = value
  }
  return result
}

async function deleteBinding(binding: AgentBinding) {
  if (!window.confirm(`确定移除绑定「${formatBindingSummary(binding.match)}」吗？`)) return
  try {
    await api.channels.deleteAgentBinding(
      binding.agentId || 'main',
      binding.match?.channel,
      binding.match?.accountId || null,
      extractBindingConfig(binding.match),
    )
    await refreshPage()
    toast.success('绑定已移除')
  } catch (error: any) {
    toast.error(error?.message || '移除失败')
  }
}

async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command)
    toast.success('命令已复制')
  } catch {
    toast.error('复制失败')
  }
}

function pluginRequired(platform: string): string | null {
  return pluginStatus.value[platform]?.required || null
}

function pluginInstalled(platform: string): boolean {
  return pluginStatus.value[platform]?.installed === true
}

async function runDiagnose(platform: string) {
  diagnoseExpanded[platform] = !diagnoseExpanded[platform]
  if (!diagnoseExpanded[platform]) return
  try {
    diagnoseLoading[platform] = true
    const summary = configuredPlatforms.value.find(item => item.id === platform)
    const accountId = summary?.accounts?.[0]?.accountId || null
    const config = accountId || summary
      ? (await api.channels.readPlatformConfig(platform, accountId)).values || {}
      : {}
    diagnoseResults[platform] = await api.channels.diagnose(platform, config)
  } catch (error: any) {
    toast.error(error?.message || '诊断失败')
  } finally {
    diagnoseLoading[platform] = false
  }
}

function supportsPairing(platform: string): boolean {
  return ['telegram', 'discord', 'slack', 'feishu'].includes(platform)
}

function platformAliases(platform: string): string[] {
  return Array.from(new Set([platform, getChannelBindingKey(platform), reverseChannelKey(getChannelBindingKey(platform))]))
}

function deviceBelongsToPlatform(platform: string, entry: any): boolean {
  const aliases = platformAliases(platform)
  const candidates = [
    entry?.platform,
    entry?.raw?.platform,
    entry?.raw?.channel,
    entry?.raw?.request?.channel,
    entry?.raw?.device?.platform,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  return candidates.some(value => aliases.includes(value))
}

function pendingForPlatform(platform: string): any[] {
  return pendingRequests.value.filter(item => deviceBelongsToPlatform(platform, item))
}

function pairedForPlatform(platform: string): any[] {
  return pairedDevices.value.filter(item => deviceBelongsToPlatform(platform, item))
}

async function loadDevices() {
  try {
    devicesLoading.value = true
    const result = await api.gateway.listDevices()
    pendingRequests.value = result.pendingRequests || []
    pairedDevices.value = result.pairedDevices || []
  } catch {
    pendingRequests.value = []
    pairedDevices.value = []
  } finally {
    devicesLoading.value = false
  }
}

function togglePairing(platform: string) {
  pairingExpanded[platform] = !pairingExpanded[platform]
  if (pairingExpanded[platform]) void loadDevices()
}

async function approveDevice(requestId: string) {
  try {
    deviceActionBusy[requestId] = true
    await api.gateway.approveDevice(requestId)
    await loadDevices()
    toast.success('已批准设备')
  } catch (error: any) {
    toast.error(error?.message || '批准失败')
  } finally {
    deviceActionBusy[requestId] = false
  }
}

async function rejectDevice(requestId: string) {
  try {
    deviceActionBusy[requestId] = true
    await api.gateway.rejectDevice(requestId)
    await loadDevices()
    toast.success('已拒绝设备')
  } catch (error: any) {
    toast.error(error?.message || '拒绝失败')
  } finally {
    deviceActionBusy[requestId] = false
  }
}

async function removeDevice(deviceId: string) {
  try {
    deviceActionBusy[deviceId] = true
    await api.gateway.removeDevice(deviceId)
    await loadDevices()
    toast.success('已移除设备')
  } catch (error: any) {
    toast.error(error?.message || '移除设备失败')
  } finally {
    deviceActionBusy[deviceId] = false
  }
}

function formatTimeLabel(value?: number): string {
  if (!value) return '时间未知'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
</script>

<style scoped>
.channels-shell {
  max-width: 1320px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.page-desc,
.modal-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.65;
  max-width: 820px;
}

.channels-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.channels-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 0 16px;
}
.channels-loading-bar {
  width: 180px;
  height: 4px;
  border-radius: 2px;
  background: rgba(99, 102, 241, 0.12);
  overflow: hidden;
  position: relative;
}
.channels-loading-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.6), transparent);
  animation: channels-shimmer 1.4s ease-in-out infinite;
}
@keyframes channels-shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
.channels-loading-label {
  font-size: 13px;
  color: var(--text-secondary, var(--text-secondary));
}

.channel-metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.channel-metric-card {
  background: var(--surface);
  border: 1px solid var(--tint-medium);
  border-radius: 20px;
  padding: 18px 18px 16px;
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
  min-height: 132px;
}

.channel-metric-card::before {
  content: "";
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, rgba(99,102,241,0.9), rgba(99,102,241,0.15));
}

.channel-metric-card::after {
  content: "";
  position: absolute;
  right: -12px;
  top: -18px;
  width: 82px;
  height: 82px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(99,102,241,0.1), transparent 70%);
  pointer-events: none;
}

.channel-metric-label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-weight: 700;
  letter-spacing: .02em;
}

.channel-metric-value {
  margin-top: 10px;
  font-size: 32px;
  line-height: 1;
  font-weight: 760;
  color: var(--text-primary);
  letter-spacing: -0.04em;
}

.channel-metric-meta {
  margin-top: 8px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.6;
}

.channels-tab-bar {
  margin-bottom: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  padding: 6px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--tint-strong);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
  backdrop-filter: blur(10px);
}

.channels-tab-bar .tab {
  appearance: none;
  border: 0;
  background: transparent;
  border-radius: 999px;
  padding: 10px 18px;
  min-width: 112px;
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 180ms ease;
}

.channels-tab-bar .tab:hover {
  color: var(--text-primary);
  background: var(--tint-weak);
}

.channels-tab-bar .tab.active {
  color: #fff;
  background: linear-gradient(180deg, #818cf8 0%, var(--accent) 100%);
  box-shadow: 0 10px 24px rgba(99, 102, 241, 0.22);
}

.config-section {
  background: var(--card-fill);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

.config-section-title {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}

.section-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.6;
}

.platforms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.platform-card,
.platform-pick,
.agent-binding-card {
  background: var(--surface);
  border: 1px solid var(--tint-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}

.platform-card:hover,
.platform-pick:hover,
.agent-binding-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: rgba(99, 102, 241, 0.14);
}

.platform-card {
  padding: 20px;
  position: relative;
  overflow: hidden;
}

.platform-card.active {
  border-left: 3px solid #22c55e;
}

.platform-card.inactive {
  border-left: 3px solid #94a3b8;
  opacity: 0.8;
}

.platform-card-header,
.agent-binding-card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}

.platform-emoji {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.07));
  color: var(--accent-text);
  font-size: 14px;
  font-weight: 700;
}

.platform-head-copy {
  flex: 1;
  min-width: 0;
}

.platform-head-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.platform-head-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.platform-name,
.platform-pick-name,
.agent-binding-title {
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--text-primary);
}

.platform-pick-name {
  margin-top: 0;
  line-height: 1.25;
}

.platform-name {
  flex: 1;
  line-height: 1.25;
}

.account-count,
.platform-pick-badge,
.agent-badge,
.account-appid {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: var(--text-xs);
  font-weight: 600;
}

.account-count,
.platform-pick-badge {
  background: var(--success-bg);
  color: var(--success-text);
}

.agent-badge {
  background: rgba(99, 102, 241, 0.08);
  color: var(--accent-text);
}

.account-appid {
  background: var(--tint-medium);
  color: var(--text-secondary);
}

.platform-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: auto;
}

.platform-status-dot.on {
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.35);
}

.platform-status-dot.off {
  background: #94a3b8;
}

.platform-accounts,
.agent-binding-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.account-item,
.agent-binding-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--tint-medium);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.7);
}

.account-id {
  font-weight: 700;
  color: var(--text-primary);
}

.account-actions,
.platform-card-actions,
.agent-binding-row-actions,
.config-action-row,
.modal-footer-row,
.pairing-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.platform-card-actions {
  padding-top: 4px;
  gap: 10px;
}

.account-actions {
  margin-left: auto;
}

.platform-summary-row {
  margin-bottom: 14px;
}

.inline-panel {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--tint-strong);
}

.inline-panel-title,
.pairing-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.diag-row,
.pairing-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--tint-medium);
}

.diag-row:last-child,
.pairing-row:last-child {
  border-bottom: 0;
}

.diag-indicator {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  margin-top: 6px;
  flex: 0 0 auto;
}

.diag-ok {
  background: #22c55e;
}

.diag-fail {
  background: #ef4444;
}

.diag-title,
.pairing-id {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
}

.diag-detail {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.6;
  margin-left: auto;
  text-align: right;
}

.diag-hints,
.pairing-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.pairing-group + .pairing-group {
  margin-top: 14px;
}

.pairing-main {
  min-width: 0;
}

.binding-badges-inline {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.platform-pick {
  flex-direction: column;
  align-items: stretch;
  text-align: left;
  padding: 20px;
  min-height: 170px;
  justify-content: space-between;
  cursor: pointer;
  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
}

.platform-pick:hover {
  transform: translateY(-2px);
  border-color: rgba(99, 102, 241, 0.24);
  box-shadow: var(--shadow-md);
}

.platform-pick.configured {
  border-color: rgba(34, 197, 94, 0.28);
}

.platform-pick-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.platform-pick-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.platform-pick-desc {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.7;
  display: block;
}

.platform-pick-footer {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.channels-agent-hint {
  margin-bottom: 4px;
}

.agent-binding-card {
  padding: 20px;
  margin-bottom: 16px;
  background: var(--surface);
}

.agent-binding-card-head {
  justify-content: space-between;
  align-items: flex-start;
}

.agent-binding-row {
  justify-content: space-between;
}

.agent-binding-row-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.mono {
  font-family: var(--font-mono);
}

.empty-state {
  padding: 36px 20px;
  text-align: center;
  color: var(--text-secondary);
  border: 1px dashed var(--tint-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
}

.channels-modal {
  max-width: min(680px, 92vw);
  width: 100%;
}

.channels-shell .btn {
  min-height: 34px;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .01em;
  line-height: 1;
}

.channels-shell .btn.btn-sm {
  min-height: 32px;
  padding: 6px 13px;
}

.channels-shell .btn.btn-xs {
  min-height: 28px;
  padding: 4px 10px;
  font-size: 12px;
}

.channels-shell .btn.btn-secondary {
  background: var(--surface);
  border-color: var(--tint-strong);
  color: var(--text-secondary);
}

.channels-shell .btn.btn-secondary:hover {
  border-color: rgba(99, 102, 241, 0.18);
  color: var(--text-primary);
}

.channels-shell .btn.btn-danger {
  background: var(--error-bg);
  border-color: var(--error-bg);
  color: var(--warn-text);
}

.channels-shell .form-input,
.channels-shell .form-select {
  min-height: 42px;
  border-radius: 16px;
}

.guide-panel,
.manual-commands,
.action-output {
  margin-bottom: 16px;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--surface-2);
  border: 1px solid var(--tint-medium);
}

.guide-title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.guide-content :deep(ol) {
  padding-left: 20px;
  color: var(--text-secondary);
  line-height: 1.8;
}

.form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.required-mark {
  color: var(--error-text);
  margin-left: 4px;
}

.verify-result {
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: var(--text-sm);
}

.verify-success {
  background: var(--success-bg);
  color: var(--success-text);
}

.verify-error {
  background: var(--error-bg);
  color: var(--error-text);
}

.badge-warn {
  background: var(--warn-bg);
  color: var(--warn-text);
}

.badge-plugin-ok {
  background: rgba(99, 102, 241, 0.09);
  color: var(--accent-text);
}

.modal-diag-panel {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--surface-2);
  border: 1px solid var(--tint-medium);
}

.guide-cmd {
  display: block;
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  white-space: pre-wrap;
  word-break: break-all;
}

.action-output pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  font-size: 12px;
}

.login-qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px;
  border-radius: 16px;
  background: var(--surface-2);
  border: 1px solid var(--tint-medium);
}

.login-qr-img {
  width: 220px;
  height: 220px;
  border-radius: 8px;
  display: block;
}

.login-qr-hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

@media (max-width: 960px) {
  .channel-metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .page-header,
  .agent-binding-card-head,
  .platform-card-header,
  .account-item,
  .agent-binding-row {
    align-items: flex-start;
  }

  .account-actions {
    margin-left: 0;
  }

  .platform-pick-top {
    align-items: center;
  }
}

@media (max-width: 640px) {
  .channel-metric-grid {
    grid-template-columns: 1fr;
  }

  .channels-tab-bar {
    width: 100%;
    justify-content: stretch;
  }

  .channels-tab-bar .tab {
    flex: 1;
    min-width: 0;
  }
}

/* platform grouping */
.platform-group-label {
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: .05em;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.overseas-toggle {
  appearance: none;
  border: 1px dashed var(--tint-strong);
  background: var(--surface-2);
  border-radius: 14px;
  padding: 11px 16px;
  margin-top: 16px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}

.overseas-toggle:hover {
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.18);
  color: var(--text-primary);
}

.overseas-toggle-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: 500;
}

.overseas-toggle-arrow {
  margin-left: auto;
  color: var(--text-muted);
  transition: transform 200ms ease;
}

.overseas-toggle-arrow.expanded {
  transform: rotate(180deg);
}

.platforms-grid-overseas {
  margin-top: 12px;
}

/* modal loading bar */
.config-loading-bar {
  height: 3px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.1);
  overflow: hidden;
  margin-bottom: 14px;
}

.config-loading-inner {
  height: 100%;
  width: 40%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), #60a5fa);
  animation: loading-slide 1.2s ease-in-out infinite;
}

@keyframes loading-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

/* action-only-shell spacing */
.action-only-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-only-desc {
  margin: 0;
  line-height: 1.7;
}

.action-only-shell .config-action-row {
  margin: 0;
}

.action-only-shell .action-output,
.action-only-shell .manual-commands {
  margin-bottom: 0;
}
</style>
