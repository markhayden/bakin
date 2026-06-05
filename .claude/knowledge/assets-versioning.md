# Versioned Assets (asset-as-directory)

Deep reference for Bakin's asset model. Spec: `.claude/specs/versioned-assets.md`.
Plan/history: `.claude/specs/versioned-assets-plan.md`.

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
- **Display fields** (`description`, `tags`) **mirror the current version**, so
  promote/delete losslessly restore the right card/search content. Per-version
  `description`/`tags` are stored on each version for this.
- **Exports are derived artifacts, not versions** — idempotent per surface (one
  export per surface; re-export overwrites).
- Markdown/text assets ride the same spine; "markdown out of v1" only meant no
  markdown-specific diff/merge UI.

## Key modules (`plugins/assets/lib/`)

- `asset-id.ts` — generate/validate assetId, shard derivation.
- `manifest.ts` — Zod `AssetManifest` schema + **atomic** read/write (temp+rename;
  tolerant reads). The manifest is read on every serve AND is the search reindex
  trigger, so torn writes must never be observable.
- `asset-lock.ts` — per-`assetId` async mutex serializing all manifest mutations
  (guards the version-number race). Different assets stay concurrent.
- `asset-service.ts` — `createAsset` / `addVersion` / `promoteVersion` /
  `deleteVersion` (auto-fallback, can't-delete-last) / `addExport` / `relink` /
  `retype` / `deleteAsset` + `restoreAsset` / `getAsset` / `resolveFile` /
  `listAssets` / `findBySourcePath` / `upsertFromSource`. All mutations: lock →
  mutate → atomic write.
- `serve.ts` — `resolveAssetServe(segments)` for the HTTP serving route.
- `search-doc.ts` — `versionedAssetPath` + `buildVersionedAssetSearchDoc`.

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
(`plugins/assets/routes/versioned.ts`).

## Search

One `bakin_assets` row **per asset, keyed by `assetId`**, built from the current
version. `manifest.json` is the indexed unit + reindex trigger: the watcher's
`onSync` reindexes on manifest write, `onUnlink` removes on manifest delete.
Version/thumb/export files never get their own row.

## Live updates

Every mutation rewrites the manifest → the watcher emits `asset.changed`
(`asset.removed` on delete) over `/api/events`. The grid + detail route refetch
on these events.

## Image tools (`plugins/images/lib/tools.ts`)

`generate` → `createAsset` (v1); `edit(assetId)` → `addVersion` on the current
version; `export(assetId)` → `addExport`; `import`/upload → `createAsset`. Tools
return `assetId`. **Billed calls are idempotent** via `idempotency.ts` (in-flight
dedup + ~5min TTL result cache, keyed by `{taskId, op, source, promptHash,
provider, model, w, h, quality}`) — prevents the client-timeout double-bill
without adding a retry. No `sourcePath` on edit (import loose files first); no
`savePromptPacket` (the prompt lives per-version in the manifest).

## save-by-source upsert

`bakin_exec_assets_save` → `upsertFromSource`: a re-save of the same source path
versions the existing asset (content-hash → no-op if unchanged), instead of
minting duplicates. The retired `bakin_exec_assets_update_content` tool is
replaced by this. (`includeChildren` on the list is the task hierarchy
`taskId--*`, unrelated and retained.)

## UI (`plugins/assets/components/versioned/`)

Shared atoms (`asset-urls`, `AssetThumb`, `AssetMetaSummary`, `ProvenanceChips`,
`VersionRow`, `AssetTypeIcon`) compose the grid (`VersionedAssetGrid`, version
badge, navigate, live refresh) and the detail route (`VersionedAssetDetail`,
host route `assets.$assetId.tsx` → `page:/assets/:assetId` slot): current
preview + exports + version timeline (promote / delete-version) + delete-scope
dialog. Client types in `components/versioned/types.ts` (no server imports).
