# Execution Plan — Surgical Agent-Packages UI in Teams (#158)

Companion to `.claude/specs/team-agent-packages-ui.md`. Read the spec first for the *what* and *why*; this document is the *how* — exact files, line numbers, dependency graph, per-checkpoint verification, and the rollback story.

## Refresher (locked decisions live in the spec)

Three Teams surfaces wired in this issue, two components stay on the shelf, no Workshop. The 6-commit strategy carries us from data-plumbing to docs in independently-revertable slices.

## One Deviation From Spec Wording

The spec described "a new `usePackageStates()` hook" as the data-plumbing pattern. The plan uses the **existing Zustand `useAgentStore`** instead — extending its `load()` to fetch `/api/agent-packages` in parallel with the existing roster fetch and exposing a `packageStates` field + a `refreshPackageStates()` action.

Why the deviation:
- `AgentThemeProvider` (`packages/host/src/providers/AgentThemeProvider.tsx:13-15`) already calls `useAgentStore.load()` once at app mount, so the store is populated before any consumer renders. A standalone hook would duplicate that bootstrap fetch in two places (team-grid + agent-detail).
- Single source of truth is more aligned with CLAUDE.md's "no parallel stat-tracking systems" principle.
- The existing `reload` action pattern (used by `team-grid:176`, `agent-detail:43`, `team-manager:21`) already gives us cache-invalidation precedent for free.

The spec's intent — *parallel client fetch, no Teams server changes* — is preserved exactly. Only the implementation shape changes.

## Critical Files

| # | Path | Role | Rough edit surface |
|---|---|---|---|
| 1 | `plugins/team/hooks/use-agent-store.ts` | Add `packageStates: Record<agentId, PackageStateRow>` field, fetch in parallel inside `load()`, expose `refreshPackageStates()` action. New selector `usePackageState(agentId)`. | Extend `AgentStore` interface (12-34), add parallel fetch in `load()` (46-77), add `refreshPackageStates` action, add `usePackageState` selector after `useAgentColor` (108). New `PackageStateRow` type imported from a shared location or inlined. |
| 2 | `plugins/team/types.ts` | Add `PackageStateRow` type (mirrors `/api/agent-packages` response row shape) for use by the store and consumers. | Append type at end of file. |
| 3 | `plugins/team/components/package-state-badge.tsx` | Add `compact` prop for the cramped node context. Compact = no text label, just the colored pill (12px, no padding). | Add `compact?: boolean` to `PackageStateBadgeProps` (25-31). Adjust render branch (66-78) to skip label + tooltip-only mode when compact. |
| 4 | `plugins/team/components/team-grid.tsx` | Wire `<PackageStateBadge compact>` into `AgentCardNode` with attention-only conditional rendering. | Modify `AgentCardNode` (86-140). Add `usePackageState(agent.id)` call near top. Render badge in bottom row (124-136) only when `state ∈ {unmanaged, drifted, update-available}`. Position to be settled visually during build (likely between status badge and model name on line 127-135). |
| 5 | `plugins/team/components/agent-detail.tsx` | Add Knowledge tab to TABS list and render `<KnowledgeToggleList>` (or "Coming soon" empty state). Add Package card section to ProfileTab. Lift agent state for refetch after Adopt. | (a) Extend `Tab` union (25) and `TABS` (27-35). (b) Pass `packageState` prop into `ProfileTab` (272). (c) Insert new `<PackageCard>` component above existing sections in `ProfileTab` (330-363). (d) Add `{activeTab === 'knowledge' && <KnowledgeTab agentId={agentId} packageState={...} />}` row after line 277. (e) Define `<PackageCard>` and `<KnowledgeTab>` helper components after `ProfileTab` (363+) — `<PackageCard>` renders state badge, fields, Adopt button on unmanaged; `<KnowledgeTab>` renders `<KnowledgeToggleList>` for managed/adopted, "Coming soon" otherwise. (f) Adopt button mounts `<AdoptDialog>` and on `onAdopted` calls `refreshPackageStates()`. |
| 6 | `tests/plugins/team/use-package-states.test.ts` | **New.** Unit tests for the store extension. | Asserts: load() fetches both endpoints in parallel; merge by agentId; refreshPackageStates() invalidates and re-fetches; failed `/api/agent-packages` doesn't break agent loading. ~120 lines. |
| 7 | `tests/plugins/team/agent-card-package-badge.test.tsx` | **New.** Component-level test for AgentCardNode badge wiring. | Renders AgentCardNode within a minimal store wrapper for each PackageState; asserts badge presence/absence per attention rules; asserts compact prop applied. ~80 lines. |
| 8 | `tests/plugins/team/agent-detail-package-card.test.tsx` | **New.** Renders Package card per state. | Asserts visible fields per state; CLI hint visibility (drifted, update-available) and absence (managed, adopted, unmanaged); Adopt button visibility (unmanaged only). ~120 lines. |
| 9 | `tests/plugins/team/agent-detail-adopt.test.tsx` | **New.** Adopt button wiring. | Click Adopt → dialog opens with correct `agentId`; mock POST to `/api/agent-packages/install` with `{source, adopt: agentId}`; on success → `refreshPackageStates` called. ~100 lines. |
| 10 | `tests/plugins/team/agent-detail-knowledge-tab.test.tsx` | **New.** Knowledge tab. | Tab visible in tab bar; renders `<KnowledgeToggleList>` for managed/adopted; renders "Coming soon" for unmanaged; clicking tab updates `?tab=knowledge` URL state. ~80 lines. |
| 11 | `.claude/knowledge/team-plugin-ui.md` | **New.** Documents the wiring patterns for future agents. | Sections: agent-card structure, package badge convention (attention-only rule), agent-detail tab order, package state fetching pattern (store extension), Adopt flow round-trip. ~150 lines. |
| 12 | `docs/agent-packages-authoring.md` | Add "From the UI" section. | Short paragraph: what's surfaced today (badge, Package card, Knowledge tab) and what's CLI-only (install, browse, update, remove, reset, drift repair). ~30 lines. |

**No changes to:**

- `plugins/team/index.ts` — Teams server code unchanged. `/api/plugins/team/` continues returning the same shape.
- `packages/host/src/api/agent-packages/*` — REST endpoints already exist and match.
- `plugins/team/components/install-dialog.tsx`, `curated-browser.tsx` — stay built-but-unwired (Workshop ticket).
- `plugins/team/lib/build-graph.ts` — keep `buildGraph` pure; AgentCardNode reads package state via hook, not via prop drilling.
- `plugins/team/components/knowledge-toggle-list.tsx` — already correct, no changes.
- `plugins/team/components/adopt-dialog.tsx` — already correct, no changes.
- `plugins/health/*` — drift widget deferred to Workshop ticket.
- `CLAUDE.md` — plugin count unchanged; existing patterns adequate.
- `README.md` — no user-facing surface change.

## Dependency Graph

```
C1 (store extension) ──┬──▶ C2 (badge) ──────────┐
                       │                          │
                       ├──▶ C3 (Package card) ───▶ C4 (Adopt wiring) ──┐
                       │                                                │
                       └──▶ C5 (Knowledge tab) ─────────────────────────┘
                                                                        │
                                                                        ▼
                                                            C6 (docs — independent, ships last)
```

- **C1 must land before C2, C3, C5** because all three read `packageStates` from the store.
- **C3 must land before C4** because the Adopt button lives inside the Package card.
- **C2, C3, C5 can be developed in parallel** if multiple branches/agents are at play (not the case here, but useful for understanding the slice independence).
- **C6 (docs) is independent** — could land at any point. We put it last so the knowledge file reflects the *landed* state, not the planned state.

## Per-Commit Plan

### C1 — `feat(team): fetch package state in agent store`

**Files:** `plugins/team/hooks/use-agent-store.ts`, `plugins/team/types.ts`, `tests/plugins/team/use-package-states.test.ts`

**Changes:**

1. Add `PackageStateRow` type to `plugins/team/types.ts` mirroring the row shape from `/api/agent-packages`:
   ```ts
   export interface PackageStateRow {
     agentId: string
     state: PackageState  // imported from package-state-badge
     packageId?: string
     source?: string
     ref?: string
     commitSha?: string
     installedAt?: string
     dependencies?: string[]
   }
   ```
   Reference the actual response shape in `packages/host/src/api/agent-packages/list.ts` to confirm field names; correct any drift before committing.

2. Extend `AgentStore` interface (`use-agent-store.ts:12-34`) with:
   ```ts
   packageStates: Record<string, PackageStateRow>
   refreshPackageStates: () => Promise<void>
   ```

3. Modify `load()` (lines 46-77) to use `Promise.all` for the two endpoints:
   ```ts
   const [rosterRes, pkgRes] = await Promise.all([
     fetch('/api/plugins/team/'),
     fetch('/api/agent-packages'),
   ])
   ```
   - Process roster as today
   - Process pkgRes into `packageStates: Record<string, PackageStateRow>`
   - **Failed `/api/agent-packages` is non-fatal** — log + set `packageStates: {}` so the rest of the UI keeps working
   - `set({...existing, packageStates})`

4. Implement `refreshPackageStates()` — re-fetches just `/api/agent-packages` and updates the slice without touching `agents`.

5. Add `usePackageState(agentId)` selector after `useAgentColor` (line 108):
   ```ts
   export function usePackageState(agentId: string): PackageStateRow | undefined {
     return useAgentStore((s) => s.packageStates[agentId])
   }
   ```

**Tests (`use-package-states.test.ts`):**
- `load()` calls both endpoints in parallel (assert via call order/timing)
- Merge: store has correct `packageStates` map after load
- `refreshPackageStates()` re-fetches only the package endpoint
- Failed `/api/agent-packages` → `packageStates: {}`, agents still load
- All required mocks per CLAUDE.md (content-dir x2, openclaw-home, logger, watcher, openclaw-client) — even though this is client-side, transitive imports may pull server modules.

**Verification:**
```bash
bun test --isolate tests/plugins/team/use-package-states.test.ts
bun test --isolate tests/plugins/team   # ensure no existing test regressions
bun run dev:mock                         # store loads without error; check Network tab for parallel fetches
```

**Acceptance:** New test passes. No UI change visible. Network tab shows both `/api/plugins/team/` and `/api/agent-packages` firing on app mount.

---

### C2 — `feat(team): show package state badge on agent cards`

**Files:** `plugins/team/components/package-state-badge.tsx`, `plugins/team/components/team-grid.tsx`, `tests/plugins/team/agent-card-package-badge.test.tsx`

**Changes:**

1. Add `compact` prop to `<PackageStateBadge>` (`package-state-badge.tsx:25-31`):
   ```ts
   compact?: boolean
   ```
   Render branch (66-78) — when `compact`, output a smaller pill: no label text (just the colored dot/pill), tooltip retained, narrower padding (`text-[10px] px-1 py-0` or similar). Keep the existing default render unchanged for non-compact callers.

2. Wire `<PackageStateBadge compact>` into `AgentCardNode` (`team-grid.tsx:86-140`):
   - Add `usePackageState(agent.id)` call near top of component (line 87-88 vicinity)
   - Within bottom row (124-136), after the status `<Badge>` (133) and before the model `<span>` (134) — render conditionally:
     ```tsx
     {pkgState && ['unmanaged', 'drifted', 'update-available'].includes(pkgState.state) && (
       <PackageStateBadge state={pkgState.state} compact />
     )}
     ```
   - If the bottom row gets cramped, expand `CARD_W` in `build-graph.ts:31` from 152 → 168 (or similar). Settle visually during build.

**Tests (`agent-card-package-badge.test.tsx`):**
- Render `AgentCardNode` inside a wrapper that primes the store with each of: `managed`, `adopted`, `unmanaged`, `drifted`, `update-available`, `absent`, undefined (no entry)
- Assert badge presence: only `unmanaged`, `drifted`, `update-available` show a badge
- Assert badge absence: `managed`, `adopted`, `absent`, undefined show no badge
- Assert `compact` prop is passed (badge has no visible label text)

**Verification:**
```bash
bun test --isolate tests/plugins/team/agent-card-package-badge.test.tsx
bun run dev:mock
# Visual: open /team. Verify:
#   - Healthy agents (managed/adopted) → no badge (clean cards as today)
#   - Imitation Crab seeds at least one unmanaged agent → amber/yellow badge visible
#   - Tooltip on the badge shows the state-specific copy
```

**Acceptance:** New test passes. Visual verification matches attention-only rule. Existing team-grid tests still green.

---

### C3 — `feat(team): add Package card to agent detail Profile tab`

**Files:** `plugins/team/components/agent-detail.tsx`, `tests/plugins/team/agent-detail-package-card.test.tsx`

**Changes:**

1. Define new `<PackageCard>` helper component below `ProfileTab` (after line 363). Inputs: `packageState: PackageStateRow | undefined`. Output:
   - Section wrapper (matches `ProfileSection` pattern at line 313-319) — label "Package"
   - State badge (full, non-compact) at top
   - **If state is managed/adopted:** dl-style list of fields — Source, Ref, Commit SHA (short, 7 chars), Installed at (formatted date), Dependencies (chip list)
   - **If state is drifted:** state badge + CLI hint copy box: ``bakin install agent-assets`` with copy-to-clipboard button
   - **If state is update-available:** state badge + CLI hint copy box: ``bakin agents update <agentId>`` with copy-to-clipboard
   - **If state is unmanaged or undefined:** state badge + Adopt button (disabled in C3, wired in C4 — for now placeholder onClick)

2. Modify `ProfileTab` signature (`agent-detail.tsx:330`) to accept `packageState`:
   ```tsx
   function ProfileTab({ profile, packageState }: { profile: AgentProfile; packageState: PackageStateRow | undefined })
   ```

3. Insert `<PackageCard packageState={packageState} />` at the top of `ProfileTab` body (line 332, before the existing Identity section) — appears first so package state is the primary metadata.

4. Update the `<ProfileTab>` callsite (line 272):
   ```tsx
   {activeTab === 'profile' && <ProfileTab profile={profile} packageState={pkgState} />}
   ```
   And `pkgState = usePackageState(agentId)` near the top of `AgentDetail` (around line 39-54).

**Tests (`agent-detail-package-card.test.tsx`):**
- Render Package card with each state value
- Assert displayed fields per state (Source/Ref/Commit/Installed/Deps shown for managed+adopted; CLI hint shown for drifted+update-available; Adopt button shown for unmanaged)
- Assert clipboard button present on CLI hints (don't test actual clipboard write — too fragile)
- Assert Adopt button **disabled** in this commit (becomes enabled in C4)

**Verification:**
```bash
bun test --isolate tests/plugins/team/agent-detail-package-card.test.tsx
bun run dev:mock
# Visual: click into any agent → Profile tab → Package card visible at top.
# Switch between agents in different states (Imitation Crab seeds them) → card adapts correctly.
```

**Acceptance:** New test passes. Visual verification across all 5 states. Adopt button visible but inert.

---

### C4 — `feat(team): wire AdoptDialog into Package card`

**Files:** `plugins/team/components/agent-detail.tsx`, `tests/plugins/team/agent-detail-adopt.test.tsx`

**Changes:**

1. Inside `<PackageCard>`:
   - Local state: `const [adoptOpen, setAdoptOpen] = useState(false)`
   - Replace placeholder Adopt button onClick with `() => setAdoptOpen(true)`
   - Render `<AdoptDialog open={adoptOpen} onOpenChange={setAdoptOpen} agentId={agentId} onAdopted={...} />` at the bottom of the card. Note `agentId` needs to be prop-drilled into `<PackageCard>` from `<ProfileTab>` (or read from a context — prop-drilling is fine here, single hop).
   - `onAdopted` handler: calls `refreshPackageStates()` from the store (new selector), then closes the dialog. Dialog already closes itself on success but we explicitly invalidate state.

2. Pull in `refreshPackageStates`:
   ```tsx
   const refresh = useAgentStore((s) => s.refreshPackageStates)
   ```

**Tests (`agent-detail-adopt.test.tsx`):**
- Render Package card in `unmanaged` state, click Adopt → assert `<AdoptDialog>` is in the DOM with `open=true`
- Mock `fetch('/api/agent-packages/install')` with success
- Submit dialog with valid source → assert POST body matches `{source, adopt: agentId}` shape
- Assert `refreshPackageStates` is called after success
- Assert dialog closes after success (button enabled state, etc.)

**Verification:**
```bash
bun test --isolate tests/plugins/team/agent-detail-adopt.test.tsx
bun run dev:mock
# Visual: pick an unmanaged agent → Profile → Package card → Adopt
#   → enter `github:bakin-examples/pixel` (or any seeded curated source) → submit
#   → verify card transitions to managed/adopted without page reload
#   → verify badge on the agent card in the grid disappears (was attention-only)
```

**Acceptance:** New test passes. End-to-end Adopt flow works from the UI without reload.

---

### C5 — `feat(team): add Knowledge tab to agent-detail`

**Files:** `plugins/team/components/agent-detail.tsx`, `tests/plugins/team/agent-detail-knowledge-tab.test.tsx`

**Changes:**

1. Extend `Tab` union (`agent-detail.tsx:25`):
   ```ts
   type Tab = 'profile' | 'soul' | 'rules' | 'tools' | 'skills' | 'memory' | 'stats' | 'knowledge'
   ```

2. Add to `TABS` array (27-35) — insert after `'memory'` (or wherever fits the visual order; suggest: **after `'skills'` and before `'memory'`** since both Skills and Knowledge are package-rooted concepts):
   ```ts
   { id: 'knowledge', label: 'Knowledge' },
   ```

3. Add render branch in tab content (after line 277):
   ```tsx
   {activeTab === 'knowledge' && <KnowledgeTab agentId={agentId} packageState={pkgState} />}
   ```

4. Define `<KnowledgeTab>` helper after `<PackageCard>`:
   - **If state is managed or adopted:** render `<KnowledgeToggleList agentId={agentId} />` (existing component, no changes)
   - **Else:** render an empty state — centered "Coming soon" with a brief explainer line ("Knowledge management requires an agent-package. Adopt this agent in the Package card to unlock."). Use the existing pattern for empty states (find one in `tasks/skills/memory` tabs to match).

**Tests (`agent-detail-knowledge-tab.test.tsx`):**
- Tab "Knowledge" appears in the tab bar
- Click Knowledge tab → URL updates to `?tab=knowledge`
- For state=managed: renders `<KnowledgeToggleList>` (assert presence by querying for the component's identifying markup, e.g., the loader or a test-id)
- For state=adopted: same as managed
- For state=unmanaged: renders "Coming soon" placeholder
- For state=undefined (no package data): also renders "Coming soon"

**Verification:**
```bash
bun test --isolate tests/plugins/team/agent-detail-knowledge-tab.test.tsx
bun run dev:mock
# Visual: pick a managed agent → Knowledge tab → toggles visible, can flip them
# Pick an unmanaged agent → Knowledge tab → "Coming soon"
# Reload preserves ?tab=knowledge URL state
```

**Acceptance:** New test passes. Knowledge tab works end-to-end for both states.

---

### C6 — `docs: document Teams agent-package UI surfaces`

**Files:** `.claude/knowledge/team-plugin-ui.md` (new), `docs/agent-packages-authoring.md` (extend)

**Changes:**

1. Create `.claude/knowledge/team-plugin-ui.md` with sections:
   - **AgentCardNode structure** — 152px-wide ReactFlow node, status dot top-right, name+role+bottom-row layout, badge insertion point
   - **Package badge convention** — attention-only render rule, compact variant, color mapping per state
   - **agent-detail tab order** — current 8-tab list (Profile, Soul, Rules, Tools, Skills, Knowledge, Memory, Stats), URL-state via `useQueryState('tab')`
   - **Package card placement** — top of Profile tab, render variants per state, CLI hint conventions
   - **Package state fetching** — extension of `useAgentStore.load()` with parallel `/api/agent-packages` fetch, `usePackageState(agentId)` selector, `refreshPackageStates()` invalidation pattern
   - **Adopt flow round-trip** — button → dialog → POST install → onAdopted → refresh → UI auto-updates

2. Extend `docs/agent-packages-authoring.md` with a new "From the UI" section near the end:
   - One paragraph naming the three Teams UI surfaces (badge, Package card, Knowledge tab)
   - One paragraph naming what's CLI-only today (install, browse, curated, update, remove, reset workspace, `.userEdited` lock-release, drift repair)
   - One sentence pointing at the future Workshop ticket

**Tests:** None.

**Verification:**
```bash
# Read the new knowledge file end-to-end. Verify it reflects what landed in C1-C5.
# Read the updated agent-packages-authoring.md section. Verify it matches reality.
```

**Acceptance:** Both files committed; no inaccuracies vs the landed code.

---

## Verification Across All Commits

After each commit:
```bash
bun test --isolate tests/plugins/team   # focused
bun test --isolate                       # full suite, no regressions
```

Before opening the PR:
```bash
bun run typecheck     # confirm exact name in package.json
bun run build:plugins # or scripts/build-plugins.ts — full plugin build clean
bun run dev:mock      # last visual sweep across all 5 acceptance criteria
```

PR checklist (mirrors spec's "Definition of Done"):
- [ ] All 6 commits on `feat/team-agent-packages-ui`
- [ ] Full test suite passes
- [ ] Visual verification of all 5 happy-path criteria + 1 CLI-hint criterion
- [ ] PR body says "Closes #158 partially. Follow-up: <Workshop issue link>"
- [ ] Workshop follow-up issue filed before merge

## Rollback Story

Every commit is independently revertable; the codebase remains functional after any subset is reverted.

| Revert | Result |
|---|---|
| Just C6 | Code identical; only the new knowledge file + docs section disappear. No user-visible change. |
| Just C5 | Knowledge tab vanishes from `agent-detail`; URL `?tab=knowledge` falls back to default `profile`. Other surfaces unchanged. |
| Just C4 | Adopt button on Package card becomes inert (placeholder onClick) — visible but does nothing. CLI hint not added either; user is told via copy to use CLI. Or revert C4 + C3 together for cleaner removal. |
| Just C3 | Package card disappears from Profile tab. Knowledge tab and badge still work. |
| Just C2 | Badges vanish from `AgentCardNode`. Package card + Knowledge tab still functional. |
| Just C1 | All consumers fail to read package state — `usePackageState` returns undefined → badge never renders, Package card defaults to "no package data" (which renders as the unmanaged variant). **C2/C3/C4/C5 must be reverted alongside C1** for full cleanliness, but the partial-revert state is non-broken (just shows "no package data" everywhere). |
| Full revert (C1-C6) | Codebase identical to pre-#158 state. The 5 components in `plugins/team/components/` are still present (they were already there before this issue), still untested at the isolation level (also unchanged). |

**Recovery:** Each commit ships with its own test additions, so `git revert <sha>` cleanly removes both feature and test in one operation. No orphaned tests, no broken imports.

**No destructive operations** in any commit:
- No file deletions
- No schema migrations
- No env var requirements
- No build-pipeline changes
- No new dependencies (every component used is already in the tree; existing primitives in `@bakin/sdk/ui`)

## Open Questions (resolve during build, not blockers)

These are intentionally left open — they're micro-decisions the spec doesn't constrain and that benefit from being settled visually rather than on paper:

1. **Badge placement within the bottom row of `AgentCardNode`** — left-of-status-badge vs right-of-model-text vs replacing the model text. To be settled by eyeballing the rendered card.
2. **Card width adjustment** — keep 152px or grow to ~168px to accommodate the badge. Tied to (1).
3. **Adopt button styling** — primary CTA vs subtle secondary. Probably primary since it's the only action on an unmanaged Package card.
4. **CLI hint copy box style** — fully-rendered `<code>` block with copy button vs inline backtick mention. Probably the former for clipboard ergonomics.
5. **Knowledge tab order** — between Skills and Memory (suggested) or end of list. Tied to mental model of "package-rooted concepts together."

None of these block C1 from starting; all can be settled during their respective commits.
