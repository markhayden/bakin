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
import { buildAgentBurnReports } from '../../../../src/core/agent-burn'
import { LedgerUnavailableError } from '../../../../src/core/execution-ledger'
import { healthError, healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput } from '@makinbakin/sdk'

export async function checkAgentBurn(): Promise<HealthCheckRunInput> {
  let reports
  try {
    reports = buildAgentBurnReports()
  } catch (err) {
    if (err instanceof LedgerUnavailableError) {
      return healthObserved([healthError({
        key: 'ledger',
        summary: 'Agent token burn cannot be evaluated.',
        detail: err.message,
        incident: {
          key: 'ledger-unavailable',
          title: 'Usage ledger is unavailable',
          impact: 'Health cannot detect unusually expensive agent activity without usage records.',
          disposition: 'action_required',
          resources: [{ kind: 'system', id: 'execution-ledger', label: 'Execution ledger' }],
          resolution: {
            key: 'restore-ledger',
            type: 'instructions',
            label: 'Restore usage records',
            steps: ['Check the execution-ledger storage path and permissions, then rerun Health.'],
          },
        },
      })])
    }
    return healthObserved([healthUnknown({
      key: 'usage',
      summary: 'Agent token burn could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'evaluation-failed',
        title: 'Agent token burn is unknown',
        impact: 'Health cannot determine whether agents are using tokens unusually quickly.',
        disposition: 'watch',
        resources: [{ kind: 'system', id: 'usage', label: 'Usage telemetry' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }

  const flagged = reports.filter((r) => r.flags.length > 0)
  if (flagged.length === 0) {
    const scope = reports.length === 0 ? 'no agent activity in the window' : `${reports.length} agent(s) evaluated`
    return healthObserved([healthHealthy({
      key: 'usage',
      summary: 'Agent token burn looks healthy.',
      detail: scope,
      evidence: { agentCount: reports.length },
    })])
  }

  // One row per flagged agent keeps messages readable and lets the UI
  // attribute each flag via data.agents.
  const observations = flagged.map<HealthObservationInput>((report) => {
    const agentLabel = report.agent.slice(0, 120)
    return healthWarning({
      key: `agent:${stableKeyPart(report.agent)}`,
      summary: `${agentLabel} has unusual token burn.`,
      detail: report.flags.slice(0, 20).map((flag) => flag.message).join(' | ').slice(0, 4_000),
      evidence: {
        agents: [report.agent.slice(0, 500)],
        kinds: report.flags.slice(0, 50).map((flag) => flag.kind.slice(0, 500)),
      },
      incident: {
        key: `unusual-burn:${stableKeyPart(report.agent)}`,
        title: 'Agent token burn needs review',
        impact: 'High, spiking, or unattributed usage may increase cost without corresponding completed work.',
        disposition: 'watch',
        resources: [{ kind: 'agent', id: stableKeyPart(report.agent), label: agentLabel }],
        resolution: {
          key: 'open-agent-diagnostics',
          type: 'navigate',
          label: 'Review agent diagnostics',
          href: `/team/${encodeURIComponent(report.agent.slice(0, 1_000))}?tab=diagnostics`,
        },
      },
    })
  })
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

function stableKeyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]/g, '-').slice(0, 100) || 'unknown'
}
