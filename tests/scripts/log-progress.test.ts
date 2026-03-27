import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/core/task-service', () => ({
  logProgress: vi.fn(),
}))

vi.mock('../../scripts/lib/registry', () => ({
  addExecTool: vi.fn(),
}))

import { logProgressFormatted } from '../../scripts/lib/log-progress'
import { logProgress } from '../../src/core/task-service'

const mockLogProgress = vi.mocked(logProgress)

describe('logProgressFormatted', () => {
  it('formats with default category (progress)', async () => {
    mockLogProgress.mockResolvedValue(undefined as never)
    const result = await logProgressFormatted({
      taskId: 'task-123',
      message: 'Starting image generation',
      agent: 'pixel',
    })
    expect(result.ok).toBe(true)
    expect(result.formatted).toBe('[PROGRESS] Starting image generation')
    expect(mockLogProgress).toHaveBeenCalledWith(
      'task-123',
      'pixel',
      '[PROGRESS] Starting image generation',
      'mcp',
    )
  })

  it('uses category prefix', async () => {
    mockLogProgress.mockResolvedValue(undefined as never)
    const result = await logProgressFormatted({
      taskId: 'task-123',
      message: 'All done',
      agent: 'chef',
      category: 'complete',
    })
    expect(result.ok).toBe(true)
    expect(result.formatted).toBe('[COMPLETE] All done')
  })

  it('includes stage tag when provided', async () => {
    mockLogProgress.mockResolvedValue(undefined as never)
    const result = await logProgressFormatted({
      taskId: 'task-123',
      message: 'Generating hero image',
      agent: 'pixel',
      category: 'progress',
      stage: 'image-gen',
    })
    expect(result.ok).toBe(true)
    expect(result.formatted).toBe('[PROGRESS] [image-gen] Generating hero image')
  })

  it('uses start category', async () => {
    mockLogProgress.mockResolvedValue(undefined as never)
    const result = await logProgressFormatted({
      taskId: 'task-123',
      message: 'Beginning workflow',
      agent: 'chef',
      category: 'start',
    })
    expect(result.formatted).toContain('[START]')
  })

  it('uses milestone category', async () => {
    mockLogProgress.mockResolvedValue(undefined as never)
    const result = await logProgressFormatted({
      taskId: 'task-123',
      message: 'Copy approved',
      agent: 'chef',
      category: 'milestone',
    })
    expect(result.formatted).toContain('[MILESTONE]')
  })

  it('uses blocked category', async () => {
    mockLogProgress.mockResolvedValue(undefined as never)
    const result = await logProgressFormatted({
      taskId: 'task-123',
      message: 'API key missing',
      agent: 'pixel',
      category: 'blocked',
    })
    expect(result.formatted).toContain('[BLOCKED]')
  })

  it('returns fail on error', async () => {
    mockLogProgress.mockRejectedValue(new Error('db write failed'))
    const result = await logProgressFormatted({
      taskId: 'task-err',
      message: 'test',
      agent: 'pixel',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('db write failed')
  })
})
