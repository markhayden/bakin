/**
 * Tests for the recommended-plugins onboarding component (Phase 6).
 *
 * The component itself is small but has three behavior axes:
 *   - check() — empty list / all-installed / some-missing
 *   - install() in autoApprove (--yes) — defaultSelected installs only
 *   - install() in interactive — drives the prompt; we mock it
 *   - install() failure modes — partial success, all-fail
 *
 * Lockfile state is mocked so we can simulate "plugin already
 * installed." execFileSync is mocked so we don't actually shell to
 * `bakin plugins install`.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-onboard-recommended-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// Mock the curated list — the real one ships empty until Phase 4-5.
// We synthesize a non-empty fixture so all three check() branches and
// every install() path can be exercised.
const FIXTURE_LIST = [
  {
    id: 'messaging',
    source: 'github:markhayden/bakin-bits-official#plugins/messaging',
    name: 'Messaging',
    description: 'Brainstorm + draft.',
    defaultSelected: true,
  },
  {
    id: 'projects',
    source: 'github:markhayden/bakin-bits-official#plugins/projects',
    name: 'Projects',
    description: 'Tracker.',
    defaultSelected: false,
  },
] as const
mock.module('../../../src/core/onboarding/recommended-plugins', () => ({
  RECOMMENDED_PLUGINS: FIXTURE_LIST,
}))

// Mock the lockfile — install state per test.
let installedIds: string[] = []
mock.module('../../../packages/core/src/plugins/lockfile', () => ({
  readPluginLockfile: () => ({
    version: 1,
    plugins: Object.fromEntries(installedIds.map((id) => [id, {}])),
  }),
}))

// Mock the prompt — drive selections from the test.
let promptSelection: string[] = []
mock.module('../../../src/core/onboarding/recommended-plugins-prompt', () => ({
  promptRecommendedPlugins: async () => promptSelection,
}))

// Mock execFileSync so install() never actually shells out.
let installShouldFailFor: Set<string> = new Set()
const installCalls: string[] = []
mock.module('child_process', () => ({
  execFileSync: (_cmd: string, args: readonly string[]) => {
    const source = args[2] ?? '<unknown>'
    installCalls.push(source)
    if ([...installShouldFailFor].some((id) => source.includes(id))) {
      throw new Error(`synthetic install failure for ${source}`)
    }
    return Buffer.from('ok')
  },
  spawnSync: () => ({ stdout: '', stderr: '', status: 0 }),
}))

import { recommendedPluginsComponent } from '../../../src/core/onboarding/recommended-plugins-component'

beforeEach(() => {
  installedIds = []
  promptSelection = []
  installShouldFailFor = new Set()
  installCalls.length = 0
})

const noninteractiveOpts = {
  interactive: false,
  autoApprove: true,
  json: false,
  checkOnly: false,
  force: false,
}

const interactiveOpts = {
  interactive: true,
  autoApprove: false,
  json: false,
  checkOnly: false,
  force: false,
}

describe('recommended-plugins component — check()', () => {
  it('returns ok when every recommended plugin is already installed', async () => {
    installedIds = ['messaging', 'projects']
    const result = await recommendedPluginsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toMatch(/already installed/)
  })

  it('returns missing when some plugins are not yet installed', async () => {
    installedIds = ['messaging']
    const result = await recommendedPluginsComponent.check()
    expect(result.status).toBe('missing')
    expect(result.details?.missing).toEqual(['projects'])
  })

  it('returns missing when none are installed', async () => {
    const result = await recommendedPluginsComponent.check()
    expect(result.status).toBe('missing')
    expect(result.details?.missing).toEqual(['messaging', 'projects'])
  })
})

describe('recommended-plugins component — install() autoApprove', () => {
  it('installs every defaultSelected plugin without prompting', async () => {
    const result = await recommendedPluginsComponent.install(noninteractiveOpts)
    expect(result.status).toBe('installed')
    expect(installCalls).toEqual([
      'github:markhayden/bakin-bits-official#plugins/messaging',
    ])
  })

  it('returns noop when every recommended plugin is already installed', async () => {
    installedIds = ['messaging', 'projects']
    const result = await recommendedPluginsComponent.install(noninteractiveOpts)
    expect(result.status).toBe('noop')
    expect(installCalls).toEqual([])
  })

  it('skipped when no defaults match available recommendations', async () => {
    // messaging is already installed, projects is NOT defaultSelected.
    // → No defaults left to install non-interactively.
    installedIds = ['messaging']
    const result = await recommendedPluginsComponent.install(noninteractiveOpts)
    expect(result.status).toBe('skipped')
  })
})

describe('recommended-plugins component — install() interactive', () => {
  it('drives the prompt and installs the user selection', async () => {
    promptSelection = ['projects']
    const result = await recommendedPluginsComponent.install(interactiveOpts)
    expect(result.status).toBe('installed')
    expect(installCalls).toEqual([
      'github:markhayden/bakin-bits-official#plugins/projects',
    ])
  })

  it('skipped when user picks nothing', async () => {
    promptSelection = []
    const result = await recommendedPluginsComponent.install(interactiveOpts)
    expect(result.status).toBe('skipped')
  })
})

describe('recommended-plugins component — failure modes', () => {
  it('reports failed when every install errors', async () => {
    installShouldFailFor = new Set(['messaging', 'projects'])
    promptSelection = ['messaging', 'projects']
    const result = await recommendedPluginsComponent.install(interactiveOpts)
    expect(result.status).toBe('failed')
  })

  it('reports installed (partial) when some succeed, others fail', async () => {
    installShouldFailFor = new Set(['projects'])
    promptSelection = ['messaging', 'projects']
    const result = await recommendedPluginsComponent.install(interactiveOpts)
    expect(result.status).toBe('installed')
    expect(result.message).toMatch(/installed 1\/2/)
    expect(result.message).toMatch(/failed: projects/)
  })
})
