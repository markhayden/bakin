# Todo: Versioned Assets

Plan: `.claude/specs/versioned-assets-plan.md` · Spec: `.claude/specs/versioned-assets.md`
Each phase ends at a **green checkpoint** (full `bun test --isolate` + `typecheck`) = one conventional commit = a rollback point.

## PR A — Double-bill idempotency (branch `fix/images-idempotent-billed-calls`)
- [x] **A1** idempotency module (`plugins/images/lib/idempotency.ts`) + wire into `tools.ts` generate/edit; tests (concurrent→1 call, TTL cache, distinct→2, failure-not-cached, expiry). ✅ checkpoint — commit f45390c2, suite 4262/0, typecheck clean
- [~] **A2** mcporter timeout — **folded into B9** (per-call `--timeout` in Pixel's `mcporter call` commands). A1 already fixes the double-bill, so A2 is optional polish; not a standalone PR. (Bakin manages mcporter config; not a package-level setting.)
- [ ] Merge PR A (#389) → `main`

## PR B — Versioned assets (branch `feat/versioned-assets` off post-A main)
- [x] **B1** asset service: `asset-id.ts`, `asset-lock.ts` (per-assetId mutex), `manifest.ts` (Zod + atomic temp+rename), `asset-service.ts` (`createAsset`/`getAsset`/`resolveFile`/`list`/`exists` + per-version thumbs); service tests. ✅ commit 2dd40c47, suite 4271/0. (Additive — new modules alongside old; core/SDK type changes deferred to when consumers flip.)
- [x] **B2** HTTP serving: `serve.ts` (`resolveAssetServe`) + `assets.resolveServe` hook + `[...path].ts` (`<id>`,`/v/<n>`,`/thumb`,`/export/<name>`, ETag `id:version`, 304, range); resolver + host-route tests. ✅ commit e1b812af, suite 4282/0. (Legacy filename route kept as fallback; removed in B8. `list`→`AssetSummary` deferred to B8 UI flip.)
- [x] **B3** lifecycle: `addVersion`/`promote`/`deleteVersion`(auto-fallback,can't-delete-last,gaps)/`addExport`(idempotent per surface)/`deleteAsset`+`restore`/`relink`/`retype`, all behind lock+atomic write; per-version description/tags added; edge tests. ✅ f1abf9a3, suite 4290/0. (Export keyed one-per-surface, simpler than spec's surface+format — reconcile spec in B9.)
- [x] **B4** search: manifest-driven `versionedAssetPath`+`buildVersionedAssetSearchDoc`, branched `onSync`/`onUnlink`/`reindex`/`verifyExists`, current-only; tests. ✅ c3ef391a, 4295/0.
- [x] **B5** image tools: ctx.assets +createAsset/addVersion/addExport/resolveVersionFile; generate→v1, edit(assetId)→addVersion, export→attached, import→v1, return `assetId`, drop `sourcePath`+`savePromptPacket`, idempotency re-keyed; perms mapped; all mock ctx updated; tools test rewritten. ✅ 6b4dfd3a, 4295/0.
- [x] **B6** save-by-source upsert (`findBySourcePath`/`upsertFromSource`), `assets_save`→upsert (versions on re-save, no-op if unchanged), retire `assets_update_content`; tests. **Kept `includeChildren`** — it's task-hierarchy (taskId--*), NOT prompt-packets (spec assumption corrected). ✅ ec3efc58, 4293/0.
- [x] **B7** cross-cutting: watcher emits `asset.changed`/`asset.removed`; clipboard-purge versioned pass; inbox→versioned v1 (async); health manifest-integrity check; inbox test rewritten. ✅ fd23d5e7, 4289/0. (UI event consumer lands in B8.)
- [x] **B8 API** versioned HTTP routes (list/manifest/promote/delete-version/export/delete-asset) + tests. ✅ 789d92fb, 4295/0.
- [x] **B8 UI** atoms (`asset-urls`/`AssetThumb`/`AssetMetaSummary`/`ProvenanceChips`/`VersionRow`/`AssetTypeIcon`) → grid (`VersionedAssetGrid`, version badge, navigate, live refresh) → detail route (`VersionedAssetDetail` + `assets.$assetId.tsx` slot: timeline/exports/promote/delete + delete-scope dialog) → `client.tsx` slot flip. **Live-verified in browser (Playwright)**: grid badge → navigate → timeline → promote → delete-version → delete-scope dialog all working. ✅ 7618a19d, 4295/0. (Modal "full history" link + old-page feature parity (search/filters/trash on versioned) = follow-up/B10.)
- [x] **B9** docs: rewrote `using/assets.md`, hardened `using/images.md`, regenerated reference docs (exec-tools/openapi), new `.claude/knowledge/assets-versioning.md`, `CLAUDE.md`, recaptured the 2 relevant screenshots (grid + detail) via cwebp + removed stale ones; `docs:check` green. ✅ a9121908. (README needs no change. **bakin-bits Pixel docs = post-PR-B follow-up** — its contract goes live when PR B merges.)
- [~] **B10 cutover** (functional cutover — re-point consumers; dead-file deletion is fast-follow):
  - [x] **B10a** all 12 agent exec tools → assetId (asset-service); versioned-exec-tools test; dead filename exec-tool tests removed. ✅ 4c966052, 4278/0.
  - [x] **B10b** cross-plugin UI → assetId: task-assets (versioned fetch/thumb/navigate/relink), `POST /versioned/:id/relink` + includeChildren; route count → 19. ✅ c578d800, 4278/0.
  - [x] **B10c** empty-state + versioned upload: `handleUpload`→`createAsset` (one v1 per file), `VersionedAssetGrid` "Add your first asset" CTA + header "Add asset" + hidden file input honoring `?linkTo=`, task-detail clipboard paste writes `/api/assets/<assetId>` refs; upload test rewritten to assert the manifest. ✅ suite 4280/0, typecheck + plugin build clean.
  - [x] **B10d** remove dead legacy, in green sub-commits:
    - [x] **B10d-1** dead client UI: 11 legacy components + asset-preview/asset-detail-modal slots + useAssets/useTrash hook & SDK exports. ✅ a6e4fb3c.
    - [x] **B10d-2** legacy filename routes (list/file/delete/link/retype/content/trash) + handler files; routes.test.ts → surviving surface (9 routes). ✅ fb86bf42.
    - [x] **B10d-3+4** search/hook machinery + filename `ctx.assets` surface: manifest-only onSync/onUnlink/reindex/verifyExists; dropped sidecar/path-for-filename/trash hooks (kept getAssetTypes/resolveServe/purgeClipboard versioned-only); deleted libs (asset-index/sidecar/path-for-filename/relink/retype/trash/save-asset); rewrote health-checks to versioned manifest integrity; removed AssetMeta/AssetVariantMeta/AssetSaveInput/AssetSaveResult/AssetFileRef from core+SDK (added AssetTypeName, versioned AssetsAPI in SDK); serve route dropped pathForFilename fallback; post_channel → imageAssetId/videoAssetId; images health check → createAsset; permissions trimmed; consumer tests rewritten. ✅ suite 4082/0, typecheck + full build clean.
  - [ ] **B10e** data wipe (this machine — authorized; user does other box), open PR B.
  - NOTE: deep-link to /assets/<id> on hard refresh showed "Not found" in the dev server (in-app nav works) — verify production SPA-fallback during e2e.

## Cross-repo / merge
- [ ] bakin-bits Pixel PR merged after B verified
- [ ] dev box reseeded on new layout
