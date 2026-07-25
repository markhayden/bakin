# Versioned Assets (asset-as-directory)

Deep reference for Bakin's asset model (canonical — the originating spec/plan
shipped and were retired).

## Model

An **asset is a stable id naming a directory** of versioned files plus a single
`manifest.json` (the sole source of truth — no per-file sidecars). Identity is
the `assetId`, never a filename.

```
~/.bakin/assets/store/<YYYY-MM>/<assetId>/
  manifest.json                 # asset-level meta + versions[] + exports[]
  v1.png  v1.thumb.jpg          # version files (images get a thumb)
  v2.png  v2.thumb.jpg
  v3.png  v3.thumb.jpg          # "current" is a pointer in the manifest
  exports/<surface>.<fmt>       # derived deliverables (NOT versions)
```

- **assetId** = `YYYYMMDD-<slug>-<id8>` (no extension). The `YYYY-MM` shard is
  derived from the date prefix by construction. `plugins/assets/lib/asset-id.ts`.
- **Versions are linear, append-only, stable-numbered with gaps allowed.**
  `currentVersion` is a free pointer (can point at any version). `parentVersion`
  records lineage. Never renumber.
- **`description` mirrors the current version** (stored per-version), so
  promote/delete losslessly restore the right card/search content. **`tags` are
  asset-level ONLY** — a pure organizational namespace ("folders" in the UI)
  that `addVersion`/`promoteVersion`/`deleteVersion` never touch. Versions
  carry no tags field (old manifests' version tags are stripped on parse; no
  migration). Machine provenance never goes into tags — it lives structurally
  in `op`/`source`/`generation`. Brand-conditioned generations (#419) also
  record `generation.{brandId, brandFingerprint}` — which brand, and which
  VERSION of it (content hash), conditioned the render; a changed brand is a
  new generation, never a dedupe hit. The V2 staleness hook.
- **Tag normalization** (`lib/tags.ts` — trim, lowercase, whitespace→hyphen,
  dedupe) is applied by **every** tag-writing path: `updateMetadata`, global
  ops, bulk apply, `createAsset`, upload, `assets_save`. One source of truth;
  routes never bypass it.
- **Exports are derived artifacts, not versions** — idempotent per surface (one
  export per surface; re-export overwrites).
- Markdown/text assets ride the same spine; "markdown out of v1" only meant no
  markdown-specific diff/merge UI.

## Key modules (`plugins/assets/lib/`)

- `asset-id.ts` — generate/validate assetId, shard derivation.
- `manifest.ts` — Zod `AssetManifest` schema + **atomic** read/write (temp+rename;
  tolerant reads). The manifest backs every serve AND is the search reindex
  trigger, so torn writes must never be observable.
- `manifest-cache.ts` — stat-validated read cache (see below). Read paths go
  through `getManifestCached`; mutations and `.trash/` reads call `readManifest`
  directly.
- `asset-lock.ts` — per-`assetId` async mutex serializing all manifest mutations
  (guards the version-number race). Different assets stay concurrent.
- `asset-service.ts` — `createAsset` / `addVersion` / `promoteVersion` /
  `deleteVersion` (auto-fallback, can't-delete-last) / `addExport` / `relink` /
  `retype` / `updateMetadata` (description write-through + tags replace) /
  `renameTagGlobal` + `removeTagGlobal` (store-wide sweeps; **trash skipped** —
  a restore may resurrect a stale tag, fixable with one edit) / `applyTags`
  (bulk; unknown ids reported, not fatal) / `deleteAsset` + `restoreAsset` /
  `getAsset` / `resolveFile` / `listAssets` / `findBySourcePath` /
  `upsertFromSource` (caller tags **union** into asset tags on version-upsert).
  All mutations: lock → mutate → atomic write.
- `tags.ts` — `normalizeTag` / `normalizeTags`, shared by server mutations AND
  the client TagInput (pure module, no node imports).
- `serve.ts` — `resolveAssetServe(segments)` for the HTTP serving route.
- `search-doc.ts` — `versionedAssetPath` + `buildVersionedAssetSearchDoc`.

## Manifest read cache (#392)

`lib/manifest-cache.ts` — in-memory `assetId → manifest`, **validated against
one `statSync` of `manifest.json` on every read** (token: `ino + size +
mtimeMs`). Match → cached manifest; mismatch → re-parse + refill; stat failure
→ evict + null. Because `writeManifestAtomic` is temp-file + rename, the inode
changes on every write — the token discriminates even same-millisecond writes
and restored timestamps. Drops list/serve parse cost from O(total assets) to
O(changed) while reads stay ground-truth: **no invalidation wiring, no watcher
dependency, no staleness by construction.** Contract details:

- **Fill ordering is stat → read → cache (pre-read token).** A write landing
  between stat and read costs one redundant re-parse later, never staleness.
  Don't "optimize" this order.
- **Mutations bypass the cache** (fresh `readManifest` under the asset lock) so
  a stale entry can never be persisted back to disk. `.trash/` reads also
  bypass (watcher-excluded, would never revalidate sensibly).
- Positive-only (404 probes insert nothing), unbounded (~KB/manifest), lazy
  fill. Cached manifests are **shared references, deep-frozen under
  `NODE_ENV=test`** — a consumer mutating one throws in the suite.
- `resolveFileFromManifest(manifest, version?)` resolves version files from an
  already-loaded manifest; `serve.ts` uses it so one request = one stat, not
  two parses. `resolveFile(assetId)` keeps the old signature on top of it.
- **Caching rule of thumb (repo-wide):** stat-validate when an authoritative
  file exists to validate against (this cache; adapter `sessionStoreCache`);
  write-through + watcher backstop only for *derived* indexes with no backing
  file (`task-asset-index`). Don't write-through what you can stat.

## Cross-plugin API (`ctx.assets`)

`createAsset`, `addVersion`, `addExport`, `resolveVersionFile` (version-aware) —
defined in `packages/core/src/plugin-types.ts` (`AssetsAPI`), implemented in
`src/lib/plugin-context-services.ts` (delegates to the asset service). Permission
mappings in `src/lib/plugin-permissions.ts` (`assets.write` for create/version/
export, `assets.read` for resolve). The images plugin is the primary consumer.

**Task-linked lookup (`assets.listByTask` hook, #434):** the plugin maintains an
in-memory `taskId → assetIds` index (`lib/task-asset-index.ts`) — lazy one-time
store scan, updated synchronously at the `writeManifestAtomic` choke point plus
the trash/restore paths; the watcher's `onSync`/`onUnlink` are the self-heal
backstop for externally edited manifests. Dispatch's "Attached Assets" block
consumes this hook (`buildDispatchAssetBlock` in `src/core/dispatch.ts`) and
renders assetIds; no search dependency, and core never walks `assets/store/`
directly.

## Consolidation (`consolidateAssets`, #203)

`lib/asset-consolidate.ts` — built for select-best flows (image-multi-select):
N variant assets collapse into ONE. Each loser's current file is absorbed as a
new version of the winner (`op: 'import'`, `tool: 'consolidate'`, the loser's
generation record travels), the winner's ORIGINAL version is restored as the
pointer, and the losers are soft-trashed. Absorbed versions carry
`consolidatedFrom: { assetId, version }` — that provenance field IS the
idempotency marker: re-runs skip already-absorbed losers. Consolidation NEVER
changes which version is current: each absorb captures the pointer
immediately before its addVersion and restores it immediately after, so the
pre-existing pointer always survives — the winner's original in the normal
flow, or a deliberately re-promoted absorbed variant (the selection-gate
re-select flow) across later retries. Concurrent invocations per winner are
serialized in-process, so timeout-retry overlap cannot double-absorb.
Failures are typed per-loser (`loser_not_found`, `self_reference`,
`winner_not_found`), never thrown; the exec tool's `ok` is winner-fatal only
(matched on the `winner_not_found` CODE — a self_reference failure carries
the winner's id but is not fatal).
Agent surface: `bakin_exec_assets_consolidate` (the 15th assets exec tool).
Enrichment runs once per absorbed version (`done+forVersion` guard) — a
vision-LLM call, not a re-bill of generation.

## HTTP addressing (path segments)

```
GET    /api/assets/<assetId>                # current version bytes
GET    /api/assets/<assetId>/v/<n>          # specific version
GET    /api/assets/<assetId>/thumb          # current thumbnail (…/v/<n>/thumb)
GET    /api/assets/<assetId>/export/<name>  # export bytes
```
Host route `packages/host/src/api/assets/[...path].ts` resolves via the
`assets.resolveServe` hook; ETag keyed on `assetId:currentVersion` (busts on
promote/edit). Plugin mutation routes under `/api/plugins/assets/versioned/*`
(`plugins/assets/routes/versioned.ts`), including
`PATCH /versioned/:assetId/metadata` (description and/or tags). Global tag ops
under `/api/plugins/assets/tags/*` (`routes/tags.ts`):
`POST /tags/rename {from,to}`, `POST /tags/remove {tag}`,
`POST /tags/apply {assetIds, add?, remove?}`.

## Search

One `bakin_assets` row **per asset, keyed by `assetId`**, built from the current
version. `manifest.json` is the indexed unit + reindex trigger: the watcher's
`onSync` reindexes on manifest write, `onUnlink` removes on manifest delete.
Version/thumb/export files never get their own row.

Doc fields beyond the basics: `tags` (comma-joined text, searchable + embedded)
plus `tags_facet` (keyword **array** — text fields can't produce per-tag terms
buckets); generation provenance as `surface` (searchable + in the embedding
templates — "instagram" matches `instagram-feed-portrait`) and
`provider`/`model` (**facet-only**, deliberately kept out of embeddings so they
don't flatten similarity across generated assets). Facets:
`asset_type, agent, tool, tags_facet, provider, model`. Any future schema/index
change bumps the content type's `schemaVersion` (in the assets registration —
currently 2) and blue/green-migrates in the background: queries stay on the
old physical table until the new one converges. No drops, no degraded window.
Enrichment fields (`caption`, `ocr_text`, `suggested_tags`, `transcript`,
`summary`) ride the search doc from the manifest's `enrichment` block, and
`media_url` (a `file://` URL) feeds the visual/audio embedding leg for raster
images and audio files.

**Enrichment health (health trust overhaul, 2026-07-24):** ONE self-healing coverage stat, never a per-asset nag. The assets check emits a single `enrichment-coverage` observation (evidence: total/wanting/enriched/missing/stale/failed/skipped/coveragePct); `skipped` assets leave the denominator. Advisory only below 60% coverage on 5+ enrichable assets (`ENRICHMENT_COVERAGE_ADVISORY_BELOW`); a missing engine stays a small advisory config callout. A daily self-heal pass (`incompleteEnrichmentAssetIds` → `enqueueEnrichmentBackfill`, NO force so nothing re-bills) re-attempts failed/missing/stale enrichment automatically.

## Live updates

Every mutation rewrites the manifest → the watcher emits `asset.changed`
(`asset.removed` on delete) over `/api/events`. The grid + detail route refetch
on these events. The grid coalesces event bursts through a 300ms trailing
debounce (`components/versioned/sse-refetch.ts`): N rapid mutations → one list
fetch per tab, removals fold a trash refetch into the same flush.

## Image tools (`plugins/images/lib/tools.ts`)

`generate` → `createAsset` (v1); `edit(assetId)` → `addVersion` on the current
version; `export(assetId)` → `addExport`; `import`/upload → `createAsset`. Tools
return `assetId`. **None of them write tags** — the old machine stamps
(`generated`/`edited`/`imported`/surface/provider/model) duplicated `op`/
`source`/`generation` and polluted the folder namespace; `import` passes the
caller's tags through untouched. **Billed calls are idempotent** via `idempotency.ts` (in-flight
dedup + ~5min TTL result cache, keyed by `{taskId, op, source, promptHash,
provider, model, w, h, quality, references}`) — prevents the client-timeout
double-bill without adding a retry. No `sourcePath` on edit (import loose files
first); no `savePromptPacket` (the prompt lives per-version in the manifest).

**`generation` provenance (per-version):** `provider`/`model`/`surface`/
`routeSource`, plus optional `quality` and `references`.
- `quality` is recorded **only on the shim path** (OpenClaw has no quality
  flag); native generations omit it. The schema field is optional; the
  asset-reuse match treats a missing quality as native-normal (#379).
- `references` (#418) is `Array<{assetId, version}>` — the reference/context
  images that conditioned the generation. Raw-path references passed to the image
  tools are auto-imported (source-path dedup) so every entry is a tracked asset.
  The asset **detail page renders a "References" row** of clickable chips linking
  to each referenced asset. References also participate in the idempotency key
  (same prompt + different references ≠ duplicate).

## save-by-source upsert

**Run-workspace saves (same-agent concurrency):** paths under
`~/.bakin/run-workspaces/` dedup on a task-stable virtual key
(`run:task:<taskId>/<relpath>`, derived by READING the run dir's
`.bakin-run.json` sidecar — never path parsing; missing/torn sidecar degrades
to real-path identity). The virtual key stores as `source.path`. **Staleness
gate:** a save whose origin run is not `running` in the ledger
(superseded/lost/settled/purged/unreadable — fail-closed) records its version
WITHOUT advancing `currentVersion` + audits `asset.stale_run_write_suppressed`
(`addVersion` `advanceCurrent:false`) — a zombie's late output never displaces
the corrective attempt's deliverable.

`bakin_exec_assets_save` → `upsertFromSource`: a re-save of the same source path
versions the existing asset (content-hash → no-op if unchanged), instead of
minting duplicates. The retired `bakin_exec_assets_update_content` tool is
replaced by this. (`includeChildren` on the list is the task hierarchy
`taskId--*`, unrelated and retained.)

**Agent-path translation (`BAKIN_AGENT_PATH_MAP`):** the save handler (and the
images plugin's reference inputs) run the agent-supplied absolute path through
`translateAgentPath` (`packages/core/src/agent-path-map.ts`) BEFORE any read —
`from=to[;from=to]` prefix map, boundary-safe, identity when unset. Exists for
the dev rig, where agents report container paths on a bind mount the host can
read; translation happens before `upsertFromSource` so the dedup `source.path`
is the stable host path. Production never sets it.

## UI (`plugins/assets/components/versioned/`)

Shared atoms (`asset-urls`, `AssetThumb`, `AssetMetaSummary`, `ProvenanceChips`,
`VersionRow`, `AssetTypeIcon`) compose the grid (`VersionedAssetGrid`, version
badge, navigate, live refresh) and the detail route (`VersionedAssetDetail`,
host route `assets.$assetId.tsx` → `page:/assets/:assetId` slot): current
preview + exports + version timeline (promote / delete-version) + delete-scope
dialog. Client types in `components/versioned/types.ts` (no server imports).

Index views (`?view=` URL-backed): `grid` (auto-fill tiles, 250px min) /
`list` / `tags` (**Folders** — `TagFolderGrid`: assets grouped per tag,
multi-tag assets in every matching folder, pinned Untagged bucket, recency
sort, kebab rename/delete wired to the global tag routes) / `trash`. Tag
filtering: `Tags` FacetFilter (`?tags=a,b`; `__untagged__` sentinel from
`tag-filter.ts`) with a `Folders / <tag> ✕` breadcrumb back to `?view=tags`.
Metadata editing: `AssetEditDrawer` (BakinDrawer; description + `TagInput`
chips with suggestions) opens from card hover pencil, list-row action, and the
detail Edit button → PATCH metadata. Bulk tagging: Select mode in grid/list +
floating bar → `POST /tags/apply`.
