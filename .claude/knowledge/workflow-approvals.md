# Workflow Approvals — Decision Trace and Discord Pattern

How gate decisions are recorded and surfaced. Issue #91 reshaped this
end-to-end. Per-gate notification customization (overriding defaults per
workflow YAML) is tracked separately in #98.

## The decision record

Every gate decision produces one durable record across three surfaces:

| Surface | Where | What it carries |
|---|---|---|
| **`StepHistoryEntry`** | `~/.bakin/workflows/instances/<task>.json` → `history[]` | The truth. Survives the rewind reset that wipes the gate's `stepStates` back to `pending` for re-presentation on rejection. Includes `approver`, `requestedAt`, `completedAt`, `rejectionReason`. |
| **`StepState`** | Same file → `stepStates[stepId]` | Live snapshot. `requestedAt` set when the gate enters `pending_approval`; `decidedAt` + `approver` set on approve. On reject the rewind loop resets this to `{ status: 'pending' }`, so look in history for rejected-gate detail. |
| **`audit.jsonl`** | `~/.bakin/audit.jsonl` | `gate.approved` / `gate.rejected` events with `taskId`, `stepId`, `gateLabel`, `approver`, `requestedAt`, `decidedAt`, `durationMs` (and `reason` on reject). Memory plugin renders these. |

The `GateDecisionRecord` returned by `approveGate` / `rejectGate`
(`plugins/workflows/lib/runtime.ts`) is the in-process projection of the
above — callers (Discord handler, REST handlers) read it directly instead
of reloading the instance after the mutation.

## ApprovalActor

```ts
interface ApprovalActor {
  id: string                // Discord user id, OS username, or 'system'
  displayName?: string      // Discord global_name/username, OS username
  source: 'discord' | 'web' | 'system'
}
```

Defined in `packages/core/src/plugin-types.ts` so both `src/core/discord-gateway.ts`
and the workflows plugin import from a shared location (cross-boundary
import from `src/core/` into `plugins/` is layering-incorrect — the type
lives in core where it can be neutrally consumed).

| `source` | When it's used | `id` / `displayName` |
|---|---|---|
| `discord` | User clicked Approve/Reject in Discord | Real Discord user id; `global_name` preferred over `username` |
| `web` | User clicked the corresponding button in the Bakin UI (REST `/api/plugins/workflows/gates/:taskId/approve` or `/reject`) | OS username from `os.userInfo()` — single-user behind Tailscale, machine-level granularity is enough |
| `system` | Auto-approve, watchdog, scheduled cleanup. Reserved — no callers today, kept distinct from `web` so a future automation doesn't get conflated with a human REST click. | `'system'` / undefined |

If a Discord interaction payload is malformed and contains neither
`member.user` nor `user`, the gateway uses an `'unknown'` sentinel and
logs a warning. Should never happen in a guild — defensive-only.

## Two-message Discord pattern

When a gate enters `pending_approval` with `discordGateAlerts=true`:

1. **Awaiting card** — `sendDiscordGateAlert` posts a yellow embed with
   the gate label, workflow id, task id, step id, prior output preview,
   and Approve/Reject buttons. Discord message id is persisted on
   `StepState.discordMessageId` so we can edit it later.

When a decision is recorded:

2. **Edit in place** — `editDiscordGateMessage` GETs the existing message,
   preserves its `title` and `fields`, appends `Decision` + `Decided by`
   (and `Reason` on reject), updates the color (green/red), and removes
   the buttons. If the GET fails (missing `READ_MESSAGE_HISTORY`, message
   deleted), it falls back to a stripped embed and logs.

3. **Standalone summary** — `sendDiscordGateSummary` posts a second embed
   to the same channel carrying the full record: gate label as the title,
   gate description as the body, and fields for Decision, Decided by,
   Workflow, Task, Step, Requested (Discord relative timestamp), Decided,
   Duration, optional Reason, with the instance id in the footer. This is
   the durable trace someone scrolling the channel reads to understand
   what happened.

Both messages are fire-and-forget — Discord failures log but never block
workflow progression. The audit JSONL is the canonical record either way.

## Thread overflow for long prior outputs

The awaiting card's `Prior Output` field is capped per-key at 200 chars
in the preview. If the **full** content exceeds 1024 chars across all
keys, `postThreadReply` starts a thread on the gate message and posts
the full text inside, splitting across multiple thread messages if any
single chunk would exceed Discord's 2000-char message limit. The embed
field gets a `_Full output posted in thread below._` note.

Thread name format: `${workflowId} — ${gateLabel}`, truncated to
Discord's 100-char cap.

## Required Discord bot permissions

For the approvals channel:

- `VIEW_CHANNEL` — required to GET messages and post
- `READ_MESSAGE_HISTORY` — required for `editDiscordGateMessage`'s GET
- `SEND_MESSAGES` — for both the awaiting card and the summary
- `CREATE_PUBLIC_THREADS` — for the prior-output overflow thread
- `SEND_MESSAGES_IN_THREADS` — to post inside the overflow thread

Any of these missing degrades gracefully:

| Missing | Effect |
|---|---|
| `READ_MESSAGE_HISTORY` | Edit falls back to stripped embed; summary message and audit log unaffected |
| `CREATE_PUBLIC_THREADS` | Overflow thread fails with a logged warning; awaiting card with truncated preview still lands |
| `SEND_MESSAGES_IN_THREADS` | Thread is created but empty; warning logged per failed message post |
| `SEND_MESSAGES` (entirely) | Both alert and summary fail; gate decisions still flow through the runtime and audit log |

## Audit JSONL shape

```jsonc
{
  "ts": "2026-04-13T12:35:42Z",
  "event": "gate.approved",
  "agent": "discord",         // or 'web' for REST/UI clicks; 'system' reserved
  "data": {
    "taskId": "task-42",
    "stepId": "review-gate",
    "gateLabel": "Final review",
    "approver": {
      "source": "discord",
      "id": "111222333",
      "displayName": "Mark Hayden"
    },
    "requestedAt": "2026-04-13T12:30:00Z",
    "decidedAt": "2026-04-13T12:35:42Z",
    "durationMs": 342000
  }
}
```

`gate.rejected` has the same shape plus `data.reason: string`.

The `agent` field's source tag aligns with `data.approver.source` —
`discord` events come from button clicks, `web` events come from REST
hits (the Bakin UI today, future CLI tomorrow), `system` is reserved
for non-human deciders. The historical `'system'` REST audits (pre-#91)
are unmigrated; treat them as ambiguous.

## Runtime API

```ts
// All optional fields default to undefined; both functions return a
// GateDecisionRecord in result.decision so callers can render Discord
// summaries and audit payloads without reloading the instance.

approveGate(taskId, stepId, opts?: {
  approver?: ApprovalActor
  contentDir?: string
})

rejectGate(taskId, stepId, reason, opts?: {
  approver?: ApprovalActor
  rewindTo?: string
  contentDir?: string
})
```

Both signatures are options-objects rather than positional — issue #91
plan called this out as a tech-debt win to prevent silent bugs at the
~8 call sites where a `contentDir: string` would have looked
indistinguishable from an `approver: object` had we appended positionally.

## Cross-references

- Spec: `.claude/specs/issue-91-discord-approvals.md`
- Plan: `.claude/specs/issue-91-discord-approvals-PLAN.md`
- Follow-up: GitHub issue #98 (`notify_format` per-gate YAML overrides)
- Related: `.claude/knowledge/plugin-system.md` (audit + activity API),
  `.claude/knowledge/repo-architecture.md` (workflows plugin)
