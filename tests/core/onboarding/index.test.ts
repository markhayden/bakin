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
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { OnboardingInstallOptions } from '../../../src/core/onboarding/install-request'
import type { CheckResult, InstallResult, OnboardingComponent } from '../../../src/core/onboarding/types'
import { noopOp } from '../../helpers/operation-harness'

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

const COMPONENT_NAMES = ['mkdir', 'settings', 'runtime', 'llm', 'search', 'search-models', 'media', 'openclaw-integration', 'plugin-assets', 'agent-sync', 'models', 'budget', 'channels', 'recommended-plugins', 'recommended-agents', 'capabilities'] as const

let scripts: Record<(typeof COMPONENT_NAMES)[number], ScriptedComponent>

let saveStateCalls: Array<{ components: Record<string, string>; bakinVersion: string }>
let clearMarkerCalls: number

/** Check-only in production: the runtime and credentials are set up outside Bakin. */
const CHECK_ONLY = new Set<string>(['llm', 'channels', 'budget'])

/** What each real component declares it needs (the requirements test pins the real table). */
const REQUIRES: Record<(typeof COMPONENT_NAMES)[number], readonly string[]> = {
  mkdir: [], settings: ['mkdir'], runtime: ['settings'], llm: ['runtime'], search: ['settings'], 'search-models': ['search'],
  media: ['mkdir'], 'openclaw-integration': ['runtime'], 'plugin-assets': ['runtime'], 'agent-sync': ['runtime'], models: ['runtime'],
  budget: ['settings'], channels: ['runtime'], 'recommended-plugins': ['runtime'], 'recommended-agents': ['runtime'], capabilities: ['runtime'],
}
const USABLE_WHEN_MISSING = new Set<string>(['mkdir', 'settings'])
const REQUIRES_OK: Partial<Record<(typeof COMPONENT_NAMES)[number], readonly string[]>> = { 'search-models': ['search'] }

function makeMock(name: (typeof COMPONENT_NAMES)[number]): OnboardingComponent {
  const check = async () => {
    scripts[name].checkCalls++
    return scripts[name].check
  }
  const needs = { requires: REQUIRES[name], ...(USABLE_WHEN_MISSING.has(name) ? { usableWhenMissing: true } : {}), ...(REQUIRES_OK[name] ? { requiresOk: REQUIRES_OK[name] } : {}) }
  if (CHECK_ONLY.has(name)) return { name, ...needs, manualSetup: `Set up ${name} outside Bakin.`, check }
  return {
    name,
    ...needs,
    plan: { stages: [{ id: 'run', kind: 'installing', label: name }], pointOfNoReturn: 'start' },
    resources: [],
    check,
    install: async () => {
      scripts[name].installCalls++
      return scripts[name].install
    },
  }
}

/** The options each install was handed — what the CLI would send to the server. */
let installOptions: Array<{ name: string; options: OnboardingInstallOptions }> = []

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
mock.module('../../../src/core/onboarding/media', () => ({ mediaComponent: makeMock('media') }))
mock.module('../../../src/core/onboarding/openclaw-integration', () => ({ openClawIntegrationComponent: makeMock('openclaw-integration') }))
mock.module('../../../src/core/onboarding/plugin-assets', () => ({ pluginAssetsComponent: makeMock('plugin-assets') }))
mock.module('../../../src/core/onboarding/agent-sync', () => ({ agentSyncComponent: makeMock('agent-sync') }))
mock.module('../../../src/core/onboarding/budget', () => ({ budgetComponent: makeMock('budget') }))
mock.module('../../../src/core/onboarding/models', () => ({ modelsComponent: makeMock('models') }))
mock.module('../../../src/core/onboarding/credentials', () => ({
  llmComponent: makeMock('llm'),
  channelsComponent: makeMock('channels'),
}))
mock.module('../../../src/core/onboarding/recommended-plugins', () => ({
  recommendedPluginsComponent: makeMock('recommended-plugins'),
  RECOMMENDED_PLUGINS: [],
}))
mock.module('../../../src/core/onboarding/recommended-agents', () => ({
  recommendedAgentsComponent: makeMock('recommended-agents'),
  RECOMMENDED_AGENTS: [],
}))
mock.module('../../../src/core/onboarding/recommended-capabilities', () => ({
  recommendedCapabilitiesComponent: makeMock('capabilities'),
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

mock.module('../../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {},
    search: {},
    tasks: {},
    health: {},
  }),
  maybeGetAppServices: () => ({
    runtime: {},
    search: {},
    tasks: {},
    health: {},
  }),
  createAppServices: async () => ({
    runtime: {},
    search: {},
    tasks: {},
    health: {},
  }),
}))
mock.module('../../../src/core/app-services-store', () => ({
  getAppServices: () => ({
    runtime: {},
    search: {},
    tasks: {},
    health: {},
  }),
  maybeGetAppServices: () => ({
    runtime: {},
    search: {},
    tasks: {},
    health: {},
  }),
  createAppServices: async () => ({
    runtime: {},
    search: {},
    tasks: {},
    health: {},
  }),
}))
mock.module('../../../src/core/app-services.ts', () => ({
  getAppServices: () => ({
    runtime: {},
    search: {},
    tasks: {},
    health: {},
  }),
  maybeGetAppServices: () => ({
    runtime: {},
    search: {},
    tasks: {},
    health: {},
  }),
  createAppServices: async () => ({
    runtime: {},
    search: {},
    tasks: {},
    health: {},
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
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => '/tmp/bakin-onboarding-orchestrator-test',
  getBakinPaths: () => ({}),
}))

describe('runOnboard orchestrator', () => {
  let runOnboardWith: typeof import('../../../src/core/onboarding/index').runOnboard
  /** Installs run the component in place, as an in-process operation would. */
  const runOnboard = (o: Parameters<typeof runOnboardWith>[0]) => runOnboardWith(o, (component, options) => {
    installOptions.push({ name: component.name, options })
    return component.install(options, noopOp())
  })
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
    installOptions = []
    saveStateCalls = []
    clearMarkerCalls = 0
    stdoutLines = []
    stdoutWriteSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutLines.push(String(chunk))
      return true
    })
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/index')
    runOnboardWith = mod.runOnboard
    checkAll = mod.checkAll
    COMPONENT_ORDER = mod.COMPONENT_ORDER
  })

  afterEach(() => {
    stdoutWriteSpy.mockRestore()
  })

  afterAll(() => {
    mock.restore()
  })

  const opts = {
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }

  // ---------------------------------------------------------------------------
  // Component ordering
  // ---------------------------------------------------------------------------

  describe('COMPONENT_ORDER', () => {
    it('contains exactly the expected components in the spec order', () => {
      expect(COMPONENT_ORDER.map((c) => c.name)).toEqual([
        'mkdir',
        'settings',
        'runtime',
        'llm',
        'search',
        'search-models',
        'media',
        'openclaw-integration',
        'plugin-assets',
        'agent-sync',
        'models',
        'budget',
        'channels',
        'recommended-plugins',
        'recommended-agents',
        'capabilities',
      ])
    })
  })

  // ---------------------------------------------------------------------------
  // Happy path — every component ok
  // ---------------------------------------------------------------------------

  describe('installs run through the caller (#895 D11)', () => {
    it('hands each install explicit options — the wizard selections, never a service claim', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'missing' }
      scripts['recommended-plugins'].check = { name: 'recommended-plugins', status: 'missing', message: 'missing' }
      await runOnboard({ ...opts, approvedComponents: ['search'], selectedRecommendedPluginIds: ['bits'] })
      expect(installOptions).toEqual([
        { name: 'search', options: { autoApprove: true, allowServiceClaim: false, approvedComponents: ['search'], selectedRecommendedPluginIds: ['bits'] } },
        { name: 'recommended-plugins', options: { autoApprove: true, allowServiceClaim: false, approvedComponents: ['search'], selectedRecommendedPluginIds: ['bits'] } },
      ])
    })

    it('an interrupted install (Ctrl-C) stops onboarding: nothing after it runs and no marker is written', async () => {
      const { OnboardingInterruptedError } = await import('../../../src/core/onboarding/index')
      scripts.search.check = { name: 'search', status: 'missing', message: 'missing' }
      scripts.media.check = { name: 'media', status: 'missing', message: 'missing' }
      const started: string[] = []
      const run = runOnboardWith(opts, async (component) => {
        started.push(component.name)
        throw new OnboardingInterruptedError(component.name, 'cancelled')
      })
      await expect(run).rejects.toBeInstanceOf(OnboardingInterruptedError)
      expect(started).toEqual(['search'])
      expect(saveStateCalls).toEqual([])
    })

    it('a check-only component that is not set up records its setup pointer and installs nothing', async () => {
      scripts.llm.check = { name: 'llm', status: 'missing', message: 'no providers' }
      const result = await runOnboard(opts)
      const llm = result.outcomes.find((o) => o.name === 'llm')
      expect(llm).toMatchObject({ finalStatus: 'ok', message: 'Set up llm outside Bakin.' })
      expect(installOptions).toEqual([])
    })
  })

  describe('all ok', () => {
    it('returns exit code 0, writes marker, no installs called', async () => {
      const result = await runOnboard(opts)
      expect(result.exitCode).toBe(0)
      expect(result.markerWritten).toBe(true)
      expect(result.outcomes.map((o) => o.finalStatus)).toEqual(
        Array.from({ length: COMPONENT_NAMES.length }, () => 'ok'),
      )
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
        media: 'ok',
        'openclaw-integration': 'ok',
        'plugin-assets': 'ok',
        'agent-sync': 'ok',
        llm: 'ok',
        models: 'ok',
        budget: 'ok',
        channels: 'ok',
        'recommended-plugins': 'ok',
        'recommended-agents': 'ok',
        capabilities: 'ok',
      })
    })

    it('reports each outcome to the human UI without affecting outcomes', async () => {
      const outcomes: string[] = []
      const result = await runOnboard({
        ...opts,
        onOutcome: outcome => outcomes.push(`${outcome.finalStatus}:${outcome.name}`),
      })

      expect(result.exitCode).toBe(0)
      expect(outcomes).toContain('ok:mkdir')
      expect(outcomes).toContain('ok:recommended-agents')
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
      scripts['plugin-assets'].check = { name: 'plugin-assets', status: 'missing', message: 'plugin-assets missing' }
      scripts['plugin-assets'].install = { name: 'plugin-assets', status: 'failed', message: 'npm failed', durationMs: 0 }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'plugin-assets')?.finalStatus).toBe('error')
      expect(result.exitCode).toBe(1)
      expect(result.markerWritten).toBe(false)
      expect(saveStateCalls).toHaveLength(0)
    })

    it('treats install:skipped as skipped (exit 2, marker still written)', async () => {
      scripts['plugin-assets'].check = { name: 'plugin-assets', status: 'missing', message: 'plugin-assets missing' }
      scripts['plugin-assets'].install = { name: 'plugin-assets', status: 'skipped', message: 'user declined', durationMs: 0 }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'plugin-assets')?.finalStatus).toBe('skipped')
      expect(result.exitCode).toBe(2)
      expect(result.markerWritten).toBe(true)
    })

    it('every skip carries a typed reason: an unexplained install skip is declined, an explained one keeps its reason and code', async () => {
      scripts['plugin-assets'].check = { name: 'plugin-assets', status: 'missing', message: 'plugin-assets missing' }
      scripts['plugin-assets'].install = { name: 'plugin-assets', status: 'skipped', message: 'not approved', durationMs: 0 }
      scripts.models.check = { name: 'models', status: 'missing', message: 'no plan' }
      scripts.models.install = { name: 'models', status: 'skipped', reason: 'unavailable', code: 'no_runnable_model', message: 'nothing can run', durationMs: 0 }
      const result = await runOnboard({ ...opts, json: true })
      const pluginAssets = result.outcomes.find((o) => o.name === 'plugin-assets')
      const models = result.outcomes.find((o) => o.name === 'models')
      expect([pluginAssets?.reason, pluginAssets?.code]).toEqual(['declined', undefined])
      expect([models?.reason, models?.code]).toEqual(['unavailable', 'no_runnable_model'])
      // The reason and code are on the JSON line; consumers never parse the message.
      const line = stdoutLines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.component === 'models')
      expect(line).toMatchObject({ status: 'skipped', reason: 'unavailable', code: 'no_runnable_model' })
    })

    it('a warning the install could not fix survives it — rechecked, never reported as a bare ok', async () => {
      const broken = { name: 'search-models', status: 'broken' as const, message: 'visual embedder is not the pinned download.' }
      const remaining = { name: 'search-models', status: 'warn' as const, message: "custom embedder can't load on this machine.", remediation: 'Nothing to install.' }
      Object.defineProperty(scripts['search-models'], 'check', { get: () => scripts['search-models'].installCalls > 0 ? remaining : broken, configurable: true })
      scripts['search-models'].install = { name: 'search-models', status: 'installed', message: 'Pulled 1 model: visual embedder.', durationMs: 5 }
      const result = await runOnboard(opts)
      const outcome = result.outcomes.find((o) => o.name === 'search-models')
      expect(scripts['search-models'].installCalls).toBe(1)
      expect(outcome?.finalStatus).toBe('warn')
      expect(outcome?.message).toContain("custom embedder can't load")
      expect(outcome?.remediation).toBe('Nothing to install.')
      expect(result.exitCode).toBe(2)
    })

    it('a recheck that is not a warning keeps the install\'s ok (a service still starting never fails a good install)', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'search missing' }
      scripts.search.install = { name: 'search', status: 'installed', message: 'search installed', durationMs: 1 }
      const result = await runOnboard(opts)
      expect(scripts.search.checkCalls).toBe(2)
      expect(result.outcomes.find((o) => o.name === 'search')?.finalStatus).toBe('ok')
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
      scripts['plugin-assets'].check = { name: 'plugin-assets', status: 'missing', message: 'plugin-assets missing' }
      const result = await runOnboard({ ...opts, checkOnly: true })
      expect(scripts.search.installCalls).toBe(0)
      expect(scripts['plugin-assets'].installCalls).toBe(0)
      expect(result.outcomes.find((o) => o.name === 'search')?.finalStatus).toBe('skipped')
      expect(result.outcomes.find((o) => o.name === 'search')?.reason).toBe('check_only')
      expect(result.outcomes.find((o) => o.name === 'plugin-assets')?.finalStatus).toBe('skipped')
      expect(result.exitCode).toBe(2)
    })

    it('never writes the marker: a check proves nothing was set up', async () => {
      const allOk = await runOnboard({ ...opts, checkOnly: true })
      expect(allOk.exitCode).toBe(0)
      expect(allOk.markerWritten).toBe(false)
      expect(saveStateCalls).toHaveLength(0)
    })

    it('never clears the marker, even when force is also set', async () => {
      await runOnboard({ ...opts, checkOnly: true, force: true })
      expect(clearMarkerCalls).toBe(0)
    })

    it('never provisions an empty roster: the runtime is reported as not set up yet, not as an error', async () => {
      scripts.runtime.check = {
        name: 'runtime',
        status: 'missing',
        message: 'Runtime adapter returned no agents',
        details: { emptyRoster: true },
      }
      const result = await runOnboard({ ...opts, checkOnly: true })
      expect(scripts.runtime.installCalls).toBe(0)
      expect(scripts.runtime.checkCalls).toBe(1)
      expect(result.outcomes.find((o) => o.name === 'runtime')).toMatchObject({ finalStatus: 'skipped', reason: 'check_only' })
      expect(result.outcomes.some((o) => o.finalStatus === 'error')).toBe(false)
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
    it('runtime unreachable: only the steps that need it are skipped; independent steps still run', async () => {
      scripts.runtime.check = {
        name: 'runtime',
        status: 'error',
        message: 'runtime not configured',
        remediation: 'Configure the runtime adapter',
      }
      const result = await runOnboard(opts)
      expect(scripts.runtime.checkCalls).toBe(1)
      expect(scripts.runtime.installCalls).toBe(0) // nothing an install can fix
      // Independent of the runtime: checked as usual.
      for (const name of ['mkdir', 'settings', 'search', 'search-models', 'media', 'budget'] as const) {
        expect({ name, checked: scripts[name].checkCalls }).toEqual({ name, checked: 1 })
        expect(result.outcomes.find((o) => o.name === name)?.finalStatus).toBe('ok')
      }
      // Need the runtime: never checked, and each says what it was waiting for.
      for (const name of ['llm', 'plugin-assets', 'agent-sync', 'models', 'channels', 'recommended-plugins', 'recommended-agents', 'capabilities'] as const) {
        expect({ name, checked: scripts[name].checkCalls }).toEqual({ name, checked: 0 })
        expect(result.outcomes.find((o) => o.name === name)).toMatchObject({ finalStatus: 'skipped', reason: 'requires', requires: 'runtime' })
      }
      expect(result.outcomes).toHaveLength(COMPONENT_NAMES.length)
      expect(result.outcomes.find((o) => o.name === 'runtime')?.finalStatus).toBe('error')
      // A dependent carries the remediation of what it was waiting for.
      expect(result.outcomes.find((o) => o.name === 'channels')?.remediation).toBe('Configure the runtime adapter')
      // An unreachable runtime blocks completion: exit 1, no marker.
      expect(result.exitCode).toBe(1)
      expect(result.markerWritten).toBe(false)
    })

    it('a runtime with no agents yet is provisioned by its install and the flow proceeds', async () => {
      const empty = { name: 'runtime', status: 'missing' as const, message: 'Runtime adapter returned no agents', details: { emptyRoster: true } }
      const ready = { name: 'runtime', status: 'ok' as const, message: 'test-runtime runtime adapter is available' }
      Object.defineProperty(scripts.runtime, 'check', { get: () => scripts.runtime.installCalls > 0 ? ready : empty, configurable: true })
      scripts.runtime.install = { name: 'runtime', status: 'installed', message: 'provisioned', durationMs: 1 }
      const result = await runOnboard(opts)
      expect(scripts.runtime.installCalls).toBe(1)
      expect(result.outcomes.find((o) => o.name === 'runtime')?.finalStatus).toBe('ok')
      // What needs the runtime runs.
      expect(scripts.llm.checkCalls).toBe(1)
      expect(result.exitCode).toBe(0)
    })

    it('a runtime whose provisioning does not produce a usable roster blocks completion', async () => {
      scripts.runtime.check = { name: 'runtime', status: 'missing', message: 'Runtime adapter returned no agents', details: { emptyRoster: true } }
      scripts.runtime.install = { name: 'runtime', status: 'failed', message: 'Runtime still has no agents after provisioning', durationMs: 1 }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'runtime')).toMatchObject({ finalStatus: 'error', message: 'Runtime still has no agents after provisioning' })
      expect(result.outcomes.find((o) => o.name === 'llm')).toMatchObject({ reason: 'requires', requires: 'runtime' })
      expect(result.exitCode).toBe(1)
      expect(result.markerWritten).toBe(false)
    })

    it('a runtime the operator has to fix is never installed over', async () => {
      scripts.runtime.check = { name: 'runtime', status: 'error', message: 'Runtime roster has 1 integrity issue' }
      const result = await runOnboard(opts)
      expect(scripts.runtime.installCalls).toBe(0)
      expect(result.outcomes.find((o) => o.name === 'runtime')?.finalStatus).toBe('error')
    })

    it('runtime broken is an error that blocks completion', async () => {
      scripts.runtime.check = {
        name: 'runtime',
        status: 'error',
        message: 'runtime config corrupt',
      }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'runtime')?.finalStatus).toBe('error')
      expect(scripts.runtime.installCalls).toBe(0)
      // What needs the runtime never ran; what does not, did.
      expect(scripts.llm.checkCalls).toBe(0)
      expect(scripts.search.checkCalls).toBe(1)
      // Error -> exit 1, no marker
      expect(result.exitCode).toBe(1)
      expect(result.markerWritten).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Search -> search-models cascade: model downloads need the search adapter binary.
  // ---------------------------------------------------------------------------

  describe('phases', () => {
    it('asks for selections once, after the bootstrap components and before anything else is looked at', async () => {
      const seen: Array<{ names: string[]; searchChecked: number }> = []
      await runOnboardWith(opts, (component, options) => component.install(options, noopOp()), {
        afterBootstrap: async (bootstrap) => {
          seen.push({ names: bootstrap.map((o) => o.name), searchChecked: scripts.search.checkCalls })
          return undefined
        },
      })
      expect(seen).toEqual([{ names: ['mkdir', 'settings', 'runtime'], searchChecked: 0 }])
    })

    it('the selections apply to the rest of the run', async () => {
      scripts.media.check = { name: 'media', status: 'missing', message: 'media missing' }
      await runOnboardWith({ ...opts, autoApprove: false }, (component, options) => {
        installOptions.push({ name: component.name, options })
        return component.install(options, noopOp())
      }, {
        afterBootstrap: async () => ({ approvedComponents: ['media'], selectedRecommendedPluginIds: ['projects'] }),
      })
      expect(installOptions.find((entry) => entry.name === 'media')?.options).toMatchObject({ approvedComponents: ['media'], selectedRecommendedPluginIds: ['projects'] })
    })

    it('the bootstrap phase sees the runtime outcome it has to decide on', async () => {
      scripts.runtime.check = { name: 'runtime', status: 'error', message: 'no runtime' }
      let runtimeStatus: string | undefined
      await runOnboardWith(opts, (component, options) => component.install(options, noopOp()), {
        afterBootstrap: async (bootstrap) => {
          runtimeStatus = bootstrap.find((o) => o.name === 'runtime')?.finalStatus
          return undefined
        },
      })
      expect(runtimeStatus).toBe('error')
    })

    it('a throw from the phase boundary stops onboarding: nothing after the bootstrap runs, no marker', async () => {
      const stop = new Error('the operator left the wizard')
      await expect(runOnboardWith(opts, (component, options) => component.install(options, noopOp()), {
        afterBootstrap: async () => { throw stop },
      })).rejects.toBe(stop)
      expect(scripts.search.checkCalls).toBe(0)
      expect(saveStateCalls).toHaveLength(0)
    })
  })

  describe('declined components', () => {
    const DECLINED = ['recommended-plugins', 'recommended-agents', 'capabilities'] as const

    it('a declined component is neither checked nor installed, even with autoApprove', async () => {
      for (const name of DECLINED) {
        scripts[name].check = { name, status: 'missing', message: `${name} missing` }
        scripts[name].install = { name, status: 'installed', message: `${name} installed`, durationMs: 0 }
      }
      const result = await runOnboard({ ...opts, autoApprove: true, declinedComponents: [...DECLINED] })
      for (const name of DECLINED) {
        expect({ name, checked: scripts[name].checkCalls, installed: scripts[name].installCalls }).toEqual({ name, checked: 0, installed: 0 })
        expect(result.outcomes.find((o) => o.name === name)).toMatchObject({ finalStatus: 'skipped', reason: 'declined' })
      }
      // Declining is a choice, not a failure: the run completes.
      expect(result.exitCode).toBe(2)
      expect(result.markerWritten).toBe(true)
    })

    it('still declined when already installed: nothing is looked at', async () => {
      // Every check would say ok; a decline does not ask.
      const result = await runOnboard({ ...opts, declinedComponents: [...DECLINED] })
      for (const name of DECLINED) {
        expect(scripts[name].checkCalls).toBe(0)
        expect(result.outcomes.find((o) => o.name === name)?.reason).toBe('declined')
      }
    })

    it('says where to get it later and prints a line for it under --json', async () => {
      const result = await runOnboard({ ...opts, json: true, declinedComponents: ['capabilities'] })
      expect(result.outcomes.find((o) => o.name === 'capabilities')?.message).toContain('bakin install capabilities')
      const line = stdoutLines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.component === 'capabilities')
      expect(line).toMatchObject({ status: 'skipped', reason: 'declined' })
    })

    it('everything not declined runs as usual', async () => {
      const result = await runOnboard({ ...opts, declinedComponents: [...DECLINED] })
      expect(scripts.search.checkCalls).toBe(1)
      expect(scripts.models.checkCalls).toBe(1)
      expect(result.outcomes.filter((o) => o.reason === 'declined').map((o) => o.name)).toEqual([...DECLINED])
    })
  })

  describe('declared requirements', () => {
    it('a step that does not apply to the runtime satisfies whatever requires it', async () => {
      // openclaw-integration never applies to the test runtime; nothing waits on it.
      const result = await runOnboard(opts)
      expect(result.outcomes.filter((o) => o.reason === 'requires')).toEqual([])
    })

    it('requirements chain: when the home cannot be created nothing after it runs', async () => {
      scripts.mkdir.check = { name: 'mkdir', status: 'missing', message: 'no home' }
      scripts.mkdir.install = { name: 'mkdir', status: 'failed', message: 'ENOTDIR', durationMs: 0 }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'mkdir')?.finalStatus).toBe('error')
      expect(result.outcomes.find((o) => o.name === 'settings')).toMatchObject({ reason: 'requires', requires: 'mkdir' })
      expect(result.outcomes.find((o) => o.name === 'runtime')).toMatchObject({ reason: 'requires', requires: 'settings' })
      expect(result.outcomes.find((o) => o.name === 'llm')).toMatchObject({ reason: 'requires', requires: 'runtime' })
      expect(scripts.runtime.checkCalls).toBe(0)
      expect(result.exitCode).toBe(1)
      expect(result.markerWritten).toBe(false)
    })

    it('under --check a missing home or settings file does not block the checks after it', async () => {
      scripts.mkdir.check = { name: 'mkdir', status: 'missing', message: 'no home' }
      scripts.settings.check = { name: 'settings', status: 'missing', message: 'no settings' }
      const result = await runOnboard({ ...opts, checkOnly: true })
      expect(result.outcomes.find((o) => o.name === 'mkdir')).toMatchObject({ finalStatus: 'skipped', reason: 'check_only' })
      expect(result.outcomes.find((o) => o.name === 'settings')).toMatchObject({ finalStatus: 'skipped', reason: 'check_only' })
      expect(scripts.runtime.checkCalls).toBe(1)
      expect(scripts.search.checkCalls).toBe(1)
      expect(scripts.media.checkCalls).toBe(1)
      expect(result.outcomes.filter((o) => o.reason === 'requires')).toEqual([])
    })

    it('under --check a BROKEN settings file still blocks what needs it', async () => {
      scripts.settings.check = { name: 'settings', status: 'broken', message: 'not JSON' }
      const result = await runOnboard({ ...opts, checkOnly: true })
      expect(result.outcomes.find((o) => o.name === 'runtime')).toMatchObject({ reason: 'requires', requires: 'settings' })
      expect(scripts.runtime.checkCalls).toBe(0)
      // media only needs the home, which is fine.
      expect(scripts.media.checkCalls).toBe(1)
    })

    it('under --check a step that is not usable-when-missing still blocks its dependents', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'engine not installed' }
      const result = await runOnboard({ ...opts, checkOnly: true })
      expect(result.outcomes.find((o) => o.name === 'search-models')).toMatchObject({ reason: 'requires', requires: 'search' })
    })
  })

  describe('search -> search-models cascade', () => {
    it('skips search-models when search failed to install', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'search missing' }
      scripts.search.install = { name: 'search', status: 'failed', message: 'brew missing', durationMs: 0 }
      const result = await runOnboard(opts)
      expect(scripts.search.installCalls).toBe(1)
      // search-models never even has check() called; it is pre-skipped.
      expect(scripts['search-models'].checkCalls).toBe(0)
      expect(result.outcomes.find((o) => o.name === 'search-models')?.finalStatus).toBe('skipped')
      expect(result.outcomes.find((o) => o.name === 'search-models')).toMatchObject({ reason: 'requires', requires: 'search' })
      expect(result.outcomes.find((o) => o.name === 'search-models')?.message).toContain('needs search')
      // plugin-assets and credentials still run; they do not depend on search.
      expect(scripts['plugin-assets'].checkCalls).toBe(1)
      expect(scripts.llm.checkCalls).toBe(1)
    })

    it('a search that only warns does NOT satisfy search-models: it is an engine this home does not run', async () => {
      scripts.search.check = { name: 'search', status: 'warn', message: 'Temporary home cannot manage the shared search service.' }
      // Left to run, the models check would report the missing engine as an error.
      scripts['search-models'].check = { name: 'search-models', status: 'error', message: 'engine binary not found' }
      const result = await runOnboard(opts)
      expect(scripts['search-models'].checkCalls).toBe(0)
      expect(result.outcomes.find((o) => o.name === 'search-models')).toMatchObject({ finalStatus: 'skipped', reason: 'requires', requires: 'search' })
      // A warning upstream never turns into a failed onboarding.
      expect(result.exitCode).toBe(2)
      expect(result.markerWritten).toBe(true)
    })

    it('a warning satisfies an ordinary requirement', async () => {
      scripts.settings.check = { name: 'settings', status: 'warn', message: 'settings has a caveat' }
      const result = await runOnboard(opts)
      expect(scripts.runtime.checkCalls).toBe(1)
      expect(result.outcomes.filter((o) => o.reason === 'requires')).toEqual([])
    })

    it('a declined search skips search-models without failing the run', async () => {
      scripts.search.check = { name: 'search', status: 'missing', message: 'search missing' }
      scripts.search.install = { name: 'search', status: 'skipped', reason: 'declined', message: 'not approved', durationMs: 0 }
      const result = await runOnboard(opts)
      expect(result.outcomes.find((o) => o.name === 'search-models')).toMatchObject({ finalStatus: 'skipped', reason: 'requires', requires: 'search' })
      expect(scripts['search-models'].checkCalls).toBe(0)
      // As complete as the operator allowed: exit 2, marker written.
      expect(result.exitCode).toBe(2)
      expect(result.markerWritten).toBe(true)
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
      expect(stdoutLines).toHaveLength(COMPONENT_NAMES.length)
      for (const line of stdoutLines) {
        const parsed = JSON.parse(line)
        expect(COMPONENT_NAMES).toContain(parsed.component)
        expect(parsed.status).toBe('ok')
      }
    })

    it('emits JSON for cascaded skips from runtime', async () => {
      scripts.runtime.check = { name: 'runtime', status: 'error', message: 'runtime missing' }
      await runOnboard({ ...opts, json: true })
      // Should emit every component: those before runtime plus downstream cascade-skips.
      expect(stdoutLines).toHaveLength(COMPONENT_NAMES.length)
    })

    it('emits a line for a component that does not apply to the runtime, with its typed reason', async () => {
      // openclaw-integration declares supportedAdapters; the test runtime is not one of them.
      const result = await runOnboard({ ...opts, json: true })
      const skipped = result.outcomes.filter((o) => o.reason === 'not_applicable')
      const lines = stdoutLines.map((l) => JSON.parse(l) as Record<string, unknown>)
      expect(lines).toHaveLength(COMPONENT_NAMES.length)
      for (const outcome of skipped) {
        expect(lines.find((l) => l.component === outcome.name)).toMatchObject({ status: 'skipped', reason: 'not_applicable' })
      }
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
      expect(results).toHaveLength(COMPONENT_NAMES.length)
      expect(results.map((r) => r.name)).toEqual([...COMPONENT_NAMES])
      for (const n of COMPONENT_NAMES) {
        expect(scripts[n].checkCalls).toBe(1)
        expect(scripts[n].installCalls).toBe(0)
      }
    })

    it('catches thrown errors from check() and returns them as error status', async () => {
      scripts['plugin-assets'].check = { name: 'plugin-assets', status: 'ok', message: 'ok' }
      // Replace the mock to make plugin-assets.check throw
      const mod = await import('../../../src/core/onboarding/plugin-assets')
      spyOn(mod.pluginAssetsComponent, 'check').mockRejectedValueOnce(new Error('boom'))
      const results = await checkAll()
      const mcp = results.find((r) => r.name === 'plugin-assets')
      expect(mcp?.status).toBe('error')
      expect(mcp?.message).toContain('boom')
    })
  })

  // ---------------------------------------------------------------------------
  // Exception handling inside runOnboard
  // ---------------------------------------------------------------------------

  describe('exception handling', () => {
    it('converts a thrown check() error into an error outcome', async () => {
      const mod = await import('../../../src/core/onboarding/plugin-assets')
      spyOn(mod.pluginAssetsComponent, 'check').mockRejectedValueOnce(new Error('boom'))
      const result = await runOnboard(opts)
      const mcp = result.outcomes.find((o) => o.name === 'plugin-assets')
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
