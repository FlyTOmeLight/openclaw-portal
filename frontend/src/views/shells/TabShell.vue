<template>
  <div class="tab-shell">
    <div class="shell-header">
      <div>
        <h1 class="page-title">{{ title }}</h1>
        <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      </div>
      <div class="shell-tabs">
        <RouterLink
          v-for="t in tabs"
          :key="t.path"
          :to="t.path"
          class="shell-tab"
          active-class="active"
        >
          <span v-if="t.icon" class="shell-tab-icon">{{ t.icon }}</span>
          <span>{{ t.label }}</span>
        </RouterLink>
      </div>
    </div>
    <div class="shell-body">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
  tabs: Array<{ path: string; label: string; icon?: string }>
}>()
</script>

<style scoped>
.tab-shell {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  height: 100%;
  min-height: 0;
}
.shell-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}
.shell-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
}
.shell-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
}
.shell-tab:hover { color: var(--text-primary); background: var(--ghost-hover-bg); }
.shell-tab.active {
  background: var(--surface);
  color: var(--accent-text);
  box-shadow: var(--shadow-sm);
}
.shell-tab-icon { font-size: 12px; }
.shell-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
/* Suppress duplicate page-level headers from embedded views */
.shell-body :deep(.page-header) {
  margin-bottom: var(--space-4);
  padding-bottom: 0;
  border-bottom: none;
}
.shell-body :deep(.page-title) {
  font-size: var(--text-md);
  font-weight: 600;
}
.shell-body :deep(.subtitle) {
  font-size: var(--text-sm);
}
</style>
