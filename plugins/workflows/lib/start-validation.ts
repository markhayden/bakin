/**
 * Workflow Start Validation
 *
 * The single recursive workflow-start validator shared by REST, hooks, and
 * exec tools. Previously this logic was duplicated three ways (a module-scope
 * copy reading the `pluginCtx` global for routes, and an activate-scope copy
 * closing over `ctx` for hooks/exec-tools) — and the two had diverged: only
 * the route copy carried the top-level assignee-known check. This module is
 * the canonical superset: recursive nested-workflow validation + cycle
 * detection + the explicit assignee check, applied to every start path.
 *
 * The runtime-agent dependency is injected as a `ctx` (anything exposing
 * `runtime.agents.list()`); a null ctx degrades to an empty agent set, matching
 * the old module-scope guard.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import type { WorkflowDefinition, NestedWorkflowStep, MapWorkflowStep } from '../types'
import { collectTeamTokenIds } from '@bakin/core/workflows/team-token'
import { listDefinitions, loadDefinition, validateDefinition, validateWorkflowId } from './parser'
import { createInstance } from './runtime'

export async function getRuntimeAgentNames(ctx: PluginContext | null): Promise<Set<string>> {
  if (!ctx) return new Set()
  const agents = await ctx.runtime.agents.list()
  const names = new Set<string>()
  for (const agent of agents) {
    names.add(agent.id)
    names.add(agent.name)
  }
  return names
}

function collectNestedWorkflowIds(def: WorkflowDefinition, out: Set<string>): void {
  for (const step of def.steps) {
    if (step.type === 'workflow' || step.type === 'map_workflow') {
      out.add((step as NestedWorkflowStep | MapWorkflowStep).workflow_id)
    }
  }
}

export async function validateWorkflowForStart(
  ctx: PluginContext | null,
  workflowId: string,
  assignee: string | undefined,
  contentDir?: string,
  runtimeAgents?: Set<string>,
): Promise<string[]> {
  const errors: string[] = []
  const knownAgents = runtimeAgents ?? await getRuntimeAgentNames(ctx)
  const knownWorkflowIds = new Set(listDefinitions(contentDir).map((entry) => entry.name))
  const visited = new Set<string>()

  // Recurse through nested workflows, validating each definition and detecting
  // nesting cycles. The REST /instances/start path previously skipped this —
  // only the hook/exec-tool paths recursed — so a cyclic or invalid nested
  // workflow could be started via REST. This matches the strong validator.
  const visit = async (id: string, path: string[]): Promise<void> => {
    const workflowIdError = validateWorkflowId(id)
    if (workflowIdError) {
      errors.push(`Workflow "${id}": ${workflowIdError}`)
      return
    }
    if (path.includes(id)) {
      errors.push(`Workflow nesting cycle detected: ${[...path, id].join(' -> ')}`)
      return
    }
    if (visited.has(id)) return
    visited.add(id)

    const def = loadDefinition(id, contentDir)
    if (!def) {
      errors.push(`Workflow definition not found: ${id}`)
      return
    }

    // Team targets (#611): verify referenced teams exist at start time.
    // Unreachable team plugin → undefined → existence unchecked (tiered);
    // dispatch fails honestly then.
    let knownTeamIds: Set<string> | undefined
    const teamIds = collectTeamTokenIds(def.steps ?? [])
    if (teamIds.length > 0 && ctx) {
      try {
        const checks = await Promise.all(teamIds.map(async (teamId) =>
          [teamId, await ctx.hooks.invoke<boolean>('team.exists', { teamId })] as const))
        knownTeamIds = new Set(checks.filter(([, exists]) => exists === true).map(([teamId]) => teamId))
      } catch {
        knownTeamIds = undefined
      }
    }

    errors.push(...validateDefinition(def, {
      definitionId: id,
      source: def.source,
      contentDir,
      knownWorkflowIds,
      runtimeAgents: knownAgents,
      assignee,
      requireResolvedAgents: true,
      knownTeamIds,
    }).map((message) => `Workflow "${id}": ${message}`))

    const nestedIds = new Set<string>()
    collectNestedWorkflowIds(def, nestedIds)
    for (const nestedId of nestedIds) await visit(nestedId, [...path, id])
  }

  await visit(workflowId, [])

  if (assignee && !knownAgents.has(assignee)) {
    errors.push(`Assignee "${assignee}" is not a known runtime agent`)
  }
  return errors
}

export async function createValidatedInstance(
  ctx: PluginContext | null,
  taskId: string,
  workflowId: string,
  assignee: string | undefined,
  contentDir?: string,
  parentContext?: Record<string, unknown>,
) {
  const knownAgents = await getRuntimeAgentNames(ctx)
  const errors = await validateWorkflowForStart(ctx, workflowId, assignee, contentDir, knownAgents)
  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }
  return createInstance(taskId, workflowId, contentDir, assignee, parentContext, knownAgents)
}
