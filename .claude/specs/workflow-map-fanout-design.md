# Design: `map_workflow` — Dynamic Fan-out / Fan-in

**Status:** Design approved for future implementation (not scheduled)
**Issue:** #203 (this doc is its buildable core; the issue is re-scoped to reference it)
**Prereqs shipped:** #374 order-independent nested refs; dead-surface deletions (`dependsOn`, `on_approve`); strict builtin schemas (see `.claude/specs/workflows-hardening.md`)

## Motivation

The video-production workflow needs a step whose *width is decided at runtime*:

1. Write full video script → 2. Gate: approve script → 3. Segment into 5–10s clip briefs → **4. Produce one clip per segment (N unknown at authoring time)** → 5. Join when all clips complete → 6. Assemble → 7. Gate: approve video → 8. Publish.

Today `parallel` is static (children enumerated in YAML) and `workflow` spawns exactly one child. Nothing expresses "one child per element of a prior step's output array."

## Decision summary (settled in the workflows-hardening interview)

- **The engine stays an ordered-list executor.** No DAG, no readiness scheduler. `map_workflow` is ONE new step type in the linear sequence — when the sequence reaches it, it fans out; when every child completes, the sequence advances. We deleted `dependsOn` for being unread; we are not reintroducing graph semantics through the back door.
- **Children are ordinary nested-workflow instances.** Fan-out reuses the existing machinery — `createInstance` + `parentTaskId`/`parentStepId` linkage + `createBoardTaskForChild` + `propagateChildCompletion` (`plugins/workflows/lib/engine.ts`). Gates inside children, cycle detection, step ownership, and board visibility all come for free.
- **Join waits for all; failures don't cascade.** A failed/cancelled child never auto-fails siblings or the parent. The map step stays `in_progress`; the failed child is individually retryable or cancellable. No `on_child_failure` policy knob until a real workflow needs one.

## YAML surface

```yaml
- id: segment-script
  type: agent
  agent: $assigned
  skill: segment-video-script
  # The skill's output_schema requires { clips: [...] } — see Source contract.

- id: produce-clips
  type: map_workflow
  label: Produce clips
  source: segment-script.clips     # <stepId>.<outputKey> — must be an array
  workflow_id: clip-creation       # the child workflow, same resolution tiers as `workflow`
  item_key: clip                   # optional; child sees parentContext[item_key] (default: "item")
  max_children: 24                 # optional guardrail; start rejects wider fanouts (default 32)

- id: assemble-video
  type: agent
  agent: $assigned
```

New step type only. No changes to `agent`, `gate`, `parallel`, `output`, `workflow`, `createTask`.

### Validation rules (extends `validate-definition.ts`)

- `source` must be `<stepId>.<key>` where `<stepId>` is an **earlier top-level step** in the same definition (same rule shape the deleted `dependsOn` validator used; positional, checkable statically).
- `workflow_id` follows the `workflow` step's three-tier existence model (#374): structural + self-reference fatal at load; existence fatal at start; advisory in health.
- Cycle detection: start-time recursion in `start-validation.ts` treats `map_workflow.workflow_id` exactly like `workflow.workflow_id`.
- `map_workflow` is top-level only — not permitted inside `parallel` children (agent-only, unchanged).
- Zod schema is strict like every builtin (id, type, label, source, workflow_id, item_key?, max_children?, description?).

### Source contract

The source step's output key must hold an array at runtime. Authors declare it via the source step's `output_schema` (or its skill's) so the dispatch prompt tells the agent exactly what to produce; the engine enforces at fan-out time:

- Missing key or non-array → the map step fails with a typed error (`map_source_invalid`) before any child spawns. Visible on the task, recoverable by re-running the source step (`reopenFromStep`).
- Empty array → the map step completes immediately with `outputs: []` and the workflow advances. (An empty segmentation is a valid outcome; a gate before the map is the right place to catch "that's not what I wanted".)
- Array longer than `max_children` → typed error, no partial spawn.

## Runtime semantics

### Fan-out (when the ordered executor reaches the map step)

For each `item` at index `i` of the source array:

- `childTaskId = ${taskId}--${stepId}--${i}` (extends the existing `${taskId}--${nested.id}` convention; stable, collision-free, index-encoded).
- `createInstance(childTaskId, workflow_id, dir, assignee, parentContext + { [item_key]: item, mapIndex: i, mapTotal: N })`.
- `childInstance.parentTaskId = taskId`, `parentStepId = stepId` — identical linkage to nested workflows.
- One board task per child via `createBoardTaskForChild`, so clip gates surface in the UI like any nested workflow's.

Parent map-step state:

```ts
stepStates[stepId] = {
  status: 'in_progress',
  startedAt,
  children: [{ index, childTaskId, status: 'in_progress' | 'complete' | 'failed' | 'cancelled' }],
}
```

This is additive to `StepState` (today's nested-workflow state holds a single `childTaskId`; map steps hold `children[]`).

### Fan-in (join)

`propagateChildCompletion` grows a map-aware branch: when the completing child's `parentStepId` names a map step, update that child's entry in `children[]`, and

- **all complete** → aggregate `output = { outputs: children.sortedByIndex.map(c => c.output) }` (stable source order regardless of completion order), mark the step complete, advance the parent. Aggregated child outputs are subject to the existing `dispatch.maxWorkflowContextBytes` budget when injected into later prompts (visible omission markers, per the startup-context rules).
- **any child failed/cancelled** → parent stays `in_progress`. No cascade, no timer.

### Per-child recovery

The unit of retry is the child, never the parent:

- **Retry** = `reopenFromStep` on the child instance (or full child re-create with the same `childTaskId` + item context if the child is terminally dead) — surfaced as a task action on the child's board task and a per-child button in the parent's map-step drawer.
- **Cancel child** = existing `cancelInstance` on the child; its entry becomes `cancelled`. A cancelled child **blocks the join** (join = all children terminal-successful) until the user either retries it or cancels the parent — deliberate: silently assembling 7 of 8 clips is the wrong default for production work. (If a skip affordance is ever needed, it is an explicit user action recorded in history, not YAML policy.)
- **Cancel parent** = existing `cancelInstance` recursion cancels all live children.

### Concurrency

None added. Children dispatch through the normal task dispatch loop and are throttled by `settings.dispatch.maxConcurrentTurns` / `maxTurnsPerAgent` like any other tasks. A 20-clip fan-out queues; the ledger's exactly-once claims already prevent double-dispatch.

### Persistence & crash safety

Nothing new: children are instances in the existing instance store; the parent's `children[]` array is part of its instance JSON (atomic writes). Restart recovery = the same watchdog/forensics paths that cover nested workflows today.

## UI

- **Canvas:** one `map_workflow` node (renderer alongside the existing nested-workflow node) showing `workflow_id` + a live rollup badge (`5/8 complete, 1 failed`). Children are NOT canvas nodes — they're runtime instances, and the canvas renders the definition. Clicking the node opens the step drawer with a per-child list (status, link to child task, retry/cancel actions).
- **Task board:** children appear as tasks (existing `createBoardTaskForChild`), titled `{parent title} — {label} {i+1}/{N}`.
- **Node config drawer:** fields from the node-registry form-field metadata (source, workflow_id, item_key, max_children) — no special-casing.

## Answers to #203's open questions

| #203 question | Answer |
|---|---|
| Ordered list vs DAG vs control-flow nodes? | Ordered list + one map node. No DAG (decided at spec interview). |
| What should `dependsOn` mean? | Nothing — deleted (engine never read it). |
| Arbitrary `on_approve` jumps? | No — `on_approve` deleted; approval is positional. Gate routing is a non-goal. |
| Gates inside fan-out children vs top-level? | Both work unchanged: child gates are nested-workflow gates (already supported); top-level review points are ordinary gates before/after the map step. |
| Output aggregation across children? | `{ outputs: [...] }` in stable source order; byte-budgeted on prompt injection. |
| Retry/reject a single child without rewinding the parent? | Child-level `reopenFromStep`/re-create; parent join just waits. |
| How do dynamic children appear on board/canvas? | Board: real tasks (existing bridge). Canvas: rollup on the map node, never fake static nodes. |
| Plugin node ownership/side effects? | Unchanged — plugin kinds keep their registry + hook dispatch; `map_workflow` is a builtin. |

## Non-goals

- DAG/readiness scheduling, conditional branches, forward jumps, `while`/retry loops in YAML.
- Nested maps (a map child whose workflow contains another map). Nothing forbids it structurally (it's just nesting), but it is explicitly unsupported/untested in v1; validation warns.
- Per-node failure policies (`on_child_failure`), child timeouts, partial-join thresholds.
- Cross-child communication. Children see their item + parent context only.

## Implementation sketch (for the future build; ~3 PRs)

1. **Engine + types:** `MapWorkflowStep` in `definition-types.ts` + strict schema + form fields in `node-type-registry.ts`; validation rules; fan-out branch in `engine.ts` (`advanceWorkflow`/`createInstance` first-step handling); map-aware `propagateChildCompletion`; `map_source_invalid` typed error. Tests: fan-out N children, stable-order aggregation, empty-array advance, invalid source, max_children, crash-restart (reload instance mid-fanout).
2. **Recovery + gates-in-children:** per-child retry/cancel routes + exec tools; join-blocking semantics; cancel-parent recursion. Tests: single-child failure blocks join, retry unblocks, cancel-parent sweeps children, child gate approval flows to join.
3. **UI:** map node renderer + rollup, step-drawer child list, board task titles. Component tests per existing canvas/drawer suites.

Estimated size: comparable to the C2/C3 extraction series — comfortably reviewable in 3 PRs.

## Test plan seams

Everything mocks per CLAUDE.md testing rules (content-dir + OpenClaw home). The engine tests extend `tests/plugins/workflows/runtime.test.ts` fixtures (a `map-flow.yaml` with a scripted source-step output); join/propagation tests live beside the existing nested-workflow propagation tests; no live runtime needed anywhere.
