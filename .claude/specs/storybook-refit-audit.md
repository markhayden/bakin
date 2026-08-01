# Storybook Refit — Phase 0 Audit

Status: APPROVED 2026-07-29 (all §9 items resolved in review — resolutions inline)
Date: 2026-07-29
Spec: `storybook-refit.md` (decisions D1–D16 referenced throughout)
Evidence: four parallel repo sweeps (lists, charts, archetypes, story test posture)
over checkpoint commit `ce0aaf6b8`, plus `design-system/{public-api,migrations}.json`.

Corrections to the spec's assumptions: there are **65** story files (164 stories),
not 67 — the 88 files under `storybook/` include 23 companion `.stories.css` files.

Verdict vocabulary: **keep** (no change) · **retitle** (story title/section only) ·
**rename** (SDK export changes, call sites migrate) · **merge** (absorbed into
another entry/component) · **split** (one scene file → per-component entries) ·
**demote** (leaves the public SDK, moves into its one consumer) · **delete** ·
**new** (missing, to be built).

---

## 1. Headline findings

1. **No docs addon, no code examples, anywhere.** `.storybook/main.ts` loads only
   a11y + vitest. 59/65 files write `parameters.docs.description` that nothing
   renders. The CanonicalUsage + autodocs work (P1) has zero overlap with any
   existing check — it is pure gap.
2. **Coverage is inverted.** Patterns/charts/conversation entries are strong
   (28 files declare coverage axes, rich play tests); the 26 Foundation files are
   the weakest: 18 have zero play assertions, none declare coverage axes, and
   only 12 have visual baselines. The most-reused primitives are the least-proven.
3. **Internal stories never run.** vitest's storybook project excludes the
   `internal` tag, so the 6 internal files (20 stories, 8 with assertions) are
   dead weight in `ui:test:stories`. The teeth script is a single-file canary
   (button.stories.tsx), not a per-entry gate.
4. **The archetype consolidation is even stronger than hoped.** Of seven page
   archetypes, `WorkflowPage` and `ConversationPage` roots have **zero production
   consumers**; `width="wide"` — the default on three archetypes — has **zero call
   sites** (every consumer overrides to `full`); the busy/feedback/state content
   slot is duplicated **six times**; and seven pages hand-roll the identical
   `h-full overflow-auto` string because no `scroll` variant exists.
5. **Lists: ~67% of ~147 surfaces are hand-rolled.** The dominant failure is not
   "no pattern" but "pattern unadopted": most hand-rolled dense rows are literally
   `ListRows variant="separated"` re-typed. Two genuinely missing primitives
   recur: **feed/timeline** (11 hand-rolled implementations, 0 kit coverage) and
   **calendar grid** (2 complete parallel implementations: schedule + Bits messaging).
6. **Charts: the kit is good and unused where it matters.** 8 real chart usages
   total; meanwhile `plugins/health` runs a parallel hand-rolled bar-chart system
   (14 hand-rolled visualizations; "ranked bar with failure overlay" reimplemented
   5×, "100% stacked composition bar" 4×). `ChartDataTable` has zero external
   consumers and two call sites explicitly opt out and hand-roll replacement
   tables — the built-in table needs an escape hatch before Pie/Area ship with it.
7. **Host is the largest un-migrated island.** `packages/host/src/ui/page-archetypes.ts`
   re-exports the entire kit and no host component imports any of it; settings.tsx
   and runtime.tsx still run on legacy `PageLayout`/`PluginHeader` from
   `src/components/`.

---

## 2. Target taxonomy — amendments needed (ASK)

The approved §5 tree covers almost everything, but the audit found four
homeless groups. Proposed amendments (each is a user decision at review):

| Amendment | Rationale | Recommendation |
|---|---|---|
| Add `Agents/` section | D12 sanctions agent-identity vocabulary but the tree gave it no home | **Add** — `Agents/AgentAvatar`, `Agents/AgentSelect`, `Agents/AgentFilter`, `Agents/AgentStatus` |
| Add `Content/` section | MarkdownContent/MarkdownEditor fit no existing section | **Add** — `Content/MarkdownContent`, `Content/MarkdownEditor` |
| Pickers' home | AssetPicker/ModelSelect/ColorPicker: "Choices/" dissolves | **Forms/** — they are form controls |
| `Testing/Plugin UI fixture host` | Public test infra for external plugin authors, not a pattern | **Keep a `Testing/` section** (1 entry, tagged public deliberately) |
| Drop `Foundations/iconography` | No icon kit exists; icons are inline Lucide-style SVGs; several story files duplicate icon helpers | **Drop from tree**; add an iconography *usage note* on the Foundations/Semantic tokens docs page instead of a fake section |

`Primitives/` vs current `Foundation/`: the tree renames the section; the
`Foundation/` vs `Foundations/` split dies in the same move.

Entry-title casing rule (spec §12.5): **component entries use the export name**
(`Primitives/Button`, `Charts/LineChart`) so search-in-sidebar matches
search-in-code; **recipe and foundations entries use sentence-case phrases**
(`Recipes/Settings page with save bar`). Section names: plural nouns except
sanctioned domains (`Conversation/`, `Agents/`) and `Foundations/`.

---

## 3. Story-entry verdicts (all 65 files)

### 3.1 Foundation → Primitives / Overlays / Feedback (26 files)

| Current entry | Verdict | Target |
|---|---|---|
| Foundation/Button | keep+retitle | Primitives/Button |
| Foundation/Input | keep+retitle | Primitives/Input |
| Foundation/Textarea | keep+retitle | Primitives/Textarea |
| Foundation/Checkbox | keep+retitle | Primitives/Checkbox |
| Foundation/Switch | keep+retitle | Primitives/Switch |
| Foundation/Select | keep+retitle | Primitives/Select |
| Foundation/Label | keep+retitle | Primitives/Label |
| Foundation/InputGroup | keep+retitle | Primitives/InputGroup |
| Foundation/Badge | keep+retitle | Primitives/Badge |
| Foundation/Avatar | keep+retitle | Primitives/Avatar |
| Foundation/Card | keep+retitle | Primitives/Card |
| Foundation/Separator | keep+retitle | Primitives/Separator |
| Foundation/Skeleton | keep+retitle | Feedback/Skeleton |
| Foundation/Progress | keep+retitle | Feedback/Progress |
| Foundation/Alert | keep+retitle | Feedback/Alert |
| Foundation/Collapsible | keep+retitle | Primitives/Collapsible |
| Foundation/Command | keep+retitle | Navigation/Command |
| Foundation/Dialog | keep+retitle | Overlays/Dialog |
| Foundation/Sheet | keep+retitle | Overlays/Sheet |
| Foundation/Popover | keep+retitle | Overlays/Popover |
| Foundation/Tooltip | keep+retitle | Overlays/Tooltip |
| Foundation/DropdownMenu | keep+retitle | Overlays/DropdownMenu |
| Foundation/BakinDrawer | rename+retitle | Overlays/Drawer (component rename, §4) |
| Foundation/Text fields | **merge → delete** | duplicates Input/Textarea/InputGroup entries; salvage any unique scenario into those entries |
| Foundation/Selection controls | **merge → delete** | duplicates Checkbox/Switch entries |
| Foundation/Anchored overlays | **merge → delete** | duplicates Popover/Tooltip/DropdownMenu; its overlay-stacking scenario moves to Recipes |
| Foundation/Modal and side overlays | **merge → delete** | duplicates Dialog/Sheet/Drawer; its focus-return scenario moves to Recipes |
| Foundation/Surface and content | **merge** | Card entry (surface tokens demo) + Foundations docs |
| Foundation/Action and status | **split** | Button (action states) + Feedback/StatusBadge |
| Foundations/Semantic tokens | keep+retitle | Foundations/Semantic tokens (fix prefix; add docs description — currently the only public entry without one) |

### 3.2 Patterns and one-off sections (20 files)

| Current entry | Verdict | Target |
|---|---|---|
| Patterns/Lists | **split+grow** | Lists/ListRows + new per-type entries (§6) |
| Patterns/List and detail pages | split | Pages/Page (list variant stories) + Recipes/List page with drawer detail |
| Patterns/Settings and dashboard pages | split | Pages/Page (settings/dashboard variants) + Recipes |
| Patterns/Workspace pages | keep+retitle | Pages/WorkspacePage |
| Patterns/Workflow and action pages | split | Pages/Page (canvas variant) + Lists/Kanban cross-link + Recipes/Workflow canvas page |
| Patterns/Conversation and inspector | split | Conversation/ConversationPanel cross-link + Pages/Page + Recipes/Conversation page with inspector |
| Patterns/Kanban board | keep+retitle | Lists/Kanban |
| Patterns/Filters and navigation | split | Navigation/FacetFilter, Navigation/SegmentedControl, Navigation/UnderlineTabs→Tabs (§4), Navigation/SearchInput, Navigation/Pagination (renamed PageNavigator, §4) |
| Patterns/Destructive and dirty state | split | Feedback/ConfirmDialog, Feedback/DangerZone, Forms/SaveBar, Forms/UnsavedChangesDialog + Recipes/Destructive settings flow |
| Patterns/Status and metrics | split | Charts/StatTile, Charts/StatGroup, Feedback/StatusBadge, Feedback/StatusMarker |
| Patterns/Schedule and timeline | **split** | Lists/Timeline (new component, §6) absorbs the timeline half; RecurringDaySummary demotes (§4) and its story leaves public Storybook |
| Agents/Identity and assignment | split+keep section | Agents/AgentAvatar, Agents/AgentSelect+AgentFilter, Agents/AgentStatus |
| Choices/Asset, model, and color pickers | split | Forms/AssetPicker, Forms/ModelSelect, Forms/ColorPicker |
| Search/Trust states | keep+retitle | Feedback/Search trust states (SearchDegradedChip/SearchPartialChip/SearchUnavailable/ScoreOverlay as one intent family) |
| States/System state and feedback | split | Feedback/SystemState, Feedback/Toast, Feedback/Banner |
| Content/Markdown | split | Content/MarkdownContent, Content/MarkdownEditor |
| Forms/Field and form composition | keep | Forms/Field composition |
| Forms/Plugin settings renderer | keep+retitle | Forms/PluginSettingsRenderer |
| Charts/Line, bar, and stacked charts | **split** | Charts/LineChart, Charts/BarChart, Charts/StackedColumnChart (one file each) |
| Charts/Exact data and compact trends | **split** | Charts/RankedBarChart, Charts/Sparkline, Charts/ChartDataTable, Charts/ChartExplainer |

### 3.3 Layout, conversation, testing, internal (19 files)

| Current entry | Verdict | Target |
|---|---|---|
| Layout/PageShell and flow | split | Layout/PageShell, Layout/Stack+Inline (flow) |
| Layout/Grid, section, and overflow | split | Layout/Grid, Layout/Section, Layout/BoundedOverflow |
| Conversation/* (6 files) | keep | Conversation/* unchanged (sanctioned; already granular). Turn-output gains a visual baseline (only conversation entry without one) |
| Testing/Plugin UI fixture host | keep | Testing/Plugin UI fixture host |
| Internal/Foundation/Button | delete | superseded by the teeth fixture in the public Button entry |
| Maintainer/Plugin containment | keep | Internal/Plugin containment |
| Direction studies/* (4 files) | keep | Internal/Direction studies/* (historical record; excluded from gates as today) |

Net effect: 65 files → ~75 smaller files (splits outnumber merges), every public
entry granular, one component per entry, CanonicalUsage-first.

---

## 4. SDK export verdicts (public API)

`@makinbakin/sdk/ui`, `/layout`, `/content`, `/navigation`, `/conversation`:
**keep everything** except:

| Export | Verdict | New name / home | Blast radius |
|---|---|---|---|
| `BakinDrawer`, `BakinDrawerSection` (ui) | **rename** | `Drawer`, `DrawerSection` (D15; no collision — Sheet stays the primitive side overlay, Drawer is the record-overlay pattern) | schedule, tasks, memory, brands, assets(+drawer sections), workflows, health + stories + Bits |
| `PageNavigator` (patterns) | **rename** | `Pagination` — it renders "Page X of Y" controls; the current name reads as page-level nav | 9 consumer files across health/models/memory/schedule/team/workflows + stories |
| `UnderlineTabs` (patterns) | **merge** | `Tabs` variant (`tabsListVariants` already exists in ui) — one tab system, styled by variant | chat, brands, team, health, models + stories |
| `RecurringDaySummary` (patterns) | **demote** | → `plugins/schedule/components/` (single consumer: calendar-weekly) | schedule only |
| `ScoreOverlay` (patterns) | **keep** | cross-cutting (memory, assets, host search overlay); name is intent | — |
| `AgentAvatar/AgentDot/AgentFilter/AgentSelect/AgentStatus` | **keep** | sanctioned domain (D12) | — |
| `ModelSelect` | **keep** | models + team consumers; "model" is a permanent primitive like agents; flag for D12 list addendum | — |
| `AssetPicker` | **keep** | generic noun, cross-repo utility (Bits hand-rolls a copy it should delete) | — |
| `KanbanBoard/KanbanColumn/KanbanColumnHeader/KanbanColumnBody/KanbanCardSignal` | **keep** (ASK) | kanban is a generic pattern noun (rubric rule 4); single consumer (tasks) argues for demotion by rule 6, but it is one of the seven vetted list types and Bits-facing. Recommendation: keep public, story at Lists/Kanban | — |
| `ASSIGNED_AGENT_VALUE`, `DEFAULT_MODEL_VALUE`, `TEAM_VALUE_PREFIX`, `isTeamValue`, `teamIdFromValue`, `computeMatchedFields` | **keep** | picker/search support constants; not worth API churn | — |

### 4.1 Page archetypes (patterns) — the big consolidation (D6 answer)

Evidence (archetype sweep): all seven wrap `PageShell`; `DashboardPage` ≡
`SettingsPage` byte-for-byte at the root; the busy/feedback/state content slot is
duplicated 6×; `WorkflowPage`/`ConversationPage` roots have zero production
consumers; `width="wide"` has zero call sites; `DetailPageBody layout="aside"`,
`SettingsPageBody layout="navigation"`, `WorkflowPageBody layout="inspector"` are
three implementations of primary-column+rail at three arbitrary breakpoints.

**Proposed final set: 2 archetypes + shared slots.**

| Component | Verdict | Notes |
|---|---|---|
| `Page` | **new** | absorbs ListPage/DetailPage/SettingsPage/DashboardPage/ConversationPage/WorkflowPage roots. Props: `width: 'standard' \| 'full'` (default `full` — matches 100% of shipped pages; `standard` = today's `content` measure), `scroll: 'page' \| 'contained'` (kills seven hand-rolled `h-full overflow-auto` strings), `density: 'default' \| 'compact'` |
| `PageBody` | **new** | the ONE busy/feedback/state slot (replaces 6 duplicates). `layout: 'single' \| 'aside'` (one breakpoint/ratio, replacing three) |
| `PageControls` | **new** | merges ListPageControls + WorkflowPageToolbar (`as` switch for toolbar ARIA) |
| `PageAside`, `PageCanvas`, `PageTimeline`, `PageComposer` | **rename** | from DetailPageAside / WorkflowPageCanvas / ConversationPageTimeline / ConversationPageComposer — the genuinely unique slots survive under intent names |
| `WorkspacePage` + `WorkspacePageHeader/Body/CompactHeader` | **keep** | the only archetype with a real structural contract (full-bleed, mode context, safe-area body) |
| `ListPage*`, `DetailPage*`, `SettingsPage*`, `DashboardPage*`, `ConversationPage*`, `WorkflowPage*` | **delete** | after consumer migration |
| `PageHeader`, `PageHeaderOverflowMenu` | **keep** | universal already |
| `InspectorPanel*`, `SaveBar`, `ConfirmDialog`, `UnsavedChangesDialog`, `DangerZone`, `FacetFilter`, `SegmentedControl`, `SearchInput`, `SortableHead`, `StatTile`, `StatGroup`, `StatusBadge`, `StatusMarker`, `PluginSettingsRenderer` | **keep** | intent names, multi-consumer |

`width="wide"` (max-w-7xl) is **deleted** — zero call sites.

### 4.2 Frozen `/components` entrypoint

Deleted at P-final (D14). Its unique legacy exports (`ChannelIcon`,
`ContextMeter`, `EmptyState`, `ErrorBanner`, `ErrorState`, `PageLayout`,
`PluginHeader`, `SectionCard`, `useUnsavedGuard`) die with the last legacy
consumers: host `settings.tsx` + `runtime.tsx` (→ `Page` + `PageHeader` +
`SettingsPageBody`-equivalent), `src/components/conversation/context-meter.tsx`,
and the three health import-path stragglers that pull chart components from
`/components` instead of `/charts` (agents-usage-chart, overview-agent-spend,
overview-interactions — trivial import swaps).

---

## 5. Charts (D5 execution detail)

New components:

| Component | Consumers waiting | Notes |
|---|---|---|
| `PieChart` (donut via prop) | health/overview-context-traffic (token mix), health/activity-pulse (outcomes), memory/tier-overview-cards (tier distribution) | ≤5 slices; segment labels + exact-data table, non-color cues per kit rules; **not** for ranked comparisons (spend-breakdown stays RankedBarChart) |
| `AreaChart` (single + stacked) | models/spend-tab (cumulative burn), health/agents-usage-chart + overview-agent-spend (wide windows), health/activity-volume-chart (long windows) | same ChartDatum/ChartSeries contract |
| `Sparkline` area-fill variant | team/diagnostics-tab | prop, not a new component |

Kit fixes surfaced by the sweep:

1. **`ChartDataTable` escape hatch** — two call sites `showDataTable={false}` and
   hand-roll replacement tables (health/activity-volume-chart, models/spend-breakdown).
   Add a slot/render-prop so the exact-data contract survives customization; adopt
   at both sites.
2. **RankedBarChart adoption** — 4 hand-rolled ranked-bar surfaces in health
   (activity-breakdown, overview-agent-spend, overview-interactions, activity-pulse
   byKind) map onto the existing component (needs a failure-overlay/secondary-segment
   affordance — audit flags; decide during P4 design).
3. **`CompositionBar`** (RESOLVED: in scope, ships in P4) — a single horizontal
   100%-stacked strip with CVD-safe palette slots, aria-label, exact values, and
   optional dot legend. The two roomy sites (overview-context-traffic,
   activity-pulse outcomes) convert to PieChart; the two inline metric-row strips
   (agent-pulse, overview-interactions) convert to CompositionBar — no standing
   exceptions.
4. Health's hand-rolled `role="progressbar"` context meters → `Progress` (ui).

Chart stories split per §3.2; every chart entry gets CanonicalUsage + coverage
axes (already strong here) + the new Pie/Area entries.

---

## 6. Lists — the vetted set (D7 target)

Seven types (evidence: ~147 surfaces classified):

| # | Type | Kit surface | Status | Work |
|---|---|---|---|---|
| 1 | Dense rows | `ListRows`/`ListRow` | exists, ~16% adopted | add `grouped` variant (chat-rail, Bits plan-list, calendar day lists) + a `columns` grid-template variant to absorb the 8 "grid-as-table" pseudo-tables (models routing/agents/budget rows, health agent-pulse) |
| 2 | Card grid | `Grid` presets via `PageBody` | exists, 3/19 adopted | add `auto-fill` minmax preset (3 identical hand-rolls) |
| 3 | Table | **new `DataTable`** over `Table*` + `SortableHead` + `Pagination` | primitives exist, 2 adopters | RESOLVED: build `DataTable` — columns/rows config, sorting, pagination, mobile ListRows collapse built in; all ~6 true tables migrate to it; `Table*` primitives stay public as the D9-gated escape hatch |
| 4 | Feed / timeline | — | **missing** (11 hand-rolled) | **new `Timeline` component**: `ol` semantics, timestamp gutter, StatusMarker rail, expandable entries. Consumers: task-run-history, task-notes, task-workflow-panels, team/active-context, team/diagnostics, health/activity-event-stream, health/incident-row, workflows/workflow-card, host/runtimes-tab |
| 5 | Picker / option list | `FacetFilter`, `SegmentedControl`, `Command`, `AssetPicker` | exists, decent | add master-detail `NavList` (4 identical Button-stack navigators: agent-detail ×2, node-type-palette, host settings nav) |
| 6 | Kanban | `Kanban*` | exists, 100% adopted | keep as-is; do not generalize |
| 7 | Calendar grid | — | **missing** (2 full parallel implementations) | **new `CalendarGrid`** (month 7-col, week hour×day, day agenda) deduping `plugins/schedule/components/calendar-*.tsx` and Bits `content-calendar.tsx`. Largest net-new item — sized as its own P5 slice |

Storybook: a `Lists/` section with one entry per type; every entry documents
"when to use / when not"; extension past these seven goes through the D9 gate.

---

## 7. Test-posture gaps (D8 gate backlog)

Current floor: 100/164 stories have play+expect; 30/65 files have visual
baselines; 28/65 declare coverage axes; a11y errors enforced storybook-wide;
teeth = single-file canary.

To bring every public entry to the D8 bar the P1 gate must add, per public entry:
play-function assertion (20 files currently at zero — 18 of them Foundation),
visual baseline (35 files missing; priority: the split-out Primitives entries +
conversation/turn-output), declared coverage axes (37 files missing — all
foundation/layout/forms/states), docs description (tokens.generated only).
Internal entries stay excluded from `ui:test:stories` but that exclusion becomes
explicit in the teeth check so it can't silently widen.

Story scaffolding cleanup (D4 CanonicalUsage rule): shared chrome consolidates to
ONE `storybook/support/` module (`StoryStage` replacing the 3 copy-pasted
`StoryHeader`s + 3 `PatternStage`s + 2 `WorkspaceBackdrop`s + duplicated icon
helpers); `ChartStage` survives as chart-recipe scaffolding only after each chart
entry's CanonicalUsage story is scaffold-free.

---

## 8. Ledger + conformance debt sizing (P6 slicing)

`migrations.json` after checkpoint regeneration: 136 paths, 2,411 total
violations (749 raw-palette, 337 arbitrary-size, 118 raw-control, 38 inline-style,
1,162 generic-token, 7 private-import).

| Owner | Violations | P6 slice notes |
|---|---|---|
| host | 549 | settings.tsx + runtime.tsx legacy pages, runtime tabs (raw shadcn), global-search overlay, sidebar |
| Bits projects | 353 | ProjectsPageFrame → Page; project-detail hand-rolled header/rows; delete local ProgressBar + hand-rolled AssetPicker |
| workflows | 339 | step-detail/node-config drawers, canvas chrome |
| health | 325 | chart conformance (§5) + tables + Timeline adoption |
| Bits messaging | 234 | content-calendar → CalendarGrid; plan-workspace rows |
| sdk | 163 | legacy `src/components/` (PageLayout, PluginHeader, ContextMeter…) — deleted, not migrated |
| assets | 146 | grids → Grid auto-fill preset; version rows → ListRows |
| brands | 107 | editor rows → ListRows; builder stepper → Timeline |
| models | 63 | grid-as-table rows → ListRows columns variant |
| memory | 62 | search results → ListRows; cleanup tree → ListRows+Collapsible |
| chat | 36 | launcher card grid; rail grouped rows |
| tasks | 31 | run-history/notes/workflow-panels → Timeline |
| schedule | 3 | calendars → CalendarGrid (debt is low but dedup is the point) |

Suggested P6 commit order: sdk-legacy deletion → host → health → models/memory/
assets/brands/chat/tasks/schedule → workflows → Bits projects → Bits messaging
(Bits last so compat re-pins once per repo pass, lockstep per D13).

---

## 9. Review resolutions (2026-07-29)

1. Taxonomy amendments (§2): **approved** — add `Agents/`, `Content/`, keep
   `Testing/`, drop `Foundations/iconography`, pickers under `Forms/`.
2. Kanban: **`Lists/Kanban` single entry**, components keep their names. Promote
   to its own section only if it grows more entries or a second consumer.
3. Table type: **build `DataTable`** (see §6 row 3).
4. `CalendarGrid`: **confirmed in scope** (P5).
5. `CompositionBar`: **add to chart kit** in P4 (see §5 item 3).
6. RankedBarChart failure-overlay affordance: design call stays deferred to P4.

Archetype note from review: `WorkspacePage` survives as the second archetype
because the split is **scroll ownership** — `Page` is a scrolling document (the
page owns the scrollbar); `WorkspacePage` is an app window (`h-full
overflow-hidden`, inner panes own their scrollers, mode context, sticky compact
header, safe-area handling in slots). Merging them would load pane-scroll
machinery onto every document page.
6. RankedBarChart failure-overlay affordance: design call deferred to P4.
