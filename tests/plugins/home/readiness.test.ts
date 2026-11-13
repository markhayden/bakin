/**
 * Home's facts (home-first-run plan, task 1.4): gathered from the runtime
 * through neutral reads, with every failure becoming "unknown", never a
 * guess. The runtime here is a hand-rolled stand-in for exactly the members
 * the gatherer reads.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-home-readiness-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

let capabilities: Array<{ capability: string; ready: boolean; secrets: Array<{ required: boolean; status: string }> }> = []
let capabilitiesThrow = false
mock.module('../../../src/core/agent-packages/capability-readiness', () => ({ listCapabilities: async () => { if (capabilitiesThrow) throw new Error('lockfile unreadable'); return capabilities } }))
type Verdict = { status: 'eligible' } | { status: 'ineligible'; reason: string; detail: string } | { status: 'unknown'; detail: string }
let verdicts = new Map<string, Verdict>()
let eligibilityThrows = false
const eligibilityAskedFor: Array<{ agentId?: string; extraIds?: string[] }> = []
mock.module('../../../src/core/model-eligibility', () => ({
  getModelEligibility: async (_runtime: unknown, opts: { agentId?: string; extraIds?: string[] }) => {
    eligibilityAskedFor.push(opts)
    if (eligibilityThrows) throw new Error('catalog unavailable')
    return { byModel: new Map((opts.extraIds ?? []).map((id) => [id, { eligibility: verdicts.get(id) ?? { status: 'unknown', detail: '?' } }])) }
  },
}))

import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { gatherHomeFacts, isSeededName } from '../../../plugins/home/lib/readiness'

interface Scripted {
  agents?: Array<{ id: string; name: string; role?: string; model?: string }> | Error
  soul?: string | null | Error
  providers?: string[] | Error
  defaultModel?: string
}
function runtimeOf(script: Scripted): AgentRuntimeAdapter {
  const orThrow = <T,>(value: T | Error): T => { if (value instanceof Error) throw value; return value }
  return {
    agents: {
      list: async () => orThrow(script.agents ?? [{ id: 'main', name: 'Main', role: 'orchestrator' }]),
      readWorkspaceFile: async (_agentId: string, path: string) => {
        const soul = orThrow(script.soul === undefined ? null : script.soul)
        return soul === null ? null : { path, content: soul }
      },
    },
    credentialStatus: async () => ({ llmProviders: orThrow(script.providers ?? []), channels: [] }),
    models: { routingPolicy: async () => ({ defaultModel: script.defaultModel ?? '', fallbackModels: [], defaultSubagentModel: null, aliases: {} }) },
  } as unknown as AgentRuntimeAdapter
}
const gather = (script: Scripted, canGenerateImage: () => Promise<boolean | undefined> = async () => undefined) =>
  gatherHomeFacts({ runtime: runtimeOf(script), canGenerateImage })

beforeEach(() => {
  capabilities = []
  capabilitiesThrow = false
  verdicts = new Map()
  eligibilityThrows = false
  eligibilityAskedFor.length = 0
  rmSync(testDir, { recursive: true, force: true })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('a name the runtime gave, not a person', () => {
  it('is the agent\'s own id, "Main", or nothing, without regard to case', () => {
    expect(isSeededName({ id: 'main', name: 'Main' })).toBe(true)
    expect(isSeededName({ id: 'main', name: 'main' })).toBe(true)
    expect(isSeededName({ id: 'orchestrator', name: 'Orchestrator' })).toBe(true)
    expect(isSeededName({ id: 'main', name: '  ' })).toBe(true)
    expect(isSeededName({ id: 'main', name: 'Nova' })).toBe(false)
  })
})

describe('has the main agent been introduced', () => {
  it('a fresh Pi home: seeded name, no personality file → not introduced', async () => {
    expect((await gather({})).mainAgent).toEqual({ id: 'main', name: 'Main', introduced: false })
  })

  it('an empty personality file counts as none', async () => {
    expect((await gather({ soul: '  \n' })).mainAgent?.introduced).toBe(false)
  })

  it('a real name is enough, and the file is not even read', async () => {
    const facts = await gather({ agents: [{ id: 'main', name: 'Nova' }], soul: new Error('must not be read') })
    expect(facts.mainAgent).toEqual({ id: 'main', name: 'Nova', introduced: true })
  })

  it('a seeded-looking name WITH a personality is introduced (an OpenClaw main that was set up there)', async () => {
    expect((await gather({ soul: 'You are thoughtful.' })).mainAgent?.introduced).toBe(true)
  })

  it('a personality file that cannot be read is unknown, never "not introduced"', async () => {
    expect((await gather({ soul: new Error('EACCES') })).mainAgent?.introduced).toBe('unknown')
  })

  it('the main agent is the orchestrator, whatever order the roster is in', async () => {
    const facts = await gather({ agents: [{ id: 'pixel', name: 'Pixel' }, { id: 'main', name: 'Nova', role: 'orchestrator' }] })
    expect(facts.mainAgent?.id).toBe('main')
    expect(facts.starters.agents).toEqual(['pixel', 'main'])
  })
})

describe('reachability and credentials', () => {
  it('a roster that cannot be read is an unreachable runtime, and nothing else is asked', async () => {
    const facts = await gather({ agents: new Error('gateway down') })
    expect(facts).toMatchObject({ runtimeReachable: false, mainAgent: null, credentials: 'unknown' })
    expect(eligibilityAskedFor).toEqual([])
  })

  it('an empty roster is reachable with no main agent', async () => {
    expect(await gather({ agents: [] })).toMatchObject({ runtimeReachable: true, mainAgent: null })
  })

  it('credentials are present, absent, or unknown when the status cannot be read', async () => {
    expect((await gather({ providers: ['openai-codex'] })).credentials).toBe('present')
    expect((await gather({ providers: [] })).credentials).toBe('absent')
    expect((await gather({ providers: new Error('auth.json unreadable') })).credentials).toBe('unknown')
  })
})

describe('can the main agent\'s model run', () => {
  it('judges the agent\'s own pin under that agent\'s credentials', async () => {
    verdicts.set('openai/gpt-5.4-mini', { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' })
    const facts = await gather({ agents: [{ id: 'main', name: 'Nova', model: 'openai/gpt-5.4-mini' }], providers: ['anthropic'] })
    expect(facts.model).toEqual({ status: 'cannot_run', model: 'openai/gpt-5.4-mini', detail: 'no credentials for openai' })
    expect(eligibilityAskedFor).toEqual([{ agentId: 'main', extraIds: ['openai/gpt-5.4-mini'] }])
  })

  it('falls back to the runtime default when the agent has no pin', async () => {
    verdicts.set('anthropic/claude', { status: 'eligible' })
    expect((await gather({ defaultModel: 'anthropic/claude' })).model).toEqual({ status: 'runnable' })
  })

  it('no model anywhere, an unknown verdict, or a failed read are all unknown: never a block', async () => {
    expect((await gather({})).model).toEqual({ status: 'unknown' })
    expect((await gather({ defaultModel: 'x/y' })).model).toEqual({ status: 'unknown' })
    eligibilityThrows = true
    expect((await gather({ defaultModel: 'x/y' })).model).toEqual({ status: 'unknown' })
  })
})

describe('what starters can use', () => {
  it('only capabilities that are ready count, once each', async () => {
    capabilities = [{ capability: 'web-search', ready: true, secrets: [] }, { capability: 'web-search', ready: true, secrets: [] }, { capability: 'ocr', ready: false, secrets: [] }]
    expect((await gather({})).starters.readyCapabilities).toEqual(['web-search'])
  })

  it('an image provider is usable only when the Images plugin says so; absent or failing means no', async () => {
    expect((await gather({}, async () => true)).starters.imageProvider).toBe(true)
    expect((await gather({}, async () => undefined)).starters.imageProvider).toBe(false)
    expect((await gather({}, async () => { throw new Error('images plugin failed') })).starters.imageProvider).toBe(false)
  })

  it('keeps what suggestions need: every installed pack, whether a key is what it lacks, and "unknown" when nobody could say', async () => {
    capabilities = [
      { capability: 'web-search', ready: false, secrets: [{ required: true, status: 'missing' }] },
      { capability: 'ocr', ready: false, secrets: [{ required: false, status: 'missing' }, { required: true, status: 'store' }] },
    ]
    const facts = await gather({}, async () => false)
    expect(facts.capabilities).toEqual([{ capability: 'web-search', ready: false, needsKey: true }, { capability: 'ocr', ready: false, needsKey: false }])
    expect(facts.imageProvider).toBe(false)

    capabilitiesThrow = true
    const blind = await gather({}, async () => undefined)
    expect(blind.capabilities).toBe('unknown')
    expect(blind.imageProvider).toBe('unknown')
    // Starters still lean the safe way.
    expect(blind.starters).toMatchObject({ readyCapabilities: [], imageProvider: false })
    expect((await gather({}, async () => { throw new Error('images plugin failed') })).imageProvider).toBe('unknown')
  })
})
