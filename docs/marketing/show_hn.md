# Show HN — post copy

## Title (choose one)

1. `Show HN: OpenClaw Portal – self-hosted management UI for AI agents (MIT, Vue+Fastify)`
2. `Show HN: A Claude-inspired web UI for self-hosted AI agents`
3. `Show HN: Open-source portal for OpenClaw – manage agents, channels, skills in browser`

**Recommended:** #1 (mentions differentiators: self-hosted + MIT + stack).

## URL

`https://github.com/FlyTOmeLight/openclaw-portal`

## Text (optional first comment — post immediately after submission)

> Author here. Built this because running OpenClaw (self-hosted AI agent runtime) was great but every config change, channel bind, or skill install meant dropping back to a terminal. Not a blocker for devs, a non-starter for ops teams.
>
> OpenClaw Portal is a Vue 3 + Fastify web UI that sits in front of the gateway. It keeps the gateway's loopback-only trust boundary intact (all traffic goes through nginx with a trusted-proxy header — no shared secrets in cookies) and exposes dashboard, agent CRUD, streaming chat, channel bind for 11 IM platforms, skill/plugin install, logs, terminal, file browser, topology graph, audit trail.
>
> Stack: Vue 3, Vite, Pinia, Naive UI, Fastify 5, TypeScript. Ships with Dockerfile + docker-compose for one-command deploy.
>
> Specific design choices I'm happy to debate:
> - Gateway RPC over WebSocket (not HTTP) because the portal needs to stream tokens from chat and tail logs
> - Per-agent model/tools config (not global) because different agents need different capabilities
> - Three-layer trust boundary (loopback + allowlist + proxy header) because reverse-shell via cookie leak is the #1 thing I wanted to avoid
>
> Happy to answer questions, and PRs / `good first issue` candidates are tagged.

## Timing

- **Best:** Tuesday/Wednesday 08:00–10:00 PT
- **Avoid:** Friday evening PT, weekends (lower traffic)
- **Watch:** Refresh `/newest` in another tab to make sure your post shows up; some shadow-banning happens silently

## After submission

- Reply to every top-level comment within the first 2 hours
- Don't upvote your own post (HN detects it)
- Don't ask friends to upvote (flagging almost certain)
- If it hits front page → pin a comment with updates/FAQ
