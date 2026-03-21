/**
 * Workflows plugin — template/recipe library
 */
import type { MCPlugin, PluginContext } from '../../src/lib/plugin-types'
import { listDefinitions, loadDefinition } from './parser'
import type { WorkflowTemplate } from './types'

function countSteps(steps: { type: string; steps?: unknown[] }[]): number {
  let count = 0
  for (const step of steps) {
    if (step.type === 'parallel' && Array.isArray(step.steps)) {
      count += step.steps.length
    } else {
      count++
    }
  }
  return count
}

const workflowsPlugin: MCPlugin = {
  id: 'workflows',
  name: 'Workflows',
  version: '1.0.0',

  navItems: [
    { id: 'workflows', label: 'Workflows', icon: 'Zap', href: '/workflows', order: 15 },
  ],

  contentFiles: [],

  activate(ctx: PluginContext) {
    // GET /api/plugins/workflows/list — list all workflow templates
    ctx.registerRoute({
      path: '/list',
      method: 'GET',
      handler: async () => {
        const defs = listDefinitions()
        const templates: WorkflowTemplate[] = defs.map(d => ({
          name: d.definition.name,
          filename: d.name,
          description: d.definition.description,
          stepCount: countSteps(d.definition.steps),
          definition: d.definition,
        }))
        return Response.json({ templates })
      },
    })

    // GET /api/plugins/workflows/definition?name=<filename> — get a specific definition
    ctx.registerRoute({
      path: '/definition',
      method: 'GET',
      handler: async (req) => {
        const url = new URL(req.url)
        const name = url.searchParams.get('name')

        if (!name) {
          return Response.json({ error: 'name query param required' }, { status: 400 })
        }

        const definition = loadDefinition(name)
        if (!definition) {
          return Response.json({ error: 'Definition not found' }, { status: 404 })
        }

        return Response.json({ definition })
      },
    })
  },
}

export default workflowsPlugin
