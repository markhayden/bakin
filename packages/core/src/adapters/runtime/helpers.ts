import type { AgentRuntimeAdapter, RuntimeAgent } from './concepts'

export function selectRuntimeMainAgent(agents: RuntimeAgent[]): RuntimeAgent | null {
  return agents.find((agent) => agent.id === 'main')
    ?? agents.find((agent) => agent.role?.toLowerCase() === 'orchestrator')
    ?? agents[0]
    ?? null
}

export async function getRuntimeMainAgent(runtime: AgentRuntimeAdapter): Promise<RuntimeAgent | null> {
  return selectRuntimeMainAgent(await runtime.agents.list())
}

export async function getRuntimeMainAgentId(runtime: AgentRuntimeAdapter, fallback = 'main'): Promise<string> {
  return (await getRuntimeMainAgent(runtime))?.id ?? fallback
}

export async function getRuntimeMainAgentName(runtime: AgentRuntimeAdapter, fallback = 'Main'): Promise<string> {
  return (await getRuntimeMainAgent(runtime))?.name ?? fallback
}
