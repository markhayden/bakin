/**
 * Workflow-plugin-owned doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#137) — these three functions
 * operate on workflow-plugin data (definitions, instances, skills) so
 * they belong with the plugin that owns that data model.
 *
 * Registered in plugins/workflows/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks them up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

import { getSettings } from '../../../src/core/settings'
import { getHookRegistry } from '../../../src/lib/plugin-registry'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'

import { listDefinitions } from './parser'
import { listInstances } from './runtime'

// ─── Result constructors (inlined; eventual migration target) ─────────────

function ok(check: string, message: string): HealthCheckResult {
  return { check, status: 'ok', message, autoFixable: false }
}
function warn(check: string, message: string, autoFixable = false): HealthCheckResult {
  return { check, status: 'warn', message, autoFixable }
}
function fixed(check: string, message: string): HealthCheckResult {
  return { check, status: 'fixed', message, autoFixable: true }
}

// ─── Workflow skills: YAML + output_schema check ──────────────────────────

/**
 * Scan `{contentDir}/workflows/skills/*.md` for missing YAML frontmatter or
 * missing `output_schema`. Warnings-only — no auto-fix.
 */
export function checkWorkflowSkills(contentDir: string): HealthCheckResult[] {
  const results: HealthCheckResult[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')

  if (!existsSync(skillsDir)) return results

  try {
    const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      try {
        const content = readFileSync(join(skillsDir, file), 'utf-8')
        const match = content.match(/^---\n([\s\S]*?)\n---/)
        if (!match) {
          results.push(warn('workflow-skills', `Skill ${file} has no YAML frontmatter — output will not be validated`))
          continue
        }
        if (!content.includes('output_schema')) {
          results.push(warn('workflow-skills', `Skill ${file} has no output_schema — step output will not be validated server-side`))
        }
      } catch {
        results.push(warn('workflow-skills', `Could not read skill file: ${file}`))
      }
    }
  } catch {
    // skills dir exists but can't be read
  }

  if (results.length === 0) {
    results.push(ok('workflow-skills', 'All workflow skills have output_schema'))
  }

  return results
}

// ─── Workflow definitions: skill reference integrity ──────────────────────

/**
 * Verify every step `skill:` reference in every workflow definition resolves
 * to an existing skill file. Walks builtin + parallel children.
 */
export async function checkWorkflowDefinitions(contentDir: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')

  try {
    const defs = listDefinitions(contentDir)
    for (const { name, definition } of defs) {
      for (const step of definition.steps) {
        const skillName = (step as { skill?: string }).skill
        if (skillName && !existsSync(join(skillsDir, `${skillName}.md`))) {
          results.push(warn('workflow-definitions', `Workflow "${name}" step "${(step as { id: string }).id}" references skill "${skillName}" which does not exist`))
        }
        // Check parallel children too
        if ((step as { type?: string }).type === 'parallel' && 'steps' in step) {
          for (const child of (step as { steps: Array<{ id: string; skill?: string }> }).steps) {
            if (child.skill && !existsSync(join(skillsDir, `${child.skill}.md`))) {
              results.push(warn('workflow-definitions', `Workflow "${name}" parallel step "${child.id}" references skill "${child.skill}" which does not exist`))
            }
          }
        }
      }
    }
  } catch {
    // No definitions or parser error — non-fatal
  }

  if (results.length === 0) {
    results.push(ok('workflow-definitions', 'All workflow skill references resolve'))
  }

  return results
}

// ─── Stale / orphaned workflow instances ──────────────────────────────────

/**
 * Flag in-progress instances stuck > 2 hours, and orphaned instances whose
 * tasks no longer exist on the board. `autoFix` is read from settings (no
 * longer a parameter) — matches the core doctor pattern.
 *
 * `tasks.readTaskboard` stays as a cross-plugin hook call (tasks plugin owns
 * the taskboard; we can't import directly without creating a circular dep).
 */
export async function checkStaleWorkflowInstances(contentDir: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  const autoFix = getSettings().doctor.autoFixSkill
  const hooks = getHookRegistry()

  try {
    const allInstances = listInstances(undefined, contentDir)

    interface BoardTask { id: string }
    const board = await hooks.invoke<{ columns: Record<string, BoardTask[]> }>('tasks.readTaskboard', {})
    if (!board) return [warn('workflow-instances', 'Taskboard not available')]
    const { columns } = board
    const allTaskIds = new Set<string>()
    for (const col of Object.values(columns)) {
      for (const task of col) {
        allTaskIds.add(task.id)
      }
    }

    const now = Date.now()
    const staleThreshold = 2 * 60 * 60 * 1000 // 2 hours

    for (const instance of allInstances) {
      // Orphaned instance — task deleted from board
      if (!allTaskIds.has(instance.taskId)) {
        if (autoFix) {
          const instancePath = join(contentDir, 'workflows', 'instances', `${instance.taskId}.json`)
          try {
            unlinkSync(instancePath)
            results.push(fixed('workflow-instances', `Removed orphaned workflow instance for deleted task "${instance.taskId}"`))
          } catch {
            results.push(warn('workflow-instances', `Orphaned workflow instance for deleted task "${instance.taskId}" — could not remove`))
          }
        } else {
          results.push(warn('workflow-instances', `Orphaned workflow instance for deleted task "${instance.taskId}" — task no longer on board`, true))
        }
        continue
      }

      // Stale in-progress instances
      if (instance.status !== 'in_progress') continue
      const updated = new Date(instance.updatedAt).getTime()
      if (isNaN(updated)) continue
      const age = now - updated
      if (age > staleThreshold) {
        const hours = Math.round(age / (60 * 60 * 1000) * 10) / 10
        results.push(warn('workflow-instances', `Workflow instance for task "${instance.taskId}" has been in_progress on step "${instance.currentStepId}" for ${hours}h with no updates`))
      }
    }
  } catch {
    // No instances directory — non-fatal
  }

  if (results.length === 0) {
    results.push(ok('workflow-instances', 'No stale workflow instances'))
  }

  return results
}
