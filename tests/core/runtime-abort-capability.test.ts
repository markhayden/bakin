/**
 * T1 (#604): the adapter-neutral cancel capability — MessageArgs.signal and
 * the 'aborted' RuntimeError kind. Pure contract tests; no filesystem.
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { rmSync } from 'fs'

import { RuntimeError } from '../../packages/core/src/adapters/runtime/errors'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'

// Pure contract tests — nothing here touches storage, but the isolation rule
// is unconditional: no test may resolve the real ~/.bakin or ~/.openclaw.
const testDir = join(tmpdir(), `bakin-test-runtime-abort-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('RuntimeError kind: aborted', () => {
  test("'aborted' is a constructible RuntimeError kind", () => {
    const err = new RuntimeError('turn cancelled', { kind: 'aborted' })
    expect(err.kind).toBe('aborted')
    expect(err.name).toBe('RuntimeError')
  })
})

describe('mock runtime adapter honors MessageArgs.signal', () => {
  test('pre-aborted signal rejects with kind aborted', async () => {
    const adapter = createMockRuntimeAdapter()
    const controller = new AbortController()
    controller.abort('task-deleted')

    expect.assertions(2)
    try {
      await adapter.messaging.send({ agentId: 'a1', content: 'hello', signal: controller.signal })
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError)
      expect((err as RuntimeError).kind).toBe('aborted')
    }
  })

  test('unaborted signal sends normally', async () => {
    const adapter = createMockRuntimeAdapter()
    const controller = new AbortController()
    const result = await adapter.messaging.send({ agentId: 'a1', content: 'hello', signal: controller.signal })
    expect(result.id).toStartWith('msg-')
  })

  test('no signal keeps existing behavior', async () => {
    const adapter = createMockRuntimeAdapter()
    const result = await adapter.messaging.send({ agentId: 'a1', content: 'hello' })
    expect(result.id).toStartWith('msg-')
  })
})
