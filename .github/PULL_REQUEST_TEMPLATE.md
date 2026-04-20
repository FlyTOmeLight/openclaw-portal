## Summary

<!-- One or two sentences: what does this PR change and why? -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Docs / translation
- [ ] CI / tooling
- [ ] Other:

## Screenshots (UI changes only)

| Before | After |
|:--:|:--:|
|  |  |

## Checklist

- [ ] `cd backend && npm test` passes
- [ ] `cd backend && npm run build` passes
- [ ] `cd frontend && npm run build` passes
- [ ] Trust boundary kept intact (loopback bind + onRequest allowlist + `X-Forwarded-User`)
- [ ] Gateway RPC responses still parsed from `payload` (not `result`)
- [ ] Agent-scoped settings still under `agents.list[].*`
- [ ] No hardcoded secrets / internal URLs / IPs
- [ ] Updated README / docs if behavior changed

## Related issues

<!-- Closes #123 / Part of #456 / etc. -->
