/**
 * YAML workflow definition parser.
 * Uses js-yaml for reliable parsing with definition validation.
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import type { WorkflowDefinition, WorkflowStep, ParallelStep, NestedWorkflowStep } from '../types'
import { getContentDir } from './content-dir'

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
        // Check that referenced workflow exists
        const defsDir = join(getContentDir(), 'workflows', 'definitions')
        const nestedPath = join(defsDir, `${nested.workflow_id}.yaml`)
        if (!existsSync(nestedPath)) {
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
 * Load a workflow definition by name.
 */
export function loadDefinition(name: string, contentDir?: string): WorkflowDefinition | null {
  const defsDir = getDefinitionsDir(contentDir)
  const filePath = join(defsDir, `${name}.yaml`)
  if (!existsSync(filePath)) return null

  const content = readFileSync(filePath, 'utf-8')
  const parsed = parseYAML(content) as unknown as WorkflowDefinition
  return parsed
}

/**
 * List all available workflow definitions.
 */
export function listDefinitions(contentDir?: string): { name: string; definition: WorkflowDefinition }[] {
  const defsDir = getDefinitionsDir(contentDir)
  if (!existsSync(defsDir)) return []

  return readdirSync(defsDir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const name = f.replace('.yaml', '')
      const definition = loadDefinition(name, contentDir)
      return definition ? { name, definition } : null
    })
    .filter((d): d is { name: string; definition: WorkflowDefinition } => d !== null)
}
