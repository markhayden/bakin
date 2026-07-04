/**
 * bakin_exec_memory_status — indexer health snapshot.
 *
 * Same counts-by-tier shape the /status REST route returns, but in the
 * exec-tool response envelope so agents can read it without needing an
 * HTTP round-trip. Counting lives in lib/status-snapshot.ts, shared with
 * the REST route so the two surfaces can't drift.
 */
import type { ExecToolDefinition, PluginContext } from '@bakin/core/plugin-types'
import { statusSnapshot } from '../lib/status-snapshot'

export function createMemoryStatusTool(ctx: PluginContext): ExecToolDefinition {
  return {
    name: 'bakin_exec_memory_status',
    label: 'Read memory status',
    description: 'Indexer health: per-tier row counts, offset tracking, snapshot timestamp.',
    parameters: {},
    handler: async () => {
      return { ok: true, ...(await statusSnapshot(ctx)) }
    },
  }
}
