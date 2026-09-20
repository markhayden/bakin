import type { DataTableSort } from '@makinbakin/sdk/patterns'
import type { WorkflowTemplate } from '../types'
import { collectWorkflowAssignments, getWorkflowScanCounts } from './workflow-presentation'

export type WorkflowSortField = 'name' | 'source' | 'steps' | 'features' | 'assignment'
export type WorkflowSort = DataTableSort<WorkflowSortField>

export function getWorkflowSource(template: WorkflowTemplate): 'custom' | 'managed' {
  return template.source === 'plugin' || template.source === 'agent-package' ? 'managed' : 'custom'
}

export function parseWorkflowSort(field: string, dir: string): WorkflowSort | undefined {
  if (field !== 'name' && field !== 'source' && field !== 'steps' && field !== 'features' && field !== 'assignment') return undefined
  return { field, dir: dir === 'desc' ? 'desc' : 'asc' }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Sort the complete result set before pagination. Missing values stay last. */
export function sortWorkflows(
  templates: WorkflowTemplate[],
  sort?: WorkflowSort,
  agentNames: ReadonlyMap<string, string> = new Map(),
): WorkflowTemplate[] {
  if (!sort) return templates
  // Compute compound cells once, not on each comparison.
  const rows = templates.map(template => {
    const assignments = collectWorkflowAssignments(template.definition.steps)
    const names = [
      ...(assignments.inheritsTaskAgent ? ['Task agent'] : []),
      ...assignments.teamIds,
      ...assignments.agentIds.map(id => agentNames.get(id) ?? id),
    ].sort(collator.compare)
    const { gateCount, nestedCount } = getWorkflowScanCounts(template.definition.steps)
    return { template, assignment: names.join('\u0000'), gateCount, nestedCount }
  })
  const direction = sort.dir === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    switch (sort.field) {
      case 'name': return direction * collator.compare(a.template.name, b.template.name)
      case 'source': return direction * collator.compare(getWorkflowSource(a.template), getWorkflowSource(b.template))
      case 'steps': return direction * ((a.template.stepCount ?? a.template.definition.steps.length) - (b.template.stepCount ?? b.template.definition.steps.length))
      case 'features': {
        const aEmpty = a.gateCount + a.nestedCount === 0
        const bEmpty = b.gateCount + b.nestedCount === 0
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
        return direction * (a.gateCount - b.gateCount || a.nestedCount - b.nestedCount)
      }
      case 'assignment':
        if (Boolean(a.assignment) !== Boolean(b.assignment)) return a.assignment ? -1 : 1
        return direction * collator.compare(a.assignment, b.assignment)
    }
  })
  return rows.map(row => row.template)
}
