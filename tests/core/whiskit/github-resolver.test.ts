/**
 * GitHub-release resolver URL construction (Phase 6). Pure — no network.
 * Mandatory isolation mocks per project rule.
 */
import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const mockDir = join(tmpdir(), `whiskit-ghres-mock-${Date.now()}-${randomUUID()}`)
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

import { githubArtifactSource } from '../../../src/core/whiskit/github-resolver'

describe('githubArtifactSource', () => {
  it('uses the releases/latest/download redirect when no @ref', () => {
    const r = githubArtifactSource('github:markhayden/bakin-bits-official#plugins/messaging')
    expect(r.pluginId).toBe('messaging')
    expect(r.baseUrl).toBe(
      'https://github.com/markhayden/bakin-bits-official/releases/latest/download',
    )
    expect(r.resolver.scheme).toBe('github')
  })

  it('pins to a tag download path when @ref is given', () => {
    const r = githubArtifactSource('github:markhayden/bakin-bits-official@messaging-v0.2.0#plugins/messaging')
    expect(r.pluginId).toBe('messaging')
    expect(r.baseUrl).toBe(
      'https://github.com/markhayden/bakin-bits-official/releases/download/messaging-v0.2.0',
    )
  })

  it('derives pluginId from the last subpath segment', () => {
    expect(githubArtifactSource('github:owner/repo#plugins/projects').pluginId).toBe('projects')
    expect(githubArtifactSource('owner/repo#a/b/my-plugin').pluginId).toBe('my-plugin')
  })

  it('requires a #subpath', () => {
    expect(() => githubArtifactSource('github:owner/repo')).toThrow(/#subpath/i)
  })
})
