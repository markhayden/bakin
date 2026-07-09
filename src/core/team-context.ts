/**
 * Layered team context files (layered-context spec, C3).
 *
 * Context layers live as plain markdown under `~/.bakin/team/context/`:
 *
 *   global.md              — applies to every runtime agent. Wholly
 *                            user-owned (Bakin ships no global content).
 *   roles/orchestrator.md  — built-in role layer, main agent only.
 *   roles/subagent.md      — built-in role layer, every other agent.
 *   <teamId>.md            — applies to members of that OrgTeam.
 *
 * Role files use the fractal block pattern: user content outside a
 * `bakin:managed` block, Bakin-shipped default rules inside it. Binary
 * updates refresh ONLY the inner block (via `refreshRoleContextBlocks`);
 * everything else in every file is user territory. Team/global files are
 * pure user content — if Bakin ever ships defaults for them, they get the
 * same inner-block treatment.
 *
 * Files support `{{agentId}}`, `{{agentName}}`, `{{mainAgentId}}`,
 * `{{mainAgentName}}` tokens, substituted per-agent at composition time.
 *
 * Team membership is resolved through the `team.membership` hook
 * (registered by the team plugin) per the plugin-communication rule — this
 * module never reads team.json directly. Missing hook → no team layer.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  MANAGED_BLOCK_ID,
  type ComposeInputs,
} from '../../packages/core/src/agent-packages/composer'
import { extractBlock, injectBlock } from '../../packages/core/src/agent-packages/managed-blocks'
import { getContentDir } from './content-dir'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { createLogger } from './logger'
import { ROLE_DEFAULTS } from './team-context-defaults'
import { renderToolAccessInstructions } from './tool-access'
// Leaf accessor (P1.0) — safe from team-context without an import cycle.
import { maybeGetAppServices } from './app-services-store'

const log = createLogger('team-context')

export type AgentRole = 'orchestrator' | 'subagent'

export interface ContextAgentVars {
  agentId: string
  agentName: string
  mainAgentId: string
  mainAgentName: string
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export function getContextDir(): string {
  return join(getContentDir(), 'team', 'context')
}

export function getGlobalContextPath(): string {
  return join(getContextDir(), 'global.md')
}

export function getRoleContextPath(role: AgentRole): string {
  return join(getContextDir(), 'roles', `${role}.md`)
}

export function getTeamContextPath(teamId: string): string {
  return join(getContextDir(), `${teamId}.md`)
}

// ─── File seeds ──────────────────────────────────────────────────────────────

const GLOBAL_SEED = `<!--
Global context: everything in this file (outside HTML comments) reaches EVERY
runtime agent's AGENTS.md managed block on the next sync. Tokens available:
{{agentId}}, {{agentName}}, {{mainAgentId}}, {{mainAgentName}}.
-->
`

function roleSeed(role: AgentRole): string {
  const audience = role === 'orchestrator' ? 'the main (orchestrator) agent' : 'every non-main agent'
  const header = `<!--
${role === 'orchestrator' ? 'Orchestrator' : 'Subagent'} role context: reaches ${audience} on sync.
Write your own additions outside the managed block below — Bakin rewrites the
block's interior on binary updates and sync, and never touches anything
outside it. HTML comments and the block markers themselves never reach agents.
-->
`
  return injectBlock(header, MANAGED_BLOCK_ID, ROLE_DEFAULTS[role])
}

/**
 * Create the context directory + global/role files that don't exist yet.
 * Never overwrites an existing file. Returns the paths it created.
 */
export function seedContextFiles(): { created: string[] } {
  const created: string[] = []
  const writes: Array<{ path: string; content: string }> = [
    { path: getGlobalContextPath(), content: GLOBAL_SEED },
    { path: getRoleContextPath('orchestrator'), content: roleSeed('orchestrator') },
    { path: getRoleContextPath('subagent'), content: roleSeed('subagent') },
  ]
  for (const w of writes) {
    if (existsSync(w.path)) continue
    mkdirSync(dirname(w.path), { recursive: true })
    writeFileSync(w.path, w.content, 'utf-8')
    created.push(w.path)
  }
  if (created.length > 0) log.info('Seeded context files', { created })
  return { created }
}

/**
 * Refresh the Bakin-managed block inside each role context file to the
 * current shipped defaults. User content outside the block is preserved
 * byte-for-byte. Missing files are seeded. Returns the roles whose block
 * content actually changed.
 */
export function refreshRoleContextBlocks(): { updated: AgentRole[] } {
  const updated: AgentRole[] = []
  for (const role of ['orchestrator', 'subagent'] as const) {
    const path = getRoleContextPath(role)
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, roleSeed(role), 'utf-8')
      updated.push(role)
      continue
    }
    const current = readFileSync(path, 'utf-8')
    const currentBlock = extractBlock(current, MANAGED_BLOCK_ID)
    if (currentBlock === ROLE_DEFAULTS[role].trim()) continue
    writeFileSync(path, injectBlock(current, MANAGED_BLOCK_ID, ROLE_DEFAULTS[role]), 'utf-8')
    updated.push(role)
  }
  if (updated.length > 0) log.info('Refreshed role context blocks', { updated })
  return { updated }
}

/** True iff a role file's managed block matches the shipped defaults. */
export function isRoleContextCurrent(role: AgentRole): boolean {
  const path = getRoleContextPath(role)
  if (!existsSync(path)) return false
  return extractBlock(readFileSync(path, 'utf-8'), MANAGED_BLOCK_ID) === ROLE_DEFAULTS[role].trim()
}

// ─── Layer resolution ────────────────────────────────────────────────────────

export function substituteTokens(content: string, vars: ContextAgentVars): string {
  return content
    .replaceAll('{{agentId}}', vars.agentId)
    .replaceAll('{{agentName}}', vars.agentName)
    .replaceAll('{{mainAgentId}}', vars.mainAgentId)
    .replaceAll('{{mainAgentName}}', vars.mainAgentName)
}

/**
 * Flatten a context file to its effective text: bakin block MARKER lines are
 * dropped (the interior is kept — nesting markers inside the agent file's
 * outer block would corrupt block parsing) and HTML comments are stripped
 * (they hold authoring guidance for the human editing the file, not agent
 * context). Whitespace runs left by removals are collapsed.
 */
export function effectiveContextContent(raw: string): string {
  const withoutComments = raw.replace(/<!--[\s\S]*?-->/g, '')
  return withoutComments.replace(/\n{3,}/g, '\n\n').trim()
}

function readContextFile(path: string): string | null {
  if (!existsSync(path)) return null
  const effective = effectiveContextContent(readFileSync(path, 'utf-8'))
  return effective ? effective : null
}

/**
 * Resolve the agent's team id via the team plugin's existing
 * `team.getAgentTeam` hook (returns the OrgTeam or null). Returns null when
 * the hook is unregistered (e.g. minimal test harnesses) or reports no team
 * — the team layer is simply omitted.
 */
export async function resolveTeamMembership(agentId: string): Promise<string | null> {
  try {
    const team = await getHookRegistry().invoke<{ id: string } | null>(
      'team.getAgentTeam',
      { id: agentId },
    )
    return team?.id ?? null
  } catch (err) {
    log.warn('team.getAgentTeam hook failed — omitting team layer', { agentId, error: String(err) })
    return null
  }
}

/**
 * Resolve the global/role/team context layers for one agent, token-substituted
 * and ready for the composer. The package/lessons inputs are the caller's
 * responsibility (they come from the installed package, not context files).
 */
export async function resolveContextInputs(
  vars: ContextAgentVars,
): Promise<Pick<ComposeInputs, 'global' | 'role' | 'toolAccess' | 'team'>> {
  const role: AgentRole = vars.agentId === vars.mainAgentId ? 'orchestrator' : 'subagent'
  const inputs: Pick<ComposeInputs, 'global' | 'role' | 'toolAccess' | 'team'> = {}

  const global = readContextFile(getGlobalContextPath())
  if (global) inputs.global = substituteTokens(global, vars)

  const roleContent = readContextFile(getRoleContextPath(role))
  if (roleContent) inputs.role = { id: role, content: substituteTokens(roleContent, vars) }

  // Runtime-specific tool-access section (P1.4) — rendered from the ACTIVE
  // runtime's static tool-access style. `describeToolAccess()` is a pure
  // literal (no I/O), so this is a cheap in-memory call. Omitted when app
  // services aren't up yet — composition stays consistent within a run.
  const runtime = maybeGetAppServices()?.runtime
  const access = runtime?.describeToolAccess?.()
  if (access) {
    const rendered = renderToolAccessInstructions(access, { agentId: vars.agentId })
    if (rendered.trim()) inputs.toolAccess = rendered
  }

  const teamId = await resolveTeamMembership(vars.agentId)
  if (teamId) {
    const team = readContextFile(getTeamContextPath(teamId))
    if (team) inputs.team = { id: teamId, content: substituteTokens(team, vars) }
  }

  return inputs
}
