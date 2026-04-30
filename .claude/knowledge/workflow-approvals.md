# Workflow Approvals — Decision Trace and Runtime Channels

How gate decisions are recorded and surfaced. Approval state is Bakin-owned;
runtime channel adapters only render and resolve delivery refs.

## Decision Record

Every gate decision produces one durable record across three surfaces:

| Surface | Where | What it carries |
|---|---|---|
| **`StepHistoryEntry`** | `~/.bakin/workflows/instances/<task>.json` -> `history[]` | The truth. Survives rejection rewinds. Includes `approver`, `requestedAt`, `completedAt`, and `rejectionReason`. |
| **`StepState`** | Same file -> `stepStates[stepId]` | Live snapshot. `requestedAt` is set when the gate enters `pending_approval`; `decidedAt` + `approver` are set on approve. |
| **`audit.jsonl`** | `~/.bakin/audit.jsonl` | `gate.approved` / `gate.rejected` events with `taskId`, `stepId`, `gateLabel`, `approver`, `requestedAt`, `decidedAt`, `durationMs`, and optional `reason`. |

`approveGate` / `rejectGate` in `plugins/workflows/lib/runtime.ts` return a
`GateDecisionRecord` projection so callers can emit summaries and audit payloads
without reloading the instance after mutation.

## ApprovalActor

```ts
interface ApprovalActor {
  id: string
  displayName?: string
  source: 'channel' | 'web' | 'system'
}
```

The shared type lives in `packages/core/src/plugin-types.ts`.

| `source` | When it is used |
|---|---|
| `channel` | A user action arrived through the active runtime channel adapter. |
| `web` | User clicked the corresponding Bakin UI / REST gate action. |
| `system` | Automation such as watchdog or scheduled cleanup. Reserved unless a caller is truly non-human. |

## Runtime Channel Rendering

When a gate enters `pending_approval` and channel gate alerts are enabled,
workflows call `runtime.channels.createApproval()` through
`plugins/workflows/lib/notifications.ts`. The adapter renders the approval in
whatever provider it owns (buttons, commands, links, or plain text) and returns
delivery refs. Bakin persists those refs on the step state only so later
resolve/cancel operations can target the same rendered message.

When a decision is recorded, workflows call `runtime.channels.resolveApproval()`
and `runtime.channels.sendNotification()` where appropriate. These calls are
fire-and-forget: channel delivery failures log but never block workflow
progression. The workflow instance and audit log remain canonical.

OpenClaw channel approvals are interactive only for configured channels that
advertise `interactive-approval`. The OpenClaw adapter uses native
`plugin.approval.*` gateway requests for those channels and maps provider
decisions back to Bakin `approvalId` values. Channels without real runtime
approval responses stay render-only and include a Bakin approval link.
Requests that require a reject reason also stay on the Bakin fallback page
unless the provider can collect a structured reason.

Provider approval buttons are a convenience surface, not Bakin state. OpenClaw
native approval requests can expire before a workflow gate does, and provider
events may be missed if Bakin is offline. The durable Bakin approval record and
the Bakin fallback approval URL remain canonical. Reject responses that require
a reason must include one; no-reason channel rejects are ignored and the user is
sent back to the Bakin approval link.

## Long Prior Outputs

Prior output previews are rendered by Bakin before they are sent to the adapter.
Adapters may split, thread, attach, truncate, or otherwise provider-format long
content. Bakin should not contain provider limits such as message length caps.

## Audit JSONL Shape

```jsonc
{
  "ts": "2026-04-13T12:35:42Z",
  "event": "gate.approved",
  "agent": "web",
  "data": {
    "taskId": "task-42",
    "stepId": "review-gate",
    "gateLabel": "Final review",
    "approver": {
      "source": "web",
      "id": "roscoe",
      "displayName": "Roscoe"
    },
    "requestedAt": "2026-04-13T12:30:00Z",
    "decidedAt": "2026-04-13T12:35:42Z",
    "durationMs": 342000
  }
}
```

`gate.rejected` has the same shape plus `data.reason: string`.

## Runtime API

```ts
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

Both signatures use options objects so `approver` and `contentDir` cannot be
confused at call sites.

## Cross-References

- `.claude/knowledge/plugin-system.md` — audit + activity API
- `.claude/knowledge/repo-architecture.md` — workflows plugin
- `.claude/specs/adapter-layer.md` — durable approval and channel adapter contract
