import { describe, expect, it } from 'bun:test'
import type { WorkflowTemplate, WorkflowStep } from '../../../plugins/workflows/types'
import { getWorkflowSource, parseWorkflowSort, sortWorkflows } from '../../../plugins/workflows/lib/workflow-sort'

function template(name: string, steps: WorkflowStep[] = [], extra: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return { name, filename: name, description: '', stepCount: steps.length,
    definition: { name, version: 1, description: '', steps }, ...extra }
}

describe('workflow collection sorting', () => {
  it('classifies plugins and agent packages as managed, with legacy definitions custom', () => {
    expect(getWorkflowSource(template('plugin', [], { source: 'plugin' }))).toBe('managed')
    expect(getWorkflowSource(template('package', [], { source: 'agent-package' }))).toBe('managed')
    expect(getWorkflowSource(template('legacy'))).toBe('custom')
    expect(getWorkflowSource(template('override', [], { source: 'user', shadowedSource: { source: 'plugin' } }))).toBe('custom')
  })

  it('validates URL fields and directions without introducing a default sort', () => {
    expect(parseWorkflowSort('', 'desc')).toBeUndefined()
    expect(parseWorkflowSort('unknown', 'asc')).toBeUndefined()
    expect(parseWorkflowSort('name', 'invalid')).toEqual({ field: 'name', dir: 'asc' })
    expect(parseWorkflowSort('source', 'desc')).toEqual({ field: 'source', dir: 'desc' })
  })

  it('preserves relevance when unsorted, sorts names naturally, and never mutates input', () => {
    const rows = [template('Workflow 10'), template('workflow 2'), template('Alpha')]
    const names = (sort?: ReturnType<typeof parseWorkflowSort>) => sortWorkflows(rows, sort).map(row => row.name)
    expect(names()).toEqual(['Workflow 10', 'workflow 2', 'Alpha'])
    expect(names({ field: 'name', dir: 'asc' })).toEqual(['Alpha', 'workflow 2', 'Workflow 10'])
    expect(names({ field: 'name', dir: 'desc' })).toEqual(['Workflow 10', 'workflow 2', 'Alpha'])
    expect(rows[0].name).toBe('Workflow 10')
  })

  it('sorts step counts numerically and keeps ties stable', () => {
    const rows = [template('ten', [], { stepCount: 10 }), template('two', [], { stepCount: 2 }), template('also two', [], { stepCount: 2 })]
    expect(sortWorkflows(rows, { field: 'steps', dir: 'asc' }).map(row => row.name)).toEqual(['two', 'also two', 'ten'])
  })

  it('sorts sources in both directions', () => {
    const rows = [template('managed', [], { source: 'agent-package' }), template('custom', [], { source: 'user' })]
    expect(sortWorkflows(rows, { field: 'source', dir: 'asc' })[0].name).toBe('custom')
    expect(sortWorkflows(rows, { field: 'source', dir: 'desc' })[0].name).toBe('managed')
  })

  it('sorts features by visible approval count then nested count', () => {
    const gate: WorkflowStep = { id: 'gate', type: 'gate', label: 'Review' }
    const nested: WorkflowStep = { id: 'nested', type: 'workflow', label: 'Child', workflow_id: 'child' }
    const rows = [template('both', [gate, nested]), template('approval', [gate]), template('nested', [nested]), template('none')]
    expect(sortWorkflows(rows, { field: 'features', dir: 'asc' }).map(row => row.name)).toEqual(['nested', 'approval', 'both', 'none'])
    expect(sortWorkflows(rows, { field: 'features', dir: 'desc' }).map(row => row.name)).toEqual(['both', 'approval', 'nested', 'none'])
  })

  it('uses assignment display names and leaves absent assignments last in both directions', () => {
    const agent = (id: string): WorkflowStep => ({ id, type: 'agent', label: 'Work', agent: id })
    const rows = [template('empty'), template('pixel', [agent('pixel')]), template('main', [agent('main')]), template('inherited', [agent('$assigned')])]
    const names = new Map([['pixel', 'Zoe'], ['main', 'Ada']])
    expect(sortWorkflows(rows, { field: 'assignment', dir: 'asc' }, names).map(row => row.name)).toEqual(['main', 'inherited', 'pixel', 'empty'])
    expect(sortWorkflows(rows, { field: 'assignment', dir: 'desc' }, names).map(row => row.name)).toEqual(['pixel', 'inherited', 'main', 'empty'])
  })
})
