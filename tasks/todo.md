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
- [ ] Archive #125 tasks → `.claude/tasks/issue-125-{plan,todo}.md`
- [ ] Commit: `chore(issue-129): spec + plan scaffold`

## T1 — feat(models): disk-backed cache + stale flag

- [ ] New file `plugins/models/lib/models-cache.ts` — `readPersistedCache()`, `writePersistedCache()`, `clearPersistedCache()` + zod validation on read
- [ ] Path: `getContentDir() + 'plugin-settings/models/available.json'`; atomic tmp+rename on write
- [ ] Extend `fetchAvailableModels()` in `plugins/models/index.ts`:
  - In-memory hot read stays
  - On in-memory miss → check disk → hydrate + return with `stale` flag
  - On OpenClaw fetch success → write both caches
  - On OpenClaw failure + no cache → return `{ models: [], cached: false, error }` (NOT `fallbackModels()`)
- [ ] Response shape gains `stale: boolean`; `AvailableModelsResponse` in `plugins/models/types.ts` gains optional field
- [ ] New test `tests/plugins/models/models-cache.test.ts` — round-trip, corrupt JSON returns null, missing file returns null, clear deletes
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run tests/plugins/models/` clean
- [ ] Commit: `feat(models): disk-backed cache with stale flag`

## T2 — feat(models): /refresh + gateway-restart invalidation

- [ ] New route: `POST /api/plugins/models/refresh`
  - Bypasses cache
  - Calls `loadConfiguredModelsFromOpenClaw`
  - On success → write both caches
  - On failure + disk cache exists → `{ ok: false, error, models: cachedModels, stale: true }`
  - On failure + no cache → `{ ok: false, error, models: [] }`
- [ ] Extend `POST /gateway/restart` (`plugins/models/index.ts:647`):
  - After successful restart, call `setModelsCache(null)` + `clearPersistedCache()`
- [ ] Extend `tests/plugins/models/routes.test.ts` — `/refresh` happy + failure paths; cache-clear on gateway restart
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Commit: `feat(models): manual refresh endpoint + invalidate cache on gateway restart`

## T3 — refactor(models): delete fallbackModels + MODEL_CATALOG dead code

- [ ] Remove `fallbackModels()` from `plugins/models/index.ts:252-259`
- [ ] Remove `MODEL_CATALOG` + `ModelCatalogEntry` from `plugins/models/types.ts:45-58`
- [ ] Verify greps all return zero:
  - [ ] `grep -rn 'fallbackModels' plugins/models/` → 0 hits
  - [ ] `grep -rn 'MODEL_CATALOG' plugins/` → 0 hits
  - [ ] `grep -rn 'ModelCatalogEntry' plugins/` → 0 hits
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Commit: `refactor(models): remove fallbackModels + MODEL_CATALOG dead code`

## T4 — feat(models): curated catalog data module

- [ ] New file `plugins/models/data/known-models.ts` — interfaces + arrays + helpers
- [ ] `KnownModel` with: id, name, description?, bestFor?, tier?, contextWindow?, costRange?, kind, brandIconSlug?
- [ ] `KnownProvider` with: id, label, brandIconSlug?, brandColor?
- [ ] Seed:
  - [ ] 4 Anthropic LLMs (haiku 4.5, sonnet 4.5, sonnet 4.6, opus 4.6)
  - [ ] 3 OpenAI LLMs (gpt-5.4, gpt-5, gpt-4o)
  - [ ] 2 Google LLMs (gemini 2.5 pro, gemini 2.5 flash)
  - [ ] 2 Ollama LLMs (llama 3.3, qwen 2.5)
  - [ ] 5 image: DALL-E 3, Imagen 4, Flux (pro), SDXL, Midjourney v6.1
  - [ ] 5 video: Seedance, Kling 1.6, Runway Gen-3 Alpha, Sora, Veo 2
  - [ ] 10 providers covering every model's `providerFromId` output with `brandIconSlug` + `brandColor`
- [ ] `getKnownModel(id)` — exact match, fallback to date-suffix-strip retry (`id.replace(/-\d{8}$/, '')`)
- [ ] `getKnownProvider(id)` — exact match only
- [ ] New test `tests/plugins/models/known-models.test.ts` — 5+ cases
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run tests/plugins/models/` clean
- [ ] Commit: `feat(models): curated catalog of 22 popular models + providers`

## T5 — feat(models): enrich AvailableModel from catalog

- [ ] Extend `AvailableModel` in `plugins/models/types.ts` with optional: description, bestFor, costRange, kind, brandIconSlug, providerLabel, providerBrandIconSlug, providerBrandColor
- [ ] Update `.map(...)` block in `loadConfiguredModelsFromOpenClaw` (around `plugins/models/index.ts:213`) to merge `getKnownModel(id)` + `getKnownProvider(providerFromId(id))`
- [ ] Extend `tests/plugins/models/routes.test.ts` with an enrichment regression — fixture OpenClaw response containing a known id produces enriched shape; unknown id falls back to `tierFromId` with no enrichment fields
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Commit: `feat(models): enrich AvailableModel with curated catalog metadata`

## T6 — feat(models): BrandIcon + simple-icons dep

- [ ] `pnpm add simple-icons`
- [ ] Verify deep import works: `cat node_modules/simple-icons/icons/openai.js` — should export `{ title, slug, path, hex, source }`
- [ ] New file `plugins/models/components/brand-icon.tsx`
- [ ] Import map of 10 brands: anthropic, openai, google, ollama, runway, stability, midjourney, bytedance, kuaishou, blackforestlabs
- [ ] Props: `slug?`, `fallbackText?`, `fallbackColor?`, `size?`, `className?`
- [ ] Known slug → SVG with `<path d={icon.path}/>` inside a `<svg viewBox="0 0 24 24">`
- [ ] Unknown slug / missing → first-letter chip with `fallbackColor` bg
- [ ] New test `tests/plugins/models/brand-icon.test.tsx` — 4 cases (known, unknown, empty, color-applied)
- [ ] Checkpoint: `pnpm tsc --noEmit` clean; bundle not catastrophically larger (eyeball only)
- [ ] Commit: `feat(models): BrandIcon component with simple-icons + first-letter fallback`

## T7 — feat(models): models-page UI — Refresh, cache-age, banner, enriched cards

- [ ] Surgical edits inside `tab === 'available'` block (`plugins/models/components/models-page.tsx:590-640`)
- [ ] Mount-time fetch for `GET /gateway/status`; render amber banner when `restartNeeded: true`
- [ ] Top of tab: Refresh button (calls `POST /refresh`; disables during in-flight) + `Last refreshed: X ago` indicator
- [ ] Provider header: `<BrandIcon slug={providerBrandIconSlug} fallbackText={providerLabel ?? provider} fallbackColor={providerBrandColor} />` + label
- [ ] Model row: enriched layout when catalog fields present (description, bestFor badge, contextWindow, costRange), plain layout otherwise
- [ ] Loading state when fetch in-flight AND no cache yet: spinner + "Querying OpenClaw gateway — this can take up to 30 seconds on first load"
- [ ] Error state when fetch failed AND no cache: error message + Retry button
- [ ] Smoke: load `/models/?tab=available` → enriched cards for Anthropic/OpenAI; plain rows for anything else
- [ ] Other tabs (agents, aliases, profiles) render unchanged
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Commit: `feat(models): enriched cards + Refresh button + cache-age + gateway-sync banner`

## T8 — test(models): regression guards

- [ ] Extend `tests/plugins/models/routes.test.ts`: `/refresh` path, `/available` stale flag, gateway-restart cache-clear
- [ ] New `tests/plugins/models/enrichment.test.ts`: enriched `AvailableModel[]` for known ids, plain for unknown, date-suffix-strip match end-to-end
- [ ] New `tests/plugins/models/models-page.test.tsx`: cache-age indicator renders, Refresh button triggers `/refresh`, loading state with no cache, error state on fetch fail, gateway-sync banner renders on flag
- [ ] All required mocks per CLAUDE.md (content-dir, logger, watcher, openclaw-client, tasks/flow-store, cross-plugin hooks)
- [ ] Grep verifications repeat (zero hits): fallbackModels, MODEL_CATALOG, ModelCatalogEntry
- [ ] Checkpoint: full `pnpm vitest run` + `pnpm tsc --noEmit` clean (ignore pre-existing dagre failures)
- [ ] Commit: `test(models): regression guards for cache + enrichment + loading UI`

## T9 — Ship

- [ ] Delete `~/.bakin/plugin-settings/models/available.json` to force cold-start test
- [ ] Manual smoke: loading → real data → Refresh → banner flow
- [ ] Visual check: Anthropic/OpenAI enriched cards render with logos + descriptions + cost range
- [ ] Visual check: non-catalog model (e.g. local Ollama) renders plain row without errors
- [ ] `git push -u origin issue-129-models-loading-ux`
- [ ] Open PR against `main`, reference #129, link spec + plugin-system one-pager
- [ ] Merge when green
- [ ] Close #129 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-129-{plan,todo}.md`
