/**
 * Extension trust lane (pi-ecosystem WS4): inert discovery, policy status
 * honesty, and the ONE trust engine's allow/revoke semantics.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-ext-lane-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.PI_HOME = pathJoin(testDir, 'pi')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// The trust engine reads/writes Bakin settings — fake BOTH module paths
// (packages/core + the src facade) with a complete-enough surface.
let runtimeSettings: Record<string, unknown> = {}
const settingsFake = () => ({
  getSettings: () => ({ runtime: { adapter: 'pi', settings: runtimeSettings } }),
  updateSettings: (partial: { runtime?: { settings?: Record<string, unknown> } }) => {
    runtimeSettings = partial.runtime?.settings ?? runtimeSettings
  },
  resetSettingsCache: () => {},
})
mock.module('../../packages/core/src/settings', settingsFake)
mock.module('../../src/core/settings', settingsFake)
mock.module('@/core/settings', settingsFake)

import { createExtensionsSurface } from '../../packages/adapter-pi/src/extensions'
import { resetPiHome } from '../../packages/adapter-pi/src/home'

const extDir = () => join(testDir, 'pi', 'agent', 'extensions')

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(extDir(), { recursive: true })
  resetPiHome()
  runtimeSettings = {}
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function seedExtensions(): void {
  writeFileSync(join(extDir(), 'weather-tool.ts'), 'export default () => {}')
  mkdirSync(join(extDir(), 'mcp-bridge'), { recursive: true })
  writeFileSync(join(extDir(), 'mcp-bridge', 'index.ts'), 'export default () => {}')
  writeFileSync(join(extDir(), 'notes.d.ts'), '// types only — never an extension')
  mkdirSync(join(testDir, 'pi', 'agent'), { recursive: true })
  writeFileSync(join(testDir, 'pi', 'agent', 'settings.json'), JSON.stringify({ packages: ['npm:@ssweens/pi-image-gen'] }))
}

describe('adapter discovery (inert)', () => {
  it('enumerates dir entries + npm packages with allowlist-default pending status', async () => {
    seedExtensions()
    const surface = createExtensionsSurface(() => runtimeSettings)
    const list = await surface.list()
    expect(list.map((e) => e.id).sort()).toEqual(['@ssweens/pi-image-gen', 'mcp-bridge', 'weather-tool'])
    expect(new Set(list.map((e) => e.status))).toEqual(new Set(['pending'])) // default allowlist-empty
  })

  it('statuses reflect the policy exactly as the loader applies it', async () => {
    seedExtensions()
    const surface = createExtensionsSurface(() => runtimeSettings)

    runtimeSettings = { piExtensions: { mode: 'allowlist', allow: ['weather-tool'] } }
    let list = await surface.list()
    expect(list.find((e) => e.id === 'weather-tool')!.status).toBe('allowed')
    expect(list.find((e) => e.id === 'mcp-bridge')!.status).toBe('pending')

    runtimeSettings = { piExtensions: { mode: 'none' } }
    list = await surface.list()
    expect(new Set(list.map((e) => e.status))).toEqual(new Set(['blocked']))

    runtimeSettings = { piExtensions: { mode: 'all' } }
    list = await surface.list()
    expect(new Set(list.map((e) => e.status))).toEqual(new Set(['allowed']))
  })

  it('an exact-basename allow entry never over-matches a sibling prefix', async () => {
    writeFileSync(join(extDir(), 'foo.ts'), '')
    writeFileSync(join(extDir(), 'foobar.ts'), '')
    runtimeSettings = { piExtensions: { mode: 'allowlist', allow: ['foo'] } }
    const surface = createExtensionsSurface(() => runtimeSettings)
    const list = await surface.list()
    expect(list.find((e) => e.id === 'foo')!.status).toBe('allowed')
    expect(list.find((e) => e.id === 'foobar')!.status).toBe('pending')
  })
})

describe('trust engine (ONE mutation path)', () => {
  async function engine() {
    const surface = createExtensionsSurface(() => runtimeSettings)
    ;(globalThis as Record<string, unknown>).__bakinAppServices = { runtime: { extensions: surface } }
    return import('../../src/core/runtime-extensions')
  }

  it('allow persists the exact id and the extension flips to allowed', async () => {
    seedExtensions()
    const { allowRuntimeExtension } = await engine()
    const report = await allowRuntimeExtension('weather-tool')
    expect((runtimeSettings.piExtensions as { allow: string[] }).allow).toEqual(['weather-tool'])
    expect(report.extensions.find((e) => e.id === 'weather-tool')!.status).toBe('allowed')
  })

  it('allow refuses ids discovery does not know — never free-text patterns', async () => {
    seedExtensions()
    const { allowRuntimeExtension } = await engine()
    await expect(allowRuntimeExtension('totally-made-up')).rejects.toThrow(/Unknown extension/)
  })

  it('revoke removes the entry; revoking a non-entry is a typed error', async () => {
    seedExtensions()
    const { allowRuntimeExtension, revokeRuntimeExtension } = await engine()
    await allowRuntimeExtension('weather-tool')
    const report = await revokeRuntimeExtension('weather-tool')
    expect(report.extensions.find((e) => e.id === 'weather-tool')!.status).toBe('pending')
    await expect(revokeRuntimeExtension('weather-tool')).rejects.toThrow(/not in the allowlist/)
  })

  it('reports supported: false honestly when the runtime omits the surface', async () => {
    ;(globalThis as Record<string, unknown>).__bakinAppServices = { runtime: {} }
    const { listRuntimeExtensions, allowRuntimeExtension } = await import('../../src/core/runtime-extensions')
    const report = await listRuntimeExtensions()
    expect(report.supported).toBe(false)
    await expect(allowRuntimeExtension('x')).rejects.toThrow(/no extension mechanism/)
  })
})
