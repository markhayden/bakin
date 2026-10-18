/**
 * Agent-invocation context (#898 D-H5): every exec-tool call an agent makes
 * — over MCP or in-process through the runtime exec provider — runs inside
 * this AsyncLocalStorage context. Anything that must never act on an
 * agent's behalf (an approval decision, an operator-confirmed repair) asks
 * `currentAgentInvocation()` and refuses inside it.
 *
 * Always `run`, never `enterWith`: the context ends with the call. Work a
 * tool hands to an independently created queue does not inherit it; that
 * work fails closed on its own (no operator declaration).
 */
import { AsyncLocalStorage } from 'async_hooks'

export interface AgentInvocation {
  agentId: string
  tool: string
}

const storage = new AsyncLocalStorage<AgentInvocation>()

export function runAsAgentInvocation<T>(invocation: AgentInvocation, fn: () => Promise<T>): Promise<T> {
  return storage.run(invocation, fn)
}

export function currentAgentInvocation(): AgentInvocation | null {
  return storage.getStore() ?? null
}
