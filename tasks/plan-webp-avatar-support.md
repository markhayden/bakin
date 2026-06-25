# Plan: WebP Avatar Support (#339)

**Spec:** `.claude/specs/webp-avatar-support.md`
**Branch:** `feat/webp-avatar-support` (off `main`)
**Backbone:** the spec's C1–C5 commit strategy, sliced vertically.

---

## Dependency graph

```
        ┌─────────────────────────────────────────────┐
        │ reuse: @bakin/core/media/image-format        │
        │  (IMAGE_EXTENSION_TO_MIME — do NOT duplicate) │
        │ reuse: @bakin/core/agent-packages/markers     │
        │  (removeInstalledBy)                          │
        └───────────────────┬─────────────────────────┘
                            │
                  T1  resolver + unit tests      (C1)  ← foundation, no consumers yet
                   │
        ┌──────────┴───────────┐
        ▼                      ▼
  T2 team wiring (C2)    T3 host wiring (C3)     ← independent consumers, both need T1
        │                      │
        └──────────┬───────────┘
                   ▼
        T4 dual-format test sweep (C4)            ← needs T2+T3 behavior in place
                   │
                   ▼
        T5 docs (C5)                              ← last; describes shipped behavior
```

T2 and T3 are independent of each other (different files, both depend only on T1). They are
committed separately for clean rollback but can be implemented back-to-back.

---

## Vertical slices

Each task is one complete path (code + the test that proves it), builds green, and is a rollback
checkpoint. "Verify" = the concrete command/observation that closes the task.

### T1 — Shared avatar resolver (C1)

**Goal:** `packages/core/src/agents/avatar.ts` is the single source of truth for avatar disk
resolution, magic-byte detection, and conditional serving. Nothing consumes it yet.

**Build:**
- `AVATAR_EXT_PRIORITY = ['webp','png','jpg']`; MIME via `IMAGE_EXTENSION_TO_MIME` from
  `@bakin/core/media/image-format` (no new mime strings).
- `AGENT_ID_RE` guard (lifted from host route).
- `resolveAgentAvatar(id) → ResolvedAvatar | null` — validate id, one `statSync` on first existing
  `avatar.<ext>` in priority order; returns `{path, contentType, size, mtimeMs}`.
- `detectImageExtension(buf) → 'webp'|'png'|'jpg'|null` — magic bytes: PNG `89 50 4E 47`,
  JPEG `FF D8 FF`, WebP `RIFF`(0–3)+`WEBP`(8–11).
- `serveAvatar(req, id) → Response` — 404 when unresolved; else body + `Cache-Control`,
  `Last-Modified` (mtime), weak `ETag "<size>-<mtimeMs>"`; return `304` on matching
  `If-None-Match` or `If-Modified-Since`.

**Acceptance:**
- Pure/functional; only `fs` + the two shared core modules imported.
- No mime literals outside `IMAGE_EXTENSION_TO_MIME`.

**Verify:** `bun test tests/core/agents/avatar.test.ts --isolate` green (test authored in this task);
`bun run build` green.

### T2 — Team plugin wiring (C2)

**Goal:** team plugin discovery + serve + upload all go through the resolver.

**Build (`plugins/team/index.ts`):**
- `agentToMeta` (~L186): `headshot = resolveAgentAvatar(agent.id) ? '/api/plugins/team/${id}/avatar' : ''`.
- Serve route (~L1308): handler body → `return serveAvatar(req, agentId)` after the agentId check.
  Change `responses[200].contentType` (L1315) `image/jpeg` → `application/octet-stream`.
- Upload handler (~L1007): `detectImageExtension(buf)`; `null` → 400 `Unsupported image format`;
  write `avatar.<ext>`; delete each other-format sibling + its `.installedBy` sidecar via
  `removeInstalledBy` (`@bakin/core/agent-packages/markers`).
- Remove now-dead imports (`readFileSync`/`image/jpeg` literals) if unused.

**Acceptance:** matches spec §3.2; no hardcoded `avatar.jpg`/`image/jpeg` left in the file.

**Verify:** `grep -n "avatar.jpg\|image/jpeg" plugins/team/index.ts` → no matches;
`bun test tests/plugins/team --isolate` green; `bun run build` green.

### T3 — Host route wiring (C3)

**Goal:** `GET /api/agents/avatar?id=` serves all formats via the resolver.

**Build (`packages/host/src/api/agents/avatar.ts`):**
- Body → `return serveAvatar(req, id)` after the `id` presence check.
- Delete the local `AGENT_ID_RE` (centralized in resolver) and now-unused `fs`/`path` imports.

**Acceptance:** file is a thin adapter over `serveAvatar`; no `avatar.jpg`/`image/jpeg` literal.

**Verify:** `grep -n "avatar.jpg\|image/jpeg\|AGENT_ID_RE" packages/host/src/api/agents/avatar.ts`
→ no matches; `bun run build` green.

### T4 — Dual-format test sweep (C4)

**Goal:** existing avatar tests cover webp/png/jpg; team route + upload behaviors are proven.

**Build (add cases, don't swap):**
- `tests/plugins/team/health-checks.test.ts`
- `tests/agent-packages/{projector,markers,lockfile,uninstaller}.test.ts`
- Team route/upload (via `tests/plugins/test-helpers.ts` `callRoute`): webp upload preserves `.webp`;
  junk bytes → 400; 2nd-format upload deletes 1st file + sidecar; serve returns correct MIME + 304.
- (`tests/cli/install-agent-assets.test.ts` from the issue does not exist — skip, note in plan.)

**Acceptance:** all touched suites assert at least one non-jpg path.

**Verify:** `bun run test` green (full suite, CI flags).

### T5 — Docs (C5)

**Goal:** docs describe dual-format support + recommend WebP for new packages.

**Build:**
- `.claude/knowledge/design-system.md:90` — `avatar.{webp,png,jpg}`, note priority + ETag serving.
- `.claude/knowledge/agent-system.md:36` — dual-format path.
- `CLAUDE.md:45` directory-map line — `{id}/avatar.{webp,png,jpg}, avatar-full.png + .installedBy`.
- `docs/src/content/docs/extending/agents/packages.md` — short "prefer WebP for avatar assets" note.

**Acceptance:** no doc still implies JPEG-only; package authors told to prefer WebP.

**Verify:** `grep -rn "avatar.jpg" CLAUDE.md .claude/knowledge docs/src` reviewed — every remaining
hit is intentional (e.g. historical context), none implies JPEG-only is the only option.

---

## Checkpoints (between phases)

- **CP-A after T1:** `bun run build` + resolver unit tests green. Resolver is dead code until T2/T3
  — safe to pause here. ✅ rollback point.
- **CP-B after T2+T3:** both serve routes + upload exercised manually or via test; `bun run build`
  green; no JPEG hardcodes remain in either consumer. ✅ functional dual-format end to end.
- **CP-C after T4:** `bun run test` full suite green. ✅ coverage locked.
- **CP-D after T5:** docs consistent; final `bun run build` + `bun run test`; confirm
  `generated-version.ts` is NOT staged. ✅ ready for PR.

---

## Risks / watch-items

- **`generated-version.ts`** — `bun run build` mutates it; never stage it (memory + CLAUDE.md).
- **Test isolation** — every fs-touching test must mock both content-dir resolvers + OpenClaw home
  (CLAUDE.md Testing Rules). Reuse `tests/plugins/test-helpers.ts` for team route tests.
- **Import specifier** — `@bakin/core/agent-packages/markers` resolves (adapter-openclaw + memory
  plugin use it) even though it's absent from the package `exports` map; a tsconfig `@bakin/core/*`
  wildcard covers it. If it fails at build, fall back to the relative path the projector uses
  (`../../packages/core/src/agent-packages/markers`).
- **Downstream** — actual `.webp` files ship from `bakin-bits-official` (separate task, not this PR).

---

## Out of scope (reconfirmed)

avatar-full migration; AVIF; conversion deps; multi-res; remote sourcing; `.userEdited`/sync-ownership
changes. (Caching/ETag was pulled INTO scope per kickoff decision #7.)
