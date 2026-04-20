# Awesome-list PR submissions

A few curated lists accept new entries via PR. Each gives you a long-tail discovery path.

## Priority 1: alvinreal/awesome-openclaw

**Exact fit** — has `## 🎛️ Dashboards & Control Centers` section.

- Repo: <https://github.com/alvinreal/awesome-openclaw>
- PR URL: <https://github.com/alvinreal/awesome-openclaw/edit/main/README.md>

**Line to add** (alphabetical order, between `FlyTOmeLight` neighbors — check current README before PRing):

```markdown
- [FlyTOmeLight/openclaw-portal](https://github.com/FlyTOmeLight/openclaw-portal) ![GitHub Repo stars](https://img.shields.io/github/stars/FlyTOmeLight/openclaw-portal?style=social) - Self-hosted web UI for OpenClaw — dashboard, agents, channels, chat, skills, plugins in one Claude-inspired Vue 3 + Fastify portal. Bilingual (EN/zh-CN), Docker-ready, MIT.
```

**PR title:** `Add FlyTOmeLight/openclaw-portal to Dashboards & Control Centers`

**PR body:**
```
Hi! Adding my Vue 3 + Fastify self-hosted portal for OpenClaw.

- Dashboard / agents / channels / chat / skills / plugins / MCP / cron / memory / logs / audit / usage
- Loopback-only trust boundary (nginx proxy header auth, no shared cookie secrets)
- Docker-ready, bilingual README (EN + 简体中文), MIT licensed
- CI green, 5 `good first issue` seeded for contributors

Repo: https://github.com/FlyTOmeLight/openclaw-portal

Thanks for maintaining this list!
```

## Priority 2: SamurAIGPT/awesome-openclaw

- Repo: <https://github.com/SamurAIGPT/awesome-openclaw>
- Check for a "Dashboards" or "Admin UI" section; if missing, add entry under "Tools" or "Integrations"

## Priority 3: rohitg00/awesome-openclaw

- Repo: <https://github.com/rohitg00/awesome-openclaw>
- Lighter maintenance but still worth a PR

## Lower priority (not strictly OpenClaw but adjacent)

- `awesome-selfhosted` (<https://github.com/awesome-selfhosted/awesome-selfhosted>) — only if the portal works standalone. Currently requires OpenClaw gateway, so **skip** until we add mock/demo mode.
- `awesome-vue` (<https://github.com/vuejs/awesome-vue>) — add under "Applications" or "Admin Templates"
- `awesome-typescript` — might accept
- `awesome-fastify` (<https://github.com/fastify/fastify/blob/main/docs/Guides/Ecosystem.md>) — official ecosystem list, PR against Fastify main repo

## PR tips that actually matter

1. **Check CONTRIBUTING.md** before opening the PR — many lists require alphabetical order, star badge, specific description length
2. **Don't bundle multiple entries** — one PR per addition is easier to merge
3. **Reply within 24h** to any maintainer comments — they stop caring fast
4. **Don't be salesy** — "my project" is fine, "revolutionary" gets you closed
5. **Add entries for the right section** — "Dashboards" not "Plugins", "Deployment" not "Tutorials"

## Execution order (spread over 2 weeks)

- Week 1, day 1: PR to `alvinreal/awesome-openclaw` (highest fit)
- Week 1, day 3: PR to `SamurAIGPT/awesome-openclaw` + `rohitg00/awesome-openclaw`
- Week 2, day 1: PR to `awesome-vue` (under Admin Templates section)
- Week 2, day 3: check PR statuses, respond to reviews

**Don't PR all on day 1** — looks spammy if you're doing a coordinated launch push; better to stagger.
