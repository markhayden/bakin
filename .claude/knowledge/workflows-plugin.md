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
| **Drift detection** | None — rebuilt every server boot | `.installedBy` JSON marker (sha256), `.userEdited` sentinel, `bakin doctor` surface |

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
| `defaults/workflow-skills/` | `src/lib/plugin-skill-loader.ts` (invoked by `src/lib/plugin-registry.ts` after every `activate()`) | Server boot, every startup, generic across all plugins |
| `defaults/runtime-skills/` | `src/core/onboarding/plugin-assets.ts` (`scanPluginAssets` + `installPluginAssets`) | `bakin install plugin-assets` (manual), or surfaced by `bakin doctor` |

The first two paths are in-memory only — every reboot rebuilds them from disk. The third writes to the runtime skill store and needs explicit drift management.

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
as `basil`, `pixel`, `rolo`, or `roscoe` in default definitions. Use the
symbolic `$assigned` token for every shipped `agent:` value until Bakin grows a
provider-neutral role/capability selector.

User-owned and agent-package workflow YAML can use literal local agent ids.
Start-time validation checks those ids against the runtime roster. `$assigned`
requires the task to already have an assignee and fails before instance creation
if it cannot resolve.

Default workflow loading is two-pass: Bakin parses every file, builds the set of
known workflow ids, then validates. Nested workflow references are therefore not
filesystem-order dependent.

## Runtime Execution Contract

The current runtime is not a general DAG executor. It executes top-level steps in
file order. `dependsOn` is preserved as metadata and validation, but it cannot
pull a future step forward or express arbitrary graph branching.

Validation enforces the current engine's real contract:

- `dependsOn` can only reference earlier top-level steps.
- `gate.on_approve` must advance to the next top-level step, or `done` for a final gate.
- `gate.on_reject.goto` can only target the current or an earlier top-level step.
- `parallel` groups can only contain agent child steps; gates, output steps, nested workflows, and child `dependsOn` are rejected.
- `workflow` nested references must resolve to known definitions and cannot reference themselves. Start-time validation rejects nested workflow cycles.
- `output` steps require an agent owner so channel-post authorization has a concrete principal.

Agents are also gated at tool-use time. Workflow step reads and submissions use
the actual MCP caller, not a caller-supplied `agentId`. Progress logs and task
blocking are allowed only for the current step owner. Direct task completion is
denied while a workflow is active. Channel posts are allowed only for the current
owner of the active `output` step.

## Node-Type Registry

`plugins/workflows/lib/node-type-registry.ts`. 5 builtins self-register at module load; plugins add more via `ctx.registerNodeType`:

| Kind | Schema | Purpose |
|------|--------|---------|
| `agent` | `agentStepSchema` | Dispatch to a single agent with skill + inputs |
| `gate` | `gateStepSchema` | Human (or auto-) approval before continuing |
| `parallel` | `parallelStepSchema` | Fan out to multiple steps; converge on completion |
| `output` | `outputStepSchema` | Final step that materializes workflow output |
| `workflow` | `nestedWorkflowStepSchema` | Invoke another workflow as a sub-step |

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

Teardown: `unregisterPluginNotificationChannels(pluginId)` is called by `src/lib/plugin-registry.ts` in the user-plugin-overrides-builtin path alongside `unregisterPluginNodeTypes`, so hot reload of a plugin that registered channels doesn't leak `{pluginId}.{id}` entries.

The official Messaging plugin resolves channels through this registry from `bakin-bits-official/plugins/messaging`; the old hardcoded channel label/icon maps are gone.

## Runtime Gate Approvals

Workflow gate channel approvals are Bakin-owned durable records, not provider-owned state. `plugins/workflows/lib/approval-store.ts` persists records under `~/.bakin/workflows/approvals/` before `runtime.channels.createApproval()` renders provider messages.

The approval record contains the `approvalId`, workflow/run/task/step owner, request body/options/context, delivery refs, response data, and timestamps. Runtime channel message ids are stored only as delivery refs. Channel interaction payloads carry `approvalId`; the workflows plugin loads the durable record and gets task/step identity from Bakin state before approving or rejecting a gate.

Channel approval requests include a Bakin-owned fallback URL in the request context. Provider-native buttons may expire or fail independently of the workflow gate; the fallback page posts back to the workflows plugin and uses the same durable approval record, audit trail, summary notification, and render resolution path as the Bakin UI. Gates that require reject reasons must use the fallback page unless the provider can return a structured reason.

Startup calls `rehydratePendingApprovals()` from `plugins/workflows/lib/approval-rehydration.ts`. It reattaches stored delivery refs to pending workflow instances and retries `runtime.channels.createApproval()` for pending records that were written before rendering completed. Duplicate render windows are tolerated; the durable Bakin approval record remains the source of truth.

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
```

Both are wired through `cmdOnboardingInstallSingle` / `cmdOnboardingCheckSingle` in `cli/bakin.ts`. `pluginAssetsComponent` is also part of `COMPONENT_ORDER` in `src/core/onboarding/index.ts`, so `bakin onboard --yes` covers it as a side effect on a fresh machine.

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

- **2C — Plugin distribution**: `bakin plugin install <name>` from a registry/git, signature verification, automatic `plugin-assets install` after upgrade.
- **2D — Skill rebase UX**: replace `.userEdited` warn-and-skip with 3-way merge and a UI for resolving conflicts.

Phases 2A (plugin-registered node types) and 2B (visual canvas editor) shipped together — see the Node-Type Registry and Canvas Editor sections above and `.claude/specs/workflows-phase-2-plugin-nodes-and-canvas.md` for the original spec.
