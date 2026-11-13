/**
 * The introduction's writes (home-first-run plan, task 2.2): several
 * separate writes that cannot be atomic, so they are resumable. A failure
 * after ANY step leaves the answers pending and Home still showing the
 * introduction; a retry reaches the same result.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-home-introduction-${Date.now()}-${randomUUID()}`)
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

import { readDecisions, type IntroductionAnswers } from '../../../plugins/home/lib/decisions'
import { completeIntroduction, personalityFor, skipIntroduction, UnknownPersonalityError, type IntroductionStep } from '../../../plugins/home/lib/introduction'
import { homeState, type HomeFacts } from '../../../plugins/home/lib/state'

const ANSWERS: IntroductionAnswers = { agentName: 'Nova', personality: { kind: 'preset', id: 'warm' }, userName: 'Mark' }
const NOW = () => new Date('2026-11-13T12:00:00.000Z')

/** Records each write; `failAt` makes that step throw, once per listed call. */
function world(failAt: IntroductionStep[] = []) {
  const failures = [...failAt]
  const calls: string[] = []
  const written: { identity?: Record<string, unknown>; person?: string; synced: number } = { synced: 0 }
  const step = (name: IntroductionStep, effect: () => void) => {
    calls.push(name)
    if (failures[0] === name) { failures.shift(); throw new Error(`${name} failed`) }
    effect()
  }
  return {
    calls, written,
    deps: {
      now: NOW,
      updateIdentity: async (update: Record<string, unknown>) => step('identity', () => { written.identity = update }),
      setOperatorName: (name: string) => step('person', () => { written.person = name }),
      syncAgents: async () => step('sync', () => { written.synced += 1 }),
    },
  }
}
const factsWith = (name: string, introduced: boolean): HomeFacts => ({
  runtimeReachable: true, mainAgent: { id: 'main', name, introduced }, credentials: 'present', model: { status: 'runnable' },
  decisions: { introduction: readDecisions().introduction }, starters: { readyCapabilities: [], imageProvider: false, agents: ['main'] },
  capabilities: [], imageProvider: false,
})

beforeEach(() => rmSync(testDir, { recursive: true, force: true }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('the personality that gets written', () => {
  it('a preset gives its vibe line and its text, addressed to the agent by its new name', () => {
    const { vibe, soul } = personalityFor(ANSWERS)
    expect(vibe).toBe('Warm and encouraging')
    expect(soul).toStartWith('# Nova\n\nYour name is Nova. You are warm, encouraging and patient.')
  })

  it('"describe it yourself" keeps the person\'s own words, with a short label', () => {
    const description = 'Like a patient senior engineer who explains things without ever talking down to me, and who is honest when I am wrong'
    const { vibe, soul } = personalityFor({ ...ANSWERS, personality: { kind: 'custom', description } })
    expect(vibe.length).toBeLessThanOrEqual(60)
    expect(vibe).toEndWith('...')
    expect(soul).toContain(`> ${description}`)
  })

  it('an unknown preset is refused before anything is recorded', async () => {
    const { deps, calls } = world()
    const bad: IntroductionAnswers = { ...ANSWERS, personality: { kind: 'preset', id: 'grumpy' } }
    await expect(completeIntroduction('main', bad, deps)).rejects.toBeInstanceOf(UnknownPersonalityError)
    expect(calls).toEqual([])
    expect(readDecisions().introduction).toBeUndefined()
  })
})

describe('completeIntroduction', () => {
  it('writes the agent, then the person, then syncs, and only then records it as done', async () => {
    const { deps, calls, written } = world()
    expect(await completeIntroduction('main', ANSWERS, deps)).toEqual({ ok: true })
    expect(calls).toEqual(['identity', 'person', 'sync'])
    expect(written.identity).toMatchObject({ agentId: 'main', name: 'Nova', vibe: 'Warm and encouraging' })
    expect(written.person).toBe('Mark')
    expect(readDecisions().introduction).toEqual({ status: 'completed', at: '2026-11-13T12:00:00.000Z' })
  })

  for (const failing of ['identity', 'person', 'sync'] as const) {
    it(`a failure at "${failing}" leaves the answers pending, and Home still shows the introduction`, async () => {
      const { deps, calls } = world([failing])
      expect(await completeIntroduction('main', ANSWERS, deps)).toEqual({ ok: false, step: failing, error: `${failing} failed` })
      // Nothing after the failed step ran.
      expect(calls.at(-1)).toBe(failing)
      expect(readDecisions().introduction).toEqual({ status: 'pending', at: '2026-11-13T12:00:00.000Z', answers: ANSWERS })
      // Even when the agent already carries its new name, the introduction is resumed, not hidden.
      const renamed = failing !== 'identity'
      expect(homeState(factsWith(renamed ? 'Nova' : 'Main', renamed))).toEqual({
        name: 'meet-agent', agent: { id: 'main', name: renamed ? 'Nova' : 'Main' }, resume: ANSWERS,
      })
    })
  }

  it('a retry after a failure runs every step again and finishes', async () => {
    const { deps, calls, written } = world(['sync'])
    await completeIntroduction('main', ANSWERS, deps)
    expect(await completeIntroduction('main', ANSWERS, deps)).toEqual({ ok: true })
    expect(calls).toEqual(['identity', 'person', 'sync', 'identity', 'person', 'sync'])
    expect(written.synced).toBe(1)
    expect(readDecisions().introduction?.status).toBe('completed')
    expect(homeState(factsWith('Nova', true)).name).toBe('ready')
  })

  it('submitting twice gives the same result as once', async () => {
    const { deps, written } = world()
    await completeIntroduction('main', ANSWERS, deps)
    const first = structuredClone(written.identity)
    await completeIntroduction('main', ANSWERS, deps)
    expect(written.identity).toEqual(first)
    expect(readDecisions().introduction?.status).toBe('completed')
  })
})

describe('skipIntroduction', () => {
  it('records the skip, and Home moves on', () => {
    skipIntroduction(NOW)
    expect(readDecisions().introduction).toEqual({ status: 'skipped', at: '2026-11-13T12:00:00.000Z' })
    expect(homeState(factsWith('Main', false)).name).toBe('ready')
  })
})
