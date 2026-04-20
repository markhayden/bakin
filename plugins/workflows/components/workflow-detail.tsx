'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Workflow, Lock, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { WorkflowCanvas } from './workflow-canvas'
import { StepDetailDrawer } from './step-detail-drawer'
import { collectAgents } from './workflow-card'
import { AgentAvatar } from '@/components/agent-avatar'
import type { WorkflowDefinition, WorkflowStep, ParallelStep, NestedWorkflowStep } from '../types'

/** Find a step by ID in the step tree (top-level, parallel children, sub-workflow expansions) */
function findStepById(
  steps: WorkflowStep[],
  nodeId: string,
  subWorkflows?: Record<string, WorkflowDefinition>,
): WorkflowStep | null {
  for (const step of steps) {
    if (step.id === nodeId) return step

    // Check parallel children
    if (step.type === 'parallel') {
      const parallel = step as ParallelStep
      for (const child of parallel.steps) {
        if (child.id === nodeId) return child
      }
    }

    // Check sub-workflow steps (node IDs are prefixed: parentId__childId)
    if (step.type === 'workflow' && subWorkflows) {
      const nested = step as NestedWorkflowStep
      const subDef = subWorkflows[nested.workflow_id]
      if (subDef) {
        // Try stripping the prefix and searching recursively
        const prefix = step.id + '__'
        if (nodeId.startsWith(prefix)) {
          const childId = nodeId.slice(prefix.length)
          const found = findStepById(subDef.steps, childId, subWorkflows)
          if (found) return found
        }
        // Also try direct match in sub-workflow
        const found = findStepById(subDef.steps, nodeId, subWorkflows)
        if (found) return found
      }
    }
  }
  return null
}

/** Recursively search for a step across the full node ID space (handles deeply nested prefixes) */
function findStepByNodeId(
  definition: WorkflowDefinition,
  nodeId: string,
  subWorkflows?: Record<string, WorkflowDefinition>,
): WorkflowStep | null {
  // Direct match first
  const direct = findStepById(definition.steps, nodeId, subWorkflows)
  if (direct) return direct

  // Try stripping nested prefixes progressively
  const parts = nodeId.split('__')
  for (let i = 1; i < parts.length; i++) {
    const suffix = parts.slice(i).join('__')
    const found = findStepById(definition.steps, suffix, subWorkflows)
    if (found) return found
  }

  return null
}

interface WorkflowDetailProps {
  workflowId: string
  onBack: () => void
}

export function WorkflowDetail({ workflowId, onBack }: WorkflowDetailProps) {
  const router = useRouter()
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [subWorkflows, setSubWorkflows] = useState<Record<string, WorkflowDefinition>>({})
  const [source, setSource] = useState<'plugin' | 'user' | undefined>()
  const [pluginId, setPluginId] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    async function fetchDefinition() {
      try {
        const res = await fetch(`/api/plugins/workflows/definitions/${workflowId}`)
        if (!res.ok) {
          setError(res.status === 404 ? 'Workflow not found' : 'Failed to load workflow')
          return
        }
        const data = await res.json()
        setDefinition(data.definition)
        setSubWorkflows(data.subWorkflows ?? {})
        setSource(data.source)
        setPluginId(data.pluginId)
      } catch {
        setError('Failed to load workflow')
      } finally {
        setLoading(false)
      }
    }
    fetchDefinition()
  }, [workflowId])

  const handleNodeClick = useCallback((nodeId: string) => {
    if (!definition) return
    // Skip trigger and subflow group nodes
    if (nodeId === '__trigger' || nodeId.endsWith('__trigger')) return

    const step = findStepByNodeId(definition, nodeId, subWorkflows)
    if (step) {
      setSelectedStep(step)
      setDrawerOpen(true)
    }
  }, [definition, subWorkflows])

  if (loading) {
    return (
      <div className="flex h-full flex-col animate-pulse">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div className="h-4 w-4 rounded bg-zinc-800" />
          <div className="h-5 w-48 rounded bg-zinc-800" />
        </div>
        <div className="flex-1 bg-zinc-950" />
      </div>
    )
  }

  if (error || !definition) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{error || 'Workflow not found'}</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" /> Back to Workflows
        </Button>
      </div>
    )
  }

  const agentIds = collectAgents(definition.steps)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="size-8">
          <ArrowLeft className="size-4" />
        </Button>
        <Workflow className="size-4 text-amber-400" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-medium truncate">{definition.name}</h1>
          {definition.description && (
            <p className="text-xs text-muted-foreground truncate">{definition.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/workflows/${workflowId}/edit`)}
            title={source === 'plugin' ? 'Edit a copy of this workflow' : 'Edit workflow'}
          >
            <Pencil className="size-3.5 mr-1" />
            {source === 'plugin' ? 'Customize' : 'Edit'}
          </Button>
          <Badge variant="secondary" className="text-[10px]">
            {definition.steps.length} steps
          </Badge>
          {agentIds.length > 0 && (
            <div className="flex -space-x-1.5">
              {agentIds.slice(0, 5).map(id => (
                <AgentAvatar key={id} agentId={id} size="xs" />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Read-only banner — plugin-shipped definitions cannot be edited in place */}
      {source === 'plugin' && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-6 py-2 text-xs text-amber-200">
          <Lock className="size-3.5" />
          <span>
            Read-only: this workflow ships with the
            {pluginId ? ` "${pluginId}"` : ''} plugin. Save a copy under
            <code className="px-1 mx-1 rounded bg-black/30 font-mono text-[11px]">~/.bakin/workflows/definitions/{workflowId}.yaml</code>
            to override it locally.
          </span>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <WorkflowCanvas
          definition={definition}
          subWorkflows={subWorkflows}
          onNodeClick={handleNodeClick}
        />
      </div>

      {/* Step detail drawer */}
      <StepDetailDrawer
        step={selectedStep}
        allSteps={definition.steps}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  )
}
