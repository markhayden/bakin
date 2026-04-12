# Issue #73 — Plugin harness ↔ search consistency — Implementation Plan

**Spec:** `.claude/specs/issue-73-watcher-unlink-hook.md`
**Task list:** `.claude/tasks/issue-73-todo.md`
**Shape:** One PR, six commits, six phases. Each phase is a vertical slice (core → plugin migration → docs) that leaves the tree buildable and green.

---

## Dependency graph (why this order)

```
        ┌─── Phase 1 ─── foundation
        │      │
        │      ├── 1A  widen watcher filter to YAML
        │      ├── 1B  formalize watcher hook contract (docs in watcher.ts)
        │      ├── 1C  SearchAPI surface: add registerFileBackedContentType
        │      └── 1D  helper impl + performStartupReconcile + unit tests
        │              └── blocks all migrations below
        │
        ├─── Phase 2 ─── projects migration (simplest caller)
        │      └── exercises the happy-path helper shape
        │
        ├─── Phase 3 ─── workflows migration (multi-pattern caller)
        │      └── exercises multi-pattern + YAML, depends on 1A
        │
        ├─── Phase 4 ─── assets migration (escape-hatch caller)
        │      └── closes the original issue #73; depends on escape hatches in 1D
        │
        ├─── Phase 5 ─── orphan cleanup demotion
        │      └── independent of migrations but meaningful only after them
        │
        └─── Phase 6 ─── docs (.claude/knowledge + CLAUDE.md)
               └── must come last so examples match final API
```

Key constraints:

- **Phase 1 is a hard blocker for 2–4.** The helper must exist and pass unit tests before any plugin migrates to it.
- **Phase 3 requires Phase 1A.** Workflow definitions are YAML; if the watcher still filters YAML out, their sync hook never fires.
- **Phase 4 depends on escape hatches (`onSync`/`onUnlink`) landing in Phase 1D.** Assets can't fit the default `fileToId/fileToDoc` shape without them.
- **Phase 5 must come after 2–4.** Only after watcher hooks are wired is it safe to demote the orphan cleanup to a 7-day backstop.
- **Phase 6 must come last.** Docs show the final helper surface; writing them before it stabilizes just means rewriting them.

Within each phase, slice work **vertically** — helper-side change + caller-side change + test, bundled. No "land the helper first then migrate projects next week" — that adds uncalled surface area.

---

## Files-level blast radius

| File | Phase | Change |
|---|---|---|
| `src/core/watcher.ts` | 1A, 1B | Regex widen (YAML). Contract comments at top. |
| `packages/core/src/plugin-types.ts` | 1C | Add `FileBackedContentTypeDefinition` type, extend `SearchAPI` with `registerFileBackedContentType`. |
| `src/core/search-registry.ts` | 1D | Implement `registerFileBackedContentType` inside `buildSearchAPI`. Wire sync+unlink hooks per registration. Implement `performStartupReconcile`. |
| `src/core/search-reconcile.ts` *(new)* | 1D | Standalone mtime-delta reconciler (pure function, easier to unit test than inlined in `search-registry.ts`). |
| `src/core/search-cleanup.ts` | 5 | Update log wording to "backstop scan". No interval constant change — we update the default in `settings.ts`. |
| `packages/core/src/settings.ts` | 5 | `cleanupInterval: '24h'` → `cleanupInterval: '7d'`. |
| `plugins/projects/index.ts` | 2 | Replace `registerContentType` block with `registerFileBackedContentType`. Remove bespoke `indexProject` function (now lives inside the helper mapper). Keep REST route index/remove calls. |
| `plugins/workflows/index.ts` | 3 | Same pattern, with two file-pattern entries (definitions YAML + instances JSON). |
| `plugins/assets/index.ts` | 4 | Migrate via escape hatches. Drop the existing `registerSyncHook(...)` call (now owned by helper). Add unlink behavior inside `onUnlink`. |
| `tests/core/watcher.test.ts` | 1A | Add YAML case. |
| `tests/core/search-reconcile.test.ts` *(new)* | 1D | Unit tests for the mtime delta loop. |
| `tests/core/register-file-backed-content-type.test.ts` *(new)* | 1D | Tests the new SearchAPI method + hook wiring with a mocked adapter. |
| `tests/plugins/projects/sync-hook.test.ts` *(new)* | 2 | Plugin-level test: drop a `.md`, assert index call; delete it, assert remove call. |
| `tests/plugins/workflows/sync-hook.test.ts` *(new)* | 3 | Same for YAML definitions and JSON instances. |
| `tests/plugins/assets/unlink-hook.test.ts` *(new)* | 4 | Three cases: binary delete, sidecar-only (no-op), `.trash/` (no-op). |
| `tests/integration/search-watcher-sync.test.ts` *(new)* | 4 | End-to-end. Temp contentDir + real watcher + mocked search adapter. Covers all three migrated plugins. |
| `.claude/knowledge/search-system.md` | 6 | Architecture update + worked example. |
| `.claude/knowledge/search-plugin-guide.md` | 6 | Replace manual wiring example with helper. |
| `CLAUDE.md` | 6 | One-paragraph "Search Indexing" update referencing the helper. |

**Estimated LOC**: ~+1000 / −130, 10 modified, 7 created.

---

## Phase 1 — Foundation

**Goal:** ship the infrastructure three plugins will migrate to, with tests proving the helper works end-to-end against a mocked search adapter.

### Task 1A — widen watcher filter to accept YAML
- **File:** `src/core/watcher.ts:90` (the `/\.(md|json|jsonl)$/` regex).
- **Change:** `/\.(md|json|jsonl|ya?ml)$/`.
- **Why separate from 1B:** it's a one-character edit but has a testable behavior change.
- **Verify:** `tests/core/watcher.test.ts` — add a test that writes a `.yaml` file into the temp dir and asserts the change event fires.
- **Acceptance:** watcher test suite passes with the new case; existing tests untouched.

### Task 1B — formalize watcher hook contract
- **File:** `src/core/watcher.ts` (header comments + function-level doc blocks on `registerSyncHook`/`registerUnlinkHook`).
- **Change:** add explicit comments covering (1) signature, (2) fire-and-forget semantics, (3) `awaitWriteFinish: 300ms` lag note, (4) "authoritative writes (REST) should still call `ctx.search.index()` directly; hooks are a safety net."
- **Why separate from 1A:** doc-only, but reviewers should see it land before the helper depends on the stated contract.
- **Verify:** code compiles; no test impact.

### Task 1C — extend the SearchAPI interface
- **File:** `packages/core/src/plugin-types.ts` around line 308.
- **Change:** define `FileBackedContentTypeDefinition` = `SearchContentTypeDefinition` + file-scoping fields; add `registerFileBackedContentType(def): void` to `SearchAPI`.
- **Proposed shape** (finalized here; 1D implements it):
  ```ts
  export interface FilePatternMapper {
    /** Glob relative to contentDir. Passed to picomatch (already a dep via chokidar). */
    pattern: string
    /** Derive the search key for a file matching this pattern. Return null to skip. */
    fileToId: (relPath: string) => string | null
    /**
     * Build the search doc for a file matching this pattern.
     * Content is the raw file bytes as a UTF-8 string (empty for binaries).
     * Return null to skip (e.g. missing sidecar).
     */
    fileToDoc: (relPath: string, content: string) => Promise<Record<string, unknown> | null>
  }

  export interface FileBackedContentTypeDefinition extends SearchContentTypeDefinition {
    /** One or more file-pattern mappers. Patterns should not overlap; first match wins. */
    filePatterns: FilePatternMapper[]
    /** Optional exclude patterns applied before any mapper matches. Globs relative to contentDir. */
    excludePatterns?: string[]
    /**
     * Escape hatch: if provided, the helper invokes this instead of the default
     * `fileToDoc` → `ctx.search.index` flow for any matching file. The plugin
     * takes full responsibility for indexing. Use when pairing logic (e.g.
     * assets' binary+sidecar) can't be expressed as a single mapper.
     */
    onSync?: (relPath: string, content: string) => Promise<void>
    /**
     * Escape hatch: same story for unlinks. If unset, the helper calls
     * `fileToId(relPath)` and `ctx.search.remove(id)`.
     */
    onUnlink?: (relPath: string) => Promise<void>
    /**
     * Whether to run the startup reconcile on plugin activation. Default true.
     * Set false only for plugins that want to drive their own reindex.
     */
    buildOnStartup?: boolean
  }

  export interface SearchAPI {
    // ...existing fields...
    registerFileBackedContentType(def: FileBackedContentTypeDefinition): void
  }
  ```
- **Verify:** `pnpm typecheck` passes with only the new type added. No runtime impact yet (1D wires it up).

### Task 1D — implement the helper + startup reconcile + tests
- **Files:**
  - `src/core/search-registry.ts` — add `registerFileBackedContentType` inside `buildSearchAPI`, wire sync/unlink hooks.
  - `src/core/search-reconcile.ts` *(new)* — export `performStartupReconcile(def, searchAdapter)`.
  - `tests/core/search-reconcile.test.ts` *(new)*
  - `tests/core/register-file-backed-content-type.test.ts` *(new)*
- **Helper behavior:**
  1. On call, invoke `registerContentType(def)` to register the underlying content type.
  2. Compile each `filePatterns[i].pattern` + `excludePatterns` into matchers (use `picomatch`).
  3. Register a single `registerSyncHook` closure that:
     - Tests the path against excludes → skip.
     - Tests against each `filePatterns[i].pattern` → first match wins.
     - If `onSync` is provided, call it and return.
     - Else: read content (already passed in), call `fileToDoc(relPath, content)`; if non-null, call `ctx.search.index(id, doc)`.
  4. Register a single `registerUnlinkHook` closure with symmetric routing.
  5. If `buildOnStartup !== false`, schedule `performStartupReconcile(def)` after plugin activation completes (defer via `queueMicrotask` or `setImmediate` so activation returns quickly).
- **`performStartupReconcile` behavior:**
  1. Call `verifyExists` is the wrong primitive here — it's one-at-a-time. For efficiency, scan Antfly directly with `antfly.scanTable(tableName)` to get `{key → updated_at}` pairs.
  2. Walk the filesystem matching `filePatterns`; for each file, `stat` it and compute the expected id.
  3. If not in index OR `fs.mtime > index.updated_at` → re-index (call `fileToDoc` + `ctx.search.index`).
  4. If id in index but not on disk → remove.
  5. Returns counts `{ scanned, reindexed, removed }` for logging.
  6. If nothing drifted and counts match, logs `reconcile: clean (N docs)` and exits.
- **Tests:**
  - `search-reconcile.test.ts`: mock adapter, temp content dir. Cases: (a) clean-slate (adapter empty, fs has 3 files → 3 re-indexes), (b) steady state (counts match, no mtime drift → 0 mutations), (c) one file stale (mtime newer → 1 re-index), (d) one file deleted (in adapter, not on fs → 1 remove), (e) mixed drift.
  - `register-file-backed-content-type.test.ts`: mock plugin context, call `registerFileBackedContentType`, fire synthetic watcher events, assert index/remove calls. Cases: (a) default fileToId/fileToDoc path, (b) escape-hatch `onSync`/`onUnlink` path, (c) exclude pattern skip, (d) no-match skip, (e) fileToDoc returns null (skip).
- **Verify:** both test files pass; existing search-registry tests pass unchanged.
- **Acceptance:** The helper is callable via `ctx.search` in a mock plugin; synthetic file events flow through correctly; reconcile correctly classifies drift.

### Phase 1 checkpoint
- `pnpm test -- core/` green.
- `pnpm typecheck` green.
- No plugin migrated yet; existing behavior unchanged.
- **Commit 1** — `feat(core): add YAML to watcher filter, formalize hook contract, add registerFileBackedContentType helper + startup reconcile`

---

## Phase 2 — Projects migration

**Goal:** prove the helper on the simplest caller. Projects has one pattern, one mapper, no tricks.

### Task 2A — migrate projects plugin
- **File:** `plugins/projects/index.ts`.
- **Change:**
  - Replace `ctx.search.registerContentType({ ...reindex, verifyExists })` with `ctx.search.registerFileBackedContentType({ ...same fields, filePatterns: [{ pattern: 'projects/*.md', fileToId: (p) => basename(p, '.md'), fileToDoc: async (relPath) => { const id = basename(relPath, '.md'); const project = readProject(id); return project ? projectToSearchDoc(project) : null } }] })`.
  - Keep the `reindex` generator — it's still called by `/api/reindex`. (Startup reconcile and REST reindex are two different code paths; the helper handles startup, `reindex` handles on-demand.)
  - Keep REST route calls to `ctx.search.index`/`remove` (authoritative path, closes the 300ms-lag race for clients expecting immediate consistency).
  - Keep the in-memory task-link `rebuildIndex()` and its `ctx.events.on('file.changed', ...)` subscription — unrelated to search.
- **Verify via test:**
  - New `tests/plugins/projects/sync-hook.test.ts`: mock content dir, mock search adapter, activate plugin, write `projects/foo.md` via `fs.writeFile` (or call the sync hook directly with the synthetic content), assert `ctx.search.index('foo', ...)` called. Delete the file, assert `ctx.search.remove('foo')` called.
- **Regression:** existing projects tests must pass unchanged.
- **Acceptance:** filesystem-add AND filesystem-delete both land in the mocked adapter without going through a REST route.

### Phase 2 checkpoint
- `pnpm test -- plugins/projects/` green.
- `pnpm test -- core/` still green.
- Manual smoke: `echo '---\ntitle: hello\n---\n' > ~/.bakin/projects/test-$(date +%s).md && curl ...` reveals it in search.
- **Commit 2** — `refactor(projects): migrate to registerFileBackedContentType`

---

## Phase 3 — Workflows migration

**Goal:** prove multi-pattern support + the YAML path that task 1A unblocked.

### Task 3A — migrate workflows plugin
- **File:** `plugins/workflows/index.ts`.
- **Change:** same pattern as projects, but `filePatterns` has two entries:
  ```ts
  filePatterns: [
    {
      pattern: 'workflows/definitions/*.{yaml,yml}',
      fileToId: (p) => `def:${basename(p).replace(/\.ya?ml$/, '')}`,
      fileToDoc: async (relPath) => {
        const name = basename(relPath).replace(/\.ya?ml$/, '')
        const def = loadDefinition(name)
        return def ? definitionToSearchDoc(name, def) : null
      },
    },
    {
      pattern: 'workflows/instances/*.json',
      fileToId: (p) => `inst:${basename(p, '.json')}`,
      fileToDoc: async (relPath) => {
        const taskId = basename(relPath, '.json')
        const inst = loadInstance(taskId)
        return inst ? instanceToSearchDoc(inst) : null
      },
    },
  ],
  ```
- Keep `indexInstance` / `indexDefinition` helpers — they're still called from REST routes (authoritative path).
- **Verify via test:** `tests/plugins/workflows/sync-hook.test.ts` — write a YAML definition + a JSON instance via `fs.writeFile`, assert correct `ctx.search.index(...)` calls with `def:`/`inst:` prefixes. Delete both, assert correct removes.
- **Regression:** existing workflow runtime tests pass.

### Phase 3 checkpoint
- `pnpm test -- plugins/workflows/` green.
- Manual smoke: drop a YAML into `~/.bakin/workflows/definitions/`, hit `/api/plugins/workflows/search?q=<name>`, must return it within ~1s.
- **Commit 3** — `refactor(workflows): migrate instances and definitions to registerFileBackedContentType`

---

## Phase 4 — Assets migration + issue #73 closure

**Goal:** close the original issue. Assets is the complex caller — uses escape hatches for binary/sidecar pairing.

### Task 4A — migrate assets plugin
- **File:** `plugins/assets/index.ts`.
- **Change:**
  - Replace `registerContentType` + `registerSyncHook` with a single `registerFileBackedContentType` call.
  - Use the escape hatches (`onSync` + `onUnlink`) because the binary/sidecar pairing doesn't fit the default flow:
    ```ts
    ctx.search.registerFileBackedContentType({
      // ...all existing content type fields (schema, indexes, facets, reindex, verifyExists, rerankField, chunker, etc.)
      filePatterns: [{ pattern: 'assets/**/*', fileToId: (p) => p, fileToDoc: async () => null /* unused when onSync set */ }],
      excludePatterns: ['assets/**/.trash/**'],
      onSync: async (relPath) => {
        // Binary or sidecar? Re-run indexAsset on the binary path either way.
        const binaryPath = relPath.endsWith('.meta.json') ? relPath.replace('.meta.json', '') : relPath
        upsertAsset(binaryPath)
        await indexAsset(binaryPath)
      },
      onUnlink: async (relPath) => {
        // Sidecar-only delete: no-op (binary still on disk, stub will re-index).
        if (relPath.endsWith('.meta.json')) return
        // Binary delete: remove from local tracker + search.
        removeAsset(relPath)
        await ctx.search.remove(relPath)
      },
    })
    ```
  - Drop the bespoke `registerSyncHook(...)` call (now owned by helper).
  - Drop the call to `buildIndex()` at line 267 — that builds the local asset tracker, which the helper's startup reconcile also needs. Options:
    - **Leave `buildIndex()` call as-is** — it's cheap and builds the in-memory tracker. The helper's startup reconcile runs AFTER and handles search-index delta. Two passes over the filesystem but they have different outputs; acceptable.
    - **Or:** move `buildIndex()` into an `onStartupReconcile` callback in the helper. Adds API surface. Skip for now.
  - **Decision:** keep the `buildIndex()` call. Documented as "asset tracker is a separate in-memory index unrelated to search."
- **Verify via test:** `tests/plugins/assets/unlink-hook.test.ts` — three cases:
  1. Binary delete → `ctx.search.remove(path)` and `removeAsset(path)` both called.
  2. Sidecar-only delete → neither called.
  3. `.trash/` delete → neither called.
- **Integration test:** `tests/integration/search-watcher-sync.test.ts` — spin up the real watcher against a temp contentDir with a mocked `ctx.search` adapter. Run three scenarios (projects, workflows, assets) through the full pipeline. This is the most valuable test in the suite; it catches any wiring bugs invisible at unit level.
- **Regression:** existing assets tests — especially `multimodal-indexing.test.ts`, `routes.test.ts`, `upload.test.ts`, `clipboard-purge.test.ts` — must pass unchanged.

### Phase 4 checkpoint
- `pnpm test` (full suite) green.
- Manual smoke per spec acceptance criteria: `rm` an asset binary, hit asset search, must not return it.
- **Commit 4** — `refactor(assets): migrate to registerFileBackedContentType with escape hatches (closes #73)`

---

## Phase 5 — Orphan cleanup demotion

**Goal:** now that the watcher is authoritative, the orphan cleanup's interval can relax to a week and its log output should reflect its backstop role.

### Task 5A — change default interval
- **File:** `packages/core/src/settings.ts:194`.
- **Change:** `cleanupInterval: '24h'` → `cleanupInterval: '7d'`.
- **Note:** this is the *default*. Users who changed it in `~/.bakin/settings.json` keep their override. Acceptable because this is a single-user machine with no custom override.

### Task 5B — update log wording
- **File:** `src/core/search-cleanup.ts`.
- **Change:** existing `Cleanup: ${tableName} — removed ${orphans} orphans of ${scanned} scanned` → `Cleanup backstop: ${tableName} — removed ${orphans} orphans of ${scanned} scanned`. Add a log.info at startup noting "backstop scan, expected no-op under normal operation."
- **Not touched:** the runCleanup logic itself. It still iterates content types and calls `verifyExists`. The semantics are the same; only wording changes.
- **Verify:** existing search-cleanup tests (if any) pass unchanged.

### Phase 5 checkpoint
- `pnpm test` still green.
- **Commit 5** — `chore(search): demote orphan cleanup default to 7d backstop`

---

## Phase 6 — Documentation

**Goal:** the next engineer/agent adding a file-backed content type finds the helper in one read.

### Task 6A — update `.claude/knowledge/search-system.md`
- Add a top-level "Three consistency paths" section enumerating: REST routes (authoritative), watcher hooks (safety net), startup reconcile (drift recovery). A small diagram showing each path feeding the same Antfly table.
- Update the "Orphan cleanup" section: recast it as a 7-day backstop, not a primary sync mechanism.
- Keep references to existing sections (reindex generators, TTL, reranker) intact.

### Task 6B — update `.claude/knowledge/search-plugin-guide.md`
- Replace the "register a content type" walkthrough with one that uses `registerFileBackedContentType`. Include a worked example (projects or workflows, pick whichever is simpler).
- Add a "When to use escape hatches" callout pointing at assets as the precedent.

### Task 6C — update CLAUDE.md
- Find the "Search Indexing" key-pattern paragraph. Update the last sentence to reference `registerFileBackedContentType` as the preferred API for file-backed content types.

### Phase 6 checkpoint
- Docs read coherently top-to-bottom; no dead links.
- **Commit 6** — `docs(search): document registerFileBackedContentType and update architecture knowledge`

---

## Commit strategy summary

| # | Commit | Rollback impact |
|---|---|---|
| 1 | `feat(core): add YAML to watcher filter, formalize hook contract, add registerFileBackedContentType helper + startup reconcile` | Pure additive. Safe to revert; nothing depends on it yet. |
| 2 | `refactor(projects): migrate to registerFileBackedContentType` | Reverts projects to its old wiring. Search drops filesystem-write consistency for projects but REST path still works. |
| 3 | `refactor(workflows): migrate instances and definitions to registerFileBackedContentType` | Same class. YAML filter in commit 1 stays harmless. |
| 4 | `refactor(assets): migrate to registerFileBackedContentType with escape hatches (closes #73)` | This is the issue-closing commit. Rollback restores the original gap. |
| 5 | `chore(search): demote orphan cleanup default to 7d backstop` | Interval-only. Users who lost drift protection for a week wouldn't notice on a steady-state system. |
| 6 | `docs(search): document registerFileBackedContentType and update architecture knowledge` | Docs-only, always safe to revert. |

Natural rollback points: any commit can be reverted independently except that 4→3→2 must revert in reverse order (each depends on the previous being present).

---

## Acceptance verification per phase

**Phase 1:**
- [ ] Watcher fires events for `.yaml` / `.yml` files (new test case).
- [ ] Watcher header comment documents the hook contract.
- [ ] `registerFileBackedContentType` exists on `SearchAPI` (typecheck).
- [ ] Helper wires sync/unlink hooks and invokes correct mapper paths (unit test).
- [ ] `performStartupReconcile` classifies drift correctly across 5 cases (unit test).

**Phase 2:**
- [ ] Writing `~/.bakin/projects/*.md` directly to disk indexes the project in `bakin_projects` within 1 loop tick (plugin test + manual smoke).
- [ ] Deleting the same file removes it within 1 loop tick.
- [ ] Existing project REST routes still index/remove as before.

**Phase 3:**
- [ ] Writing `~/.bakin/workflows/definitions/foo.yaml` indexes as `def:foo`.
- [ ] Writing `~/.bakin/workflows/instances/bar.json` indexes as `inst:bar`.
- [ ] Deleting either removes the correct key.

**Phase 4 (closes #73):**
- [ ] Deleting an asset binary immediately removes its row from `bakin_assets`.
- [ ] Sidecar-only delete is a no-op.
- [ ] `.trash/` delete is a no-op.
- [ ] `listAssets()` no longer returns the deleted asset.
- [ ] Integration test covering the full watcher pipeline passes for all three plugins.
- [ ] Existing assets test suite unchanged.

**Phase 5:**
- [ ] `pnpm dev` server logs show "Orphan cleanup timer started (interval: 7d)".
- [ ] Cleanup log wording includes "backstop".

**Phase 6:**
- [ ] Docs reference the helper as the primary API.
- [ ] Worked example matches the final helper signature.

---

## Open risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Helper shape doesn't fit assets even with escape hatches | Low (escape hatches are explicitly designed around this) | Fallback: leave assets on raw `registerContentType` + manual hooks. Projects/workflows still migrated. Commit 4 becomes "add unlink hook to assets" instead. |
| Startup reconcile breaks on first boot (stale index from old schema) | Medium | User approved wiping `bakin_*` tables. `bakin doctor` or manual Antfly drop-table recovers. |
| `picomatch` matcher performance at scale | Very low | Each match runs on one file path; O(patterns) per event. Workflows and projects have 2–3 total patterns. Assets has 1. Negligible. |
| Race between REST route `index()` and watcher sync hook `index()` both firing for the same write | Low | Both calls upsert the same doc idempotently. Second call is a no-op write from Antfly's perspective. |
| Watcher YAML broadcasts leak large files over SSE | Very low | Workflow definitions are < 5KB. No other YAML files under `~/.bakin/` today. |

---

## Time estimate

Rough, assuming focused work without interruption:

- Phase 1: 3–4 hours (helper impl + 2 new test files is the bulk).
- Phase 2: 45 min.
- Phase 3: 1 hour (two patterns + YAML first-pass debugging).
- Phase 4: 1.5 hours (escape hatches + integration test).
- Phase 5: 15 min.
- Phase 6: 45 min.

**Total: ~7–8 hours of build time.**

---

## Not in this plan (explicit non-goals)

- Making `registerContentType` (the raw API) private or deprecated. Plugins that don't fit the helper shape (assets would have if we didn't have escape hatches) should still be able to use it.
- Migrating `tasks`, `team`, `schedule` to the helper — none of them are file-backed under `~/.bakin/`.
- Adding an `addExcludePattern()` or any other global watcher-filter API. Helper's `excludePatterns` is per-registration.
- Touching the `ctx.watchFiles()` API. It's effectively dead (stored but never read) but removing it is orthogonal and creates noise in this PR.
- Performance tuning of `awaitWriteFinish`. 300ms is fine for a single-user system.
