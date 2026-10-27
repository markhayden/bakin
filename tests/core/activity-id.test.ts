import { describe, expect, it } from 'bun:test'
import { auditActivityId, taskLogActivityId } from '../../packages/core/src/events/activity-id'

describe('activity identities', () => {
  const ts = '2026-10-26T20:00:00.000Z'

  it('is deterministic for the same task-log entry', () => {
    expect(taskLogActivityId('task-1', ts, 'pixel', 'working')).toBe(taskLogActivityId('task-1', ts, 'pixel', 'working'))
  })

  it('separates same-author entries in the same millisecond by message', () => {
    expect(taskLogActivityId('task-1', ts, 'pixel', 'step one')).not.toBe(taskLogActivityId('task-1', ts, 'pixel', 'step two'))
  })

  it('never collides across tasks with the same timestamp and author', () => {
    expect(taskLogActivityId('task-1', ts, 'pixel', 'same')).not.toBe(taskLogActivityId('task-2', ts, 'pixel', 'same'))
  })

  it('derives audit ids from ts, event and agent (system when absent)', () => {
    expect(auditActivityId({ ts, event: 'task.created', agent: 'main' })).toBe(`audit:${ts}:task.created:main`)
    expect(auditActivityId({ ts, event: 'doctor.run' })).toBe(`audit:${ts}:doctor.run:system`)
  })
})
