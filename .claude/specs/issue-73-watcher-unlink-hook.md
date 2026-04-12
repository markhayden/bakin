---
issue: 73
title: Plugin harness ↔ search consistency — watcher hooks, file-backed content types, delta reindex
status: approved
scope: expanded (beyond original issue)
---

# Issue #73 — Plugin harness ↔ search consistency

## Background

The original issue asked for a watcher unlink hook in the assets plugin so filesystem-level deletions remove records from the Antfly `bakin_assets` index immediately instead of waiting for the 24h orphan-cleanup timer. Verification showed the gap is wider:

- **Three plugins** hold the filesystem-delete gap, not one: `assets`, `projects`, `workflows` (instances + definitions).
- **Two of them** (`projects`, `workflows`) also have the filesystem-**add/update** gap that commit `5eff959` already fixed for `assets`. If an agent writes a new project markdown via direct file I/O instead of the REST route, it silently misses the search index.
- **`tasks`, `team`, `schedule`** are *not* affected — they're backed by OpenClaw (SQLite or `~/.openclaw/`), which the Bakin watcher does not cover, and their REST paths already own search mutations.
- **The watcher's non-asset file filter** (`watcher.ts:90`) excludes YAML, so workflow definitions don't fire events at all under the current code — a prerequisite blocker for any fix touching workflows.

The user-stated goal is bigger than a point fix: establish a **thorough, consistent pattern** for plugin ↔ search integration so the watcher is the primary consistency mechanism, not a 24h backstop. Reduce boilerplate for plugin authors. Reduce unnecessary full reindexes.

## Objective

Make the watcher the authoritative real-time consistency mechanism between the filesystem and the search index. Reduce each file-backed plugin's search wiring to a single `registerFileBackedContentType()` call. Shrink `buildIndex()` on startup to a cheap mtime-based delta reconciliation. Demote orphan cleanup to a rarely-running backstop.

## Non-goals

- No OpenClaw-backed plugin (`tasks`, `team`, schedule jobs) gets watcher hooks — they're not file-backed under `~/.bakin/`.
- No backwards-compatibility shims for `ctx.search.registerContentType` — per CLAUDE.md this is a single-user machine; migrate directly and update callers in the same commit.
- No migration of the Antfly table schema. Existing tables stay. DB wipe is an acceptable recovery path if migration goes sideways.
- No cross-plugin unlink abstraction beyond the helper — we don't invent a new plugin lifecycle phase or a new hook category.

## Scope by plugin

| Plugin | File-backed under `~/.bakin/`? | Action |
|---|---|---|
| `assets` | yes (`assets/**`) | Migrate to helper with `onSync`/`onUnlink` escape hatches (binary/sidecar/`.trash/` logic). |
| `projects` | yes (`projects/*.md`) | Migrate to helper, straightforward mapper. |
| `workflows` instances | yes (`workflows/instances/*.json`) | Migrate to helper. |
| `workflows` definitions | yes (`workflows/definitions/*.{yaml,yml}`) | Migrate to helper (requires watcher YAML filter). |
| `tasks` | no (OpenClaw SQLite) | No change. |
| `team` | no (`~/.openclaw/`) | No change. |
| `schedule` | no (OpenClaw jobs + self-cleaning sidecar aggregate) | No change. |

## Design

### The helper: `ctx.search.registerFileBackedContentType()`

One blessed API that plugins call to register a file-backed search content type. The helper internally:

1. Calls `ctx.search.registerContentType()` with the schema fields.
2. Registers a watcher sync hook (scoped to the declared file patterns, respecting excludes).
3. Registers a watcher unlink hook (same scoping).
4. Drives the initial index build at plugin activation via `performStartupReconcile()` (see Phase 4).

Proposed signature (exact surface finalized in Phase 1):

```typescript
ctx.search.registerFileBackedContentType({
  // Standard content-type fields (type, table, fields, facets, etc.)
  ...contentTypeFields,

  // File scoping
  filePatterns: string[],           // globs relative to contentDir
  excludePatterns?: string[],       // e.g. ['**/.trash/**']

  // Standard case: helper calls these automatically
  fileToId: (relPath: string) => string | null,       // null = skip
  fileToDoc: (relPath: string, content: string) => Promise<Doc | null>,

  // Escape hatches for complex cases (assets uses these)
  onSync?: (relPath: string, content: string) => Promise<void>,
  onUnlink?: (relPath: string) => Promise<void>,

  // Startup
  buildOnStartup?: boolean,         // default true
})
```

Semantics:

- If `onSync` is provided, the helper invokes it instead of the default `fileToDoc → ctx.search.index` flow. The plugin takes full control.
- If `onUnlink` is provided, same story for unlinks.
- Escape hatches let `assets` live inside the helper while still handling its binary/sidecar pairing and `.trash/` filtering.
- The helper swallows hook errors (logs + continue), matching the existing watcher hook semantics.

### REST routes remain authoritative

REST routes keep their direct `ctx.search.index()` / `ctx.search.remove()` calls. The watcher hooks are a safety net for non-REST writes (manual file drops, rsync, external agents). Both paths converge on idempotent index operations. Rationale: `awaitWriteFinish: 300ms` in the watcher introduces a lag between write and hook firing; REST callers that expect immediate search consistency can't wait on it.

### Phase 4 — mtime-based delta reconciliation

Each file-backed content type currently owns a `buildIndex()` that scans the filesystem from scratch on plugin activation. Replace with a delta reconciliation driven by the helper:

1. Load current index state: `{ id → mtime }` via a search query.
2. Scan filesystem matching `filePatterns \ excludePatterns`.
3. For each file: if `fs.mtime > index.mtime`, re-index. If in index but not on disk, remove.
4. Stop early if counts match and no drift found.

In a steady-state system with watcher hooks wired, this loop finds zero drift and exits in a handful of stat calls. The 24h orphan cleanup timer gets demoted to a 7-day paranoia backstop.

### Watcher filter widening

Change the filter at `watcher.ts:90` from `/\.(md|json|jsonl)$/` to `/\.(md|json|jsonl|ya?ml)$/`. Required for workflow definitions.

## Phased implementation

### Phase 1 — Foundation
1. Widen watcher file filter to include `.yaml`/`.yml`.
2. Formalize watcher hook contract in `watcher.ts` header comments: signatures, firing order, error semantics, `awaitWriteFinish` lag note.
3. Implement `ctx.search.registerFileBackedContentType()` in the search subsystem: content-type registration + sync/unlink hook wiring + startup reconcile driver + escape hatches.
4. Implement `performStartupReconcile(contentType)` — the mtime delta loop. Unit-tested against a mock adapter.

### Phase 2 — Migrate projects
5. Convert `projects` to the helper. Keep REST-route `index`/`remove` calls (authoritative). Delete its bespoke `buildIndex()` in favor of the helper-driven reconcile.

### Phase 3 — Migrate workflows
6. Convert workflow **instances** to the helper.
7. Convert workflow **definitions** to the helper (depends on Phase 1 YAML filter).

### Phase 4 — Migrate assets
8. Convert `assets` to the helper using `onSync` + `onUnlink` escape hatches. The unlink path is where issue #73's original ask lands: binary delete → `removeAsset()` + `ctx.search.remove()`; sidecar-only delete → no-op; `.trash/` skipped.

### Phase 5 — Orphan cleanup demotion
9. Extend orphan-cleanup interval to 7 days (constant or setting). Update its log output to "backstop scan" language. Document it as "catches drift from crashes mid-unlink, not a primary sync mechanism."

### Phase 6 — Docs
10. Update `.claude/knowledge/search-system.md` with the new architecture: three write paths (REST, watcher, startup reconcile), how they converge, race semantics, orphan cleanup as backstop.
11. Add an "Adding a file-backed content type" section with a worked example using the helper.
12. Update CLAUDE.md's "Search Indexing" key-pattern paragraph to reference the helper as the canonical API.

## Commit strategy

One PR, six commits, each independently buildable and runnable. Phase boundaries = commit boundaries, giving natural rollback points.

1. `feat(core): add YAML to watcher file filter and formalize hook contract`
2. `feat(search): add registerFileBackedContentType helper with mtime delta reconcile`
3. `refactor(projects): migrate to registerFileBackedContentType`
4. `refactor(workflows): migrate instances and definitions to registerFileBackedContentType`
5. `refactor(assets): migrate to registerFileBackedContentType with escape hatches (closes #73)`
6. `chore(search): demote orphan cleanup to 7-day backstop + update docs`

Commit 5 is the one that closes the original issue. Commits 3–4 are the "invisible" fixes for the wider gap. If any phase regresses, `git revert` on that single commit recovers cleanly.

## Acceptance criteria

**Original issue (#73):**
1. Deleting any asset binary from the filesystem removes its `bakin_assets` row within one event loop tick.
2. Search queries stop returning the deleted asset immediately, not after 24h.
3. `listAssets()` no longer returns the deleted asset immediately (local tracker stays consistent).
4. Unlink of a `.meta.json` alone does **not** call `ctx.search.remove`.
5. Unlink inside `.trash/` does **not** call `ctx.search.remove`.
6. The unlink hook fires exactly once per deletion.

**Expanded scope:**
7. Dropping a project `.md` into `~/.bakin/projects/` via direct file write (no REST call) results in a `bakin_projects` row within one tick.
8. Same for workflow instances and definitions.
9. Deleting any of the above from the filesystem removes its row within one tick.
10. `registerFileBackedContentType` is the only API plugins need to call for standard file-backed search content types.
11. `performStartupReconcile` on a steady-state server finishes with zero index mutations and < 50ms runtime.
12. Orphan cleanup runs at a 7-day interval, logs "backstop scan", and finds zero orphans during normal operation.

**Plugin authoring:**
13. Adding a new file-backed content type to a plugin takes one helper call and a mapper function. No direct watcher hook registration required.
14. `.claude/knowledge/search-system.md` contains an end-to-end example.

## Test plan

### Unit
- `tests/core/watcher.test.ts` — existing. Add a YAML file case.
- `tests/search/register-file-backed-content-type.test.ts` — new. Cover: standard path (fileToId + fileToDoc), escape-hatch path (onSync/onUnlink), pattern matching, exclude matching, startup reconcile with mock adapter.
- `tests/plugins/projects/sync-hook.test.ts` — new. Drop a file into the projects dir (temp), assert index call; delete it, assert remove call.
- `tests/plugins/workflows/sync-hook.test.ts` — new. Same for instances and definitions.
- `tests/plugins/assets/unlink-hook.test.ts` — new. Three cases: binary delete, sidecar-only delete (no-op), `.trash/` delete (no-op).

### Integration
- `tests/integration/search-watcher-sync.test.ts` — new. Spin up the watcher against a temp contentDir with a mock search adapter. For each migrated plugin, write a file, assert it lands in the index; delete it, assert it leaves the index. Verifies the full real wiring, not mocks.

### Regression
- All existing assets, projects, workflows tests must pass unchanged after migration.

### Manual smoke
- Start Bakin. Drop a project markdown directly into `~/.bakin/projects/`. Hit `/api/plugins/projects/search?q=<title>`. Must return it within ~1s (awaitWriteFinish + index flush).
- Same for a workflow instance JSON.
- Same for a workflow definition YAML.
- `rm` an asset binary. Hit asset search. Must not return it.

## Files touched (estimated)

- `src/core/watcher.ts` — regex + contract docs (~15 lines).
- `packages/core/src/search/` — `registerFileBackedContentType` helper (~200 lines), `performStartupReconcile` (~80 lines).
- `packages/core/src/search/content-type-types.ts` — type additions.
- `plugins/projects/index.ts` — migration (~−40, +20 lines).
- `plugins/workflows/index.ts` — migration (~−60, +30 lines).
- `plugins/assets/index.ts` — migration with escape hatches (~−30, +40 lines).
- `src/core/search-cleanup.ts` — interval constant + log wording (~5 lines).
- `.claude/knowledge/search-system.md` — architecture update + worked example (~+80 lines).
- `CLAUDE.md` — one-paragraph key-pattern update (~5 lines).
- Tests — 5 new files, ~400 lines total.

Rough total: ~1000 LOC added, ~130 LOC removed, 10 files modified, 6 files created.

## Open risks

- **Helper shape for assets.** The escape-hatch design (`onSync`/`onUnlink`) is unvalidated until commit 5. If it turns out to be too constraining, we either widen the hatches or leave assets on the raw `registerContentType` path with a documented justification. Decision deferred to build phase; falling back to raw registration for assets only does not invalidate the migration for projects and workflows.
- **Startup reconcile cost on first boot after migration.** First boot will see an index with the old schema and a filesystem that may have drifted during development. Acceptable: user approved wiping `bakin_*` tables as a recovery path. The `bakin doctor` command (if it covers reindex) or a manual helper will reseed.
- **YAML files other than workflow definitions.** Widening the watcher filter to YAML means every YAML under `~/.bakin/` fires events and gets broadcast via SSE. Currently there are no other YAML files in the tree; if plugins start dropping YAML elsewhere, SSE traffic grows. Low risk, not worth a pre-filter.
