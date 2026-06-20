/**
 * YAML workflow definition parser.
 * Uses js-yaml for reliable parsing with definition validation.
 *
 * Definitions come from two sources, merged with user-wins precedence:
 *   1. User-owned YAML files at ~/.bakin/workflows/definitions/{id}.yaml
 *   2. Plugin-registered definitions (via ctx.registerWorkflow, see source-registry)
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import type { WorkflowDefinition, WorkflowStep, ParallelStep, NestedWorkflowStep } from '../types'
import { getContentDir } from './content-dir'
import {
  getDefinition as getRegistryDefinition,
  listAll as listRegistryAll,
  type DefinitionSource,
} from './source-registry'

/**
 * A definition plus its provenance.
 *   - Disk-loaded defs carry source='user'
 *   - Plugin-registered defs carry source='plugin' + pluginId
 *   - Agent-package-registered defs carry source='agent-package' + packageId
 */
export type LoadedDefinition = WorkflowDefinition & {
  source?: DefinitionSource
  pluginId?: string
  packageId?: string
}

export interface LoadedDefinitionEntry {
  name: string
  definition: LoadedDefinition
  source: DefinitionSource
  pluginId?: string
  packageId?: string
}

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
}

export const WORKFLOW_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const WORKFLOW_ID_VALIDATION_MESSAGE = 'Workflow id must use lowercase letters, numbers, and hyphens.'

export function validateWorkflowId(id: string, label = 'Workflow id'): string | null {
  if (!id.trim()) return `${label} is required`
  if (!WORKFLOW_ID_PATTERN.test(id)) return WORKFLOW_ID_VALIDATION_MESSAGE
  return null
}

function getDefinitionsDir(contentDir?: string): string {
  const dir = contentDir || getContentDir()
  return join(dir, 'workflows', 'definitions')
}

/**
 * Parse a YAML string into a WorkflowDefinition.
 */
export function parseYAML(content: string): Record<string, unknown> {
  return yaml.load(content) as Record<string, unknown>
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

// ─── Definition traversal helpers ───────────────────────────────────────────
// Pure WorkflowDefinition walkers (including parallel children) used by the
// runtime engine, gates, step-context, and node-dispatch. They carry zero
// instance knowledge, so they live beside loadDefinition for reuse.

/**
 * Flatten all step IDs from a workflow definition (including parallel children).
 */
export function flattenSteps(steps: WorkflowStep[]): { id: string; step: WorkflowStep; parentId?: string }[] {
  const result: { id: string; step: WorkflowStep; parentId?: string }[] = []
  for (const step of steps) {
    result.push({ id: step.id, step })
    if (step.type === 'parallel') {
      for (const child of (step as ParallelStep).steps) {
        result.push({ id: child.id, step: child, parentId: step.id })
      }
    }
  }
  return result
}

/**
 * Find a step by ID in a workflow definition.
 */
export function findStep(def: WorkflowDefinition, stepId: string): WorkflowStep | null {
  for (const step of def.steps) {
    if (step.id === stepId) return step
    if (step.type === 'parallel') {
      for (const child of (step as ParallelStep).steps) {
        if (child.id === stepId) return child
      }
    }
  }
  return null
}

/**
 * Get the top-level step index (in definition.steps array) for a step ID.
 */
export function getTopLevelIndex(def: WorkflowDefinition, stepId: string): number {
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i]
    if (step.id === stepId) return i
    if (step.type === 'parallel') {
      for (const child of (step as ParallelStep).steps) {
        if (child.id === stepId) return i
      }
    }
  }
  return -1
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

  const validateAgent = (step: WorkflowStep, path: string): void => {
    const agent = 'agent' in step ? step.agent : undefined
    if (step.type === 'output' && !agent) {
      errors.push(`Step "${step.id}": output step requires an agent owner`)
      return
    }
    if (typeof agent !== 'string' || agent.length === 0) return

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

  const validateDependsOn = (step: WorkflowStep, topLevelIdx: number): void => {
    if (!('dependsOn' in step) || !step.dependsOn) return
    const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn]
    for (const dep of deps) {
      if (!idSet.has(dep)) {
        errors.push(`Step "${step.id}": dependsOn references nonexistent step "${dep}"`)
        continue
      }
      if (!topLevelIds.has(dep)) {
        errors.push(`Step "${step.id}": dependsOn references child step "${dep}"; only top-level step dependencies are supported`)
        continue
      }
      const depIdx = getTopLevelStepIndex(def.steps, dep)
      if (depIdx >= topLevelIdx) {
        errors.push(`Step "${step.id}": dependsOn "${dep}" must reference an earlier top-level step`)
      }
    }
  }

  // Validate references and runtime-supported semantics.
  for (let idx = 0; idx < def.steps.length; idx++) {
    const step = def.steps[idx]
    validateAgent(step, `steps[${idx}]`)
    validateDependsOn(step, idx)

    // Check gate on_reject.goto references
    if (step.type === 'gate' && step.on_reject?.goto) {
      if (!idSet.has(step.on_reject.goto)) {
        errors.push(`Step "${step.id}": on_reject.goto references nonexistent step "${step.on_reject.goto}"`)
      } else if (!topLevelIds.has(step.on_reject.goto)) {
        errors.push(`Step "${step.id}": on_reject.goto must target a top-level step`)
      } else if (getTopLevelStepIndex(def.steps, step.on_reject.goto) > idx) {
        errors.push(`Step "${step.id}": on_reject.goto must rewind to this or an earlier step`)
      }
    }

    if (step.type === 'gate') {
      const expectedNext = def.steps[idx + 1]?.id
      if (step.on_approve !== 'done' && step.on_approve !== expectedNext) {
        errors.push(
          expectedNext
            ? `Step "${step.id}": on_approve must point to the next top-level step "${expectedNext}" or "done"`
            : `Step "${step.id}": final gate on_approve must be "done"`,
        )
      }
    }

    // Validate workflow step references
    if (validateNestedWorkflowRefs && step.type === 'workflow') {
      const nested = step as NestedWorkflowStep
      if (!nested.workflow_id) {
        errors.push(`Step "${step.id}": workflow step requires workflow_id`)
      } else if (opts.definitionId && nested.workflow_id === opts.definitionId) {
        errors.push(`Step "${step.id}": workflow_id "${nested.workflow_id}" cannot reference its own workflow`)
      } else {
        // Check that referenced workflow exists in the current validation set,
        // on disk, or in the registry. The validation-set path is what lets
        // plugin-shipped defaults validate in two passes before registration.
        const inKnownSet = knownWorkflowIds?.has(nested.workflow_id) ?? false
        const defsDir = join(opts.contentDir || getContentDir(), 'workflows', 'definitions')
        const nestedYaml = join(defsDir, `${nested.workflow_id}.yaml`)
        const nestedYml = join(defsDir, `${nested.workflow_id}.yml`)
        const onDisk = existsSync(nestedYaml) || existsSync(nestedYml)
        const inRegistry = !!getRegistryDefinition(nested.workflow_id)
        if (!inKnownSet && !onDisk && !inRegistry) {
          errors.push(`Step "${step.id}": workflow_id "${nested.workflow_id}" not found in definitions`)
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
        if ('dependsOn' in child && child.dependsOn) {
          errors.push(`Step "${child.id}": dependsOn inside parallel children is not supported`)
        }
      }
    }
  }

  return errors
}

/**
 * Load a workflow definition by name. Same precedence as listDefinitions:
 *   user (~/.bakin/workflows/definitions/) > agent-package > plugin
 *
 * The source-registry's `getDefinition()` already resolves agent-package
 * vs plugin — we just check disk first.
 */
export function loadDefinition(name: string, contentDir?: string): LoadedDefinition | null {
  // User-wins: check ~/.bakin/ disk first
  const defsDir = getDefinitionsDir(contentDir)
  const yamlPath = join(defsDir, `${name}.yaml`)
  const ymlPath = join(defsDir, `${name}.yml`)
  const filePath = existsSync(yamlPath) ? yamlPath : existsSync(ymlPath) ? ymlPath : null
  if (filePath) {
    const content = readFileSync(filePath, 'utf-8')
    const parsed = parseYAML(content) as unknown as WorkflowDefinition
    return { ...parsed, source: 'user' }
  }

  // Fall back to source-registry (agent-package > plugin precedence)
  const entry = getRegistryDefinition(name)
  if (entry) {
    return {
      ...entry.definition,
      source: entry.source,
      pluginId: entry.pluginId,
      packageId: entry.packageId,
    }
  }

  return null
}

/**
 * List all available workflow definitions, merging plugin + agent-package +
 * disk (user) entries with the precedence rule:
 *   user > agent-package > plugin
 *
 * The seeding order below builds the map low → high, so the final value at
 * each id is whichever tier wins.
 */
export function listDefinitions(contentDir?: string): LoadedDefinitionEntry[] {
  const byName = new Map<string, LoadedDefinitionEntry>()

  // 1. Plugin-registered entries (lowest precedence)
  for (const entry of listRegistryAll()) {
    if (entry.source === 'plugin') {
      byName.set(entry.id, {
        name: entry.id,
        definition: { ...entry.definition, source: entry.source, pluginId: entry.pluginId },
        source: entry.source,
        pluginId: entry.pluginId,
      })
    }
  }

  // 2. Agent-package-registered entries (overwrite plugin on collision)
  for (const entry of listRegistryAll()) {
    if (entry.source === 'agent-package') {
      byName.set(entry.id, {
        name: entry.id,
        definition: {
          ...entry.definition,
          source: entry.source,
          packageId: entry.packageId,
        },
        source: entry.source,
        packageId: entry.packageId,
      })
    }
  }

  // 3. Disk entries (user — overwrites plugin and agent-package on collision)
  const defsDir = getDefinitionsDir(contentDir)
  if (existsSync(defsDir)) {
    for (const f of readdirSync(defsDir)) {
      if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue
      const name = f.replace(/\.(yaml|yml)$/, '')
      const definition = loadDefinition(name, contentDir)
      if (!definition) continue
      byName.set(name, {
        name,
        definition,
        source: 'user',
      })
    }
  }

  return Array.from(byName.values())
}
