/** Home's state machine (home-first-run plan, task 1.5). Pure: no modules with side effects. */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-home-state-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { HOME_CONTENT, type Starter } from '../../../plugins/home/lib/content'
import { availableStarters, homeState, isFirstDay, starterBlockedBy, type HomeFacts } from '../../../plugins/home/lib/state'

const NOTHING_EXTRA = { readyCapabilities: [], imageProvider: false, agents: ['main'] }
const facts = (over: Partial<HomeFacts> = {}): HomeFacts => ({
  runtimeReachable: true,
  mainAgent: { id: 'main', name: 'Nova', introduced: true },
  credentials: 'present',
  model: { status: 'runnable' },
  decisions: {},
  starters: NOTHING_EXTRA,
  capabilities: [],
  imageProvider: false,
  ...over,
})
const UNNAMED = { id: 'main', name: 'Main', introduced: false } as const
const AGENT = { id: 'main', name: 'Nova' }

describe('homeState: which screen', () => {
  it('a named agent with a login that can run is ready', () => {
    expect(homeState(facts())).toEqual({ name: 'ready', agent: AGENT })
  })

  it('an unreadable runtime wins over everything, including an unnamed agent', () => {
    expect(homeState(facts({ runtimeReachable: false, mainAgent: UNNAMED, credentials: 'absent' }))).toEqual({ name: 'unavailable', reason: 'runtime_unreachable', href: '/health' })
    expect(homeState(facts({ mainAgent: null })).name).toBe('unavailable')
  })

  it('an unintroduced agent is met first, before login', () => {
    expect(homeState(facts({ mainAgent: UNNAMED, credentials: 'absent' }))).toEqual({ name: 'meet-agent', agent: { id: 'main', name: 'Main' } })
  })

  it('skipping or completing the introduction moves on, whatever the agent is called', () => {
    for (const status of ['skipped', 'completed'] as const) {
      const state = homeState(facts({ mainAgent: UNNAMED, credentials: 'absent', decisions: { introduction: { status, at: '2026-11-13T00:00:00.000Z' } } }))
      expect(state.name).toBe('needs-login')
    }
  })

  it('unknown is never treated as missing: not for the introduction, not for credentials', () => {
    expect(homeState(facts({ mainAgent: { id: 'main', name: 'Main', introduced: 'unknown' } })).name).toBe('ready')
    expect(homeState(facts({ credentials: 'unknown' })).name).toBe('ready')
    expect(homeState(facts({ model: { status: 'unknown' } })).name).toBe('ready')
  })

  it('no login is needs-login, even when the model would not run either', () => {
    expect(homeState(facts({ credentials: 'absent', model: { status: 'cannot_run', model: 'openai/x', detail: 'no credentials for openai' } }))).toEqual({ name: 'needs-login', agent: AGENT })
  })

  it('logged in to a provider the agent\'s model does not belong to is its own honest state, pointing at Models', () => {
    expect(homeState(facts({ model: { status: 'cannot_run', model: 'openai/gpt-5.4-mini', detail: 'no credentials for openai' } }))).toEqual({
      name: 'unavailable', reason: 'model_cannot_run', detail: 'no credentials for openai', href: '/models',
    })
  })
})

describe('starters this home can run', () => {
  // The shipped starters need nothing; the rule is still what decides, so it is tested on its own.
  const starter = (id: string, needs: Starter['needs']): Starter => ({ id, title: id, description: id, prompt: id, needs })
  const NEEDY = [
    starter('plain', {}),
    starter('search', { capability: 'web-search' }),
    starter('picture', { imageProvider: true }),
    starter('edit', { attachment: true, imageProvider: true }),
    starter('summarize', { attachment: true }),
    starter('pixel', { agent: 'pixel' }),
  ]

  it('the shipped starters all run on the barest home, in curated order', () => {
    expect(availableStarters(HOME_CONTENT.starters, NOTHING_EXTRA).map((entry) => entry.id)).toEqual(HOME_CONTENT.starters.map((entry) => entry.id))
  })

  it('a starter with a need is offered only once the home has it', () => {
    expect(availableStarters(NEEDY, NOTHING_EXTRA).map((entry) => entry.id)).toEqual(['plain', 'summarize'])
    const equipped = { readyCapabilities: ['web-search'], imageProvider: true, agents: ['main', 'pixel'] }
    expect(availableStarters(NEEDY, equipped)).toHaveLength(NEEDY.length)
  })

  it('says what is missing, and an attachment is never what is missing', () => {
    const blockedBy = (id: string, readiness = NOTHING_EXTRA) => starterBlockedBy(NEEDY.find((entry) => entry.id === id)!, readiness)
    expect(blockedBy('search')).toBe('capability')
    expect(blockedBy('picture')).toBe('image-provider')
    expect(blockedBy('pixel')).toBe('agent')
    expect(blockedBy('summarize')).toBeNull()
    // Needs an attachment AND an image provider: only the provider can block it.
    expect(blockedBy('edit')).toBe('image-provider')
    expect(blockedBy('edit', { ...NOTHING_EXTRA, imageProvider: true })).toBeNull()
  })
})

describe('the first day', () => {
  const AT = '2026-11-13T00:00:00.000Z'
  it('lasts from finishing the introduction until the first thing is asked for', () => {
    expect(isFirstDay({ introduction: { status: 'completed', at: AT } })).toBe(true)
    expect(isFirstDay({ introduction: { status: 'completed', at: AT }, firstRequest: { at: AT } })).toBe(false)
  })

  it('a skipped introduction, or none at all, has no first day', () => {
    expect(isFirstDay({ introduction: { status: 'skipped', at: AT } })).toBe(false)
    expect(isFirstDay({})).toBe(false)
  })
})
