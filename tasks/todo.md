# TODO: Issue #129 — Models loading UX + curated catalog

**Spec:** `.claude/specs/issue-129-models-loading-ux-and-catalog.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/129
**Branch:** `issue-129-models-loading-ux`

## T0 — Branch + scaffold commit

- [x] `git checkout -b issue-129-models-loading-ux`
- [x] Close #128 with rationale
- [x] Update `docs/ideas/plugin-system.md` to strike `models.providers`
- [x] Write spec at `.claude/specs/issue-129-models-loading-ux-and-catalog.md`
- [x] Archive #125 tasks → `.claude/tasks/issue-125-{plan,todo}.md`
- [x] Commit: `chore(issue-129): spec + plan scaffold`

## T1 — feat(models): disk-backed cache + stale flag

- [x] New file `plugins/models/lib/models-cache.ts` — `readPersistedCache()`, `writePersistedCache()`, `clearPersistedCache()` + zod validation on read
- [x] Path: `getContentDir() + 'plugin-settings/models/available.json'`; atomic tmp+rename on write
- [x] Extend `fetchAvailableModels()` in `plugins/models/index.ts`:
  - In-memory hot read stays
  - On in-memory miss → check disk → hydrate + return with `stale` flag
  - On OpenClaw fetch success → write both caches
  - On OpenClaw failure + no cache → return `{ models: [], cached: false, error }` (NOT `fallbackModels()`)
- [x] Response shape gains `stale: boolean`; `AvailableModelsResponse` in `plugins/models/types.ts` gains optional field
- [x] New test `tests/plugins/models/models-cache.test.ts` — round-trip, corrupt JSON returns null, missing file returns null, clear deletes
- [x] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run tests/plugins/models/` clean
- [x] Commit: `feat(models): disk-backed cache with stale flag`

## T2 — feat(models): /refresh + gateway-restart invalidation

- [x] New route: `POST /api/plugins/models/refresh`
  - Bypasses cache
  - Calls `loadConfiguredModelsFromOpenClaw`
  - On success → write both caches
  - On failure + disk cache exists → `{ ok: false, error, models: cachedModels, stale: true }`
  - On failure + no cache → `{ ok: false, error, models: [] }`
- [x] Extend `POST /gateway/restart` (`plugins/models/index.ts:647`):
  - After successful restart, call `setModelsCache(null)` + `clearPersistedCache()`
- [x] Extend `tests/plugins/models/routes.test.ts` — `/refresh` happy + failure paths; cache-clear on gateway restart
- [x] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [x] Commit: `feat(models): manual refresh endpoint + invalidate cache on gateway restart`

## T3 — refactor(models): delete fallbackModels + MODEL_CATALOG dead code

- [x] Remove `fallbackModels()` from `plugins/models/index.ts:252-259`
- [x] Remove `MODEL_CATALOG` + `ModelCatalogEntry` from `plugins/models/types.ts:45-58`
- [x] Verify greps all return zero:
  - [ ] `grep -rn 'fallbackModels' plugins/models/` → 0 hits
  - [ ] `grep -rn 'MODEL_CATALOG' plugins/` → 0 hits
  - [ ] `grep -rn 'ModelCatalogEntry' plugins/` → 0 hits
- [x] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [x] Commit: `refactor(models): remove fallbackModels + MODEL_CATALOG dead code`

## T4 — feat(models): curated catalog data module

- [x] New file `plugins/models/data/known-models.ts` — interfaces + arrays + helpers
- [x] `KnownModel` with: id, name, description?, bestFor?, tier?, contextWindow?, costRange?, kind, brandIconSlug?
- [x] `KnownProvider` with: id, label, brandIconSlug?, brandColor?
- [x] Seed:
  - [ ] 4 Anthropic LLMs (haiku 4.5, sonnet 4.5, sonnet 4.6, opus 4.6)
  - [ ] 3 OpenAI LLMs (gpt-5.4, gpt-5, gpt-4o)
  - [ ] 2 Google LLMs (gemini 2.5 pro, gemini 2.5 flash)
  - [ ] 2 Ollama LLMs (llama 3.3, qwen 2.5)
  - [ ] 5 image: DALL-E 3, Imagen 4, Flux (pro), SDXL, Midjourney v6.1
  - [ ] 5 video: Seedance, Kling 1.6, Runway Gen-3 Alpha, Sora, Veo 2
  - [ ] 10 providers covering every model's `providerFromId` output with `brandIconSlug` + `brandColor`
- [x] `getKnownModel(id)` — exact match, fallback to date-suffix-strip retry (`id.replace(/-\d{8}$/, '')`)
- [x] `getKnownProvider(id)` — exact match only
- [x] New test `tests/plugins/models/known-models.test.ts` — 5+ cases
- [x] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run tests/plugins/models/` clean
- [x] Commit: `feat(models): curated catalog of 22 popular models + providers`

## T5 — feat(models): enrich AvailableModel from catalog

- [x] Extend `AvailableModel` in `plugins/models/types.ts` with optional: description, bestFor, costRange, kind, brandIconSlug, providerLabel, providerBrandIconSlug, providerBrandColor
- [x] Update `.map(...)` block in `loadConfiguredModelsFromOpenClaw` (around `plugins/models/index.ts:213`) to merge `getKnownModel(id)` + `getKnownProvider(providerFromId(id))`
- [x] Extend `tests/plugins/models/routes.test.ts` with an enrichment regression — fixture OpenClaw response containing a known id produces enriched shape; unknown id falls back to `tierFromId` with no enrichment fields
- [x] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [x] Commit: `feat(models): enrich AvailableModel with curated catalog metadata`

## T6 — feat(models): BrandIcon + simple-icons dep

- [x] `pnpm add simple-icons`
- [x] Verify deep import works: `cat node_modules/simple-icons/icons/openai.js` — should export `{ title, slug, path, hex, source }`
- [x] New file `plugins/models/components/brand-icon.tsx`
- [x] Import map of 10 brands: anthropic, openai, google, ollama, runway, stability, midjourney, bytedance, kuaishou, blackforestlabs
- [x] Props: `slug?`, `fallbackText?`, `fallbackColor?`, `size?`, `className?`
- [x] Known slug → SVG with `<path d={icon.path}/>` inside a `<svg viewBox="0 0 24 24">`
- [x] Unknown slug / missing → first-letter chip with `fallbackColor` bg
- [x] New test `tests/plugins/models/brand-icon.test.tsx` — 4 cases (known, unknown, empty, color-applied)
- [x] Checkpoint: `pnpm tsc --noEmit` clean; bundle not catastrophically larger (eyeball only)
- [x] Commit: `feat(models): BrandIcon component with simple-icons + first-letter fallback`

## T7 — feat(models): models-page UI — Refresh, cache-age, banner, enriched cards

- [x] Surgical edits inside `tab === 'available'` block (`plugins/models/components/models-page.tsx:590-640`)
- [x] Mount-time fetch for `GET /gateway/status`; render amber banner when `restartNeeded: true`
- [x] Top of tab: Refresh button (calls `POST /refresh`; disables during in-flight) + `Last refreshed: X ago` indicator
- [x] Provider header: `<BrandIcon slug={providerBrandIconSlug} fallbackText={providerLabel ?? provider} fallbackColor={providerBrandColor} />` + label
- [x] Model row: enriched layout when catalog fields present (description, bestFor badge, contextWindow, costRange), plain layout otherwise
- [x] Loading state when fetch in-flight AND no cache yet: spinner + "Querying OpenClaw gateway — this can take up to 30 seconds on first load"
- [x] Error state when fetch failed AND no cache: error message + Retry button
- [x] Smoke: load `/models/?tab=available` → enriched cards for Anthropic/OpenAI; plain rows for anything else
- [x] Other tabs (agents, aliases, profiles) render unchanged
- [x] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [x] Commit: `feat(models): enriched cards + Refresh button + cache-age + gateway-sync banner`

## T8 — test(models): regression guards

- [x] Extend `tests/plugins/models/routes.test.ts`: `/refresh` path, `/available` stale flag, gateway-restart cache-clear
- [x] New `tests/plugins/models/enrichment.test.ts`: enriched `AvailableModel[]` for known ids, plain for unknown, date-suffix-strip match end-to-end
- [x] New `tests/plugins/models/models-page.test.tsx`: cache-age indicator renders, Refresh button triggers `/refresh`, loading state with no cache, error state on fetch fail, gateway-sync banner renders on flag
- [x] All required mocks per CLAUDE.md (content-dir, logger, watcher, openclaw-client, tasks/flow-store, cross-plugin hooks)
- [x] Grep verifications repeat (zero hits): fallbackModels, MODEL_CATALOG, ModelCatalogEntry
- [x] Checkpoint: full `pnpm vitest run` + `pnpm tsc --noEmit` clean (ignore pre-existing dagre failures)
- [x] Commit: `test(models): regression guards for cache + enrichment + loading UI`

## T9 — Ship

- [x] `git push -u origin issue-129-models-loading-ux`
- [x] Open PR #131 against `main`, reference #129, link spec + plugin-system one-pager
- [ ] Manual smoke on the other machine (cache wipe → loading → refresh → banner flow)
- [ ] Merge when smoke passes
- [ ] Close #129 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-129-{plan,todo}.md`
