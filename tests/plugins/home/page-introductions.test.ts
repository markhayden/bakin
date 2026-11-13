/** Which pages still introduce themselves (home-first-run plan, task 7.1). Pure. */
import { describe, expect, it, mock } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-home-page-intros-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { HOME_CONTENT } from '../../../plugins/home/lib/content'
import { openPageIntroductions, startedOnHome } from '../../../plugins/home/lib/page-introductions'

const AT = '2026-11-13T12:00:00.000Z'
const ALL = HOME_CONTENT.pageIntroductions
const ids = (decisions: Parameters<typeof openPageIntroductions>[1]) => openPageIntroductions(ALL, decisions).map((introduction) => introduction.id)

describe('page introductions', () => {
  it('ships one for each page the tour names, and each is a real core plugin', () => {
    expect(ALL.map((introduction) => introduction.id)).toEqual(HOME_CONTENT.tour.map((slide) => slide.id))
    for (const introduction of ALL) expect(existsSync(join(import.meta.dir, `../../../plugins/${introduction.id}/bakin-plugin.json`))).toBe(true)
  })

  it('a home where someone finished or skipped the introduction gets all of them', () => {
    expect(ids({ introduction: { status: 'completed', at: AT } })).toEqual(['chat', 'tasks', 'team', 'assets', 'schedule', 'health'])
    expect(ids({ introduction: { status: 'skipped', at: AT } })).toHaveLength(6)
  })

  it('a home that did not start on Home gets none: its people already know their way around', () => {
    expect(startedOnHome({})).toBe(false)
    expect(ids({})).toEqual([])
    // Answers given but not yet all written: not there yet.
    expect(ids({ introduction: { status: 'pending', at: AT, answers: { agentName: 'Nova', personality: { kind: 'preset', id: 'warm' }, userName: 'Mark' } } })).toEqual([])
  })

  it('a closed one stays closed, and the others stay open', () => {
    expect(ids({ introduction: { status: 'completed', at: AT }, closedPageIntroductions: { tasks: { at: AT }, health: { at: AT } } })).toEqual(['chat', 'team', 'assets', 'schedule'])
  })
})
