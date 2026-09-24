# Navigation indicator consistency — implementation plan

Status: approved by “build plan”; implementation and verification complete.
Two intermittent Firefox checks passed on unchanged isolated rerun (details below). Implements
[the specification](navigation-indicator-consistency.md).

## Outcome

Main navigation uses small count-free dots with consistent meaning. Health
signals actionable alerts, conversations signal unread replies, and Tasks owns
workflow approvals. Live updates and recovery work while destination pages are
unmounted. Failed reads retain last-known state.

## Architecture decisions

- Keep domain stores authoritative. Navigation derives presence/tone, never a
  parallel queue of notifications that can drift from the destination.
- Keep one shell SSE connection. Reconciliation is a lifecycle event distinct
  from a domain event, so recovering a snapshot does not replay fanfare.
- Use existing `usePluginEvent` for that lifecycle signal; no new SDK entrypoint.
  Document the event and forward file changes on the same bus for the official
  Messaging consumer that currently opens a separate connection.
- Every snapshot owner handles supersession, in-flight invalidation, failure
  retention, and teardown. Use the existing Health resource lifecycle where it
  applies; extract shared mechanics only when actual consumers justify them.
- Health's server owns check scheduling and time-dependent report publication.
  The page and nav read the same canonical report. Retain manual Run checks as an
  explicit override, without making navigation the implicit refresh trigger.
- Keep pending gate toasts and deep links, but remove their Workflows nav write.
  Tasks' review/blocked projection is already the correct source; prove its gate
  transitions before changing provider ownership.
- Preserve useful counts in domain summaries. Remove nav count rendering,
  count-based accessible copy, and numeric rollup aggregation. Static and runtime
  zero-count behavior must remain consistent.
- Reuse public StatusMarker, Kanban, and ReviewAction patterns named in the spec.
  No new token, layout, public component, or deliberate UI exception is planned.

## Task sequence and acceptance

Each task targets roughly 3–5 files. Split larger producer-wiring or documentation
work by owner instead of combining unrelated files into one task. Dependencies
below describe execution order; this plan does not require parallel agents.

### 1. Establish failing reproductions and a producer map

Files: existing Health summary/resource tests, nav logic tests, a focused SSE
reconciliation test, and an evidence section in this plan.

- Reproduce stale Health state while its page is unmounted, an event during an
  in-flight fetch, and recovery after missing events. Preserve exact observed
  evidence; the user's 56-to-3 example is not yet reproduced.
- Map each indicator to its authoritative read, mutation events, suppression
  rules, and destination. Map Health checks to actual owner mutation points and
  existing maxAgeMs/deadlines. Distinguish checks with events from periodic-only
  external probes.
- Verify pending gate reach/approve/reject/deletion paths produce taskboard
  changes and visible review state. Treat mismatches as part of this fix.

Verify: focused tests fail for the intended behavior, without production data.
Record baseline checks and local mock observations. Do not commit failing tests
alone; include them with the corresponding passing implementation slice.

### 2. Add shared connection/resume reconciliation

Files: `src/hooks/use-sse.ts`, `src/hooks/use-plugin-event.ts`, focused SSE tests,
and `docs/src/content/docs/extending/plugins/realtime.md`.

- Publish one documented client lifecycle signal on successful connection and
  visible-tab/page resume; coalesce overlapping triggers and clean up listeners.
- Keep initial snapshot reads in providers so late-mounted plugins cannot miss
  recovery. Reconcile after every connection, including a restarted server whose
  event replay buffer cannot contain the old connection's gap.
- Forward relevant file change events to existing plugin subscriptions, without
  opening another EventSource or replaying notifications.

Verify: deterministic EventSource tests for initial open, reconnect, resume,
unmount/remount, and duplicate trigger coalescing. Existing SSE tests stay green.

### 3. Make Tasks and Spend snapshot reads resilient

Files per slice: the provider/hook, its focused regression test, and associated
summary schema/helper only if required. Split Tasks and Spend into separate tasks
at implementation time if their combined diff exceeds five files.

- Subscribe before initial read and react to lifecycle reconciliation.
- Discard superseded results; an event during a pending request must cause a read
  after that event. Preserve successful state on transport/parse failures.
- Retry a failed reconciliation with bounded backoff, canceled on teardown.
  No new perpetual full-domain polling loop or duplicate state authority.

Verify: controlled promises resolve in reverse order; offline recovery refreshes
while pages are unmounted; invalid responses retain state; retries recover without
another domain event. Spend snapshot recovery emits no old milestone toasts.

### 4. Make conversation attention recovery resilient

Files: `src/components/conversation/use-conversation-attention.tsx`, its tests,
`plugins/chat/components/chat-badge-provider.tsx`, and a chat event/store file if
the producer map reveals missing invalidation.

- Reconcile unread totals on lifecycle signals; retain last-known values on
  failures and reject stale responses.
- Cover read/send/delete/complete transitions, including another browser tab.
  Remove unused streaming tracking from the nav hook once working-only signaling
  is removed; keep progress inside conversation consumers.
- Snapshot recovery updates state without firing historical toasts/chimes/OS
  notifications. Live reply notification behavior remains event-driven.

Verify: conversation attention tests plus Chat fixtures, with unseen/read/deleted
conversations and interrupted requests. Shared changes apply to official Projects
and Messaging consumers; run their focused consumer tests too.

### 5. Restore Assets snapshot truth

Files: Assets badge provider, unmanaged tracker, import routes, focused tests,
and route manifest/schema if a cheap summary endpoint is needed.

- Provide a cheap authoritative snapshot of known unmanaged state at mount and
  recovery; do not run an expensive full import scan per SSE event or browser tab.
- Preserve the existing explicit-import model and watcher/scan ownership. Unknown
  startup inventory is not a verified empty directory. Ensure the initial
  background inventory is established without requiring the Import page.
- Serialize snapshots and `asset.unmanaged` updates so an older fetch cannot
  replace a newer event, including transition to zero.

Verify: startup inventory, new file, import, removal, reconnect, and read failure
against temporary asset directories. Document any summary route through existing
route schemas and manifests; no undocumented endpoint.

### Checkpoint A — live-state recovery

All changed providers pass their race/recovery tests. There is one shell stream,
no historical notification replay, and no failed fetch clears known indicators.
Run typecheck and quick conformance before committing passing slices.

### 6. Make Health freshness independent of page visits

Core slice files: `src/core/doctor.ts`, `doctor-execution.ts`,
`doctor-report-cache.ts`, a focused coordinator helper if needed, and a coordinator
test. Owner event wiring is separate 3–5-file slices derived from Task 1.

- Schedule missing/expired checks using canonical check metadata and existing
  per-check single-flight execution. Retain periodic full sweeps for checks that
  cannot expose events. Honor deadlines, backoff, unregister, and shutdown.
- Invalidate affected checks after relevant durable mutations and recovery
  transitions. Debounce bursts. If a mutation arrives during a check, queue one
  follow-up check; joining a check started before that mutation is insufficient.
- Advance canonical report projection at time boundaries, including snooze
  expiry, without a page read. Avoid event loops from `health.report.changed` and
  repeated publication of unchanged projections.

Verify: fake-clock/coordinator tests prove background convergence, bounded check
execution, follow-up work, snooze expiry, failed checks retaining honest evidence,
and clean teardown. Existing doctor/cache/acks/repair tests stay green.

### 7. Unify Health consumers and alert eligibility

Files: Health summary/report/resource hooks, shared report-client helper, and
focused tests; split lifecycle consolidation and eligibility into separate slices
if necessary.

- Use the canonical report parser and one action-required eligibility predicate;
  remove the partial legacy-fallback parser from the nav summary.
- Watch/advisory incidents never signal the nav in any sensitivity mode. Acked
  and snoozed incidents remain suppressed; genuine action alerts remain visible.
- Make automatic freshness the background coordinator's job; entering Health
  reads current state rather than providing a special freshness advantage.
  Preserve explicit Run checks and existing honest stale/error page states.

Verify: watch-only, advisory-only, action-required, snoozed, expired snooze,
resolved, failed refresh, and mixed incident tests. An action resolves while the
page is unmounted, and opening the page agrees with the already-updated nav.

### Checkpoint B — Health correctness

Demonstrate page-independent updates in the local mock. Report measured
diagnostic execution time separately from the target of two-second UI convergence
after authoritative evidence becomes available. No expensive sweep per event.

### 8. Render count-free dots and align conversation tones

Files: host `nav-badge.tsx`, `nav-badge-logic.ts`, their tests, and the shared
conversation attention rule/test pair in a separate small slice.

- Render `StatusMarker size="sm"` for active flat, grouped, collapsed, flyout,
  and mobile indicators. Remove count pills and count summation.
- Keep red > yellow > informational priority across parent/children and stable
  fallback behavior for static badges. Informational/unread nav signals are
  green. Accessible labels/tooltips describe the reason without numbers.
- Unread conversation totals yield green; in-flight work alone yields null.

Verify: rendering/logic tests cover zero, absent, large count, mixed priorities,
closed/open groups, static defaults, and clearing a higher-priority child. Inspect
real browser dot size, placement, keyboard focus, and accessible descriptions.

### 9. Remove duplicate Workflows approval indicators

Files: workflow approvals provider, attention rules, corresponding tests, and
Tasks gate projection/test only if Task 1 identified an actual gap.

- Remove the Workflows badge write and obsolete gate-count fetch/state.
- Keep event-driven approval toast/deep-link behavior. Tasks' existing review
  summary lights its dot, with blocked tasks retaining higher priority.
- Verify the three seeded mock approvals are visible in Review with working
  approval controls. Approving/rejecting updates Tasks; Workflows stays silent.

Verify: workflow attention tests, task/gate integration tests, and actual mock
navigation. Correct fixtures only if evidence shows they are invalid; do not
erase real pending approvals to make the indicator disappear.

### 10. Align official Messaging's remaining provider

Repository: sibling `bakin-bits-official`. Files: Plans summary hook, Messaging
refresh helper, corresponding tests, and local SDK test shim only if needed.

- Replace the extra EventSource with the documented shared event subscription.
- Retain state on failures, reject superseded responses, and reconcile on resume.
- Verify nested Plans/Brainstorm and Projects use the same dot semantics through
  the shared SDK; avoid unrelated official-plugin UI changes.

Verify with that repository's `bun run test` command (its required DOM preload),
typecheck, and affected plugin conformance fixture. Coordinate changes on a
matching feature branch; do not publish a plugin release.

### 11. Update contracts, knowledge, and evidence

Split docs by shell/conversations, Health, and domain owners; update each alongside
its corresponding passing code slice rather than deferring all docs to the end.

- Update `.claude/knowledge` files named in the spec and public
  `extending/plugins/{client-ui,realtime}.md` guidance.
- Add/update relevant existing Storybook examples to demonstrate nav-sized
  indicators and non-color state descriptions. Review the public API inventory;
  no new export or component is expected.
- Record README as reviewed/not impacted. Mark conflicting historical badge
  descriptions superseded without rewriting unrelated architecture history.
- Capture before/after browser evidence. If canonical tooling requires a visual
  baseline update, present the exact diff for explicit approval before updating.

## Commit and rollback strategy

Use short-lived `fix/navigation-indicators` branches. Preserve unrelated work.
Every behavioral commit includes its regression tests and relevant documentation;
commit only after its focused checks pass. Planned logical checkpoints:

1. `docs(nav): specify current-state navigation indicators` — reviewed spec/plan.
2. `fix(events): reconcile plugin snapshots after connection recovery` — event
   lifecycle, provider adoption in small passing commits; reverts restore prior
   refresh behavior without changing stored domain data.
3. `fix(health): refresh and publish diagnostics independently of page visits` —
   coordinator and owner-wiring commits. Revert wiring before its coordinator.
4. `fix(health): signal actionable incidents only` — eligibility and consumer
   consistency; can revert separately from freshness.
5. `fix(nav): replace numeric badges with semantic dots` — host rendering and
   rollups; no persistence migration, so presentation can be reverted alone.
6. `fix(conversation): signal unread replies without working indicators` — shared
   rules and consumers, including green tone and recovery tests.
7. `fix(workflows): keep pending approval indicators on tasks` — duplicate removal
   after task projection tests pass; notification delivery remains intact.
8. Official-repo `fix(messaging): retain and reconcile navigation state` — depends
   on the shared lifecycle event. Roll back this consumer before its event support.
9. `test(nav): verify live indicators across navigation layouts` — browser evidence
   and any remaining integration coverage/documentation reconciliation.

Some checkpoints may use two smaller commits to keep owner-specific changes
reviewable. No squash into one large change. Revert commits in dependency-reverse
order with `git revert`; no force push, destructive reset, or data rollback.

## Final verification and completion gate

Run focused suites first, then once for the complete change:

```sh
bun run typecheck
bun run lint
bun run test
bun run ui:conformance --quick
bun run ui:conformance --full
bun run build:host
bun run build:plugins
bun run docs:validate
```

Run `bun run --cwd plugins/<affected-plugin> test:ui` for changed client surfaces
and inspect `test-results/bakin-ui/index.html`. Run the canonical Storybook/browser
checks required by full conformance. Validate official changes with its own test,
typecheck, and UI commands. Read browser-testing and code-review skills when
entering those phases.

Browser matrix: expanded/collapsed/mobile; nested group open/closed; unrelated page
open while alert appears/resolves; green unread reply read in another tab; working
without unread; three pending task approvals; watch-only Health; real alert
resolution; disconnect/resume/server restart; snapshot error and retry. Confirm
no new console failures, overflow, keyboard regressions, or unexpected fanfare.

Complete only when this matrix agrees with the canonical destination data. Report
actual checks, any limits of periodic diagnostic detection, the Storybook patterns
used, and any explicit design-system approvals. The user approved implementation with “build plan”; no deployment or publication
is included in this work.

## Risks and controls

| Risk | Control |
| --- | --- |
| Refresh bursts or check feedback loops | Coalescing, per-check single-flight, queued follow-up, deadlines, negative tests |
| Events lost during startup or reconnect | Subscribe before snapshot, reconcile every connection/resume, retry failed reads |
| Snapshot predates a mutation | Generation/sequence guard plus post-event follow-up |
| Offline state mistaken for current truth | Retain known state and expose existing connection/stale context |
| Approval disappears from all nav entries | Task projection/integration proof precedes duplicate removal |
| Changing sensitivity hides real alerts | Effective action-required predicate; all modes and suppression tested |
| Shared SDK change affects Bits | Test Projects/Messaging consumers and nested group rollups |
| Scope grows into a Health rewrite | Retain registry, report, checks, and execution engine; change scheduling/publication only |

## Evidence log

- Source inspection complete for the host indicator, all core badge providers,
  shared conversation attention, Health cache/execution, task approval bridge,
  and official Plans summary refresh.
- Product decisions captured in the companion spec.
- Planning baseline: `bun run ui:conformance --quick` passed (228 architecture
  tests, zero failures, TypeScript and governance checks passed). Only the spec
  and plan were added; application behavior has not changed.

### Implementation and review — 2026-09-24

- Health was previously refreshed by a full doctor interval (30 minutes by
  default), while several checks expired after 60 seconds. Opening Health
  additionally requested a fresh sweep. The new server coordinator schedules
  each check independently of page visits, handles durable invalidations, and
  publishes time-dependent projection changes. The exact reported 56-to-3
  production episode was not replayed; regression tests reproduce superseded
  responses and expired evidence without a mounted page.
- Every main-nav layout uses the existing small StatusMarker. Positive counts
  remain provider metadata; neither visible navigation nor accessible names
  contain them. Static child defaults participate in consistent rollups.
- Conversation indicators signal green unread replies only. Removed obsolete
  working-state inputs from the shared contract and all three first-party
  consumers; updated the official repository's ambient types and test stub.
- Health navigation is action-required-only, across sensitivity modes; watch,
  acknowledged, and snoozed incidents do not light it. Pending workflow gates
  stay visible in Tasks Review; Workflows publishes no duplicate gate badge.
- Snapshot reads retain last-known state, retry failures, reject superseded
  results, and recover through the shell event bus. Chat seen/delete broadcasts
  now originate after server writes. Assets exposes its watcher-maintained
  inventory through `/import/summary`; it does not scan per browser event.
- Review covered correctness (races, failures, suppression, teardown), clarity
  (removed count aggregation and dead working inputs), architecture (domain
  ownership and one SSE connection), safety (read-only recovery; isolated test
  homes), and performance (targeted checks, bounded retries, cheap snapshots).
  Review fixes included observer-error isolation, accessible expanded links,
  and preserving Assets retry backoff during loading.
- README reviewed: core top-level setup unchanged. Updated official Messaging
  README, public plugin guidance, the style guide, relevant knowledge files,
  and supersession notes on the older main-navigation specification.
- Reused `feedback/status-marker.stories.tsx` / `DenseViewMarkers`,
  `lists/kanban.stories.tsx` / `TaskBoardComposition`, and
  `recipes/workflow-pages.stories.tsx` / `ReviewAction`. No new public visual
  contract, styles, token, exception, allowance, or baseline was needed.

### Verification evidence

- Core canonical suite: **10,063 passed, 19 skipped, 0 failed**. The initial
  sandboxed run could not bind local test servers; the authorized rerun passed
  with `IMITATION_CRAB_HOME=/tmp/bakin-nav-suite-mock`.
- Final focused regression suite after review: **213 passed, 0 failed** across
  18 files. Covers Health eligibility/scheduling/resources, SSE lifecycle,
  Tasks/Assets/Spend/Chat recovery, dot rendering and rollups, and approvals.
- Core typecheck and lint passed (six pre-existing warnings; none added).
  `bun run ui:conformance --quick` passed, including 228 architecture tests.
- Official repository: **648 passed, 8 skipped, 0 failed**; typecheck and lint
  passed, as did its production build. Its installed-package UI conformance passed against a freshly built
  SDK, including all Messaging and Projects surfaces and eight Projects browser
  scenarios. Direct fixture execution initially selected the test stub; the
  repository's canonical installed-package runner supplied the real SDK.
- Health, Tasks, Chat, Workflows, Spend, and Assets `test:ui` fixtures passed;
  their HTML reports were inspected. Desktop and mobile screenshots were
  reviewed; reports live at each plugin's `test-results/bakin-ui/index.html`.
- Isolated mock at port 3747, with all data under `/tmp`, dispatch paused, and
  search directed to a disabled isolated endpoint: desktop expanded/closed
  group, collapsed rail/popover, and 390px mobile drawer confirmed count-free
  dots. Three approvals are visibly marked in Tasks; Workflows is quiet.
- Browser: a server-side Chat read cleared the original Tasks-page indicator
  within two seconds. Snoozing action-required Health incidents cleared its dot
  without visiting Health, while a remaining watch incident stayed silent.
  Failed snapshots retained state; resume and real browser offline/online
  transitions reconciled within two seconds without notification replay.
  There were no page errors. Existing Activity-panel state was closed for the
  narrow drawer capture; broad page-layout behavior was not changed.
- Browser screenshots and results: `test-results/navigation-indicators/`.
  Browser tooling in this session lacked the in-app browser/Node REPL, so
  repository Playwright was used. Temporary mock processes were stopped.
- A prolonged-outage test exposed the previous 20-attempt SSE cutoff. The
  shell now retries for the mounted tab lifetime, capped at 30 seconds, and
  ignores stale connection errors. The regression failed before the change and
  passed afterward; all ten SSE tests, typecheck, and focused lint passed.
- Full conformance was run. Host/plugin/vendor builds, payload ratchet,
  deterministic Storybook, the core suite, all 365 Storybook interaction and
  accessibility tests, and all 314 canonical visual comparisons passed.
- Cross-browser first run: **154 passed, 2 failed** (Chromium and WebKit passed).
  Firefox's forced-colors field-focus check observed `outline-style: none`, and
  its markdown/search check recorded an aborted `axe` script request during
  navigation. Both passed in an isolated canonical-container rerun, unchanged
  (**2 passed**). No tests were relaxed or ignored. The aggregate full command
  therefore exited nonzero; this is not recorded as a clean first-run pass.
- The two remaining full-conformance gates were completed separately after that
  aggregate exit: `bun run ui:test:conformance` passed, and `bun run docs:check`
  passed (generated contracts, route checks, docs site, and public catalog).
  All affected plugin fixtures and the feature-specific mock browser matrix
  passed; no navigation regression was observed.
- Canonical visual baselines, public API inventories, design tokens, exception
  ledgers, and performance ceilings were not changed. Generated API references
  and the production embedded-asset manifest were committed normally.

### Checkpoints and rollback

Core checkpoints: `45efb8675` specification, `16b626e41` shared recovery,
`dd548f137` Health scheduling and eligibility, `c887ebbbc` Assets/Spend recovery,
`7e4021525` dot rendering, `f4f9801cc` unread conversations, `5e89f337c` approval
ownership, `49b3c7785` prolonged-outage recovery, and `dca9fec3c` generated
documentation/assets. Official Bits checkpoint: `5987450`. Revert consumers before the
shared event/contract changes; no persisted domain data migration is involved.

### Limits

Event-backed changes reconcile promptly once their authoritative snapshot is
available. External diagnostic probes still obey their registered cadence and
execution deadline; this does not promise instantaneous knowledge of external
systems. Disconnected or failed reads deliberately retain their last-known state.
Neither repository has been pushed, merged, published, or deployed.

### Code-review corrections

- Task-store events carry `{ type: 'taskboard', event: 'change' }`. The server
  now distinguishes that envelope from plugin events and invalidates the Tasks,
  Workflows, restart-recovery, and execution-safety checks immediately.
- Cached reconciliation reads no longer qualify as diagnostic sweeps. Run checks
  starts a POST even while a cached read is pending. Report/recovery events during
  a manual run coalesce into one read afterward, preserving the run's promise.
  Unmount and source changes discard queued reads.
- The real task envelope and both request races failed regression tests before
  the fixes. Afterward, 529 Health/doctor tests passed, including cleanup cases;
  focused lint, typecheck, quick UI conformance, the Health production client
  build, and both Health browser fixtures passed. The fixture HTML reports were
  inspected and contain no findings. The full conformance matrix was not rerun
  for these request-lifecycle corrections; its preceding results remain above.
- UI contract remains `storybook/public/feedback/status-marker.stories.tsx` —
  `DenseViewMarkers`, via `@makinbakin/sdk/patterns`. These corrections change no
  markup or styles and require no story, baseline, or design-system deviation.
