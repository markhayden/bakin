# Storybook Refit — Plan & Task Breakdown

Status: DRAFT — pending approval
Date: 2026-07-29
Inputs: `storybook-refit.md` (spec, D1–D16), `storybook-refit-audit.md` (approved verdicts)
Branch: `feat/ui-design-system-foundation`, phase-boundary conventional commits (D11)

## Dependency graph

```
P1 gates+docs infra ─→ P2 taxonomy (non-renamed entries)
                     ─→ P3 rename clusters (each carries its own story work)
P2, P3 ─→ P4 chart kit growth ──────────┐
        ─→ P5 page/list kit consolidation ┤─→ P6 per-plugin app conformance ─→ P-final
```

Rules that shape the slicing:

- **Vertical slices, no double-touch.** An entry slated for rename (P3), a new
  chart (P4), or archetype/list consolidation (P5) is NOT rewritten in P2 — its
  story work rides its own slice. P2 covers only entries whose component API is
  already final.
- **Compliance ratchet.** The P1 gates (CanonicalUsage, per-entry coverage) would
  fail on all 65 existing files. They land with a checked-in monotonic baseline
  (`design-system/story-compliance.json`, same pattern as migrations.json):
  reductions pass, increases fail. Every subsequent slice burns it down; it must
  be empty (and is then deleted, gate becomes absolute) at the end of P5.
- **Ledger down only.** Every P6 slice ends with `ui:legacy-styles:generate`
  producing strictly lower ceilings, reviewed in the same commit.
- **Bits lockstep** (D13): P3, P5, P6 slices that touch Bits update the sibling
  checkout in the same slice; `compatibility.json` re-pins at each phase boundary.

Standard verification for EVERY task (run before its commit):
`bun run typecheck && bun run lint && bun run test` + `bun run ui:conformance --quick`;
phase boundaries additionally run `ui:conformance --full`, `ui:test:visual`
(with intentional snapshot updates), and evidence regeneration
(census / public-api / migrations / performance as touched).

---

## P1 — Docs infra + gates (land the grader before the graded work)

**T1.1 addon-docs + autodocs.** Add `@storybook/addon-docs` to `.storybook/main.ts`;
enable autodocs for public entries; verify props tables render from TS types and
story source panels appear. Docs build must stay deterministic
(`ui:build:public:verify`).
*Accept:* a Foundation entry shows autodocs page + source panel in `ui:dev` and in
the public static build; determinism check passes.

**T1.2 `storybook/support/` module.** One shared scaffolding home: `StoryStage`
(replaces 3× `StoryHeader`, 3× `PatternStage`, 2× `WorkspaceBackdrop` copies),
shared icon helpers. Old in-file copies stay until their entries migrate (no
double-touch); new/rewritten entries may only import scaffolding from support.
*Accept:* module exists with tests-by-usage in at least one migrated entry; lint
boundary added (scaffolding imports outside `storybook/` banned).

**T1.3 Story-compliance gate + ratchet.** Extend `verify-story-teeth`/story checks:
every public entry requires (a) first story exported `CanonicalUsage`, minimal,
imports only `@makinbakin/sdk/*`, no story-local helpers; (b) ≥1 play assertion;
(c) meta `bakinCoverage` axes; (d) docs description; (e) visual baseline mapping.
Recipes/Internal exempt from (a) only. Baseline file records current
noncompliance; monotonic check wired into `ui:conformance --quick`.
*Accept:* gate fails on a seeded violation (teeth case), passes on baseline;
baseline counts match audit §7 numbers.

**T1.4 Kit-growth gate (D9).** Conformance check: any new public export from
`packages/ui`/`packages/sdk` UI entrypoints without story entry + CanonicalUsage +
coverage + `public-api.json` registration fails. Teeth case proves it bites.
*Accept:* seeded new export fails; current tree passes.

**T1.5 Internal-exclusion made explicit.** vitest storybook project's `internal`
exclusion becomes a declared, teeth-checked fact (can't silently widen).

**Phase commit:** `feat(storybook): docs addon + canonical-usage, coverage, and kit-growth gates`
**Docs in-phase:** design-system/README.md (new gate + ratchet), CLAUDE.md UI bullet,
`.claude/knowledge/design-system.md`, conformance skill.
**Rollback:** revert single commit; no story content changed yet.

## P2 — Taxonomy reorg (entries with final APIs)

Execution order (one commit per group, ratchet down each time):

**T2.1 Primitives/** — 15 keep+retitle moves (Button…Collapsible per audit §3.1)
each rewritten CanonicalUsage-first with coverage axes + play + visual baseline.
**T2.2 Overlays/** — Dialog, Sheet, Popover, Tooltip, DropdownMenu (Drawer waits
for P3). Merge-delete `anchored-overlays`, `modal-and-side-overlays` (salvage
scenarios → Recipes).
**T2.3 Feedback/** — Skeleton, Progress, Alert + split `action-status`,
`states/system-feedback` (SystemState, Toast, Banner), StatusBadge/StatusMarker
(from status-metrics), Search trust states.
**T2.4 Forms/** — field composition, PluginSettingsRenderer, pickers
(AssetPicker/ModelSelect/ColorPicker from Choices), SaveBar/UnsavedChangesDialog/
ConfirmDialog/DangerZone (from destructive-dirty; composition scenario → Recipes).
**T2.5 Navigation/** — Command, FacetFilter, SegmentedControl, SearchInput
(UnderlineTabs + PageNavigator wait for P3).
**T2.6 Charts/ split** — LineChart, BarChart, StackedColumnChart, RankedBarChart,
Sparkline, ChartDataTable, ChartExplainer one file each; StatTile/StatGroup join
Charts/. ChartStage survives only in recipe stories.
**T2.7 Agents/, Content/, Conversation/, Layout/, Foundations/, Testing/, Internal/**
— splits/retitles per audit §3; tokens.generated gets its docs description; delete
`internal/foundation.stories.tsx`; merge-delete `text-fields`/`selection-controls`/
`surface-content`.
**T2.8 Recipes/** — salvage scenarios landed by T2.2/T2.4 + existing page scenes
that remain valid pre-P5 (list-detail, settings-dashboard scenes move as-is,
retitled; final rewrite happens in P5).

*Accept per task:* moved entries granular + compliant (ratchet strictly lower);
visual snapshots intentionally updated; no dead files; `ui:test:stories` green.
**Phase commit(s):** `refactor(storybook): <section> under intent taxonomy` ×8
**Phase boundary:** full conformance + visual suite; ratchet = only P3/P4/P5-owned
entries remain.
**Docs in-phase:** conformance skill section names; docs site overview.

## P3 — Rename clusters (each slice: rename → call sites → story → evidence)

**T3.1 `BakinDrawer`→`Drawer`, `BakinDrawerSection`→`DrawerSection`** (D15).
Call sites: schedule, tasks, memory, brands, assets, workflows, health, host,
Bits; story → Overlays/Drawer.
**T3.2 `PageNavigator`→`Pagination`.** 9 consumer files; story → Navigation/Pagination.
**T3.3 `UnderlineTabs`→ merged into `Tabs`** (variant). Consumers: chat, brands,
team, health, models; story → Navigation/Tabs (documents both variants); delete
UnderlineTabs.
**T3.4 `RecurringDaySummary` demotion** → `plugins/schedule/components/`; SDK export
removed; its public story removed (schedule-timeline split: timeline half parked
for P5 Timeline).
**T3.5 Health import-path stragglers** — 3 files importing charts from frozen
`/components` → `/charts` (prereq for P-final, cheap here).

*Accept per slice:* zero references to old name repo-wide + Bits; census +
public-api regenerated; ratchet down; suite green.
**Phase commits:** one per cluster, `refactor(sdk)!: …`; boundary re-pins
`compatibility.json`.
**Docs in-phase:** knowledge files naming BakinDrawer/PageNavigator; docs site.

## P4 — Chart kit growth (kit + stories only; app adoption is P6)

**T4.1 `PieChart`** (donut prop; ≤5 slices guidance, exact-data table, non-color
cues). **T4.2 `AreaChart`** (single + stacked; ChartDatum/ChartSeries contract).
**T4.3 `CompositionBar`** (single stacked strip; CVD slots, aria, legend option).
**T4.4 `Sparkline` area-fill variant.** **T4.5 `ChartDataTable` escape hatch**
(slot/render-prop). **T4.6 `RankedBarChart` secondary-segment/failure-overlay
affordance** (design call: resolve while implementing, matching the 4 health
consumers' needs). Each ships: unit tests for scale math (`tests/components/`),
Charts/ story entry (CanonicalUsage + coverage incl. cvd/missing-data), visual
baselines, dataviz-skill-consistent color/geometry review, public-api + kit-growth
gate registration.

**Phase commit(s):** `feat(charts): pie and composition charts` / `feat(charts): area charts + data-table escape hatch`
**Docs in-phase:** CLAUDE.md chart-kit bullet, `.claude/knowledge/agent-health-diagnostics.md`
chart-kit note, docs site.

## P5 — Page + list kit consolidation

**T5.1 `Page` + `PageBody` + `PageControls` + renamed slots** (audit §4.1): build
new components; migrate ALL archetype consumers (mechanical: 10 ListPage, 7
DetailPage, 1 each Settings/Dashboard, chat/team/workflows WorkspacePage
consumers keep theirs; Bits consumers in lockstep); delete six old archetype
roots + duplicate slots; `width="wide"` dies. Stories: Pages/Page (variant-prop
stories incl. width/scroll/density), Pages/WorkspacePage.
**T5.2 `ListRows` growth** — `grouped` variant + `columns` grid-template variant.
Stories under Lists/.
**T5.3 `DataTable`** — columns/rows config, sorting, pagination, mobile ListRows
collapse; migrate the 2 kit tables (task-log, job-list) to prove the API; story
Lists/DataTable.
**T5.4 `Timeline`** — ol semantics, timestamp gutter, StatusMarker rail,
expandable entries; story Lists/Timeline. (App adoption in P6.)
**T5.5 `NavList`** (master-detail button-stack navigator); story Navigation/NavList.
**T5.6 `Grid` auto-fill preset**; Lists/Card grid story.
**T5.7 `CalendarGrid`** — month/week/day views deduping schedule + Bits
content-calendar; schedule plugin migrates in this slice (it IS the reference
consumer); Bits migrates in P6. Story Lists/CalendarGrid.
**T5.8 Lists/Kanban retitle** + Recipes/ final rewrite of page-scene stories
(now composed from `Page`); compliance ratchet reaches ZERO and is deleted —
gates become absolute.

*Accept:* all seven vetted list types documented under Lists/; archetype deletion
leaves zero references; ratchet deleted; full visual suite intentionally updated.
**Phase commits:** one per T5.x, `refactor(patterns)!` / `feat(patterns)`.
**Docs in-phase:** knowledge `design-system.md`/`shared-ui-patterns.md`/`ui-patterns.md`,
docs site, conformance skill pattern list, CLAUDE.md.

## P5.9 — Controls pass + LineChart smoothing (added 2026-07-30, Mark's review)

Also: `LineChart` gains `smooth?: boolean` (default false) — monotone cubic
interpolation (no overshoot; a smoothed line never implies values outside the
data). Story + controls + unit tests + baseline note ride this slice.

Adopt Storybook controls where prop exploration genuinely helps: convert
CanonicalUsage stories to `args`-based form (with `argTypes` select/boolean
controls) for prop-matrix components — Button, Badge, Progress, Avatar, Page
(width/scroll/density), Tabs (variant), charts (donut/stacked/compactData,
CompositionBar size), DataTable (collapseBelow), and peers where the API is
args-friendly. Render-function stories stay for composition-shaped components
where controls would mislead. One commit; no gate changes needed (the
compliance checker already accepts args-based canonical stories).

## P6 — App conformance (ledger burndown; one commit per slice)

Order (audit §8): **T6.1** sdk-legacy deletion (`src/components/` PageLayout,
PluginHeader, ContextMeter → host settings/runtime rebuilt on Page + PageHeader)
→ **T6.2** host (runtime tabs, global-search overlay, sidebar, route wrappers)
→ **T6.3** health (charts adoption per audit §5 incl. Pie/CompositionBar/
RankedBarChart/Progress conversions, 3 raw tables → DataTable/ChartDataTable,
Timeline adoption) → **T6.4** models (grid-as-table → ListRows columns; spend
area chart) → **T6.5** memory, assets, brands, chat, tasks, schedule leftovers
→ **T6.6** workflows (drawers, canvas chrome, Timeline) → **T6.7** Bits projects
(ProjectsPageFrame → Page; delete local ProgressBar + hand-rolled AssetPicker)
→ **T6.8** Bits messaging (content-calendar → CalendarGrid — resolve the six
on-paper gaps from the T5.7 report first: outsideDays rendering, all-day-only
week hours, flat today list, day-header count slot, past-day dimming knob,
and the UTC date-string parsing footgun; plan rows; brainstorm).

Every slice: surfaces map to a vetted pattern or get an explicit exceptions.json
entry (expected: none); `ui:legacy-styles:generate` strictly lower; behavioral
changes verified in the isolated rig (`/verify`) for at least the slice's
highest-traffic page; Bits slices re-pin compatibility.

**Commits:** `refactor(<owner>): conform to vetted patterns`.

## P-final — Zero and delete

**T7.1** Delete `@makinbakin/sdk/components` (all consumers gone in P6);
public-api regen (8→7 entrypoints, frozen bucket gone). **T7.2** migrations.json
regenerated EMPTY; ratchet now guards zero. **T7.3** performance baseline regen
(payload drops expected); census regen; full gate suite + visual suite.
**T7.4** Docs/knowledge/README sweep: anything naming deleted components or old
taxonomy. Memory-file update for the new gates.

**Commit:** `feat(sdk)!: remove frozen components entrypoint; design-system debt to zero`

---

## Checkpoint summary (rollback points)

| After | State guaranteed |
|---|---|
| P1 | Gates live, ratcheted; zero content changed |
| P2 | New taxonomy for stable entries; ratchet lists only P3/P4/P5 entries |
| P3 | No old names anywhere; compat re-pinned |
| P4 | Chart kit complete; app unchanged |
| P5 | Kit final; ratchet zero+deleted; app pages on Page/WorkspacePage |
| each P6 slice | That owner conformant; ledger strictly lower |
| P-final | Ledger empty; /components gone |

## Estimate & risk

Largest items: T5.7 CalendarGrid (two full calendar implementations to unify),
T5.1 Page migration (30+ pages), T6.3 health (27 surfaces). Highest-risk:
visual-baseline churn masking real regressions during P2/P5 — mitigated by
updating snapshots per-task (small reviewable diffs), never in bulk at phase end;
and Base UI popover behavior in play tests (P2 backfill) — the routing-tab fix
in `5204f3d20` is the reference pattern.

## Todo checklist

- [ ] P1: T1.1 addon-docs · T1.2 support module · T1.3 compliance gate+ratchet · T1.4 kit-growth gate · T1.5 internal-exclusion teeth
- [ ] P2: T2.1 Primitives · T2.2 Overlays · T2.3 Feedback · T2.4 Forms · T2.5 Navigation · T2.6 Charts split · T2.7 Agents/Content/Conversation/Layout/Foundations/Testing/Internal · T2.8 Recipes
- [ ] P3: T3.1 Drawer · T3.2 Pagination · T3.3 Tabs merge · T3.4 RecurringDaySummary demotion · T3.5 chart import stragglers
- [ ] P4: T4.1 PieChart · T4.2 AreaChart · T4.3 CompositionBar · T4.4 Sparkline area · T4.5 ChartDataTable hatch · T4.6 RankedBarChart overlay
- [ ] P5: T5.1 Page consolidation · T5.2 ListRows variants · T5.3 DataTable · T5.4 Timeline · T5.5 NavList · T5.6 Grid preset · T5.7 CalendarGrid · T5.8 Kanban/Recipes + ratchet-zero
- [ ] P6: T6.1 sdk-legacy · T6.2 host · T6.3 health · T6.4 models · T6.5 small plugins · T6.6 workflows · T6.7 Bits projects · T6.8 Bits messaging
- [ ] P-final: T7.1 delete /components · T7.2 ledger zero · T7.3 evidence regen · T7.4 docs sweep
