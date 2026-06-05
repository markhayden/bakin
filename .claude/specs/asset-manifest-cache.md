# Asset Manifest Cache (#392) — mtime-validated MVP

Closes [#392](https://github.com/markhayden/bakin/issues/392) — cache asset manifests to avoid O(N) re-parse on every list/serve request.

## Objective

Asset reads re-parse `manifest.json` (readFileSync + JSON.parse + Zod, ~100µs each, all synchronous) on every request. `listAssets()` parses **every** asset's manifest per call (grid list route, `bakin_exec_assets_list`, clipboard purge); `resolveAssetServe()` parses per byte/thumb/export request — twice, via `getAsset` + `resolveFile`; `findBySourcePath()` (every `bakin_exec_assets_save`) walks all manifests; the `assets.listByTask` hook (#452) calls `getAsset` per linked asset every dispatch cycle. The grid refetches the full list on every `asset.changed` SSE event with no debounce.

Add a small **mtime-validated** in-memory cache so parse cost drops from O(total assets) to O(changed assets) per read, and debounce the grid's SSE refetch. Pure perf/tech-debt work: **zero observable behavior change** — reads always reflect disk.

Single-user machine. No backwards compatibility, no shims, no config flags, no observability machinery.

## Design — settled 2026-06-05 (interview + double-check)

**Validation-token cache, not an invalidation cache.** Entries are `assetId → { token, manifest }` where `token = { ino, size, mtimeMs }` from one `statSync` of `manifest.json`. Every read stats the file: token match → return cached manifest; mismatch/stat-failure → re-parse/evict. Correctness is checked against disk at read time, **never maintained by discipline** — no write-through, no watcher wiring, no choke-point coupling, no trash/restore special-casing, no onSync ordering constraints. Mutations, `manifest.ts`, and `index.ts` need zero changes.

### Why not the issue's proposed watcher-invalidated cache (considered alternatives)

- **Write-through + watcher backstop** (issue text; #452's `task-asset-index` pattern): faster steady state (zero syscalls on hit) but creates a permanent invariant — every future manifest-writing/renaming path must remember the cache — plus a watcher-liveness dependency (missed event = stale forever, phantom assets) and a two-tier consistency model. `task-asset-index` *needs* write-through because a derived taskId→assetIds index has no file to validate against. Manifests do.
- **Repo rule of thumb this establishes:** *mtime-validate when an authoritative file exists to stat (`sessionStoreCache` precedent); write-through only for derived indexes with no backing file (`task-asset-index`).* Goes in the knowledge doc.
- Cost accepted: one ~10µs stat per asset per list call (vs ~100µs+ parse). At 1k assets: ~10ms vs ~150ms event-loop block. If ever insufficient (~10k assets), write-through can be added inside the module without touching callers.

### Decisions

| Decision | Choice |
|---|---|
| Validation token | `ino + size + mtimeMs` from one `statSync`. `writeManifestAtomic` is temp-file + rename, so **ino changes on every write** — immune to same-millisecond writes, restored old timestamps, delete-recreate. |
| Fill ordering | **stat → read → cache with the pre-read token.** Token-at-or-before-content means the worst race outcome is one redundant re-parse, never staleness. Stat-after-read could mask an interleaved write. |
| Stat failure | Evict entry, return null (covers trash, external delete; no dead-entry growth). |
| Read coverage | All store reads route through the cached get-or-fill: `getAsset`, `listAssets`, `getAssetSummary`, `resolveFile`, `findBySourcePath`. `serve.resolveAssetServe` passes its manifest into the version-resolution step (kills the existing double read — 3-line tidy). |
| Stays uncached | Mutations (read disk fresh under `withAssetLock` — unchanged code); `.trash/` reads; health-check/doctor reads (occasional, direct parse is correct there). |
| Entry policy | Positive-only (never cache null — no growth from 404 URL probes), unbounded Map (~KB per manifest; an LRU smaller than the store would thrash under `listAssets`). |
| Fill strategy | Lazy. First `listAssets` warms the store; no eager scan. |
| Cached-object safety | Shared references. `Object.freeze` entries **in test mode only** (`NODE_ENV=test`) so any future consumer mutation throws in the suite instead of corrupting silently. No consumer mutates today (audited: routes serialize, images tools read-only). |
| Concurrency | Get-or-fill is fully synchronous (no awaits inside) — no interleaving on Bun's single thread. Mutations stay behind the per-asset lock, untouched. |
| Grid SSE refetch | ~300ms trailing debounce coalescing `asset.changed`/`asset.removed` bursts (shared timer also covering `fetchTrash`); timer cleaned up on unmount. Direct user actions (upload/restore) keep their immediate fetches. |
| Multi-process consumers | `scripts/lib/post-channel.ts` et al. get a per-process cache validating against shared disk — always correct, no coordination. |
| Test isolation | `__resetManifestCache()` test-only export (hygiene). mtime validation self-corrects across content-dir swaps (different path → different ino → refill), so **no audit of existing tests is required.** |

## Module Contract — `plugins/assets/lib/manifest-cache.ts` (new, ~50 lines)

```ts
/** Stat-validated read: returns the cached manifest iff manifest.json's
 *  ino+size+mtimeMs match; otherwise re-reads via readManifest, refills
 *  (positive-only), and returns fresh. Stat failure evicts and returns null. */
getManifestCached(assetId: string, assetDirAbs: string): AssetManifest | null

/** @internal Test-only. */
__resetManifestCache(): void
```

Imports `readManifest` + type from `./manifest` (one-way; manifest.ts never imports back). `asset-service.ts` read paths swap `readManifest(dir)` → `getManifestCached(assetId, dir)`; mutation paths keep `readManifest` as-is.

## Affected Files

- `plugins/assets/lib/manifest-cache.ts` — **new**
- `plugins/assets/lib/asset-service.ts` — read paths only (`getAsset`, `listAssets`, `findBySourcePath`); mutations untouched
- `plugins/assets/lib/serve.ts` — pass resolved manifest through to version resolution (remove double read)
- `plugins/assets/components/versioned/VersionedAssetGrid.tsx` — debounced SSE refetch
- `.claude/knowledge/assets-versioning.md` — cache contract + the mtime-vs-write-through rule of thumb
- Tests: new `tests/plugins/assets/manifest-cache.test.ts`; targeted additions to `asset-service.test.ts` / `serve.test.ts` / grid test

**Explicitly untouched:** `manifest.ts`, `plugins/assets/index.ts`, all mutation functions, trash/restore, health checks, legacy filename paths.

## Acceptance Criteria

1. **Parse-count proof (RED-first, fs-spy style like #452):** repeated `listAssets` calls re-parse nothing when manifests are unchanged (stats only); second serve resolve for the same asset performs zero manifest file reads.
2. **Freshness without events:** mutate via any path (`addVersion`/`promote`/`relink`/`deleteAsset`/`restoreAsset`) → immediate read reflects it (token mismatch → re-parse). **External hand-rewrite of manifest.json → immediate read reflects it** — no watcher involvement anywhere.
3. **Same-millisecond writes:** two `writeManifestAtomic` calls with identical mtimeMs (forced) are both observed (ino discriminates).
4. **Eviction:** trashed/externally-deleted asset → read returns null, entry evicted; unknown assetIds insert nothing.
5. **Test-mode freeze:** mutating a returned manifest throws under `NODE_ENV=test`.
6. **Grid coalescing:** burst of SSE events within the window → exactly one list fetch; timer cleanup on unmount.
7. Full suite green (`bun run test`), `bun run build` green.
8. **Manual gold-standard e2e** (dockerized rig `bun run instance dev` + Playwright): grid load with thumbnails; upload → add-version → promote → trash → restore round-trip with live UI updates; real-agent `bakin_exec_assets_save` loop showing coalesced refresh; hand-edit a manifest in the rig home → next read/UI reflects it; zero errors in server log.

## Testing Strategy

Per CLAUDE.md rules: mock both content-dir resolvers + OpenClaw home into temp dirs, mock logger/watcher, `--isolate`, cleanup in `afterAll`. `__resetManifestCache()` in setups. Parse-count assertions via fs spies on `readFileSync` filtered to manifest paths (#452's op-count pattern). Grid debounce via the existing component-test pattern (`asset-thumb.test.tsx`).

## Commit Strategy (natural rollback checkpoints)

Dependency-ordered; each commit leaves the suite green and is independently revertible:

1. `test(assets): parse-count + freshness specs for manifest cache (RED)` — failing specs encoding criteria 1–4 against current behavior
2. `perf(assets): mtime-validated manifest cache behind asset-service read paths` — module + read-path swap + serve double-read tidy; turns commit 1 green. Reverting restores plain disk reads with no residue.
3. `perf(assets): debounce VersionedAssetGrid SSE refetch` — client-side, fully independent
4. `docs(assets): assets-versioning knowledge update (cache contract + caching rule of thumb)`

## Boundaries

- **Always:** stat-before-read fill ordering; positive-only entries; mutations read disk fresh.
- **Never:** cache `.trash/` reads; watcher/event wiring for the cache; stat-tracking machinery; touching `manifest.ts`/`index.ts`/mutation paths; fixing the `plugins/images` → `assets/lib` direct-import boundary violation here (pre-existing — file as observed follow-up in the PR, like #452's `.meta.json` note).
- **Ask first:** if implementation reveals a consumer mutating a cached manifest (would force clone-on-read), or if the serve tidy turns out to require reshaping `resolveFile`'s public signature beyond an optional parameter.
