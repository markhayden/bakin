/**
 * Onboarding budget component (cost-control v2 T14): check() reflects
 * whether any cap rule exists; install() NEVER writes a silent default —
 * non-interactive/--yes skips loudly, interactive declines skip, and only
 * explicit positive input writes a global metered rule.
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
import { readPluginSettings } from '../../../packages/core/src/plugins/settings-store'

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

describe('budget onboarding component', () => {
  it('check() warns with remediation when no rules exist', async () => {
    const r = await budgetComponent.check()
    expect(r.status).toBe('warn')
    expect(r.message).toContain('uncapped')
    expect(r.remediation).toBeTruthy()
  })

  it('--yes skips LOUDLY and writes nothing', async () => {
    const r = await budgetComponent.install(YES_MODE)
    expect(r.status).toBe('skipped')
    expect(readPluginSettings<{ budget?: unknown }>('models').budget).toBeUndefined()
  })

  it('interactive decline skips and writes nothing', async () => {
    yesNoAnswers = [false]
    const r = await budgetComponent.install(INTERACTIVE)
    expect(r.status).toBe('skipped')
    expect(readPluginSettings<{ budget?: unknown }>('models').budget).toBeUndefined()
  })

  it('interactive accept writes ONE global metered rule from the entered caps', async () => {
    yesNoAnswers = [true]
    lineAnswers = ['25', '300']
    const r = await budgetComponent.install(INTERACTIVE)
    expect(r.status).toBe('installed')
    const settings = readPluginSettings<{ budget?: { rules?: unknown[] } }>('models')
    expect(settings.budget?.rules).toEqual([{ scope: 'global', lane: 'metered', dailyCap: 25, monthlyCap: 300 }])
    // check() clears once a rule exists.
    expect((await budgetComponent.check()).status).toBe('ok')
  })

  it('accept with no caps entered still writes nothing', async () => {
    yesNoAnswers = [true]
    lineAnswers = ['', ''] // Enter twice
    const r = await budgetComponent.install(INTERACTIVE)
    expect(r.status).toBe('skipped')
    expect(readPluginSettings<{ budget?: unknown }>('models').budget).toBeUndefined()
  })

  it('noops when a budget already exists', async () => {
    yesNoAnswers = [true]
    lineAnswers = ['10', '']
    await budgetComponent.install(INTERACTIVE)
    const r = await budgetComponent.install(INTERACTIVE)
    expect(r.status).toBe('noop')
  })
})
