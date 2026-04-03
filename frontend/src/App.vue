<template>
  <div class="app-shell">
    <nav class="sidebar">
      <div class="sidebar-logo">
        <span class="logo-icon">🦞</span>
        <span class="logo-text">OpenClaw</span>
      </div>

      <div class="nav-section">
        <p class="nav-section-label">主要</p>
        <RouterLink to="/" class="nav-item">
          <span class="nav-icon">◻</span> 仪表盘
        </RouterLink>
        <RouterLink to="/chat" class="nav-item">
          <span class="nav-icon">💬</span> 聊天
        </RouterLink>
        <RouterLink to="/filebrowser" class="nav-item">
          <span class="nav-icon">📁</span> 文件管理
        </RouterLink>
      </div>

      <div class="nav-section">
        <p class="nav-section-label">配置</p>
        <RouterLink to="/models" class="nav-item">
          <span class="nav-icon">🤖</span> 模型配置
        </RouterLink>
        <RouterLink to="/channels" class="nav-item">
          <span class="nav-icon">📡</span> Channel
        </RouterLink>
        <RouterLink to="/plugins" class="nav-item">
          <span class="nav-icon">🧩</span> 插件
        </RouterLink>
        <RouterLink to="/skills" class="nav-item">
          <span class="nav-icon">⚡</span> 技能
        </RouterLink>
        <RouterLink to="/agents" class="nav-item">
          <span class="nav-icon">🧠</span> Agents
        </RouterLink>
      </div>
    </nav>

    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  background: var(--bg);
  overflow: hidden;
}

.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  display: flex;
  flex-direction: column;
  padding: 16px 10px;
  gap: 0;
  overflow-y: auto;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 20px;
  border-bottom: 1px solid #292524;
  margin-bottom: 12px;
}
.logo-icon { font-size: 20px; }
.logo-text {
  font-size: 16px;
  font-weight: 700;
  color: #FAFAF9;
  letter-spacing: -.2px;
}

.nav-section { margin-bottom: 20px; }
.nav-section-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--sidebar-label);
  padding: 0 10px;
  margin-bottom: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  color: var(--sidebar-text);
  text-decoration: none;
  transition: background .12s, color .12s;
}
.nav-item:hover { background: var(--sidebar-hover); color: #E7E5E4; }
.nav-item.router-link-active {
  background: var(--sidebar-active);
  color: var(--sidebar-active-text);
}
.nav-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
  min-width: 0;
}
</style>
