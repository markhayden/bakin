/**
 * System-prompt assembly from the agent's canonical workspace files.
 *
 * Pi auto-discovers AGENTS.md from the session cwd (= the agent workspace),
 * so agent-package projections into AGENTS.md work with zero prompt code.
 * The OTHER canonical files (SOUL/IDENTITY/TOOLS/…) don't enter Pi context
 * natively — they append to the system prompt here, in a stable labeled
 * order so the bytes are deterministic and measurable (#357 discipline:
 * workspaceFileStats reports exactly these files).
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { getAgentWorkspaceDir } from './home'

/** Canonical files in fixed order; remaining root *.md files follow alphabetically. */
const CANONICAL_ORDER = ['SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'USER.md']

/** AGENTS.md is excluded — Pi loads it natively via project-context discovery. */
export function canonicalPromptFiles(agentId: string): string[] {
  const root = getAgentWorkspaceDir(agentId)
  if (!existsSync(root)) return []
  const rootMd = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md') && e.name !== 'AGENTS.md')
    .map((e) => e.name)
  const canonical = CANONICAL_ORDER.filter((name) => rootMd.includes(name))
  const rest = rootMd.filter((name) => !CANONICAL_ORDER.includes(name)).sort()
  return [...canonical, ...rest]
}

/** One labeled section per canonical file, ready for appendSystemPrompt. */
export function buildAppendSystemPrompt(agentId: string): string[] {
  const root = getAgentWorkspaceDir(agentId)
  return canonicalPromptFiles(agentId).map((name) => {
    const content = readFileSync(join(root, name), 'utf-8').trim()
    return `# ${name}\n\n${content}`
  }).filter((section) => !/\n\n$/.test(section) && section.length > 0)
}
