# Issue #73 — Task list

**Plan:** `.claude/tasks/issue-73-plan.md`
**Spec:** `.claude/specs/issue-73-watcher-unlink-hook.md`

Order is strict: blocked tasks are marked with their dependency. Each task ends with the verification command to run before checking it off.

---

## Phase 1 — Foundation
*Commit 1 boundary after all Phase 1 tasks complete.*

- [ ] **1A — Widen watcher file filter to YAML**
  - File: `src/core/watcher.ts:90`
  - Change: `/\.(md|json|jsonl)$/` → `/\.(md|json|jsonl|ya?ml)$/`
  - Add test case in `tests/core/watcher.test.ts` covering a `.yaml` write
  - Verify: `pnpm test -- tests/core/watcher`

- [ ] **1B — Formalize watcher hook contract in comments**
  - File: `src/core/watcher.ts` (header + `registerSyncHook`/`registerUnlinkHook` doc blocks)
  - Cover: signature, fire-and-forget, 300ms `awaitWriteFinish` lag, REST routes remain authoritative
  - Verify: `pnpm typecheck`

- [ ] **1C — Extend `SearchAPI` interface with `registerFileBackedContentType`**
  - File: `packages/core/src/plugin-types.ts`
  - Add `FilePatternMapper`, `FileBackedContentTypeDefinition` types
  - Add method to `SearchAPI` (not yet implemented)
  - Verify: `pnpm typecheck` passes; no runtime behavior change

- [ ] **1D — Implement helper + startup reconcile + unit tests**
  - Files: `src/core/search-registry.ts`, `src/core/search-reconcile.ts` *(new)*, `tests/core/search-reconcile.test.ts` *(new)*, `tests/core/register-file-backed-content-type.test.ts` *(new)*
  - Helper wires sync + unlink hooks per registration (with exclude + multi-pattern support)
  - `performStartupReconcile` scans Antfly + walks fs, classifies drift, re-indexes or removes
  - Reconcile test cases: clean-slate, steady-state, mtime drift, removed-on-disk, mixed
  - Helper test cases: default mapper path, escape-hatch path, exclude skip, no-match skip, null-doc skip
  - Verify: `pnpm test -- tests/core` green
  - **Blocked by:** 1A, 1B, 1C

- [ ] **Phase 1 checkpoint** — commit: `feat(core): add YAML to watcher filter, formalize hook contract, add registerFileBackedContentType helper + startup reconcile`

---

## Phase 2 — Projects migration
*Commit 2 boundary.*

- [ ] **2A — Migrate `plugins/projects/index.ts` to helper**
  - Replace `ctx.search.registerContentType(...)` with `ctx.search.registerFileBackedContentType(...)`
  - Single pattern: `projects/*.md`, `fileToId: basename`, `fileToDoc: readProject → projectToSearchDoc`
  - Keep REST route `ctx.search.index`/`remove` calls (authoritative race-killer)
  - Keep the in-memory task-link `rebuildIndex()` + `ctx.events.on('file.changed', ...)` path — unrelated to search
  - Verify: `pnpm test -- tests/plugins/projects`
  - **Blocked by:** Phase 1

- [ ] **2B — Add plugin-level sync-hook test**
  - File: `tests/plugins/projects/sync-hook.test.ts` *(new)*
  - Write a `.md`, assert mocked `ctx.search.index` called; delete it, assert `remove` called
  - Verify: new test passes; existing projects tests pass unchanged

- [ ] **2C — Manual smoke**
  - `printf -- '---\ntitle: sync-test\nstatus: active\n---\nbody\n' > ~/.bakin/projects/sync-test.md`
  - `curl -s 'http://localhost:3737/api/plugins/projects/search?q=sync-test' | jq` — expect hit within 1s
  - `rm ~/.bakin/projects/sync-test.md` — re-query, expect miss within 1s

- [ ] **Phase 2 checkpoint** — commit: `refactor(projects): migrate to registerFileBackedContentType`

---

## Phase 3 — Workflows migration
*Commit 3 boundary.*

- [ ] **3A — Migrate `plugins/workflows/index.ts` to helper**
  - Replace `registerContentType` with `registerFileBackedContentType` using TWO `filePatterns`:
    - `workflows/definitions/*.{yaml,yml}` → `def:{name}` key
    - `workflows/instances/*.json` → `inst:{taskId}` key
  - Keep `indexInstance` / `indexDefinition` helpers called from REST routes
  - Verify: `pnpm test -- tests/plugins/workflows`
  - **Blocked by:** Phase 1 (especially 1A for YAML support)

- [ ] **3B — Add plugin-level sync-hook test**
  - File: `tests/plugins/workflows/sync-hook.test.ts` *(new)*
  - Cover YAML definition add/delete AND JSON instance add/delete with correct key prefixes
  - Verify: new test passes

- [ ] **3C — Manual smoke**
  - `cp ~/.bakin/workflows/definitions/text-social-post.yaml ~/.bakin/workflows/definitions/sync-test.yaml`
  - `curl -s 'http://localhost:3737/api/plugins/workflows/search?q=sync-test' | jq` — expect hit
  - `rm ~/.bakin/workflows/definitions/sync-test.yaml` — re-query, expect miss

- [ ] **Phase 3 checkpoint** — commit: `refactor(workflows): migrate instances and definitions to registerFileBackedContentType`

---

## Phase 4 — Assets migration + closes #73
*Commit 4 boundary — the commit that closes the original issue.*

- [ ] **4A — Migrate `plugins/assets/index.ts` to helper via escape hatches**
  - Replace `registerContentType` + `registerSyncHook` with `registerFileBackedContentType`
  - Use `onSync` / `onUnlink` escape hatches (binary/sidecar pairing doesn't fit default flow)
  - `onSync`: normalize sidecar path → binary path, call `upsertAsset` + `indexAsset`
  - `onUnlink`: skip if `.meta.json` suffix, else call `removeAsset` + `ctx.search.remove`
  - Use `excludePatterns: ['assets/**/.trash/**']`
  - Keep the existing `buildIndex()` call for the in-memory asset tracker (separate from search)
  - Verify: `pnpm test -- tests/plugins/assets`
  - **Blocked by:** Phase 1

- [ ] **4B — Add unlink-hook test**
  - File: `tests/plugins/assets/unlink-hook.test.ts` *(new)*
  - Case 1: binary delete → both `removeAsset` and `ctx.search.remove` called
  - Case 2: sidecar-only delete → neither called
  - Case 3: `.trash/` delete → neither called
  - Verify: new test passes

- [ ] **4C — Add end-to-end integration test**
  - File: `tests/integration/search-watcher-sync.test.ts` *(new)*
  - Temp contentDir + real watcher start() + mocked search adapter
  - Run all three migrated plugins through the real watcher pipeline (write file → expect index call; delete file → expect remove call)
  - Verify: `pnpm test -- tests/integration/search-watcher-sync`

- [ ] **4D — Regression check**
  - Run: `pnpm test -- tests/plugins/assets` — existing multimodal-indexing, routes, upload, clipboard-purge tests must pass unchanged
  - Run: `pnpm test` — full suite green

- [ ] **4E — Manual smoke (issue #73 acceptance criteria)**
  - Start server, have an asset in `bakin_assets` (any asset)
  - `rm ~/.bakin/assets/<type>/<subdir>/<file>` (the binary, not the sidecar)
  - `curl -s 'http://localhost:3737/api/plugins/assets/search?q=<filename>' | jq '.results | length'` — must be 0 within 1s
  - `curl -s 'http://localhost:3737/api/plugins/assets' | jq '.assets[] | select(.path == "<path>")'` — must be empty

- [ ] **Phase 4 checkpoint** — commit: `refactor(assets): migrate to registerFileBackedContentType with escape hatches (closes #73)`

---

## Phase 5 — Orphan cleanup demotion
*Commit 5 boundary.*

- [ ] **5A — Change default interval**
  - File: `packages/core/src/settings.ts:194`
  - Change: `cleanupInterval: '24h'` → `cleanupInterval: '7d'`
  - Verify: `pnpm typecheck`

- [ ] **5B — Update log wording**
  - File: `src/core/search-cleanup.ts`
  - Rename cleanup log output to include "backstop scan"
  - Add startup log note clarifying role
  - Verify: `pnpm test` full suite still green

- [ ] **Phase 5 checkpoint** — commit: `chore(search): demote orphan cleanup default to 7d backstop`

---

## Phase 6 — Docs
*Commit 6 boundary (last commit).*

- [ ] **6A — Update `.claude/knowledge/search-system.md`**
  - Add "Three consistency paths" section (REST / watcher / startup reconcile)
  - Update orphan cleanup section to describe its backstop role
  - Cross-link to search-plugin-guide

- [ ] **6B — Update `.claude/knowledge/search-plugin-guide.md`**
  - Rewrite the "register a content type" walkthrough to use `registerFileBackedContentType`
  - Worked example using projects (simplest)
  - Add "When to use escape hatches" callout pointing at assets

- [ ] **6C — Update CLAUDE.md Search Indexing paragraph**
  - Reference `registerFileBackedContentType` as the preferred API
  - Keep the one-paragraph format

- [ ] **Phase 6 checkpoint** — commit: `docs(search): document registerFileBackedContentType and update architecture knowledge`

---

## Final verification (after all phases)

- [ ] `pnpm typecheck` green
- [ ] `pnpm test` full suite green
- [ ] `pnpm lint` green
- [ ] `pnpm build` succeeds (Next.js production build)
- [ ] All 6 commits present, ordered, each individually buildable
- [ ] `gh pr create` with body linking to issue #73 and the spec

---

## Rollback triggers

If any of these surface during build, **stop and reassess** rather than patching forward:

- Helper shape requires a third escape hatch for assets → consider leaving assets on raw `registerContentType`, migrate only projects + workflows.
- `picomatch` matcher produces false positives/negatives on observed paths → either pin matching strategy or switch to a simpler prefix-match API.
- Integration test reveals race between REST `index()` and watcher hook `index()` writing different doc versions → investigate Antfly idempotency, may need to gate watcher hook on a "last REST write timestamp" per id.
- Startup reconcile runtime > 1s on steady state → profile, likely need indexed `updated_at` lookup instead of full scan.
