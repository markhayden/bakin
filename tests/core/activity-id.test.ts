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

  it('is deterministic for the same audit record, agent defaulting to system', () => {
    const entry = { ts, event: 'task.created', agent: 'main', data: { id: 'a', title: 'A' } }
    expect(auditActivityId(entry)).toBe(auditActivityId({ ...entry, data: { id: 'a', title: 'A' } }))
    expect(auditActivityId({ ts, event: 'doctor.run' })).toBe(auditActivityId({ ts, event: 'doctor.run', agent: 'system', data: {} }))
  })

  it('separates same-instant audit records from the same agent by their data', () => {
    expect(auditActivityId({ ts, event: 'task.created', agent: 'main', data: { id: 'a' } }))
      .not.toBe(auditActivityId({ ts, event: 'task.created', agent: 'main', data: { id: 'b' } }))
  })

  it('derives the same id from a record and its JSON round-trip (HTTP snapshot vs SSE)', () => {
    const live = { ts, event: 'task.moved', agent: 'pixel', data: { id: 'a', from: 'todo', to: 'done' } }
    expect(auditActivityId(JSON.parse(JSON.stringify(live)))).toBe(auditActivityId(live))
  })
})
