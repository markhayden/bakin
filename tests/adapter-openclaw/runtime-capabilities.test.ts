/**
 * Runtime capabilities probe — answers imageInput/audioInput from the
 * runtime's OWN model catalog for the selected agent's effective model (default: main)
 * (spec: enrichment-runtime-fallback §3). Conservative false everywhere
 * ambiguous; the same catalog the gateway's attachment gate enforces.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-caps-'))

// Mutable per-test: which agents exist and what the main agent's model is.
let mockAgents: Array<{ id: string; name: string; model?: { primary?: string } }> = []

mock.module('../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => testHome,
  getOpenClawPath: (...parts: string[]) => join(testHome, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../packages/adapter-openclaw/src/config', () => ({
  readOpenClawConfig: () => ({ agents: { list: mockAgents } }),
  findAgentById: (id: string) => mockAgents.find((a) => a.id === id) ?? null,
  getAgentList: () => mockAgents,
}))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }),
}))
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'

const binDir = join(testHome, 'bin')
const openclaw = join(binDir, 'openclaw')

function writeModelsBinary(models: Array<Record<string, unknown>>): void {
  mkdirSync(binDir, { recursive: true })
  writeFileSync(openclaw, `#!/bin/sh
cat <<'JSON'
${JSON.stringify({ models })}
JSON
`, 'utf-8')
  chmodSync(openclaw, 0o755)
}

function makeAdapter() {
  return createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })
}

beforeEach(() => {
  mockAgents = [{ id: 'main', name: 'Main', model: { primary: 'openai/gpt-5.5' } }]
})

afterAll(() => rmSync(testHome, { recursive: true, force: true }))

describe('OpenClaw runtime capabilities', () => {
  it('reports imageInput true when the main agent model is catalog-declared text+image', async () => {
    writeModelsBinary([
      { key: 'openai/gpt-5.5', input: 'text+image', available: true, tags: ['configured'] },
    ])
    const caps = await makeAdapter().capabilities!()
    expect(caps).toEqual({ imageInput: true, audioInput: false })
  })

  it('reports all-false for a text-declared model (the live-machine case)', async () => {
    writeModelsBinary([
      { key: 'openai/gpt-5.5', input: 'text', available: true, tags: ['configured'] },
      { key: 'anthropic/claude-sonnet-4-6', input: 'text+image', available: true, tags: ['configured'] },
    ])
    const caps = await makeAdapter().capabilities!()
    // Other catalog models being multimodal is irrelevant — the probe keys
    // on the main agent's EFFECTIVE model, which the gateway gate enforces.
    expect(caps).toEqual({ imageInput: false, audioInput: false })
  })

  it("falls back to the catalog's `default`-tagged entry when the agent has no explicit model", async () => {
    mockAgents = [{ id: 'main', name: 'Main' }]
    writeModelsBinary([
      { key: 'openai/gpt-5.4', input: 'text+image', available: true, tags: ['default', 'configured'] },
      { key: 'openai/gpt-5.3-codex', input: 'text', available: true, tags: ['fallback#1'] },
    ])
    const caps = await makeAdapter().capabilities!()
    expect(caps.imageInput).toBe(true)
  })

  it('reports all-false when the model is missing from the catalog (ambiguity = false)', async () => {
    writeModelsBinary([
      { key: 'someone/else', input: 'text+image', available: true },
    ])
    const caps = await makeAdapter().capabilities!()
    expect(caps).toEqual({ imageInput: false, audioInput: false })
  })

  it('reports all-false when the catalog read fails (probe never throws)', async () => {
    mkdirSync(binDir, { recursive: true })
    writeFileSync(openclaw, '#!/bin/sh\nexit 1\n', 'utf-8')
    chmodSync(openclaw, 0o755)
    const caps = await makeAdapter().capabilities!()
    expect(caps).toEqual({ imageInput: false, audioInput: false })
  })

  it('evaluates the REQUESTED agent, not main (per-agent probe for enrichmentAgent)', async () => {
    mockAgents = [
      { id: 'main', name: 'Main', model: { primary: 'openai/gpt-5.5' } },
      { id: 'enrich', name: 'Enrich', model: { primary: 'anthropic/claude-sonnet-4-6' } },
    ]
    writeModelsBinary([
      { key: 'openai/gpt-5.5', input: 'text', available: true },
      { key: 'anthropic/claude-sonnet-4-6', input: 'text+image', available: true },
    ])
    const adapter = makeAdapter()
    expect(await adapter.capabilities!()).toEqual({ imageInput: false, audioInput: false })
    expect(await adapter.capabilities!({ agentId: 'enrich' })).toEqual({ imageInput: true, audioInput: false })
    // per-agent cache isolation: repeat both, same answers
    expect(await adapter.capabilities!({ agentId: 'enrich' })).toEqual({ imageInput: true, audioInput: false })
    expect(await adapter.capabilities!()).toEqual({ imageInput: false, audioInput: false })
  })

  it('a REQUESTED agent that does not exist reports all-false (no default-model fallback)', async () => {
    writeModelsBinary([
      { key: 'openai/gpt-5.4', input: 'text+image', available: true, tags: ['default'] },
    ])
    const caps = await makeAdapter().capabilities!({ agentId: 'ghost' })
    expect(caps).toEqual({ imageInput: false, audioInput: false })
  })

  it('parses audio-inclusive declarations', async () => {
    writeModelsBinary([
      { key: 'openai/gpt-5.5', input: 'text+image+audio', available: true },
    ])
    const caps = await makeAdapter().capabilities!()
    expect(caps).toEqual({ imageInput: true, audioInput: true })
  })

  it('matches a bare agent model against a provider-prefixed catalog key (live enrich-agent shape)', async () => {
    mockAgents = [{ id: 'enrich', name: 'Enrich', model: { primary: 'claude-sonnet-4-6' } }]
    writeModelsBinary([
      { key: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', input: 'text+image', available: true },
    ])
    const caps = await makeAdapter().capabilities!({ agentId: 'enrich' })
    expect(caps.imageInput).toBe(true)
  })
})
