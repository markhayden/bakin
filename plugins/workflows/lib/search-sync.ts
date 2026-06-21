/**
 * Workflow Search Sync
 *
 * Search-document builders for workflow instances and definitions, plus the
 * ctx-injected index helpers. Previously these were duplicated across a
 * module-scope copy (reading the pluginCtx global, for route closures) and an
 * activate-scope copy (closing over ctx, for the file-backed content type and
 * hooks/exec-tools). Now a single set, reading the shared plugin-context
 * accessor — null ctx before activate degrades to a no-op, matching the old
 * `if (!pluginCtx) return` guard.
 */
import type { WorkflowDefinition, WorkflowInstance } from '../types'
import type { DefinitionSource } from './source-registry'
import { loadDefinition } from './parser'
import { loadInstance } from './runtime'
import { isWorkflowDisabled } from './availability'
import { getWorkflowPluginContext } from './plugin-context'
import { createLogger } from '@bakin/core/logger'

const log = createLogger('workflows')

/** Convert a workflow instance to a search document. */
export function instanceToSearchDoc(inst: WorkflowInstance): Record<string, unknown> {
  const def = loadDefinition(inst.workflowId)
  const stepsText = def?.steps.map(s => `${s.id}: ${s.label || ''}`).join(', ') || ''
  return {
    name: def?.name || inst.workflowId,
    description: def?.description || '',
    type: 'instance',
    status: inst.status,
    task_id: inst.taskId,
    steps: stepsText,
    updated_at: inst.updatedAt || new Date().toISOString(),
  }
}

/** Convert a workflow definition to a search document. */
export function definitionToSearchDoc(name: string, def: WorkflowDefinition, source?: DefinitionSource): Record<string, unknown> {
  const stepsText = def.steps.map(s => `${s.id}: ${s.label || ''}`).join(', ')
  const definitionSource = source ?? (def as WorkflowDefinition & { source?: DefinitionSource }).source
  return {
    name: def.name,
    description: def.description || '',
    type: 'definition',
    status: definitionSource !== 'user' && isWorkflowDisabled(name) ? 'disabled' : 'active',
    task_id: '',
    steps: stepsText,
    updated_at: new Date().toISOString(),
  }
}

/** Index a workflow instance in search. No-op until the plugin has activated. */
export async function indexInstance(taskId: string): Promise<void> {
  const ctx = getWorkflowPluginContext()
  if (!ctx) return
  try {
    const inst = loadInstance(taskId)
    if (inst) {
      await ctx.search.index(`inst:${taskId}`, instanceToSearchDoc(inst))
    }
  } catch (err) {
    log.warn('Failed to index workflow instance', { taskId, error: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Index a workflow definition in search. No-op until the plugin has activated.
 * Errors propagate so callers can log with their own context (mirrors the
 * former inline `pluginCtx?.search.index` + try/catch at the availability route).
 */
export async function indexDefinition(name: string, def: WorkflowDefinition, source?: DefinitionSource): Promise<void> {
  const ctx = getWorkflowPluginContext()
  if (!ctx) return
  await ctx.search.index(`def:${name}`, definitionToSearchDoc(name, def, source))
}
