/**
 * Client-side static plugin manifest.
 * No dynamic imports — adding a plugin = adding one import line here.
 *
 * Also aggregates each plugin's optional `nodeRenderers` export into the
 * workflows canvas's renderer registry at module-load time. A plugin that
 * wants to render custom workflow nodes exports `nodeRenderers: NodeTypes`
 * from its `client.tsx` (keys must match the namespaced kind returned by
 * `ctx.registerNodeType`). Plugins that don't ship custom kinds simply
 * omit the export — nothing else is required.
 */
import { navItems as taskNav } from '../../plugins/tasks/client'
import { navItems as memoryNav } from '../../plugins/memory/client'
import { navItems as workflowsNav, nodeRenderers as workflowsNodeRenderers } from '../../plugins/workflows/client'
import { navItems as modelsNav } from '../../plugins/models/client'
import { navItems as messagingNav } from '../../plugins/messaging/client'
import { navItems as assetsNav } from '../../plugins/assets/client'
import { navItems as scheduleNav } from '../../plugins/schedule/client'
import { navItems as healthNav } from '../../plugins/health/client'
import { navItems as projectsNav } from '../../plugins/projects/client'
import { navItems as teamNav } from '../../plugins/team/client'
import type { NodeTypes } from '@xyflow/react'
import { registerNodeRenderer } from '../../plugins/workflows/lib/node-renderer-registry'
import type { NavItem } from './plugin-types'

export const allNavItems: NavItem[] = [
  ...teamNav,
  ...taskNav,
  ...memoryNav,
  ...modelsNav,
  ...messagingNav,
  ...workflowsNav,
  ...assetsNav,
  ...scheduleNav,
  ...healthNav,
  ...projectsNav,
].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))

/**
 * Register every plugin's node renderers. Add a line here when a new
 * plugin starts shipping workflow node kinds — the `nodeRenderers` export
 * is optional, so plugins that don't define one never show up here.
 */
const allNodeRenderers: NodeTypes[] = [
  workflowsNodeRenderers,
]

for (const bundle of allNodeRenderers) {
  for (const [kind, component] of Object.entries(bundle)) {
    registerNodeRenderer(kind, component)
  }
}
