/**
 * buildSetupChecklist (spec §7): each item in each of its states — done,
 * todo, unknown, and left out. Pure: the sources are what the existing
 * engines answer, so nothing here touches a home.
 */
import { describe, expect, test } from 'bun:test'

import { buildSetupChecklist, type SetupChecklistSources, type Sourced } from '../../../src/core/onboarding/setup-checklist'
import type { CheckResult } from '../../../src/core/onboarding/types'

const answer = <T,>(value: T): Sourced<T> => ({ ok: true, value })
const threw = (error: string): Sourced<never> => ({ ok: false, error })
const check = (name: string, status: CheckResult['status'], over: Partial<CheckResult> = {}): CheckResult => ({ name, status, message: `${name} ${status}`, ...over })

/** A home where everything is in place. */
const allDone: SetupChecklistSources = {
  runtimeLabel: 'Pi',
  llm: answer(check('llm', 'ok', { message: '1 LLM provider configured: anthropic' })),
  search: answer({ ...check('search', 'ok'), applicable: true }),
  channels: answer(check('channels', 'ok', { details: { mode: 'server', state: 'connected' } })),
  capabilities: answer([]),
  models: answer(check('models', 'ok', { details: { candidates: 3, persisted: true } })),
  serverRunning: true,
}
const build = (over: Partial<SetupChecklistSources>) => buildSetupChecklist({ ...allDone, ...over })
const item = (over: Partial<SetupChecklistSources>, id: string) => build(over).items.find((entry) => entry.id === id)

function capability(over: Record<string, unknown> = {}) {
  return {
    capability: 'web-search', packageId: 'web-search-brave', version: '1.0.0', name: 'Web search', description: '',
    skills: [], bins: [], npm: [], models: [], prereqs: [],
    secrets: [{ name: 'BRAVE_API_KEY', required: true, status: 'store' as const }],
    platformSupported: true, manifestValid: true, ready: true, missing: [],
    ...over,
  } as never
}

describe('the checklist as a whole', () => {
  test('everything in place: every item is done, in the order someone would do them', () => {
    const { items } = build({})
    expect(items.map((entry) => [entry.id, entry.state])).toEqual([
      ['login', 'done'], ['search', 'done'], ['channels', 'done'], ['model-plan', 'done'],
    ])
  })

  test('a fresh Pi home with no login: only what applies is listed, and the login comes first', () => {
    const { items } = build({
      llm: answer(check('llm', 'warn', { remediation: 'Log in to Pi: run `pi`, type `/login`.' })),
      search: answer({ ...check('search', 'ok'), applicable: false }),
      channels: answer(check('channels', 'ok', { details: { mode: 'configuration-only', projected: 'disabled' } })),
      models: answer(check('models', 'missing', { details: { candidates: 0 } })),
      serverRunning: false,
    })
    expect(items.map((entry) => [entry.id, entry.state])).toEqual([['login', 'todo'], ['channels', 'todo']])
  })
})

describe('log in to the runtime', () => {
  test('done when a provider is logged in', () => {
    expect(item({}, 'login')).toMatchObject({ title: 'Log in to Pi', state: 'done', detail: '1 LLM provider configured: anthropic' })
  })
  test('todo with the runtime\'s own instructions when none is', () => {
    const entry = item({ llm: answer(check('llm', 'warn', { remediation: 'Log in to Pi: run `pi`, type `/login`.' })) }, 'login')
    expect(entry).toMatchObject({ state: 'todo', detail: 'Log in to Pi: run `pi`, type `/login`.' })
  })
  test('unknown when the credential status cannot be read', () => {
    expect(item({ llm: threw('gateway closed the connection') }, 'login')).toMatchObject({ state: 'unknown', detail: 'Could not tell: gateway closed the connection' })
    expect(item({ llm: answer(check('llm', 'error', { message: 'check() threw' })) }, 'login')?.state).toBe('unknown')
  })
  test('names the active runtime', () => {
    expect(item({ runtimeLabel: 'OpenClaw' }, 'login')?.title).toBe('Log in to OpenClaw')
  })
})

describe('search', () => {
  test('done when the engine is in place for this home', () => {
    expect(item({}, 'search')?.state).toBe('done')
  })
  test.each(['missing', 'broken', 'warn'] as const)('todo with the install command when the check is %s', (status) => {
    const entry = item({ search: answer({ ...check('search', status, { remediation: 'Run `bakin install search`.' }), applicable: true }) }, 'search')
    expect(entry).toMatchObject({ state: 'todo', command: 'bakin install search', detail: 'Run `bakin install search`.' })
  })
  test('unknown when the check throws or errors', () => {
    expect(item({ search: threw('probe hung') }, 'search')?.state).toBe('unknown')
    expect(item({ search: answer({ ...check('search', 'error'), applicable: true }) }, 'search')?.state).toBe('unknown')
  })
  test('left out when there is nothing on this machine to set up (external endpoint, temporary home)', () => {
    expect(item({ search: answer({ ...check('search', 'ok'), applicable: false }) }, 'search')).toBeUndefined()
    expect(item({ search: answer({ ...check('search', 'warn'), applicable: false }) }, 'search')).toBeUndefined()
  })
})

describe('channels', () => {
  test.each([
    ['connected (server)', { mode: 'server', state: 'connected' }],
    ['configured, waiting for the server', { mode: 'configuration-only', projected: 'ready_to_connect' }],
  ])('done when %s', (_label, details) => {
    expect(item({ channels: answer(check('channels', 'ok', { details })) }, 'channels')?.state).toBe('done')
  })
  test.each([
    ['disabled', 'ok', { mode: 'configuration-only', projected: 'disabled' }],
    ['missing_token', 'warn', { mode: 'configuration-only', projected: 'missing_token' }],
    ['missing_guild', 'warn', { mode: 'server', state: 'missing_guild' }],
    ['failed', 'warn', { mode: 'server', state: 'failed' }],
  ] as const)('todo, pointing at Settings → Channels, when %s', (_label, status, details) => {
    expect(item({ channels: answer(check('channels', status, { details })) }, 'channels')).toMatchObject({ state: 'todo', href: '/settings?tab=channels' })
  })
  test('unknown when readiness cannot be read or reports no state', () => {
    expect(item({ channels: threw('timeout') }, 'channels')?.state).toBe('unknown')
    expect(item({ channels: answer(check('channels', 'ok')) }, 'channels')?.state).toBe('unknown')
  })
  test('left out when the runtime delivers natively', () => {
    expect(item({ channels: answer(check('channels', 'ok', { details: { mode: 'server', state: 'native' } })) }, 'channels')).toBeUndefined()
  })
})

describe('capability keys', () => {
  test('done when an installed capability has the key it requires', () => {
    expect(item({ capabilities: answer([capability()]) }, 'capability-key:web-search')).toMatchObject({ title: 'Web search key', state: 'done' })
    expect(item({ capabilities: answer([capability({ secrets: [{ name: 'K', required: true, status: 'env' }] })]) }, 'capability-key:web-search')?.state).toBe('done')
  })
  test('todo, naming the key and where to add it, when a required key is missing', () => {
    const entry = item({ capabilities: answer([capability({ secrets: [{ name: 'BRAVE_API_KEY', required: true, status: 'missing' }] })]) }, 'capability-key:web-search')
    expect(entry).toMatchObject({ state: 'todo', href: '/settings?tab=integrations' })
    expect(entry?.detail).toContain('BRAVE_API_KEY')
  })
  test('unknown when the installed manifest cannot be trusted', () => {
    expect(item({ capabilities: answer([capability({ manifestValid: false, secrets: [] })]) }, 'capability-key:web-search')?.state).toBe('unknown')
  })
  test('unknown, once, when readiness itself throws', () => {
    const { items } = build({ capabilities: threw('lockfile unreadable') })
    expect(items.filter((entry) => entry.id.startsWith('capability-key'))).toEqual([{ id: 'capability-keys', title: 'Capability keys', state: 'unknown', detail: 'Could not tell: lockfile unreadable' }])
  })
  test('left out when a capability declares no required key, or only optional ones', () => {
    expect(item({ capabilities: answer([capability({ secrets: [] })]) }, 'capability-key:web-search')).toBeUndefined()
    expect(item({ capabilities: answer([capability({ secrets: [{ name: 'OPTIONAL', required: false, status: 'missing' }] })]) }, 'capability-key:web-search')).toBeUndefined()
  })
  test('one item per installed capability', () => {
    const { items } = build({ capabilities: answer([capability(), capability({ capability: 'image-gen', name: 'Image generation', secrets: [{ name: 'KEY', required: true, status: 'missing' }] })]) })
    expect(items.filter((entry) => entry.id.startsWith('capability-key:')).map((entry) => [entry.id, entry.state])).toEqual([['capability-key:web-search', 'done'], ['capability-key:image-gen', 'todo']])
  })
})

describe('model plan', () => {
  test('done when a plan is in place and its check is ok', () => {
    expect(item({}, 'model-plan')?.state).toBe('done')
  })
  test('todo with the apply command when no plan is chosen and something can run', () => {
    expect(item({ models: answer(check('models', 'missing', { details: { candidates: 2 } })) }, 'model-plan')).toMatchObject({ state: 'todo', command: 'bakin models plan --apply' })
  })
  test('todo when a plan exists but needs attention', () => {
    expect(item({ models: answer(check('models', 'warn', { message: 'Your model plan needs attention: enrichment cannot see images.', details: { candidates: 2, persisted: true } })) }, 'model-plan')).toMatchObject({ state: 'todo', detail: 'Your model plan needs attention: enrichment cannot see images.' })
  })
  test('unknown when the check throws or errors', () => {
    expect(item({ models: threw('catalog unreadable') }, 'model-plan')?.state).toBe('unknown')
    expect(item({ models: answer(check('models', 'error')) }, 'model-plan')?.state).toBe('unknown')
  })
  test('left out when nothing can run yet: logging in comes first, and that item says so', () => {
    expect(item({ models: answer(check('models', 'missing', { details: { candidates: 0 } })) }, 'model-plan')).toBeUndefined()
  })
})

describe('next steps that carry no state', () => {
  test('starting Bakin is suggested only when no server runs for this home', () => {
    expect(build({ serverRunning: false }).notes.map((note) => note.id)).toEqual(['start', 'explore'])
    expect(build({ serverRunning: true }).notes.map((note) => note.id)).toEqual(['explore'])
    expect(build({ serverRunning: false }).notes[0]).toMatchObject({ command: 'bakin start' })
  })
  test('spend limits and brands are never listed: both are opt-in', () => {
    const everything = JSON.stringify(build({ serverRunning: false }))
    expect(everything).not.toMatch(/spend|budget|limit|brand/i)
  })
})
