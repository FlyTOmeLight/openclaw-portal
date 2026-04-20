<div align="center">

# OpenClaw Portal

**Self-service management portal for [OpenClaw](https://openclaw.ai) — Vue 3 + Fastify.**

Dashboard, agents, channels, skills, plugins, chat and ops in one Claude-inspired UI.

[![CI](https://github.com/FlyTOmeLight/openclaw-portal/actions/workflows/ci.yml/badge.svg)](https://github.com/FlyTOmeLight/openclaw-portal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/FlyTOmeLight/openclaw-portal?include_prereleases)](https://github.com/FlyTOmeLight/openclaw-portal/releases)
[![Stars](https://img.shields.io/github/stars/FlyTOmeLight/openclaw-portal?style=social)](https://github.com/FlyTOmeLight/openclaw-portal/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/FlyTOmeLight/openclaw-portal)](https://github.com/FlyTOmeLight/openclaw-portal/commits/main)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883.svg)](https://vuejs.org)
[![Fastify](https://img.shields.io/badge/Fastify-5-black.svg)](https://fastify.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org)

English · [简体中文](./README.zh-CN.md)

<img src="./docs/screenshots/dashboard.png" alt="OpenClaw Portal Dashboard" width="880" />

</div>

---

## What is this?

OpenClaw Portal is a web UI that sits in front of an OpenClaw gateway and exposes everything a non-terminal operator needs:

- A **dashboard** with live gateway status, system stats, model & channel counts
- An **agent console** for creating, configuring, and running AI agents (model / thinking mode / tools / subagents)
- A **built-in chat** that streams replies, files, images, and text through the gateway WebSocket RPC
- **Channel management** (DingTalk, Feishu/Lark, QQ, WeChat, Lansenger, …) — bind, test, rotate credentials
- **Skills / plugins / MCP / memory / cron** — install, enable, inspect
- **Ops tooling** — logs, terminal, file browser, topology graph, diagnosis, audit, usage metering

Everything runs behind a loopback-only trust boundary: nginx terminates TLS, portal backend talks to the gateway using trusted-proxy headers. No shared secrets in cookies, no token leakage.

## Features

| Area | Views | What you can do |
|---|---|---|
| **Overview** | Dashboard, Monitor, Topology, Diagnosis | See gateway health, model/channel counts, system load, live call graph, run doctor checks |
| **Agents** | Agents, AgentDetail, Sessions, Chat | CRUD agents, per-agent model & thinking mode, tools / subagents config, session replay, streaming chat |
| **Models** | ModelWizard | Add providers (Anthropic / OpenAI / DashScope / Gemini / Ollama…), test, set primary/fallback |
| **Channels** | Channels | Bind IM channels, set webhook / credentials, send test messages, rotate secrets |
| **Extensions** | Skills, Plugins, MCP, Memory, Cron | Install / enable / inspect, upload .skill packs, browse installed skill docs |
| **Ops** | Gateway, Logs, Terminal, FileBrowser, Audit, Activity, Usage, Settings | Start/stop/restart gateway, tail logs, pop a shell, browse workspace, audit trail, cost report |

## Architecture

```mermaid
flowchart LR
  user([Operator]) -->|HTTPS 8080| nginx
  nginx -->|/| gateway[OpenClaw Gateway<br/>:18789]
  nginx -->|/portal/| portal_be[Portal Backend<br/>Fastify :18800]
  portal_be -->|X-Forwarded-User: admin<br/>loopback RPC| gateway
  portal_fe[Portal Frontend<br/>Vue 3 + Vite] -.build.-> nginx
  gateway --> plugins[(Plugins / Channels)]
  gateway --> skills[(Skills)]
  gateway --> sessions[(Sessions)]
```

- **Trust boundary**: portal backend binds loopback only, applies an `onRequest` allowlist guard, and forwards `X-Forwarded-User` from nginx. All three layers must remain intact.
- **Gateway comms**: RPC responses land under `payload` (not `result`); chat goes through the gateway WebSocket, not the model provider directly.
- **Agent scoping**: model / thinking / tools / subagents are stored per-agent under `agents.list[].*`, never via global overrides.

## Screenshots

> Replace these with your own captures — paths are `docs/screenshots/*.png`.

| Dashboard | Channels | Chat |
|:--:|:--:|:--:|
| ![Dashboard](./docs/screenshots/dashboard.png) | ![Channels](./docs/screenshots/channels.png) | ![Chat](./docs/screenshots/chat.png) |

| Agents | Skills | Plugins |
|:--:|:--:|:--:|
| ![Agents](./docs/screenshots/agents.png) | ![Skills](./docs/screenshots/skills.png) | ![Plugins](./docs/screenshots/plugins.png) |

## Quickstart

### Prerequisites

- Node.js 22 or newer (or Docker 24+)
- A running OpenClaw gateway on `127.0.0.1:18789` (see [openclaw.ai](https://openclaw.ai))

### 🐳 Docker (easiest)

```bash
git clone https://github.com/FlyTOmeLight/openclaw-portal.git
cd openclaw-portal
docker compose up -d
```

Open <http://localhost:18800>. The container uses `network_mode: host` so it can reach the gateway on loopback.

### 🧑‍💻 Local dev (hot reload)

```bash
git clone https://github.com/FlyTOmeLight/openclaw-portal.git
cd openclaw-portal
make install   # install backend + frontend deps
make dev       # start both in dev mode with hot reload
```

Open <http://localhost:3000>. Backend listens on `127.0.0.1:18800` and proxies to the gateway.

### Production build (no Docker)

```bash
make build     # typecheck + bundle
make start     # serve built backend + static frontend
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORTAL_PORT` | `18800` | Portal backend listen port |
| `GATEWAY_PORT` | `18789` | OpenClaw gateway port the portal talks to |
| `GATEWAY_HOST` | `127.0.0.1` | Must stay on loopback in production |
| `TRUSTED_PROXY_USER` | `admin` | Username to forward to the gateway via `X-Forwarded-User` |

The portal expects a reverse proxy (nginx) in front of it handling TLS and forwarding the user header. Do **not** expose port 18800 directly on a public interface.

## Development

```
portal/
├── backend/           # Fastify + TypeScript
│   ├── src/
│   │   ├── routes/    # agents, channels, chat, models, plugins, skills, system, …
│   │   └── services/  # channel-manager, config-manager, plugin-manager, process-manager, …
│   └── test/          # vitest
├── frontend/          # Vue 3 + Vite + TypeScript
│   └── src/
│       ├── views/     # Dashboard, Channels, Chat, Agents, Skills, Plugins, ModelWizard, …
│       ├── stores/    # Pinia stores
│       └── api/       # typed API client
├── Makefile
└── docs/
```

Backend tests: `cd backend && npm test`.

## Contributing

Issues, PRs, and design feedback are all welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Start with the [`good first issue`](https://github.com/FlyTOmeLight/openclaw-portal/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) list if you want a low-context entry point. Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

Architecture rules (enforced in reviews):

1. Keep the trust boundary intact (loopback bind + `onRequest` allowlist + `X-Forwarded-User`).
2. Gateway RPC responses use the `payload` field, not `result`.
3. Agent-scoped settings live under `agents.list[].*`, never via global overrides.

## Roadmap

- [ ] i18n: English / 简体中文 UI toggle (currently zh-CN only)
- [ ] OAuth / SSO login in addition to trusted-proxy header
- [ ] Prometheus `/metrics` endpoint
- [ ] Real-time push notifications for channel events
- [ ] Dark-mode polish pass across all views

Have an idea? Open a [Discussion](https://github.com/FlyTOmeLight/openclaw-portal/discussions/new?category=ideas).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=FlyTOmeLight/openclaw-portal&type=Date)](https://star-history.com/#FlyTOmeLight/openclaw-portal&Date)

## License

[MIT](./LICENSE) © 2026 FlyTOmeLight
