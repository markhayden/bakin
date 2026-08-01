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
`plugins/workflows/lib/notifications.ts`. The `approvalChannel` setting is
resolved through `resolveRuntimeChannelRef` (`src/core/channel-aliases.ts` —
the same resolver `bakin_exec_post_channel` uses), so it may be an alias from
`notifications.channelAliases`, a `provider:target` ref, or a bare runtime
channel id. Resolution failure logs at **error** level and skips delivery; the
durable approval record is created before resolution, so rehydration can retry
once the config is fixed. The adapter renders the approval in whatever
provider it owns (buttons, commands, links, or plain text) and returns
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
Native buttons are used regardless of `requireRejectReason` — the reason
requirement binds only surfaces that can collect one (Bakin UI and the
fallback decision page, both of which enforce a typed reason
unconditionally). A channel button reject with no comment records the
provider-neutral default reason `Rejected via runtime channel (no reason
provided)` (`plugins/workflows/lib/channel-approvals.ts`).

On Pi, the same surface is served by the Discord delivery bridge when
configured (#669, `delivery: 'shimmed'` — `.claude/knowledge/delivery-bridge.md`):
buttoned cards with a Review-in-Bakin link, an approver allowlist that fails
closed, and — unlike the OpenClaw native path — a Discord MODAL that collects
the typed reject reason (`requireRejectReason` makes the input required), so
bridge rejects carry the real reason instead of the canned default. Consumers
in this plugin are unchanged: the bridge emits the same
`ApprovalResolveEvent` into `wireChannelApprovals`.

Provider approval buttons are a convenience surface, not Bakin state. OpenClaw
native approval requests can expire before a workflow gate does, and provider
events may be missed if Bakin is offline. The durable Bakin approval record and
the Bakin fallback approval URL remain canonical.

**Threaded gate messaging:** because the native card is capped at 256 chars
(upstream), `sendGateApprovalRequest` delivers gate context as normal rich
messages. When the adapter exposes the optional `channels.createThread` /
`channels.editMessage` capabilities (OpenClaw does, via `message thread
create` / `message edit`), the channel gets ONE compact root card (header,
output preview, links), a thread anchored to it carries the full labeled
output + media (assetIds from prior output resolved through the
`assets.resolveServe` hook), and the native button card is routed into the
thread via `context.threadId` → `turnSourceThreadId`. On decision, the root
card is edited in place into a receipt and the summary posts inside the
thread — the channel stays one-card-per-gate. Without threading capabilities
(mock adapters, other providers) everything falls back to the previous flat
layout; callers MUST feature-detect, never error on absence. Delivery refs on
the durable record encode the structure: `message:<id>` (root),
`thread:<id>` (thread marker), `openclaw-plugin-approval:<id>` (native card).
Best-effort throughout — context/thread failures log warns and never block
the approval. Decision links omit the approvalId (the page resolves the
newest pending record via `findPendingApprovalForGate`; explicit ids still
bind). `BAKIN_URL` should be set to a network-reachable host (e.g. Tailscale
hostname) or links render as localhost. The watchdog's per-gate
general-channel ping was retired in favor of this.

Native request hardening (all in `packages/adapter-openclaw/src/runtime.ts`):

- Gate requests send `allowedDecisions: ['allow-once', 'deny']` so OpenClaw
  never offers "Always allow" — gates are one-shot human decisions and
  persistent trust must not exist for them. Button labels themselves
  ("Allow once"/"Don't allow") are OpenClaw's UI and not customizable.
- If OpenClaw returns a **pre-resolved** decision at request time (a persisted
  allow rule — no human saw a prompt), the adapter suppresses the phantom
  resolve event and falls back to the rendered message + Bakin link so a
  human decides. Any gate approved via an `allow-always` decision logs a
  loud warning.
- Prompt **delivery routing** (verified against OpenClaw's shipped
  `extensions/discord/src/approval-native.ts`): the native prompt posts into
  a channel only when the request's `turnSourceTo` carries an explicit
  `channel:`/`group:` prefix — a bare id silently falls back to approver
  DMs. Bakin passes the resolved alias target through as `turnSourceTo`, so
  Discord approval aliases MUST be fully qualified as
  `discord:channel:<id>` in `notifications.channelAliases`.
  `channels.discord.execApprovals.target` (`dm|channel|both`) controls the
  DM copy. `approvals.plugin.*` forwarding is a separate plain-message
  pipeline, not the native-buttons path — don't chase it for gates.

## Approval Store GC

Startup rehydration (`plugins/workflows/lib/approval-rehydration.ts`) garbage
collects the durable store before reattaching deliveries: resolved records
(`approved`/`rejected`/`cancelled`/`expired`) older than 30 days are deleted
(`pruneResolvedApprovalRecords`), and pending records whose workflow instance
is missing, mismatched, or no longer pending at that gate are cancelled with
an `orphaned:` reason. Pending records for live gates are never pruned or
cancelled — a live gate whose alert simply has not rendered yet stays pending
so `findPendingApprovalForGate` and re-render keep working. The rehydration
summary carries `pruned`/`cancelled` counts and is logged whenever GC did
work. Consequence: a fallback decision link for a record pruned by age renders
404 "Approval Not Found" instead of "already decided".

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
      "id": "main-operator",
      "displayName": "Main Operator"
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
- `.claude/knowledge/adapter-architecture.md` — durable approval and channel adapter contract
