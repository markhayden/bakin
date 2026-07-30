'use client'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  DrawerSection,
  Button,
  Field,
  FieldControl,
  FieldLabel,
  Textarea,
} from '@makinbakin/sdk/ui'
import { StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import { AlertTriangle, Check, Hourglass, RefreshCw, X } from 'lucide-react'
import { StepOutputViewer } from './step-output-viewer'
import type { TaskDetail } from './use-task-detail'

const STEP_TONE: Record<string, StatusTone> = {
  complete: 'success',
  in_progress: 'accent',
  pending_approval: 'attention',
  rejected: 'danger',
  pending: 'neutral',
  failed: 'danger',
  cancelled: 'neutral',
  missing: 'danger',
}

function statusTone(status: string): StatusTone {
  return STEP_TONE[status] ?? 'neutral'
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function WorkflowStepList({
  definition,
  instance,
}: {
  definition: NonNullable<TaskDetail['wfDefinition']>
  instance: TaskDetail['wfInstance']
}) {
  return (
    <ol
      data-workflow-step-list=""
      data-orientation="vertical"
      className="m-0 list-none divide-y divide-bakin-border-subtle rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default px-bakin-3"
    >
      {definition.steps.map((step, index) => {
        const state = instance?.stepStates[step.id]
        const status = state?.status || 'pending'
        const isGate = step.type === 'gate'
        return (
          <li key={step.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-bakin-3 py-bakin-3">
            <span
              aria-hidden="true"
              className="grid size-bakin-6 place-items-center rounded-bakin-pill border border-bakin-border-subtle bg-bakin-canvas-default font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
                <span className="font-bakin-typography-weight-semibold text-bakin-text-primary">
                  {step.label || step.id}
                </span>
                <StatusBadge tone={statusTone(status)} variant={status === 'pending' ? 'outline' : 'solid'} size="xs">
                  {statusLabel(status)}
                </StatusBadge>
              </div>
              <div className="mt-bakin-1 flex min-w-0 flex-wrap items-center gap-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">
                {isGate ? (
                  <span className="inline-flex items-center gap-bakin-1">
                    <Hourglass aria-hidden="true" className="size-bakin-3" />
                    Approval gate
                  </span>
                ) : (
                  <span>{statusLabel(step.type)}</span>
                )}
                {state?.childTaskId && status === 'in_progress' ? (
                  <span className="break-all font-bakin-typography-family-mono">
                    Sub-task {state.childTaskId.split('--').pop()?.slice(0, 8) || state.childTaskId.slice(0, 6)}
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Read-only vertical workflow progress for detail and edit views. */
export function WorkflowProgressPanel({ m }: { m: TaskDetail }) {
  const { activeWorkflowId, wfDefinition, wfInstance } = m
  if (!activeWorkflowId || !wfDefinition) return null
  return (
    <DrawerSection
      title="Workflow"
      actions={(
        <span className="max-w-48 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
          {activeWorkflowId}
        </span>
      )}
    >
      <WorkflowStepList definition={wfDefinition} instance={wfInstance} />
    </DrawerSection>
  )
}

/**
 * Map fan-out children: live rollup plus retry/cancel controls, or a typed
 * recovery alert when the source output cannot be mapped.
 */
export function MapChildrenPanel({ m }: { m: TaskDetail }) {
  const {
    wfInstance,
    wfDefinition,
    mapStepId,
    mapChildren,
    mapActionLoading,
    handleMapChildAction,
    failedStep,
    handleReopenWorkflow,
  } = m

  if (failedStep?.code === 'map_source_invalid') {
    const failedDefStep = wfDefinition?.steps.find(step => step.id === failedStep.stepId)
    const sourceStepId = (failedDefStep as { source?: string } | undefined)?.source?.split('.')[0]
    return (
      <Alert tone="danger">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>
          Fan-out failed
          <code className="ms-bakin-2 font-bakin-typography-family-mono text-bakin-typography-size-meta font-bakin-typography-weight-regular">
            map_source_invalid
          </code>
        </AlertTitle>
        <AlertDescription>
          {failedStep.error ? <p>{failedStep.error}</p> : null}
          <div className="mt-bakin-3 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={mapActionLoading || !sourceStepId}
              onClick={() => {
                if (sourceStepId) void handleReopenWorkflow(sourceStepId)
              }}
            >
              <RefreshCw aria-hidden="true" />
              Re-run source step
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (!wfInstance || !mapStepId) return null
  const entries = wfInstance.stepStates[mapStepId]?.children
  if (!entries || entries.length === 0) return null

  const mapStepLabel = wfDefinition?.steps.find(step => step.id === mapStepId)?.label || mapStepId
  const liveByIndex = new Map(mapChildren.map(child => [child.index, child.liveStatus]))
  const rows = entries.map(entry => ({ ...entry, status: liveByIndex.get(entry.index) ?? entry.status }))
  const counts = rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.status] = (accumulator[row.status] || 0) + 1
    return accumulator
  }, {})
  const rollup = [
    `${counts.complete || 0}/${rows.length} complete`,
    counts.failed ? `${counts.failed} failed` : null,
    counts.cancelled ? `${counts.cancelled} cancelled` : null,
  ].filter(Boolean).join(' · ')

  return (
    <DrawerSection
      title={mapStepLabel}
      actions={<span className="text-bakin-typography-size-meta text-bakin-text-muted">{rollup}</span>}
    >
      <ul className="m-0 list-none divide-y divide-bakin-border-subtle p-0">
        {rows.map((row) => (
          <li key={row.childTaskId} className="grid min-w-0 gap-bakin-2 py-bakin-3 first:pt-0">
            <div className="flex min-w-0 items-center gap-bakin-2">
              <span className="shrink-0 font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                {row.index + 1}/{rows.length}
              </span>
              <code className="min-w-0 flex-1 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                {row.childTaskId}
              </code>
              <StatusBadge tone={statusTone(row.status)} size="xs">{statusLabel(row.status)}</StatusBadge>
            </div>
            {row.status !== 'complete' ? (
              <div className="flex flex-wrap justify-end gap-bakin-2">
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  disabled={mapActionLoading}
                  onClick={() => { void handleMapChildAction('retry', row.index) }}
                >
                  <RefreshCw aria-hidden="true" /> Retry
                </Button>
                {row.status === 'in_progress' || row.status === 'pending_approval' ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="danger"
                    disabled={mapActionLoading}
                    onClick={() => { void handleMapChildAction('cancel', row.index) }}
                  >
                    <X aria-hidden="true" /> Cancel
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </DrawerSection>
  )
}

/** Approval-gate decision panel, including the prior step's normalized output. */
export function GateApprovalPanel({ m }: { m: TaskDetail }) {
  const {
    isGatePending,
    gateStep,
    outputLoading,
    outputUnavailable,
    priorStepOutput,
    fetchPriorOutput,
    showRejectInput,
    setShowRejectInput,
    rejectReason,
    setRejectReason,
    gateLoading,
    handleRejectGate,
    handleApproveGate,
  } = m
  if (!isGatePending || !gateStep) return null

  return (
    <Alert tone="attention">
      <Hourglass aria-hidden="true" />
      <AlertTitle>Approval required: {gateStep.label || gateStep.id}</AlertTitle>
      <AlertDescription>
        {outputLoading ? (
          <p role="status" className="inline-flex items-center gap-bakin-2">
            <RefreshCw aria-hidden="true" className="size-bakin-3 animate-spin motion-reduce:animate-none" />
            Loading step output…
          </p>
        ) : null}

        {outputUnavailable && !priorStepOutput ? (
          <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
            <span>Step output unavailable.</span>
            <Button type="button" variant="link" size="xs" onClick={() => { void fetchPriorOutput() }}>
              <RefreshCw aria-hidden="true" /> Retry
            </Button>
          </div>
        ) : null}

        {priorStepOutput ? (
          <section aria-label="Prior step output" className="mt-bakin-3 grid min-w-0 gap-bakin-2">
            <h4 className="m-0 text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wider text-bakin-text-muted">
              Prior step output
            </h4>
            <StepOutputViewer output={priorStepOutput} />
          </section>
        ) : null}

        {showRejectInput ? (
          <div className="mt-bakin-3 grid min-w-0 gap-bakin-3">
            <Field name="rejectReason">
              <FieldLabel requirement="required">Rejection reason</FieldLabel>
              <FieldControl
                render={(
                  <Textarea
                    value={rejectReason}
                    onChange={event => setRejectReason(event.target.value)}
                    placeholder="Describe what needs to change…"
                    rows={3}
                    autoFocus
                  />
                )}
              />
            </Field>
            <div className="flex flex-wrap justify-end gap-bakin-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowRejectInput(false)
                  setRejectReason('')
                }}
                disabled={gateLoading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => { void handleRejectGate() }}
                disabled={gateLoading || !rejectReason.trim()}
              >
                <X aria-hidden="true" />
                {gateLoading ? 'Rejecting…' : 'Reject'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-bakin-3 flex flex-wrap justify-end gap-bakin-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => setShowRejectInput(true)}
              disabled={gateLoading}
            >
              <X aria-hidden="true" /> Reject
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => { void handleApproveGate() }}
              disabled={gateLoading}
            >
              <Check aria-hidden="true" />
              {gateLoading ? 'Approving…' : 'Approve'}
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}

/** Edit-mode preview of the selected workflow using the same vertical language. */
export function WorkflowPreview({ m }: { m: TaskDetail }) {
  const { workflowId, wfDefinition, wfInstance, workflows } = m
  if (!workflowId || !wfDefinition) return null
  const description = workflows.find(workflow => workflow.filename.replace('.yaml', '') === workflowId)?.description

  return (
    <DrawerSection
      title="Workflow preview"
      actions={(
        <span className="text-bakin-typography-size-meta text-bakin-text-muted">
          {wfDefinition.steps.length} steps
        </span>
      )}
    >
      <div className="grid min-w-0 gap-bakin-3">
        {description ? (
          <p className="m-0 text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">{description}</p>
        ) : null}
        <WorkflowStepList definition={wfDefinition} instance={wfInstance} />
      </div>
    </DrawerSection>
  )
}
