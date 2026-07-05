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
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

const CHECK = 'usage.agent-burn'

function result(
  status: HealthCheckResult['status'],
  message: string,
  data?: Record<string, unknown>,
): HealthCheckResult {
  return { check: CHECK, status, message, autoFixable: false, ...(data ? { data } : {}) }
}

export async function checkAgentBurn(): Promise<HealthCheckResult[]> {
  let reports
  try {
    reports = buildAgentBurnReports()
  } catch (err) {
    if (err instanceof LedgerUnavailableError) {
      return [result('error', `Burn check cannot read the execution ledger: ${err.message}`)]
    }
    return [result('error', `Burn check failed: ${err instanceof Error ? err.message : String(err)}`)]
  }

  const flagged = reports.filter((r) => r.flags.length > 0)
  if (flagged.length === 0) {
    const scope = reports.length === 0 ? 'no agent activity in the window' : `${reports.length} agent(s) evaluated`
    return [result('ok', `Token burn looks healthy — ${scope}.`)]
  }

  // One row per flagged agent keeps messages readable and lets the UI
  // attribute each flag via data.agents.
  return flagged.map((r) =>
    result('warn', r.flags.map((f) => f.message).join(' | '), {
      agents: [r.agent],
      kinds: r.flags.map((f) => f.kind),
    }),
  )
}
