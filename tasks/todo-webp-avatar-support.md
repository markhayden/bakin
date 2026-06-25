# TODO: WebP Avatar Support (#339)

Plan: `tasks/plan-webp-avatar-support.md` · Spec: `.claude/specs/webp-avatar-support.md`
Branch: `feat/webp-avatar-support`

## T1 — Shared resolver (C1) `feat(core): add shared agent-avatar resolver`
- [ ] `packages/core/src/agents/avatar.ts`: `AVATAR_EXT_PRIORITY`, `AGENT_ID_RE`, `ResolvedAvatar`
- [ ] `resolveAgentAvatar(id)` — id guard + priority statSync, MIME from `IMAGE_EXTENSION_TO_MIME`
- [ ] `detectImageExtension(buf)` — webp/png/jpg magic bytes, else null
- [ ] `serveAvatar(req,id)` — Cache-Control + Last-Modified + weak ETag + 304 + 404
- [ ] `tests/core/agents/avatar.test.ts` (mock both content-dir resolvers + OpenClaw home)
- [ ] Verify: `bun test tests/core/agents/avatar.test.ts --isolate` + `bun run build` green
- [ ] **CP-A** commit

## T2 — Team plugin wiring (C2) `refactor(team): serve/detect avatars via shared resolver`
- [ ] `agentToMeta` → `resolveAgentAvatar`
- [ ] serve route → `serveAvatar`; OpenAPI `contentType` → `application/octet-stream`
- [ ] upload → `detectImageExtension` (400 on null) + write `avatar.<ext>` + sibling/sidecar cleanup
- [ ] drop dead imports
- [ ] Verify: `grep avatar.jpg\|image/jpeg plugins/team/index.ts` empty; team tests + build green
- [ ] commit

## T3 — Host route wiring (C3) `refactor(host): route /api/agents/avatar through resolver`
- [ ] body → `serveAvatar(req,id)`; drop local `AGENT_ID_RE` + dead imports
- [ ] Verify: grep clean; `bun run build` green
- [ ] **CP-B** commit

## T4 — Dual-format test sweep (C4) `test(avatar): dual-format coverage`
- [x] resolver unit tests (T1): resolve/detect/serve all formats + priority + 304 + traversal
- [x] team upload route: preserve webp/png, reject junk(400), stale sibling+sidecar delete, serve MIME
- [x] projector: webp projection (format-agnostic proof) — #339 case
- [x] DECISION (scope): markers/lockfile/uninstaller/health-checks tests use avatar.jpg as a
      GENERIC projected-asset fixture; their source code is format-agnostic. Adding webp there is
      churn with zero new assertion value, so intentionally skipped (not a silent cap).
- [x] (skip non-existent `tests/cli/install-agent-assets.test.ts`)
- [x] Verify: `bun run test` full suite green (5115 pass / 0 fail) — **CP-C**
- [x] commit (f2e328d5)

## T5 — Docs (C5) `docs(avatar): document dual-format support`
- [x] `design-system.md:90`, `agent-system.md:36`, `CLAUDE.md:45`, `packages.md` WebP guidance
- [x] Verify: grep review; `bun run build` green (binaries); `generated-version.ts` NOT staged — **CP-D**
- [x] commit (0005144a)

## CP-D end-to-end (this machine)
- [x] full `bun run build` green; build artifacts reverted (generated-version.ts, _embedded-assets-static.ts)
- [x] real-HTTP e2e via Bun.serve + curl: 12/12 (content-types, webp-wins, ETag/304, If-Modified-Since, 404s, 400 traversal/missing-id, byte integrity)
- [x] e2e server killed; ports 57872 + 3737 confirmed FREE; tree clean

## Post
- [ ] Open PR `feat/webp-avatar-support` → main, reference #339 (awaiting go-ahead)
- [ ] Note downstream `bakin-bits-official` follow-up in PR body
