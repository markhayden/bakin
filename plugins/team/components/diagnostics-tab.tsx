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
import { Loader2, RefreshCw } from 'lucide-react'
import { Button, Badge, Skeleton } from '@makinbakin/sdk/ui'
import { Sparkline, ChartExplainer } from '@makinbakin/sdk/components'
import { usePluginEvent, useJsonFetch } from '@makinbakin/sdk/hooks'
import { formatDuration } from '@makinbakin/sdk/utils'
import type { HealthReport } from '@makinbakin/sdk/types'
import type { ScanFinding, TimelineEventView } from '../types'

// ── Small shared bits ────────────────────────────────────────────────────────

function Panel({ title, actions, children }: {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
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

function useTimedJsonFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setData(null)
    setLoading(true)
    setError(null)

    void fetchWithDeadline(url, {}, controller)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`)
        return (await response.json()) as T
      })
      .then((body) => {
        if (!active) return
        setData(body)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(cause instanceof DiagnosticsRequestTimeoutError
          ? 'Request timed out.'
          : 'Request failed.')
        setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [retryNonce, url])

  return {
    data,
    loading,
    error,
    refresh: () => setRetryNonce((nonce) => nonce + 1),
  }
}

// ── Attention hook + Overview chips ─────────────────────────────────────────

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
    incident.disposition !== 'advisory'
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
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={onOpen}
          title={`Open the Diagnostics tab (${chip.label.toLowerCase()} details)`}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-accent ${
            chip.flagged
              ? 'border-amber-500/50 text-amber-400'
              : 'border-border text-muted-foreground'
          }`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${chip.flagged ? 'bg-amber-400' : 'bg-emerald-500'}`} />
          {chip.label}
          {!attention.loaded && chip.key === 'drift' ? '…' : chip.flagged ? ' ⚠' : ' ok'}
        </button>
      ))}
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

  return (
    <Panel
      title="Drift"
      actions={
        <div className="flex items-center gap-2">
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
      }
    >
      {loading ? (
        <Skeleton className="h-16 w-full" />
      ) : !scan ? (
        <p className="text-sm text-muted-foreground">Drift scan unavailable.</p>
      ) : findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No drift — this agent&apos;s files match what its package and context layers expect.
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((finding, i) => (
            <li key={i} className="rounded border border-border/60 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={finding.severity === 'error' ? 'destructive' : 'secondary'}>
                  {finding.type}
                </Badge>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {finding.file ?? finding.target ?? ''}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{finding.message}</p>
              {finding.staleInputs && finding.staleInputs.length > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Changed inputs: <span className="font-mono">{finding.staleInputs.join(', ')}</span>
                </p>
              )}
              {finding.hint && <p className="mt-0.5 text-xs text-muted-foreground/80">{finding.hint}</p>}
            </li>
          ))}
        </ul>
      )}
      {syncError && <p className="mt-2 text-sm text-red-400">{syncError}</p>}
      {locked.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {locked.length} file(s) are locked from sync because you edited them — reclaim from the CLI if you want the package version back.
        </p>
      )}
      {receipt && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last sync {new Date(receipt.syncedAt).toLocaleString()}
          {receipt.checkOnly ? ' (check only)' : ''} · verification {receipt.verification?.status ?? 'unknown'}
        </p>
      )}
      <ChartExplainer>
        Drift means this agent&apos;s live files no longer match what Bakin composed for it — usually a
        stale layer or an in-place edit. &ldquo;Sync now&rdquo; recomposes managed content; your own edits
        outside managed blocks are never touched.
      </ChartExplainer>
    </Panel>
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
  const reportRes = useTimedJsonFetch<ContextReportPayload>(
    `/api/context-report/${encodeURIComponent(agentId)}`,
  )
  const settingsRes = useTimedJsonFetch<{ dispatch?: { contextBudgetBytes?: number } }>('/api/settings')
  const loading = reportRes.loading || settingsRes.loading
  const payload = reportRes.data
  const configured = settingsRes.data?.dispatch?.contextBudgetBytes
  const budget =
    typeof configured === 'number' && configured > 0 ? configured : null

  if (loading) return <Panel title="Context budget"><Skeleton className="h-16 w-full" /></Panel>
  const report = payload?.report
  if (!report) {
    return (
      <Panel
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
        <p className="text-sm text-muted-foreground">
          Context report unavailable{reportRes.error === 'Request timed out.' ? ' because the request timed out.' : '.'}
        </p>
      </Panel>
    )
  }

  const estimated = report.dispatch.estimatedMaxTaskBytes
  const pct = budget === null ? null : Math.min(100, (estimated / budget) * 100)
  const over = budget === null ? false : estimated > budget
  const topSections = [...report.dispatch.task.sections].sort((a, b) => b.bytes - a.bytes).slice(0, 5)
  const observedInputs = report.observed.runs
    .map((r) => r.inputTokens)
    .filter((n): n is number => n !== null)
    .reverse()

  return (
    <Panel title="Context budget">
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span>
              Estimated per-dispatch context:{' '}
              <span className={`font-medium ${over ? 'text-amber-400' : ''}`}>{formatBytes(estimated)}</span>
              {budget !== null && (
                <span className="text-muted-foreground"> of {formatBytes(budget)} budget</span>
              )}
            </span>
            {budget === null ? (
              <Badge variant="secondary">budget unknown</Badge>
            ) : over ? (
              <Badge variant="secondary" className="text-amber-400">over budget</Badge>
            ) : null}
          </div>
          {pct === null ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 px-3 py-2">
              <p className="text-sm text-muted-foreground">Configured budget unavailable.</p>
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
          ) : (
            <div className="h-2 overflow-hidden rounded-full bg-border/60">
              <div
                className={`h-full rounded-full ${over ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Largest prompt sections</h4>
          {topSections.map((s) => (
            <div key={s.source} className="flex items-center justify-between text-sm">
              <span className="truncate font-mono text-xs text-muted-foreground">{s.source}</span>
              <span className="tabular-nums">{formatBytes(s.bytes)}</span>
            </div>
          ))}
        </div>

        {report.workspace.available && report.workspace.files.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Workspace files ({formatBytes(report.workspace.totalBytes)} total)
            </h4>
            {report.workspace.files.slice(0, 8).map((f) => (
              <div key={f.name} className="flex items-center justify-between text-sm">
                <span className="truncate font-mono text-xs text-muted-foreground">{f.name}</span>
                <span className="tabular-nums">
                  {formatBytes(f.bytes)}
                  {typeof f.managedBlockBytes === 'number' && (
                    <span className="text-muted-foreground"> ({formatBytes(f.managedBlockBytes)} managed)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {observedInputs.length >= 2 && (
          <div className="flex items-center gap-3">
            <Sparkline values={observedInputs} label="Observed turn input tokens, oldest to newest" />
            <span className="text-xs text-muted-foreground">
              Observed turn input over the last {observedInputs.length} dispatches
              (latest {formatTokens(observedInputs[observedInputs.length - 1]!)})
            </span>
          </div>
        )}
      </div>
      <ChartExplainer>
        This is what a fresh session costs before the agent does any work. A growing number usually
        means bloated workspace files or lessons — compare the sections above with
        `bakin agents context {agentId}`.
      </ChartExplainer>
    </Panel>
  )
}

// ── Timeline panel ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  running: 'text-blue-400',
  settled: 'text-emerald-500',
  superseded: 'text-amber-500',
  lost: 'text-red-400',
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
  const [events, setEvents] = useState<TimelineEventView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const live = useAgentLiveActivity(agentId)

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
    <Panel
      title="Activity timeline"
      actions={
        <span className="flex gap-1">
          {(['24h', '7d'] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindow(w)}
              className={`rounded px-2 py-0.5 text-xs ${w === window ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {w}
            </button>
          ))}
        </span>
      }
    >
      {live && (
        <div className="mb-2 flex items-center gap-2 rounded border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm">
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
          </span>
          <span className="text-blue-300 text-xs">live</span>
          <span className="truncate text-xs text-blue-200/90" title={live.label}>{live.label}</span>
        </div>
      )}
      {loading ? (
        <Skeleton className="h-16 w-full" />
      ) : error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 px-3 py-2">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetryNonce((nonce) => nonce + 1)}
            aria-label="Retry activity timeline"
          >
            Retry
          </Button>
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity in this window.</p>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <li key={event.type === 'run' ? event.runId : `${event.ts}:${event.event}`} className="text-sm">
              {event.type === 'run' ? (
                <div className="rounded border border-border/60 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {new Date(event.startedAt).toLocaleTimeString()}
                    </span>
                    <span className="font-medium">{event.taskTitle ?? event.taskId}</span>
                    <span className={`text-xs ${STATUS_STYLES[event.status] ?? ''}`}>
                      {event.status === 'settled' ? (event.settleReason ?? 'settled') : event.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {event.model && <span>{event.model} · </span>}
                    {event.durationMs !== null ? `${formatDuration(event.durationMs) ?? ''} · ` : 'in flight · '}
                    {event.inputTokens !== null && `${formatTokens(event.inputTokens)} in`}
                    {event.outputTokens !== null && ` / ${formatTokens(event.outputTokens)} out`}
                    {event.costUsdMicros !== null && ` · $${(event.costUsdMicros / 1_000_000).toFixed(2)}`}
                    {event.routeSource && ` · via ${event.routeSource === 'class' ? 'class route' : event.routeSource}`}
                  </div>
                  {event.logs.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        {event.logs.length} progress log line(s){event.logsTruncated ? ' (truncated)' : ''}
                      </summary>
                      <ul className="mt-1 space-y-0.5 border-l border-border/60 pl-3">
                        {event.logs.map((line, i) => (
                          <li key={i} className="text-xs text-muted-foreground">
                            <span className="tabular-nums">{new Date(line.ts).toLocaleTimeString()}</span> {line.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ) : (
                <div className="flex items-baseline gap-2 px-3">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {new Date(event.ts).toLocaleTimeString()}
                  </span>
                  <span className={event.severity === 'warn' ? 'text-amber-400' : 'text-muted-foreground'}>
                    {event.severity === 'warn' ? '⚠ ' : ''}{event.message}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <ChartExplainer>
        Every row is one dispatched run — what it cost and how it ended. Warnings between runs
        (session deaths, tool-path bypasses) are the events worth reading when something feels off.
      </ChartExplainer>
    </Panel>
  )
}

// ── The tab ──────────────────────────────────────────────────────────────────

export function DiagnosticsTab({ agentId }: { agentId: string }) {
  return (
    <div className="space-y-4">
      <DriftPanel agentId={agentId} />
      <ContextPanel agentId={agentId} />
      <TimelinePanel agentId={agentId} />
    </div>
  )
}
