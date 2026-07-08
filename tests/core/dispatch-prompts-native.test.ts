/**
 * Adapter-aware tool-access rendering (P4): 'native' invocation renders bare
 * tool calls; the default stays byte-identical mcporter CLI (fixture suite
 * covers those bytes — this file covers the branch).
 */
import { describe, test, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-prompts-native-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { buildDispatchMessage, toolHelpers, resolveToolAccess } from '../../src/core/dispatch-prompts'
import { setAppServices } from '../../src/core/app-services'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'
import type { AppServices } from '@bakin/core/app-services'

describe('tool invocation styles', () => {
  test('toolHelpers renders per the supplied access style', () => {
    const bare = toolHelpers('rolo', { style: 'in-process' })
    expect(bare.mc('bakin_exec_tasks_get', 'taskId=t1')).toBe('bakin_exec_tasks_get taskId=t1')

    const mcp = toolHelpers('rolo', { style: 'mcp', mcpServerTemplate: 'bakin-<agent>' })
    expect(mcp.mc('bakin_exec_tasks_get', 'taskId=t1')).toBe('bakin-rolo.bakin_exec_tasks_get taskId=t1')
  })

  test('in-process runtime → bare calls + direct header, never a server prefix', () => {
    const runtime = createMockRuntimeAdapter({
      describeToolAccess: () => ({ style: 'in-process' as const }),
    })
    setAppServices({ runtime } as unknown as AppServices)
    expect(resolveToolAccess().style).toBe('in-process')

    const msg = buildDispatchMessage(
      { id: 't1', title: 'Do the thing', agent: 'rolo' },
      'rolo',
      '/tmp/none',
    )
    expect(msg).toContain('call these tools directly')
    expect(msg).toContain('bakin_exec_tasks_log_progress taskId=t1')
    expect(msg).not.toContain('bakin-rolo.')
    expect(msg).not.toContain('mcporter')
  })

  test('mcp runtime → native MCP header + per-agent prefixed calls', () => {
    const runtime = createMockRuntimeAdapter({
      describeToolAccess: () => ({ style: 'mcp' as const, mcpServerTemplate: 'bakin-<agent>' }),
    })
    setAppServices({ runtime } as unknown as AppServices)
    expect(resolveToolAccess().style).toBe('mcp')

    const msg = buildDispatchMessage(
      { id: 't1', title: 'Do the thing', agent: 'rolo' },
      'rolo',
      '/tmp/none',
    )
    expect(msg).toContain('native MCP tools (server `bakin-rolo`)')
    expect(msg).toContain('bakin-rolo.bakin_exec_tasks_log_progress taskId=t1')
    expect(msg).not.toContain('mcporter')

    // Restore a clean default runtime for other suites sharing this process.
    setAppServices({ runtime: createMockRuntimeAdapter() } as unknown as AppServices)
  })
})
