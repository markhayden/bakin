# SPEC — Workflows Phase 2A + 2B: Plugin-Registered Node Types + Visual Canvas Editor

**Status:** Draft awaiting approval
**Branch:** `issue-107-108-workflows-phase-2`
**Issues:** [#107](https://github.com/madeinwyo/bakin/issues/107) (Phase 2A), [#108](https://github.com/madeinwyo/bakin/issues/108) (Phase 2B)
**Owner:** roscoe@madeinwyo.com
**Date:** 2026-04-20
**Predecessor:** `.claude/specs/workflows-plugin-architecture.md` (shipped 2026-04)
**Next step:** `/agent-skills:plan` (include commit/checkpoint strategy) → `/agent-skills:build` → `/agent-skills:test`

---

## 1. Problem & Framing

The 2026-04 overhaul shipped the foundation: source registry, node-type registry, form editor, CRUD routes, `registerWorkflow`. Two slots were deliberately left closed, with the registry shape already forward-compatible:

1. **Closed node-type set.** The 5 builtins (`agent`, `gate`, `parallel`, `output`, `workflow`) are the only step kinds workflows can use. `registerNodeType()` exists but is not exposed to plugins.
2. **Form-driven editor.** `workflow-editor.tsx` uses per-step forms, not the canvas. The canvas at `/workflows/:id` is read-only. Users can't drag nodes, connect edges, or author visually.

Phase 2A opens the node-type registry so plugins define their own step kinds. Phase 2B replaces the form editor with on-canvas editing. They ship together on one branch because 2B consumes 2A's renderer-split contract — plugin-registered node types' client renderers drop onto the canvas via the same registry.

---

## 2. Goals

| # | Goal | Acceptance signal |
|---|------|-------------------|
| G1 | Plugins can register workflow node types via `ctx.registerNodeType()` with `{pluginId}.{kind}` namespacing | An integration test registers a synthetic `demo.note-step` node type, builds a workflow using it, validates, and executes end-to-end through the hook dispatch path |
| G2 | Client renderers for plugin node types do not leak into server bundles | SSR build succeeds with no React imports pulled into server code from plugin renderers; client bundle size is unaffected for plugins that only ship SSR metadata |
| G3 | Runtime executes plugin node types through `workflows.executeNode.{kind}` without touching its builtin execution paths | 7 live production workflows (`video-script`, `clip-creation`, etc.) run byte-identically to pre-Phase-2A behavior; a workflow with a plugin node type completes successfully with the hook handling execution |
| G4 | Workflows can be authored visually on the xyflow canvas — create, edit, connect edges, configure nodes, save | A user builds a workflow with ≥3 steps including a `parallel`, connects edges, configures inline via drawer, saves, reloads, runs. No filesystem editing involved. |
| G5 | YAML saved by the canvas is byte-equivalent to YAML the form editor would have produced for the same definition | A round-trip test: parse existing YAML → render on canvas → save → diff the two YAML files. Diff is empty. |
| G6 | The form editor is deleted in the same branch that ships the canvas editor | `plugins/workflows/components/workflow-editor.tsx` is gone; `app/workflows/new/page.tsx` and `app/workflows/[id]/edit/page.tsx` render the canvas editor |

---

## 3. Non-Goals (in scope of this work)

- Auto-layout for arbitrary existing workflows. Only new/empty workflows get snap-to-grid + simple auto-layout. Loaded workflows use saved positions.
- Per-node-type *graphical theming* (custom colors, icons beyond a lucide glyph). MVP: plugin-registered kinds inherit a single generic plugin-node style.
- A visual debugger or runtime inspector overlaid on the canvas.
- Drag-between-tabs multi-workflow editing.
- Import/export of third-party workflow formats (n8n, Zapier, etc.).
- Migration of existing `~/.bakin/workflows/definitions/` user YAMLs. They keep working; the canvas reads and writes the same schema.
- Backwards compatibility shims for the form editor. It is deleted, not hidden behind a flag.
- Plugin distribution / installation (Phase 2C, tracked separately).
- A demo plugin shipped in `tests/fixtures/`. Per conversation: one integration test exercises the plugin path via an in-test synthetic node type; the fixture directory is not needed.

---

## 4. User Stories

1. **A plugin author registers a custom node type.** In their plugin's `activate(ctx)`, they call `ctx.registerNodeType({ kind: 'note-step', zodSchema, formFields, execute })`. At startup, the kind becomes available in the editor as `demo.note-step` (auto-namespaced by pluginId). A workflow using `type: 'demo.note-step'` validates on save and executes at runtime.
2. **A plugin author ships a client renderer for their node type.** They register SSR-safe pieces (kind, schema, form metadata) from a server-safe module, and a client renderer from a client module (`'use client'`). The canvas renders the custom node on the client without the React code landing in the server bundle.
3. **A user builds a workflow visually.** From `/workflows`, click "New". Empty canvas with a "Trigger" root node. Drag from a node-type palette onto the canvas to add steps. Connect edges by dragging from a node's output handle to another node's input handle. Click a node to open the inline config drawer. Configure `agent`, `skill`, `description`. Save.
4. **A user edits an existing workflow.** Open `/workflows/:id/edit` — canvas shows the saved node positions and edges. Move a node, change a configured value in the drawer, save. YAML rewritten atomically.
5. **A user tries to break the edge rules.** They drag from a `gate` node's output while an edge already exists. The canvas rejects the connection (gate has exactly one out-edge). Error toast: "A gate can have only one on_approve target." Same for an `output` node's outbound (none allowed), and `parallel` spawning children (edges carry semantic meaning inside the parallel container, handled as a sub-canvas).
6. **A user opens the canvas on a plugin-owned workflow.** The canvas loads read-only — no handles, no drawer-save, only a "Save as new" button that prefills a user-owned copy. Existing read-only banner from `workflow-detail.tsx` is preserved.

---

## 5. MVP Scope vs Deferred

### In MVP (this branch)

**Phase 2A:**
- `ctx.registerNodeType()` added to `PluginContext`, implemented in `plugin-registry.ts`.
- Auto-namespacing: the registry prefixes every plugin-registered `kind` with `{pluginId}.`. Builtins keep their un-prefixed names (`agent`, `gate`, etc.).
- SSR/client renderer split: `NodeTypeDef` stays SSR-safe (no React imports). A new `NodeRendererRegistry` (client-only module) holds the per-kind canvas component.
- Runtime dispatch: `runtime.ts` gains **one** new branch. For step.type not matching any builtin kind, it invokes `workflows.executeNode.{kind}` and treats the result as agent-style output (same completion semantics as an `agent` step). All existing builtin branches are untouched.
- The 5 builtins keep working unchanged — they self-register at module load as today.
- Hook naming: `workflows.executeNode.{namespacedKind}` (e.g. `workflows.executeNode.demo.note-step`). The registering plugin invokes `ctx.hooks.register()` for it as part of `registerNodeType`, supplying an `execute` function.
- Integration test covers: register → YAML validation picks up new schema → form editor renders subform → `loadDefinition` parses → runtime dispatches to hook → hook returns output → step completes.

**Phase 2B:**
- New component `plugins/workflows/components/workflow-canvas-editor.tsx` — editable xyflow canvas.
- Node-type palette (left sidebar or floating): lists builtins + all plugin-registered kinds. Drag-to-add.
- Inline config drawer (right side): opens when a node is clicked, renders the node type's `formFields` metadata as a subform, saves back to the node on blur/apply.
- Edge connection rules enforced in the canvas `onConnect` handler:
  - `agent` → 1 outbound, N inbound (dependsOn graph)
  - `gate` → 1 outbound (`on_approve`), N inbound
  - `parallel` → edges treated specially: dragging into a `parallel` node adds the child to `parallel.steps`; dragging out resumes after join
  - `output` → 0 outbound, N inbound
  - `workflow` (nested) → 1 outbound, N inbound
  - Plugin kinds: agent-style defaults (1 outbound, N inbound) unless the `NodeTypeDef` declares otherwise via a new `edgeRules` field
- Snap-to-grid: 16px grid. Enabled by default.
- Auto-layout: `@dagrejs/dagre` for a horizontal top-down layout. Runs once on "empty workflow opened" and once on "auto-arrange" button click. Saved positions override auto-layout on subsequent loads.
- Routes unchanged: `POST /definitions` (new), `PUT /definitions/:name` (edit). Both refuse plugin-owned ids via existing `isReadOnly(name)` check.
- `workflow-editor.tsx` and its tests deleted. `app/workflows/new/page.tsx` and `app/workflows/[id]/edit/page.tsx` updated to wrap the canvas editor.

### Deferred (track via Phase 2C/2D issues, already filed)

- Plugin distribution / marketplace (2C).
- Skill rebase UX (2D).
- Visual debugger overlay.
- Custom per-plugin graphical theming beyond a generic "plugin node" style.
- Auto-layout for non-empty workflows where the user wants to re-arrange.

---

## 6. Locked Architecture Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| AD1 | Plugin node type `kind` is auto-namespaced as `{pluginId}.{kind}` by the registry. Plugins register with the unprefixed kind. | Avoids cross-plugin collisions; plugin author doesn't have to remember to prefix; registry enforces uniformly. |
| AD2 | `NodeTypeDef` stays SSR-safe. Client renderer is registered through a separate client-only module (`NodeRendererRegistry`). Builtins register both from client and SSR paths; plugins register SSR metadata via `ctx.registerNodeType` and client renderer via a **client-safe entry point** convention (same plugin's client bundle imports a `registerClientRenderer(kind, component)` helper). | Prevents plugin React code from landing in server bundles and breaking SSR. Matches Next.js 16 App Router `'use client'` discipline. |
| AD3 | Runtime gains exactly one new branch for plugin node types: "if kind is not a builtin, invoke `workflows.executeNode.{kind}` hook, treat result as agent-style output." Every existing builtin branch is untouched. | Minimal change to a production-critical 1200-LOC file. Plugin kinds behave like agent steps from the runtime's perspective — dispatch, output, advance. |
| AD4 | Edge connection rules live in the `NodeTypeDef` as an optional `edgeRules: { maxInbound?, maxOutbound?, onConnect? }` field. Builtins declare their rules; plugins default to agent-style (1 out, N in). | Rules are metadata, not logic. Canvas consumes them; zero coupling back to runtime. |
| AD5 | The form editor is deleted in the same branch as the canvas editor. No overlap, no flag, no fallback. | Per user's "reduce tech debt, no shims" directive. One editor, one path. |
| AD6 | Auto-layout uses `@dagrejs/dagre`. Added to dependencies. | Standard choice for DAG layouts in xyflow ecosystem; small (~50KB); maintained. |
| AD7 | Saved node positions live inside the workflow YAML under a new **optional** top-level `layout: { positions: Record<stepId, {x,y}> }` field, absent for any workflow that hasn't been canvas-edited. | Keeps positions with the definition — no separate layout file. Optional means existing YAMLs remain valid; runtime ignores the field. |
| AD8 | The node-type palette in the canvas editor is populated dynamically from `listNodeTypes()`. Builtins + plugin-registered kinds appear together, distinguished by a small pluginId badge on plugin kinds. | Single source of truth for what's available. Adding a plugin node type makes it appear in the palette automatically. |

---

## 7. Surface Area Changes

### Changed types (`packages/core/src/plugin-types.ts`)

```ts
interface PluginContext {
  // … existing …
  registerNodeType<T>(def: PluginNodeTypeDef<T>): void
}

// SSR-safe — no React imports allowed
interface PluginNodeTypeDef<T = unknown> {
  kind: string                       // unprefixed — registry auto-namespaces
  zodSchema: z.ZodType<T>
  formFields: FormField[]
  edgeRules?: EdgeRules              // optional; defaults to agent-style
  execute: (ctx: NodeExecuteContext) => Promise<NodeExecuteResult>
}
```

### Changed module (`plugins/workflows/lib/node-type-registry.ts`)

```ts
// Added: edgeRules on NodeTypeDef
interface NodeTypeDef<T = unknown> {
  kind: string
  runtime: 'builtin' | 'plugin'
  zodSchema: z.ZodType<T>
  formFields: FormField[]
  edgeRules?: EdgeRules
  pluginId?: string                  // set for runtime: 'plugin'
}

interface EdgeRules {
  maxInbound?: number                // undefined = unlimited
  maxOutbound?: number               // undefined = unlimited
}

// New: helper that namespaces and records pluginId
function registerPluginNodeType(pluginId: string, def: PluginNodeTypeDef): void

// Existing: registerNodeType(), getNodeType(), listNodeTypes() unchanged
```

### New client-only module (`plugins/workflows/components/node-renderer-registry.tsx`)

```ts
'use client'

// Map of namespaced kind → client React component
const renderers = new Map<string, ComponentType<NodeRendererProps>>()

export function registerClientRenderer(kind: string, component: ComponentType<NodeRendererProps>): void
export function getClientRenderer(kind: string): ComponentType<NodeRendererProps> | undefined
```

Builtins' client renderers (the existing ones used by `workflow-canvas.tsx`) self-register on module load. Plugin client bundles self-register via their own `'use client'` entry point.

### Changed module (`plugins/workflows/lib/runtime.ts`)

**One** new code path: in the step-dispatch function, after the existing builtin branches, add:

```ts
const nodeType = getNodeType(step.type)
if (nodeType?.runtime === 'plugin') {
  const result = await getHookRegistry().invoke<NodeExecuteResult>(
    `workflows.executeNode.${step.type}`,
    { instance, step, context }
  )
  return handleAgentStyleOutput(instance, step, result)  // reuse existing agent-step completion
}
```

No other code in `runtime.ts` changes. The 15+ existing `step.type === 'X'` branches keep their fast paths for builtins.

### New component (`plugins/workflows/components/workflow-canvas-editor.tsx`)

Editable xyflow canvas. Uses:
- `@xyflow/react` (already installed) for nodes/edges/handles
- `@dagrejs/dagre` (new dep) for auto-layout
- Existing `node-type-registry.ts::listNodeTypes()` for the palette
- Existing `node-type-registry.ts::getNodeType(kind).formFields` for the inline drawer

### Deleted components

- `plugins/workflows/components/workflow-editor.tsx` — form editor, replaced.
- `tests/plugins/workflows/workflow-editor.test.tsx` — tests for the deleted editor.

### Updated pages

- `app/workflows/new/page.tsx` — wraps `workflow-canvas-editor.tsx` in create mode.
- `app/workflows/[id]/edit/page.tsx` — wraps `workflow-canvas-editor.tsx` in edit mode. Refuses plugin-owned ids (unchanged).

### Updated schema (`plugins/workflows/lib/node-type-registry.ts::workflowDefinitionSchema`)

```ts
workflowDefinitionSchema = z.object({
  // … existing fields …
  layout: z.object({
    positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() }))
  }).optional(),
})
```

### New hook convention

`workflows.executeNode.{namespacedKind}` — registered by plugins via `ctx.registerNodeType` (the helper auto-wires the hook from `def.execute`). Invoked by runtime for non-builtin kinds.

### New dependency

```
@dagrejs/dagre@^1.1.4    // auto-layout for xyflow DAGs
```

### Tests (all mock `getContentDir` per CLAUDE.md)

New / changed:
- `tests/plugins/workflows/node-type-registry.test.ts` — extend with `edgeRules`, `runtime: 'plugin'` namespace enforcement, collision across plugins.
- `tests/lib/plugin-registry.test.ts` — `ctx.registerNodeType` auto-namespaces, auto-registers hook, collision across plugins throws at activation.
- `tests/plugins/workflows/plugin-node-execution.integration.test.ts` **(new, the one we said we need)** — single end-to-end test: register synthetic node type in a test plugin context → build workflow using the kind → YAML validation accepts it → `loadDefinition` resolves → runtime dispatches via hook → completion advances correctly.
- `tests/plugins/workflows/runtime.test.ts` — extend: plugin-kind dispatch branch; all 7 live definitions still parse and execute through unchanged builtin paths.
- `tests/plugins/workflows/workflow-canvas-editor.test.tsx` **(new)** — render, add node from palette, connect edge (allowed), reject edge (gate 2nd outbound), open drawer, edit field, save, YAML round-trip.
- `tests/plugins/workflows/yaml-roundtrip.test.ts` **(new)** — for each of the 7 live workflows: load → serialize from canvas state → diff = empty.
- `tests/plugins/workflows/workflow-editor.test.tsx` **(deleted)**.

---

## 8. Boundaries

### Always do
- Mock `getContentDir` and `getOpenClawPath` in every test that touches the filesystem.
- Validate at boundaries with Zod — plugin `registerNodeType` argument, YAML parse, route bodies.
- Use hooks (`workflows.executeNode.{kind}`) for plugin runtime dispatch; never import across plugin packages.
- Keep `NodeTypeDef` and `registerNodeType()` SSR-safe. Any React import in a module that gets loaded from the server is a regression.
- Update `.claude/knowledge/workflows-plugin.md` in the same commit that introduces the surface it describes.
- Use `useQueryState` if adding filter state to the editor UI (probably none — it's a single-workflow page).

### Ask first
- Any change to `runtime.ts` beyond the single new branch in AD3.
- Adding a runtime field (`runtime: 'plugin'`) that survives into saved YAML — should stay as registry metadata only, never serialized.
- Adding a new top-level `~/.bakin/` directory.
- Adding more than one new npm dependency.

### Never do
- Ship a demo plugin in `tests/fixtures/` or anywhere that gets loaded at runtime. Integration test uses in-test synthetic node type only.
- Keep the form editor as a fallback. Delete it in the same branch as the canvas editor.
- Fork runtime.ts into "builtin runtime" and "plugin runtime". Single file, one new branch.
- Auto-layout on load for any workflow that has saved positions. Auto-layout only fires for empty workflows and on explicit "auto-arrange" click.
- Store node positions in a separate layout file. They live in the workflow YAML under optional `layout.positions`.
- Add backwards-compatibility shims for the form editor's URL, props, or CSS classes.
- Touch agent-internal files under `~/.openclaw/agents/{id}/`.
- Introduce a parallel stat-tracking system. Canvas interactions that warrant metrics go through `recordUsage`.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Plugin renderer leaks React into the server bundle, breaking SSR | Strict module boundary: `NodeTypeDef` (SSR) vs `NodeRendererRegistry` (client). The client registry file has `'use client'` at top. Plugin client entry must also be `'use client'`. A new build check asserts no React import exists in the SSR path of the workflows plugin. |
| `registerNodeType` throws at activation if two plugins pick the same namespaced kind | Namespacing is `{pluginId}.{kind}`, so collision requires the same plugin to register the same kind twice — which is already the existing registry throw. Cross-plugin collision is architecturally impossible. Test covers the within-plugin duplicate case. |
| Runtime's new plugin-dispatch branch breaks the 7 live workflows | The new branch only fires when `nodeType?.runtime === 'plugin'`. Builtins have `runtime: 'builtin'`. The integration test plus the live-workflow smoke gate verify no behavior change for builtins. |
| Canvas saves YAML the runtime can't load (schema drift) | Canvas uses the same `workflowDefinitionSchema` from the registry. The new `yaml-roundtrip.test.ts` asserts byte-equivalent round-trips for all 7 live workflows. |
| Users lose custom node positions when a workflow is edited outside the canvas (e.g. hand-edited YAML without `layout`) | `layout.positions` is optional. When absent, canvas runs auto-layout on load and does not save positions unless the user explicitly saves. |
| Deleting the form editor breaks a linked or bookmarked URL | Form editor was never at a stable URL — it was rendered at `/workflows/new` and `/workflows/[id]/edit`. Those URLs continue to work, now backed by the canvas editor. No external URL changes. |
| `dagre` auto-layout produces an ugly graph for edge cases (cycles, disconnected nodes) | Auto-layout is only used for empty workflows (no cycles yet) and on explicit user click. Worst case, user drags nodes to fix. Not a correctness risk. |

---

## 10. Open Questions

Resolve during planning:

1. **Plugin client-renderer registration mechanics.** If `ctx.registerNodeType` runs in `activate()` (server path), how does the client canvas pick up the renderer? Proposal: plugin ships a `'use client'` module at a well-known path (`plugins/{id}/client-renderers.tsx`) that the workflows canvas's client code dynamically imports based on the list of registered plugin kinds. Needs validation against Next.js App Router's client-component discovery.

2. **Parallel-container canvas semantics.** The canvas needs to represent `parallel` as a group/container with child nodes. How do edges work inside a parallel? Proposal: parallel is a visual group; children sit inside it; drag-into-group adds to `parallel.steps`; no inner edges (steps run concurrently). Validate against xyflow's subflow API.

3. **Should `edgeRules` live on `NodeTypeDef` or be computed from schema inspection?** Proposal: explicit field. Schema inspection is clever and brittle; explicit rules are obvious.

4. **Auto-layout direction.** LR (left-to-right) or TB (top-to-bottom)? Proposal: LR, matching the existing read-only canvas convention.

5. **Node-type palette presentation.** Left sidebar (permanent) or floating command-palette (`Cmd+K`)? Proposal: left sidebar — more discoverable for new users, and the canvas area is wide enough.

---

## 11. Follow-ups (no new GitHub issues in this work)

The 4 Phase 2 follow-up issues (2A-2D) already exist. This work closes 2A and 2B. 2C (distribution) and 2D (skill rebase) remain open for later.

Minor follow-ups to file if they surface during /build:

- If plugin client-renderer dynamic import proves awkward, file an issue for a cleaner plugin-client-bundle convention.
- If `dagre` layout quality is insufficient for common shapes, file an issue to evaluate ELK or a manual layout heuristic.

---

## 12. Done When

- G1–G6 acceptance signals all pass on the live machine.
- All 7 live workflows (`video-script`, `clip-creation`, `image-generation`, `image-social-post`, `text-social-post`, `video-social-post`, `assemble-video`) run end-to-end unchanged.
- The integration test for plugin-registered node types is in the suite and green.
- `workflow-editor.tsx` and its test file are deleted; both edit routes render the canvas editor.
- `.claude/knowledge/workflows-plugin.md` updated with: node-type registration API, SSR/client split, edge rules, `layout.positions`, canvas editor conventions.
- `CLAUDE.md` one-liner updated under "Key Patterns" pointing at Phase 2A hook dispatch convention.
- `README.md` plugin-authoring paragraph mentions node-type registration.
- Commits follow the per-commit invariants from the predecessor spec's commit strategy (atomic, build-green, tests-green, conventional-commit, co-author trailer, `runtime.ts` limited to the single AD3 branch).
- `npm test` full pass; no new lint errors.
- Branch pushed; PR opened referencing both issues.
