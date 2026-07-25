# Workflows Plugin — Deep Reference

## Overview

The workflows plugin owns workflow **authoring**, **storage**, **resolution**, execution, and the **canvas/editor UI**. Runtime execution is intentionally conservative: definitions are edited as a canvas, but the engine currently executes an ordered top-level step list with explicit support for gates, output steps, parallel child agent steps, and nested workflows.

Two registries make plugin- and package-shipped workflows possible without breaking the existing user-owned YAML model:

- **Source registry** (`lib/source-registry.ts`) — in-memory index of every workflow definition the system knows about, keyed by id, with provenance (`plugin`, `agent-package`, or `user`). Resolution order is `user > agent-package > plugin`.
- **Node-type registry** (`lib/node-type-registry.ts`) — single source of truth for the 5 builtin step types. The same Zod schemas drive both YAML parsing and the form editor — they cannot drift.

## Two Skill Systems (Don't Conflate)

The workflows surface uses the word "skill" in two different places. They are unrelated systems:

| | S-A — Workflow step skills | S-B — runtime skills |
|---|---|---|
| **Where it lives** | In-memory `pluginSkills` map + `~/.bakin/workflows/skills/*.md` | Runtime adapter skill store (+ `scripts/`) |
| **Who reads it** | Bakin's workflow runtime (injects body into agent prompt) | Runtime agents |
| **How it ships** | `defaults/workflow-skills/*.md` → auto-registered by plugin loader at activation (`ctx.registerSkill`) | `defaults/runtime-skills/{name}/` → installed to disk by `bakin install plugin-assets` |
| **Drift detection** | Local-shadow scanner for `~/.bakin/workflows/skills/*.md` using managed `sourcePath`, `<skill>.md.installedBy`, `<skill>.md.userEdited`, Health/Workflows UI surfaces | `.installedBy` JSON marker (sha256), `.userEdited` sentinel, `bakin doctor` surface |

**Rule of thumb:** if it's a workflow `step.skill: write-copy`, it's S-A. If it's something an agent invokes through the runtime skill mechanism, it's S-B.

## Plugin Authoring Contract

A plugin that ships workflows + skills lays out three sibling directories under `defaults/`:

```
plugins/<id>/
  defaults/
    workflows/             # *.yaml — registered via ctx.registerWorkflow at activate()
    workflow-skills/       # *.md   — auto-registered via ctx.registerSkill at load (S-A, in-memory)
    runtime-skills/       # {name}/SKILL.md (+ scripts/) — installed by `bakin install plugin-assets` (S-B, on disk)
```

None of the three are required. A plugin can ship any subset.

### How each gets loaded

| Directory | Loader | Trigger |
|-----------|--------|---------|
| `defaults/workflows/` | `plugins/workflows/lib/load-defaults.ts` (called from the workflows plugin's `activate()`) | Server boot, every startup |
| `defaults/workflow-skills/` | `src/lib/plugin-skill-loader.ts` (invoked by `src/core/plugin-registry.ts` after every `activate()`) | Server boot, every startup, generic across all plugins |
| `defaults/runtime-skills/` | `src/core/onboarding/plugin-assets.ts` (`scanPluginAssets` + `installPluginAssets`) | `bakin install plugin-assets` (manual), or surfaced by `bakin doctor` |

The workflow definition and managed workflow-skill registries are rebuilt on every boot. User workflow-skill files under `~/.bakin/workflows/skills/*.md` still win over managed sources, so those local shadows need drift visibility when a shipped skill contract changes.

### S-A drift detection and repair

`plugins/workflows/lib/workflow-skill-drift.ts` scans local workflow skill markdown files only when they shadow a managed plugin or agent-package skill with the same name. Managed loaders preserve `SkillDefinition.sourcePath`, letting the scanner compare the local file against the current shipped markdown without materializing every managed skill to disk.

Stale patterns are intentionally narrow and contract-oriented: old generated media path fields (`image_path`, `imagePath`, `video_path`, `videoPath`, `audio_path`, `audioPath`), old image filename/prompt-packet fields (`image_filename`, `promptAssetFilename`, `savePromptPacket`), and legacy execution tool names such as `beacon_exec_` / `bakin_exec_gen_image`.

Workflow skill sidecars live next to the markdown file:

```
~/.bakin/workflows/skills/generate-image.md
~/.bakin/workflows/skills/generate-image.md.installedBy
~/.bakin/workflows/skills/generate-image.md.userEdited
```

Repair is full-file replacement from the current managed source, never phrase-level patching. It is available only when `.installedBy` proves the local file is still managed and unedited, or when the exact local hash matches a repo-shipped known-old hash from `plugins/workflows/defaults/workflow-skill-legacy-hashes.json`. `.userEdited`, unknown, or customized files are advisory-only.

Surfaces:

- Health check `workflows.skills` reports stale local shadows and contributes a doctor repair plan for safe cases.
- `GET /api/plugins/workflows/definitions` and `GET /api/plugins/workflows/definitions/:name` include `skillDrift` summaries for affected workflows and steps.
- `POST /api/plugins/workflows/skills/:name/repair` applies the same safe repair path used by Health.
- The Workflows UI shows stale-skill badges on workflow cards, a detail banner, highlighted step nodes, and a drawer repair button when the file is safe to replace.

## Source Registry

`plugins/workflows/lib/source-registry.ts`. Backed by `globalThis.__bakinWorkflowSources` so state survives Bun HMR and module re-evaluation.

```typescript
registerPluginDefinition(pluginId, id, definition)   // throws if a *different* plugin owns id; same plugin overwrite is allowed (hot reload)
unregisterPluginDefinitions(pluginId)                // wipes every entry for that plugin
registerAgentPackageDefinition(packageId, id, definition)
unregisterAgentPackageDefinitions(packageId)
registerUserDefinition(id, definition)               // user-owned (~/.bakin/workflows/definitions/) — silently shadows plugin entry
unregisterUserDefinition(id)
getDefinition(id) → SourceEntry | undefined          // user > agent-package > plugin
listAll() → SourceEntry[]                            // resolved through source precedence
isReadOnly(id)                                       // true iff non-user-owned with no user shadow — CRUD routes refuse writes
```

`SourceEntry` carries `{ id, definition, source: 'plugin' | 'agent-package' | 'user', pluginId?, packageId? }` so the UI can render badges and the routes can refuse non-user-owned writes.

### User-wins precedence

The user copy at `~/.bakin/workflows/definitions/{id}.yaml` always shadows a plugin copy with the same id. There is **no fork UI** — a user customizes a plugin workflow by either:

1. Clicking "Save as new" in the editor (creates a separate id with the form prefilled), OR
2. Manually dropping a YAML at `~/.bakin/workflows/definitions/{same-id}.yaml` (advanced; shadow happens automatically).

Cross-plugin id collisions are an activation-time error, but the loader catches the throw and continues with other plugins.

## Portable Default Workflows

Plugin-shipped workflow YAML under `plugins/*/defaults/workflows/` must be
portable across runtime rosters. Do not hardcode local OpenClaw agent ids such
as `chef`, `pixel`, `rolo`, or `main-operator` in default definitions. Use the
symbolic `$assigned` token for every shipped `agent:` value until Bakin grows a
provider-neutral role/capability selector.

User-owned and agent-package workflow YAML can use literal local agent ids.
Start-time validation checks those ids against the runtime roster. `$assigned`
requires the task to already have an assignee and fails before instance creation
if it cannot resolve.

User-owned and agent-package steps may also target a TEAM (#611):
`agent: "team:<teamId>"` (token DSL in `@bakin/core/workflows/team-token`;
plugin-shipped defaults may NOT hardcode teams — same portability rule as
literal agents). The step resolves to a concrete member at dispatch through
the `team.resolveAssignment` hook; the pick is sticky on the instance
(`teamResolutions[stepId]`, first-write-wins via
`workflows.recordStepTeamResolution`) so gate rejections and retries return
to the same agent. Save/start validation checks team existence via
`team.exists` (tiered — unreachable team plugin skips the check and
dispatch fails honestly). Structural resolution failures block the parent
task with the team-routing sentinels; transients ride the dispatch ladder.
Deep reference: `.claude/knowledge/team-aware-assignment.md`.

### Three-tier reference validation (#374)

Nested `workflow_id` existence is deliberately validated at three tiers,
because plugin-default loading runs per-plugin during `activate()` and a
referenced workflow may ship in a plugin that has not activated yet:

1. **Load (structural only, fatal):** `loadDefaultWorkflows` validates each
   YAML in a single pass with `validateNestedWorkflowRefs: false`. Malformed
   definitions, missing `workflow_id`, and self-references are skipped with a
   warn log. A nested ref pointing at a workflow that is not (yet) registered
   is NOT a load error — cross-plugin composition must not depend on plugin
   activation order, hot-reload timing, or user-plugin install order.
2. **Start (strict, fatal):** every start path (REST, hooks, exec tools) goes
   through `createValidatedInstance`, which recursively loads each nested
   definition, detects cycles, and rejects genuinely missing children.
3. **Health (advisory):** the `workflow-definitions` check warns when any
   definition references a nested workflow absent from the live user-disk +
   registry set — order-independent and current under hot reload.

## Runtime Execution Contract

The current runtime is not a general DAG executor. It executes top-level steps
strictly in file order. There is no step-level dependency or approval-routing
surface: `dependsOn` and `gate.on_approve` were deleted (they were validated
metadata the engine never read — approval always advances to the next step, or
completes the workflow at a final gate).

Validation enforces the current engine's real contract:

- `gate.on_reject.goto` can only target the current or an earlier top-level step, and never a `map_workflow` step (target its source step instead).
- `parallel` groups can only contain agent child steps (type, zod schema, and validator all agree).
- `workflow` nested references cannot reference themselves (fatal everywhere). Existence is tiered (#374): not checked at plugin-default load, fatal at start time, advisory in the `workflow-definitions` health check. `map_workflow.workflow_id` follows the identical tiering and joins start-time cycle detection.
- `map_workflow.source` must be `<stepId>.<outputKey>` naming a strictly EARLIER top-level step (the deleted `dependsOn` validator's rule shape) — which makes a first-step map statically illegal.
- `output` steps require an agent owner so channel-post authorization has a concrete principal.
- Nested maps (a map child whose workflow contains another map) are unsupported in v1 — the `workflow-definitions` health check warns.

The builtin node-type zod schemas are **strict**: unknown YAML keys are
rejected at the CRUD/save boundary with an error naming the key, and the
`workflow-definitions` health check warns when an on-disk or registry
definition carries stray keys (they never pass through zod at load). Step
`output_schema` on agent/output steps is a declared field — it is injected
into the dispatch prompt by step-format. The TS index signatures on step types
exist for runtime augmentation (rejectionReason, plugin node-kind config), not
YAML freedom.

Agents are also gated at tool-use time. Workflow step reads and submissions use
the actual MCP caller, not a caller-supplied `agentId`. Progress logs and task
blocking are allowed only for the current step owner. Direct task completion is
denied while a workflow is active. Channel posts are allowed only for the current
owner of the active `output` step.

When a workflow-backed task is explicitly blocked through `blockTaskWithEffects`,
core task-service invokes `workflows.cancelInstance` best-effort with the block
reason. (A completed task never reaches this path — the completion guard rejects
the block first, #482.) The engine's own column moves go through
`syncLedgerForStoreMove`, so reopening a completed instance deletes the
completion row and re-completion records a fresh one. A blocked board task must not leave a stale `in_progress` workflow
instance behind. Recovery should happen through explicit reopen/retry flows
such as `workflows.reopenFromStep`, not by silently continuing the canceled
instance.

## Map Fan-out (`map_workflow`, #203)

The one dynamic-width primitive in the otherwise ordered-list executor
(design: `.claude/specs/workflow-map-fanout-design.md`). When the sequence
reaches a `map_workflow` step, `fanOutMapStep` (engine.ts) spawns one ordinary
nested-workflow instance per element of the source step's output array:
`childTaskId = {taskId}--{stepId}--{i}`, parentContext = the source step's
full output + the item under `item_key` (default `item`) + `mapIndex`/`mapTotal`,
one fraction-titled board task per child. Gates inside children, cycle
detection, and board visibility come from the existing nested machinery.

- **Typed failure:** missing key / non-array / over `max_children` (default 32)
  → `StepState.code = 'map_source_invalid'` + `status: 'failed'` + instance
  `failed`, zero children spawned. `getCurrentStep` returns a
  `{ status: 'failed', code }` context; recovery = `reopenFromStep` on the
  SOURCE step (reopening AT a map step is refused everywhere). Empty array →
  step completes with `{ outputs: [] }` and the workflow advances.
- **Mid-fan-out status:** `getCurrentStep` on the parent returns a typed
  `{ status: 'fanned_out', childrenTotal, childrenComplete }` context — never
  null (null means "no instance" on the REST/tool surfaces) — and the
  dispatch loop skips it explicitly. Children that fail during spawn record
  an honest `failed` entry; a map-child's own typed failure propagates to its
  parent entry via `markMapChildFailed`.
- **Stale-child sweep:** `sweepLiveMapChildren` rediscovers live children from
  the INSTANCE STORE (never the parent's cached `children[]`, which a
  source-step reopen wipes) and runs before EVERY fan-out outcome — valid,
  empty, or invalid — and again inside `cancelInstance` (stray rediscovery),
  so reopen/cancel sequences can never orphan running children.
- **Join:** `propagateChildCompletion`'s map branch updates the child's entry
  in `StepState.children[]` with the child's finalOutput; when ALL entries are
  complete it aggregates `{ outputs: [...] }` in stable source order and
  advances. Failed/cancelled children block the join — never cascade.
- **Per-child recovery** (`lib/map-children.ts`): `retryMapChild` (live child
  reopens in place; dead/missing child re-creates under the same id via the
  shared `buildMapChildContext`), `cancelMapChild`, `listMapChildren` (LIVE
  child statuses — cached entries can lag out-of-band changes). Surfaces:
  `workflows.{retryMapChild,cancelMapChild,listMapChildren}` hooks,
  `GET/POST /instances/:taskId/map/:stepId/children[...]` routes,
  `bakin_exec_workflows_{retry,cancel}_map_child` exec tools. There is also
  `POST /instances/:taskId/reopen` (REST surface over `reopenFromStep`).
- **Re-fan-out** after a source rewind sweeps stale live children before
  reusing ids; orphans beyond the new width are retired from the board.
- **UI:** the canvas node is definitional only (children are runtime
  instances); the live rollup + per-child retry/cancel live on the task
  detail panel (`plugins/tasks/components/task-workflow-panels.tsx`
  `MapChildrenPanel`).
- **Budget:** the aggregated outputs ride the existing
  `dispatch.maxWorkflowContextBytes` cap like any step output (pinned by
  `tests/core/dispatch-workflow-context.test.ts`).
- First production consumer: `image-multi-select` + `image-variant`
  (`plugins/images/defaults/workflows/`), validated live via
  `scripts/validate-map-select.ts` + `docs/validation/map-select-runbook.md`.
- Engine tests: `tests/plugins/workflows/runtime-map.test.ts`,
  `map-child-surfaces.test.ts`, `image-multi-select-flow.test.ts`.

## Node-Type Registry

`plugins/workflows/lib/node-type-registry.ts`. Builtins self-register at module load; plugins add more via `ctx.registerNodeType`:

| Kind | Schema | Purpose |
|------|--------|---------|
| `agent` | `agentStepSchema` | Dispatch to a single agent with skill + inputs |
| `gate` | `gateStepSchema` | Human (or auto-) approval before continuing |
| `parallel` | `parallelStepSchema` | Fan out to multiple steps; converge on completion |
| `output` | `outputStepSchema` | Final step that materializes workflow output |
| `workflow` | `nestedWorkflowStepSchema` | Invoke another workflow as a sub-step |
| `createTask` | `createTaskStepSchema` | Create a real board task from a workflow |

Each `NodeTypeDef<T>` carries:
- `kind` — string discriminator (plugin kinds are auto-namespaced as `{pluginId}.{kind}`)
- `runtime: 'builtin' | 'plugin'` — distinguishes self-registered kinds from those contributed via `ctx.registerNodeType`
- `pluginId?` — set when `runtime === 'plugin'`; identifies the owning plugin
- `zodSchema` — validates step shape; the top-level `workflowDefinitionSchema` uses a `z.union` over the builtin discriminated union + a plugin-passthrough branch that delegates to the registered schema for the step's `type`
- `formFields` — typed metadata that drives the inline node-config drawer
- `edgeRules` — `{ maxInbound?, maxOutbound? }` consumed by the canvas editor's `canConnect` helper. Plugin kinds default to `{ maxOutbound: 1 }` when they don't ship their own.

The canvas editor's palette fetches `GET /api/plugins/workflows/node-types` on mount so it sees every registered kind, including plugin contributions. The drawer uses `getNodeType(kind).formFields` to render the right inputs and `safeParse` against the kind's `zodSchema` on Apply — schema drift between the loader and the editor is impossible by construction.

Plugin registration goes through `ctx.registerNodeType`, which:
1. Calls `registerPluginNodeType(pluginId, def)` — namespaces the kind to `{pluginId}.{kind}` and stores `runtime: 'plugin'`.
2. Registers a `workflows.executeNode.{namespacedKind}` hook; `runtime.ts` looks this up when it encounters a step whose `type` isn't a builtin.

The client-side node renderer map is owned by the workflows plugin's `lib/node-renderer-registry.ts`. Plugins that ship custom kinds call `registerNodeRenderer(kind, Component)` from the workflows plugin's registry in their own `client.tsx` — there is no cross-plugin `nodeRenderers` export. The workflows plugin itself does this for the 7 builtins (see `plugins/workflows/client.tsx`).

## Notification Channel Registry

`plugins/workflows/lib/notification-channel-registry.ts`. Same shape as the node-type registry — `Map<id, NotificationChannelDef>` with 4 built-in runtime channel ids (`general`, `announcements`, `alerts`, `email`) self-registering at module load. Plugins add more via `ctx.registerNotificationChannel`:

```ts
ctx.registerNotificationChannel({
  id: 'mastodon',
  label: 'Mastodon',
  initials: 'MA',      // optional; falls back to id.slice(0, 2).toUpperCase()
  icon: 'MessageSquare', // optional lucide-react export name
})
// returns namespaced id: 'socialstack.mastodon'
```

Plugin ids are auto-namespaced as `{pluginId}.{id}`; builtins keep their short runtime-channel ids (`general`, `alerts`, etc.). `NotifyChannel.channel` in `plugins/workflows/types.ts` is `string` and the zod schema at `notifyChannelSchema` uses `z.string().min(1)`.

**Cross-plugin read surfaces:**
- `workflows.notificationChannels.list` — HookRegistry, returns `NotificationChannelDef[]`
- `workflows.getNotificationChannel` — HookRegistry, takes `{ id }`, returns `NotificationChannelDef | null`
- `GET /api/plugins/workflows/notification-channels` — REST, returns `{ channels: NotificationChannelDef[] }`

**Client consumers** use `useNotificationChannels()` from `plugins/workflows/hooks/use-notification-channels.ts` — module-level promise cache with single-flight coalescing so concurrent mounts share one fetch. Paired helpers `getChannelLabel(id, channels)` + `getChannelInitials(id, channels)` return raw-id fallbacks for orphan refs (channel ids that were removed from the registry but still appear in persisted workflow definitions).

**Icon rendering** goes through `<ChannelIcon channelId="..." />` in `plugins/workflows/hooks/channel-icon.tsx`, which holds an explicit lucide map. `import * as Lucide` is deliberately avoided to keep the client bundle small — unknown icon names silently fall back to `HelpCircle`. Widening the map (or switching to an `IconSpec` discriminator that accepts emoji/URL/SVG) is a future concern when a plugin actually needs non-lucide icons.

Teardown: `unregisterPluginNotificationChannels(pluginId)` is called by `src/core/plugin-registry.ts` in the user-plugin-overrides-builtin path alongside `unregisterPluginNodeTypes`, so hot reload of a plugin that registered channels doesn't leak `{pluginId}.{id}` entries.

The official Messaging plugin resolves channels through this registry from `bakin-bits-official/plugins/messaging`; the old hardcoded channel label/icon maps are gone.

Registry ids are logical workflow/UI ids, not guaranteed provider delivery
targets. Delivery tools resolve `#general`, `general`, and other labels through
`settings.notifications.channelAliases` via `src/core/channel-aliases.ts`
before they call `runtime.channels.*`. Use fully-qualified runtime targets such
as `discord:<target>` in aliases. A bare value is accepted only when it matches
an id from `runtime.channels.list()`. Legacy
`notifications.channel` + `notifications.target` settings act as the default
`general` alias only when no explicit `channelAliases.general` exists.

## Runtime Gate Approvals

Workflow gate channel approvals are Bakin-owned durable records, not provider-owned state. `plugins/workflows/lib/approval-store.ts` persists records under `~/.bakin/workflows/approvals/` before `runtime.channels.createApproval()` renders provider messages.

The approval record contains the `approvalId`, workflow/run/task/step owner, request body/options/context, delivery refs, response data, and timestamps. Runtime channel message ids are stored only as delivery refs. Channel interaction payloads carry `approvalId`; the workflows plugin loads the durable record and gets task/step identity from Bakin state before approving or rejecting a gate.

Gate delivery resolves `approvalChannel` through `resolveRuntimeChannelRef` (`src/core/channel-aliases.ts` — the same resolver as `bakin_exec_post_channel`), so the setting may be a `notifications.channelAliases` alias, a `provider:target` ref, or a bare runtime channel id. Resolution failure logs at error level and skips delivery; the durable record is created first so rehydration can retry after a config fix.

Channel approval requests include a Bakin-owned fallback URL in the request context. Provider-native buttons may expire or fail independently of the workflow gate; the fallback page posts back to the workflows plugin and uses the same durable approval record, audit trail, summary notification, and render resolution path as the Bakin UI. Native buttons render regardless of `requireRejectReason`: a button reject records the default reason `Rejected via runtime channel (no reason provided)`, while the Bakin UI and fallback page require a typed reason unconditionally.

Startup calls `rehydratePendingApprovals()` from `plugins/workflows/lib/approval-rehydration.ts`. It garbage-collects first (resolved records older than 30 days are deleted; orphaned pending records whose instance is gone or no longer pending at that gate are cancelled), then reattaches stored delivery refs to pending workflow instances and retries `runtime.channels.createApproval()` for pending records that were written before rendering completed. Duplicate render windows are tolerated; the durable Bakin approval record remains the source of truth. Deep reference: `.claude/knowledge/workflow-approvals.md`.

### Cross-Plugin Gate Resolution Hooks

Plugins that own their own review UI resolve workflow gates through
HookRegistry, never by importing workflow runtime internals or calling the
workflows REST routes from inside the server process:

- `workflows.approveGate` takes `{ taskId, stepId, approver?, contentDir? }`
  and returns the same result shape as `approveGate()`.
- `workflows.rejectGate` takes `{ taskId, stepId, reason, approver?,
  rewindTo?, contentDir? }` and returns the same result shape as
  `rejectGate()`.
- `workflows.reopenFromStep` takes `{ taskId, stepId?, reason, actor?,
  contentDir? }` and reopens the same workflow instance/task at an actionable
  step. If `stepId` is a gate, the runtime resolves the gate's reject target or
  previous actionable top-level step. This is for explicit user recovery flows;
  it is not a generic background retry mechanism.

`approver` should use the `ApprovalActor` shape from
`packages/core/src/plugin-types.ts`: `{ id, displayName?, source }`. Passing a
bare string does not produce a useful decision actor for downstream audit,
notifications, or UI rendering.

Workflow-backed tasks should still be spawned by creating a Bakin task with
`workflowId` set. `src/core/task-service.ts` invokes
`workflows.createInstance` automatically during task creation. A plugin that
needs the resulting workflow state should look it up afterward with
`workflows.loadInstance`; it should not call `workflows.createInstance`
directly unless it is intentionally attaching a workflow to an already-created
task.

### Built-In `createTask` Step

`createTask` is the workflow-native way to schedule follow-up board work. It
creates a task through `createTaskWithEffects`, so normal task side effects,
workflow instance creation, audit, dispatch eligibility, and task provenance all
stay centralized.

Supported task fields include:

- `title`
- `description`
- `agent`
- `column`
- `workflowId`
- `parentId`
- `projectId`
- `availableAt`
- `dueAt`
- `source`

The runtime uses a deterministic task id by default
`${parentTaskId}--${step.id}`. If that task already exists, the step completes
without creating a duplicate. Use this for one-time scheduled work; do not model
that as plugin-owned cron or health-check behavior.

## CRUD Routes

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/definitions` | List, including `source` and `pluginId` for plugin-owned entries |
| `GET` | `/definitions/:name` | Single definition with provenance |
| `POST` | `/definitions` | Validate against `workflowDefinitionSchema` plus runtime semantic rules, write to `~/.bakin/workflows/definitions/{slug}.yaml`. 409 on slug collision (user dir), 400 on validation failure. |
| `PUT` | `/definitions/:name` | Same validation. **403 if `isReadOnly(name)`** — caller must POST a new id instead. |
| `DELETE` | `/definitions/:name` | **403 on plugin-owned**. 200 on user-owned; warning payload lists nested workflows pointing at the deleted id. |

The watcher syncs YAML → search index within ~300 ms, so no extra indexing call is needed in the routes.

## UI

| Page | Component |
|------|-----------|
| `/workflows` | `plugins/workflows/components/workflows-page.tsx` — grid of cards |
| `/workflows/:id` | `plugins/workflows/components/workflow-detail.tsx` — canvas + step drawer; read-only banner if `source === 'plugin'` |
| `/workflows/new` | wraps `workflow-canvas-editor.tsx` in create mode |
| `/workflows/:id/edit` | wraps `workflow-canvas-editor.tsx` in edit mode (plugin-owned sources offer Save-as-new only) |

`workflow-card.tsx` adds a "Provided by {pluginId}" badge when source is plugin.

### Canvas Editor (`workflow-canvas-editor.tsx`)

Sole editor for create and edit. Wraps xyflow with three panels:

- **Toolbar** (top): workflow name/description inputs, Auto-arrange (dagre LR re-layout), Save / Save-as-new / Delete.
- **Palette** (left): `node-type-palette.tsx` — lists every registered kind, grouped as "Builtin" vs "Plugins" with the `pluginId` badge. Drag a tile onto the canvas to mint a new step; the drag MIME type is `application/x-bakin-node-kind`.
- **Canvas** (centre): xyflow with the full `NodeRendererRegistry` passed as `nodeTypes`. Edges are user-drawn; `canConnect` (from `lib/edge-rules.ts`) enforces `edgeRules` from the node-type registry and toasts the rejection reason. `onNodesChange` persists positions into `state.positions`, which are serialized as `definition.layout.positions` on save.
- **Drawer** (right, contextual): `node-config-drawer.tsx` — opens when a node is clicked. Renders fields from `getNodeType(step.type).formFields`, validates the candidate step via `zodSchema.safeParse` on Apply, and surfaces Zod issues inline.

When a definition has no `layout.positions`, the editor runs `layoutNodes` from `lib/dagre-layout.ts` on load with `rankdir: 'LR'` so nodes don't stack at (0, 0). The "Auto-arrange" button re-runs the same layout on demand, respecting whatever edges the user has drawn.

`GET /api/plugins/workflows/node-types` is the single source of truth the palette hydrates from — plugin-registered kinds appear in the palette without a core change.

## Plugin-Assets Install Pipeline (S-B)

```
runtime skill store:
  SKILL.md
  scripts/...
  .installedBy        ← {"pluginId": "<id>", "sha256": "<hex>"}
  .userEdited         ← optional empty sentinel — locks the dir from overwrite
```

`src/core/onboarding/plugin-assets.ts` exports:

```typescript
scanPluginAssets(plugins) → ScanReport       // {totalAvailable, missing, drifted, installed, userEdited}
installPluginAssets(plugins) → InstallReport // {installed, unchanged, skipped(userEdited)}
pluginAssetsComponent: OnboardingComponent   // .check() + .install() following the standard interface
```

`discoverPlugins()` reads `bakin.config.ts` (built-in plugins) and walks `~/.bakin/plugins/{id}/bakin-plugin.json` (user plugins). Runtime skill projection goes through the active runtime adapter; the installer never reaches provider storage directly.

Drift rules:
- **Missing** — no `SKILL.md` at the install path → `install` will copy.
- **Drifted** — install sha256 differs from source sha256 → `install` will overwrite.
- **`.userEdited` present** — `install` skips and reports under `skipped`. The sentinel is forever; user must delete it manually to opt back into managed updates. (Phase 2D issue tracks a 3-way merge UX.)

### CLI Surface

```bash
bakin install plugin-assets [--yes]    # apply pending installs
bakin check plugin-assets              # report drift, never write
bakin plugins upgrade <id>             # also reapplies that plugin's runtime skills
```

The install/check commands are wired through `cmdOnboardingInstallSingle` / `cmdOnboardingCheckSingle` in `cli/bakin.ts`. `pluginAssetsComponent` is also part of `COMPONENT_ORDER` in `src/core/onboarding/index.ts`, so `bakin onboard --yes` covers it as a side effect on a fresh machine.

The plugin upgrade flow calls `installPluginAssets([{ id, path }])` after a committed rebuild and before marking the upgrade complete in the lockfile. Unexpected asset install failures fail the upgrade response. `.userEdited` runtime skills remain protected and are reported as skipped.

### Doctor Surface

`src/core/doctor.ts::checkPluginAssets()` calls `pluginAssetsComponent.check()` and renders one diagnostic line:

- `ok` — message echoes the component result (e.g. "0 plugin assets to install" or "All N plugin asset(s) installed").
- `warn` — message ends with the remediation reminder (`Run \`bakin install plugin-assets\` to apply.`). **Doctor never auto-installs.**

## Test Conventions

Same non-negotiable rules as the rest of the codebase:

- Every test mocks `getContentDir` to a temp dir.
- Every test that needs runtime skill storage mocks the runtime adapter.
- The plugin-assets tests use a synthetic in-memory plugin under a temp dir — no checked-in fixture plugin.
- Source-registry tests call `clearSourceRegistry()` in `beforeEach`/`afterEach` so global state stays clean across cases.

## Key Files

| File | Purpose |
|------|---------|
| `plugins/workflows/lib/runtime.ts` | Workflow execution, step ownership, and active-workflow tool authorization |
| `plugins/workflows/lib/approval-store.ts` | File-backed durable workflow approval records |
| `plugins/workflows/lib/approval-rehydration.ts` | Startup reattachment/retry for pending workflow approvals |
| `plugins/workflows/lib/notifications.ts` | Runtime channel notifications and gate approval rendering |
| `plugins/workflows/lib/parser.ts` | `loadDefinition`, `listDefinitions`, and semantic validation of the runtime-supported workflow contract |
| `plugins/workflows/lib/source-registry.ts` | Per-id source index with user > agent-package > plugin precedence |
| `plugins/workflows/lib/node-type-registry.ts` | Zod schemas + form metadata for the 5 builtins |
| `plugins/workflows/lib/load-defaults.ts` | Reads `defaults/workflows/*.yaml` and calls `ctx.registerWorkflow` per file |
| `plugins/workflows/lib/skill-loader.ts` | Resolves `step.skill` to in-memory body (S-A) |
| `plugins/workflows/lib/edge-rules.ts` | `canConnect()` validator used by canvas `isValidConnection` |
| `plugins/workflows/lib/dagre-layout.ts` | Pure `layoutNodes()` wrapper — used on load + Auto-arrange |
| `plugins/workflows/lib/node-renderer-registry.ts` | Client-side registry of per-kind renderers (aggregated from plugins) |
| `plugins/workflows/components/workflow-canvas-editor.tsx` | Sole editor — drives `/workflows/new` + `/workflows/:id/edit` |
| `plugins/workflows/components/node-type-palette.tsx` | Draggable palette grouped by builtin vs plugin |
| `plugins/workflows/components/node-config-drawer.tsx` | Inline per-step form driven by `formFields` + Zod |
| `plugins/workflows/components/workflow-card.tsx` | Grid card with source badge |
| `plugins/workflows/components/workflow-detail.tsx` | Canvas + read-only banner |
| `src/lib/plugin-skill-loader.ts` | Generic auto-register for `defaults/workflow-skills/*.md` (called from plugin-registry) |
| `src/core/onboarding/plugin-assets.ts` | S-B install + drift |
| `src/core/onboarding/index.ts` | `COMPONENT_ORDER` includes `pluginAssetsComponent` |
| `src/core/doctor.ts::checkPluginAssets` | Drift surface in `bakin doctor` |
| `cli/bakin.ts` | `bakin install/check plugin-assets` dispatch |

## Future Work

Tracked as separate GitHub issues:

- **2C — Plugin distribution**: `bakin plugin install <name>` from a registry/git and signature verification.
- **2D — Skill rebase UX**: replace `.userEdited` warn-and-skip with 3-way merge and a UI for resolving conflicts.

Phases 2A (plugin-registered node types) and 2B (visual canvas editor) shipped together — see the Node-Type Registry and Canvas Editor sections above.
