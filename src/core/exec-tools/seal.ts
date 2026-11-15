/**
 * Serialise an exec tool's successful result for the agent — the ONE step
 * both invoke paths share (the in-process provider and the MCP server).
 * Whatever the result carries for the conversation rides a host receipt
 * (`@bakin/core/conversation/receipts`); entity references the tool does not
 * declare are dropped, logged and audited, never rendered.
 */
import { sealToolResult } from '@bakin/core/conversation/receipts'
import type { ExecToolDefinition, ExecToolResult } from '@bakin/core/plugin-types'
import { appendAudit } from '../audit'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'

const log = createLogger('exec-tools')

export function sealExecToolResult(tool: Pick<ExecToolDefinition, 'name' | 'reports'>, agentId: string, result: ExecToolResult): string {
  return sealToolResult(result, { agentId, toolName: tool.name }, {
    reports: tool.reports,
    onRejected: (refs) => {
      const kinds = refs.map((ref) => String((ref as { kind?: unknown } | null)?.kind ?? 'malformed'))
      log.warn('exec tool reported entities it does not declare', { tool: tool.name, agent: agentId, kinds })
      appendAudit(getContentDir(), 'exec.entities.rejected', agentId, { tool: tool.name, kinds, declared: tool.reports ?? [] }, 'mcp')
    },
  })
}
