/**
 * The completeness gate's two sources (#753): junit <testsuite file=…> and the
 * per-file header bun prints to stdout. The header is the ONLY source for a
 * file whose tests all skipped (no <testsuite> is emitted for it), and under
 * GITHUB_ACTIONS bun 1.4 wraps that header in a `::group::` annotation (#965) —
 * the bare regex alone reported the two all-skipped antfly suites as "never
 * dispatched" on CI. Pure: string fixtures only.
 */
import { describe, expect, it } from 'bun:test'
import { filesInJunit, filesInLog } from '../../scripts/check-test-completeness'

describe('filesInLog', () => {
  it('accepts the bare header bun 1.3 printed and the ::group:: form bun 1.4 prints under GITHUB_ACTIONS', () => {
    const log = [
      'bun test v1.4.3 (c6da4a4d3) 4x PARALLEL',
      'tests/integration/antfly/workaround-regressions.test.ts:',
      '::group::tests/integration/search-conformance/antfly.conformance.test.ts:',
      '⚠ search-conformance/antfly SKIPPED — no antfly binary',
      '::endgroup::',
      'tests/core/with trailing space.test.ts:   ',
      '(pass) something > works [1.00ms]',
    ].join('\n')
    expect([...filesInLog(log)]).toEqual([
      'tests/integration/antfly/workaround-regressions.test.ts',
      'tests/integration/search-conformance/antfly.conformance.test.ts',
    ])
  })

  it('ignores lines that merely mention a test file', () => {
    const log = [
      'error: tests/core/foo.test.ts: something failed',
      '  at tests/core/foo.test.ts:12:3',
      '::group::not-a-header',
      'tests/core/foo.test.ts: (with trailing text)',
    ].join('\n')
    expect(filesInLog(log).size).toBe(0)
  })
})

describe('filesInJunit', () => {
  it('collects distinct, repo-relative file attributes across nested testsuites', () => {
    const xml = [
      '<testsuites>',
      '<testsuite name="tests/core/a.test.ts" file="tests/core/a.test.ts" tests="2">',
      '<testsuite name="inner" file="tests/core/a.test.ts" line="5" tests="1"></testsuite>',
      '</testsuite>',
      `<testsuite name="b" file="${process.cwd()}/tests/core/b.test.ts" tests="1"></testsuite>`,
      '</testsuites>',
    ].join('\n')
    expect([...filesInJunit(xml)].sort()).toEqual(['tests/core/a.test.ts', 'tests/core/b.test.ts'])
  })
})
