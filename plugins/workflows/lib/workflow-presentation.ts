import type { WorkflowStep } from '../types'

export const WORKFLOW_FEATURES = [
  { value: 'gate', label: 'Approval gates' },
  { value: 'nested', label: 'Nested workflows' },
  { value: 'parallel', label: 'Parallel steps' },
  { value: 'fan-out', label: 'Fan-out' },
  { value: 'creates-task', label: 'Creates tasks' },
] as const

export type WorkflowFeature = (typeof WORKFLOW_FEATURES)[number]['value']

export interface WorkflowAssignments {
  agentIds: string[]
  inheritsTaskAgent: boolean
  teamIds: string[]
}

function addAgentSelection(
  value: string | undefined,
  agentIds: Set<string>,
  teamIds: Set<string>,
  inheritance: { value: boolean },
) {
  if (!value) return
  const preferred = value.match(/^\$preferred\((.*)\)$/)?.[1]
  const selections = preferred
    ? preferred.split(',').map((candidate) => candidate.trim()).filter(Boolean)
    : [value]

  for (const selection of selections) {
    if (selection === '$assigned') {
      inheritance.value = true
    } else if (selection.startsWith('team:')) {
      const teamId = selection.slice('team:'.length).trim()
      if (teamId) teamIds.add(teamId)
    } else if (!selection.startsWith('$')) {
      agentIds.add(selection)
    }
  }
}

/** Separate concrete avatars from inherited and team assignment semantics. */
export function collectWorkflowAssignments(steps: WorkflowStep[]): WorkflowAssignments {
  const agentIds = new Set<string>()
  const teamIds = new Set<string>()
  const inheritance = { value: false }

  for (const step of steps) {
    if (step.type === 'agent' || step.type === 'output' || step.type === 'createTask') {
      addAgentSelection(step.agent, agentIds, teamIds, inheritance)
    }
    if (step.type === 'parallel') {
      for (const child of step.steps) {
        addAgentSelection(child.agent, agentIds, teamIds, inheritance)
      }
    }
  }

  return {
    agentIds: Array.from(agentIds),
    inheritsTaskAgent: inheritance.value,
    teamIds: Array.from(teamIds),
  }
}

/** Return the filterable structural features present in a workflow. */
export function getWorkflowFeatures(steps: WorkflowStep[]): Set<WorkflowFeature> {
  const features = new Set<WorkflowFeature>()

  for (const step of steps) {
    switch (step.type) {
      case 'gate':
        features.add('gate')
        break
      case 'workflow':
        features.add('nested')
        break
      case 'parallel':
        features.add('parallel')
        break
      case 'map_workflow':
        features.add('fan-out')
        break
      case 'createTask':
        features.add('creates-task')
        if (step.workflowId) features.add('nested')
        break
    }
  }

  return features
}

export function workflowMatchesFeatures(
  steps: WorkflowStep[],
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true
  const features = getWorkflowFeatures(steps)
  return selected.some((feature) => features.has(feature as WorkflowFeature))
}

export function humanizeWorkflowId(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
