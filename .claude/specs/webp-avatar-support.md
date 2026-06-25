# Spec: WebP Avatar Support (Dual-Format Read / Serve / Upload)

**Issue:** [#339](https://github.com/markhayden/bakin/issues/339)
**Status:** Approved design — ready for `/agent-skills:plan`
**Author:** kickoff interview, 2026-06-17

---

## 1. Objective

Make Bakin's agent-avatar pipeline format-agnostic across **WebP, PNG, and JPEG** so first-party
agent packages (`bakin-bits-official`) can ship ~40–50% smaller WebP avatars without coordinated
filename hacks. Today the filename `avatar.jpg` and MIME `image/jpeg` are hardcoded across four
server-side sites, blocking any format migration.

This change is **runtime-only** (this repo). Shipping the actual `.webp` asset files lives in
`bakin-bits-official` and is explicitly a downstream follow-up (see §7).

**Primary "user":** agent-package authors + the avatar upload UI. **Secondary:** every screen that
renders an agent headshot (consumes a stable URL, unaffected by format).

### Non-goals (out of scope)

- Multi-resolution avatars (`avatar-256`, etc.).
- Remote avatar sourcing.
- AVIF support (defer until WebP lands and metrics motivate it).
- Migrating `avatar-full.png` (the full-res original) to another format — it stays a PNG; nothing
  reads it today, and the served thumbnail is the only thing this issue touches.
- Changing manual-upload vs. `agents sync` ownership semantics (no new `.userEdited` behavior).
- Server-side format **conversion** (would require a native image dep flagged "ask first").

---

## 2. Current State (verified)

| Site | File:Line | Hardcoded today |
|------|-----------|-----------------|
| Discovery (`agentToMeta`) | `plugins/team/index.ts:186` | `join(agents, id, 'avatar.jpg')` |
| Upload handler | `plugins/team/index.ts:1033` | `writeFileSync(.../'avatar.jpg', buf)` |
| Team serve route | `plugins/team/index.ts:1322`, `:1331`, `:1315` | path + `Content-Type: image/jpeg` + OpenAPI decl |
| **Host serve route** (issue missed this) | `packages/host/src/api/agents/avatar.ts:27,37` | path + `image/jpeg` |

**Already format-agnostic (no change):** `src/core/agent-packages/projector.ts:413` copies
`contributions.assets` by `basename(rel)`; `unprojectPackage` skips missing files
(`projector.ts:572`). The projector will happily project `avatar.webp`.

**Drift in the issue's references (handle gracefully):**
- `.claude/specs/agent-avatar-asset-management.md` — does **not** exist (this spec replaces it).
- `tests/cli/install-agent-assets.test.ts` — does **not** exist (skip).
- `docs/.../packages.md` — has **no** avatar refs today (we *add* author guidance).
- `agent-system.md:36` references `avatar.jpg` but the issue didn't list it (we update it).

---

## 3. Design

### 3.1 New shared module — `packages/core/src/agents/avatar.ts`

The single source of truth for the format↔MIME map and all avatar disk/serve logic. Lives in
`packages/core` (the shared server tier), **not** the SDK — the SDK is browser-only (9 externalized
vendor bundles, zero `fs`), and no third-party plugin reads avatar files directly (they fetch the
URL). Both real consumers (`plugins/team/index.ts`, `packages/host/src/api/agents/avatar.ts`)
already import from `packages/core`.

**Reuse the existing format↔MIME map.** `@bakin/core/media/image-format` already owns the
canonical `IMAGE_EXTENSION_TO_MIME` table (consolidated in #380 to stop exactly this kind of
drift). The resolver MUST NOT define its own mime strings — it imports that table and only adds an
avatar-specific **priority order of extensions**. That module is pure (no fs), so it adds no
magic-byte sniffing; `detectImageExtension` is the genuinely new piece, and it returns an extension
that feeds back into `IMAGE_EXTENSION_TO_MIME` for the served MIME.

```ts
import { IMAGE_EXTENSION_TO_MIME } from '@bakin/core/media/image-format'

// Avatar-specific priority — first existing file wins. MIME comes from the
// shared table (IMAGE_EXTENSION_TO_MIME['.webp'] etc.), never re-declared here.
const AVATAR_EXT_PRIORITY = ['webp', 'png', 'jpg'] as const

// Centralized path-traversal guard (currently only the host route has one).
const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export interface ResolvedAvatar {
  path: string
  contentType: string
  size: number
  mtimeMs: number
}

/** Read path. Returns null for invalid id, or no avatar on disk. One statSync. */
export function resolveAgentAvatar(agentId: string): ResolvedAvatar | null

/** Upload path. Magic-byte sniff → 'webp' | 'png' | 'jpg' | null (unrecognized). */
export function detectImageExtension(buffer: Uint8Array): 'webp' | 'png' | 'jpg' | null

/** Serve path. Builds the full Response incl. Cache-Control, Last-Modified,
 *  weak ETag "<size>-<mtimeMs>", and 304 on matching If-None-Match /
 *  If-Modified-Since. Returns 404 Response when no avatar resolves. */
export function serveAvatar(req: Request, agentId: string): Response
```

**Magic bytes:** WebP = `RIFF....WEBP` (bytes 0–3 `52 49 46 46`, bytes 8–11 `57 45 42 50`);
PNG = `89 50 4E 47`; JPEG = `FF D8 FF`.

**ETag:** weak validator `"<size>-<mtimeMs>"` — no file read needed for a 304, correct for
re-uploads (mtime changes). Strong content-hash rejected (would read+hash every request).

### 3.2 Consumer wiring

- **`agentToMeta` (`team/index.ts:186`)** → `headshot = resolveAgentAvatar(agent.id) ? \`/api/plugins/team/${agent.id}/avatar\` : ''`
- **Team serve route (`:1308`)** → handler body becomes `return serveAvatar(req, agentId)` (after the
  `agentId` presence check). Update the `defineRoute` `responses[200].contentType` (`:1315`) from
  `image/jpeg` to a non-misleading value (e.g. `application/octet-stream`, matching the host route's
  existing OpenAPI decl at `core-routes/index.ts:31`).
- **Host serve route (`packages/host/src/api/agents/avatar.ts`)** → body becomes
  `return serveAvatar(req, id)`. Drop the now-duplicated local `AGENT_ID_RE` (centralized in the
  resolver). Keep the `id` presence check.
- **Upload handler (`:1007`)**:
  1. `const ext = detectImageExtension(imageBuffer)`; if `null` → `400 { error: 'Unsupported image format' }`.
  2. Write `avatar.<ext>`.
  3. Delete every other-format sibling `avatar.<otherExt>` for that agent, and each one's
     `.installedBy` sidecar via `removeInstalledBy()` from `@bakin/core/agent-packages/markers`
     — leaves exactly one canonical avatar, no orphaned sidecars. (`unprojectPackage` already
     tolerates the now-missing projection.)

---

## 4. Acceptance Criteria

- [ ] Both serve routes return `avatar.webp` as `image/webp`, `avatar.png` as `image/png`, and
      `avatar.jpg` as `image/jpeg`, picking webp → png → jpg when multiple exist.
- [ ] Both serve routes emit `ETag` + `Last-Modified` and return `304` for a matching conditional
      request; a re-upload (new mtime) busts the cache.
- [ ] `agentToMeta` sets `headshot` when an avatar in **any** supported format exists.
- [ ] Upload preserves the uploaded format via magic-byte detection and **rejects** non-image bytes
      with `400`.
- [ ] Upload removes stale other-format siblings **and** their `.installedBy` sidecars.
- [ ] Invalid/path-traversal agent ids are rejected by the shared resolver on both routes.
- [ ] Tests cover webp + png + jpg on read/serve, 304 conditional-request, upload format
      preservation, unknown-format rejection, and stale-sibling cleanup.
- [ ] Docs describe dual-format support and recommend WebP for new packages.
- [ ] `bun run test` green; `bun run build` green; no `generated-version.ts` committed.

---

## 5. Testing Strategy

Follow CLAUDE.md "Testing Rules — CRITICAL": every fs-touching test mocks **both** content-dir
resolvers and the OpenClaw home to temp dirs; clean up in `afterAll`; mock logger + watcher.

- **New** `tests/core/agents/avatar.test.ts` (unit, no app side effects):
  - `resolveAgentAvatar`: each format, priority order, none-present → null, invalid id → null.
  - `detectImageExtension`: real magic-byte fixtures for webp/png/jpg; junk → null.
  - `serveAvatar`: correct Content-Type per format; ETag/Last-Modified present; `If-None-Match` and
    `If-Modified-Since` → 304; missing avatar → 404.
- **Update existing** for dual-format coverage (add `.webp`/`.png` cases, don't just swap):
  `tests/plugins/team/health-checks.test.ts`, `tests/agent-packages/{projector,markers,lockfile,uninstaller}.test.ts`.
- **Team route + upload**: extend the team plugin test(s) — upload webp preserves `.webp`; upload
  junk → 400; uploading a 2nd format deletes the 1st + its sidecar. Use
  `tests/plugins/test-helpers.ts` (`callRoute`).
- `tests/cli/install-agent-assets.test.ts` from the issue does not exist — skip.

---

## 6. Commit Strategy (rollback checkpoints)

Each commit builds + tests green and is a clean rollback point. Layered so nothing references the
resolver before it exists.

| # | Scope | Contents |
|---|-------|----------|
| **C1** | `feat(core): add shared agent-avatar resolver` | `packages/core/src/agents/avatar.ts` + `tests/core/agents/avatar.test.ts`. Self-contained; no consumer yet. |
| **C2** | `refactor(team): serve/detect avatars via shared resolver` | `agentToMeta`, team serve route (+ OpenAPI `contentType`), upload handler (detect/reject/sibling-cleanup). |
| **C3** | `refactor(host): route /api/agents/avatar through resolver` | `packages/host/src/api/agents/avatar.ts`; drop local `AGENT_ID_RE`. |
| **C4** | `test(avatar): dual-format coverage` | Update the 5 existing test files + team route/upload tests. |
| **C5** | `docs(avatar): document dual-format support` | `design-system.md:90`, `agent-system.md:36`, `CLAUDE.md:45`, WebP guidance in `docs/.../packages.md`. |

Commit messages end with the required `Co-Authored-By` trailer. Branch off `main`
(e.g. `feat/webp-avatar-support`). Do not commit `generated-version.ts` after `bun run build`.

---

## 7. Downstream follow-up (NOT in this PR)

Once `main` accepts all three formats, `bakin-bits-official` ships `avatar.webp` per agent and
updates each `bakin-package.json` `contributions.assets`. Expected ~50 KB → ~25 KB per avatar.
Track as a separate cross-repo task.

---

## 8. Boundaries

- **Always:** mock content-dir + OpenClaw home in fs tests; keep the format↔MIME map in one place;
  validate agent id before disk access; functional/pure helpers; `const` over `let`; kebab-case files.
- **Ask first:** any native image-processing dependency (sharp/etc.); any change to manual-upload vs.
  `agents sync` ownership; AVIF.
- **Never:** add a parallel/duplicate format map; read avatar files outside the resolver; put fs code
  in the SDK; introduce backwards-compat shims (single-user machine, clean migration); commit
  `generated-version.ts`.
