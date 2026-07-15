/**
 * Runtime conformance vs the REAL Pi adapter (in-process SDK) over the fake
 * OpenAI-compatible provider — zero LLM tokens. Recipes mirror
 * tests/integration/pi/turn.test.ts: seeded turn scripts per case, provider
 * 500 for the typed-failure pin, a delayed script for the mid-turn abort.
 */
import { beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

// The Pi SDK calls global fetch; the happy-dom preload replaces it with a
// browser emulation that breaks real sockets — restore Bun's native fetch.
globalThis.fetch = (Bun as unknown as { fetch: typeof fetch }).fetch

const testDir = join(tmpdir(), `bakin-test-runtime-conf-pi-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { RuntimeExecToolProvider } from '../../../packages/core/src/adapters/runtime'
import { createPiRuntimeAdapter } from '../../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../../packages/adapter-pi/src/models'
import { startFakeProvider, type FakeProvider, type FakeTurnScript } from '../pi/fake-provider'
import { runRuntimeConformanceSuite, type RuntimeConformanceTarget } from './conformance'

let provider: FakeProvider | undefined
const adapter = createPiRuntimeAdapter()
let threadSeq = 0

// Minimal echo exec tool so toolCall provider scripts round-trip (mirrors
// tests/integration/pi/turn.test.ts).
const execToolProvider: RuntimeExecToolProvider = {
  list: () => [{
    name: 'bakin_exec_conf_echo',
    description: 'Echo a message',
    parametersSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  }],
  invoke: async (_name, params) => ({ ok: true, text: JSON.stringify({ ok: true, echoed: params.message }) }),
}

function seedProvider(scripts: FakeTurnScript[]): void {
  provider?.stop()
  provider = startFakeProvider(scripts)
  // Point the fixture model at the fresh server (port changes per start).
  const agentDir = join(testDir, 'pi', 'agent')
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      fakeai: {
        name: 'FakeAI',
        baseUrl: provider.url,
        api: 'openai-completions',
        models: [{
          id: 'fake-model',
          name: 'Fake Model',
          input: ['text'],
          reasoning: false,
          contextWindow: 100000,
          maxTokens: 8000,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  }))
  resetModelRegistry()
}

beforeAll(async () => {
  resetPiHome()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({
    fakeai: { type: 'api_key', key: 'fake-key' },
  }))
  await adapter.initialize({
    contentDir: join(testDir, 'bakin'),
    execTools: execToolProvider,
    // Bakin's dispatch owns retries — disable Pi's inner retry layers so
    // failure cases settle immediately (same rationale as pi/turn.test.ts).
    settings: { retry: { enabled: false, provider: { maxRetries: 0 } } },
  })
  await adapter.provisionToolAccess() // seeds main (write-free initialize)
  await adapter.agents.update('main', { model: 'fakeai/fake-model' })
})

afterAll(() => {
  provider?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

const target: RuntimeConformanceTarget = {
  runtime: adapter,
  agentId: 'main',
  newThreadId: () => `conf:pi:${++threadSeq}`,
  prepareOkTurn: () => {
    seedProvider([{ steps: [{ text: 'conformance ' }, { text: 'reply' }], usage: { prompt: 3, completion: 2 } }])
  },
  failingSend: () => {
    seedProvider([{ status: 500, errorBody: { error: { message: 'fake provider exploded' } } }])
    return adapter.messaging.send({ agentId: 'main', content: 'must fail', threadId: `conf:pi:fail:${++threadSeq}` })
  },
  expectedFailingKind: 'runtime_failed',
  startAbortableTurn: () => {
    seedProvider([{ steps: [{ text: 'slow ' }, { delayMs: 3_000, text: 'never delivered' }] }])
    const controller = new AbortController()
    const settled = adapter.messaging.send({
      agentId: 'main',
      content: 'abort me mid-turn',
      threadId: `conf:pi:abort:${++threadSeq}`,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort('conformance: mid-turn'), 250)
    return { settled }
  },
  prepareToolTurn: () => {
    // Tool round-trip: the model "calls" the echo exec tool, then replies.
    seedProvider([
      { steps: [{ toolCall: { name: 'bakin_exec_conf_echo', args: { message: 'conformance ping' } } }] },
      { steps: [{ text: 'tool replied' }], usage: { prompt: 4, completion: 2 } },
    ])
    return 'conformance: use the echo tool'
  },
  failingStream: () => {
    seedProvider([{ status: 500, errorBody: { error: { message: 'fake provider exploded' } } }])
    return adapter.messaging.stream({
      agentId: 'main',
      content: 'conformance: failing stream',
      threadId: `conf:pi:fail-stream:${++threadSeq}`,
    })
  },
  // Pi provisions in-process (no durable writes) — nothing to snapshot.
  observeProvisionedState: () => null,
  // An uninitialized Pi adapter cannot serve a turn. The credential-presence
  // half of Pi's probe is unit-tested in tests/adapter-pi/ping-serveability
  // (PI_HOME is process-global — can't vary it mid-file here).
  makeUnserveableRuntime: () => createPiRuntimeAdapter(),
  // Fresh adapter against a pristine PI_HOME: initialize must create nothing
  // (seeding happens at provisionToolAccess). PI_HOME is process-global, so
  // the scenario re-points it and cleanup restores the shared home.
  makeFreshInitScenario: () => {
    const freshHome = join(testDir, `pi-fresh-${randomUUID()}`)
    process.env.PI_HOME = freshHome
    resetPiHome()
    const fresh = createPiRuntimeAdapter()
    return {
      homeDir: freshHome,
      initialize: () => fresh.initialize({ contentDir: join(testDir, 'bakin'), execTools: execToolProvider, settings: {} }),
      cleanup: () => {
        process.env.PI_HOME = join(testDir, 'pi')
        resetPiHome()
        resetModelRegistry()
      },
    }
  },
}

runRuntimeConformanceSuite('pi (fake provider)', () => target, { cron: 'absent' })
