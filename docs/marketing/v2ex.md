# V2EX 分享发现 - 发帖模板

## 标题

**[分享创造] 给 OpenClaw 做了一个自服务管理界面，开源了（Vue 3 + Fastify · MIT）**

## 节点

`分享创造` 主节点。可考虑同时交叉发到：
- `程序员`
- `开源软件`
- `前端开发`（因为 UI 栈）

## 正文

```markdown
自己在用 [OpenClaw](https://openclaw.ai) 作为本地 AI agent runtime，跑得挺好，但每次改配置、绑定渠道、装技能都要回到命令行。对我还好，对公司里的运营/产品就是劝退。

花了一段时间做了个 Web 管理界面，今天开源了 —— **OpenClaw Portal**：

**仓库**：https://github.com/FlyTOmeLight/openclaw-portal

### 做了什么

- **Dashboard**：gateway 状态、系统指标、模型 / 渠道数量、最近日志
- **Agent 控制台**：CRUD、每个 agent 独立模型 / thinking / 工具 / 子 agent、会话回放
- **内置对话**：走 gateway WebSocket RPC 流式输出，支持文本/文件/图片
- **渠道管理**：钉钉、飞书、QQ、微信、Lansenger 等国内 IM 一键绑定
- **技能 / 插件 / MCP / memory / cron**：装卸启停一条龙
- **运维工具**：日志、终端、文件浏览、拓扑图、诊断、审计、token 用量

### 技术栈

- 前端 Vue 3 + Vite + TypeScript + Naive UI + Pinia
- 后端 Fastify 5 + TypeScript
- 中英双语 README、MIT License
- Docker / docker-compose 一键起、GitHub Actions CI

### 安全

保留 OpenClaw 的 loopback 信任边界：只绑定 127.0.0.1、`onRequest` 白名单、透传 nginx 的 `X-Forwarded-User`。cookie 里不存共享密钥，没有 token 泄露路径。

### 截图

（贴 3~6 张：Dashboard / Chat / Agents / Channels / Skills / Plugins）

---

欢迎试用 / 提 issue / 加星星。有 5 个 `good first issue` 已经写好了，想练 Vue 3 / Fastify 的同学可以来玩。

（如果有建议我把哪些功能抽出来做单独的组件开源，也欢迎拍砖）
```

## 发帖时机

- 周二到周四 **上午 10–11 点** 或 **下午 14–16 点**（V2EX 主力用户上班时间）
- 避免周一早上（被周会信息淹没）、周五下午（大家划水但不看技术帖）
- 避免晚上 21 点后（夜猫子少，沉得快）

## 后续互动

- 首小时回复每条评论，哪怕是 "+1" 都回一句 "谢谢，欢迎用"
- 如果被喷"又一个管理面板"，不要怼回去，列出差异化（trust boundary、内置国内 IM、双语）
- 24 小时后看数据：回复 > 点击 > 收藏 是健康信号；只有点击没回复说明标题党了，文案需要改
