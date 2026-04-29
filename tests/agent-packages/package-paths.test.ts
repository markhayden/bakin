/**
 * Tests for the agent-package path helpers.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-package-paths-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  PACKAGES_DIR_NAME,
  getInstallLockFile,
  getPackageSourceDir,
  getPackagesRoot,
  getStagingDir,
} from '../../packages/core/src/agent-packages/package-paths'

const CONTENT = '/some/content'

describe('package-paths', () => {
  it('packages root sits under content dir', () => {
    expect(getPackagesRoot(CONTENT)).toBe(join(CONTENT, PACKAGES_DIR_NAME))
  })

  it('agent install dir lives under packages/agents/<id>@<version>', () => {
    expect(getPackageSourceDir(CONTENT, 'agent', 'pixel', '0.1.0')).toBe(
      join(CONTENT, 'packages', 'agents', 'pixel@0.1.0'),
    )
  })

  it('skill-pack install dir lives under packages/skill-packs/', () => {
    expect(
      getPackageSourceDir(CONTENT, 'skill-pack', 'markhayden.bakin-skills-visual', '0.3.1'),
    ).toBe(join(CONTENT, 'packages', 'skill-packs', 'markhayden.bakin-skills-visual@0.3.1'))
  })

  it('workflow-pack install dir lives under packages/workflow-packs/', () => {
    expect(getPackageSourceDir(CONTENT, 'workflow-pack', 'creative', '0.2.0')).toBe(
      join(CONTENT, 'packages', 'workflow-packs', 'creative@0.2.0'),
    )
  })

  it('knowledge-pack install dir lives under packages/knowledge-packs/', () => {
    expect(getPackageSourceDir(CONTENT, 'knowledge-pack', 'lessons', '1.0.0')).toBe(
      join(CONTENT, 'packages', 'knowledge-packs', 'lessons@1.0.0'),
    )
  })

  it('staging dir embeds a label for collision avoidance', () => {
    const a = getStagingDir(CONTENT, 'pixel-1730000000')
    const b = getStagingDir(CONTENT, 'pixel-1730000001')
    expect(a).not.toBe(b)
    expect(a.startsWith(getPackagesRoot(CONTENT))).toBe(true)
  })

  it('install lock file lives at packages/.lock', () => {
    expect(getInstallLockFile(CONTENT)).toBe(join(CONTENT, 'packages', '.lock'))
  })
})
