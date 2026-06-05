# Assets Plugin Usability Pass — tiles, tag folders, metadata editing

Make the assets index navigable at scale: fix squished tile cards, turn tags into a first-class "folder" concept, and give the user a way to edit asset metadata (description + tags) that has never existed. Single-user machine; priority is reducing tech debt — no backwards compatibility, no shims.

## Objective

Today the assets plugin is write-only from the user's perspective: agents create assets with descriptions and tags, but there is **zero UI or API** to edit them (`plugins/assets/index.ts` routes cover promote/delete/relink/export/upload only). Tags exist in the manifest and search index but can't be filtered on, grouped by, or changed. The tile grid uses fixed column counts (`grid-cols-2 sm:3 md:4 lg:5`) that squish cards below usable size before wrapping.

This pass delivers:
1. **F1 — Tile min-width:** content-driven grid, 250px minimum card width.
2. **F2 — Folders view:** a new view mode at the assets index grouping assets by tag, folder-click navigates into a tag-filtered grid with a breadcrumb back.
3. **F3 — Metadata edit drawer:** edit description + tags from grid cards, list rows, and the detail page.
4. **F4 — Global tag ops:** rename/delete a tag across all assets from the folders view.
5. **F5 — Tags facet filter:** URL-backed multi-select Tags filter in grid/list views.
6. **F6 — Search facet:** register tags as an Antfly search facet.
7. **F7 — Bulk tagging:** multi-select assets in grid/list → add tags to all selected.
8. **F8 — Tag/version decoupling:** tags become a pure asset-level organizational namespace that survives agent edits and promotes (see Design v2).

## Design — settled 2026-06-05 (interview + evidence-based revision)

### v2 revision: tags decoupled from the version mirror

The original write-through plan died on contact with the code: `addVersion` sets the new version's tags to `input.tags ?? []` and `mirrorDisplay()` copies them to asset level — and `plugins/images/lib/tools.ts:217` stamps `['edited', surface, provider, model]` on **every agent edit**. Under the mirror invariant, a user's `hello-world` folder tag would be wiped the next time an agent touched the image, and promote would shuffle folder membership. Additionally those machine tags are pure duplication: per-version `op` + `generation { provider, model, surface, quality }` already record the same provenance structurally.

**Resolution (user-approved):**
- `asset.tags` is the single organizational namespace. `mirrorDisplay` mirrors **description only**. `addVersion` and `promoteVersion` never alter asset tags.
- **`tags` is deleted from `AssetVersionSchema`** — it has no remaining consumer. Zod strips the stale key from existing manifests on parse; the next write drops it. No migration, nothing reads it.
- The images tools **stop stamping machine tags** (`'generated'`, `'edited'`, surface, provider, model) — provenance already lives in `op`/`tool`/`generation`. Existing machine-tag folders are cleaned up manually via F4 global delete (~5 clicks; tiny asset population, no migration code).
- Creation paths route organizational tags to asset level: `createAsset`/`upload`/`bakin_exec_assets_save` take `tags` → `asset.tags` (normalized). When `assets_save` upserts a **new version** of an existing asset and the caller passed tags, they are **unioned** into `asset.tags` (agents add organization, never wipe the user's).
- Description keeps the original write-through decision: editing it updates asset-level + current version; promote/delete still restore per-version descriptions. That invariant remains correct for content-descriptive text.

### Decisions

| Decision | Choice |
|---|---|
| Tags model | Asset-level only (F8 above). Version schema loses `tags`; machine stamps removed at the source. |
| Description edit semantics | **Write-through to current version** (asset-level + current version's `description`), keeping the mirror invariant for description. Apply the existing 200-char cap (`.slice(0, 200)`) — same as version writes. |
| Folder-click navigation | **Filter the existing grid.** Clicking a folder navigates to `?view=grid&tags=<tag>`. No dedicated folder page — the folders view is a visual entry point into the same tag-filter backbone (F5). One mental model, deep-linkable. |
| Breadcrumb / back | When a tags filter is active in grid/list, show a breadcrumb row (`Folders / <tag> ✕`) linking back to `?view=tags` and clearing the filter. Browser back also works since all state is URL-backed. |
| Edit access pattern | **Right-side `BakinDrawer`** (SDK component) with Description textarea + TagInput. Opened from a hover edit affordance on grid cards, an action on list rows, and an Edit button on the detail page. |
| Tag input behavior | Combobox: type-to-filter suggestions from all existing tags (derived client-side from loaded summaries — no new endpoint), Enter creates freeform. |
| Tag normalization | Server-side in **every path that writes tags** (PATCH, global ops, bulk apply, createAsset, upload, assets_save): trim, lowercase, collapse internal whitespace to hyphens (`"Hello World"` → `"hello-world"`), dedupe, drop empties. Single shared `normalizeTag()` — one source of truth. |
| Global tag ops | Folder card kebab menu: **Rename** (re-tags every asset carrying it; merge+dedupe if target exists) and **Delete** (removes the tag from all assets; assets untouched). Only `asset.tags` exists now, so these are simple single-field sweeps. |
| Trash policy | Global tag ops **skip `.trash/`** (consistent with `listAssets`). A restored asset may resurrect a stale tag — acceptable at this scale; fix is one drawer edit. Documented, not handled. |
| Untagged assets | Pinned **"Untagged"** pseudo-folder in folders view; clicking filters to tagless assets (`?view=grid&tags=__untagged__` or equivalent sentinel). Nothing is invisible in this view. |
| Folder sort & card | Folders sorted by most-recently-updated asset within them (Untagged pinned first). Folder card: thumbnail collage of up to 4 recent assets + tag name + asset count. |
| Multi-tag membership | An asset with N tags appears in all N folders. Tags are labels, not exclusive containers. |
| Title field | **None added.** `description` keeps doubling as the displayed title. No schema migration. |
| Folders data source | Computed **entirely client-side** from the existing `/versioned` list response (summaries already carry `tags`, `updated`, `hasThumb`). No new list endpoint. |
| Search provenance fields | With machine tags gone, the search doc indexes the current version's `generation` provenance directly: **`surface` in searchable text + embedding template** (real semantic value — "instagram" matches `instagram-feed-portrait`); **`provider` + `model` as filterable facet fields** (not embedded — supports "everything made with gpt-image-2" auditing without polluting embeddings). |
| Bulk tagging UX | Selection mode in grid/list (header toggle or hover checkbox); floating action bar when N > 0: "Add tags to N assets" (TagInput) + clear selection. Selection is ephemeral component state, not URL. The bulk endpoint supports add **and** remove; UI ships add-only (per-subset removal is covered by per-asset edit + global delete). |
| Out of scope | Drag-asset-onto-folder. Separate title field. Editing agent/taskId from the drawer (relink already exists). Tag colors. Agent-facing metadata-edit exec tool (assets_save already carries tags; revisit if agents need post-hoc editing). |

## API

All under `/api/plugins/assets/`, registered in `plugins/assets/index.ts`, implemented in `plugins/assets/routes/`. Every mutation goes through `writeManifestAtomic` under the per-asset lock and is picked up by the content watcher → `asset.changed` SSE → grid refetch. Zod-validated bodies.

| Route | Method | Body | Behavior |
|---|---|---|---|
| `/versioned/:assetId/metadata` | PATCH | `{ description?: string, tags?: string[] }` | Description: write-through (asset-level + current version, 200-char cap). Tags: replace `asset.tags` (normalized). Returns updated manifest. 404 unknown asset, 400 invalid body. |
| `/tags/rename` | POST | `{ from: string, to: string }` | Every asset with `from` in `asset.tags`: replace with normalized `to`, dedupe (merge). Skips trash. Returns `{ updated: number }`. |
| `/tags/remove` | POST | `{ tag: string }` | Remove `tag` from `asset.tags` of every asset. Skips trash. Returns `{ updated: number }`. |
| `/tags/apply` | POST | `{ assetIds: string[], add?: string[], remove?: string[] }` | Per asset: add/remove on `asset.tags` (normalized, deduped). Returns per-asset results; unknown assetIds reported, don't abort the rest. |

Tag mutation core lives in `plugins/assets/lib/asset-service.ts` (`updateMetadata`, `renameTagGlobal`, `removeTagGlobal`, `applyTags`) next to the existing `promoteVersion`/`relink` mutations; `normalizeTag` in a small shared module used by all writers.

## UI

All in `plugins/assets/components/`, imports from `@makinbakin/sdk` / `@makinbakin/sdk/components` only.

- **Grid sizing (F1):** `VersionedAssetGrid.tsx:387` — replace fixed `grid-cols-*` with `repeat(auto-fill, minmax(250px, 1fr))` (Tailwind arbitrary value). Applies to the tiled (grid) view only.
- **Folders view (F2):** add `{ key: 'tags', label: 'Folders' }` to `VIEW_OPTIONS` (view state already URL-backed via `useQueryState('view')`). New `TagFolderGrid.tsx` renders folder cards from the in-memory summaries; kebab menu hosts Rename/Delete (F4) with confirm dialogs (SDK `Dialog`).
- **Tags filter (F5):** SDK `FacetFilter` next to the existing Type filter, options derived from loaded summaries, backed by `useQueryArrayState('tags')`. Client-side filtering, same as the type filter. Breadcrumb row renders when the tags filter is active.
- **Edit drawer (F3):** new `AssetEditDrawer.tsx` (SDK `BakinDrawer` + `Textarea` + new `TagInput.tsx`). Optimistic close on successful PATCH; SSE refetch reconciles. TagInput is plugin-local for now — promote to SDK only when a second consumer appears.
- **Bulk select (F7):** selection state in `VersionedAssetGrid.tsx`; action bar component; reuses `TagInput`; calls `/tags/apply`.

## Affected Files

- `plugins/assets/lib/manifest.ts` — **remove `tags` from `AssetVersionSchema`**; no other schema change
- `plugins/assets/lib/asset-service.ts` — metadata/tag mutations; `mirrorDisplay` mirrors description only; creation/version inputs drop version tags, route organizational tags to asset level
- `plugins/images/lib/tools.ts` — stop stamping machine tags (provenance stays in `op`/`generation`)
- `plugins/assets/routes/versioned.ts` + new `plugins/assets/routes/tags.ts` — new routes
- `plugins/assets/routes/upload.ts` — tags → asset level, normalized
- `plugins/assets/index.ts` — route registration; `assets_save` tag handling (union on upsert-version); tags facet in search registration (F6)
- `plugins/assets/lib/search-doc.ts` — tags facet field if Antfly needs a keyword-typed field; add `surface` (searchable + embedded) and `provider`/`model` (facets) from current version's `generation` (check `.claude/knowledge/search-plugin-guide.md`)
- `plugins/assets/components/versioned/VersionedAssetGrid.tsx` — grid sizing, folders view wiring, tags facet, breadcrumb, selection mode
- `plugins/assets/components/versioned/TagFolderGrid.tsx` — **new**
- `plugins/assets/components/versioned/AssetEditDrawer.tsx` — **new**
- `plugins/assets/components/versioned/TagInput.tsx` — **new**
- `plugins/assets/components/versioned/VersionedAssetDetail.tsx` — Edit button → drawer
- `tests/plugins/assets-*.test.ts` — new route/service tests
- `.claude/knowledge/assets-versioning.md` — tags-as-asset-level-namespace rule, metadata mutation contract, normalization, global tag ops, trash caveat
- `README.md` — only if it enumerates assets features (verify during build)

## Testing Strategy

Route/service-level tests under `tests/`, following CLAUDE.md testing rules verbatim (temp-dir `BAKIN_HOME`, mock both content-dir paths + OpenClaw home, mock logger/watcher, `afterAll` cleanup, `--isolate`):

- **PATCH metadata:** description updates asset-level AND current version (older versions untouched, 200-char cap); tags replace asset-level only; normalization applied (`"Hello World"` → `"hello-world"`, dedupe, empty-drop); 404/400 paths; manifest re-read from disk to assert atomic write.
- **Decoupling invariants (the regression guards for F8):** after tagging an asset, `addVersion` (with and without input tags) leaves user tags intact; `promoteVersion` changes description but never tags; image generate/edit produce **no** machine tags.
- **Rename:** sweeps all assets carrying the tag; merge+dedupe when target already present; non-carrying assets untouched (manifest byte-identical); trash untouched.
- **Remove:** same sweep/skip assertions.
- **Apply (bulk):** add+remove across a set; per-asset result reporting; unknown assetId doesn't abort the rest.
- **Creation normalization:** upload/assets_save/createAsset normalize tags; assets_save upsert-version unions tags into asset level.
- **Search doc:** built doc carries `surface` in searchable/embedded text and `provider`/`model` as facet fields; absent `generation` (uploads) yields empty fields, not errors.
- UI verified manually via `bun run dev` (+ Playwright/devtools spot-check of grid min-width and drawer flow if warranted in the test phase).

## Boundaries

- **Always:** mutate manifests only via `writeManifestAtomic` under the per-asset lock; normalize tags through the single shared helper in every writing path; keep all filter/view state URL-backed (`useQueryState`/`useQueryArrayState`); emit nothing manually — the watcher owns `asset.changed`.
- **Ask first:** any further manifest schema change beyond removing version `tags`; promoting TagInput into the SDK; new endpoints beyond the four listed.
- **Never:** per-file sidecars or parallel tag stores (tags live in `asset.tags` in the manifest, period); backwards-compat shims; bypassing Zod validation on route bodies; touching `~/.bakin/` from tests.

## Commands

- Dev: `bun run dev` (HMR for plugin client code; server route changes need manual restart)
- Tests: `bun run test` (full), `bun test tests/plugins/<file>.test.ts --isolate` (single)
- Typecheck/build sanity: `bun run build` before ship
