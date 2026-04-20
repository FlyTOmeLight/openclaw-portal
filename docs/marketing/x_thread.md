# X / Twitter 发布 thread

## Tweet 1 (hook + GIF)

```
I open-sourced a self-hosted web UI for AI agents.

Vue 3 + Fastify. MIT.

Sits in front of @openclaw and exposes:
— agent CRUD
— streaming chat
— 11 IM channel bindings (DingTalk, Lark, QQ, WeChat...)
— skill/plugin install
— terminal + file browser
— logs + audit

🔗 github.com/FlyTOmeLight/openclaw-portal
```

📎 Attach: `docs/screenshots/demo.gif` (once recorded) or `docs/screenshots/dashboard.png` for now.

## Tweet 2

```
Why build it?

OpenClaw is great for devs. For ops/PM teams, "SSH in and edit YAML" is a non-starter.

Portal turns every config surface into a Claude-inspired UI so non-engineers can operate agents safely.
```

## Tweet 3

```
Architecture:

nginx (TLS, 8080)
  ↓
  ├── openclaw gateway (:18789)
  └── portal backend (Fastify, :18800)
        ↓ loopback RPC + X-Forwarded-User
        openclaw gateway

Trust boundary stays intact. No cookie secrets. No token leakage.
```

📎 Attach: screenshot of the mermaid architecture diagram from README.

## Tweet 4

```
What's in the box:

✅ Docker / docker-compose
✅ CI (GitHub Actions)
✅ Bilingual README (EN + zh-CN)
✅ 5 `good first issue` tagged
✅ Contributing guide + CoC
✅ Every route has a keyboard shortcut (⌘K)
```

## Tweet 5 (CTA)

```
If you run OpenClaw — give it a try, break it, PR fixes.

🌟 Star: github.com/FlyTOmeLight/openclaw-portal
📝 Roadmap: i18n, OAuth/SSO, /metrics, dark-mode polish
🗨️ Discussions are open.

RTs appreciated — this is my first big OSS release.
```

## Tagging strategy

First tweet: tag sparingly — only projects/maintainers directly relevant.
- `@openclaw` (upstream)
- `@vuejs`
- `@fastifyjs`

**Don't** tag influencers / random tech accounts — looks desperate and often ignored.

## Timing

- **Best:** Tuesday or Wednesday, 09:00–10:00 US Eastern OR 15:00 UTC (catches US morning + EU afternoon)
- **Chinese audience alternative:** 20:00 Beijing time (post Chinese version to 即刻 / 小红书 at same time)

## Cross-post

- **即刻**: shorter version of tweet 1 + 4, link in comment
- **LinkedIn**: longer professional write-up (500 words), title "Building a self-service UI for self-hosted AI agents"
- **Mastodon fosstodon.org**: same as Twitter thread, tag `#opensource #vuejs #aiagent #selfhosted`
- **Bluesky**: same as Twitter
