/**
 * Focused unit tests for the security-critical install phases that the
 * 2026-06 audit flagged as buried mid-function and untestable:
 *
 * 1. Consent-token manifestSha binding (C13) — `evaluateConsentGate`:
 *    a valid token over the staged manifest sha proceeds; a token bound
 *    to a DIFFERENT manifest sha bounces back to awaitingConsent with a
 *    fresh token; forged/missing tokens are rejected with 400.
 * 2. Core-plugin-id squatting rejection — `coreIdSquattingError`.
 * 3. FW1.7 dist-deletion before non-artifact builds — `buildSourceInstall`
 *    removes any shipped dist/ BEFORE invoking the builder.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-install-security-${Date.now()}-${randomUUID()}`)

// ES imports are hoisted above mock.module — set env so any module-load
// content-dir reads resolve into the temp dir.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
// Only core-registry surface the squatting check touches.
mock.module('../../src/core/plugin-registry', () => ({
  isCorePlugin: (id: string) => id === 'tasks' || id === 'schedule',
}))
// Pin the host to a dev build: the range-gate tests below assert dev-host
// skip semantics, which release CI would otherwise break — stamp-version
// runs before `bun test` there, so APP_VERSION is a real rc version.
mock.module('../../packages/core/src/generated-version', () => ({
  APP_VERSION: '0.0.0-dev',
}))
// Record whether dist/ still exists at the moment the builder runs.
// (Object property, not a bare `let` — TS would narrow a module-level
// binding to `undefined` across the awaited call below.)
const buildProbe: { distExistedAtBuildTime: boolean | undefined; calls: number } = {
  distExistedAtBuildTime: undefined,
  calls: 0,
}
function resetBuildProbe(): void {
  buildProbe.distExistedAtBuildTime = undefined
  buildProbe.calls = 0
}
mock.module('../../packages/host/src/plugin-host/user-plugin-builder', () => ({
  buildUserPlugin: async (dir: string) => {
    buildProbe.calls += 1
    buildProbe.distExistedAtBuildTime = existsSync(join(dir, 'dist'))
    return { id: 'stub', builtServer: true, builtClient: false }
  },
}))

import { evaluateConsentGate, consentSourceIdentity } from '../../packages/host/src/api/plugins/install/consent-gate'
import { coreIdSquattingError, validateStagedManifest } from '../../packages/host/src/api/plugins/install/validate-manifest'
import { buildSourceInstall } from '../../packages/host/src/api/plugins/install/commit'
import { signConsentToken } from '../../src/core/plugins/consent-token'
import type { InstallBody } from '../../packages/host/src/api/plugins/install/body'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function gateArgs(overrides: {
  body?: Partial<InstallBody>
  stagedManifestSha?: string
  permissions?: string[]
}): Parameters<typeof evaluateConsentGate>[0] {
  const body: InstallBody = {
    source: 'github:user/repo',
    type: 'github',
    ...overrides.body,
  }
  return {
    body,
    requestedRef: '',
    id: 'hello',
    manifest: { id: 'hello', version: '1.2.3' },
    parsedPermissions: (overrides.permissions ?? ['exec-tools']) as never,
    stagedManifestSha: overrides.stagedManifestSha ?? SHA_A,
  }
}

describe('evaluateConsentGate — consent-token manifestSha binding (C13)', () => {
  it('returns awaitingConsent with a bound token at preflight (accepted not set)', async () => {
    const res = evaluateConsentGate(gateArgs({}))
    expect(res).not.toBeNull()
    const json = await res!.json()
    expect(json.awaitingConsent).toBe(true)
    expect(json.id).toBe('hello')
    expect(json.version).toBe('1.2.3')
    expect(typeof json.consentToken).toBe('string')
  })

  it('proceeds (null) when the token sha matches the staged manifest sha', () => {
    const token = signConsentToken({
      source: consentSourceIdentity('github:user/repo', ''),
      manifestSha: SHA_A,
      permissions: ['exec-tools'],
    })
    const res = evaluateConsentGate(gateArgs({
      body: { accepted: true, consentToken: token },
      stagedManifestSha: SHA_A,
    }))
    expect(res).toBeNull()
  })

  it('bounces to awaitingConsent + manifestChanged when the manifest changed since preflight', async () => {
    const token = signConsentToken({
      source: consentSourceIdentity('github:user/repo', ''),
      manifestSha: SHA_A,
      permissions: ['exec-tools'],
    })
    const res = evaluateConsentGate(gateArgs({
      body: { accepted: true, consentToken: token },
      stagedManifestSha: SHA_B,
    }))
    expect(res).not.toBeNull()
    const json = await res!.json()
    expect(json.ok).toBe(false)
    expect(json.awaitingConsent).toBe(true)
    expect(json.manifestChanged).toBe(true)
    // Fresh token is re-bound to the NEW manifest sha so the user can
    // re-consent to what is actually staged now.
    expect(typeof json.consentToken).toBe('string')
    expect(json.consentToken).not.toBe(token)
  })

  it('rejects a commit without a consentToken (400)', async () => {
    const res = evaluateConsentGate(gateArgs({ body: { accepted: true } }))
    expect(res!.status).toBe(400)
    const json = await res!.json()
    expect(json.error).toContain('consentToken')
  })

  it('rejects a forged/garbage token (400)', async () => {
    const res = evaluateConsentGate(gateArgs({
      body: { accepted: true, consentToken: 'bm9wZQ==.' + 'f'.repeat(64) },
    }))
    expect(res!.status).toBe(400)
    const json = await res!.json()
    expect(json.error).toContain('invalid or expired')
  })

  it('rejects a token bound to a different source (400)', async () => {
    const token = signConsentToken({
      source: consentSourceIdentity('github:evil/other', ''),
      manifestSha: SHA_A,
      permissions: ['exec-tools'],
    })
    const res = evaluateConsentGate(gateArgs({
      body: { accepted: true, consentToken: token },
    }))
    expect(res!.status).toBe(400)
    const json = await res!.json()
    expect(json.error).toContain('source does not match')
  })

  it('proceeds without any token when the manifest declares no permissions', () => {
    const res = evaluateConsentGate(gateArgs({ permissions: [] }))
    expect(res).toBeNull()
  })
})

describe('coreIdSquattingError — core-plugin-id squatting rejection', () => {
  it('rejects a user plugin claiming a core plugin id', () => {
    const err = coreIdSquattingError('tasks', undefined)
    expect(err).toContain('collides with a core plugin')
  })

  it('rejects when overrideCore is explicitly false', () => {
    expect(coreIdSquattingError('schedule', false)).toContain('collides with a core plugin')
  })

  it('allows a core id only with the explicit overrideCore opt-in', () => {
    expect(coreIdSquattingError('tasks', true)).toBeNull()
  })

  it('allows non-core ids without any opt-in', () => {
    expect(coreIdSquattingError('my-plugin', undefined)).toBeNull()
  })
})

describe('buildSourceInstall — FW1.7 dist deleted before non-artifact builds', () => {
  it('removes a shipped dist/ BEFORE invoking the builder', async () => {
    const targetDir = join(testDir, 'plugins', 'shipped-dist')
    mkdirSync(join(targetDir, 'dist'), { recursive: true })
    writeFileSync(join(targetDir, 'dist', 'index.js'), '// attacker-supplied prebuilt bundle\n')
    writeFileSync(join(targetDir, 'index.ts'), 'export default { id: "shipped-dist", activate() {} }\n')

    resetBuildProbe()
    await buildSourceInstall(targetDir)

    expect(buildProbe.calls).toBe(1)
    expect(buildProbe.distExistedAtBuildTime).toBe(false)
  })

  it('still builds when no dist/ was shipped', async () => {
    const targetDir = join(testDir, 'plugins', 'no-dist')
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'index.ts'), 'export default { id: "no-dist", activate() {} }\n')

    resetBuildProbe()
    await buildSourceInstall(targetDir)

    expect(buildProbe.calls).toBe(1)
    expect(buildProbe.distExistedAtBuildTime).toBe(false)
  })
})

describe('validateStagedManifest — bakin range gate (T15/R13)', () => {
  function stageManifest(name: string, bakin: string): { stagingDir: string; body: { source: string; type: 'local' } } {
    const stagingDir = join(testDir, 'staging', name)
    mkdirSync(stagingDir, { recursive: true })
    writeFileSync(join(stagingDir, 'bakin-plugin.json'), JSON.stringify({
      id: name,
      name,
      version: '1.0.0',
      bakin,
      description: 'range-gate fixture',
    }))
    return { stagingDir, body: { source: `./${name}`, type: 'local' } }
  }

  it('rejects a malformed range with an actionable 400 and tears down staging', async () => {
    const { stagingDir, body } = stageManifest('bad-range', 'banana')
    const result = validateStagedManifest(body as never, stagingDir, stagingDir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      const json = await result.response.json()
      expect(json.error).toContain('banana')
      expect(json.error).toContain('not a valid semver range')
    }
    expect(existsSync(stagingDir)).toBe(false)
  })

  it('accepts a release-floor range on a dev host (0.0.0-dev skips satisfaction)', () => {
    // APP_VERSION is pinned to 0.0.0-dev by the module mock above — a
    // well-formed range no real host could satisfy must pass (dev-host skip).
    const { stagingDir, body } = stageManifest('future-range', '>=999.0.0')
    const result = validateStagedManifest(body as never, stagingDir, stagingDir)
    expect(result.ok).toBe(true)
  })

  it('accepts the scaffold dev-floor range', () => {
    const { stagingDir, body } = stageManifest('dev-floor', '>=0.0.0-dev')
    const result = validateStagedManifest(body as never, stagingDir, stagingDir)
    expect(result.ok).toBe(true)
  })
})
