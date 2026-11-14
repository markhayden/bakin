/**
 * Spec provider-integrations §4.1 (plan 1.1): a pack manifest's `bakin`
 * range is ENFORCED at install/upgrade — before this it was parsed and
 * ignored ("cosmetic"), so an older host could accept a manifest whose
 * requirements it cannot read (e.g. `requires.login`) and report ready.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-bakin-range-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { assertBakinRangeCompatible } from '../../src/core/agent-packages/bakin-range-gate'
import { SkillRefusalError } from '../../src/core/agent-packages/errors'
import type { Manifest } from '../../packages/core/src/agent-packages/manifest'

function pack(bakin?: string): Manifest {
  return {
    id: 'google-workspace',
    kind: 'skill-pack',
    name: 'Google Workspace',
    version: '2.0.0',
    ...(bakin !== undefined ? { bakin } : {}),
  } as Manifest
}

function auditLines(): Array<Record<string, unknown>> {
  const path = join(testDir, 'audit.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}

beforeAll(() => mkdirSync(testDir, { recursive: true }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('assertBakinRangeCompatible', () => {
  it('accepts a manifest with no bakin range', () => {
    expect(() => assertBakinRangeCompatible(pack(), '0.1.0-rc.9')).not.toThrow()
  })

  it('accepts a range the stamped host satisfies, including an rc floor of the same base', () => {
    expect(() => assertBakinRangeCompatible(pack('>=0.0.1'), '0.1.0-rc.9')).not.toThrow()
    expect(() => assertBakinRangeCompatible(pack('>=0.1.0-rc.9'), '0.1.0-rc.9')).not.toThrow()
    expect(() => assertBakinRangeCompatible(pack('>=0.1.0-rc.9'), '0.1.0-rc.12')).not.toThrow()
  })

  it('refuses a host older than the rc floor, naming both versions', () => {
    let caught: unknown
    try {
      assertBakinRangeCompatible(pack('>=0.1.0-rc.9'), '0.1.0-rc.8')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SkillRefusalError)
    const refusal = caught as SkillRefusalError
    expect(refusal.reason).toBe('bakin-range')
    expect(refusal.message).toContain('>=0.1.0-rc.9')
    expect(refusal.message).toContain('0.1.0-rc.8')
    expect(refusal.message).toContain('google-workspace')
  })

  it('refuses the legacy ^1.0.0 placeholder on a 0.x host', () => {
    expect(() => assertBakinRangeCompatible(pack('^1.0.0'), '0.1.0-rc.9')).toThrow(SkillRefusalError)
  })

  it('skips satisfaction on the unstamped dev host but still rejects a malformed range', () => {
    expect(() => assertBakinRangeCompatible(pack('>=9.0.0'), '0.0.0-dev')).not.toThrow()
    expect(() => assertBakinRangeCompatible(pack('banana'), '0.0.0-dev')).toThrow(SkillRefusalError)
  })

  it('audits every refusal as pkg.install_refused with reason bakin-range', () => {
    const before = auditLines().length
    expect(() => assertBakinRangeCompatible(pack('>=0.1.0-rc.9'), '0.1.0-rc.8')).toThrow()
    const events = auditLines().slice(before)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'pkg.install_refused',
      data: { packageId: 'google-workspace', reason: 'bakin-range', range: '>=0.1.0-rc.9', hostVersion: '0.1.0-rc.8' },
    })
  })
})
