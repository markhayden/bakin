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
mock.module('../../scripts/lib/generate-image', () => ({}))
mock.module('../../scripts/lib/post-discord', () => ({}))
mock.module('../../scripts/lib/get-paths', () => ({}))

import {
  addExecTool,
  getAllExecTools,
  getExecTool,
} from '../../scripts/lib/registry'

// Per-tool call counting now lives in the unified usage recorder
// (src/core/usage.ts). The registry is just a Map lookup; any test that
// wants to assert call/error counts for a tool should drive recordUsage()
// directly and query getUsageFeed({ kind: 'mcp' }).

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
})
