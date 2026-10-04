/** The CLI command is the authority boundary for deliberate service transfer. */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { OnboardingComponent, OnboardingOptions } from '../../../src/core/onboarding/types'

const sandbox = mkdtempSync(join(tmpdir(), 'bakin-test-search-claim-intent-'))
const savedEnv = {
  HOME: process.env.HOME,
  BAKIN_HOME: process.env.BAKIN_HOME,
  OPENCLAW_HOME: process.env.OPENCLAW_HOME,
  ANTFLY_HOME: process.env.ANTFLY_HOME,
  ANTFLY_PATH: process.env.ANTFLY_PATH,
}
process.env.HOME = join(sandbox, 'os-home')
process.env.BAKIN_HOME = sandbox
process.env.OPENCLAW_HOME = join(sandbox, 'openclaw')
process.env.ANTFLY_HOME = join(sandbox, 'antfly-home')
process.env.ANTFLY_PATH = join(sandbox, 'antfly-home', 'bin', 'antfly')

const contentDirMock = () => ({
  getContentDir: () => sandbox,
  getBakinPaths: () => ({
    home: sandbox,
    logs: join(sandbox, 'logs'),
    db: join(sandbox, 'bakin.db'),
    media: join(sandbox, 'media'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(sandbox, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(sandbox, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
mock.module('../../../src/core/watcher', () => ({}))
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ runtime: { adapter: 'pi' }, search: { settings: { url: 'http://127.0.0.1:3738' } } }),
  updateSettings: () => { throw new Error('This fixture must not write settings') },
}))
mock.module('../../../src/core/onboarding/prompts', () => ({ askYesNo: async () => true }))

type CapturedOptions = OnboardingOptions & { allowServiceClaim?: boolean }
const searchInstalls: CapturedOptions[] = []
const modelInstalls: CapturedOptions[] = []
mock.module('../../../src/core/search-adapter-factory', () => ({
  getSearchAdapterSetup: () => ({
    dependency: {
      check: async () => ({ name: 'search', status: 'missing', message: 'Managed search needs installation' }),
      install: async (options: CapturedOptions) => {
        searchInstalls.push(options)
        return { name: 'search', status: 'installed', message: 'Installed', durationMs: 0 }
      },
    },
  }),
}))

function readyComponent(name: string): OnboardingComponent {
  return {
    name,
    check: async () => ({ name, status: 'ok', message: 'Ready' }),
    install: async () => ({ name, status: 'noop', message: 'Ready', durationMs: 0 }),
  }
}
mock.module('../../../src/core/onboarding/mkdir', () => ({ mkdirComponent: readyComponent('mkdir') }))
mock.module('../../../src/core/onboarding/settings', () => ({ settingsComponent: readyComponent('settings') }))
mock.module('../../../src/core/onboarding/runtime', () => ({ runtimeComponent: readyComponent('runtime') }))
mock.module('../../../src/core/onboarding/search-models', () => ({
  searchModelsComponent: {
    ...readyComponent('search-models'),
    install: async (options: CapturedOptions) => {
      modelInstalls.push(options)
      return { name: 'search-models', status: 'noop', message: 'Ready', durationMs: 0 }
    },
  },
}))
mock.module('../../../src/core/onboarding/media', () => ({ mediaComponent: readyComponent('media') }))
mock.module('../../../src/core/onboarding/openclaw-integration', () => ({ openClawIntegrationComponent: readyComponent('openclaw-integration') }))
mock.module('../../../src/core/onboarding/plugin-assets', () => ({ pluginAssetsComponent: readyComponent('plugin-assets') }))
mock.module('../../../src/core/onboarding/agent-sync', () => ({ agentSyncComponent: readyComponent('agent-sync') }))
mock.module('../../../src/core/onboarding/credentials', () => ({ llmComponent: readyComponent('llm'), channelsComponent: readyComponent('channels') }))
mock.module('../../../src/core/onboarding/models', () => ({ modelsComponent: readyComponent('models') }))
mock.module('../../../src/core/onboarding/budget', () => ({ budgetComponent: readyComponent('budget') }))
mock.module('../../../src/core/onboarding/recommended-plugins', () => ({ recommendedPluginsComponent: readyComponent('recommended-plugins') }))
mock.module('../../../src/core/onboarding/recommended-agents', () => ({ recommendedAgentsComponent: readyComponent('recommended-agents') }))
mock.module('../../../src/core/onboarding/recommended-capabilities', () => ({ recommendedCapabilitiesComponent: readyComponent('capabilities') }))
mock.module('../../../src/core/onboarding/state', () => ({
  saveState: mock(), clearMarker: mock(), isOnboarded: () => false, loadState: () => null, ONBOARDING_VERSION: 1,
}))
mock.module('../../../src/cli/http', () => ({ apiGet: () => { throw new Error('CLI must not contact a server') } }))
mock.module('../../../src/cli/output', () => ({ print: mock(), statusIcon: () => '' }))
mock.module('../../../src/cli/help', () => ({ exitUnknownSubcommand: () => { throw new Error('Unexpected CLI target') } }))
mock.module('../../../src/core/cli/ui/render-report', () => ({ renderInkReport: () => { throw new Error('JSON commands must not mount UI') } }))

const { run } = await import('../../../src/cli/commands/onboarding')
const { runOnboard } = await import('../../../src/core/onboarding/index')
let consoleSpy: ReturnType<typeof spyOn>
let exitSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  searchInstalls.length = 0
  modelInstalls.length = 0
  consoleSpy = spyOn(console, 'log').mockImplementation(() => {})
  exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('Unexpected process.exit') })
})
afterEach(() => {
  consoleSpy.mockRestore()
  exitSpy.mockRestore()
})
afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(sandbox, { recursive: true, force: true })
})

describe('search service claim authority', () => {
  it('bakin install search explicitly authorizes transfer through the real search component', async () => {
    await run(['install', 'search', '--yes', '--json'])

    expect(searchInstalls).toHaveLength(1)
    expect(searchInstalls[0].allowServiceClaim).toBe(true)
  })

  it('the actual onboarding runner does not authorize takeover through approval or force flags', async () => {
    const result = await runOnboard({
      interactive: false,
      autoApprove: true,
      approvedComponents: ['search'],
      force: true,
      json: false,
      checkOnly: false,
    })

    expect(result.outcomes.find((outcome) => outcome.name === 'search')?.finalStatus).toBe('ok')
    expect(searchInstalls).toHaveLength(1)
    expect(searchInstalls[0].autoApprove).toBe(true)
    expect(searchInstalls[0].allowServiceClaim).not.toBe(true)
  })

  it('bakin install search-models does not receive service transfer authority', async () => {
    await run(['install', 'search-models', '--yes', '--json'])

    expect(modelInstalls).toHaveLength(1)
    expect(modelInstalls[0].allowServiceClaim).not.toBe(true)
    expect(searchInstalls).toEqual([])
  })
})
