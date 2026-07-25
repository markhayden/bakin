/**
 * The ONE host-side meter hook for interactive conversational turns
 * (work class 'chat', metered-only). Chat and brands consume this;
 * external plugins get the equivalent via the plugin-context factory's
 * declarative `metering` config.
 *
 * Lives OUTSIDE conversation-turns.ts on purpose: the engine module is
 * bundled into the published SDK testing harness, and agent-cost's module
 * graph (execution ledger + its native SQLite driver) must never enter
 * that package's declaration dependency graph.
 */
import type { ConversationTurnServiceConfig } from './conversation-turns'
import { createLogger } from './logger'

const log = createLogger('conversation-metering')

export function createChatMeterHook(
  runId: (key: string, turnId: string) => string,
): NonNullable<ConversationTurnServiceConfig['hooks']>['meter'] {
  return async ({ key, agentId, turnId, usage }) => {
    try {
      const { meterAgentTurn } = await import('./agent-cost')
      await meterAgentTurn({
        runId: runId(key, turnId),
        agent: agentId,
        activityClass: 'user',
        workClass: 'chat',
        result: { id: turnId, content: '', ...(usage ? { usage } : {}) },
      })
    } catch (err) {
      log.error(`turn metering failed for ${key}`, err as Error)
    }
  }
}
