/**
 * T8 (#687): the minimal ClawHub integration — verdict gate policy
 * (fail-closed, D5), per-file sha256 verification, path/size sanity caps,
 * ambiguous-slug surfacing, and the full install path over a mocked client.
 * No test touches the network.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-clawhub-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('../../packages/core/src/content-dir', () => ({
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
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ runtime: { adapter: 'pi' } }),
}))

const skillStore = new Map<string, { name: string; files?: Record<string, string> }>()
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      agents: { list: async () => [], get: async () => null },
      skills: {
        list: async () => Array.from(skillStore.values()),
        get: async (name: string) => skillStore.get(name) ?? null,
        write: async (skill: { name: string }) => {
          skillStore.set(skill.name, skill as { name: string; files?: Record<string, string> })
        },
        remove: async (name: string) => {
          skillStore.delete(name)
        },
      },
    },
  }),
  maybeGetAppServices: () => undefined,
}))

import {
  AmbiguousClawhubSlugError,
  type ClawhubClient,
  evaluateVerdict,
  sha256Hex,
} from '../../src/core/agent-packages/clawhub-client'
import { fetchClawhubWithClient } from '../../src/core/agent-packages/source-fetcher'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'skill-bundles')
const scanSuspicious = JSON.parse(readFileSync(join(FIXTURES, 'clawhub-api', 'scan-suspicious.json'), 'utf-8'))
const scanClean = JSON.parse(readFileSync(join(FIXTURES, 'clawhub-api', 'scan-clean.json'), 'utf-8'))

const SKILL_MD = '---\nname: weather\ndescription: get weather\nversion: 2.0.1\n---\n# Weather\nRun scripts/get.sh\n'
const SCRIPT = '#!/bin/sh\necho weather\n'

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function makeClient(overrides: Partial<ClawhubClient> = {}, fileMap: Record<string, string> = { 'SKILL.md': SKILL_MD, 'scripts/get.sh': SCRIPT }): ClawhubClient {
  const files = Object.entries(fileMap).map(([path, content]) => ({
    path,
    size: bytesOf(content).length,
    sha256: sha256Hex(bytesOf(content)),
  }))
  return {
    getDetail: async () => ({ skill: { slug: 'weather', tags: { latest: '2.0.1' } } }),
    resolveLatestVersion: async () => '2.0.1',
    getVersionDetail: async () => ({
      version: { version: '2.0.1', files, security: scanClean.security, license: 'MIT-0', changelog: null },
    }),
    getScan: async () => scanClean,
    getFileBytes: async (_slug, path) => bytesOf(fileMap[path] ?? ''),
    ...overrides,
  }
}

let seq = 0
function freshStaging(): string {
  return join(testDir, `staging-${seq++}`)
}

beforeEach(() => {
  skillStore.clear()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('evaluateVerdict — D5 gate policy', () => {
  it('refuses the real suspicious fixture (skillscan) on multiple grounds', () => {
    const verdict = evaluateVerdict(scanSuspicious, scanSuspicious.security)
    expect(verdict.state).toBe('refused')
    expect(verdict.refusals.join(' ')).toContain('suspicious')
    expect(verdict.refusals.join(' ')).toContain('DO_NOT_INSTALL')
  })

  it('clean fixture passes; unreachable is unverified; unknown status fails closed', () => {
    expect(evaluateVerdict(scanClean, scanClean.security).state).toBe('clean')
    expect(evaluateVerdict(null, null).state).toBe('unverified')
    const weird = { ...scanClean, security: { ...scanClean.security, status: 'trust-me-bro' } }
    const verdict = evaluateVerdict(weird, weird.security)
    expect(verdict.state).toBe('refused')
    expect(verdict.refusals.join(' ')).toContain('fail closed')
  })

  it('moderation flags refuse regardless of scanner status', () => {
    const flagged = { ...scanClean, moderation: { ...scanClean.moderation, isMalwareBlocked: true } }
    expect(evaluateVerdict(flagged, scanClean.security).state).toBe('refused')
  })
})

describe('fetchClawhubWithClient', () => {
  it('downloads per-file, verifies pins, synthesizes, and pins the resolved version', async () => {
    const fetched = await fetchClawhubWithClient('clawhub:@steipete/weather', makeClient(), freshStaging())
    expect(fetched.kind).toBe('clawhub')
    expect(fetched.ref).toBe('2.0.1')
    expect(fetched.synthesis?.skillName).toBe('weather')
    const manifest = JSON.parse(readFileSync(join(fetched.stagingDir, 'bakin-package.json'), 'utf-8'))
    expect(manifest.id).toBe('hub-weather')
    expect(manifest.upstream.source).toBe('clawhub:@steipete/weather')
    expect(readFileSync(join(fetched.stagingDir, 'skills', 'weather', 'scripts', 'get.sh'), 'utf-8')).toBe(SCRIPT)
    rmSync(fetched.stagingDir, { recursive: true, force: true })
  })

  it('REFUSES a hub-flagged skill with no override', async () => {
    const client = makeClient({ getScan: async () => scanSuspicious })
    const staging = freshStaging()
    await expect(fetchClawhubWithClient('clawhub:@x/weather', client, staging)).rejects.toThrow(/no override/i)
    expect(existsSync(staging)).toBe(false)
  })

  it('refuses on sha mismatch', async () => {
    const client = makeClient({ getFileBytes: async () => bytesOf('tampered content') })
    await expect(fetchClawhubWithClient('clawhub:@x/weather', client, freshStaging())).rejects.toThrow(/sha256 verification/)
  })

  it('refuses unsafe listed paths before downloading anything', async () => {
    let downloads = 0
    const client = makeClient({
      getVersionDetail: async () => ({
        version: {
          version: '2.0.1',
          files: [{ path: '../escape.md', size: 4, sha256: 'a'.repeat(64) }],
          security: scanClean.security,
        },
      }),
      getFileBytes: async (_s, path) => {
        downloads += 1
        return bytesOf(path)
      },
    })
    await expect(fetchClawhubWithClient('clawhub:@x/weather', client, freshStaging())).rejects.toThrow(/unsafe file path/)
    expect(downloads).toBe(0)
  })

  it('refuses over-cap bundles', async () => {
    const client = makeClient({
      getVersionDetail: async () => ({
        version: {
          version: '2.0.1',
          files: [{ path: 'SKILL.md', size: 30 * 1024 * 1024, sha256: 'a'.repeat(64) }],
          security: scanClean.security,
        },
      }),
    })
    await expect(fetchClawhubWithClient('clawhub:@x/weather', client, freshStaging())).rejects.toThrow(/sanity cap/)
  })

  it('unverified (hub scan unreachable) proceeds with a fetch warning', async () => {
    const client = makeClient({
      getScan: async () => null,
      getVersionDetail: async () => ({
        version: {
          version: '2.0.1',
          files: [
            { path: 'SKILL.md', size: bytesOf(SKILL_MD).length, sha256: sha256Hex(bytesOf(SKILL_MD)) },
          ],
          security: null,
        },
      }),
    })
    const fetched = await fetchClawhubWithClient('clawhub:@x/weather', client, freshStaging())
    expect(fetched.fetchWarnings?.join(' ')).toContain('unverified')
    rmSync(fetched.stagingDir, { recursive: true, force: true })
  })

  it('surfaces ambiguous slugs as the owner-picker error', async () => {
    const matches = JSON.parse(readFileSync(join(FIXTURES, 'clawhub-api', 'ambiguous-matches.json'), 'utf-8')).matches
    const client = makeClient({
      resolveLatestVersion: async () => {
        throw new AmbiguousClawhubSlugError('skill-vetter', matches)
      },
    })
    await expect(fetchClawhubWithClient('clawhub:skill-vetter', client, freshStaging()))
      .rejects.toThrow(/clawhub:@spclaudehome\/skill-vetter/)
  })
})

describe('clawhub API access stays behind the client (arch pin)', () => {
  it('no clawhub-client imports or raw API URLs outside the sanctioned modules', async () => {
    // Scheme strings / page URLs in help text are UX copy, not coupling.
    // What this pins: importing the client module or hitting the API base
    // from anywhere but the skill-hub feature core.
    const { execSync } = await import('child_process')
    const hits = execSync(
      `grep -rlE "clawhub-client|clawhub\\.ai/api" src/ packages/host/src/api packages/core/src --include="*.ts" || true`,
      { cwd: join(import.meta.dir, '..', '..') },
    ).toString().trim().split('\n').filter(Boolean)
    const allowed = new Set([
      'src/core/agent-packages/clawhub-client.ts',
      'src/core/agent-packages/source-fetcher.ts',
      'src/core/agent-packages/skill-trust.ts',
    ])
    const violations = hits.filter((h) => !allowed.has(h))
    expect(violations).toEqual([])
  })
})

describe('verdict honesty — code-review regressions (#687)', () => {
  it('an UNSCANNED version is never labeled clean (the ClawHavoc fresh-upload case)', () => {
    const unscanned = { moderation: null, security: { status: 'unscanned' } }
    const verdict = evaluateVerdict(unscanned, null)
    expect(verdict.state).toBe('unscanned')
    expect(verdict.warnings.join(' ')).toContain('NOT scanned')
  })

  it('a pending scan is unscanned, not clean', () => {
    const pending = { moderation: { ...scanClean.moderation, isPendingScan: true }, security: null }
    expect(evaluateVerdict(pending, null).state).toBe('unscanned')
  })

  it('a contentless {} scan yields unscanned — absence of evidence is never clean', () => {
    expect(evaluateVerdict({}, null).state).toBe('unscanned')
    expect(evaluateVerdict({ moderation: null, security: null }, undefined).state).toBe('unscanned')
  })

  it('clean still requires an affirmative positive signal', () => {
    expect(evaluateVerdict(scanClean, scanClean.security).state).toBe('clean')
  })
})

describe('download size enforcement (#687 review)', () => {
  it('refuses a file whose delivered size contradicts the manifest claim', async () => {
    const lie = 'x'.repeat(5000)
    const client = makeClient({
      getVersionDetail: async () => ({
        version: {
          version: '2.0.1',
          // Claims 10 bytes; the origin serves 5000.
          files: [{ path: 'SKILL.md', size: 10, sha256: sha256Hex(bytesOf(lie)) }],
          security: scanClean.security,
        },
      }),
      getFileBytes: async (_s, _p, opts) => {
        const bytes = bytesOf(lie)
        if (opts.expectedSize !== undefined && bytes.length !== opts.expectedSize) {
          throw new Error(`ClawHub file is ${bytes.length} bytes but the manifest claims ${opts.expectedSize} — refusing`)
        }
        return bytes
      },
    })
    await expect(fetchClawhubWithClient('clawhub:@x/weather', client, freshStaging())).rejects.toThrow(/manifest claims/)
  })
})

describe('verdict evidence — second-pass review regressions (#687)', () => {
  it('an EMPTY moderation object is not evidence — {} never reads as clean', () => {
    // Every ScanSchema field is optional on a passthrough object, so a hub
    // field rename would otherwise turn every pending skill green.
    expect(evaluateVerdict({ moderation: {}, security: null }, null).state).toBe('unscanned')
    expect(evaluateVerdict({ moderation: {} }, undefined).state).toBe('unscanned')
  })

  it('an unreachable scan can never be clean, even when version-detail says clean', () => {
    // No moderation flag was ever consulted, so a green check would be a lie.
    const verdict = evaluateVerdict(null, scanClean.security)
    expect(verdict.state).toBe('unscanned')
    expect(verdict.warnings.join(' ')).toContain('could not be checked')
  })

  it('clean requires an explicit security.status: clean', () => {
    expect(evaluateVerdict({ moderation: scanClean.moderation, security: scanClean.security }, null).state).toBe('clean')
  })
})
