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
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-cli-plugin-assets-${Date.now()}`)

vi.mock('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))
vi.mock('@/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

describe('CLI: bakin install/check plugin-assets', () => {
  it('cli/bakin.ts dispatches install plugin-assets to the onboarding component', () => {
    const cli = readFileSync(join(process.cwd(), 'cli', 'bakin.ts'), 'utf-8')
    expect(cli).toMatch(/sub === 'plugin-assets'/)
    expect(cli).toMatch(/'plugin-assets':\s*async\s*\(\)\s*=>\s*\(await import\('\.\.\/src\/core\/onboarding\/plugin-assets'\)\)\.pluginAssetsComponent/)
  })

  it('the onboarding component exposes the OnboardingComponent shape', async () => {
    const { pluginAssetsComponent } = await import('@/core/onboarding/plugin-assets')
    expect(pluginAssetsComponent.name).toBe('plugin-assets')
    expect(typeof pluginAssetsComponent.check).toBe('function')
    expect(typeof pluginAssetsComponent.install).toBe('function')
  })

  it('check() returns ok with "0 plugin assets" when nothing ships S-B skills', async () => {
    const { pluginAssetsComponent } = await import('@/core/onboarding/plugin-assets')
    const result = await pluginAssetsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toMatch(/0 plugin assets/i)
  })

  it('install() returns noop when nothing needs installing', async () => {
    const { pluginAssetsComponent } = await import('@/core/onboarding/plugin-assets')
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

  it('help output advertises both new commands', () => {
    const cli = readFileSync(join(process.cwd(), 'cli', 'bakin.ts'), 'utf-8')
    expect(cli).toMatch(/install plugin-assets\s+Install plugin-shipped OpenClaw skills/)
    expect(cli).toMatch(/check plugin-assets\s+Detect plugin-shipped OpenClaw skills/)
  })
})
