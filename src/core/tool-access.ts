/**
 * The ONE renderer for a runtime's tool-access instructions (P1.2).
 *
 * A runtime declares HOW its agents reach Bakin's `bakin_exec_*` tools via
 * `describeToolAccess()` → {@link RuntimeToolAccess}. This module turns that
 * declaration into the agent-facing instruction block. Both the projected
 * AGENTS.md role layer and the per-dispatch prompt render through here (P1.4),
 * so the two surfaces can never drift.
 *
 * Style intent:
 *  - `in-process`  — exec tools are first-class session tools; bare calls,
 *                    no cheat-sheet (the agent discovers the live set).
 *  - `mcp`         — tools appear as native MCP tools under a per-agent
 *                    server; prefixed calls, still discovered live.
 *  - `cli-shim`    — tools are reached through a shell command; the exhaustive
 *                    cheat-sheet IS warranted here because the invocation is
 *                    non-obvious and easy to get wrong.
 */
import type { RuntimeToolAccess } from '@bakin/core/adapters/runtime'

const AGENT_SLOT = '<agent>'
const TOOL_SLOT = '<tool>'
const ARGS_SLOT = '<args>'

export interface ToolAccessRenderOptions {
  /** Agent whose per-agent server / shim names to substitute (mcp, cli-shim). */
  agentId: string
}

/** Replace every `<agent>` slot in a per-agent template. */
function forAgent(template: string, agentId: string): string {
  return template.split(AGENT_SLOT).join(agentId)
}

/** Default cli-shim command when a runtime declares the style without one. */
const CLI_SHIM_FALLBACK = `<shim-command> ${TOOL_SLOT} ${ARGS_SLOT}`

function renderShimCall(shimCommand: string, agentId: string, tool: string, args: string): string {
  return forAgent(shimCommand, agentId).split(TOOL_SLOT).join(tool).split(ARGS_SLOT).join(args)
}

/**
 * Render ONE tool invocation in the runtime's style — the primitive shared by
 * both the standing tool-access block (below) and the per-dispatch prompt
 * authors, so invocation bytes cannot drift between the two surfaces.
 *   - in-process → `bakin_exec_x arg=1`
 *   - mcp        → `bakin-<agent>.bakin_exec_x arg=1`
 *   - cli-shim   → the shim command with `<tool>`/`<args>` filled in
 * `args` may be empty (trailing space is trimmed).
 */
export function renderToolCall(
  access: RuntimeToolAccess,
  opts: { agentId: string; tool: string; args?: string },
): string {
  const args = opts.args ?? ''
  switch (access.style) {
    case 'in-process':
      return `${opts.tool} ${args}`.trimEnd()
    case 'mcp': {
      const server = forAgent(access.mcpServerTemplate ?? `bakin-${AGENT_SLOT}`, opts.agentId)
      return `${server}.${opts.tool} ${args}`.trimEnd()
    }
    case 'cli-shim':
      return renderShimCall(access.shimCommand ?? CLI_SHIM_FALLBACK, opts.agentId, opts.tool, args).trimEnd()
  }
}

/** Core tools every agent touches — the cli-shim cheat-sheet payload. */
const CORE_TOOL_EXAMPLES: ReadonlyArray<[tool: string, args: string]> = [
  ['bakin_exec_tasks_get', 'taskId=<id>'],
  ['bakin_exec_tasks_log_progress', 'taskId=<id> message="<update>"'],
  ['bakin_exec_tasks_complete', 'taskId=<id> summary="<what you did>"'],
  ['bakin_exec_tasks_block', 'taskId=<id> reason="<what went wrong>"'],
  ['bakin_exec_assets_save', 'taskId=<id> type=<type> filePath="<path>" description="<what it is>"'],
]

/** Shared closing rules — identical across every style. */
const DISCIPLINE_LINES = [
  '- Discover the live set before you rely on a tool name — never invent one you have not confirmed.',
  '- Mutate task state ONLY through a `bakin_exec_*` tool. Editing files, the database, or CLI shortcuts bypasses the audit trail.',
  '- Delivering media in an interactive chat: generate through the Bakin image tools (or save files with `bakin_exec_assets_save`), then embed the returned asset URL in your reply as markdown — `![desc](/api/assets/<assetId>)`. Text like "here you go" with no embedded asset delivers NOTHING to the user.',
]

function renderInProcess(access: RuntimeToolAccess, agentId: string): string[] {
  return [
    '## Tool access',
    '',
    "Bakin's `bakin_exec_*` tools are available directly in your session — call them like any other tool.",
    '',
    `Example: \`${renderToolCall(access, { agentId, tool: 'bakin_exec_tasks_get', args: 'taskId=<id>' })}\``,
    '',
    ...DISCIPLINE_LINES,
  ]
}

function renderMcp(access: RuntimeToolAccess, agentId: string): string[] {
  const server = forAgent(access.mcpServerTemplate ?? `bakin-${AGENT_SLOT}`, agentId)
  return [
    '## Tool access',
    '',
    `Bakin's tools are exposed to you as native MCP tools under the \`${server}\` server — call them by their prefixed name.`,
    '',
    `Example: \`${renderToolCall(access, { agentId, tool: 'bakin_exec_tasks_get', args: 'taskId=<id>' })}\``,
    '',
    ...DISCIPLINE_LINES,
  ]
}

function renderCliShim(access: RuntimeToolAccess, agentId: string): string[] {
  const cheatSheet = CORE_TOOL_EXAMPLES.map(
    ([tool, args]) => `\`${renderToolCall(access, { agentId, tool, args })}\``,
  )
  return [
    '## Tool access',
    '',
    "Bakin's tools are reached through a shell command — pass the tool name and its arguments.",
    '',
    'Core tools you will use:',
    ...cheatSheet,
    '',
    ...DISCIPLINE_LINES,
  ]
}

/**
 * Render the runtime-specific tool-access instruction block for `agentId`.
 * Returns a single markdown string (no trailing newline).
 */
export function renderToolAccessInstructions(
  access: RuntimeToolAccess,
  opts: ToolAccessRenderOptions,
): string {
  const lines = ((): string[] => {
    switch (access.style) {
      case 'in-process':
        return renderInProcess(access, opts.agentId)
      case 'mcp':
        return renderMcp(access, opts.agentId)
      case 'cli-shim':
        return renderCliShim(access, opts.agentId)
    }
  })()
  return lines.join('\n')
}
