# Plan — Explore: the "do more with Bakin" discovery plugin (issue #163 pivot)

## Context

Bakin's extensibility (agents, plugins, packs) is terminal-shaped; a business user can't discover or install official content without the CLI. Per the approved **SPEC.md** (repo root), we build **Explore** — an 11th core plugin: an app-store-style storefront that browses a curated catalog (agents / plugins / packs) by category with use cases, installs via existing host REST (consent preserved), and relays installed / built-in / update-available status with deep-links into Team/Health. It is **not** a management surface — update/remove/repair stays in Team/Health/CLI (remaining #163 scope, deferred).

Interview-locked decisions: new core plugin `explore`, nav pinned to sidebar bottom above Settings via a new generic `placement: 'bottom'` NavItem field; unified embedded catalog + user-triggered remote refresh from `bakin-bits-official`; core plugins showcased with "Built in" badges; packs tab auto-hides when empty.

Corrections found during planning (vs. issue/SPEC text): `curated-browser.tsx` never existed; the pack kind is `lesson-pack` not `knowledge-pack`; team's orphaned `install-dialog.tsx` has **no** existing test (nothing migrates — SPEC §3.6 note); agent update-state is network-probe only (never persisted), so offline update badges apply to plugins only, agents show unknown until an explicit check.

## Dependency graph

```
S1 placement:'bottom' ──► S2 scaffold explore plugin ──┐
S3 unified catalog + onboarding migration ─────────────┤
                                                       ▼
                                    S4 catalog route + join + browse UI
                                       ├─► S5 install flows + consent ─► S7 delete orphaned team dialog
                                       └─► S6 remote refresh + update relay
                                                       ▼
                                              S8 docs/knowledge
```
S2 ∥ S3 are independent; S5 ∥ S6 both depend only on S4.

## Slices (each = one green, revertable commit)

### S1 `feat(sdk,host): NavItem placement:'bottom' + sidebar bottom section`
- `packages/sdk/src/types/registration.ts` — add `placement?: 'bottom'` to `NavItem` (~line 47).
- `packages/core/src/plugins/manifest.ts` — `parseNavItem` (~204) must parse `placement` (validator copies only known fields; otherwise silently dropped). Throw `PluginManifestError` on values other than `'bottom'`.
- `packages/host/src/components/layout/app-sidebar.tsx` — partition items; render bottom items inside the existing `mt-auto border-t` block (lines 329–345) above the hardcoded Settings link; extract flat-item render into a local helper.
- New pure module `packages/host/src/components/layout/nav-placement.ts` — `partitionNavItems(items)` (mirrors `nav-badge-logic.ts` testability pattern) + `tests/components/nav-placement.test.ts`; manifest-parse unit test for the round-trip.
- No change needed in `buildNavItemsSnapshot` (`packages/sdk/src/register.ts`) — copies items verbatim.
- **Accept:** placement round-trips manifest parse; partition unit-tested; sidebar unchanged for existing plugins. **Verify:** `bun run typecheck && bun test tests/components tests/plugins/manifest-drift.test.tsx --isolate && bun run test`.

### S2 `feat(explore): scaffold explore core plugin`
- Create `plugins/explore/`: `bakin-plugin.json` (id `explore`, `contributes.nav: [{id:'explore', label:'Explore', icon:'Compass' (already in ICONS map), href:'/explore', placement:'bottom'}]`, `contributes.slots: ['page:/explore']`, NOT eager), `index.ts` (`definePlugin` from `@bakin/core/routing`, `createLogger('explore')`), `client.tsx` (`registerPlugin({id:'explore', slots:{'page:/explore': ExplorePage}})`), `components/explore-page.tsx` placeholder (`PluginHeader` + `EmptyState`, `<Suspense>`), `package.json` (copy health's shape), `types.ts` stub.
- Lockstep edits (guarded by `tests/architecture/core-plugin-ids.test.ts`): `src/lib/core-plugin-ids.ts`, `src/lib/plugin-static-imports.ts` (static import + `CORE_PLUGIN_IMPORTS` entry), `bakin.config.ts`, `tsconfig.json` `@bakin/explore/*` aliases, `tests/plugins/manifest-drift.test.tsx` `CLIENTFUL_CORE_PLUGINS` (+explore; eager list stays `['assets','health','tasks']`).
- Tech-debt kill: `src/core/plugins/dependencies.ts:11` has its own stale core-id set (already missing `images`) — replace with `new Set(CORE_PLUGIN_IDS)` import.
- Regenerate: `bun run build:plugins && bun run build:assets-manifest`; stage `_embedded-assets-static.ts` explicitly (never `git add -A` — build stamp).
- **Accept:** architecture + manifest-drift tests green with 11 plugins; dev shows Explore at sidebar bottom with Compass; `/explore` renders. **Verify:** `bun test tests/architecture tests/plugins/manifest-drift.test.tsx --isolate && bun run typecheck && bun run test`.

### S3 `feat(explore): unified curated catalog + onboarding migration + delete /api/curated`
(May split into 3a add/migrate + 3b delete/regenerate if the diff gets unwieldy.)
- Create `src/core/curated-catalog/schema.ts` (zod: `CatalogEntrySchema` — id, kind enum `agent|plugin|skill-pack|workflow-pack|lesson-pack`, name, emoji?, description, category, tags, useCases, source?, ref?, trust, builtin default false, dependencies?, defaultSelected?; `CatalogFileSchema` version literal 2) and `load.ts` (`loadUnifiedCatalog()` — static-import-first, `EMBEDDED_ASSETS['/data/curated-catalog.json']` in binary; generalizes/folds `src/core/onboarding/curated-catalog.ts`).
- Create `packages/host/src/data/curated-catalog.json` v2: migrate 5 agents (enrich, jessica, patch, pixel, rolo) + 2 plugins (messaging, projects), author category/useCases content, add `builtin:true` entries for all clientful core plugins (incl. explore).
- Migrate readers keeping export shapes byte-compatible: `src/core/onboarding/recommended-agents.ts` (filter `kind==='agent' && !builtin`), `recommended-plugins.ts` (`kind==='plugin' && !builtin`; `installSource()` untouched).
- Delete: `packages/host/src/api/curated/list.ts`, both old JSONs, `tests/api/curated.test.ts`; remove request-handler import (~line 50) + dispatch block (~347–350) + `core-routes/index.ts:62` entry; fix stale `/api/curated` comments.
- Preserve the two independent embedded-assets-builder guard describes from `tests/api/curated.test.ts` → new `tests/architecture/embedded-assets-builder.test.ts` (pure scanners, mock-checker exempt).
- New `tests/core/curated-catalog.test.ts`: shipped file validates; agent id set + `github:markhayden/bakin-bits-official#agents/<id>` sources; builtin entries have no source.
- Regenerate `bun run build:assets-manifest` **in this commit** (the tracked generated `_embedded-assets-static.ts` hard-imports the old JSONs — deleting without regenerating breaks typecheck).
- **Accept:** onboarding suites (`tests/core/onboarding/*`, `tests/cli/onboarding-ui.test.tsx`) pass unmodified (same rows → same selections); zero `/api/curated` references remain. **Verify:** `bun test tests/core/onboarding tests/core/curated-catalog.test.ts tests/architecture --isolate && bun run typecheck && bun run test`.

### S4 `feat(explore): catalog route + install-state join + browse UI`
- `plugins/explore/lib/catalog.ts` — merge embedded ⊕ cached remote (`join(getContentDir(),'plugin-data','explore','catalog.json')`, zod-validated, invalid cache dropped); merge key `(kind,id)`, remote wins except `builtin` entries (embedded-only).
- `plugins/explore/lib/install-state.ts` — server-side join, direct module reuse (plugins legally import `src/**`; never `packages/host/src/**` — de-facto convention):
  - agents: `listAllAgentStates()` (`src/core/agent-packages/agent-state.ts:104`);
  - plugins: `readPluginLockfile()` (`@bakin/core/plugins/lockfile`) + `isCorePlugin`; extract `computeUpgradeAvailable(entry)` from `packages/host/src/api/plugins/manifest.ts:174–185` into `packages/core/src/plugins/lockfile.ts` and reuse from both (small host edit; avoids duplication);
  - packs: `readLockfile()` (`@bakin/core/agent-packages/lockfile`), `kind !== 'agent'`;
  - builtin short-circuit: `{installed:true, builtin:true, updateAvailable:null}` (core plugins have no lockfile entry);
  - agents default `updateAvailable:null` (unknown — probe-only, see S6).
- `index.ts` registers `GET /catalog` (declared in `contributes.apiRoutes`); no network I/O on default GET.
- UI: `explore-page.tsx` (PluginHeader + UnderlineTabs Agents|Plugins|Packs — Packs only when catalog has ≥1 pack entry; `useQueryState('tab')` + `useQueryArrayState('category')` FacetFilter; `useJsonFetch('/api/plugins/explore/catalog')`), `catalog-card.tsx` (emoji, category chip, use-case preview, Installed/Built in/Update badges), `detail-drawer.tsx` — **right-side drawer** (SDK `BakinDrawer`; user-confirmed via mockups) showing full use cases, dependencies (with installed ✓), source, trust; Install in the drawer footer; selected entry tracked in `useQueryState('item')` for deep-linking.
- Tests `tests/plugins/explore/`: `catalog-route.test.ts` (test-helpers `activatePlugin`/`callRoute`; seeded temp lockfiles; mandatory isolation mocks — both content-dir paths + openclaw home + logger + rmSync cleanup), `install-state.test.ts` (pure join permutations), `explore-page.test.tsx` + `catalog-card.test.tsx` (jsdom + testing-library; URL state; packs-hidden-when-empty; builtin ⇒ no Install button).
- **Verify:** `bun test tests/plugins/explore --isolate && bun run test`.

### S5 `feat(explore): install flows — one-click, custom source, consent`
- `components/install-dialog.tsx` — modeled on team's `adopt-dialog.tsx` (dialog + POST + ErrorBanner) and the orphaned team install-dialog (presetSource, installAs, adopt, replace). Routes by kind: agent → `POST /api/agent-packages/install`; plugin → `POST /api/plugins/install` two-phase; pack → `POST /api/packages/install`; plus free-form "Install from source…" (type inference per `recommended-plugins.ts:74–76`).
- `components/consent-dialog.tsx` — renders `permissions[]` from `{ok:false, awaitingConsent:true, id, version, permissions, consentToken}`; Accept → re-POST `{...body, accepted:true, consentToken}`; Decline → nothing; **`manifestChanged:true` bounce** re-prompts with the fresh token + new permission list and a "permissions changed" notice (reference `consent-gate.ts:104–120`); 400s rendered human-readable.
- Wire Install buttons (hidden for builtin/installed); success → re-fetch catalog (live-activation means no restart).
- Tests: `install-dialog.test.tsx`, `consent-dialog.test.tsx` — mocked fetch; success / server-error / consent accept / decline-no-second-POST / manifestChanged re-prompt.
- **Accept:** SPEC US-1/US-2/US-5/US-6 dialog-level criteria; zero new mutation routes in explore. **Verify:** `bun test tests/plugins/explore --isolate && bun run test`; manual `bun run dev:mock` plugin-install walkthrough.

### S6 `feat(explore): remote refresh + update relay/deep-links`
- `lib/refresh.ts` — `refreshRemoteCatalog(fetcher = fetch)`: GET `https://raw.githubusercontent.com/markhayden/bakin-bits-official/main/catalog.json`; zod-validate; `atomicWriteJson` (`@bakin/core/storage/atomic-write`; pattern `plugins/models/lib/models-cache.ts`) to the plugin-data cache; 404 → clean "no remote catalog yet"; network/schema failure → cache untouched, honest error. Injectable fetcher — tests never hit network.
- `index.ts` — `POST /catalog/refresh`; `GET /catalog?check=1` runs `runChecks(userPluginIds)` (`src/core/plugins/upgrade`, persists plugin markers atomically) + `checkPackageUpdate(packageId)` (`src/core/agent-packages/checker.ts:50`) for managed agents, folding fresh status into the join.
- Client: explicit "Refresh catalog" + "Check for updates" buttons (never auto-fetch — SPEC §7); update badges; deep-links agent → `/team/{id}`, plugin → detail panel w/ CLI hint, health → `/health`.
- Tests: `refresh.test.ts` (cache precedence, invalid remote leaves cache, 404, network down) + `catalog-route.test.ts` `?check=1` with module-mocked probes.
- **Verify:** `bun test tests/plugins/explore --isolate && bun run test`.

### S7 `chore(team): delete orphaned install-dialog`
- Delete `plugins/team/components/install-dialog.tsx`; fix the pointer comment at `adopt-dialog.tsx:20`. Commit message notes: no pre-existing test existed (SPEC §3.6 correction); explore's dialogs are freshly tested in S5.
- **Verify:** `bun run typecheck && bun run test`.

### S8 `docs(knowledge): explore-plugin.md + doc updates`
- New `.claude/knowledge/explore-plugin.md` (catalog schema v2, merge/refresh semantics, install-state join incl. agent-probe-only caveat, cache path).
- `CLAUDE.md` (10 → 11 plugins, `placement:'bottom'` nav note), `.claude/knowledge/plugin-system.md`, `repo-architecture.md`, onboarding knowledge if it documents recommended-* internals; README/Astro docs if plugins enumerated (grep); fix "the 10 plugins" header in `src/lib/core-plugin-ids.ts` if not done in S2.
- **Verify:** `bun run test`; grep for remaining "10 core plugins".

## Key risks

1. **`_embedded-assets-static.ts`** is tracked generated output — regenerate inside S2 and S3; stage explicitly (build-stamp trap: never `git add -A`).
2. **Architecture tests**: core-plugin-ids 3-way lockstep; plugin-boundaries (explore must not import other plugins or `packages/host/src/**`); manifest-drift clientful/eager lists.
3. **Onboarding regression**: keep `RECOMMENDED_AGENTS`/`RECOMMENDED_PLUGINS` export shapes identical; their suites are the gate and should pass unmodified.
4. **Consent edge cases**: manifestChanged bounce (fresh token), expired token 400s, decline-does-nothing — all explicit S5 tests.
5. **Builtin/no-lockfile** and **agent update = probe-only** — handled in join design (null = unknown).
6. **Test isolation**: every fs-touching test mocks both content-dir resolvers + openclaw home + logger; refresh tests use injected fetcher.

## After approval (first actions of build phase)

- Write `tasks/plan.md` + `tasks/todo.md` from this plan (skill requirement; blocked in plan mode).
- Post the pivot summary comment to issue #163 (SPEC §10) — includes corrections (`curated-browser.tsx` never existed; `lesson-pack` not `knowledge-pack`) and notes the deferred management scope.
- Then execute S1→S8 via /agent-skills:build, each slice landing as its own commit, `bun run typecheck && bun run test` green per commit, finishing with /agent-skills:test for coverage review.

## Verification (end-to-end)

Per-slice commands above, plus final: `bun run test` full suite; `bun run dev` manual pass — Explore pinned above Settings, browse/filter via URL params, install a curated agent (mock runtime), plugin consent dialog round-trip, refresh with network off shows honest error; `bun run build` completes with explore embedded.
