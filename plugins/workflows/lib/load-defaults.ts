/**
 * Loader for plugin-shipped workflow defaults.
 *
 * Reads every `*.yaml` / `*.yml` file under `plugins/workflows/defaults/workflows/`,
 * parses it via `parseYAML`, validates it via `validateDefinition`, and registers
 * each definition through `ctx.registerWorkflow`. The id is derived from the
 * filename (sans extension) so the same id resolves through the source registry,
 * the loadDefinition() helper, and the existing `~/.bakin/workflows/instances/`
 * lookup path without further wiring.
 *
 * User-side YAMLs at `~/.bakin/workflows/definitions/` always win on collision
 * — that's enforced inside the source registry, not here.
 */
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { PluginContext } from '@bakin/core/plugin-types'
import { parseYAML, validateDefinition } from './parser'
import type { WorkflowDefinition } from '../types'

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

  const parsedFiles: Array<{ id: string; definition: WorkflowDefinition }> = []
  for (const file of files) {
    const id = file.replace(/\.(yaml|yml)$/, '')
    try {
      const raw = readFileSync(join(defaultsDir, file), 'utf-8')
      const parsed = parseYAML(raw) as unknown as WorkflowDefinition
      parsedFiles.push({ id, definition: parsed })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.skipped.push({ id, errors: [message] })
      log.warn(`Failed to load plugin-shipped workflow "${id}"`, { error: message })
    }
  }

  const knownWorkflowIds = new Set(parsedFiles.map((entry) => entry.id))
  for (const { id, definition } of parsedFiles) {
    const errors = validateDefinition(definition, {
      definitionId: id,
      source: 'plugin',
      knownWorkflowIds,
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
