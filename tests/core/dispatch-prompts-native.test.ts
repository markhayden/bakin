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

import { buildDispatchMessage, mcporterHelpers, resolveToolInvocation } from '../../src/core/dispatch-prompts'
import { setAppServices } from '../../src/core/app-services'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'
import type { AppServices } from '@bakin/core/app-services'

describe('tool invocation styles', () => {
  test('mcporterHelpers renders both styles', () => {
    const cli = mcporterHelpers('rolo', 'mcporter-cli')
    expect(cli.mc('bakin_exec_tasks_get', 'taskId=t1')).toBe('mcporter call bakin-rolo.bakin_exec_tasks_get taskId=t1')
    const native = mcporterHelpers('rolo', 'native')
    expect(native.mc('bakin_exec_tasks_get', 'taskId=t1')).toBe('bakin_exec_tasks_get taskId=t1')
  })

  test('resolveToolInvocation follows the active runtime hint (fallback mcporter-cli)', () => {
    const runtime = createMockRuntimeAdapter({
      describeToolAccess: () => ({ invocation: 'native' as const }),
    })
    setAppServices({ runtime } as unknown as AppServices)
    expect(resolveToolInvocation()).toBe('native')

    const msg = buildDispatchMessage(
      { id: 't1', title: 'Do the thing', agent: 'rolo' },
      'rolo',
      '/tmp/none',
    )
    expect(msg).toContain('call these tools directly')
    expect(msg).toContain('bakin_exec_tasks_log_progress taskId=t1')
    expect(msg).not.toContain('mcporter')

    // Restore legacy default for other suites sharing this process.
    setAppServices({ runtime: createMockRuntimeAdapter() } as unknown as AppServices)
    expect(resolveToolInvocation()).toBe('mcporter-cli')
  })
})
