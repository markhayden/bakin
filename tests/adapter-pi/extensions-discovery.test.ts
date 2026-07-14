/**
 * Extension trust lane (pi-ecosystem WS4): discovery honesty and the ONE
 * trust engine's allow/revoke semantics.
 *
 * Trust identity is the resolved module PATH — names/basenames collide
 * across sources, and approving must name exactly one file. The pre-load
 * gate itself (unapproved code is NEVER imported) is pinned live against the
 * real SDK loader in tests/integration/pi/extensions.test.ts.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-ext-lane-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.PI_HOME = pathJoin(testDir, 'pi')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
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

// Bakin settings: in-memory, delta-merged the way updateSettings behaves on
// disk (so a write that clobbered runtime.adapter would show up here).
let settingsFile: Record<string, unknown> = { runtime: { adapter: 'pi', settings: {} } }
const settingsFake = () => ({
  getSettings: () => settingsFile as { runtime: { adapter: string; settings: Record<string, unknown> } },
  updateSettings: (partial: Record<string, unknown>) => {
    const merge = (base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
      const out = { ...base }
      for (const [k, v] of Object.entries(patch)) {
        const cur = out[k]
        out[k] = cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v)
          ? merge(cur as Record<string, unknown>, v as Record<string, unknown>)
          : v
      }
      return out
    }
    settingsFile = merge(settingsFile, partial)
  },
  resetSettingsCache: () => {},
})
mock.module('../../packages/core/src/settings', settingsFake)
mock.module('../../src/core/settings', settingsFake)
mock.module('@/core/settings', settingsFake)

import { createExtensionsSurface } from '../../packages/adapter-pi/src/extensions'
import { resetPiHome } from '../../packages/adapter-pi/src/home'

const extDir = () => join(testDir, 'pi', 'agent', 'extensions')
const policy = () => (settingsFile.runtime as { settings: Record<string, unknown> }).settings.piExtensions as
  | { mode?: string; allow?: Array<{ path: string; sha256: string }> }
  | undefined
const setPolicy = (p: { mode?: string; allow?: Array<{ path: string; sha256: string }> } | undefined) => {
  ;(settingsFile.runtime as { settings: Record<string, unknown> }).settings = p ? { piExtensions: p } : {}
}
const runtimeSettings = () => (settingsFile.runtime as { settings: Record<string, unknown> }).settings

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(extDir(), { recursive: true })
  mkdirSync(join(testDir, 'pi', 'agent', 'workspace'), { recursive: true })
  resetPiHome()
  settingsFile = { runtime: { adapter: 'pi', settings: {} } }
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function seedExtension(name: string, body = 'export default () => {}'): string {
  const path = join(extDir(), `${name}.ts`)
  writeFileSync(path, body)
  return realpathSync(path) // discovery reports real paths (symlinks resolved)
}
const hashOf = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
const entry = (p: string) => ({ path: p, sha256: hashOf(p) })

const surface = () => createExtensionsSurface(() => runtimeSettings())

describe('discovery', () => {
  it('identifies extensions by their absolute module path, pending under the allowlist default', async () => {
    const weather = seedExtension('weather-tool')
    const list = await surface().list()
    const row = list.find((e) => e.path === weather)!
    expect(row).toBeTruthy()
    expect(row.id).toBe(weather) // identity IS the path — never a basename
    expect(row.status).toBe('pending') // default allowlist-empty
  })

  it('two extensions sharing a basename stay independently trustable', async () => {
    const a = seedExtension('utils')
    mkdirSync(join(extDir(), 'nested'), { recursive: true })
    writeFileSync(join(extDir(), 'nested', 'utils.ts'), 'export default () => {}')
    const b = realpathSync(join(extDir(), 'nested', 'utils.ts'))

    setPolicy({ mode: 'allowlist', allow: [entry(a)] })
    const list = await surface().list()
    expect(list.find((e) => e.path === a)!.status).toBe('allowed')
    const nested = list.find((e) => e.path === b)
    // Discovery may or may not surface a nested file depending on loader
    // rules — what MUST hold is that approving `a` never trusts `b`.
    if (nested) expect(nested.status).toBe('pending')
  })

  it('a content change after approval reverts the file to pending (not silently trusted)', async () => {
    const p = seedExtension('mutable', 'export default () => { /* v1 */ }')
    setPolicy({ mode: 'allowlist', allow: [entry(p)] })
    expect((await surface().list()).find((e) => e.path === p)!.status).toBe('allowed')
    // Swap the bytes — the stored hash no longer matches.
    writeFileSync(p, 'export default () => { /* EVIL v2 */ }')
    expect((await surface().list()).find((e) => e.path === p)!.status).toBe('pending')
  })

  it('status follows the policy mode exactly', async () => {
    const p = seedExtension('weather-tool')

    setPolicy({ mode: 'none' })
    expect((await surface().list()).find((e) => e.path === p)!.status).toBe('blocked')

    setPolicy({ mode: 'all' })
    expect((await surface().list()).find((e) => e.path === p)!.status).toBe('allowed')

    setPolicy({ mode: 'allowlist', allow: [entry(p)] })
    expect((await surface().list()).find((e) => e.path === p)!.status).toBe('allowed')
  })
})

describe('trust engine (ONE mutation path)', () => {
  async function engine() {
    ;(globalThis as Record<string, unknown>).__bakinAppServices = { runtime: { extensions: surface() } }
    return import('../../src/core/runtime-extensions')
  }

  it('allow persists the PATH and never clobbers other settings', async () => {
    const p = seedExtension('weather-tool')
    const { allowRuntimeExtension } = await engine()
    const report = await allowRuntimeExtension(p)

    expect(policy()!.allow).toEqual([entry(p)])
    expect(report.extensions.find((e) => e.path === p)!.status).toBe('allowed')
    // The write is a DELTA — the adapter (and any other setting) survives.
    expect((settingsFile.runtime as { adapter: string }).adapter).toBe('pi')
  })

  it('allow refuses anything discovery does not know — never a free-text pattern', async () => {
    seedExtension('weather-tool')
    const { allowRuntimeExtension } = await engine()
    await expect(allowRuntimeExtension('weather-tool')).rejects.toThrow(/Unknown extension/) // bare name is NOT an id
    await expect(allowRuntimeExtension('/etc/passwd')).rejects.toThrow(/Unknown extension/)
  })

  it('revoke removes the path; revoking a non-entry is a typed error', async () => {
    const p = seedExtension('weather-tool')
    const { allowRuntimeExtension, revokeRuntimeExtension } = await engine()
    await allowRuntimeExtension(p)
    const report = await revokeRuntimeExtension(p)
    expect(report.extensions.find((e) => e.path === p)!.status).toBe('pending')
    expect(policy()!.allow).toEqual([])
    await expect(revokeRuntimeExtension(p)).rejects.toThrow(/not in the allowlist/)
  })

  it("mode 'all' is honest: allow/revoke refuse rather than pretend the allowlist gates anything", async () => {
    const p = seedExtension('weather-tool')
    setPolicy({ mode: 'all' })
    const { allowRuntimeExtension, revokeRuntimeExtension } = await engine()
    await expect(allowRuntimeExtension(p)).rejects.toThrow(/policy is "all"/)
    await expect(revokeRuntimeExtension(p)).rejects.toThrow(/policy is "all"/)
  })

  it('reports supported: false honestly when the runtime omits the surface', async () => {
    ;(globalThis as Record<string, unknown>).__bakinAppServices = { runtime: {} }
    const { listRuntimeExtensions, allowRuntimeExtension } = await import('../../src/core/runtime-extensions')
    const report = await listRuntimeExtensions()
    expect(report.supported).toBe(false)
    await expect(allowRuntimeExtension('x')).rejects.toThrow(/no extension mechanism/)
  })
})
