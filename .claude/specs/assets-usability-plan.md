# Assets Usability Pass — Implementation Plan

Spec: `.claude/specs/assets-usability.md` (user-approved, F1–F8). On approval, this plan is also saved to `.claude/specs/assets-usability-plan.md` per repo convention.

## Context

The assets plugin is write-only for the user: agents create assets with descriptions/tags, but no UI or API exists to edit them; tags can't be filtered, grouped, or changed; the tile grid squishes cards (`grid-cols-2 sm:3 md:4 lg:5`). The spec settles the design: tags become a **pure asset-level organizational namespace** (folders) that survives agent edits/promotes; description keeps write-through-to-current-version semantics; a drawer edits metadata; a folders view + tag facet + bulk tagging make the index navigable at scale.

**Critical code facts grounding this plan** (all verified by reading):
- `plugins/assets/lib/asset-service.ts:303` — `mirrorDisplay()` copies current version's `description`+`tags` to asset level; called from `addVersion`/`promoteVersion`/`deleteVersion`.
- `plugins/images/lib/tools.ts:212,217` — stamps machine tags `['generated'|'edited', surface, provider, model]`; same data already structured in `generation {provider, model, surface, quality}` + `op`.
- `upsertFromSourceInner` (asset-service.ts:666) passes `tags` into `addVersion` — must change to asset-level union under F8.
- Routes: declarative `defineRoute` table in `plugins/assets/index.ts:62-186`; handlers in `plugins/assets/routes/versioned.ts`. Mutations audit via `ctx.activity.audit(...)`.
- Search: `registerFileBackedContentType` in index.ts:210 — `tags: {type:'text'}` comma-joined (search-doc.ts:51); facets need `keyword` type per `.claude/knowledge/search-plugin-guide.md`; embedding template `{{description}} {{tags}} {{file_name}} {{content}}`.
- Grid: `VersionedAssetGrid.tsx` (395 lines) — views `grid|list|trash` via `useQueryState('view')`, type facet via `useQueryArrayState('type')` + client-side filter (line 245); card click navigates to detail.
- SDK components: `BakinDrawer` (src/components/bakin-drawer.tsx — open/onOpenChange/title/actions/dirty props), `FacetFilter` (src/components/facet-filter.tsx — label/options/selected/onChange/counts), `Dialog`, `Badge`, `Input`, `Textarea`. No TagInput exists anywhere.
- Tests: `tests/plugins/assets/` — 19 files, env-var-first temp-dir isolation pattern (`BAKIN_HOME`+`OPENCLAW_HOME` set before imports). **12 of them reference tags**; `asset-lifecycle.test.ts` explicitly asserts the OLD mirror behavior (`expect(m.tags).toEqual(['two'])` after addVersion) and must be updated in the F8 task.
- Knowledge doc: `.claude/knowledge/assets-versioning.md:26-28` documents the mirror invariant — must be rewritten.

## Branch & Commit Strategy

One branch `feat/assets-usability` off `main`, PR at the end. **Ten commits, each a green checkpoint** (typecheck via `bun run build` types + `bun run test` pass before every commit) so any regression rolls back to the nearest checkpoint with `git revert`/`reset`. Server is data-compatible at every commit (old manifests always parse — Zod strips the removed version-tags key; no migration).

| # | Commit (conventional) | Contents |
|---|---|---|
| 1 | `fix(assets): content-driven tile grid with 250px min card width` | F1 only — one-line grid class change. Trivial, instant rollback anchor. |
| 2 | `refactor(assets)!: tags become asset-level only, decoupled from version mirror` | F8 server core: schema, service, images tools, existing-test updates. The foundation everything else builds on. |
| 3 | `feat(assets): tag normalization + metadata update API` | normalizeTags lib + `updateMetadata` service + PATCH route + creation-path normalization + tests. |
| 4 | `feat(assets): global tag rename/remove + bulk apply API` | F4/F7 server: service fns + 3 routes + tests. |
| 5 | `feat(assets): index generation provenance for search; tags facet` | F6: search-doc fields + registration schema/facets + tests. |
| 6 | `feat(assets): tags facet filter + folder breadcrumb in grid/list` | F5 UI + breadcrumb. |
| 7 | `feat(assets): asset metadata edit drawer with tag input` | F3 UI: TagInput + AssetEditDrawer + affordances on card/row/detail. |
| 8 | `feat(assets): folders view grouping assets by tag` | F2 UI: TagFolderGrid + rename/delete dialogs wired to commit-4 routes. |
| 9 | `feat(assets): bulk multi-select tagging` | F7 UI: selection mode + action bar. |
| 10 | `docs(assets): update knowledge docs for tag namespace + editing` | assets-versioning.md rewrite of invariant + new routes; search docs if schema changed; README check. |

Commits 2–5 are server-side (manual server restart to verify); 6–9 are client-side (HMR via `bun run dev`). 1 is independent; 5 is independent of 3–4; 6 depends on 2 only (filtering is client-side); 7 depends on 3; 8 depends on 4+6; 9 depends on 4+7.

## Tasks

### T1 — Tile min-width (commit 1)
`VersionedAssetGrid.tsx:387`: `grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5` → `grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]`.
**Accept:** cards never narrower than 250px; row count adapts to viewport. **Verify:** `bun run dev`, resize window; existing tests green.

### T2 — Tags decoupling (commit 2) — the foundation
1. `plugins/assets/lib/manifest.ts`: delete `tags` from `AssetVersionSchema`; update the lines-39-41 comment (description-only mirror).
2. `asset-service.ts`: `mirrorDisplay` → description only (rename comment); `AssetVersionInput` drops `tags`; `addVersion` no longer writes version tags; `createAsset` keeps `input.tags` → `manifest.tags` only (not on v1 version object); `upsertFromSourceInner` stops passing tags to `addVersion` (the union lands in T3 — see below). Do **not** widen `addVersion`'s signature with a merge param.
3. `plugins/images/lib/tools.ts`: delete the `tags:` arguments at **all three** sites — `:136` (`importImage`'s `params.tags ?? ['imported']` default → `params.tags ?? undefined`; `op: 'import'` already records provenance), `:212` (generate), `:217` (edit).
4. Test fallout (exhaustive — vetted by adversarial review; commit must be green):
   - `tests/plugins/assets/asset-lifecycle.test.ts:49,58` — invert the mirror-tags assertions (tags survive addVersion/promote).
   - `tests/plugins/images/tools.test.ts:145,255` — hard-assert the machine-tag arrays; remove those expectations.
   - `tests/plugins/assets/manifest-cache.test.ts:219` — freeze-guard asserts on `versions[0].tags` which ceases to exist (would pass as TypeError for the wrong reason); retarget to a surviving version field.
   - Files that merely *construct* version-level tags in raw JSON fixtures (`versioned-exec-tools`, `health-checks`, `clipboard-purge`, `serve`, `asset-service`, `manifest-cache:193`) need **no edit** — Zod strips unknown keys on parse. Don't churn them.
   - `search-doc.test.ts:52` + `upload.test.ts:134` survive because createAsset/upload keep routing tags to asset level — they become regression guards; keep as-is.
   - Add new guards: user tags intact after addVersion (with + without input tags), promote changes description but never tags, generate/edit/import produce zero machine tags.
**Accept:** version objects carry no tags; asset tags survive addVersion/promote/delete-version; old manifests with version tags still parse (Zod strips). **Verify:** `bun run test tests/plugins/assets/ tests/plugins/images/ --isolate` green; full suite green.

### T3 — Normalization + metadata PATCH (commit 3)
1. New `plugins/assets/lib/tags.ts`: `normalizeTags(tags: string[]): string[]` — trim, lowercase, collapse internal whitespace to `-`, drop empties, dedupe (order-preserving).
2. `asset-service.ts`: `updateMetadata(assetId, { description?, tags? })` — per-asset lock; description: `.slice(0,200)`, write-through to asset-level + current version; tags: `normalizeTags` → asset-level only; bump `updated`; `writeManifestAtomic`. Apply `normalizeTags` in `createAsset` + upload route's tag parsing (`routes/upload.ts:47`).
3. **Upsert union** (deferred from T2): in `upsertFromSourceInner`, after `addVersion` returns and when `input.tags` was provided, call `updateMetadata(existingId, { tags: union(manifest.tags, input.tags) })`. Lock-correct (source lock + per-asset lock use different keys, no deadlock); two writes is fine — the watcher coalesces and only the final manifest is indexed. Keeps `addVersion`'s API clean.
3. New handler in `routes/versioned.ts` (or `routes/tags.ts`): `PATCH /versioned/:assetId/metadata`, Zod body `{ description?: string, tags?: string[] }` (reject empty body), 404 unknown asset; audit `asset.metadata_updated`. Register via `defineRoute` in index.ts.
**Accept/Verify:** new test file `tests/plugins/assets/metadata-route.test.ts` — write-through description (older versions untouched, cap), tags asset-level only, normalization (`"Hello World"`→`hello-world`, dedupe), 400/404, manifest re-read from disk; promote-after-edit restores that version's description but not tags.

### T4 — Global tag ops + bulk apply (commit 4)
1. `asset-service.ts`: `renameTagGlobal(from, to)` (normalize `to`; sweep `listAssets()`, per-asset lock + atomic write only for assets carrying `from`; merge-dedupe; returns count), `removeTagGlobal(tag)` (same sweep), `applyTags(assetIds, {add, remove})` (per-asset; unknown ids collected, not fatal).
2. New `plugins/assets/routes/tags.ts`: `POST /tags/rename {from,to}`, `POST /tags/remove {tag}`, `POST /tags/apply {assetIds, add?, remove?}` — Zod bodies, audits (`assets.tag.renamed` / `assets.tag.removed` / `assets.tags.applied`). Register in index.ts. Trash is naturally skipped (`listAssets` only walks `store/`).
**Accept/Verify:** `tests/plugins/assets/tag-ops.test.ts` — multi-asset sweep, merge on rename collision, non-carrying assets' manifests untouched (compare mtime/serialized bytes), apply add+remove + per-asset results, trash dir untouched.

### T5 — Search provenance + tags facet (commit 5)
1. `search-doc.ts`: add `surface: current.generation?.surface ?? ''` (text, searchable+embedded), `provider`/`model` (keyword) — empty strings when no generation.
2. index.ts registration: schema adds `surface {text}`, `provider {keyword}`, `model {keyword}`; `searchableFields` += `surface`; both `embeddingTemplate`s += `{{surface}}`; `facets` += `provider`, `model`.
3. **Tags facet (F6):** the comma-joined `text` field CANNOT facet — a terms aggregation on it yields one bucket with the whole `"a, b"` string (adapter maps facets to terms aggs, `packages/adapter-antfly/src/search.ts:532`; `text` → analyzed, `search.ts:501`). Add a dedicated `tags_facet: { type: 'array' }` field (adapter maps `array → ['keyword']`, `search.ts:506`) populated with the normalized tag array, and facet on it. **Caveat:** no array-valued field exists anywhere in the repo yet, so antfly's array-terms-bucketing is unverified — spike it first against a dev Antfly; if buckets don't split per element, ship F6 as provider/model facets only and file the tags-facet follow-up. The grid's Tags FacetFilter (T6) is client-side and unaffected either way.
4. **Schema migration (mandatory, not optional):** existing tables are never altered — `tables.create` no-ops when the table exists (`search.ts:215`). Bump `SCHEMA_VERSION` 2 → 3 in `src/core/search-migration.ts:35` (+ version-history comment) so boot does drop → recreate-with-new-schema → reindex. `bakin reindex` alone pushes docs into the OLD schema and the new fields never materialize.
**Accept/Verify:** update `search-doc.test.ts` + `multimodal-indexing.test.ts`; new assertions: doc carries surface/provider/model (+ tags_facet array); absent generation → empty fields; Antfly disabled → no-ops. Migration verified by booting dev server against a pre-existing index.

### T6 — Tags facet filter + breadcrumb (commit 6)
`VersionedAssetGrid.tsx`: `useQueryArrayState('tags')`; tag options + counts derived from loaded summaries (`__untagged__` sentinel entry labeled "Untagged"); second `FacetFilter` next to Type; client-side filter extends line 245 (`__untagged__` matches `tags.length===0`); breadcrumb row when tags filter active — `Folders / <tag(s)> ✕` linking `view=tags` / clearing filter.
**Accept/Verify:** URL-backed (`?tags=a,b` deep-links), works in grid+list, search+type filters compose. Manual dev check; component behavior covered by E2E-ish manual pass (matches existing repo practice — grid has no unit tests).
*(Noted UX gap, deliberately out of scope: `AssetMetaSummary` tag badges on cards stay non-clickable — filtering goes through the facet. Revisit if it chafes.)*

### T7 — Edit drawer (commit 7)
1. New `TagInput.tsx` (plugin-local): badge chips with ✕, text input with suggestion popover (filtered existing tags from summaries), Enter adds freeform; client-side preview of normalization (server is authority).
2. New `AssetEditDrawer.tsx`: `BakinDrawer` (use `dirty` prop), Description `Textarea` + TagInput; Save → `PATCH /versioned/:id/metadata`; error display; close on success (SSE refetch reconciles).
3. Affordances: hover pencil on `AssetCard` (stopPropagation vs card onClick), action on `AssetListRow`, Edit button in `VersionedAssetDetail.tsx` header.
**Accept/Verify:** edit from all three entry points round-trips; Esc/backdrop close respects dirty state. Manual dev pass.

### T8 — Folders view (commit 8)
`VIEW_OPTIONS` += `{ key: 'tags', label: 'Folders', Icon: Folder }`. New `TagFolderGrid.tsx`: group summaries by tag (multi-membership), Untagged pinned first, folders sorted by max(updated) desc; folder card = up-to-4 thumb collage (`AssetThumb`) + name + count; click → `setView('grid')` + `setTags([tag])`; kebab → Rename (input dialog) / Delete (confirm dialog) → commit-4 routes → SSE refetch.
**Accept/Verify:** folder click lands in filtered grid with breadcrumb back; rename merges; delete clears folder; empty store edge (no tags → just Untagged or empty state). Manual dev pass.

### T9 — Bulk tagging (commit 9)
Selection mode in `VersionedAssetGrid.tsx` (header "Select" toggle; checkboxes on cards/rows; ephemeral state); floating action bar (N selected): TagInput + "Add tags" → `POST /tags/apply`; clear-selection; exit on view change.
**Accept/Verify:** tags land on all selected (SSE refetch shows); selection survives filtering but not view switch. Manual dev pass.

### T10 — Docs (commit 10)
- `.claude/knowledge/assets-versioning.md`: rewrite mirror invariant (description-only), document tag namespace rule, new routes, normalization, global ops + trash caveat, no machine tags.
- `.claude/knowledge/search-system.md` / `search-plugin-guide.md`: only if T5 changed registration patterns worth documenting.
- `README.md`: verified — no assets-feature enumeration exists; no change expected.
**Verify:** docs match shipped behavior; grep for stale "mirror the current version" phrasing repo-wide (it also appears in code comments updated in T2).

## End-to-End Verification (before PR)

1. `bun run test` — full suite green.
2. `bun run build` — typecheck + binary build green.
3. Manual `bun run dev` pass: resize grid (F1) → tag two assets via drawer (F3) → folders view shows them (F2) → click folder → breadcrumb back → rename folder (F4) → bulk-tag three assets (F7) → agent-style addVersion (upload new version on detail page) and confirm tags survive (F8) → search an asset by surface term (F5/F6, if Antfly enabled).
4. Optional Playwright spot-check of grid min-width + drawer flow.
5. PR `feat/assets-usability` → main with summary referencing the spec.
