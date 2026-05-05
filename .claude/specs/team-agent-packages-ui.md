# Spec — Surgical Agent-Packages UI in Teams Plugin (#158)

Closes part of [#158](https://github.com/markhayden/bakin/issues/158) as a partial. Opens follow-up for Workshop install/browse UX.

## Problem

The agent-packages refactor shipped 5 self-contained React components in `plugins/team/components/` but **wired none of them into the live Teams UI**. Today:

- Managed / adopted / unmanaged / drifted state is invisible in the browser
- Adopting an existing OpenClaw agent requires CLI
- Per-agent knowledge lessons can't be toggled from the UI
- Package metadata (source, ref, commit, installed-at, deps) is invisible

Components on the shelf, no UI consuming them.

## Why surgical, not comprehensive

The full issue #158 imagines a complete UI parity flow including curated browse, install dialogs, lifecycle (update / remove / reinstall / reset workspace), bulk operations, and a per-package detail drawer for non-agent kinds. That is a different beast — *install/browse/manage* — and naturally belongs in a future top-level "Workshop" page (native, sibling of `/settings`), not the Teams plugin.

This spec covers only what's *contextual to an existing agent*:

1. Visual signal of package state (badge on the agent node)
2. Read-only package metadata + adopt CTA (in agent-detail Profile tab)
3. Interactive knowledge toggling (new tab in agent-detail)

The 2 deferred components stay built-but-unwired in `plugins/team/components/`, awaiting the Workshop ticket.

## Locked Decisions

1. **No Workshop in this issue.** Install / browse / curated UX deferred to a follow-up ticket. `<InstallDialog>` and `<CuratedBrowser>` remain on the shelf, untouched.
2. **3 of 5 components wired:** `<PackageStateBadge>`, `<AdoptDialog>`, `<KnowledgeToggleList>`.
3. **Three Teams surfaces:**
   - Conditional attention-only badge on `AgentCardNode` (only renders when `state ∈ {unmanaged, drifted, update-available}`)
   - Read-only Package card added to Profile tab in `agent-detail`
   - Knowledge tab added to `agent-detail`, always visible (with empty state for unmanaged)
4. **Adopt button lives in the Package card**, not on the node itself. The node badge does the visual signaling; click → agent-detail → Adopt button in Package card.
5. **Package state via parallel client fetch.** New `usePackageStates()` hook calls `/api/agent-packages` in parallel with the existing team list fetch; merge by `agentId` client-side. **Zero changes to Teams server code.**
6. **CLI hints only when no UI alternative.** Unmanaged → Adopt button (no hint). Drifted → `bakin install agent-assets` hint. Update-available → `bakin agents update <id>` hint. Managed/adopted → no hint.
7. **Knowledge tab empty state for unmanaged is "Coming soon"** placeholder — replaced in a follow-up with adoption-value + knowledge-explainer copy.
8. **Issue #158 closes as a partial.** Opens follow-up issue: "Workshop: install/browse/curated UX (the deferred 2 components)."
9. **Branch:** `feat/team-agent-packages-ui`. Single PR.

## Acceptance Criteria

A user opening Teams in the browser can:

- ✅ See at a glance which agents need attention (unmanaged, drifted, or update-available render a colored badge on the agent card; managed/adopted are visually unchanged from today)
- ✅ Open any agent's detail page and see a Package card showing current state and (when present) source / ref / commit SHA / installed-at / dependencies
- ✅ Click "Adopt" on the Package card of any unmanaged agent, complete the flow, and see the agent transition to `managed` state without page refresh
- ✅ Open the Knowledge tab on a managed/adopted agent and toggle individual lessons on/off; toggles persist across reload
- ✅ Open the Knowledge tab on an unmanaged agent and see a "Coming soon" placeholder
- ✅ See a CLI hint with copy-to-clipboard for drifted and update-available states, since those flows are deferred

Not in this issue (CLI remains canonical):

- ❌ Curated browser
- ❌ Install dialog (generic install entry)
- ❌ Update / Reinstall / Remove buttons in agent-detail
- ❌ Reset workspace flow
- ❌ `.userEdited` lock surfacing
- ❌ Drift report widget in Health plugin
- ❌ Bulk update-all
- ❌ Per-package detail drawer for non-agent kinds (skill-pack / workflow-pack / knowledge-pack)
- ❌ Sort / filter team-grid by package state (graph viz makes this awkward; punt to Workshop's installed-list)

## In Scope (Files Touched)

| Path | Change |
|---|---|
| `plugins/team/components/team-grid.tsx` | Wire `<PackageStateBadge>` (compact variant, attention-only) into `AgentCardNode` (lines 86–140). Pass package state to nodes via `data.packageState`. |
| `plugins/team/components/agent-detail.tsx` | Add Package card section to Profile tab (around lines 327–365). Add new "Knowledge" tab to the tab list (lines 27–35) and panel. |
| `plugins/team/components/package-state-badge.tsx` | Add `compact` prop or `size="sm"` variant for the cramped node context. |
| `plugins/team/hooks/use-package-states.ts` | **New.** Hook fetching `/api/agent-packages`, returning a `Record<agentId, PackageStateRow>` map. Re-fetches on focus + on demand (after Adopt success). |
| `plugins/team/hooks/use-agent-store.ts` | Wire `usePackageStates()` alongside existing agent fetch; merge by `agentId` so node `data.packageState` is populated. |
| `tests/plugins/team/use-package-states.test.tsx` | **New.** Coverage for the hook (fetch shape, merge logic, refetch trigger). |
| `tests/plugins/team/agent-card-package-badge.test.tsx` | **New.** Renders `AgentCardNode` with each state value; asserts badge visibility per attention rules. |
| `tests/plugins/team/agent-detail-package-card.test.tsx` | **New.** Renders Package card per state; asserts CLI hint visibility, Adopt button visibility. |
| `tests/plugins/team/agent-detail-adopt.test.tsx` | **New.** Click Adopt → assert `<AdoptDialog>` opens with correct `agentId`; on success assert refetch is triggered. |
| `tests/plugins/team/agent-detail-knowledge-tab.test.tsx` | **New.** Tab renders for managed (lessons + toggles), unmanaged (Coming soon), adopted (lessons). |
| `.claude/knowledge/team-plugin-ui.md` | **New** (or extension to existing `team-plugin.md` if focused). Documents the agent-card structure, package badge convention, agent-detail tabs, package state fetching pattern. |
| `docs/agent-packages-authoring.md` | Add "From the UI" section: short paragraph on what's surfaced in the Teams UI today (badge, Package card, Knowledge tab) and what's CLI-only. |

**Not touched:**

- `plugins/team/index.ts` — Teams server code unchanged. Package state comes from `/api/agent-packages`, which already exists.
- `packages/host/src/api/agent-packages/*` — REST endpoints already exist and match the shapes we need.
- `plugins/team/components/install-dialog.tsx`, `curated-browser.tsx` — stay on the shelf.
- `plugins/health/*` — no drift widget in this issue.
- `CLAUDE.md` — no plugin count changes; pattern coverage already adequate.
- `README.md` — no user-facing CLI or workflow surface changes.

## Commands (Verification Surfaces)

```bash
# Tests during dev (every commit must keep these green)
bun test --watch --isolate tests/plugins/team

# Full suite (pre-merge)
bun test --isolate

# Type check
bun run typecheck   # or whatever the project's tsc invocation is — check package.json

# Build verification (catches plugin-build regressions)
bun run build:plugins   # or scripts/build-plugins.ts

# Visual verification (this is UI work — required)
bun run dev:mock
# Open http://localhost:3737/team and visually verify:
#   - Badges only on attention agents (Imitation Crab seeds at least one of each state)
#   - Click into an agent → Profile tab → Package card visible
#   - Adopt button on unmanaged agents → opens dialog → completes
#   - Knowledge tab visible → renders toggles for managed agents → "Coming soon" for unmanaged
```

## Code Style

Inherits from `CLAUDE.md`:

- TypeScript strict, no `any` across module boundaries
- Functional preference, hooks over class components
- `kebab-case.tsx` for files, `PascalCase` for components
- Imports follow the standard order (Node → external → SDK → internal → plugin → relative)
- `const` over `let`, never `var`
- No empty catch blocks
- No unsolicited refactors of adjacent code (scope discipline)

UI specifics:

- Use existing `@bakin/sdk/components` primitives where they exist (`Badge`, `Button`, `Card`, `Tabs` triggers/content, etc. — survey their actual location during build)
- Mirror existing `agent-detail` tab structure for the Knowledge tab (don't invent a new tab pattern)
- Follow the conditional rendering convention from the existing `<Badge variant=...>` lookups in `team-grid.tsx`

## Testing Strategy

**Mandatory mock setup** (project rule, non-negotiable — see CLAUDE.md "Testing Rules — CRITICAL"):

Every test file must mock both `getContentDir` resolvers (the shim in `src/core/content-dir.ts` AND the canonical `packages/core/src/content-dir.ts`), the OpenClaw home resolver where the code under test still resolves provider paths, the active runtime boundary (`ctx.runtime` or `src/core/app-services`), the logger, and the watcher. Test data goes to `tmpdir()`, never to `~/.bakin/` or `~/.openclaw/`. Cleanup with `afterAll(() => rmSync(testDir, ...))`.

For the new tests in this spec, since we're testing UI components and a thin client-side hook (no server-side filesystem reads), most of those mocks are precautionary — but the rule applies anyway because component imports may transitively pull in modules that read content-dir at module-load.

**Per-commit test focus:**

| Commit | Test additions |
|---|---|
| C1 (hook) | `use-package-states.test.tsx` — fetch shape, merge logic, refetch trigger. Use `mock.module` to stub `/api/agent-packages` response. |
| C2 (badge) | `agent-card-package-badge.test.tsx` — render `AgentCardNode` with each state; assert visibility per attention rules. Snapshot-style assertions on which Badge variant renders. |
| C3 (Package card read-only) | `agent-detail-package-card.test.tsx` — render Package card variants (managed / adopted / unmanaged / drifted / update-available); assert displayed fields + CLI hint visibility. |
| C4 (Adopt wiring) | `agent-detail-adopt.test.tsx` — click Adopt → dialog opens with correct `agentId`; on dialog success → refetch hook called. |
| C5 (Knowledge tab) | `agent-detail-knowledge-tab.test.tsx` — tab renders for managed (delegates to `<KnowledgeToggleList>`); empty state "Coming soon" for unmanaged. |
| C6 (docs) | No test additions. |

**No new isolation tests for `<PackageStateBadge>`, `<AdoptDialog>`, `<KnowledgeToggleList>` themselves** — they exist as components today (the issue body claims "passing isolation tests" but none were found in `tests/plugins/team/`; we're not adding speculative coverage to components that already work, only to the wiring that consumes them). If a wired flow fails because of a component bug, *then* we add isolation tests for the failing component.

**Bun test runner:** `bun test --isolate tests/plugins/team` for the focused suite during dev.

## Boundaries

**Always do:**

- Maintain CLAUDE.md test isolation rules (mock content-dir + provider home paths → tmpdir, mock logger, mock watcher, mock active runtime boundary) — corruption of `~/.bakin/` from a leaked test has happened multiple times
- Use existing `@bakin/sdk/components` primitives instead of duplicating them inside Teams
- Refetch package state on `<AdoptDialog>` success so the UI updates without page reload
- Pass package state through to `AgentCardNode` via `data.packageState` (the React Flow data prop), not via context or external state
- Keep `plugins/team/index.ts` untouched — server-side Teams code does not need to know about packages
- Use TanStack Router's existing `team.$id.tsx` route shape; don't add new routes

**Ask first about:**

- Any change to `<PackageStateBadge>` beyond adding a `compact`/`size="sm"` variant — the component is shared with the (deferred) Workshop ticket; breaking changes propagate
- Any change to the `/api/agent-packages` REST shape — backend is out of scope for this issue
- Reordering Profile tab cards (Identity, Soul, Rules, Tools, Heartbeat exist today; Package card insertion point matters for muscle memory)
- Adding any UI surface for the deferred lifecycle ops (Update / Reinstall / Remove / Reset) — these were explicitly punted to CLI

**Never do:**

- Wire `<InstallDialog>` or `<CuratedBrowser>` in this issue (Workshop ticket)
- Add UI buttons for Update / Reinstall / Remove / Reset (CLI-only for V1)
- Hardcode `~/.bakin/` or `~/.openclaw/` anywhere — use `getContentDir()` / `getOpenClawPath()`
- Add a parallel package-state cache or fetch system — `usePackageStates()` is the single client source of truth, mirroring the "no parallel stat-tracking systems" rule from CLAUDE.md
- Modify Teams server code (`plugins/team/index.ts`) to enrich `/api/plugins/team/` with package state — keeps the two endpoints decoupled and avoids cross-plugin server-side coupling
- Bypass the badge attention-only rule by showing badges for `managed`/`adopted` — clean cards on healthy teams is the explicit design choice
- Skip tests because "the components already work" — wiring is what we're testing here
- Add backwards-compatibility shims for the unwired components (single-user app, no v1→v2 migration)

## Risks

| Risk | Mitigation |
|---|---|
| Adopt flow doesn't refresh state cleanly → user sees stale "unmanaged" until reload | Adopt dialog `onAdopted` callback explicitly invalidates `usePackageStates` query. Test C4 covers this. |
| Knowledge toggle race during in-flight enable/disable | Existing `<KnowledgeToggleList>` already has optimistic UI + revert-on-error (verified in survey). No new logic needed. |
| Badge visual overload on a fresh install where every agent is unmanaged | Acceptable — that's the point. Once user adopts via CLI/UI, badges disappear. |
| Cross-fetch latency makes the team-grid render briefly without badges | Acceptable — both fetches start in parallel on mount. Worst case is ~50ms of badge-less grid. Don't add a loading skeleton just for this. |
| `.userEdited` lock surfacing was an issue ask — skipping it could leave user stuck | Documented in `docs/agent-packages-authoring.md` as CLI-managed for V1: `rm <file>.userEdited` (or future Workshop affordance). Not a blocker. |
| Drift detection produces false positives | Out of scope — drift logic lives server-side in `/api/agent-packages`. We're a display-only consumer. |

## Out of Scope (Tracked in Follow-Up Issues)

To open after this lands:

- **"Workshop: install/browse/curated UX"** — wires `<InstallDialog>` + `<CuratedBrowser>`, adds native `/workshop` page, includes Packages tab for non-agent kinds, drift filter, Health plugin drift count widget.
- **"Knowledge tab adoption-value copy"** — replaces "Coming soon" placeholder with marketing/explainer content.
- **"Lifecycle ops in agent-detail UI"** — Update / Reinstall / Remove / Reset workspace buttons (after Workshop lands and the patterns are settled).

## Definition of Done

- All 6 commits land on `feat/team-agent-packages-ui`
- `bun test --isolate` passes (no regressions in existing suites; new tests pass)
- `bun run dev:mock` visual verification for all 5 acceptance criteria
- PR opened against `main` referencing #158 with "Closes #158 partially. Follow-up: <Workshop issue link>"
- Knowledge file `.claude/knowledge/team-plugin-ui.md` (new or appended) documents the wiring patterns for future agents
- `docs/agent-packages-authoring.md` "From the UI" section landed
- Follow-up Workshop issue filed before merge
