<template>
  <div class="layout">
    <nav class="sidebar">
      <div class="logo">🦞 OpenClaw</div>
      <RouterLink to="/">仪表盘</RouterLink>
      <RouterLink to="/models">模型配置</RouterLink>
      <RouterLink to="/skills">技能管理</RouterLink>
      <RouterLink to="/plugins">插件管理</RouterLink>
      <RouterLink to="/agents">Agent 概览</RouterLink>
    </nav>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100vh; font-family: system-ui, sans-serif; }
.sidebar {
  width: 200px; background: #1a1a2e; color: #eee; padding: 24px 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.logo { font-size: 18px; font-weight: bold; margin-bottom: 24px; }
.sidebar a { color: #aaa; text-decoration: none; padding: 8px 12px; border-radius: 6px; }
.sidebar a.router-link-active { background: #16213e; color: #fff; }
.content { flex: 1; overflow-y: auto; padding: 32px; background: #f5f5f5; }
</style>
