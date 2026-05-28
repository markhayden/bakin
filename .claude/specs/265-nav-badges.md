# Spec: #265 — Dynamic nav badges for plugin-owned nav items

GitHub issue: https://github.com/markhayden/bakin/issues/265
Branch (bakin): `feat/265-nav-badges`
Sibling branch (bakin-bits-official): `feat/265-plans-badge` — opened after PR #1 merges.

## Objective

Add a first-class **nav badge** primitive to the SDK + sidebar so plugin authors can attach a count or presence indicator to any nav item they own. Badges update at runtime without re-registering the plugin, render consistently across all sidebar paths (expanded / collapsed / parent / child / flat / flyout / tooltip), and disappear automatically when the owning plugin unregisters or hot-reloads.

Concrete first consumer: the Messaging plugin's **Plans** nav item shows an amber count when one or more Plans are in `needs_review`. Hidden at zero. Powered by a small dedicated `/plans/summary` endpoint refreshed via SSE — no cron, no MCP traffic, no heartbeat coupling.

**Target users:** the single user of this Bakin instance and future plugin authors writing badge-aware nav items. The system must work identically for **core plugins** (bundled in the binary) and **installed plugins** (under `~/.bakin/plugins/`).

## Scope

### In scope — bakin (PR #1)

- `packages/sdk/src/types/index.ts`
  - Consolidate `NavItem` here as the single canonical definition (delete the duplicate in `register.ts`).
  - Add `NavBadge` interface: `{ count?: number; tone?: 'attention' | 'info' | 'success' }`.
  - Add optional `badge?: NavBadge` field to `NavItem` (used only as initial seed; runtime values flow through the registry).
- `packages/sdk/src/register.ts`
  - Drop the local `NavItem` interface; import from `../types`.
  - Add a nav-badge registry (`badgesByPlugin: Map<pluginId, Map<navItemId, NavBadge>>`) keyed inside the existing `ClientRegistry` globalThis singleton so HMR/hot-swap stays consistent.
  - Public API:
    - `setNavBadge(pluginId: string, navItemId: string, badge: NavBadge | null): void` — passes `null` to clear.
    - `getNavBadge(navItemId: string): NavBadge | undefined` — read the merged current value for a nav item across all plugins (first match wins; ids are expected unique).
    - `getNavBadgesSnapshot(): ReadonlyMap<string, NavBadge>` — for `useSyncExternalStore` consumers.
    - `subscribeNavBadges(listener: () => void): () => void` — separate channel from the existing `subscribeRegistry` so a badge tick doesn't force a full nav re-render.
  - `unregisterPlugin(id)` already deletes from `navByPlugin` / `routesByPlugin` / slots — extend it to also delete the plugin's badges map and bump the badge version.
- `packages/host/src/components/layout/nav-badge.tsx` *(new)*
  - Renders a `NavBadge` as either a pill (when `count` present) or a small dot (when only `tone` present, no count). Count clamped at `99+`. Tones map to: attention → amber-500/20 + amber-300 text (matches the existing `needs_review` palette in messaging `constants.ts`), info → muted blue, success → emerald.
  - Exports a `<NavBadgeDot>` variant for the collapsed-parent rollup case.
  - aria-label compatible: the component returns text the parent can splice into its own `aria-label` (e.g. `Plans (3 needing review)`).
- `packages/host/src/components/layout/app-sidebar.tsx`
  - Subscribe to nav-badge registry via `useSyncExternalStore(subscribeNavBadges, getNavBadgesSnapshot, getNavBadgesSnapshot)`.
  - Render badges in all six paths:
    1. Flat expanded — pill after label.
    2. Flat collapsed — dot overlay on the icon (tooltip aria-label includes the count).
    3. Expanded parent with children — pill after parent label (only when the parent has a direct badge; not for rollup).
    4. Expanded child — pill after child label.
    5. Collapsed alwaysExpanded (Popover flyout) — rollup dot on the parent icon if any child has a badge; per-child pills inside the flyout content.
    6. Collapsed tooltip (parent with children, not always-expanded) — rollup dot on the parent icon; tooltip label includes the rollup count via aria-label.
- `packages/host/src/plugin-host/PluginHost.tsx`
  - Mount `<Slot name="nav-badge-providers" />` once at root so plugin-contributed background components stay mounted while the plugin is registered. Renders alongside `children`, returns `null` themselves.
- Tests
  - `tests/sdk/register.test.ts` — extend with nav-badge cases (set/clear, multi-plugin isolation, cleanup on unregister, separate subscribe channel).
  - `tests/components/app-sidebar-badges.test.tsx` *(new)* — render each of the six sidebar paths and assert badge presence + rollup dot behavior + aria text.
- Docs
  - `.claude/knowledge/plugin-system.md` — new section: "Nav badges (runtime)" covering the SDK API, the slot mount, the rollup rule, and the lifecycle (badges disappear with their owning plugin).
  - `docs/plugin-authoring.md` — append a short example showing how a plugin contributes a background provider that calls `setNavBadge`.

### In scope — bakin-bits-official (PR #2, after #1 merges)

- `plugins/messaging/index.ts`
  - New route: `GET /plans/summary` → `{ needsReview: number, total: number }`. Reads from the content storage; cheap (count only, no plan bodies).
- `plugins/messaging/hooks/use-plans-summary.ts` *(new)*
  - Mirrors `use-plans.ts` shape but fetches `/api/plugins/messaging/plans/summary`. Refreshes on `useMessagingContentRefresh` with prefix `messaging/plans/`.
- `plugins/messaging/components/plans-badge-provider.tsx` *(new)*
  - Background component (renders null). Consumes `usePlansSummary()`, calls `setNavBadge('messaging', 'messaging-plans', summary.needsReview > 0 ? { count: summary.needsReview, tone: 'attention' } : null)` whenever the value changes.
- `plugins/messaging/client.tsx`
  - Add `slots: { 'nav-badge-providers': PlansBadgeProvider }` to the existing `registerPlugin({...})` call.
- Tests
  - `plugins/messaging/tests/plans-routes.test.ts` — extend with summary-endpoint case.
  - `plugins/messaging/tests/plans-badge-provider.test.tsx` *(new)* — render the provider with mocked `usePlansSummary` and assert `setNavBadge` is called correctly on transitions (0 → 3 → 0).

### Out of scope

- Stylistic theming knobs beyond the three tones — if a plugin wants a different color, add the tone to the registry definition; don't open a per-plugin color API.
- Server-side badge state — badges are 100% client-runtime. No SSE event types, no server registry, no persistence.
- Migration / backwards-compat shims — single user, no external consumers, callers update in lockstep.
- Moving the messaging plugin into bakin or vice versa — repo split is intentional.

## Acceptance criteria

From the issue, with concrete checks:

- ✅ Plugin updates a badge for one of its nav items without re-registering — `setNavBadge('messaging', 'messaging-plans', { count: 3, tone: 'attention' })` succeeds and AppSidebar re-renders.
- ✅ `Plans` shows a visible badge when at least one Messaging Plan is in `needs_review` — verified against the running imitation-crab dev loop.
- ✅ Badge clears when there are no Plans needing review — transition observed in browser when last `needs_review` Plan is approved.
- ✅ Sidebar rendering remains stable in expanded and collapsed modes — both modes render correctly; collapsed parent shows rollup dot when child has a badge.
- ✅ Tests cover SDK/nav registry behavior, sidebar rendering, hot-reload cleanup, and the messaging count path.
- ✅ Hot reload cleanup — disabling the messaging plugin (or hot-swapping it) clears the Plans badge without leaving stale state in the registry.
- ✅ Core and installed plugins behave identically — verified by exercising both a core plugin (tasks/team) badge and the messaging (installed) badge in tests.

## Design decisions

(Resolved during kickoff interview; recorded as the rationale anchor.)

| Decision | Choice | Why |
|---|---|---|
| Badge shape | `{ count?: number; tone?: 'attention'\|'info'\|'success' }` | Covers count badges, dot-only badges, and future tones without API churn. |
| Update API | Imperative `setNavBadge(pluginId, navItemId, badge\|null)` + plugin mounts a background component | Plugin owns data shape; SDK owns mount lifecycle + cleanup. |
| Background mount | Reuse slots with name `nav-badge-providers` | Zero new SDK primitive; slot cleanup already handled by `clearSlotsOwnedBy`. |
| Parent rollup (collapsed) | Presence dot (no count) | Avoids sum-semantics ambiguity; expanded view shows real per-child counts. |
| NavItem dedup | Single definition in `types/index.ts` | Reduces drift; tech-debt cleanup carried as part of this work per CLAUDE.md priority. |
| Count source | New `/plans/summary` endpoint + SSE refresh | Cheap; matches issue's "efficient summary endpoint" requirement. |
| Cross-repo | Two PRs, bakin first | SDK consumer in bakin-bits-official depends on a published SDK version. |

## Architecture impact

- Adds a new public SDK surface (`setNavBadge`, `getNavBadge`, `getNavBadgesSnapshot`, `subscribeNavBadges`) — types live in `packages/sdk/src/types/index.ts`, implementation in `packages/sdk/src/register.ts`. The exported namespace grows by 4 functions + 1 type + 1 NavItem field.
- New PluginHost mount point: the `<Slot name="nav-badge-providers" />` is the recommended extension point for any background hook runners going forward (not just badges) — documented in plugin-authoring.
- Two subscribe channels on the SDK registry (the existing one for nav/route/slot mutations + the new `subscribeNavBadges`). Separation keeps badge ticks from forcing nav re-renders during high-frequency updates.

## Commit strategy

### PR #1 — bakin (5 commits)

1. **`refactor(sdk): consolidate NavItem type, add NavBadge interface`**
   - Drop local `NavItem` in `register.ts`; import from `types/index.ts`.
   - Add `NavBadge` interface + `badge?: NavBadge` field to `NavItem`.
   - Types-only change; no runtime behavior. Existing tests still pass unchanged.

2. **`feat(sdk): nav badge registry + setNavBadge API`**
   - Add `badgesByPlugin` to `ClientRegistry`, bump version on mutation, separate listener set for `subscribeNavBadges`.
   - Public functions: `setNavBadge`, `getNavBadge`, `getNavBadgesSnapshot`, `subscribeNavBadges`.
   - Extend `unregisterPlugin` to clean up badges for the unregistering plugin.
   - Tests in `tests/sdk/register.test.ts`: set/clear, multi-plugin isolation, unregister cleanup, subscribe-channel isolation.

3. **`feat(host): render nav badges in AppSidebar`**
   - New `NavBadge` + `NavBadgeDot` components.
   - AppSidebar subscribes to the registry and renders badges in all six paths.
   - Parent rollup dot for collapsed paths.
   - New test file `tests/components/app-sidebar-badges.test.tsx` covering each path + rollup behavior + aria-label.

4. **`feat(host): mount nav-badge-providers slot in PluginHost`**
   - Single-line addition: `<Slot name="nav-badge-providers" />` rendered alongside children.
   - Quick test that the slot is present in the rendered tree after a plugin contributes to it.

5. **`docs(knowledge): document nav badge API + sidebar contract`**
   - Append section to `.claude/knowledge/plugin-system.md` covering the new API, the slot, the rollup rule, and the lifecycle guarantee.
   - Append authoring example to `docs/plugin-authoring.md`.

### PR #2 — bakin-bits-official (2 commits, opened after PR #1 merges)

1. **`feat(messaging): plans summary endpoint`**
   - Register `GET /plans/summary` → `{ needsReview, total }`.
   - Extend `tests/plans-routes.test.ts` with the new endpoint.

2. **`feat(messaging): plans needs_review nav badge`**
   - `hooks/use-plans-summary.ts`, `components/plans-badge-provider.tsx`.
   - Wire `PlansBadgeProvider` into `client.tsx` slots field.
   - New test file `tests/plans-badge-provider.test.tsx`.

## Testing strategy

- **Unit** — SDK badge registry behavior (commit 2 of PR #1). Helpers are pure or use the existing globalThis registry pattern; no React needed.
- **Component** — AppSidebar rendering paths (commit 3 of PR #1). Use existing happy-dom + @testing-library/react setup. Cover each path explicitly.
- **Integration (informal)** — Manual verification via the running imitation-crab dev loop. Activate the messaging plugin, watch the Plans badge appear when a plan transitions to `needs_review`, watch it disappear when transitioned out. Collapse the sidebar; confirm the rollup dot on the messaging parent.
- **Hot reload** — Verify in the dev loop: edit the messaging plugin (e.g. change `client.tsx`), trigger hot reload, confirm badges re-attach correctly without stale state.

No e2e/Playwright tests — manual verification is appropriate for a single-user dev loop.

## Boundaries

**Always:**
- Run `bun test --isolate` for every test file touched (per CLAUDE.md).
- Update `.claude/knowledge/plugin-system.md` when the SDK API surface changes.
- Update `docs/plugin-authoring.md` when adding new plugin-authoring patterns.

**Ask first:**
- (Resolved during kickoff. Nothing outstanding.)

**Never:**
- Introduce server-side badge state — badges live in the client registry only.
- Add per-plugin color knobs — extend the `tone` enum instead.
- Add backwards-compat shims for the old NavItem type — single user, no external consumers.
- Couple badge updates to cron, heartbeat, or MCP traffic.
- Touch the messaging plugin in this repo (`plugins/messaging/dist/` is generated from the bakin-bits-official source).
