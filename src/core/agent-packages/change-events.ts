/**
 * The in-process notice that the agent-package lockfile changed (#1007 B,
 * review r2 #3). Sync and migration already broadcast `agent_pkg:changed`
 * over SSE (which reaches the same bus); installs and removals announce here
 * so the updates engine retires a record whose installed identity just
 * changed instead of offering the version that was installed a moment ago.
 * Bus-only: nothing to render for a browser beyond what the routes already
 * answer.
 */
import { observeServerEvent } from '../server-events'

export function announceAgentPackagesChanged(kind: 'installed' | 'removed', agentId?: string): void {
  observeServerEvent({ type: 'agent_pkg:changed', kind, ...(agentId ? { agentId } : {}), timestamp: new Date().toISOString() })
}
