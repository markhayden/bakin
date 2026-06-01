# Spec: Versioned Assets (images-first)

**Status:** Approved (2026-05-29) — in `/agent-skills:plan`
**Author:** interview-driven (markhayden + Claude)
**Related:** `.claude/specs/media-generation-adapter-architecture.md` (PR #382 — images plugin + media-generation adapter)

---

## 1. Objective

Refactor Bakin's asset system from **"an asset is a single file whose identity is its filename"** to **"an asset is a stable id with a directory of versioned files + a manifest."**

Today, every image iteration (generate → edit → edit) and every export lands as a separate top-level asset, cluttering the grid with N cards for one logical deliverable. The version *history* is valuable; the *flattening* of it into the grid is the bug. The new model shows **one card per asset (current version + a version-count badge)**; clicking opens a **drillable version history** with `promote-to-current` and `delete-version`.

The version spine is **type-agnostic** — every asset type can be versioned — with **images as the first consumer**. Text/markdown assets ride the same spine for free. This also fixes the **workspace-file sprawl**: agents re-saving an evolving source file (e.g. Margo saving `travel-plan.md` repeatedly) currently mint a new managed asset per save; under this model a re-save *versions the existing asset* (see §4.10).

Separately, fix a **double-bill** bug: a client (mcporter) timeout retries a billed image call that actually succeeded server-side, producing a duplicate billed generation.

### Non-goals / explicitly rejected
- **No migration, no back-compat, no shims, no dual-format readers.** Single user, two machines; dev box is disposable, prod has ~2 deletable assets. Clean cutover to a single on-disk format.
- **No git-as-version-store** — manifest+files is simpler, faster on every access pattern, and makes hard delete-version trivial (git's worst case). Rationale recorded in interview.
- **No branching/DAG** — linear versions; divergence (if ever needed) is modeled later as *fork-to-new-asset*, not an intra-asset graph.
- **No markdown-specific features** (diff/merge UI) in v1. Markdown inherits the generic version spine only.

---

## 2. Delivery: two PRs

| PR | Title | Lands on | Depends on |
|----|-------|----------|------------|
| **A — fast-track** | `fix(images): idempotent billed image calls (no double-bill on client retry)` | current `main` (filename identity) | none |
| **B — refactor** | `feat(assets): versioned assets (asset-as-directory)` | `main` after A | A (carries its idempotency forward, adapts result shape to `assetId`) |

A ships first (pure bug, financial impact). B is the large refactor. Per-commit checkpoint strategy is defined in `/agent-skills:plan`.

**Cutover (PR B is breaking, by design):** no migration code is written. On deploy, existing flat assets are **discarded** — dev box: `rm -rf ~/.bakin/assets` then it rebuilds empty; prod: delete the ~2 existing assets. The new directory layout is the only layout the code reads. A startup guard may log/scan for legacy flat files (a bare `…-id8.png` directly under a month shard) and warn, but does **not** migrate them.

---

## 3. PR A — Double-bill idempotency (fast-track)

### Root cause (verified)
- `OPENCLAW_IMAGE_PROCESS_TIMEOUT_MS = 600000` (10 min) — Bakin's subprocess timeout is **not** the limiter.
- Bakin's MCP server imposes **no** per-call timeout; exec tools run to completion.
- The give-up is on the **MCP client (mcporter)**: its call timeout is shorter than gpt-image-2's ~90s. Bakin finishes, saves the asset, logs `.ok`; mcporter returns a timeout; the agent retries → a second billed call also completes. (Confirmed in audit: task `033d9a50`, two `edit.ok`, duplicate assets `5cdc25a9` ≈ `189e8b37`.)

### Fix
**Idempotency in the image exec-tool layer (`plugins/images`)** — Bakin owns the policy; the adapter owns the provider call.

- **Signature** = hash of `{ taskId, op, sourceAssetId|null, promptHash, provider, model, width, height, quality }`.
- **In-flight registry** (`Map<sig, Promise<result>>`): an identical request arriving while one is in flight awaits the *same* promise — no second provider call.
- **Completed-result cache** (TTL ≈ 5 min, `Map<sig, {result, expiresAt}>`): an identical request arriving just *after* completion returns the cached result (the just-saved asset) — this is the exact ice-cream scenario.
- On completion (success), populate the cache; on failure, do **not** cache (allow a real retry). Preserve the existing "no auto-retry on billed calls" invariant — idempotency replaces retry, it does not add one.
- Cache is in-memory, process-local (single-user, single-process). No persistence needed.

### Complement (bakin-bits)
Bump Pixel's mcporter call timeout above ~120s so spurious client timeouts (and the safe no-op retries they trigger) are rarer.

### Notes for sequencing
On `main` the identity is still the filename, so PR A's cache returns `{ filename, ... }`. PR B changes the return to `{ assetId, version }`; the signature + cache mechanism is unchanged.

---

## 4. PR B — Versioned assets refactor

### 4.1 Identity & on-disk layout

- **assetId** = the existing conventional name `YYYYMMDD-<slug>-<id8>` (reuses `filename-id.ts` generation + the `YYYY-MM` shard derivation), but it now names a **directory**, not a file. The slug is frozen at v1 — it is an *id*, not a title; the manifest carries live meaning.

```
~/.bakin/assets/store/2026-05/
  20260529-ice-cream-a4d3f940/
    manifest.json
    v1.png   v1.thumb.jpg
    v2.png   v2.thumb.jpg
    v3.png   v3.thumb.jpg          # current (pointer in manifest)
    exports/
      instagram-feed-portrait.jpg  # derived from a version
      open-graph.jpg
```

- The per-file `.meta.json` sidecar is **gone**. `manifest.json` is the sole source of truth.
- Per-version thumbnail `vN.thumb.jpg` (images only; non-image versions fall back to a type icon — no thumb generated).

### 4.2 Manifest schema (`manifest.json`)

```jsonc
{
  "assetId": "20260529-ice-cream-a4d3f940",
  "type": "images",
  "source": { "kind": "generated", "path": null }, // kind: generated|upload|import|clipboard|workspace-file; path set for workspace-file/import (upsert key)
  "agent": "pixel",
  "taskId": "033d9a50",             // asset-level; mutable via relink; nullable
  "created": "<ISO>",
  "updated": "<ISO>",
  "currentVersion": 3,              // free pointer; may be < latest
  "description": "...",             // MIRRORS current version (recomputed on current change)
  "tags": ["instagram-feed-portrait", "openai", "gpt-image-2"], // MIRRORS current
  "versions": [
    {
      "version": 1,
      "file": "v1.png",
      "thumb": "v1.thumb.jpg",      // null for non-image
      "mimeType": "image/png",
      "size": 12345,
      "width": 1024, "height": 1536, // null for non-dimensional types
      "created": "<ISO>",
      "op": "generate",             // generate | edit | upload | import
      "parentVersion": null,        // lineage; may point to a non-adjacent / deleted version
      "tool": "bakin_exec_images_generate",
      "prompt": "...",              // null for upload/import
      "promptHash": "sha256:...",   // null when no prompt
      "generation": {               // null for upload/import
        "provider": "openai", "model": "gpt-image-2",
        "surface": "instagram-feed-portrait", "quality": "standard",
        "routeSource": "runtime", "routeReason": "..."
      }
    }
  ],
  "exports": [
    {
      "name": "instagram-feed-portrait", // key = surface (+format if ambiguous)
      "surface": "instagram-feed-portrait",
      "format": "jpg",
      "file": "exports/instagram-feed-portrait.jpg",
      "width": 1080, "height": 1350,
      "fromVersion": 3,             // provenance; may reference a deleted version
      "created": "<ISO>"
    }
  ]
}
```

- **Version numbers are stable, gaps allowed** — never renumber (would break `parentVersion`/`fromVersion` refs).
- **Exports are derived artifacts, not versions** — idempotent per `surface`(+`format`): re-export overwrites the entry, no pile-up.

### 4.3 Lifecycle operations & rules

| Op | Behavior |
|----|----------|
| `createAsset` | New asset, v1. (generate / upload / import) |
| `addVersion` | Append a new version derived from `currentVersion` (`parentVersion = currentVersion`), advance `currentVersion`, recompute asset-level `description`/`tags`. (edit; text-content edit) |
| `promoteVersion(v)` | Move `currentVersion` to `v` (any existing version). No file changes. Recompute display fields. |
| `deleteVersion(v)` | Remove `vN.*` files + manifest entry. **Cannot delete the last remaining version** (use delete-asset). **v1 deletable** like any other. If `v` was current → **auto-fallback to the highest-numbered remaining version**. Exports survive (their `fromVersion` becomes dangling provenance). |
| `addExport({fromVersion?, surface, format})` | Render `exports/<name>.<fmt>` from `fromVersion ?? currentVersion`; upsert manifest entry (idempotent per surface+format). |
| `deleteAsset` | Move whole `<assetId>/` dir → `.trash/<assetId>__deleted-<ts>/`. Restore moves it back. 7-day TTL cleanup. |

### 4.4 `ctx.assets` API (replaces `save`/`getByFilename`/`exists`/`fileRef`)

Only consumer today is the images plugin (5 call sites). Type-agnostic; the assets-plugin routes call the same service lib (one implementation).

```ts
interface AssetsAPI {
  createAsset(input: AssetCreateInput): Promise<{ assetId: string; version: 1 }>
  addVersion(assetId: string, input: AssetVersionInput): Promise<{ assetId: string; version: number }>
  promoteVersion(assetId: string, version: number): Promise<void>
  deleteVersion(assetId: string, version: number): Promise<void>
  addExport(assetId: string, opts: { fromVersion?: number; surface: string; format: string }): Promise<{ name: string; file: string }>
  getAsset(assetId: string): Promise<AssetManifest | null>
  list(filter?: { type?: AssetType; taskId?: string | null }): Promise<AssetSummary[]> // one entry per asset, current-version view
  resolveFile(assetId: string, version?: number): Promise<AssetFileRef>
  resolveExport(assetId: string, name: string): Promise<AssetFileRef>
  relink(assetId: string, taskId: string | null): Promise<void>   // asset-level manifest edit
  retype(assetId: string, type: AssetType): Promise<void>         // asset-level manifest edit
  exists(assetId: string): Promise<boolean>
  // Workspace-file / import upsert (§4.10) — keyed by source path, not assetId
  findBySourcePath(sourcePath: string): Promise<string | null> // → assetId
  upsertFromSource(sourcePath: string, input: AssetCreateInput): Promise<{ assetId: string; version: number; changed: boolean }>
}
```

`getByFilename` is removed entirely. Identity is `assetId`, full stop.

**Type blast radius:** new `AssetManifest`, `AssetSummary` (current-version view for `list`), `AssetVersion`, `AssetExport`, `AssetCreateInput`, `AssetVersionInput`, `AssetFileRef` replace `AssetMeta` / `SaveAssetParams`. The SDK type `AssetMeta` + **`AssetVariantMeta`** (`packages/sdk/src/types/index.ts:843,819` and the mirror in `packages/core/src/plugin-types.ts:565,542`) are redefined. **The `variants[]` concept is retired** — thumbnails are per-version in the manifest; the sibling `.opt.`/`.thumb.` files + `detectVariant()` go away. Every UI consumer (`asset-card`, `asset-detail`, `asset-renderer`, `assets-grid`, `assets-list`, `task-assets`) moves to the new `AssetSummary`/`AssetManifest` shape.

### 4.5 HTTP addressing (path segments; old routes removed)

```
GET /api/assets/<assetId>               → current version bytes
GET /api/assets/<assetId>/v/<n>         → specific version bytes
GET /api/assets/<assetId>/thumb         → current thumbnail (…/v/<n>/thumb)
GET /api/assets/<assetId>/export/<name> → export bytes
```

- **ETag keyed on `<assetId>:<currentVersion>`** (and the version for version/thumb routes) so promote/edit busts the browser cache. HTTP range support retained for video.
- **Removed (no shim):** `/api/plugins/assets/file?name=`, the `?filename=` list param, filename resolution in the host catch-all + the `assets.pathForFilename` hook (→ assetId resolver). List API returns `assetId` + current-version info; UI links by `assetId`.

### 4.6 Search

- **One row per asset, keyed by `assetId`** (never per-version).
- **`manifest.json` is the indexed unit and the reindex trigger.** `fileToId`: `assets/store/<month>/<assetId>/manifest.json → assetId`; returns `null` for version files, thumbs, `exports/`. Every mutation rewrites `manifest.json` → watcher `onSync` re-indexes that one row. `onUnlink(manifest.json)` → `ctx.search.remove(assetId)`.
- **Index the current version only**: `description`/`tags` from current; text `content` extraction reads the current version's file; visual `image_url` → current version file. `.trash/` excluded.

### 4.7 UI

**Shared atoms (built once, `plugins/assets/components/`), composed by all surfaces — no duplication:**
- `assetUrls.ts` — single source for all asset URLs (current / `/v/<n>` / `/thumb` / `/export/<name>`). Deletes the 3 hand-rolled URL builders in renderer/card/detail.
- `AssetRenderer` (exists) — media-by-type render; takes `assetId` + optional `version`. Reused by modal + route preview.
- `AssetThumb` — small thumbnail + icon fallback; used by card cover **and** version-timeline rows.
- `AssetMetaSummary` — agent/created/taskId/tags row; used by card + modal + route header.
- `AssetTypeIcon` + shared `TYPE_ICONS/COLORS` → `../lib/constants` (card's copy deleted).
- `ProvenanceChips` — provider/model/`routeSource`/surface chips; version rows + modal/route.
- `VersionRow` — one timeline entry (`AssetThumb` + `ProvenanceChips` + promote/delete actions).

**Three surfaces:**
- **Grid card** = `AssetThumb` + `AssetMetaSummary` + **version-count badge** (shown when >1) + action menu. Click → navigates to the detail route.
- **Modal (lightweight preview)** — unchanged surface (task panel + `asset-detail-modal` slot). `AssetRenderer`(current) + `AssetMetaSummary` + quick actions + "v3 · N versions" chip + **"View full history →"** link to the route. **No timeline, no version management.**
- **Route `/assets/<assetId>` (full detail)** — host shell (`packages/host/src/routes/assets.$assetId.tsx`) renders `<Slot name="page:/assets/:assetId">`, filled by the assets plugin (same pattern as `page:/assets`). `AssetRenderer`(current) + `AssetMetaSummary` + **version timeline** (`VersionRow[]`) + **exports** + lifecycle actions. URL-state-backed per the deep-linking convention; the only home for version management.

`AssetRenderer` (`asset-preview` slot) untouched beyond rendering current-by-assetId. Cross-plugin access stays via **slots**, not imports — nothing promoted to the SDK (no second importer).

**Delete UX:** context-driven + a scope choice on the asset-level dialog.
- Timeline row `[delete]` → that exact version (simple confirm, no scope picker).
- Card / asset-level delete → dialog **defaulting to "Delete whole asset (all N versions)"**, with a secondary "Just delete the current version (vN)" when >1 version. Single-version asset → plain "Delete asset?". Deleting current uses the auto-fallback rule.

### 4.8 Text/markdown

The modal's in-place text editor now **saves through `addVersion`** — text assets version exactly like images, via the same generic path (no special-casing). "Markdown out of v1" = no markdown-specific diff/merge UI; the generic version timeline applies.

### 4.9 Agent contract changes (bakin-bits — Pixel)

- Returned/accepted identifier is **`assetId`** everywhere: `generate`/`edit` return `assetId`; `edit`/`export` take `assetId`. Workflow-skill output schema field `image_filename` → **`assetId`**.
- **`edit` takes a managed `assetId` only** — `sourcePath` removed. Loose files (native multi-image compose) go through `import` first. Update `AGENTS.md` + `generate-image.md`.
- **`savePromptPacket` + `promptAssetFilename` removed** — the prompt + promptHash live per-version in the manifest. Update the workflow-skill output schema + docs.
- Bump Pixel's mcporter call timeout (PR A complement).

### 4.10 Save → version upsert (workspace files / `bakin_exec_assets_save`)

The markdown twin of the image fix. Today `bakin_exec_assets_save` has ambiguous dual behavior (a source path imports a *new* snapshot every call; a `store/...` path returns idempotently), and a separate, poorly-discovered `bakin_exec_assets_update_content` exists. Result: agents re-saving an evolving workspace file mint N managed assets.

**New behavior — `assets_save` upserts by source path:**
- `upsertFromSource(sourcePath, input)`:
  - No managed asset tracks this `sourcePath` → **create v1** (records `source: { kind: 'workspace-file', path }`).
  - An asset already tracks it → **content-hash the source**: changed → **`addVersion`** (advance current); identical → **no-op**, return current.
- Lookup is `findBySourcePath` over the in-memory index (`source.path` match). Single-user, single-process — a scan/index is sufficient.
- Re-saving `travel-plan.md` three times ⇒ **one asset, v1/v2/v3** (today: three assets).

**Tool surface collapse (reduce confusion that caused the bug):**
- `bakin_exec_assets_save` → the upsert-by-source entry (versions, never silently mints duplicates).
- `bakin_exec_assets_update_content` → **retired**; "update this asset's content" = `addVersion(assetId, content)`. The detail-modal text editor (§4.8) already routes through `addVersion`.
- Skill quick-ref (`skills/bakin/SKILL.md` and equivalents) updated to list the full asset verb set (save/version/promote/delete/export), eliminating the discoverability gap that hid the update path.

This applies to **all asset types**, not just text — it's a property of save-from-a-stable-source, orthogonal to images.

### 4.11 Cross-cutting details & edge cases

Found during the spec review pass; these are correctness-critical or were latent in the old model.

- **Atomic manifest writes.** `manifest.json` is the single source of truth, the search-reindex trigger, *and* read on every serve — a torn write would corrupt it or make the watcher read half a file. All manifest writes are **temp-file + `rename`** (atomic, same-fs), mirroring the secret-store pattern. Readers tolerate a transient parse failure (retry once / skip-this-tick), never crash. (Today's `writeFileSync` of the sidecar is non-atomic — do not carry that forward.)
- **Per-asset mutation lock.** Concurrent `addVersion`/`promote`/`delete`/`relink`/`retype` on the *same* asset would race on read-modify-write of the manifest (lost update, duplicate version number). Serialize all manifest mutations behind an **in-process async mutex keyed by `assetId`**. (Image idempotency dedups *identical* requests; this guards *different* concurrent mutations.) Single-process — an in-memory keyed lock suffices.
- **Live-update events (SSE).** The dashboard refreshes on `/api/events` (e.g. `task-assets.tsx` reopens `EventSource` and refetches). Every asset mutation (create / addVersion / promote / deleteVersion / addExport / delete / relink / retype) must **broadcast an asset-changed event carrying `assetId`** (+ `taskId`) so the grid, detail route, and task panel update live. Reuse the existing activity/audit broadcast path; do not rely solely on the chokidar watcher (which serves search, not the UI).
- **Retire the child-asset concept.** `includeChildren` (`list.ts`, `asset-index.ts`) + the `task-assets` `&includeChildren=true` exist only to surface **prompt-packet** child assets — which we're removing. Drop `includeChildren` and the child-linking logic; `task-assets` just lists assets by `taskId`. *(Plan phase: confirm prompt-packets were the only child producer; if another exists, reassess.)*
- **Clipboard purge.** The `purgeClipboardOnComplete` setting + `assets.purgeClipboardForTask` hook now match `source.kind === 'clipboard'` and delete the **whole asset** (dir) by `assetId`. Behavior preserved, keyed off the manifest `source`.
- **Inbox ingest.** A drop in `~/.bakin/assets/inbox/[type]/` ingests as a **new asset (v1)** via `createAsset` (type from the subdir hint), not a flat store file. `REQUIRED_ASSET_DIRS = [store, inbox, .trash]` unchanged.
- **relink / retype.** Asset-level manifest edits (mutate `taskId` / `type`), through the per-asset lock + atomic write, then re-broadcast + reindex. Exposed on `ctx.assets` and the existing routes.
- **Health checks.** `health-checks.ts` is rewritten for the new model: manifest parses; `currentVersion` resolves to an existing version; every `versions[].file`/`thumb` exists; no orphan files in the asset dir; exports resolve. The old "missing sidecar / orphaned variant" checks are retired.
- **Multi-image generate (`count`).** The runtime capability supports `count > 1`. If a single generate yields N images, each output becomes **its own asset (v1)** — they are parallel *alternatives*, not a lineage. (The images plugin tool stays single-image by default; this rule governs the behavior if `count` is ever surfaced.)
- **Export naming.** Export `name` = `<surface>` when one format per surface; if the same surface is exported in two formats, the key/name is `<surface>.<format>` to keep `/export/<name>` unique. Re-export of the same (surface, format) overwrites.

---

## 5. Testing strategy

Follow the repo's mandatory test isolation: mock both content-dir resolvers + OpenClaw home (or set `BAKIN_HOME`/`OPENCLAW_HOME` to temp), mock logger + watcher, `--isolate`.

**PR A:**
- Idempotency: in-flight dedup (concurrent identical → one provider call), TTL completed-cache (sequential identical within TTL → cached, no second call), distinct signatures → distinct calls, failure not cached, TTL expiry re-issues.

**PR B:**
- Manifest read/write round-trip; schema validation (Zod at the boundary).
- Lifecycle: createAsset, addVersion (parent + advance + display recompute), promoteVersion, deleteVersion (auto-fallback, can't-delete-last, v1 deletable, stable numbers/gaps, exports survive), addExport (idempotent per surface+format), deleteAsset/restore.
- Addressing routes: current/version/thumb/export, ETag busts on promote, range requests, 404s, path-traversal guard.
- Search: manifest-as-row, reindex on manifest change, current-only content/visual, remove on unlink.
- Save→version upsert (§4.10): new source path → v1; same path changed → addVersion; same path identical → no-op; `findBySourcePath` correctness; `assets_update_content` retirement (content update = addVersion).
- Images tools: generate→new asset, edit→addVersion on current, export→attached, import/upload→v1, assetId contract, idempotency carried from A.
- UI: shared atoms (assetUrls, AssetThumb, AssetMetaSummary, ProvenanceChips, VersionRow), card badge, modal "full history" link, route timeline + promote/delete + export, delete-scope dialog.
- Cross-cutting (§4.11): **concurrency** (two concurrent `addVersion` on one asset → distinct sequential versions, no lost update — exercises the per-asset lock); **atomic write** (interrupted/partial manifest write never yields a corrupt read); **events** (each mutation broadcasts an `assetId` event); clipboard-purge by `source.kind`; inbox drop → v1 asset; relink/retype manifest edits; rewritten health checks (manifest integrity, missing version file, orphan file); export-name disambiguation.
- Retire `includeChildren`/child-asset tests; `task-assets` lists by `taskId` only.
- Rewrite/replace existing `tests/plugins/assets/*` and `tests/plugins/images/*` to the new model (filename-identity + variant-detection + child-asset regression tests retired).

---

## 6. Docs & knowledge coverage (mandatory)

### Public docs site (`docs/`, Astro Starlight) — final step of PR B
Done **last**, after the UI is built, so screenshots reflect the real interface.
- **`docs/src/content/docs/using/assets.md`** — **rewrite** for the version model: one card per asset, version history, current pointer, promote/delete-version, delete-scope dialog, attached exports, save→version upsert. The asset model is changing fundamentally; this page must not describe the old flat-file model.
- **`docs/src/content/docs/using/images.md`** — **harden** the Images-plugin page (shipped thin with #382): generate/edit/export with `assetId` + versioning, the idempotency/no-double-bill behavior, `edit` takes `assetId` only (no `sourcePath`), no `savePromptPacket`.
- **Screenshots** — recapture the stale `using-assets--library.webp` (now shows version badges), `using-assets--detail-modal.webp` (modal is now the lightweight preview), and add the new **detail route** (version timeline) + trash, via `bun run docs:screenshots` + `docs:inject-screenshots`. Verify the full site builds: `bun run docs:build`.

### Generated reference & in-repo docs
- **`docs/.generated/*`** + `docs/src/content/docs/reference/generated/*` — regenerate (exec-tool params for edit/export, generate return shape, new `ctx.assets` surface) via `bun run docs:generate`; pass `docs:validate` + `docs:validate:routes`.
- **`docs/src/content/docs/extending/plugins/server-contracts.md`** (and `docs/plugin-authoring.md` if present) — update `ctx.assets` usage (no `save`/`getByFilename`; new version-aware surface + `upsertFromSource`).
- **`.claude/knowledge/`** — add `assets-versioning.md` (model, manifest, lifecycle, addressing, UI); cross-link from the media-generation spec.
- **`CLAUDE.md`** — update Storage (asset layout), Content Directory / `~/.bakin/` map (asset dirs + manifest), and any asset/sidecar references.
- **`README.md`** — update if it documents the asset model.

### Agent-facing docs
- **Agent skill quick-refs** (`skills/bakin/SKILL.md` and equivalents in agent packages) — list the full asset verb set (save-upsert / version / promote / delete / export); remove the gap that hid the update path and caused the workspace-file sprawl. Retire `bakin_exec_assets_update_content` from docs/tools.
- **bakin-bits** — Pixel `AGENTS.md`, `generate-image.md`, CHANGELOG (assetId, drop sourcePath + savePromptPacket, timeout bump).

---

## 7. Boundaries

**Always:** clean cutover (single on-disk format, no back-compat reader); **write the manifest atomically (temp+rename) and serialize per-asset mutations behind an `assetId` lock**; **broadcast an `assetId` event on every mutation** (UI liveness); keep the adapter boundary (provider details stay in `adapter-openclaw`, idempotency policy in the plugin); mock content-dir + OpenClaw home in every fs-touching test; update `.claude/knowledge` + docs for every change; preserve the "no auto-retry on billed calls" invariant.

**Ask first:** any data migration (there is none — clean slate); any scope expansion to markdown-specific features; deleting production data.

**Never:** reintroduce filename-as-identity or `getByFilename`; add shims / dual-format readers; allow a retry/idempotency gap that double-bills; build an intra-asset DAG; add a parallel asset-metadata store beside the manifest.

---

## 8. Deferred to `/agent-skills:plan`
- Per-commit checkpoint strategy (natural rollback points) for both PRs.
- Build sequencing (task breakdown, dependency order within PR B: model → service/API → routes → search → tools → UI → docs).
