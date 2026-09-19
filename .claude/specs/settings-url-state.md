# Spec: Settings URL State + App-Wide Selection-State Audit

**Status:** Phase 1 SHIPPED — PR #829 merged 2026-09-18. Phase 2 in progress: PR 1 (team) SHIPPED #830; PR 2 (tasks) on `feat/tasks-url-state` (`tasks/tasks-url-state/plan.md`).
**Date:** 2026-09-18
**Priority:** Tech-debt reduction. Single user, single machine. NO backwards compatibility, NO shims, NO redirects for old shapes. Clean and clear over compatible.
**Parent:** `.claude/specs/routing-overhaul.md` (the URL taxonomy this spec extends)

## Objective

The `/settings` page keeps its active category in React local state. Refresh loses your place, and nothing in the app can link to a category or a field — even though six health-incident resolutions and the runtime Capabilities tab already try to ("Open System & Alerts", "Open Integrations & Keys", "Add the key in Settings" — all land on bare `/settings`).

Phase 1 puts the settings category and an optional field highlight in the URL, wires every existing producer to the real target, and pins the behavior with tests. Phase 2 audits every plugin for the same defect class (bookmark-worthy selection held in local state) and fixes each finding under one shared rule set, one PR per plugin.

**User:** the operator (Mark) — bookmarking, refreshing, and following incident links.

**Success looks like:** `/settings?tab=models` cold-boots into Models; `/settings?tab=system&field=dispatch.paused` opens System & Alerts scrolled to the kill switch with it highlighted; every "Open …" resolution in Health lands where its label says; the audit's seven gaps are closed the same way.

### Decisions locked during interview

| # | Decision | Choice |
|---|----------|--------|
| D1 | Category state shape | **Query param `?tab=<categoryId>`.** Matches the locked taxonomy (path = page identity, query = tabs) and the seven existing `useQueryState('tab', …)` consumers. Keeps the kit `NavList` (state-backed by design; a path-based navigator would need a kit change). |
| D2 | Built-in category ids | **Rename the constants**: `SYSTEM_SETTINGS_TAB_ID = 'system'`, `PROVIDER_KEYS_TAB_ID = 'integrations'`. The old `__system` / `__provider_keys__` spellings are referenced nowhere else and die with the rename. Plugin categories use the plugin id verbatim. A plugin whose id is `system` or `integrations` is refused at grouping time (logged + skipped) — the built-ins own those slots. |
| D3 | Field-level deep link | **In scope.** `?tab=<category>&field=<fieldKey>`. Kit `PluginSettingsRenderer` gains `highlightKey?: string`: the matching field scrolls into view ONCE per key and carries `data-highlighted="true"` (team-lessons `lessonId` precedent). `field` is ignored on `integrations` (bespoke component, not schema-rendered). Switching category clears `field` in the same navigation (setters batch per tick). |
| D4 | Producers | **All seven existing `/settings` links retargeted in this PR** (targets in `tasks/settings-url-state/plan.md` Task 3; the seventh — the images plugin's "Review runtime settings" incident → `/settings?tab=integrations`, relabeled "Open Integrations & Keys" — was found by the build-time sweep, not the interview). Hand-written hrefs, matching the existing `/models?tab=routing` / `/health?tab=activity` convention — no URL-builder abstraction. The structured `{ kind: 'setting', id }` incident resource stays as-is (not a routing mechanism). |
| D5 | Delivery | Branch `feat/settings-url-state` from `main` in the MAIN checkout (3737 serves it); atomic commits; PR opened via `gh`; Mark live-tests the checklist; Claude does not merge. |
| D6 | Audit phase | Findings table lands in this spec (below); fixes ship **one PR per plugin**, all seven rows in scope, under the shared rules in "Phase 2". |

### Behavior settled by precedent (not asked)

- **History:** category switches use the replace setter (all seven tab consumers do); no history entry per click. Drawers push (memory `recordId`, schedule `jobId` precedent).
- **Default:** `useQueryState('tab', 'system')` — the param is omitted at default, so `/settings` still lands on System & Alerts with a clean URL.
- **Unknown `tab`:** normalize to `system` via replace, health-page precedent (`if (pathname === '/settings' && !known) setTab('system')`), but only AFTER the schema list has loaded — before that, "unknown" is not knowable. Guarded by pathname so the outgoing page never normalizes params onto the next route.
- **Unknown `field`:** no-op (nothing highlighted, param left alone). Not an error.
- **Spec location:** `.claude/specs/` (repo convention), not a root `SPEC.md`.

### Assumptions (surfaced, not asked)

1. `useQueryState` rebuilds the URL from pathname + query, dropping any hash — so a `#fragment` design was never viable; `field` is a query param.
2. The Storybook recipe "Recipes/Settings and dashboard pages" keeps its local-state category — it is a router-less composition demo. Only the kit `PluginSettingsRenderer` story changes (new `highlightKey` coverage).
3. `notifications.channelAliases` has NO field on the System & Alerts form; the channel-aliases incident therefore targets the category only. Adding that field is out of scope (noted as a follow-up).
4. The runtime Capabilities tab uses TanStack `Link` (host-internal, allowed) with the typed `search` prop (`to="/settings" search={{ tab: 'integrations' }}`) — a query string inside `to` fails the typed-route check. The test router shim (`tests/shims/tanstack-router.ts`) now composes `search` into the anchor href and returns a real React element (its old raw object crashed React 19 when rendered); React is lazy-required inside the stub because a module-top value import segfaults bun 1.3.13 under the global alias.
5. ~~`savedValues` reset on category change stays exactly as today.~~ Planning found this wrong: with the URL driving the category, Back/Forward changes it without a click, so clear-on-select would show category A's just-saved values under B. The cache is tagged with the values URL it was saved against and used only while that URL is active (`plan.md` "Architecture decisions"); pinned by a test.

## Tech Stack

- Bun 1.3.13 (pinned), React 19, TanStack Router (code-based routes), `@makinbakin/sdk/navigation` (`useQueryState`, `PluginLink`, `useRouter`)
- Kit: `@makinbakin/sdk/patterns` (`NavList`, `PluginSettingsRenderer`, `Page`/`PageHeader`/`PageBody`)
- Tests: `bun:test` + RTL under happy-dom, router shim at `tests/shims/tanstack-router.ts`
- Storybook (public) is the executable UI contract — `bakin-ui-conformance` skill governs every UI change

## Commands

```
Test (all):        bun run test                                  # never bare `bun test`
Test (one):        bun test tests/components/settings-route-url-state.test.tsx --isolate
Lint:              bun run lint
Typecheck:         bun run typecheck
UI conformance:    bun run ui:conformance --quick                 # every UI change; full mode before merge-ready
Story gates:       bun run ui:story-compliance:check && bun run ui:kit-coverage:check
Story play tests:  bun run ui:test:stories                        # after editing the renderer story
Cycles:            bun run check:cycles
Dev:               bun run dev                                    # host + plugin HMR; server code needs manual restart
Full build chain:  bun run build:css && bun run build:vendors && bun run build:plugins && bun run build:host-shell
                   (kit changes in packages/sdk need build:vendors + hard refresh to reach the dev server;
                    never `git add -A` after a build — generated-version.ts / _embedded-assets-static.ts are stamped)
```

## Project Structure (files Phase 1 touches)

```
packages/host/src/routes/settings.tsx                       → selectedId → useQueryState('tab','system'); field → highlightKey; unknown-tab normalize; id-collision guard
src/components/system-settings.ts                           → SYSTEM_SETTINGS_TAB_ID = 'system'
src/components/provider-keys-tab.tsx                        → PROVIDER_KEYS_TAB_ID = 'integrations'
src/components/plugin-settings-renderer.tsx                 → pass-through highlightKey (host adapter)
packages/sdk/src/patterns/plugin-settings-renderer.tsx      → highlightKey prop: scroll-once + data-highlighted on the matching Field
storybook/public/forms/plugin-settings-renderer.stories.tsx → highlightKey story (+ play assertion)
plugins/health/lib/system-checks/delivery-discord.ts        → 4 resolution hrefs
plugins/health/lib/system-checks/channel-aliases.ts         → 1 resolution href
packages/host/src/components/runtime/capabilities-tab.tsx   → Link to="/settings?tab=integrations"
tests/components/settings-route-url-state.test.tsx          → NEW: deep-link + normalize + field-clear + highlight tests
tests/components/settings-route-save.test.tsx               → mount under router shim (page now reads the URL)
tests/components/settings-sort.test.ts                      → id constants + collision guard
tests/plugins/health/*delivery-discord*, *channel-aliases*  → assert new hrefs (existing files)
.claude/knowledge/url-state-deep-linking.md                 → Settings row in status table; `field` in param table; `tab` value note
.claude/knowledge/delivery-bridge.md                        → resolution targets (if hrefs are quoted)
.claude/knowledge/doctor-and-health-checks.md               → navigate-resolution deep-link note (if applicable)
docs/src/content/docs/using/settings.md                     → "Deep links" paragraph
.claude/specs/settings-url-state.md                         → this file (living; audit table appended)
```

## Code Style

Existing conventions (CLAUDE.md) plus the navigation rules from the routing overhaul. The shape this spec adds:

```tsx
// packages/host/src/routes/settings.tsx — category + field ride the URL
const [tabParam, setTab] = useQueryState('tab', SYSTEM_SETTINGS_TAB_ID)   // 'system'
const [fieldParam, setField] = useQueryState('field', '')

const activePlugin = plugins.some((p) => p.id === tabParam) ? tabParam : SYSTEM_SETTINGS_TAB_ID

useEffect(() => {
  // Normalize only on this route, only once the schema list is known — the
  // outgoing page can see the next route's params for one render.
  if (pathname !== '/settings' || plugins.length === 0) return
  if (!plugins.some((p) => p.id === tabParam)) setTab(SYSTEM_SETTINGS_TAB_ID)
}, [pathname, plugins, tabParam, setTab])

const selectPlugin = (id: string) => {
  setSavedValues(null)
  setTab(id)
  setField('')   // batches into the same navigation as setTab
}

<PluginSettingsRenderer … highlightKey={fieldParam || undefined} />
```

```tsx
// producers: hand-written hrefs, same as /models?tab=routing today
resolution: { key: 'open-settings', type: 'navigate', label: 'Open System & Alerts',
              href: '/settings?tab=system&field=integrations.discord.guildIds' }
```

- Param names: short, lowercase, existing vocabulary (`tab`, `field`, `mode`, `q`); new nouns only for in-page master-detail (`skill`, `file`, `step`, `version`).
- Never `window.location` for internal navigation; `PluginLink` / TanStack `Link` / `useRouter()` only.
- Conventional commits with scope.

## Testing Strategy

- **Component (RTL, `--isolate`, `rtl-settle`):** follow `tests/plugins/chat/chat-page-routing.test.tsx` — `mock.module('@tanstack/react-router', …)` with a `useNavigate` that records navigations, seed the location with happy-dom `setURL`, mock `@/hooks/use-toast` + content-dir per convention. Cases:
  1. `/settings?tab=models` cold-mounts with Models active (`aria-current` on the NavList item, heading = "Models").
  2. `/settings` (no param) lands on System & Alerts; no navigation is emitted.
  3. `/settings?tab=nope` emits ONE replace navigation to `/settings` after schemas load — none before.
  4. Selecting a category emits a replace navigation carrying `tab=<id>` and NO `field`.
  5. `/settings?tab=system&field=dispatch.paused` renders that field with `data-highlighted="true"` and calls `scrollIntoView` once; a different field key re-arms.
  6. `?tab=integrations&field=x` renders the keys tab; no highlight, no navigation.
  7. A schema entry with id `system` is refused (logged, not rendered) — `groupAndSortSchemas` unit test.
- **Kit (story play):** `plugin-settings-renderer.stories.tsx` gains a `HighlightedField` story asserting `data-highlighted` lands on the right `Field`. `ui:test:stories` green.
- **Producers:** existing health system-check tests updated to assert the new hrefs (no new files unless a check has none).
- **Architecture:** `no-hard-navigation` + style ratchet + census stay green (no allowlist changes expected).
- **Live checklist (Mark, 3737):** cold-boot `/settings?tab=models`; refresh keeps place; back/forward across categories does NOT add entries; Health → "Discord bridge has no guilds" → lands on System & Alerts scrolled to Guild IDs, highlighted; Runtime → Capabilities → "Add the key in Settings" → Integrations & Keys; switching category drops `field` from the URL; SSE connection id unchanged throughout.

## Boundaries

- **Always:** load `bakin-ui-conformance` before touching the route/kit/story; run `bun run test`, `lint`, `typecheck`, `ui:conformance --quick` before every commit; update `.claude/knowledge/` + docs in the same PR; conventional commits; verify HEAD before committing; keep the routing test seeded through the shim (no real RouterProvider in RTL).
- **Ask first:** any URL shape outside the taxonomy; any kit prop beyond `highlightKey`; adding dependencies; changing `NavList`; touching the health-incident resource contract; merging.
- **Never:** back-compat for `__system` / `__provider_keys__` or bare `/settings` resolution labels; `#fragment` anchors; a URL-builder abstraction; `window.location` navigation; committing `generated-version.ts` / `_embedded-assets-static.ts` stamps; `git add -A`.

## Commit Strategy (rollback checkpoints) — Phase 1, PR `feat/settings-url-state`

Each commit is atomic, green (test + lint + typecheck + `ui:conformance --quick`), and revertable alone.

1. `feat(settings): category rides ?tab= with system/integrations ids` — constants renamed, `useQueryState('tab','system')`, unknown-tab normalize, id-collision guard, `selectPlugin` clears `field`; tests 1–4 + 7; existing settings tests re-mounted under the shim.
2. `feat(sdk): highlightKey on PluginSettingsRenderer` — kit prop (scroll-once + `data-highlighted`), story + play, host adapter pass-through, route reads `?field=`; tests 5–6; story gates green.
3. `fix(health,runtime): deep-link settings resolutions to their category and field` — six hrefs + their tests.
4. `docs(settings): URL state, field deep links, knowledge + docs-site sweep` — knowledge rows, docs page paragraph, this spec → SHIPPED status for Phase 1.

Rollback: `git revert` any checkpoint; 3 depends on 1+2 (targets exist), 4 is docs-only.

## Success Criteria — Phase 1

1. `/settings?tab=<any category>` cold-boots into that category; refresh keeps place; `/settings` still lands on System & Alerts with a clean URL.
2. Unknown `tab` values normalize to `system` exactly once, only on `/settings`, only after schemas load.
3. `?field=<key>` highlights and scrolls to the field once; switching category drops `field`; `field` is inert on Integrations & Keys.
4. All six producers land where their labels say (table in D4); zero bare `/settings` hrefs remain outside the sidebar nav item and the route-shadow list.
5. `groupAndSortSchemas` refuses plugin ids `system` / `integrations`.
6. Full suite, lint, typecheck, `ui:conformance --quick`, story gates, cycles green; `url-state-deep-linking.md` lists Settings + `field`; docs-site settings page documents deep links; README unaffected (verified — no settings-navigation content).
7. Live checklist passes on 3737 before merge.

## Phase 2 — App-Wide Audit

### Rules (extend the taxonomy; do not replace it)

1. **Any selection that changes what a routed page shows goes in the URL.** Tabs → `tab`; in-page master-detail selection → a noun param (`skill`, `file`, `step`, `version`); edit-vs-preview → the existing `mode` param (`mode=edit`); time windows → the existing `<area>_window` naming.
2. **History by presentation:** drawers/overlays PUSH (Back closes them); tabs and in-page selection REPLACE.
3. **Stays local:** wizard steps inside modals, delete-confirm targets, async phases, DataTable sort, hover/drag, search-overlay view mode (localStorage by design).
4. **Stale noun params do not rewrite the URL.** A `?skill=`/`?file=`/`?step=`/`?version=` naming something that no longer exists shows the default (first item) and leaves the URL alone. Only page-level `tab` values normalize (settings/health precedent) — an in-page selection has nothing user-visible to fix, and rewriting would need an effect + spy plumbing for no gain.
5. Every fix ships with: URL-seeded RTL test via the shim, producer links updated (⌘K hit renderers, toasts, incident resolutions), and a row in `url-state-deep-linking.md`.

### Findings (sweep of 2026-09-18; every `packages/host/src/{routes,components}` + `plugins/*/components` file)

| # | Plugin | File | Gap | Fix | PR |
|---|--------|------|-----|-----|----|
| 1 | team | `agent-detail.tsx:435` / `:522` | Selected skill + selected memory file (`NavList`, local state) inside URL-backed `?tab=skills` / `?tab=memory` | `?skill=<name>`, `?file=<name>` (replace) | `feat/team-url-state` — implemented 2026-09-18 |
| 2 | team | `diagnostics-tab.tsx:788` | Activity window local while its page number (`activityPage`) is URL state; window change resets page | `?activity_window=` (replace), matching health | `feat/team-url-state` — implemented 2026-09-18 |
| 3 | team | `team-detail.tsx:69` | Team-context edit vs preview on a routed page | `?mode=edit` | `feat/team-url-state` — implemented 2026-09-18 |
| 4 | tasks | `kanban-board.tsx:430` | `taskId` consumed once then cleared — inbound deep link only; card clicks never write the URL | Push `taskId` on open, clear on close (memory/schedule pattern) | `feat/tasks-url-state` — implemented 2026-09-18 |
| 5 | workflows | `workflow-detail.tsx:111` | Step drawer selection on a routed page | `?step=<id>` (push) | `feat/workflows-url-state` |
| 6 | assets | `VersionedAssetDetail.tsx:59` | Previewed version on `/assets/$assetId` | `?version=<n>` (replace) | `feat/assets-url-state` |
| 7 | brands | `brand-doc-editor.tsx:56` | Doc edit vs preview on a routed page | `?mode=edit` | `feat/brands-url-state` |
| 8 | health | `agents-usage-chart.tsx:149` | Chart metric local beside URL-backed `agents_window` | `?agents_metric=` (replace) | `feat/health-url-state` |
| 9 | chat | `chat-page.tsx:95` | Rail search — the only list search not on `q` | `useQueryState('q','')` | `feat/chat-url-state` |

Legitimately local (no action): brand-builder wizard step, explore install-dialog key step, health `selectedRepair`, workflow canvas node selection (dirty-guarded editor), all delete-confirm / rename targets, DataTable sorts, search-overlay `viewMode`, sidebar expansion.

Reference implementations to copy: `plugins/memory/components/use-record-deep-link.ts` (push-mode drawer), `plugins/schedule/components/schedule-page.tsx` (fully URL-driven page), `plugins/health/components/health-page.tsx` (tab normalize guard).

### Phase 2 delivery

One PR per plugin (team, tasks, workflows, assets, brands, health, chat — 7 PRs), each with the Phase 1 commit shape (state → tests → producers → docs). Order by value: team, tasks, workflows, then the rest. Each PR is planned with `/agent-skills:plan` against this spec's rules; this table is updated with PR numbers as they open.

## Open Questions

None blocking. Follow-ups recorded, not scheduled:
- `notifications.channelAliases` has no System & Alerts field; the channel-aliases incident can only target the category until one exists.
- Integrations & Keys is bespoke (`ProviderKeysTab`); per-secret highlighting would need it to adopt keyed sections first.
- The `/` route redirects to `/tasks` without forwarding the search string (`packages/host/src/routes/index.tsx`); forwarding it is a one-line routing-contract change worth its own PR. Until then producers must build `/tasks?…`, never `/?…`.
- The create-new task drawer stays component-level; `?mode=create` would need dirty-guard work and was not requested.
