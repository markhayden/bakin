/**
 * Whiskit build provenance schema + IO (Phase 3).
 *
 * Pure module over a temp file; no ~/.bakin/~/.openclaw. Mandatory isolation
 * mocks added per project rule.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'

const mockDir = join(tmpdir(), `whiskit-prov-mock-${Date.now()}-${randomUUID()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(mockDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(mockDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  WHISKIT_PROVENANCE_VERSION,
  parseProvenance,
  readProvenance,
  writeProvenance,
  isExternalsContractCompatible,
  type WhiskitBuildProvenance,
} from '../../../src/core/whiskit/provenance'
import { EXTERNALS_CONTRACT, supportsExternalsContract } from '../../../src/core/whiskit/externals'

let dir: string | null = null
afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = null
  }
})

function freshDir(): string {
  const d = join(tmpdir(), `whiskit-prov-test-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  return d
}

function validProvenance(): WhiskitBuildProvenance {
  return {
    version: WHISKIT_PROVENANCE_VERSION,
    pluginId: 'messaging',
    pluginVersion: '0.1.0',
    bakinVersion: '0.0.1-rc.15',
    bakinRange: '>=0.0.1-rc.15 <0.1.0',
    whiskitVersion: '1',
    buildBackend: 'system-bun',
    platform: 'darwin-arm64',
    sourceCommitSha: 'a'.repeat(40),
    sourceTreeSha: 'b'.repeat(64),
    manifestSha: 'c'.repeat(64),
    externalsContract: EXTERNALS_CONTRACT,
    approvedInstallScripts: [],
    outputs: { serverEntry: 'dist/index.js', clientEntry: 'dist/client.js' },
    builtAt: '2026-06-04T00:00:00.000Z',
  }
}

describe('whiskit provenance', () => {
  it('round-trips a valid record through write + read', () => {
    dir = freshDir()
    const path = join(dir, 'build.json')
    const prov = validProvenance()
    writeProvenance(path, prov)
    expect(readProvenance(path)).toEqual(prov)
  })

  it('applies schema defaults (sourceCommitSha, approvedInstallScripts)', () => {
    const raw = { ...validProvenance() } as Record<string, unknown>
    delete raw.sourceCommitSha
    delete raw.approvedInstallScripts
    const parsed = parseProvenance(raw)
    expect(parsed.sourceCommitSha).toBe('')
    expect(parsed.approvedInstallScripts).toEqual([])
  })

  it('rejects a wrong schema version', () => {
    const raw = { ...validProvenance(), version: 1 }
    expect(() => parseProvenance(raw)).toThrow()
  })

  it('rejects a record missing required fields', () => {
    const raw = { ...validProvenance() } as Record<string, unknown>
    delete raw.outputs
    expect(() => parseProvenance(raw)).toThrow()
  })

  it('rejects non-JSON on disk with a clear error', () => {
    dir = freshDir()
    const path = join(dir, 'build.json')
    writeFileSync(path, 'not json{', 'utf-8')
    expect(() => readProvenance(path)).toThrow(/not valid JSON/i)
  })

  it('reports externals-contract compatibility', () => {
    expect(EXTERNALS_CONTRACT).toBe('react19-sdk-makinbakin-v2')
    expect(isExternalsContractCompatible(validProvenance())).toBe(true)
    expect(
      isExternalsContractCompatible({ ...validProvenance(), externalsContract: 'react19-sdk-makinbakin-v1' }),
    ).toBe(true)
    expect(
      isExternalsContractCompatible({ ...validProvenance(), externalsContract: 'react19-sdk-makinbakin-v3' }),
    ).toBe(false)
    expect(
      isExternalsContractCompatible({ ...validProvenance(), externalsContract: 'react18-old' }),
    ).toBe(false)
    expect(
      supportsExternalsContract('react19-sdk-makinbakin-v2', 'react19-sdk-makinbakin-v1'),
    ).toBe(false)
    expect(supportsExternalsContract('malformed', EXTERNALS_CONTRACT)).toBe(false)
    expect(supportsExternalsContract('-v1', EXTERNALS_CONTRACT)).toBe(false)
  })

  it('writes pretty-printed JSON with a trailing newline (atomic writer)', () => {
    dir = freshDir()
    const path = join(dir, 'build.json')
    writeProvenance(path, validProvenance())
    const text = readFileSync(path, 'utf-8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "pluginId": "messaging"')
  })
})
