'use client'

import { Button } from "@makinbakin/sdk/ui"
import { Check, X, RefreshCw, AlertTriangle } from 'lucide-react'
import { StepOutputViewer } from './step-output-viewer'
import type { TaskDetail } from './use-task-detail'

const STEP_DOT_COLORS: Record<string, string> = {
  complete: 'bg-green-400',
  in_progress: 'bg-blue-400',
  pending_approval: 'bg-amber-400 animate-pulse',
  rejected: 'bg-red-400',
  pending: 'bg-zinc-600',
  failed: 'bg-red-600',
}

/** Read-only workflow step progress row (detail + edit views). */
export function WorkflowProgressPanel({ m }: { m: TaskDetail }) {
  const { activeWorkflowId, wfDefinition, wfInstance } = m
  if (!activeWorkflowId || !wfDefinition) return null
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider">Workflow</h3>
        <span className="text-[11px] font-medium text-muted-foreground bg-muted/50 border border-border rounded-full px-2.5 py-0.5">{activeWorkflowId}</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap rounded-lg bg-surface p-3">
        {wfDefinition.steps.map((step, i) => {
          const state = wfInstance?.stepStates[step.id]
          const status = state?.status || 'pending'
          const dotColor = STEP_DOT_COLORS[status] || STEP_DOT_COLORS.pending
          const isGate = step.type === 'gate'
          return (
            <div key={step.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                {i > 0 && <span className="text-zinc-600 text-[10px]">&rarr;</span>}
                <div className="flex items-center gap-1 group relative">
                  <span className={`size-2 rounded-full ${dotColor} shrink-0`} />
                  <span className={`text-[10px] ${status === 'pending_approval' ? 'text-amber-400 font-semibold' : 'text-zinc-500'}`}>
                    {isGate ? '⏳' : ''}{step.label || step.id}
                  </span>
                </div>
              </div>
              {state?.childTaskId && status === 'in_progress' && (
                <span className="text-[10px] text-cyan-400 ml-3">
                  ↳ sub-task #{state.childTaskId.split('--').pop()?.slice(0, 8) || state.childTaskId.slice(0, 6)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const CHILD_STATUS_COLORS: Record<string, string> = {
  complete: 'text-green-400',
  in_progress: 'text-blue-400',
  pending_approval: 'text-amber-400',
  failed: 'text-red-400',
  cancelled: 'text-zinc-500',
  missing: 'text-red-400',
}

/**
 * Map fan-out children panel: live rollup + per-child retry/cancel for the
 * active map_workflow step, and a typed-failure banner (map_source_invalid)
 * with a re-run-source affordance for failed instances.
 */
export function MapChildrenPanel({ m }: { m: TaskDetail }) {
  const { wfInstance, wfDefinition, mapStepId, mapChildren, mapActionLoading, handleMapChildAction, failedStep, handleReopenWorkflow } = m

  // Typed-failure banner (the source step is the recovery unit).
  if (failedStep?.code === 'map_source_invalid') {
    const failedDefStep = wfDefinition?.steps.find(s => s.id === failedStep.stepId)
    const sourceStepId = (failedDefStep as { source?: string } | undefined)?.source?.split('.')[0]
    return (
      <div className="rounded-lg border-2 border-red-500/30 bg-red-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-red-400" />
          <h3 className="text-sm font-semibold text-red-400">Fan-out failed</h3>
          <span className="text-[10px] font-mono text-red-400/70 bg-red-500/10 rounded px-1.5 py-0.5">map_source_invalid</span>
        </div>
        {failedStep.error && <p className="text-xs text-zinc-400">{failedStep.error}</p>}
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={mapActionLoading || !sourceStepId}
            onClick={() => handleReopenWorkflow(sourceStepId)}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            <RefreshCw className="size-3 mr-1" />
            Re-run source step
          </Button>
        </div>
      </div>
    )
  }

  if (!wfInstance || !mapStepId) return null
  const entries = wfInstance.stepStates[mapStepId]?.children
  if (!entries || entries.length === 0) return null

  const mapStepLabel = wfDefinition?.steps.find(s => s.id === mapStepId)?.label || mapStepId
  // Live statuses win over cached entries when available.
  const liveByIndex = new Map(mapChildren.map(c => [c.index, c.liveStatus]))
  const rows = entries.map(e => ({ ...e, status: liveByIndex.get(e.index) ?? e.status }))
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})
  const rollup = [
    `${counts.complete || 0}/${rows.length} complete`,
    counts.failed ? `${counts.failed} failed` : null,
    counts.cancelled ? `${counts.cancelled} cancelled` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] text-violet-400 uppercase tracking-wider font-semibold">{mapStepLabel}</h3>
        <span className="text-[11px] text-muted-foreground">{rollup}</span>
      </div>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.childTaskId} className="flex items-center gap-2 text-xs">
            <span className={`font-mono ${CHILD_STATUS_COLORS[row.status] || 'text-zinc-500'}`}>
              {row.index + 1}/{rows.length}
            </span>
            <span className="font-mono text-[10px] text-zinc-500 truncate flex-1">
              {row.childTaskId}
            </span>
            <span className={`text-[10px] ${CHILD_STATUS_COLORS[row.status] || 'text-zinc-500'}`}>
              {row.status}
            </span>
            {row.status !== 'complete' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[10px] text-blue-400 hover:text-blue-300"
                disabled={mapActionLoading}
                onClick={() => handleMapChildAction('retry', row.index)}
              >
                <RefreshCw className="size-2.5 mr-0.5" /> Retry
              </Button>
            )}
            {(row.status === 'in_progress' || row.status === 'pending_approval') && (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[10px] text-red-400 hover:text-red-300"
                disabled={mapActionLoading}
                onClick={() => handleMapChildAction('cancel', row.index)}
              >
                <X className="size-2.5 mr-0.5" /> Cancel
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Approval-gate action panel (detail + edit views), including prior-step output. */
export function GateApprovalPanel({ m }: { m: TaskDetail }) {
  const {
    isGatePending, gateStep, outputLoading, outputUnavailable, priorStepOutput, fetchPriorOutput,
    showRejectInput, setShowRejectInput, rejectReason, setRejectReason, gateLoading,
    handleRejectGate, handleApproveGate,
  } = m
  if (!isGatePending || !gateStep) return null
  return (
    <div className="rounded-lg border-2 border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
        <h3 className="text-sm font-semibold text-amber-400">
          Approval Gate: {gateStep.label || gateStep.id}
        </h3>
      </div>

      {outputLoading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <RefreshCw className="size-3 animate-spin" />
          Loading step output...
        </div>
      )}

      {outputUnavailable && !priorStepOutput && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Step output unavailable</span>
          <button
            onClick={() => fetchPriorOutput()}
            className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            <RefreshCw className="size-2.5" /> Retry
          </button>
        </div>
      )}

      {priorStepOutput && (
        <div>
          <p className="text-[11px] text-zinc-400 uppercase tracking-wider mb-1.5">Prior Step Output</p>
          <StepOutputViewer output={priorStepOutput} />
        </div>
      )}

      {showRejectInput ? (
        <div className="space-y-2">
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Describe what needs to change..."
            rows={3}
            className="w-full rounded-md border border-red-500/30 bg-background px-3 py-2 text-sm text-foreground"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowRejectInput(false); setRejectReason('') }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRejectGate}
              disabled={gateLoading || !rejectReason.trim()}
            >
              <X className="size-3 mr-1" />
              {gateLoading ? 'Rejecting...' : 'Reject'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRejectInput(true)}
            disabled={gateLoading}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            <X className="size-3 mr-1" />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={handleApproveGate}
            disabled={gateLoading}
          >
            <Check className="size-3 mr-1" />
            {gateLoading ? 'Approving...' : 'Approve'}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Edit-mode inline preview of the selected workflow's steps. */
export function WorkflowPreview({ m }: { m: TaskDetail }) {
  const { workflowId, wfDefinition, wfInstance, workflows } = m
  if (!workflowId || !wfDefinition) return null
  return (
    <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground bg-muted/50 border border-border rounded-full px-2.5 py-0.5">{wfDefinition.name || workflowId}</span>
        <span className="text-[11px] text-muted-foreground">{wfDefinition.steps.length} steps</span>
      </div>
      {(() => {
        const desc = workflows.find(w => w.filename.replace('.yaml', '') === workflowId)?.description
        return desc ? <p className="text-xs text-muted-foreground">{desc}</p> : null
      })()}
      <div className="flex items-center gap-1 flex-wrap">
        {wfDefinition.steps.map((step, i) => {
          const state = wfInstance?.stepStates[step.id]
          const status = state?.status || 'pending'
          const dotColor = STEP_DOT_COLORS[status] || STEP_DOT_COLORS.pending
          const isGate = step.type === 'gate'
          return (
            <div key={step.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-zinc-600 text-[10px]">&rarr;</span>}
              <span className={`size-2 rounded-full ${dotColor} shrink-0`} />
              <span className={`text-[10px] ${status === 'pending_approval' ? 'text-amber-400 font-semibold' : 'text-zinc-500'}`}>
                {isGate ? '⏳' : ''}{step.label || step.id}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
