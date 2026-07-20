/**
 * Enrichment engine resolution ladder (spec: enrichment-runtime-fallback
 * §1/§4): auto = direct key → runtime-if-capable → skip-with-composed-
 * reason; pinned providers never fall through; runtime path is capability-
 * gated with honest reasons and resolves to the runtime engine bound to
 * the configured agent (default 'enrich').
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-enrich-engine-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

// Key resolution is the ladder's direct-path gate — driven via env vars
// (the resolver's first source), same pattern as enrichment-queue.test.ts.
const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY'] as const
const SAVED_ENV = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]))
function clearKeys(): void {
  for (const k of ENV_KEYS) delete process.env[k]
}
function setAnthropicKey(): void {
  process.env.ANTHROPIC_API_KEY = 'sk-test'
}

import { resolveEnrichmentEngine } from '../../../plugins/assets/lib/enrichment/engine'
import { checkEnrichmentEngine } from '../../../plugins/assets/lib/health-checks'
import { runtimeEngineAvailability } from '../../../plugins/assets/lib/enrichment/runtime'
import { createMockRuntimeAdapter } from '../../../packages/core/src/adapters/runtime/testing'
import type { AgentRuntimeAdapter } from '../../../packages/core/src/adapters/runtime'

afterAll(() => {
  for (const [k, v] of SAVED_ENV) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(testDir, { recursive: true, force: true })
})
beforeEach(() => { clearKeys() })

function capabilitySetWith(input: { imageInput: boolean; audioInput: boolean }) {
  return {
    toolCalling: { mode: 'native' as const, access: { style: 'cli-shim' as const } },
    delivery: { mode: 'native' as const },
    imageGen: { mode: 'unavailable' as const },
    memory: { mode: 'native' as const },
    sessions: { mode: 'native' as const },
    workspaceFiles: { mode: 'native' as const },
    concurrency: { sameAgentTurns: 'serialized' as const },
    input,
  }
}

function runtimeWith(caps: { imageInput: boolean; audioInput: boolean } | 'none' | 'throws'): AgentRuntimeAdapter {
  const base = createMockRuntimeAdapter()
  if (caps === 'none') {
    const { capabilities: _drop, ...rest } = base as AgentRuntimeAdapter & { capabilities?: unknown }
    return rest as AgentRuntimeAdapter
  }
  if (caps === 'throws') {
    return { ...base, capabilities: async () => { throw new Error('probe boom') } }
  }
  return { ...base, capabilities: async () => capabilitySetWith(caps) }
}

describe('resolveEnrichmentEngine ladder', () => {
  it('auto + key present → direct engine (cheapest configured model)', async () => {
    setAnthropicKey()
    const resolution = await resolveEnrichmentEngine({}, { kind: 'image' }, { runtime: null })
    expect(resolution.ok).toBe(true)
    if (resolution.ok) {
      expect(resolution.engine.name).toBe('direct')
      expect(resolution.engine.modelId).toBe('anthropic/claude-haiku-4-5')
    }
  })

  it('auto + no key + capable runtime → runtime engine on the default agent', async () => {
    const resolution = await resolveEnrichmentEngine(
      {}, { kind: 'image' }, { runtime: runtimeWith({ imageInput: true, audioInput: false }) },
    )
    expect(resolution.ok).toBe(true)
    if (resolution.ok) {
      expect(resolution.engine.name).toBe('runtime')
      expect(resolution.engine.modelId).toBe('runtime:enrich')
    }
  })

  it('enrichmentAgent setting picks the runtime agent', async () => {
    const resolution = await resolveEnrichmentEngine(
      { enrichmentProvider: 'runtime', enrichmentAgent: 'vision-bot' }, { kind: 'image' },
      { runtime: runtimeWith({ imageInput: true, audioInput: false }) },
    )
    expect(resolution.ok).toBe(true)
    if (resolution.ok) expect(resolution.engine.modelId).toBe('runtime:vision-bot')
  })

  it('auto + no key + text-only runtime → composed skip reason', async () => {
    const resolution = await resolveEnrichmentEngine(
      {}, { kind: 'image' }, { runtime: runtimeWith({ imageInput: false, audioInput: false }) },
    )
    expect(resolution.ok).toBe(false)
    if (!resolution.ok) {
      expect(resolution.reason).toContain('no vision-capable enrichment model configured')
      expect(resolution.reason).toContain("runtime unavailable: agent 'enrich' has no image input")
    }
  })

  it('pinned direct provider never falls through to the runtime', async () => {
    const resolution = await resolveEnrichmentEngine(
      { enrichmentProvider: 'anthropic' }, { kind: 'image' },
      { runtime: runtimeWith({ imageInput: true, audioInput: true }) },
    )
    expect(resolution.ok).toBe(false)
    if (!resolution.ok) {
      expect(resolution.reason).toContain('provider pinned to anthropic')
      expect(resolution.reason).not.toContain('runtime')
    }
  })

  it("provider 'runtime' consults only the runtime path", async () => {
    setAnthropicKey() // a key exists but must be ignored
    const resolution = await resolveEnrichmentEngine(
      { enrichmentProvider: 'runtime' }, { kind: 'image' },
      { runtime: runtimeWith({ imageInput: false, audioInput: false }) },
    )
    expect(resolution.ok).toBe(false)
    if (!resolution.ok) expect(resolution.reason).toBe("runtime unavailable: agent 'enrich' has no image input")
  })

  it('disabled settings short-circuit everything', async () => {
    setAnthropicKey()
    const resolution = await resolveEnrichmentEngine(
      { enrichmentEnabled: false }, { kind: 'image' }, { runtime: null },
    )
    expect(resolution.ok).toBe(false)
    if (!resolution.ok) expect(resolution.reason).toBe('enrichment disabled in settings')
  })
})

describe('runtimeEngineAvailability capability gating', () => {
  it('no runtime / no capabilities member / probe failure → honest reasons', async () => {
    expect(await runtimeEngineAvailability(null, { kind: 'image' }))
      .toEqual({ ok: false, reason: 'no runtime adapter available' })
    expect(await runtimeEngineAvailability(runtimeWith('none'), { kind: 'image' }))
      .toEqual({ ok: false, reason: 'runtime does not report input capabilities' })
    expect(await runtimeEngineAvailability(runtimeWith('throws'), { kind: 'image' }))
      .toEqual({ ok: false, reason: 'runtime capability probe failed' })
  })

  it('audio jobs gate on audioInput; documents need no media modality', async () => {
    const imageOnly = runtimeWith({ imageInput: true, audioInput: false })
    expect(await runtimeEngineAvailability(imageOnly, { kind: 'audio' }))
      .toEqual({ ok: false, reason: 'runtime model has no audio input' })
    const doc = await runtimeEngineAvailability(runtimeWith({ imageInput: false, audioInput: false }), { kind: 'document' })
    expect(doc).toEqual({ ok: true })
  })
})

describe('checkEnrichmentEngine health observation', () => {
  it('reports the active runtime engine + agent when keyless and capable', async () => {
    const row = await checkEnrichmentEngine({}, runtimeWith({ imageInput: true, audioInput: false }))
    expect(row.status).toBe('healthy')
    expect(row.summary).toContain('Runtime agent enrichment is ready with enrich')
  })

  it('reports the direct engine when a key is configured', async () => {
    setAnthropicKey()
    const row = await checkEnrichmentEngine({}, null)
    expect(row.status).toBe('healthy')
    expect(row.summary).toContain('Direct API enrichment is ready with anthropic/claude-haiku-4-5')
  })

  it('warns with the composed capability verdict when nothing can serve', async () => {
    const row = await checkEnrichmentEngine({}, runtimeWith({ imageInput: false, audioInput: false }))
    expect(row.status).toBe('warning')
    expect(row.summary).toContain("agent 'enrich' has no image input")
  })
})
