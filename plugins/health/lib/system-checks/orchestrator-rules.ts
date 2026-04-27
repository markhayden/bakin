/**
 * System check — orchestrator rules block in main agent's AGENTS.md.
 *
 * Migrated out of src/core/doctor.ts (#139 C8). Auto-fixable — safe
 * to write/update Bakin's own block (gated by start/end markers).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'

import { getSettings } from '../../../../src/core/settings'
import { getOpenClawPath } from '../../../../packages/core/src/openclaw-home'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

import { AGENT_RULES_BLOCK_END, AGENT_RULES_BLOCK_START, resolveOrchestratorRules } from '../managed-blocks'

function ok(message: string): HealthCheckResult {
  return { check: 'orchestrator-rules', status: 'ok', message, autoFixable: false }
}
function warn(message: string, autoFixable = false): HealthCheckResult {
  return { check: 'orchestrator-rules', status: 'warn', message, autoFixable }
}
function error(message: string): HealthCheckResult {
  return { check: 'orchestrator-rules', status: 'error', message, autoFixable: false }
}
function fixed(message: string): HealthCheckResult {
  return { check: 'orchestrator-rules', status: 'fixed', message, autoFixable: true }
}

export async function checkOrchestratorRules(): Promise<HealthCheckResult[]> {
  const autoFix = getSettings().doctor.autoFixSkill
  const agentsPath = getOpenClawPath('workspace', 'AGENTS.md')

  if (!existsSync(agentsPath)) {
    return [warn('AGENTS.md not found — cannot verify orchestrator rules')]
  }

  const resolvedContent = await resolveOrchestratorRules()
  const current = readFileSync(agentsPath, 'utf-8')
  const startIdx = current.indexOf(AGENT_RULES_BLOCK_START)
  const endIdx = current.indexOf(AGENT_RULES_BLOCK_END)
  const hasBlock = startIdx !== -1

  if (!hasBlock) {
    if (!autoFix) {
      return [warn('Orchestrator rules block missing from AGENTS.md — run: bakin agent-rules --apply', true)]
    }
    const block = `${AGENT_RULES_BLOCK_START}\n${resolvedContent}\n${AGENT_RULES_BLOCK_END}\n`
    writeFileSync(agentsPath, current.trimEnd() + '\n\n' + block, 'utf-8')
    return [fixed('Added orchestrator rules block to AGENTS.md')]
  }

  if (endIdx === -1) {
    return [error('Orchestrator rules block start marker found but no end marker — AGENTS.md may be corrupt')]
  }

  const blockContent = current.slice(startIdx + AGENT_RULES_BLOCK_START.length, endIdx).trim()
  const expected = resolvedContent.trim()

  if (blockContent === expected) {
    return [ok('Orchestrator rules block present and up to date')]
  }

  if (!autoFix) {
    return [warn('Orchestrator rules block is outdated — run: bakin agent-rules --apply', true)]
  }

  const block = `${AGENT_RULES_BLOCK_START}\n${resolvedContent}\n${AGENT_RULES_BLOCK_END}`
  const updated = current.slice(0, startIdx) + block + current.slice(endIdx + AGENT_RULES_BLOCK_END.length)
  writeFileSync(agentsPath, updated, 'utf-8')
  return [fixed('Updated orchestrator rules block in AGENTS.md')]
}
