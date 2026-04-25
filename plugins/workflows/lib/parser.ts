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

/**
 * Validate a parsed workflow definition.
 * Returns an array of error messages (empty if valid).
 */
export function validateDefinition(def: WorkflowDefinition): string[] {
  const errors: string[] = []

  if (!def.name) errors.push('Missing required field: name')
  if (!def.steps || !Array.isArray(def.steps) || def.steps.length === 0) {
    errors.push('Workflow must have at least one step')
    return errors
  }

  const allIds = collectStepIds(def.steps)
  const idSet = new Set<string>()

  // Check for duplicate IDs
  for (const id of allIds) {
    if (idSet.has(id)) {
      errors.push(`Duplicate step ID: "${id}"`)
    }
    idSet.add(id)
  }

  // Validate references
  for (const step of def.steps) {
    // Check gate on_reject.goto references
    if (step.type === 'gate' && step.on_reject?.goto) {
      if (!idSet.has(step.on_reject.goto)) {
        errors.push(`Step "${step.id}": on_reject.goto references nonexistent step "${step.on_reject.goto}"`)
      }
    }

    // Check dependsOn references
    if ('dependsOn' in step && step.dependsOn) {
      const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn]
      for (const dep of deps) {
        if (!idSet.has(dep)) {
          errors.push(`Step "${step.id}": dependsOn references nonexistent step "${dep}"`)
        }
      }
    }

    // Validate workflow step references
    if (step.type === 'workflow') {
      const nested = step as NestedWorkflowStep
      if (!nested.workflow_id) {
        errors.push(`Step "${step.id}": workflow step requires workflow_id`)
      } else {
        // Check that referenced workflow exists on disk OR in the plugin registry
        const defsDir = join(getContentDir(), 'workflows', 'definitions')
        const nestedYaml = join(defsDir, `${nested.workflow_id}.yaml`)
        const nestedYml = join(defsDir, `${nested.workflow_id}.yml`)
        const onDisk = existsSync(nestedYaml) || existsSync(nestedYml)
        const inRegistry = !!getRegistryDefinition(nested.workflow_id)
        if (!onDisk && !inRegistry) {
          errors.push(`Step "${step.id}": workflow_id "${nested.workflow_id}" not found in definitions`)
        }
      }
    }

    // Validate parallel children
    if (step.type === 'parallel') {
      for (const child of (step as ParallelStep).steps) {
        if ('dependsOn' in child && child.dependsOn) {
          const deps = Array.isArray(child.dependsOn) ? child.dependsOn : [child.dependsOn]
          for (const dep of deps) {
            if (!idSet.has(dep)) {
              errors.push(`Step "${child.id}": dependsOn references nonexistent step "${dep}"`)
            }
          }
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
