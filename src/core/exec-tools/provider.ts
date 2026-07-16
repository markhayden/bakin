/**
 * RuntimeExecToolProvider — the in-process seam that hands Bakin's exec-tool
 * registry to runtime adapters (AdapterInitOpts.execTools).
 *
 * OpenClaw agents reach the same registry over HTTP MCP (mcp-server.ts);
 * this provider is the equivalent for runtimes that register tools directly
 * in the agent session (Pi). It mirrors the MCP path's per-call bookkeeping
 * — usage recording + exec.* audit rows + result text formatting — so a
 * tool call looks identical in the dashboard regardless of transport.
 * Per-turn allow/deny policy is NOT applied here: the adapter filters the
 * tool set per MessageArgs (toolsMode/toolsAllow/toolsDeny) at session
 * build, which is where the runtime decides what the model can see.
 */
import { z } from 'zod'

import type { RuntimeExecToolDescriptor, RuntimeExecToolInvokeResult, RuntimeExecToolProvider } from '@bakin/core/adapters/shared'
import { appendAudit } from '../audit'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { recordUsage } from '../usage'
// Namespace import: several suites mock.module() the registry with partial
// export sets; named imports would fail the whole import graph.
import * as registry from './registry'

const log = createLogger('exec-tool-provider')

function toDescriptor(tool: { name: string; description: string; parameters: z.ZodRawShape }): RuntimeExecToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    parametersSchema: z.toJSONSchema(z.object(tool.parameters), { io: 'input' }) as Record<string, unknown>,
  }
}

export function createRuntimeExecToolProvider(): RuntimeExecToolProvider {
  return {
    list(): RuntimeExecToolDescriptor[] {
      const out: RuntimeExecToolDescriptor[] = []
      for (const tool of registry.getAllExecTools()) {
        try {
          out.push(toDescriptor(tool))
        } catch (err) {
          // One unconvertible schema must not hide the rest of the registry.
          log.error(`exec tool ${tool.name} has an unconvertible schema — skipped`, err as Error)
        }
      }
      return out
    },

    async invoke(name, params, agentId): Promise<RuntimeExecToolInvokeResult> {
      const tool = registry.getExecTool(name)
      if (!tool) {
        return { ok: false, text: `ERROR: unknown exec tool: ${name}` }
      }
      const activityClass = tool.activityClass ?? 'user'
      const start = Date.now()
      const taskId = params.taskId as string | undefined
      log.info('Exec tool called (runtime-native)', { tool: name, agent: agentId, taskId })
      // Parity with the MCP path, where the SDK zod-parses params against the
      // declared shape before the handler runs. Handlers are typed
      // `z.infer<ZodObject<Shape>>` — without this parse that typing would be
      // theater on the runtime-native path.
      const parsedParams = z.object(tool.parameters).safeParse(params)
      if (!parsedParams.success) {
        const detail = parsedParams.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')
        log.warn('Exec tool rejected: invalid parameters (runtime-native)', { tool: name, agent: agentId, detail })
        return { ok: false, text: `ERROR: invalid parameters for ${name}: ${detail}` }
      }
      try {
        const result = await tool.handler(
          parsedParams.data as Record<string, unknown>,
          agentId,
          typeof registry.getToolContext === 'function' ? registry.getToolContext(name) : undefined,
        )
        const durationMs = Date.now() - start
        recordUsage({
          kind: 'mcp',
          activityClass,
          name,
          agent: agentId,
          durationMs,
          status: result.ok ? 'ok' : 'error',
          meta: {
            taskId,
            label: tool.label,
            via: 'runtime-native',
            ...(result.ok ? {} : { error: String(result.error || 'unknown') }),
          },
        })
        appendAudit(
          getContentDir(),
          result.ok ? `exec.${name}.ok` : `exec.${name}.fail`,
          agentId,
          { taskId, label: tool.label, via: 'runtime-native', ...(tool.activityDuplicate ? { duplicate: true } : {}), ...(result.ok ? {} : { error: result.error }) },
          'mcp',
        )
        const text = result.ok
          ? JSON.stringify(result, null, 2)
          : `ERROR: ${result.error}${result.details ? '\n' + JSON.stringify(result.details, null, 2) : ''}`
        return { ok: result.ok, text }
      } catch (err) {
        const durationMs = Date.now() - start
        const message = err instanceof Error ? err.message : String(err)
        log.error(`exec tool ${name} threw`, err as Error, { agent: agentId })
        recordUsage({
          kind: 'mcp',
          activityClass,
          name,
          agent: agentId,
          durationMs,
          status: 'error',
          meta: { taskId, label: tool.label, via: 'runtime-native', error: message },
        })
        appendAudit(getContentDir(), `exec.${name}.fail`, agentId, { taskId, via: 'runtime-native', error: message }, 'mcp')
        return { ok: false, text: `ERROR: ${message}` }
      }
    },
  }
}
