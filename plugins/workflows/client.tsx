/**
 * Workflows plugin — client entry point
 *
 * - `registerPlugin` contributes page slots. Nav is declared in
 *   bakin-plugin.json `contributes.nav`; slots are mirrored in
 *   `contributes.slots` so the host lazy-loads this client (the heaviest
 *   core bundle — xyflow) on first render of a workflows page.
 * - `registerNodeRenderer` wires each xyflow node kind to its visual
 *   component. Kinds are globally unique — built-ins use their bare name
 *   (`agent`, `gate`, `parallel`, `output`, `workflow`, `createTask`, `trigger`,
 *   `subflowGroup`); plugin-owned kinds arrive pre-namespaced as
 *   `{pluginId}.{kind}`.
 */
import { registerPlugin, registerPluginCleanup } from '@makinbakin/sdk'

import { TriggerNode } from './components/nodes/trigger-node'
import { AgentNode } from './components/nodes/agent-node'
import { GateNode } from './components/nodes/gate-node'
import { ParallelNode } from './components/nodes/parallel-node'
import { OutputNode } from './components/nodes/output-node'
import { WorkflowNode } from './components/nodes/workflow-node'
import { MapWorkflowNode } from './components/nodes/map-workflow-node'
import { CreateTaskNode } from './components/nodes/create-task-node'
import { SubflowGroupNode } from './components/nodes/subflow-group-node'
import { WorkflowsPage } from './components/workflows-page'
import { ApprovalsBadgeProvider } from './components/approvals-badge-provider'
import { WorkflowDetail } from './components/workflow-detail'
import { WorkflowCanvasEditor } from './components/workflow-canvas-editor'
import {
  registerNodeRenderer,
  unregisterNodeRenderer,
  listNodeRendererKinds,
} from './lib/node-renderer-registry'
import { unregisterPluginDefinitions } from '@bakin/core/workflows/source-registry'

registerPlugin({
  search: {
    hitRenderers: {
      workflows: (hit) => {
        const isInstance = hit.id.startsWith('inst:')
        const bare = hit.id.replace(/^(def|inst):/, '')
        return {
          title: String(hit.fields.name ?? hit.fields.title ?? bare),
          subtitle: isInstance ? 'workflow run' : 'workflow',
          href: isInstance ? `/tasks?taskId=${encodeURIComponent(bare)}` : `/workflows/${encodeURIComponent(bare)}`,
          icon: 'workflow',
        }
      },
    },
  },
  id: 'workflows',
  slots: {
    'nav-badge-providers': ApprovalsBadgeProvider,
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
registerNodeRenderer('map_workflow', MapWorkflowNode)
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
