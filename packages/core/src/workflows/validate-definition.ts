/**
 * Workflow definition validation — shared by the workflows plugin's parser
 * (YAML loading, editor CRUD, start validation) and core's agent-package
 * loader + package-integrity checks. Moved here from
 * plugins/workflows/lib/parser.ts so core stops importing the plugin's
 * source tree; the parser re-exports `validateDefinition` from this home.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import type { WorkflowDefinition, WorkflowStep, ParallelStep, NestedWorkflowStep, MapWorkflowStep } from './definition-types'
import { getContentDir } from '../content-dir'
import { getDefinition as getRegistryDefinition, type DefinitionSource } from './source-registry'
import { isTeamStepToken, teamIdFromToken } from './team-token'

export interface ValidateDefinitionOptions {
  definitionId?: string
  source?: DefinitionSource
  contentDir?: string
  knownWorkflowIds?: Iterable<string>
  runtimeAgents?: Iterable<string>
  assignee?: string
  requireResolvedAgents?: boolean
  validateNestedWorkflowRefs?: boolean
  allowEmptySteps?: boolean
  /** Existing team ids for `team:<id>` step targets (#611). Absent = team
   * existence is not checked here (tiered like nested-workflow refs — the
   * caller couldn't reach the team plugin); dispatch fails honestly then. */
  knownTeamIds?: Iterable<string>
}

/**
 * Collect all step IDs (including nested parallel children).
 */
function collectStepIds(steps: WorkflowStep[]): string[] {
  const ids: string[] = []
  for (const step of steps) {
    ids.push(step.id)
    if (step.type === 'parallel') {
      for (const child of (step as ParallelStep).steps) {
        ids.push(child.id)
      }
    }
  }
  return ids
}

function getTopLevelStepIndex(steps: WorkflowStep[], stepId: string): number {
  return steps.findIndex((step) => step.id === stepId)
}

function isSymbolicAgent(agent: string): boolean {
  return agent.startsWith('$')
}

const SUPPORTED_AGENT_SYMBOLS = new Set(['$assigned'])

export function parsePreferredAgentExpression(agent: string): string[] | null {
  const match = agent.match(/^\$preferred\((.*)\)$/)
  if (!match) return null
  const raw = match[1].split(',').map(part => part.trim())
  if (raw.length < 2 || raw.some(part => part.length === 0)) return null
  return raw
}

function resolvePreferredForValidation(
  choices: string[],
  opts: { runtimeAgents?: Set<string>; assignee?: string },
): string | null {
  for (const choice of choices) {
    if (choice === '$assigned') {
      if (opts.assignee && (!opts.runtimeAgents || opts.runtimeAgents.has(opts.assignee))) return opts.assignee
      continue
    }
    if (!choice.startsWith('$') && opts.runtimeAgents?.has(choice)) return choice
  }
  return null
}

/**
 * Validate a parsed workflow definition.
 * Returns an array of error messages (empty if valid).
 */
export function validateDefinition(def: WorkflowDefinition, opts: ValidateDefinitionOptions = {}): string[] {
  const errors: string[] = []
  const knownWorkflowIds = opts.knownWorkflowIds ? new Set(opts.knownWorkflowIds) : undefined
  const runtimeAgents = opts.runtimeAgents ? new Set(opts.runtimeAgents) : undefined
  const validateNestedWorkflowRefs = opts.validateNestedWorkflowRefs ?? true

  if (!def.name) errors.push('Missing required field: name')
  if (!def.steps || !Array.isArray(def.steps)) {
    errors.push('Workflow must have at least one step')
    return errors
  }
  if (def.steps.length === 0) {
    if (opts.allowEmptySteps) return errors
    errors.push('Workflow must have at least one step')
    return errors
  }

  const allIds = collectStepIds(def.steps)
  const idSet = new Set<string>()
  const topLevelIds = new Set(def.steps.map((step) => step.id))

  // Check for duplicate IDs
  for (const id of allIds) {
    if (idSet.has(id)) {
      errors.push(`Duplicate step ID: "${id}"`)
    }
    idSet.add(id)
  }

  const knownTeamIds = opts.knownTeamIds ? new Set(opts.knownTeamIds) : undefined

  const validateAgent = (step: WorkflowStep, path: string): void => {
    const agent = 'agent' in step ? step.agent : undefined
    if (step.type === 'output' && !agent) {
      errors.push(`Step "${step.id}": output step requires an agent owner`)
      return
    }
    if (typeof agent !== 'string' || agent.length === 0) return

    // Team target (#611) — resolved per-step at dispatch. Team ids are
    // machine-specific like literal agents, so plugin-shipped workflows may
    // not hardcode them.
    if (isTeamStepToken(agent)) {
      const teamId = teamIdFromToken(agent)
      if (!teamId) {
        errors.push(`Step "${step.id}": team target "${agent}" has no team id at ${path}.agent`)
      } else if (opts.source === 'plugin') {
        errors.push(`Step "${step.id}": plugin-shipped workflows must use symbolic agents; found team target "${agent}"`)
      } else if (knownTeamIds && !knownTeamIds.has(teamId)) {
        errors.push(`Step "${step.id}": references unknown team "${teamId}"`)
      }
      return
    }

    if (isSymbolicAgent(agent)) {
      const preferred = parsePreferredAgentExpression(agent)
      if (preferred) {
        for (const choice of preferred) {
          if (choice.startsWith('$') && !SUPPORTED_AGENT_SYMBOLS.has(choice)) {
            errors.push(`Step "${step.id}": unsupported agent symbol "${choice}" in selector at ${path}.agent`)
          }
        }
        if (opts.requireResolvedAgents && !resolvePreferredForValidation(preferred, { runtimeAgents, assignee: opts.assignee })) {
          errors.push(`Step "${step.id}": agent selector "${agent}" cannot resolve to a known runtime agent`)
        }
      } else if (agent.startsWith('$preferred(')) {
        errors.push(`Step "${step.id}": unsupported agent selector "${agent}" at ${path}.agent`)
      } else if (!SUPPORTED_AGENT_SYMBOLS.has(agent)) {
        errors.push(`Step "${step.id}": unsupported agent symbol "${agent}" at ${path}.agent`)
      } else if (agent === '$assigned' && opts.requireResolvedAgents && !opts.assignee) {
        errors.push(`Step "${step.id}": agent "$assigned" cannot resolve because the task has no assignee`)
      } else if (agent === '$assigned' && opts.assignee && runtimeAgents && !runtimeAgents.has(opts.assignee)) {
        errors.push(`Step "${step.id}": agent "$assigned" resolves to unknown agent "${opts.assignee}"`)
      }
      return
    }

    if (opts.source === 'plugin') {
      errors.push(`Step "${step.id}": plugin-shipped workflows must use symbolic agents; found literal agent "${agent}"`)
      return
    }

    if (runtimeAgents && !runtimeAgents.has(agent)) {
      errors.push(`Step "${step.id}": references unknown agent "${agent}"`)
    }
  }

  // Validate references and runtime-supported semantics.
  for (let idx = 0; idx < def.steps.length; idx++) {
    const step = def.steps[idx]
    validateAgent(step, `steps[${idx}]`)

    // Check gate on_reject.goto references
    if (step.type === 'gate' && step.on_reject?.goto) {
      if (!idSet.has(step.on_reject.goto)) {
        errors.push(`Step "${step.id}": on_reject.goto references nonexistent step "${step.on_reject.goto}"`)
      } else if (!topLevelIds.has(step.on_reject.goto)) {
        errors.push(`Step "${step.id}": on_reject.goto must target a top-level step`)
      } else if (getTopLevelStepIndex(def.steps, step.on_reject.goto) > idx) {
        errors.push(`Step "${step.id}": on_reject.goto must rewind to this or an earlier step`)
      } else if (def.steps[getTopLevelStepIndex(def.steps, step.on_reject.goto)]?.type === 'map_workflow') {
        errors.push(`Step "${step.id}": on_reject.goto cannot target a map_workflow step — target its source step instead`)
      }
    }

    // Validate workflow step references. Structural checks (workflow_id
    // present, no self-reference) are always fatal; the EXISTENCE check is
    // gated by validateNestedWorkflowRefs because plugin-default loading runs
    // before every plugin has activated (#374) — there, existence is enforced
    // at start time and surfaced by the workflow-definitions health check.
    // map_workflow child references follow the exact same three-tier model.
    if (step.type === 'workflow' || step.type === 'map_workflow') {
      const workflowId = (step as NestedWorkflowStep | MapWorkflowStep).workflow_id
      if (!workflowId) {
        errors.push(`Step "${step.id}": ${step.type} step requires workflow_id`)
      } else if (opts.definitionId && workflowId === opts.definitionId) {
        errors.push(`Step "${step.id}": workflow_id "${workflowId}" cannot reference its own workflow`)
      } else if (validateNestedWorkflowRefs) {
        // Referenced workflow must exist in the current validation set, on
        // disk, or in the registry.
        const inKnownSet = knownWorkflowIds?.has(workflowId) ?? false
        const defsDir = join(opts.contentDir || getContentDir(), 'workflows', 'definitions')
        const nestedYaml = join(defsDir, `${workflowId}.yaml`)
        const nestedYml = join(defsDir, `${workflowId}.yml`)
        const onDisk = existsSync(nestedYaml) || existsSync(nestedYml)
        const inRegistry = !!getRegistryDefinition(workflowId)
        if (!inKnownSet && !onDisk && !inRegistry) {
          errors.push(`Step "${step.id}": workflow_id "${workflowId}" not found in definitions`)
        }
      }
    }

    // Validate map_workflow source references: positional, statically
    // checkable — same rule shape the deleted dependsOn validator used
    // (exists / top-level / strictly earlier).
    if (step.type === 'map_workflow') {
      const map = step as MapWorkflowStep
      const match = typeof map.source === 'string' ? /^([^.\s]+)\.(\S+)$/.exec(map.source) : null
      if (!match) {
        errors.push(`Step "${step.id}": source must be "<stepId>.<outputKey>"; got "${map.source}"`)
      } else {
        const sourceStepId = match[1]
        if (!idSet.has(sourceStepId)) {
          errors.push(`Step "${step.id}": source references nonexistent step "${sourceStepId}"`)
        } else if (!topLevelIds.has(sourceStepId)) {
          errors.push(`Step "${step.id}": source must reference a top-level step`)
        } else if (getTopLevelStepIndex(def.steps, sourceStepId) >= idx) {
          errors.push(`Step "${step.id}": source must reference an earlier top-level step`)
        }
      }
    }

    // Validate parallel children
    if (step.type === 'parallel') {
      for (const [childIdx, child] of (step as ParallelStep).steps.entries()) {
        validateAgent(child, `steps[${idx}].steps[${childIdx}]`)
        if (child.type !== 'agent') {
          errors.push(`Step "${step.id}": parallel children must be agent steps; child "${child.id}" is "${child.type}"`)
        }
      }
    }
  }

  return errors
}
