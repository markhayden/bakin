'use client'

/**
 * Supervision sections (#385) — the "is the runtime doing something I don't
 * know about" cards:
 *
 *  - LiveNowSection: every in-flight dispatch run (ledger truth) with
 *    running-for + heartbeat age; the empty state says plainly that nothing
 *    is running.
 *  - AttentionSection: per-agent chips derived from the CACHED doctor results
 *    (data.agents on agent-sync / context.startup-size / usage.agent-burn) —
 *    no second detection path; each chip deep-links to the agent's
 *    Diagnostics tab.
 *  - EffortSection: effort vs outcome per agent — runs, completions,
 *    Bakin-attributed vs total-observed vs unattributed tokens — with the
 *    burn flags inline. The two token columns make the store difference
 *    self-explanatory instead of contradictory.
 */
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@makinbakin/sdk/ui'
import { useQueryState } from '@makinbakin/sdk/hooks'
import { ChartExplainer } from '@makinbakin/sdk/components'
import type { PolledResult } from './use-health-data'
import { usePolledJson, HEALTH_POLL_MS } from './use-health-data'
import { formatTokenCount, formatRuntimeCost } from '../lib/format'
import type { HealthSummary, LiveNowData, AgentEffortData, AgentEffortWindow } from '../types'

// ── Live now ─────────────────────────────────────────────────────────────────

/** Heartbeat older than this renders amber — the agent may be wedged. */
const STALE_HEARTBEAT_MS = 2 * 60 * 1000

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function LiveNowSection({ refreshNonce }: { refreshNonce: number }) {
  const result = usePolledJson<LiveNowData>('/api/plugins/health/live-now', {
    intervalMs: HEALTH_POLL_MS,
    refreshNonce,
    select: (raw) => {
      const body = raw as Partial<LiveNowData> | null
      return body && Array.isArray(body.runs) ? (body as LiveNowData) : null
    },
  })
  const runs = result.data?.runs ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Running Right Now
          {runs.length > 0 && <Badge variant="secondary">{runs.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {result.error ? (
          <div className="text-sm text-muted-foreground">Live-run feed unavailable: {result.error}</div>
        ) : runs.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nothing is running right now. Agents only work when a task, schedule, or workflow dispatches them.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Agent</th>
                <th className="pb-2 font-medium">Task</th>
                <th className="pb-2 font-medium text-right">Running for</th>
                <th className="pb-2 font-medium text-right">Last heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const stale = run.heartbeatAgeMs > STALE_HEARTBEAT_MS
                return (
                  <tr key={run.runId} className="border-t border-border/60">
                    <td className="py-1.5 pr-3 font-medium">{run.agent}</td>
                    <td className="py-1.5 pr-3 truncate max-w-[280px]" title={run.taskId}>
                      {run.taskTitle ?? <span className="text-muted-foreground">{run.taskId}</span>}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{formatDuration(run.runningForMs)}</td>
                    <td className={`py-1.5 pl-3 text-right tabular-nums ${stale ? 'text-amber-500' : 'text-muted-foreground'}`}>
                      {formatDuration(run.heartbeatAgeMs)} ago{stale ? ' ⚠' : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <ChartExplainer>
          This is everything Bakin has dispatched that hasn&apos;t finished. A heartbeat that stops
          advancing while the run keeps aging usually means a stuck turn — the watchdog will step in,
          or open the agent&apos;s timeline to see what it was doing.
        </ChartExplainer>
      </CardContent>
    </Card>
  )
}

// ── Attention rollup ─────────────────────────────────────────────────────────

interface AttentionChip {
  agent: string
  kind: 'drift' | 'context' | 'burn' | 'budget'
  status: string
  message: string
}

const ATTENTION_CHECKS: Record<string, AttentionChip['kind']> = {
  'agent-sync': 'drift',
  'context.startup-size': 'context',
  'usage.agent-burn': 'burn',
  budget: 'budget',
}

const CHIP_LABEL: Record<AttentionChip['kind'], string> = {
  drift: 'drift',
  context: 'context size',
  burn: 'token burn',
  budget: 'budget',
}

interface DoctorRowLike {
  check?: string
  status?: string
  message?: string
  data?: { agents?: unknown }
}

/** Derive per-agent chips from cached doctor rows — data.agents only, never message parsing. */
export function deriveAttentionChips(results: DoctorRowLike[]): AttentionChip[] {
  const chips: AttentionChip[] = []
  for (const row of results) {
    const kind = row.check ? ATTENTION_CHECKS[row.check] : undefined
    if (!kind || row.status === 'ok' || row.status === 'fixed') continue
    const agents = Array.isArray(row.data?.agents) ? row.data.agents.filter((a): a is string => typeof a === 'string') : []
    for (const agent of agents) {
      if (!chips.some((c) => c.agent === agent && c.kind === kind)) {
        chips.push({ agent, kind, status: row.status ?? 'warn', message: row.message ?? '' })
      }
    }
  }
  return chips.sort((a, b) => a.agent.localeCompare(b.agent) || a.kind.localeCompare(b.kind))
}

export function AttentionSection({ result }: { result: PolledResult<HealthSummary> }) {
  const doctor = result.data?.doctor as { results?: DoctorRowLike[] } | null | undefined
  const hasDoctorRun = Boolean(doctor?.results)
  const chips = deriveAttentionChips(doctor?.results ?? [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Agents Needing Attention
          {chips.length > 0 && <Badge variant="destructive">{chips.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasDoctorRun ? (
          <div className="text-sm text-muted-foreground">Waiting for the first doctor run.</div>
        ) : chips.length === 0 ? (
          <div className="text-sm text-muted-foreground">All agents look healthy.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <a
                key={`${chip.agent}:${chip.kind}`}
                href={chip.kind === 'budget' ? '/models?tab=spend' : `/team/${encodeURIComponent(chip.agent)}?tab=diagnostics`}
                title={chip.message}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent ${
                  chip.status === 'error' ? 'border-red-500/50 text-red-400' : 'border-amber-500/50 text-amber-400'
                }`}
              >
                <span className="font-medium">{chip.agent}</span>
                <span className="text-muted-foreground">· {CHIP_LABEL[chip.kind]}</span>
              </a>
            ))}
          </div>
        )}
        <ChartExplainer>
          Chips come from the doctor&apos;s scheduled checks: stale agent definitions (drift), oversized
          fresh-session context, unusual token burn, and budget breaches. Click a chip to open that
          agent&apos;s diagnostics (budget chips open Models → Spend).
        </ChartExplainer>
      </CardContent>
    </Card>
  )
}

// ── Effort vs outcome ────────────────────────────────────────────────────────

const EFFORT_WINDOWS: AgentEffortWindow[] = ['24h', '7d', '30d']

export function EffortSection({ refreshNonce }: { refreshNonce: number }) {
  const [windowParam, setWindowParam] = useQueryState('ew', '24h')
  const win: AgentEffortWindow = EFFORT_WINDOWS.includes(windowParam as AgentEffortWindow)
    ? (windowParam as AgentEffortWindow)
    : '24h'

  const result = usePolledJson<AgentEffortData>(`/api/plugins/health/agent-effort?window=${win}`, {
    intervalMs: HEALTH_POLL_MS,
    refreshNonce,
    select: (raw) => {
      const body = raw as Partial<AgentEffortData> | null
      return body && Array.isArray(body.agents) ? (body as AgentEffortData) : null
    },
  })
  const rows = result.data?.agents ?? []
  const anyObserved = rows.some((r) => r.totalObservedTokens !== null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Effort vs Outcome</span>
          <span className="flex gap-1">
            {EFFORT_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowParam(w)}
                className={`rounded px-2 py-0.5 text-xs ${w === win ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {w}
              </button>
            ))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No agent activity in this window.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Agent</th>
                <th className="pb-2 font-medium text-right">Runs</th>
                <th
                  className="pb-2 font-medium text-right"
                  title="Tasks whose completion this agent reported. If another agent (or the orchestrator) reports the completion, it counts there — an agent can do the work while the completion lands elsewhere."
                >
                  Done*
                </th>
                <th className="pb-2 font-medium text-right">Bakin tokens</th>
                <th className="pb-2 font-medium text-right">Total observed</th>
                <th className="pb-2 font-medium text-right">Unattributed</th>
                <th className="pb-2 font-medium text-right">Tokens / done</th>
                <th className="pb-2 font-medium text-right">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const flagged = row.flags.length > 0
                const flagText = row.flags.map((f) => f.message).join('\n')
                return (
                  <tr key={row.agent} className="border-t border-border/60" title={flagText || undefined}>
                    <td className="py-1.5 pr-3 font-medium">
                      {flagged && <span className="mr-1 text-amber-500">⚠</span>}
                      {row.agent}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.runs}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.completions}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{formatTokenCount(row.windowTokens)}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {row.totalObservedTokens === null ? '—' : formatTokenCount(row.totalObservedTokens)}
                    </td>
                    <td className={`py-1.5 pl-3 text-right tabular-nums ${row.flags.some((f) => f.kind === 'unattributed') ? 'text-amber-500' : ''}`}>
                      {row.unattributedTokens === null ? '—' : formatTokenCount(row.unattributedTokens)}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {row.tokensPerCompletion === null ? '—' : formatTokenCount(row.tokensPerCompletion)}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {row.windowCostUsdMicros === null ? '—' : formatRuntimeCost(row.windowCostUsdMicros / 1_000_000)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <ChartExplainer>
          &ldquo;Bakin tokens&rdquo; is work Bakin dispatched; &ldquo;total observed&rdquo; is everything found in the
          agent&apos;s session transcripts. A large unattributed gap means the agent was active outside
          Bakin-managed tasks — worth a look at its recent sessions.
          {!anyObserved && ' Observed columns show — until the usage scanner has covered this window.'}
          {' '}High tokens with few completions can mean an agent is spinning — open its timeline.
          {' '}*Done counts completions the agent itself recorded.
        </ChartExplainer>
      </CardContent>
    </Card>
  )
}
