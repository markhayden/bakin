'use client'

/**
 * Approval panel — every pending decision on a task, decided where the task
 * lives (spec D7). One renderer per approval kind over the same record:
 *   workflow-gate   → Approve / Reject (typed reason), with the prior step's output
 *   health-repair   → Apply repair (ConfirmDialog listing every frozen change) / Dismiss
 *   health-navigate → Open the place that needs the operator / Dismiss
 * Patterns: storybook/public/feedback/alert.stories.tsx — WithAction;
 * storybook/public/feedback/confirm-dialog.stories.tsx — CanonicalUsage / Busy.
 * Presentational: the task-detail hook owns fetch, busy, error and the mutation.
 */
import { useState } from 'react'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  buttonVariants,
  Field,
  FieldControl,
  FieldLabel,
  Spinner,
  Text,
  Textarea,
} from '@makinbakin/sdk/ui'
import { ConfirmDialog } from '@makinbakin/sdk/patterns'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Inline } from '@makinbakin/sdk/layout'
import { TriangleAlert, Check, Hourglass, RefreshCw, X } from 'lucide-react'
import { StepOutputViewer } from './step-output-viewer'
import type { TaskApproval } from '../types'

export interface ApprovalPanelError {
  approvalId: string
  message: string
}

/** What a workflow gate shows beside its decision: the prior step's output. */
export interface ApprovalGateContext {
  priorStepOutput: Record<string, unknown> | null
  outputLoading: boolean
  outputUnavailable: boolean
  fetchPriorOutput: () => void
}

export interface ApprovalPanelProps {
  approvals: readonly TaskApproval[]
  /** First load of this task's approvals in flight. */
  loading: boolean
  /** The approvals request failed; nothing can be decided until it recovers. */
  failed: boolean
  busyApprovalId: string | null
  error: ApprovalPanelError | null
  onResolve: (approval: TaskApproval, option: string, comment?: string) => void
  onRetry: () => void
  gate?: ApprovalGateContext
}

function DecisionError({ error }: { error: ApprovalPanelError | null }) {
  if (!error) return null
  return (
    <Alert tone="danger" className="mt-bakin-3">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>Decision not applied</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  )
}

function GateApproval({ approval, busy, error, onResolve, gate }: {
  approval: TaskApproval
  busy: boolean
  error: ApprovalPanelError | null
  onResolve: ApprovalPanelProps['onResolve']
  gate?: ApprovalGateContext
}) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const requireReason = approval.request.context?.requireRejectReason !== false

  return (
    <Alert tone="attention" data-approval-kind="workflow-gate">
      <Hourglass aria-hidden="true" />
      <AlertTitle>Approval required: {approval.request.title.replace(/^Gate:\s*/, '')}</AlertTitle>
      <AlertDescription>
        {gate?.outputLoading ? (
          <p role="status" className="inline-flex items-center gap-bakin-2">
            <Spinner size="sm" />
            Loading step output…
          </p>
        ) : null}

        {gate?.outputUnavailable && !gate.priorStepOutput ? (
          <Inline gap="dense">
            <span>Step output unavailable.</span>
            <Button type="button" variant="link" size="xs" onClick={() => { gate.fetchPriorOutput() }}>
              <RefreshCw aria-hidden="true" /> Retry
            </Button>
          </Inline>
        ) : null}

        {gate?.priorStepOutput ? (
          <section aria-label="Prior step output" className="mt-bakin-3 grid min-w-0 gap-bakin-2">
            <Text as="p" size="meta" tone="muted" className="font-bakin-typography-weight-medium">Prior step output</Text>
            <StepOutputViewer output={gate.priorStepOutput} />
          </section>
        ) : null}

        <DecisionError error={error} />

        {rejecting ? (
          <div className="mt-bakin-3 grid min-w-0 gap-bakin-3">
            <Field name="rejectReason">
              <FieldLabel requirement={requireReason ? 'required' : 'optional'}>Rejection reason</FieldLabel>
              <FieldControl
                render={(
                  <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Describe what needs to change…"
                    rows={3}
                    autoFocus
                  />
                )}
              />
            </Field>
            <div className="flex flex-wrap justify-end gap-bakin-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setRejecting(false); setReason('') }} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => onResolve(approval, 'reject', reason.trim() || undefined)}
                disabled={busy || (requireReason && !reason.trim())}
              >
                <X aria-hidden="true" />
                {busy ? 'Rejecting…' : 'Reject'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-bakin-3 flex flex-wrap justify-end gap-bakin-2">
            <Button type="button" variant="danger" size="sm" onClick={() => setRejecting(true)} disabled={busy}>
              <X aria-hidden="true" /> Reject
            </Button>
            <Button type="button" size="sm" onClick={() => onResolve(approval, 'approve')} disabled={busy}>
              <Check aria-hidden="true" />
              {busy ? 'Approving…' : 'Approve'}
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}

function proposedChanges(approval: TaskApproval): Array<{ key: string; safety: string; text: string }> {
  if (approval.owner.kind !== 'health-repair') return []
  return approval.owner.proposal.items.flatMap((item) =>
    item.changes.map((change, index) => ({
      key: `${item.itemId}:${index}`,
      safety: item.safety,
      text: `${change.action} ${change.kind} ${change.target} — ${change.description}`,
    })))
}

function RepairApproval({ approval, busy, error, onResolve }: {
  approval: TaskApproval
  busy: boolean
  error: ApprovalPanelError | null
  onResolve: ApprovalPanelProps['onResolve']
}) {
  const [confirming, setConfirming] = useState(false)
  const changes = proposedChanges(approval)

  return (
    <Alert tone="attention" data-approval-kind="health-repair">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{approval.request.title}</AlertTitle>
      <AlertDescription>
        <MarkdownContent content={approval.request.body} />
        <DecisionError error={error} />
        <div className="mt-bakin-3 flex flex-wrap justify-end gap-bakin-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onResolve(approval, 'dismiss')} disabled={busy}>
            Dismiss
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={() => setConfirming(true)} disabled={busy}>
            {busy ? 'Applying…' : 'Apply repair'}
          </Button>
        </div>
      </AlertDescription>
      <ConfirmDialog
        open={confirming}
        busy={busy}
        title="Apply this repair?"
        description="Bakin re-checks that nothing has changed since this was proposed, then runs exactly these changes."
        confirmLabel="Apply repair"
        busyLabel="Applying repair…"
        confirmTone="danger"
        error={error?.message}
        onConfirm={() => onResolve(approval, 'apply')}
        onCancel={() => setConfirming(false)}
      >
        <ul className="grid gap-bakin-1" aria-label="Proposed changes">
          {changes.map((change) => (
            <li key={change.key} className="min-w-0 break-words">
              <span className="font-bakin-typography-weight-medium">[{change.safety}]</span> {change.text}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </Alert>
  )
}

function NavigateApproval({ approval, busy, error, onResolve }: {
  approval: TaskApproval
  busy: boolean
  error: ApprovalPanelError | null
  onResolve: ApprovalPanelProps['onResolve']
}) {
  const href = approval.owner.kind === 'health-navigate' ? approval.owner.href : '/health'
  return (
    <Alert tone="attention" data-approval-kind="health-navigate">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{approval.request.title}</AlertTitle>
      <AlertDescription>
        {/* Plain prose, not Markdown: the body names the destination URL for
            channel readers, and an autolinked URL inside an attention alert
            fails contrast — the Open action below IS the link here. */}
        <Text as="p" className="whitespace-pre-line">{approval.request.body}</Text>
        <DecisionError error={error} />
        <div className="mt-bakin-3 flex flex-wrap justify-end gap-bakin-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onResolve(approval, 'dismiss')} disabled={busy}>
            {busy ? 'Dismissing…' : 'Dismiss'}
          </Button>
          <PluginLink to={href} className={buttonVariants({ size: 'sm' })}>
            Open
          </PluginLink>
        </div>
      </AlertDescription>
    </Alert>
  )
}

export function ApprovalPanel({ approvals, loading, failed, busyApprovalId, error, onResolve, onRetry, gate }: ApprovalPanelProps) {
  if (failed) {
    return (
      <Alert tone="danger" data-approval-panel="failed">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>Pending decisions could not load</AlertTitle>
        <AlertDescription>Anything waiting on this task stays undecided until the approvals service answers.</AlertDescription>
        <AlertAction>
          <Button type="button" size="xs" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" /> Retry
          </Button>
        </AlertAction>
      </Alert>
    )
  }
  if (approvals.length === 0) {
    if (!loading) return null
    return (
      <p role="status" className="inline-flex items-center gap-bakin-2" data-approval-panel="loading">
        <Spinner size="sm" />
        Checking for pending decisions…
      </p>
    )
  }
  return (
    <div className="grid min-w-0 gap-bakin-3" data-approval-panel="">
      {approvals.map((approval) => {
        const busy = busyApprovalId === approval.approvalId
        const own = error?.approvalId === approval.approvalId ? error : null
        if (approval.owner.kind === 'workflow-gate') return <GateApproval key={approval.approvalId} approval={approval} busy={busy} error={own} onResolve={onResolve} gate={gate} />
        if (approval.owner.kind === 'health-repair') return <RepairApproval key={approval.approvalId} approval={approval} busy={busy} error={own} onResolve={onResolve} />
        return <NavigateApproval key={approval.approvalId} approval={approval} busy={busy} error={own} onResolve={onResolve} />
      })}
    </div>
  )
}
