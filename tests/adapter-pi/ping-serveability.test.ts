/**
 * T29 — Pi ping() is a real serveability probe, not `initialized === true`.
 * Contract: "can serve a turn, cheaply probed; resolves false, never throws".
 * Pi's recipe: initialized AND ≥1 LLM credential in auth.json. The
 * credential half lives here (PI_HOME is process-global, so the
 * runtime-conformance runner can't vary it mid-file — it pins the
 * uninitialized case instead).
 */
import { describe, test, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-pi-ping-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPiRuntimeAdapter } from '../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../packages/adapter-pi/src/home'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('pi ping serveability (T29)', () => {
  test('uninitialized adapter pings false', async () => {
    resetPiHome()
    const adapter = createPiRuntimeAdapter()
    expect(await adapter.ping()).toBe(false)
  })

  test('initialized but NO credentials pings false; adding a credential flips it true', async () => {
    resetPiHome()
    const agentDir = join(testDir, 'pi', 'agent')
    mkdirSync(agentDir, { recursive: true })
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: join(testDir, 'bakin') })

    // No auth.json → cannot serve any turn → false (the old probe said true here).
    expect(await adapter.ping()).toBe(false)

    writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({
      fakeai: { type: 'api_key', key: 'k' },
    }))
    expect(await adapter.ping()).toBe(true)
  })

  test('unreadable auth.json resolves false — never throws', async () => {
    resetPiHome()
    const agentDir = join(testDir, 'pi', 'agent')
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'auth.json'), '{not json')
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: join(testDir, 'bakin') })
    expect(await adapter.ping()).toBe(false)
  })
})
