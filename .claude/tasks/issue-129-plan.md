# Plan — Issue #129: Models loading UX + curated catalog

**Spec:** `.claude/specs/issue-129-models-loading-ux-and-catalog.md`
**Issue:** https://github.com/markhayden/bakin/issues/129
**Branch:** `issue-129-models-loading-ux`
**Replaces:** closed #128 (plugin-contributed models registry — premature abstraction)

## Goal

Kill `fallbackModels()` (the 15-second cold-start lie) by moving model data to a persistent disk cache, and while we're in there, ship the curated catalog + brand icons + enriched UI that makes the models page actually useful. One PR, two user-visible wins: honest loading states + rich model cards.

## Dependency graph

```
T0 scaffold (archive #125 tasks, write this plan + todo)
  │
  ▼
T1 disk cache + stale flag ...................... (foundation)
  │
  ▼
T2 /refresh route + gateway-restart invalidation . (depends on T1)
  │
  ▼
T3 delete fallbackModels + MODEL_CATALOG dead code (depends on T1 so nothing still calls fallback)
  │
  ▼
T4 curated catalog data module ................... (independent; new data, no consumers yet)
  │
  ▼
T5 enrich AvailableModel from catalog ............ (depends on T4)
  │
  ▼
T6 BrandIcon component + simple-icons dep ........ (independent; sets up the icon surface T7 uses)
  │
  ▼
T7 enriched models-page cards + Refresh + banner . (needs T5 fields + T6 icons)
  │
  ▼
T8 regression tests (full coverage pass)
  │
  ▼
T9 ship
```

Solo sequential. Each task = one commit. Intermediate commits must build and pass tests — no broken-main moments.

## Task detail

### T0 — chore(issue-129): spec + plan scaffold

**Already done:**
- Branch `issue-129-models-loading-ux` created from `main`
- Issue #128 closed with rationale (plugin-registry for models is premature)
- `docs/ideas/plugin-system.md` updated to strike `models.providers` from the registry list
- Spec written at `.claude/specs/issue-129-models-loading-ux-and-catalog.md`

**Still to do (this task):**
- Archive issue-125 tasks → `.claude/tasks/issue-125-{plan,todo}.md`
- Write this `tasks/plan.md` + `tasks/todo.md`
- One commit bundling all scaffolding

**Acceptance:**
- [ ] `tasks/plan.md` + `tasks/todo.md` present, scoped to #129
- [ ] `.claude/tasks/issue-125-{plan,todo}.md` present with #125's final state
- [ ] Commit message: `chore(issue-129): spec + plan scaffold`

---

### T1 — feat(models): disk-backed cache + stale flag

**What:** Move model cache persistence from in-memory-only to in-memory + disk. Response gains `stale: boolean`.

**"Look first":** the existing cache at `plugins/models/index.ts:149-157` uses `globalThis.__bakinModelsCache`. Keep it as the hot-read layer; disk is underneath. Do NOT rip out the globalThis pattern.

**Files:**
- New: `plugins/models/lib/models-cache.ts` — disk read/write with zod-validated reads
- Edit: `plugins/models/index.ts` — `fetchAvailableModels()` extended to read disk on cold start, write disk on success, return `stale: boolean` in the response
- Edit: `plugins/models/types.ts` — `AvailableModelsResponse` gains optional `stale?: boolean` field
- New test: `tests/plugins/models/models-cache.test.ts`

**Shape:**

```ts
// plugins/models/lib/models-cache.ts
interface PersistedCache {
  models: AvailableModel[]
  fetchedAt: number
  source: 'openclaw' | 'empty'
}
export function readPersistedCache(): PersistedCache | null   // zod-validated; returns null on miss/corrupt
export function writePersistedCache(cache: PersistedCache): void  // atomic tmp+rename
export function clearPersistedCache(): void
```

Path: `getContentDir()` + `plugin-settings/models/available.json`. Mkdir parent on first write.

Response flow in `/available`:
1. In-memory cache fresh → return `{ models, cached: true, cachedAt, stale: false }`
2. In-memory cache empty but disk cache present → hydrate in-memory, return `{ models, cached: true, cachedAt, stale: (Date.now() - cachedAt) > CACHE_TTL }`
3. Both empty → call `loadConfiguredModelsFromOpenClaw`; write both caches on success, return `{ models, cached: false, cachedAt: now, stale: false }`
4. OpenClaw fails AND no cache → return `{ models: [], cached: false, cachedAt: null, error: '...' }` — **never** `fallbackModels()`

Note: `fallbackModels()` still exists in the file after T1; T3 deletes it. T1 just stops calling it in the success-empty branch.

**Acceptance:**
- [ ] `plugins/models/lib/models-cache.ts` exists with 3 exports + zod validation on read
- [ ] Disk cache path resolves to `~/.bakin/plugin-settings/models/available.json`
- [ ] First `/available` on a fresh install with no disk file returns an HTTP-200 with `models: []` + error (no fake data) — unless OpenClaw is reachable, in which case fresh fetch + disk write
- [ ] Response shape includes `stale: boolean`
- [ ] `fallbackModels()` is no longer referenced in `fetchAvailableModels` (still defined, deleted in T3)
- [ ] Unit tests cover: round-trip write/read, corrupt JSON returns null, missing file returns null, `clearPersistedCache` deletes the file
- [ ] `pnpm tsc --noEmit` + `pnpm vitest run tests/plugins/models/` clean

**Commit:** `feat(models): disk-backed cache with stale flag`

---

### T2 — feat(models): manual refresh + gateway-restart cache invalidation

**What:** New `POST /api/plugins/models/refresh` endpoint that forces a cache bypass. Extend `POST /gateway/restart` to wipe both caches.

**"Look first":** `getGatewaySync()`/`markGatewayRestarted()` live at `plugins/models/index.ts:23-28` (same file). `POST /gateway/restart` exists at `:647`. Just extend, don't relocate.

**Files:**
- Edit: `plugins/models/index.ts` — new `/refresh` route; `/gateway/restart` clears in-memory + disk cache after successful restart
- Edit: existing `tests/plugins/models/routes.test.ts` — add cases for /refresh + cache-clear on restart

**Flow for `/refresh`:**
- Ignore cache
- Call `loadConfiguredModelsFromOpenClaw` directly
- On success: write both in-memory + disk cache
- On failure + there IS a disk cache: return `{ ok: false, error, models: cachedModels, stale: true }`
- On failure + no cache: return `{ ok: false, error, models: [] }`

**Acceptance:**
- [ ] `POST /api/plugins/models/refresh` route registered
- [ ] `/refresh` bypasses cache and returns fresh data
- [ ] `/refresh` on OpenClaw failure falls back to last-known-good cache when available
- [ ] `POST /gateway/restart` clears in-memory AND disk cache on successful restart
- [ ] `pnpm vitest run` clean
- [ ] `pnpm tsc --noEmit` clean

**Commit:** `feat(models): manual refresh endpoint + invalidate cache on gateway restart`

---

### T3 — refactor(models): delete fallbackModels + MODEL_CATALOG dead code

**What:** Pure deletion. Both surfaces are now unused.

**Files:**
- Edit: `plugins/models/index.ts` — remove `fallbackModels()` function (lines 252-259)
- Edit: `plugins/models/types.ts` — remove `MODEL_CATALOG` + `ModelCatalogEntry` (lines 45-58)

**Grep verifications (all zero hits):**
- `grep -rn 'fallbackModels' plugins/models/`
- `grep -rn 'MODEL_CATALOG' plugins/`
- `grep -rn 'ModelCatalogEntry' plugins/`

**Acceptance:**
- [ ] All three greps return zero hits
- [ ] `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] No test regressions — `MODEL_CATALOG` was dead code, nothing depends on it

**Commit:** `refactor(models): remove fallbackModels + MODEL_CATALOG dead code`

---

### T4 — feat(models): curated catalog data module

**What:** New `plugins/models/data/known-models.ts` with the 22-entry seed + lookup helpers.

**Files:**
- New: `plugins/models/data/known-models.ts` — exports `KnownModel`, `KnownProvider`, `KNOWN_MODELS`, `KNOWN_PROVIDERS`, `getKnownModel`, `getKnownProvider`
- New test: `tests/plugins/models/known-models.test.ts`

**Seed: 9 LLMs + 5 image + 5 video + providers** (per spec §Seed entries).

**`getKnownModel` normalization:**
- Exact match first
- On miss, strip trailing `-\d{8}` date suffix and retry
- Return `undefined` otherwise

**Providers seed:** at minimum `anthropic`, `openai` (and `openai-codex` alias), `google`, `ollama`, `bytedance`, `kuaishou`, `runway`, `black-forest-labs`, `stability`, `midjourney` with matching `brandIconSlug` + `brandColor` (hex).

**Acceptance:**
- [ ] 22 model entries across `kind: 'llm' | 'image' | 'video'` (9 + 5 + 5; 3 slots flexibility if a seed model shifts)
- [ ] Providers cover every model's `providerFromId` output
- [ ] `getKnownModel('anthropic/claude-sonnet-4-6-20250514')` matches the base `anthropic/claude-sonnet-4-6` entry
- [ ] `getKnownModel('unknown/model')` returns undefined
- [ ] Unit tests: exact match, date-suffix-strip match, miss, provider lookup hit + miss
- [ ] `pnpm tsc --noEmit` + `pnpm vitest run tests/plugins/models/` clean

**Commit:** `feat(models): curated catalog of 22 popular models + providers`

---

### T5 — feat(models): enrich AvailableModel from catalog

**What:** `loadConfiguredModelsFromOpenClaw` merges catalog metadata into every returned `AvailableModel`.

**Files:**
- Edit: `plugins/models/types.ts` — `AvailableModel` gains optional fields: `description`, `bestFor`, `costRange`, `kind`, `brandIconSlug`, `providerLabel`, `providerBrandIconSlug`, `providerBrandColor`
- Edit: `plugins/models/index.ts` — enrichment in the `.map(...)` block at `:213` (around the existing `AvailableModel` construction)
- Extend: `tests/plugins/models/routes.test.ts` — fixture OpenClaw response for a known id should produce an `AvailableModel` with the catalog's `description` / `bestFor` / `costRange`; unknown id falls back to `tierFromId`

**Enrichment shape (preserves existing fallbacks):**

```ts
const known = getKnownModel(id)
const knownProvider = getKnownProvider(providerFromId(id))
return {
  id,
  name: known?.name ?? model.name ?? id,
  tier: known?.tier ?? tierFromId(id),
  provider: providerFromId(id),
  providerLabel: knownProvider?.label,
  providerBrandIconSlug: knownProvider?.brandIconSlug,
  providerBrandColor: knownProvider?.brandColor,
  description: known?.description,
  bestFor: known?.bestFor,
  costRange: known?.costRange,
  kind: known?.kind,
  brandIconSlug: known?.brandIconSlug,
  // ... existing fields untouched
}
```

**Acceptance:**
- [ ] `AvailableModel` type has the 8 new optional fields
- [ ] Mocked OpenClaw fixture including `anthropic/claude-sonnet-4-6` produces enriched shape with catalog fields
- [ ] Mocked OpenClaw fixture for an unknown id still constructs a valid `AvailableModel` with `tier` from `tierFromId` heuristic and no enrichment fields
- [ ] Existing `routes.test.ts` tests still pass (no regression on existing assertions)
- [ ] `pnpm tsc --noEmit` clean — downstream consumers ignore the new optional fields

**Commit:** `feat(models): enrich AvailableModel with curated catalog metadata`

---

### T6 — feat(models): BrandIcon component + simple-icons dep

**What:** New client component that renders SVG brand logos via `simple-icons`, with first-letter chip fallback.

**"Look first":**
- Run `pnpm add simple-icons` first; verify the deep-import shape by `cat node_modules/simple-icons/icons/openai.js` (should export `{ title, slug, path, hex, source }`)
- If tree-shaking concerns appear (bundle swells visibly), switch to deep imports by path: `import siOpenai from 'simple-icons/icons/openai'`. Not a blocker — covered in the spec's Not Doing list (no dynamic imports).

**Files:**
- `package.json` + `pnpm-lock.yaml` — add `simple-icons` dep
- New: `plugins/models/components/brand-icon.tsx`
- New test: `tests/plugins/models/brand-icon.test.tsx`

**Import map: 10 slugs** matching the seed catalog — `anthropic`, `openai`, `google`, `ollama`, `runway`, `stability`, `midjourney`, `bytedance`, `kuaishou`, `blackforestlabs`. Plus `helpcircle`-shaped fallback if any icon happens to be missing in the package.

**Props:**

```ts
interface BrandIconProps {
  slug?: string
  fallbackText?: string       // for first-letter chip
  fallbackColor?: string      // hex
  size?: 'sm' | 'md'
  className?: string
}
```

**Fallback rules:**
- `slug` present and in the map → render the SVG path
- `slug` missing or not in the map → render first-letter chip with `fallbackColor` bg
- `fallbackText` missing → render `?`

**Acceptance:**
- [ ] `simple-icons` installed, lockfile updated
- [ ] `plugins/models/components/brand-icon.tsx` exports `BrandIcon`
- [ ] Renders `<svg>` for known slug, `<span>` chip for unknown/missing
- [ ] `pnpm build` (or `pnpm tsc --noEmit`) clean — no TS errors from the deep imports
- [ ] Bundle size check: nothing obviously catastrophic. Eyeball only, not a hard gate.
- [ ] Tests: 4 cases (known slug renders path, unknown slug renders chip, empty text renders '?', bg color applied)

**Commit:** `feat(models): BrandIcon component with simple-icons + first-letter fallback`

---

### T7 — feat(models): enriched models-page cards + Refresh + cache-age + banner

**What:** The visible UI work. All changes scoped to the `tab === 'available'` block in `plugins/models/components/models-page.tsx` (lines ~590-640) plus a tab-header area for the Refresh button.

**"Look first:** models-page.tsx is 808 lines; surgical edits, no full-page refactor. The tab content lives inside an `AnimatePresence`-style conditional block. Refresh button + cache-age indicator probably belong inside the `tab === 'available'` block's header (above the provider sections), not in the top-level page header.

**UI additions:**
1. **Refresh button + cache-age indicator** at top of `tab === 'available'`:
   - Button disabled during in-flight request
   - Spinner replaces icon while refreshing
   - Text: `Last refreshed: 2m ago` (under 24h → relative; older → absolute date)
2. **Gateway-out-of-sync banner** — pulled from `GET /gateway/status` on mount (`restartNeeded === true`):
   - Amber background, inline `Restart gateway` button
   - Only renders when flag is true
3. **Provider header** now renders `<BrandIcon slug={providerBrandIconSlug} fallbackText={providerLabel ?? provider} fallbackColor={providerBrandColor} />` + `{providerLabel ?? provider.replace(/[-_]/g, ' ')}`
4. **Model row** gains (when catalog match exists):
   - Small `<BrandIcon>` next to name
   - `description` as muted secondary line
   - `bestFor` badge next to the tier badge
   - `contextWindow` as mono-font small text next to name
   - `costRange` right-aligned at end of row
5. **Loading state** when fetch in-flight AND no cache yet: spinner + "Querying OpenClaw gateway — this can take up to 30 seconds on first load"
6. **Error state** when fetch failed AND no cache: error message + Retry button (calls `POST /refresh`)

**Files:**
- Edit: `plugins/models/components/models-page.tsx` — surgical edits inside `tab === 'available'` block + a mount-time fetch for gateway-status
- Optional new file: `plugins/models/components/model-card-row.tsx` if the enriched row JSX gets unwieldy inline (judgment call during implementation — prefer inline unless it hurts readability)

**Acceptance:**
- [ ] Refresh button triggers `POST /api/plugins/models/refresh` + updates UI
- [ ] Cache-age indicator renders relative time for <24h, absolute date otherwise
- [ ] Provider headers render `<BrandIcon>` + resolved label
- [ ] Model rows with catalog match show description + bestFor badge + contextWindow + costRange
- [ ] Model rows without catalog match show plain (existing) layout — no regression
- [ ] First-ever load (no cache) shows loading state, not fake data
- [ ] Fetch failure + no cache shows error + Retry button
- [ ] Gateway-out-of-sync banner renders when `/gateway/status` reports `restartNeeded: true`
- [ ] Existing model-selector UIs on other tabs (agents, aliases, profiles) render unchanged
- [ ] `pnpm tsc --noEmit` clean; `pnpm vitest run` clean

**Commit:** `feat(models): enriched cards + Refresh button + cache-age + gateway-sync banner`

---

### T8 — test(models): regression guards

**What:** Comprehensive test pass for the loading/catalog flow. Existing test coverage at `tests/plugins/models/` is limited to `routes.test.ts`; expand to cover cache + enrichment + UI degradation cases that the earlier commits didn't lock down.

**Files:**
- Extend: `tests/plugins/models/routes.test.ts` — new cases for `/refresh`, cache stale flag, gateway-restart cache-clear
- New: `tests/plugins/models/enrichment.test.ts` — mocked OpenClaw fixture → enriched `AvailableModel[]` with catalog fields; unknown ids have no enrichment; date-suffix-stripped match works end-to-end
- New: `tests/plugins/models/models-page.test.tsx` — component-level regression: renders cache-age indicator, renders Refresh button, triggers refresh, shows loading state with no cache, shows error state on fetch failure, gateway-sync banner renders when flag present

**Mocks required:** content-dir, logger, watcher, openclaw-client, tasks/flow-store (per CLAUDE.md), plus `use-agent-store` and any other cross-plugin hooks the page references.

**Acceptance:**
- [ ] New regression tests pass
- [ ] Full `pnpm vitest run` clean (ignore pre-existing `@dagrejs/dagre` failures)
- [ ] `pnpm tsc --noEmit` clean
- [ ] Grep verifications (repeat from T3 for the final artifact): `fallbackModels` / `MODEL_CATALOG` / `ModelCatalogEntry` all zero hits

**Commit:** `test(models): regression guards for cache + enrichment + loading UI`

---

### T9 — Ship

- [ ] Manual smoke on maintainer's install:
  - Delete `~/.bakin/plugin-settings/models/available.json` to force cold start
  - Load `/models` → loading state appears briefly, then real data lands
  - Click Refresh → spinner, then updated timestamp
  - Trigger a gateway config change (edit `openclaw.json`, don't restart) → banner appears
  - Click the banner's Restart button → banner clears, cache refreshes
  - Verify enriched cards for `anthropic/claude-sonnet-4-6` show description + bestFor + cost range + logo
  - Verify a non-catalog model (e.g. an OSS local) renders plain row without errors
- [ ] `git push -u origin issue-129-models-loading-ux`
- [ ] Open PR against `main`, reference #129, link spec + plugin-system one-pager
- [ ] Merge when green
- [ ] Close #129 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-129-{plan,todo}.md`

## Commit strategy

One PR, 9 implementation commits (T0 scaffold + T1–T8) plus any hotfix commits that show up during testing. Each commit self-contained: tsc clean, tests pass, no broken intermediate state. Intermediate commits must not break the models page — so T1 stops *calling* `fallbackModels()` but keeps the function defined until T3.

## Risks / call-outs

- **T1 disk-cache write contention.** If two server processes write concurrently, atomic tmp+rename prevents corruption but the later write wins. In practice Bakin is single-process per install, so this is theoretical. Flag only if we later support multi-process.
- **T6 simple-icons bundle size.** If deep-imports don't tree-shake cleanly, client bundle swells by the full icon set (~1.5 MB). Worst case: do static imports for only the 10 brands we need (already planned), confirmed tree-shakable via deep paths. If bundle concern materializes, cut back to first-letter chips only and accept the loss of visual polish.
- **T7 scope creep into a full models-page redesign.** The spec is crystal clear — surgical edits inside `tab === 'available'`. Don't touch other tabs. Don't reshape the page layout. If a visual tweak elsewhere is tempting, note it as a follow-up issue and move on.
- **T8 test file sprawl.** Three new test files is a lot; if any feel redundant during writing, consolidate. The point is coverage, not file count.
- **Pre-existing `@dagrejs/dagre` failures** in the test suite are unrelated and will still fail on this branch. Not a blocker; not introduced by #129.

## Archival

After merge, T9 moves `tasks/plan.md` + `tasks/todo.md` into `.claude/tasks/issue-129-{plan,todo}.md` — matches the `issue-115-`, `issue-118-`, `issue-125-` archival pattern already in that directory.
