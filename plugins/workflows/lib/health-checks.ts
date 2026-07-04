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

import { readTaskboard } from '../../../src/core/task-store'
import type { HealthCheckResult, HealthRepairHandler } from '../../../packages/core/src/plugin-types'
import { healthOk as ok, healthWarn as warn, healthFixed as fixed } from '@makinbakin/sdk/utils'
import { splitFrontmatter } from '@bakin/core/format/frontmatter'

import { listDefinitions } from './parser'
import { workflowDefinitionSchema } from '@bakin/core/workflows/node-type-registry'
import { getAgentPackageSkills } from '@bakin/core/workflows/agent-package-skill-registry'
import { getPluginSkills } from '@bakin/core/skills/plugin-skill-registry'
import { listInstances } from './runtime'
import {
  repairWorkflowSkillDrift,
  scanWorkflowSkillDrift,
  type WorkflowSkillDriftReport,
} from './workflow-skill-drift'

// ─── Result constructors (inlined; eventual migration target) ─────────────


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
        if (splitFrontmatter(content).raw === null) {
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

  for (const report of scanWorkflowSkillDrift(contentDir)) {
    results.push(warn(
      'workflow-skills',
      workflowSkillDriftMessage(report),
      report.repairable,
    ))
  }

  if (results.length === 0) {
    results.push(ok('workflow-skills', 'All workflow skills have output_schema'))
  }

  return results
}

export function workflowSkillDriftRepair(contentDir: string): HealthRepairHandler {
  return {
    async plan(rows) {
      if (!rows.some(row => row.check === 'workflow-skills')) return []
      return scanWorkflowSkillDrift(contentDir)
        .filter(report => report.repairable)
        .map(report => ({
          id: workflowSkillRepairItemId(report.skillName),
          checkId: 'workflow-skills',
          title: `Repair workflow skill ${report.skillName}`,
          reason: workflowSkillDriftMessage(report),
          safety: 'safe' as const,
          requiresConfirmation: true,
          changes: [{
            kind: 'file' as const,
            target: report.filePath,
            action: 'update' as const,
            description: `Replace ${report.skillName}.md from the current ${report.managedSource.kind} source.`,
          }],
        }))
    },
    async apply(items) {
      const results = []
      for (const item of items) {
        const skillName = skillNameFromRepairItemId(item.id)
        if (!skillName) {
          results.push({
            id: item.id,
            checkId: 'workflow-skills',
            status: 'skipped' as const,
            message: `Skipped unknown workflow skill repair item "${item.id}".`,
            changes: [],
          })
          continue
        }
        const result = repairWorkflowSkillDrift({
          contentDir,
          skillName,
          confirmKnownOld: true,
        })
        results.push({
          id: item.id,
          checkId: 'workflow-skills',
          status: result.status === 'applied' ? 'applied' as const : result.status === 'failed' ? 'failed' as const : 'skipped' as const,
          message: result.message,
          changes: result.status === 'applied'
            ? item.changes
            : [],
        })
      }
      return results
    },
  }
}

function workflowSkillRepairItemId(skillName: string): string {
  return `workflows.repair-workflow-skill-drift.${skillName}`
}

function skillNameFromRepairItemId(id: string): string | null {
  const prefix = 'workflows.repair-workflow-skill-drift.'
  if (!id.startsWith(prefix)) return null
  return id.slice(prefix.length) || null
}

function workflowSkillDriftMessage(report: WorkflowSkillDriftReport): string {
  const source = report.managedSource.kind === 'plugin'
    ? `plugin ${report.managedSource.id}`
    : `agent package ${report.managedSource.id}`
  const findings = report.findings.map(finding => finding.label).join('; ')
  const repairNote = report.repairable
    ? 'Safe repair is available.'
    : `Advisory only: ${workflowSkillRepairabilityLabel(report.repairability)}.`
  return `Workflow skill "${report.skillName}" shadows managed ${source} skill and appears stale: ${findings}. ${repairNote}`
}

function workflowSkillRepairabilityLabel(repairability: WorkflowSkillDriftReport['repairability']): string {
  switch (repairability) {
    case 'custom-advisory':
      return 'local file is unmarked or customized'
    case 'user-edited':
      return 'local file is marked user-edited'
    case 'known-old-confirmable':
      return 'known old managed file requires confirmation'
    case 'safe-managed':
      return 'file is managed and unedited'
  }
}

// ─── Workflow definitions: skill + nested-workflow reference integrity ─────

/**
 * Verify every step `skill:` reference and every nested `workflow_id`
 * reference in every workflow definition resolves. Walks builtin + parallel
 * children. Nested-workflow existence is checked HERE (against the live
 * user-disk + registry set) rather than at plugin-default load time, because
 * load order must not decide validity (#374) — this check is order-independent
 * and stays current under hot reload.
 */
export async function checkWorkflowDefinitions(contentDir: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')

  // Mirror the skill-loader's resolution tiers: a skill "exists" when a user
  // file is on disk OR an agent package / plugin registered it. Checking the
  // file alone false-positives whenever a packaged skill has no local shadow.
  const registered = new Set([
    ...getAgentPackageSkills().keys(),
    ...getPluginSkills().keys(),
  ])
  const skillExists = (name: string): boolean =>
    existsSync(join(skillsDir, `${name}.md`)) || registered.has(name)

  try {
    const defs = listDefinitions(contentDir)
    // listDefinitions merges user-disk and plugin/agent-package registry
    // definitions (user wins), so this set IS the resolvable-workflow universe.
    const knownWorkflowIds = new Set(defs.map((entry) => entry.name))
    for (const { name, definition } of defs) {
      // Strict-schema drift: the CRUD boundary rejects unknown keys, but
      // definitions loaded from disk or registered by plugins never pass
      // through zod — surface stray keys here so silently-dead YAML fields
      // (the on_approve/dependsOn pattern) can't accumulate unnoticed.
      const { source: _s, pluginId: _p, packageId: _k, ...bare } = definition
      const parsed = workflowDefinitionSchema.safeParse(bare)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          if (issue.message.includes('Unrecognized key')) {
            const at = issue.path.length ? ` at ${issue.path.join('.')}` : ''
            results.push(warn('workflow-definitions', `Workflow "${name}" has unknown YAML keys${at}: ${issue.message}`))
          }
        }
      }
      for (const step of definition.steps) {
        const skillName = (step as { skill?: string }).skill
        if (skillName && !skillExists(skillName)) {
          results.push(warn('workflow-definitions', `Workflow "${name}" step "${(step as { id: string }).id}" references skill "${skillName}" which does not exist`))
        }
        const stepType = (step as { type?: string }).type
        if (stepType === 'workflow') {
          const workflowId = (step as { workflow_id?: string }).workflow_id
          if (workflowId && !knownWorkflowIds.has(workflowId)) {
            results.push(warn('workflow-definitions', `Workflow "${name}" step "${(step as { id: string }).id}" references nested workflow "${workflowId}" which does not exist`))
          }
        }
        // Check parallel children too
        if (stepType === 'parallel' && 'steps' in step) {
          for (const child of (step as { steps: Array<{ id: string; skill?: string }> }).steps) {
            if (child.skill && !skillExists(child.skill)) {
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
    results.push(ok('workflow-definitions', 'All workflow references resolve'))
  }

  return results
}

// ─── Stale / orphaned workflow instances ──────────────────────────────────

/**
 * Flag in-progress instances stuck > 2 hours, and orphaned instances whose
 * tasks no longer exist on the board. `autoFix` is read from settings (no
 * longer a parameter) — matches the core doctor pattern.
 *
 * Reads the Bakin task store directly; task metadata is not owned by a plugin
 * hook.
 */
export async function checkStaleWorkflowInstances(contentDir: string): Promise<HealthCheckResult[]> {
  return checkStaleWorkflowInstancesInternal(contentDir, false)
}

async function checkStaleWorkflowInstancesInternal(contentDir: string, autoFix: boolean): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []

  try {
    const allInstances = listInstances(undefined, contentDir)

    interface BoardTask { id: string }
    const board = readTaskboard() as unknown as { columns: Record<string, BoardTask[]> }
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

export function staleWorkflowInstancesRepair(contentDir: string): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter(row => row.check === 'workflow-instances' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'workflows.remove-orphan-instances',
        checkId: 'workflow-instances',
        title: 'Remove orphaned workflow instances',
        reason: matching.map(row => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
        changes: [{
          kind: 'file',
          target: join(contentDir, 'workflows', 'instances'),
          action: 'delete',
          description: 'Delete workflow instance files whose tasks no longer exist on the board.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const rows = await checkStaleWorkflowInstancesInternal(contentDir, true)
      const failures = rows.filter(row => row.status === 'error')
      return [{
        id: 'workflows.remove-orphan-instances',
        checkId: 'workflow-instances',
        status: failures.length > 0 ? 'failed' : 'applied',
        message: rows.map(row => row.message).join('; '),
        changes: rows
          .filter(row => row.status === 'fixed')
          .map(row => ({
            kind: 'file' as const,
            target: join(contentDir, 'workflows', 'instances'),
            action: 'delete' as const,
            description: row.message,
          })),
      }]
    },
  }
}
