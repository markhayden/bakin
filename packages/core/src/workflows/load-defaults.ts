/**
 * Loader for plugin-shipped workflow defaults.
 *
 * Reads every `*.yaml` / `*.yml` file under a plugin's `defaults/workflows/`
 * directory, parses it via js-yaml, validates it via `validateDefinition`, and
 * registers each definition through `ctx.registerWorkflow`. The id is derived
 * from the filename (sans extension) so the same id resolves through the source
 * registry, the loadDefinition() helper, and the existing
 * `~/.bakin/workflows/instances/` lookup path without further wiring.
 *
 * Lives in core (not the workflows plugin) because ANY plugin that ships
 * `defaults/workflows/` uses it from `activate()` — a plugin-to-plugin import
 * would cross the plugin boundary (see
 * tests/architecture/plugin-boundaries.test.ts).
 *
 * User-side YAMLs at `~/.bakin/workflows/definitions/` always win on collision
 * — that's enforced inside the source registry, not here.
 */
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import type { PluginContext } from '../plugin-types'
import type { WorkflowDefinition } from './definition-types'
import { validateDefinition } from './validate-definition'

export interface LoadDefaultsResult {
  registered: string[]
  skipped: { id: string; errors: string[] }[]
}

export function loadDefaultWorkflows(
  ctx: PluginContext,
  defaultsDir: string,
  log: { warn: (msg: string, meta?: Record<string, unknown>) => void },
): LoadDefaultsResult {
  const result: LoadDefaultsResult = { registered: [], skipped: [] }
  if (!existsSync(defaultsDir)) return result

  const files = readdirSync(defaultsDir).filter(
    (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
  )

  for (const file of files) {
    const id = file.replace(/\.(yaml|yml)$/, '')
    let definition: WorkflowDefinition
    try {
      const raw = readFileSync(join(defaultsDir, file), 'utf-8')
      definition = yaml.load(raw) as unknown as WorkflowDefinition
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.skipped.push({ id, errors: [message] })
      log.warn(`Failed to load plugin-shipped workflow "${id}"`, { error: message })
      continue
    }

    // Nested-ref EXISTENCE is deliberately not checked at load time: the
    // referenced workflow may ship in a plugin that has not activated yet
    // (#374). Structural validation and self-references stay fatal here; a
    // truly missing child is rejected by start-time validation
    // (createValidatedInstance) and surfaced by the workflow-definitions
    // health check.
    const errors = validateDefinition(definition, {
      definitionId: id,
      source: 'plugin',
      validateNestedWorkflowRefs: false,
    })
    if (errors.length > 0) {
      result.skipped.push({ id, errors })
      log.warn(`Skipping invalid plugin-shipped workflow "${id}"`, { errors })
      continue
    }
    ctx.registerWorkflow({ ...definition, id })
    result.registered.push(id)
  }

  return result
}
