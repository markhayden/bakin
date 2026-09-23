/**
 * Onboarding budget component: spend limits are OPT-IN (spec S8). check()
 * is always ok and states the fact; install() prints one line, never
 * prompts, never writes — the Spend page / `bakin budget set` is where a
 * limit is chosen.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-onboard-budget-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
    pluginSettings: join(testDir, 'plugin-settings'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

// Scriptable prompt answers.
let lineAnswers: string[] = []
let yesNoAnswers: boolean[] = []
mock.module('../../../src/core/onboarding/prompts', () => ({
  readLine: async () => lineAnswers.shift() ?? '',
  askYesNo: async (_q: string, dflt: boolean) => (yesNoAnswers.length ? yesNoAnswers.shift()! : dflt),
  formatPrompt: (p: string) => p,
}))

import { budgetComponent } from '../../../src/core/onboarding/budget'
import { readPluginSettings, writePluginSettings } from '../../../packages/core/src/plugins/settings-store'

const INTERACTIVE = { interactive: true, autoApprove: false, json: false, checkOnly: false, force: false } as never
const YES_MODE = { interactive: false, autoApprove: true, json: false, checkOnly: false, force: false } as never

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
  lineAnswers = []
  yesNoAnswers = []
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('budget onboarding component (limits are opt-in — S8)', () => {
  it('check() is ok with no rules and states the fact — never a warning, never remediation', async () => {
    const r = await budgetComponent.check()
    expect(r.status).toBe('ok')
    expect(r.message).toContain('No spend limits set')
    expect(r.message).not.toContain('uncapped')
    expect(r.remediation).toBeUndefined()
  })

  it('check() reports the rule count once limits exist', async () => {
    writePluginSettings('spend', { limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', monthlyCap: 100 }] }, billing: { overrides: [] } })
    const r = await budgetComponent.check()
    expect(r.status).toBe('ok')
    expect(r.message).toContain('1 rule')
  })

  it('install() never prompts and never writes: --yes and interactive alike leave spend.json untouched', async () => {
    yesNoAnswers = [true] // must not be consumed — there is no prompt
    lineAnswers = ['25', '300']
    for (const opts of [YES_MODE, INTERACTIVE]) {
      const r = await budgetComponent.install(opts)
      expect(r.status).toBe('noop')
      expect(r.message).toContain('opt-in')
    }
    expect(yesNoAnswers).toEqual([true])
    expect(lineAnswers).toEqual(['25', '300'])
    expect(readPluginSettings<{ limits?: { rules?: unknown[] } }>('spend').limits?.rules ?? []).toEqual([])
  })

  it('install() is a noop once limits exist', async () => {
    writePluginSettings('spend', { limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', monthlyCap: 100 }] }, billing: { overrides: [] } })
    const r = await budgetComponent.install(INTERACTIVE)
    expect(r.status).toBe('noop')
    expect(r.message).toContain('already configured')
  })
})
