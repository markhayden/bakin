# Models Loading UX + Curated Catalog (#129)

**Status:** Implemented (PR #131, commits `c01b66c..b7cc50b` on `issue-129-models-loading-ux`)
**Tracking issue:** [#129](https://github.com/madeinwyo/bakin/issues/129)
**Replaces:** closed #128 (plugin-contributed models registry — premature abstraction)

## Problem Statement

Two interlocking pains on the models page, both currently papered over with lies.

### A. Loading is slow + the fallback fabricates data

Cold-start flow:

1. Client hits `GET /api/plugins/models/available`
2. Server sees the in-memory cache is empty, calls `loadConfiguredModelsFromOpenClaw` which spawns `openclaw models list --all --json`
3. That CLI takes **15–20 seconds** to resolve on a fresh boot
4. If the call fails or is still pending, the route falls through to `fallbackModels()` (`plugins/models/index.ts:252-259`) which returns four hardcoded entries: GPT-5.4, Claude Sonnet 4.6, Claude Opus 4.6, Claude Haiku 4.5
5. UI renders those four as if they were the real list
6. Eventually OpenClaw responds, cache fills, UI silently swaps to the real data

This is worse than a spinner. It shows confident-looking wrong data for 15s — the user doesn't know they're looking at a placeholder. When OpenClaw is misconfigured or unreachable, the UI actively lies about what models exist.

### B. The UI is bare-bones

`plugins/models/components/models-page.tsx:596-620` renders each model as `name + tier badge` with the provider as a plain text heading (`{provider.replace(/[-_]/g, ' ')}`). No logos, no descriptions, no context-window info, no cost hints, no purpose guidance. `MODEL_CATALOG` in `plugins/models/types.ts:53` has `bestFor` / `contextWindow` metadata but **no consumer reads it** (grep confirms dead code) — it never made it into the UI.

## Goals

- **Kill `fallbackModels()` entirely.** No fabricated data, ever.
- **Persist the model cache to disk** at `~/.bakin/plugin-settings/models/available.json` so cold start renders last-known-good immediately instead of fake data.
- **Honest loading states.** First-ever load or cache-corrupted → spinner + explanatory copy ("Querying OpenClaw gateway — this can take up to 30 seconds on first load"). Never blank, never fake.
- **Manual Refresh button** on the models page so users can force a re-fetch when they know OpenClaw config changed.
- **Cache age indicator** ("Last refreshed: 3h ago") so users can judge whether Refresh is needed.
- **Curated metadata catalog.** Ship a Bakin-maintained lookup of ~22 popular LLM / image / video models with descriptions, cost ranges, tier info, brand icons. Join against OpenClaw-sourced models at read time. Unknown models render plain — no lying.
- **Graceful degradation.** Every failure mode falls back to honest UI: "we couldn't reach OpenClaw, here's why, try again."

## Non-Goals

- Not touching how models are **invoked**. Gateway client path in `openclaw-client.ts` stays identical.
- Not opening a plugin-contribution API for the catalog. This was #128 and it's closed — plugins don't add LLMs.
- Not adding per-provider auth / API-key UI. Credentials live in OpenClaw + BakinSettings as today.
- Not changing the model-selector shape in agent-config UI. Dropdowns keep working; they just render richer rows.
- Not implementing background polling. Refresh is user-initiated or piggybacks on gateway-restart — no timer-based polling.

## Design

### Disk cache

New file `plugins/models/lib/models-cache.ts`:

```ts
interface PersistedCache {
  models: AvailableModel[]
  fetchedAt: number            // ms epoch
  source: 'openclaw' | 'empty' // 'empty' means the fetch succeeded but returned no models
}

const CACHE_FILE = 'models/available.json'  // relative to plugin-settings dir
const STALE_AFTER_MS = 60 * 60 * 1000       // 1h — matches today's in-memory TTL

export function readPersistedCache(): PersistedCache | null
export function writePersistedCache(cache: PersistedCache): void
export function clearPersistedCache(): void
```

Path resolves via `getContentDir()` + `plugin-settings/models/available.json`. Writes atomically (tmp-file + rename). Read failures (missing, corrupt JSON, schema mismatch) return `null` — treated as no-cache.

The in-memory cache (`globalThis.__bakinModelsCache`) stays as a first-line hot read. Flow on `/available`:

1. Check in-memory cache → return if present (existing behavior)
2. Check disk cache → if present, hydrate in-memory + return
3. Otherwise call `loadConfiguredModelsFromOpenClaw` live
4. On success: write both in-memory + disk cache; return
5. On failure: return `{ models: [], cached: false, cachedAt: null, error: '...' }` — **not** `fallbackModels()`

### Stale-but-valid path

When a cached entry is returned, the response shape gains:

```ts
{ models: AvailableModel[], cached: true, cachedAt: number, stale: boolean }
```

- `stale: false` → cache is fresh (<1h) — no background refresh
- `stale: true` → cache is older than `STALE_AFTER_MS` — UI shows the cached data immediately AND triggers a background refresh via a new `POST /api/plugins/models/refresh` call

Background refresh is client-initiated (the UI decides when to poll) so the server stays stateless. When the refresh POST resolves, the UI replaces rows; no flash because the id set is usually identical.

### Manual refresh endpoint

```
POST /api/plugins/models/refresh
```

- Bypasses cache
- Calls `loadConfiguredModelsFromOpenClaw` fresh
- Writes result to both in-memory + disk cache on success
- Returns the same shape as `/available`
- On failure returns `{ ok: false, error, stale: true, models: cachedModels }` so the UI can show "refresh failed, here's what we still know"

### Gateway-restart integration

`POST /api/plugins/models/gateway/restart` already exists (`index.ts:647`). Extend it to call `clearPersistedCache()` + `setModelsCache(null)` after a successful restart. Next `/available` request naturally re-fetches.

### Client UI

`plugins/models/components/models-page.tsx`:

- On mount: fetch `/available`. If response has `cached: true, stale: true` → render rows immediately + trigger `POST /api/plugins/models/refresh` in the background; update rows when that resolves.
- If response has `cached: false, models: []` → render loading state with "Querying OpenClaw gateway — this can take up to 30 seconds on first load."
- If refresh failed AND no cached data → render error state with the specific error message + Retry button.
- New header component above the model list:

  ```
  [🗘 Refresh]   Last refreshed: 3h ago
  ```

  Clicking Refresh disables the button, shows an inline spinner, calls `POST /refresh`, re-enables after response.

- Cache-age display uses a small helper: `<relative time>` for under 24h (`2m ago`, `3h ago`), absolute date for older (`Apr 18`).

### Curated catalog data module

New file `plugins/models/data/known-models.ts`:

```ts
export interface KnownModel {
  id: string                                  // exact match against OpenClaw id
  name: string                                // display name override
  description?: string                        // 1–2 sentence summary
  bestFor?: string                            // short purpose hint
  tier?: 'budget' | 'standard' | 'premium'
  contextWindow?: string                      // display: '200K', '1M'
  costRange?: string                          // display: '$3 in / $15 out per 1M'
  kind: 'llm' | 'image' | 'video'
  brandIconSlug?: string                      // simple-icons slug, e.g. 'openai', 'anthropic'
}

export interface KnownProvider {
  id: string                                  // matches `providerFromId(modelId)` output
  label: string                               // 'Anthropic', 'OpenAI', 'Google'
  brandIconSlug?: string
  brandColor?: string                         // hex for first-letter chip tint
}

export const KNOWN_PROVIDERS: readonly KnownProvider[]
export const KNOWN_MODELS: readonly KnownModel[]

export function getKnownModel(id: string): KnownModel | undefined
export function getKnownProvider(id: string): KnownProvider | undefined
```

#### Seed entries (22 total)

**LLMs** (9):
- `anthropic/claude-haiku-4-5` — Budget, Simple tasks / routing / heartbeat
- `anthropic/claude-sonnet-4-5` — Standard, Content creation, reasoning
- `anthropic/claude-sonnet-4-6` — Standard, General-purpose (current default)
- `anthropic/claude-opus-4-6` — Premium, Complex coding, planning, analysis
- `openai/gpt-5.4` (OpenClaw sometimes tags as `openai-codex/gpt-5.4`) — Premium, Reasoning, code
- `openai/gpt-5` — Premium, Frontier reasoning
- `openai/gpt-4o` — Standard, Multimodal general-purpose
- `google/gemini-2.5-pro` — Premium, Long-context reasoning, code
- `google/gemini-2.5-flash` — Budget, Fast multimodal tasks
- `ollama/llama-3.3` — Budget, Local large-model
- `ollama/qwen-2.5` — Budget, Local general-purpose

**Image** (5):
- `openai/dall-e-3` — Standard, High-quality image generation
- `google/imagen-4` — Premium, Photorealistic generation
- `black-forest-labs/flux-pro` — Standard, Detailed photographic output
- `stability/sdxl` — Budget, Open-weights image generation
- `midjourney/v6.1` — Premium, Stylized artistic generation

**Video** (5):
- `bytedance/seedance` — Premium, Text-to-video
- `kuaishou/kling-1.6` — Standard, Text-to-video with camera control
- `runway/gen-3-alpha` — Premium, High-fidelity text-to-video
- `openai/sora` — Premium, Long-form text-to-video
- `google/veo-2` — Premium, Text-to-video with physics understanding

Data is human-readable; maintainers add/edit entries as new popular models appear. PR process, no migration logic needed (entries only enrich — adding/removing is pure read-side).

#### Normalization

OpenClaw sometimes returns ids with date suffixes (`anthropic/claude-sonnet-4-6-20250514`). The catalog uses base ids (`anthropic/claude-sonnet-4-6`). `getKnownModel(id)` does exact match first, then strips trailing `-\d{8}$` and retries. Documented in the helper's JSDoc.

### Enrichment in `loadConfiguredModelsFromOpenClaw`

`plugins/models/index.ts:196` — the `.map(...)` block that constructs each `AvailableModel` gains enrichment:

```ts
.map((model) => {
  const id = normalizeModelId(model.key!)
  const known = getKnownModel(id)
  const provider = providerFromId(id)
  const knownProvider = getKnownProvider(provider)
  // ... existing fields ...
  return {
    id,
    name: known?.name ?? model.name ?? id,
    tier: known?.tier ?? tierFromId(id),
    provider,
    providerLabel: knownProvider?.label,              // NEW
    providerBrandIconSlug: knownProvider?.brandIconSlug, // NEW
    providerBrandColor: knownProvider?.brandColor,    // NEW
    description: known?.description,                  // NEW
    bestFor: known?.bestFor,                          // NEW
    costRange: known?.costRange,                      // NEW
    kind: known?.kind,                                // NEW
    brandIconSlug: known?.brandIconSlug,              // NEW
    // ... existing: input, contextWindow, local, available, tags, configured, isDefault, fallbackIndex
  }
})
```

`AvailableModel` in `plugins/models/types.ts` gains these optional fields. Existing consumers keep working — they ignore the new optional fields; the models-page gains rendering that uses them when present.

### Brand icons via `simple-icons`

Install `simple-icons` (MIT package, CC0 icon paths). Create `plugins/models/components/brand-icon.tsx`:

```tsx
import siAnthropic from 'simple-icons/icons/anthropic'
import siOpenai from 'simple-icons/icons/openai'
import siGoogle from 'simple-icons/icons/google'
import siOllama from 'simple-icons/icons/ollama'
// ... ~10 deep imports covering the seed list ...

const BRAND_ICON_MAP: Record<string, { path: string; hex: string }> = {
  anthropic: siAnthropic,
  openai: siOpenai,
  google: siGoogle,
  // ...
}

interface BrandIconProps {
  slug?: string
  fallbackText?: string       // for first-letter chip when slug missing or unknown
  fallbackColor?: string      // hex
  size?: 'sm' | 'md'
  className?: string
}

export function BrandIcon({ slug, fallbackText, fallbackColor, size = 'sm', className }: BrandIconProps) {
  const icon = slug ? BRAND_ICON_MAP[slug] : undefined
  if (icon) {
    return <svg viewBox="0 0 24 24" className={cn(sizeClass[size], className)} fill="currentColor">
      <path d={icon.path} />
    </svg>
  }
  // Fallback: first-letter chip with brand color bg
  return <span className={cn(chipClass[size], className)} style={{ backgroundColor: fallbackColor ?? '#475569' }}>
    {(fallbackText ?? '?').charAt(0).toUpperCase()}
  </span>
}
```

Deep imports from `simple-icons/icons/xxx` are tree-shakable under Next.js / webpack; only the ~10 brand paths end up in the client bundle. Unknown slugs fall through to the first-letter chip with `brandColor`. Same silent-fallback philosophy as `<ChannelIcon>` from #125.

### Models-page UI — what changes

Current (`models-page.tsx:596-620`):

```tsx
{availableProviders.map((provider) => (
  <div key={provider}>
    <h3>{provider.replace(/[-_]/g, ' ')}</h3>
    {/* list of models */}
  </div>
))}
```

New: provider header renders `<BrandIcon slug={providerBrandIconSlug} fallbackText={providerLabel ?? provider} fallbackColor={providerBrandColor} />` + `{providerLabel ?? provider}`. Model rows gain:

- Small `<BrandIcon>` next to the name (if a model-specific slug exists, else the provider's)
- `description` as subdued secondary text
- `bestFor` as a chip/badge next to the tier badge
- `contextWindow` next to name (small mono font)
- `costRange` at right end of the row

Plain rows still work for models without catalog entries. The enriched layout only renders the fields that exist.

### Consumer file inventory

- `plugins/models/index.ts` — delete `fallbackModels()` (lines 252-259); extend `fetchAvailableModels()` to read/write disk cache + return stale flag; add `/refresh` route; invalidate cache on `/gateway/restart`
- `plugins/models/lib/models-cache.ts` — new file, disk I/O
- `plugins/models/data/known-models.ts` — new file, catalog data + lookups
- `plugins/models/components/brand-icon.tsx` — new file
- `plugins/models/components/models-page.tsx` — Refresh button + cache-age indicator + richer model rows
- `plugins/models/types.ts` — extend `AvailableModel` with the new optional fields; delete `MODEL_CATALOG` + `ModelCatalogEntry` (dead)
- `package.json` — add `simple-icons` dep

## Resolved Decisions

- **Disk cache location:** `~/.bakin/plugin-settings/models/available.json`. Matches existing plugin-settings conventions.
- **Stale threshold:** 1 hour — preserves today's `CACHE_TTL` behavior; "stale" returns cached data + triggers background refresh (doesn't block UI).
- **No background polling.** Refresh is user-initiated (click or gateway-restart). Models don't change often enough to justify a timer.
- **Unknown models render plain, never fake.** `fallbackModels()` deleted; empty-state with error + Retry is the worst-case UI.
- **Catalog is code-shipped, not plugin-contributed.** Bakin maintainers PR to `known-models.ts`; plugins have no contribution API. This is not #128.
- **Icons via `simple-icons` deep imports + first-letter chip fallback.** No extra React wrapper dep. Unknown slugs silently fall back.
- **OpenClaw id date-suffix normalization** in `getKnownModel` — strip `-\d{8}$` before retry. Avoids maintaining dated entries.

## Resolved (from spec review)

- **OpenClaw-config-edit edge case:** piggyback on existing `GET /api/plugins/models/gateway/status` which already reports `restartNeeded` (comparing config mtime vs last restart). Models page reads this on mount/refresh; when `restartNeeded === true`, render a small amber banner: "OpenClaw config changed since last gateway restart — model list may be out of date. Restart gateway." Only renders when the signal is already there; no new detection logic.
- **Disk-cache schema drift:** read path zod-validates the persisted cache against the current `AvailableModel` shape. On any parse failure, treat as no cache (`null` return) and delete the file. No crashes, no stale-shape rows.
- **Race between auto-refresh and manual Refresh:** accepted as v1 behavior. Both resolve server-side to near-identical writes; last-writer-wins is fine since content is functionally identical.

## Open Questions

- **Catalog coverage policy.** The 22-entry seed covers frontier + popular OSS. When does a new model earn a catalog entry? Lean: user-driven — add when someone actually configures it in their OpenClaw and we notice the plain row. Informal triage, not a formal process.

## Acceptance Criteria

- [ ] `fallbackModels()` deleted; `grep -rn fallbackModels plugins/models/` returns zero hits
- [ ] Disk cache at `~/.bakin/plugin-settings/models/available.json` written after each successful OpenClaw fetch
- [ ] Cold start with existing cache renders models immediately + "Last refreshed: X ago" indicator
- [ ] Cold start with no cache renders loading state, never fake data
- [ ] `GET /available` response includes `stale: boolean` flag
- [ ] New `POST /api/plugins/models/refresh` bypasses cache and returns fresh data
- [ ] `POST /gateway/restart` clears both in-memory and disk caches
- [ ] Manual Refresh button on models page triggers `/refresh` + disables during request
- [ ] Fetch failure with no cache shows error message + Retry button, not fake entries
- [ ] Gateway-out-of-sync banner renders on models page when `/gateway/status` reports `restartNeeded: true`
- [ ] Disk cache read validates against current `AvailableModel` zod shape; parse failure drops cache silently
- [ ] `MODEL_CATALOG` + `ModelCatalogEntry` removed from `plugins/models/types.ts`
- [ ] `AvailableModel` has optional `description`, `bestFor`, `costRange`, `kind`, `brandIconSlug`, `providerLabel`, `providerBrandIconSlug`, `providerBrandColor`
- [ ] `plugins/models/data/known-models.ts` exists with 22 curated entries (9 LLM + 5 image + 5 video + providers)
- [ ] `getKnownModel` normalizes trailing `-\d{8}` date suffix on miss
- [ ] `<BrandIcon>` renders inline SVG from `simple-icons` for known slugs, first-letter chip otherwise
- [ ] Models-page renders enriched cards when metadata present (description, bestFor badge, cost range, brand icon), plain rows otherwise
- [ ] Full `pnpm vitest run` + `pnpm tsc --noEmit` clean
- [ ] Existing model-selector UIs (agent config dropdowns, defaults, fallbacks) work unchanged

## Testing Strategy

All tests mock `content-dir`, `logger`, `watcher`, `openclaw-client`, `tasks/flow-store` per CLAUDE.md.

- **Unit — `models-cache.ts`:** write+read round-trip, read-from-missing returns null, read-from-corrupt-JSON returns null, clear deletes the file
- **Unit — `known-models.ts`:** `getKnownModel` exact match, date-suffix-strip match, miss returns undefined; `getKnownProvider` same shape
- **Unit — `fetchAvailableModels`:** cache-hit path returns in-memory, disk-cache-hit path hydrates in-memory + returns, no-cache-success path writes both caches, no-cache-failure returns empty + error
- **Integration — `/available` route:** returns `stale: false` for fresh cache, `stale: true` for old cache, never returns fallback entries on failure
- **Integration — `/refresh` route:** bypasses cache, writes fresh data to both caches, returns stale+cached models on OpenClaw failure
- **Integration — `/gateway/restart`:** clears both caches after successful restart
- **Enrichment unit test:** mocked `openclaw models list` output for a known id includes the catalog's `bestFor`, `description`, `costRange` in the resulting `AvailableModel`; unknown id renders with `tierFromId` heuristic
- **Client component — `BrandIcon`:** renders SVG for known slug, renders first-letter chip with correct bg color for unknown slug, handles empty/undefined slug gracefully

## Sequencing

1. **feat(models): disk-backed cache + stale flag** — new `models-cache.ts`, extend `fetchAvailableModels`, hydrate from disk, never call `fallbackModels()` — with `fallbackModels` still present (called nowhere now). Response gains `stale` flag. (1 commit)
2. **feat(models): manual refresh + gateway-restart cache invalidation** — new `/refresh` route, extend `/gateway/restart` to clear disk cache. (1 commit)
3. **refactor(models): delete `fallbackModels` + `MODEL_CATALOG`** — dead code removal after paths above are in place. (1 commit)
4. **feat(models): curated catalog data** — new `known-models.ts` with 22 seed entries + helpers. (1 commit)
5. **feat(models): enrich `AvailableModel` from catalog** — `loadConfiguredModelsFromOpenClaw` merges catalog metadata; type extended with optional fields. (1 commit)
6. **feat(models): BrandIcon + simple-icons dep** — new component, package.json update. (1 commit)
7. **feat(models): enriched models-page cards + Refresh button + cache-age indicator** — UI changes. (1 commit)
8. **test(models): regression guards** — loading states, refresh path, catalog enrichment, unknown-model plain rendering. (1 commit)
9. **Ship** — PR against main, smoke, merge.

## Not Doing (and Why)

- **Plugin-contribution API for the catalog** — closed as premature in #128. Plugins don't add LLMs.
- **Background polling timer** — adds server load for a list that changes rarely. User-initiated refresh + gateway-restart trigger is enough.
- **Streaming progress** ("Fetched 50/120 models...") — OpenClaw's CLI returns all-or-nothing; no intermediate state to stream.
- **Cross-user / cross-machine cache sharing** — single-user self-hosted; each Bakin install has its own local cache.
- **Catalog entries for every possible model** — maintain-as-we-go. Unknown models render plain.
- **`simple-icons-react` wrapper** — extra dep for what's a tiny SVG-path render. Roll our own `<BrandIcon>`.
- **Per-model icons separate from provider icons** — model-level `brandIconSlug` falls through to provider's when missing. Mostly the same brand anyway.
- **Runtime-dynamic icon loading** (`import(`simple-icons/icons/${slug}`)`) — static map covers the seed list, Next.js can't code-split dynamic imports cleanly. Revisit if the catalog grows past 50 entries.
- **Migrating `plugins/models/index.ts:252-259` to a plugin-contributed fallback** — we're deleting the concept, not relocating it.
