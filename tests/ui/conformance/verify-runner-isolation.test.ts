import { describe, expect, it } from 'bun:test'

import { runIsolated } from '../../../scripts/ui/verify-plugin-conformance'

// The official conformance runner verifies each fixture in its OWN process
// with a hard deadline. In the CI Playwright container, launching a browser
// per fixture inside one long-lived bun process eventually hands the next
// launch a dead devtools pipe: Playwright waits its 180s launch timeout,
// throws, and the process never exits (the event loop stays pinned) — the
// job then sat until GitHub's 6h default. Isolation + a deadline turn that
// into a named failure in seconds.
describe('official conformance runner fixture isolation', () => {
  it('reports the child exit code when the fixture process finishes', async () => {
    const outcome = await runIsolated(['bun', '-e', 'process.exit(3)'], { timeoutMs: 10_000, graceMs: 200 })
    expect(outcome).toEqual({ status: 'exited', code: 3 })
  })

  it('kills a fixture process that produces no verdict before the deadline', async () => {
    const startedAt = Date.now()
    const outcome = await runIsolated(
      ['bun', '-e', 'setTimeout(() => {}, 60_000)'],
      { timeoutMs: 300, graceMs: 200 },
    )
    expect(outcome).toEqual({ status: 'timeout' })
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  it('escalates to SIGKILL when the fixture process ignores SIGTERM', async () => {
    const startedAt = Date.now()
    const outcome = await runIsolated(
      ['bun', '-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 60_000)'],
      { timeoutMs: 300, graceMs: 200 },
    )
    expect(outcome).toEqual({ status: 'timeout' })
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })
})
