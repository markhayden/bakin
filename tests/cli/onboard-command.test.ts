import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

const testDir = join(tmpdir(), `bakin-test-onboard-command-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const outcomes = [
  {
    name: 'mkdir',
    finalStatus: 'ok',
    check: { name: 'mkdir', status: 'ok', message: 'home ready' },
    message: 'Bakin home directory is initialized at /Users/roscoe/.bakin',
    durationMs: 1,
  },
  {
    name: 'settings',
    finalStatus: 'ok',
    check: { name: 'settings', status: 'ok', message: 'settings ready' },
    message: 'settings.json is present and parses at /Users/roscoe/.bakin/settings.json',
    durationMs: 1,
  },
]

let onboarded = false
let onboardingSelections: Record<string, unknown> = {}
let onboardingState: {
  version: number
  completedAt: string
  bakinVersion: string
  components: Record<string, 'ok' | 'warn' | 'skipped' | 'error'>
} | null = null

const runOnboard = mock(async (
  opts: {
    onProgress?: (message: string) => void
    onOutcome?: (outcome: { name: string; finalStatus: 'ok'; message: string }) => void
  },
  _install: unknown,
  phases?: { afterBootstrap?: (bootstrap: Array<{ name: string; finalStatus: 'ok' }>) => Promise<unknown> },
) => {
  opts.onProgress?.('Checking mkdir')
  opts.onOutcome?.({ name: 'mkdir', finalStatus: 'ok', message: outcomes[0].message })
  // The real run hands over once the home, settings and runtime are done.
  await phases?.afterBootstrap?.([{ name: 'mkdir', finalStatus: 'ok' }, { name: 'settings', finalStatus: 'ok' }, { name: 'runtime', finalStatus: 'ok' }])
  return { outcomes, exitCode: 0, markerWritten: true }
})

mock.module('../../src/core/onboarding/index', () => ({
  runOnboard,
  isOnboarded: () => onboarded,
  loadState: () => onboardingState,
  COMPONENT_ORDER: outcomes.map(outcome => ({ name: outcome.name })),
  RECOMMENDED_COMPONENTS: ['recommended-plugins', 'recommended-agents', 'capabilities'],
}))

class OnboardingCancelledError extends Error {}
mock.module('../../src/core/cli/onboarding-interactive', () => ({
  collectOnboardingSelections: async () => onboardingSelections,
  OnboardingCancelledError,
  promptRuntimeChoice: async () => 'pi',
}))

// The runtime decision reads the machine (which runtimes are set up) and
// this home's settings; here it has already been made.
type Chosen = { kind: 'use'; adapter: string; source: string; persist: boolean; found: string[] } | { kind: 'refused'; code: string; message: string; found: string[] }
let chosenRuntime: Chosen = { kind: 'use', adapter: 'pi', source: 'existing', persist: false, found: ['pi'] }
const chooseRuntime = mock(async () => chosenRuntime)
mock.module('../../src/cli/onboard-runtime', () => ({
  chooseRuntime,
  readRuntimeFlag: (args: string[]) => {
    const index = args.indexOf('--runtime')
    return index === -1 ? undefined : args[index + 1]
  },
}))

const harness = setupTtyCliHarness({
  mockFetch: false,
  spyStdoutWrite: true,
  saveEnv: ['BAKIN_CONSOLE_FORMAT', 'BAKIN_URL', 'BAKIN_RUNTIME_ADAPTER'],
})

describe('CLI onboard command', () => {
  beforeEach(() => {
    // Onboarding targets this home's own server (via server.lock) or runs in-process.
    delete process.env.BAKIN_URL
    onboarded = false
    onboardingSelections = {}
    onboardingState = null
    chosenRuntime = { kind: 'use', adapter: 'pi', source: 'existing', persist: false, found: ['pi'] }
    chooseRuntime.mockClear()
  })

  it('continues the shared onboarding summary without replaying the brand header', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'onboard', '--force']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = harness.output()
    const liveOutput = harness.writeOutput()
    expect(liveOutput).toContain("┃ 🐷 Bakin'")
    expect(output).not.toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Onboarding')
    expect(output).toContain('Machine setup complete')
    expect(output).toContain('PREREQUISITES')
    expect(output).toContain('Run `bakin start` to launch Bakin.')
  })

  it('continues onboarding progress without replaying the brand after wizard screens', async () => {
    onboardingSelections = { renderedWizardScreens: true }
    process.argv = ['bun', 'cli/bakin.ts', 'onboard', '--force']

    const { main } = await import('../../cli/bakin')
    await main()

    const liveOutput = harness.writeOutput()
    expect(liveOutput).toContain('Onboard')
    expect(liveOutput).not.toContain("┃ 🐷 Bakin'")
  })

  it('renders already-onboarded state with shared onboarding UI in a TTY', async () => {
    onboarded = true
    onboardingState = {
      version: 3,
      completedAt: '2026-05-19T12:00:00.000Z',
      bakinVersion: '1.0.0',
      components: { mkdir: 'ok', settings: 'ok' },
    }
    process.argv = ['bun', 'cli/bakin.ts', 'onboard']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = harness.output()
    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Machine setup already complete')
    expect(output).toContain('Already onboarded on 2026-05-19.')
    expect(output).toContain('Run `bakin onboard --force`')
    expect(output).not.toContain('[OK] Already onboarded')
    expect(runOnboard).not.toHaveBeenCalled()
  })

  it('refuses when BAKIN_URL points at another server — its checks and marker are this home\'s', async () => {
    process.env.BAKIN_URL = 'http://10.0.0.9:3737'
    onboarded = true
    process.argv = ['bun', 'cli/bakin.ts', 'onboard']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(harness.errorOutput()).toContain('BAKIN_URL points at http://10.0.0.9:3737')
    expect(runOnboard).not.toHaveBeenCalled()
  })

  describe('the runtime decision comes first', () => {
    it('a refusal prints why and exits 1 before anything runs', async () => {
      chosenRuntime = { kind: 'refused', code: 'ambiguous_runtime', message: 'More than one runtime is set up here (openclaw, pi). Say which one with --runtime <openclaw|pi>.', found: ['openclaw', 'pi'] }
      process.argv = ['bun', 'cli/bakin.ts', 'onboard', '--yes']

      const { main } = await import('../../cli/bakin')
      await expect(main()).rejects.toThrow('exit:1')

      expect(harness.errorOutput()).toContain('More than one runtime is set up here (openclaw, pi)')
      expect(runOnboard).not.toHaveBeenCalled()
    })

    it('a refusal under --json is the summary line and nothing else', async () => {
      chosenRuntime = { kind: 'refused', code: 'invalid_runtime', message: '--runtime bogus is not a runtime Bakin supports (openclaw, pi).', found: ['pi'] }
      process.argv = ['bun', 'cli/bakin.ts', 'onboard', '--json', '--runtime', 'bogus']

      const { main } = await import('../../cli/bakin')
      await expect(main()).rejects.toThrow('exit:1')

      const lines = harness.output().split('\n').filter(Boolean)
      expect(lines.map((line) => JSON.parse(line))).toEqual([{ summary: { exitCode: 1, markerWritten: false, runtime: { refused: 'invalid_runtime', found: ['pi'] } } }])
      expect(runOnboard).not.toHaveBeenCalled()
    })

    it('a refusal wins over the already-onboarded shortcut', async () => {
      onboarded = true
      chosenRuntime = { kind: 'refused', code: 'runtime_already_set', message: 'This home already uses pi.', found: ['pi'] }
      process.argv = ['bun', 'cli/bakin.ts', 'onboard', '--runtime', 'openclaw']

      const { main } = await import('../../cli/bakin')
      await expect(main()).rejects.toThrow('exit:1')
      expect(harness.output()).not.toContain('already complete')
    })

    it('a scripted run (--yes) is never asked: the decision is told nobody can choose', async () => {
      process.argv = ['bun', 'cli/bakin.ts', 'onboard', '--yes']
      const { main } = await import('../../cli/bakin')
      await main()
      expect(chooseRuntime).toHaveBeenCalledTimes(1)
      expect((chooseRuntime.mock.calls[0] as unknown as [{ interactive: boolean }])[0].interactive).toBe(false)
    })

    it('a choice to be kept is handed to the run as a proposal; one that is not, is not', async () => {
      chosenRuntime = { kind: 'use', adapter: 'pi', source: 'detected', persist: true, found: ['pi'] }
      process.argv = ['bun', 'cli/bakin.ts', 'onboard', '--force']
      const { main } = await import('../../cli/bakin')
      await main()
      expect((runOnboard.mock.calls.at(-1) as unknown as [{ runtimeProposal?: string }])[0].runtimeProposal).toBe('pi')

      runOnboard.mockClear()
      chosenRuntime = { kind: 'use', adapter: 'pi', source: 'existing', persist: false, found: ['pi'] }
      await main()
      expect((runOnboard.mock.calls.at(-1) as unknown as [{ runtimeProposal?: string }])[0].runtimeProposal).toBeUndefined()
    })
  })
})
