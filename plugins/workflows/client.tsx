/**
 * Workflows plugin — client entry point
 *
 * Exports:
 * - `navItems`: sidebar entries (merged into the shell by plugin-manifest)
 * - `nodeRenderers`: React components xyflow uses to render each node
 *   kind on the canvas. Keys match the kind registered server-side:
 *   bare (`agent`, `gate`, etc.) for builtins, namespaced
 *   (`{pluginId}.{kind}`) for plugins. Aggregated by plugin-manifest.ts
 *   into the canvas's renderer registry at module-load time.
 */
import type { NodeTypes } from '@xyflow/react'
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'

import { TriggerNode } from './components/nodes/trigger-node'
import { AgentNode } from './components/nodes/agent-node'
import { GateNode } from './components/nodes/gate-node'
import { ParallelNode } from './components/nodes/parallel-node'
import { OutputNode } from './components/nodes/output-node'
import { WorkflowNode } from './components/nodes/workflow-node'
import { SubflowGroupNode } from './components/nodes/subflow-group-node'
import { WorkflowsPage } from './components/workflows-page'

export const navItems: NavItem[] = [
  { id: 'workflows', label: 'Workflows', icon: 'Workflow', href: '/workflows', order: 40 },
]

registerSlot('page:/workflows', WorkflowsPage)

export const nodeRenderers: NodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  gate: GateNode,
  parallel: ParallelNode,
  output: OutputNode,
  workflow: WorkflowNode,
  subflowGroup: SubflowGroupNode,
}
