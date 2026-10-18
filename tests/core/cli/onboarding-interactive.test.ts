/**
 * The onboarding wizard (#895 PR6): installs never prompt, so every consent
 * comes from here — including media, and including a fresh Pi home whose
 * roster is empty until provisioning seeds it.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-onboarding-wizard-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

// Every prompt answers yes (confirm) or "nothing selected" (multi-select),
// and records its title.
const titles: string[] = []
mock.module('ink', () => ({
  Box: ({ children }: { children?: unknown }) => children ?? null,
  render: (element: { props: { title?: string; onSubmit: (value: unknown) => void; items?: unknown[] } }) => {
    titles.push(String(element.props.title))
    queueMicrotask(() => element.props.onSubmit(element.props.items ? [] : true))
    return { unmount() {}, rerender() {} }
  },
}))
mock.module('../../../src/core/cli/ui/render-to-string', () => ({ renderToString: () => '' }))

type Check = { name: string; status: string; message: string; details?: Record<string, unknown> }
let runtimeChecks: Check[] = []
const provisioned: number[] = []
const ok = (name: string): Check => ({ name, status: 'ok', message: `${name} ok` })
let mediaCheck: Check = ok('media')
mock.module('../../../src/core/onboarding/runtime', () => ({
  runtimeComponent: { name: 'runtime', manualSetup: 'set up', check: async () => runtimeChecks.shift() ?? ok('runtime') },
  provisionRuntimeForOnboarding: async () => { provisioned.push(1) },
}))
mock.module('../../../src/core/onboarding/search', () => ({ searchComponent: { name: 'search', check: async () => ok('search') } }))
mock.module('../../../src/core/onboarding/search-models', () => ({ searchModelsComponent: { name: 'search-models', check: async () => ok('search-models') } }))
mock.module('../../../src/core/onboarding/media', () => ({ mediaComponent: { name: 'media', check: async () => mediaCheck } }))
mock.module('../../../src/core/onboarding/models', () => ({ modelsComponent: { name: 'models', check: async () => ok('models') } }))
mock.module('../../../src/core/onboarding/recommended-plugins', () => ({ recommendedPluginsComponent: { name: 'recommended-plugins', check: async () => ok('recommended-plugins') } }))
mock.module('../../../src/core/onboarding/recommended-agents', () => ({ recommendedAgentsComponent: { name: 'recommended-agents', check: async () => ok('recommended-agents') } }))

import { collectOnboardingSelections } from '../../../src/core/cli/onboarding-interactive'

const INTERACTIVE = { interactive: true, autoApprove: false, json: false, checkOnly: false }

beforeEach(() => {
  titles.length = 0
  provisioned.length = 0
  runtimeChecks = []
  mediaCheck = ok('media')
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('collectOnboardingSelections', () => {
  it('asks about image processing and records the approval for media', async () => {
    mediaCheck = { name: 'media', status: 'missing', message: 'no image processing.' }
    const selections = await collectOnboardingSelections(INTERACTIVE)
    expect(titles).toContain('Image processing')
    expect(selections.approvedComponents).toEqual(['media'])
  })

  it('a fresh Pi home (empty roster) is seeded first, then the wizard asks', async () => {
    runtimeChecks = [{ name: 'runtime', status: 'broken', message: 'no agents yet', details: { emptyRoster: true } }, ok('runtime')]
    mediaCheck = { name: 'media', status: 'missing', message: 'no image processing' }
    const selections = await collectOnboardingSelections(INTERACTIVE)
    expect(provisioned).toEqual([1])
    expect(selections.approvedComponents).toEqual(['media'])
  })

  it('a runtime that is genuinely not ready asks nothing (the orchestrator reports it)', async () => {
    runtimeChecks = [{ name: 'runtime', status: 'missing', message: 'no runtime' }]
    expect(await collectOnboardingSelections(INTERACTIVE)).toEqual({})
    expect(provisioned).toEqual([])
    expect(titles).toEqual([])
  })
})
