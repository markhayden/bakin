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
- [ ] add webp/png cases: health-checks, projector, markers, lockfile, uninstaller
- [ ] team route/upload tests: preserve webp, reject junk(400), sibling+sidecar delete, serve MIME+304
- [ ] (skip non-existent `tests/cli/install-agent-assets.test.ts`)
- [ ] Verify: `bun run test` full suite green — **CP-C**
- [ ] commit

## T5 — Docs (C5) `docs(avatar): document dual-format support`
- [ ] `design-system.md:90`, `agent-system.md:36`, `CLAUDE.md:45`, `packages.md` WebP guidance
- [ ] Verify: grep review; `bun run build` + `bun run test`; `generated-version.ts` NOT staged — **CP-D**
- [ ] commit

## Post
- [ ] Open PR `feat/webp-avatar-support` → main, reference #339
- [ ] Note downstream `bakin-bits-official` follow-up in PR body
