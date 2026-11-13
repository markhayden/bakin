/** The suggestions engine (home-first-run plan, task 4.1). Pure: facts in, an ordered list out. */
import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-home-suggestions-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { HOME_CONTENT, parseHomeContent, type Suggestion, type SuggestionCondition } from '../../../plugins/home/lib/content'
import { conditionHolds, DISMISSAL_MS, isDismissed, suggestionsFor, type SuggestionFacts } from '../../../plugins/home/lib/suggestions'

/** A home with everything: nothing to suggest. */
const COMPLETE: SuggestionFacts = {
  capabilities: [{ capability: 'web-search', ready: true, needsKey: false }],
  imageProvider: true,
  agents: ['main', 'pixel'],
  plugins: ['home', 'projects'],
  checklistTodo: [],
}
/** A home straight out of onboarding with nothing added. */
const BARE: SuggestionFacts = { capabilities: [], imageProvider: false, agents: ['main'], plugins: ['home'], checklistTodo: ['channels'] }
const NOW = Date.parse('2026-11-13T12:00:00.000Z')
const ids = (list: readonly Suggestion[]) => list.map((suggestion) => suggestion.id)
const holds = (when: SuggestionCondition, over: Partial<SuggestionFacts>) => conditionHolds(when, { ...COMPLETE, ...over })

describe('when a suggestion applies', () => {
  it('a capability nobody installed', () => {
    const when = { kind: 'capability-missing', capability: 'web-search' } as const
    expect(holds(when, { capabilities: [] })).toBe(true)
    expect(holds(when, { capabilities: [{ capability: 'ocr', ready: true, needsKey: false }] })).toBe(true)
    // Installed, even if it does not work yet, is not missing.
    expect(holds(when, { capabilities: [{ capability: 'web-search', ready: false, needsKey: true }] })).toBe(false)
  })

  it('an installed capability that only lacks its key', () => {
    const when = { kind: 'capability-needs-key', capability: 'web-search' } as const
    expect(holds(when, { capabilities: [{ capability: 'web-search', ready: false, needsKey: true }] })).toBe(true)
    expect(holds(when, { capabilities: [] })).toBe(false)
    // Not ready for another reason: a key would not fix it, so it is Health's to say.
    expect(holds(when, { capabilities: [{ capability: 'web-search', ready: false, needsKey: false }] })).toBe(false)
    // Another pack already provides it.
    expect(holds(when, { capabilities: [{ capability: 'web-search', ready: false, needsKey: true }, { capability: 'web-search', ready: true, needsKey: false }] })).toBe(false)
  })

  it('no image provider, a lone main agent, a missing agent, a missing plugin, a checklist item to do', () => {
    expect(holds({ kind: 'no-image-provider' }, { imageProvider: false })).toBe(true)
    expect(holds({ kind: 'no-image-provider' }, {})).toBe(false)
    expect(holds({ kind: 'only-main-agent' }, { agents: ['main'] })).toBe(true)
    expect(holds({ kind: 'only-main-agent' }, {})).toBe(false)
    expect(holds({ kind: 'agent-missing', agent: 'jessica' }, {})).toBe(true)
    expect(holds({ kind: 'agent-missing', agent: 'pixel' }, {})).toBe(false)
    expect(holds({ kind: 'plugin-missing', plugin: 'messaging' }, {})).toBe(true)
    expect(holds({ kind: 'plugin-missing', plugin: 'projects' }, {})).toBe(false)
    expect(holds({ kind: 'checklist-todo', item: 'channels' }, { checklistTodo: ['channels'] })).toBe(true)
    expect(holds({ kind: 'checklist-todo', item: 'channels' }, {})).toBe(false)
  })

  it('what could not be read never makes a suggestion appear', () => {
    const blind = { capabilities: 'unknown', imageProvider: 'unknown', plugins: 'unknown', checklistTodo: 'unknown' } as const
    expect(holds({ kind: 'capability-missing', capability: 'web-search' }, blind)).toBe(false)
    expect(holds({ kind: 'capability-needs-key', capability: 'web-search' }, blind)).toBe(false)
    expect(holds({ kind: 'no-image-provider' }, blind)).toBe(false)
    expect(holds({ kind: 'plugin-missing', plugin: 'projects' }, blind)).toBe(false)
    expect(holds({ kind: 'checklist-todo', item: 'channels' }, blind)).toBe(false)
    expect(suggestionsFor(HOME_CONTENT.suggestions, { ...BARE, ...blind, agents: ['main', 'pixel'] }, {}, NOW)).toEqual([])
  })
})

describe('the shipped suggestions', () => {
  it('a home with everything is asked for nothing', () => {
    expect(suggestionsFor(HOME_CONTENT.suggestions, COMPLETE, {}, NOW)).toEqual([])
  })

  it('a bare home gets them in curated order, and never both halves of one capability', () => {
    expect(ids(suggestionsFor(HOME_CONTENT.suggestions, BARE, {}, NOW))).toEqual(['web-search', 'image-provider', 'add-agent', 'channels', 'projects'])
    const keyless = { ...BARE, capabilities: [{ capability: 'web-search', ready: false, needsKey: true }] }
    expect(ids(suggestionsFor(HOME_CONTENT.suggestions, keyless, {}, NOW)).slice(0, 2)).toEqual(['web-search-key', 'image-provider'])
  })

  it('every starter a home can be missing something for has a suggestion that supplies it', () => {
    for (const starter of HOME_CONTENT.starters) {
      const { capability, imageProvider, agent } = starter.needs
      const covered = (kinds: (when: SuggestionCondition) => boolean) => HOME_CONTENT.suggestions.some((suggestion) => kinds(suggestion.when))
      if (capability) expect(covered((when) => when.kind === 'capability-missing' && when.capability === capability)).toBe(true)
      if (imageProvider) expect(covered((when) => when.kind === 'no-image-provider')).toBe(true)
      if (agent) expect(covered((when) => when.kind === 'agent-missing' && when.agent === agent)).toBe(true)
    }
  })

  it('never suggests a spend limit or a brand, and the schema refuses one that tries', () => {
    for (const suggestion of HOME_CONTENT.suggestions) {
      expect(`${suggestion.id} ${suggestion.title} ${suggestion.payoff} ${suggestion.action.href}`.toLowerCase()).not.toMatch(/spend|budget|limit|brand/)
    }
    for (const href of ['/spend', '/spend?tab=limits', '/brands/new', 'https://example.com', '//example.com']) {
      const content = structuredClone(HOME_CONTENT) as { suggestions: Array<{ action: { href: string } }> }
      content.suggestions[0]!.action.href = href
      expect(() => parseHomeContent(content)).toThrow()
    }
  })

  it('an Explore link names something the curated catalog really has', () => {
    const catalog = JSON.parse(readFileSync(join(import.meta.dir, '../../../packages/host/src/data/curated-catalog.json'), 'utf-8')) as Record<string, unknown>
    const known = new Set(Object.values(catalog).filter(Array.isArray).flat().map((entry) => `${(entry as { kind: string }).kind}:${(entry as { id: string }).id}`))
    const items = HOME_CONTENT.suggestions.map((suggestion) => new URL(suggestion.action.href, 'http://bakin').searchParams.get('item')).filter((item): item is string => item !== null)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(known.has(item)).toBe(true)
  })
})

describe('"Not now"', () => {
  const at = new Date(NOW).toISOString()

  it('hides a suggestion, and only that one', () => {
    expect(ids(suggestionsFor(HOME_CONTENT.suggestions, BARE, { 'web-search': { at } }, NOW))).toEqual(['image-provider', 'add-agent', 'channels', 'projects'])
  })

  it('for thirty days: hidden a moment before, back at the thirtieth day', () => {
    expect(DISMISSAL_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(isDismissed({ x: { at } }, 'x', NOW + DISMISSAL_MS - 1)).toBe(true)
    expect(isDismissed({ x: { at } }, 'x', NOW + DISMISSAL_MS)).toBe(false)
    expect(ids(suggestionsFor(HOME_CONTENT.suggestions, BARE, { 'web-search': { at } }, NOW + DISMISSAL_MS))[0]).toBe('web-search')
  })

  it('a record that is not a time hides nothing; one for a suggestion that no longer applies changes nothing', () => {
    expect(isDismissed({ x: { at: 'yesterday-ish' } }, 'x', NOW)).toBe(false)
    expect(suggestionsFor(HOME_CONTENT.suggestions, COMPLETE, { 'web-search': { at } }, NOW)).toEqual([])
  })
})
