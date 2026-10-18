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
requireRejectReason: true }` — `channelAlerts` + `channel` are routing and
live in Settings → Channels (`PUT /api/channels/routing`, #908);
`requireRejectReason` is approval policy and stays in System & Alerts.
Workflows keeps ZERO approval
settings. `requireRejectReason` binds surfaces that can collect a reason (UI
and decision page: a web reject without a comment is refused 400 while on);
channel-button rejects without a comment record the default reason
`Rejected via runtime channel (no reason provided)`. The Discord bridge's
modal collects a real reason.

## Provenance — declared, vouched, or refused (#898 H)

HTTP is unauthenticated and agents share the OS user, so a record never
claims "a verified human". Every decision carries `ApprovalProvenance`
(`packages/core/src/adapters/runtime/channels.ts`):
`{ channel: ui|cli|discord|mcp|runtime|hook, actor: { kind:
operator-declared|agent|channel-user|unknown, id?, displayName? }, evidence:
declared|runtime-context|provider }` — built ONLY by the transport
(`packages/core/src/approvals/provenance.ts`), never from request JSON:

- **HTTP:** `approvalProvenanceFromRequest(req)` reads headers only.
  Browser decision clients send `OPERATOR_DECLARATION_HEADERS`
  (`X-Bakin-Operator: declared`, re-exported from `@makinbakin/sdk/utils`);
  the CLI sends it only with `--as human`; channel = `cli` when
  `X-Bakin-Origin: cli`, else `ui`. `X-Bakin-Agent-Context` overrides any
  declaration (a malformed one is `unknown`, never "no agent"). The
  server-rendered gate decision form posts ONE exact scalar field
  (`operator=declared`) — the only non-header declaration.
- **Channels:** runtime channels report `ChannelApprovalDecision { channel:
  discord|runtime, responder? }` — the provider vouches for the user
  (Discord keeps its id + fail-closed approver allowlist). No responder ⇒
  `unknown` ⇒ refused; none is ever invented (OpenClaw without `resolvedBy`).
- **Hooks:** `workflows.approveGate/rejectGate` take `provenance` (the
  plugin passes `approvalProvenanceFromRequest(req)` from
  `@makinbakin/sdk/routing` for the request it serves); absent/malformed is
  never defaulted.

**ONE policy** (`approvalRefusal`) runs before ANY side effect — in
`resolveApprovalWithResult` (before even the record lookup: a refused caller
learns nothing) and at the other operator-word boundary, Health's direct
apply when non-safe items are confirmed (`assertOperatorDecision`). It
refuses: an in-process agent tool call (`src/core/agent-invocation.ts` —
every exec-tool handler runs inside it, MCP and runtime-native), an `agent`
actor, an undeclared/unknown caller, and `mcp`/`hook` channels.
`ApprovalRefusedError { code }` → 403 on every surface (hooks return
`{ success: false, status: 403, code }`; the decision page renders it).

**Agent contexts are detected, not assumed away:** Pi agent shells carry
`BAKIN_AGENT_CONTEXT=<agent>` per command (bash `spawnHook`,
`packages/adapter-pi/src/agent-shell.ts`); the CLI resolves ONE identity per
invocation in the shared http plumbing (`src/cli/identity.ts`): env marker →
run-dir sidecar → (only for `--as human`) the run-dir/workspace check via the
runtime's optional, STRICT `agents.workspaces()` (OpenClaw can't mark its
shells; an unreadable openclaw.json throws rather than listing none), asked
of THIS home's server (server.lock) — never a `BAKIN_URL` target, which
cannot vouch for a local cwd; with no local server the CLI runs the same
check in-process against a BARE runtime adapter (constructed, never
initialized — no app services, search, or settings/secret writes). OpenClaw
treats only ENOENT as an absent config; any other read failure is
unreadable (strict readers and writers refuse it). A check that cannot
answer is not a negative:
the server answers 503 when services, the roster or a workspace lookup fail
(`AgentContextUnavailableError`), and the CLI then does not honor `--as
human` (stderr says why) — task commands fail rather than act as an
unconfirmed operator. Task commands' `--as human` inside an agent context
resolves to that agent. Pi's replacement bash
is `defaultActive: false` — active exactly when the session selects bash.
Refusal codes stay machine-readable everywhere: JSON `code`, Health
`refusalCode`, the decision page's `X-Bakin-Refusal-Code` header; the
activity feed renders `approval.resolved` as "Approved — Declared in UI".

**Words** (`describeApprovalProvenance`): "Declared in UI", "CLI --as
human", "Discord @user", "Runtime channel user X", "Agent X (channel)",
"Provenance unavailable — legacy record". Every decision appends ONE
`approval.resolved` audit record with them; gate activity lines, receipts,
repair task logs and Health request events use the same words.

**Records:** old `response.actor` is dropped on read, never translated
(status/decision/timestamps intact, an idempotent create never reopens);
cancellations carry no provenance (Bakin withdrew the request).

**Documented limits:** no HTTP auth; an arbitrary shell `curl` carrying the
declaration, or a shell that strips the markers, is indistinguishable from
the operator. Working from inside an agent's workspace with `--as human`
is a false positive in the safe direction.

## Surfaces

- Host REST: `GET /api/approvals?status=pending[&taskIds=a,b]`,
  `POST /api/approvals/:id/resolve { option, comment? }` (provenance from
  the transport — see § Provenance), `GET /api/approvals/agent-context?cwd=`
  (the CLI's workspace check). Routes: `packages/host/src/api/approvals.ts`.
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
  `.claude/knowledge/doctor-and-health-checks.md` § Escalation. Coverage
  reads only schema-valid repair-request files, and a future-dated request
  covers nothing (#898).

## Health decisions

- **One approval, one execution.** The Health page's `/doctor/repair/apply`
  checks `pendingRepairApprovalFor(selected observationIds)` first: when a
  review task already holds the repair, the page's Apply RESOLVES that record
  (`resolveApprovalWithResult` returns the started repair's
  `{ operationId, bootId }`, answered as 202) instead of running a second
  plan — the service's in-flight guard makes a Health-page click and a
  task-panel/Discord click one execution (review P1, 2026-10-02).
- **Decision first, outcome after (#895 D24).** `onResolve` validates,
  writes `applying` BEFORE anything can mutate, starts the repair operation
  (`startDoctorRepair`, origin from the provenance channel: cli / discord
  (runtime channels too) / web),
  appends `operation-started` and returns its id WITHOUT waiting — so the
  decision is saved, the card updated and `approval.resolved` published at
  once. The kind's `afterResolve` (run by the service strictly after that,
  fire-and-forget, errors logged; `settleApprovalFollowUps()` in tests)
  awaits the operation, judges it (below), records `applied` / `verified` /
  `apply-failed`, completes or blocks the task, and posts the outcome with
  `postApprovalOutcome` (feature-detected `RuntimeChannelSurface`
  member; Discord replies to the card). A repair that cannot even start
  (fresh evidence moved under the plan) records `apply-failed` and blocks
  the task in `onResolve`, then returns `{ startFailure }` so
  `afterResolve` still posts exactly one failure outcome. Boot recovery
  (`recoverInterruptedApplies`) skips requests whose operation is still live;
  any other `applying` request is "outcome unknown" — a task log line, a
  channel follow-up, then the fresh-check judgement.
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
