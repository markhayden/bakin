/** Canonical Workflows health checks and independently registered repairs. */
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

import { readTaskboard } from '../../../src/core/task-store'
import type {
  HealthCheckRunInput,
  HealthObservationInput,
  HealthRepairActionDefinition,
} from '../../../packages/core/src/plugin-types'
import {
  healthHealthy,
  healthObserved,
  healthUnknown,
  healthWarning,
} from '@makinbakin/sdk/utils'
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

function stablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'unknown'
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function workflowWarning(input: {
  key: string
  summary: string
  impact: string
  workflowId?: string
  resourceKind?: 'workflow' | 'file' | 'task'
  disposition?: 'advisory' | 'watch' | 'action_required'
  repairActionId?: string
  evidence?: Record<string, string | number | boolean | null>
}): HealthObservationInput {
  const disposition = input.disposition ?? (input.repairActionId ? 'action_required' : 'advisory')
  const resourceId = input.workflowId
  return healthWarning({
    key: input.key,
    summary: bounded(input.summary, 500),
    evidence: input.evidence,
    incident: {
      key: input.key,
      title: bounded(input.summary, 120),
      impact: input.impact,
      disposition,
      resources: resourceId
        ? [{ kind: input.resourceKind ?? 'workflow', id: stablePart(resourceId), label: bounded(resourceId, 120) }]
        : [{ kind: 'plugin', id: 'workflows', label: 'Workflows' }],
      resolution: input.repairActionId
        ? { key: input.repairActionId, type: 'repair', label: 'Review repair', actionId: input.repairActionId }
        : { key: 'review-workflows', type: 'navigate', label: 'Review Workflows', href: '/workflows' },
    },
  })
}

/** Validate workflow skill metadata and detect managed-source drift. */
export function checkWorkflowSkills(contentDir: string): HealthCheckRunInput {
  const observations: HealthObservationInput[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')

  if (existsSync(skillsDir)) {
    try {
      const files = readdirSync(skillsDir).filter(file => file.endsWith('.md'))
      for (const file of files) {
        try {
          const content = readFileSync(join(skillsDir, file), 'utf-8')
          if (splitFrontmatter(content).raw === null) {
            observations.push(workflowWarning({
              key: `frontmatter-${stablePart(file)}`,
              summary: `Workflow skill ${file} has no YAML frontmatter.`,
              impact: 'The skill output cannot be validated reliably.',
              workflowId: file,
              resourceKind: 'file',
              disposition: 'action_required',
            }))
            continue
          }
          if (!content.includes('output_schema')) {
            observations.push(workflowWarning({
              key: `output-schema-${stablePart(file)}`,
              summary: `Workflow skill ${file} has no output_schema.`,
              impact: 'Step output will not be validated server-side.',
              workflowId: file,
              resourceKind: 'file',
              disposition: 'action_required',
            }))
          }
        } catch {
          observations.push(workflowWarning({
            key: `unreadable-${stablePart(file)}`,
            summary: `Workflow skill ${file} could not be read.`,
            impact: 'Bakin cannot verify or execute the skill definition reliably.',
            workflowId: file,
            resourceKind: 'file',
            disposition: 'watch',
          }))
        }
      }
    } catch {
      observations.push(healthUnknown({
        key: 'skills-directory',
        summary: 'The workflow skills directory could not be inspected.',
        incident: {
          key: 'skills-directory',
          title: 'Workflow skill verification is unavailable',
          impact: 'Skill metadata and drift could not be verified during this run.',
          disposition: 'watch',
          resources: [{ kind: 'directory', id: 'workflows.skills', label: 'Workflow skills' }],
          resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
        },
      }))
    }
  }

  for (const report of scanWorkflowSkillDrift(contentDir)) {
    observations.push(workflowWarning({
      key: `drift-${stablePart(report.skillName)}`,
      summary: workflowSkillDriftMessage(report),
      impact: 'Workflow execution may use a stale local skill instead of its current managed source.',
      workflowId: report.filePath,
      resourceKind: 'file',
      disposition: report.repairable ? 'action_required' : 'advisory',
      repairActionId: report.repairable ? 'repair-skill-drift' : undefined,
      evidence: { skill: report.skillName, repairability: report.repairability },
    }))
  }

  if (observations.length === 0) {
    observations.push(healthHealthy({ key: 'skills', summary: 'Workflow skills have valid output schemas and no managed-source drift.' }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

/** Re-project only drifted workflow skills whose source identity is known. */
export function workflowSkillDriftRepair(contentDir: string): HealthRepairActionDefinition {
  return {
    id: 'repair-skill-drift',
    name: 'Repair workflow skill drift',
    async plan() {
      return scanWorkflowSkillDrift(contentDir)
        .filter(report => report.repairable)
        .map(report => ({
          id: `skill-${stablePart(report.skillName)}`,
          actionId: 'repair-skill-drift',
          title: `Repair workflow skill ${report.skillName}`,
          reason: workflowSkillDriftMessage(report),
          safety: report.repairability === 'safe-managed' ? 'safe' as const : 'manual' as const,
          incidentIds: [],
          observationIds: [],
          preconditions: [],
          changes: [{
            kind: 'file' as const,
            target: report.filePath,
            action: 'update' as const,
            description: `Replace ${report.skillName}.md from the current ${report.managedSource.kind} source.`,
          }],
        }))
    },
    async apply(items) {
      const reports = scanWorkflowSkillDrift(contentDir)
      return items.map(item => {
        const target = item.changes.find(change => change.kind === 'file')?.target
        const report = reports.find(candidate => candidate.filePath === target && candidate.repairable)
        if (!report) {
          return {
            itemId: item.id,
            actionId: item.actionId,
            status: 'skipped' as const,
            message: 'The workflow skill no longer has repairable managed-source drift.',
            affectedCheckIds: ['workflows.skills'],
            changes: [],
          }
        }
        const result = repairWorkflowSkillDrift({ contentDir, skillName: report.skillName, confirmKnownOld: true })
        return {
          itemId: item.id,
          actionId: item.actionId,
          status: result.status === 'applied' ? 'applied' as const : result.status === 'failed' ? 'failed' as const : 'skipped' as const,
          message: result.message,
          affectedCheckIds: ['workflows.skills'],
          changes: result.status === 'applied' ? item.changes : [],
        }
      })
    },
  }
}

function workflowSkillDriftMessage(report: WorkflowSkillDriftReport): string {
  const source = report.managedSource.kind === 'plugin'
    ? `plugin ${report.managedSource.id}`
    : `agent package ${report.managedSource.id}`
  const findings = report.findings.map(finding => finding.label).join('; ')
  const repairNote = report.repairable
    ? 'A source-aware repair is available.'
    : `Advisory only: ${workflowSkillRepairabilityLabel(report.repairability)}.`
  return `Workflow skill ${report.skillName} shadows managed ${source} and appears stale: ${findings}. ${repairNote}`
}

function workflowSkillRepairabilityLabel(repairability: WorkflowSkillDriftReport['repairability']): string {
  switch (repairability) {
    case 'custom-advisory': return 'the local file is unmarked or customized'
    case 'user-edited': return 'the local file is marked user-edited'
    case 'known-old-confirmable': return 'the known old managed file requires confirmation'
    case 'safe-managed': return 'the file is managed and unedited'
  }
}

/** Verify skill references, nested workflow references, and strict schema shape. */
export async function checkWorkflowDefinitions(contentDir: string): Promise<HealthCheckRunInput> {
  const observations: HealthObservationInput[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')
  const registered = new Set([...getAgentPackageSkills().keys(), ...getPluginSkills().keys()])
  const skillExists = (name: string): boolean => existsSync(join(skillsDir, `${name}.md`)) || registered.has(name)

  try {
    const definitions = listDefinitions(contentDir)
    const knownWorkflowIds = new Set(definitions.map(entry => entry.name))
    for (const { name, definition } of definitions) {
      const workflowKey = stablePart(name)
      const { source: _source, pluginId: _pluginId, packageId: _packageId, ...bare } = definition
      const parsed = workflowDefinitionSchema.safeParse(bare)
      if (!parsed.success) {
        parsed.error.issues.forEach((issue, index) => {
          if (!issue.message.includes('Unrecognized key')) return
          const at = issue.path.length ? ` at ${issue.path.join('.')}` : ''
          observations.push(workflowWarning({
            key: `schema-${workflowKey}-${index}`,
            summary: `Workflow ${name} has unknown YAML keys${at}: ${issue.message}`,
            impact: 'Unknown fields are ignored, so the workflow may not behave as its author intended.',
            workflowId: name,
            disposition: 'action_required',
          }))
        })
      }

      for (const step of definition.steps) {
        const typedStep = step as { id: string; skill?: string; type?: string; workflow_id?: string; steps?: Array<{ id: string; skill?: string }> }
        if (typedStep.skill && !skillExists(typedStep.skill)) {
          observations.push(workflowWarning({
            key: `skill-${workflowKey}-${stablePart(typedStep.id)}-${stablePart(typedStep.skill)}`,
            summary: `Workflow ${name} step ${typedStep.id} references missing skill ${typedStep.skill}.`,
            impact: 'The workflow cannot execute this step.',
            workflowId: name,
            disposition: 'action_required',
          }))
        }
        if (typedStep.type === 'workflow' || typedStep.type === 'map_workflow') {
          const childId = typedStep.workflow_id
          if (childId && !knownWorkflowIds.has(childId)) {
            observations.push(workflowWarning({
              key: `nested-${workflowKey}-${stablePart(typedStep.id)}-${stablePart(childId)}`,
              summary: `Workflow ${name} step ${typedStep.id} references missing workflow ${childId}.`,
              impact: 'The nested workflow step cannot start.',
              workflowId: name,
              disposition: 'action_required',
            }))
          }
          if (typedStep.type === 'map_workflow' && childId) {
            const child = definitions.find(entry => entry.name === childId)
            const childHasMap = child?.definition.steps.some(childStep => (childStep as { type?: string }).type === 'map_workflow')
            if (childHasMap) {
              observations.push(workflowWarning({
                key: `nested-map-${workflowKey}-${stablePart(typedStep.id)}`,
                summary: `Workflow ${name} maps to ${childId}, which also contains a map_workflow step.`,
                impact: 'Nested maps are unsupported in v1 and may not execute reliably.',
                workflowId: name,
                disposition: 'advisory',
              }))
            }
          }
        }
        if (typedStep.type === 'parallel') {
          for (const child of typedStep.steps ?? []) {
            if (!child.skill || skillExists(child.skill)) continue
            observations.push(workflowWarning({
              key: `parallel-skill-${workflowKey}-${stablePart(child.id)}-${stablePart(child.skill)}`,
              summary: `Workflow ${name} parallel step ${child.id} references missing skill ${child.skill}.`,
              impact: 'The parallel workflow branch cannot execute this step.',
              workflowId: name,
              disposition: 'action_required',
            }))
          }
        }
      }
    }
  } catch {
    return healthObserved([healthUnknown({
      key: 'definitions-scan',
      summary: 'Workflow definitions could not be inspected.',
      incident: {
        key: 'definitions-scan',
        title: 'Workflow definition verification is unavailable',
        impact: 'Bakin could not verify workflow references during this run.',
        disposition: 'watch',
        resources: [{ kind: 'directory', id: 'workflows.definitions', label: 'Workflow definitions' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
      },
    })])
  }

  if (observations.length === 0) {
    observations.push(healthHealthy({ key: 'definitions', summary: 'All workflow references and schemas resolve.' }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

interface WorkflowInstanceFinding {
  taskId: string
  currentStepId: string | null
  ageHours?: number
}

function scanWorkflowInstances(contentDir: string): { orphans: WorkflowInstanceFinding[]; stale: WorkflowInstanceFinding[] } {
  const instances = listInstances(undefined, contentDir)
  const board = readTaskboard() as unknown as { columns: Record<string, Array<{ id: string }>> }
  const taskIds = new Set(Object.values(board.columns).flatMap(column => column.map(task => task.id)))
  const orphans: WorkflowInstanceFinding[] = []
  const stale: WorkflowInstanceFinding[] = []
  const staleThreshold = 2 * 60 * 60 * 1000

  for (const instance of instances) {
    if (!taskIds.has(instance.taskId)) {
      orphans.push({ taskId: instance.taskId, currentStepId: instance.currentStepId ?? null })
      continue
    }
    if (instance.status !== 'in_progress') continue
    const updated = new Date(instance.updatedAt).getTime()
    if (!Number.isFinite(updated)) continue
    const age = Date.now() - updated
    if (age > staleThreshold) {
      stale.push({ taskId: instance.taskId, currentStepId: instance.currentStepId ?? null, ageHours: Math.round(age / 360_000) / 10 })
    }
  }
  return { orphans, stale }
}

/** Flag orphaned instance files and in-progress workflows with no update for two hours. */
export async function checkStaleWorkflowInstances(contentDir: string): Promise<HealthCheckRunInput> {
  let scan: ReturnType<typeof scanWorkflowInstances>
  try {
    scan = scanWorkflowInstances(contentDir)
  } catch {
    return healthObserved([healthUnknown({
      key: 'instances-scan',
      summary: 'Workflow instances could not be inspected.',
      incident: {
        key: 'instances-scan',
        title: 'Workflow instance verification is unavailable',
        impact: 'Bakin cannot determine whether workflow runs are stale or orphaned.',
        disposition: 'watch',
        resources: [{ kind: 'directory', id: 'workflows.instances', label: 'Workflow instances' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
      },
    })])
  }

  const observations: HealthObservationInput[] = scan.orphans.map(orphan => workflowWarning({
    key: `orphan-${stablePart(orphan.taskId)}`,
    summary: `Workflow instance for deleted task ${orphan.taskId} is orphaned.`,
    impact: 'The stale instance file consumes state and can confuse workflow history.',
    workflowId: orphan.taskId,
    resourceKind: 'task',
    repairActionId: 'remove-orphan-instances',
  }))
  for (const stale of scan.stale) {
    observations.push(workflowWarning({
      key: `stale-${stablePart(stale.taskId)}`,
      summary: `Workflow for task ${stale.taskId} has remained on ${stale.currentStepId ?? 'an unknown step'} for ${stale.ageHours}h.`,
      impact: 'Work assigned to this workflow may be stalled.',
      workflowId: stale.taskId,
      resourceKind: 'task',
      disposition: 'watch',
      evidence: { ageHours: stale.ageHours ?? 0 },
    }))
  }
  if (observations.length === 0) {
    observations.push(healthHealthy({ key: 'instances', summary: 'No stale or orphaned workflow instances were found.' }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

/** Delete instance files only after their tasks have disappeared from the current board. */
export function staleWorkflowInstancesRepair(contentDir: string): HealthRepairActionDefinition {
  return {
    id: 'remove-orphan-instances',
    name: 'Remove orphaned workflow instances',
    async plan() {
      let orphans: WorkflowInstanceFinding[]
      try { orphans = scanWorkflowInstances(contentDir).orphans } catch { return [] }
      if (orphans.length === 0) return []
      return [{
        id: 'remove-orphans',
        actionId: 'remove-orphan-instances',
        title: 'Remove orphaned workflow instances',
        reason: `${orphans.length} workflow instance file(s) refer to tasks that no longer exist.`,
        safety: 'destructive',
        incidentIds: [],
        observationIds: [],
        preconditions: [],
        changes: orphans.map(orphan => ({
          kind: 'file' as const,
          target: join(contentDir, 'workflows', 'instances', `${orphan.taskId}.json`),
          action: 'delete' as const,
          description: `Delete the orphaned instance for task ${orphan.taskId}.`,
        })),
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      let orphans: WorkflowInstanceFinding[]
      try { orphans = scanWorkflowInstances(contentDir).orphans } catch (error) {
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
          affectedCheckIds: ['workflows.stale-instances'],
          changes: [],
        }))
      }
      const changes: Array<{ kind: 'file'; target: string; action: 'delete'; description: string }> = []
      const failures: string[] = []
      for (const orphan of orphans) {
        const target = join(contentDir, 'workflows', 'instances', `${orphan.taskId}.json`)
        try {
          unlinkSync(target)
          changes.push({ kind: 'file' as const, target, action: 'delete' as const, description: `Deleted orphaned instance for ${orphan.taskId}.` })
        } catch (error) {
          failures.push(`${orphan.taskId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return items.map(item => ({
        itemId: item.id,
        actionId: item.actionId,
        status: failures.length > 0 ? 'failed' as const : orphans.length > 0 ? 'applied' as const : 'skipped' as const,
        message: failures.length > 0
          ? `Removed ${changes.length} orphaned instance(s); ${failures.length} failed.`
          : orphans.length > 0
            ? `Removed ${orphans.length} orphaned workflow instance(s).`
            : 'No orphaned workflow instances remain.',
        affectedCheckIds: ['workflows.stale-instances'],
        changes,
      }))
    },
  }
}
