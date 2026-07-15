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
import { stableKeyPart } from './key'
import type { AgentRuntimeAdapter } from '../../../../packages/core/src/adapters/runtime'
import { healthHealthy, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput } from '@makinbakin/sdk'

const DEFAULT_BUDGET_BYTES = 64 * 1024

export async function checkStartupContextSize(runtime: AgentRuntimeAdapter): Promise<HealthCheckRunInput> {
  const configured = getSettings().dispatch?.contextBudgetBytes
  const budget = typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_BUDGET_BYTES

  let agents
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    // Reachability is the `runtime` check's job — a cost check shouldn't double-alert.
    return healthObserved([healthUnknown({
      key: 'roster',
      summary: 'Startup-context size could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'runtime-unavailable',
        title: 'Startup-context size is unknown',
        impact: 'Health cannot estimate how much context each agent receives at dispatch.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'active', label: 'Active runtime' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun after runtime recovery' },
      },
    })])
  }
  if (agents.length === 0) {
    return healthNotApplicable('There are no agents in the runtime roster to estimate.')
  }

  let mainAgentId: string
  try {
    mainAgentId = await getRuntimeMainAgentId(runtime)
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'main-agent',
      summary: 'Startup-context size could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'main-agent-unavailable',
        title: 'Main agent identity is unknown',
        impact: 'Health cannot calculate accurate per-agent startup context without the main-agent relationship.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'active', label: 'Active runtime' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }
  const contentDir = getContentDir()
  const observations: HealthObservationInput[] = []
  for (const agent of agents) {
    const agentLabel = agent.id.slice(0, 120)
    const est = estimateMaxTaskDispatchBytes(agent.id, mainAgentId, contentDir)
    if (est.totalBytes > budget) {
      const top = [...est.components]
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 3)
        .map((c) => `${c.source}=${c.bytes}B`)
        .join(', ')
      observations.push(healthWarning({
        key: `agent:${stableKeyPart(agent.id)}`,
        summary: `${agentLabel}'s startup context exceeds its budget.`,
        detail: `Estimated ${est.totalBytes} bytes against a ${budget}-byte budget. Largest components: ${top}. Dispatch remains enabled.`,
        evidence: {
          agentId: agent.id.slice(0, 500),
          totalBytes: est.totalBytes,
          budgetBytes: budget,
          components: est.components.map(({ source, bytes }) => ({ source, bytes })),
        },
        incident: {
          key: `over-budget:${stableKeyPart(agent.id)}`,
          title: 'Startup context exceeds the configured budget',
          impact: 'Large injected context increases token use and may crowd out task-relevant information, but does not block dispatch.',
          disposition: 'watch',
          resources: [{ kind: 'agent', id: stableKeyPart(agent.id), label: agentLabel }],
          resolution: {
            key: 'open-agent-diagnostics',
            type: 'navigate',
            label: 'Review agent diagnostics',
            href: `/team/${encodeURIComponent(agent.id.slice(0, 1_000))}?tab=diagnostics`,
          },
        },
      }))
    }
  }

  if (observations.length === 0) {
    return healthObserved([healthHealthy({
      key: 'budget',
      summary: `All ${agents.length} agent${agents.length === 1 ? ' is' : 's are'} within the startup-context budget.`,
      detail: `${budget} bytes per dispatch (dispatch.contextBudgetBytes).`,
      evidence: { agentCount: agents.length, budgetBytes: budget },
    })])
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}
