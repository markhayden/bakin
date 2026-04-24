/**
 * Tests for the mcporter onboarding component.
 *
 * This component is a thin wrapper over the existing src/core/mcporter
 * module — we mock the underlying module directly rather than mocking
 * child_process or fs, because the wrapper's whole job is to translate
 * isMcporterInstalled/installMcporter/syncConfig into CheckResult and
 * InstallResult shapes. Testing the underlying module's behavior is
 * already covered by tests/core/mcporter.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

let isInstalledReturn: boolean | (() => boolean)
let installMcporterReturn: boolean
let installMcporterCalls: number
let syncConfigReturn: string[] | (() => string[])
let syncConfigCalls: number[]
let syncConfigError: Error | null
let configFileExists: boolean
let askYesNoReturn: boolean

mock.module('../../../src/core/mcporter', () => ({
  isMcporterInstalled: () =>
    typeof isInstalledReturn === 'function' ? isInstalledReturn() : isInstalledReturn,
  installMcporter: () => {
    installMcporterCalls++
    // A successful install mutates isInstalledReturn so the post-install
    // re-check passes. Failed installs leave it alone.
    if (installMcporterReturn) isInstalledReturn = true
    return installMcporterReturn
  },
  syncConfig: (port: number) => {
    syncConfigCalls.push(port)
    if (syncConfigError) throw syncConfigError
    return typeof syncConfigReturn === 'function' ? syncConfigReturn() : syncConfigReturn
  },
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('fs', () => {
  const actual = require('fs') as typeof import('fs')
  return {
    ...actual,
    existsSync: (p: unknown) => {
      const path = String(p)
      if (path.endsWith('.mcporter/mcporter.json')) return configFileExists
      return actual.existsSync(p as never)
    },
  }
})

mock.module('../../../src/core/onboarding/prompts', () => ({
  askYesNo: () => Promise.resolve(askYesNoReturn),
  readLine: () => Promise.resolve(''),
}))

describe('onboarding mcporter component', () => {
  let mcporterComponent: typeof import('../../../src/core/onboarding/mcporter').mcporterComponent

  beforeEach(async () => {
    isInstalledReturn = false
    installMcporterReturn = true
    installMcporterCalls = 0
    syncConfigReturn = []
    syncConfigCalls = []
    syncConfigError = null
    configFileExists = true
    askYesNoReturn = true
    process.env.PORT = '3737'
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/mcporter')
    mcporterComponent = mod.mcporterComponent
  })

  afterEach(() => {
    delete process.env.PORT
  })

  const optsAutoYes = {
    interactive: false,
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }
  const optsInteractive = {
    interactive: true,
    autoApprove: false,
    json: false,
    checkOnly: false,
    force: false,
  }
  const optsNonInteractiveNoYes = {
    interactive: false,
    autoApprove: false,
    json: false,
    checkOnly: false,
    force: false,
  }

  describe('check()', () => {
    it('reports ok when mcporter is installed and config file exists', async () => {
      isInstalledReturn = true
      configFileExists = true
      const result = await mcporterComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.port).toBe(3737)
    })

    it('reports missing when mcporter is not installed', async () => {
      isInstalledReturn = false
      const result = await mcporterComponent.check()
      expect(result.status).toBe('missing')
      expect(result.remediation).toContain('bakin install mcporter')
    })

    it('reports broken when installed but config file is missing', async () => {
      isInstalledReturn = true
      configFileExists = false
      const result = await mcporterComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('missing')
    })
  })

  describe('install()', () => {
    it('installs mcporter and syncs config when not already installed', async () => {
      isInstalledReturn = false
      installMcporterReturn = true
      syncConfigReturn = ['added bakin-main', 'added bakin-pixel']
      const result = await mcporterComponent.install(optsAutoYes)
      expect(result.status).toBe('installed')
      expect(installMcporterCalls).toBe(1)
      expect(syncConfigCalls).toEqual([3737])
      expect(result.message).toContain('2 change')
    })

    it('is a noop when already installed with no config changes', async () => {
      isInstalledReturn = true
      syncConfigReturn = []
      const result = await mcporterComponent.install(optsAutoYes)
      expect(result.status).toBe('noop')
      expect(installMcporterCalls).toBe(0)
      expect(syncConfigCalls).toEqual([3737])
    })

    it('reports installed (not noop) when already installed but config was updated', async () => {
      isInstalledReturn = true
      syncConfigReturn = ['updated bakin-main']
      const result = await mcporterComponent.install(optsAutoYes)
      expect(result.status).toBe('installed')
      expect(result.message).toContain('synced')
      expect(installMcporterCalls).toBe(0)
    })

    it('fails cleanly when installMcporter returns false', async () => {
      isInstalledReturn = false
      installMcporterReturn = false
      const result = await mcporterComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('npm install -g mcporter failed')
    })

    it('fails when syncConfig throws', async () => {
      isInstalledReturn = true
      syncConfigError = new Error('EACCES')
      const result = await mcporterComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('EACCES')
    })

    it('skips install when user declines the prompt', async () => {
      isInstalledReturn = false
      askYesNoReturn = false
      const result = await mcporterComponent.install(optsInteractive)
      expect(result.status).toBe('skipped')
      expect(installMcporterCalls).toBe(0)
    })

    it('skips install in non-interactive mode without --yes when not installed', async () => {
      isInstalledReturn = false
      const result = await mcporterComponent.install(optsNonInteractiveNoYes)
      expect(result.status).toBe('skipped')
      expect(result.message).toContain('Non-interactive')
      expect(installMcporterCalls).toBe(0)
    })

    it('still syncs config in non-interactive mode when mcporter is already installed', async () => {
      isInstalledReturn = true
      syncConfigReturn = []
      const result = await mcporterComponent.install(optsNonInteractiveNoYes)
      // No install prompt because nothing to install
      expect(installMcporterCalls).toBe(0)
      // syncConfig still runs
      expect(syncConfigCalls).toEqual([3737])
      expect(result.status).toBe('noop')
    })
  })
})
