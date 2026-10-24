/**
 * Self-healing PR1 slice 1.2: the two sync routes expose their operation
 * inputs (`packageSyncOperation`, `agentSyncOperation`) the way the plugin
 * upgrade route does, so the updates apply service and the Health repair
 * actions start the SAME operation the routes start. Shape only — the
 * routes' behaviour is covered by package-operations.test.ts.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-pkg-sync-op-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

import { afterAll, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'

const paths = () => ({ home: testDir, db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') })
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths, isUsingBakinHome: () => true }))
mock.module('@bakin/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths, isUsingBakinHome: () => true }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...p: string[]) => join(testDir, 'openclaw', ...p), resetOpenClawHome: () => {} }))

import { packageSyncOperation } from '../../packages/host/src/api/packages/dynamic'
import { agentSyncOperation } from '../../packages/host/src/api/agent-packages/dynamic'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const SHA = 'a'.repeat(40)

describe('packageSyncOperation', () => {
  it('a writing sync owns install-state, a check holds nothing', () => {
    const sync = packageSyncOperation('ocr@0.1.0', {}, 'web')
    expect(sync).toMatchObject({ kind: 'sync', owner: 'core', origin: 'web', resources: ['install-state'] })
    expect(packageSyncOperation('ocr@0.1.0', { check: true }, 'cli').resources).toEqual([])
  })

  it('the pin and the reinstall flag are part of the identity — a pinned repair never attaches to an ordinary sync', () => {
    const plain = packageSyncOperation('ocr@0.1.0', {}, 'system').fingerprint
    const pinned = packageSyncOperation('ocr@0.1.0', { expected: { sha: SHA }, reinstall: true }, 'system').fingerprint
    expect(pinned).not.toBe(plain)
    expect(pinned).toContain(SHA)
    expect(packageSyncOperation('ocr@0.1.0', { reinstall: true }, 'system').fingerprint).not.toBe(plain)
  })
})

describe('agentSyncOperation', () => {
  it('mirrors the pack shape and keeps reclaim in the identity', () => {
    const sync = agentSyncOperation('pixel', {}, 'web')
    expect(sync).toMatchObject({ kind: 'sync', owner: 'core', resources: ['install-state'] })
    expect(sync.href).toBe('/team/pixel')
    expect(agentSyncOperation('pixel', { reclaim: 'all' }, 'web').fingerprint).not.toBe(sync.fingerprint)
    expect(agentSyncOperation('pixel', { expected: { sha: SHA } }, 'web').fingerprint).toContain(SHA)
  })
})
