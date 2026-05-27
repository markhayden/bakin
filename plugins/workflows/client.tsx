/**
 * Workflows plugin — client entry point
 *
 * - `registerPlugin` contributes nav items and page slots.
 * - `registerNodeRenderer` wires each xyflow node kind to its visual
 *   component. Kinds are globally unique — built-ins use their bare name
 *   (`agent`, `gate`, `parallel`, `output`, `workflow`, `createTask`, `trigger`,
 *   `subflowGroup`); plugin-owned kinds arrive pre-namespaced as
 *   `{pluginId}.{kind}`.
 */
import { registerPlugin, registerPluginCleanup } from '@makinbakin/sdk'
import type { NavItem } from '@makinbakin/sdk'

import { TriggerNode } from './components/nodes/trigger-node'
import { AgentNode } from './components/nodes/agent-node'
import { GateNode } from './components/nodes/gate-node'
import { ParallelNode } from './components/nodes/parallel-node'
import { OutputNode } from './components/nodes/output-node'
import { WorkflowNode } from './components/nodes/workflow-node'
import { CreateTaskNode } from './components/nodes/create-task-node'
import { SubflowGroupNode } from './components/nodes/subflow-group-node'
import { WorkflowsPage } from './components/workflows-page'
import { WorkflowDetail } from './components/workflow-detail'
import { WorkflowCanvasEditor } from './components/workflow-canvas-editor'
import {
  registerNodeRenderer,
  unregisterNodeRenderer,
  listNodeRendererKinds,
} from './lib/node-renderer-registry'
import { unregisterPluginDefinitions } from './lib/source-registry'

const navItems: NavItem[] = [
  { id: 'workflows', label: 'Workflows', icon: 'Workflow', href: '/workflows', order: 40 },
]

registerPlugin({
  id: 'workflows',
  navItems,
  slots: {
    'page:/workflows': WorkflowsPage,
    'page:/workflows/[id]': WorkflowDetail,
    // WorkflowCanvasEditor handles both /new and /[id]/edit — the wrapper
    // passes mode='create' or 'edit' and the appropriate initialDefinition.
    'page:/workflows/new': WorkflowCanvasEditor,
    'page:/workflows/[id]/edit': WorkflowCanvasEditor,
  },
})

registerNodeRenderer('trigger', TriggerNode)
registerNodeRenderer('agent', AgentNode)
registerNodeRenderer('gate', GateNode)
registerNodeRenderer('parallel', ParallelNode)
registerNodeRenderer('output', OutputNode)
registerNodeRenderer('workflow', WorkflowNode)
registerNodeRenderer('createTask', CreateTaskNode)
registerNodeRenderer('subflowGroup', SubflowGroupNode)

// v2 dev hot-swap teardown: the SDK's unregisterPlugin clears nav + slots,
// but the node-renderer + workflow-source registries are plugin-local and
// need their own sweep. Today workflows is the only plugin registering
// into either, so clearing every entry here is safe.
registerPluginCleanup('workflows', () => {
  for (const kind of listNodeRendererKinds()) {
    unregisterNodeRenderer(kind)
  }
  unregisterPluginDefinitions('workflows')
})
