import { describe, it, expect } from 'vitest'
import { mapAuditMessage, humanizeExecName } from '../../src/lib/map-audit-message'

describe('mapAuditMessage', () => {
  // Existing domain events should still work
  it('maps task.created to human-readable text', () => {
    expect(mapAuditMessage('task.created', { title: 'Fix bug' })).toBe('Created task: Fix bug')
  })

  it('maps task.moved with title and target', () => {
    expect(mapAuditMessage('task.moved', { title: 'Fix bug', to: 'done' })).toBe('Moved "Fix bug" → done')
  })

  it('maps workflow.gate_reached', () => {
    expect(mapAuditMessage('workflow.gate_reached', { label: 'Review' })).toBe('Awaiting approval: Review')
  })

  it('maps system.init', () => {
    expect(mapAuditMessage('system.init', {})).toBe('Bakin started')
  })

  // Exec tool events with label in data
  it('uses data.label for exec.*.ok events', () => {
    expect(mapAuditMessage('exec.bakin_exec_tasks_create.ok', { label: 'Created a task' }))
      .toBe('Created a task')
  })

  it('appends (failed) for exec.*.fail events', () => {
    expect(mapAuditMessage('exec.bakin_exec_tasks_create.fail', { label: 'Created a task', error: 'oops' }))
      .toBe('Created a task (failed)')
  })

  it('appends (error) for exec.*.error events', () => {
    expect(mapAuditMessage('exec.bakin_exec_health_doctor.error', { label: 'Ran diagnostics', error: 'timeout' }))
      .toBe('Ran diagnostics (error)')
  })

  // Exec tool events without label — fallback to humanized name
  it('humanizes exec tool name when no label present', () => {
    expect(mapAuditMessage('exec.bakin_exec_tasks_list.ok', {}))
      .toBe('Tasks list')
  })

  it('humanizes and appends (failed) for exec.*.fail without label', () => {
    expect(mapAuditMessage('exec.bakin_exec_schedule_create.fail', {}))
      .toBe('Schedule create (failed)')
  })

  // Unknown events pass through
  it('returns raw event name for unknown events', () => {
    expect(mapAuditMessage('some.unknown.event', {})).toBe('some.unknown.event')
  })
})

describe('humanizeExecName', () => {
  it('strips bakin_exec_ prefix and capitalizes', () => {
    expect(humanizeExecName('bakin_exec_tasks_list')).toBe('Tasks list')
  })

  it('handles multi-word tool names', () => {
    expect(humanizeExecName('bakin_exec_workflows_complete_step')).toBe('Workflows complete step')
  })

  it('handles names without bakin_exec_ prefix', () => {
    expect(humanizeExecName('custom_tool')).toBe('Custom tool')
  })

  it('handles single word after prefix', () => {
    expect(humanizeExecName('bakin_exec_heartbeat')).toBe('Heartbeat')
  })
})
