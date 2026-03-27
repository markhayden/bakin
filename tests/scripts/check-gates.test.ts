import { describe, it, expect, vi } from 'vitest'

// Mock the runtime module before any imports
vi.mock('../../plugins/workflows/runtime', () => ({
  loadInstance: vi.fn(),
}))

// Mock the registry to prevent circular init
vi.mock('../../scripts/lib/registry', () => ({
  addExecTool: vi.fn(),
  getAllExecTools: vi.fn(() => []),
  getExecTool: vi.fn(),
  recordExecToolCall: vi.fn(),
  getExecToolStats: vi.fn(() => []),
}))

import { checkGates } from '../../scripts/lib/check-gates'
import { loadInstance } from '../../plugins/workflows/runtime'

const mockLoadInstance = vi.mocked(loadInstance)

describe('checkGates', () => {
  it('returns fail when no instance found', async () => {
    mockLoadInstance.mockReturnValue(null)
    const result = await checkGates('missing-task')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No workflow instance')
  })

  it('formats gate statuses from stepStates', async () => {
    mockLoadInstance.mockReturnValue({
      taskId: 'task-123',
      workflowId: 'content-pipeline',
      status: 'active',
      currentStepId: 'generate-image',
      stepStates: {
        'copy-gate': { status: 'complete', startedAt: '2026-03-25T14:00:00Z', completedAt: '2026-03-25T14:30:00Z' },
        'prompt-gate': { status: 'pending_approval', startedAt: '2026-03-25T15:00:00Z' },
        'write-copy': { status: 'complete', startedAt: '2026-03-25T13:00:00Z', completedAt: '2026-03-25T13:30:00Z' },
      },
      stepOrder: [],
      startedAt: '2026-03-25T12:00:00Z',
    } as never)

    const result = await checkGates('task-123')
    expect(result.ok).toBe(true)

    const text = result.formatted as string
    expect(text).toContain('content-pipeline')
    expect(text).toContain('copy-gate')
    expect(text).toContain('APPROVED')
    expect(text).toContain('prompt-gate')
    expect(text).toContain('WAITING')
    // write-copy should NOT appear (not a gate)
    expect(text).not.toContain('write-copy')
  })

  it('shows "no gates found" when none match', async () => {
    mockLoadInstance.mockReturnValue({
      taskId: 'task-456',
      workflowId: 'simple-flow',
      status: 'active',
      currentStepId: 'step-1',
      stepStates: {
        'step-1': { status: 'in_progress', startedAt: '2026-03-25T12:00:00Z' },
      },
      stepOrder: [],
      startedAt: '2026-03-25T12:00:00Z',
    } as never)

    const result = await checkGates('task-456')
    expect(result.ok).toBe(true)
    expect(result.formatted).toContain('no gates found')
  })
})
