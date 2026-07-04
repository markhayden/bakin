/**
 * Shared TTY CLI test harness (B7).
 *
 * The CLI TTY tests all patch the same process-global surface: argv, exit,
 * exitCode, cwd, fetch, stdout.isTTY, and console.log/error spies. Before B7
 * that scaffolding was copy-pasted across ~10 files under tests/cli/. This
 * helper owns it once: call `setupTtyCliHarness()` at module scope (before
 * the describe block) and it registers the beforeEach/afterEach itself.
 *
 * IMPORTANT: bun's `mock.module(...)` calls MUST stay in each test file —
 * module mocks are per-file under `--isolate`, and hoisting them into a
 * shared helper would silently change what gets mocked. Only pure global
 * patching and spies live here.
 *
 * Real per-file variations are supported via options, not normalized:
 * exit-mock semantics differ between help flows (exit(0) throws) and
 * command flows (exit(0) returns), some files keep the real fetch, the
 * schedule TUI needs data: URLs passed through to the real fetch, and the
 * onboarding flows render live output through process.stdout.write.
 */
import { afterEach, beforeEach, mock, spyOn } from 'bun:test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export type ExitMockMode =
  | 'zero-returns'
  | 'zero-or-undefined-returns'
  | 'always-throws'
  | 'none'

export interface TtyCliHarnessOptions {
  /**
   * process.exit mock semantics (default 'zero-returns'):
   * - 'zero-returns': exit(0) returns undefined; any other code throws `exit:N`.
   * - 'zero-or-undefined-returns': exit(0) and exit() return; others throw.
   * - 'always-throws': every exit(code) throws `exit:N` (flows that assert exit:0).
   * - 'none': leave process.exit untouched (still restored after each test).
   */
  exitMode?: ExitMockMode
  /**
   * stdout.isTTY value applied in beforeEach. `null` leaves it untouched
   * (tests set it per-case); it is always restored in afterEach. Default true.
   */
  defaultIsTTY?: boolean | null
  /** Replace globalThis.fetch with the harness fetchMock (default true). */
  mockFetch?: boolean
  /**
   * When set, fetchMock.mockResolvedValue(jsonResponse(defaultFetchJson))
   * runs in each beforeEach (after mock.clearAllMocks).
   */
  defaultFetchJson?: unknown
  /** Pass data: URLs through to the real fetch (schedule TUI assets). */
  passthroughDataUrls?: boolean
  /** Also spy process.stdout.write (live TUI renderers). Default false. */
  spyStdoutWrite?: boolean
  /** Env vars snapshotted before each test and restored after. */
  saveEnv?: string[]
}

export interface TtyCliHarness {
  fetchMock: ReturnType<typeof mock>
  /** console.log spy — recreated in every beforeEach. */
  log: ReturnType<typeof spyOn>
  /** console.error spy — recreated in every beforeEach. */
  error: ReturnType<typeof spyOn>
  /** process.stdout.write spy — only set when spyStdoutWrite is true. */
  stdoutWrite: ReturnType<typeof spyOn> | undefined
  /** All console.log first-args joined with newlines. */
  output: () => string
  /** All console.error args (space-joined per call) joined with newlines. */
  errorOutput: () => string
  /** All process.stdout.write first-args concatenated. */
  writeOutput: () => string
  setStdoutIsTTY: (value: boolean) => void
  jsonResponse: (body: unknown) => Response
}

export function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  } as Response
}

export function setStdoutIsTTY(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
}

export function setupTtyCliHarness(options: TtyCliHarnessOptions = {}): TtyCliHarness {
  const {
    exitMode = 'zero-returns',
    defaultIsTTY = true,
    mockFetch = true,
    defaultFetchJson,
    passthroughDataUrls = false,
    spyStdoutWrite = false,
    saveEnv = [],
  } = options

  const fetchMock = mock()
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalExitCode = process.exitCode
  const originalFetch = globalThis.fetch
  const originalCwd = process.cwd()
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let savedEnv: Record<string, string | undefined> = {}

  const harness: TtyCliHarness = {
    fetchMock,
    log: undefined as unknown as ReturnType<typeof spyOn>,
    error: undefined as unknown as ReturnType<typeof spyOn>,
    stdoutWrite: undefined,
    output: () => harness.log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n'),
    errorOutput: () =>
      harness.error.mock.calls
        .map((call: unknown[]) => call.map(part => String(part)).join(' '))
        .join('\n'),
    writeOutput: () =>
      harness.stdoutWrite
        ? harness.stdoutWrite.mock.calls.map((call: unknown[]) => String(call[0])).join('')
        : '',
    setStdoutIsTTY,
    jsonResponse,
  }

  beforeEach(() => {
    mock.clearAllMocks()
    savedEnv = {}
    for (const key of saveEnv) savedEnv[key] = process.env[key]
    process.argv = originalArgv
    if (mockFetch) {
      if (passthroughDataUrls) {
        globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          if (typeof input === 'string' && input.startsWith('data:')) return originalFetch(input, init)
          return fetchMock(input, init)
        }) as typeof fetch
      } else {
        globalThis.fetch = fetchMock as unknown as typeof fetch
      }
      if (defaultFetchJson !== undefined) fetchMock.mockResolvedValue(jsonResponse(defaultFetchJson))
    }
    harness.log = spyOn(console, 'log').mockImplementation(() => {})
    harness.error = spyOn(console, 'error').mockImplementation(() => {})
    if (spyStdoutWrite) {
      harness.stdoutWrite = spyOn(process.stdout, 'write').mockImplementation(() => true)
    }
    if (exitMode !== 'none') {
      process.exit = ((code?: number) => {
        if (exitMode === 'zero-returns' && code === 0) return undefined as never
        if (exitMode === 'zero-or-undefined-returns' && (code === 0 || code === undefined)) {
          return undefined as never
        }
        throw new Error(`exit:${code}`)
      }) as never
    }
    if (defaultIsTTY !== null) setStdoutIsTTY(defaultIsTTY)
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    process.exitCode = originalExitCode ?? 0
    globalThis.fetch = originalFetch
    process.chdir(originalCwd)
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    for (const key of saveEnv) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    harness.log.mockRestore()
    harness.error.mockRestore()
    harness.stdoutWrite?.mockRestore()
    harness.stdoutWrite = undefined
  })

  return harness
}

/**
 * Point BAKIN_HOME at a fresh temp dir (with resetContentDir) for the
 * duration of `fn`, then restore. Used by the audit-log CLI tests, which
 * exercise the REAL content-dir resolver against a temp home — the standard
 * mock.module isolation pattern would defeat what they test.
 */
export async function withTempBakinHome(
  prefix: string,
  fn: (tempHome: string) => Promise<void>,
): Promise<void> {
  const originalBakinHome = process.env.BAKIN_HOME
  const tempHome = mkdtempSync(join(tmpdir(), prefix))
  const { resetContentDir } = await import('../../../packages/core/src/content-dir')
  process.env.BAKIN_HOME = tempHome
  resetContentDir()
  try {
    await fn(tempHome)
  } finally {
    if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
    else process.env.BAKIN_HOME = originalBakinHome
    resetContentDir()
  }
}
