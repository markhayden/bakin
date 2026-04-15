---
issue: 91
title: Richer Discord approval notifications — two-message pattern, decision audit fields, thread overflow
status: draft
follow_up: 98
---

# Issue #91 — Richer Discord approval notifications

## Background

Today's Discord approval flow is sparse and lossy:

- The **awaiting card** (`plugins/workflows/lib/notifications.ts:156-242`) carries the gate label, workflow id, task id, step id, and prior output (truncated at 1024 chars). The gate's `description` field is **never rendered** even though it exists on `GateStep` (`plugins/workflows/types.ts:43`).
- On approval, `editDiscordGateMessage` (`notifications.ts:248-290`) **destroys** that context — title becomes `"Gate Approved"`, description becomes `"Approved"`, fields removed. Long prior outputs are hard-truncated at 1024 chars instead of preserved.
- The `gate.approved` / `gate.rejected` audit events (`plugins/workflows/index.ts:325, 344`) carry only `taskId`, `stepId`, and (on reject) `reason`. There is **no approver identity, no requested-at, no decided-at** anywhere — not in `StepState`, not in the audit payload, not in the Discord card. "Who approved this and when?" cannot be answered from any surface.
- `GateInteraction` (`src/core/discord-gateway.ts:46-55`) discards the Discord user fields that are already on the raw `INTERACTION_CREATE` payload (`data.member.user.{id, username, global_name}`).

Net effect: the approvals channel is decorative, the audit log is a stub, and the operator has to open another system to answer basic questions about a decision.

## Objective

Make every approval decision **traceable from Discord alone**, and **traceable from the audit log alone**, without adding deep links (the install is single-user behind Tailscale; no public URL exists). Capture the approver identity and decision timeline once, in `StepState`, and reuse it everywhere downstream.

## Non-goals

- **No deep links.** No `BAKIN_PUBLIC_URL`, no "Open Task" buttons. Tailscale-only access makes URLs useless to anyone reading Discord from a phone outside the tailnet, and we have one user.
- **No per-gate `notify_format` YAML.** Deferred to issue #98. All gates render with the same defaults.
- **No backwards-compatibility shims.** Single-user machine per CLAUDE.md. `StepState` field additions land directly; existing instance JSONs missing the new fields just render with empty values until they're decided. Existing audit JSONL stays unchanged on disk — only new entries carry new fields.
- **No multi-source approval identity service.** Approver is a flat `{ id, displayName, source }` triple. Web-source approvals fill `displayName` from `os.userInfo().username`; system/auto approvals leave `displayName` undefined.
- **No Slack notifications.** Out of scope despite the `NotifyChannel` type listing slack — that's #98 territory.

## Design

### Three changes, one decision

1. **Capture the approver and timeline in `StepState`** so the data exists exactly once and feeds Discord, audit, and the memory plugin's audit view.
2. **Two-message Discord pattern on decision:** edit the awaiting card in place to *append* decision + approver (preserving all existing fields), then post a second standalone summary message with the full record.
3. **Thread overflow:** if prior output exceeds Discord's 1024-char field limit, post the gate alert with a truncated preview *and* start a thread on that message containing the full output. Reject-reason text never overflows (capped at 500 chars by the modal).

### Data model changes

`plugins/workflows/types.ts`:

```ts
export interface ApprovalActor {
  id: string                // Discord user id, OS username, or 'system'
  displayName?: string      // Discord global_name/username, OS username
  source: 'discord' | 'web' | 'system'
}

export interface StepState {
  status: StepStatus
  startedAt?: string
  completedAt?: string
  output?: Record<string, unknown>
  previousOutput?: Record<string, unknown>
  rejectionReason?: string
  childTaskId?: string
  discordMessageId?: string
  // NEW — gate decision metadata
  requestedAt?: string      // when gate moved to pending_approval
  decidedAt?: string        // when approve/reject was recorded (set for both outcomes)
  approver?: ApprovalActor
}
```

`requestedAt` is set by `advanceWorkflow` when a gate enters `pending_approval` (`runtime.ts:757`). `decidedAt` and `approver` are set by `approveGate` / `rejectGate`. Duration is computed on read (`decidedAt - requestedAt`).

### Discord gateway: extract approver

`src/core/discord-gateway.ts`:

- Extend `GateInteraction` with `approver: ApprovalActor` (always present for Discord-sourced interactions, `source: 'discord'`).
- In `handleInteraction`, extract from the raw payload:
  - `data.member?.user` (guild context) or `data.user` (DM context — never used here, but tolerate)
  - `id` → `approver.id`
  - `global_name || username` → `approver.displayName`
- Modal-submit path (`MODAL_SUBMIT`, line 192) carries the same `member.user`; extract there too.

### Runtime: capture timeline + accept approver

`plugins/workflows/lib/runtime.ts`:

- `advanceWorkflow` (gate branch, line 755-780): set `instance.stepStates[nextStep.id].requestedAt = now`.
- `approveGate(taskId, stepId, approver?, contentDir?)`: new optional `approver: ApprovalActor` parameter. Set `stepState.decidedAt = now` and `stepState.approver = approver` before save. Pass through to `notifyGateApproved`.
- `rejectGate(taskId, stepId, reason, approver?, contentDir?)`: same treatment.
- Both functions: REST-source callers in `plugins/workflows/index.ts` REST handlers fill an actor with `source: 'web'` and `displayName = os.userInfo().username`. System-source callers (auto-approve, watchdog cleanup if any) pass `{ source: 'system', id: 'system' }`.

### Notifications: rebuild the edit, add the summary, add the thread

`plugins/workflows/lib/notifications.ts`:

**`editDiscordGateMessage` rewrite** — preserves the awaiting card's context. Signature changes to take the full decision record:

```ts
editDiscordGateMessage(
  channelName: string,
  messageId: string,
  decision: 'approved' | 'rejected',
  approver: ApprovalActor,
  decidedAt: string,
  reason?: string,
): Promise<void>
```

Behavior: GET the existing message, preserve embed `title`, `fields`, append two new fields (`Decision`, `Decided by`), update `color` (green/red), remove `components`. Falls back to the old strip-and-replace shape only if GET fails.

**`sendDiscordGateSummary`** (new) — posts the second message after the edit succeeds:

```ts
sendDiscordGateSummary(
  instance: WorkflowInstance,
  step: GateStep,
  decision: 'approved' | 'rejected',
  approver: ApprovalActor,
  requestedAt: string,
  decidedAt: string,
  reason: string | undefined,
  settings: DiscordGateSettings,
): Promise<void>
```

Embed shape:

```
Title:       Gate {Approved|Rejected}: {gate.label}
Description: {gate.description ?? ''}
Color:       green | red
Fields:
  - Decision:    Approved / Rejected
  - Decided by:  {approver.displayName} ({approver.source})
  - Workflow:    {instance.workflowId}
  - Task:        {instance.taskId}
  - Step:        {stepId}
  - Requested:   <t:{unix}:R>     (Discord relative timestamp)
  - Decided:     <t:{unix}:R>
  - Duration:    {humanized}
  - Reason:      {reason}          (only on reject)
Footer:      instance {instance.instanceId}
```

**Thread overflow helper** (new) — used by `sendDiscordGateAlert` when prior output exceeds the field limit:

```ts
postThreadReply(
  channelId: string,
  messageId: string,
  threadName: string,
  content: string,
): Promise<void>
```

Implementation: `POST /channels/{channelId}/messages/{messageId}/threads` with `{ name, auto_archive_duration: 60 }`, then `POST /channels/{thread.id}/messages` with the full content. If the content itself exceeds Discord's 2000-char message limit, split into multiple sequential posts.

`sendDiscordGateAlert` keeps a short truncated preview in the embed field, then fires the thread reply if the full text exceeds 1024 chars (fire-and-forget, log-on-fail). The thread reply posts after the message id is known — chained off the same response.

### Audit payload extension

`plugins/workflows/index.ts` (Discord interaction handler at :315-355, plus REST approve/reject handlers wherever they live):

```ts
ctx.activity.audit('gate.approved', 'discord', {
  taskId, stepId, gateLabel: step.label,
  approver: approver,
  requestedAt: stepState.requestedAt,
  decidedAt: stepState.decidedAt,
  durationMs: Date.parse(decidedAt) - Date.parse(requestedAt),
})
```

Same shape for `gate.rejected` plus `reason`. The memory plugin's audit view picks this up automatically since it reads the JSONL.

### Discord interaction handler glue

`plugins/workflows/index.ts:315`:

- Pull `interaction.approver` out and pass to `approveGate(taskId, stepId, approver)` / `rejectGate(taskId, stepId, reason, approver)`.
- After the runtime call succeeds, reload the instance to read `stepState.{requestedAt, decidedAt, approver}` and pass them to both `editDiscordGateMessage` and `sendDiscordGateSummary`.
- Failure modes: edit failure does not block the summary message (the summary is the durable trace; the edit is a UX nicety). Summary failure logs and does not throw — the audit event is the canonical record.

### REST gate approval path

The REST routes that approve/reject gates (search for `approve` / `reject` under `plugins/workflows/index.ts`) need the same actor wiring:

```ts
const approver: ApprovalActor = {
  source: 'web',
  id: os.userInfo().username,
  displayName: os.userInfo().username,
}
```

If Discord is enabled and the gate has a `discordMessageId`, also fire the edit + summary so web-initiated approvals show up in the channel with the correct source tag. (This is a side-benefit, not the primary motivation — but it's free now that the plumbing exists.)

## Acceptance criteria

Functional:

- [ ] Discord-initiated approval results in: (a) original card edited in place with all original fields preserved + Decision/Decided-by appended, (b) a second summary message in the same channel with the fields enumerated above.
- [ ] Discord-initiated rejection produces the same two-message pattern with `Reason` and red color.
- [ ] Web-initiated approval (REST POST) updates `StepState` with `source: 'web'`; if Discord is enabled and the gate had a Discord card, the same edit + summary fire with `(web)` source tag.
- [ ] Prior outputs longer than 1024 chars: gate card shows truncated preview, full text appears in a thread on the gate message.
- [ ] `StepState.{requestedAt, decidedAt, approver}` populated on every approval/rejection going forward.
- [ ] `gate.approved` / `gate.rejected` audit JSONL entries carry `approver`, `gateLabel`, `requestedAt`, `decidedAt`, `durationMs` (and `reason` for rejects).

Non-functional:

- [ ] No outgoing HTTP to Discord during tests — every test mocks `fetch` per CLAUDE.md testing rules.
- [ ] Tests mock `getContentDir`, `logger`, `watcher`, `openclaw-client` per the standard plugin test harness.
- [ ] All new code paths log on failure rather than throwing — Discord failures must never kill a workflow advance.
- [ ] No new external deps.

## Test plan

`tests/core/discord-gateway.test.ts`:

- Approver extraction from `MESSAGE_COMPONENT` payload with `member.user.{id, username, global_name}` — `global_name` preferred, fall back to `username`.
- Approver extraction from `MODAL_SUBMIT` payload (reject path).
- Approver still populated when `member` is absent and only `user` is present.

`tests/plugins/workflows/notifications.test.ts`:

- `editDiscordGateMessage` GETs the existing message, preserves `fields`, appends Decision + Decided by, removes `components`, updates color.
- `editDiscordGateMessage` falls back to a stripped embed if GET fails (and logs).
- `sendDiscordGateSummary` produces an embed with all required fields for approval and for rejection (with reason).
- `sendDiscordGateSummary` formats Discord relative timestamps as `<t:UNIX:R>`.
- `postThreadReply` calls the threads endpoint with the message id and posts the full content; splits content over 2000 chars into sequential posts.
- `sendDiscordGateAlert` triggers the thread reply only when prior output exceeds 1024 chars.

`tests/plugins/workflows/runtime.test.ts` (or new file):

- `advanceWorkflow` sets `requestedAt` on the gate step state.
- `approveGate` with an approver sets `decidedAt` and `approver` on the step state and persists.
- `rejectGate` with an approver sets the same plus `rejectionReason`.
- Both functions still work when `approver` is omitted (system path).

`tests/plugins/workflows/discord-flow.test.ts` (new):

- End-to-end Discord approval flow with mocked `fetch`: gate reach → alert sent → user clicks approve → `approveGate` called with extracted approver → edit + summary fired → audit event payload contains approver/gateLabel/timestamps/durationMs.
- Same for reject path.
- Web-source approval (call REST handler directly) still produces the edit + summary when a `discordMessageId` is present.

## Commit strategy

Each commit should leave the repo green (`pnpm test`, `pnpm typecheck`). The order is chosen to allow rollback of the visible Discord changes (commits 4–6) without unwinding the data model (commits 1–3).

1. **`feat(workflows): add ApprovalActor type and StepState decision fields`**
   `plugins/workflows/types.ts` only. New type, three new optional `StepState` fields. No behavior change. Compiles cleanly because all new fields are optional.

2. **`feat(core): extract approver from Discord interaction payloads`**
   `src/core/discord-gateway.ts` + `tests/core/discord-gateway.test.ts`. `GateInteraction.approver` populated for both `MESSAGE_COMPONENT` and `MODAL_SUBMIT`. Existing handler in `plugins/workflows/index.ts` ignores the new field for now.

3. **`feat(workflows): capture gate decision timeline in StepState`**
   `plugins/workflows/lib/runtime.ts` + runtime tests. `advanceWorkflow` sets `requestedAt`; `approveGate`/`rejectGate` accept optional `approver`, set `decidedAt`, persist. Discord handler still passes nothing — fields populated only via runtime, not yet visible in Discord.

4. **`refactor(workflows): preserve context in editDiscordGateMessage`**
   `plugins/workflows/lib/notifications.ts` + notification tests. Rewrite edit to GET-and-preserve, accept new signature. Update the single caller in `plugins/workflows/index.ts` to pass the new args (pulled from the freshly-loaded instance). Discord card now retains its original fields after a decision.

5. **`feat(workflows): two-message Discord approval pattern`**
   Add `sendDiscordGateSummary` to `notifications.ts` + tests; wire into the Discord interaction handler and the REST approve/reject handlers. Audit payloads extended with `approver`, `gateLabel`, timestamps, `durationMs`.

6. **`feat(workflows): thread reply for long gate prior outputs`**
   Add `postThreadReply` helper + tests; `sendDiscordGateAlert` chains a thread post when output exceeds 1024 chars. Independent of commits 4–5; could ship first if priorities shift.

7. **`docs(workflows): document approval audit fields and Discord pattern`**
   Update `.claude/knowledge/` with a workflows approval doc (or extend the existing workflows knowledge doc); update workflows plugin README if one exists; cross-link issue #98 as the follow-up for per-gate formatting. README.md root is not impacted.

Rollback granularity: any commit 4–7 can be reverted in isolation. Commits 1–3 are pure data-model additions; reverting them later would require a follow-up to drop the new `StepState` fields (acceptable since the install is single-user and the JSON files just stop carrying the fields).

## Files touched (estimate)

- `plugins/workflows/types.ts` — add `ApprovalActor`, three `StepState` fields
- `src/core/discord-gateway.ts` — extract approver from interaction payloads
- `plugins/workflows/lib/runtime.ts` — capture timeline; accept approver in approve/reject
- `plugins/workflows/lib/notifications.ts` — rewrite edit, add summary, add thread helper
- `plugins/workflows/index.ts` — pass approver through; wire summary; extend audit payloads; REST handlers source `os.userInfo()`
- `tests/core/discord-gateway.test.ts` — approver extraction
- `tests/plugins/workflows/notifications.test.ts` — new edit shape, summary, thread overflow
- `tests/plugins/workflows/runtime.test.ts` — timeline + approver persistence
- `tests/plugins/workflows/discord-flow.test.ts` — new end-to-end flow test
- `.claude/knowledge/<workflows or new>.md` — document the audit fields and the two-message contract

Estimated diff: ~400–550 lines added, ~60 lines changed/removed across 5 production files + 4 test files + 1 doc.

## Open questions

None at spec time. Discord API capabilities (embed GET, message PATCH, threads-from-message) confirmed against current `notifications.ts` and the Discord v10 docs. All new behavior is fire-and-forget on the Discord side — workflow progression never blocks on Discord I/O.
