# Todo: Versioned Assets

Plan: `.claude/specs/versioned-assets-plan.md` · Spec: `.claude/specs/versioned-assets.md`
Each phase ends at a **green checkpoint** (full `bun test --isolate` + `typecheck`) = one conventional commit = a rollback point.

## PR A — Double-bill idempotency (branch `fix/images-idempotent-billed-calls`)
- [x] **A1** idempotency module (`plugins/images/lib/idempotency.ts`) + wire into `tools.ts` generate/edit; tests (concurrent→1 call, TTL cache, distinct→2, failure-not-cached, expiry). ✅ checkpoint — commit f45390c2, suite 4262/0, typecheck clean
- [~] **A2** mcporter timeout — **folded into B9** (per-call `--timeout` in Pixel's `mcporter call` commands). A1 already fixes the double-bill, so A2 is optional polish; not a standalone PR. (Bakin manages mcporter config; not a package-level setting.)
- [ ] Merge PR A (#389) → `main`

## PR B — Versioned assets (branch `feat/versioned-assets` off post-A main)
- [ ] **B1** types (core + SDK mirror; delete `AssetVariantMeta`) **+** asset service: `manifest.ts` (atomic temp+rename), `asset-lock.ts` (per-assetId mutex), `createAsset`/`getAsset`/`resolveFile`/`list`/`exists`, `asset-paths.ts`, per-version thumbs; service tests. ✅
- [ ] **B2** HTTP serving: rewrite `[...path].ts` (`<id>`,`/v/<n>`,`/thumb`,`/export/<name>`, ETag `id:current`, range); remove `routes/file.ts`, `?filename=`, `pathForFilename` hook; `list` → `AssetSummary`; route tests. ✅
- [ ] **B3** lifecycle: `addVersion`/`promoteVersion`/`deleteVersion`(auto-fallback)/`addExport`(idempotent)/`deleteAsset`+`restore`/`relink`/`retype`; edge-case tests. ✅
- [ ] **B4** search: manifest-driven `fileToId`/`onSync`/`onUnlink`/`reindex`/`verifyExists`, current-only; tests. ✅
- [ ] **B5** image tools: generate→createAsset, edit(assetId)→addVersion, export→addExport, import→v1, return `assetId`, drop `sourcePath`, remove `savePromptPacket`; carry idempotency; tests. ✅
- [ ] **B6** save-by-source upsert (`findBySourcePath`/`upsertFromSource`), `assets_save`→upsert, retire `assets_update_content` + `includeChildren`/child-assets; tests (confirm prompt-packet was only child producer). ✅
- [ ] **B7** cross-cutting: mutation→`assetId` SSE event; clipboard-purge by `source.kind`; inbox→v1; health-checks rewrite; tests. ✅
- [ ] **B8** UI: atoms (`asset-urls`, `AssetThumb`, `AssetMetaSummary`, `ProvenanceChips`, `VersionRow`, shared `TYPE_ICONS`) → card (badge, navigate) → modal (light + "full history") → detail route (`assets.$assetId.tsx` + slot: timeline/exports/promote/delete) → delete-scope dialog; component tests + manual click-through. ✅
- [ ] **B9** docs (LAST): rewrite `using/assets.md`, harden `using/images.md`, recapture screenshots, regen generated docs, `server-contracts.md`, new `.claude/knowledge/assets-versioning.md`, `CLAUDE.md`, `README.md`, skill quick-refs, bakin-bits Pixel (AGENTS/generate-image/CHANGELOG); `docs:check` green. ✅
- [ ] **B10** cutover: legacy warn-guard, wipe dev assets, full suite, e2e manual (generate→edit→promote→delete→export via UI + agent), confirm no double-bill; open PR B. ✅

## Cross-repo / merge
- [ ] bakin-bits Pixel PR merged after B verified
- [ ] dev box reseeded on new layout
