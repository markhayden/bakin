import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

// The onboarding component modules are all mocked below, so nothing here should
// reach a real home — but the isolation rule is blanket for a reason, and this
// file had no guard at all.
const testDir = join(tmpdir(), `bakin-test-onboarding-cli-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

/**
 * These tests assert the CLI's runtime-log suppression contract, which branches on
 * BAKIN_CONSOLE_FORMAT being UNSET (`withTtyRuntimeLogsSilenced`: an operator's
 * explicit format always wins over --verbose). The suite as a whole runs with that
 * var set to 'silent' (tests/setup.ts), so this file has to clear it to exercise the
 * unset branch at all — otherwise --verbose has nothing to un-silence, and the
 * non-verbose case would pass for the wrong reason: ambient silence rather than the
 * code's own.
 */
let previousConsoleFormat: string | undefined
beforeEach(() => {
  previousConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  delete process.env.BAKIN_CONSOLE_FORMAT
})
afterEach(() => {
  if (previousConsoleFormat === undefined) delete process.env.BAKIN_CONSOLE_FORMAT
  else process.env.BAKIN_CONSOLE_FORMAT = previousConsoleFormat
})

const runtimeCheck = mock()

const checkAll = mock()

const pluginAssetsInstall = mock()
const mkdirInstall = mock()
const settingsInstall = mock()

mock.module('../../src/core/onboarding/runtime', () => ({
  runtimeComponent: {
    name: 'runtime',
    check: runtimeCheck,
    install: mock(async () => ({ name: 'runtime', status: 'noop', message: 'Runtime ready.', durationMs: 1 })),
  },
}))

// A terminal `bakin install <x>` without --yes asks before it starts.
const askYesNo = mock(async () => true)
mock.module('../../src/core/onboarding/prompts', () => ({ askYesNo }))

/** Each install runs as an in-process operation (no server.lock in this home — #895 D11). */
const PLAN = { stages: [{ id: 'run', kind: 'installing' as const, label: 'Run' }], pointOfNoReturn: 'start' as const }
const installables: Record<string, { name: string; plan: typeof PLAN; resources: never[]; check: () => Promise<unknown>; install: (...args: unknown[]) => Promise<unknown> }> = {
  'plugin-assets': { name: 'plugin-assets', plan: PLAN, resources: [], check: async () => ({ name: 'plugin-assets', status: 'missing', message: 'Plugin assets missing.' }), install: (...args) => pluginAssetsInstall(...args) },
  mkdir: { name: 'mkdir', plan: PLAN, resources: [], check: async () => ({ name: 'mkdir', status: 'ok', message: 'Bakin home ready.' }), install: (...args) => mkdirInstall(...args) },
  settings: { name: 'settings', plan: PLAN, resources: [], check: async () => ({ name: 'settings', status: 'ok', message: 'Settings ready.' }), install: (...args) => settingsInstall(...args) },
}
mock.module('../../src/core/onboarding/index', () => ({
  checkAll,
  installableComponent: (name: string) => installables[name],
}))

mock.module('../../src/core/onboarding/plugin-assets', () => ({
  pluginAssetsComponent: {
    name: 'plugin-assets',
    check: mock(async () => ({ name: 'plugin-assets', status: 'ok', message: 'Plugin assets ready.' })),
    install: pluginAssetsInstall,
  },
}))

mock.module('../../src/core/onboarding/mkdir', () => ({
  mkdirComponent: {
    name: 'mkdir',
    check: mock(async () => ({ name: 'mkdir', status: 'ok', message: 'Bakin home ready.' })),
    install: mkdirInstall,
  },
}))

mock.module('../../src/core/onboarding/settings', () => ({
  settingsComponent: {
    name: 'settings',
    check: mock(async () => ({ name: 'settings', status: 'ok', message: 'Settings ready.' })),
    install: settingsInstall,
  },
}))

// spyStdoutWrite keeps the live progress frames out of the test output.
const harness = setupTtyCliHarness({ mockFetch: false, spyStdoutWrite: true, saveEnv: ['BAKIN_URL'] })
const { output } = harness

describe('onboarding component CLI commands', () => {
  beforeEach(() => {
    delete process.env.BAKIN_URL
    pluginAssetsInstall.mockClear()
    askYesNo.mockClear()
    runtimeCheck.mockImplementation(async () => {
      const { createLogger } = await import('../../packages/core/src/logger')
      createLogger('settings').info('Runtime check log')
      return {
        name: 'runtime',
        status: 'ok',
        message: 'Runtime adapter is available.',
      }
    })
    checkAll.mockImplementation(async () => {
      const { createLogger } = await import('../../packages/core/src/logger')
      createLogger('settings').info('Settings loaded')
      return [
        { name: 'runtime', status: 'ok', message: 'Runtime adapter is available.' },
        { name: 'search', status: 'ok', message: 'Search adapter is available.' },
      ]
    })
    pluginAssetsInstall.mockImplementation(async () => {
      const { createLogger } = await import('../../packages/core/src/logger')
      createLogger('settings').info('Plugin install log')
      return {
        name: 'plugin-assets',
        status: 'installed',
        message: 'Installed plugin assets.',
        durationMs: 12,
      }
    })
    mkdirInstall.mockImplementation(async () => {
      const { createLogger } = await import('../../packages/core/src/logger')
      createLogger('settings').info('Mkdir install log')
      return {
        name: 'mkdir',
        status: 'noop',
        message: 'Already initialized at ~/.bakin',
        durationMs: 3,
      }
    })
    settingsInstall.mockImplementation(async () => {
      const { createLogger } = await import('../../packages/core/src/logger')
      createLogger('settings').info('Settings init log')
      return {
        name: 'settings',
        status: 'installed',
        message: 'Wrote ~/.bakin/settings.json',
        durationMs: 5,
      }
    })
  })

  it('renders single component checks with the shared TUI in a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'check', 'runtime']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain("┃ 🐷 Bakin'")
    expect(output()).toContain('Onboarding check')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Runtime adapter is available.')
    expect(output()).not.toContain('Runtime check log')
    expect(output()).not.toContain('[OK]')
  })

  it('renders all component checks with the shared TUI in a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'check', 'all']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(checkAll).toHaveBeenCalled()
    expect(output()).toContain('Onboarding checks')
    expect(output()).toContain('CHECKS')
    expect(output()).toContain('Search adapter is available.')
    expect(output()).not.toContain('Settings loaded')
    expect(output()).not.toContain('[OK]')
  })

  it('keeps component check logs when --verbose is used', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'check', 'all', '--verbose']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain('Settings loaded')
    expect(output()).toContain('Onboarding checks')
  })

  it('renders component installs with the shared TUI in a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'install', 'plugin-assets']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain('Onboarding install')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Installed plugin assets.')
    expect(askYesNo).toHaveBeenCalledWith('Plugin assets missing. Install plugin-assets now?', true)
    expect(output()).not.toContain('Plugin install log')
    expect(output()).not.toContain('[INSTALLED]')
  })

  it('declining the prompt starts nothing and reports the skip', async () => {
    askYesNo.mockImplementationOnce(async () => false)
    process.argv = ['bun', 'cli/bakin.ts', 'install', 'plugin-assets']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(pluginAssetsInstall).not.toHaveBeenCalled()
    expect(output()).toContain('Skipped')
  })

  it('with BAKIN_URL the prompt names the remote Bakin, never this machine\'s check — and declining contacts nothing', async () => {
    process.env.BAKIN_URL = 'http://10.0.0.9:3737'
    askYesNo.mockImplementationOnce(async () => false)
    process.argv = ['bun', 'cli/bakin.ts', 'install', 'plugin-assets']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(askYesNo).toHaveBeenCalledWith('Install plugin-assets on the Bakin at http://10.0.0.9:3737?', true)
    expect(pluginAssetsInstall).not.toHaveBeenCalled()
  })

  it('renders mkdir installs with the shared TUI in a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'mkdir']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(mkdirInstall).toHaveBeenCalledWith({ autoApprove: true, allowServiceClaim: false }, expect.anything())
    expect(output()).toContain('Onboarding install')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Already initialized at ~/.bakin')
    expect(output()).not.toContain('Mkdir install log')
    expect(output()).not.toContain('[NOOP]')
  })

  it('renders settings init installs with the shared TUI in a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'init']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(settingsInstall).toHaveBeenCalledWith({ autoApprove: true, allowServiceClaim: false }, expect.anything())
    expect(output()).toContain('Onboarding install')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Wrote ~/.bakin/settings.json')
    expect(output()).not.toContain('Settings init log')
    expect(output()).not.toContain('[INSTALLED]')
  })

  it('preserves JSON output for component installs', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'install', 'plugin-assets', '--json']

    const { main } = await import('../../cli/bakin')
    await main()

    const body = JSON.parse(output())
    expect(body.component).toBe('plugin-assets')
    expect(body.status).toBe('installed')
    expect(output()).not.toContain('Onboarding install')
  })

  it('preserves JSON output for mkdir and settings init aliases', async () => {
    const { main } = await import('../../cli/bakin')

    process.argv = ['bun', 'cli/bakin.ts', 'mkdir', '--json']
    await main()
    let body = JSON.parse(output())
    expect(body.component).toBe('mkdir')
    expect(body.status).toBe('noop')
    expect(mkdirInstall).toHaveBeenCalledWith({ autoApprove: true, allowServiceClaim: false }, expect.anything())
    expect(output()).not.toContain('Onboarding install')

    harness.log.mockClear()
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'init', '--json']
    await main()
    body = JSON.parse(output())
    expect(body.component).toBe('settings')
    expect(body.status).toBe('installed')
    expect(settingsInstall).toHaveBeenCalledWith({ autoApprove: true, allowServiceClaim: false }, expect.anything())
    expect(output()).not.toContain('Onboarding install')
  })
})
