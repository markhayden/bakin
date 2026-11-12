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
/** When set, the next screen is left with Ctrl-C instead of answered. */
let cancelNextScreen = false
mock.module('ink', () => ({
  Box: ({ children }: { children?: unknown }) => children ?? null,
  render: (element: { props: { title?: string; onSubmit: (value: unknown) => void; items?: unknown[] } }) => {
    titles.push(String(element.props.title))
    let exited: () => void = () => {}
    const exit = new Promise<void>((resolve) => { exited = resolve })
    if (cancelNextScreen) {
      cancelNextScreen = false
      // Ink unmounts on Ctrl-C without calling the screen's onSubmit.
      queueMicrotask(exited)
    } else {
      queueMicrotask(() => element.props.onSubmit(element.props.items ? [] : true))
    }
    return { unmount() { exited() }, rerender() {}, waitUntilExit: () => exit }
  },
}))
mock.module('../../../src/core/cli/ui/render-to-string', () => ({ renderToString: () => '' }))

type Check = { name: string; status: string; message: string; details?: Record<string, unknown> }
const ok = (name: string): Check => ({ name, status: 'ok', message: `${name} ok` })
let mediaCheck: Check = ok('media')
mock.module('../../../src/core/onboarding/search', () => ({ searchComponent: { name: 'search', check: async () => ok('search') } }))
mock.module('../../../src/core/onboarding/search-models', () => ({ searchModelsComponent: { name: 'search-models', check: async () => ok('search-models') } }))
mock.module('../../../src/core/onboarding/media', () => ({ mediaComponent: { name: 'media', check: async () => mediaCheck } }))
mock.module('../../../src/core/onboarding/models', () => ({ modelsComponent: { name: 'models', check: async () => ok('models') } }))
mock.module('../../../src/core/onboarding/recommended-plugins', () => ({ recommendedPluginsComponent: { name: 'recommended-plugins', check: async () => ok('recommended-plugins') } }))
mock.module('../../../src/core/onboarding/recommended-agents', () => ({ recommendedAgentsComponent: { name: 'recommended-agents', check: async () => ok('recommended-agents') } }))

import { collectOnboardingSelections, OnboardingCancelledError } from '../../../src/core/cli/onboarding-interactive'

const INTERACTIVE = { interactive: true, autoApprove: false, json: false, checkOnly: false }
/** The bootstrap phase finished with a runtime the wizard can ask about. */
const READY = { runtimeReady: true }

beforeEach(() => {
  titles.length = 0
  mediaCheck = ok('media')
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('collectOnboardingSelections', () => {
  it('asks about image processing and records the approval for media', async () => {
    mediaCheck = { name: 'media', status: 'missing', message: 'no image processing.' }
    const selections = await collectOnboardingSelections(INTERACTIVE, READY)
    expect(titles).toContain('Image processing')
    expect(selections.approvedComponents).toEqual(['media'])
  })

  it('leaving a screen with Ctrl-C is a cancellation, never a silent finish', async () => {
    mediaCheck = { name: 'media', status: 'missing', message: 'no image processing.' }
    cancelNextScreen = true
    await expect(collectOnboardingSelections(INTERACTIVE, READY)).rejects.toBeInstanceOf(OnboardingCancelledError)
    // The wizard stopped at the screen that was left; nothing after it was asked.
    expect(titles).toHaveLength(1)
  })

  it('a runtime the bootstrap phase could not get ready asks nothing (the run reports why)', async () => {
    mediaCheck = { name: 'media', status: 'missing', message: 'no image processing.' }
    expect(await collectOnboardingSelections(INTERACTIVE, { runtimeReady: false })).toEqual({})
    expect(titles).toEqual([])
  })

  it('never asks in a scripted run, whatever the bootstrap phase came to', async () => {
    mediaCheck = { name: 'media', status: 'missing', message: 'no image processing.' }
    for (const scripted of [{ ...INTERACTIVE, interactive: false }, { ...INTERACTIVE, autoApprove: true }, { ...INTERACTIVE, json: true }, { ...INTERACTIVE, checkOnly: true }]) {
      expect(await collectOnboardingSelections(scripted, READY)).toEqual({})
    }
    expect(titles).toEqual([])
  })
})
