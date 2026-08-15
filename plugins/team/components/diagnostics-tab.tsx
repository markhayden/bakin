'use client'

/**
 * Diagnostics tab (#385) — the per-agent "is this agent healthy and what has
 * it been doing" view, three stacked panels:
 *
 *  - Drift: live scan findings (GET /api/agent-packages/{id}/scan — always
 *    fresh, read-only) with per-input attribution, a Sync-now action reusing
 *    the existing sync POST, and the latest receipt summary.
 *  - Context budget: pure render of GET /api/context-report/{id} — budget
 *    meter, top static sections, workspace files w/ managed-block bytes, and
 *    an observed-input sparkline.
 *  - Activity timeline: GET /api/plugins/team/{id}/timeline — dispatch runs
 *    (tokens/cost/outcome) interleaved with notable events, expandable logs.
 *
 * Also exports useAgentAttention + DiagnosticsChips: the Overview tab's
 * drift/context/burn status chips, derived from canonical cached Health
 * incidents and their structured agent resources.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { ChartExplainer, Sparkline } from '@makinbakin/sdk/charts'
import { usePluginEvent, useJsonFetch, useQueryState } from '@makinbakin/sdk/hooks'
import { DisclosurePanel, Grid, Panel, Section, Stack } from '@makinbakin/sdk/layout'
import {
  KeyValue,
  Pagination,
  SegmentedControl,
  StatusBadge,
  StatusMarker,
  Timeline,
  TimelineEntry,
  type KeyValueItem,
} from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Progress,
  ProgressLabel,
  ProgressValue,
  Skeleton,
  SystemState,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { formatDuration } from '@makinbakin/sdk/utils'
import type { HealthReport } from '@makinbakin/sdk/types'
import type { ScanFinding, TimelineEventView } from '../types'

// ── Small shared bits ────────────────────────────────────────────────────────

function DiagnosticsSection({ title, actions, children, divider = 'top' }: {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
  divider?: 'none' | 'top'
}) {
  const headingId = `diagnostics-${title.toLowerCase().replaceAll(' ', '-')}`
  return (
    <Section spacing="compact" divider={divider} aria-labelledby={headingId}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
        <h2 id={headingId}>{title}</h2>
        {actions}
      </div>
      {children}
    </Section>
  )
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${n} B`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

const DIAGNOSTICS_REQUEST_TIMEOUT_MS = 15_000

class DiagnosticsRequestTimeoutError extends Error {
  constructor() {
    super('Request timed out')
    this.name = 'DiagnosticsRequestTimeoutError'
  }
}

async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  controller: AbortController,
): Promise<Response> {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timeout = globalThis.setTimeout(() => {
          controller.abort()
          reject(new DiagnosticsRequestTimeoutError())
        }, DIAGNOSTICS_REQUEST_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout)
  }
}

export interface AgentAttention {
  loaded: boolean
  drift: boolean
  context: boolean
  burn: boolean
}

function reportFlagsAgent(report: HealthReport, checkId: string, agentId: string): boolean {
  const observationIds = new Set(
    report.observations
      .filter(observation => observation.checkId === checkId)
      .map(observation => observation.id),
  )
  return report.incidents.some(incident => (
    incident.effectiveDisposition !== 'advisory'
    && incident.resources.some(resource => resource.kind === 'agent' && resource.id === agentId)
    && incident.observationIds.some(observationId => observationIds.has(observationId))
  ))
}

/** Drift/context/burn flags for one agent from canonical cached Health incidents. */
export function useAgentAttention(agentId: string): AgentAttention {
  const health = useJsonFetch<HealthReport>('/api/plugins/health/doctor')
  // Re-fetch when the agent changes (matches the old per-effect behavior):
  // an instance surviving /team/a → /team/b navigation must not flag the new
  // agent from a stale doctor snapshot. Skips the mount run — the hook
  // already fetches on mount; this only covers agentId CHANGES.
  const { refresh } = health
  const mountedAgent = useRef(agentId)
  useEffect(() => {
    if (mountedAgent.current === agentId) return
    mountedAgent.current = agentId
    refresh()
  }, [agentId, refresh])
  return useMemo(() => {
    const report = health.data
    return {
      loaded: report !== null,
      drift: report ? reportFlagsAgent(report, 'team.agent-sync', agentId) : false,
      context: report ? reportFlagsAgent(report, 'health.context.startup-size', agentId) : false,
      burn: report ? reportFlagsAgent(report, 'health.usage.agent-burn', agentId) : false,
    }
  }, [health.data, agentId])
}

export function DiagnosticsChips({ agentId, onOpen }: { agentId: string; onOpen: () => void }) {
  const attention = useAgentAttention(agentId)
  return <DiagnosticsChipsView attention={attention} onOpen={onOpen} />
}

export function DiagnosticsChipsView({ attention, onOpen }: { attention: AgentAttention; onOpen: () => void }) {
  const chips: Array<{ key: string; label: string; flagged: boolean }> = [
    { key: 'drift', label: 'Drift', flagged: attention.drift },
    { key: 'context', label: 'Context', flagged: attention.context },
    { key: 'burn', label: 'Burn', flagged: attention.burn },
  ]
  return (
    <div className="flex flex-wrap gap-bakin-2">
      {chips.map((chip) => {
        const state = !attention.loaded && chip.key === 'drift'
          ? 'Checking'
          : chip.flagged ? 'Needs attention' : 'OK'
        return (
          // A chip reports state, so a StatusBadge carries it; the surrounding
          // inline Button carries the one action (open the details tab).
          <Button key={chip.key} type="button" size="inline" variant="ghost" onClick={onOpen}>
            <StatusBadge
              tone={chip.flagged ? 'attention' : 'neutral'}
              variant={chip.flagged ? 'solid' : 'soft'}
              size="xs"
              icon={chip.flagged ? AlertTriangle : undefined}
            >
              {chip.label} · {state}
            </StatusBadge>
          </Button>
        )
      })}
    </div>
  )
}

// ── Drift panel ──────────────────────────────────────────────────────────────

interface ScanPayload {
  ok: boolean
  packageId: string | null
  findings: ScanFinding[]
  scannedAt: string
}

interface ReceiptPayload {
  receipt?: {
    syncedAt: string
    checkOnly: boolean
    blocks?: Array<{ file: string; action: string; bytes?: number }>
    verification?: { status: string }
  }
}

function DriftPanel({ agentId }: { agentId: string }) {
  const [scan, setScan] = useState<ScanPayload | null>(null)
  const [receipt, setReceipt] = useState<ReceiptPayload['receipt'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const syncControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let completed = false
    let scanBody: ScanPayload | null = null
    let receiptBody: ReceiptPayload | null = null

    setLoading(true)
    setScan(null)
    setReceipt(null)

    const requests = Promise.allSettled([
      getJson<ScanPayload>(
        `/api/agent-packages/${encodeURIComponent(agentId)}/scan`,
        controller.signal,
      ).then((body) => { scanBody = body }),
      getJson<ReceiptPayload>(
        `/api/agent-packages/${encodeURIComponent(agentId)}/receipt`,
        controller.signal,
      ).then((body) => { receiptBody = body }),
    ])

    const finish = () => {
      if (!active || completed) return
      completed = true
      setScan(scanBody)
      setReceipt(receiptBody?.receipt ?? null)
      setLoading(false)
    }

    const timeout = globalThis.setTimeout(() => {
      controller.abort()
      finish()
    }, DIAGNOSTICS_REQUEST_TIMEOUT_MS)

    void requests.then(() => {
      globalThis.clearTimeout(timeout)
      finish()
    })

    return () => {
      active = false
      globalThis.clearTimeout(timeout)
      controller.abort()
    }
  }, [agentId, retryNonce])

  useEffect(() => {
    const controller = syncControllerRef.current
    syncControllerRef.current = null
    controller?.abort()
    setSyncing(false)
    setSyncError(null)
    return () => {
      const activeController = syncControllerRef.current
      syncControllerRef.current = null
      activeController?.abort()
    }
  }, [agentId])

  const handleSync = async () => {
    syncControllerRef.current?.abort()
    const controller = new AbortController()
    syncControllerRef.current = controller
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetchWithDeadline(`/api/agent-packages/${encodeURIComponent(agentId)}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, controller)
      if (syncControllerRef.current !== controller) return
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (syncControllerRef.current !== controller) return
        setSyncError(body.migrationRequired
          ? 'This agent needs the one-time block migration — run `bakin agents sync` in a terminal.'
          : (body.error ?? `sync failed (${res.status})`))
        return
      }
      if (syncControllerRef.current !== controller) return
      setRetryNonce((nonce) => nonce + 1)
    } catch (cause) {
      if (syncControllerRef.current !== controller) return
      setSyncError(cause instanceof DiagnosticsRequestTimeoutError
        ? 'Sync timed out. Try again.'
        : 'Sync could not be completed. Try again.')
    } finally {
      if (syncControllerRef.current === controller) {
        syncControllerRef.current = null
        setSyncing(false)
      }
    }
  }

  const findings = scan?.findings ?? []
  const locked = findings.filter((f) => f.type === 'user-edited')
  const findingLabel = (finding: ScanFinding) => {
    if (finding.type === 'block-missing') return 'Managed block missing'
    if (finding.type === 'block-stale') return 'Managed block out of date'
    if (finding.type === 'user-edited') return 'Protected user edit'
    return finding.type.replaceAll('-', ' ')
  }

  return (
    <Section spacing="compact" divider="none" aria-labelledby="diagnostics-drift">
      <Panel data-drift-checklist="" tone="neutral">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
          <div className="min-w-0">
            <h2 id="diagnostics-drift">Drift</h2>
            <p className="m-0 mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
              {loading
                ? 'Comparing managed files with the installed package.'
                : findings.length === 0
                  ? 'Managed files match the package and composed context.'
                  : `${findings.length} ${findings.length === 1 ? 'finding needs' : 'findings need'} review.`}
            </p>
          </div>
          <div className="flex items-center gap-bakin-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryNonce((nonce) => nonce + 1)}
              disabled={loading}
            >
              <RefreshCw className="mr-1 size-3" /> Rescan
            </Button>
            <Button size="sm" onClick={() => void handleSync()} disabled={syncing || !scan?.packageId}>
              {syncing ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
              Sync now
            </Button>
          </div>
        </div>

        <div className="mt-bakin-4">
          {loading ? (
            <SystemState
              kind="loading"
              scope="inline"
              headingLevel={3}
              title="Scanning agent files"
              description="Comparing managed content with the installed package."
              preview={<Skeleton className="h-10 w-full" />}
            />
          ) : !scan ? (
            <Alert tone="danger">
              <AlertTitle>Drift scan unavailable.</AlertTitle>
              <AlertDescription>Rescan to compare the current files with the installed package.</AlertDescription>
            </Alert>
          ) : findings.length === 0 ? (
            <SystemState
              kind="initial-empty"
              scope="inline"
              headingLevel={3}
              title="No drift detected"
              description="This agent's files match what its package and context layers expect."
            />
          ) : (
            <ul className="m-0 grid gap-bakin-1 p-0">
              {findings.map((finding, i) => (
                <li
                  key={i}
                  data-drift-finding={finding.type}
                  className="flex min-w-0 gap-bakin-3 rounded-bakin-control px-bakin-2 py-bakin-2"
                >
                  {/* Was a decorative span painted to look like an unchecked
                      checkbox — a control the reader could never operate. */}
                  <span className="mt-bakin-1 shrink-0">
                    <StatusMarker tone="attention" size="sm" label={`${findingLabel(finding)} needs review`} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-bakin-2 gap-y-bakin-1">
                      <strong className="capitalize">{findingLabel(finding)}</strong>
                      <span className="truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                        {finding.file ?? finding.target ?? ''}
                      </span>
                    </div>
                    <p className="m-0 mt-bakin-1 text-bakin-text-muted">{finding.message}</p>
                    {finding.staleInputs && finding.staleInputs.length > 0 && (
                      <p className="m-0 mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
                        Changed inputs: <span className="font-bakin-typography-family-mono">{finding.staleInputs.join(', ')}</span>
                      </p>
                    )}
                    {finding.hint ? <p className="m-0 mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">{finding.hint}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {syncError ? (
          <div className="mt-bakin-3">
            <Alert tone="danger">
              <AlertTitle>Agent files were not synced</AlertTitle>
              <AlertDescription>{syncError}</AlertDescription>
            </Alert>
          </div>
        ) : null}
        {locked.length > 0 && (
          <div className="mt-bakin-3">
            <Alert tone="attention">
              <AlertTitle>{locked.length} edited {locked.length === 1 ? 'file is' : 'files are'} protected</AlertTitle>
              <AlertDescription>
                Reclaim from the CLI if you want to replace {locked.length === 1 ? 'it' : 'them'} with the package version.
              </AlertDescription>
            </Alert>
          </div>
        )}
        <div className="mt-bakin-4 flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1 border-t border-bakin-border-subtle pt-bakin-3 text-bakin-typography-size-meta text-bakin-text-muted">
          {receipt ? (
            <span>
              Last sync {new Date(receipt.syncedAt).toLocaleString()}
              {receipt.checkOnly ? ' (check only)' : ''} · verification {receipt.verification?.status ?? 'unknown'}
            </span>
          ) : null}
          <span>
            Sync recomposes managed content; edits outside managed blocks are never touched.
          </span>
        </div>
      </Panel>
    </Section>
  )
}

// ── Context budget panel ─────────────────────────────────────────────────────

interface ContextReportPayload {
  ok: boolean
  report?: {
    tokenEstimateNote?: string
    dispatch: {
      task: { sections: Array<{ source: string; bytes: number; approxTokens: number }>; totalBytes: number }
      workflow: { totalBytes: number }
      dynamicCaps: Array<{ source: string; maxBytes: number; setting: string }>
      estimatedMaxTaskBytes: number
    }
    workspace: {
      available: boolean
      totalBytes: number
      files: Array<{ name: string; bytes: number; kind: string; managedBlockBytes?: number }>
    }
    observed: { label: string; runs: Array<{ inputTokens: number | null }> }
  }
}

function ContextPanel({ agentId }: { agentId: string }) {
  // Both reads degrade independently. A failed settings request must not be
  // confused with the configured budget: the estimate remains useful, but
  // its threshold is unknown until settings recover.
  const reportRes = useJsonFetch<ContextReportPayload>(
    `/api/context-report/${encodeURIComponent(agentId)}`,
    { timeoutMs: DIAGNOSTICS_REQUEST_TIMEOUT_MS },
  )
  const settingsRes = useJsonFetch<{ dispatch?: { contextBudgetBytes?: number } }>(
    '/api/settings',
    { timeoutMs: DIAGNOSTICS_REQUEST_TIMEOUT_MS },
  )
  const loading = reportRes.loading || settingsRes.loading
  const payload = reportRes.data
  const configured = settingsRes.data?.dispatch?.contextBudgetBytes
  const budget =
    typeof configured === 'number' && configured > 0 ? configured : null

  if (loading) {
    return (
      <DiagnosticsSection title="Context budget">
        <SystemState
          kind="loading"
          scope="inline"
          headingLevel={3}
          title="Loading context report"
          description="Calculating prompt sections, workspace files, and observed input."
          preview={<Skeleton className="h-10 w-full" />}
        />
      </DiagnosticsSection>
    )
  }
  const report = payload?.report
  if (!report) {
    return (
      <DiagnosticsSection
        title="Context budget"
        actions={(
          <Button
            variant="outline"
            size="sm"
            onClick={reportRes.refresh}
            disabled={reportRes.loading}
            aria-label="Retry context report"
          >
            Retry
          </Button>
        )}
      >
        <Alert tone="danger">
          <AlertTitle>
            Context report unavailable{reportRes.error === 'Request timed out' ? ' because the request timed out.' : '.'}
          </AlertTitle>
          <AlertDescription>Retry to calculate this agent&apos;s current context footprint.</AlertDescription>
        </Alert>
      </DiagnosticsSection>
    )
  }

  const estimated = report.dispatch.estimatedMaxTaskBytes
  const over = budget === null ? false : estimated > budget
  const topSections = [...report.dispatch.task.sections].sort((a, b) => b.bytes - a.bytes).slice(0, 5)
  const observedInputs = report.observed.runs
    .map((r) => r.inputTokens)
    .filter((n): n is number => n !== null)
    .reverse()

  return (
    <DiagnosticsSection title="Context budget">
      <Stack gap="item">
        <div className="grid gap-bakin-2">
          {budget === null ? (
            <Alert tone="neutral">
              <AlertTitle>Configured budget unavailable.</AlertTitle>
              <AlertDescription>
                The estimate is still available, but Bakin cannot determine whether it exceeds the configured limit.
              </AlertDescription>
              <div className="mt-bakin-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={settingsRes.refresh}
                  disabled={settingsRes.loading}
                  aria-label="Retry context budget"
                >
                  Retry
                </Button>
              </div>
            </Alert>
          ) : (
            <Progress
              value={estimated}
              max={budget}
              tone={over ? 'attention' : 'primary'}
              size="md"
              aria-label="Estimated per-dispatch context"
            >
              <ProgressLabel>Estimated per-dispatch context</ProgressLabel>
              <ProgressValue>
                {() => `${formatBytes(estimated)} of ${formatBytes(budget)} budget`}
              </ProgressValue>
            </Progress>
          )}
          <div className="flex flex-wrap items-center gap-bakin-2">
            <strong>{formatBytes(estimated)}</strong>
            {budget === null ? (
              <StatusBadge tone="neutral" variant="outline" size="xs">Budget unknown</StatusBadge>
            ) : over ? (
              <StatusBadge tone="attention" variant="solid" size="xs">over budget</StatusBadge>
            ) : (
              <StatusBadge tone="success" variant="solid" size="xs">Within budget</StatusBadge>
            )}
          </div>
        </div>

        <Grid layout="split" gap="section" align="start">
          <div className="grid gap-bakin-2">
            <h3 className="text-bakin-typography-size-body">Largest prompt sections</h3>
            <KeyValue
              items={topSections.map((section) => ({
                label: <span className="font-bakin-typography-family-mono">{section.source}</span>,
                value: formatBytes(section.bytes),
                numeric: true,
              }))}
            />
          </div>

          {report.workspace.available && report.workspace.files.length > 0 ? (
            <div className="grid gap-bakin-2">
              <h3 className="text-bakin-typography-size-body">
                Workspace files ({formatBytes(report.workspace.totalBytes)} total)
              </h3>
              <KeyValue
                items={report.workspace.files.slice(0, 8).map((file) => ({
                  label: <span className="font-bakin-typography-family-mono">{file.name}</span>,
                  numeric: true,
                  value: (
                    <>
                      {formatBytes(file.bytes)}
                      {typeof file.managedBlockBytes === 'number' ? (
                        <span className="text-bakin-text-muted"> ({formatBytes(file.managedBlockBytes)} managed)</span>
                      ) : null}
                    </>
                  ),
                }))}
              />
            </div>
          ) : <div />}
        </Grid>

        {observedInputs.length >= 2 && (
          <div className="flex min-w-0 flex-wrap items-center gap-bakin-3">
            <Sparkline values={observedInputs} label="Observed turn input tokens, oldest to newest" />
            <span className="text-bakin-typography-size-meta text-bakin-text-muted">
              Observed turn input over the last {observedInputs.length} dispatches
              (latest {formatTokens(observedInputs[observedInputs.length - 1]!)})
            </span>
          </div>
        )}
      </Stack>
      <ChartExplainer>
        This is what a fresh session costs before the agent does any work. A growing number usually
        means bloated workspace files or lessons — compare the sections above with
        `bakin agents context {agentId}`.
      </ChartExplainer>
    </DiagnosticsSection>
  )
}

// ── Timeline panel ───────────────────────────────────────────────────────────

type TimelineRun = Extract<TimelineEventView, { type: 'run' }>
type TimelineAuditEvent = Extract<TimelineEventView, { type: 'event' }>
type TimelineActivityItem =
  | { type: 'run'; run: TimelineRun; relatedEvents: TimelineAuditEvent[]; ts: number }
  | { type: 'event'; event: TimelineAuditEvent; ts: number }

const FAILED_SETTLE_REASON = /fail|error|unauthori[sz]ed|invalid|denied|timeout|timed out|exhausted|cancel(?:led|ed)|mismatch/i
const RELATED_EVENT_GRACE_MS = 60_000

function timelineOutcome(event: TimelineRun): {
  label: string
  tone: 'accent' | 'success' | 'attention' | 'danger' | 'neutral'
  failed: boolean
} {
  if (event.status === 'running') return { label: 'Running', tone: 'accent', failed: false }
  if (event.status === 'superseded') return { label: 'Superseded', tone: 'attention', failed: false }
  if (event.status === 'lost') return { label: 'Failed', tone: 'danger', failed: true }
  if (event.settleReason && FAILED_SETTLE_REASON.test(event.settleReason)) {
    return { label: 'Failed', tone: 'danger', failed: true }
  }
  if (event.status === 'settled') return { label: 'Completed', tone: 'success', failed: false }
  return { label: event.status, tone: 'neutral', failed: false }
}

/**
 * Audit records and ledger runs arrive as one chronological stream. When an
 * audit record names the same task and lands inside (or immediately around)
 * a run, keep it subordinate to that dispatch attempt instead of presenting
 * two unrelated top-level rows.
 */
function groupTimelineActivity(events: readonly TimelineEventView[]): TimelineActivityItem[] {
  const runs = events.filter((event): event is TimelineRun => event.type === 'run')
  const relatedByRun = new Map<string, TimelineAuditEvent[]>()
  const standaloneEvents: TimelineAuditEvent[] = []

  for (const event of events) {
    if (event.type !== 'event') continue
    if (!event.taskId) {
      standaloneEvents.push(event)
      continue
    }

    const matchingRun = runs
      .filter((run) => {
        if (run.taskId !== event.taskId) return false
        const end = run.settledAt ?? Number.POSITIVE_INFINITY
        return event.ts >= run.startedAt - RELATED_EVENT_GRACE_MS
          && event.ts <= end + RELATED_EVENT_GRACE_MS
      })
      .sort((left, right) => (
        Math.abs(event.ts - left.startedAt) - Math.abs(event.ts - right.startedAt)
      ))[0]

    if (!matchingRun) {
      standaloneEvents.push(event)
      continue
    }

    const related = relatedByRun.get(matchingRun.runId) ?? []
    related.push(event)
    relatedByRun.set(matchingRun.runId, related)
  }

  return [
    ...runs.map((run): TimelineActivityItem => {
      const relatedEvents = relatedByRun.get(run.runId) ?? []
      return {
        type: 'run',
        run,
        relatedEvents,
        ts: Math.max(run.ts, ...relatedEvents.map((event) => event.ts)),
      }
    }),
    ...standaloneEvents.map((event): TimelineActivityItem => ({
      type: 'event',
      event,
      ts: event.ts,
    })),
  ].sort((left, right) => right.ts - left.ts)
}

function eventCategory(event: TimelineAuditEvent): string {
  if (event.severity === 'warn') return 'Warning'
  if (event.event.startsWith('agent_pkg.lessons_')) return 'Context'
  if (event.event === 'task.routed') return 'Routing'
  if (event.event.includes('worktree')) return 'Workspace'
  return 'System'
}

/** Sweep a live chip this long after its last chunk (tap is best-effort —
 *  no terminal signal is guaranteed). Mirrors the tasks board TTL. */
const LIVE_ACTIVITY_TTL_MS = 45_000

/**
 * Latest live turn-activity chip for one agent — fed by the ephemeral
 * 'turn-activity' SSE events (never persisted; the timeline's durable spine
 * below stays ledger + audit).
 */
function useAgentLiveActivity(agentId: string): { label: string; ts: number } | null {
  const [chip, setChip] = useState<{ label: string; ts: number } | null>(null)

  usePluginEvent('turn-activity', (payload) => {
    if (payload.agentId !== agentId) return
    const chunk = payload.chunk as { type?: string; content?: string; data?: { toolName?: string; phase?: string; status?: string } } | undefined
    if (!chunk) return
    // Event's own timestamp, stale events dropped — a replayed/delayed
    // event must never re-chip a settled turn (mirrors the board hook).
    const eventTs = Date.parse(String(payload.ts ?? ''))
    const ts = Number.isFinite(eventTs) ? eventTs : Date.now()
    if (Date.now() - ts > LIVE_ACTIVITY_TTL_MS) return
    const label = chunk.type === 'tool'
      ? `${chunk.data?.toolName ?? 'tool'}${chunk.data?.phase === 'result' ? (chunk.data?.status === 'failed' ? ' ✗' : ' ✓') : '…'}`
      : (chunk.content || 'working…')
    setChip({ label, ts })
  })

  useEffect(() => {
    if (!chip) return
    const timer = setTimeout(() => {
      setChip((prev) => (prev && Date.now() - prev.ts >= LIVE_ACTIVITY_TTL_MS ? null : prev))
    }, LIVE_ACTIVITY_TTL_MS + 500)
    return () => clearTimeout(timer)
  }, [chip])

  useEffect(() => { setChip(null) }, [agentId])

  return chip
}

function TimelinePanel({ agentId }: { agentId: string }) {
  const [window, setWindow] = useState<'24h' | '7d'>('24h')
  const [pageParam, setPageParam] = useQueryState('activityPage', '1')
  const [events, setEvents] = useState<TimelineEventView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const live = useAgentLiveActivity(agentId)
  const pageSize = 10
  const activityItems = useMemo(() => groupTimelineActivity(events), [events])
  const showAll = pageParam === 'all'
  const requestedPage = Number.parseInt(pageParam, 10)
  const pageCount = Math.max(1, Math.ceil(activityItems.length / pageSize))
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), pageCount)
    : 1
  const visibleItems = showAll
    ? activityItems
    : activityItems.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const timeout = globalThis.setTimeout(() => {
      controller.abort()
      setEvents([])
      setError('Activity timeline unavailable.')
      setLoading(false)
    }, DIAGNOSTICS_REQUEST_TIMEOUT_MS)

    fetch(`/api/plugins/team/${encodeURIComponent(agentId)}/timeline?window=${window}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`)
        return (await response.json()) as { ok: boolean; events?: TimelineEventView[] }
      })
      .then((body) => {
        if (controller.signal.aborted) return
        if (!Array.isArray(body.events)) throw new Error('Timeline response was invalid')
        setEvents(body.events)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause as { name?: string })?.name === 'AbortError') return
        setEvents([])
        setError('Activity timeline unavailable.')
        setLoading(false)
      })
      .finally(() => globalThis.clearTimeout(timeout))

    return () => {
      globalThis.clearTimeout(timeout)
      controller.abort()
    }
  }, [agentId, window, retryNonce])

  return (
    <DiagnosticsSection
      title="Activity timeline"
      actions={
        <SegmentedControl
          ariaLabel="Activity timeline window"
          options={[
            { value: '24h', label: '24 hours' },
            { value: '7d', label: '7 days' },
          ]}
          value={window}
          onValueChange={(next) => {
            setWindow(next)
            setPageParam('1')
          }}
        />
      }
    >
      {live && (
        <Alert tone="accent">
          <AlertTitle>Live activity</AlertTitle>
          <AlertDescription>
            <Tooltip>
              <TooltipTrigger render={<span />} className="block truncate">{live.label}</TooltipTrigger>
              <TooltipContent>{live.label}</TooltipContent>
            </Tooltip>
          </AlertDescription>
        </Alert>
      )}
      {loading ? (
        <SystemState
          kind="loading"
          scope="inline"
          headingLevel={3}
          title="Loading activity"
          description="Recent runs and operational events will appear here."
          preview={<Skeleton className="h-10 w-full" />}
        />
      ) : error ? (
        <SystemState
          kind="error"
          scope="inline"
          headingLevel={3}
          title={error}
          description="Retry to load the latest dispatch runs and events."
          action={(
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryNonce((nonce) => nonce + 1)}
              aria-label="Retry activity timeline"
            >
              Retry
            </Button>
          )}
        />
      ) : events.length === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="inline"
          headingLevel={3}
          title="No activity in this window."
          description="Choose a longer window or wait for the next dispatch."
        />
      ) : (
        <>
          <ChartExplainer className="mb-bakin-2 mt-0">
            Each entry is one dispatch attempt. Context, routing, warnings, and logs recorded
            during that attempt stay inside it; only unrelated system events appear on their own.
          </ChartExplainer>
          <Timeline aria-label="Dispatch activity">
            {visibleItems.map((item) => {
              if (item.type === 'run') {
                const event = item.run
                const outcome = timelineOutcome(event)
                // A settle reason that just restates success is noise beside
                // the outcome badge; only a real explanation earns a note.
                const reason = event.settleReason?.trim()
                const showReason = Boolean(
                  reason && !/^(turn-)?(ok|done|complete[d]?|success)$/i.test(reason),
                )
                const title = event.taskTitle ?? event.taskId
                const stats: KeyValueItem[] = [{
                  label: 'Duration',
                  numeric: true,
                  value: event.durationMs !== null
                    ? (formatDuration(event.durationMs) ?? `${event.durationMs} ms`)
                    : 'In flight',
                }]
                if (event.model) stats.push({ label: 'Model', value: event.model })
                if (event.inputTokens !== null || event.outputTokens !== null) {
                  stats.push({
                    label: 'Tokens',
                    numeric: true,
                    value: `${event.inputTokens !== null ? `${formatTokens(event.inputTokens)} in` : '—'}${
                      event.outputTokens !== null ? ` / ${formatTokens(event.outputTokens)} out` : ''
                    }`,
                  })
                }
                if (event.costUsdMicros !== null) {
                  stats.push({ label: 'Cost', numeric: true, value: `$${(event.costUsdMicros / 1_000_000).toFixed(2)}` })
                }
                if (event.routeSource) {
                  stats.push({ label: 'Route', value: event.routeSource === 'class' ? 'Class route' : event.routeSource })
                }

                return (
                  <TimelineEntry
                    key={event.runId}
                    tone={outcome.tone}
                    timestamp={new Date(event.startedAt).toLocaleTimeString()}
                    dateTime={new Date(event.startedAt).toISOString()}
                    title={title}
                    meta={(
                      <>
                        <StatusBadge tone={outcome.tone} variant="solid" size="xs">{outcome.label}</StatusBadge>
                        <span className="text-bakin-text-muted">Attempt {event.seq}</span>
                      </>
                    )}
                    note={showReason ? reason : undefined}
                    noteLabel={showReason ? (outcome.failed ? 'Failure reason' : 'Detail') : undefined}
                  >
                    <KeyValue layout="inline" items={stats} />

                    {item.relatedEvents.length > 0 ? (
                      <Timeline nested aria-label={`Events during attempt ${event.seq}`}>
                        {item.relatedEvents.map((related) => (
                          <TimelineEntry
                            key={`${related.ts}:${related.event}`}
                            tone={related.severity === 'warn' ? 'attention' : 'neutral'}
                            markerLabel={related.severity === 'warn' ? 'Warning' : 'Event'}
                            timestamp={new Date(related.ts).toLocaleTimeString()}
                            dateTime={new Date(related.ts).toISOString()}
                            title={eventCategory(related)}
                            meta={<span className="text-bakin-text-muted">{related.message}</span>}
                          />
                        ))}
                      </Timeline>
                    ) : null}

                    {event.logs.length > 0 ? (
                      <DisclosurePanel
                        variant="soft"
                        summary={`${event.logs.length} progress log line(s)${event.logsTruncated ? ' (truncated)' : ''}`}
                      >
                        <ul className="m-0 grid gap-bakin-1 p-0">
                          {event.logs.map((line, i) => (
                            <li key={i} className="text-bakin-text-muted">
                              <span className="tabular-nums">{new Date(line.ts).toLocaleTimeString()}</span> {line.message}
                            </li>
                          ))}
                        </ul>
                      </DisclosurePanel>
                    ) : null}
                  </TimelineEntry>
                )
              }

              return (
                <TimelineEntry
                  key={`${item.event.ts}:${item.event.event}`}
                  tone={item.event.severity === 'warn' ? 'attention' : 'neutral'}
                  timestamp={new Date(item.event.ts).toLocaleTimeString()}
                  dateTime={new Date(item.event.ts).toISOString()}
                  title={item.event.message}
                  meta={(
                    <StatusBadge tone={item.event.severity === 'warn' ? 'attention' : 'neutral'} variant="soft" size="xs">
                      {item.event.severity === 'warn' ? 'Standalone warning' : 'System event'}
                    </StatusBadge>
                  )}
                >
                  {item.event.taskId ? (
                    <span className="font-bakin-typography-family-mono">Task {item.event.taskId}</span>
                  ) : null}
                </TimelineEntry>
              )
            })}
          </Timeline>
          <Pagination
            page={page}
            pageSize={pageSize}
            showAll={showAll}
            total={activityItems.length}
            onPageChange={(nextPage) => setPageParam(String(nextPage))}
            onShowAllChange={(nextShowAll) => setPageParam(nextShowAll ? 'all' : '1')}
          />
        </>
      )}
    </DiagnosticsSection>
  )
}

// ── The tab ──────────────────────────────────────────────────────────────────

export function DiagnosticsTab({ agentId }: { agentId: string }) {
  return (
    <Stack gap="section">
      <DriftPanel agentId={agentId} />
      <ContextPanel agentId={agentId} />
      <TimelinePanel agentId={agentId} />
    </Stack>
  )
}
