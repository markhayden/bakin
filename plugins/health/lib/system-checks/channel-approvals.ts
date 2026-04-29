/**
 * System check — runtime channel approval response capability.
 *
 * Gate approval records are durable in Bakin. Runtime channels may render the
 * request, but only channels that advertise `interactive-approval` can feed
 * approve/reject decisions back into Bakin.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { hasChannelCapability } from '@bakin/core/adapters/runtime'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

export async function checkChannelApprovals(
  runtime: Pick<AgentRuntimeAdapter, 'channels'>
): Promise<HealthCheckResult[]> {
  try {
    const channels = await runtime.channels.list()
    const interactive = channels.filter((channel) => hasChannelCapability(channel.capabilities, 'interactive-approval'))
    if (interactive.length > 0) {
      return [{
        check: 'channel-approvals',
        status: 'ok',
        message: `Interactive channel approvals available on: ${interactive.map((channel) => channel.label || channel.id).join(', ')}`,
        autoFixable: false,
      }]
    }

    return [{
      check: 'channel-approvals',
      status: 'warn',
      message: 'Runtime channel approvals are render-only. Approve/reject workflow gates in the Bakin UI until a runtime channel reports interactive-approval support.',
      autoFixable: false,
    }]
  } catch (err) {
    return [{
      check: 'channel-approvals',
      status: 'warn',
      message: `Could not inspect runtime channel approval capabilities: ${err instanceof Error ? err.message : String(err)}`,
      autoFixable: false,
    }]
  }
}
