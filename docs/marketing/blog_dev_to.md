# Dev.to / Hashnode blog post

## Title options

1. "I built a self-hosted web UI for AI agents so my team could stop living in the terminal"
2. "Building OpenClaw Portal: Vue 3 + Fastify + a trust boundary that actually holds"
3. "Open-sourcing a Claude-inspired admin panel for self-hosted AI agents"

**Recommended:** #1 — narrative-first titles perform better on Dev.to

## Tags

`opensource, vue, typescript, ai`

## Cover image

Use `docs/social/social-preview.png` (the 1280×640 image we already generated).

---

## Body

```markdown
If you've ever watched a non-engineer try to bind a Feishu bot via YAML, you know exactly why I built this.

A few months ago I started running [OpenClaw](https://openclaw.ai) — a self-hosted AI agent runtime — as a lobster-themed replacement for cloud assistants. Local-first, private, works with 20+ messaging platforms. Great for me. A cliff for everyone else on my team.

Every config change, channel bind, skill install, log tail required dropping back into a terminal. That's fine for devs. For ops, PM, and design? "Please SSH in and edit `openclaw.json`" is where the conversation ends.

So I built **OpenClaw Portal**: a Vue 3 + Fastify web UI that sits in front of the gateway and exposes every operator surface as a point-and-click interface.

Today I'm open-sourcing it under MIT: **https://github.com/FlyTOmeLight/openclaw-portal**

## Screenshots

![Dashboard](./docs/screenshots/dashboard.png)

![Channels](./docs/screenshots/channels.png)

![Chat streaming](./docs/screenshots/chat.png)

## What's in it

| Area | What you get |
|---|---|
| Dashboard | Gateway health, system stats, model/channel counts, token trends, recent logs |
| Agents | CRUD, per-agent model / thinking mode / tools / subagents, session replay |
| Chat | Streaming replies via WebSocket RPC, file/image attachments |
| Channels | Bind DingTalk, Feishu/Lark, QQ, WeChat, Lansenger and 6 more — rotate creds, test webhooks |
| Skills / Plugins | Browse ClawHub registry, install to global lib or specific agent, upload .skill packs |
| MCP / Memory / Cron | External capability integration, scheduled tasks, global memory |
| Ops | Logs, terminal, file browser, topology graph, diagnosis, audit trail, token usage metering |

## Stack

- **Frontend:** Vue 3 + Vite + TypeScript + Pinia + Naive UI
- **Backend:** Fastify 5 + TypeScript (ESM)
- **Tooling:** Docker, docker-compose, GitHub Actions CI
- **Docs:** Bilingual (English + 简体中文), Mermaid architecture diagrams

## Three design decisions I'm happy to defend

### 1. All agent chat goes through the gateway WebSocket, never direct to the model provider

Portal backend proxies via `gateway.chat.stream` RPC. Model choice, tool use, subagent dispatch — all decided by the gateway. Portal is a thin UI layer, which means:

- You can swap model providers without touching the UI
- The gateway is the single auth/audit/trust boundary
- Chat streams tokens end-to-end (user → portal → gateway → model → back)

### 2. Per-agent settings, not global

Model, thinking mode, tools, subagents all live under `agents.list[].*`. No `setPrimaryModel` fallback that crosses agent boundaries. This maps 1:1 to how OpenClaw stores config and avoids a whole class of "works for main agent but not mathmaster" bugs.

### 3. Three-layer trust boundary

```
nginx (TLS, 8080)
  ├── / → openclaw gateway (:18789)
  └── /portal/ → portal backend (:18800)
        ↓ X-Forwarded-User: admin
        gateway RPC on loopback
```

Portal backend:

- Binds `127.0.0.1` only (not `0.0.0.0`) — firewall + cloud SG can't save you if you misconfigure
- Has an `onRequest` allowlist guard — even if you accidentally add a route, it won't be reachable externally
- Forwards `X-Forwarded-User` from nginx — no shared secrets in cookies, no token leakage across requests

All three layers have to be intact. Break any one and you've re-invented the attack surface.

## Try it

```bash
git clone https://github.com/FlyTOmeLight/openclaw-portal.git
cd openclaw-portal
docker compose up -d
```

Open http://localhost:18800. You'll need a running OpenClaw gateway on 127.0.0.1:18789.

## Where to help

I tagged 5 `good first issue`s at the launch: demo GIF, English UI toggle (i18n), test coverage badge, dark-mode polish, `/metrics` endpoint. If you've been looking for a Vue 3 or Fastify project to contribute to, it's a pretty gentle entry.

⭐ **Star: https://github.com/FlyTOmeLight/openclaw-portal**
🗨️ **Discussions: https://github.com/FlyTOmeLight/openclaw-portal/discussions**

Roast the code. Break the trust boundary. Send PRs. Let me know what you think.
```

## Cross-post targets

- **Dev.to** (canonical here, SEO main body)
- **Hashnode** (set canonical URL pointing back to Dev.to)
- **Medium** (same — canonical)
- **freeCodeCamp News** (requires pitch)

Do NOT cross-post to Dev.to + Medium + Hashnode simultaneously without setting canonical — Google penalizes duplicate content.
