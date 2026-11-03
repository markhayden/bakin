/**
 * System check — usage.agent-burn (#385).
 *
 * Warn-only heuristics over agent token burn: heavy effort with no completed
 * tasks, spikes vs the agent's own baseline, and usage outside Bakin-managed
 * tasks (unattributed). The arithmetic lives in src/core/agent-burn.ts — the
 * SAME engine behind /agent-effort and the effort card, so the doctor, the
 * dashboard, and the CLI can never disagree. Settings (settings.burn) are
 * re-read every run; a flag is a prompt to look, never an enforcement action.
 */
import {
  buildAgentBurnReports,
  coverageCanFlagSessions,
  type BurnFlag,
  type ScheduledJobEvidence,
} from '../../../../src/core/agent-burn'
import { LedgerUnavailableError } from '../../../../src/core/execution-ledger'
import {
  getLastUsageScan,
  getUsageHistoryScanStaleAfterMs,
  isUsageHistoryScanInFlight,
} from '../../../../src/core/usage-history-timer'
import { healthError, healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthObservationInput } from '@makinbakin/sdk'
import { stableKeyPart } from './key'

/** Row 44: an unreachable usage ledger is the fallback lane's; row 50: a running runaway is the operator's decision (Pause agent dispatch on the diagnostics tab); every other row is an observation. */
export const AGENT_BURN_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'ledger-unavailable', subjectKind: 'system', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
  { id: 'runaway-usage', subjectKind: 'agent', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
]

function incompleteMeteringObservation(
  reports: Array<{
    agent: string
    runs: number
    tokenApplicableRuns: number
    tokenMeteredRuns: number
    tokenAggregateRepresentable: boolean
  }>,
): HealthObservationInput {
  const runCount = reports.reduce((sum, report) => sum + report.runs, 0)
  const applicableRunCount = reports.reduce((sum, report) => sum + report.tokenApplicableRuns, 0)
  const meteredRunCount = reports.reduce((sum, report) => sum + report.tokenMeteredRuns, 0)
  const unrepresentableAgents = reports
    .filter((report) => !report.tokenAggregateRepresentable)
    .map((report) => report.agent)
  const detail = unrepresentableAgents.length > 0
    ? `${meteredRunCount} of ${applicableRunCount} token-bearing recorded calls reported totals, but ${unrepresentableAgents.length} agent aggregate${unrepresentableAgents.length === 1 ? '' : 's'} exceeded the safe reporting range.`
    : `${meteredRunCount} of ${applicableRunCount} token-bearing recorded calls reported totals across ${reports.length} agent(s).`
  return healthUnknown({
    key: 'metering',
    summary: 'Agent token burn metering is incomplete.',
    detail,
    evidence: {
      agents: reports.map((report) => report.agent),
      runs: runCount,
      tokenApplicableRuns: applicableRunCount,
      tokenMeteredRuns: meteredRunCount,
      unrepresentableAggregateAgents: unrepresentableAgents,
    },
  })
}

function unrepresentableCostObservation(
  reports: Array<{ agent: string; runs: number; costedRuns: number; costAggregateRepresentable: boolean }>,
): HealthObservationInput {
  const affected = reports.filter((report) => !report.costAggregateRepresentable)
  const costedRunCount = affected.reduce((sum, report) => sum + report.costedRuns, 0)
  return healthUnknown({
    key: 'cost-aggregation',
    summary: 'Agent cost totals could not be represented safely.',
    detail: `${affected.length} agent aggregate${affected.length === 1 ? '' : 's'} exceeded the safe reporting range across ${costedRunCount} priced call${costedRunCount === 1 ? '' : 's'}.`,
    evidence: {
      agents: affected.map((report) => report.agent),
      costedRuns: costedRunCount,
    },
  })
}

export async function checkAgentBurnWith(
  deps: {
    buildReports?: typeof buildAgentBurnReports
    lastUsageScan?: typeof getLastUsageScan
    scanStaleAfterMs?: () => number
    now?: () => number
    /** Cron-guard evidence fetch (D11); null = no cron surface / read failed. */
    scheduledJobs?: () => Promise<ScheduledJobEvidence[] | null>
  } = {},
): Promise<HealthCheckRunInput> {
  let reports
  const lastScan = (deps.lastUsageScan ?? getLastUsageScan)()
  const now = (deps.now ?? Date.now)()
  const staleAfterMs = (deps.scanStaleAfterMs ?? getUsageHistoryScanStaleAfterMs)()
  const scanAgeMs = lastScan ? Math.max(0, now - lastScan.at) : null
  const scanInFlight = isUsageHistoryScanInFlight()
  const scanFresh = !scanInFlight && scanAgeMs !== null && scanAgeMs <= staleAfterMs
  // Stale transcript rows remain useful history, but cannot create a new
  // spike/unexplained verdict or a fresh healthy observation.
  const coverage = scanFresh ? lastScan?.report.coverage : { agents: [] as const }
  // Cron evidence is skipped only when NO agent can produce a runaway flag
  // (per-agent predicate — a partial fleet must not strip the D11 downgrade
  // from a fully-covered agent's page).
  const scheduledJobs = coverageCanFlagSessions(coverage) && deps.scheduledJobs
    ? await deps.scheduledJobs()
    : null
  try {
    reports = (deps.buildReports ?? buildAgentBurnReports)(now, {
      coverage,
      scheduledJobs,
    })
  } catch (err) {
    if (err instanceof LedgerUnavailableError) {
      return healthObserved([healthError({
        key: 'ledger',
        summary: 'Agent token burn cannot be evaluated.',
        detail: err.message,
        incident: {
          key: 'ledger-unavailable',
          title: 'Usage ledger is unavailable',
          class: 'service_failure',
          impact: 'Health cannot detect unusually expensive agent activity without usage records (the ledger storage path or permissions are the usual cause).',
          disposition: 'action_required',
          subject: { kind: 'system', id: 'usage-ledger', label: 'Usage ledger' },
          declarationId: 'ledger-unavailable',
          resources: [{ kind: 'system', id: 'execution-ledger', label: 'Execution ledger' }],
          resolution: { key: 'restore-ledger', type: 'repair', label: 'Investigate the usage ledger', actionId: 'core.diagnose' },
        },
      })])
    }
    return healthObserved([healthUnknown({
      key: 'usage',
      summary: 'Agent token burn could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
    })])
  }

  const flagged = reports.filter((r) => r.flags.length > 0)
  const incompletelyMetered = reports.filter((report) => report.windowTokens === null)
  const meteringUnknown = incompletelyMetered.length > 0
    ? incompleteMeteringObservation(incompletelyMetered)
    : null
  const unrepresentableCosts = reports.filter((report) => !report.costAggregateRepresentable)
  const costAggregationUnknown = unrepresentableCosts.length > 0
    ? unrepresentableCostObservation(unrepresentableCosts)
    : null
  if (flagged.length === 0) {
    const incompleteCoverage = !scanFresh
      || lastScan?.report.coverage.status !== 'complete'
      || reports.some((report) => report.totalObservedTokens === null)
    if (incompleteCoverage) {
      const coverageReason = lastScan
        ? scanInFlight
          ? 'scan_in_progress'
          : scanFresh
          ? lastScan.report.coverage.reason
          : 'scan_stale'
        : scanInFlight ? 'scan_in_progress' : 'scan_not_run'
      // The card says WHICH state it is in and what resolves it — a bare
      // "coverage is incomplete" left operators guessing whether to wait
      // or act (field feedback, 2026-07-22).
      const coverageReasonText: Record<string, string> = {
        scan_in_progress: 'A transcript scan is running right now — this resolves itself when it completes; recheck in a minute.',
        scan_not_run: 'No transcript scan has completed since the server started — the first scan resolves this on its own; recheck in a few minutes.',
        scan_stale: 'The last transcript scan is older than its freshness window — the scanner may be stuck; rerun this check, and report it if staleness persists.',
        roster_unavailable: 'The runtime agent roster could not be read, so usage cannot be attributed per agent — check runtime reachability (`bakin check runtime`), then rerun.',
        agent_scan_failed: 'One or more agent transcript scans failed — rerun this check; if it persists, the server log names the failing agent.',
        missing_session_tier: 'The active runtime does not expose a session-transcript tier, so per-message usage cannot be observed on this adapter.',
        // The scan itself completed but an agent reported no observable
        // token totals — its sessions may not expose usage.
        complete: 'Transcripts scanned clean, but at least one agent reports no observable token totals — its runtime sessions may not expose usage data.',
      }
      // Row 46: an observation — the reason text says whether it resolves itself or the scanner is stuck.
      const transcriptUnknown = healthUnknown({
        key: 'usage',
        summary: 'Agent token burn could not be verified.',
        detail: `Runtime transcript coverage is incomplete, so zero observed usage cannot be confirmed. ${coverageReasonText[coverageReason] ?? `Coverage gap: ${coverageReason}.`}`,
        evidence: {
          coverage: scanFresh ? lastScan?.report.coverage.status ?? 'unavailable' : 'unavailable',
          reason: coverageReason,
          scanAgeMs,
          staleAfterMs,
        },
      })
      return healthObserved([
        transcriptUnknown,
        ...(meteringUnknown ? [meteringUnknown] : []),
        ...(costAggregationUnknown ? [costAggregationUnknown] : []),
      ])
    }
    if (meteringUnknown || costAggregationUnknown) {
      return healthObserved([
        ...(meteringUnknown ? [meteringUnknown] : []),
        ...(costAggregationUnknown ? [costAggregationUnknown] : []),
      ] as [HealthObservationInput, ...HealthObservationInput[]])
    }
    const scope = reports.length === 0 ? 'no agent activity in the window' : `${reports.length} agent(s) evaluated`
    return healthObserved([healthHealthy({
      key: 'usage',
      summary: 'Agent token burn looks healthy.',
      detail: scope,
      evidence: { agentCount: reports.length },
    })])
  }

  // One observation per (agent, bucket) so each signal carries its honest
  // severity: interactive is calm, unexplained asks for a look, runaway is
  // loud (or a scheduled-jobs review prompt when downgraded). Effort/spike
  // keep their combined legacy observation. UIs attribute via evidence,
  // never by parsing copy.
  const observations: HealthObservationInput[] = []
  for (const report of flagged) {
    const agentLabel = report.agent.slice(0, 120)
    const keyPart = stableKeyPart(report.agent)
    const agentResource = { kind: 'agent' as const, id: keyPart, label: agentLabel }
    const diagnosticsHref = `/team/${encodeURIComponent(report.agent.slice(0, 1_000))}?tab=diagnostics`
    const legacyFlags: BurnFlag[] = []
    for (const flag of report.flags) {
      if (flag.kind === 'interactive') {
        // Row 47: an observation (normal use).
        observations.push(healthWarning({
          key: `interactive:${keyPart}`,
          summary: `${agentLabel} has interactive session usage.`,
          detail: `${flag.message} Direct chats and TUI sessions consume tokens outside the task ledger — normal use; review ${diagnosticsHref} only if unexpected.`.slice(0, 4_000),
          evidence: { agents: [report.agent.slice(0, 500)], kinds: ['interactive'], tokens: flag.tokens },
        }))
      } else if (flag.kind === 'unexplained') {
        // Row 48: an observation; the diagnostics page is named in the detail.
        observations.push(healthWarning({
          key: `unexplained:${keyPart}`,
          summary: `${agentLabel} has unexplained token usage.`,
          detail: `${flag.message} Review ${diagnosticsHref}.`.slice(0, 4_000),
          evidence: {
            agents: [report.agent.slice(0, 500)],
            kinds: ['unexplained'],
            tokens: flag.tokens,
            spikeConcurrent: flag.spikeConcurrent,
          },
        }))
      } else if (flag.kind === 'runaway') {
        const evidence = {
          agents: [report.agent.slice(0, 500)],
          kinds: ['runaway'],
          sessions: flag.sessions.slice(0, 20),
          scheduledJobs: flag.scheduledJobs.slice(0, 50),
          downgraded: flag.downgraded,
        }
        observations.push(flag.downgraded
          // Row 49: the scheduled-jobs downgrade is an observation.
          ? healthWarning({
              key: `runaway:${keyPart}`,
              summary: `${agentLabel} has high autonomous usage.`,
              detail: `${flag.message} This runtime has scheduled jobs that may explain it — review ${diagnosticsHref} if unexpected.`.slice(0, 4_000),
              evidence,
            })
          // Row 50: a decision while it still burns — pause the agent's dispatch on its diagnostics tab.
          : healthError({
              key: `runaway:${keyPart}`,
              summary: `${agentLabel} shows possible runaway usage.`,
              detail: flag.message.slice(0, 4_000),
              evidence,
              incident: {
                key: `runaway-usage:${keyPart}`,
                title: 'Possible runaway agent usage',
                class: 'runaway_usage',
                impact: 'Autonomous token accumulation with no user interaction is actively consuming quota — investigate immediately.',
                disposition: 'action_required',
                subject: agentResource,
                declarationId: 'runaway-usage',
                required: true,
                resources: [agentResource],
                resolution: { key: 'open-agent-diagnostics', type: 'human', needs: 'decision', label: 'Review and pause the agent', href: diagnosticsHref },
              },
            }))
      } else {
        legacyFlags.push(flag)
      }
    }
    if (legacyFlags.length > 0) {
      // Row 51: an observation; the diagnostics page is named in the detail.
      observations.push(healthWarning({
        key: `agent:${keyPart}`,
        summary: `${agentLabel} has unusual token burn.`,
        detail: `${legacyFlags.slice(0, 20).map((flag) => flag.message).join(' | ')} Review ${diagnosticsHref}.`.slice(0, 4_000),
        evidence: {
          agents: [report.agent.slice(0, 500)],
          kinds: legacyFlags.slice(0, 50).map((flag) => flag.kind.slice(0, 500)),
        },
      }))
    }
  }
  if (meteringUnknown) observations.push(meteringUnknown)
  if (costAggregationUnknown) observations.push(costAggregationUnknown)
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

export async function checkAgentBurn(
  scheduledJobs?: () => Promise<ScheduledJobEvidence[] | null>,
): Promise<HealthCheckRunInput> {
  return checkAgentBurnWith({ scheduledJobs })
}
