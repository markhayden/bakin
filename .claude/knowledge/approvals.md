# Approvals — ONE durable "a human must decide" primitive

Spec: `.claude/specs/health-escalation-and-migration-safety.md` (D6/D7, plan
PR 2). Workflow gates and Health decisions share one record shape, one
resolve path, one rehydration, one channel subscription, one attention
provider and one place to decide: the task the approval belongs to.

## Record (`packages/core/src/approvals/`)

`ApprovalRecord` lives at `~/.bakin/approvals/<encoded approvalId>.json`:

```ts
{ approvalId, owner, status: 'pending'|'approved'|'rejected'|'cancelled'|'expired',
  request: { title, body, options[{id,label,variant?}], expiresAt?, context? },
  deliveries: ApprovalDelivery[], response?, createdAt, updatedAt, resolvedAt? }
```

`owner` is a tagged union — each kind carries exactly what its handler needs:

| kind | owner fields | opened by |
|---|---|---|
| `workflow-gate` | `taskId, workflowId, runId, stepId` | the workflow engine, every gate (`requestGateApproval`) |
| `health-repair` | `taskId, requestId, incidentIds, proposal` (frozen `{reportId, observationIds, items[{actionId,itemId,safety,changes[]}]}`, plan review R1) | escalation, for non-safe repair items |
| `health-navigate` | `taskId, requestId, incidentIds, href` | escalation, for operator-only incidents |

Store verbs (`store.ts`): `createApprovalRecord` (idempotent — a pending record
is refreshed, a resolved one is returned untouched so a replay never reopens
a decision), `importApprovalRecord`, `getApprovalRecord`,
`listApprovalRecords({status, taskIds, kind})`, `updateApprovalDeliveries`,
`resolveApprovalRecord` (**compare-and-set** on `pending`; `approve|apply` →
`approved`, `reject|dismiss` → `rejected`; throws `ApprovalNotFoundError` /
`ApprovalNotPendingError`), `cancelApprovalRecord(id, reason)`,
`deleteApprovalRecord`, `pruneResolvedApprovalRecords(maxAgeMs)`,
`findPendingApproval(predicate)`, `approvalRefFromRecord`. Zod validates every
read.

## Kinds and the service (`src/core/approvals/`)

- `kinds.ts` — `registerApprovalKind({ kind, ownerState, onResolve, render? })`.
  `ownerState` answers rehydration: `live` (keep, re-render if delivery-less),
  `orphaned` (cancel), `unknown` (skip — NEVER cancel; a false cancel kills
  live buttons). `onResolve` applies the decision and throws a typed
  `ApprovalResolveError(message, 400|409|500)` to refuse it — the record
  stays pending. `render` (optional) draws richer channel content than the
  default `createApproval` card. Core never imports a kind: workflows
  registers `workflow-gate` at activation; the doctor's kinds register from
  startup recovery (`registerDoctorApprovalKinds`) before `bootApprovals`.
- `service.ts` — `requestApproval({approvalId, owner, request})` → record +
  `approval.pending` plugin-event + fire-and-forget channel render when
  `settings.approvals.channelAlerts` and the runtime has `channels`.
  `resolveApproval(id, decision)` → 404/409 typed refusals, an in-flight
  guard (Health card + Discord button at once: one wins, the other gets
  409, the handler runs once), the kind's `onResolve`, the CAS write,
  `channels.resolveApproval`, `approval.resolved`. `cancelApproval(id,
  reason)` (idempotent) tells the channel and publishes `approval.resolved`
  with `status: 'cancelled'`.
- `rehydration.ts` — prune resolved records older than 30 days; per record
  ask the kind's `ownerState`; re-render delivery-less live records when
  channel alerts are on. Unknown kinds are left untouched and logged.
- `channel-wiring.ts` — `bootApprovals(runtime)`: rehydrate, then ONE
  `channels.subscribeApprovalResponses` for every kind (stale provider
  buttons are ignored with a warn; refusals are logged, never thrown).
- `errors.ts` — `approvalErrorStatus(err)` is the ONE HTTP mapping
  (404/409/handler status/503 kind-unavailable) used by host and plugin routes.
- `links.ts` — `bakinBaseUrl()`, `taskUrl(taskId)` (`/tasks?taskId=`; the
  `/` route drops the search string, never build `/?taskId=`).

Boot order (`src/core/server/startup-recovery.ts`): plugins activate (kinds)
→ `doctor.start` → `registerDoctorApprovalKinds` → `recoverInterruptedApplies`
→ `bootApprovals`. Kinds must exist before rehydration or their records are
"unknown kind" for that boot.

## Settings

`settings.approvals = { channelAlerts: false, channel: 'general',
requireRejectReason: true }` (System & Alerts). Workflows keeps ZERO approval
settings. `requireRejectReason` binds surfaces that can collect a reason (UI
and decision page: a web reject without a comment is refused 400 while on);
channel-button rejects without a comment record the default reason
`Rejected via runtime channel (no reason provided)`. The Discord bridge's
modal collects a real reason.

## Surfaces

- Host REST: `GET /api/approvals?status=pending[&taskIds=a,b]`,
  `POST /api/approvals/:id/resolve { option, comment? }` (actor =
  `{source:'web', id: OS user}`). Routes: `packages/host/src/api/approvals.ts`.
- Attention: `packages/host/src/components/attention/approvals-attention-provider.tsx`
  (toast with Open + OS notification on `approval.pending`, silent while
  viewing that task) — the ONE announcement path for every kind; the
  workflows badge provider is gone.
- Board: `plugins/tasks/hooks/use-task-approvals.ts` reads the pending set
  (no polling; refresh on `approval.*`, `taskboard`, `bakin.reconcile`) and
  lights the "Needs approval" card signal (`approvalLabel`). The task detail
  renders `ApprovalPanel` (`plugins/tasks/components/approval-panel.tsx`) —
  one card per kind — and resolves through `/api/approvals/:id/resolve`;
  typed refusals render inline on that approval.
- Workflows plugin: `plugins/workflows/lib/approval-kind.ts` (kind handler,
  `decideGate`, `ensurePendingGateApprovals` at `onReady`); gate routes and
  hooks go through `decideGate` (newest pending record for the gate), the
  durable decision page resolves the EXACT record its form named, and the
  kind refuses an older generation (409) once a newer request exists for
  the same gate. Gate
  rendering detail: `.claude/knowledge/workflows-plugin.md` § Runtime Gate
  Approvals.
- Doctor: `src/core/doctor-approvals.ts` — `openRepairApproval` /
  `openNavigateApproval` (ONE unassigned review task + request + record),
  the two kind handlers, `recoverInterruptedApplies`. Policy and auto-close:
  `.claude/knowledge/doctor-and-health-checks.md` § Escalation.

## Health decisions

- **One approval, one execution.** The Health page's `/doctor/repair/apply`
  checks `pendingRepairApprovalFor(selected observationIds)` first: when a
  review task already holds the repair, the page's Apply RESOLVES that record
  (`resolveApprovalWithResult` returns the kind's apply report) instead of
  running a second plan — the service's in-flight guard makes a Health-page
  click and a task-panel/Discord click one execution (review P1, 2026-10-02).
- **Targets are concrete.** A repair action's `plan()` must name every real
  target (search-spin / search-scar emit one change per table read from the
  CURRENT report's evidence) and its `apply(items)` must act on the items'
  change targets only — never module-level "last seen" state — or the frozen
  change-set comparison cannot protect anything.
- **Apply** (health-repair): re-plan against the current report for the
  frozen proposal's observations; apply only when the fresh change set
  (`actionId|kind|target|action`, order-independent) equals the frozen one.
  A differing set withdraws the approval (`plan-changed`), posts a fresh
  proposal on the SAME task (new approvalId `health-repair:<requestId>:<n>`)
  and refuses with 409; nothing left to repair withdraws and leaves the task
  for auto-close. The request is `applying` BEFORE any mutation; passing
  targeted checks → `verified` + task done; failed steps / incidents still
  burning → `failed` + task blocked with the reason. "Passing" is
  `judgeRequest` (the auto-close rule): every originating check EVALUATED
  healthy on the fresh run — an absent incident (unknown / failed /
  unregistered check) never verifies, here or in interrupted-apply recovery.
- **Dismiss** (both kinds): snooze 7 d on action_required incidents (the ack
  store refuses a permanent ack on that tier), ack on lower tiers; request
  `dismissed`; task done.
- Interrupted applies (crash between mutation and `applied`) are recovered at
  boot: fresh targeted checks → verified or failed+blocked; the pending record
  is withdrawn (`interrupted`).

## One-shot upgrades (delete after margo has booted PR 2 once)

`src/core/approvals/settings-upgrade.ts` moves `approvalChannelAlerts` /
`approvalChannel` / `requireRejectReason` from `plugin-settings/workflows.json`
into `settings.approvals`, drops `notifyOnGate`, and rewrites
`doctor.escalation` strings (`off`→false, `notify|task`→true) with a
`workflows.json.pre-approvals.bak` backup. `records-upgrade.ts` moves
`~/.bakin/workflows/approvals/*.json` into the core store as
`workflow-gate` records with deliveries intact (live Discord cards keep
resolving). Both run in `server.ts` after `createAppServices()`, before
plugin init; `normalizeDoctorSettings` coerces the legacy strings on every
load until the files are deleted.

## Tests

`tests/core/approvals/{store,service,rehydration,channel-wiring,settings-upgrade,records-upgrade}.test.ts`,
`tests/host/{approvals-api,approvals-attention}.test.*`,
`tests/plugins/workflows/{approval-kind,notifications,gate-decision-page,gate-hooks}.test.ts`,
`tests/core/{doctor-approvals,doctor-escalation,doctor-autoclose}.test.ts`,
`tests/plugins/tasks/{use-task-approvals,approval-panel}.test.tsx`.
