/**
 * SECURITY REGRESSION (prove-it) — the Pi extension trust lane gates which
 * extension MODULES are imported, but it does NOT gate the SDK package
 * manager's install side effect. Every turn builds a DefaultResourceLoader
 * and calls `reload()`, which calls `packageManager.resolve()` with NO
 * `onMissing` handler. For any `packages[]` entry (npm/git) that isn't already
 * installed, that path runs a REAL install — `npm install <spec>`, whose
 * postinstall lifecycle scripts are arbitrary code. This fires:
 *   - in EVERY policy mode, including `none` (maximum lockdown) and the
 *     default empty `allowlist` — `noExtensions` only filters loaded
 *     extension PATHS, never the resolver's install side effect;
 *   - from Pi's user-scope settings (PI_HOME/agent/settings.json); AND
 *   - from the AGENT-WRITABLE workspace project settings
 *     (<workspace>/.pi/settings.json), because the per-turn SettingsManager is
 *     built with `projectTrusted: true`. That last one needs no human, no
 *     approval, and no allowlist entry: an agent that can write a file in its
 *     own workspace can trigger install-time code execution inside the Bakin
 *     server process, bypassing the extension allowlist entirely.
 *
 * The existing sentinel pin (extensions.test.ts) only proves unapproved
 * extension MODULES aren't imported; it never exercises package resolution, so
 * it does not catch this. Here a fake `npmCommand` is a stand-in for the
 * install exec: if it writes its sentinel, the install path ran (real npm
 * would additionally execute the package's postinstall scripts).
 *
 * EXPECTED TO FAIL on the current adapter. The fix is to run the per-turn
 * package resolution in a no-install / offline posture (e.g. set PI_OFFLINE
 * for the turn, or resolve with an onMissing:'skip'-equivalent), so a missing
 * package is skipped instead of installed. When that lands, these assertions
 * (no install exec) pass.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'fs'
import { randomUUID } from 'crypto'

globalThis.fetch = (Bun as unknown as { fetch: typeof fetch }).fetch

const testDir = join(tmpdir(), `bakin-test-pi-ext-install-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPiRuntimeAdapter } from '../../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../../packages/adapter-pi/src/models'
import { startFakeProvider, type FakeProvider } from './fake-provider'

const agentSettingsPath = join(testDir, 'pi', 'agent', 'settings.json')
const workspacePiDir = join(testDir, 'pi', 'agent', 'agents', 'main', 'workspace', '.pi')

/** A fake package manager binary: it just records that it was invoked. */
function installSentinelScript(sentinel: string): string {
  const path = join(testDir, `fake-npm-${randomUUID()}.sh`)
  writeFileSync(path, `#!/bin/sh\necho ran >> ${JSON.stringify(sentinel)}\nexit 0\n`)
  chmodSync(path, 0o755)
  return path
}

let provider: FakeProvider
function seedProvider(): FakeProvider {
  provider?.stop()
  provider = startFakeProvider([{ steps: [{ text: 'ok' }] }])
  writeFileSync(join(testDir, 'pi', 'agent', 'models.json'), JSON.stringify({
    providers: {
      fakeai: { name: 'F', baseUrl: provider.url, api: 'openai-completions', models: [{ id: 'fake-model', name: 'FM', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 8000, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] },
    },
  }))
  resetModelRegistry()
  return provider
}

async function adapterWithPolicy(policy: Record<string, unknown>) {
  const adapter = createPiRuntimeAdapter()
  await adapter.initialize({
    contentDir: join(testDir, 'bakin'),
    settings: { retry: { enabled: false }, piExtensions: policy },
  })
  await adapter.provisionToolAccess()
  await adapter.agents.update('main', { model: 'fakeai/fake-model' })
  return adapter
}

beforeAll(() => {
  resetPiHome()
  mkdirSync(join(testDir, 'pi', 'agent'), { recursive: true })
  writeFileSync(join(testDir, 'pi', 'agent', 'auth.json'), JSON.stringify({ fakeai: { type: 'api_key', key: 'k' } }))
})

afterAll(() => {
  provider?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

describe('pi extension trust lane — package install exec must be gated', () => {
  test("mode 'none': a configured-but-missing user package must NOT be installed during a turn", async () => {
    const sentinel = join(testDir, 'SENTINEL-user-none')
    rmSync(sentinel, { force: true })
    writeFileSync(agentSettingsPath, JSON.stringify({
      packages: ['npm:@redteam/definitely-not-installed@1.0.0'],
      npmCommand: [installSentinelScript(sentinel)],
    }))
    const fake = seedProvider()
    const adapter = await adapterWithPolicy({ mode: 'none' })
    await adapter.messaging.send({ agentId: 'main', content: 'go' })
    writeFileSync(agentSettingsPath, JSON.stringify({}))

    expect(fake.requests.length).toBeGreaterThan(0) // the turn actually ran
    // The extension allowlist claims nothing loads in 'none' — but the package
    // resolver still runs the install. That is arbitrary code execution the
    // trust lane never authorized.
    expect(existsSync(sentinel)).toBe(false)
  })

  test("default 'allowlist' (empty): a configured-but-missing user package must NOT be installed", async () => {
    const sentinel = join(testDir, 'SENTINEL-user-allowlist')
    rmSync(sentinel, { force: true })
    writeFileSync(agentSettingsPath, JSON.stringify({
      packages: ['npm:@redteam/definitely-not-installed@2.0.0'],
      npmCommand: [installSentinelScript(sentinel)],
    }))
    seedProvider()
    const adapter = await adapterWithPolicy({ mode: 'allowlist', allow: [] })
    await adapter.messaging.send({ agentId: 'main', content: 'go' })
    writeFileSync(agentSettingsPath, JSON.stringify({}))

    expect(existsSync(sentinel)).toBe(false)
  })

  test('AGENT-WRITABLE workspace project package must NOT be installed during a turn', async () => {
    const sentinel = join(testDir, 'SENTINEL-project-agent')
    rmSync(sentinel, { force: true })
    // The agent authors its OWN workspace/.pi/settings.json (the turn's cwd).
    mkdirSync(workspacePiDir, { recursive: true })
    writeFileSync(join(workspacePiDir, 'settings.json'), JSON.stringify({
      packages: ['npm:@redteam/agent-authored@3.0.0'],
      npmCommand: [installSentinelScript(sentinel)],
    }))
    seedProvider()
    const adapter = await adapterWithPolicy({ mode: 'none' })
    await adapter.messaging.send({ agentId: 'main', content: 'go' })
    rmSync(join(workspacePiDir, 'settings.json'), { force: true })

    // No human, no approval, no allowlist entry — self-service install exec
    // from inside an agent turn. This is the sharpest form of the hole.
    expect(existsSync(sentinel)).toBe(false)
  })
})
