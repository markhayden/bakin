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
  it('ships the ten starters and four personalities, each with a unique id', () => {
    expect(HOME_CONTENT.starters).toHaveLength(10)
    expect(HOME_CONTENT.personalities.map((p) => p.id)).toEqual(['warm', 'direct', 'witty', 'calm'])
    expect(new Set(HOME_CONTENT.starters.map((s) => s.id)).size).toBe(10)
  })

  it('most starters need nothing beyond a login, so the barest home gets a full set', () => {
    const free = HOME_CONTENT.starters.filter((starter) => Object.keys(starter.needs).length === 0)
    expect(free.length).toBeGreaterThanOrEqual(6)
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

  it('refuses a starter with no prompt, and a personality with no sample line', () => {
    const noPrompt = clone()
    noPrompt.starters[0]!.prompt = ''
    expect(() => parseHomeContent(noPrompt)).toThrow()
    const noSample = clone()
    delete noSample.personalities[0]!.sample
    expect(() => parseHomeContent(noSample)).toThrow()
  })
})
