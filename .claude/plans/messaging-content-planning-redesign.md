# Messaging Plugin Top-to-Bottom Refactor

## Context

Today the Messaging plugin (lives in `bakin-bits-official/plugins/messaging/`, not Bakin core) treats a single `scheduledAt` field as both **when content publishes** and **when the agent should start working**. Once a `CalendarItem` is brainstormed and "scheduled," nothing happens — there is no sweep, no dispatch, no task creation. The `taskId` field on items is declared but never set; statuses `executing | waiting | failed` are defined but never assigned. Content created via brainstorm sits in a vacuum until the user manually does the work.

This refactor rebuilds the plugin around **content planning** as a first-class workflow: an agent helps the user brainstorm in an open-ended way; each accepted topic crystallizes into its own **Plan** (e.g., "Taco Tuesday"); each Plan fans out into per-channel **Deliverables**; each Deliverable has its own prep window (distinct from publish time), a dedicated agent does the prep work as a Bakin task (optionally backed by a workflow with gates), the user reviews drafts, and a sweep publishes at the right moment. The plugin becomes laser-focused on planning + executing content plans for a business, while keeping a one-off "Quick post" path so simple content creation isn't gated by the planning machinery.

Linked issues: **#190** (top-to-bottom redesign) and **#156** (planning prompt strengthening) are in scope. **#191** (generic plugin-contributed scheduled domain events) is deferred — it is explicitly non-blocking, benefits multiple plugins, and deserves its own design pass.

## Decisions log (interview outcomes)

| # | Decision |
|---|---|
| 1 | **Domain model: 3 entities — `BrainstormSession` / `Plan` / `Deliverable`.** A brainstorm session is open-ended and can birth multiple Plans. Each Plan is one topic/day (e.g., "Taco Tuesday") with its own brief, channels, agent, and date. Each Plan has 0..N Deliverables (per-channel work). `Deliverable.taskId` is the only bridge to the Bakin Tasks plugin which executes prep work. |
| 2 | Fan-out: two-phase. Brainstorm produces Plan proposals; user accepts proposals → Plans are created; on Plan confirm (or directly on creation), ONE Bakin "planning task" spawns per Plan; the assigned agent calls `bakin_exec_messaging_propose_deliverable` once per channel; user approves/edits/rejects each proposed Deliverable in the UI. |
| 3 | Timing: `Plan.targetDate` is a soft anchor with no triggers. `Deliverable.publishAt` is the precise publish time. `Deliverable.prepStartAt` is derived as `publishAt − contentType.prepLeadHours`, with a per-Deliverable `prepStartAtOverride` for rush jobs / extended prep. |
| 4 | Prep flow: hybrid — `ContentTypeOption` gains an optional `workflowId`. When set, prep runs as a workflow instance; when unset, prep runs as a bare Bakin task with column transitions. Ship `messaging-blog-prep` and `messaging-video-prep` defaults (valid against the current workflows schema; no templating). |
| 5 | Phase-2 shape: bare Bakin task (no new session/workflow entity for fan-out). Agent uses one exec tool — `bakin_exec_messaging_propose_deliverable` — to emit Deliverable proposals; user reviews in the messaging UI. |
| 6 | Missed publishAt: defer to `overdue` status, notify the assigned agent's owner channel, surface recovery actions (Extend / Approve-and-publish-now / Cancel). Never publish unapproved content. |
| 7 | Quick path: `Deliverable.planId` is nullable. A header-level `[+ Quick post]` button creates a free-floating Deliverable directly. Quick Post supports any contentType, including media-required ones — the dialog offers an optional "Attach existing asset" picker, but the user can skip it and let the prep agent generate the asset; publish-time asset validation gates delivery, so an image-required Deliverable that ends up with no asset fails to publish cleanly. |
| 8 | Issue scope: #190 + #156 in scope; #191 deferred. |
| 9 | Storage: file-per-entity in typed subdirectories under `~/.bakin/plugin-data/messaging/` (`plans/`, `deliverables/`, `sessions/`). Atomic write-rename helper owned by messaging because core's `ScopedPluginStorageAdapter.writeJson` is not atomic. No top-level `messaging.json`. |
| 10 | Review surface: messaging owns `Deliverable.status` as the unified state machine; both bare-task and workflow-gate paths converge to `in_review` (when `contentType.requiresApproval !== false`) and resolve in the messaging UI. |
| 11 | Commit strategy: two PRs — PR-A in Bakin core for `plugin:settings-changed` SSE event AND `workflows.approveGate`/`workflows.rejectGate` hooks; PR-B in `bakin-bits-official` as one coherent refactor composed of ~22 atomic commits. No backwards-compat shims. |
| 12 | Navigation: **three top-level routes** — `/messaging/calendar` (default landing, global map), `/messaging/plans` (Plan list + Plan workspace), `/messaging/brainstorm` (free-standing ideation; sessions list + per-session chat). A brainstorm session can produce multiple Plans. Quick post lives as a header-level button. Reviews surface on Calendar via filter chip + status badges (no standalone Review route). |

## Domain model

```
BrainstormSession              ~/.bakin/plugin-data/messaging/sessions/{sessionId}.json
  id
  agentId                      who Mark is brainstorming with
  title                        user-supplied or auto-generated
  scope                        optional free-text scope ('next 4 days', 'Q2', etc.)
  status                       'active' | 'archived'
  messages[]                   SessionMessage[]
  proposals[]                  PlanProposal[]   ← shape changed; see below
  createdAtPlanIds[]           Plan ids that this session produced (audit trail)
  createdAt, updatedAt

PlanProposal (lives inside BrainstormSession.proposals)
  id, messageId, revision
  agentId
  title                        'Tacos'
  targetDate                   ISO date
  brief                        2–3 sentence focus
  suggestedChannels[]          optional hint; not binding
  status                       'proposed' | 'approved' | 'rejected' | 'revised'
  planId?                      set when materialized to a Plan
  rejectionNote?

Plan                           ~/.bakin/plugin-data/messaging/plans/{planId}.json
  id
  title                        'Taco Tuesday'
  brief                        focus / topic
  targetDate                   ISO date; soft anchor
  agent                        lead agent (defaults from session)
  status                       'planning' | 'fanning_out' | 'in_prep' |
                               'in_review' | 'scheduled' | 'overdue' |
                               'partially_published' | 'done' |
                               'cancelled' | 'failed'
  fanOutTaskId                 FK to the phase-2 Bakin task (nullable until confirm)
  sourceSessionId              optional FK to the BrainstormSession that birthed it
  campaign?: string            optional free-text grouping tag (no entity above Plan)
  suggestedChannels[]          carried over from PlanProposal as a hint
  createdAt, updatedAt

Deliverable                    ~/.bakin/plugin-data/messaging/deliverables/{deliverableId}.json
  id
  planId                       nullable for Quick Post
  channel                      runtime channel id
  contentType                  taxonomy id
  tone
  agent                        the prep agent
  title, brief
  publishAt                    ISO datetime
  prepStartAt                  derived: publishAt − contentType.prepLeadHours
  prepStartAtOverride          optional ISO datetime
  status                       'proposed' | 'planned' | 'in_prep' | 'in_review' |
                               'changes_requested' | 'approved' | 'published' |
                               'overdue' | 'cancelled' | 'failed'
  taskId                       FK to the prep Bakin task (set when status >= in_prep)
  workflowInstanceId           FK to workflow instance (set via workflows.loadInstance
                               lookup AFTER ctx.tasks.create({ workflowId }) — we do
                               not call workflows.createInstance ourselves)
  pendingGateStepId            captured from 'workflow.gate_reached' event for later
                               approve/reject calls
  draft { caption, imagePrompt, videoPrompt, imageFilename, videoFilename, agentNotes }
  rejectionNote                from 'changes_requested'
  failureReason                set whenever status transitions to 'failed'; required
  failedAt                     ISO timestamp; set with failureReason
  publishedAt, publishedDeliveryRef
  createdAt, updatedAt

ContentTypeOption (extended)   stored in plugin settings
  id, label                    existing fields
  prepLeadHours: number        default lead time; e.g., blog=72, video=168, x-post=4
  workflowId?: string          optional prep workflow definition id (must exist)
  requiresApproval?: boolean   default true; see "requiresApproval semantics" below
  defaultAgent?: string        optional channel-specialist agent
  assetRequirement?: 'none'           default; text-only content
                  | 'optional-image'  may include an image; not required
                  | 'image'           must have an image asset
                  | 'optional-video'  may include a video; not required
                  | 'video'           must have a video asset
                               UI + publish-time validation enforce this:
                               - drawer disables Approve if required asset missing
                               - publish sweep / workflow.complete handler fails the
                                 Deliverable to 'failed' with a clear reason if a
                                 required asset is missing or its fileRef cannot
                                 be resolved
                               Shipped defaults:
                                 blog          → 'optional-image'
                                 video         → 'video'
                                 x-post        → 'optional-image'
                                 image         → 'image'        (Instagram-style)
                                 announcement  → 'none'

MessagingSettings (extended)   stored in plugin settings
  defaultView                  existing
  contentTypes[]               existing, but now richer per above
  channels                     existing
  sweepCronSchedule            cron expression; default '*/5 * * * *'
```

### Plan.status aggregation rules

Plan status is **derived from its Deliverables** plus a few state-machine rules. The plugin recomputes Plan.status whenever a child Deliverable changes status, in a single helper `recomputePlanStatus(planId)`:

| Plan.status | Trigger |
|---|---|
| `planning` | Plan created (from brainstorm or manually); no fan-out task yet OR fan-out task in progress AND no Deliverables yet. |
| `fanning_out` | Fan-out task exists, agent has proposed at least one Deliverable, but at least one Deliverable is still in `proposed` status (user hasn't reviewed yet). |
| `in_prep` | All Deliverables are at or beyond `planned`; at least one is in `planned`, `in_prep`, or `changes_requested`. |
| `in_review` | At least one Deliverable is in `in_review` AND none are still in `in_prep` or earlier. |
| `scheduled` | All non-terminal Deliverables are `approved` and waiting for `publishAt`; none are `planned`, `in_prep`, `changes_requested`, or `in_review`. |
| `overdue` | At least one Deliverable is `overdue` AND no Deliverables are still in `planned`, `in_prep`, `changes_requested`, or `in_review`. |
| `partially_published` | At least one Deliverable is `published` AND at least one is still in a non-terminal state (not `published`/`cancelled`/`failed`). |
| `done` | All Deliverables are in `published`, `cancelled`, or `failed` AND at least one is `published`. |
| `cancelled` | All Deliverables are `cancelled` OR Plan was explicitly cancelled (user action; also cancels all its non-terminal Deliverables). |
| `failed` | All Deliverables are terminal (`cancelled` or `failed`) AND none are `published`, or the Plan was explicitly marked failed by an operator. |

A Plan with zero Deliverables is `planning`. A Plan whose fan-out task failed (Bakin task moved to `archived` without producing Deliverables) sits in `planning` with a UI warning surfacing the fan-out task's failure state. These rules are ordered: explicit Plan cancellation wins first, then zero-Deliverable planning, then all-terminal states (`done` / `cancelled` / `failed`), then `partially_published`, `overdue`, `in_review`, `in_prep`, `scheduled`, and finally `fanning_out`.

### Default content types (shipped in settings on first activate)

| id | label | assetRequirement | prepLeadHours | workflowId | requiresApproval | defaultAgent |
|---|---|---|---|---|---|---|
| `blog` | Blog post | `optional-image` | 72 | `messaging-blog-prep` | true | _(none)_ |
| `video` | Video | `video` | 168 | `messaging-video-prep` | true | _(none)_ |
| `x-post` | X post | `optional-image` | 4 | _(none — bare task)_ | true | _(none)_ |
| `image` | Image post | `image` | 24 | `messaging-image-post-prep` | true | _(none)_ |
| `announcement` | Announcement | `none` | 1 | _(none — bare task)_ | false | _(none)_ |

Seeding logic on first activate is idempotent: if `settings.contentTypes` is absent, write the canonical defaults above. If contentTypes already exist, normalize them by `id`: preserve user-edited fields (`label`, `defaultAgent`, channel choices, custom ids), but fill missing new fields from shipped defaults (`prepLeadHours`, `assetRequirement`, `requiresApproval`, and default `workflowId` where the id matches a shipped type). If a contentType references a `workflowId` whose definition can't be loaded at activate time, log a warning per missing id and clear the workflowId reference for that contentType in the normalized settings (degrades to bare-task lifecycle).

### Draft update merge semantics

`PUT /deliverables/:id` and the `bakin_exec_messaging_deliverable_update` exec tool **deep-merge** the `draft` object into the existing Deliverable.draft. Workflow steps call the update tool multiple times during prep (once for caption, once for imageFilename, etc.); shallow replacement would wipe earlier fields. Concretely:

```ts
async function updateDeliverable(id: string, patch: Partial<Deliverable>) {
  const existing = await readDeliverable(id)
  const next: Deliverable = { ...existing, ...patch }
  if (patch.draft) {
    next.draft = { ...existing.draft, ...patch.draft }  // one-level deep merge
  }
  await atomicWriteJson(deliverablePath(id), next)
}
```

Tests in `storage/deliverables.test.ts` cover:
- Two sequential updates `{ draft: { caption: 'a' } }` then `{ draft: { imageFilename: 'x.png' } }` produce a final draft of `{ caption: 'a', imageFilename: 'x.png' }`.
- Update with `{ draft: { caption: null } }` explicitly clears caption (null is a sentinel for "clear this field").
- Top-level fields outside `draft` remain shallow-replace semantics (no surprise deep-merging of arrays like `suggestedChannels`).

### Shared publish helpers

The publish-sweep bare-task path, the workflow.complete event handler, and the bare-task approve-and-publish-now recovery route publish through shared helpers in `lib/publish.ts`. `buildFilesFromDraft` resolves draft asset filenames into the `files: AssetFileRef[]` array passed to `ctx.runtime.channels.deliverContent`; `publishDeliverableNow` wraps asset resolution, delivery, success persistence, failure persistence, audit, and notification so delivery behavior cannot drift across call sites:

```ts
type BuildResult =
  | { ok: true; files: AssetFileRef[] }
  | { ok: false; reason: string }

export async function buildFilesFromDraft(
  deliverable: Deliverable,
  contentType: ContentTypeOption,
  ctx: PluginContext,
): Promise<BuildResult> {
  const files: AssetFileRef[] = []
  const req = contentType.assetRequirement ?? 'none'
  for (const kind of ['image', 'video'] as const) {
    const filename = (deliverable.draft as any)[`${kind}Filename`] as string | undefined
    const isRequired = req === kind
    if (filename) {
      try {
        files.push(await ctx.assets.fileRef(filename))
      } catch (err) {
        return { ok: false, reason: `Asset ${filename} (${kind}) not resolvable: ${(err as Error).message}` }
      }
    } else if (isRequired) {
      return { ok: false, reason: `Required ${kind} asset missing on Deliverable` }
    }
  }
  return { ok: true, files }
}
```

When `buildFilesFromDraft` returns `{ ok: false, reason }`, `publishDeliverableNow` transitions the Deliverable to `failed` and sets `failureReason: reason`, `failedAt: new Date().toISOString()`. `publishDeliverableNow` also catches `ctx.runtime.channels.deliverContent` errors or missing delivery entries, stores a clear failure reason, audits the failure, notifies the owner channel, and returns `{ ok: false, reason }` instead of throwing to sweep/event callers. Asset-resolution and publish-helper test cases cover every branch (required-missing, optional-missing-ok, fileRef-throws-image, fileRef-throws-video, both-present, content-type-none, deliverContent-throws, and missing-delivery-entry).

### requiresApproval semantics

`ContentTypeOption.requiresApproval` controls whether the **bare-task** path forces an `in_review` step before publish. **Asset validation runs in both branches** — `requiresApproval=false` skips the review queue but does NOT skip the required-asset check.

- `requiresApproval !== false` (default): when the agent calls `bakin_exec_messaging_deliverable_ready_for_review`, route handler validates that any `assetRequirement` is satisfied (via `buildFilesFromDraft`). If validation succeeds, transition `in_prep → in_review`. If validation fails, return a 400-class error to the agent with the reason; Deliverable remains `in_prep` so the agent can fix.
- `requiresApproval === false`: same validation runs. If it passes, transition directly `in_prep → approved`. If it fails, return the error; Deliverable stays `in_prep`.

For the **workflow-backed** path, `requiresApproval` is ignored — the workflow's own gate steps govern review. If the workflow has no gate steps, `workflow.complete` fires and messaging's event handler runs `publishDeliverableNow`; on asset or delivery failure the Deliverable transitions to `failed` with the reason.

**Approve route validation.** `POST /deliverables/:id/approve` ALSO runs `buildFilesFromDraft`. UI disables the Approve button when required assets are missing (drawer test), but if a caller approves via the route directly (exec tool, curl, agent), the route enforces the same rule. Returns 400 with the reason; Deliverable remains in its prior status. Route test cases verify this. `POST /deliverables/:id/approve-and-publish-now` is supported only for bare-task Deliverables (`workflowInstanceId == null`); workflow-backed Deliverables return 409 with guidance to use normal Approve so `workflow.complete` remains the sole workflow publish signal. On the bare path, approve-and-publish-now uses `publishDeliverableNow` after setting `approved`, so it enforces the same asset validation and delivery failure handling.

## Lifecycle

```
┌──────────────────── Phase 1: Brainstorm (free-standing) ─────────────────────┐
│ User opens /messaging/brainstorm (or resumes a session).                      │
│ Creates a new session (agent, title, optional scope text).                    │
│ Chat back-and-forth. Agent emits ```json Plan proposals — one per topic/day.  │
│ User approves / edits / rejects each Plan proposal in the review panel.       │
│ User clicks [Materialize approved] → for each approved PlanProposal:          │
│   create Plan row; PlanProposal.planId set; session.createdAtPlanIds appended.│
│ Session stays `active` (user can come back; spawn more Plans later).          │
│ User can archive the session at any time.                                     │
└─────────────────────────────────────────┬─────────────────────────────────────┘
                                          │
┌──────────── Phase 2: Per-Plan fan-out (Plan workspace) ──────────────────────┐
│ User navigates to the Plan workspace (or stays in brainstorm and follows a   │
│ link). Plan.status starts as `planning`.                                     │
│                                                                              │
│ User clicks [Start fan-out] OR phase-2 auto-starts on Plan creation if       │
│ Plan.agent is set:                                                           │
│   ctx.tasks.create({                                                         │
│     parentId:    null,                                                       │
│     agent:       Plan.agent,                                                 │
│     column:      'todo',                                                     │
│     title:       'Plan: ' + Plan.title,                                      │
│     description: Plan.brief + ' Use bakin_exec_messaging_propose_deliverable │
│                  for each channel you intend to produce.',                   │
│     // no workflowId — fan-out is bare-task                                  │
│   })                                                                         │
│   Plan.fanOutTaskId = task.id                                                │
│   Plan.status       = 'fanning_out'                                          │
│                                                                              │
│ Dispatch fires task. Agent reads Plan context (via                           │
│ bakin_exec_messaging_plan_get tool), calls                                   │
│ bakin_exec_messaging_propose_deliverable once per channel. Each call         │
│ creates a Deliverable with status='proposed'. Agent marks task done.         │
│                                                                              │
│ User reviews proposed Deliverables in Plan workspace:                        │
│   [Approve] [Reject] [Edit channel/brief/publishAt]                          │
│ On Approve: Deliverable.status = 'planned'                                   │
│ recomputePlanStatus(Plan.id)                                                 │
└─────────────────────────────────────────┬─────────────────────────────────────┘
                                          │
┌──────────── Phase 3: Per-Deliverable prep (cron-driven) ─────────────────────┐
│ Sweep cron fires per sweepCronSchedule.                                      │
│                                                                              │
│ For each Deliverable status='planned' and now >= (prepStartAtOverride        │
│                                                  ?? prepStartAt):            │
│   status = 'in_prep'                                                         │
│   const task = await ctx.tasks.create({                                      │
│     title:       'Prep: ' + Plan.title + ' — ' + channel,                    │
│     agent:       Deliverable.agent,                                          │
│     column:      'todo',                                                     │
│     description: brief + draft hints + agent guidance,                       │
│     workflowId:  contentType.workflowId || undefined,                        │
│   })                                                                         │
│   Deliverable.taskId = task.id                                               │
│   if (contentType.workflowId) {                                              │
│     const inst = await ctx.hooks.invoke<{ instanceId: string }>(             │
│       'workflows.loadInstance', { taskId: task.id })                         │
│     Deliverable.workflowInstanceId = inst?.instanceId                        │
│   }                                                                          │
│                                                                              │
│ Agent works the prep task. On completion:                                    │
│   bare path:     agent calls bakin_exec_messaging_deliverable_ready_for_review│
│                  IF contentType.requiresApproval !== false:                  │
│                    Deliverable.status = 'in_review'                          │
│                  ELSE:                                                       │
│                    Deliverable.status = 'approved'                           │
│   workflow path: workflows emits 'workflow.gate_reached' on the event bus    │
│                  (plugins/workflows/lib/notifications.ts:73).                │
│                  Messaging subscribes via ctx.events.on('workflow.gate_reached'):│
│                    find Deliverable by event.taskId                          │
│                    Deliverable.status = 'in_review'                          │
│                    Deliverable.pendingGateStepId = event.stepId              │
│                                                                              │
│ User reviews in messaging UI (Calendar drawer, Plan workspace):              │
│   [Approve]                                                                  │
│     bare path:                                                               │
│       Deliverable.status = 'approved'                                        │
│       (publish sweep handles delivery at publishAt)                          │
│     workflow path:                                                           │
│       Deliverable.status = 'approved'   ← set BEFORE invoking approveGate    │
│       try {                                                                  │
│         ctx.hooks.invoke('workflows.approveGate', {                          │
│           taskId,                                                            │
│           stepId: pendingGateStepId,                                         │
│           approver: { id: 'mark', source: 'web' },  ← ApprovalActor shape    │
│         })                                                                   │
│       } catch (err) {                                                        │
│         Deliverable.status = 'in_review'                                     │
│         surface gate-resolution warning; return 502 to caller                │
│       }                                                                      │
│       workflow advances per its on_approve config; the workflow.complete     │
│       handler will see status='approved' and publish.                        │
│   [Request changes (note)]                                                   │
│     bare path:                                                               │
│       Deliverable.status         = 'changes_requested'                       │
│       Deliverable.rejectionNote  = note                                      │
│       await ctx.tasks.update(taskId, { column: 'inProgress' })               │
│       await ctx.tasks.appendLog(taskId, {                                    │
│         timestamp: new Date().toISOString(),                                 │
│         author: 'mark',                                                      │
│         message: 'Changes requested: ' + note,                               │
│       })                                                                     │
│       // dispatch loop picks up tasks moved to inProgress without a recent   │
│       // agent reply and re-engages the agent.                               │
│       Deliverable.status = 'in_prep'                                         │
│     workflow path:                                                           │
│       const priorStatus = Deliverable.status                                 │
│       Deliverable.status        = 'changes_requested'                        │
│       Deliverable.rejectionNote = note                                       │
│       try {                                                                  │
│         ctx.hooks.invoke('workflows.rejectGate', {                           │
│           taskId,                                                            │
│           stepId: pendingGateStepId,                                         │
│           reason: note,                                                      │
│           approver: { id: 'mark', source: 'web' },                           │
│         })                                                                   │
│       } catch (err) {                                                        │
│         Deliverable.status = priorStatus                                     │
│         surface gate-resolution warning; return 502 to caller                │
│       }                                                                      │
│       workflow rewinds per its on_reject config (typically goto: draft);     │
│       when workflows re-emits gate_reached on next gate, status flips        │
│       back to 'in_review'.                                                   │
│   [Edit]                  in-place field edit                                │
│                                                                              │
│ recomputePlanStatus(Plan.id)                                                 │
└─────────────────────────────────────────┬─────────────────────────────────────┘
                                          │
┌──────────── Phase 4: Publish (split between sweep + event handler) ──────────┐
│ BARE-TASK PATH — publish sweep:                                              │
│   For each Deliverable status='approved' and publishAt <= now                │
│                                            and workflowInstanceId is null:   │
│     // Single source of truth for asset validation, delivery, failure        │
│     // persistence, audit, and notification.                                │
│     const result = await publishDeliverableNow(deliverable, contentType, ctx)│
│     if (!result.ok) continue                                                 │
│                                                                              │
│ WORKFLOW-BACKED PATH — event handler:                                        │
│   ctx.events.on('workflow.complete', handler):                               │
│     find Deliverable by data.taskId                                          │
│     if Deliverable.workflowInstanceId is null → ignore (not workflow-backed) │
│     if Deliverable.status === 'approved':                                    │
│       // workflow's gate(s) approved messaging-side already; messaging owns  │
│       // the actual publish. Asset filenames must already be on              │
│       // Deliverable.draft — the workflow's agent steps are instructed to    │
│       // call bakin_exec_messaging_deliverable_update with the filename      │
│       // immediately after registering an asset via bakin_exec_assets_save.  │
│       // Same shared helper as bare-task path — no duplicate logic.          │
│       await publishDeliverableNow(deliverable, contentType, ctx)             │
│       // Local event handlers receive only raw `data`; timestamps for        │
│       // publishedAt/failedAt are generated inside publishDeliverableNow.    │
│     else if Deliverable.status !== 'published':                              │
│       // workflow finished while messaging-side status wasn't 'approved' —   │
│       // anomaly (user may have rejected and the workflow had no path back). │
│       Deliverable.status = 'failed'                                          │
│       audit + notify                                                         │
│                                                                              │
│ OVERDUE — sweep handles BOTH paths:                                          │
│   For each Deliverable publishAt <= now AND status NOT IN ('approved',       │
│                              'published', 'overdue', 'cancelled', 'failed'): │
│     Deliverable.status = 'overdue'                                           │
│     ctx.runtime.channels.sendNotification(severity='warn', ...)              │
│     append audit event 'deliverable.publishAt_missed'                        │
│                                                                              │
│ recomputePlanStatus(Plan.id)                                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Deliverable status state machine (canonical)

```
                  ┌── cancelled ◄────────┐
                  │                       │
 proposed ── approve ──► planned          │
                          │               │
                          ▼               │
                       in_prep ──┐        │
                          ▲      │        │
                          │      ▼        │
            changes_requested  in_review  │
                          ▲      │        │
                          └─────┘ │       │
                                  ▼       │
                              approved ───┤
                                  │       │
                                  ▼       │
                              published   │
                          (publishAt missed)
                                  │       │
                                  ▼       │
                              overdue ────┘
                                  ▲
                                  │
                                  └── publishAt fires while status ≠ approved

failed: terminal sink for workflow-completes-without-approval anomalies.
        Also reached from any other state via explicit [Mark failed] UI action.
```

## Server routes and exec tools (messaging plugin)

REST routes (mounted at `/api/plugins/messaging/`):

```
Brainstorm sessions
  GET    /sessions                       list (status filter)
  GET    /sessions/:id                   get
  POST   /sessions                       create (agentId, title, optional scope)
  PUT    /sessions/:id                   update metadata
  DELETE /sessions/:id                   archive (rename status='archived')
  POST   /sessions/:id/messages          SSE streaming; emits Plan proposals
  PUT    /sessions/:id/proposals/:pid    update proposal status / fields
  POST   /sessions/:id/materialize       create Plans from approved proposals;
                                         returns { planIds: string[] }

Plans
  GET    /plans                          list (status, agent filters; campaign)
  GET    /plans/:id                      get
  POST   /plans                          create (manual; bypasses brainstorm)
  PUT    /plans/:id                      update metadata
  DELETE /plans/:id                      delete + cascade Deliverables
  POST   /plans/:id/start-fanout         create the phase-2 Bakin task
  POST   /plans/:id/cancel               cancels plan + all non-terminal Deliverables

Deliverables
  GET    /deliverables                   list (planId, status, channel, publishAt range)
  GET    /deliverables/:id               get
  POST   /deliverables                   create (Quick Post path: planId nullable)
  PUT    /deliverables/:id               update
  POST   /deliverables/:id/approve       → status=approved (bare path; or invokes
                                         workflows.approveGate for workflow path)
  POST   /deliverables/:id/reject        → status=changes_requested (note)
                                         (or invokes workflows.rejectGate)
  POST   /deliverables/:id/approve-and-publish-now
                                         bare-task overdue-recovery only:
                                         approve + immediately publish (single
                                         transaction; workflow-backed returns 409)
  POST   /deliverables/:id/extend-publish-at
                                         body: { newPublishAt }; recalculates
                                         derived prepStartAt; clears overdue if set
  POST   /deliverables/:id/cancel        → status=cancelled
  DELETE /deliverables/:id               hard delete (does NOT cascade-delete the
                                         linked Bakin task; user must tidy)
```

The `/search` route is **NOT** declared by messaging code directly. `ctx.search.registerFileBackedContentType()` auto-registers `GET /api/plugins/messaging/search` and dispatches across all content types messaging registers (`messaging_brainstorm`, `messaging_deliverables`). One unified search endpoint covering both.

Exec tools (canonical names; consistent across the plan):

```
bakin_exec_messaging_plan_list                list plans (filters)
bakin_exec_messaging_plan_get                 get plan
bakin_exec_messaging_plan_create              create plan (bypasses brainstorm)
bakin_exec_messaging_plan_start_fanout        kick off phase-2 task explicitly

bakin_exec_messaging_propose_deliverable      PHASE-2 fan-out exec tool — called by
                                              the agent inside the phase-2 task to
                                              emit one Deliverable per channel

bakin_exec_messaging_deliverable_list         list (filters)
bakin_exec_messaging_deliverable_get
bakin_exec_messaging_deliverable_create       Quick Post (free-floating)
bakin_exec_messaging_deliverable_update
bakin_exec_messaging_deliverable_approve
bakin_exec_messaging_deliverable_reject
bakin_exec_messaging_deliverable_ready_for_review   agent signals prep done (bare path)

bakin_exec_messaging_session_list
bakin_exec_messaging_session_get
bakin_exec_messaging_session_create
bakin_exec_messaging_session_message          SSE stream
bakin_exec_messaging_session_proposal_update  approve/reject/edit a Plan proposal
bakin_exec_messaging_session_materialize      create Plans from approved proposals
```

## Cron sweep

One job registered via `ctx.runtime.cron.create({...})` on plugin activate:

```
id:       messaging-content-sweep
name:     Messaging content sweep
schedule: from settings.sweepCronSchedule (default '*/5 * * * *')
command:  'bakin:messaging:sweep'
metadata: { source: 'bakin', isBakinJob: true, description: '...' }
```

The command string `bakin:messaging:sweep` is interpreted by Bakin's schedule-plugin bridge: when a cron job with a `bakin:<pluginId>:<action>` command fires, the bridge invokes a hook on that plugin instead of dispatching a task. Messaging registers the hook:

```ts
ctx.hooks.register('messaging.sweep.run', async () => {
  // sweep handler body — iterates Deliverables, applies transitions
}, { hookKind: 'rpc', label: 'Run messaging content sweep' })
```

This requires a small addition to the schedule-plugin bridge to recognize `bakin:<pluginId>:<action>` command strings and dispatch via `ctx.hooks.invoke('${pluginId}.${action}.run', ...)` (the schedule plugin has its own `ctx.hooks` like any plugin; no direct `getHookRegistry` import needed). **Add this dispatch logic to the schedule-plugin bridge in PR-A.**

The sweep handler iterates all Deliverables in a single pass and:

1. `status='planned'` AND `now >= (prepStartAtOverride ?? prepStartAt)` → transition to `in_prep`, call `ctx.tasks.create({ workflowId? })`, populate `taskId`, and (for workflow path) look up `workflowInstanceId` via `workflows.loadInstance`.
2. `status='approved'` AND `publishAt <= now` AND `workflowInstanceId is null` → call `publishDeliverableNow(deliverable, contentType, ctx)`, which resolves assets, calls `deliverContent`, persists success fields, and records `failed` with `failureReason/failedAt` on asset or delivery failure.
3. `status NOT IN ('approved', 'published', 'overdue', 'cancelled', 'failed')` AND `publishAt <= now` → `status='overdue'`, notify owner, append audit event.

Workflow-backed publishes are handled by the `workflow.complete` event subscription, not the sweep. The sweep is idempotent — re-running it on the same state produces the same result.

## Brainstorm prompt rewrite (phase 1)

Drop today's prompt body and replace with a new structure tailored to **Plan** proposals (one per topic/day). Folds in #156 hard-rule + few-shot fixes.

```
You are {agentName}.

## Your Persona
{persona}

## Brainstorming Instructions

You are in a brainstorm session with Mark. The session scope is: {session.scope || 'open'}.

Your job is to propose **content topics** as Plan proposals. One Plan = one topic
or one day's focus (e.g., "Taco Tuesday"). A single brainstorm session can produce
multiple Plans — Mark will materialize the ones he likes into the content calendar.

HARD RULE: If Mark requests ANY concrete content topic — even a single one ("a
post about tacos") — you MUST emit it as a ```json proposal block. Do not reply
in prose when a concrete content request is made. If Mark is ambiguous, clarify
briefly first, then emit a proposal.

HARD RULE: Emit each Plan as its OWN fenced JSON block — one object per block,
NOT an array. Brief intro sentence before each block so items appear incrementally.

Example block format:
```json
{
  "title": "Taco Tuesday",
  "targetDate": "2026-05-19",
  "brief": "Tuesday focus on tacos — celebrate weeknight family recipes, easy assembly, fun toppings.",
  "suggestedChannels": ["blog", "x", "youtube"]
}
```

Fields:
- title: punchy topic title in your authentic voice
- targetDate: ISO date (timezone: America/Denver, MDT)
- brief: 2–3 sentence focus describing the topic and angle
- suggestedChannels: optional hint; Mark will finalize channels per-Plan later

Few-shot examples:

[example 1 — single quote request]
User: "Generate an inspirational quote for today."
Agent: "One inspirational pulse for today:"
```json
{
  "title": "Monday motivation",
  "targetDate": "2026-05-17",
  "brief": "An inspirational quote about persistence through slow progress; tied to a personal anecdote.",
  "suggestedChannels": ["x", "instagram"]
}
```

[example 2 — multi-day plan]
User: "Plan three topics for next week."
Agent: "Three topics, one per day:"
```json
{ "title": "Taco Tuesday", "targetDate": "2026-05-19", ... }
```
"Wednesday leans educational:"
```json
{ "title": "Spice blending fundamentals", "targetDate": "2026-05-20", ... }
```
"Friday wraps with something lighter:"
```json
{ "title": "Weekend pairings", "targetDate": "2026-05-22", ... }
```

[example 3 — revision with id]
User: "Make Wednesday's brief more SEO-focused."
Agent: "Refining Wednesday:"
```json
{
  "id": "{existing-proposal-id}",
  "title": "Spice blending fundamentals",
  "targetDate": "2026-05-20",
  "brief": "[SEO-tuned brief mentioning 'how to blend spices at home' and 'beginner spice blends'...]",
  "suggestedChannels": ["blog"]
}
```

## Revising Existing Proposals
{revision instructions referencing the proposals[] state}

## Current Session State
{list of proposals with status; count summary}
```

## Workflow integration

Three integration points with the workflows plugin. All cross-plugin coupling goes through the hook registry (`ctx.hooks`) or the event bus (`ctx.events`) — never direct imports.

1. **Spawn — single path via `ctx.tasks.create({ workflowId })`.** When a Deliverable's contentType has a `workflowId`, the sweep's prep-spawn calls `ctx.tasks.create` with `workflowId` set. Core's `task-service.ts:269` already invokes `workflows.createInstance` internally when a task is created with a workflowId. **Messaging does NOT call `workflows.createInstance` itself.** If messaging needs the resulting workflow `instanceId`, look it up afterward via `ctx.hooks.invoke('workflows.loadInstance', { taskId })`.

2. **Gate reached → status='in_review' via event bus.** Workflows emits `workflow.gate_reached` (`plugins/workflows/lib/notifications.ts:73`). Messaging subscribes in `activate(ctx)`:

   ```ts
   ctx.events.on('workflow.gate_reached', async (_evt, data) => {
     const deliverable = await findDeliverableByTaskId(data.taskId as string)
     if (!deliverable) return  // not messaging's task
     await updateDeliverable(deliverable.id, {
       status: 'in_review',
       pendingGateStepId: data.stepId as string,
     })
     recomputePlanStatus(deliverable.planId)
   })

   ctx.events.on('workflow.complete', async (_evt, data) => {
     const deliverable = await findDeliverableByTaskId(data.taskId as string)
     if (!deliverable || deliverable.workflowInstanceId == null) return
     // Local event subscribers do NOT receive a timestamp — only the SSE
     // broadcast layer attaches one. publishDeliverableNow creates its own
     // publishedAt/failedAt timestamps.
     if (deliverable.status === 'approved') {
       await publishDeliverableNow(deliverable, contentType, ctx)
     } else if (deliverable.status !== 'published') {
       await updateDeliverable(deliverable.id, {
         status: 'failed',
         failureReason: `workflow.complete fired but messaging-side status was ${deliverable.status}`,
         failedAt: new Date().toISOString(),
       })
       // audit + notify
     }
     recomputePlanStatus(deliverable.planId)
   })
   ```

3. **Approve / Reject → new core hooks `workflows.approveGate` / `workflows.rejectGate` (added in PR-A).** Today the workflows plugin exports `approveGate(taskId, stepId, opts)` and `rejectGate(taskId, stepId, reason, opts)` as in-process functions (`plugins/workflows/lib/runtime.ts:950` and `:1038`) and REST routes. PR-A adds thin hook wrappers so messaging can resolve gates without HTTP round-trips. Both `approver` arguments must use the `ApprovalActor` shape `{ id, displayName?, source }` (`packages/core/src/plugin-types.ts:14`) — passing a bare string fails validation in `approveGate`/`rejectGate`.

   ```ts
   // Critical ordering: set messaging-side status FIRST, then resolve the gate.
   // The workflow.complete handler keys off Deliverable.status === 'approved'
   // to publish. If we resolved the gate first and the workflow auto-progressed
   // to complete before this update landed, the handler would mark it failed.
   await updateDeliverable(deliverable.id, { status: 'approved' })
   try {
     await ctx.hooks.invoke('workflows.approveGate', {
       taskId,
       stepId: pendingGateStepId,
       approver: { id: 'mark', source: 'web' },
     })
   } catch (err) {
     await updateDeliverable(deliverable.id, { status: 'in_review' })
     throw new RouteError(502, `Failed to approve workflow gate: ${(err as Error).message}`)
   }

   // Reject path:
   const priorStatus = deliverable.status
   await updateDeliverable(deliverable.id, {
     status: 'changes_requested',
     rejectionNote: note,
   })
   try {
     await ctx.hooks.invoke('workflows.rejectGate', {
       taskId,
       stepId: pendingGateStepId,
       reason: note,
       approver: { id: 'mark', source: 'web' },
     })
   } catch (err) {
     await updateDeliverable(deliverable.id, { status: priorStatus })
     throw new RouteError(502, `Failed to reject workflow gate: ${(err as Error).message}`)
   }
   ```

   `workflows.completeStep` is **not** used for gate approval — completeStep validates `in_progress` step state, but gates are `pending_approval`.

**Graceful absence.** Messaging guards the workflow path with `ctx.hooks.has('workflows.approveGate')` (the SDK-surface check; messaging never directly imports `getHookRegistry`). If the workflows plugin is uninstalled, contentTypes with `workflowId` fall through to bare-task lifecycle, the activate log warns about each missing workflowId, and Deliverables already in `in_review` via a workflow gate are surfaced with a UI warning that no resolution path exists.

## Default workflow YAML

All three default workflows are **valid against the current workflows schema** (`plugins/workflows/lib/node-type-registry.ts`), use no templating, and rely on messaging's `workflow.complete` event handler to perform the actual `deliverContent` publish. The workflow's job is to gate; messaging's job is to publish.

Workflow step output schema currently supports only `{ id, type?, path? }` (`plugins/workflows/lib/node-type-registry.ts:139`). No JSON-Schema-style validation. Defaults below use `type` literal strings only.

**plugins/messaging/defaults/workflows/messaging-blog-prep.yaml:**

```yaml
name: Messaging — Blog Prep
description: Standard blog-post prep flow. Agent drafts the post (optional hero image), the user reviews via a gate step, then messaging publishes via deliverContent when the workflow completes.
version: 1
steps:
  - id: draft
    label: Draft blog copy
    type: agent
    agent: $assigned
    description: |
      Write the blog draft per the brief in this task's description.
      Aim for 600–900 words, your authentic voice, and a clear CTA.
      Then push the caption to the Deliverable:
        bakin_exec_messaging_deliverable_update {
          deliverableId: <from task description>,
          draft: { caption: "<full draft>" }
        }
      OPTIONAL — if you want a hero image:
        1. Save the image asset:
             bakin_exec_assets_save { filePath, taskId, type: 'images' }
           returns { filename }
        2. Push the filename to the Deliverable:
             bakin_exec_messaging_deliverable_update {
               deliverableId,
               draft: { imageFilename }
             }
      Then set this step's output and the workflow will advance to review.
    outputs:
      - id: caption
        type: string
  - id: review
    label: Review blog draft
    type: gate
    description: User approves the draft in the messaging review queue.
    approval_required: true
    preview:
      - draft.outputs.caption
    on_approve: complete
    on_reject:
      goto: draft
      note_to_agent: true
  - id: complete
    label: Mark prep complete
    type: agent
    agent: $assigned
    description: |
      Finalize draft fields on the Deliverable. Messaging will publish on
      workflow.complete event using ctx.runtime.channels.deliverContent.
    outputs:
      - id: ready
        type: string
```

**plugins/messaging/defaults/workflows/messaging-video-prep.yaml:**

```yaml
name: Messaging — Video Prep
description: Standard video prep flow. Agent writes a script, records or attaches a video asset, then a review gate happens before messaging publishes via deliverContent on workflow.complete.
version: 1
steps:
  - id: script
    label: Write video script
    type: agent
    agent: $assigned
    description: |
      Write a concise script (60–90 seconds spoken length) per the brief.
    outputs:
      - id: script
        type: string
  - id: record
    label: Generate or attach the video asset
    type: agent
    agent: $assigned
    description: |
      Produce or attach a video asset matching the script. Required steps:
        1. Save the video asset:
             bakin_exec_assets_save { filePath, taskId, type: 'video' }
           returns { filename }
        2. Push the filename to the Deliverable so messaging can publish it:
             bakin_exec_messaging_deliverable_update {
               deliverableId: <from task description>,
               draft: { videoFilename }
             }
        3. Set this step's output to the same filename.
      If you skip step 2 the workflow will still complete, but messaging's
      asset validation will fail the Deliverable at publish time.
    outputs:
      - id: videoFilename
        type: file
  - id: review
    label: Review final video
    type: gate
    description: User approves the video draft.
    approval_required: true
    preview:
      - script.outputs.script
      - record.outputs.videoFilename
    on_approve: complete
    on_reject:
      goto: script
      note_to_agent: true
  - id: complete
    label: Mark prep complete
    type: agent
    agent: $assigned
    description: |
      Confirm the script + video asset are finalized. Messaging publishes on
      workflow.complete.
    outputs:
      - id: ready
        type: string
```

**plugins/messaging/defaults/workflows/messaging-image-post-prep.yaml:**

```yaml
name: Messaging — Image Post Prep
description: Image-required social post prep (Instagram-style). Agent writes a caption and produces or attaches an image asset. User reviews via a gate step; messaging publishes via deliverContent on workflow.complete.
version: 1
steps:
  - id: caption
    label: Write caption
    type: agent
    agent: $assigned
    description: |
      Write the caption per the brief. Keep it within platform limits.
      Push it to the Deliverable:
        bakin_exec_messaging_deliverable_update {
          deliverableId: <from task description>,
          draft: { caption: "<final caption>" }
        }
    outputs:
      - id: caption
        type: string
  - id: image
    label: Generate or attach the image asset
    type: agent
    agent: $assigned
    description: |
      Produce or attach the image asset. Required steps:
        1. Save the image asset:
             bakin_exec_assets_save { filePath, taskId, type: 'images' }
           returns { filename }
        2. Push the filename to the Deliverable:
             bakin_exec_messaging_deliverable_update {
               deliverableId,
               draft: { imageFilename }
             }
        3. Set this step's output to the same filename.
    outputs:
      - id: imageFilename
        type: file
  - id: review
    label: Review final post
    type: gate
    description: User approves caption + image.
    approval_required: true
    preview:
      - caption.outputs.caption
      - image.outputs.imageFilename
    on_approve: complete
    on_reject:
      goto: caption
      note_to_agent: true
  - id: complete
    label: Mark prep complete
    type: agent
    agent: $assigned
    description: Confirm caption + image are finalized.
    outputs:
      - id: ready
        type: string
```

Per-Deliverable parameterization (channel, brief, draft, target Deliverable id) is conveyed through the **Bakin task description** that messaging populates when calling `ctx.tasks.create`. The agent reads the task to know which Deliverable it's working on; the description starts with a stable header like:

```
Deliverable: <deliverableId>
Channel: <channel>
PublishAt: <isoDatetime>
Brief: <brief>
---
<agent-readable guidance>
```

The workflow definition itself stays parameter-free; the agent is responsible for plumbing draft fields back into messaging via `bakin_exec_messaging_deliverable_update`.

**Bare-task prep guidance (when no workflowId is set).** The prep task description is built the same way and includes a closing instruction tailored to the contentType's `assetRequirement`:

- For `none`: "Write your draft. Then call `bakin_exec_messaging_deliverable_update` with `{ draft: { caption } }`, then `bakin_exec_messaging_deliverable_ready_for_review`."
- For `image` or `optional-image`: same as above, plus "If an image is needed, call `bakin_exec_assets_save { filePath, taskId, type: 'images' }`, then include the returned filename in your update: `{ draft: { caption, imageFilename } }`."
- For `video` or `optional-video`: same shape, using `type: 'video'` and `videoFilename`.

These guidance strings are templated by messaging at task-creation time using the contentType's `assetRequirement` value; the agent always sees concrete instructions.

**Constraint:** `gate.on_approve` must reference the **immediate next top-level step or `done`** (`plugins/workflows/lib/parser.ts:184`). Both YAML files honor this: review's `on_approve: complete` and complete is the next step. If we add more steps between review and the publish signal, the YAML must preserve this immediate-next ordering.

## Bakin core changes (PR-A)

Three coordinated additions Messaging depends on. All small, all benefit other plugins.

**A1 — `plugin:settings-changed` SSE event.**

- `src/core/sse.ts` — add to discriminated union:
  ```ts
  | { type: 'plugin:settings-changed'; pluginId: string; timestamp: string }
  ```
- `packages/host/src/api/plugin-settings/[pluginId].ts` — after `pluginRegistry.notifySettingsChange(...)`, call `broadcast({ type: 'plugin:settings-changed', pluginId, timestamp: new Date().toISOString() })`.

Tests `tests/api/plugin-settings-sse.test.ts`:
1. PUT writes settings AND broadcasts an event with the exact shape `{ type, pluginId, timestamp }`.
2. `pluginRegistry.notifySettingsChange` still fires when broadcast is added.
3. Malformed/empty pluginId path handling is unchanged.

**A2 — `workflows.approveGate` and `workflows.rejectGate` hooks.**

- `plugins/workflows/index.ts` — register thin hook wrappers around the existing exported `approveGate` and `rejectGate` functions.

Tests `plugins/workflows/tests/gate-hooks.test.ts`:
1. `workflows.approveGate` resolves a pending gate and advances the workflow.
2. `workflows.rejectGate` rewinds the workflow per `on_reject`.
3. Both return the same result shape as the underlying functions.
4. Both error cleanly on missing/unknown taskId or stepId.

**A3 — Schedule-plugin bridge dispatch for `bakin:<pluginId>:<action>` commands (with pluginId='schedule' carve-out).**

Today the schedule-plugin bridge handler starts by looking up sidecar metadata via `getJob(jobId)` and **skips the run entirely if no Bakin sidecar exists** (`plugins/schedule/index.ts:242`). The schedule plugin itself uses `bakin:schedule:<name>` commands for its own jobs (orphan extraction parses these). For messaging to register a plugin-owned cron without writing sidecar metadata, the bridge needs three changes:

1. **Inspect command before the sidecar lookup.** If the command matches `^bakin:([^:]+):([^:]+)$`:
   - If pluginId === 'schedule': retain existing semantics (continue with sidecar lookup; this is the schedule plugin's own job).
   - Else: bypass sidecar lookup; dispatch via `ctx.hooks.invoke('${pluginId}.${action}.run', { jobId, runId, ... })` from inside the schedule plugin. Do NOT create a Bakin task; the plugin owns the work entirely.
2. **Record run status from the hook return.** Hook returns `{ ok: boolean, error?: string, taskId?: string }` shape; bridge records a `RunEntry` with `status: 'success' | 'failure'`, `error`, and optional `taskId` (in case the plugin hook chose to create a task internally).
3. **Carve-out for `bakin:schedule:*`.** Document the reserved-prefix rule so other plugins don't pick `pluginId === 'schedule'`. (No new code needed beyond the if-check.)

Tests `plugins/schedule/tests/bridge-plugin-cron.test.ts`:
1. A cron job with command `bakin:messaging:sweep` invokes hook `messaging.sweep.run` and does NOT create a Bakin task.
2. A cron job with command `bakin:schedule:my-recurring-job` retains existing sidecar-lookup behavior (creates a task via the existing path).
3. A cron job with a non-bakin-prefixed command creates a task as before.
4. If the plugin hook is missing for a `bakin:<plugin>:<action>` command, the run records `status: 'failure'` with a clear reason ("hook plugin.action.run not registered").
5. Hook return value `{ ok: false, error: '...' }` records the run as a failure with the supplied error message.

Activate-time self-check in messaging: after registering the cron and the `messaging.sweep.run` hook, log a warning if `ctx.hooks.has('messaging.sweep.run')` is false (should never happen since we just registered it) and surface a doctor health-check that periodically asserts the sweep cron job exists in `ctx.runtime.cron.list()`.

Docs:
- `.claude/knowledge/plugin-system.md` — paragraph on `plugin:settings-changed` SSE event.
- `.claude/knowledge/workflows-plugin.md` — new gate hooks; canonical cross-plugin gate pattern; reminder that `workflows.createInstance` fires automatically from core task-service.
- `.claude/knowledge/dispatch.md` — note the `bakin:<pluginId>:<action>` command convention for plugin-owned cron sweeps.

Total: ~7 source edits, ~12 tests across 3 files, 3 doc edits. Roughly 250 lines diff.

## Files in `bakin-bits-official/plugins/messaging/` — create / modify / delete

**Create:**

```
plugins/messaging/types.ts                            rewrite (kept name)
plugins/messaging/lib/storage/atomic-write.ts         temp-write + POSIX rename
plugins/messaging/lib/storage/plans.ts                Plan entity store
plugins/messaging/lib/storage/deliverables.ts         Deliverable entity store
plugins/messaging/lib/storage/sessions.ts             renamed from lib/sessions.ts
plugins/messaging/lib/storage/index.ts                barrel
plugins/messaging/lib/sweep.ts                        sweep handler
plugins/messaging/lib/plan-status.ts                  recomputePlanStatus helper
plugins/messaging/lib/prompt-builder.ts               rewrite — Plan-proposing prompt
plugins/messaging/lib/proposal-parser.ts              extracted streaming JSON parser
plugins/messaging/lib/workflow-bridge.ts              gate_reached + complete events;
                                                      approve/reject hook invocations
plugins/messaging/lib/legacy-archive.ts               rename legacy paths on first activate
plugins/messaging/hooks/use-plans.ts                  client hook
plugins/messaging/hooks/use-plan.ts                   single-plan + Deliverables
plugins/messaging/hooks/use-deliverables.ts
plugins/messaging/hooks/use-content-types.ts          rewrite — SSE-aware
plugins/messaging/hooks/use-sessions.ts
plugins/messaging/components/plan-list.tsx
plugins/messaging/components/plan-workspace.tsx       main view with Deliverables +
                                                      phase-2 task status
plugins/messaging/components/proposed-deliverables-panel.tsx
plugins/messaging/components/deliverable-drawer.tsx
plugins/messaging/components/deliverable-status-badge.tsx
plugins/messaging/components/content-calendar.tsx     rewrite to read Deliverables
plugins/messaging/components/quick-post-button.tsx    header-mounted
plugins/messaging/components/brainstorm-view.tsx      rewrite — session list +
                                                      per-session chat with Plan
                                                      proposal review panel
plugins/messaging/components/plan-proposal-card.tsx   replaces old proposal-card
plugins/messaging/components/integrated-brainstorm-plan.tsx
                                                      thin wrapper around
                                                      IntegratedBrainstorm from
                                                      @bakin/sdk/components, passing
                                                      transformAssistantMessage to
                                                      render Plan proposal cards
                                                      inline
plugins/messaging/defaults/workflows/messaging-blog-prep.yaml
plugins/messaging/defaults/workflows/messaging-video-prep.yaml
plugins/messaging/defaults/workflows/messaging-image-post-prep.yaml
plugins/messaging/tests/...                           see test strategy
```

**Modify:**

```
plugins/messaging/bakin-plugin.json                   new settings schema, nav items,
                                                      contentFiles updated
plugins/messaging/client.tsx                          new top-level routes
plugins/messaging/index.ts                            full rewrite — routes, exec
                                                      tools, sweep hook registration,
                                                      event subscriptions
plugins/messaging/package.json                        no public-API changes
```

**Delete (cleaned out in the final commit):**

```
plugins/messaging/components/item-detail-drawer.tsx
plugins/messaging/components/calendar-week.tsx        folded into rewritten calendar
plugins/messaging/components/new-session-dialog.tsx
plugins/messaging/components/delete-session-dialog.tsx
plugins/messaging/components/planning-layout.tsx
plugins/messaging/components/session-list.tsx         folded into brainstorm-view
plugins/messaging/components/session-chat.tsx         replaced by IntegratedBrainstorm
plugins/messaging/components/review-panel.tsx         folded into brainstorm-view
plugins/messaging/components/proposal-card.tsx        replaced by plan-proposal-card
plugins/messaging/lib/sessions.ts                     moved to storage/sessions.ts
plugins/messaging/lib/storage.ts                      replaced by storage/*
plugins/messaging/lib/brainstorm-search.ts            re-implemented in new storage layer
plugins/messaging/constants.ts                        folded into types.ts
plugins/messaging/lib/ids.ts                          replaced by storage helpers
plugins/messaging/tests/...                           legacy CalendarItem tests removed
```

## Legacy data handling

Existing user data under `~/.bakin/plugin-data/messaging.json` and `~/.bakin/plugin-data/messaging/sessions/` is NOT migrated. **Never silently destroy** legacy files. On first activate of the refactored plugin:

1. If `messaging.json` exists, rename it to `messaging.legacy-{ISO-timestamp}.json` in the same directory.
2. If `messaging/sessions/` exists and contains files, rename the directory to `messaging/sessions.legacy-{ISO-timestamp}/`.
3. Log a single info-level line for each rename: `Renamed legacy messaging path {from} → {to}; not migrated to refactored model.`
4. Append an audit event `messaging.legacy_path_archived`.

The user can manually delete the legacy paths later. Tests in `legacy-archive.test.ts`:
- Legacy files are renamed, not deleted.
- The renamed paths follow the `legacy-<ISO-timestamp>` convention.
- A log line + audit event are emitted for each rename.
- Running activate twice doesn't re-rename (renamed paths no longer match legacy patterns).

## Atomic writes

Bakin's `ScopedPluginStorageAdapter.writeJson` (`packages/core/src/storage/scoped-plugin-storage.ts:55`) uses `writeFileSync` directly — not atomic. Because the sweep cron and user edits race on the same Deliverable file, **messaging owns its own atomic-write helper** in `lib/storage/atomic-write.ts`:

```ts
export function atomicWriteJson(absPath: string, value: unknown): void {
  const dir = dirname(absPath)
  const tmp = join(dir, `.${basename(absPath)}.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8')
  try {
    renameSync(tmp, absPath)        // POSIX atomic rename
  } catch (err) {
    try { unlinkSync(tmp) } catch {}
    throw err
  }
}
```

All messaging storage modules write through `atomicWriteJson`. Tests in `atomic-write.test.ts`:
- Successful write produces the final file with no `.tmp` artifact.
- Mocked `renameSync` failure leaves the destination file unchanged and cleans up the temp file.
- Concurrent writes of distinct values to the same path produce one valid JSON file (no torn content).

## Commit strategy

### PR-A — Bakin core (small, isolated)

Branch: `feature/messaging-host-prereqs` off `main` in `markhayden/bakin`.

| # | Commit | Files |
|---|---|---|
| 1 | `feat(sse): add plugin:settings-changed event type` | `src/core/sse.ts` |
| 2 | `feat(plugin-settings): broadcast change on PUT` | `packages/host/src/api/plugin-settings/[pluginId].ts` |
| 3 | `test(plugin-settings): cover SSE emission, registry notification preservation, and pluginId param parsing` | `tests/api/plugin-settings-sse.test.ts` |
| 4 | `feat(workflows): add workflows.approveGate and workflows.rejectGate hooks` | `plugins/workflows/index.ts` |
| 5 | `test(workflows): cover gate approve/reject hooks` | `plugins/workflows/tests/gate-hooks.test.ts` |
| 6 | `feat(schedule): bridge dispatches bakin:<pluginId>:<action> commands to plugin hooks` | `plugins/schedule/index.ts` |
| 7 | `test(schedule): cover bakin:<pluginId>:<action> dispatch path` | `plugins/schedule/tests/bridge-bakin-command.test.ts` |
| 8 | `docs(knowledge): SSE event, workflow gate hooks, plugin-cron command convention` | `.claude/knowledge/plugin-system.md`, `.claude/knowledge/workflows-plugin.md`, `.claude/knowledge/dispatch.md` |

Merge PR-A first. Build/run Bakin for PR-B development.

### PR-B — Messaging refactor (one coherent PR, atomic commits)

Branch: `feature/messaging-content-planning-redesign` off `main` in `markhayden/bakin-bits-official`.

| # | Commit | Verification |
|---|---|---|
| 1 | `feat(messaging): add Plan/Deliverable/Session types + zod schemas + status machine + failureReason/failedAt fields` | tsc clean; status-machine unit tests |
| 2 | `feat(messaging): atomic-write helper + tests` | concurrent-write test passes; no `.tmp` artifacts |
| 3 | `feat(messaging): file-per-entity storage modules; draft deep-merge; through atomicWriteJson` | storage CRUD tests; deep-merge tests; isolation mocks present |
| 4 | `feat(messaging): plan-status recompute helper + tests` | Plan.status aggregation cases covered, including all-approved scheduled, all-overdue, all-failed, and mixed terminal cases |
| 5 | `feat(messaging): legacy-archive helper + activate-time rename + tests` | rename + idempotent + audit event |
| 6 | `feat(messaging): seed/normalize default contentTypes with assetRequirement + workflowId mapping` | activate tests verify canonical defaults, existing-setting normalization, user override preservation, and missing-workflow fallback |
| 7 | `feat(messaging): brainstorm routes + Plan-proposal-emitting prompt + #156 hard rules + few-shots` | prompt tests verify hard-rule lines verbatim; route tests |
| 8 | `feat(messaging): session materialize → spawn Plans` | materialize tests |
| 9 | `feat(messaging): plans CRUD routes + exec tools + tests` | route tests |
| 10 | `feat(messaging): plan start-fanout creates phase-2 Bakin task` | route + task-spawn mocked tests |
| 11 | `feat(messaging): deliverables CRUD routes + exec tools + tests (incl. Quick Post; deep-merge draft update)` | route tests; nullable parent verified; deep-merge update verified |
| 12 | `feat(messaging): buildFilesFromDraft + publishDeliverableNow helpers + tests` | every assetRequirement value covered; fileRef and deliverContent failure cases covered |
| 13 | `feat(messaging): register single sweep cron via bakin:messaging:sweep command` | activate test + sweep registration verified |
| 14 | `feat(messaging): sweep — prepStartAt → in_prep + ctx.tasks.create with optional workflowId` | sweep tests with fake timer; verifies single-path spawn |
| 15 | `feat(messaging): sweep — publishAt → published (bare path) / overdue / failed-on-asset-or-delivery-validation` | sweep tests; uses publishDeliverableNow |
| 16 | `feat(messaging): workflow bridge — events.on(gate_reached, complete); approveGate/rejectGate hook invocations; asset validation on workflow.complete; absent-workflows fallback` | bridge tests; mock event bus; approve/reject hook failure rollback cases |
| 17 | `feat(messaging): ship messaging-blog-prep, messaging-video-prep, messaging-image-post-prep workflow YAMLs` | parser/load test against current workflow schema |
| 18 | `feat(messaging): bare-task review lifecycle (ready_for_review enforces asset validation regardless of requiresApproval); approve route enforces asset validation; approve-and-publish-now` | route tests including requiresApproval=false missing-asset blocking, workflow-backed 409 policy, asset-validation failure, and deliverContent failure |
| 19 | `feat(messaging): phase-2 propose_deliverable exec tool + UI proposed-deliverables-panel` | exec-tool tests; panel tests |
| 20 | `feat(messaging): client routes — Calendar (rewrite) + Plans (list + workspace) + Brainstorm (sessions list + chat with proposals)` | component tests; IntegratedBrainstorm transformAssistantMessage path tested |
| 21 | `feat(messaging): deliverable drawer + status badges + asset preview (via assets file route) + quick post header button with optional asset picker` | component tests; failure-reason rendering tested |
| 22 | `feat(messaging): content-types live refresh via plugin:settings-changed SSE` | use-content-types tests with synthetic SSE |
| 23 | `feat(messaging): calendar filter shows orphan agent ids + orphan content-type fallback` | calendar test; orphan-refs regression |
| 24 | `chore(messaging): remove legacy CalendarItem types/routes/tests/components` | suite still passes; legacy refs grep-clean |
| 25 | `docs(messaging): update bakin-bits README + plugin-authoring callouts` | docs render check |

### Rollback playbook

**PR-A:** revertable as a whole. Messaging then loses live content-type refresh, workflow-gate resolution, and the cron sweep dispatch. The workflow path falls back to bare-task via `ctx.hooks.has('workflows.approveGate')` guard. The cron sweep falls back to nothing (the cron command `bakin:messaging:sweep` is ignored by the unaltered bridge and no task is dispatched, so the sweep silently stops firing — doctor health-check surfaces this with a clear repair instruction). No data corruption.

**PR-B by phase:**

| Phase | Commits | Rollback granularity | Rationale |
|---|---|---|---|
| Read-only setup | 1–12 | Individual commit revert | Types, atomic-write, storage (+deep merge), plan-status, legacy archive, default contentTypes seed/normalize, brainstorm routes, materialize, plans CRUD, plan start-fanout, deliverables CRUD, buildFilesFromDraft/publishDeliverableNow helpers — all routes exist but no background sweep or event subscriptions are wired. Activate-time settings normalization may persist enriched contentTypes, but does not create tasks, workflow instances, or Deliverables. |
| Side-effecting machinery | 13–19 | **Full PR revert only after first sweep run** | Sweep registration + transitions + event subscriptions + workflow bridge + lifecycle routes start producing persisted Bakin tasks, workflow instances, and Deliverable status changes. Reverting individual commits after first use leaves orphaned tasks, dangling workflow instances, or Deliverables stuck mid-transition. |
| UI | 20–21 | Individual revert OK only if no users have used the new UI in this session | UI reverts don't corrupt data but make in-flight Deliverables unmanageable. |
| Cleanup + polish | 22–25 | Individual revert OK | SSE refresh, orphan filter fix, legacy removal, doc updates. |

**Full PR-B revert after side-effecting phase has run:** there is no automated cleanup. Manually: stop the plugin (sweep stops registering); inspect `messaging.legacy-*` archives; inspect new entity files under `messaging/plans/`, `messaging/deliverables/`; inspect Bakin tasks tagged `messaging-deliverable` and the workflow instances they reference; cancel/archive as appropriate.

## Test strategy

Strictly follows CLAUDE.md "Testing Rules — CRITICAL." Every test file:

1. Mocks **both** content-dir resolvers (`src/core/content-dir` and `packages/core/src/content-dir`).
2. Mocks `@bakin/adapter-openclaw/home`.
3. Sets `process.env.BAKIN_HOME` and `process.env.OPENCLAW_HOME` BEFORE module imports.
4. Mocks the logger and watcher.
5. Mocks `AppServices.runtime` / `ctx.runtime` so no real agent messages fire.
6. Uses `bun test --isolate`.
7. Cleans up tmp dirs in `afterAll`.

Test layout (under `plugins/messaging/tests/`):

```
types.test.ts                       Zod schemas; status state machine valid transitions
storage/atomic-write.test.ts        success path; tmp cleanup on rename failure; no torn writes
storage/plans.test.ts               file-per-entity CRUD; emission per write
storage/deliverables.test.ts
storage/sessions.test.ts
legacy-archive.test.ts              renames on first activate; idempotent on second
settings-content-types.test.ts       default contentTypes seed/normalize; preserves user overrides; clears missing workflowId with warning
plan-status.test.ts                 every aggregation rule from the table, including all-approved scheduled, all-overdue, all-failed, mixed published/non-terminal, and mixed failed/cancelled without published
sweep.test.ts                       prep / publish / overdue transitions; uses Bun mock timer
prompt-builder.test.ts              HARD RULE sections, 3 few-shot examples, revision format
proposal-parser.test.ts             streaming JSON-block extraction; legacy array fallback
workflow-bridge.test.ts             ctx.tasks.create({workflowId}) path;
                                    ctx.events.on('workflow.gate_reached') → status=in_review;
                                    ctx.events.on('workflow.complete') → status=published with
                                    publishedDeliveryRef from result.deliveries[0]?.ref;
                                    approve invokes workflows.approveGate hook;
                                    approveGate throw reverts status to in_review and returns 502;
                                    reject invokes workflows.rejectGate hook;
                                    rejectGate throw restores prior status and returns 502;
                                    workflows plugin absent → bare-task fallback + activate warning
defaults-workflows.test.ts          all three YAMLs validate against workflow parser
asset-resolution.test.ts            buildFilesFromDraft/publishDeliverableNow: required image missing → failed;
                                    optional image missing → publishes with no files entry;
                                    fileRef throws → failed with reason captured;
                                    deliverContent throws → failed with reason captured;
                                    missing delivery entry → failed with reason captured;
                                    multiple assets resolved into the files array;
                                    contentType.assetRequirement values all covered
routes/sessions.test.ts             CRUD + messages SSE + proposal update + materialize
routes/plans.test.ts                CRUD + start-fanout + cancel + cascade
routes/deliverables.test.ts         CRUD + approve + reject + approve-and-publish-now +
                                    extend-publish-at + cancel + Quick Post (nullable planId);
                                    approve-and-publish-now covers required-asset failure,
                                    deliverContent failure, and workflow-backed 409 policy
exec-tools.test.ts                  all new exec tools, input/output schema validation
ui/plan-workspace.test.tsx          renders plan + Deliverables + fan-out task status
ui/proposed-deliverables-panel.test.tsx   approve/reject/edit per proposal
ui/deliverable-drawer.test.tsx      drawer modes; status-conditional actions; approve-and-publish-now
                                    button on overdue; Approve button disabled when contentType.
                                    assetRequirement requires an image/video and draft.imageFilename
                                    / draft.videoFilename is missing; tooltip explains why;
                                    asset preview renders by pointing an <img> or <video> element
                                    at the existing assets file route (e.g.,
                                    `/api/assets/{encodedFilename}` or `/api/plugins/assets/file?name=...`) — fileRef is a
                                    server-side primitive for deliverContent resolution and is
                                    NOT a browser-loadable URL; missing-asset state shows a
                                    clear "asset missing" indicator; failureReason renders
                                    inline when status='failed'
ui/content-calendar.test.tsx        Deliverable-reading; status badges; orphan agent filter; orphan contentType label fallback
ui/use-content-types.test.tsx       SSE-driven refresh on plugin:settings-changed
ui/quick-post.test.tsx              free-floating Deliverable creation; contentType selector
                                    works for all assetRequirement values; if assetRequirement
                                    requires an asset, the dialog shows an "Attach existing
                                    asset" picker AND notes "or let the prep agent generate
                                    one"; submit with no attached asset still succeeds (the
                                    prep cycle handles media generation)
ui/brainstorm-view.test.tsx         IntegratedBrainstorm transformAssistantMessage proposal card rendering; multi-Plan session
end-to-end/full-plan-lifecycle.test.ts
                                    brainstorm → materialize → fan-out → propose Deliverables →
                                    approve → prep → review → approve → publish; all storage
                                    transitions; all hooks; both bare + workflow paths
```

PR-A tests (Bakin core repo): see PR-A section above.

## Reusable utilities to lean on (not re-implement)

- `IntegratedBrainstorm` from `@bakin/sdk/components` — chat-pinned-at-bottom pattern used by Projects plugin. Pass `transformAssistantMessage` (declared in `src/components/integrated-brainstorm/types.ts:66`) to render Plan proposal cards inline beneath assistant messages. Messaging owns the session route that parses `\`\`\`json` blocks server-side and persists them; the SSE proposal events drive UI updates.
- `PluginTaskService` (`ctx.tasks`) for task create/update/list. Tasks have `column` (not `status`) — valid columns include `todo`, `inProgress`, `review`, `done`, `blocked`, `archived`. Use `column` precisely throughout messaging code.
- `ctx.runtime.cron` for the sweep registration (command string format: `bakin:messaging:sweep`).
- `ctx.runtime.channels.{deliverContent, sendMessage, sendNotification, createApproval, subscribeApprovalResponses}` for delivery + notifications + future approval surfaces.
- `ctx.runtime.messaging.{send, stream}` for brainstorm agent calls.
- `ctx.tasks.create({ workflowId })` for workflow-backed prep tasks (workflow instance auto-created by core task-service; do NOT call `workflows.createInstance`).
- `ctx.hooks.invoke('workflows.approveGate' | 'workflows.rejectGate', { taskId, stepId, ... })` for gate resolution from messaging (added in PR-A).
- `ctx.hooks.invoke('workflows.loadInstance', { taskId })` to look up a workflow instance from a task id.
- `ctx.events.on('workflow.gate_reached', handler)` and `ctx.events.on('workflow.complete', handler)` for status bridging.
- `ctx.hooks.invoke('team.getAgentIds' | 'team.resolveProfile' | 'team.getAgent')` for agent validation + persona + display name.
- `ctx.assets.{getByFilename, fileRef, list}` for media references.
- `ctx.search.registerFileBackedContentType` for sessions AND deliverables indexing; auto-registers a `GET /api/plugins/messaging/search` route that dispatches across registered content types.
- `ctx.hooks.has('workflows.approveGate')` to gate the workflow path; falls through to bare-task path when workflows plugin is absent. (Plugin-side guard — never import `getHookRegistry` directly from core in messaging.)
- `useAgentIds`, `useNotificationChannels`, `useQueryState`, `useQueryArrayState`, `useSSE` from `@bakin/sdk/hooks`.
- `PluginHeader`, `FacetFilter` from `@bakin/sdk/components`.

## Knowledge & docs to update

PR-A (Bakin core):

- `.claude/knowledge/plugin-system.md` — `plugin:settings-changed` SSE event.
- `.claude/knowledge/workflows-plugin.md` — new gate hooks; canonical cross-plugin gate-resolution pattern; reminder that `workflows.createInstance` fires automatically from core task-service.
- `.claude/knowledge/dispatch.md` — `bakin:<pluginId>:<action>` cron command convention.
- `.claude/knowledge/search-system.md` — mention messaging will register `messaging_deliverables` (alongside existing `messaging_brainstorm`).

PR-B (`bakin-bits-official`):

- `bakin-bits-official/README.md` — refresh messaging plugin description (new entities + flows).
- `bakin-bits-official/plugins/messaging/README.md` (create if absent) — new model overview, exec-tool reference, default workflow descriptions.
- `bakin/docs/plugin-authoring.md` — `IntegratedBrainstorm` with `transformAssistantMessage` example; `bakin:<pluginId>:<action>` cron-sweep example.

## Verification

End-to-end manual verification once PR-A is merged and PR-B is checked out:

1. `bun run dev` against the local `bakin` + `bakin-bits-official` plugin source.
2. Open `/messaging` → redirects to `/messaging/calendar` (empty state).
3. Open `/messaging/brainstorm` → click "New session" → name "Planning the next four days" → enter chat.
4. Send "Plan four days: tacos Monday, pasta Tuesday, soup Wednesday, salad Thursday." Verify four `\`\`\`json` proposal blocks render as Plan proposal cards inline beneath the assistant message via `transformAssistantMessage`.
5. Approve all four → click "Materialize approved." Verify four Plans appear at `/messaging/plans`.
6. Open the "Taco" Plan workspace. Verify status is `planning`. Click "Start fan-out." A Bakin task "Plan: Taco Tuesday" appears in the Tasks plugin UI, dispatched to the lead agent.
7. The agent calls `bakin_exec_messaging_propose_deliverable` for blog/x/youtube channels. Verify three proposed Deliverables show up under the Plan with approve/edit/reject.
8. Approve Deliverables. Each becomes `planned` with a derived `prepStartAt`. Plan status auto-recomputes (e.g., `in_prep` once at least one Deliverable has hit `in_prep`).
9. Trigger sweep early via `ctx.runtime.cron.runNow('messaging-content-sweep')`. Verify prep tasks spawn for Deliverables whose `prepStartAt` has passed. For the blog (`workflowId` set), verify a workflow instance was also created via core task-service.
10. Wait for or simulate workflow gate reach. Verify `ctx.events.on('workflow.gate_reached')` fires and Deliverable.status flips to `in_review`.
11. Approve in the Calendar drawer. Verify messaging sets `Deliverable.status = 'approved'` FIRST, then invokes `workflows.approveGate`; the workflow advances; on `workflow.complete`, messaging calls `deliverContent` and sets `status=published` with `publishedDeliveryRef` populated from `result.deliveries[0]?.ref`.
12. For the X-post (`workflowId` unset, `requiresApproval` default true): bare path. Agent calls `bakin_exec_messaging_deliverable_ready_for_review` → status=`in_review`. Approve in UI → `approved`. Trigger sweep at publish time → `deliverContent` fires → `published`.
13. Configure a contentType with `requiresApproval=false` and a Deliverable on it. Agent calls `bakin_exec_messaging_deliverable_ready_for_review`. Verify Deliverable goes directly to `approved`, no review surface required.
14. Create a Deliverable with `publishAt` already past while status was `in_prep` (simulate via direct PUT or by reducing prepLeadHours after creation). Run sweep. Verify status flips to `overdue`, notification fires, audit event written. From the drawer, click "Approve and publish now" → verify single-transaction approve+publish (no second sweep tick needed).
15. Create a Quick Post via the header button (planId=null, channel=x, contentType=x-post, publishAt = now+2h). Verify it appears on Calendar with an "ad hoc" badge and runs through bare-task lifecycle.
15a. Create another Quick Post with a media-required contentType (e.g., `image`, channel=instagram). Verify the dialog offers an "Attach existing asset" picker. Skip the picker and submit. Watch the prep agent: it should call `bakin_exec_assets_save` and then `bakin_exec_messaging_deliverable_update` to set `draft.imageFilename` (and the previously-set `draft.caption` should survive thanks to deep-merge). The Deliverable drawer should render the asset preview by pointing an `<img>` at `/api/assets/{encodedFilename}` or `/api/plugins/assets/file?name=...` (NOT a fileRef URL). Approve. Verify publish succeeds and the file ref is included in the `deliverContent` call. Then create another image-required Quick Post, attach NOTHING, and force the agent to also produce no asset (skip the asset_save call). Approve via UI — Approve button must be DISABLED with a tooltip explaining the required asset is missing. Bypass UI and POST `/deliverables/:id/approve` directly via curl — the route MUST return 400 with the same reason ("Required image asset missing"). Configure a contentType with `requiresApproval=false` AND `assetRequirement='image'`; have the agent call `bakin_exec_messaging_deliverable_ready_for_review` with no image — verify the call returns 400 and the Deliverable stays in `in_prep` rather than auto-advancing to `approved`. Confirm `failureReason` and `failedAt` are populated whenever a Deliverable transitions to `failed` (verify via direct GET of the entity file).
15b. Create a Deliverable whose `draft.imageFilename` references an asset that does not exist (simulate via direct PUT). Approve, run sweep. Verify Deliverable transitions to `failed` with the fileRef-resolution error in the reason. Force `deliverContent` to throw or return no delivery entry in an automated test and verify the same `failed`/`failureReason`/`failedAt` policy.
16. Edit a contentType label in Settings. Verify the Calendar's content-type filter and Deliverable badges update without a page reload (validates the new `plugin:settings-changed` SSE event end-to-end).
17. Reference an agent id in a Deliverable that no longer exists in the team plugin. Verify the Deliverable remains visible and filterable via an "Unknown / removed agent" bucket.
18. Place a fake legacy `messaging.json` in `~/.bakin/plugin-data/` (and `messaging/sessions/oldsession.json`). Restart the plugin. Verify files are renamed to `messaging.legacy-<timestamp>.json` and `messaging/sessions.legacy-<timestamp>/`, log line emitted, audit event written. Files are NOT deleted.

Automated:

- `bun test --isolate` in both repos passes clean.
- `bun run build` succeeds (binary build for Bakin; plugin build for bakin-bits).
- `bun run check` (typecheck) clean in both repos.

## Risks

- **Workflow gate ↔ messaging-status round-trip** — needs the workflows plugin present and the new gate hooks registered. Mitigate: `ctx.hooks.has('workflows.approveGate')` guard; warn at activate time if any contentType references a missing or non-loadable workflowId; degrade to bare-task lifecycle in that case. Subscribe to `workflow.gate_reached` and `workflow.complete` via `ctx.events.on` only when the workflows plugin has registered the new hooks.
- **Sweep race conditions** — sweep fires while user edits a Deliverable. Mitigate: messaging owns `atomicWriteJson` (temp file + POSIX rename), enforced through every storage module; tests verify concurrency. Sweep reads a snapshot of Deliverables, then applies transitions one at a time.
- **Brainstorm prompt drift** — agents may emit malformed JSON. Mitigate: streaming parser already tolerates malformed blocks; #156 HARD RULEs + 3 few-shot examples improve emission reliability; prompt-builder tests assert the hard-rule lines verbatim so future edits don't drift them away.
- **Cron command bridge** — the schedule-plugin bridge dispatch for `bakin:<pluginId>:<action>` commands is new infrastructure (PR-A A3). If A3 doesn't ship, messaging's sweep silently stops firing (its `messaging.sweep.run` hook is registered but no one invokes it on the cron tick). Mitigate: activate-time self-check — messaging calls `ctx.runtime.cron.list()` to confirm its sweep is registered, then verifies the schedule-plugin bridge handles its command by inspecting that `ctx.hooks.has('messaging.sweep.run')` is true (a sanity check on its own registration). A separate `doctor` health-check periodically probes for a recent sweep run; if none has fired within `2 * sweepCronSchedule`, surface a doctor failure with a clear repair instruction (likely: "PR-A A3 didn't ship; revert PR-B or ship A3").
- **Task cascade on Deliverable delete** — deleting a Deliverable does NOT delete the linked Bakin task. Mitigate: explicit Cancel on Deliverable archives the linked task by moving it to the `archived` column. Hard DELETE orphans the task; UI affordance warns the user before doing this.
- **Cross-repo coordination** — if PR-A is reverted post-merge of PR-B, content-types refresh degrades to one-time-load (the pre-refactor behavior for that hook). Workflow path falls back to bare-task. Cron sweep stops firing (doctor surfaces the failure). No data corruption.
