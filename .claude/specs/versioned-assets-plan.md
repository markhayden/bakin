# Plan: Versioned Assets (images-first)

**Spec:** `.claude/specs/versioned-assets.md` (Approved 2026-05-29)
**Status:** Approved (2026-05-29) — in `/agent-skills:build` (PR A)
**Companion:** `.claude/specs/versioned-assets-todo.md` (checkbox task list)

---

## 1. Approach

- **Two PRs.** PR A (double-bill idempotency) lands first on current `main` (filename identity). PR B (the asset-as-directory refactor) lands after A and carries A's idempotency forward, adapting the result shape to `assetId`.
- **Vertical-first within the unavoidable foundation.** A storage-model refactor has a real foundational layer (manifest + service) that everything sits on; that's B1. *On top of it*, each phase is a thin end-to-end capability slice (create→serve, then add-version→serve, then lifecycle, …) that is independently testable and committable.
- **Every phase ends at a green checkpoint** — full `bun test --isolate` + `typecheck` pass — which is a natural rollback point and a single conventional commit. A phase is never left half-applied across a checkpoint.

## 2. Dependency graph

```
PR A (independent) ──────────────────────────────────────────────┐
                                                                  │ (merge first)
PR B:                                                             ▼
 B0 types ─► B1 service (manifest+lock+atomic, create/read) ─► B2 HTTP serving
                          │                                        │
                          ├─► B3 lifecycle (addVersion/promote/delete/export/relink/retype)
                          │              │
                          │              ├─► B4 search (manifest-driven)
                          │              ├─► B5 image tools (+ carry A idempotency)
                          │              │        └─► B6 save-by-source upsert + tool collapse
                          │              └─► B7 cross-cutting (events/clipboard/inbox/health)
                          │
                          └─► B8 UI (atoms ─► card ─► modal ─► detail route)  [needs B2 serving + B3 ops]
 B9 docs (LAST — needs UI built for screenshots) ─► B10 cutover + full verify
```

Hard edges: B1 blocks everything; B2 needs B1; B5/B6 need B3; B8 needs B2+B3; B9 needs B8 (screenshots) + everything (accuracy); B10 last.
Parallelizable once B3 lands: B4, B5, B7 are independent of each other.

## 3. Commit & checkpoint strategy

- **One conventional commit per phase** (`feat(assets):`, `refactor(assets):`, `test(assets):`, `docs(assets):`), each at a green checkpoint. Larger phases (B1, B8) may split into 2–3 commits but still land green.
- **Checkpoint = rollback point.** At each ✅ the branch builds, typechecks, and the full suite is green. If a later phase goes wrong, `git reset --hard` to the prior checkpoint loses only that phase.
- **PR A is its own branch** off `main`, merged before PR B branches. **PR B** branches off post-A `main`.
- **bakin-bits** changes (Pixel) are a separate PR in that repo, opened during B9, merged after B is verified.
- **Cutover (B10) is the last commit** and includes the destructive data wipe (dev) — never earlier.
- Do **not** commit with red tests "to checkpoint progress" — use `git stash`/WIP branches instead.

---

## 4. PR A — Double-bill idempotency (fast-track)

> Branch `fix/images-idempotent-billed-calls` off `main`. ~1–2 commits.

### A1 — Idempotency module + wiring
- **Files:** new `plugins/images/lib/idempotency.ts`; wire into `plugins/images/lib/tools.ts` (`generateImage`, `editImage`) before the `ctx.runtime.images.*` call.
- **Build:** `signature({taskId, op, sourceFilename|null, promptHash, provider, model, width, height, quality})`; `Map<sig,Promise>` in-flight; `Map<sig,{result,expiresAt}>` TTL≈5min completed-cache. Identical in-flight → await same promise; identical-within-TTL → return cached; success caches, failure does not. Preserve "no auto-retry."
- **Acceptance:** a second identical billed call (mid-flight OR within TTL after completion) issues **zero** additional `ctx.runtime.images.*` calls and returns the first result.
- **Verify:** unit tests with a mock runtime counting calls — (a) concurrent identical → 1 call; (b) sequential identical within TTL → 1 call, cached result; (c) distinct signature → 2 calls; (d) failure not cached (next call re-issues); (e) TTL expiry re-issues. Manual: slow-edit + immediate duplicate invoke → one asset, one bill.
- **Checkpoint ✅:** suite + typecheck green.

### A2 — Pixel mcporter timeout (bakin-bits)
- **Repo:** `bakin-bits-official` — bump Pixel's mcporter call timeout > ~120s; CHANGELOG.
- **Verify:** config present; (optional) manual long edit completes without client timeout.
- Separate PR; merge alongside A.

**PR A done:** merge to `main`; rebase/branch PR B from here.

---

## 5. PR B — Versioned assets refactor

> Branch `feat/versioned-assets` off post-A `main`.

### B0 — Types & scaffolding (no behavior)
- **Files:** `packages/core/src/plugin-types.ts` + `packages/sdk/src/types/index.ts` (mirror): add `AssetManifest`, `AssetVersion`, `AssetExport`, `AssetSummary`, `AssetCreateInput`, `AssetVersionInput`, new `AssetFileRef`; **delete** `AssetVariantMeta`; redefine `AssetMeta` consumers' import target (or remove `AssetMeta`, introduce `AssetSummary`). New `AssetsAPI` interface (§4.4).
- **Acceptance:** types compile; old `variants`/`SaveAssetParams` references surface as type errors (the worklist for later phases).
- **Verify:** `bun run typecheck` enumerates the break sites (expected). 
- **Checkpoint ✅:** types committed; downstream type errors are the known worklist (tracked, not green yet — this is the one phase that may land with intentional downstream `// TODO` stubs to keep the build compiling; prefer to fold B0 into B1 if a red build is unacceptable).

> Note: to keep every checkpoint green, **B0 is implemented as the first commit of B1** (types + service together) rather than a standalone red commit.

### B1 — Asset service foundation (vertical: create + read)
- **Files:** new `plugins/assets/lib/manifest.ts` (atomic temp+rename read/write, Zod schema), `plugins/assets/lib/asset-lock.ts` (in-process `assetId` async mutex), rewrite `plugins/assets/lib/save-asset.ts` → service (`createAsset`, `getAsset`, `resolveFile`, `list`, `exists`); `plugins/assets/lib/path-for-filename.ts` → `asset-paths.ts` (`assetId`→dir, shard from id prefix); per-version thumb generation moves into the asset dir.
- **Acceptance:** `createAsset` writes `<assetId>/manifest.json` + `v1.<ext>` (+ `v1.thumb.jpg` for images) atomically; `getAsset`/`list`/`resolveFile(current)` read it; concurrent create/read safe.
- **Verify:** unit tests (mock content-dir + OpenClaw home, `--isolate`): create→read round-trip, atomic write (no partial manifest observable), `assetId`-dir layout, shard derivation, thumb generated for images only.
- **Checkpoint ✅.**

### B2 — HTTP serving & addressing (vertical: created asset is fetchable)
- **Files:** rewrite `packages/host/src/api/assets/[...path].ts` to parse `<assetId>[/v/<n>|/thumb|/export/<name>]`; ETag `assetId:currentVersion`; range support; **remove** `plugins/assets/routes/file.ts` (`?name=`), the `?filename=` list param, `assets.pathForFilename` hook → assetId resolver. Update `plugins/assets/routes/list.ts` → `AssetSummary`.
- **Acceptance:** `GET /api/assets/<id>` serves current bytes; `/v/<n>`, `/thumb`, `/export/<name>` resolve; ETag changes when current changes; old filename routes 404/removed.
- **Verify:** route tests: current/version/thumb served, ETag bust on promote (stub), range 206, path-traversal guard, removed routes gone.
- **Checkpoint ✅.**

### B3 — Lifecycle operations
- **Files:** extend service: `addVersion`, `promoteVersion`, `deleteVersion` (auto-fallback, can't-delete-last, v1-deletable, stable numbers/gaps), `addExport` (sharp resize → `exports/`, idempotent per surface+format, naming rule), `deleteAsset`/`restore` (whole-dir trash), `relink`/`retype` (asset-level manifest edits). All behind the per-asset lock + atomic write.
- **Acceptance:** each op matches §4.3 rules; deleting current auto-falls-back to highest remaining; exports survive version deletion; trash/restore round-trips the dir.
- **Verify:** unit tests per op incl. edge cases (delete current, delete v1, can't-delete-last, gaps preserved, export idempotency, restore).
- **Checkpoint ✅.**

### B4 — Search (manifest-driven)
- **Files:** rewrite the `registerFileBackedContentType` block in `plugins/assets/index.ts`: `fileToId` on `…/<assetId>/manifest.json` → `assetId` (null for version files/thumbs/exports); `onSync`/`onUnlink`/`reindex`/`verifyExists` on manifest; index current-version only (description/tags/content/image_url). Exclude `.trash/`.
- **Acceptance:** one search row per asset; manifest write re-indexes that row; manifest unlink removes it; promoting an old version re-embeds to match current.
- **Verify:** tests: manifest-as-row, reindex on change, current-only content/visual, remove on unlink, retype/relink re-index.
- **Checkpoint ✅.**

### B5 — Image exec tools on the new model (+ carry A idempotency)
- **Files:** `plugins/images/lib/tools.ts` + `plugins/images/index.ts`: `generate`→`createAsset`(v1); `edit(assetId)`→`addVersion`; `export(assetId)`→`addExport`; `import`/upload→`createAsset`; return `assetId`; drop `sourcePath` from edit; **remove `savePromptPacket`/`promptAssetFilename`**; re-key idempotency signature to `sourceAssetId`/`assetId`.
- **Acceptance:** generate→edit→edit yields **one asset, v1/v2/v3**; export attaches; tools return `assetId`; idempotent retry still no-bills.
- **Verify:** tests (generate→new asset, edit→addVersion on current, export→attached, import→v1, assetId contract, idempotency). Manual: agent-style generate+edit loop → one card.
- **Checkpoint ✅.**

### B6 — Save-by-source upsert + tool-surface collapse
- **Files:** service `findBySourcePath` + `upsertFromSource`; `bakin_exec_assets_save` → upsert entry; **retire `bakin_exec_assets_update_content`**; **retire `includeChildren`/child-asset** logic (`asset-index.ts`, `routes/list.ts`, `task-assets.tsx`).
- **Acceptance:** re-saving one source path → one asset with versions; identical save → no-op; update-content path = `addVersion`; no child-asset code remains.
- **Verify:** tests (new path→v1, changed→addVersion, identical→no-op, findBySourcePath; child-asset removal; confirm prompt-packet was the only child producer).
- **Checkpoint ✅.**

### B7 — Cross-cutting (events, clipboard, inbox, health)
- **Files:** broadcast `assetId` event on every mutation (reuse activity/audit path) so UI refreshes; `assets.purgeClipboardForTask` → match `source.kind==='clipboard'`, delete whole asset; `ingest-inbox.ts` → `createAsset` v1; rewrite `health-checks.ts` (manifest integrity, current resolves, version files exist, no orphans, exports resolve).
- **Acceptance:** mutations emit events; clipboard purge by source; inbox drop → v1 asset; health checks reflect new model.
- **Verify:** tests for each; manual: edit an asset → grid/detail/task-panel refresh live.
- **Checkpoint ✅.**

### B8 — UI (shared atoms → card → modal → detail route)
- **Files:** `plugins/assets/components/`: new `lib/asset-urls.ts`, `AssetThumb`, `AssetMetaSummary`, `ProvenanceChips`, `VersionRow`; consolidate `TYPE_ICONS/COLORS` → `lib/constants`; update `AssetRenderer` (assetId+version). Then `asset-card` (version badge, navigate to route), `asset-detail` modal (light preview + "full history →", `addVersion` text edit), new route `packages/host/src/routes/assets.$assetId.tsx` + `<Slot name="page:/assets/:assetId">` filled by plugin (timeline + exports + promote/delete + delete-scope dialog). Delete-scope dialog (whole vs current).
- **Acceptance:** grid = one card/asset + badge; click → route; route shows timeline + exports + working promote/delete; modal stays light with history link; no duplicated URL/metadata/preview logic across surfaces.
- **Verify:** component tests for atoms + surfaces; manual click-through: generate→edit→promote→delete-version→export all via UI.
- **Checkpoint ✅** (split into atoms / card+modal / route commits if large).

### B9 — Docs (LAST)
- **Files:** rewrite `docs/src/content/docs/using/assets.md`; harden `docs/src/content/docs/using/images.md`; recapture screenshots (`docs:screenshots` + `docs:inject-screenshots`); `bun run docs:generate` + `docs:validate` + `docs:validate:routes`; update `docs/src/content/docs/extending/plugins/server-contracts.md`; new `.claude/knowledge/assets-versioning.md`; `CLAUDE.md`; `README.md`; agent skill quick-refs; **bakin-bits** Pixel (`AGENTS.md`, `generate-image.md`, CHANGELOG: assetId, drop sourcePath+savePromptPacket, timeout bump).
- **Acceptance:** docs describe the new model only; `docs:build` green; generated docs current; no stale flat-file/`variants`/`update_content`/`image_filename` references remain.
- **Verify:** `bun run docs:check`; grep for retired terms; visual screenshot review.
- **Checkpoint ✅.**

### B10 — Cutover & full verification
- **Steps:** add startup legacy-file warn-not-migrate guard; wipe dev assets (`rm -rf ~/.bakin/assets`); full `bun test --isolate`; end-to-end manual on a mock-runtime server (generate→edit→promote→delete→export via UI + an agent invocation); confirm no double-bill on forced retry.
- **Acceptance:** clean install rebuilds empty; full suite green; e2e flow works; spec boundaries all satisfied.
- **Verify:** suite + manual e2e capture.
- **Final commit + open PR B.**

---

## 6. Risks & rollback
- **Type blast radius (B0/B1).** Mitigation: fold types into B1's first commit so the build never lands red; the type errors *are* the worklist.
- **Watcher/manifest race.** Mitigation: atomic temp+rename + tolerant readers (B1); covered by an atomic-write test.
- **Version-number race.** Mitigation: per-asset mutex (B1); covered by a concurrency test.
- **Hidden child-asset producers.** Mitigation: B6 verifies prompt-packets were the only producer before deleting `includeChildren`.
- **Screenshots drift.** Mitigation: docs phase is last, against the real UI.
- **Rollback:** each phase is a green-checkpoint commit; `git reset --hard <prior checkpoint>` reverts one phase cleanly.

## 7. Definition of done
- PR A merged (no double-bill; tests green). PR B: all phases ✅; full suite + typecheck + `docs:check` green; e2e verified; `.claude/knowledge` + README + CLAUDE.md + public docs updated; bakin-bits Pixel PR merged; dev box reseeded on the new layout.
