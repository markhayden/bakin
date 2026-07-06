/**
 * System check — startup-context size (#357).
 *
 * Warn-only guardrail on per-dispatch Bakin-injected context: static prompt
 * sections (measured from the real builders) plus configured dynamic caps,
 * compared to `dispatch.contextBudgetBytes`. It NEVER blocks dispatch —
 * startup context size is a cost concern, not a correctness failure. The
 * arithmetic is the context-report engine's, so this check, the CLI, and the
 * REST report can't disagree. Settings are re-read every run (watchdog-style,
 * no restart needed).
 *
 * Distinct from `bakin diagnostics startup`, which measures server boot
 * timing — this check is about what a fresh agent SESSION costs.
 */
import { getSettings } from '../../../../src/core/settings'
import { getContentDir } from '../../../../src/core/content-dir'
import { estimateMaxTaskDispatchBytes } from '../../../../src/core/context-report'
import { getRuntimeMainAgentId } from '../../../../packages/core/src/adapters/runtime'
import type { AgentRuntimeAdapter } from '../../../../packages/core/src/adapters/runtime'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

const CHECK = 'context.startup-size'
const DEFAULT_BUDGET_BYTES = 64 * 1024

function result(
  status: HealthCheckResult['status'],
  message: string,
  data?: Record<string, unknown>,
): HealthCheckResult {
  return { check: CHECK, status, message, autoFixable: false, ...(data ? { data } : {}) }
}

export async function checkStartupContextSize(runtime: AgentRuntimeAdapter): Promise<HealthCheckResult[]> {
  const configured = getSettings().dispatch?.contextBudgetBytes
  const budget = typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_BUDGET_BYTES

  let agents
  try {
    agents = await runtime.agents.list()
  } catch {
    // Reachability is the `runtime` check's job — a cost check shouldn't double-alert.
    return [result('ok', 'Skipped — runtime unreachable (see the runtime check).')]
  }
  if (agents.length === 0) {
    return [result('ok', 'No agents in the runtime roster.')]
  }

  const mainAgentId = await getRuntimeMainAgentId(runtime)
  const contentDir = getContentDir()
  const over: string[] = []
  const overAgents: string[] = []
  for (const agent of agents) {
    const est = estimateMaxTaskDispatchBytes(agent.id, mainAgentId, contentDir)
    if (est.totalBytes > budget) {
      const top = [...est.components]
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 3)
        .map((c) => `${c.source}=${c.bytes}B`)
        .join(', ')
      over.push(`${agent.id} ~${est.totalBytes}B (top: ${top})`)
      overAgents.push(agent.id)
    }
  }

  if (over.length === 0) {
    return [result('ok', `All ${agents.length} agent(s) within the ${budget}B per-dispatch context budget (dispatch.contextBudgetBytes).`)]
  }
  return [result(
    'warn',
    `${over.length} agent(s) exceed the ${budget}B per-dispatch context budget: ${over.join('; ')}. `
    + 'Warn-only — dispatch is never blocked. Inspect with `bakin agents context <id>`; '
    + 'tune caps or raise dispatch.contextBudgetBytes.',
    { agents: overAgents },
  )]
}
