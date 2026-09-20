# List/table audit — working evidence for #806

## Scope and evidence status

Source snapshot: Bakin `de3d183321c9faca5c21705d08564f1f63d12cd5`;
official Bits `4ff49426de9f88a87298754c515fef30aa866576` (both local main).
The compatibility matrix's older Bits pin is a test-contract input, not the
source snapshot inspected here. Neither main branch nor compatibility pins changed.

This is a **source inventory, census-linked triage and representative browser review**, not a completed fleet/browser
audit. The canonical census contains 102 entries of mixed kinds, not 102 lists.
Direct JSX occurrences below exclude tests, dependencies, and build output;
they do not measure rendered items, unique screens, or wrappers/hand-built lists.
Every canonical ID now has a disposition in [CENSUS.md](CENSUS.md); all 102 IDs
match without omissions or duplicates. This does not mean all nested collections
and state branches have completed browser verification.

The initial scan parsed TSX under `plugins`, `packages/host/src`, and sibling
`bakin-bits-official/plugins` using TypeScript's JSX opening/self-closing nodes.

| Direct component | Occurrences | Files | Notes |
| --- | ---: | ---: | --- |
| ListRows | 39 | 32 | 12 explicit bordered, 18 separated, 5 plain, 4 implicit bordered |
| DataTable | 16 | 14 | 3 explicitly collapse below `2xl`; 13 retain tables |
| Table | 1 | 1 | Health activity chart's exact-data representation |
| Grid | 31 | 22 | Includes page layout, metrics, and skeletons; not 31 card collections |
| Timeline | 5 | 4 | Specialized chronological surfaces |
| NavList | 2 | 2 | Navigation, not a generic collection candidate |

## Current contract and research

Current Storybook offers three ListRows treatments, defaults to bordered rows,
and includes grouped, aligned-column, interactive, and compact compositions.
Card collection guidance is split between primitive Card and layout Grid.
DataTable defaults to retaining a table; its optional narrow mode uses ListRows.

Official references reviewed on 2026-09-19:

- [shadcn Item](https://ui.shadcn.com/docs/components/base/item): media,
  content/title/description, and actions form a reusable item anatomy. Borrow
  that clarity rather than its entire visual variant menu.
- [shadcn Data Table](https://ui.shadcn.com/docs/components/base/data-table):
  a composition guide rather than one universal data-table component. For
  Bakin this argues against a mega-component, not against our shared DataTable.
- [MUI List](https://mui.com/material-ui/react-list/),
  [Card](https://mui.com/material-ui/react-card/), and
  [Table](https://mui.com/material-ui/react-table/): distinguish continuous
  item browsing, a bounded subject, and tabular data. MUI also distinguishes
  native tables from its richer DataGrid; we are not proposing that dependency.
- [Ant Design Table](https://ant.design/components/table/): responsive column
  visibility is explicit. Our inference: narrow layouts need deliberate
  information priority, not automatic information loss.
- [Ant Design List](https://ant.design/components/list/): responsive grid/list
  examples remain informative, but the component is marked deprecated. Do not
  model a new public API on it.

The agreed standard-list/card-list/table distinction is Bakin's design decision,
informed by these sources; it is not a claim that all three frameworks prescribe
the same default or mobile conversion rule.

## Findings and candidate migrations

These are recommendations, not authorization to edit consumers. Paths below are
relative to Bakin except rows marked Bits. Existing migration-ledger allowances
remain authoritative for recorded style debt; a new pattern-choice finding
must not be treated as already approved merely because its path is in that ledger.

| Surface and source | Current evidence | Recommendation / classification |
| --- | --- | --- |
| Kit `storybook/public/lists/list-rows.stories.tsx` | `ListVarieties` says plain is not for interactive records; `Grouped` uses plain rows with Open buttons | Contract/documentation conflict: revise guidance and specimens with the approved direction; no new API required merely to use separated rows |
| Kit `packages/ui/src/patterns/list-rows.tsx` | Default bordered; `separated` has outer top/bottom borders plus internal dividers; row content/layout remains authored by consumers | Review one standard anatomy and density recipe; decide default/compatibility changes explicitly |
| Kit `packages/ui/src/patterns/data-table.tsx` | Sorting controls are inside the wide header; narrow render provides no replacement control | Reusable interaction gap: propose a shared composition/contract before fixing each consumer independently |
| Bits Projects `plugins/projects/components/{project-grid,project-card}.tsx` | Auto-fit cards; title, status, progress, item count, updated time; no media preview | Strong standard-row candidate using existing patterns; preserve progress and unread/streaming signals |
| Workflows `plugins/workflows/components/{workflows-page,workflow-card}.tsx` | Thirds grid of workflow cards with text, assignments and step/feature summaries | Standard-row candidate; preserve assignment and meaningful workflow signals; exact information priority needs visual review |
| Assets `plugins/assets/components/versioned/{VersionedAssetGrid,TagFolderGrid}.tsx` | Auto-fill preview/folder cards; asset and trash tables also present | Keep preview cards as default browsing treatment; retain deliberate table view; don't convert every asset-related list to cards |
| Assets `plugins/assets/components/task-assets.tsx` | Bordered attachment rows | Candidate for compact separated rows, despite belonging to Assets |
| Branding `plugins/brands/components/{brands-page,brand-card}.tsx` | Split-grid cards with logo/monogram cover, palette strip, description and completeness | Strong candidate to keep cards: the visual identity preview earns its space; confirm in browser before the final ruling |
| Branding `plugins/brands/components/{brand-builder,brand-detail}.tsx` | Bordered attached materials/document rows | Standard-row candidates; separate from the top-level brand gallery decision |
| Chat `plugins/chat/components/{launcher,chat-rail}.tsx` | Recent chats default to bordered; rail groups use compact plain rows | Standardize main recent-chat list; evaluate rail as specialized compact context rather than blindly adding dividers everywhere |
| Team `plugins/team/components/{team-manager,lesson-toggle-list,team-detail}.tsx` | Bordered teams/lessons, separated members | Standard rows likely sufficient; preserve toggles and independent actions |
| Explore `plugins/explore/components/{explore-page,hub-skills-section,detail-drawer}.tsx` | Card collections plus plain/bordered skills and preview gallery | Review text-first catalog entries for rows; image gallery remains media composition; do not conflate pickers with result lists |
| Models `plugins/models/components/{aliases-tab,routing-tab,agents-tab,spend-budget-controls}.tsx` | Six ListRows `columns` usages across Models and Health combined; Models mixes alias browsing with labelled editable settings | Separate record browsing from repeated form controls. Alignment alone is not grounds to force a table; retain independent labels when stacked |
| Models `plugins/models/components/{available-models-tab,routing-tab,spend-breakdown}.tsx` | Catalog, routing, spend tables | Keep comparison-table candidates; verify narrow column priorities/scroll rather than converting all to cards |
| Health `plugins/health/components/agent-pulse.tsx` | Bordered aligned rows with expandable agent evidence | Standard-row candidate; review dense comparisons and expansion before changing structure |
| Health `plugins/health/components/activity-failure-groups.tsx` | Two implicit bordered lists plus a hand-built ranked list | Separated-row candidates; review ranked list against existing patterns; preserve chronology only where it helps explain events |
| Health `plugins/health/components/{system-watch-list,activity-breakdown,overview-agent-spend,system-inventory}.tsx` | Separated findings/details plus plain agent ranking | Mostly existing standard-pattern compositions; inspect local spacing/activation rather than replacing wholesale |
| Health `plugins/health/components/{system-search-section,system-inventory,activity-volume-chart}.tsx` | Two DataTables plus raw Table for exact chart data | Retain tabular comparison; raw Table is an escape-hatch review, not automatically a violation |
| Tasks `plugins/tasks/components/task-log-table.tsx` | Collapsing table with role-based narrow rows; sorting state only connected to table headers | Keep deliberate dual layout, fix sort parity through shared contract; verify wide/narrow actions |
| Schedule `plugins/schedule/components/job-list.tsx` | Collapsing table with custom MobileJobRow and bordered narrow treatment | Consolidate narrow-row anatomy; preserve job menus, run/pause actions, and sorting |
| Tasks/Schedule run history and task notes/workflow panels | Already separated rows in `task-run-history`, `task-notes-section`, `task-workflow-panels`, Schedule `run-history` | Keep standard rows unless chronology genuinely needs a timeline; timestamps alone do not justify a rewrite |
| Memory `plugins/memory/components/memory-search-results.tsx` | Search results use DataTable | Retain pending purpose/narrow review; protect search relevance and result navigation |
| Host runtime `packages/host/src/components/runtime/{overview-tab,extensions-section}.tsx` | Three DataTables | Comparison candidates; verify wide content and narrow controls |
| Host search `packages/host/src/components/search/global-search-overlay.tsx` | Local auto-fill CSS for card results rather than Grid | Audit separately against search/command behavior and migration ledger; don't replace its keyboard interaction with generic list behavior |
| Bits Messaging `plugins/messaging/components/{plan-list,plan-workspace,brainstorm-view}.tsx` | Bordered plans, channels, pieces, sessions | Strong separated-row candidates; preserve grouping, actions, and conversation selection |
| Bits Messaging `plugins/messaging/components/content-calendar.tsx` | Specialized calendar; list mode is a collapsing table with custom bordered narrow rows | Keep calendar specialized; standardize list-mode anatomy and sorting independently |
| Bits Terminal `plugins/terminal/components/terminal-page.tsx` | Table of session attributes/actions | Keep comparison candidate; verify long paths and touch actions |
| Bits Projects `plugins/projects/components/{project-checklist,project-detail}.tsx` | Separated tasks and attached assets | Already aligned with the proposed default; verify compact spacing/actions |

## Mobile finding: evidence versus verification

The three explicit table-collapse consumers are Task log, scheduled jobs, and
Bits content-calendar list. The shared narrow renderer has no sorting UI.
Source searches show Task log's `toggleSort`, Schedule's `toggleListSort`, and
the calendar's internal sorting connected to wide DataTable headers without
an equivalent narrow sort control in the inspected sources. This is a
source-supported interaction finding, now reproduced in the shared public
`DataTable/SortedPagedDualRender` story at 320px: the list and pagination remain,
but no sorting control is exposed. Existing sort order is preserved; the missing
capability is changing it. The three production consumers have not individually
completed this interaction check.

## Remaining work before calling the audit complete

- Deepen the census-linked dispositions where several nested collections share
  one surface; all IDs are annotated, but the direct JSX counts remain only a
  starting point and do not imply complete state-branch coverage.
- Inspect custom `map` renderers, semantic lists, and repeated-control groups;
  distinguish prose lists, forms, metric layouts, navigation, pickers, and feeds.
- Confirm individual findings against path-scoped migration records and record
  exact evidence. Do not create exceptions to preserve historical divergence.
- Browser-review representative main pages, rails, drawers and Bits fixtures
  at wide/narrow widths, with state/interaction checks from the spec.
- Resolve card candidates individually: assets yes by intent; branding's visible
  logo/monogram and palette support keeping its cards;
  projects/workflows rows recommended; catalog and richer preview cases pending.
- Approve a Storybook comparison, then publish selection guidance and census
  labels through their maintained source/generator. Do not edit generated
  inventories as a shortcut or declare this draft to be the public contract.

## Census integration finding

`scripts/ui/census.ts` defines surface classification (`visual-surface`,
`embedded-surface`, `non-visual-alias`, `shared-ui`, `public-contract`), not
collection presentation. `design-system/census.schema.json` rejects additional
properties. Do not overwrite that classification with `list` or `table`.

Implemented minimal integration: [CENSUS.md](CENSUS.md), keyed by existing census IDs,
with one or more source/symbol-specific collection findings under each surface.
The generated census remains the authority for ownership, routes and discovery;
the audit records purpose, recommended presentation, decision and evidence.
Aliases and surfaces without collections receive explicit outcomes, not forced
list classifications. Start with the matrix in this scoped audit; a later
machine-readable annotation mechanism needs its own justified scope and tests.

## Additional interaction check

`ListRowActions` in `packages/ui/src/patterns/list-rows.tsx` uses hidden actions
revealed on hover or focus-within for `reveal="hover"`; it has no explicit
coarse-pointer/no-hover treatment. In `ListRows/DenseRows` at 320px with touch
enabled, after moving the pointer outside and clearing focus left by the story
play, the action cluster computed to `display: none`. This confirms hidden
initial actions, not that keyboard/touch access is impossible. The deterministic
story fixture also shims media queries, so a dedicated coarse-pointer consumer
test is still needed before selecting a shared fix. The new row proposal uses
the existing always-visible action treatment. Do not broaden this into unrelated
CardAction changes by assumption.

## Additional source findings from the census pass

The initial three-root scan omitted `src/components` and the reference example.
These are included in the matrix, without silently adding them to the original
direct-use counts:

- `src/components/tasks/activity-feed.tsx`: compact separated activity rows.
- `src/components/provider-keys-tab.tsx`: repeated credential/provider forms;
  preserve independent labels and security semantics, not generic record rows.
- `examples/reference-plugin/components/bookmarks-page.tsx`: text-first bookmark
  cards are row candidates; its single-link widget is not a collection.
- `plugins/team/components/team-grid.tsx`: ReactFlow organizational canvas, not
  a generic card grid. Keep it specialized; evaluate the manager list separately.
- `packages/host/src/components/runtime/capabilities-tab.tsx`: capability cards
  containing dependency facts are row candidates, preserving prerequisite labels.
- Asset detail's versions, exports and references are distinct subcollections;
  the gallery ruling does not settle their presentation.
- The official author template contains status/form sections, not a collection
  simply because it uses two Cards.

## Browser evidence — 2026-09-19

In-app browser/DevTools tools were unavailable. Read-only local Playwright checks
used the existing Bakin server at 3737 and Storybook at 6006. Non-GET/HEAD API
requests were blocked in the live-app inspection contexts; no runtime records
were changed. Live dev assets are not proven to match the audited commit exactly.

| Target | Environment / evidence | Observation and limit |
| --- | --- | --- |
| Projects | macOS Chromium, 1440/320; `/private/tmp/bakin-806-projects-{1440,320}.png` | Text/status/progress cards support the standard-row recommendation |
| Workflows | Same; `/private/tmp/bakin-806-workflows-{1440,320}.png` | Text and assignment summaries support rows; preserve step/feature facts |
| Assets / Branding | Same; `/private/tmp/bakin-806-{assets,brands}-{1440,320}.png` | Preview-led browsing supports keeping cards, especially brand identity/palette |
| Health and other main routes | Same widths; Health screenshots under the same prefix | Initial read-only snapshots, not complete drawer/expansion/error coverage |
| DataTable / SortedPagedDualRender | Shared public story at 320; `/private/tmp/bakin-806-table-mobile.png` | Sort-control absence reproduced; pagination retained |
| ListRows / DenseRows | Shared public story at 320 with touch enabled | Hover-action cluster hidden before focus; fixture caveat above |

The route sweep included projects, assets, brands, workflows, health, models,
schedule, tasks, chat, memory, team, explore, runtime and settings. At the sampled
times no document overflow or page errors were captured. This is not a complete
console/network assertion or all-states pass: Team's narrow view had not settled,
Memory was empty, and other async/interactive branches remain untested.

## Initial Storybook-only comparison and verification (before approval)

`storybook/public/recipes/collection-patterns.stories.tsx`:

- `SameRecords`: identical project facts as separated rows, cards and a table;
  the comparison table deliberately keeps bounded horizontal scrolling.
- `RowBehaviors`: grouped/default and compact rows, keyboard selection,
  independent pinning, disclosure, long labels and a disabled refresh action.
- `PreviewCards`: illustrative brand monograms using existing CardMedia;
  detailed asset previews remain follow-up work.

Closest existing contracts: `ListRows` (`ListVarieties`, `Grouped`, `DenseRows`),
`DataTable` (`SortedPagedDualRender`), `Card` (`MediaCover`), and
`Collapsible` (`Behavior`). Helpers stay in Storybook support and use only focused
`/ui`, `/layout`, `/patterns` APIs. No app consumers, defaults, exports, tokens,
exceptions or compatibility pins changed. The CSS build adds only the utility
for an existing page-title token used by the illustrative monograms.

The initial disclosure composition overflowed its action group: the trigger
defaults to full width. A failing story assertion reproduced this; a supported
`w-auto` composition override fixed it. The row owns the boundary, so the nested
disclosure also uses `border-0`. No shared component behavior changed.
Enlarged-text inspection then caught the longer Pinned label extending beyond
the row. Mobile viewport expansion made the first document-width probe
insufficient. The action group now uses supported wrapping/max-width utilities;
the canonical scenario asserts individual button bounds at 320px/200% text.

- Focused Storybook tests: 3 passed, including keyboard/actions/disclosure and
  action bounds; the overflow regression was observed failing before the fix.
- Quick conformance: passed, including 228 architecture tests and typechecking.
  Used `BAKIN_DOCS_EXTERNAL_SOURCES=/private/tmp/bakin-804-bits.IDXEin/plugins`
  for the existing pinned compatibility source, not current Bits audit main.
- Lint: passed with five pre-existing warnings in untouched files.
- Public Storybook build: passed.
- Row behaviors and preview cards inspected at 1440, 768 and 320px; corrected
  rows have no document overflow at all three. Same-records inspected at 1440/320.
- All three stories inspected at 320px using the existing browser-test technique
  `document.documentElement.style.fontSize = '200%'`. The initial mobile
  document-width probe was insufficient; the row action overflow found through
  screenshot inspection is corrected and guarded as described above. Initial
  local evidence: `/private/tmp/bakin-806-*-text200.png` (before action wrapping).
  Corrected close-up: `/private/tmp/bakin-806-row-actions-text200-fixed.png`;
  direct button-to-row bounds check reports no escaping actions.
- Canonical Linux `mcr.microsoft.com/playwright:v1.60.0-noble`, linux/amd64:
  six targeted visual cases reached the screenshot assertion with heading,
  document bounds and page-error checks passing. With `--update-snapshots=none`,
  all six correctly report missing baselines. No baseline was written/accepted.
  Evidence: `playwright-report/ui/index.html`, `test-results/ui-visual/`.

Baseline acceptance, full conformance, remaining asynchronous states and deeper
fleet coverage are pending. This proposal is ready for visual feedback, not a PR
or a declaration that #806 is finished. Keep the maintainer Storybook running.

## Approved kit-readiness slice

Following visual review, the three-family model and compact independent actions
are approved. Row, card, and table comparisons now show optional overflow menus
using the existing Button/DropdownMenu contract, record-specific trigger names,
keyboard opening, callback assertions, and focus return. These are demonstration
callbacks, not product mutations. Owners remain text-first.

`ListRowGroup` now owns the approved section-header treatment via
`headerVariant="section"`, with a neutral rail by default, semantic `headerTone`,
and `headingLevel` (default 3). The collection recipe no longer builds custom
headings with negative margins. Existing plain labels are unchanged: the source
impact review found compact consumers in Chat's rail and Bits Messaging's plan
list. No app or Bits consumer has been migrated in this slice.

Public evidence: `Components/Lists/ListRows — SectionGroups` (interactive tone
and heading-level controls) and `Recipes/Collection patterns — RowBehaviors`.
The overview and style guide document the contract. Public API inventory review
confirms ListRowGroup and ListRowGroupProps already belong to `/patterns`; no new
export, entrypoint, token, freeze regeneration, or exception is needed.

Verification for the shared-header slice:

- RED: three new group-header tests failed against the old implementation.
- GREEN: 12 focused unit tests and 11 focused public story tests passed.
- Quick conformance passed (228 architecture tests, API/growth/story gates,
  typecheck); targeted lint and public Storybook build passed.
- Canonical Linux visual run with snapshot updates disabled reached all six
  screenshot assertions. All six fail only for absent, unapproved baselines;
  no baseline was accepted. The row action bounds check at 320px/200% text passed.
- Desktop/mobile canonical row renderings were visually inspected. Full
  conformance remains pending; this is not a merge-ready checkpoint.

Issue #759 now explicitly covers mobile filters **and sorting**, including URL
state, one sorting pipeline, and migration guardrails. Kit work and the planned
Workflows proof can proceed independently; affected table migrations remain
incomplete until mobile sort parity is preserved by #759 or a separately
reviewed parity fix. Do not invent a per-plugin replacement.

## Visual approval — 2026-09-20

The user reviewed refreshed canonical full-page desktop (1440px) and mobile
(320px) captures in Finder and approved them ("ooks good"). These include the
neutral group headers, optional menus, compact controls, and the new Details
down/up chevron. Accepted scope is exactly six files under
`tests/ui/snapshots/{chromium-desktop,chromium-mobile}/foundation.visual.ts/`:
`collection-same-records.png`, `collection-row-behaviors.png`, and
`collection-preview-cards.png` for each viewport. A subsequent explicit approval
("Approve the two caption baselines") also covers `lists-list-rows.png` at both
viewports, solely for the corrected overview captions. No other existing
baselines, exceptions, compatibility pins, or performance ceilings may change.

The baseline capture used the pinned canonical Linux image and the targeted
`collection proposal:` scenarios. A fresh render with snapshot updates disabled
passed all six cases. The initial missing-baseline results above are historical
evidence, not current approval blockers. Remaining fleet audit work is still open.

## Foundation review and verification

- Independent read-only review found no remaining correctness, accessibility,
  compatibility, security, or performance code findings. Plain header markup
  and the bordered runtime default are preserved.
- The review corrected stale ListVarieties captions: bordered rows are a
  compatibility/nested-detail choice, and plain compact navigation can contain
  interactive controls. Its two existing desktop/mobile baselines were updated
  only after separate approval of the caption-only before/after evidence.
- Census reconciliation rechecked: 102 documented IDs, no missing/unknown IDs
  or duplicates.
- Full conformance repository tests: 9,467 passed, 15 existing skips, 0 failed.
  Lint passed with five pre-existing warnings in untouched files. Shared vendor,
  core plugin, and host builds and the browser payload ratchet passed.
- All 335 public Storybook interaction/accessibility tests passed (113 files;
  five existing skipped files). The full command's canonical visual stage had
  278 passing cases and two caption-only differences and stopped there. After
  explicit approval, the two baselines were updated in a targeted canonical
  run; a fresh run with updates disabled passed all eight affected screenshots
  (six collection recipes plus the two caption images). No other baseline moved.
- The later isolated plugin-conformance stage passed separately, including the
  reference-plugin HTML report with no findings. Docs generation/validation,
  route checks, site build, and public catalog integration passed separately;
  unrelated generated reference/timestamp/source-path drift was discarded.
- All 93 canonical Chromium/Firefox/WebKit behavior checks passed separately.
  Thus every full-conformance stage has passing evidence after the approved
  visual correction; the full wrapper was not restarted from the beginning.
  Review and verification cover this foundation only, not the remaining fleet
  audit or any consumer migration.
- Rebased cleanly onto main at `91099d012` after verification. The UI source,
  stories, and tests are byte-for-byte unchanged by the rebase. Fresh quick
  conformance and all 11 focused public story tests passed; the rebased full
  repository suite passed 9,497 tests with 15 existing skips and zero failures.
