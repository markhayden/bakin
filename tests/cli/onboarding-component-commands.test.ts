import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

const runtimeCheck = mock()

const checkAll = mock()

const pluginAssetsInstall = mock()

mock.module('../../src/core/onboarding/runtime', () => ({
  runtimeComponent: {
    name: 'runtime',
    check: runtimeCheck,
    install: mock(async () => ({ name: 'runtime', status: 'noop', message: 'Runtime ready.', durationMs: 1 })),
  },
}))

mock.module('../../src/core/onboarding/index', () => ({
  checkAll,
}))

mock.module('../../src/core/onboarding/plugin-assets', () => ({
  pluginAssetsComponent: {
    name: 'plugin-assets',
    check: mock(async () => ({ name: 'plugin-assets', status: 'ok', message: 'Plugin assets ready.' })),
    install: pluginAssetsInstall,
  },
}))

describe('onboarding component CLI commands', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>

  function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
  }

  function output(): string {
    return log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  beforeEach(() => {
    mock.clearAllMocks()
    runtimeCheck.mockImplementation(async () => ({
      name: 'runtime',
      status: 'ok',
      message: 'Runtime adapter is available.',
    }))
    checkAll.mockImplementation(async () => [
      { name: 'runtime', status: 'ok', message: 'Runtime adapter is available.' },
      { name: 'search', status: 'ok', message: 'Search adapter is available.' },
    ])
    pluginAssetsInstall.mockImplementation(async () => ({
      name: 'plugin-assets',
      status: 'installed',
      message: 'Installed plugin assets.',
      durationMs: 12,
    }))
    process.argv = originalArgv
    log = spyOn(console, 'log').mockImplementation(() => {})
    process.exit = ((code?: number) => {
      if (code === 0) return undefined as never
      throw new Error(`exit:${code}`)
    }) as never
    setStdoutIsTTY(true)
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    log.mockRestore()
  })

  it('renders single component checks with the shared TUI in a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'check', 'runtime']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(output()).toContain('Onboarding check')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Runtime adapter is available.')
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
    expect(output()).not.toContain('[OK]')
  })

  it('renders component installs with the shared TUI in a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'install', 'plugin-assets']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain('Onboarding install')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Installed plugin assets.')
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
})
