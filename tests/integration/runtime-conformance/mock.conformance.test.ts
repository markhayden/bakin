/**
 * Runtime conformance vs the in-tree dev mock (createMockRuntimeAdapter).
 * Guarantees the mock stays an honest stand-in for the messaging contract
 * every real adapter must satisfy — plugin tests that pass against the mock
 * must not be passing against fantasy semantics.
 */
import { afterAll, beforeEach, describe, it, mock } from 'bun:test'
import { rmSync } from 'fs'
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

import { createMockRuntimeAdapter, mockCron } from '../../../packages/core/src/adapters/runtime/testing'
import { runRuntimeConformanceSuite, runtimeConformanceChecks, type RuntimeConformanceTarget } from './conformance'

let target: RuntimeConformanceTarget
let threadSeq = 0

beforeEach(() => {
  const runtime = createMockRuntimeAdapter()
  target = {
    runtime,
    agentId: 'main',
    newThreadId: () => `conf:mock:${++threadSeq}`,
    // The mock's [[fail]] marker is its provider-failure recipe (typed
    // runtime_failed) — the same taxonomy class the Pi and OpenClaw runners
    // exercise with real provider/gateway errors, and distinct from the
    // abort pin's code path. Plugin tests rely on this marker (documented in
    // testing.ts), so the suite pins the send half here.
    failingSend: () =>
      runtime.messaging.send({ agentId: 'main', content: 'conformance: must fail [[fail]]' }),
    expectedFailingKind: 'runtime_failed',
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
    // The mock is purely in-memory: a fresh initialize against a pristine
    // dir must leave it absent.
    makeFreshInitScenario: () => {
      const freshHome = join(testDir, `mock-fresh-${randomUUID()}`)
      const fresh = createMockRuntimeAdapter()
      return {
        homeDir: freshHome,
        initialize: () => fresh.initialize({ contentDir: freshHome }),
      }
    },
  }
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

runRuntimeConformanceSuite('dev mock', () => target, { cron: 'absent' })

// The minimal mock omits cron; the opt-in surface must still honor the CRUD
// contract so schedule tests exercising it inherit pinned behavior.
describe('mock cron opt-in (mockCron)', () => {
  it('round-trips the cron CRUD contract', async () => {
    const cronTarget = { ...target, runtime: createMockRuntimeAdapter({ cron: mockCron() }) }
    await runtimeConformanceChecks.cronCrudRoundTrip(cronTarget)
  })
})
