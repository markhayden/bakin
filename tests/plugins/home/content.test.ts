/**
 * Home's curated content (home-first-run spec §10): the shipped file is
 * valid, and the schema refuses the mistakes an editor would make.
 * Pure data: no app modules with side effects, no filesystem.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-home-content-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { HOME_CONTENT, parseHomeContent } from '../../../plugins/home/lib/content'

const clone = () => structuredClone(HOME_CONTENT) as unknown as { starters: Array<Record<string, unknown>>; personalities: Array<Record<string, unknown>> }

describe('home content', () => {
  it('ships a short set of starters and four personalities, each with a unique id', () => {
    expect(HOME_CONTENT.starters.map((s) => s.id)).toEqual(['agent-avatar', 'create-image', 'schedule-reminder', 'research-topic', 'goal-into-tasks'])
    expect(HOME_CONTENT.personalities.map((p) => p.id)).toEqual(['warm', 'direct', 'witty', 'calm'])
  })

  it('the avatar starter and the image starter are two halves of one slot: exactly one applies to any home', () => {
    const when = (id: string) => HOME_CONTENT.starters.find((starter) => starter.id === id)?.when
    expect(when('agent-avatar')).toBe('main-agent-has-no-avatar')
    expect(when('create-image')).toBe('main-agent-has-avatar')
    // So a home is offered four at most, and every other starter is unconditional.
    expect(HOME_CONTENT.starters.filter((starter) => starter.when === undefined)).toHaveLength(3)
  })

  it('every starter shows whatever is installed: what is missing is the agent\'s to say, in the conversation', () => {
    for (const starter of HOME_CONTENT.starters) expect(starter.needs).toEqual({})
  })

  it('refuses a `when` it does not know', () => {
    const content = clone()
    content.starters[0]!.when = 'main-agent-is-bored'
    expect(() => parseHomeContent(content)).toThrow()
  })

  it('refuses a duplicate id', () => {
    const content = clone()
    content.starters[1]!.id = content.starters[0]!.id
    expect(() => parseHomeContent(content)).toThrow(/duplicate id/)
  })

  it('refuses a need it does not know, so a typo cannot silently mean "needs nothing"', () => {
    const content = clone()
    content.starters[0]!.needs = { imageProvidr: true }
    expect(() => parseHomeContent(content)).toThrow()
  })

  it('refuses a starter with no prompt, and a personality with no personality text', () => {
    const noPrompt = clone()
    noPrompt.starters[0]!.prompt = ''
    expect(() => parseHomeContent(noPrompt)).toThrow()
    const noSample = clone()
    delete noSample.personalities[0]!.soul
    expect(() => parseHomeContent(noSample)).toThrow()
  })
})
