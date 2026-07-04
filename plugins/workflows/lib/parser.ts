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
import type { WorkflowDefinition, WorkflowStep, ParallelStep } from '../types'
import { getContentDir } from './content-dir'
import {
  getDefinition as getRegistryDefinition,
  listAll as listRegistryAll,
  type DefinitionSource,
} from '@bakin/core/workflows/source-registry'

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

// validateDefinition + its option type and the preferred-agent expression
// parser moved to core so the agent-package loader and package-integrity
// checks stop importing this plugin's source tree. Re-exported here so
// plugin-internal consumers (routes, start-validation, load-defaults,
// step-context) keep this module as their import surface.
export {
  validateDefinition,
  parsePreferredAgentExpression,
  type ValidateDefinitionOptions,
} from '@bakin/core/workflows/validate-definition'

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
