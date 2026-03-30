import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all the self-registering tool imports to prevent side-effect errors
vi.mock('../../scripts/lib/save-asset', () => ({}))
vi.mock('../../scripts/lib/log-progress', () => ({}))
vi.mock('../../scripts/lib/get-step', () => ({}))
vi.mock('../../scripts/lib/submit-step', () => ({}))
vi.mock('../../scripts/lib/check-gates', () => ({}))
vi.mock('../../scripts/lib/generate-image', () => ({}))
vi.mock('../../scripts/lib/post-discord', () => ({}))

import {
  addExecTool,
  getAllExecTools,
  getExecTool,
  recordExecToolCall,
  getExecToolStats,
} from '../../scripts/lib/registry'

describe('exec tool registry', () => {
  const mockTool = {
    name: 'bakin_exec_test_tool',
    description: 'Test tool',
    source: 'test',
    parameters: {},
    handler: async () => ({ ok: true as const }),
  }

  it('registers and retrieves a tool', () => {
    addExecTool(mockTool)
    expect(getExecTool('bakin_exec_test_tool')).toBe(mockTool)
  })

  it('returns undefined for unknown tool', () => {
    expect(getExecTool('nonexistent')).toBeUndefined()
  })

  it('getAllExecTools returns registered tools', () => {
    addExecTool(mockTool)
    const all = getAllExecTools()
    expect(all.find(t => t.name === 'bakin_exec_test_tool')).toBeDefined()
  })

  it('records tool call stats', () => {
    addExecTool(mockTool)
    recordExecToolCall('bakin_exec_test_tool')
    recordExecToolCall('bakin_exec_test_tool')

    const stats = getExecToolStats()
    const stat = stats.find(s => s.name === 'bakin_exec_test_tool')
    expect(stat).toBeDefined()
    expect(stat!.calls).toBeGreaterThanOrEqual(2)
    expect(stat!.lastUsed).toBeTruthy()
  })

  it('getExecToolStats includes source', () => {
    addExecTool(mockTool)
    const stats = getExecToolStats()
    const stat = stats.find(s => s.name === 'bakin_exec_test_tool')
    expect(stat!.source).toBe('test')
  })
})
