# Marketing / Launch Copy

Ready-to-paste launch copy for each channel. Stagger submissions — don't fire them all in one day.

## Recommended 7-day launch sequence

| Day | Channel | File |
|---|---|---|
| Monday | Hacker News (`Show HN`) | [`show_hn.md`](./show_hn.md) |
| Monday | r/selfhosted | [`reddit.md`](./reddit.md#rselfhosted) |
| Tuesday | V2EX 分享创造 | [`v2ex.md`](./v2ex.md) |
| Tuesday | r/LocalLLaMA | [`reddit.md`](./reddit.md#rlocalllama) |
| Wednesday | X / Twitter thread | [`x_thread.md`](./x_thread.md) |
| Wednesday | Dev.to (canonical) | [`blog_dev_to.md`](./blog_dev_to.md) |
| Thursday | 掘金 + 公众号 + 小红书 | [`juejin_wechat.md`](./juejin_wechat.md) |
| Thursday | r/programming | [`reddit.md`](./reddit.md#rprogramming) |
| Friday | Awesome-list PRs (start) | [`awesome_list_prs.md`](./awesome_list_prs.md) |

## Principles

1. **Don't launch everywhere day 1.** Staggering gives you bandwidth to respond to comments + a week of fresh activity signal.
2. **Always respond to first comments within 2 hours.** Algorithm boost is real; silent founders get buried.
3. **Never ask for upvotes / stars.** All Reddit + HN + X communities penalize it.
4. **One channel at a time.** Shotgunning 10 platforms = nothing to respond to = 0 traction.
5. **Post when you're available to babysit for 2+ hours afterwards.** Don't launch on a travel day.

## What's already shipped in the repo

- ✅ MIT LICENSE
- ✅ Bilingual README (EN + zh-CN) with Mermaid architecture, features table, screenshots
- ✅ Dockerfile + docker-compose.yml + .dockerignore
- ✅ GitHub Actions CI (backend, frontend, docker image builds)
- ✅ CONTRIBUTING.md + CODE_OF_CONDUCT.md
- ✅ .github/ISSUE_TEMPLATE/{bug_report,feature_request}.md + config.yml
- ✅ .github/PULL_REQUEST_TEMPLATE.md
- ✅ 5 seeded issues (good first issue + help wanted)
- ✅ 14 GitHub topics, Discussions enabled, social preview image at `docs/social/social-preview.png`

## What's left for you to do (takes 1 hour)

- [ ] Upload `docs/social/social-preview.png` to **repo Settings → General → Social preview** (GitHub API doesn't expose this endpoint; must be done in browser)
- [ ] Record a 30–60s demo GIF and replace `docs/screenshots/dashboard.png` at the top of both READMEs (see issue #1)
- [ ] Decide timing for launch sequence (pick a Monday)
- [ ] Prep screenshots for Reddit / Dev.to / 公众号 if you want customized ones
