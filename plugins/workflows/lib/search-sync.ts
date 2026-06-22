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
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import type { PluginContext } from '@bakin/core/plugin-types'
import type { WorkflowDefinition, WorkflowInstance } from '../types'
import type { DefinitionSource } from './source-registry'
import { getManagedDefinition } from './source-registry'
import { loadDefinition, listDefinitions } from './parser'
import { loadInstance } from './runtime'
import { isWorkflowDisabled } from './availability'
import { getWorkflowPluginContext } from './plugin-context'
import { getContentDir } from './content-dir'
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

/**
 * Register the file-backed `workflows` search content type: definitions
 * (yaml/yml) and instances (json) under the content dir, with the onUnlink
 * shadow-fallback, full reindex generator, and existence verifier.
 */
export function registerWorkflowSearch(ctx: PluginContext): void {
  ctx.search.registerFileBackedContentType({
    table: 'workflows',
    schema: {
      name: { type: 'text' },
      description: { type: 'text' },
      type: { type: 'keyword' },
      status: { type: 'keyword' },
      task_id: { type: 'keyword' },
      steps: { type: 'text' },
      updated_at: { type: 'datetime' },
    },
    searchableFields: ['name', 'description', 'steps'],
    rerankField: 'description',
    embeddingTemplate: '{{name}} {{description}} {{steps}}',
    facets: ['type', 'status'],
    filePatterns: [
      {
        pattern: 'workflows/definitions/*.{yaml,yml}',
        fileToId: (rel) => {
          const name = rel.replace(/^workflows\/definitions\//, '').replace(/\.(yaml|yml)$/, '')
          return `def:${name}`
        },
        fileToDoc: async (rel) => {
          const name = rel.replace(/^workflows\/definitions\//, '').replace(/\.(yaml|yml)$/, '')
          const def = loadDefinition(name)
          return def ? definitionToSearchDoc(name, def, def.source) : null
        },
      },
      {
        pattern: 'workflows/instances/*.json',
        fileToId: (rel) => {
          const taskId = rel.replace(/^workflows\/instances\//, '').replace(/\.json$/, '')
          return `inst:${taskId}`
        },
        fileToDoc: async (rel, content) => {
          try {
            const data = JSON.parse(content) as WorkflowInstance
            return instanceToSearchDoc(data)
          } catch {
            return null
          }
        },
      },
    ],
    preserveVirtualDocuments: true,
    onUnlink: async (rel) => {
      if (rel.startsWith('workflows/definitions/')) {
        const name = rel.replace(/^workflows\/definitions\//, '').replace(/\.(yaml|yml)$/, '')
        const defsDir = join(getContentDir(), 'workflows', 'definitions')
        const alternateUserPath = rel.endsWith('.yaml')
          ? join(defsDir, `${name}.yml`)
          : join(defsDir, `${name}.yaml`)

        if (existsSync(alternateUserPath)) {
          const alternateDefinition = yaml.load(readFileSync(alternateUserPath, 'utf-8')) as WorkflowDefinition
          await ctx.search.index(
            `def:${name}`,
            definitionToSearchDoc(name, { ...alternateDefinition, source: 'user' }, 'user'),
          )
          return
        }

        const fallbackEntry = getManagedDefinition(name)
        if (fallbackEntry) {
          await ctx.search.index(
            `def:${name}`,
            definitionToSearchDoc(
              name,
              { ...fallbackEntry.definition, source: fallbackEntry.source },
              fallbackEntry.source,
            ),
          )
        } else {
          await ctx.search.remove(`def:${name}`)
        }
        return
      }
      if (rel.startsWith('workflows/instances/')) {
        const taskId = rel.replace(/^workflows\/instances\//, '').replace(/\.json$/, '')
        await ctx.search.remove(`inst:${taskId}`)
      }
    },
    reindex: async function* () {
      const contentDir = getContentDir()

      // Yield effective definitions from every source: plugin defaults,
      // agent-package definitions, and user YAML shadows.
      for (const entry of listDefinitions(contentDir)) {
        yield { key: `def:${entry.name}`, doc: definitionToSearchDoc(entry.name, entry.definition, entry.source) }
      }

      // Yield instances
      const instancesDir = join(contentDir, 'workflows', 'instances')
      if (existsSync(instancesDir)) {
        for (const file of readdirSync(instancesDir).filter(f => f.endsWith('.json'))) {
          try {
            const data = JSON.parse(readFileSync(join(instancesDir, file), 'utf-8')) as WorkflowInstance
            yield { key: `inst:${data.taskId}`, doc: instanceToSearchDoc(data) }
          } catch { /* skip corrupt instances */ }
        }
      }
    },
    verifyExists: async (key: string) => {
      const contentDir = getContentDir()
      if (key.startsWith('def:')) {
        const name = key.slice(4)
        return loadDefinition(name, contentDir) !== null
      }
      if (key.startsWith('inst:')) {
        const taskId = key.slice(5)
        return existsSync(join(contentDir, 'workflows', 'instances', `${taskId}.json`))
      }
      return false
    },
  })
}
