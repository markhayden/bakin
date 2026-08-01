/**
 * Startup artifact verification (Phase 9). Pure over a temp plugin dir.
 * Mandatory isolation mocks per project rule.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

const mockDir = join(tmpdir(), `whiskit-verify-mock-${Date.now()}-${randomUUID()}`)
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

import { verifyInstalledArtifact } from '../../../src/core/whiskit/verify'
import { writeProvenance, WHISKIT_PROVENANCE_VERSION, type WhiskitBuildProvenance } from '../../../src/core/whiskit/provenance'
import { EXTERNALS_CONTRACT } from '../../../src/core/whiskit/externals'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function pluginDir(provenance?: Partial<WhiskitBuildProvenance> | 'corrupt'): string {
  const dir = join(tmpdir(), `whiskit-verify-plugin-${Date.now()}-${randomUUID()}`)
  mkdirSync(join(dir, 'dist'), { recursive: true })
  dirs.push(dir)
  if (provenance === 'corrupt') {
    mkdirSync(join(dir, '.whiskit'), { recursive: true })
    writeFileSync(join(dir, '.whiskit', 'build.json'), 'not json{')
  } else if (provenance) {
    const full: WhiskitBuildProvenance = {
      version: WHISKIT_PROVENANCE_VERSION,
      pluginId: 'foo',
      pluginVersion: '1.0.0',
      bakinVersion: '0.0.1-rc.15',
      bakinRange: '>=0.0.1-rc.1',
      whiskitVersion: '1',
      buildBackend: 'system-bun',
      platform: 'neutral',
      sourceCommitSha: '',
      sourceTreeSha: 'a'.repeat(64),
      manifestSha: 'b'.repeat(64),
      externalsContract: EXTERNALS_CONTRACT,
      approvedInstallScripts: [],
      outputs: { serverEntry: 'dist/index.js' },
      builtAt: '2026-06-04T00:00:00.000Z',
      ...provenance,
    }
    mkdirSync(join(dir, '.whiskit'), { recursive: true })
    writeProvenance(join(dir, '.whiskit', 'build.json'), full)
  }
  return dir
}

describe('verifyInstalledArtifact', () => {
  it('returns non-whiskit when there is no .whiskit/build.json', () => {
    expect(verifyInstalledArtifact(pluginDir()).status).toBe('non-whiskit')
  })

  it('returns compatible when the externals contract matches the host', () => {
    const v = verifyInstalledArtifact(pluginDir({}))
    expect(v.status).toBe('compatible')
  })

  it('keeps artifacts built against an older compatible contract loadable', () => {
    const v = verifyInstalledArtifact(pluginDir({ externalsContract: 'react19-sdk-makinbakin-v1' }))
    expect(v.status).toBe('compatible')
  })

  it('returns needs-update when the externals contract does not match', () => {
    const v = verifyInstalledArtifact(pluginDir({ externalsContract: 'react18-old-vX' }))
    expect(v.status).toBe('needs-update')
    if (v.status === 'needs-update') expect(v.reason).toContain('react18-old-vX')
  })

  it('returns invalid for a corrupt provenance record', () => {
    expect(verifyInstalledArtifact(pluginDir('corrupt')).status).toBe('invalid')
  })
})
