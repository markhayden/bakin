# List/table audit — working evidence for #806

## Final fleet sweep — 2026-09-22

This section supersedes the historical pending recommendations below. The user
approved finishing all remaining collection work in one batch; Models is
explicitly excluded because it is being refactored separately. Previously
approved Projects, Messaging, Tasks, Schedule and Workflows are not redesigned.

| Surface | Final disposition | Protected behavior |
| --- | --- | --- |
| Runtime capability/setup/runtime/extension inventories | Responsive DataTables with a host-local composition of the existing Select and DataTable | URL-backed heading/selector sorting; numeric and null-last ordering; full path/SHA and readiness facts; independent trust, repair and switch confirmations |
| Health check registry | Grouped disclosures containing sortable DataTables | Healthy/not-applicable/failed evidence retained; concerning groups initially open; revealing evidence focuses the visible narrow or wide copy without adding permanent tab stops |
| Health overview incidents/notices | Separated supporting rows, not independently sorted tables | Canonical attention priority, capped preview/disclosure, exact acknowledgement/snooze/resolution actions retained |
| Chat recent conversations | Separated supporting rows with wrapping identities | Six-item preview, unread/open behavior and conversation/agent starters retained |
| Team management and lessons | Separated supporting rows | Reporting fields, confirmed deletion, lesson switches, pending locks and URL highlighting retained; org canvas untouched |
| Assets attachments/history/references/downloads | Separated supporting rows | Preview/promote/delete and outbound/download actions remain independent; unlink errors/retry, read-only behavior, pending lock and stale-response protection covered |
| Branding materials/documents/lessons | Separated supporting rows | File names wrap; existing editing, staged saves, toggles and delete actions retained; logo/palette/media galleries unchanged |
| Terminal index (Bits) | Responsive sortable DataTable | Persistent sorting, full working directory, named independent session menu and existing operation/confirmation ownership semantics; terminal workspace unchanged |
| Reference bookmark plugin | Table-first author example | Shared heading/selector sorting, narrow roles, outbound links and independent deletion; creation form/conversation example retained |

Retained specialized interfaces are intentional, not unfinished card-to-table
work: media/brand galleries, org/workflow canvases, calendars, boards, timelines,
conversation streams, pickers/navigation and labelled repeated form controls.
The census now annotates all 103 IDs, including the new host-local RuntimeTable.
No public SDK entrypoint, prop or interaction pattern was added. Mobile filter
takeover remains the separate #759 design-system workstream.

Patterns: `lists/data-table.stories.tsx` — `NarrowRoles`,
`SortedPagedDualRender`; `lists/list-rows.stories.tsx` — `CanonicalUsage`,
`InteractiveRows`, `DenseRows`; `pages/page.stories.tsx` — `ControlModes`.
Focused SDK `/patterns`, `/ui`, `/layout`, `/navigation` only for the collection
compositions. Reference-plugin README documents the table-first example.

Verification so far: 937 embedded Chat/Team/Assets/Brands tests pass; focused
Runtime/Health and new Asset locking/failure regressions pass. New real-SDK
Chat/Team/Assets/Brands fixtures and expanded Health fixtures pass at desktop
and 320px; reports and mobile images were reviewed. Asset screenshot review
caught an inherited absolute delete position, corrected with ListRowActions.
Bits Terminal tests pass (22, with 8 environment-gated skips), as do its build and
typecheck. Final full-suite and isolated browser evidence is recorded below
when complete. No screenshot baselines or suppressions were changed.

The user explicitly approved only the host initial-JS measurement of 234,532
bytes and Terminal measurement of 514,331 bytes. Growth allowances and every
other budget are unchanged. Removed one obsolete Runtime raw-control exception
and reduced existing style-migration allowances; none were broadened.

Approved earlier batch saved locally: Health `90e34a822`, Memory `75253a09b`,
Explore `76e399298`, Settings `f33f91d8e`, checkpoint notes `487cbb142`.
The earlier combined full run passed (`bakin-collections-batch-full.log`).
The final sweep's first full run exposed stale generated CSS after removal of
the old card helper; rebuilding the canonical artifact fixed all six packaging
tests. The local live host on port 3737 stopped answering during final browser
checks; it was not restarted or mutated. An isolated real-SDK fixture is used
for remaining collection behavior, not claimed as a live-host integration test.

Final isolated browser proof passes at 1440/320px for Runtime, Terminal and
reference bookmarks: shared header/selector sort, valid-query reconstruction,
invalid-query fallback, numeric/null-last ordering, full paths/SHA, named switch
and session confirmation, independent outbound links and rejected deletion
retaining records. No overflow or page errors. This fixture explicitly resolves
Bits imports to the actual SDK and shared React, not its unit-test shim.
RuntimeTable also has focused ordering/query-input regression tests (2 pass).
Independent final reviews of embedded/reference, Runtime/Health and Terminal
found no remaining blockers.

Evidence: `/private/tmp/bakin-final-isolated-browser.log`,
`/private/tmp/bakin-final-{runtime-capabilities,runtime-roster,terminal,reference}-{1440,320}.png`,
`/private/tmp/bakin-final-runtime-sort-tests.log`,
`/private/tmp/bakin-final-regressions.log`,
`/private/tmp/bakin-final-{chat,team,assets,brands,health,reference}-fixture.log`.
Package reports are `plugins/<id>/test-results/bakin-ui/index.html` and
`examples/reference-plugin/test-results/bakin-ui/index.html`.

Final product commits: Runtime `92096eed7`, Health registry/incidents
`4900329e8`, Assets `96f8ea3af`, Chat/Team/Branding `792d76ed0`, reference
example `5ffd7ff77`; companion Bits Terminal `fd90256`. No remote push, PR,
release, dependency change or compatibility-pin update is included.

Final verification: `bun run ui:conformance --full` **passed**. This includes
quick governance/typecheck, lint (zero errors, six existing warnings), 9,559
repository tests (18 existing skips), production builds, payload ratchet,
deterministic Storybook, 335 interaction tests, 280 unchanged canonical visual
comparisons, 93 Chromium/Firefox/WebKit checks, plugin conformance harness and
published docs/catalog. Log: `/private/tmp/bakin-final-fleet-full.log`.
Late Runtime sort tests and the final Asset action-slot/Health focus checks were
also rerun separately (34 tests), followed by a passing quick and lint run.
No screenshot baseline, tolerance, dependency or compatibility pin changed.
The list/table migration checkpoint is complete locally; PRs and coordinated
release remain separate authorized actions. Models and #759 remain separate.

## Memory, Settings and Extend — combined batch (2026-09-22)

User asked to handle these together and explicitly excluded Models, which is
being refactored on another branch. Extend is the existing Explore/add-ons
surface. No Models source was changed and no further Health surface was added.

| Surface | Implemented / retained | Protected behavior |
| --- | --- | --- |
| Memory Browse | DataTable column-derived separated narrow rows; persistent `memorySort` selector shared with headings, sorted before pagination | Search retains server relevance even with a stored browse sort; missing dates stay last; debug/tier/agent filters, record URL/reload and drawer remain intact |
| Memory Browse/Scrub navigation | Actual consumer-owned tab panels for the existing SegmentedControl | Both `aria-controls` targets exist; inactive content does not fetch; URL mode retained |
| Memory Scrub and tier summary | Keep specialized grouped cleanup/selection workflow and stat tiles | Exact cleanup dispatch/verification and indexed tier facts, not a generic index replacement |
| Settings category navigation / schema forms | Keep existing NavList master-detail and labelled fields | Category and highlighted-field URLs, save rejection and per-category values remain covered |
| Settings Integrations & Keys | Separated provider settings; Integration / Secret / Remove DataTable with narrow roles; responsive labelled add form | Write-only values; exact named-secret deletion; runtime/env overrides; all mutations locked together; rejected writes retain drafts; failed reads block editing and offer retry; missing optional images provider endpoint does not block unrelated secrets |
| Explore catalog | Replace text-first cards with sortable Name / Category / Status / Version / Runtime table and matching loading rows | `catalogSort` URL parity, existing tabs/search/categories/selection; independent Details/Install; compatibility, built-in/installed gating, consent and install flow unchanged |
| Explore installed capabilities / detail | Compact separated supporting management list; retain preview gallery and warnings in detail/consent | Existing named remove confirmation, source provenance, risk/permission and runtime conditions preserved |

Patterns: `storybook/public/lists/data-table.stories.tsx` — `NarrowRoles`,
`SortedPagedDualRender`, `ActivatableRows`; `lists/list-rows.stories.tsx` —
`CanonicalUsage`; `navigation/segmented-control.stories.tsx` (consumer-owned
panels); `navigation/nav-list.stories.tsx` — `SelectionAndKeyboard`;
`recipes/settings-dashboard-pages.stories.tsx` — `SettingsCategories`;
`forms/form-composition.stories.tsx` — `CanonicalUsage`. Focused SDK `/patterns`,
`/ui`, `/layout`, `/navigation` compositions only. No public API/story extension,
golden update or new performance approval is needed for this batch.

Focused verification: 54 tests, 177 assertions, zero failures across six files;
five existing Settings route/schema suites also passed during review (45 tests).
The added real-SDK Memory and Explore desktop/mobile fixtures pass; both HTML
reports and screenshots were inspected. Fixture review reproduced an existing
Memory tab-to-missing-panel defect and verified the consumer wiring fix. New
Settings tests reproduced failed-read/failed-draft behavior and optional-provider
absence before their fixes; deferred-write coverage confirms global mutation
locking and draft retention. Independent review found one prose-wrapping issue
in catalog cells; explicit wrapping fixed it before browser verification.

Intercepted real-app browser proof passes at 320/768/1024/1440px: Memory shared
sort/reload, relevance order, record drawer/reload and Browse/Scrub panels;
Explore sort/reload, incompatible install absence, keyboard Details and return
focus, independent Install dialog and no-results recovery; Settings table/narrow
rows, exact synthetic secret removal and failed-read retry. No real writes,
horizontal page overflow or page errors. Settings snapshots show the narrow
render even on a wide viewport when the navigation/activity panes constrain the
content container, as intended by DataTable's container-query contract.

Logs: `/private/tmp/bakin-collections-batch-{tests,lint,quick,performance,browser,full}.log`;
fixture logs `/private/tmp/bakin-{memory,explore}-batch-fixture.log`;
screenshots `/private/tmp/bakin-{memory,settings,explore}-batch-{width}.png`.
Both fixtures live under their plugin's `tests/ui.fixture.tsx` and run via
`bun run test:ui`. The batch retires one scoped raw-control exception and four
raw-scale migration allowances; no allowance was expanded. The one combined full
checkpoint is running; do not treat these local results as its completion.

## Health Agent pulse — table and details drawer (2026-09-22, local)

The user accepted the existing kit Drawer recommendation. Agent pulse now uses
DataTable `NarrowRoles` / `SortedPagedDualRender` and Drawer `CanonicalUsage`
(`storybook/public/lists/data-table.stories.tsx` and
`storybook/public/overlays/drawer.stories.tsx`), through the focused SDK
`/patterns`, `/ui`, `/layout`, `/navigation` and `/charts` contracts.
Columns compare Agent, Review, Usage & cost, Tracked work and Startup context;
Details is an independent trailing action. The default review sort preserves
canonical live/usage/name ties. Numeric sorts keep missing evidence last;
headings and the persistent narrow selector share `agent_sort` URL state.
`healthAgent` selects the drawer and survives reload. Latest-session breakdown,
partial/unknown costs, missing/stale evidence and the exact Team diagnostics
destination remain intact; diagnostic calculations and APIs are unchanged.

Verification: 44 focused tests (240 assertions), quick conformance, lint, plugin
build and both real-SDK Health fixtures pass. Independent review found no blocker.
Intercepted real-app checks pass at 320/768/1024/1440px for default and explicit
sorting, missing evidence, URL reload, keyboard Details, named drawer, partial
cost/cache evidence, diagnostics destination, Escape and focus restoration,
drawer reload, close-query cleanup, overflow and page errors. No API writes
occurred. Screenshot review also corrected mobile header count placement and
a clipped long-agent diagnostics label; its compact visible label retains an
agent-specific accessible name. Evidence:
`/private/tmp/bakin-health-agents-{tests,quick,lint,build,fixtures,browser,performance}.log`,
`/private/tmp/bakin-health-agents-{width}.png` and
`/private/tmp/bakin-health-agent-details-{width}.png`.
Fixtures/reports: `plugins/health/tests/agent-pulse.fixture*.ts*` and
`plugins/health/test-results/bakin-ui-agents/` (alongside the System report).

The user explicitly approved Health's exact 502,173-byte recorded measurement
(previously 500,046); only that record changes. The final mobile-label correction
measures 502,208, 35 bytes above the approved record and within the unchanged
2,048-byte allowance. No dependency, golden, public API or exception was added.
The removed arbitrary details-grid size further reduces the migration ledger
(combined Health arbitrary-size summary: 81 → 78). Full conformance is still
required at the combined Health checkpoint; this is not a merge-ready handoff.

## Health overhaul — System proof (2026-09-22, local)

System's installed-plugin and search-index inventories now compose DataTable
`NarrowRoles` / `SortedPagedDualRender` from
`storybook/public/lists/data-table.stories.tsx`: separated column-derived narrow
rows, a 2xl collapse breakpoint, and persistent URL-backed sorting shared with
the wide headings. Numeric fields sort numerically; missing evidence stays last
in either direction. Update is its own trailing action instead of part of Status.
Reindex also honors an explicitly unreachable engine, matching Reindex all.
Plugin findings reveal the visible desktop/mobile record, clearing an excluding
filter first; the programmatic focus target leaves normal tab order unchanged.
No diagnostic calculation, permission flow or repair endpoint was replaced.

Verification: 34 focused tests (201 assertions), quick conformance, lint, build
and the unchanged payload gate pass. Independent review found no blocking issue.
Intercepted real-app checks pass at 320/768/1024/1440px for URL sort persistence,
header/select parity, numeric/null order, filtered finding reveal and visible
focus, exact Update target and explicit permission approval, exact Reindex
target, ambiguous-confirmation and engine-offline locks, native disclosure
keyboard behavior, overflow and page errors. All API writes were intercepted.
Evidence: `/private/tmp/bakin-health-system-{focused,quick,lint,browser}.log`,
`/private/tmp/bakin-health-{build,performance}.log`, and
`/private/tmp/bakin-health-system-{width}.png`.

New real-SDK fixture: `plugins/health/tests/ui.fixture.tsx`, with long identities,
failed activation, unavailable evidence, migration errors and trailing actions.
Desktop/mobile images and HTML report were inspected under
`plugins/health/test-results/bakin-ui/`. The fixture now **passes** with no
findings after the explicitly approved native-disclosure harness correction.
Both interactive collectors recognize `details > summary:first-of-type` and
exclude contents hidden by closed disclosures. Two new browser regressions
failed before the fix: nested open/closed disclosures stopped tab traversal,
and a summary with no focus ring was not inspected. Both now pass, alongside
the two existing focus tests. The shared clean fixture includes the real SDK
DisclosurePanel (`storybook/public/layout/disclosure-panel.stories.tsx` —
`CanonicalUsage`, `/layout`); `ui:test:conformance` passes and deliberately
broken fixtures still trigger their expected rules. Logs:
`/private/tmp/bakin-summary-harness-{red,green,conformance,quick,lint}.log`.
Independent focused review found no blocker. No component API/style change
or public story update is needed for this test-harness correction.
No accessibility suppression, golden update, new public API or budget increase
was made. Two removed arbitrary-size usages reduced matching ledger counts;
all other allowances remain unchanged. Full conformance is not yet run for this
Health slice; this is local review evidence, not a merge-ready checkpoint.

Health collection disposition (Agent pulse subsequently implemented above):

| Surface | Recommended next treatment | Preserve |
| --- | --- | --- |
| Agent pulse (`agent-pulse.tsx`) | Implemented locally: sortable DataTable plus URL-selected kit Drawer | Live vs selected-period evidence, unknown/partial values, independent detail action; see current evidence above |
| Complete check registry (`system-inventory.tsx`) | DataTable for check/group/status/owner/completed evidence | Canonical status precedence, unavailable/stale evidence, finding-to-check focus and descriptions |
| Overview incidents (`overview-alerts.tsx`) | Review current incident cards as an actionable findings surface, not a preview-card default | Consequence, repair/delegation, acknowledgment, snooze, sensitivity/provenance and expandable resolution detail |
| System watch list | Keep compact separated supporting rows | Capped summary, expansion, exact evidence target |
| Activity event stream | Keep chronological Timeline | Status, source, reason and technical details |
| Charts, readiness stages and metrics | Keep specialized charts/stat compositions | Exact chart data, units, unknown evidence and consistent series mapping |

## Schedule and Tasks table parity — 2026-09-21 local review

Projects remains as visually approved; this slice does not reopen it.

### Task action-menu follow-up

The user approved Schedule and reaffirmed Projects, and requested Edit,
Duplicate and Delete directly on Task log rows. Current tasks now use one
shared `TaskActionsMenu` in the detail drawer and both DataTable renders.
The existing edit drawer, duplication payload/refresh and named delete
confirmation are reused. Audit-only historical entries remain read-only;
they may no longer have a task record to mutate.

The matching kit contracts are DataTable `ActivatableRows` and `NarrowRoles`
in `storybook/public/lists/data-table.stories.tsx`. Focused tests exercise all
three actions in both renders without activating the row. Intercepted live-app
checks at 320/768/1024/1440px verify keyboard menu access, the edit form and URL
target, duplicate payload and refresh, delete cancellation and exact confirmed
target, overflow and page errors. No real API writes occurred. Evidence:
`/private/tmp/bakin-task-actions-browser.log` and
`/private/tmp/bakin-task-actions-{width}.png`. Quick conformance passes;
independent review found no blockers. No story/API extension is needed.

The accumulated Tasks client measures 199,344 bytes versus the recorded
196,889 (+2,455), exceeding the unchanged 2,048-byte growth allowance by 407.
Sharing the menu reduced the increase without dropping behavior or adding a
dependency. The user explicitly approved exactly 199,344 bytes. Only Tasks'
recorded measurement is updated; all other measurements and the shared growth
allowance remain unchanged. This follow-up still requires full conformance
before a merge-ready checkpoint (subsequently passed below).

### Approved checkpoint — full verification

Full conformance passed for the final Schedule/Tasks delta, including the shared
task action menu and exactly approved Tasks measurement. Log:
`/private/tmp/bakin-schedule-tasks-approved-full.log`. Results: quick contracts,
typecheck/lint/builds, 9,555 repository tests (16 existing skips), 335 Storybook
interactions, 280 unchanged visual comparisons, 93 cross-browser checks,
plugin conformance and docs publication (448 stories). Both page fixtures and
the four-width intercepted action/sort checks also pass; independent review
found no blockers. No canonical screenshots or other limits were updated.

Generated reference-doc churn from the full run is preserved separately in
`preserve generated docs from Schedule Tasks conformance`; the pre-existing
embedded-assets manifest change stays outside the commit. This is a verified
local checkpoint, not a push, release or completion of the remaining fleet audit.

### Initial table-parity slice evidence (before the action-menu follow-up)

- Pattern: `storybook/public/lists/data-table.stories.tsx` — `NarrowRoles`
  and `SortedPagedDualRender`. Existing `/patterns`, `/ui`, `/layout` and
  `/navigation` contracts only; no public API, dependency or design exception.
- Schedule now uses the same column model and action menu at both widths,
  with separated narrow rows. A persistent Sort selector shares URL state with
  the headings, sorts before pagination and resets the current page. Default
  order retains search relevance. Job identity, source, missing-tool warnings,
  timezone, next run, status and existing action permissions remain intact.
- Task log has persistent URL-backed sorting, wrapping titles, labelled narrow
  dates and explicit dashes for missing dates. Date sorting compares instants
  and leaves unknown values last in either direction. Search preserves ranked
  current matches, excludes unrelated audit history and hides manual sorting.
- Browser checks also caught Schedule's duplicate compact switcher referencing
  nonexistent panels and its crowded header splitting the title with the activity
  rail open. Removed only the invalid duplicate linkage and delayed the existing
  header control group's inline layout to its wider container breakpoint.
- Focused regression tests, quick conformance/typecheck, plugin build and the
  unchanged payload ratchet pass. Both real-SDK fixtures pass with no findings;
  run `bun run test:ui` in `plugins/schedule` or `plugins/tasks`. Reports and
  desktop/mobile screenshots are in each plugin's `test-results/bakin-ui/`.
- Intercepted Imitation Crab checks pass at 320/768/1024/1440px: sort persists
  after reload, Schedule sorts the whole collection and resets pagination,
  the Delete menu opens the named confirmation without opening the row,
  cancellation preserves the collection, and no document overflow/page errors.
  Log: `/private/tmp/bakin-schedule-tasks-browser.log`. All API writes were
  intercepted; no real jobs or tasks were changed. Independent review is clear.
- This is a local review slice, not a merge-ready checkpoint. Full conformance
  remains required before saving the next migration checkpoint. No canonical
  screenshot baselines or performance limits were updated. Calendar, Kanban,
  task detail interactions and the rest of the fleet remain outside this slice.

## Brainstorm table-first correction — 2026-09-21 local review

The user's table-first ruling supersedes the earlier row-first recommendations
for record indexes below. DataTable is the default; cards require meaningful
previews, while separated rows remain appropriate for compact supporting lists.
This iteration changes only Brainstorm's index, not other indexes or kit prop defaults.

- Pattern: `storybook/public/lists/data-table.stories.tsx` — `NarrowRoles`
  and `SortedPagedDualRender`; existing focused SDK entrypoints only.
- Six sortable columns: Brainstorm, Agent, Status, Proposals, Accepted, Updated.
  Newest-first default; URL-backed sort selector remains available on narrow screens.
- Search, agent filtering, working/unread markers, session opening, and retry
  behavior are preserved. Existing conversation/detail actions remain unchanged.
- Verification: 16 focused tests / 73 assertions; Bits suite 596 passed,
  8 skipped / 3,591 assertions; typecheck, lint, build, and quick conformance passed.
  Four real-SDK fixtures passed. Browser checks passed at 320/768/1024/1440px,
  including persisted sorting, filtering, retry, keyboard opening, and overflow.
- User explicitly approved Messaging's measured payload 709,343 → 713,362 bytes
  (+4,019) and the two existing desktop/mobile `collection-same-records.png`
  baselines for table-first captions. Updates are limited to that byte entry
  and those two goldens; all other limits and baselines remain unchanged.
- Applied both approvals: performance ratchet passes and the two canonical
  caption baselines regenerated successfully. User visually approved Messaging
  ("messaging looks good").
- Checkpoint review found and corrected conflicting table-selection guidance
  in the ListRows public story. Its two `lists-list-rows.png` caption baselines
  are separate from the comparison goldens; the user subsequently explicitly
  approved exactly those two additional ListRows caption baselines.
  Both were regenerated canonically and then passed with updates disabled.
- A Bits checkpoint rerun exposed a Projects test-only synchronization timeout
  when deleting all three fixtures. Awaiting each asynchronous delete inside
  React `act` preserves every assertion and the original timeout; the focused
  17-test file passes and the formerly failing case drops from ~5s to 19ms.
  Product behavior is unchanged.
- Independent review found no remaining blocking code issue after those fixes.
  Bits checkpoint rerun: 596 passed, 8 skipped; typecheck and lint passed.
- Full conformance passed for this delta, logged at
  `/private/tmp/bakin-brainstorm-table-full.log`: repository tests (9,550 passed,
  16 skipped), builds, payload, deterministic Storybook, 335 Storybook interaction
  tests, 280 visuals, 93 cross-browser checks, plugin conformance and docs
  publication (448 stories). Only the four explicitly approved caption goldens
  changed; all others remained unchanged.
- Local Bits commits: `64cd4c8` (test synchronization) and `4f0a01f` (Brainstorm
  table). Generated docs-only churn was preserved separately in the named
  `preserve generated docs from Brainstorm table conformance` stash. The
  pre-existing embedded-assets change is excluded from this checkpoint.
  Nothing has been pushed, released or deployed.

## Remaining Messaging collections — 2026-09-21 local batch

- Existing patterns: `storybook/public/recipes/collection-patterns.stories.tsx`
  (`SameRecords`, `RowBehaviors`), `storybook/public/lists/data-table.stories.tsx`
  (`NarrowRoles`, `SortedPagedDualRender`), and the established Plans Sort selector
  composition. Focused SDK boundaries: `/ui`, `/patterns`, `/layout`, `/navigation`.
  No public system extension or baseline update.
- Brainstorm sessions and plan channel/content lists now use separated rows,
  wrapping titles and soft count/metadata chips. Existing independent actions,
  session navigation and specialized conversations remain. Calendar list mode
  uses labelled narrow roles and shared URL-backed heading/selector sort state;
  month/week/day ordering remains chronological. Calendar and Brainstorm load
  failures now show Retry rather than empty success.
- Added deterministic real-SDK Calendar, Brainstorm and workspace fixtures to
  the existing Plans fixture command. All four pass with no package blockers
  or conformance findings. HTML and screenshot evidence:
  `/private/tmp/bakin-plans-ui.Ag2Vaz/plugin/test-results/bakin-ui{,-calendar,-brainstorm,-workspace}`;
  final log: `/private/tmp/bakin-messaging-collections-final-fixture.log`.
- Browser review found an existing inner-main landmark and tab panels without
  visible focus; the consumer now uses a div and existing Tabs focus tokens.
  Height-contained 320px host review additionally caught the content column
  shrinking below its children and the Details rail intercepting channel actions.
  Narrow `flex-none`, returning to desktop `flex-1`, fixes that overlap without
  changing the desktop resizer/scroll model. Regression evidence:
  `/private/tmp/bakin-messaging-workspace-overlap-red.log`; final focused test passes.
- 592 Bits tests pass, 8 existing skips, 3,559 assertions; typecheck, lint and
  build pass. Final unit log: `/private/tmp/bakin-messaging-final-bits-tests.log`.
  Intercepted local-app checks at 320/768/1024/1440px verify sort after
  reload, filter/no-results recovery, load retries, keyboard session navigation,
  channel confirmation/cancel, no document overflow and no page errors. Log:
  `/private/tmp/bakin-messaging-collection-browser-fixed.log`; screenshots:
  `/private/tmp/bakin-messaging-{calendar,brainstorm,workspace}-{width}.png`.
  API writes were intercepted; no real plans/channels/content were deleted.
- User explicitly approved Messaging's measured 704,390 → 709,343-byte baseline
  (4,953-byte delta). Sorting and retry states account for the increase; other
  limits and the shared 2,048-byte allowance remain unchanged. Subsequent focus
  and layout corrections fit within that unchanged allowance. Payload check:
  `/private/tmp/bakin-messaging-batch-performance-final.log`.
- Full shared checkpoint passed in
  `/private/tmp/bakin-messaging-collections-full-permitted.log`: quick contracts,
  lint/typecheck/builds, 9,550 shared tests (16 skips), approved payload ratchet,
  335 Storybook interactions, 280 unchanged visuals, 93 cross-browser checks,
  plugin conformance and docs publication (448 stories). The earlier
  sandbox-limited attempt was stopped because local browser ports/build output
  need test permissions; it is not passing evidence. No release, push or
  dependency change. Unrelated generated docs are preserved in a scoped stash;
  the pre-existing embedded-assets manifest is excluded from the commit.
- Independent five-axis review found no required changes. At intermediate wide
  widths Calendar retains its existing bounded horizontal table scroll; moving
  the narrow-render breakpoint earlier is optional follow-up, not a new
  regression. Both retry-test suites reinstall fetch in `beforeEach`, preventing
  a failed assertion from carrying the temporary error response into later cases.

## Scope and evidence status

### Next simple-row slice: source recheck (2026-09-21)

These are pending recommendations, not completed migrations:

| Consumer | Remaining change | Preserve / verify |
| --- | --- | --- |
| Chat `launcher.tsx` recent chats | Explicit separated rows and wrapping titles | Six-item limit, unread state, open action; agent cards and compact rail stay specialized |
| Team `team-manager.tsx`, `lesson-toggle-list.tsx` | Separated rows and long-label wrapping | Global team identity, exact delete target, independently labelled lesson switch, pending lock and rollback, deep-link highlight |
| Models `aliases-tab.tsx` | Separated rows; kit density instead of local px/py | Alias → provider/model mapping, missing-catalog fallback, pagination and named delete confirmation; not the repeated routing/settings forms |
| Assets `task-assets.tsx` | Compact separated rows and persistent independent unlink action | Thumbnails/version facts, read-only behavior, unlink-not-delete scope; current silent load/unlink errors need honest feedback in that slice |
| Branding `brand-builder.tsx` attached materials | Compact separated rows; retire outdated bordered-resource rationale | File names/sizes, remove action, three-file cap and input constraints; no gallery changes |
| Branding `brand-detail.tsx` document/lesson lists | Separated rows with mobile content/actions wrapping | Edit route, context/active switches, delete confirmation, staged save semantics; the current shrink-0 filename/action groups need narrow testing |

Do not treat removing an outline as the entire migration: an available menu,
honest load state and readable narrow identity are part of each acceptance test.

### Table parity source findings (2026-09-21; Schedule/Tasks addressed above)

Read-only review against DataTable `NarrowRoles`/`SortedPagedDualRender` confirms:

- **Schedule first:** `plugins/schedule/components/job-list.tsx` supplies a
  private narrow row without the desktop `JobActionsMenu`, and sortable headings
  disappear with no persistent selector in `schedule-page.tsx`. Actions remain
  available through `job-drawer.tsx` (pause/resume, run, delete, edit, duplicate,
  adopt, restore, skip), so this is direct-action parity, not lost capability.
  Add persistent sorting and reuse the same menu on narrow rows.
- **Tasks next:** `plugins/tasks/components/task-log-table.tsx` already uses
  labelled narrow roles and row activation. Its headings are the only sort
  controls and disappear when narrow. Preserve those roles; add a shared sort
  control rather than another row implementation.
- **Health afterward:** `system-inventory.tsx` and `system-search-section.tsx`
  retain wide-only, 760px-minimum tables inside bounded scroll. Update/Reindex
  actions can be offscreen. Their `renderRow={() => null}` is dormant because
  no collapse breakpoint is set. Introduce explicit supported narrow roles and
  preserve action scope and sorting. ChartDataTable remains a separate exact-data
  chart view, not automatically part of this migration.

Schedule and Task log now have local implementation/browser evidence above.
Health's subsequent local System proof is recorded above; other Health
collections remain follow-ups, not completed migrations.

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
| Workflows `plugins/workflows/components/{workflows-page,workflow-table}.tsx` | User-approved unified DataTable after reviewing rows and grouped tables (originally a thirds card grid) | Source column/filter replaces sections; sorting and pagination apply to the complete results. Preserves text, assignments and step/feature summaries. Visual checkpoint pending. |
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

## Workflows proof — local review, 2026-09-20

- Branch: `refactor/workflow-list-806`, based on merged foundation #879.
- Composition: `Recipes/Collection patterns — SameRecords / RowBehaviors`;
  `ListRows variant="separated"`, neutral `ListRowGroup` section headings at
  level 2, wrapping identity/description/facts, independent step-info control.
  Step counts and section counts are soft metadata; disabled/stale-skill chips
  remain solid states. Navigation uses the existing focused `/navigation` API.
- Replaced the private WorkflowCard with WorkflowRow (no remaining runtime
  consumers of the card). Search relevance, features, assignments, opening
  disabled definitions, custom/managed grouping and pagination are preserved.
  Canvas/detail/editor surfaces and mobile filter/sort redesign are untouched.
- Added a long-content `editorial-launch.yaml` to Imitation Crab fixtures and
  added that one definition to the already-running local mock using its API.
  No full reseed, existing data replacement, production data writes, or workflow
  dispatch. Local review: `http://localhost:3737/workflows`.
- Live Playwright proof passed at 1440/768/320px: group counts, managed paging,
  show-all and URL state, feature filters, no-results recovery, keyboard opening,
  independent step tooltips, and no document overflow/page errors. Captures:
  `/private/tmp/bakin-workflows-{1440,768,320}.png`; execution log:
  `/private/tmp/bakin-workflows-local.log`. A separate 320px/200%-text check
  confirmed the long title, description, and controls remain bounded; capture:
  `/private/tmp/bakin-workflows-320-text200.png`.
- 592 focused workflow tests passed. Quick conformance passed using the existing
  pinned Bits checkout; lint passed with five existing warnings. Four raw-scale
  allowances were retired from the two migrated components (no increased debt).
  Rebuilt the canonical SDK stylesheet to remove the now-unused card spacing
  utilities; no token definitions changed.
- Full repository suite: 9,501 passed, 15 existing skips, zero failures
  (`/private/tmp/bakin-workflows-all-tests-unsandboxed.log`). The initial
  sandboxed run could not bind isolated fixture servers and found the stale
  pre-rebuild stylesheet; the fresh permitted run after rebuilding passed.
- New Workflows `bun run test:ui` fixture exercises the real collection page
  with long content, a disabled managed definition, and a long team assignment.
  Report: `plugins/workflows/test-results/bakin-ui/index.html`. The fixture
  initially failed only its two desktop/mobile search keyboard-focus checks.
  Diagnosis: the shared InputGroup sets focus outline width/color but retains
  `outline-style: none`; the harness also inspects only the focused control,
  not the group's intended ring. The user explicitly approved the focused kit
  repair. InputGroup now sets a solid focus outline; the checker recognizes
  only the canonical editable control's changing group outline, not arbitrary
  ancestor decoration or an addon button's surrounding group. No suppression,
  exception, public API/token change, or baseline update was added.
  The new input/textarea Storybook assertions failed before the repair and now
  pass (seven InputGroup/SearchInput stories). Checker regression cases cover
  real group/control rings plus missing, static, transparent, unrelated, and
  addon-only decoration (two browser tests pass). The Workflows fixture now
  passes both viewports with no findings, and live Imitation Crab keyboard
  checks confirm the ring appears and clears at 1440/320px. Focus captures:
  `/private/tmp/bakin-workflow-focus-{1440,320}.png`.
- Independent review of the focused kit/checker repair caught and resolved a
  transparent CSS Color 4 outline bypass. Its new failing-first test now passes;
  the reviewer reran the browser tests (two tests, ten assertions) and reported
  no remaining findings. Public author guidance documents group-owned focus.
- Post-fix full conformance has passed quick gates, lint, the repository suite
  (9,501 pass, 16 skips, zero failures), vendor/plugin/host builds, browser payload
  ratchet, and deterministic public Storybook build. The additional plain-suite
  skip is the new browser-only regression, explicitly run and passing above.
  Story, canonical visual/cross-browser, plugin teeth, and docs stages are still
  in progress in `/private/tmp/bakin-workflows-full-conformance.log`.
- Existing definition-fetch errors are still swallowed by the page and display
  the initial-empty state; this predates the row migration and remains separate
  state-handling debt, not evidence of error-state coverage in this proof.
- User visual approval, code review, and full conformance remain required before
  this migration is merge-ready. Full conformance is running after the kit fix.

### User-requested table comparison trial

After the rows proof, the user requested a local DataTable alternative before
choosing the presentation. The current Workflows page now uses `WorkflowTable`:
Workflow (name, description, status), Steps (soft count and preview), Features,
and Assignment. Custom/Managed headings, URL filters, relevance order, managed
pagination, provenance and disabled-definition inspection remain intact. Loading
uses a matching table skeleton. Columns do not introduce slice-only sorting.

- Pattern: `storybook/public/lists/data-table.stories.tsx` — `CanonicalUsage`
  and `ActivatableRows`; `recipes/collection-patterns.stories.tsx` — `SameRecords`.
- Contract: SDK `/patterns`, `/ui`, `/layout`, `/navigation`; no system extension,
  new public props, exception, or baseline updates. This trial deliberately keeps
  the table at narrow widths with an explicit minimum width and local scrolling.
- First test failed for missing table semantics before implementation; final
  focused run: 21 tests, 113 assertions, zero failures. Quick conformance and
  focused lint pass. Workflows plugin browser fixture/report has no blockers or
  conformance findings.
- Live Imitation Crab checks pass at 1440, 1024, 768 and 320px: row keyboard open,
  separate step preview, pagination/show-all, feature filters, search recovery,
  and no document overflow or page errors. Captures:
  `/private/tmp/bakin-workflows-table-{1440,1024,768,320}.png`.
- Logs: `/private/tmp/bakin-workflows-table-{tests,quick,fixture,browser,lint}.log`.
- The pre-existing full-conformance run began before this trial; it is not full
  verification of the table change. Final presentation choice, review and full
  verification remain pending. No commit or PR was made for the trial.

### Section-header refinement and filter-treatment audit

The user requested pink Workflows section rails and more separation owned by
the kit. Workflows now opts into existing `headerTone="accent"`; the neutral
default remains. Adjacent section-mode `ListRowGroup` siblings get one extra
12px item-spacing step, producing a 24px gap inside `Stack gap="item"`. The first
section and compact plain groups are unchanged. `SectionGroups` browser coverage
failed before the spacing fix; all 11 ListRows/collection story tests and 27
focused unit tests now pass, as do quick conformance and the Workflows fixture.
Live 1440/320px checks confirm the margin, total gap and accent tone after rebuilding
the vendor bundles. Captures: `/private/tmp/bakin-workflows-pink-sections-{1440,320}.png`.
No baseline was updated; the earlier full run predates this shared-kit change.

The user's follow-up filter consistency audit found the leading icon belongs to
`AgentFilter`, not `PageControls`. Tasks/Schedule inherit it; Memory places it
after Tier; Assets supplies a separate icon; Workflows/Models/Explore and Bits
Projects omit it. Bits Messaging inherits it through AgentFilter. A shared
filter-mode contract is proposed, not yet implemented; generic command/view
controls must remain distinct and agent filters must not duplicate the icon.

### Approved shared filter mode

The user approved the shared-kit extension and core/Bits rollout. Public contract:
`PageControls variant="filters"` owns one decorative indicator before its wrapping
controls set. A private React context suppresses nested AgentFilter indicators
(including through wrappers and nested PageControls); standalone `showIcon`
behavior and default command/search/view bars remain unchanged. Assets and Explore
select the filter variant only when actual facets are present.

- Story: `storybook/public/pages/page.stories.tsx` — `ControlModes`; existing
  `AgentFiltering` verifies standalone keyboard behavior. List/detail recipes and
  public author guidance now use the filter mode. Public API inventory reviewed:
  no new export or entrypoint; the additive prop is part of existing PageControlsProps.
- Core: Workflows, Tasks, Schedule, Memory, Assets, Models and Explore.
- Bits branch `refactor/shared-filter-controls`: Projects plus Messaging Plans,
  Calendar and Brainstorm; matching ambient prop, test stub and author/release-order
  guidance updated. Host support must ship first; no version bump/tag/release made.
- Two new unit tests failed before implementation. Focused core run: 623 pass,
  zero failures. Storybook Page/AgentSelect: 11 pass. Quick conformance and the
  Workflows plugin browser fixture pass. Other changed core/Bits packages remain
  explicitly migration-pending in fixture enrollment; this change does not claim
  to graduate their entire UI surface.
- All seven core filter bars and all four Bits filter bars pass live-browser checks
  at 1440/320px: one icon, no duplicate agent icons, no document overflow/page errors.
  Bits checks intercepted only their candidate client bundles inside the isolated
  test browser against Imitation Crab; installed plugins/server data were untouched.
- Bits: 561 tests pass, 8 existing browser skips, zero failures; typecheck, lint,
  build and updated Projects regression pass. No dependency/lockfile changes.
- Independent multi-model review: no actionable findings; reviewer independently
  ran 19 PageControls tests and 6 Bits Projects tests successfully.
- Evidence: `/private/tmp/bakin-filter-{core-tests,stories,quick,browser}.log`,
  `/private/tmp/bakin-bits-filter-{tests,types,lint,build,browser}.log`, plus
  `/private/tmp/bakin-filter-workflows-fixture.log`. Desktop/mobile region captures
  are `/private/tmp/bakin-filter-*.png` and `/private/tmp/bakin-bits-filter-*.png`.
- Fresh full conformance is running in `/private/tmp/bakin-filter-full-conformance.log`.
  The earlier full suite passed but predates the table/section/filter refinements.
  No baseline updates, commits or PRs were made; visual review remains required.

### Unified Workflows table and sorting

The user approved replacing Custom/Managed sections with one table: Workflow,
Source, Steps, Features, Assignment. Source uses neutral soft xs classifications;
managed provenance (plugin or agent package) has a separate keyboard-accessible
lock tooltip in that cell. Custom overrides remain Custom. The shared section
header improvements remain in the kit, but this page no longer needs headings.

- Existing patterns: `lists/data-table.stories.tsx` — `SortedPagedDualRender`
  (controlled sorting before pagination), `primitives/select.stories.tsx` —
  `CanonicalUsage`, and `pages/page.stories.tsx` — `ControlModes`.
- Focused SDK `/patterns`, `/ui`, `/layout`, `/navigation`, `/hooks`; no public
  API changes, new system contract, deviations, or baseline updates.
- One All sources/Custom/Managed selector combines with search and Features.
  One paginator covers all results; one no-results state clears all filters.
  `source`, `sort`, `dir`, and `page` are URL-backed. Unknown source/sort values
  fall back safely; loading does not prematurely clamp a deep-linked page.
- No explicit sort preserves the incoming/search relevance order. Header clicks
  toggle direction and reset the page, preserving Show all. Names sort naturally,
  steps numerically, features by visible approval count then nested count, and
  assignments by displayed agent names/team IDs/Task agent. Empty feature and
  assignment cells stay last in either direction; ties retain incoming order.
- Failure-first regression coverage; all 600 Workflows tests pass (1839 assertions),
  focused lint and quick conformance pass. The Workflows browser fixture reports
  no package blockers or conformance findings.
- Independent multi-model review found no actionable issues and independently
  reran all 16 page tests (80 assertions) successfully.
- Live Imitation Crab checks pass at 1440/768/320px: all sortable headings,
  pagination and Show all, URL reload/back, combined source/features/search,
  single empty-state recovery, provenance tooltip, row keyboard navigation,
  bounded table scrolling, and no document overflow/page errors.
  Captures: `/private/tmp/bakin-workflows-unified-{1440,768,320}.png`;
  logs: `/private/tmp/bakin-workflows-unified-{all-tests,quick,fixture,browser,lint}.log`.
- The earlier filter full run stopped on `Row Behaviors` menu focus-return
  coverage (334 story tests passed, one failed). The unchanged collection story
  passes on focused rerun (all 3 tests); the intermittent full-run failure remains
  a merge-checkpoint concern, not a passing full-suite claim. No full run yet
  covers this latest unified-table change. Changes remain uncommitted for review.

### Approved baseline refresh and 20-row Workflows default

The user explicitly approved updating the screenshots after the review identified
the section-spacing and filter-bar differences. Regenerated only
`collection-row-behaviors.png` and `foundation-list-page.png` in both
`chromium-desktop` and `chromium-mobile`, using the pinned Linux/x64 Playwright
1.60.0 Noble container. Inspected the desktop/mobile differences; no unrelated
baselines or tolerances changed. All four selected visual tests pass again with
snapshot updates disabled. Logs: `/private/tmp/bakin-approved-baselines-{update,verify}.log`.

The user also requested 20 Workflows rows per page. Changed the page-owned size
from 9 to 20; the shared Pagination default and other pages are untouched.
The regression first failed at 9 vs 20, then passed with a 21-record collection,
sorting before pagination, page reset and Show all. All 26 focused table/page/sort
tests pass, as do quick conformance and the Workflows browser fixture.
Live desktop/mobile verification shows all 16 mock definitions together; an
isolated browser-only 21-record response verifies 20+1 paging, reload, sort reset,
and Show all without modifying mock-server data. Evidence:
`/private/tmp/bakin-workflows-page20-{red,tests,quick,fixture,browser}.log` and
`/private/tmp/bakin-workflows-page20-{1440,320}.png`.

The broad visual comparison started before the refresh finished with 275 passes
and five failures (`/private/tmp/bakin-review-visual.log`). Four were the approved
targets, all compared before regeneration began and subsequently passing the
separate focused verification. The fifth is a 49-pixel difference in the
unrelated mobile `lists-calendar-grid.png` baseline; it is untouched and needs
triage before the merge checkpoint. This is not a new full-conformance pass or a
merge-ready claim. The user requested local commits after approving the result.

### Final verification and PR checkpoint — 2026-09-20

- The unrelated mobile calendar discrepancy did not reproduce in three isolated
  canonical repeats or the subsequent full visual run. Its baseline and the
  screenshot tolerance remain unchanged. The earlier row-menu focus-return
  failure also passed in the fresh full story run.
- The payload gate initially measured Workflows at 615,320 bytes against the
  613,240-byte baseline plus its existing 2,048-byte allowance. Consolidating
  duplicated step-badge markup reduced it to 615,249 bytes (71 bytes smaller),
  with no budget increase or UI behavior change. An empty-step characterization
  test passes before and after; the final 27 page/table/sort tests pass, and
  independent review found no actionable issues.
- `bun run ui:conformance --full` passed with the compatibility-pinned Bits
  source archive: quick governance/architecture/typecheck, lint, 9,512 repository
  tests (16 skips), production builds, payload ratchet, deterministic Storybook,
  335 story interaction tests, 280 canonical desktop/mobile visual comparisons,
  93 Chromium/Firefox/WebKit behavior checks, plugin conformance, and docs/catalog.
  Log: `/private/tmp/bakin-workflows-final-conformance-3.log`.
- The Workflows-specific `bun run test:ui` fixture also passed after the payload
  cleanup; its HTML report has no package blockers or conformance findings.
  Log: `/private/tmp/bakin-workflow-payload-fixture.log`.
- Bits verification passed again: 561 tests, 8 existing browser-only skips,
  typecheck, lint and build. Logs: `/private/tmp/bakin-bits-final-*.log`.
- Bakin PR: https://github.com/markhayden/bakin/pull/885. Companion Bits PR:
  https://github.com/markhayden/bakin-bits-official/pull/106, held in draft until
  the host/SDK support is available. No version, tag, release or dependency bump.
  Bakin's draft CI ran completeness despite skipping test shards, so its initial
  missing-report failure is not a code-test failure; ready-for-review triggers
  the normal CI run. No CI workflow changes are included.
- Unrelated generated documentation churn from verification was discarded;
  the pre-existing embedded-assets manifest edit remains untouched and excluded.
  Projects remains a separate follow-up after shipment, not part of these PRs.

### PR #885 visual-test synchronization follow-up

CI run `35546549323` passed every lane except the desktop RowBehaviors visual
test (279 of 280 visuals passed). The trace shows the menu still open after
Escape and the story's focus-return assertion aborting before Pin. The visual
test also resized the viewport and doubled text while the play was still in
flight; network idle and a visible heading were not interaction readiness.

The story now waits for menu focus before Escape, then menu removal and trigger
focus. It publishes the existing `data-story-ready` convention only after the
entire play succeeds; the visual test waits for that before resizing and captures
console errors as well as page errors. No product UI, timeout, retry, screenshot
tolerance or baseline changed. The readiness regression failed against the old
story; all 18 canonical collection visual repeats (three runs, desktop/mobile,
CI parallelism, retries disabled), three story interactions, quick conformance
and focused lint passed. Evidence: `/private/tmp/bakin-885-{red,green,stories,quick,lint}.log`.
