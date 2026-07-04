/**
 * Governed whole-config access to the runtime provider's configuration —
 * the scoped counterpart of `runtime-config-raw.ts` (which gates key-level
 * reads). The audit flagged `runtime.config.get()/replace()` as an
 * ungoverned bypass of that gate: whole-config read-modify-replace flows
 * carried no typed scope and mutations left no audit trail.
 *
 * Every caller goes through here with a typed scope. Mutations append an
 * audit row; reads deliberately do NOT (the models plugin reads config on
 * every /config request — auditing reads would spam audit.jsonl and the
 * SSE feed for zero forensic value; the mutation trail is what matters).
 * The adapter-boundary architecture test enforces that `.config.get()` /
 * `.config.replace()` appear nowhere else in app or plugin code.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { appendAudit } from './audit'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'

const log = createLogger('runtime-config')

/** Typed scopes — one per sanctioned whole-config flow. Add here deliberately. */
export type RuntimeConfigScope =
  | 'onboarding.openclaw-mcp'   // ensure Bakin's MCP server entry in the runtime config
  | 'models.routing'            // models plugin: agent/model routing read-modify-replace
  | 'team.agent-inventory'      // team plugin: read the runtime's agent list shape

export async function readRuntimeConfig<T = Record<string, unknown>>(
  runtime: AgentRuntimeAdapter,
  scope: RuntimeConfigScope,
): Promise<T> {
  void scope // reads are scope-typed for call-site traceability, not audited
  return runtime.config.get<T>()
}

/**
 * Replace the whole runtime config. `detail` carries the caller's specific
 * reason (e.g. which agent/model changed) into both the audit row and the
 * adapter's own reason parameter.
 */
export async function replaceRuntimeConfig<T = Record<string, unknown>>(
  runtime: AgentRuntimeAdapter,
  next: T,
  scope: RuntimeConfigScope,
  detail?: string,
): Promise<void> {
  await runtime.config.replace(next, detail ? `${scope}: ${detail}` : scope)
  try {
    appendAudit(getContentDir(), 'runtime.config.replace', 'system', {
      scope,
      ...(detail ? { detail } : {}),
    }, 'system')
  } catch (err) {
    log.warn('Failed to audit runtime config replace', err, { scope, detail })
  }
}
