/**
 * Zod request/response schemas + the canonical column tuple for the tasks
 * plugin's REST routes and exec tools.
 *
 * Extracted from index.ts so the routes module, the exec tools, and the plugin
 * shell share one definition (the schemas were previously module-scope in
 * index.ts, used by both the route array and the registerExecTool blocks).
 */
import { z } from 'zod'

/** The seven kanban columns, in board order. */
export const COLUMNS = ['backlog', 'todo', 'inProgress', 'review', 'done', 'blocked', 'archived'] as const

export const taskIdParams = z.object({ taskId: z.string() })

export const runsHistoryQuery = z.object({ limit: z.coerce.number().int().positive().optional() })

export const okResponse = z.object({ ok: z.literal(true) })
export const errorResponse = z.object({ error: z.string() })

export const taskBoardResponse = z.object({}).passthrough()  // structural; defined elsewhere

export const taskSummaryResponse = z.object({ blocked: z.number(), review: z.number() })

export const taskSourceSchema = z.object({
  pluginId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  purpose: z.string().optional(),
})

export const createTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  column: z.enum(COLUMNS).optional(),
  assignee: z.string().optional(),
  /** Team assignment (#189) — mutually exclusive with assignee (handler-enforced 400). */
  team: z.string().optional(),
  workflowId: z.string().optional(),
  skipWorkflowReason: z.string().optional(),
  createdBy: z.string().optional(),
  parentId: z.string().optional(),
  projectId: z.string().optional(),
  brandId: z.string().optional(),
  repoPath: z.string().optional(),
  availableAt: z.string().optional(),
  dueAt: z.string().optional(),
  source: taskSourceSchema.optional(),
})
export const createTaskResponse = z.object({
  ok: z.literal(true),
  id: z.string(),
  workflowId: z.string().optional(),
  suggestedWorkflow: z.string().optional(),
})

export const updateTaskBody = z.object({
  id: z.string().optional(),
  originalTitle: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  agent: z.string().optional(),
  /** Team assignment (#189) — mutually exclusive with agent (handler-enforced 400). */
  team: z.string().optional(),
  column: z.string().optional(),
  workflowId: z.string().optional(),
  brandId: z.string().nullable().optional(),
  repoPath: z.string().nullable().optional(),
  availableAt: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  source: taskSourceSchema.nullable().optional(),
  /** Optimistic concurrency: refuse with 409 when stale. */
  expectedVersion: z.number().optional(),
})

export const deleteTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
}).optional()

export const moveTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  from: z.string().optional(),
  to: z.string(),
  agent: z.string(),
  reason: z.string().optional(),
  channel: z.string().optional(),
})

export const assignTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  agent: z.string().optional(),
})

export const logEntryBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  agent: z.string().optional(),
  message: z.string().min(1),
})

export const blockTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  agent: z.string().optional(),
  reason: z.string().min(1),
})

export const dependencyBody = z.object({
  id: z.string().optional(),
  dependsOn: z.string().min(1),
})

export const reorderBody = z.object({
  columnId: z.string().min(1),
  orderedIds: z.array(z.string()),
})

export const completeTaskBody = z.object({
  id: z.string().optional(),
  agent: z.string().optional(),
  summary: z.string().optional(),
})
