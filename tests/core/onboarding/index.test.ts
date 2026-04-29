/**
 * Tests for the runOnboard orchestrator.
 *
 * Every component is mocked at the module level so we can script the
 * check()/install() return values per test and verify the orchestrator's
 * decision logic (ordering, cascade skips, exit code aggregation, marker
 * write rules) in isolation from the component implementations.
 *
 * state.ts is mocked at the module level too so we can assert exactly
 * when saveState/clearMarker are called without touching the real
 * filesystem.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { CheckResult, InstallResult, OnboardingComponent } from '../../../src/core/onboarding/types'

// ---------------------------------------------------------------------------
// Per-test mock state. The mocks below read these objects on every call,
// so tests can script behavior by mutating them in beforeEach / per-it.
// ---------------------------------------------------------------------------

interface ScriptedComponent {
  check: CheckResult
  install: InstallResult
  checkCalls: number
  installCalls: number
}

const COMPONENT_NAMES = ['mkdir', 'settings', 'runtime', 'search', 'search-models', 'mcporter', 'plugin-assets', 'agent-assets', 'llm', 'channels', 'recommended-plugins'] as const

let scripts: Record<(typeof COMPONENT_NAMES)[number], ScriptedComponent>

let saveStateCalls: Array<{ components: Record<string, string>; bakinVersion: string }>
let clearMarkerCalls: number

function makeMock(name: (typeof COMPONENT_NAMES)[number]): OnboardingComponent {
  return {
    name,
    check: async () => {
      scripts[name].checkCalls++
      return scripts[name].check
    },
    install: async () => {
      scripts[name].installCalls++
      return scripts[name].install
    },
  }
}

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/onboarding/mkdir', () => ({ mkdirComponent: makeMock('mkdir') }))
mock.module('../../../src/core/onboarding/settings', () => ({ settingsComponent: makeMock('settings') }))
mock.module('../../../src/core/onboarding/runtime', () => ({ runtimeComponent: makeMock('runtime') }))
mock.module('../../../src/core/onboarding/search', () => ({ searchComponent: makeMock('search') }))
mock.module('../../../src/core/onboarding/search-models', () => ({ searchModelsComponent: makeMock('search-models') }))
mock.module('../../../src/core/onboarding/mcporter', () => ({ mcporterComponent: makeMock('mcporter') }))
mock.module('../../../src/core/onboarding/plugin-assets', () => ({ pluginAssetsComponent: makeMock('plugin-assets') }))
mock.module('../../../src/core/onboarding/agent-assets', () => ({ agentAssetsComponent: makeMock('agent-assets') }))
mock.module('../../../src/core/onboarding/credentials', () => ({
  llmComponent: makeMock('llm'),
  channelsComponent: makeMock('channels'),
}))
mock.module('../../../src/core/onboarding/recommended-plugins', () => ({
  recommendedPluginsComponent: makeMock('recommended-plugins'),
}))

mock.module('../../../src/core/onboarding/state', () => ({
  saveState: (components: Record<string, string>, bakinVersion: string) => {
    saveStateCalls.push({ components, bakinVersion })
    return {
      version: 1,
      completedAt: '2026-04-11T00:00:00.000Z',
      bakinVersion,
      components,
    }
  },
  clearMarker: () => {
    clearMarkerCalls++
  },
  isOnboarded: () => false,
  loadState: () => null,
  ONBOARDING_VERSION: 1,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

// Belt-and-braces: every component is already mocked above, so the real
// modules below are never imported. We still mock content-dir per the
// CLAUDE.md test-isolation rule so any future test addition that pulls
// in a real component still can't write to ~/.bakin/.
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => '/tmp/bakin-onboarding-orchestrator-test',
  getBakinPaths: () => ({}),
}))

describe('runOnboard orchestrator', () => {
  let runOnboard: typeof import('../../../src/core/onboarding/index').runOnboard
  let checkAll: typeof import('../../../src/core/onboarding/index').checkAll
  let COMPONENT_ORDER: typeof import('../../../src/core/onboarding/index').COMPONENT_ORDER
  let stdoutLines: string[]
  let stdoutWriteSpy: ReturnType<typeof spyOn>

  /** Build a fresh "all green" script where every component reports ok. */
  function freshScripts(): typeof scripts {
    const out = {} as typeof scripts
    for (const name of COMPONENT_NAMES) {
      out[name] = {
        check: { name, status: 'ok', message: `${name} ok` },
        install: { name, status: 'noop', message: `${name} noop`, durationMs: 0 },
        checkCalls: 0,
        installCalls: 0,
      }
    }
    return out
  }

  beforeEach(async () => {
    scripts = freshScripts()
    saveStateCalls = []
    clearMarkerCalls = 0
    stdoutLines = []
    stdoutWriteSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutLines.push(String(chunk))
      return true
    })
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/index')
    runOnboard = mod.runOnboard
    checkAll = mod.checkAll
    COMPONENT_ORDER = mod.COMPONENT_ORDER
  })

  afterEach(() => {
    stdoutWriteSpy.mockRestore()
  })

  const opts = {
    interactive: false,
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }

  // ---------------------------------------------------------------------------
  // Component ordering
  // ---------------------------------------------------------------------------

  describe('COMPONENT_ORDER', () => {
    it('contains exactly the 11 expected components in the spec order', () => {
      expect(COMPONENT_ORDER.map((c) => c.name)).toEqual([
        'mkdir',
        'settings',
        'runtime',
        'search',
        'search-models',
        'mcporter',
        'plugin-assets',
        'agent-assets',
        'llm',
        'channels',
        'recommended-plugins',
      ])
    })
  })

  // ---------------------------------------------------------------------------
  // Happy path — every component ok
  // ---------------------------------------------------------------------------

  describe('all ok', () => {
    it('returns exit code 0, writes marker, no installs called', async () => {
      const result = await runOnboard(opts)
      expect(result.exitCode).toBe(0)
      expect(result.markerWritten).toBe(true)
      expect(result.outcomes.map((o) => o.finalStatus)).toEqual([
        'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok',
      ])
      // check() was called on every component
      for (const n of COMPONENT_NAMES) {
        expect(scripts[n].checkCalls).toBe(1)
      }
      // install() was never called — nothing was missing
      for (const n of COMPONENT_NAMES) {
        expect(scripts[n].installCalls).toBe(0)
      }
      expect(saveStateCalls).toHaveLength(1)
      expect(saveStateCalls[0].components).toEqual({
        mkdir: 'ok',
        settings: 'ok',
        runtime: 'ok',
        search: 'ok',
        'search-models': 'ok',
        mcporter: 'ok',
        'plugin-assets': 'ok',
        'agent-assets': 'ok',
        llm: 'ok',
        channels: 'ok',
        'recommended-plugins': 'ok',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Install triggered by missing/broken check
  // ---------------------------------------------------------------------------

  describe('missing components trigger install', () => {
    it('calls install() when check reports missing', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'search missing' }
      scripts.search.install = { name: 'search', status: 'installed', message: 'search installed', durationMs: 100 }
      const result = await runOnboard(opts)
      expect(scripts.search.installCalls).toBe(1)
      expect(result.outcomes.find((o) => o.name === 'search')?.finalStatus).toBe('ok')
      expect(result.exitCode).toBe(0)
      expect(result.markerWritten).toBe(true)
    })

    it('treats install:failed as an error (exit 1, no marker)', async () => {
      scripts.mcporter.check = { name: 'mcporter', status: 'missing', message: 'mcporter missing' }
      scripts.mcporter.install = { name: 'mcporter', status: 'failed', message: 'npm failed', durationMs: 0 }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'mcporter')?.finalStatus).toBe('error')
      expect(result.exitCode).toBe(1)
      expect(result.markerWritten).toBe(false)
      expect(saveStateCalls).toHaveLength(0)
    })

    it('treats install:skipped as skipped (exit 2, marker still written)', async () => {
      scripts.mcporter.check = { name: 'mcporter', status: 'missing', message: 'mcporter missing' }
      scripts.mcporter.install = { name: 'mcporter', status: 'skipped', message: 'user declined', durationMs: 0 }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'mcporter')?.finalStatus).toBe('skipped')
      expect(result.exitCode).toBe(2)
      expect(result.markerWritten).toBe(true)
    })

    it('treats install:noop as ok', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'search missing' }
      scripts.search.install = { name: 'search', status: 'noop', message: 'search already installed', durationMs: 0 }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'search')?.finalStatus).toBe('ok')
    })
  })

  // ---------------------------------------------------------------------------
  // --check mode never installs
  // ---------------------------------------------------------------------------

  describe('checkOnly mode', () => {
    it('never calls install() even when check reports missing', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'search missing' }
      scripts.mcporter.check = { name: 'mcporter', status: 'missing', message: 'mcporter missing' }
      const result = await runOnboard({ ...opts, checkOnly: true })
      expect(scripts.search.installCalls).toBe(0)
      expect(scripts.mcporter.installCalls).toBe(0)
      expect(result.outcomes.find((o) => o.name === 'search')?.finalStatus).toBe('skipped')
      expect(result.outcomes.find((o) => o.name === 'mcporter')?.finalStatus).toBe('skipped')
      // check-only is non-destructive → marker still written iff no errors
      expect(result.exitCode).toBe(2)
      expect(result.markerWritten).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Warn-only components
  // ---------------------------------------------------------------------------

  describe('warn status handling', () => {
    it('llm warn does not block marker write', async () => {
      scripts.llm.check = { name: 'llm', status: 'warn', message: 'no LLM configured' }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'llm')?.finalStatus).toBe('warn')
      expect(result.exitCode).toBe(2)
      expect(result.markerWritten).toBe(true)
      // install() is never called for warn components
      expect(scripts.llm.installCalls).toBe(0)
    })

    it('channels warn aggregates to exit 2', async () => {
      scripts.channels.check = { name: 'channels', status: 'warn', message: 'no channels' }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'channels')?.finalStatus).toBe('warn')
      expect(result.exitCode).toBe(2)
      expect(scripts.channels.installCalls).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Runtime cascade - missing runtime aborts the entire flow
  // ---------------------------------------------------------------------------

  describe('runtime cascade', () => {
    it('runtime missing halts the flow and skips every downstream component', async () => {
      scripts.runtime.check = {
        name: 'runtime',
        status: 'missing',
        message: 'runtime not configured',
        remediation: 'Configure the runtime adapter',
      }
      // install() is never called for runtime - the orchestrator runs
      // it inline, skipping install because runtime setup is user-managed.
      const result = await runOnboard(opts)
      // mkdir and settings still run (before runtime in the order)
      expect(scripts.mkdir.checkCalls).toBe(1)
      expect(scripts.settings.checkCalls).toBe(1)
      expect(scripts.runtime.checkCalls).toBe(1)
      expect(scripts.runtime.installCalls).toBe(0) // never called
      // Everything downstream is NOT run - check is never called on them
      expect(scripts.search.checkCalls).toBe(0)
      expect(scripts['search-models'].checkCalls).toBe(0)
      expect(scripts.mcporter.checkCalls).toBe(0)
      expect(scripts.llm.checkCalls).toBe(0)
      expect(scripts.channels.checkCalls).toBe(0)
      // All components still appear in outcomes
      expect(result.outcomes).toHaveLength(11)
      // Runtime is error (missing prerequisite), downstream all skipped
      expect(result.outcomes.find((o) => o.name === 'runtime')?.finalStatus).toBe('error')
      expect(result.outcomes.find((o) => o.name === 'search')?.finalStatus).toBe('skipped')
      expect(result.outcomes.find((o) => o.name === 'channels')?.finalStatus).toBe('skipped')
      // Per spec: runtime missing is a hard stop - exit 1, no marker
      expect(result.exitCode).toBe(1)
      expect(result.markerWritten).toBe(false)
    })

    it('runtime broken halts the flow with error status', async () => {
      scripts.runtime.check = {
        name: 'runtime',
        status: 'broken',
        message: 'runtime config corrupt',
      }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'runtime')?.finalStatus).toBe('error')
      // install() is never called - runtime is inline
      expect(scripts.runtime.installCalls).toBe(0)
      // Downstream components never ran
      expect(scripts.search.checkCalls).toBe(0)
      // Error -> exit 1, no marker
      expect(result.exitCode).toBe(1)
      expect(result.markerWritten).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Search -> search-models cascade: model downloads need the search adapter binary.
  // ---------------------------------------------------------------------------

  describe('search -> search-models cascade', () => {
    it('skips search-models when search failed to install', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'search missing' }
      scripts.search.install = { name: 'search', status: 'failed', message: 'brew missing', durationMs: 0 }
      const result = await runOnboard(opts)
      expect(scripts.search.installCalls).toBe(1)
      // search-models never even has check() called; it is pre-skipped.
      expect(scripts['search-models'].checkCalls).toBe(0)
      expect(result.outcomes.find((o) => o.name === 'search-models')?.finalStatus).toBe('skipped')
      expect(result.outcomes.find((o) => o.name === 'search-models')?.message).toContain('search adapter binary is required')
      // mcporter and credentials still run; they do not depend on search.
      expect(scripts.mcporter.checkCalls).toBe(1)
      expect(scripts.llm.checkCalls).toBe(1)
    })

    it('runs search-models when search is ok', async () => {
      const result = await runOnboard(opts)
      expect(scripts['search-models'].checkCalls).toBe(1)
      expect(result.outcomes.find((o) => o.name === 'search-models')?.finalStatus).toBe('ok')
    })
  })

  // ---------------------------------------------------------------------------
  // --force clears the marker upfront
  // ---------------------------------------------------------------------------

  describe('force flag', () => {
    it('calls clearMarker when force=true', async () => {
      await runOnboard({ ...opts, force: true })
      expect(clearMarkerCalls).toBe(1)
    })

    it('does not call clearMarker when force=false', async () => {
      await runOnboard({ ...opts, force: false })
      expect(clearMarkerCalls).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('json output', () => {
    it('emits one JSON line per outcome', async () => {
      await runOnboard({ ...opts, json: true })
      expect(stdoutLines).toHaveLength(11)
      for (const line of stdoutLines) {
        const parsed = JSON.parse(line)
        expect(COMPONENT_NAMES).toContain(parsed.component)
        expect(parsed.status).toBe('ok')
      }
    })

    it('emits JSON for cascaded skips from runtime', async () => {
      scripts.runtime.check = { name: 'runtime', status: 'missing', message: 'runtime missing' }
      scripts.runtime.install = { name: 'runtime', status: 'noop', message: 'required', durationMs: 0 }
      await runOnboard({ ...opts, json: true })
      // Should emit every component: those before runtime plus downstream cascade-skips.
      expect(stdoutLines).toHaveLength(11)
    })

    it('does not emit JSON when json flag is false', async () => {
      await runOnboard({ ...opts, json: false })
      expect(stdoutLines).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // checkAll() never calls install
  // ---------------------------------------------------------------------------

  describe('checkAll', () => {
    it('calls check() on every component and never install()', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'search missing' }
      const results = await checkAll()
      expect(results).toHaveLength(11)
      expect(results.map((r) => r.name)).toEqual([...COMPONENT_NAMES])
      for (const n of COMPONENT_NAMES) {
        expect(scripts[n].checkCalls).toBe(1)
        expect(scripts[n].installCalls).toBe(0)
      }
    })

    it('catches thrown errors from check() and returns them as error status', async () => {
      scripts.mcporter.check = { name: 'mcporter', status: 'ok', message: 'ok' }
      // Replace the mock to make mcporter.check throw
      const mod = await import('../../../src/core/onboarding/mcporter')
      spyOn(mod.mcporterComponent, 'check').mockRejectedValueOnce(new Error('boom'))
      const results = await checkAll()
      const mcp = results.find((r) => r.name === 'mcporter')
      expect(mcp?.status).toBe('error')
      expect(mcp?.message).toContain('boom')
    })
  })

  // ---------------------------------------------------------------------------
  // Exception handling inside runOnboard
  // ---------------------------------------------------------------------------

  describe('exception handling', () => {
    it('converts a thrown check() error into an error outcome', async () => {
      const mod = await import('../../../src/core/onboarding/mcporter')
      spyOn(mod.mcporterComponent, 'check').mockRejectedValueOnce(new Error('boom'))
      const result = await runOnboard(opts)
      const mcp = result.outcomes.find((o) => o.name === 'mcporter')
      expect(mcp?.finalStatus).toBe('error')
      expect(result.exitCode).toBe(1)
      expect(result.markerWritten).toBe(false)
    })

    it('converts a thrown install() error into an error outcome', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'search missing' }
      const mod = await import('../../../src/core/onboarding/search')
      spyOn(mod.searchComponent, 'install').mockRejectedValueOnce(new Error('spawn failed'))
      const result = await runOnboard(opts)
      const search = result.outcomes.find((o) => o.name === 'search')
      expect(search?.finalStatus).toBe('error')
      expect(search?.message).toContain('spawn failed')
    })
  })
})
