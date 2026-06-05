/**
 * Shared install-core source guards (Whiskit P5, first slice).
 *
 * Locks the `#subpath` rule set that both the plugin parser
 * (parseGithubSource) and the agent-package parser (parseGithubSpec) now share,
 * so the two can never drift again. Behavior preservation on each side is also
 * covered by their own suites (tests/plugins/lifecycle/parse-github-source.test.ts,
 * tests/agent-packages/source-fetcher.test.ts), which must stay green.
 *
 * Pure module — imports no app code, touches no storage. The mandatory
 * isolation mocks are added per project rule.
 */
import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const mockDir = join(tmpdir(), `install-core-guards-mock-${Date.now()}-${randomUUID()}`)
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
  checkSubpath,
  type SubpathViolation,
} from '../../../packages/core/src/install-core/source-guards'
import {
  parseGithubSource,
  InvalidGithubSourceError,
} from '../../../packages/core/src/plugins/source'

describe('checkSubpath (shared install-core rule set)', () => {
  it('accepts valid subpaths', () => {
    for (const ok of ['a', 'agents/patch', 'plugins/messaging', 'a.b-c_d/e1']) {
      expect(checkSubpath(ok)).toBeNull()
    }
  })

  const cases: Array<[string, SubpathViolation]> = [
    ['', 'empty'],
    ['agents/patch copy', 'invalid-chars'],
    ['a$b', 'invalid-chars'],
    ['has#hash', 'invalid-chars'],
    ['/leading', 'leading-or-trailing-slash'],
    ['trailing/', 'leading-or-trailing-slash'],
    ['a/../b', 'dot-segment'],
    ['./a', 'dot-segment'],
    ['a/.', 'dot-segment'],
  ]
  for (const [input, violation] of cases) {
    it(`flags "${input}" as ${violation}`, () => {
      expect(checkSubpath(input)).toBe(violation)
    })
  }
})

describe('parseGithubSource still maps every violation to InvalidGithubSourceError', () => {
  const bad = [
    'owner/repo#',
    'owner/repo#/agents/patch',
    'owner/repo#agents/patch/',
    'owner/repo#agents/../patch',
    'owner/repo#./agents/patch',
    'owner/repo#agents patch',
  ]
  for (const source of bad) {
    it(`rejects ${source}`, () => {
      expect(() => parseGithubSource(source)).toThrow(InvalidGithubSourceError)
    })
  }

  it('still parses a valid subpath through the shared guard', () => {
    expect(parseGithubSource('github:owner/repo#plugins/messaging')).toEqual({
      cloneUrl: 'https://github.com/owner/repo.git',
      subpath: 'plugins/messaging',
    })
  })
})
