<template>
  <div class="layout">
    <nav class="sidebar">
      <div class="logo">🦞 OpenClaw</div>
      <div class="nav-group">
        <div class="nav-label">主要</div>
        <RouterLink to="/">仪表盘</RouterLink>
        <RouterLink to="/chat">聊天</RouterLink>
        <RouterLink to="/filebrowser">文件管理</RouterLink>
      </div>
      <div class="nav-group">
        <div class="nav-label">配置</div>
        <RouterLink to="/models">模型配置</RouterLink>
        <RouterLink to="/channels">Channel 管理</RouterLink>
        <RouterLink to="/plugins">插件管理</RouterLink>
        <RouterLink to="/skills">技能管理</RouterLink>
        <RouterLink to="/agents">Agent 概览</RouterLink>
      </div>
    </nav>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100vh; font-family: system-ui, sans-serif; }
.sidebar {
  width: 210px; background: #1a1a2e; color: #eee; padding: 20px 14px;
  display: flex; flex-direction: column; gap: 0; overflow-y: auto; flex-shrink: 0;
}
.logo { font-size: 17px; font-weight: bold; margin-bottom: 20px; padding: 0 4px; }
.nav-group { margin-bottom: 16px; }
.nav-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #555; padding: 0 12px; margin-bottom: 4px; }
.sidebar a { display: block; color: #aaa; text-decoration: none; padding: 7px 12px; border-radius: 6px; font-size: 14px; }
.sidebar a.router-link-active { background: #16213e; color: #fff; }
.sidebar a:hover:not(.router-link-active) { background: #0f0f23; color: #ddd; }
.content { flex: 1; overflow-y: auto; padding: 32px; background: #f5f5f5; min-width: 0; }
</style>
