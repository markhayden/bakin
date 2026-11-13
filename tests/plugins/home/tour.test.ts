/** The tour's slides (home-first-run plan, task 6.1): curated data that matches the product it describes. */
import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-home-tour-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { HOME_CONTENT, parseHomeContent } from '../../../plugins/home/lib/content'

const clone = () => structuredClone(HOME_CONTENT) as unknown as { tour: Array<Record<string, unknown>> }

describe('the tour', () => {
  it('is six slides, one per area, in the order the spec names them', () => {
    expect(HOME_CONTENT.tour.map((slide) => slide.id)).toEqual(['chat', 'tasks', 'team', 'assets', 'schedule', 'health'])
  })

  it('each slide wears the name, icon and address its page has in the sidebar', () => {
    for (const slide of HOME_CONTENT.tour) {
      const manifest = JSON.parse(readFileSync(join(import.meta.dir, `../../../plugins/${slide.id}/bakin-plugin.json`), 'utf-8')) as { contributes: { nav: Array<{ label: string; icon: string; href: string }> } }
      const nav = manifest.contributes.nav.find((item) => item.href === slide.href)
      expect(nav).toBeDefined()
      expect({ title: slide.title, icon: slide.icon as string }).toEqual({ title: nav!.label, icon: nav!.icon })
    }
  })

  it('each slide says what the area is for in two or three sentences, and one thing to do first', () => {
    for (const slide of HOME_CONTENT.tour) {
      const sentences = slide.body.split(/(?<=[.!?])\s+/).length
      expect(sentences).toBeGreaterThanOrEqual(2)
      expect(sentences).toBeLessThanOrEqual(3)
      expect(slide.first.length).toBeGreaterThan(0)
    }
  })

  it('refuses a slide with an icon the page cannot draw, a link off the product, a duplicate, or no slides at all', () => {
    const icon = clone(); icon.tour[0]!.icon = 'Sparkles'
    expect(() => parseHomeContent(icon)).toThrow()
    for (const href of ['https://example.com', '/chat/abc', 'chat']) {
      const link = clone(); link.tour[0]!.href = href
      expect(() => parseHomeContent(link)).toThrow()
    }
    const twice = clone(); twice.tour[1]!.id = twice.tour[0]!.id
    expect(() => parseHomeContent(twice)).toThrow(/duplicate id/)
    const none = clone(); none.tour = []
    expect(() => parseHomeContent(none)).toThrow()
  })
})
