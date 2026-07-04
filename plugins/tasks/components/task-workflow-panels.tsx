'use client'

import { Button } from "@makinbakin/sdk/ui"
import { Check, X, RefreshCw } from 'lucide-react'
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
