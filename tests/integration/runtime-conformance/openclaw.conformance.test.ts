/**
 * Runtime conformance vs the REAL OpenClaw adapter over the Imitation Crab
 * mock gateway (push-event frames, ack-keyed aborts — the emulated wire the
 * streaming e2e already trusts). Failure/slow recipes flip the mock's
 * per-request chat mode env (`OPENCLAW_MOCK_CHAT_MODE` is read per RPC).
 */
import { beforeAll, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const tempDir = mkdtempSync(join(tmpdir(), 'bakin-runtime-conf-openclaw-'))
let mockHome = tempDir // re-pointed at the harness home once it exists

const contentDirMock = () => ({
  getContentDir: () => mockHome,
  getBakinPaths: () => ({ root: mockHome, home: mockHome, db: join(mockHome, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

const openClawHomeMock = () => ({
  getOpenClawHome: () => mockHome,
  getOpenClawPath: (...parts: string[]) => join(mockHome, ...parts),
  resetOpenClawHome: () => {},
})
mock.module('@bakin/adapter-openclaw/home', openClawHomeMock)
mock.module('../../../packages/adapter-openclaw/src/home', openClawHomeMock)

import { readFileSync } from 'fs'
import type { ChatChunk } from '../../../packages/core/src/adapters/runtime'
import { createImitationCrabHarness, type ImitationCrabHarness } from '../../../dev/imitation-crab/harness'
import { createOpenClawRuntimeAdapter } from '../../../packages/adapter-openclaw/src/index'
import { runRuntimeConformanceSuite, type RuntimeConformanceTarget } from './conformance'

let harness: ImitationCrabHarness
let threadSeq = 0

/**
 * Sessions capability-honesty pin: ON since T28 — sessions.list/get read
 * the real per-agent sessions.json store (the crab mirrors the gateway's
 * bookkeeping at run acceptance), so the declared 'native' mode is truthful.
 */
const SESSIONS_PIN_ENABLED = true

/** Run `fn` with the mock gateway in `mode` (read per RPC), restoring after. */
async function withChatMode<T>(mode: string, fn: () => Promise<T>, extraEnv?: Record<string, string>): Promise<T> {
  const prevMode = process.env.OPENCLAW_MOCK_CHAT_MODE
  const prevExtra = Object.fromEntries(Object.keys(extraEnv ?? {}).map((k) => [k, process.env[k]]))
  process.env.OPENCLAW_MOCK_CHAT_MODE = mode
  for (const [k, v] of Object.entries(extraEnv ?? {})) process.env[k] = v
  try {
    return await fn()
  } finally {
    if (prevMode === undefined) delete process.env.OPENCLAW_MOCK_CHAT_MODE
    else process.env.OPENCLAW_MOCK_CHAT_MODE = prevMode
    for (const [k, v] of Object.entries(prevExtra)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

beforeAll(async () => {
  harness = await createImitationCrabHarness({
    chatMode: 'echo',
    // Gives provisionToolAccess a target: bakin-<agent> MCP entries land in
    // the mock home's openclaw.json (the provisioning idempotency pin).
    bakinMcpBaseUrl: 'http://localhost:3737',
  })
  mockHome = harness.env.home
})

afterAll(async () => {
  await harness.close()
  rmSync(tempDir, { recursive: true, force: true })
})

const target: RuntimeConformanceTarget = {
  get runtime() {
    return harness.services.runtime
  },
  agentId: 'pixel',
  newThreadId: () => `conf:openclaw:${++threadSeq}`,
  failingSend: () =>
    withChatMode('error', () =>
      harness.services.runtime.messaging.send({
        agentId: 'pixel',
        content: 'must fail',
        threadId: `conf:openclaw:fail:${++threadSeq}`,
      }),
    ),
  // Gateway error frames map to 'runtime_failed' (structured runtime
  // failure) — pinned exactly, matching the Pi and mock runners.
  expectedFailingKind: 'runtime_failed',
  startAbortableTurn: async () => {
    const controller = new AbortController()
    // The slow mode holds the final response for 10s; the mode env is read
    // when the RPC arrives, so keep it set until the send settles.
    const prevMode = process.env.OPENCLAW_MOCK_CHAT_MODE
    const prevDelay = process.env.OPENCLAW_MOCK_CHAT_DELAY_MS
    process.env.OPENCLAW_MOCK_CHAT_MODE = 'slow'
    process.env.OPENCLAW_MOCK_CHAT_DELAY_MS = '10000'
    const restore = () => {
      if (prevMode === undefined) delete process.env.OPENCLAW_MOCK_CHAT_MODE
      else process.env.OPENCLAW_MOCK_CHAT_MODE = prevMode
      if (prevDelay === undefined) delete process.env.OPENCLAW_MOCK_CHAT_DELAY_MS
      else process.env.OPENCLAW_MOCK_CHAT_DELAY_MS = prevDelay
    }
    const settled = harness.services.runtime.messaging.send({
      agentId: 'pixel',
      content: 'abort me mid-turn',
      threadId: `conf:openclaw:abort:${++threadSeq}`,
      signal: controller.signal,
    })
    settled.catch(() => {}).finally(restore)
    // Give the RPC time to reach the gateway and the accepted ack to land,
    // then abort mid-turn (well inside the 10s hold).
    setTimeout(() => controller.abort('conformance: mid-turn'), 300)
    return { settled }
  },
  // The crab's [[tool]] content trigger emits tool/item/command_output
  // frames like the real wire (fixture-shaped).
  prepareToolTurn: () => 'conformance: run the listing [[tool]] then summarize',
  failingStream: () => {
    // The mode env is read when the RPC arrives (first iteration) — hold it
    // for the whole stream and restore on exit, error, or early break.
    const inner = harness.services.runtime.messaging.stream({
      agentId: 'pixel',
      content: 'conformance: failing stream',
      threadId: `conf:openclaw:fail-stream:${++threadSeq}`,
    })
    async function* withErrorMode(): AsyncIterable<ChatChunk> {
      const prev = process.env.OPENCLAW_MOCK_CHAT_MODE
      process.env.OPENCLAW_MOCK_CHAT_MODE = 'error'
      try {
        yield* inner
      } finally {
        if (prev === undefined) delete process.env.OPENCLAW_MOCK_CHAT_MODE
        else process.env.OPENCLAW_MOCK_CHAT_MODE = prev
      }
    }
    return withErrorMode()
  },
  // Provisioning writes bakin-<agent> MCP entries into the mock home's
  // openclaw.json — the durable state the idempotency pin snapshots.
  observeProvisionedState: () => readFileSync(join(mockHome, 'openclaw.json'), 'utf-8'),
  // An adapter pointed at a dead port: ping's HTTP probe must resolve false.
  makeUnserveableRuntime: () =>
    createOpenClawRuntimeAdapter({
      settings: { gatewayUrl: 'http://127.0.0.1', gatewayPort: 1 },
    }),
  // Fresh adapter against a pristine home: initialize must create nothing.
  // The home module is mocked to the closure-mutable `mockHome`, so the
  // scenario re-points it and cleanup restores the harness home.
  makeFreshInitScenario: () => {
    const harnessHome = mockHome
    const freshHome = join(tempDir, `openclaw-fresh-${++threadSeq}`)
    mockHome = freshHome
    const fresh = createOpenClawRuntimeAdapter()
    return {
      homeDir: freshHome,
      initialize: () =>
        fresh.initialize({ contentDir: freshHome, bakinMcpBaseUrl: 'http://localhost:3737' }),
      cleanup: () => {
        mockHome = harnessHome
      },
    }
  },
}

runRuntimeConformanceSuite('openclaw (imitation crab)', () => target, { sessionsPin: SESSIONS_PIN_ENABLED, cron: 'present' })
