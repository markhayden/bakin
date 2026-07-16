# Main Navigation Redesign — Implementation Plan

Spec: `.claude/specs/main-navigation-redesign.md` (user-approved 2026-07-15).

## Overview

Rebuild the Bakin sidebar around a clear product story: fixed Chat/Tasks primaries; Plan & Automate, Create, Operations, and dynamic Mix-ins sections; then a fixed Make Bakin Yours discovery tile plus Runtime and Settings. The implementation adds a closed public plugin-section contract, coordinates the owned Projects/Messaging declarations in `bakin-bits-official`, makes grouped pages reachable in every responsive mode, and verifies the result in a real browser.

No navigation customization, arbitrary plugin headings, Explore build flow, new dependency, or default-route change is included.

## Grounded Code Facts

- `packages/host/src/components/layout/app-sidebar.tsx` currently renders one flat list and partitions only `placement: 'bottom'` items. Its collapsed child flyout is limited to `alwaysExpanded` groups.
- `packages/host/src/components/layout/layout-shell.tsx` puts `overflow-y-auto` on the entire desktop `<aside>`, so its bottom block is not truly fixed in a short viewport.
- `packages/host/src/components/layout/header.tsx` renders the same `AppSidebar` inside the `w-52` (13rem) mobile drawer; a height-owning sidebar can therefore share the three-region composition.
- `packages/sdk/src/types/registration.ts`, `packages/core/src/plugin-types.ts`, and `packages/core/src/plugins/manifest.ts` own the serialized `NavItem` contract and boundary parsing.
- The SDK browser registry returns a flat `NavItem[]`, sorted by declared `order`; the shell must build the product-specific regions without changing registry ownership.
- The only `placement: 'bottom'` use is the owned Explore manifest. The only `alwaysExpanded` use is owned Messaging.
- Main-repo core plugins declare nav in `bakin-plugin.json`; they generally do not duplicate nav in `client.tsx`.
- Projects and Messaging live in the clean sibling `../bakin-bits-official` repo and duplicate nav in both manifest and runtime client registration, so both copies must change together.
- The imitation-crab seeder supports `BAKIN_BITS_DIR` and symlinks Projects/Messaging from that local source. A dedicated mock home can therefore exercise both feature branches together without fetching published copies.
- Direct Bun mounting of the full AppSidebar dependency graph can segfault under the isolated suite; existing tests intentionally cover pure navigation/badge logic, with the integrated interaction verified in a real browser.
- The current Bakin worktree has unrelated Health-related changes, including a generated `_embedded-assets-static.ts` diff. Implementation must use a clean worktree so no unrelated hunk is staged, rebuilt, or reverted.

## Architecture Decisions

1. **Closed serialized section enum.** Add `NavSection = 'plan-and-automate' | 'create' | 'operations'`; omission means Mix-ins. The parser rejects invalid values and child-level use.
2. **Remove obsolete escape hatches.** Delete `placement` and `alwaysExpanded` from both type tiers and reject stale manifest fields with direct migration errors. All owned uses change in the coordinated release.
3. **Host-owned story.** Plugins choose only a defined destination; the host owns display labels, reserved primary/utility regions, official ranks, Mix-ins fallback, and empty-section omission.
4. **Pure model before rendering.** A router/Lucide-free builder transforms the flat registry snapshot into primary items and ordered sections. This carries the difficult ordering rules and remains cheap to test.
5. **Known official rank, declared section.** Known official nav IDs receive fixed ranks, but Projects/Messaging still declare their sections in their own manifests. The shell does not map external plugin IDs to sections.
6. **One group interaction model.** Expanded parents are disclosure buttons; collapsed parents are accessible hover/focus/click flyout triggers. No special `alwaysExpanded` branch remains.
7. **Three height-owning regions.** AppSidebar uses a fixed primary block, `min-h-0 overflow-y-auto` middle block, and fixed utility block. The outer desktop aside and mobile drawer clip rather than scroll as one unit.
8. **Visual work is browser-gated.** Pure tests prove contracts and ordering; real-browser checks prove flyouts, focus, touch, scroll containment, and the provisional promotional treatment.

## Dependency Graph

```text
Approved spec + plan
        │
        ▼
Public NavSection contract + parser tests
        │
        ├──────────────► Main core-plugin section declarations
        │
        ├──────────────► Bits ambient SDK contract
        │                       │
        │                       ▼
        │                Projects/Messaging declarations + build
        │
        ▼
Pure sidebar navigation model + ordering tests
        │
        ▼
Accessible item/group renderer
        │
        ▼
Three-region expanded/collapsed/mobile composition
        │
        ▼
Make Bakin Yours tile + Explore nav removal
        │
        ├──────────────► Author + maintainer docs
        │
        ▼
Local two-repo browser verification + tuning
        │
        ▼
Full test/build/doc gates + code review
```

The contract and model are sequential foundations. After the contract lands, main-repo manifests and Bits declarations are independent, but this execution stays sequential to keep the two-repo state and commit history easy to audit.

## Branch and Worktree Strategy

Use short-lived feature branches in clean `/tmp` worktrees:

- Bakin branch: `feat/main-navigation-redesign`
- Bakin worktree: `/tmp/bakin-main-navigation-redesign`
- Bits branch: `feat/navigation-sections`
- Bits worktree: `/tmp/bakin-bits-navigation-sections`

Preparation after plan approval:

1. Record `git status --short --branch` and the baseline commit for both repositories.
2. Create both feature branches/worktrees from each repo's `main` without switching or cleaning the user's current worktrees.
3. Recreate the approved spec and plan in the clean Bakin worktree using `apply_patch`, then remove only Codex's temporary untracked copies from the original checkout after verifying the committed copies byte-for-byte.
4. Run focused baseline tests in both clean worktrees before implementation.
5. Never stage, reset, stash, or regenerate files in the original dirty Bakin worktree.

If either feature branch already exists or a baseline fails, stop and report the concrete conflict before modifying source.

## Tasks

### Task 1 — Commit the approved design artifacts

**Description:** Put the reviewed spec and this implementation plan on the clean Bakin feature branch before product code changes.

**Acceptance criteria:**

- [ ] Both approved documents exist under `.claude/specs/` on the feature branch.
- [ ] Their contents match the user-reviewed copies.
- [ ] No unrelated original-worktree changes are present in the commit.

**Verification:**

- [ ] `git diff --check -- .claude/specs/main-navigation-redesign.md .claude/specs/main-navigation-redesign-plan.md`
- [ ] Review the staged diff before commit.

**Dependencies:** Plan approval.

**Files:**

- `.claude/specs/main-navigation-redesign.md`
- `.claude/specs/main-navigation-redesign-plan.md`

**Scope:** Small (2 files).

### Task 2 — Add and validate the navigation-section contract with tests first

**Description:** Add a top-level-only closed `section` contract in the SDK and core type tiers, and teach the manifest parser to validate it at the boundary. Keep the two legacy fields only as a compile-safe transition until every owned consumer is migrated in Tasks 8–10; Task 10A removes them before documentation/final verification.

**Acceptance criteria:**

- [ ] `NavSection` is exported from the public SDK and core surfaces.
- [ ] Every allowed value parses on a top-level nav item; missing section remains valid.
- [ ] Unknown section values and child sections fail with actionable errors.
- [ ] Existing `placement`/`alwaysExpanded` behavior remains buildable only for the duration of the feature branch migration.
- [ ] Existing unrelated manifest behavior remains green.

**Verification:**

- [ ] Write failing cases first in `tests/core/plugin-manifest.test.ts`.
- [ ] `bun test tests/core/plugin-manifest.test.ts --isolate`
- [ ] `bun run typecheck`

**Dependencies:** Task 1.

**Files:**

- `packages/sdk/src/types/registration.ts`
- `packages/core/src/plugin-types.ts`
- `packages/core/src/index.ts`
- `packages/core/src/plugins/manifest.ts`
- `tests/core/plugin-manifest.test.ts`

**Scope:** Medium (5 files).

### Task 3 — Build the pure sidebar navigation model with tests first

**Description:** Replace bottom partitioning with a rendering-ready primary/section model that carries host labels, official ranks, custom ordering, Mix-ins fallback, and empty-section omission.

**Acceptance criteria:**

- [ ] Chat and Tasks are extracted and rendered in fixed order regardless of plugin `order`.
- [ ] Each official destination receives the exact fixed rank from the spec.
- [ ] Custom items follow official items, sort deterministically within their cohort, and fall into Mix-ins when sectionless.
- [ ] Empty sections are absent; the input snapshot is not mutated.

**Verification:**

- [ ] Replace the old partition assertions with failing model assertions first.
- [ ] `bun test tests/components/nav-placement.test.ts --isolate`
- [ ] Run the focused contract/model test set together.

**Dependencies:** Task 2.

**Files:**

- `packages/host/src/components/layout/nav-placement.ts` (rename during implementation only if import churn stays contained)
- `tests/components/nav-placement.test.ts`

**Scope:** Small (2 files).

### Task 4 — Declare main-repo planning and creation destinations

**Description:** Move owned planning/creation plugins onto the closed section contract and update the approved icons/order values.

**Acceptance criteria:**

- [ ] Schedule and Workflows declare `plan-and-automate` with coherent within-section orders.
- [ ] Branding and Assets declare `create`.
- [ ] Schedule uses `CalendarClock`; Branding remains `Paintbrush`.
- [ ] All four manifests parse through the real parser.

**Verification:**

- [ ] Focused manifest parser test plus a small shipped-manifest assertion or parser loop.
- [ ] `bun run typecheck`

**Dependencies:** Task 2.

**Files:**

- `plugins/schedule/bakin-plugin.json`
- `plugins/workflows/bakin-plugin.json`
- `plugins/brands/bakin-plugin.json`
- `plugins/assets/bakin-plugin.json`

**Scope:** Medium (4 files).

### Task 5 — Declare main-repo operations destinations

**Description:** Move owned operational plugins onto the contract and update Health's approved icon.

**Acceptance criteria:**

- [ ] Health, Team, Models, and Memory declare `operations` in the settled order.
- [ ] Health uses `HeartPulse`; retained icons remain unchanged.
- [ ] All four manifests parse through the real parser.

**Verification:**

- [ ] Focused shipped-manifest assertions/parser loop.
- [ ] `bun run typecheck`

**Dependencies:** Task 2.

**Files:**

- `plugins/health/bakin-plugin.json`
- `plugins/team/bakin-plugin.json`
- `plugins/models/bakin-plugin.json`
- `plugins/memory/bakin-plugin.json`

**Scope:** Medium (4 files).

### Task 6 — Sync the Bits development SDK contract

**Description:** Update the official Bits ambient SDK declaration before its plugins author new section fields.

**Acceptance criteria:**

- [ ] Ambient `NavSection` matches the public Bakin enum exactly.
- [ ] Ambient `NavItem` exposes `section` and no longer exposes `alwaysExpanded` or `placement`.
- [ ] Bits typecheck remains green before plugin declarations change.

**Verification:**

- [ ] `bun run typecheck` in the Bits worktree.

**Dependencies:** Task 2.

**Files:**

- `types/sdk-ambient.d.ts`

**Scope:** Extra small (1 file).

### Task 7 — Place official Projects and Messaging in their owned repo

**Description:** Update both manifest and runtime nav copies in `bakin-bits-official`, including the approved icons and normal disclosure behavior.

**Acceptance criteria:**

- [ ] Projects declares `plan-and-automate` and `FolderKanban` in manifest and client registration.
- [ ] Messaging declares `create` and `Megaphone`; its children use CalendarDays, ClipboardList, and Lightbulb.
- [ ] `alwaysExpanded` is gone; manifest/runtime declarations remain byte-shape equivalent for drift checking.
- [ ] Bits tests, typecheck, lint, and build pass.

**Verification:**

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run test`
- [ ] `bun run build`

**Dependencies:** Task 6.

**Files:**

- `plugins/projects/bakin-plugin.json`
- `plugins/projects/client.tsx`
- `plugins/messaging/bakin-plugin.json`
- `plugins/messaging/client.tsx`

**Scope:** Medium (4 files).

### Checkpoint A — Contract and declarations

- [ ] Main contract/parser/model focused tests pass together.
- [ ] All main and Bits changed manifests parse.
- [ ] Bits manifest/runtime drift inputs match.
- [ ] Both repositories typecheck.
- [ ] Review git diffs and commit boundaries before UI work.

### Task 8 — Extract one accessible nav-item/group renderer

**Description:** Collapse the current expanded/collapsed branch duplication into a focused local renderer with one disclosure model and complete badge semantics.

**Acceptance criteria:**

- [ ] Flat items preserve active state, tooltip/accessibility labels, expanded pills, and collapsed severity dots.
- [ ] Every child-bearing item uses a disclosure button in expanded mode and a hover/focus/click flyout in collapsed mode.
- [ ] Active-route auto-open/manual-open/leave-to-close behavior matches the spec without `alwaysExpanded`.
- [ ] Closed parent badge roll-up considers parent and children; expanded children show their actual badges.

**Verification:**

- [ ] Update pure badge/activity tests before wiring the renderer.
- [ ] `bun test tests/components/nav-badge-logic.test.ts tests/components/nav-badge.test.tsx --isolate`
- [ ] `bun run typecheck`

**Dependencies:** Tasks 2 and 3.

**Files:**

- `packages/host/src/components/layout/sidebar-nav-item.tsx` (new)
- `packages/host/src/components/layout/app-sidebar.tsx`
- `packages/host/src/components/layout/nav-badge-logic.ts`
- `tests/components/nav-badge-logic.test.ts`

**Scope:** Medium (4 files).

### Task 9 — Render the three-region sidebar in every responsive mode

**Description:** Connect the pure model to fixed primary, scrollable sections, and fixed utility regions; render headings when expanded and restrained section separation in the rail.

**Acceptance criteria:**

- [ ] Expanded order exactly matches the spec; section headings are text-only/non-interactive.
- [ ] Collapsed order remains identical while headings disappear and grouping remains visually legible.
- [ ] Only the middle region scrolls in short viewports; top and bottom regions remain visible.
- [ ] The mobile drawer uses the full expanded presentation, closes on navigation, and owns its height correctly.
- [ ] Runtime uses `ServerCog`; unknown/missing plugin icons fall back to `Puzzle`.

**Verification:**

- [ ] `bun test tests/components/nav-placement.test.ts tests/components/layout-shell.test.ts --isolate`
- [ ] `bun run typecheck`
- [ ] Initial browser DOM/layout smoke check before promotional styling.

**Dependencies:** Task 8 and Checkpoint A.

**Files:**

- `packages/host/src/components/layout/app-sidebar.tsx`
- `packages/host/src/components/layout/sidebar-nav-item.tsx`
- `packages/host/src/components/layout/layout-shell.tsx`
- `packages/host/src/components/layout/header.tsx` (only if mobile height/accessibility requires it)
- `tests/components/layout-shell.test.ts` (only for testable extracted policy; do not assert raw Tailwind strings)

**Scope:** Medium (up to 5 files).

### Task 10 — Add Make Bakin Yours and remove Explore's ordinary nav item

**Description:** Make discovery a shell-owned responsive promotional tile while leaving the Explore route/page untouched.

**Acceptance criteria:**

- [ ] Expanded tile uses the exact title/copy and restrained cropped `bakin-hop.svg` treatment.
- [ ] Collapsed tile uses `Blocks`, a standalone accessible label, and visually differs from ordinary rows.
- [ ] Both link to `/explore` and close the mobile drawer after selection.
- [ ] Explore no longer contributes `Extend Bakin` nav or obsolete `placement`, while all Explore routes/slots still work.

**Verification:**

- [ ] Parse the Explore manifest through the real parser.
- [ ] Run focused Explore route/component tests.
- [ ] Browser check `/explore` from expanded, collapsed, and mobile entry points.

**Dependencies:** Task 9.

**Files:**

- `packages/host/src/components/layout/sidebar-promo.tsx` (new)
- `packages/host/src/components/layout/app-sidebar.tsx`
- `plugins/explore/bakin-plugin.json`
- `plugins/explore/client.tsx`

**Scope:** Medium (4 files).

### Task 10A — Remove the obsolete navigation fields

**Description:** After all owned consumers are migrated, delete `placement` and `alwaysExpanded` from both type tiers and reject stale manifest fields with the approved migration guidance.

**Acceptance criteria:**

- [ ] Neither public type tier exposes either legacy field.
- [ ] The parser rejects both fields instead of silently dropping them.
- [ ] No source manifest, runtime declaration, host component, test fixture, or maintained doc relies on either field.
- [ ] Typecheck and focused parser/sidebar tests pass in the final contract state.

**Verification:**

- [ ] Write the removal/rejection tests before deleting the transition fields.
- [ ] `bun test tests/core/plugin-manifest.test.ts tests/components/nav-placement.test.ts tests/components/nav-badge-logic.test.ts --isolate`
- [ ] `bun run typecheck`

**Dependencies:** Tasks 8–10.

**Files:**

- `packages/sdk/src/types/registration.ts`
- `packages/core/src/plugin-types.ts`
- `packages/core/src/index.ts`
- `packages/core/src/plugins/manifest.ts`
- `tests/core/plugin-manifest.test.ts`

**Scope:** Medium (5 files).

### Checkpoint B — Functional sidebar

- [ ] Focused main tests and typecheck pass.
- [ ] Expanded, collapsed, and mobile layouts all render with local Bits.
- [ ] Every Messaging child is reachable with pointer and keyboard.
- [ ] Short-height scroll containment is correct.
- [ ] Tasks remains `/` default and all utility routes work.

### Task 11 — Document the public plugin navigation contract

**Description:** Update author-facing docs and maintainer knowledge alongside the public contract.

**Acceptance criteria:**

- [ ] Docs list the three serialized section values, top-level-only rule, omitted-to-Mix-ins behavior, ordering guarantees, and reserved regions.
- [ ] No docs recommend arbitrary sections, `placement`, or `alwaysExpanded`.
- [ ] Plugin-creation guidance emits or explains the current contract.

**Verification:**

- [ ] `rg -n 'placement|alwaysExpanded|section'` review across touched docs.
- [ ] `bun run docs:validate`

**Dependencies:** Tasks 2–7 and 10A.

**Files:**

- `.claude/knowledge/plugin-system.md`
- `docs/src/content/docs/extending/plugins/manifest.md`
- `docs/src/content/docs/extending/plugins/client-ui.md`
- `.claude/skills/create-plugin.md` (only if its example exposes NavItem)

**Scope:** Medium (up to 4 files).

### Task 12 — Document the sidebar story and discovery entry

**Description:** Rewrite stale Explore/sidebar knowledge and the thin user navigation overview to match the shipped hierarchy.

**Acceptance criteria:**

- [ ] Explore knowledge describes Make Bakin Yours as a shell entry and removes `Extend Bakin`/bottom placement instructions.
- [ ] The design-system or UI-pattern owner documents the three-region and collapsed-group behavior without duplicating implementation details.
- [ ] Essentials explains the primary-to-plan-to-create-to-operations story and Mix-ins fallback.
- [ ] README is changed only if final inspection finds directly stale wording.

**Verification:**

- [ ] Repo-wide stale-term search for `Extend Bakin`, nav `placement`, and `alwaysExpanded`.
- [ ] `bun run docs:check`

**Dependencies:** Tasks 9 and 10.

**Files:**

- `.claude/knowledge/explore-plugin.md`
- `.claude/knowledge/design-system.md` or `.claude/knowledge/ui-patterns.md` (choose the existing owner, not both unless necessary)
- `docs/src/content/docs/using/essentials.md`
- `README.md` (conditional only)

**Scope:** Medium (3–4 files).

### Task 13 — Run the real-browser acceptance pass and tune the visuals

**Description:** Boot a disposable mock home against both feature worktrees, verify all responsive/interaction acceptance criteria, capture screenshots, and make only evidence-driven polish changes.

**Runtime command:**

```sh
IMITATION_CRAB_HOME=/tmp/bakin-nav-mock \
BAKIN_BITS_DIR=/tmp/bakin-bits-navigation-sections \
IMITATION_CRAB_PORT=18790 \
PORT=3741 \
bun run dev:mock
```

**Acceptance criteria:**

- [ ] 1440×900 expanded and collapsed states match the hierarchy and remain comfortably scannable.
- [ ] A short desktop viewport keeps top/bottom fixed while only the middle scrolls.
- [ ] Mobile drawer shows the full hierarchy and closes after flat/child navigation.
- [ ] Keyboard flow proves visible focus, disclosure state, flyout entry/exit, tooltips/accessibility labels, and every nested route.
- [ ] Badge pills/dots and accessible announcements remain accurate.
- [ ] Make Bakin Yours copy/artwork feels restrained and legible; no gradient/saturated treatment appears.
- [ ] Screenshots exist for expanded, collapsed, mobile, and short-height states.

**Verification:**

- [ ] Browser console has no new errors.
- [ ] DOM checks confirm section labels/order, `aria-expanded`, accessible names, and one active route.
- [ ] Route pass covers `/`, `/chat`, all official top-level routes, Messaging children, `/explore`, `/runtime`, and `/settings`.
- [ ] Re-run focused tests and typecheck after any tuning.

**Dependencies:** Checkpoint B and Tasks 11–12.

**Files:** At most five specific layout files implicated by browser evidence; split another focused task/commit if evidence requires more. Do not broaden the pass into customization or Explore-page work.

**Scope:** Medium, bounded by acceptance criteria.

### Task 14 — Full verification, generated artifacts, and final code review

**Description:** Run both repositories' full gates, review the complete change across contract/UI/docs/accessibility, and commit only generated artifacts the repo expects.

**Acceptance criteria:**

- [ ] Main full tests, lint, typecheck, docs build/check, and production build pass.
- [ ] Bits tests, lint, typecheck, and build pass.
- [ ] Generated `_embedded-assets-static.ts` is committed only if the clean-worktree generator changes it; no original Health hunk can enter the branch.
- [ ] A multi-axis code review finds no unresolved high/medium issue, stale contract copy, inaccessible route, or scope leak.
- [ ] Both branch histories contain atomic green commits and clean worktrees.

**Verification:**

- [ ] Main: `bun run test`
- [ ] Main: `bun run lint`
- [ ] Main: `bun run typecheck`
- [ ] Main: `bun run docs:check`
- [ ] Main: `bun run build`
- [ ] Bits: `bun run test && bun run lint && bun run typecheck && bun run build`
- [ ] `git diff --check` and `git status --short --branch` in both worktrees.
- [ ] Review staged/generated diffs before the final commit.

**Dependencies:** Task 13.

**Files:** Conditional generated manifest only; review itself is read-only.

**Scope:** Small implementation delta, large verification pass.

## Commit Strategy

Every numbered commit is a tested rollback checkpoint. Commit only after its task's focused verification passes; review staged diffs and secrets before each commit. Do not squash the cross-contract story away.

### Bakin branch

| # | Commit | Contents / rollback boundary |
|---:|---|---|
| 1 | `docs(nav): add approved main navigation redesign` | Spec and implementation plan only. |
| 2 | `feat(nav): define closed plugin navigation sections` | Additive SDK/core section contract, strict section parsing, and contract tests. Legacy fields remain only during branch migration. |
| 3 | `feat(nav): model primary and sectioned sidebar destinations` | Pure region/section builder and deterministic ordering tests. |
| 4 | `feat(nav): group planning and creation destinations` | Schedule, Workflows, Branding, and Assets manifest declarations/icons. |
| 5 | `feat(nav): group operations destinations` | Health, Team, Models, and Memory declarations/icons. |
| 6 | `refactor(nav): unify grouped navigation interactions` | Focused item/group renderer and badge/disclosure logic. |
| 7 | `feat(nav): render responsive three-region sidebar` | Sectioned expanded/rail/mobile composition, fixed-scroll-fixed layout, Runtime/fallback icons. |
| 8 | `feat(nav): add Make Bakin Yours discovery tile` | Responsive promotion plus removal of Explore's ordinary nav contribution. |
| 9 | `refactor(nav)!: remove obsolete navigation placement fields` | Final type/parser cleanup after every owned consumer has migrated; no compatibility shim remains. |
| 10 | `docs(nav): document plugin navigation sections` | Public author docs and plugin-system knowledge. |
| 11 | `docs(nav): document the sidebar story and discovery entry` | Explore/design-system/Essentials updates. |
| 12 | `fix(nav): tune responsive sidebar from browser review` | Conditional, browser-evidenced polish only; omit if no changes are needed. |
| 13 | `chore(build): refresh embedded navigation assets` | Conditional clean-worktree generated manifest only. |

### `bakin-bits-official` branch

| # | Commit | Contents / rollback boundary |
|---:|---|---|
| 1 | `chore(sdk)!: sync navigation section contract` | Ambient SDK enum/field and removal of obsolete fields. |
| 2 | `feat(nav): group official Projects and Messaging` | Both manifest/runtime declaration pairs, icons, and Messaging disclosure behavior. |

### Cross-repository release order

1. Land/publish the Bits declarations first. The current shell harmlessly ignores the new serialized `section` field, while the removed `alwaysExpanded` field is simply absent.
2. Land the stricter Bakin contract and shell immediately after, then update the installed owned plugins before starting that build on the real machine.
3. For local review before either merge, run Bakin's feature worktree with `BAKIN_BITS_DIR` pointing at the Bits feature worktree.
4. Do not push, merge, publish packages, or open PRs unless the user explicitly requests it after local verification.

## Verification Checkpoints

### Checkpoint A — After Tasks 2–7

- Contract/parser/model focused tests green.
- Both repositories typecheck.
- All owned manifests parse and Bits nav copies match.
- Commit histories match the strategy.

### Checkpoint B — After Tasks 8–10

- Functional sidebar works in expanded, collapsed, mobile, and short-height modes.
- All child routes and utility destinations are reachable.
- Tasks remains default.
- Make Bakin Yours reaches unchanged Explore.

### Checkpoint C — After Tasks 11–14

- Documentation and knowledge are current.
- Screenshots reviewed and polish accepted.
- Both full CI-equivalent command sets pass.
- Final review has no unresolved high/medium concern.
- Branches are ready for optional publish/PR handoff.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Existing dirty generated file gets mixed into nav work | High | Build only in a clean `/tmp` worktree; never stage/regenerate the original checkout. |
| Main and Bits contract drift | High | Contract first; update Bits ambient type; keep manifest/runtime declarations paired; run both builds and local symlink integration. |
| Custom `order` jumps ahead of official items | Medium | Separate official-rank and custom-order cohorts in the pure model; regression tests include negative/small custom orders. |
| Section values used on children or arbitrary headings | Medium | Strict top-level parser context and closed enum; direct error tests and docs. |
| Collapsed flyout is pointer-only or closes before keyboard entry | High | Base UI hover/focus/click primitive, real button semantics, and explicit browser keyboard pass. |
| Manual-open/active-route state fights navigation | Medium | Keep state transition logic small; route tests for enter/leave and browser use to tune. |
| Fixed regions overflow on very short screens | Medium | Height-owning nav, `min-h-0` middle scroller, and short-viewport screenshot/check. |
| Full AppSidebar component test crashes Bun | Medium | Preserve the proven pure-helper test boundary; use browser verification for integrated rendering rather than weakening coverage. |
| Promotional tile dominates the nav | Medium | Reuse brand mark sparingly, no gradients, test at real dimensions, keep visual changes in a browser-tuning checkpoint. |
| Removing obsolete fields surprises an unknown local plugin | Low by stated scope | Single-user/no-compatibility project decision; clear parser errors point directly to `section`/Mix-ins migration. |
| Build regenerates unexpected hashed vendor entries | Medium | Inspect clean-worktree generated diff; commit only expected output in a dedicated final commit. |

## Out of Scope Guardrails

- No custom section labels.
- No plugin access to Chat/Tasks or the bottom utility region.
- No drag/drop, pinning, hiding, or saved customization.
- No changes to Explore catalog/content/install flows.
- No in-product plugin builder or build-path UI; GitHub issue #688 owns that future work.
- No dependency additions, sidebar-width changes, or broad design-system refactor.
- No unrelated Health work, generated artifacts, or existing user changes.

## Open Questions

None. Implementation begins only after the user approves this plan.
