# PLAN — Workflows Phase 2A + 2B

**Status:** Draft awaiting approval
**Source spec:** `.claude/specs/workflows-phase-2-plugin-nodes-and-canvas.md`
**Branch:** `issue-107-108-workflows-phase-2`
**Issues:** [#107](https://github.com/madeinwyo/bakin/issues/107), [#108](https://github.com/madeinwyo/bakin/issues/108)
**Owner:** roscoe@madeinwyo.com
**Date:** 2026-04-20
**Next step:** `/agent-skills:build` task-by-task → `/agent-skills:test`

---

## 0. Open-Question Resolutions (from spec §10)

| Q | Resolution | Impact on plan |
|---|------------|---------------|
| Q1 — Plugin client-renderer discovery | Plugins export `nodeRenderers: Record<kind, ComponentType>` from existing `client.tsx`. `plugin-manifest.ts` aggregates into `NodeRendererRegistry` at module-load time. | Adds one task (T5) to extend the manifest. No dynamic import, no Next.js quirks. |
| Q2 — Parallel container semantics | xyflow `parentId` + `extent: 'parent'` (already used by read-only canvas for sub-workflow groups). No edges inside parallel; drag-in mutates `parallel.steps`. | Canvas editor reuses the existing pattern from `workflow-canvas.tsx`. |
| Q3 — `edgeRules` location | Explicit field on `NodeTypeDef`. | Part of T1 (registry extension). |
| Q4 — Auto-layout direction | LR — matches existing read-only canvas convention. | Part of T13 (dagre integration). |
| Q5 — Palette UI | Left sidebar, collapsible. Single source: `listNodeTypes()` + client-renderer registry. | Part of T10 (palette). |

**Additional decisions locked in during planning:**

- **Plan/spec doc location.** Following project convention (predecessor spec at `.claude/specs/workflows-plugin-plan.md`), this plan lives at `.claude/specs/workflows-phase-2-plan.md` — not `tasks/plan.md` as the generic skill prompt suggests.
- **`dagre` dependency as its own commit.** Adding a runtime dep warrants an isolated, trivially revertable commit (T13a).
- **Integration test deferred to end of Phase A.** T7 runs after T1–T6 are all landed so the test exercises the entire plugin path once, not a piece at a time.
- **No overlap with form editor.** `workflow-editor.tsx` and its test file are deleted in the same commit that wires the canvas editor to the edit routes (T14). No flag, no fallback.

---

## 1. Architecture Recap

```
                      Phase 2A (issue #107)
  ┌──────────────────────────────────────────────────────────────┐
  │                                                              │
  │  packages/core/src/plugin-types.ts                           │
  │    + registerNodeType<T>(def: PluginNodeTypeDef<T>): void    │
  │                                                              │
  │  plugins/workflows/lib/node-type-registry.ts (EXTEND)        │
  │    + runtime: 'builtin' | 'plugin'                           │
  │    + pluginId?: string                                       │
  │    + edgeRules?: EdgeRules                                   │
  │    + registerPluginNodeType(pluginId, def)                   │
  │      → auto-namespaces kind → `{pluginId}.{kind}`            │
  │      → auto-registers hook workflows.executeNode.{kind}      │
  │                                                              │
  │  plugins/workflows/components/node-renderer-registry.tsx     │
  │    'use client'                                              │
  │    + getClientRenderer(kind) / registerClientRenderer        │
  │                                                              │
  │  src/lib/plugin-manifest.ts (EXTEND)                         │
  │    + aggregate nodeRenderers from each plugin's client.tsx   │
  │      into NodeRendererRegistry at import                     │
  │                                                              │
  │  plugins/workflows/lib/runtime.ts  (ONE new branch only)     │
  │    if (!builtin kind) → invoke workflows.executeNode.{kind}  │
  │                        → handle as agent-style output        │
  └──────────────────────────────────────────────────────────────┘

                      Phase 2B (issue #108)
  ┌──────────────────────────────────────────────────────────────┐
  │                                                              │
  │  workflowDefinitionSchema  (EXTEND)                          │
  │    + optional layout: { positions: Record<id,{x,y}> }        │
  │                                                              │
  │  plugins/workflows/components/workflow-canvas-editor.tsx     │
  │    ← editable xyflow canvas                                  │
  │    ← palette (left sidebar) drawn from listNodeTypes()       │
  │    ← inline drawer drawn from NodeTypeDef.formFields         │
  │    ← onConnect enforces NodeTypeDef.edgeRules                │
  │    ← @dagrejs/dagre auto-layout for empty workflows          │
  │                                                              │
  │  app/workflows/new/page.tsx         (REWIRE to canvas)       │
  │  app/workflows/[id]/edit/page.tsx   (REWIRE to canvas)       │
  │                                                              │
  │  plugins/workflows/components/workflow-editor.tsx    DELETE  │
  │  tests/plugins/workflows/workflow-editor.test.tsx    DELETE  │
  └──────────────────────────────────────────────────────────────┘
```

---

## 2. Dependency Graph

```
Phase A — Plugin node types (issue #107)
  T1 (registry extension: edgeRules, runtime, pluginId fields)
    └─→ T2 (runtime.ts single-branch dispatch)
          └─→ T3 (ctx.registerNodeType + plugin-registry impl)
                ├─→ T4 (NodeRendererRegistry client module)
                │     └─→ T5 (plugin-manifest aggregation; builtin self-register)
                │           └─→ T6 (builtins move to new renderer registry — refactor, no behavior change)
                │                 └─→ T7 (INTEGRATION test: full plugin path)
                └───────────────────→ (also blocks T7)

Phase B — Canvas editor (issue #108)
  T8 (workflowDefinitionSchema: optional layout.positions)
    └─→ T9 (workflow-canvas-editor.tsx scaffold: editable xyflow, load/save)
          ├─→ T10 (node-type palette — consumes T1 edgeRules + T4 renderer registry)
          ├─→ T11 (inline config drawer — consumes NodeTypeDef.formFields)
          ├─→ T12 (edge connection rules — consumes T1 edgeRules)
          └─→ T13 (dagre auto-layout)
                 ├─→ T13a (add @dagrejs/dagre dependency — isolated commit)
                 └─→ T13b (integrate; run only on empty workflows + explicit click)
                       └─→ T14 (rewire /workflows/new + /edit; DELETE form editor)
                             └─→ T15 (YAML round-trip test for all 7 live workflows)

Phase C — Docs & ship
  T16 (update .claude/knowledge/workflows-plugin.md + CLAUDE.md + README.md)
  T17 (final verification gate: 7 live workflows + integration test + round-trips)
  T18 (PR opens; close issues on merge)
```

**Critical path:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T9 → T14 → T15 → T17. Everything else branches off this spine.

**Parallelism opportunities** (detailed in §5):
- T10, T11, T12, T13a, T13b can all run in parallel once T9 lands.
- T8 can run in parallel with all of Phase A (different file).
- T16 doc snippets ride along with feature commits (C7 invariant).

---

## 3. Tasks

Each task = one commit. Every commit must build green, tests green, `runtime.ts` limited to the single AD3 branch. **Bold = live-machine verification gate.**

### Phase A — Plugin Node Types (issue #107)

#### T1 · `feat(workflows): extend node-type registry with edgeRules, runtime, pluginId`

**Files:** `plugins/workflows/lib/node-type-registry.ts`, `tests/plugins/workflows/node-type-registry.test.ts`

- Add to `NodeTypeDef`:
  ```ts
  runtime: 'builtin' | 'plugin'      // was hardcoded 'builtin'
  pluginId?: string                  // set when runtime === 'plugin'
  edgeRules?: EdgeRules
  ```
- Add `EdgeRules` export:
  ```ts
  interface EdgeRules {
    maxInbound?: number
    maxOutbound?: number
  }
  ```
- Update 5 builtin registrations to explicitly set `runtime: 'builtin'` and their `edgeRules`:
  - `agent`: `{ maxInbound: undefined, maxOutbound: 1 }`
  - `gate`: `{ maxInbound: undefined, maxOutbound: 1 }` (`on_approve` target)
  - `parallel`: `{ maxInbound: undefined, maxOutbound: 1 }`
  - `output`: `{ maxInbound: undefined, maxOutbound: 0 }`
  - `workflow`: `{ maxInbound: undefined, maxOutbound: 1 }`
- Add `registerPluginNodeType(pluginId, def)`:
  - Computes `namespacedKind = \`${pluginId}.${def.kind}\``
  - Calls existing `registerNodeType` with namespaced kind + `runtime: 'plugin'` + `pluginId`
  - Default edgeRules if not supplied: `{ maxInbound: undefined, maxOutbound: 1 }` (agent-style)
- Extend `stepSchema` discriminated union to accept non-builtin `type` values at parse time — a **passthrough schema** is added at the end of the union so the YAML loader accepts unknown kinds, and validation is delegated to the node-type registry's per-kind schema.
  - Implementation detail: use `z.discriminatedUnion` + a conditional refinement that re-validates non-builtin types against their registered schema. If the kind isn't registered at parse time, the error message is "Unknown node type 'X' — did the plugin fail to activate?".
- Tests:
  - `registerPluginNodeType` produces namespaced kind
  - Two plugins cannot register the same `{pluginId}.{kind}` (throws on duplicate)
  - Same plugin re-registering same kind throws (existing behavior preserved)
  - `edgeRules` resolves correctly for builtins
  - Missing renderer / missing `execute` throws at registration (fail-fast)
- **Does NOT touch `plugin-types.ts`, `runtime.ts`, or `plugin-registry.ts`** — purely additive.

**Acceptance:** `npm test -- node-type-registry` green; existing tests untouched; builtins' `runtime: 'builtin'` propagates through the registry.

---

#### T2 · `refactor(workflows): runtime dispatches plugin kinds via executeNode hook`

**Files:** `plugins/workflows/lib/runtime.ts`, `tests/plugins/workflows/runtime.test.ts`

- In the step-dispatch function (the one that reads `step.type` to choose how to execute), after the existing 5 builtin branches but before the final fallback, add:
  ```ts
  const nt = getNodeType(step.type)
  if (nt?.runtime === 'plugin') {
    const result = await getHookRegistry().invoke<NodeExecuteResult>(
      `workflows.executeNode.${step.type}`,
      { instance, step, context: stepContext }
    )
    return advanceAsAgentStyle(instance, step, result)  // reuse existing agent-step completion
  }
  ```
- `advanceAsAgentStyle` reuses existing agent-step completion code. If not already a helper, extract the 10–15 lines from the `'agent'` branch into a shared helper first (still within runtime.ts — this is the only runtime.ts change allowed by AD3).
- Update `tests/plugins/workflows/runtime.test.ts` to cover the plugin-dispatch branch with a mock hook.
- **Assert builtin behavior unchanged:** all 7 live workflow YAMLs are parsed and their step kinds resolve to existing builtin paths (branch counters in test).

**Acceptance:** Builtin tests pass unchanged; new plugin-dispatch test passes; `git diff plugins/workflows/lib/runtime.ts` shows only the one new branch + the tiny extraction.

---

#### T3 · `feat(core): add ctx.registerNodeType to PluginContext`

**Files:** `packages/core/src/plugin-types.ts`, `src/lib/plugin-registry.ts`, `tests/lib/plugin-registry.test.ts`

- Add to `PluginContext`:
  ```ts
  registerNodeType<T>(def: PluginNodeTypeDef<T>): void
  ```
- Define `PluginNodeTypeDef`:
  ```ts
  interface PluginNodeTypeDef<T = unknown> {
    kind: string              // unprefixed — registry namespaces
    zodSchema: z.ZodType<T>
    formFields: FormField[]
    edgeRules?: EdgeRules
    execute: (ctx: NodeExecuteContext) => Promise<NodeExecuteResult>
  }
  ```
- Define `NodeExecuteContext` / `NodeExecuteResult` (lightweight — just what the runtime needs to pass and receive).
- In `plugin-registry.ts::buildContext`:
  ```ts
  registerNodeType<T>(def) {
    registerPluginNodeType(pluginId, def)              // T1 helper
    ctx.hooks.register(
      `workflows.executeNode.${pluginId}.${def.kind}`,
      async (data) => def.execute(data)
    )
  }
  ```
- Wrap the throw so a colliding plugin logs an error via the plugin's logger but doesn't crash startup (same containment pattern as `registerWorkflow`).
- Tests:
  - `ctx.registerNodeType` namespaces correctly and registers hook
  - Colliding registration from two plugins → one succeeds, other logs error, activation continues
  - Hook is invocable end-to-end (register → `getHookRegistry().invoke` returns `execute`'s result)
- Update `.claude/knowledge/plugin-system.md`: add `registerNodeType` row to the `PluginContext` table.

**Acceptance:** New tests pass; existing plugin-loader tests untouched; `npm run build` clean.

---

#### T4 · `feat(workflows): client-side node renderer registry`

**Files:** `plugins/workflows/components/node-renderer-registry.tsx` (new), `tests/plugins/workflows/node-renderer-registry.test.tsx` (new)

- New client-only module (top-level `'use client'`):
  ```ts
  'use client'
  import type { ComponentType } from 'react'

  export interface NodeRendererProps {
    data: Record<string, unknown>
    selected: boolean
    // … whatever xyflow passes to custom node components
  }

  const renderers = new Map<string, ComponentType<NodeRendererProps>>()

  export function registerClientRenderer(kind: string, component: ComponentType<NodeRendererProps>): void
  export function getClientRenderer(kind: string): ComponentType<NodeRendererProps> | undefined
  export function listRegisteredRenderers(): string[]
  ```
- Backed by `globalThis.__bakinNodeRenderers` so Next.js webpack re-evaluation doesn't wipe state (per `feedback_globalthis_sse` memory).
- Tests: register + get, duplicate registration throws (same semantics as server registry).

**Acceptance:** New tests pass; module is reachable from client bundle only (strict `'use client'`).

---

#### T5 · `feat(core): aggregate plugin nodeRenderers into renderer registry`

**Files:** `src/lib/plugin-manifest.ts`, `src/lib/plugin-types.ts` (client types), each plugin's `client.tsx` (optional `nodeRenderers` export), `tests/lib/plugin-manifest.test.tsx` (new)

- Extend the client-side plugin-surface type:
  ```ts
  interface ClientPluginExports {
    navItems: NavItem[]
    nodeRenderers?: Record<string, ComponentType<NodeRendererProps>>
  }
  ```
- In `plugin-manifest.ts`:
  - Import each plugin's client module in full (currently only `navItems` is destructured); destructure `nodeRenderers?`.
  - On module load, call `registerClientRenderer(\`${pluginId}.${kind}\`, component)` for each entry.
- **No plugin currently ships `nodeRenderers`** — this is plumbing only, ready for the first consumer.
- Test: fixture plugin module with a `nodeRenderers` export → after manifest import, `getClientRenderer('fixture.foo')` returns the component.

**Acceptance:** All 10 existing plugins still import cleanly; new fixture test passes; no runtime plugin registers a renderer yet.

---

#### T6 · `refactor(workflows): move builtin node renderers to NodeRendererRegistry`

**Files:** `plugins/workflows/components/nodes/*.tsx`, `plugins/workflows/components/workflow-canvas.tsx`, `plugins/workflows/client.tsx` (new top-level registration file or in existing client entry)

- The 5 builtin node components (`TriggerNode`, `AgentNode`, `GateNode`, `ParallelNode`, `OutputNode`, `WorkflowNode`, `SubflowGroupNode`) currently register via the static `nodeTypes` const in `workflow-canvas.tsx`.
- Move them to the new renderer registry at module load: each node file (or a single `components/nodes/register.ts`) calls `registerClientRenderer('agent', AgentNode)` etc.
- `workflow-canvas.tsx` builds `nodeTypes` by iterating the renderer registry instead of the hardcoded object.
- **No behavior change** — same components, different source of truth.
- Tests: existing `workflow-canvas.test.tsx` (if present) still passes; add assertion that `listRegisteredRenderers()` includes all 7 builtin kinds after module load.

**Acceptance:** Read-only canvas still renders all 7 live workflows identically; `git diff` on the node components shows only added `registerClientRenderer` calls, no component-body changes.

---

#### T7 · `test(workflows): integration test for plugin-registered node type end-to-end`

**Files:** `tests/plugins/workflows/plugin-node-integration.test.ts` (new)

Single test file covering the full Phase 2A contract:

```
1. In beforeEach: set up a fresh PluginContext for a synthetic 'demo' plugin in a tmp dir.
2. Call ctx.registerNodeType({ kind: 'note-step', zodSchema, formFields, execute: mock })
3. Assert:
   (a) listNodeTypes() includes 'demo.note-step' with runtime: 'plugin', pluginId: 'demo'
   (b) workflowDefinitionSchema parses a YAML with `type: demo.note-step` and validates per schema
   (c) loadDefinition returns the definition through source-registry path
   (d) Execute the step via runtime: mock execute returns output → next step advances
   (e) Invoke hook directly — result matches execute's return
4. Second test: cross-plugin collision (same namespacedKind from two plugins) throws on second registration; first registration persists.
```

All mocks follow CLAUDE.md rules (`getContentDir`, `getOpenClawPath`, logger, watcher, openclaw-client).

**Acceptance:** Test passes; `grep plugin-node-integration tests/` finds exactly this file. **GATE → Live smoke: restart server, confirm `/workflows` loads normally (Phase A is invisible to users since no runtime plugin uses the API yet). The 7 live workflows still run.**

---

### Phase B — Canvas Editor (issue #108)

#### T8 · `feat(workflows): add optional layout.positions to workflow schema`

**Files:** `plugins/workflows/lib/node-type-registry.ts` (schema), `plugins/workflows/lib/parser.ts`, `plugins/workflows/types.ts`, `tests/plugins/workflows/node-type-registry.test.ts`

- Extend `workflowDefinitionSchema`:
  ```ts
  layout: z.object({
    positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() }))
  }).optional(),
  ```
- Update `WorkflowDefinition` TS type to include `layout?: { positions: Record<string, {x,y}> }`.
- `parser.ts::loadDefinition` preserves `layout` on load.
- YAML writer (used by POST/PUT routes) serializes `layout` if present; omits field entirely if absent — no empty-object churn in YAMLs.
- Tests: schema accepts valid layout; rejects non-numeric coords; round-trip preserves; absence writes no `layout:` key.

**Acceptance:** All 7 live workflow YAMLs parse unchanged (none of them have `layout`); hand-crafted test YAML with `layout` round-trips byte-equivalent.

---

#### T9 · `feat(workflows): canvas editor scaffold (editable xyflow, load + save)`

**Files:** `plugins/workflows/components/workflow-canvas-editor.tsx` (new), `tests/plugins/workflows/workflow-canvas-editor.test.tsx` (new)

Scaffold only — no palette, no drawer, no rules yet. Bare minimum to load + drag + save.

- Component signature mirrors `WorkflowEditor`'s (`mode: 'create' | 'edit'`, `initialDefinition`, etc.) so page wiring in T14 is trivial.
- Uses `@xyflow/react` with `nodesDraggable`, `nodesConnectable: true`, `edgesUpdatable: true`.
- Consumes `NodeRendererRegistry` (T4) for `nodeTypes` — all builtins + any plugin-registered kind appear automatically.
- Load: deserializes `initialDefinition.steps` → nodes + edges, using `layout.positions` if present; otherwise delegates to T13 auto-layout (placeholder that returns simple vertical stack for now; T13 replaces).
- Save: serializes nodes+edges back to `steps[]` + `layout.positions`. POSTs or PUTs against the existing CRUD routes. Refuses to save to a plugin-owned id.
- No palette, no drawer, no rule enforcement yet — those land in T10/11/12.
- Tests: render empty canvas, render with initial definition, save → correct POST/PUT body shape including `layout.positions`.

**Acceptance:** New test passes; component loads a known test YAML and re-serializes to the same schema (diff via comparison, not byte — positions may differ).

---

#### T10 · `feat(workflows): node-type palette sidebar (drag to add)`

**Files:** `plugins/workflows/components/node-type-palette.tsx` (new), `workflow-canvas-editor.tsx` (consume), tests

- Left sidebar component, collapsible via a chevron button (no URL state needed — ephemeral editor UI).
- Data source: `listNodeTypes()` → grouped by `runtime: 'builtin' | 'plugin'`. Plugin kinds show the pluginId as a small badge.
- Icon per kind: builtins use their existing lucide icons (the node components already have them); plugin kinds use a generic `Puzzle` icon.
- Drag-and-drop: uses xyflow's drag-from-outside pattern (`onDrop` on the ReactFlow wrapper). Drops add a new node with a sensible default position + generated id.
- Tests: render palette with mocked registry containing builtins + one plugin kind → all entries appear; plugin kind has a visible pluginId badge.

**Acceptance:** Palette renders; drag-and-drop adds a node to the canvas; test passes.

---

#### T11 · `feat(workflows): inline node config drawer (form from formFields)`

**Files:** `plugins/workflows/components/node-config-drawer.tsx` (new — adapts patterns from existing `step-detail-drawer.tsx`), consume in canvas editor, tests

- Right-side drawer that opens on node click in the canvas editor (not on the read-only viewer — that keeps its existing `StepDetailDrawer`).
- Renders a form generated from `NodeTypeDef.formFields` — the existing metadata the deleted `workflow-editor.tsx` used for its subforms. Reuses `AgentSelect`, `SkillSelect` etc. for the typed pickers.
- On Apply: updates the selected node's `data` + calls the parent canvas's `onNodeUpdate(id, patch)`.
- Validates locally against the node's `zodSchema` before Apply; surfaces Zod issues inline (same UX the form editor had).
- Tests: render for each builtin kind, edit a field, Apply → parent receives correct patch; invalid input → Apply disabled with inline error.

**Acceptance:** Drawer replaces the need for per-field forms in the palette; tests pass for all 5 builtin kinds.

---

#### T12 · `feat(workflows): enforce edge connection rules from NodeTypeDef.edgeRules`

**Files:** `workflow-canvas-editor.tsx` (add `onConnect` validator), optional `plugins/workflows/lib/edge-rules.ts` (validator helper), tests

- Helper fn `canConnect(sourceKind, targetKind, currentEdges, edgeRules): { ok: boolean; reason?: string }`:
  - Rejects if source node's `maxOutbound` is already at capacity
  - Rejects if target node's `maxInbound` is already at capacity
  - Rejects if source is `output` kind (maxOutbound: 0)
- xyflow `isValidConnection` prop uses this helper → invalid drops rejected visually.
- When an invalid connection is attempted, show a toast: `"{sourceKind} can have only {N} outbound edge(s)."`
- Tests: gate → second outbound attempt rejected; agent → second outbound rejected; output → any outbound rejected; parallel → unlimited inbound OK; plugin kinds default to agent-style.

**Acceptance:** Tests pass; manual smoke: try to wire a second edge from a gate → UI refuses.

---

#### T13a · `chore: add @dagrejs/dagre@^1.1.4 dependency`

**Files:** `package.json`, `package-lock.json` (or `pnpm-lock.yaml` depending on pkg manager)

- `npm install --save @dagrejs/dagre@^1.1.4` (or `pnpm add`).
- No code changes. Isolated commit so `git revert <sha>` cleanly removes the dep if T13b is reverted.

**Acceptance:** Lockfile updated; `npm ls @dagrejs/dagre` resolves.

---

#### T13b · `feat(workflows): dagre auto-layout for empty workflows + manual button`

**Files:** `plugins/workflows/lib/dagre-layout.ts` (new), `workflow-canvas-editor.tsx` (integrate), tests

- `dagre-layout.ts` exports `layoutNodes(nodes, edges, options?): Node[]`:
  - Configures dagre graph: `rankdir: 'LR'`, `nodesep: 40`, `ranksep: 100` (matches existing canvas visual spacing).
  - Returns nodes with new `position` fields; edges unchanged.
- Integration in canvas editor:
  - On load: if `definition.layout?.positions` is absent (empty workflow or pre-canvas YAML), run auto-layout.
  - If `positions` is present, use them as-is.
  - Add "Auto-arrange" button in the canvas header that triggers layout on demand and marks the definition dirty.
- Tests: layout of a 3-node linear graph produces left-to-right ordering; empty input returns empty output; handles cycles gracefully (dagre handles them, just not gracefully — test the non-exception path).

**Acceptance:** Opening `/workflows/new` loads with an empty canvas + trigger node auto-placed; manually invoking "Auto-arrange" re-positions nodes.

---

#### T14 · `feat(workflows): rewire edit routes to canvas editor; delete form editor`

**Files:** `app/workflows/new/page.tsx`, `app/workflows/[id]/edit/page.tsx`, delete `plugins/workflows/components/workflow-editor.tsx`, delete `tests/plugins/workflows/workflow-editor.test.tsx`, delete any unused helpers that `workflow-editor.tsx` was the sole caller of

- Replace imports: `WorkflowEditor` → `WorkflowCanvasEditor`. Props mirror.
- Grep for remaining `WorkflowEditor` imports → should be only the two page files after this change.
- Delete `workflow-editor.tsx` + its test file.
- Grep for imports of helpers in `workflow-editor.tsx` that are no longer used anywhere (e.g. `_selectComponents` re-export, unused `slugify` if the canvas editor has its own); delete those too.
- Update `plugins/workflows/components/workflows-page.tsx` or list components if they linked to `WorkflowEditor` directly.

**Acceptance:** `npx tsc --noEmit` clean; `rg "WorkflowEditor|workflow-editor" --type ts --type tsx` returns no results. **GATE → Live smoke: open `/workflows/new`, build a non-trivial workflow (≥3 steps including parallel), save, reload, run. Do the same for save-as-new on a plugin workflow.**

---

#### T15 · `test(workflows): yaml round-trip test for all 7 live workflows`

**Files:** `tests/plugins/workflows/yaml-roundtrip.test.ts` (new)

- For each live plugin-shipped workflow (read from `plugins/workflows/defaults/workflows/*.yaml`):
  - Load YAML → parse via `workflowDefinitionSchema`
  - Serialize back through the same writer used by the canvas editor's save path
  - Compare YAML output byte-for-byte (or normalized if YAML library introduces cosmetic whitespace)
- Second test case: load → render in canvas editor headless → save → diff.

**Acceptance:** 7 round-trip tests pass; diff is empty for every live workflow.

---

### Phase C — Docs & Ship

#### T16 · `docs(workflows): update knowledge doc, CLAUDE.md, README.md`

**Files:** `.claude/knowledge/workflows-plugin.md`, `CLAUDE.md`, `README.md`

- `.claude/knowledge/workflows-plugin.md` — add sections:
  - **Plugin Node Types (Phase 2A).** `ctx.registerNodeType` API, `{pluginId}.{kind}` namespacing, SSR/client renderer split, hook dispatch convention, `edgeRules` metadata, authoring example (10–15 line code snippet).
  - **Canvas Editor (Phase 2B).** What replaced the form editor, how node positions are stored (`layout.positions`), palette source, edge-rule enforcement, auto-layout behavior.
  - Remove the "Form Editor" subsection.
- `CLAUDE.md` — add one line under Key Patterns → Dispatch Failure Handling block (or new block):
  ```
  Plugin node types run via workflows.executeNode.{pluginId}.{kind} hook; runtime.ts has a single fallback branch for non-builtin kinds.
  ```
- `README.md` — in the "Plugins can ship workflows and skills" paragraph, add: "Plugins can also register custom workflow node types via `ctx.registerNodeType` — see `.claude/knowledge/workflows-plugin.md`."

**Acceptance:** Docs build green; cross-links resolve; the 10-line authoring snippet compiles if copy-pasted (verify during build).

---

#### T17 · Final verification (no commit)

Run in sequence:

1. `npm test` — full suite green.
2. `npx tsc --noEmit` — clean.
3. `npm run lint` — no new errors.
4. `pnpm dev` (or current dev cmd) → open `/workflows`:
   - Load `video-script`, `clip-creation`, `image-generation`, `image-social-post`, `text-social-post`, `video-social-post`, `assemble-video` → each renders in read-only canvas without errors.
   - Dispatch one of them end-to-end → runs through at least the first gate identically to pre-change behavior.
5. Open `/workflows/new` → build a 3-step workflow with a `parallel`, save → reload → run.
6. Open a plugin-shipped workflow's `/workflows/:id/edit` → confirm "Save as new" prefills and is the only save path.

**Acceptance:** All checks pass. If any regression, file as hotfix task before shipping.

---

#### T18 · `chore: open PR against main referencing #107 and #108`

- `gh pr create --title "Phase 2A + 2B: plugin-registered node types and canvas editor"`
- Body includes:
  - Summary of both phases
  - Link to spec + plan
  - Test evidence (screenshots of canvas editor if helpful; test counts)
  - "Closes #107, closes #108" footer
- Do NOT merge automatically.

**Acceptance:** PR URL returned to user.

---

## 4. Commit Strategy

### 4.1 Per-commit invariants (inherited from predecessor spec, unchanged)

| # | Invariant | How verified |
|---|-----------|--------------|
| C1 | **Atomic.** One task per commit; revert cleanly removes it. | `git revert <sha>` on scratch branch leaves green build. |
| C2 | **Build green.** TypeScript + lint clean. | `npx tsc --noEmit` + lint before commit. |
| C3 | **Tests green.** New tests pass; full suite passes. | `npx vitest run`. |
| C4 | **7 live workflows still load.** | `parser.test.ts` live-YAML assertion + manual smoke at gates. |
| C5 | **Conventional commit.** `<type>(<scope>): <imperative summary>`, body explains why, references T<N>. | HEREDOC template below. |
| C6 | **Co-author trailer.** Every commit ends with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`. | Template. |
| C7 | **Docs ride along.** Knowledge-doc snippets land with the surface they describe. T16 is the backstop. | Code-review check at each task. |
| C8 | **`runtime.ts` minimal touch.** Only T2 modifies `runtime.ts`; diff must be limited to the single AD3 branch + the agent-style helper extraction. | Pre-commit check. |
| C9 | **No `~/.bakin/` writes from tests.** Every new test mocks `getContentDir` + `getOpenClawPath`. | Review + path assertions. |
| C10 | **No dead code.** Deleting `workflow-editor.tsx` in T14 also removes unused helpers it was sole consumer of. | Post-T14 grep. |

### 4.2 Commit message template

```
<type>(<scope>): <imperative summary, ≤72 chars>

<body — why this change, what tradeoffs, deviations from plan>

Refs: T<N> · spec §<section>
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

Allowed `type`: `feat`, `refactor`, `fix`, `test`, `docs`, `chore`.
Allowed `scope`: `workflows`, `core`, `cli`.

### 4.3 Phase checkpoints (natural rollback points)

| Phase | Commits | Gate |
|-------|---------|------|
| **A — Plugin node types** | T1, T2, T3, T4, T5, T6, T7 | After T7: integration test green, 7 live workflows unchanged. **Live smoke.** |
| **B — Canvas editor** | T8, T9, T10, T11, T12, T13a, T13b, T14, T15 | After T14: build a workflow in browser end-to-end. After T15: round-trips clean. **Live smoke.** |
| **C — Docs & ship** | T16, T17, T18 | After T17: full verification passes; PR opens. |

### 4.4 Rollback strategy

- **Single-task rollback:** `git revert <sha>`. Tasks are ordered such that reverting any single one cleanly un-does its change.
  - *Special case — T13b + T13a:* revert in that order; `T13b` removes the integration, `T13a` drops the dep. Two-commit revert.
  - *Special case — T14:* reverts the deletion of `workflow-editor.tsx`. The restored form editor is still wired to the same CRUD routes and the same `workflowDefinitionSchema`, so it works. But the canvas editor is then dead code and must be reverted too (via T14 revert + T9 revert in order).
- **Whole-phase rollback:** revert commits in reverse order within the phase.
- **Phase-boundary safety:** Phase A changes are invisible to users (no plugin ships a node type yet). Phase B changes alter the UX. If Phase B needs rollback after Phase A is merged, Phase A stays in and remains latent until re-attempted.

### 4.5 Allowed deviations from plan during build

If a task reveals a design issue (e.g. dagre produces unusable layouts, xyflow subflow API can't do what we need), the build agent **stops and proposes an alternative** rather than silently deviating. Deviation, once approved, is documented in the commit body with a `Deviation:` line.

---

## 5. Parallelism Strategy

### 5.1 Independent task groups

| Group | Tasks | Rationale |
|-------|-------|-----------|
| **G-α** (Phase A foundation) | T1, T2 | T2 depends on T1's `runtime: 'plugin'` field. Sequential. |
| **G-β** (Phase A fan-out) | T3, T4 | Both gated on T1+T2. Different files (`plugin-registry.ts` vs new client module). Can run in parallel via worktrees. |
| **G-γ** (Phase A finish) | T5, T6 | T5 (manifest aggregation) gated on T4. T6 (move builtins to registry) gated on T4. Different files; can run in parallel. |
| **G-δ** (Phase B parallel-safe) | T10, T11, T12 | All gated on T9. Different new files. Trivially parallel via worktrees. |
| **G-ε** (dagre split) | T13a, T13b | T13b depends on T13a (the dep must exist). Sequential. |
| **G-ζ** (Phase C) | T16, T17, T18 | T16 parallel with T15 verification; T17 must wait for everything; T18 last. |

### 5.2 Execution timeline with parallelism applied

```
Phase A:
  T1 → T2                                                (sequential, small)
   └─→ ┌─ T3 (worktree #1) ──────┐
       └─ T4 ─→ ┌─ T5 ────────┐  │                      (T4 unlocks G-γ)
                └─ T6 ────────┘  │
       ──────────────────────────→ T7                    (T7 waits for all)
   gate

Phase B:
  T8 ─→ T9 ─→ ┌─ T10 (worktree #2) ─┐
              ├─ T11 (worktree #3)  ├──→ merge ──→ T13b ─→ T14 ─→ T15
              ├─ T12 (worktree #4)  │                                    ─→ gate
              └─ T13a               ┘
  (T13a sequential on main so lockfile lands cleanly)

Phase C:
  T16 in parallel with T15
  T17 gate (sequential)
  T18 (open PR)
```

### 5.3 Parallel-execution rules (inherited from predecessor spec §5.3, apply verbatim)

| # | Rule |
|---|------|
| P1 | Worktree subagents never share a file. §5.1 is authoritative. |
| P2 | Each worktree commits in-place; main agent merges via `git merge --ff-only`. |
| P3 | If two parallel branches pass in isolation but merge fails, revert the second and re-attempt serially. |
| P4 | Live-machine gate runs on `main` after all worktree merges in a phase land. |
| P5 | Don't parallelize doc commits (T16 doc bodies ride with feature commits per C7; T16 is the stitch pass). |
| P6 | User interrupts at phase boundaries only; in-flight worktrees finish their task. |

### 5.4 Estimated wall-clock saving

~30% vs pure sequential. Biggest wins: G-β (T3 + T4 parallel — both non-trivial) and G-δ (T10/11/12 parallel — three UI tasks, each ~150 LOC).

---

## 6. Risk Register

| Phase | Risk | Mitigation |
|-------|------|-----------|
| A | T2 runtime branch subtly changes behavior for builtin `agent` step (via the extracted helper) | Extract only the completion code that's already identical; run full `runtime.test.ts` suite and smoke-test one live workflow (video-script) after T2. |
| A | `ctx.registerNodeType` hook auto-registration fails silently if `execute` throws | Hook invocation wraps execute errors, returns them as step failure (not silent). Tested in T7. |
| A | Client renderer registry drift: plugin renders nothing because client bundle didn't pick up the registration | T5 manifest aggregation is static import — build-time guarantee. Test asserts registry has expected entries after import. |
| B | xyflow subflow API can't represent `parallel` containers as expected | Mitigation: existing read-only canvas already uses subflow for sub-workflow groups. Same API works. If it doesn't, T9 stops and re-plans. |
| B | Canvas save emits YAML that fails runtime parse | Same `workflowDefinitionSchema` drives both save validation AND runtime load. T15 round-trip test is the backstop. |
| B | dagre auto-layout is ugly for non-trivial graphs | Only fires on empty workflows + explicit click. User can drag nodes to fix. Not a correctness risk. |
| B | Deleting `workflow-editor.tsx` breaks an existing test we forgot about | `rg "WorkflowEditor|workflow-editor"` in T14 before deletion is the backstop. |
| C | Docs drift from code after T16 lands but before PR merges | Docs land in the same commit as the surface (C7). T16 is only the stitch-and-crosslink pass. |

---

## 7. Test Inventory (added / changed in this work)

All mock `getContentDir` + `getOpenClawPath` per CLAUDE.md. Each file scoped to one concern.

- `tests/plugins/workflows/node-type-registry.test.ts` — **extended** (T1, T8)
- `tests/plugins/workflows/runtime.test.ts` — **extended** (T2)
- `tests/lib/plugin-registry.test.ts` — **extended** (T3)
- `tests/plugins/workflows/node-renderer-registry.test.tsx` — **new** (T4)
- `tests/lib/plugin-manifest.test.tsx` — **new** (T5)
- `tests/plugins/workflows/plugin-node-integration.test.ts` — **new** (T7) — the *one* integration test
- `tests/plugins/workflows/workflow-canvas-editor.test.tsx` — **new** (T9)
- `tests/plugins/workflows/node-type-palette.test.tsx` — **new** (T10)
- `tests/plugins/workflows/node-config-drawer.test.tsx` — **new** (T11)
- `tests/plugins/workflows/edge-rules.test.ts` — **new** (T12)
- `tests/plugins/workflows/dagre-layout.test.ts` — **new** (T13b)
- `tests/plugins/workflows/yaml-roundtrip.test.ts` — **new** (T15)
- `tests/plugins/workflows/workflow-editor.test.tsx` — **DELETED** (T14)

---

## 8. Done When

Mirrors spec §12, with concrete commit checkpoints:

- All 18 tasks committed (T17 is verification, no commit; T18 is the PR).
- Build + test + lint green at every commit.
- 7 existing live workflows still run end-to-end.
- Integration test for plugin-registered node types green.
- `workflow-editor.tsx` + test file deleted; `app/workflows/new/page.tsx` and `app/workflows/[id]/edit/page.tsx` use canvas editor.
- Knowledge doc, CLAUDE.md, README.md updated.
- PR open referencing #107 and #108.
