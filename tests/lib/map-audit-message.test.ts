import { describe, it, expect } from 'bun:test'
import { mapAuditMessage, humanizeExecName, isNoisyEvent } from '../../src/lib/map-audit-message'
import type { ActivityEvent } from '../../src/types'

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

  it('maps model provider dispatch failures to a compact readable message', () => {
    expect(mapAuditMessage('task.dispatch_failed', {
      category: 'model_provider_unavailable',
      reasonCode: 'provider_cooldown',
      summary: 'Dispatch failed: model provider unavailable',
    })).toBe('Dispatch failed: model provider unavailable')
  })

  it('maps non-provider dispatch failures from the sanitized summary', () => {
    expect(mapAuditMessage('task.dispatch_failed', {
      summary: 'Dispatch failed: runtime transport unavailable',
    })).toBe('Dispatch failed: runtime transport unavailable')
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

  it('returns input unchanged for empty string', () => {
    expect(humanizeExecName('')).toBe('')
  })
})

describe('mapAuditMessage — exec edge cases', () => {
  it('handles exec event with no suffix (bare exec.tool_name)', () => {
    // No .ok/.fail/.error suffix — should still use label or humanize
    expect(mapAuditMessage('exec.bakin_exec_tasks_list', { label: 'Listed tasks' }))
      .toBe('Listed tasks')
  })

  it('humanizes bare exec event without label', () => {
    expect(mapAuditMessage('exec.bakin_exec_tasks_list', {}))
      .toBe('Tasks list')
  })

  it('label takes precedence over humanized name for .ok events', () => {
    expect(mapAuditMessage('exec.bakin_exec_assets_save.ok', { label: 'Saved an asset' }))
      .toBe('Saved an asset')
  })

  it('preserves label text exactly (no trimming or transformation)', () => {
    expect(mapAuditMessage('exec.bakin_exec_health_doctor.ok', { label: 'Ran diagnostics' }))
      .toBe('Ran diagnostics')
  })
})

describe('isNoisyEvent', () => {
  function makeEvent(overrides: Partial<ActivityEvent>): ActivityEvent {
    return {
      id: 'test-1',
      ts: '2026-04-10T00:00:00Z',
      type: 'audit',
      agent: 'system',
      message: 'test',
      ...overrides,
    }
  }

  it('flags system dispatch errors as noisy', () => {
    expect(isNoisyEvent(makeEvent({ agent: 'system', message: 'Dispatch failed: timeout' }))).toBe(true)
  })

  it('does not flag normal system events as noisy', () => {
    expect(isNoisyEvent(makeEvent({ agent: 'system', message: 'Bakin started' }))).toBe(false)
  })

  it('does not flag agent events as noisy', () => {
    expect(isNoisyEvent(makeEvent({ agent: 'pixel', message: 'Dispatch failed: something' }))).toBe(false)
  })

  it('does not flag duplicate events as noisy (separate concern)', () => {
    expect(isNoisyEvent(makeEvent({ agent: 'system', message: 'Created a task', duplicate: true }))).toBe(false)
  })

  it('flags successful read-only exec tool events as noisy', () => {
    expect(isNoisyEvent(makeEvent({
      agent: 'main',
      message: 'Listed content deliverables',
      eventName: 'exec.bakin_exec_messaging_deliverable_list.ok',
    }))).toBe(true)
    expect(isNoisyEvent(makeEvent({
      agent: 'main',
      message: 'Resolved paths',
      eventName: 'exec.bakin_exec_get_paths.ok',
    }))).toBe(true)
  })

  it('keeps write exec events and failed reads visible', () => {
    expect(isNoisyEvent(makeEvent({
      agent: 'main',
      message: 'Created a task',
      eventName: 'exec.bakin_exec_tasks_create.ok',
    }))).toBe(false)
    expect(isNoisyEvent(makeEvent({
      agent: 'main',
      message: 'Read task details (failed)',
      eventName: 'exec.bakin_exec_tasks_get.fail',
    }))).toBe(false)
  })
})
