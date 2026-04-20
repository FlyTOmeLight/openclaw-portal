# 掘金 / 公众号 / CSDN 中文发布稿

## 标题备选

1. **为 OpenClaw 做了一个自服务管理界面（Vue 3 + Fastify · MIT 开源）**
2. 让团队不再"SSH 进去改 YAML"—— 开源一个本地 AI Agent 管理面板
3. 给私有部署的 AI 助手做了个 Claude 风格的管理 UI

推荐 #2 —— 痛点驱动的标题在掘金 / 公众号点击率更高。

## 摘要 (公众号 guide abstract，150 字内)

> 自托管 AI agent runtime OpenClaw 跑得好好的，但每次改配置都要回命令行 —— 对运营、PM、设计同学就是劝退。于是做了一个 Vue 3 + Fastify 的 Web 管理面板，保留 OpenClaw 的 loopback 信任边界，把 Agent / 渠道 / 技能 / 插件 / 日志 / 审计全部点鼠标搞定。今天 MIT 开源，欢迎试用。

## 正文

```markdown
## 起因：命令行是天花板

如果你在用 [OpenClaw](https://openclaw.ai)（本地 AI agent runtime）而且团队里不止你一个人，你大概也撞过这堵墙。

开发想调模型 —— `openclaw config set agent.main.model ...`，舒服。
产品想绑一个飞书机器人 —— "请问怎么把这个 JSON 发给我？"
设计想看昨天的对话 —— "你先 SSH 到 10.99.xxx，然后 `tail -f /tmp/openclaw/*.log`"，对方已经走了。

**命令行是开发者的舒适区，是所有人的天花板。**

前段时间我花了点时间把这层天花板捅穿了，做了个 Web 管理面板，今天把它 MIT 开源：

> 🔗 https://github.com/FlyTOmeLight/openclaw-portal

一句话介绍：**OpenClaw Portal · Vue 3 + Fastify 的 Claude 风格自服务管理 UI**。

## 长啥样

![Dashboard](./docs/screenshots/dashboard.png)

![渠道管理](./docs/screenshots/channels.png)

![Agent 舰队](./docs/screenshots/agents.png)

![内置对话](./docs/screenshots/chat.png)

## 能做什么

| 模块 | 页面 | 能力 |
|---|---|---|
| **概览** | Dashboard / Monitor / Topology | gateway 健康、系统指标、调用图、一键 doctor |
| **Agent** | Agents / AgentDetail / Sessions | Agent CRUD、每个独立模型 / thinking / 工具 / 子 agent、会话回放 |
| **对话** | Chat | gateway WebSocket RPC 流式输出，文件 / 图片附件 |
| **渠道** | Channels | 钉钉 / 飞书 / QQ / 微信 / Lansenger 等 11 个平台绑定、测试、轮换 |
| **扩展** | Skills / Plugins / MCP / Memory / Cron | 装卸启停一条龙 |
| **运维** | Logs / Terminal / FileBrowser / Audit / Usage | 日志、终端、文件、审计轨迹、token 计量 |

## 技术栈

- 前端：Vue 3 + Vite + TypeScript + Pinia + Naive UI
- 后端：Fastify 5 + TypeScript (ESM)
- 工具：Docker / docker-compose、GitHub Actions CI
- 文档：中英双语、Mermaid 架构图

## 三个刻意的设计决策

### 1. 所有对话走 gateway WebSocket，不直连模型厂商

Portal 后端通过 `gateway.chat.stream` 这个 RPC 代理。模型选择、工具调用、子 agent 派发全由 gateway 决定，Portal 是薄 UI 层。好处：

- 换模型厂商不用改 UI
- gateway 作为唯一的 auth / audit / 信任边界
- 对话 token 端到端流式（用户 → portal → gateway → 模型 → 返回）

### 2. 配置 per-agent，不走全局

模型、thinking 模式、工具、子 agent 都存在 `agents.list[].*` 下。没有那种 "设置主 agent 的默认模型再让别人继承" 的回退链路。和 OpenClaw 本身的存储 1:1 对应，避免 "main 能跑 mathmaster 跑不了" 的疑难杂症。

### 3. 信任边界三层守卫

```
nginx (TLS, 8080)
  ├── / → openclaw gateway (:18789)
  └── /portal/ → portal 后端 (:18800)
        ↓ X-Forwarded-User: admin
        gateway RPC 走 loopback
```

Portal 后端：

- 只绑 `127.0.0.1`，不绑 `0.0.0.0` —— 就算配错防火墙 / 安全组也救不了公网暴露
- `onRequest` 白名单守卫 —— 就算不小心加了路由，外部也调不通
- 透传 nginx 的 `X-Forwarded-User` —— cookie 里不存共享密钥，没有 token 在请求间泄露的路径

三层缺一不可。拆掉任何一层都等于把攻击面重新造出来一遍。

## 怎么跑

Docker 方式（推荐）：

```bash
git clone https://github.com/FlyTOmeLight/openclaw-portal.git
cd openclaw-portal
docker compose up -d
```

打开 http://localhost:18800，前提是有个 OpenClaw gateway 跑在 127.0.0.1:18789。

本地开发：

```bash
make install
make dev
```

## 欢迎共建

发布时已经标了 5 个 `good first issue`：Demo GIF 录制、英文 UI 切换 (i18n)、测试覆盖率徽章、深色模式优化、`/metrics` 接口。想练 Vue 3 / Fastify 的同学可以拿去玩。

> ⭐ Star： https://github.com/FlyTOmeLight/openclaw-portal
> 🗨️ 讨论区： https://github.com/FlyTOmeLight/openclaw-portal/discussions
> 📝 Roadmap：i18n、OAuth/SSO、Prometheus、深色模式

欢迎体验 / 提 issue / 喷代码 / 发 PR。如果有想单独抽出来开源的组件，也欢迎留言指路。
```

## 平台差异提示

### 掘金
- 选择分区：**前端 + 后端 + 开源**（多标签提升曝光）
- 标签：`Vue.js`、`TypeScript`、`Fastify`、`开源`、`AI`
- 首图 / 封面：用 `docs/social/social-preview.png`

### 微信公众号
- 推荐改为图文，**把代码块截成代码图片**（公众号代码块复制体验差，图片扫码更直观）
- 标题建议 "实战" 开头："实战：为本地 AI 助手做一个 Web 管理面板（Vue 3 + Fastify 开源）"
- 在公众号菜单加 "开源项目 → OpenClaw Portal" 入口

### CSDN
- 可以直接转载，标题党可以再重一点："OpenClaw 官方没有的 Web 管理面板，我给补上了！（开源）"
- 勾 "原创" 认领，否则算转载降权

### 小红书（小红书对技术内容意外友好）
- 用竖版截图（手机看更好），标题 "给 AI 助手做了个后台，老板看了直呼内行 👀"
- hashtag：`#开源 #程序员 #前端 #AI #Vue`
