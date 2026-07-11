/**
 * Runtime conformance vs the in-tree dev mock (createMockRuntimeAdapter).
 * Guarantees the mock stays an honest stand-in for the messaging contract
 * every real adapter must satisfy — plugin tests that pass against the mock
 * must not be passing against fantasy semantics.
 */
import { beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// The mock adapter is purely in-memory, but isolation rules are blanket:
// nothing in a test run may resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-runtime-conf-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { createMockRuntimeAdapter } from '../../../packages/core/src/adapters/runtime/testing'
import { runRuntimeConformanceSuite, type RuntimeConformanceTarget } from './conformance'

let target: RuntimeConformanceTarget
let threadSeq = 0

beforeEach(() => {
  const runtime = createMockRuntimeAdapter()
  target = {
    runtime,
    agentId: 'main',
    newThreadId: () => `conf:mock:${++threadSeq}`,
    // The mock's only genuine failure mode is a caller abort — its typed
    // rejection demonstrates the taxonomy pin. Real failure taxonomies
    // (provider/gateway errors) are exercised by the Pi and OpenClaw runners.
    failingSend: () => {
      const controller = new AbortController()
      controller.abort('conformance: pre-aborted')
      return runtime.messaging.send({ agentId: 'main', content: 'must fail', signal: controller.signal })
    },
    expectedFailingKind: 'aborted',
    startAbortableTurn: () => {
      const controller = new AbortController()
      const settled = runtime.messaging.send({
        agentId: 'main',
        content: 'abort me mid-turn',
        signal: controller.signal,
      })
      // The mock yields one macrotask per turn — a synchronous abort after
      // send() starts lands mid-turn.
      controller.abort('conformance: mid-turn')
      return { settled }
    },
    // The mock's content markers mirror real-adapter behavior: [[tool]]
    // streams/taps a structured tool call+result pair, [[fail]] is a typed
    // terminal failure.
    prepareToolTurn: () => 'conformance: use the tool [[tool]]',
    failingStream: () =>
      runtime.messaging.stream({
        agentId: 'main',
        content: 'conformance: fail this turn [[fail]]',
        threadId: `conf:mock:fail-stream:${++threadSeq}`,
      }),
    // The mock provisions nothing durable (in-process semantics).
    observeProvisionedState: () => null,
    // Shutdown flips the mock's alive flag — ping must read false after.
    makeUnserveableRuntime: async () => {
      const dead = createMockRuntimeAdapter()
      await dead.shutdown()
      return dead
    },
  }
})

runRuntimeConformanceSuite('dev mock', () => target)
