import { describe, expect, it } from 'bun:test'
import {
  PUBLIC_SDK_PACKAGE_NAME,
  parseArgs,
  waitForNpmVersion,
  type WaitDeps,
} from '../../scripts/wait-for-npm-version'
import type { CommandResult, CommandRunner } from '../../scripts/lib/npm-registry'

const NOT_FOUND: CommandResult = {
  status: 1,
  stdout: '',
  stderr: 'npm ERR! code E404\nnpm ERR! 404 Not Found - GET https://registry.npmjs.org/...',
}

function resolved(version: string): CommandResult {
  return { status: 0, stdout: `"${version}"\n`, stderr: '' }
}

/** Manual clock: advances only when sleep() is called, so tests never wait in real time. */
function fakeClock(): WaitDeps & { slept: number[]; viewCalls: number } {
  let clock = 0
  const slept: number[] = []
  const harness = {
    slept,
    viewCalls: 0,
    sleep: async (ms: number) => {
      slept.push(ms)
      clock += ms
    },
    now: () => clock,
  }
  return harness as WaitDeps & { slept: number[]; viewCalls: number }
}

function runnerFrom(sequence: CommandResult[], harness: { viewCalls: number }): CommandRunner {
  let i = 0
  return ((cmd, args) => {
    expect(cmd).toBe('npm')
    expect(args[0]).toBe('view')
    harness.viewCalls += 1
    const result = sequence[Math.min(i, sequence.length - 1)]
    i += 1
    return result
  }) satisfies CommandRunner
}

describe('parseArgs', () => {
  it('defaults package to the SDK and applies default timing', () => {
    expect(parseArgs(['--version', '0.1.0-rc.1'])).toEqual({
      package: PUBLIC_SDK_PACKAGE_NAME,
      version: '0.1.0-rc.1',
      timeoutMs: 120_000,
      baseDelayMs: 2_000,
      maxDelayMs: 30_000,
    })
  })

  it('parses package override and converts timing flags from seconds to ms', () => {
    expect(parseArgs([
      '--package', '@scope/foo',
      '--version', '1.2.3',
      '--timeout', '30',
      '--base-delay', '1',
      '--max-delay', '10',
    ])).toEqual({
      package: '@scope/foo',
      version: '1.2.3',
      timeoutMs: 30_000,
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
    })
  })

  it('rejects malformed versions, missing values, and non-positive timing', () => {
    expect(() => parseArgs(['--version', '0.1.0-beta.1'])).toThrow('version must')
    expect(() => parseArgs([])).toThrow('version must')
    expect(() => parseArgs(['--version'])).toThrow('requires a value')
    expect(() => parseArgs(['--version', '1.0.0', '--timeout', '0'])).toThrow('positive')
    expect(() => parseArgs(['--version', '1.0.0', '--unknown'])).toThrow('Unexpected argument')
  })
})

describe('waitForNpmVersion', () => {
  it('returns immediately when the version already resolves', async () => {
    const harness = fakeClock()
    const runner = runnerFrom([resolved('1.0.0')], harness)
    await waitForNpmVersion(
      { package: PUBLIC_SDK_PACKAGE_NAME, version: '1.0.0', timeoutMs: 120_000, baseDelayMs: 2_000, maxDelayMs: 30_000 },
      { ...harness, runner },
    )
    expect(harness.viewCalls).toBe(1)
    expect(harness.slept).toEqual([])
  })

  it('polls past transient 404s until the version becomes visible', async () => {
    const harness = fakeClock()
    const runner = runnerFrom([NOT_FOUND, NOT_FOUND, resolved('0.0.1-rc.8')], harness)
    await waitForNpmVersion(
      { package: PUBLIC_SDK_PACKAGE_NAME, version: '0.0.1-rc.8', timeoutMs: 120_000, baseDelayMs: 2_000, maxDelayMs: 30_000 },
      { ...harness, runner },
    )
    expect(harness.viewCalls).toBe(3)
    expect(harness.slept).toEqual([2_000, 4_000])
  })

  it('fails fast on a real (non-404) error without exhausting the timeout', async () => {
    const harness = fakeClock()
    const runner = runnerFrom([{ status: 1, stdout: '', stderr: 'network failed' }], harness)
    await expect(waitForNpmVersion(
      { package: PUBLIC_SDK_PACKAGE_NAME, version: '1.0.0', timeoutMs: 120_000, baseDelayMs: 2_000, maxDelayMs: 30_000 },
      { ...harness, runner },
    )).rejects.toThrow('Could not check')
    expect(harness.viewCalls).toBe(1)
    expect(harness.slept).toEqual([])
  })

  it('throws a bounded error when the version never appears before the deadline', async () => {
    const harness = fakeClock()
    const runner = runnerFrom([NOT_FOUND], harness)
    await expect(waitForNpmVersion(
      { package: PUBLIC_SDK_PACKAGE_NAME, version: '2.0.0', timeoutMs: 10_000, baseDelayMs: 2_000, maxDelayMs: 30_000 },
      { ...harness, runner },
    )).rejects.toThrow(/2\.0\.0/)
    // Delay is clamped to the remaining budget so the full 10s is used:
    // 0s -> sleep 2000; 2s -> sleep 4000; 6s -> sleep min(8000, 4000)=4000;
    // 10s -> no budget left -> throw. Four checks, full deadline consumed.
    expect(harness.viewCalls).toBe(4)
    expect(harness.slept).toEqual([2_000, 4_000, 4_000])
  })

  it('caps the backoff delay at maxDelayMs', async () => {
    const harness = fakeClock()
    const seq = [NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, resolved('3.0.0')]
    const runner = runnerFrom(seq, harness)
    await waitForNpmVersion(
      { package: PUBLIC_SDK_PACKAGE_NAME, version: '3.0.0', timeoutMs: 1_000_000_000, baseDelayMs: 2_000, maxDelayMs: 30_000 },
      { ...harness, runner },
    )
    expect(harness.slept).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
  })
})
