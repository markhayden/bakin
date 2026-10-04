'use client'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DrawerSection,
  Text,
} from '@makinbakin/sdk/ui'
import { ListRow, ListRowActions, ListRows, StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import { TriangleAlert, Hourglass, RefreshCw, X } from 'lucide-react'
import { ApprovalPanel } from './approval-panel'
import type { TaskDetail } from './use-task-detail'
import { Inline } from '@makinbakin/sdk/layout'

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
    <ListRows
      variant="separated"
      aria-label="Workflow steps"
      data-workflow-step-list=""
      data-orientation="vertical"
    >
      {definition.steps.map((step, index) => {
        const state = instance?.stepStates[step.id]
        const status = state?.status || 'pending'
        const isGate = step.type === 'gate'
        return (
          <ListRow key={step.id} className="flex min-w-0 items-start gap-bakin-3">
            {/* A step number is a position marker, not an identity — Badge, not Avatar. */}
            <Badge aria-hidden="true" tone="neutral" variant="outline" size="sm" className="font-bakin-typography-family-mono">
              {index + 1}
            </Badge>
            <div className="min-w-0 flex-1">
              <Inline gap="dense">
                <span className="font-bakin-typography-weight-semibold text-bakin-text-primary">
                  {step.label || step.id}
                </span>
                <StatusBadge tone={statusTone(status)} variant={status === 'pending' ? 'outline' : 'solid'} size="xs">
                  {statusLabel(status)}
                </StatusBadge>
              </Inline>
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
          </ListRow>
        )
      })}
    </ListRows>
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
        <Text size="meta" tone="muted" mono className="max-w-48 truncate">
          {activeWorkflowId}
        </Text>
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
        <TriangleAlert aria-hidden="true" />
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
      actions={<Text size="meta" tone="muted">{rollup}</Text>}
    >
      <ListRows variant="separated" aria-label={`${mapStepLabel} children`}>
        {rows.map((row) => (
          <ListRow key={row.childTaskId} className="grid min-w-0 gap-bakin-2">
            <Inline gap="dense" wrap={false}>
              <Text size="meta" tone="muted" mono className="shrink-0">
                {row.index + 1}/{rows.length}
              </Text>
              <Text size="meta" tone="muted" mono as="code" className="min-w-0 flex-1 truncate">
                {row.childTaskId}
              </Text>
              <StatusBadge tone={statusTone(row.status)} size="xs">{statusLabel(row.status)}</StatusBadge>
            </Inline>
            {row.status !== 'complete' ? (
              <ListRowActions className="flex-wrap gap-bakin-2">
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
              </ListRowActions>
            ) : null}
          </ListRow>
        ))}
      </ListRows>
    </DrawerSection>
  )
}

/**
 * Honest fallback when the workflow instance cannot be loaded: a workflow
 * task (worst case: sitting in Review) must never silently render NO
 * approval surface — that reads as a broken approvals feature (2026-09-21
 * scare). 404/no-instance never shows this; only real load failures do.
 */
export function WorkflowStateUnavailableNotice({ m }: { m: TaskDetail }) {
  const { wfStateUnavailable, activeWorkflowId, handleRetryWorkflowState } = m
  if (!wfStateUnavailable || !activeWorkflowId) return null

  return (
    <Alert tone="danger">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>Workflow state unavailable</AlertTitle>
      <AlertDescription>
        <Inline gap="dense">
          <span>Review and approval controls can&apos;t load right now — the workflow service didn&apos;t answer.</span>
          <Button type="button" variant="link" size="xs" onClick={handleRetryWorkflowState}>
            <RefreshCw aria-hidden="true" /> Retry
          </Button>
        </Inline>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Every pending decision on the task — workflow gate, Health repair, operator
 * action — rendered by the one ApprovalPanel over core approval records
 * (spec D7). The hook owns fetch/busy/error/mutation; a gate also gets the
 * prior step's output from the workflow instance.
 */
export function TaskApprovalsPanel({ m }: { m: TaskDetail }) {
  const {
    approvals,
    approvalsLoading,
    approvalsFailed,
    refreshApprovals,
    approvalBusyId,
    approvalError,
    resolveApproval,
    priorStepOutput,
    outputLoading,
    outputUnavailable,
    fetchPriorOutput,
  } = m
  return (
    <ApprovalPanel
      approvals={approvals}
      loading={approvalsLoading}
      failed={approvalsFailed}
      busyApprovalId={approvalBusyId}
      error={approvalError}
      onResolve={(approval, option, comment) => { void resolveApproval(approval, option, comment) }}
      onRetry={() => { void refreshApprovals() }}
      gate={{ priorStepOutput, outputLoading, outputUnavailable, fetchPriorOutput: () => { void fetchPriorOutput() } }}
    />
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
        <Text size="meta" tone="muted">
          {wfDefinition.steps.length} steps
        </Text>
      )}
    >
      <div className="grid min-w-0 gap-bakin-3">
        {description ? (
          <Text size="body" tone="muted" as="p" className="leading-relaxed">{description}</Text>
        ) : null}
        <WorkflowStepList definition={wfDefinition} instance={wfInstance} />
      </div>
    </DrawerSection>
  )
}
