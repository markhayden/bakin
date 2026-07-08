/**
 * RuntimeExecToolProvider (P3) — the in-process exec-tool seam.
 */
import { describe, test, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-test-exec-provider-${Date.now()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const usageCalls: Record<string, unknown>[] = []
mock.module('../../src/core/usage', () => ({
  recordUsage: (u: Record<string, unknown>) => usageCalls.push(u),
}))
const auditCalls: unknown[][] = []
mock.module('../../src/core/audit', () => ({
  appendAudit: (...args: unknown[]) => auditCalls.push(args),
}))

import { addExecTool } from '../../src/core/exec-tools/registry'
import { createRuntimeExecToolProvider } from '../../src/core/exec-tools/provider'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

addExecTool({
  name: 'bakin_exec_test_echo',
  description: 'Echo a message back',
  parameters: { message: z.string(), times: z.number().int().optional() },
  handler: async (params, agent) => ({ ok: true, echoed: params.message, agent }),
})

addExecTool({
  name: 'bakin_exec_test_boom',
  description: 'Always throws',
  parameters: {},
  handler: async () => { throw new Error('kaboom') },
})

describe('runtime exec-tool provider', () => {
  const provider = createRuntimeExecToolProvider()

  test('list() exposes live registry entries as JSON Schema descriptors', () => {
    const tools = provider.list()
    const echo = tools.find((t) => t.name === 'bakin_exec_test_echo')
    expect(echo).toBeDefined()
    expect(echo!.description).toBe('Echo a message back')
    const schema = echo!.parametersSchema as { type: string; properties: Record<string, { type: string }>; required?: string[] }
    expect(schema.type).toBe('object')
    expect(schema.properties.message.type).toBe('string')
    expect(schema.required).toContain('message')
    expect(schema.required ?? []).not.toContain('times')
  })

  test('invoke() runs the handler with agent binding and records usage + audit', async () => {
    usageCalls.length = 0
    auditCalls.length = 0
    const result = await provider.invoke('bakin_exec_test_echo', { message: 'hi' }, 'agent-7')
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.text)).toMatchObject({ ok: true, echoed: 'hi', agent: 'agent-7' })
    expect(usageCalls[0]).toMatchObject({ kind: 'mcp', name: 'bakin_exec_test_echo', agent: 'agent-7', status: 'ok' })
    expect(auditCalls[0]?.[1]).toBe('exec.bakin_exec_test_echo.ok')
  })

  test('throwing handler yields ok:false + ERROR text, never throws across the seam', async () => {
    const result = await provider.invoke('bakin_exec_test_boom', {}, 'agent-7')
    expect(result.ok).toBe(false)
    expect(result.text).toStartWith('ERROR: kaboom')
  })

  test('unknown tool is an honest error', async () => {
    const result = await provider.invoke('bakin_exec_nope', {}, 'agent-7')
    expect(result.ok).toBe(false)
    expect(result.text).toContain('unknown exec tool')
  })
})
