'use client'

import { useEffect, useState, type ComponentPropsWithoutRef } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Progress,
  ProgressLabel,
} from '@bakin/ui'
import { Inline, Stack } from '@bakin/ui/layout'
import { CopyButton, StatusBadge, Timeline, TimelineEntry, type StatusTone } from '@bakin/ui/patterns'
import { cn } from '@bakin/ui/utils'

import {
  isOperationFinished,
  operationQuietState,
  type OperationItem,
  type OperationPhase,
  type OperationStageStatus,
  type OperationStageView,
  type OperationStatus,
  type OperationView,
} from '../types/operations'

export type OperationProgressVariant = 'full' | 'compact'

export interface OperationProgressProps extends Omit<ComponentPropsWithoutRef<'section'>, 'children'> {
  /** The complete view (from `useOperation`, an SSE event, or a fixture). */
  operation: OperationView
  /** Child operations in the parent's order (a repair's actions). */
  childOperations?: readonly OperationView[]
  /**
   * How the client sees the operation (`useOperation().phase`). `expired`,
   * `restarted` and `unreachable` explain themselves; omit for a plain view.
   */
  phase?: OperationPhase
  /** `compact`: title, current stage, bar and Cancel — for trays and rows. */
  variant?: OperationProgressVariant
  /** Shown only while cancel is allowed. */
  onCancel?: () => void
  /** Offered when the outcome is unknown (restarted, expired) — re-read the resulting state. */
  onRecheck?: () => void
  /** A fixed clock (ms since epoch) for stories and tests; live otherwise. */
  now?: number
}

const STATUS_COPY: Record<OperationStatus, { label: string; tone: StatusTone }> = {
  running: { label: 'Running', tone: 'accent' },
  cancelling: { label: 'Cancelling', tone: 'attention' },
  succeeded: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

const STAGE_COPY: Record<OperationStageStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  active: { label: 'In progress', tone: 'accent' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
}

const ATTEMPT_REASON: Record<string, string> = {
  stalled: 'the transfer stalled',
  deadline: 'it ran past its deadline',
  http: 'the server answered with an error',
  network: 'the connection failed',
}

/** `14s`, `2m 05s`, `1h 02m`. */
export function formatOperationDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** Decimal units, one decimal place above a kilobyte. */
export function formatOperationBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function useClock(fixed: number | undefined, live: boolean): number {
  const [now, setNow] = useState(() => fixed ?? Date.now())
  useEffect(() => {
    if (fixed !== undefined || !live) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [fixed, live])
  return fixed ?? now
}

interface Measure {
  /** 0–100, or null for an indeterminate bar. */
  percent: number | null
  text: string
}

function measureStage(stage: OperationStageView): Measure {
  if (stage.bytes) {
    const { received, total } = stage.bytes
    if (total && total > 0) {
      return { percent: Math.min(100, (received / total) * 100), text: `${formatOperationBytes(received)} of ${formatOperationBytes(total)}` }
    }
    return { percent: null, text: `${formatOperationBytes(received)} · size unknown` }
  }
  const items = stage.items ?? []
  if (items.length > 0) {
    const finished = items.filter((i) => i.status === 'done' || i.status === 'skipped').length
    return { percent: (finished / items.length) * 100, text: `${finished} of ${items.length}` }
  }
  return { percent: null, text: 'Working' }
}

function itemMeasure(item: OperationItem): string | null {
  if (!item.bytes) return null
  return item.bytes.total
    ? `${formatOperationBytes(item.bytes.received)} of ${formatOperationBytes(item.bytes.total)}`
    : `${formatOperationBytes(item.bytes.received)} · size unknown`
}

function StageBar({ stage, label }: { stage: OperationStageView; label: string }) {
  const measure = measureStage(stage)
  return (
    <Progress
      value={measure.percent}
      tone="accent"
      data-slot="operation-progress-bar"
      getAriaValueText={() => measure.text}
      className="w-full"
    >
      <ProgressLabel className="sr-only">{label}</ProgressLabel>
      <span className="order-last basis-full font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] tabular-nums text-bakin-text-muted">
        {measure.text}
      </span>
    </Progress>
  )
}

function stageDuration(stage: OperationStageView, now: number): string | null {
  if (!stage.startedAt) return null
  const end = stage.endedAt ? Date.parse(stage.endedAt) : now
  return formatOperationDuration(end - Date.parse(stage.startedAt))
}

function CancelControl({ operation, onCancel, compact }: { operation: OperationView; onCancel?: () => void; compact: boolean }) {
  if (operation.status === 'cancelling') {
    return <Button variant="secondary" size="sm" busy>Cancelling</Button>
  }
  if (operation.status !== 'running') return null
  if (operation.cancellable) {
    return onCancel ? <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button> : null
  }
  if (compact) return null
  const copy = operation.plan.pointOfNoReturn === 'start' ? "Can't be cancelled" : 'Will finish — past the point of no return'
  return (
    <span data-slot="operation-progress-cancel-note" className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
      {copy}
    </span>
  )
}

interface Notice {
  key: string
  tone: StatusTone
  title: string
  body?: string
  recheck?: boolean
}

function notices(operation: OperationView, phase: OperationPhase | undefined, now: number): Notice[] {
  const out: Notice[] = []
  if (phase === 'restarted') {
    out.push({ key: 'restarted', tone: 'attention', title: 'Bakin restarted while this was running', body: 'The outcome is unknown. Re-check to see what was applied.', recheck: true })
  } else if (phase === 'expired') {
    out.push({ key: 'expired', tone: 'neutral', title: 'This record has expired', body: 'Finished operations are kept for an hour. Re-check to see the current state.', recheck: true })
  } else if (phase === 'unreachable') {
    out.push({ key: 'unreachable', tone: 'attention', title: "Can't reach Bakin", body: 'Showing the last update received. Retrying.' })
  }

  if (operation.waitingFor) {
    const { holderTitle, since, stale } = operation.waitingFor
    const waited = formatOperationDuration(now - Date.parse(since))
    out.push(stale
      ? { key: 'waiting', tone: 'attention', title: `${holderTitle} stopped responding`, body: `Reclaiming its lock after ${waited}. This starts next.` }
      : { key: 'waiting', tone: 'neutral', title: `Waiting for ${holderTitle}`, body: `Waiting ${waited}. This starts automatically when it finishes.` })
  }

  const quiet = operationQuietState(operation, now)
  if (quiet.state === 'stuck' && phase !== 'restarted') {
    const stage = operation.stages.find((s) => s.id === quiet.stageId)
    out.push({
      key: 'stuck',
      tone: 'attention',
      title: `No progress for ${formatOperationDuration(quiet.sinceProgressMs)}`,
      body: `${stage?.label ?? 'This step'} has not advanced. It may still finish; nothing has been stopped.`,
    })
  }

  if (operation.status === 'cancelling') {
    out.push({ key: 'cancelling', tone: 'neutral', title: 'Cancelling', body: 'Stopping after the current step settles.' })
  } else if (operation.status === 'cancelled') {
    out.push({ key: 'cancelled', tone: 'neutral', title: 'Cancelled', body: operation.outcome?.message ?? 'Stopped before anything was changed.' })
  } else if (operation.status === 'failed') {
    const outcome = operation.outcome
    if (outcome?.partiallyApplied || outcome?.code === 'partially_applied') {
      out.push({ key: 'outcome', tone: 'attention', title: 'Partially applied', body: outcome.message })
    } else if (outcome?.code === 'verification_failed') {
      out.push({ key: 'outcome', tone: 'danger', title: 'Verification failed', body: outcome.message })
    } else {
      out.push({ key: 'outcome', tone: 'danger', title: 'Failed', body: outcome?.message })
    }
  }
  return out
}

function ItemList({ items, label }: { items: readonly OperationItem[]; label: string }) {
  return (
    <Timeline nested aria-label={label}>
      {items.map((item) => {
        const copy = STAGE_COPY[item.status]
        const measure = itemMeasure(item)
        return (
          <TimelineEntry
            key={item.id}
            tone={copy.tone}
            title={item.label}
            meta={<StatusBadge tone={copy.tone} size="xs">{copy.label}</StatusBadge>}
          >
            {measure || item.message ? (
              <span>{[measure, item.message].filter(Boolean).join(' · ')}</span>
            ) : null}
          </TimelineEntry>
        )
      })}
    </Timeline>
  )
}

function StageEntry({ operation, stage, now, childOperations }: {
  operation: OperationView
  stage: OperationStageView
  now: number
  /** Nested under this stage (a parent's first stage owns its children, D10). */
  childOperations?: readonly OperationView[]
}) {
  const copy = STAGE_COPY[stage.status]
  const duration = stage.status === 'active' || stage.status === 'done' || stage.status === 'failed' ? stageDuration(stage, now) : null
  const active = stage.status === 'active' && isOperationFinished(operation.status) === false
  const quiet = active ? operationQuietState(operation, now) : null
  const lastOutputAgo = formatOperationDuration(now - Date.parse(operation.lastLivenessAt))

  const note = stage.status === 'skipped' && stage.skippedReason
    ? stage.skippedReason
    : stage.attempt
      ? `Attempt ${stage.attempt.n} of ${stage.attempt.of} — retrying because ${ATTEMPT_REASON[stage.attempt.reason] ?? stage.attempt.reason}${stage.attempt.detail ? ` (${stage.attempt.detail})` : ''}.`
      : stage.status === 'failed' ? stage.message : undefined
  const noteLabel = stage.status === 'skipped' ? 'Skipped because' : stage.attempt ? 'Retrying' : stage.status === 'failed' ? 'Reason' : undefined

  return (
    <TimelineEntry
      data-stage-id={stage.id}
      data-stage-status={stage.status}
      tone={copy.tone}
      title={stage.label}
      meta={(
        <>
          <StatusBadge tone={copy.tone} size="xs">{copy.label}</StatusBadge>
          {duration ? (
            <span className="font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] tabular-nums text-bakin-text-muted">
              {duration}
            </span>
          ) : null}
        </>
      )}
      note={note}
      noteLabel={note ? noteLabel : undefined}
    >
      {active ? (
        <Stack gap="dense">
          {stage.message ? <span className="text-bakin-text-primary">{stage.message}</span> : null}
          <StageBar stage={stage} label={`${stage.label} progress`} />
          {quiet && quiet.state === 'quiet' ? (
            <span data-slot="operation-progress-quiet">
              No measurable progress for {formatOperationDuration(quiet.sinceProgressMs)} — still working{operation.lastOutput ? `; last output ${lastOutputAgo} ago` : ''}.
            </span>
          ) : null}
          {operation.lastOutput ? (
            <span data-slot="operation-progress-liveness" className="min-w-0 truncate font-bakin-typography-family-mono">
              {operation.lastOutput}
            </span>
          ) : null}
        </Stack>
      ) : null}
      {stage.items && stage.items.length > 0 ? <ItemList items={stage.items} label={`${stage.label} items`} /> : null}
      {childOperations && childOperations.length > 0 ? (
        <Timeline nested aria-label={`${operation.title} included operations`}>
          {childOperations.map((child) => <ChildEntry key={child.id} child={child} now={now} />)}
        </Timeline>
      ) : null}
    </TimelineEntry>
  )
}

function ChildEntry({ child, now }: { child: OperationView; now: number }) {
  const status = STATUS_COPY[child.status]
  const active = child.stages.find((s) => s.status === 'active')
  const failedStage = child.stages.find((s) => s.status === 'failed')
  return (
    <TimelineEntry
      data-child-id={child.id}
      tone={status.tone}
      title={child.title}
      meta={<StatusBadge tone={status.tone} size="xs">{status.label}</StatusBadge>}
      note={child.status === 'failed' ? (child.outcome?.message ?? failedStage?.message) : undefined}
      noteLabel={child.status === 'failed' ? 'Reason' : undefined}
    >
      {active && !isOperationFinished(child.status) ? (
        <Stack gap="dense">
          <span>{active.label}</span>
          <StageBar stage={active} label={`${child.title} progress`} />
        </Stack>
      ) : child.status === 'running' && child.waitingFor ? (
        <span>Waiting for {child.waitingFor.holderTitle} · {formatOperationDuration(now - Date.parse(child.waitingFor.since))}</span>
      ) : null}
    </TimelineEntry>
  )
}

function Details({ operation }: { operation: OperationView }) {
  if (operation.log.length === 0) return null
  const text = operation.log.map((l) => `${l.at} ${l.level.toUpperCase()} ${l.text}`).join('\n')
  return (
    <Collapsible data-slot="operation-progress-details" className="border-b-0">
      <CollapsibleTrigger className="text-[length:var(--bakin-typography-size-meta)]">Details</CollapsibleTrigger>
      <CollapsibleContent>
        <Stack gap="dense">
          <Inline justify="end">
            <CopyButton text={text} label="Copy activity log" />
          </Inline>
          <pre
            aria-label="Activity log"
            className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-bakin-surface border border-bakin-border-subtle p-bakin-3 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted"
          >
            {text}
          </pre>
        </Stack>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The one progress surface for a long-running operation (#895): the declared
 * plan as a Timeline, a Progress bar on the active stage (indeterminate when
 * the size is unknown), honest quiet/stuck language from progress alone
 * (output is liveness, never progress), the waiting overlay, cancel or why
 * cancel is unavailable, an Alert for every non-happy state, and the
 * activity log under Details. Child operations nest under the parent's
 * first stage — a repair parent's plan is its children, then verifying.
 */
export function OperationProgress({
  operation,
  childOperations = [],
  phase,
  variant = 'full',
  onCancel,
  onRecheck,
  now: fixedNow,
  className,
  ...props
}: OperationProgressProps) {
  const finished = isOperationFinished(operation.status)
  const now = useClock(fixedNow, !finished && phase !== 'restarted' && phase !== 'expired')
  const status = operation.waitingFor && operation.status === 'running'
    ? { label: 'Waiting', tone: 'neutral' as const }
    : STATUS_COPY[operation.status]
  const elapsed = formatOperationDuration((operation.endedAt ? Date.parse(operation.endedAt) : now) - Date.parse(operation.startedAt))
  const compact = variant === 'compact'
  const activeStage = operation.stages.find((s) => s.status === 'active')

  const header = (
    <Inline justify="between" gap="dense" data-slot="operation-progress-header">
      <Inline gap="dense" className="min-w-0">
        <span data-slot="operation-progress-title" className="min-w-0 break-words font-bakin-typography-weight-semibold text-bakin-text-primary">
          {operation.title}
        </span>
        <StatusBadge tone={status.tone} size="xs">{status.label}</StatusBadge>
        <span className="font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] tabular-nums text-bakin-text-muted">
          {elapsed}
        </span>
      </Inline>
      <CancelControl operation={operation} onCancel={onCancel} compact={compact} />
    </Inline>
  )

  if (compact) {
    return (
      <section
        {...props}
        aria-label={operation.title}
        data-slot="operation-progress"
        data-variant="compact"
        data-status={operation.status}
        className={cn('flex min-w-0 flex-col gap-bakin-2 font-bakin-typography-family-ui', className)}
      >
        {header}
        {!finished && operation.waitingFor ? (
          <span className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
            Waiting for {operation.waitingFor.holderTitle}
          </span>
        ) : !finished && activeStage ? (
          <Stack gap="dense" className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
            <span>{activeStage.label}</span>
            <StageBar stage={activeStage} label={`${operation.title} progress`} />
          </Stack>
        ) : operation.outcome?.message ? (
          <span className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">{operation.outcome.message}</span>
        ) : null}
      </section>
    )
  }

  return (
    <section
      {...props}
      aria-label={operation.title}
      data-slot="operation-progress"
      data-variant="full"
      data-status={operation.status}
      className={cn('flex min-w-0 flex-col gap-bakin-4 font-bakin-typography-family-ui', className)}
    >
      {header}
      {notices(operation, phase, now).map((n) => (
        <Alert key={n.key} tone={n.tone} data-notice={n.key}>
          <AlertTitle>{n.title}</AlertTitle>
          {n.body || (n.recheck && onRecheck) ? (
            <AlertDescription>
              <Stack gap="dense" align="start">
                {n.body ? <span>{n.body}</span> : null}
                {n.recheck && onRecheck ? <Button variant="secondary" size="sm" onClick={onRecheck}>Re-check</Button> : null}
              </Stack>
            </AlertDescription>
          ) : null}
        </Alert>
      ))}
      {operation.status === 'succeeded' && operation.outcome?.message ? (
        <p className="m-0 text-bakin-text-muted">{operation.outcome.message}</p>
      ) : null}
      <Timeline aria-label={`${operation.title} steps`}>
        {operation.stages.map((stage, i) => (
          <StageEntry key={stage.id} operation={operation} stage={stage} now={now} childOperations={i === 0 ? childOperations : undefined} />
        ))}
      </Timeline>
      <Details operation={operation} />
    </section>
  )
}
