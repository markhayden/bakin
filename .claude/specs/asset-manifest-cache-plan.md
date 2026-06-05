# Plan — Asset Manifest Cache (#392)

Spec: `.claude/specs/asset-manifest-cache.md`. Branch: `perf/asset-manifest-cache` off `main`.

## Dependency graph

```
T1 (RED tests) ──► T2 (cache module + read paths) ──► CHECKPOINT A ──► T4 (docs)
                                                   └► T3 (grid debounce) ──► CHECKPOINT A
CHECKPOINT A ──► T5 (manual gold-standard e2e) ──► T6 (PR)
```

T3 is independent of T1/T2 (client-only) but lands after so the e2e pass exercises both together. Vertical slices: T2 is one complete server path (cache → every read route → proof tests green); T3 one complete client path.

## Tasks

### T1 — RED parse-count + freshness specs — commit 1: `test(assets): parse-count + freshness specs for manifest cache (RED)`

New `tests/plugins/assets/manifest-cache.test.ts` (standard temp-dir + dual content-dir mocks + logger/watcher mocks, `--isolate`), using `spyOn(fs, 'readFileSync')` op-counting (idiom: `tests/core/task-store-index.test.ts:155`). Specs encode spec criteria 1–5:

1. Repeated `listAssets` over an unchanged store: manifest `readFileSync` count is N on first call, **0 on subsequent calls**
2. Second `resolveAssetServe(['<id>','thumb'])` for same asset: **0 manifest reads** (also covers the double-read tidy: first call ≤1 read)
3. Freshness via every mutation path: `addVersion`, `promoteVersion`, `relink`, `deleteAsset`, `restoreAsset` → immediate read reflects change
4. External hand-rewrite of `manifest.json` (no watcher running) → immediate read reflects it
5. Same-`mtimeMs` double-write (force with `utimesSync` after second write) → both observed (ino discriminates)
6. Eviction: trashed/deleted asset reads null + no entry; unknown assetId inserts nothing
7. Test-mode freeze: mutating a returned manifest throws

**AC:** specs 1, 2, 5, 7 FAIL on current code (red); 3, 4, 6 pass (current behavior — they pin the no-regression contract). Committed with `it.todo`-free failing state? No — failing tests can't land green. **Resolution:** commit 1 contains the test file with the not-yet-passing specs marked `it.skip` + a `// RED: unskip in commit 2` marker; commit 2 unskips. Suite stays green at every checkpoint while preserving RED-first evidence in history.
**Verify:** `bun test tests/plugins/assets/manifest-cache.test.ts --isolate` — skipped specs counted, others green; full suite untouched.

### T2 — Cache module + read-path swap — commit 2: `perf(assets): mtime-validated manifest cache behind asset-service read paths`

1. **`plugins/assets/lib/manifest-cache.ts`** (new, ~50 lines): `getManifestCached(assetId, assetDirAbs)` — `statSync` (try/catch; failure → evict, null) → token compare (`ino`,`size`,`mtimeMs`) → hit: return cached; miss: `readManifest`, fill positive-only **with pre-read token**, `NODE_ENV=test` → deep-`Object.freeze` before storing. `__resetManifestCache()` export. One-way import from `./manifest`.
2. **`asset-service.ts` read paths:** `getAsset` delegates to `getManifestCached`; `listAssets` + `findBySourcePath` swap their inner `readManifest(join(monthDir, assetId))` for the cached get (dir walk unchanged). Mutations/trash/`listTrashedAssets` keep `readManifest` verbatim.
3. **Serve double-read tidy:** extract internal `resolveFileFromManifest(manifest, assetId, version?)`; `resolveFile` (public signature unchanged — 3 external consumers) = `getAsset` + that helper; `serve.resolveAssetServe` calls the helper with the manifest it already holds.
4. Unskip T1's RED specs.

**AC:** all manifest-cache specs green; existing `asset-service.test.ts`, `serve.test.ts`, `versioned-routes.test.ts`, `versioned-exec-tools.test.ts`, `clipboard-purge.test.ts`, integration `assets-serve-route.test.ts` pass **unmodified** (zero-behavior-change proof); no new exports from asset-service; `manifest.ts`/`index.ts` diff-clean.
**Verify:** `bun run test` full suite; `git diff --stat` confirms file scope matches spec's affected-files list.

### CHECKPOINT A — after T2+T3: full suite + `bun run build` green; review diff against spec boundaries (anything touched outside the affected-files list = stop and reassess).

### T3 — Grid SSE debounce — commit 3: `perf(assets): debounce VersionedAssetGrid SSE refetch`

In `VersionedAssetGrid.tsx` SSE handler: single trailing ~300ms timer coalescing `asset.changed`→`fetchAssets` and `asset.removed`→`fetchAssets`+`fetchTrash` (removed events set a flag so the flush includes trash); timer ref cleared on unmount alongside `es.close()`. Direct-action fetches (upload/restore/trash ops) untouched. Component test (pattern: `asset-thumb.test.tsx`): burst of N synthetic SSE events within window → exactly 1 list fetch; unmount mid-window → no fetch, no act warnings.

**AC:** new component test green; existing grid behavior tests pass.
**Verify:** `bun test tests/plugins/assets/ --isolate`; manual spot-check deferred to T5.

### T4 — Docs — commit 4: `docs(assets): assets-versioning knowledge update (cache contract + caching rule of thumb)`

`.claude/knowledge/assets-versioning.md`: short "Manifest read cache" section — token validation contract, stat-before-read rule, what bypasses it, and the repo rule of thumb (*mtime-validate when an authoritative file exists; write-through only for derived indexes* — `sessionStoreCache` vs `task-asset-index`). Check `.claude/knowledge/plugin-system.md` + `search-system.md` for stale claims about per-read manifest parsing (line-level scan, expect no changes). README/CLAUDE.md: no impact (no commands/architecture surface changed) — confirm by scan.

**AC:** knowledge doc reflects the shipped design; no doc claims contradict code.

### T5 — Manual gold-standard e2e (dockerized rig + Playwright)

`bun run instance dev` (disposable home). Script:
1. Seed several versioned assets (upload via UI + `bun run mock:seed`-equivalent rig seeding as available)
2. Grid load: thumbnails render, counts right
3. Full lifecycle via UI: upload → add version → promote → delete version → trash asset → restore — each step's UI updates live (SSE), detail view correct
4. Real-agent loop: dispatch a task instructing the agent to `bakin_exec_assets_save` the same evolving file several times quickly → grid shows coalesced refresh (not N stampedes), versions accumulate on ONE asset
5. External-edit self-heal: hand-edit a manifest's description in the rig home → refetch/navigate shows new value (no restart, no watcher dependency)
6. Server log: zero errors/warnings attributable to assets
7. Light perf sanity: time `/api/plugins/assets/versioned` cold vs warm (expect warm ≤ cold; no regression)

**AC:** all 7 pass, findings written into the PR body (the #452 verification-bar format).

### T6 — PR

`gh pr create` → main. Body: spec/plan links, per-commit map, verification evidence (suite, build, e2e transcript), **observed follow-up note:** `plugins/images/lib/tools.ts:6` imports `../../assets/lib/asset-service` directly (pre-existing hook-boundary violation — not fixed here; file an issue).

## Risks & mitigations

- **Freeze breaks a hidden mutator** → spec's "ask first" boundary; the full-suite run in T2 is the detector (freeze active under `NODE_ENV=test`).
- **`statSync` ino semantics in test temp-dirs (tmpfs/docker)** — APFS + Docker linux fs both provide stable inos; spec 5's forced-mtime test proves the discriminator works on the actual fs.
- **Existing tests that assert exact fs op counts on asset paths** (if any exist from #452) could see counts change → T2 AC requires existing tests pass *unmodified*; if one legitimately encodes the old double-read, updating it is allowed but must be called out in the commit body.
```
