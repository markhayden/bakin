import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import type { AgentRuntimeAdapter, RuntimeToolAccess } from '@bakin/core/adapters/runtime'
import { readEmbeddedBakinSkillTemplate } from './bakin-skill-template'
import { renderToolAccessInstructions } from './tool-access'
import { maybeGetAppServices } from './app-services-store'

// The bakin skill is one shared document (not per-agent), so it renders the
// tool-access section with a generic `<agent>` placeholder. Conservative
// out-of-process `mcp` default when app services aren't up.
const DEFAULT_TOOL_ACCESS: RuntimeToolAccess = { style: 'mcp', mcpServerTemplate: 'bakin-<agent>' }

function activeToolAccess(): RuntimeToolAccess {
  try {
    return maybeGetAppServices()?.runtime.describeToolAccess?.() ?? DEFAULT_TOOL_ACCESS
  } catch {
    return DEFAULT_TOOL_ACCESS
  }
}

const EXEC_TOOLS_START = '<!-- bakin:exec-tools:start -->'
const EXEC_TOOLS_END = '<!-- bakin:exec-tools:end -->'

export interface BakinSkillStatus {
  installed: boolean
  upToDate: boolean
  expected: string
  current?: string
}

/**
 * Deterministic per (template, tool-access style) — deliberately NOT a
 * function of the live exec-tool registry. Rendering registry state (tool
 * counts) into the bytes made the skill process-context-sensitive: a CLI
 * sync (no plugins activated) wrote "No exec tools registered" while the
 * server rendered the full block, so check/sync flip-flopped between
 * processes forever (found live in P5.3).
 */
function buildExecToolsBlock(toolAccess: RuntimeToolAccess): string {
  return `
## Live Exec Tools

${renderToolAccessInstructions(toolAccess, { agentId: '<agent>' })}

The Bakin skill intentionally keeps this block compact so routine agent turns do not carry a large, stale tool catalog. Common task, workflow, team, asset, schedule, and health tools are listed above in the static quick reference.
`
}

export function renderBakinRuntimeSkill(projectRoot: string, toolAccess?: RuntimeToolAccess): string {
  const sourceSkill = join(projectRoot, 'skill', 'SKILL.md')
  const templateContent = existsSync(sourceSkill)
    ? readFileSync(sourceSkill, 'utf-8')
    : readEmbeddedBakinSkillTemplate()
  const startIdx = templateContent.indexOf(EXEC_TOOLS_START)
  const endIdx = templateContent.indexOf(EXEC_TOOLS_END)
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`skill/SKILL.md template is missing the ${EXEC_TOOLS_START} / ${EXEC_TOOLS_END} markers`)
  }

  const before = templateContent.slice(0, startIdx + EXEC_TOOLS_START.length)
  const after = templateContent.slice(endIdx)
  return `${before}${buildExecToolsBlock(toolAccess ?? activeToolAccess())}${after}`
}

export async function checkBakinRuntimeSkill(
  projectRoot: string,
  runtime: AgentRuntimeAdapter,
): Promise<BakinSkillStatus> {
  // Render from THIS runtime's tool access, not global app-services state —
  // check and sync must agree in every process that holds a runtime.
  const expected = renderBakinRuntimeSkill(projectRoot, runtime.describeToolAccess?.())
  const installedSkill = await runtime.skills.get('bakin')
  const current = installedSkill?.instructions
  return {
    installed: Boolean(current),
    upToDate: current === expected,
    expected,
    ...(current ? { current } : {}),
  }
}

export async function syncBakinRuntimeSkill(
  projectRoot: string,
  runtime: AgentRuntimeAdapter,
): Promise<'installed' | 'updated' | 'noop'> {
  const status = await checkBakinRuntimeSkill(projectRoot, runtime)
  if (status.upToDate) return 'noop'

  await runtime.skills.write({
    name: 'bakin',
    instructions: status.expected,
    metadata: { source: 'bakin-onboarding' },
  })
  return status.installed ? 'updated' : 'installed'
}

export const _internals = {
  EXEC_TOOLS_START,
  EXEC_TOOLS_END,
  buildExecToolsBlock,
}
