/**
 * Shared harness for the workflow runtime tests (FW7).
 *
 * The former tests/plugins/workflows/runtime.test.ts godfile carried one big
 * scaffold: hook-backed task-store/task-service fakes plus the workflow YAML
 * fixtures seeded before every test. The split files (runtime-engine,
 * runtime-gates, runtime-step-context, runtime-instance-store,
 * runtime-task-bridge) all need the same scaffold, so it lives here once.
 *
 * IMPORTANT: bun's `mock.module(...)` calls MUST stay in each test file —
 * module mocks are per-file under `--isolate`, and hoisting them into a
 * shared helper would silently change what gets mocked. This helper only
 * exports the hook mocks, module shapes, fixtures, and seed/reset routines;
 * each test file wires them into its own mock.module calls.
 */
import { mock } from 'bun:test'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export type HookTask = { id: string; title: string; column: string; description?: string; agent?: string }
export const hookTasks = new Map<string, HookTask>()
export const createTaskHook = mock(async (data: Record<string, unknown>) => {
  const id = data.id as string
  hookTasks.set(id, {
    id,
    title: data.title as string,
    column: data.column as string,
    description: data.description as string | undefined,
    agent: data.agent as string | undefined,
  })
  return { id }
})
export const createTaskWithEffectsHook = mock(async (data: Record<string, unknown>) => {
  const id = data.id as string
  hookTasks.set(id, {
    id,
    title: data.title as string,
    column: data.column as string,
    description: data.description as string | undefined,
  })
  return { id, workflowId: data.workflowId as string | undefined }
})
export const addTaskLogHook = mock(async (_data?: Record<string, unknown>) => undefined)
export const moveTaskHook = mock(async (data: Record<string, unknown>) => {
  const task = hookTasks.get(data.identifier as string)
  if (task) task.column = data.to as string
})
// Ledger-sync seam (#482): the runtime's store moves must go through
// task-service's syncLedgerForStoreMove. The spy delegates to moveTaskHook so
// move-sequence assertions keep observing the same store calls.
export const syncLedgerForStoreMoveHook = mock(async (taskId: string, to: string, _agent: string, opts?: { from?: string }) => {
  await moveTaskHook({ identifier: taskId, to, from: opts?.from })
})

export function readTaskboardForTest() {
  const columns: Record<string, HookTask[]> = {
    backlog: [],
    inProgress: [],
    todo: [],
    review: [],
    done: [],
    archived: [],
    blocked: [],
  }
  for (const task of hookTasks.values()) {
    ;(columns[task.column] ??= []).push(task)
  }
  return { columns }
}

export const taskStoreMock = {
  addTaskLog: (identifier: string, author: string, message: string) => addTaskLogHook({ identifier, author, message }),
  createTask: (
    title: string,
    column?: string,
    assignee?: string,
    description?: string,
    _workflowId?: string,
    _createdBy?: string,
    id?: string,
  ) => createTaskHook({ id, title, column, description, agent: assignee }),
  getTask: (id: string) => hookTasks.get(id) ?? null,
  getTaskWithColumn: (id: string) => {
    const task = hookTasks.get(id)
    return task ? { task, column: task.column } : null
  },
  moveTask: (identifier: string, to: string, from?: string) => moveTaskHook({ identifier, to, from }),
  readTaskboard: readTaskboardForTest,
}

export const taskServiceMock = () => ({
  createTaskWithEffects: (data: Record<string, unknown>) => createTaskWithEffectsHook(data),
  syncLedgerForStoreMove: (taskId: string, to: string, agent: string, opts?: { from?: string }) =>
    syncLedgerForStoreMoveHook(taskId, to, agent, opts),
})

// ---------------------------------------------------------------------------
// Workflow YAML fixtures (seeded into defsDir/skillsDir before every test)
// ---------------------------------------------------------------------------

// Simple linear workflow: 3 agent steps
export const linearWorkflow = `
name: Linear Test
description: 3-step linear workflow
version: 1
steps:
  - id: step-one
    type: agent
    label: Step One
    agent: chef
    description: Do step one
  - id: step-two
    type: agent
    label: Step Two
    agent: pixel
    description: Do step two
  - id: step-three
    type: agent
    label: Step Three
    agent: rolo
    description: Do step three
`

// Workflow with parallel steps
export const parallelWorkflow = `
name: Parallel Test
description: Workflow with parallel steps
version: 1
steps:
  - id: write-copy
    type: agent
    label: Write Copy
    agent: chef
    description: Write the copy
  - id: create-assets
    type: parallel
    label: Generate Assets
    steps:
      - id: create-image
        type: agent
        label: Generate Image
        agent: pixel
        description: Generate an image
      - id: create-video
        type: agent
        label: Generate Video
        agent: rolo
        description: Generate a video
  - id: publish
    type: agent
    label: Publish
    agent: main
    description: Publish it all
`

export const preferredWorkflow = `
name: Preferred Agent Test
description: Prefer pixel with assigned fallback
version: 1
steps:
  - id: create-image
    type: agent
    label: Create Image
    agent: $preferred(pixel,$assigned)
    description: Create the image
`

// Workflow with gate step
export const gateWorkflow = `
name: Gate Test
description: Workflow with gate
version: 1
steps:
  - id: write-copy
    type: agent
    label: Write Copy
    agent: chef
    description: Write the copy
  - id: review-gate
    type: gate
    label: Review
    description: Human review
    approval_required: true
    on_reject:
      goto: write-copy
      note_to_agent: true
  - id: publish
    type: agent
    label: Publish
    agent: main
    description: Publish
`

// Workflow ending in an approval gate (advance is purely positional)
export const finalGateWorkflow = `
name: Final Gate
description: Workflow ending in an approval gate
version: 1
steps:
  - id: write-copy
    type: agent
    label: Write Copy
    agent: chef
  - id: publish-gate
    type: gate
    label: Publish approval
    approval_required: true
`

// Workflow with skill references
export const skillWorkflow = `
name: Skill Test
description: Test skill resolution
version: 1
steps:
  - id: write
    type: agent
    label: Write
    agent: chef
    skill: test-skill
  - id: plain
    type: agent
    label: Plain
    agent: pixel
    description: No skill, just description
`

export const taskNodeWorkflow = `
name: Task Node Test
description: Builtin createTask node
version: 1
steps:
  - id: make-task
    type: createTask
    label: Make Task
    title: Prep Instagram Reel
    agent: patch
    description: Prepare the channel deliverable.
    availableAt: '2026-05-18T15:00:00.000Z'
    dueAt: '2026-05-22T15:00:00.000Z'
    source:
      pluginId: messaging
      entityType: deliverable
      entityId: deliverable-1
      purpose: kickoff
  - id: after-create
    type: agent
    label: Continue
    agent: chef
    description: Continue after task creation
`

// Map fan-out parent: source agent step → map_workflow → after
export const mapWorkflow = `
name: Map Flow
description: Dynamic fan-out test workflow
version: 1
steps:
  - id: source-step
    type: agent
    label: Segment
    agent: chef
    description: Produce the items array
  - id: produce-items
    type: map_workflow
    label: Produce Items
    source: source-step.items
    workflow_id: map-child
    item_key: brief
    max_children: 4
  - id: after-map
    type: agent
    label: After Map
    agent: main
    description: Consume the aggregate
`

// Minimal child workflow for map fan-out
export const mapChildWorkflow = `
name: Map Child
description: Single-step map child
version: 1
steps:
  - id: do-work
    type: agent
    label: Do Work
    agent: pixel
    description: Work one item
`

// Map parent whose children use a $preferred(...) agent selector — proves the
// fan-out board tasks store a RESOLVED agent, not the raw selector string.
export const mapPreferredWorkflow = `
name: Map Preferred Flow
description: Fan-out into preferred-selector children
version: 1
steps:
  - id: source-step
    type: agent
    label: Segment
    agent: chef
  - id: produce-items
    type: map_workflow
    label: Produce Items
    source: source-step.items
    workflow_id: preferred
  - id: after-map
    type: agent
    label: After Map
    agent: main
`

// Map child WITH a gate — proves child gate approvals flow to the join
export const mapGatedChildWorkflow = `
name: Map Gated Child
description: Map child containing a gate
version: 1
steps:
  - id: work
    type: agent
    label: Work
    agent: pixel
  - id: check
    type: gate
    label: Check
    approval_required: true
  - id: finish
    type: agent
    label: Finish
    agent: pixel
`

// Map parent whose children carry gates
export const mapGatedWorkflow = `
name: Map Gated Flow
description: Fan-out into gated children
version: 1
steps:
  - id: source-step
    type: agent
    label: Segment
    agent: chef
  - id: produce-items
    type: map_workflow
    label: Produce Items
    source: source-step.items
    workflow_id: map-gated-child
  - id: after-map
    type: agent
    label: After Map
    agent: main
`

// Nested recursion: a parent whose child workflow (map-flow) contains the map
export const mapWrapperWorkflow = `
name: Map Wrapper
description: Nested workflow whose child contains a map step
version: 1
steps:
  - id: run-map-flow
    type: workflow
    label: Run Map Flow
    workflow_id: map-flow
  - id: wrap-after
    type: agent
    label: Wrap After
    agent: main
`

// Statically illegal (map at index 0 has no earlier source step) — exercises
// the defensive createInstance branch on non-validating paths.
export const mapFirstWorkflow = `
name: Map First
description: Defensive first-step map
version: 1
steps:
  - id: fan
    type: map_workflow
    label: Fan
    source: ghost.items
    workflow_id: map-child
  - id: after
    type: agent
    label: After
    agent: main
`

export const testSkillMarkdown = `---
name: Test Skill
output_schema:
  type: object
  required:
    - caption
  properties:
    caption:
      type: string
---

Write a great caption.
`

/**
 * Clears the hook-task state and hook-call history exactly as the original
 * godfile's beforeEach did (syncLedgerForStoreMoveHook is intentionally NOT
 * cleared here — the ledger-sync tests clear it themselves).
 */
export function resetRuntimeHarness(): void {
  hookTasks.clear()
  createTaskHook.mockClear()
  createTaskWithEffectsHook.mockClear()
  addTaskLogHook.mockClear()
  moveTaskHook.mockClear()
}

/** Recreates the workflow dirs and seeds every YAML/skill fixture. */
export function seedWorkflowFixtures(testDir: string): void {
  const defsDir = join(testDir, 'workflows', 'definitions')
  const skillsDir = join(testDir, 'workflows', 'skills')
  const instancesDir = join(testDir, 'workflows', 'instances')
  mkdirSync(defsDir, { recursive: true })
  mkdirSync(skillsDir, { recursive: true })
  mkdirSync(instancesDir, { recursive: true })

  writeFileSync(join(defsDir, 'linear.yaml'), linearWorkflow)
  writeFileSync(join(defsDir, 'parallel.yaml'), parallelWorkflow)
  writeFileSync(join(defsDir, 'preferred.yaml'), preferredWorkflow)
  writeFileSync(join(defsDir, 'gate.yaml'), gateWorkflow)
  writeFileSync(join(defsDir, 'final-gate.yaml'), finalGateWorkflow)
  writeFileSync(join(defsDir, 'skill-test.yaml'), skillWorkflow)
  writeFileSync(join(defsDir, 'task-node.yaml'), taskNodeWorkflow)
  writeFileSync(join(defsDir, 'map-flow.yaml'), mapWorkflow)
  writeFileSync(join(defsDir, 'map-child.yaml'), mapChildWorkflow)
  writeFileSync(join(defsDir, 'map-first.yaml'), mapFirstWorkflow)
  writeFileSync(join(defsDir, 'map-wrapper.yaml'), mapWrapperWorkflow)
  writeFileSync(join(defsDir, 'map-gated-child.yaml'), mapGatedChildWorkflow)
  writeFileSync(join(defsDir, 'map-gated.yaml'), mapGatedWorkflow)
  writeFileSync(join(defsDir, 'map-preferred.yaml'), mapPreferredWorkflow)
  writeFileSync(join(skillsDir, 'test-skill.md'), testSkillMarkdown)
}
