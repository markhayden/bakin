/** Canonical Workflows health checks and independently registered repairs. */
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { z } from 'zod'

import { readTaskboard } from '../../../src/core/task-store'
import type {
  HealthCheckRunInput,
  HealthIncidentDeclaration,
  HealthObservationInput,
  HealthRepairActionDefinition,
  HealthResolution,
  HealthSubject,
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

/** Rows 127–132: broken skill files are the human's decision while something in use references them; drift self-heals. */
export const WORKFLOW_SKILLS_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'frontmatter', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { id: 'output-schema', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { id: 'drift', subjectKind: 'record', resolution: { type: 'repair', actionId: 'repair-skill-drift' }, required: 'always' },
]

/** Rows 133–138: definition errors are the human's decision while the workflow is in use; nested maps and the scan are observations. */
export const WORKFLOW_DEFINITIONS_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'schema', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { id: 'skill', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { id: 'nested', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { id: 'parallel-skill', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
]

/** Rows 139–141: an orphan is a one-click deletion (it blocks nothing); the scan and stale runs are observations. */
export const WORKFLOW_INSTANCES_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'orphan', subjectKind: 'task', resolution: { type: 'repair', actionId: 'remove-orphan-instances' }, required: 'never' },
]

function skillRecordSubject(file: string): HealthSubject {
  return { kind: 'record', id: `workflows/skills/${file}`, label: file }
}

function workflowRecordSubject(name: string): HealthSubject {
  return { kind: 'record', id: `workflows/${name}`, label: name }
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/**
 * One incident-bearing warning under the two-outcomes contract: a repair
 * the owner registered, or the human's decision on the record's recover
 * view. Observation rows (no incident) use `healthWarning` directly.
 */
function workflowWarning(input: {
  key: string
  declarationId: string
  summary: string
  impact: string
  subject: HealthSubject
  resourceKind?: 'workflow' | 'file' | 'task'
  resourceId: string
  disposition: 'advisory' | 'watch' | 'action_required'
  /** Mandatory for an owner-decides family: is something that runs referencing this record? */
  required?: boolean
  evidence?: Record<string, string | number | boolean | null>
  resolution: HealthResolution
}): HealthObservationInput {
  return healthWarning({
    key: input.key,
    summary: bounded(input.summary, 500),
    evidence: input.evidence,
    incident: {
      key: input.key,
      title: bounded(input.summary, 120),
      impact: input.impact,
      disposition: input.disposition,
      subject: input.subject,
      declarationId: input.declarationId,
      ...(input.required === undefined ? {} : { required: input.required }),
      resources: [{ kind: input.resourceKind ?? 'workflow', id: stablePart(input.resourceId), label: bounded(input.resourceId, 120) }],
      resolution: input.resolution,
    },
  })
}

/** The human's control for a workflow record: its recover view (self-healing 1.4b). */
function recoverDecision(href: string): HealthResolution {
  return { key: 'recover-workflow', type: 'human', needs: 'decision', label: 'Open the recover view', href }
}

/**
 * Skill names every definition on disk references (steps and parallel
 * branches) — the "in use" fact behind rows 127/128/134/137. Best effort:
 * an unreadable definitions dir simply references nothing.
 */
function referencedSkillNames(contentDir: string): Set<string> {
  const names = new Set<string>()
  try {
    for (const { definition } of listDefinitions(contentDir)) {
      for (const step of definition.steps) {
        const typed = step as { skill?: string; steps?: Array<{ skill?: string }> }
        if (typed.skill) names.add(typed.skill)
        for (const child of typed.steps ?? []) if (child.skill) names.add(child.skill)
      }
    }
  } catch {
    // The definitions check reports an unreadable definitions dir itself.
  }
  return names
}

/** Workflow ids with an in-progress instance — the "running" half of "scheduled or running" (rows 133–137). */
function runningWorkflowIds(contentDir: string): Set<string> {
  try {
    return new Set(listInstances(undefined, contentDir).filter((instance) => instance.status === 'in_progress').map((instance) => instance.workflowId))
  } catch {
    return new Set()
  }
}

/** Validate workflow skill metadata and detect managed-source drift. */
export function checkWorkflowSkills(contentDir: string): HealthCheckRunInput {
  const observations: HealthObservationInput[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')

  if (existsSync(skillsDir)) {
    try {
      const files = readdirSync(skillsDir).filter(file => file.endsWith('.md'))
      const referenced = files.length > 0 ? referencedSkillNames(contentDir) : new Set<string>()
      for (const file of files) {
        // Rows 127/128: action_required only while an in-use definition references the skill, else advisory.
        const inUse = referenced.has(file.replace(/\.md$/, ''))
        try {
          const content = readFileSync(join(skillsDir, file), 'utf-8')
          if (splitFrontmatter(content).raw === null) {
            observations.push(workflowWarning({
              key: `frontmatter-${stablePart(file)}`,
              declarationId: 'frontmatter',
              summary: `Workflow skill ${file} has no YAML frontmatter.`,
              impact: 'The skill output cannot be validated reliably.',
              subject: skillRecordSubject(file),
              resourceKind: 'file',
              resourceId: file,
              disposition: inUse ? 'action_required' : 'advisory',
              required: inUse,
              resolution: recoverDecision(`/workflows?recover=1&skill=${encodeURIComponent(file)}`),
            }))
            continue
          }
          if (!content.includes('output_schema')) {
            observations.push(workflowWarning({
              key: `output-schema-${stablePart(file)}`,
              declarationId: 'output-schema',
              summary: `Workflow skill ${file} has no output_schema.`,
              impact: 'Step output will not be validated server-side.',
              subject: skillRecordSubject(file),
              resourceKind: 'file',
              resourceId: file,
              disposition: inUse ? 'action_required' : 'advisory',
              required: inUse,
              resolution: recoverDecision(`/workflows?recover=1&skill=${encodeURIComponent(file)}`),
            }))
          }
        } catch {
          // Row 129: an observation.
          observations.push(healthWarning({
            key: `unreadable-${stablePart(file)}`,
            summary: `Workflow skill ${file} could not be read.`,
            detail: 'Bakin cannot verify or execute the skill definition reliably.',
          }))
        }
      }
    } catch {
      // Row 130: a "could not see" observation.
      observations.push(healthUnknown({
        key: 'skills-directory',
        summary: 'The workflow skills directory could not be inspected.',
        detail: 'Skill metadata and drift could not be verified during this run.',
      }))
    }
  }

  for (const report of scanWorkflowSkillDrift(contentDir)) {
    if (!report.repairable) {
      // Row 132: an observation — nothing deterministic to do.
      observations.push(healthWarning({
        key: `drift-${stablePart(report.skillName)}`,
        summary: bounded(workflowSkillDriftMessage(report), 500),
        detail: 'Workflow execution may use a stale local skill instead of its current managed source.',
        evidence: { skill: report.skillName, repairability: report.repairability },
      }))
      continue
    }
    // Row 131: the per-item repair (untouched self-heals; a user-edited file is one-click).
    observations.push(workflowWarning({
      key: `drift-${stablePart(report.skillName)}`,
      declarationId: 'drift',
      summary: workflowSkillDriftMessage(report),
      impact: 'Workflow execution may use a stale local skill instead of its current managed source.',
      subject: skillRecordSubject(`${report.skillName}.md`),
      resourceKind: 'file',
      resourceId: report.filePath,
      disposition: 'action_required',
      evidence: { skill: report.skillName, repairability: report.repairability },
      resolution: { key: 'repair-skill-drift', type: 'repair', label: 'Repair the drifted skill', actionId: 'repair-skill-drift' },
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
    // Row 131: an untouched managed file is replaced in place (self-heal);
    // the planner stamps `deletesUserContent` on a user-edited one (one-click).
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    operationPlan: () => ({
      stages: [{ id: 'replace', kind: 'committing', label: 'Replace drifted skills from their source' }],
      pointOfNoReturn: 'replace',
    }),
    async plan() {
      return scanWorkflowSkillDrift(contentDir)
        .filter(report => report.repairable)
        .map(report => ({
          id: `skill-${stablePart(report.skillName)}`,
          actionId: 'repair-skill-drift',
          title: `Repair workflow skill ${report.skillName}`,
          reason: workflowSkillDriftMessage(report),
          ...(report.repairability === 'safe-managed' ? {} : { effects: { deletesUserContent: true, spendsMoney: false, widensAuthorization: false } }),
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
    async apply(items, op) {
      const reports = scanWorkflowSkillDrift(contentDir)
      op.stage('replace')
      return items.map(item => {
        const target = item.changes.find(change => change.kind === 'file')?.target
        const report = reports.find(candidate => candidate.filePath === target && candidate.repairable)
        if (!report) {
          op.item('replace', { id: item.id, label: item.title, status: 'skipped', message: 'no longer drifted' })
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
        op.item('replace', {
          id: item.id,
          label: report.skillName,
          status: result.status === 'applied' ? 'done' : result.status === 'failed' ? 'failed' : 'skipped',
          message: result.message,
        })
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
/**
 * The unknown-key issues inside a definition parse, with full paths.
 *
 * A step is a union (builtin | plugin step), so zod reports a step's stray key
 * as ONE `invalid_union` issue whose member issues sit under `errors` with
 * paths relative to the step. Walk those, matching on the issue code (and the
 * plugin-step schema's custom re-forwarded message) — never on the union's
 * generic "Invalid input". Both union members report the same key, so the
 * result is deduped by path + message.
 */
function unknownKeyIssues(issues: z.core.$ZodIssue[], basePath: PropertyKey[] = []): Array<{ path: PropertyKey[]; message: string }> {
  const found = new Map<string, { path: PropertyKey[]; message: string }>()
  for (const issue of issues) {
    const path = [...basePath, ...issue.path]
    if (issue.code === 'invalid_union') {
      for (const member of issue.errors) {
        for (const nested of unknownKeyIssues(member, path)) found.set(`${nested.path.join('.')}|${nested.message}`, nested)
      }
      continue
    }
    const isUnknownKey = issue.code === 'unrecognized_keys'
      || (issue.code === 'custom' && issue.message.includes('Unrecognized key'))
    if (isUnknownKey) found.set(`${path.join('.')}|${issue.message}`, { path, message: issue.message })
  }
  return [...found.values()]
}

export async function checkWorkflowDefinitions(contentDir: string): Promise<HealthCheckRunInput> {
  const observations: HealthObservationInput[] = []
  const skillsDir = join(contentDir, 'workflows', 'skills')
  const registered = new Set([...getAgentPackageSkills().keys(), ...getPluginSkills().keys()])
  const skillExists = (name: string): boolean => existsSync(join(skillsDir, `${name}.md`)) || registered.has(name)

  try {
    const definitions = listDefinitions(contentDir)
    const knownWorkflowIds = new Set(definitions.map(entry => entry.name))
    const running = runningWorkflowIds(contentDir)
    for (const { name, definition } of definitions) {
      const workflowKey = stablePart(name)
      // Rows 133–137: required while the workflow is running (a schedule that
      // targets it is the schedule plugin's fact; it is not read here).
      const inUse = running.has(name)
      const decision = (href: string) => ({
        subject: workflowRecordSubject(name),
        resourceId: name,
        disposition: (inUse ? 'action_required' : 'advisory') as 'action_required' | 'advisory',
        required: inUse,
        resolution: recoverDecision(href),
      })
      const { source: _source, pluginId: _pluginId, packageId: _packageId, ...bare } = definition
      const parsed = workflowDefinitionSchema.safeParse(bare)
      if (!parsed.success) {
        unknownKeyIssues(parsed.error.issues).forEach((issue, index) => {
          const at = issue.path.length ? ` at ${issue.path.join('.')}` : ''
          observations.push(workflowWarning({
            key: `schema-${workflowKey}-${index}`,
            declarationId: 'schema',
            summary: `Workflow ${name} has unknown YAML keys${at}: ${issue.message}`,
            impact: 'Unknown fields are ignored, so the workflow may not behave as its author intended.',
            ...decision(`/workflows/${encodeURIComponent(name)}?recover=1`),
          }))
        })
      }

      for (const step of definition.steps) {
        const typedStep = step as { id: string; skill?: string; type?: string; workflow_id?: string; steps?: Array<{ id: string; skill?: string }> }
        if (typedStep.skill && !skillExists(typedStep.skill)) {
          observations.push(workflowWarning({
            key: `skill-${workflowKey}-${stablePart(typedStep.id)}-${stablePart(typedStep.skill)}`,
            declarationId: 'skill',
            summary: `Workflow ${name} step ${typedStep.id} references missing skill ${typedStep.skill}.`,
            impact: 'The workflow cannot execute this step.',
            ...decision(`/workflows/${encodeURIComponent(name)}?recover=1&step=${encodeURIComponent(typedStep.id)}`),
          }))
        }
        if (typedStep.type === 'workflow' || typedStep.type === 'map_workflow') {
          const childId = typedStep.workflow_id
          if (childId && !knownWorkflowIds.has(childId)) {
            observations.push(workflowWarning({
              key: `nested-${workflowKey}-${stablePart(typedStep.id)}-${stablePart(childId)}`,
              declarationId: 'nested',
              summary: `Workflow ${name} step ${typedStep.id} references missing workflow ${childId}.`,
              impact: 'The nested workflow step cannot start.',
              ...decision(`/workflows/${encodeURIComponent(name)}?recover=1&step=${encodeURIComponent(typedStep.id)}`),
            }))
          }
          if (typedStep.type === 'map_workflow' && childId) {
            const child = definitions.find(entry => entry.name === childId)
            const childHasMap = child?.definition.steps.some(childStep => (childStep as { type?: string }).type === 'map_workflow')
            if (childHasMap) {
              // Row 136: an observation.
              observations.push(healthWarning({
                key: `nested-map-${workflowKey}-${stablePart(typedStep.id)}`,
                summary: bounded(`Workflow ${name} maps to ${childId}, which also contains a map_workflow step.`, 500),
                detail: 'Nested maps are unsupported in v1 and may not execute reliably.',
              }))
            }
          }
        }
        if (typedStep.type === 'parallel') {
          for (const child of typedStep.steps ?? []) {
            if (!child.skill || skillExists(child.skill)) continue
            observations.push(workflowWarning({
              key: `parallel-skill-${workflowKey}-${stablePart(child.id)}-${stablePart(child.skill)}`,
              declarationId: 'parallel-skill',
              summary: `Workflow ${name} parallel step ${child.id} references missing skill ${child.skill}.`,
              impact: 'The parallel workflow branch cannot execute this step.',
              ...decision(`/workflows/${encodeURIComponent(name)}?recover=1&step=${encodeURIComponent(typedStep.id)}`),
            }))
          }
        }
      }
    }
  } catch {
    // Row 138: a "could not see" observation.
    return healthObserved([healthUnknown({
      key: 'definitions-scan',
      summary: 'Workflow definitions could not be inspected.',
      detail: 'Bakin could not verify workflow references during this run.',
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
    // Row 139: a "could not see" observation.
    return healthObserved([healthUnknown({
      key: 'instances-scan',
      summary: 'Workflow instances could not be inspected.',
      detail: 'Bakin cannot determine whether workflow runs are stale or orphaned.',
    })])
  }

  // Row 140: a one-click deletion, advisory — an orphan blocks nothing.
  const observations: HealthObservationInput[] = scan.orphans.map(orphan => workflowWarning({
    key: `orphan-${stablePart(orphan.taskId)}`,
    declarationId: 'orphan',
    summary: `Workflow instance for deleted task ${orphan.taskId} is orphaned.`,
    impact: 'The stale instance file consumes state and can confuse workflow history.',
    subject: { kind: 'task', id: orphan.taskId, label: orphan.taskId },
    resourceKind: 'task',
    resourceId: orphan.taskId,
    disposition: 'advisory',
    resolution: { key: 'remove-orphan-instances', type: 'repair', label: 'Remove the orphaned instance', actionId: 'remove-orphan-instances' },
  }))
  for (const stale of scan.stale) {
    // Row 141: an observation.
    observations.push(healthWarning({
      key: `stale-${stablePart(stale.taskId)}`,
      summary: bounded(`Workflow for task ${stale.taskId} has remained on ${stale.currentStepId ?? 'an unknown step'} for ${stale.ageHours}h.`, 500),
      detail: 'Work assigned to this workflow may be stalled.',
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
    // Row 140: deletes instance files → one-click.
    effects: { deletesUserContent: true, spendsMoney: false, widensAuthorization: false },
    mutation: 'delete',
    operationPlan: () => ({
      stages: [
        { id: 'scan', kind: 'preparing', label: 'Find orphaned instances' },
        { id: 'remove', kind: 'cleanup', label: 'Delete them' },
      ],
      pointOfNoReturn: 'remove',
    }),
    async plan() {
      let orphans: WorkflowInstanceFinding[]
      try { orphans = scanWorkflowInstances(contentDir).orphans } catch { return [] }
      if (orphans.length === 0) return []
      return [{
        id: 'remove-orphans',
        actionId: 'remove-orphan-instances',
        title: 'Remove orphaned workflow instances',
        reason: `${orphans.length} workflow instance file(s) refer to tasks that no longer exist.`,
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
    async apply(items, op) {
      if (items.length === 0) return []
      let orphans: WorkflowInstanceFinding[]
      op.stage('scan')
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
      if (orphans.length > 0) op.stage('remove')
      for (const orphan of orphans) {
        const target = join(contentDir, 'workflows', 'instances', `${orphan.taskId}.json`)
        try {
          unlinkSync(target)
          changes.push({ kind: 'file' as const, target, action: 'delete' as const, description: `Deleted orphaned instance for ${orphan.taskId}.` })
          op.item('remove', { id: orphan.taskId, label: orphan.taskId, status: 'done' })
        } catch (error) {
          failures.push(`${orphan.taskId}: ${error instanceof Error ? error.message : String(error)}`)
          op.item('remove', { id: orphan.taskId, label: orphan.taskId, status: 'failed', message: error instanceof Error ? error.message : String(error) })
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
