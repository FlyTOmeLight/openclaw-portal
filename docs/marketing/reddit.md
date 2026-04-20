# Reddit launch posts

## r/selfhosted

**Title:** `I built a self-hosted web UI for AI agents (OpenClaw Portal, Vue 3 + Fastify, MIT)`

**Flair:** `Release`

**Body:**
```
Hey r/selfhosted,

I run [OpenClaw](https://openclaw.ai) as my local-first AI agent runtime (it replaces cloud assistants, works with 20+ messaging platforms). Great tool, but configuring it meant living in a terminal — a cliff for anyone else on my team.

So I built OpenClaw Portal: a Vue 3 + Fastify web UI that sits in front of the gateway.

**Repo:** https://github.com/FlyTOmeLight/openclaw-portal

What's in it:

- Dashboard (gateway health, system stats, token trends)
- Agent CRUD with per-agent model / thinking mode / tools / subagents
- Streaming chat via gateway WebSocket RPC
- 11 IM channel bindings (DingTalk, Lark/Feishu, QQ, WeChat, Lansenger, etc.)
- Skill / plugin / MCP / memory / cron management
- Logs, terminal, file browser, topology graph, audit trail, token usage

Self-hosted specifics you care about:

- Docker + docker-compose, one command to start
- Loopback-only trust boundary — portal binds 127.0.0.1, nginx forwards `X-Forwarded-User`. No shared cookie secrets
- Bilingual docs (EN + zh-CN), MIT
- GitHub Actions CI

Roadmap includes OAuth/SSO, Prometheus `/metrics`, i18n UI toggle, and dark-mode polish.

Happy to answer questions about the trust boundary or the stack. Feedback and PRs welcome!
```

📎 Screenshots: upload dashboard + chat + channels.

## r/LocalLLaMA

**Title:** `Open-source web UI for managing self-hosted AI agents (OpenClaw Portal)`

**Flair:** `Resources`

**Body:** Same as r/selfhosted but emphasize the model-agnostic side:
```
[...opening same as above...]

**Why LocalLLaMA readers might care:**

OpenClaw routes chat to any configured model provider — Ollama, vLLM, llama.cpp server, LM Studio, Anthropic, OpenAI, DashScope, Gemini, etc. The portal is a thin UI layer on top, so if you're running a local model and want a "real" agent loop (tool use, subagents, channel integration) without writing frontend code, this should drop right in.

[...continue with features + links...]
```

## r/opensource

**Title:** `[MIT] Self-hosted portal for managing AI agents — Vue 3 + Fastify`

Mostly just a short announcement. r/opensource is low-engagement but gets indexed.

## r/sideproject

**Title:** `Show me a cooler admin panel for self-hosted AI agents — I'll wait`

More playful tone for this sub. Include a punchy GIF.

## r/programming

**Title:** `Open-sourced a Vue 3 + Fastify portal for self-hosted AI agents (building a web UI with a three-layer trust boundary)`

Focus on the **architecture / engineering choices** (trust boundary, per-agent config, WebSocket RPC) — r/programming eats this up; don't lead with features.

## Timing + etiquette

- **Best post time:** Monday–Thursday, 09:00–11:00 US Eastern
- **Worst:** Friday evening, Sunday
- **Don't post to >3 subs in one day** — triggers site-wide shadow rules
- **Stagger:** r/selfhosted Monday, r/LocalLLaMA Tuesday, r/programming Wednesday
- **Respond to every comment within 2 hours** for the first day — engagement boosts your post in the algorithm
- **Don't cross-post copy/paste** — slight rewrites per sub show respect for the audience
- **Never ask for upvotes** — Reddit hates it
