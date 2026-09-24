# Navigation indicator consistency

Status: proposed for review after product interview. Implementation has not started.

## Objective

Make main-navigation indicators quiet, current, and explainable by the destination
page. A signal must represent unread information, a needed decision, or a problem;
ordinary agent activity does not warrant a navigation signal. Fix state production
and reconciliation as well as presentation. Single-user installation; favor one
clear contract over compatibility shims.

## Confirmed decisions

1. Replace numeric main-navigation badges with small colored dots, including
   expanded navigation, collapsed navigation, nested destinations, and mobile.
2. Green represents unread updates/replies; yellow represents review or approval;
   red represents problems. Use existing semantic tokens and components.
3. Working/streaming alone produces no nav dot. Progress remains inside the plugin.
4. Pending workflow approvals belong to Tasks. Workflows must not advertise an
   approval whose controls exist only on a task. Each approval behind the Tasks
   signal must be identifiable and actionable there.
5. Fix freshness independently of removing visible numbers. Opening a destination
   must not be necessary to discover that its indicator is obsolete.
6. Retain last-known indicators during disconnection or failed refreshes. Preserve
   connection/freshness context and reconcile automatically after recovery; a
   failed read must never be interpreted as a confirmed clear state.
7. Health monitoring findings must not notify. Its nav signals only unsuppressed
   effective `action_required` incidents in every sensitivity mode. Watch and
   advisory findings remain visible inside Health. Sensitivity still computes
   effective dispositions; it no longer lowers the nav threshold to monitoring.

## User-visible behavior

| Situation | Navigation | What clears it |
| --- | --- | --- |
| Unread Chat / Projects / Messaging reply | Green dot | Reading the relevant conversation |
| Agent working with no unread reply | None | Already silent |
| Task waiting for approval or review | Yellow dot on Tasks | Decision or authoritative task-state change |
| Blocked task | Red dot on Tasks | Resolving the block |
| Workflow approval | No Workflows dot; Tasks as above | Decision on the task |
| Health action-required alert | Red dot | Resolution or valid suppression |
| Health monitoring/advisory only | None | Remains available in Health |
| Disconnected or failed summary read | Last-known dot | Successful reconciliation |

An unread update is distinct from a healthy system: green does not mean
"everything is healthy," and destinations do not get evergreen green dots.
Opening a plugin alone does not acknowledge an unresolved action or read every
conversation. Preserve existing domain read/acknowledgment semantics.

For other existing providers, preserve the underlying reason for signaling and
align its tone with the same meanings: Spend heads-ups are information, its
90% warning needs review, and its open cap incidents are problems. Assets' import
availability remains informational and must be backed by the current import list.

## Evidence from source inspection

- `packages/host/src/components/layout/nav-badge.tsx` already renders kit markers
  for presence-only badges, but turns supplied counts into pills. Both success
  and attention tones are supported. Group logic also aggregates counts.
- `src/components/conversation/attention.ts` explicitly maps unread replies to
  `attention` and in-flight turns to `info`. This explains the yellow chat nav
  signal independently of the indicator shown inside the plugin.
- `plugins/health/hooks/use-health-summary.ts` reads a cached report and listens
  for `health.report.changed`. The page's `use-health-report.ts` additionally
  checks evidence freshness and requests a sweep. This is a plausible mechanism
  for the reported change on entry, not yet a runtime reproduction of 56 to 3.
  The doctor defaults to a 30-minute full-sweep cadence. Time-dependent report
  changes (including snooze expiry) are projected when the report is read.
- `src/hooks/use-sse.ts` updates connection flags on open, without notifying
  summary consumers to reconcile events missed during disconnection.
- `plugins/tasks/hooks/use-task-summary.ts` refreshes on taskboard events without
  rejecting superseded responses. Spend and gate providers need the same audit.
- `plugins/workflows/components/approvals-badge-provider.tsx` counts pending gates
  against Workflows, while its notifications link to Tasks. Mock fixtures include
  three pending workflow approvals. Tasks already derives review/blocked state
  from its own summary; verify gate transitions reach that authority before
  removing the duplicate workflow indicator.
- Assets currently initializes at zero and relies on `asset.unmanaged` events.
  Inspect snapshot/reconnect handling so existing state is not lost on mount.
- The official Messaging Plans summary clears itself on request failure and
  lacks protection from superseded responses. Its refresh helper opens a separate
  EventSource. Address these within this indicator fix; avoid broader page refits.

## Public UI contract

Selected existing pattern:
`storybook/public/feedback/status-marker.stories.tsx` — `CanonicalUsage` and
`DenseViewMarkers`, using `StatusMarker` from `@makinbakin/sdk/patterns`, size `sm`.

Use the existing navigation layout and routing from `@makinbakin/sdk/navigation`.
Keep count-free accessible state descriptions on nav links and matching tooltip
copy; the dot can be decorative when the link names its state. Do not rely on
color alone to explain the destination's attention items. Tasks composes
`storybook/public/lists/kanban.stories.tsx` — `TaskBoardComposition`; approval
actions use `storybook/public/recipes/workflow-pages.stories.tsx` — `ReviewAction`.
No new tokens, entrypoints, or design-system exception is currently proposed.

## Proposed acceptance criteria

- No numeric indicator appears in any main-navigation presentation.
- Unread replies show green, clear when read, and never become yellow merely
  because they are unread. A working turn alone remains silent in navigation.
- Multiple reasons use deterministic urgency precedence: problems before needed
  review before unread updates. Removing a higher-priority reason reveals the
  remaining reason instead of clearing the whole signal.
- Approval creation and resolution update Tasks without visiting Tasks or
  Workflows; mock approvals can be found and acted on from Tasks.
- Health nav and Health page derive from the same canonical incident state and
  respect acknowledgment and snooze. Only effective action-required incidents
  contribute to the nav, regardless of sensitivity mode.
- Healthy connected clients reconcile authoritative changes while elsewhere in
  the application. Verify updates, resolution, deletion, acknowledgment, and
  settings changes, not just creation of alerts.
- Reconnection and return from suspension reconcile current snapshots without
  replaying old notification effects. Superseded requests cannot restore obsolete
  indicators. Initialization cannot leave a subscription gap.
- Counts remain available to domain logic where needed. Scope of this request is
  main-navigation presentation; in-page counts and tab-title counts are not
  assumed removed.

## Freshness contract

Three separate layers must be correct:

1. **Evidence:** refresh affected diagnostics after relevant known state changes,
   using the existing per-check single-flight execution. Schedule expired/missing
   evidence in the background; a mounted Health page must not be the scheduler.
   Expensive checks retain their own cadence/deadlines. External changes without
   a producer event become known on their scheduled check, not magically sooner.
2. **Projection:** publish canonical changes, including time-driven suppression
   expiry, without requiring a navigation or GET from the Health page.
3. **Client:** subscribe before requesting an initial snapshot; refresh on domain
   changes, connection recovery, and resume. Coalesce bursts, discard older
   responses, retain successful state on failures, and retry failed reconciliation
   without depending on a future unrelated event.

The local mock acceptance target is convergence within two seconds after the
authoritative snapshot is available, with the relevant plugin page unmounted.
Diagnostic execution time is measured separately. Tests must cover an event
arriving while a request or check is already in flight: one follow-up read/check
must observe that newer mutation instead of merely joining obsolete work.

Do not generate toasts, sounds, or OS notifications from snapshot reconciliation.
The existing shell connection indicator supplies offline context. Per-resource
read failure must retain honest stale/error metadata for accessible descriptions;
do not add a new notification preference or an additional main-nav dot.

## Implementation boundaries

Use the existing single SSE connection and canonical domain state. Avoid a new
notification database, per-plugin EventSource connections, parallel health
policies, and indiscriminate expensive diagnostic sweeps. Determine the minimal
shared reconciliation mechanism after completing the provider audit. Do not
claim real-time diagnostic evidence for checks that only run periodically;
document and test the actual invalidation and freshness behavior.

Retain count metadata only where it has an active consumer (for example zero
means no signal); remove numeric nav rendering and pointless rollup summation.
No broad public type migration or backwards-compatibility layer is needed to
render counts as presence. Use ordinary strict TypeScript functions and existing
schemas; for example, Health eligibility is the shared predicate:

```ts
const requiresAttention = (incident: HealthIncident): boolean =>
  incident.effectiveDisposition === 'action_required'
  && incident.ackState === undefined
```

Always: retain authoritative state and domain ownership, test before checkpoint
commits, use temporary test homes, and follow the existing UI contract.
Ask first: a concrete missing UI pattern or visual-baseline update under the UI
skill. Never: claim stale evidence is healthy, hide failing tests, introduce a
compatibility shim, or publish/deploy as part of this fix.

## Validation strategy

Add meaningful regression tests for missed events/reconnection, out-of-order
responses, health changes while its page is unmounted, green unread state,
working-only silence, mixed-priority rollups, and approval ownership. Use existing
Bun/React test conventions and isolated temporary storage; never live homes.

Relevant existing suites include `tests/components/nav-badge.test.tsx`,
`nav-badge-logic.test.ts`, `use-health-summary.test.tsx`,
`conversation-attention.test.tsx`, and
`tests/plugins/workflows/approvals-attention.test.tsx`.

Commands to refine into the implementation plan:

```sh
bun test tests/components/nav-badge.test.tsx tests/components/nav-badge-logic.test.ts --isolate
bun test tests/components/use-health-summary.test.tsx tests/components/conversation-attention.test.tsx --isolate
bun test tests/plugins/workflows/approvals-attention.test.tsx --isolate
bun run typecheck
bun run ui:conformance --quick
bun run ui:conformance --full
bun run test
```

Verify actual navigation in the mock browser in expanded, collapsed, nested, and
mobile states. Use affected plugins' UI fixtures when their surfaces change.
Approve exact visual-baseline changes separately if required by conformance.

## Documentation and plan coverage

Review `.claude/knowledge/{plugin-system,conversation-kit,chat-plugin,tasks-plugin,
workflow-approvals,doctor-and-health-checks,assets-plugin,spend-plugin,style-guide}.md`
and public plugin-author navigation guidance for affected contracts. README has
no current nav-indicator contract, so no README edit is expected. Historical
navigation specs can be marked superseded where their badge behavior differs.

After product decisions are settled, produce a vetted implementation plan with
small dependency-ordered tasks, verification gates, and conventional-commit
checkpoints that can be reverted independently. User approval precedes building.

## Product decisions awaiting clarification

None. Review the specification and implementation plan before building.

## Remaining technical investigation

- Reproduce Health divergence and trace producer invalidation, timed expiry,
  acknowledgment expiry, and report publication before selecting a fix.
- Audit core and official plugin providers for freshness and tone consistency.
- Confirm task-review projection covers every pending approval and removal path.
- Verify stale metadata can use existing accessible nav descriptions without a
  supported-UI-contract extension; report an exact gap before deviating.
