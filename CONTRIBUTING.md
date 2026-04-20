# Contributing to OpenClaw Portal

Thanks for your interest — issues, PRs, and design feedback are all welcome.

## Ways to help

- 🐛 **File a bug** — use the [Bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Reproduction steps + screenshot are the fastest path to a fix.
- ✨ **Request a feature** — open a [Feature request](.github/ISSUE_TEMPLATE/feature_request.md) or start a [Discussion](https://github.com/FlyTOmeLight/openclaw-portal/discussions).
- 📝 **Improve docs** — typo fixes, translation, a better architecture diagram, or screenshots for a page that's missing one. Docs PRs get merged fast.
- 💻 **Send code** — look for issues labeled [`good first issue`](https://github.com/FlyTOmeLight/openclaw-portal/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) if you want a low-context entry point.

## Dev setup

```bash
git clone https://github.com/FlyTOmeLight/openclaw-portal.git
cd openclaw-portal
make install   # installs backend + frontend deps
make dev       # starts both in dev mode
```

You'll also need a running OpenClaw gateway on `127.0.0.1:18789`.

## Architecture rules (don't break these)

1. **Chat / agent interactions go through the gateway WebSocket RPC**, never directly to the model provider from the portal.
2. **Gateway RPC responses use the `payload` field**, not `result`.
3. **Agent-scoped settings (model / thinking / tools / subagents) live under `agents.list[].*`**, not via global overrides.
4. **Trust boundary has three layers**: loopback bind + `onRequest` allowlist + `X-Forwarded-User` from nginx. All three must stay.

Detailed rationale is in the project-level `CLAUDE.md` if present.

## Pull request checklist

- [ ] `cd backend && npm test` passes
- [ ] `cd backend && npm run build` passes
- [ ] `cd frontend && npm run build` passes (includes `vue-tsc` typecheck)
- [ ] No new hardcoded secrets, internal URLs, or IPs
- [ ] For UI changes: screenshot attached (before / after for visual diffs)
- [ ] For new features: mention in PR body whether docs or the README need updates

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.

## Code of Conduct

All contributors agree to uphold the [Contributor Covenant](./CODE_OF_CONDUCT.md).

## License

By contributing you agree that your contributions are licensed under [MIT](./LICENSE).
