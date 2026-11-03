/**
 * The ONE brand-usage fact (Codex r2 #9): which OPEN tasks use which brand,
 * by the task's EFFECTIVE brand — its own `brandId`, the nearest ancestor's,
 * or the project's through `projects.getBrand` — the same resolution the
 * dispatch gate uses, independent of whether the brand's manifest reads.
 * The integrity check and the recover route both read this, so "no open
 * task uses this brand" is never said about a task that inherits it.
 *
 * Honesty: a task store that cannot be listed, or a resolution that throws,
 * makes the fact UNKNOWN (`known: false`) — never urgency, never "unused".
 */
import type { PluginContext, PluginTask, PluginTaskColumn } from '@bakin/core/plugin-types'

/** Columns whose tasks still use their brand (done/archived history is not usage). */
export const OPEN_TASK_COLUMNS: ReadonlySet<PluginTaskColumn> = new Set(['backlog', 'todo', 'inProgress', 'review', 'blocked'])

export interface BrandTaskUse {
  taskId: string
  title: string
  column: PluginTaskColumn
  /** How the task reaches the brand. */
  source: 'own' | 'parent' | 'project'
}

export interface BrandUsage {
  /** False when the task store or a resolution failed — the maps are then partial or empty and prove nothing. */
  known: boolean
  /** Why the fact is unknown (the first failure), for the copy that must not claim "unused". */
  error?: string
  /** Open tasks per effective brand id. */
  byBrand: Map<string, BrandTaskUse[]>
  /** Open tasks whose project brand could not be resolved (the hook errored — `known` is false then), per project id. */
  unresolvedByProject: Map<string, BrandTaskUse[]>
}

const taskUse = (task: PluginTask, source: BrandTaskUse['source']): BrandTaskUse => ({ taskId: task.id, title: task.title, column: task.column, source })

function push<K>(map: Map<K, BrandTaskUse[]>, key: K, entry: BrandTaskUse): void {
  const bucket = map.get(key) ?? []
  if (!bucket.some((existing) => existing.taskId === entry.taskId)) bucket.push(entry)
  map.set(key, bucket)
}

export async function collectBrandUsage(ctx: Pick<PluginContext, 'tasks'>): Promise<BrandUsage> {
  const byBrand = new Map<string, BrandTaskUse[]>()
  const unresolvedByProject = new Map<string, BrandTaskUse[]>()
  let tasks: PluginTask[]
  try {
    tasks = (await ctx.tasks.list()).filter((task) => OPEN_TASK_COLUMNS.has(task.column))
  } catch (err) {
    return { known: false, error: `the task board could not be read: ${err instanceof Error ? err.message : String(err)}`, byBrand, unresolvedByProject }
  }
  // Dynamic import keeps this module's load graph free of the task store (the core resolver does the same).
  const { resolveEffectiveBrand } = await import('../../../src/core/dispatch-context-blocks')
  let known = true
  let error: string | undefined
  for (const task of tasks) {
    try {
      const effective = await resolveEffectiveBrand(task)
      if (!effective) continue
      if ('unresolved' in effective) {
        // The project hook errored: the task may well use a brand we cannot name — the fact is unknown.
        known = false
        error ??= `the project brand of task ${task.id} could not be resolved`
        push(unresolvedByProject, effective.projectId, taskUse(task, 'project'))
      } else {
        push(byBrand, effective.brandId, taskUse(task, effective.source))
      }
    } catch (err) {
      known = false
      error ??= `the brand of task ${task.id} could not be resolved: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return { known, ...(error ? { error } : {}), byBrand, unresolvedByProject }
}
