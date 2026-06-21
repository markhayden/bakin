/**
 * Workflow Template List (definition + drift aggregation)
 *
 * Pure aggregation over workflow definitions: resolves nested sub-workflows,
 * builds the template list with per-definition skill-drift summaries, and
 * counts steps. Used by both routes and exec tools. No module state.
 */
import type {
  WorkflowTemplate,
  WorkflowDefinition,
  NestedWorkflowStep,
  WorkflowSkillDriftSummary,
} from '../types'
import { listDefinitions, loadDefinition } from './parser'
import { readDisabledWorkflowIds } from './availability'
import { getShadowedSource } from './source-registry'
import { scanWorkflowSkillDrift, type WorkflowSkillDriftReport } from './workflow-skill-drift'
import { getContentDir } from './content-dir'

export function resolveSubWorkflows(steps: WorkflowDefinition['steps'], subWorkflows: Record<string, WorkflowDefinition>): void {
  for (const step of steps) {
    if (step.type === 'workflow') {
      const nested = step as NestedWorkflowStep
      if (nested.workflow_id && !subWorkflows[nested.workflow_id]) {
        const subDef = loadDefinition(nested.workflow_id)
        if (subDef) {
          subWorkflows[nested.workflow_id] = subDef
          resolveSubWorkflows(subDef.steps, subWorkflows)
        }
      }
    }
  }
}

export function buildTemplateList(options: { includeDisabled?: boolean } = {}): { templates: WorkflowTemplate[]; subWorkflows: Record<string, WorkflowDefinition> } {
  const defs = listDefinitions()
  const disabledWorkflowIds = readDisabledWorkflowIds()
  const subWorkflows: Record<string, WorkflowDefinition> = {}
  const driftBySkill = workflowSkillDriftBySkill()
  const templates: WorkflowTemplate[] = defs.flatMap(d => {
    const disabled = d.source !== 'user' && disabledWorkflowIds.has(d.name)
    const shadowedSource = d.source === 'user' ? getShadowedSource(d.name) : undefined
    if (disabled && !options.includeDisabled) return []
    resolveSubWorkflows(d.definition.steps, subWorkflows)
    return [{
      name: d.definition.name,
      filename: d.name,
      description: d.definition.description,
      stepCount: countSteps(d.definition.steps),
      definition: d.definition,
      source: d.source,
      pluginId: d.pluginId,
      packageId: d.packageId,
      disabled,
      shadowedSource,
      skillDrift: workflowSkillDriftForDefinition(d.definition, driftBySkill, subWorkflows),
    }]
  })
  return { templates, subWorkflows }
}

export function workflowSkillDriftBySkill(): Map<string, WorkflowSkillDriftReport> {
  return new Map(scanWorkflowSkillDrift(getContentDir()).map(report => [report.skillName, report]))
}

export function workflowSkillDriftForDefinition(
  definition: WorkflowDefinition,
  driftBySkill: Map<string, WorkflowSkillDriftReport>,
  subWorkflows: Record<string, WorkflowDefinition> = {},
): WorkflowSkillDriftSummary | undefined {
  const byStep: Record<string, string[]> = {}
  const reports = new Map<string, WorkflowSkillDriftReport>()
  for (const ref of collectWorkflowSkillRefs(definition.steps, subWorkflows)) {
    const report = driftBySkill.get(ref.skill)
    if (!report) continue
    reports.set(report.skillName, report)
    byStep[ref.stepId] = [...(byStep[ref.stepId] ?? []), ref.skill]
  }
  const uniqueReports = Array.from(reports.values())
  if (uniqueReports.length === 0) return undefined
  return {
    count: uniqueReports.length,
    repairableCount: uniqueReports.filter(report => report.repairable).length,
    skills: uniqueReports.map(report => report.skillName),
    reports: uniqueReports,
    byStep,
  }
}

function collectWorkflowSkillRefs(
  steps: WorkflowDefinition['steps'],
  subWorkflows: Record<string, WorkflowDefinition> = {},
  idPrefix = '',
  workflowStack = new Set<string>(),
): Array<{ stepId: string; skill: string }> {
  const refs: Array<{ stepId: string; skill: string }> = []
  for (const step of steps) {
    const stepId = idPrefix ? `${idPrefix}__${step.id}` : step.id
    const skill = (step as { skill?: unknown }).skill
    if (typeof skill === 'string' && skill.length > 0) {
      refs.push({ stepId, skill })
    }
    if (step.type === 'parallel') {
      refs.push(...collectWorkflowSkillRefs(step.steps, subWorkflows, idPrefix, workflowStack))
    }
    if (step.type === 'workflow') {
      const workflowId = (step as NestedWorkflowStep).workflow_id
      const nested = workflowId ? subWorkflows[workflowId] : undefined
      if (nested && !workflowStack.has(workflowId)) {
        const nextStack = new Set(workflowStack)
        nextStack.add(workflowId)
        refs.push(...collectWorkflowSkillRefs(nested.steps, subWorkflows, stepId, nextStack))
      }
    }
  }
  return refs
}

export function countSteps(steps: { type: string; steps?: unknown[] }[]): number {
  let count = 0
  for (const step of steps) {
    if (step.type === 'parallel' && Array.isArray(step.steps)) {
      count += step.steps.length
    } else {
      count++
    }
  }
  return count
}
