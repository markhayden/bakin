/**
 * Honest degradation for surfaces Pi does not have (SPEC D3/AD6):
 *
 *   channels — no delivery layer: empty list, typed failure on send;
 *              UIs show the empty state, workflow gates have no vehicle
 *              until the Discord fast-follow.
 *   cron     — Pi agents create no runtime crons: empty reads, typed
 *              failure on mutation (Bakin-task scheduling is Bakin-owned
 *              and unaffected — see bakin-owned-scheduler).
 *   tools.invoke — no runtime-native tool registry to address (zero
 *              production callers today; typed failure keeps it honest).
 *
 * Everything throws RuntimeError kind 'runtime_failed' with an explicit
 * "not supported by the pi runtime" message — never a silent no-op, never
 * fabricated success.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { RuntimeError } from '@bakin/core/adapters/runtime'

function unsupported(surface: string): never {
  throw new RuntimeError(`adapter-pi: ${surface} is not supported by the pi runtime`, {
    kind: 'runtime_failed',
  })
}

export function createChannelsSurface(): AgentRuntimeAdapter['channels'] {
  return {
    list: async () => [],
    sendNotification: async () => unsupported('channels.sendNotification'),
    sendMessage: async () => unsupported('channels.sendMessage'),
    deliverContent: async () => unsupported('channels.deliverContent'),
    createApproval: async () => unsupported('channels.createApproval'),
    editApproval: async () => unsupported('channels.editApproval'),
    cancelApproval: async () => unsupported('channels.cancelApproval'),
    resolveApproval: async () => unsupported('channels.resolveApproval'),
    // No provider decisions will ever arrive — a no-op unsubscribe is the
    // honest subscription to an empty stream.
    subscribeApprovalResponses: () => () => {},
  }
}

export function createCronSurface(): AgentRuntimeAdapter['cron'] {
  return {
    list: async () => [],
    get: async () => null,
    listRuns: async () => [],
    getRaw: async () => null,
    create: async () => unsupported('cron.create'),
    update: async () => unsupported('cron.update'),
    remove: async () => unsupported('cron.remove'),
    runNow: async () => unsupported('cron.runNow'),
    restoreRaw: async () => unsupported('cron.restoreRaw'),
  }
}

export function createToolsSurface(): AgentRuntimeAdapter['tools'] {
  return {
    invoke: async () => unsupported('tools.invoke'),
  }
}
