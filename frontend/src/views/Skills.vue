<template>
  <div class="page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">技能管理</h1>
        <p class="page-desc">浏览技能仓库、检查内置技能依赖，并为 Agent 安装和管理技能。</p>
      </div>
      <div class="header-actions">
        <n-button type="primary" @click="showInstallModal = true">↑ 离线安装</n-button>
      </div>
    </div>

    <div class="metric-grid skills-metric-grid">
      <div class="metric-card">
        <div class="metric-label">远端技能</div>
        <div class="metric-value">{{ store.registry.length }}</div>
        <div class="metric-meta">当前源：{{ activeSourceName }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">内置就绪</div>
        <div class="metric-value">{{ bundledReadyCount }}</div>
        <div class="metric-meta">共 {{ store.bundled.length }} 个内置技能，适合快速核验运行环境</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">已安装</div>
        <div class="metric-value">{{ store.skills.length }}</div>
        <div class="metric-meta">{{ installedEnabledCount }} 个启用 · {{ installedGlobalCount }} 个全局技能</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">仓库源</div>
        <div class="metric-value">{{ store.sources.length }}</div>
        <div class="metric-meta">{{ store.sources.length ? `已配置，当前使用 ${activeSourceName}` : '尚未配置远端或本地仓库源' }}</div>
      </div>
    </div>

    <section class="section-card skills-shell-card">
      <div class="skills-shell-header">
        <div class="skills-shell-copy">
          <div class="skills-shell-kicker">{{ currentTabKicker }}</div>
          <h2 class="section-title skills-shell-title">{{ currentTabTitle }}</h2>
          <p class="section-desc skills-shell-desc">{{ currentTabDesc }}</p>
        </div>
        <div class="skills-shell-actions">
          <n-button v-if="activeTab === 'registry'" size="small" @click="openSources">仓库源</n-button>
          <n-button v-if="activeTab === 'registry'" size="small" @click="store.loadRegistry(registrySearch, selectedSourceId)">↻ 刷新</n-button>
          <n-button v-else-if="activeTab === 'bundled'" size="small" @click="store.loadBundled()">↻ 刷新</n-button>
        </div>
      </div>

      <div class="tab-bar-wrap skills-tab-bar">
        <n-tabs v-model:value="activeTab" type="segment" animated>
          <n-tab-pane
            v-for="tab in TABS"
            :key="tab.key"
            :name="tab.key"
            :tab="tab.showCount ? `${tab.label} (${tab.count.value})` : tab.label"
            display-directive="show"
          />
        </n-tabs>
      </div>

      <!-- ─── 技能库 tab ────────────────────────────────────────────── -->
      <div v-if="activeTab === 'registry'" class="skills-pane">
        <div class="toolbar-panel">
          <div class="toolbar">
            <div class="search-wrap">
              <span class="search-icon">🔍</span>
              <input
                v-model="registrySearch"
                placeholder="搜索技能名称或描述…"
                class="search-input"
                @input="queueRegistrySearch"
                @keyup.enter="triggerRegistrySearch"
              />
            </div>
            <div class="filter-chips">
              <button
                v-for="cat in registryCategories"
                :key="cat"
                :class="['chip', { active: registryCat === cat }]"
                @click="registryCat = registryCat === cat ? '' : cat"
              >{{ cat }}</button>
            </div>
            <n-select
              v-if="store.sources.length > 1"
              v-model:value="selectedSourceId"
              :options="store.sources.map(src => ({ label: src.name, value: src.id }))"
              size="small"
              style="min-width: 200px"
              @update:value="switchSource"
            />
          </div>

          <div class="toolbar-summary">
            <span>当前源：{{ activeSourceName }}</span>
            <span>显示 {{ filteredRegistry.length }} / {{ store.registry.length }} 个技能</span>
            <span v-if="registryInstalledCount">其中 {{ registryInstalledCount }} 个已有安装</span>
          </div>

          <div v-if="sourceNames.length > 1" class="source-legend">
            <span v-for="src in sourceNames" :key="src" class="source-tag">
              <span class="source-dot"></span>{{ src }}
            </span>
          </div>
        </div>

        <div v-if="store.registryLoading" class="empty-state skills-empty-state">
          <div class="empty-icon">⌛</div>
          <h3 class="empty-title">搜索远端技能中…</h3>
          <p class="empty-desc">正在从远端仓库拉取结果，请稍候。</p>
        </div>

        <div v-else-if="store.registry.length === 0" class="empty-state skills-empty-state">
          <div class="empty-icon">📦</div>
          <h3 class="empty-title">远端技能仓库为空</h3>
          <p class="empty-desc">
            当前远端仓库没有返回可用技能。你可以点击上方「仓库源」检查镜像地址，或稍后重试刷新。
          </p>
        </div>

        <div v-else-if="filteredRegistry.length === 0" class="empty-state skills-empty-state">
          <div class="empty-icon">🔍</div>
          <h3 class="empty-title">无匹配技能</h3>
          <p class="empty-desc">尝试调整搜索词或分类筛选。</p>
        </div>

        <div v-else class="skill-grid">
          <article
            v-for="skill in filteredRegistry"
            :key="skill.name + (skill.source ?? '')"
            class="skill-card skill-card-registry"
          >
            <div class="skill-card-topline">
              <span class="skill-surface-label">{{ skill.downloadUrl || skill.slug ? '远端收录' : '本地镜像' }}</span>
              <span v-if="installedNames.has(skill.name)" class="installed-tag">已有安装</span>
            </div>

            <div class="skill-card-header">
              <span class="skill-icon">{{ skillEmoji(skill.name) }}</span>
              <div class="skill-meta">
                <div class="skill-name">{{ skill.name }}</div>
                <div class="skill-badges">
                  <span class="skill-cat-badge">{{ skillCategory(skill.name) }}</span>
                  <span v-if="skill.source" class="source-badge">{{ skill.source }}</span>
                </div>
              </div>
            </div>

            <p class="skill-desc">{{ skill.description || '暂无描述' }}</p>
            <div class="skill-footnote">
              {{ skill.downloadUrl || skill.slug ? '可安装到全局技能库或指定 Agent，适合逐步扩展能力。' : '从当前镜像源直接部署到目标 Agent，适合团队内统一下发。' }}
            </div>

            <div class="skill-actions">
              <template v-if="skill.downloadUrl || skill.slug">
                <div class="deploy-wrap">
                  <select v-model="deployTargets[skill.name]" class="form-select form-select-compact agent-select" @click.stop>
                    <option value="">安装到…</option>
                    <option value="__registry__">全局技能库</option>
                    <option v-for="a in store.agents" :key="a.id" :value="a.id">
                      {{ a.identityEmoji ? a.identityEmoji + ' ' : '' }}{{ a.identityName || a.id }}
                    </option>
                  </select>
                  <n-button
                    type="primary"
                    size="small"
                    @click="installRemoteSkill(skill)"
                    :disabled="!deployTargets[skill.name] || deploying === skill.name"
                    :loading="deploying === skill.name"
                  >{{ deploying === skill.name ? '安装中…' : '安装' }}</n-button>
                </div>
              </template>

              <template v-else>
                <div class="deploy-wrap">
                  <select v-model="deployTargets[skill.name]" class="form-select form-select-compact agent-select" @click.stop>
                    <option value="">选择 Agent…</option>
                    <option v-for="a in store.agents" :key="a.id" :value="a.id">
                      {{ a.identityEmoji ? a.identityEmoji + ' ' : '' }}{{ a.identityName || a.id }}
                    </option>
                  </select>
                  <n-button
                    type="primary"
                    size="small"
                    @click="deploySkill(skill.name)"
                    :disabled="!deployTargets[skill.name] || deploying === skill.name"
                    :loading="deploying === skill.name"
                  >{{ deploying === skill.name ? '部署中…' : '部署' }}</n-button>
                </div>
              </template>
            </div>
          </article>
        </div>
      </div>

      <!-- ─── 内置技能 tab ──────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'bundled'" class="skills-pane">
        <div class="toolbar-panel">
          <div class="toolbar">
            <div class="search-wrap">
              <span class="search-icon">🔍</span>
              <input v-model="bundledSearch" placeholder="搜索内置技能…" class="search-input" />
            </div>
            <div class="filter-chips">
              <button :class="['chip', { active: bundledStatus === '' }]" @click="bundledStatus = ''">全部</button>
              <button :class="['chip', { active: bundledStatus === 'ready' }]" @click="bundledStatus = bundledStatus === 'ready' ? '' : 'ready'">✓ 就绪</button>
              <button :class="['chip', { active: bundledStatus === 'needs-setup' }]" @click="bundledStatus = bundledStatus === 'needs-setup' ? '' : 'needs-setup'">△ 需安装依赖</button>
              <button :class="['chip', { active: bundledStatus === 'unsupported-os' }]" @click="bundledStatus = bundledStatus === 'unsupported-os' ? '' : 'unsupported-os'">✕ 不支持此系统</button>
            </div>
          </div>

          <div class="toolbar-summary">
            <span>就绪 {{ bundledReadyCount }} / {{ store.bundled.length }}</span>
            <span>需安装依赖 {{ bundledNeedsCount }}</span>
            <span v-if="bundledUnsupportedCount">系统不支持 {{ bundledUnsupportedCount }}</span>
          </div>
        </div>

        <div class="bundled-stats">
          <span class="stat-item stat-ready">✓ {{ bundledReadyCount }} 就绪</span>
          <span class="stat-item stat-needs">△ {{ bundledNeedsCount }} 需安装依赖</span>
          <span v-if="bundledUnsupportedCount" class="stat-item stat-unsupported">✕ {{ bundledUnsupportedCount }} 不支持</span>
        </div>

        <div v-if="filteredBundled.length === 0" class="empty-state skills-empty-state">
          <div class="empty-icon">🔍</div>
          <h3 class="empty-title">无匹配结果</h3>
          <p class="empty-desc">调整搜索词或状态筛选，继续检查当前运行环境。</p>
        </div>

        <div v-else class="skill-grid">
          <article
            v-for="skill in filteredBundled"
            :key="skill.name"
            :class="['skill-card', 'skill-card-bundled', `bundled-${skill.status}`]"
          >
            <div class="skill-card-topline">
              <span class="skill-surface-label">内置技能</span>
              <span :class="['bundled-status-badge', `bsb-${skill.status}`]">{{ STATUS_LABEL[skill.status] }}</span>
            </div>

            <div class="skill-card-header">
              <span class="skill-icon">{{ skill.emoji }}</span>
              <div class="skill-meta">
                <div class="skill-name">{{ skill.name }}</div>
                <div class="skill-badges">
                  <span v-if="skill.os?.length" class="skill-cat-badge">{{ skill.os.join('/') }}</span>
                </div>
              </div>
            </div>

            <p class="skill-desc">{{ skill.description || '暂无描述' }}</p>

            <div v-if="skill.requiredBins?.length" class="dep-section">
              <div class="dep-title">依赖命令</div>
              <div class="dep-bins">
                <span
                  v-for="bin in skill.requiredBins"
                  :key="bin"
                  :class="['dep-bin', skill.missingBins?.includes(bin) ? 'dep-missing' : 'dep-ok']"
                >
                  {{ skill.missingBins?.includes(bin) ? '✗' : '✓' }} {{ bin }}
                </span>
              </div>
            </div>

            <div v-if="skill.status === 'needs-setup' && skill.install?.length" class="install-section">
              <div class="install-title">安装方式</div>
              <div class="install-opts">
                <div v-for="opt in skill.install" :key="opt.id" class="install-opt">
                  <div class="install-opt-header">
                    <span class="install-kind-badge">{{ opt.kind }}</span>
                    <span class="install-label">{{ opt.label }}</span>
                    <button
                      class="copy-btn"
                      @click="copyInstallCmd(opt)"
                      :title="'复制安装命令'"
                    >复制</button>
                  </div>
                  <code class="install-cmd">{{ installCmd(opt) }}</code>
                </div>
              </div>
            </div>

            <div v-if="skill.homepage" class="skill-actions">
              <n-button tag="a" :href="skill.homepage" target="_blank" rel="noopener" size="small">文档 ↗</n-button>
            </div>
          </article>
        </div>
      </div>

      <!-- ─── 已安装 tab ────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'installed'" class="skills-pane">
        <div class="toolbar-panel">
          <div class="toolbar">
            <div class="search-wrap">
              <span class="search-icon">🔍</span>
              <input v-model="installedSearch" placeholder="搜索已安装技能…" class="search-input" />
            </div>
            <div class="filter-chips">
              <button :class="['chip', { active: installedAgent === '' }]" @click="installedAgent = ''">全部</button>
              <button
                v-for="a in installedAgentNames"
                :key="a"
                :class="['chip', { active: installedAgent === a }]"
                @click="installedAgent = installedAgent === a ? '' : a"
              >{{ a }}</button>
            </div>
          </div>

          <div class="toolbar-summary">
            <span>显示 {{ filteredInstalled.length }} / {{ store.skills.length }} 个技能</span>
            <span>{{ installedEnabledCount }} 个处于启用状态</span>
            <span>{{ installedAgentNames.length || 1 }} 个 Agent / 全局作用域</span>
          </div>
        </div>

        <div v-if="store.skills.length === 0" class="empty-state skills-empty-state">
          <div class="empty-icon">⚡</div>
          <h3 class="empty-title">尚未安装任何技能</h3>
          <p class="empty-desc">前往「技能库」将技能部署到 Agent，或通过「离线安装」上传技能包。</p>
          <n-button type="primary" @click="activeTab = 'registry'">浏览技能库</n-button>
        </div>

        <div v-else-if="filteredInstalled.length === 0" class="empty-state skills-empty-state">
          <div class="empty-icon">🔍</div>
          <h3 class="empty-title">无匹配结果</h3>
          <p class="empty-desc">换一个 Agent 过滤条件，或尝试搜索技能名称与描述。</p>
        </div>

        <div v-else class="installed-groups">
          <section v-for="group in installedGroups" :key="group.agent" class="agent-group-card">
            <div class="agent-group-header">
              <div class="agent-group-heading">
                <span class="agent-dot"></span>
                <span class="agent-group-name">{{ group.agent }}</span>
                <span class="agent-group-count">{{ group.skills.length }} 个技能</span>
              </div>
              <span class="agent-group-status">{{ groupEnabledCount(group.skills) }} 启用</span>
            </div>

            <div class="skill-grid installed-skill-grid">
              <article
                v-for="skill in group.skills"
                :key="skill.name"
                :class="['skill-card', 'skill-card-installed', { 'skill-disabled': !skill.enabled }]"
              >
                <div class="skill-card-topline">
                  <span class="skill-surface-label">{{ skill.agent ? 'Agent 技能' : '全局技能' }}</span>
                  <n-tag :type="skill.enabled ? 'success' : 'default'" size="small" round>
                    {{ skill.enabled ? '启用' : '禁用' }}
                  </n-tag>
                </div>

                <div class="skill-card-header">
                  <span class="skill-icon">{{ skillEmoji(skill.name) }}</span>
                  <div class="skill-meta">
                    <div class="skill-name">{{ skill.name }}</div>
                    <div class="skill-badges">
                      <span class="skill-cat-badge">{{ skillCategory(skill.name) }}</span>
                    </div>
                  </div>
                </div>

                <p class="skill-desc">{{ skill.description || '暂无描述' }}</p>
                <div class="skill-footnote">
                  {{ skill.agent ? '该技能仅在当前 Agent 工作区内生效，可按需单独开关。' : '全局技能对所有 Agent 可见，建议仅保留稳定共用能力。' }}
                </div>

                <div class="skill-actions">
                  <n-button v-if="skill.enabled && skill.agent" size="small" @click="store.disable(skill.name, skill.agent)">禁用</n-button>
                  <n-button v-if="!skill.enabled && skill.agent" type="primary" size="small" @click="store.enable(skill.name, skill.agent)">启用</n-button>
                  <span v-if="!skill.agent" class="global-tag">全局</span>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </section>

    <!-- ─── 离线安装 modal ────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showInstallModal" class="ui-modal-overlay" @click.self="closeInstall">
        <div class="ui-modal ui-modal-sm" role="dialog" aria-modal="true">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">离线安装技能</div>
              <div class="ui-modal-subtitle">上传 .zip 压缩包或单个 SKILL.md 文件</div>
            </div>
            <button class="ui-modal-close" @click="closeInstall">✕</button>
          </div>
          <div class="ui-modal-body">
            <!-- Drop zone -->
            <div
              :class="['drop-zone', { 'drag-over': dragging, 'has-file': uploadFile }]"
              @dragover.prevent="dragging = true"
              @dragleave="dragging = false"
              @drop.prevent="onDrop"
              @click="fileInputEl?.click()"
            >
              <input ref="fileInputEl" type="file" accept=".zip,.md" @change="onFileChange" hidden />
              <template v-if="uploadFile">
                <span class="drop-file-icon">{{ uploadFile.name.endsWith('.md') ? '📄' : '📦' }}</span>
                <div class="drop-file-name">{{ uploadFile.name }}</div>
                <div class="drop-file-size">{{ formatSize(uploadFile.size) }}</div>
                <n-button size="small" @click.stop="clearFile">重新选择</n-button>
              </template>
              <template v-else>
                <span class="drop-icon">↑</span>
                <div class="drop-title">拖拽或点击选择文件</div>
                <div class="drop-hint">支持 .zip 压缩包，或单个 SKILL.md 文件</div>
              </template>
            </div>

            <!-- Skill name input — only for .md uploads -->
            <div v-if="isMdUpload" class="form-group" style="margin-top: var(--space-4)">
              <label class="form-label">
                技能名称 <span class="required-mark">*</span>
                <span class="form-hint-inline">小写字母、数字、连字符，例如 my-skill</span>
              </label>
              <n-input v-model:value="uploadSkillName" placeholder="e.g. alphaear-analysis" />
              <p v-if="uploadSkillName && !isValidSkillName" class="form-error">
                只能包含小写字母、数字和连字符，且不能以连字符开头
              </p>
            </div>

            <div class="form-group" style="margin-top: var(--space-4); margin-bottom: 0">
              <label class="form-label">
                安装到
                <span class="form-hint-inline">（留空则安装到全局技能库）</span>
              </label>
              <n-select
                v-model:value="uploadAgent"
                :options="[
                  { label: '全局技能库（所有 Agent 可用）', value: '' },
                  ...store.agents.map((a: any) => ({ label: (a.identityEmoji ? a.identityEmoji + ' ' : '') + (a.identityName || a.id), value: a.id }))
                ]"
              />
            </div>

            <div v-if="installError" class="alert-error">{{ installError }}</div>
          </div>
          <div class="ui-modal-footer">
            <n-button @click="closeInstall">取消</n-button>
            <n-button type="primary" @click="doInstall" :disabled="!canInstall || installing" :loading="installing">
              {{ installing ? '安装中…' : '安装' }}
            </n-button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ─── 仓库源管理 modal ───────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showSourcesModal" class="ui-modal-overlay" @click.self="showSourcesModal = false">
        <div class="ui-modal ui-modal-md" role="dialog" aria-modal="true">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">技能仓库源</div>
            </div>
            <button class="ui-modal-close" @click="showSourcesModal = false">✕</button>
          </div>
          <div class="ui-modal-body">
        <!-- Remote sources -->
        <div
          v-for="(src, idx) in editableSources"
          :key="src.id"
              class="source-row"
            >
              <div class="source-row-info">
                <div class="source-row-name">{{ src.name || '（未命名）' }}</div>
                <div class="source-row-url">{{ src.url }}</div>
              </div>
          <n-tag :type="src.type === 'local' ? 'info' : 'warning'" size="small" round>
            {{ src.type === 'local' ? '本地' : '远程' }}
          </n-tag>
          <n-button type="error" size="small" @click="editableSources.splice(idx, 1)">删除</n-button>
        </div>

            <div v-if="editableSources.length === 0" class="sources-empty">暂无远程仓库源</div>

            <!-- Add new source form -->
            <div class="add-source-form">
          <div class="add-source-title">添加仓库源</div>
          <div class="add-source-row">
            <n-select
              v-model:value="newSrc.type"
              :options="[{ label: '远程 URL', value: 'remote' }, { label: '本地目录', value: 'local' }]"
              style="width: 110px; flex-shrink: 0"
            />
                <n-input v-model:value="newSrc.name" placeholder="名称（如：团队技能库）" />
              </div>
              <n-input
                v-model:value="newSrc.url"
            :placeholder="newSrc.type === 'local' ? '/path/to/skills' : 'https://cn.clawhub-mirror.com'"
          />
          <p v-if="newSrc.type === 'remote'" class="form-hint">ClawHub 镜像建议填写站点根地址，如 <code>https://cn.clawhub-mirror.com</code></p>
              <n-button type="primary" size="small" @click="addSource" :disabled="!newSrc.name || !newSrc.url">添加</n-button>
            </div>
          </div>
          <div class="ui-modal-footer">
            <n-button @click="showSourcesModal = false">取消</n-button>
            <n-button type="primary" @click="saveSources" :disabled="savingSources" :loading="savingSources">
              {{ savingSources ? '保存中…' : '保存并刷新' }}
            </n-button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { NButton, NInput, NSelect, NTag, NTabs, NTabPane } from 'naive-ui'
import { useSkillsStore } from '../stores/skills.js'
import type { RegistrySource } from '../stores/skills.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'

const store = useSkillsStore()
const toast = useNaiveToast()

const activeTab = ref<'registry' | 'bundled' | 'installed'>('registry')

onMounted(async () => {
  await Promise.allSettled([store.load(), store.loadBundled(), store.loadAgents(), store.loadSources()])
  selectedSourceId.value = store.activeSourceId
  await store.loadRegistry('', selectedSourceId.value)
})

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'registry' as const,  label: '技能库',   count: computed(() => store.registry.length), showCount: false },
  { key: 'bundled' as const,   label: '内置技能', count: computed(() => store.bundled.length), showCount: true },
  { key: 'installed' as const, label: '已安装',   count: computed(() => store.skills.length), showCount: true },
]

const TAB_COPY: Record<'registry' | 'bundled' | 'installed', { kicker: string; title: string; desc: string }> = {
  registry: {
    kicker: 'Repository',
    title: '统一浏览技能仓库',
    desc: '聚合远端与镜像源技能，支持按分类搜索后直接安装到全局技能库或指定 Agent。',
  },
  bundled: {
    kicker: 'Bundled',
    title: '检查平台内置技能',
    desc: '查看随平台分发的技能清单、运行依赖与安装建议，快速判断当前环境是否可用。',
  },
  installed: {
    kicker: 'Installed',
    title: '按 Agent 管理已安装技能',
    desc: '从作用域视角查看技能启用状态，保持工作区能力清晰、可控、可维护。',
  },
}

const currentTabKicker = computed(() => TAB_COPY[activeTab.value].kicker)
const currentTabTitle = computed(() => TAB_COPY[activeTab.value].title)
const currentTabDesc = computed(() => TAB_COPY[activeTab.value].desc)

// ── Registry tab ───────────────────────────────────────────────────────────────

const registrySearch = ref('')
const registryCat = ref('')
const selectedSourceId = ref('')
const deployTargets = reactive<Record<string, string>>({})
const deploying = ref('')

const sourceNames = computed(() => {
  const names = new Set<string>()
  for (const s of store.registry) if (s.source) names.add(s.source)
  return [...names]
})

const activeSourceName = computed(() =>
  store.sources.find(src => src.id === selectedSourceId.value)?.name
  ?? store.sources.find(src => src.id === store.activeSourceId)?.name
  ?? store.sources[0]?.name
  ?? '默认仓库源'
)

const registryCategories = computed(() => {
  const cats = new Set<string>()
  for (const s of store.registry) cats.add(skillCategory(s.name))
  return [...cats].sort()
})

const filteredRegistry = computed(() => {
  let list = store.registry
  if (registryCat.value) list = list.filter(s => skillCategory(s.name) === registryCat.value)
  return list
})

let registrySearchTimer: ReturnType<typeof setTimeout> | null = null
function queueRegistrySearch() {
  if (registrySearchTimer) clearTimeout(registrySearchTimer)
  registrySearchTimer = setTimeout(() => {
    void store.loadRegistry(registrySearch.value.trim(), selectedSourceId.value)
  }, 250)
}

function triggerRegistrySearch() {
  if (registrySearchTimer) clearTimeout(registrySearchTimer)
  void store.loadRegistry(registrySearch.value.trim(), selectedSourceId.value)
}

async function switchSource(sourceId: string) {
  selectedSourceId.value = sourceId
  await store.setActiveSource(sourceId)
}

// skills with agent = null are global; include all for "已有安装" badge
const installedNames = computed(() => new Set(store.skills.map((s: any) => s.name)))
const registryInstalledCount = computed(() => filteredRegistry.value.filter((s: any) => installedNames.value.has(s.name)).length)
const installedEnabledCount = computed(() => store.skills.filter((s: any) => s.enabled).length)
const installedGlobalCount = computed(() => store.skills.filter((s: any) => !s.agent).length)

async function deploySkill(skillName: string) {
  const agent = deployTargets[skillName]
  if (!agent) return
  deploying.value = skillName
  try {
    await store.deploy(skillName, agent)
    toast.success(`${skillName} 已部署到 ${agent}`)
    deployTargets[skillName] = ''
  } catch (err: any) {
    toast.error(`部署失败: ${err.message}`)
  } finally {
    deploying.value = ''
  }
}

async function installRemoteSkill(skill: any) {
  const target = deployTargets[skill.name]
  if (!target) return
  deploying.value = skill.name
  try {
    const agent = target === '__registry__' ? null : target
    if (skill.slug && skill.sourceType === 'clawhub') {
      await store.installRegistry(skill.slug, skill.sourceUrl, skill.sourceType, agent)
    } else if (skill.slug && skill.sourceType === 'skillhub') {
      await store.installRegistry(skill.slug, skill.sourceUrl, skill.sourceType, agent)
    } else {
      await store.installRemote(skill.downloadUrl, agent)
    }
    toast.success(`${skill.name} 安装成功`)
    deployTargets[skill.name] = ''
  } catch (err: any) {
    toast.error(`安装失败: ${err.message}`)
  } finally {
    deploying.value = ''
  }
}

// ── Bundled tab ────────────────────────────────────────────────────────────────

const bundledSearch = ref('')
const bundledStatus = ref('')

const STATUS_LABEL: Record<string, string> = {
  'ready': '✓ 就绪',
  'needs-setup': '△ 需安装依赖',
  'unsupported-os': '✕ 不支持此系统',
}

const filteredBundled = computed(() => {
  let list = store.bundled
  if (bundledStatus.value) list = list.filter((s: any) => s.status === bundledStatus.value)
  if (bundledSearch.value) {
    const q = bundledSearch.value.toLowerCase()
    list = list.filter((s: any) =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q) ||
      (s.requiredBins ?? []).some((b: string) => b.toLowerCase().includes(q))
    )
  }
  return list
})

const bundledReadyCount      = computed(() => store.bundled.filter((s: any) => s.status === 'ready').length)
const bundledNeedsCount      = computed(() => store.bundled.filter((s: any) => s.status === 'needs-setup').length)
const bundledUnsupportedCount = computed(() => store.bundled.filter((s: any) => s.status === 'unsupported-os').length)

function installCmd(opt: any): string {
  switch (opt.kind) {
    case 'brew': return opt.formula ? `brew install ${opt.formula}` : opt.label
    case 'apt':  return opt.package ? `sudo apt install ${opt.package}` : opt.label
    case 'npm':  return opt.package ? `npm install -g ${opt.package}` : opt.label
    case 'pip':  return opt.package ? `pip install ${opt.package}` : opt.label
    case 'cargo':return opt.package ? `cargo install ${opt.package}` : opt.label
    default: return opt.url ?? opt.label
  }
}

function copyInstallCmd(opt: any) {
  navigator.clipboard.writeText(installCmd(opt))
  toast.success('命令已复制')
}

// ── Installed tab ──────────────────────────────────────────────────────────────

const installedSearch = ref('')
const installedAgent = ref('')

const installedAgentNames = computed(() => {
  const names = new Set<string>()
  for (const s of store.skills) if (s.agent) names.add(s.agent)
  return [...names].sort()
})

const filteredInstalled = computed(() => {
  let list = store.skills
  if (installedAgent.value) list = list.filter((s: any) => s.agent === installedAgent.value)
  if (installedSearch.value) {
    const q = installedSearch.value.toLowerCase()
    list = list.filter((s: any) =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q)
    )
  }
  return list
})

const installedGroups = computed(() => {
  const map = new Map<string, any[]>()
  for (const s of filteredInstalled.value) {
    const key = s.agent ?? '全局'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  return [...map.entries()].map(([agent, skills]) => ({ agent, skills }))
})

function groupEnabledCount(skills: any[]): number {
  return skills.filter(skill => skill.enabled).length
}

// ── Offline install ────────────────────────────────────────────────────────────

const showInstallModal = ref(false)
const uploadFile = ref<File | null>(null)
const uploadAgent = ref('')
const uploadSkillName = ref('')
const installing = ref(false)
const installError = ref('')
const dragging = ref(false)
const fileInputEl = ref<HTMLInputElement | null>(null)

const isMdUpload = computed(() => uploadFile.value?.name.endsWith('.md') ?? false)
const isValidSkillName = computed(() => /^[a-z0-9][a-z0-9-]*$/.test(uploadSkillName.value))
const canInstall = computed(() => {
  if (!uploadFile.value) return false
  if (isMdUpload.value) return !!uploadSkillName.value && isValidSkillName.value
  return true
})

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null
  setFile(f)
}

function onDrop(e: DragEvent) {
  dragging.value = false
  setFile(e.dataTransfer?.files?.[0] ?? null)
}

function setFile(f: File | null) {
  uploadFile.value = f
  installError.value = ''
  // Try to infer skill name from filename for SKILL.md
  if (f?.name === 'SKILL.md' || f?.name.endsWith('.md')) {
    // Can't infer name from SKILL.md filename, let user type it
    uploadSkillName.value = ''
  }
}

function clearFile() {
  uploadFile.value = null
  uploadSkillName.value = ''
  installError.value = ''
  if (fileInputEl.value) fileInputEl.value.value = ''
}

function closeInstall() {
  showInstallModal.value = false
  clearFile()
  uploadAgent.value = ''
}

async function doInstall() {
  if (!uploadFile.value || !canInstall.value) return
  installing.value = true
  installError.value = ''
  try {
    const skillName = isMdUpload.value ? uploadSkillName.value : undefined
    await store.install(uploadFile.value, uploadAgent.value || null, skillName)
    toast.success('技能安装成功')
    closeInstall()
  } catch (err: any) {
    installError.value = err.message ?? '安装失败'
  } finally {
    installing.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Source management ──────────────────────────────────────────────────────────

const showSourcesModal = ref(false)
const savingSources = ref(false)
const editableSources = ref<RegistrySource[]>([])
const newSrc = reactive({ name: '', type: 'local' as 'local' | 'remote', url: '' })

// Sync editableSources when modal opens
function openSources() {
  editableSources.value = store.sources.map(s => ({ ...s }))
  showSourcesModal.value = true
}

// Watch showSourcesModal to sync
watch(showSourcesModal, (v) => {
  if (v) editableSources.value = store.sources.map(s => ({ ...s }))
})

function addSource() {
  if (!newSrc.name || !newSrc.url) return
  editableSources.value.push({
    id: `src-${Date.now()}`,
    name: newSrc.name,
    type: newSrc.type,
    url: newSrc.url,
  })
  newSrc.name = ''
  newSrc.url = ''
  newSrc.type = 'local'
}

async function saveSources() {
  savingSources.value = true
  try {
    await store.saveSources([...editableSources.value])
    selectedSourceId.value = store.activeSourceId
    toast.success('仓库源已保存')
    showSourcesModal.value = false
  } catch (err: any) {
    toast.error(`保存失败: ${err.message}`)
  } finally {
    savingSources.value = false
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  alphaear: '金融',
  contract: '法律',
  medical: '医疗',
  bio: '生物信息',
  'single-cell': '生物信息',
  frontend: '前端',
  skill: '工具',
}

const CATEGORY_EMOJI: Record<string, string> = {
  金融: '📈', 法律: '⚖️', 医疗: '🏥', 生物信息: '🧬', 前端: '🎨', 工具: '🔧', 其他: '⚡',
}

function skillCategory(name: string): string {
  for (const [prefix, cat] of Object.entries(CATEGORY_MAP)) {
    if (name.startsWith(prefix)) return cat
  }
  return '其他'
}

function skillEmoji(name: string): string {
  return CATEGORY_EMOJI[skillCategory(name)] ?? '⚡'
}
</script>

<style scoped>
.skills-metric-grid {
  margin-top: calc(var(--space-2) * -1);
}

.skills-shell-card {
  padding: var(--space-5);
}

.skills-shell-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.skills-shell-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.skills-shell-kicker {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(99, 102, 241, 0.18);
  background: var(--surface);
  color: var(--accent-text);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.skills-shell-title {
  margin: 0;
}

.skills-shell-desc {
  max-width: 720px;
}

.skills-shell-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.tab-bar-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.tab-bar-wrap :deep(.n-tabs) {
  flex: 1;
}

.skills-tab-bar {
  margin-bottom: var(--space-5);
}

.skills-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.toolbar-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.toolbar {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
}

.search-wrap {
  position: relative;
  flex: 1 1 280px;
  min-width: 220px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 13px;
  pointer-events: none;
  opacity: 0.72;
}

.search-input {
  width: 100%;
  min-height: 40px;
  padding: 9px 13px 9px 36px;
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-fast);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), 0 4px 14px rgba(15,23,42,0.035);
}

.search-input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1), 0 12px 24px rgba(99,102,241,0.08);
}

.filter-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.chip {
  padding: 6px 11px;
  font-size: var(--text-xs);
  font-weight: 600;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--duration-fast), color var(--duration-fast), background var(--duration-fast), transform var(--duration-fast);
  white-space: nowrap;
}

.chip:hover {
  border-color: rgba(99, 102, 241, 0.28);
  color: var(--accent-text);
  transform: translateY(-1px);
}

.chip.active {
  background: var(--surface-2);
  border-color: rgba(99, 102, 241, 0.28);
  color: var(--accent-text);
  box-shadow: 0 10px 22px rgba(99,102,241,0.08);
}

.toolbar-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.toolbar-summary span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.toolbar-summary span::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.4);
}

.source-legend {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.source-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: var(--radius-full);
  background: var(--surface);
  border: 1px solid var(--tint-strong);
}

.source-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.source-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: var(--warn-bg);
  color: var(--warn-text);
  padding: 2px 7px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(181, 127, 16, 0.14);
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
}

.skill-card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 240px;
  padding: var(--space-4);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  background: var(--card-fill-soft);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out), border-color var(--duration-normal) var(--ease-out);
}

.skill-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 100% 0%, rgba(99,102,241,0.09), transparent 34%);
  pointer-events: none;
}

.skill-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-hover);
  border-color: rgba(99, 102, 241, 0.16);
}

.skill-card.skill-disabled {
  opacity: 0.68;
}

.skill-card-registry {
  min-height: 272px;
}

.skill-card-bundled.bundled-needs-setup {
  border-color: rgba(217, 119, 6, 0.24);
}

.skill-card-bundled.bundled-unsupported-os {
  opacity: 0.78;
}

.skill-card-topline,
.skill-card-header,
.skill-desc,
.skill-footnote,
.skill-actions,
.dep-section,
.install-section {
  position: relative;
  z-index: 1;
}

.skill-card-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.skill-surface-label {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: var(--radius-full);
  background: var(--surface);
  border: 1px solid var(--tint-medium);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.skill-card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.skill-icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 2px;
}

.skill-meta {
  flex: 1;
  min-width: 0;
}

.skill-name {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.skill-cat-badge {
  font-size: 10px;
  font-weight: 600;
  background: var(--surface);
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--tint-strong);
  white-space: nowrap;
}

.skill-desc {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.62;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-footnote {
  font-size: var(--text-xs);
  line-height: 1.55;
  color: var(--text-muted);
}

.skill-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: var(--space-3);
  border-top: 1px solid var(--tint-medium);
}

.deploy-wrap {
  display: flex;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.agent-select {
  flex: 1;
  min-width: 0;
}

.installed-tag {
  font-size: 10px;
  font-weight: 700;
  color: var(--success-text);
  background: var(--surface-2);
  border: 1px solid var(--success-bg);
  padding: 3px 8px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.global-tag {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--tint-strong);
  padding: 3px 8px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.bundled-stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--radius-full);
  background: var(--surface-2);
  border: 1px solid var(--tint-medium);
  font-size: var(--text-xs);
  font-weight: 700;
}

.stat-ready { color: var(--success-text); }
.stat-needs { color: var(--warn-text); }
.stat-unsupported { color: var(--text-muted); }

.bundled-status-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.bsb-ready { background: var(--surface-2); color: var(--success-text); }
.bsb-needs-setup { background: var(--warn-bg); color: var(--warn-text); }
.bsb-unsupported-os { background: var(--surface-2); color: var(--text-muted); }

.dep-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dep-title,
.install-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.dep-bins {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dep-bin {
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.dep-ok {
  background: var(--surface-2);
  color: var(--success-text);
  border: 1px solid var(--success-bg);
}

.dep-missing {
  background: var(--warn-bg);
  color: var(--warn-text);
  border: 1px solid rgba(217,119,6,0.18);
}

.install-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.install-opts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.install-opt {
  padding: 10px 12px;
  border: 1px solid var(--tint-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.install-opt-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.install-kind-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  background: var(--surface-2);
  color: var(--text-secondary);
  padding: 2px 6px;
  border-radius: 999px;
  flex-shrink: 0;
}

.install-label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  flex: 1;
}

.copy-btn {
  font-size: 11px;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--duration-fast), color var(--duration-fast), background var(--duration-fast), transform var(--duration-fast);
  flex-shrink: 0;
}

.copy-btn:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  transform: translateY(-1px);
}

.install-cmd {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  color: #a6e3a1;
  background: #1c1917;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  word-break: break-all;
}

.installed-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.agent-group-card {
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface);
}

.agent-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.agent-group-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.agent-group-name {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.agent-group-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.agent-group-status {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-text);
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.12);
  padding: 4px 10px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.installed-skill-grid {
  gap: var(--space-3);
}

.skills-empty-state {
  padding: 64px 28px;
  background: var(--surface);
  border: 1px dashed var(--tint-stronger);
  border-radius: var(--radius-lg);
}

.empty-icon {
  font-size: 34px;
  margin-bottom: 12px;
  opacity: 0.72;
}

.empty-title {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.empty-desc {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 0 0 20px;
  line-height: 1.6;
}

.drop-zone {
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  padding: 28px 24px;
  text-align: center;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: var(--surface);
}

.drop-zone:hover,
.drop-zone.drag-over {
  border-color: var(--accent);
  background: rgba(99, 102, 241, 0.08);
}

.drop-zone.has-file {
  border-style: solid;
  border-color: rgba(34, 197, 94, 0.24);
  background: var(--surface-2);
}

.drop-icon,
.drop-file-icon {
  font-size: 24px;
}

.drop-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.drop-hint,
.drop-file-size {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.drop-file-name {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.form-hint-inline {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: 400;
}

.required-mark {
  color: var(--error-text);
}

.form-error {
  font-size: var(--text-xs);
  color: var(--error-text);
  margin: 0;
}

.form-hint {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.form-hint code {
  font-family: var(--font-mono);
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}

.alert-error {
  background: var(--error-bg);
  color: var(--error-text);
  border: 1px solid rgba(210, 63, 49, 0.18);
  border-radius: var(--radius);
  padding: 10px 12px;
  font-size: var(--text-sm);
}

.source-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.source-row + .source-row {
  margin-top: 8px;
}

.source-row-info {
  flex: 1;
  min-width: 0;
}

.source-row-name {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
}

.source-row-url {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sources-empty {
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-align: center;
  padding: var(--space-4);
}

.add-source-form {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  background: var(--surface);
}

.add-source-title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
}

.add-source-row {
  display: flex;
  gap: var(--space-2);
}

@media (max-width: 920px) {
  .skills-shell-header,
  .agent-group-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .skills-shell-actions {
    width: 100%;
  }

  .skills-shell-actions :deep(.n-button) {
    flex: 1;
  }
}

@media (max-width: 720px) {
  .skills-shell-card {
    padding: var(--space-4);
  }

  .toolbar-panel,
  .agent-group-card {
    padding: var(--space-3);
  }

  .search-wrap,
  .deploy-wrap {
    min-width: 100%;
  }

  .deploy-wrap {
    flex-direction: column;
  }

  .add-source-row {
    flex-direction: column;
  }

  .skill-grid {
    grid-template-columns: 1fr;
  }
}
</style>
