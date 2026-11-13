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

import { HOME_CONTENT } from '../../../plugins/home/lib/content'
import { availableStarters, homeState, starterBlockedBy, type HomeFacts } from '../../../plugins/home/lib/state'

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
  const byId = (id: string) => HOME_CONTENT.starters.find((starter) => starter.id === id)!

  it('a bare home still gets every starter that needs nothing, in curated order', () => {
    const ids = availableStarters(HOME_CONTENT.starters, NOTHING_EXTRA).map((starter) => starter.id)
    expect(ids).toEqual(['schedule-recurring', 'summarize-document', 'goal-into-tasks', 'draft-something', 'brainstorm', 'daily-briefing', 'show-me'])
  })

  it('a capability or an image provider unlocks the starters that need them', () => {
    const ids = availableStarters(HOME_CONTENT.starters, { readyCapabilities: ['web-search'], imageProvider: true, agents: ['main'] }).map((starter) => starter.id)
    expect(ids).toHaveLength(10)
  })

  it('says what is missing, and an attachment is never what is missing', () => {
    expect(starterBlockedBy(byId('research-topic'), NOTHING_EXTRA)).toBe('capability')
    expect(starterBlockedBy(byId('create-image'), NOTHING_EXTRA)).toBe('image-provider')
    expect(starterBlockedBy(byId('summarize-document'), NOTHING_EXTRA)).toBeNull()
    // Needs an attachment AND an image provider: only the provider can block it.
    expect(starterBlockedBy(byId('edit-image'), NOTHING_EXTRA)).toBe('image-provider')
    expect(starterBlockedBy(byId('edit-image'), { ...NOTHING_EXTRA, imageProvider: true })).toBeNull()
  })
})
