/**
 * Smoke test for `bakin install plugin-assets` and `bakin check plugin-assets`.
 *
 * The CLI dispatch lives in cli/bakin.ts and is opaque to import-time
 * testing (it runs `main()` at module load). Instead we exercise the
 * underlying onboarding component the dispatcher resolves to — that's
 * the contract the CLI commits to.
 *
 * The plugin-assets implementation has its own deep tests
 * (tests/core/onboarding/plugin-assets.test.ts). Here we assert:
 *   - The CLI source actually maps `plugin-assets` for both install and check.
 *   - The component exposes the OnboardingComponent shape the dispatcher expects.
 *   - `check()` returns ok with "0 plugin assets" when nothing ships S-B skills.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { installFilesystemRuntimeAppServices } from '../helpers/runtime-app-services'

const testDir = join(tmpdir(), `bakin-test-cli-plugin-assets-${Date.now()}`)
const openClawDir = join(testDir, 'openclaw')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
// Isolate plugin discovery from the live core-plugin set: this smoke test
// asserts the "nothing ships" branch, which must not depend on whether a
// core plugin (e.g. images) happens to ship defaults/runtime-skills/.
mock.module('../../bakin.config', () => ({ default: { plugins: [] } }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

describe('CLI: bakin install/check plugin-assets', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    mkdirSync(openClawDir, { recursive: true })
    installFilesystemRuntimeAppServices({ openClawDir })
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('cli/bakin.ts dispatches install plugin-assets to the onboarding component', () => {
    const cli = readFileSync(join(process.cwd(), 'cli', 'bakin.ts'), 'utf-8')
    expect(cli).toMatch(/sub === 'plugin-assets'/)
    expect(cli).toMatch(/'plugin-assets':\s*async\s*\(\)\s*=>\s*\(await import\('\.\.\/src\/core\/onboarding\/plugin-assets'\)\)\.pluginAssetsComponent/)
  })

  it('the onboarding component exposes the OnboardingComponent shape', async () => {
    const { pluginAssetsComponent } = require('@/core/onboarding/plugin-assets') as typeof import('@/core/onboarding/plugin-assets')
    expect(pluginAssetsComponent.name).toBe('plugin-assets')
    expect(typeof pluginAssetsComponent.check).toBe('function')
    expect(typeof pluginAssetsComponent.install).toBe('function')
  })

  it('check() returns ok with "0 plugin assets" when nothing ships S-B skills', async () => {
    const { pluginAssetsComponent } = require('@/core/onboarding/plugin-assets') as typeof import('@/core/onboarding/plugin-assets')
    const result = await pluginAssetsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toMatch(/0 plugin assets/i)
  })

  it('install() returns noop when nothing needs installing', async () => {
    const { pluginAssetsComponent } = require('@/core/onboarding/plugin-assets') as typeof import('@/core/onboarding/plugin-assets')
    const result = await pluginAssetsComponent.install({
      interactive: false,
      autoApprove: true,
      json: false,
      checkOnly: false,
      force: false,
    })
    expect(result.status).toBe('noop')
    expect(result.message).toMatch(/0 plugin assets/i)
  })

  it('help output advertises both new commands', async () => {
    const { renderCliUsage } = await import('../../src/core/cli/registry')
    const usage = renderCliUsage({ bakinUrl: 'http://localhost:3737' })
    expect(usage).toMatch(/bakin install [^\n]*plugin-assets/)
    expect(usage).toMatch(/bakin check [^\n]*plugin-assets/)
  })
})
