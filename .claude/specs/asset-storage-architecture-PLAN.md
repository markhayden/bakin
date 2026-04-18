# Asset Storage Architecture — Implementation Plan (Option B)

**Spec:** `.claude/specs/asset-storage-architecture.md`

**Status:** Supersedes previous plan (filename-as-ID + physical type dirs + resolver). Commits A–E are landed but partially redundant under this plan; see "Salvage" section.

**Environment:** single-user Mac mini, zero backwards-compat, priority = reduce tech debt.

## Dependency graph

```
P0  Prep: pathForFilename + tests                   (no deps)
P1  Retype/relink become metadata-only              (P0)
P2  saveAsset writes to store/{YYYY-MM}             (P0)
P3  Assets plugin wiring (routes, search, tools)    (P0, P2)
P4  Inbox ingestion                                 (P0, P2)
P5  Migration script                                (P0, P2, P3)
P6  Run migration (one-shot live action)            (P5)
P7  Delete resolver + dead code                     (P3, P6)
P8  Knowledge docs                                  (P7)
P9  Regression test sweep                           (P7)
```

## Salvage from commits A–E

Landed work that **stays valid** under this plan:
- Globally-unique filenames with `id8` suffix (B landed this — perfect fit).
- External references using `filename` instead of `path` (in-flight dirty tree and E commits — keep).
- Search index keyed by filename (A/E — keep).
- `filenameExists()` semantics in search `onUnlink` — can drop once resolver dies (P7).

Landed work that **becomes redundant**:
- `plugins/assets/lib/resolver.ts` (deleted in P7).
- `filenameIndex` logic that mirrors path state (deleted in P7).
- Additive filename URL form (C commit) — stays, but implementation swaps from resolver-based to `pathForFilename`.

Dirty-tree work from aborted F:
- `plugins/messaging/*`, `plugins/projects/*`, `plugins/workflows/*`, `scripts/*`, `src/core/*`, `tests/*` — mostly rename-based edits to consumer code. Keep these; they apply under B unchanged. The only adjustments are in call sites that still reference the resolver — those get rewritten to `pathForFilename`.

## Commit strategy

One logical change per commit. Each commit leaves tests+build green. Rollback = `git revert`. No squashing at the end — preserve the trail.

---

### Commit 1 (P0): `feat(assets): pathForFilename pure function`

**What**
- Add `plugins/assets/lib/path-for-filename.ts` exporting:
  ```typescript
  export function pathForFilename(filename: string): string | null
  export function relPathForFilename(filename: string): string | null  // no "assets/" prefix
  export function yearMonthFromFilename(filename: string): string | null
  ```
- `pathForFilename('20260401-x-a1b2c3d4.png')` → `'assets/store/2026-04/20260401-x-a1b2c3d4.png'`.
- Returns `null` for non-canonical names.

**Why first**
- Pure function. No side effects. Every subsequent commit depends on it.
- Gives us a clean API boundary to target in later commits.

**Tests**
- `tests/plugins/assets/path-for-filename.test.ts`: valid names, missing prefix, malformed date, edge cases.

**Checkpoint**
- `pnpm vitest run path-for-filename` green.
- `pnpm build` green.

**Rollback**: trivial, just delete the file. Nothing else uses it yet.

---

### Commit 2 (P1): `refactor(assets): retype is metadata-only`

**What**
- Rewrite `plugins/assets/lib/retype.ts`:
  - No file moves.
  - Read sidecar, set `sidecar.type = newType`, write sidecar back.
  - Return `{ ok, filename, oldType, newType }`.
- Rewrite `plugins/assets/lib/relink.ts` identically for `taskId`.
- Update `plugins/assets/routes/retype.ts` and `routes/link.ts` to match new return shape.
- Update `bakin_exec_assets_retype` + `bakin_exec_assets_link` exec tools in `plugins/assets/index.ts`:
  - Remove `path` param, add `filename` param.
  - Invoke search `index()` (upsert by filename) with new sidecar data — reuses existing `indexAsset()` helper but takes a filename.
- Delete the `indexAsset(data.newPath).catch(...)` calls that expected a path return; replace with filename-keyed reindex.

**Why**
- Biggest single reduction in complexity. Removes the file-move code that was causing the original bug.
- Still safe pre-migration because the old layout tolerates sidecar-only edits; files just stay where they are with updated metadata.

**Tests**
- Update `tests/plugins/assets/retype.test.ts` + `tests/plugins/assets/relink.test.ts`:
  - Assert **no** file moves occur.
  - Assert sidecar is updated.
  - Assert search index receives upsert with new type/taskId.

**Checkpoint**
- Retype/relink tests green.
- Full suite green.
- Smoke test: hit `PATCH /api/plugins/assets/retype` with a real filename, confirm file stays put, sidecar updates.

**Rollback**: revert this commit; previous retype/relink logic returns. Layout on disk unchanged either way.

---

### Commit 3 (P2): `feat(assets): saveAsset writes to store/{YYYY-MM}`

**What**
- Rewrite `plugins/assets/lib/save-asset.ts`:
  - Compute target via `pathForFilename(canonicalFilename)`.
  - Ensure `store/{YYYY-MM}/` exists, write file there.
  - Write sidecar next to it with full metadata (`type`, `taskId`, `agent`, etc.).
  - Return `{ ok, filename }` (drop `path` from return).
- Update `plugins/assets/routes/upload.ts` similarly.
- Update any callers that expected `path` in the return to use `filename` and derive path via `pathForFilename` if they need it.

**Why**
- New writes go to the new layout. Pre-migration, old files coexist at old paths but all new work uses `store/`.

**Tests**
- Update `tests/plugins/assets/save-asset.test.ts`: assert file lands under `store/{YYYY-MM}/`, sidecar colocated, metadata complete.

**Checkpoint**
- Save + upload tests green.
- Smoke: agent save via MCP goes to `store/`.

**Rollback**: revert; saves return to old `{type}/{taskId}/` layout.

---

### Commit 4 (P3): `refactor(assets): wire plugin to store/ layout + pathForFilename`

**What**
- `plugins/assets/routes/list.ts`, `file.ts`, `content.ts`, `delete.ts`, `trash.ts`:
  - Any place that currently calls `resolveFilename()` → replace with `pathForFilename()`.
  - Any place that walks `assets/{type}/` to list → walk `assets/store/` instead.
- `plugins/assets/lib/asset-index.ts`:
  - Simplify to filename → sidecar map (path is derivable).
  - `buildIndex()` walks `store/` once, populates map.
- `plugins/assets/lib/trash.ts`: trash target becomes `store/.trash/`.
- `plugins/assets/index.ts` (`activate`):
  - Search `filePatterns.pattern: 'assets/store/**/*'`.
  - `reindex` generator walks `store/{YYYY-MM}/` instead of `{type}/{subdir}/`.
  - `onSync` / `onUnlink` use filename extraction (already mostly filename-based post-E).
  - `bakin_exec_assets_list`, `get`, `delete`, `list_trash`, `restore`, `permanent_delete` all take `filename` (not `path`).
  - Audit exec tool walks `store/` instead of `{type}/`.

**Why**
- One commit flips the plugin's internal model from path-keyed to filename-keyed + path-derived.
- Larger commit but it's a coordinated change: piecemeal leaves the plugin in an inconsistent middle state.

**Tests**
- Heavy test updates:
  - `tests/plugins/assets/*.test.ts` — seed temp dir with `store/{YYYY-MM}/` layout.
  - `tests/plugins/assets/routes.test.ts` — param names `path` → `filename`.
  - `tests/plugins/assets/asset-index.test.ts` — map shape simpler.

**Checkpoint**
- All `tests/plugins/assets/**` green.
- Full suite green.
- Smoke: hit `/api/plugins/assets/` list, serves store files; retype an asset, re-read sidecar, confirm type updated.

**Rollback**: revert; plugin returns to resolver-based resolution. But since commits 1–3 don't depend on plugin internals, they remain.

---

### Commit 5 (P4): `feat(assets): inbox ingestion for manual drops`

**What**
- New module `plugins/assets/lib/inbox.ts`:
  - `ingestDroppedFile(absPath): Promise<{ filename } | null>` — canonicalizes name, moves to `store/{YYYY-MM}/`, writes stub sidecar.
  - Type hint from subdir (`inbox/images/` → `type: images`, else `other`).
- Wire into `activate()`:
  - `ctx.watchFiles('assets/inbox/**/*', onAdd: ingestDroppedFile)`.
  - Startup scan of `inbox/` for files missed while server was down.
- Audit event `asset.ingested` on successful ingest.

**Why**
- Restores the manual-drop UX that physical type dirs provided. Inbox becomes the single well-known drop target.

**Tests**
- `tests/plugins/assets/inbox.test.ts`:
  - Drop canonical-named file → moved to store, sidecar written, no rename.
  - Drop non-canonical file → renamed to canonical, moved, sidecar records `source: "manual"`.
  - Drop into `inbox/images/` → sidecar `type: "images"`.
  - Drop into `inbox/` root → sidecar `type: "other"`.

**Checkpoint**
- Inbox tests green.
- Smoke: drop a file into `~/.bakin/assets/inbox/`, watch it appear in `store/` within seconds.

**Rollback**: revert; manual drops stop working but store/ continues operating.

---

### Commit 6 (P5): `chore(assets): migration script`

**What**
- `scripts/bin/migrate-assets-to-store-layout.ts`:
  - Args: `--dry-run`, `--apply`, `--backup-dir=<path>`.
  - Walks `~/.bakin/assets/{type}/{taskId}/*` (excluding `store/`, `inbox/`, `.trash/`).
  - For each asset+sidecar pair:
    - Ensure filename is canonical (rename if not, preserving existing id if already suffixed).
    - Merge type + taskId into sidecar (they were in path, now in metadata).
    - Move to `store/{YYYY-MM}/{filename}` + sidecar.
  - Migrates `.trash/` to `store/.trash/`.
  - Removes empty `{type}/` dirs at end.
  - Prints: `{moved, sidecarUpdated, orphans, errors}`.
- Unit test with temp dir seeded to old layout; assert final state matches new layout.

**Why**
- Codify the migration so it's repeatable, testable, and dry-runnable before touching prod data.

**Tests**
- `tests/scripts/migrate-assets-to-store-layout.test.ts` — full migration against a seeded temp dir.

**Checkpoint**
- Migration test green.
- `--dry-run` against real `~/.bakin/assets/` prints sensible plan.

**Rollback**: don't run `--apply`. Script itself is inert until invoked.

---

### Commit 7 (P6): **LIVE MIGRATION — out-of-band action, not a commit**

This is the point of no return. Do it manually with care:

1. Stop the Bakin server (`ps aux | grep bakin`, kill).
2. Backup: `cp -a ~/.bakin/assets ~/.bakin/assets.pre-pivot-$(date +%Y%m%d-%H%M%S)` AND backup flow_runs SQLite if task descriptions reference paths.
3. `pnpm tsx scripts/bin/migrate-assets-to-store-layout.ts --dry-run` → review output.
4. `pnpm tsx scripts/bin/migrate-assets-to-store-layout.ts --apply --backup-dir=~/.bakin/assets.pre-migration`.
5. Spot-check: open a few assets in UI, verify project manifests still resolve.
6. Restart Bakin server.
7. Watch logs for 10 minutes — any file-not-found errors → roll back from backup.

**Rollback**: `rm -rf ~/.bakin/assets && mv ~/.bakin/assets.pre-pivot-* ~/.bakin/assets`.

---

### Commit 8 (P7): `chore(assets): delete resolver and legacy path code`

**What**
- Delete `plugins/assets/lib/resolver.ts`.
- Delete `filenameIndex` logic wherever it still lives (should be nowhere after commit 4).
- Delete migration script (`scripts/bin/migrate-assets-to-store-layout.ts`) — one-shot, no longer needed.
- Delete legacy path-walking code in audit tool, reindex, etc. that still handles `{type}/{subdir}/` layout.
- Remove `ASSET_TYPES` dependency anywhere it's driving directory structure (keep it as enum for sidecar validation).

**Why**
- Post-migration, the old layout no longer exists. All code handling it is dead.

**Tests**
- Existing suite should still be green — this commit only deletes. If anything breaks, it was load-bearing and we missed a reference.

**Checkpoint**
- Full suite green.
- `grep -r 'resolveFilename\|filenameIndex\|assets/images/\|assets/text/' src plugins scripts` returns nothing.

**Rollback**: revert. Resolver comes back, tests still pass (belt-and-suspenders).

---

### Commit 9 (P8): `docs(assets): update knowledge files for store layout`

**What**
- Update `.claude/knowledge/assets-plugin.md`:
  - New layout diagram.
  - `pathForFilename` as the resolution mechanism.
  - Retype/relink as metadata-only.
  - Inbox ingestion flow.
- Update `.claude/knowledge/storage-model.md` if it exists (it's referenced in CLAUDE.md).
- Update `CLAUDE.md` directory map: `~/.bakin/assets/store/{YYYY-MM}/` + `inbox/`.

**Why**
- Next session / next agent needs the accurate mental model.

**Checkpoint**
- Docs reflect current state. A cold-read reader can onboard without confusion.

**Rollback**: revert docs only.

---

### Commit 10 (P9): `test(assets): regression suite for filename-as-identity`

**What**
- End-to-end regression tests covering the original bug class:
  - Write a project manifest referencing `{filename}`, retype the asset, re-read manifest → resolves.
  - Write a messaging draft with `imageFilename`, retype asset, approve-to-discord → resolves file.
  - Agent saves asset, then the sidecar gets relinked to a new taskId, agent reads asset → resolves.
  - Inbox drop → file appears in store + index + search within a bounded time.
- File: `tests/plugins/assets/filename-identity-regression.test.ts`.

**Why**
- Prove the redesign actually solves the motivating problem. These tests should fail under Option A and pass under Option B.

**Checkpoint**
- New tests green.
- Full suite still green.

**Rollback**: revert. Tests aren't load-bearing for any code path.

## Pitfalls and brittle areas — call out explicitly

**1. Files without canonical filenames.**
Migration script depends on every file being canonicalizable. If a legacy file has no date-parseable prefix AND sidecar has no `createdAt`, we fall back to file mtime. Mtime can be wrong (restored from backup, downloaded, edited). **Mitigation:** log every fallback during `--dry-run` so the user can spot-check before `--apply`.

**2. Race between inbox move and watcher.**
Watcher may emit `add` on inbox *while* the ingester is mid-move, causing double-process. **Mitigation:** ingester uses `fs.rename` (atomic on same FS); watcher ignores files whose parent dir is `inbox/` once they're already being ingested (in-memory set of in-flight paths).

**3. Sidecar-only retype is silently invisible in Finder.**
User retypes image → plans via UI. File still sits in `store/2026-04/` (no type dirs). If user then browses Finder expecting to see it under "plans" → confusion. **Mitigation:** call this out in docs + UI tooltip. `by-type/` symlink views are a deferred nice-to-have.

**4. `pathForFilename` failing silently for non-canonical names.**
Returns `null`. Every caller must null-check. **Mitigation:** TypeScript `string | null` return forces check at type level; lint for `!` non-null assertions near `pathForFilename`.

**5. Search index onUnlink semantics.**
Under resolver-based E commit, unlink tolerated retype because `filenameExists()` would still find the filename elsewhere. Under B, unlink is simpler: if the file's gone from `store/{YYYY-MM}/`, it's gone. No need for `filenameExists`. Commit 4 simplifies this; commit 8 deletes the helper.

**6. Task descriptions in flow_runs may still have literal paths.**
Agent dispatch prompt generates fresh asset-listing on every dispatch (P4 dirty-tree change handles this with filenames). But OpenClaw's `flow_runs.state_json.description` may have been *persisted* with literal `/api/plugins/assets/file?path=...` URLs from the old era. **Mitigation:** migration script scans flow_runs (optional flag), rewrites old-format asset URLs to `/api/assets/{filename}` form. Only do this if spot-checks reveal live offenders.

**7. Test isolation is non-negotiable.**
Every test that writes to `~/.bakin/assets/` will corrupt the live instance post-migration, same as pre-migration. All tests continue to mock `getContentDir()`. Audit the dirty-tree test changes in `tests/scripts/post-discord.test.ts`, `tests/plugins/projects/*.test.ts` to confirm.

**8. Inbox ingestion + filename collisions.**
If a manual drop results in a canonical name that collides with an existing store file (vanishingly rare, but): regenerate `id8` until unique.

**9. Trash restore.**
Currently restores to `assets/{type}/{taskId}/{filename}`. Must restore to `store/{YYYY-MM}/{filename}` instead. Commit 4 handles this; tests assert the new behavior.

**10. Clipboard asset purge hook.**
`assets.purgeClipboardForTask` hook in `plugins/assets/index.ts` iterates `listAssets({ taskId })`. Under B, `listAssets` returns sidecars keyed by filename; the hook already does filename-based search `remove()`. Commit 4 verifies this keeps working.

## Tests & build cadence

After every commit:
- `pnpm vitest run` — full suite must be green.
- `pnpm build` — TypeScript + Next.js must compile.
- For commits 3, 4, 5: also manual smoke test the UI (create/retype/drop) to catch anything tests missed.

## Total effort estimate

- Commits 1–2: small, ~1–2 hours combined.
- Commit 3: medium, ~2 hours.
- Commit 4: large, ~4 hours (lots of test updates).
- Commit 5: medium, ~2 hours.
- Commit 6: medium, ~2 hours (script + test).
- Commit 7 (live migration): 30 minutes of careful execution.
- Commit 8: small, ~1 hour.
- Commits 9–10: ~2 hours combined.

Roughly **one focused day** of work, with natural checkpoints every 1–2 hours for rollback.
