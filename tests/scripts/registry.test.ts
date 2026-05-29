import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Sandbox — registry tests don't touch disk but the isolation rule is
// enforced globally to prevent any accidental writes to ~/.bakin/.
const testDir = join(tmpdir(), `bakin-test-registry-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ content: testDir }),
}))

// Mock self-registering tool imports to prevent side-effect errors
mock.module('../../scripts/lib/log-progress', () => ({}))
mock.module('../../scripts/lib/post-channel', () => ({}))
mock.module('../../scripts/lib/get-paths', () => ({}))

import {
  addExecTool,
  getAllExecTools,
  getExecTool,
  removeExecToolsByPlugin,
} from '../../scripts/lib/registry'

// Per-tool call counting now lives in the unified usage recorder
// (src/core/usage.ts). The registry is just a Map lookup; any test that
// wants to assert call/error counts for a tool should drive recordUsage()
// directly and query getUsageFeed({ kind: 'mcp' }).

describe('exec tool registry', () => {
  function mockTool(name: string, source = 'test') {
    return {
      name,
      description: 'Test tool',
      source,
      parameters: {},
      handler: async () => ({ ok: true as const }),
    }
  }

  it('registers and retrieves a tool', () => {
    const tool = mockTool('bakin_exec_test_tool_registers')
    addExecTool(tool)
    expect(getExecTool('bakin_exec_test_tool_registers')).toBe(tool)
  })

  it('rejects duplicate tool names instead of overriding', () => {
    addExecTool(mockTool('bakin_exec_test_tool_duplicate'))

    expect(() => addExecTool(mockTool('bakin_exec_test_tool_duplicate'))).toThrow('already registered')
  })

  it('removes plugin-owned tools by recorded source as well as namespace prefix', () => {
    addExecTool(mockTool('legacy_tool_name', 'plugin:sample'))
    addExecTool(mockTool('bakin_exec_sample_namespaced', 'plugin:sample'))
    addExecTool(mockTool('bakin_exec_other_namespaced', 'plugin:other'))

    expect(removeExecToolsByPlugin('sample')).toBe(2)
    expect(getExecTool('legacy_tool_name')).toBeUndefined()
    expect(getExecTool('bakin_exec_sample_namespaced')).toBeUndefined()
    expect(getExecTool('bakin_exec_other_namespaced')).toBeDefined()
  })

  it('returns undefined for unknown tool', () => {
    expect(getExecTool('nonexistent')).toBeUndefined()
  })

  it('getAllExecTools returns registered tools', () => {
    const tool = mockTool('bakin_exec_test_tool_all')
    addExecTool(tool)
    const all = getAllExecTools()
    expect(all.find(t => t.name === 'bakin_exec_test_tool_all')).toBeDefined()
  })
})
