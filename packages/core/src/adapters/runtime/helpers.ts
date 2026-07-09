import type { AgentRuntimeAdapter, RuntimeAgent } from './concepts'

/**
 * Resolve the runtime's ORCHESTRATOR from its roster (P2.6) — a
 * runtime-declared fact, never a baked constant. Ladder:
 *
 *   1. id 'main'           — the declared-id convention both adapters seed.
 *   2. role 'orchestrator' — the declared-role generalization: a runtime
 *      whose orchestrator has a different id resolves here.
 *   3. first agent         — degraded last resort so single-agent rosters
 *      always resolve.
 *
 * The id rung leads deliberately: role text is fuzzy (OpenClaw derives it
 * from IDENTITY.md, which agent packages can set) — an installed persona
 * claiming "Orchestrator" must never outrank the declared main agent.
 */
export function selectRuntimeMainAgent(agents: RuntimeAgent[]): RuntimeAgent | null {
  return agents.find((agent) => agent.id === 'main')
    ?? agents.find((agent) => agent.role?.toLowerCase() === 'orchestrator')
    ?? agents[0]
    ?? null
}

export async function getRuntimeMainAgent(runtime: AgentRuntimeAdapter): Promise<RuntimeAgent | null> {
  return selectRuntimeMainAgent(await runtime.agents.list())
}

/**
 * Resolved orchestrator id. The `fallback` applies ONLY to an empty/unreadable
 * roster (degraded mode: runtime down mid-flight) — callers that can degrade
 * differently should pass their own.
 */
export async function getRuntimeMainAgentId(runtime: AgentRuntimeAdapter, fallback = 'main'): Promise<string> {
  return (await getRuntimeMainAgent(runtime))?.id ?? fallback
}

export async function getRuntimeMainAgentName(runtime: AgentRuntimeAdapter, fallback = 'Main'): Promise<string> {
  return (await getRuntimeMainAgent(runtime))?.name ?? fallback
}
