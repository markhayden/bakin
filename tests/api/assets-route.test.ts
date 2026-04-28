import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-api-assets-route-${Date.now()}`)
const originalBakinHome = process.env.BAKIN_HOME
process.env.BAKIN_HOME = testDir
let resolvedAssetPath: string | null = null

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

mock.module('@/lib/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: async () => resolvedAssetPath,
  }),
}))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

let getRoute: typeof import('../../packages/host/src/api/assets/[...path]').get

beforeAll(async () => {
  const mod = await import('../../packages/host/src/api/assets/[...path]')
  getRoute = mod.get
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  resolvedAssetPath = null
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
  else process.env.BAKIN_HOME = originalBakinHome
})

describe('GET /api/assets/{filename}', () => {
  it('serves a file resolved from a canonical filename', async () => {
    const rel = 'assets/store/2026-04/20260420-note-a1b2c3d4.txt'
    resolvedAssetPath = rel
    mkdirSync(join(testDir, 'assets/store/2026-04'), { recursive: true })
    writeFileSync(join(testDir, rel), 'asset bytes')

    const url = new URL('http://localhost/api/assets/20260420-note-a1b2c3d4.txt')
    const res = await getRoute(new Request(url), url)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('asset bytes')
  })

  it('rejects multi-segment asset paths', async () => {
    const url = new URL('http://localhost/api/assets/assets/store/2026-04/file.png')
    const res = await getRoute(new Request(url), url)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid filename' })
  })

  it('returns 404 when the filename resolver has no match', async () => {
    const url = new URL('http://localhost/api/assets/20260420-missing-a1b2c3d4.png')
    const res = await getRoute(new Request(url), url)

    expect(res.status).toBe(404)
  })
})
