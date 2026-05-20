/**
 * Tests for the Antfly search-adapter setup component.
 *
 * Strategy:
 *   - Mock the search adapter binary helper so it returns a test-controlled value
 *   - Mock child_process.spawn to return a fake ChildProcess that emits a
 *     configurable exit code on `close` — no real brew runs
 *   - Mock fs.existsSync so the `findBrew()` helper inside the component
 *     only resolves paths we explicitly whitelist
 *   - Mock prompts so interactive confirmation is scripted
 *
 * This is the first component that shells out to a package manager, so
 * the mock ergonomics here will be reused by T6 (models) and T7 (mcporter).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'events'
import * as actualFs from 'fs'

// Per-test state for the mocks. Must be `let` so the mock closures can
// read the current value on each call. `findBinaryQueue` is a queue so
// the install() code path can see different values on successive calls
// (before spawn = missing, after spawn = installed, etc.).
let findBinaryQueue: Array<string | null>
let brewExists: boolean
let spawnExitCode: number | null
let spawnError: Error | null
let spawnStdout: string
let spawnStderr: string
let lastSpawnArgs: { cmd: string; args: string[]; opts: Record<string, unknown> } | null
let askYesNoReturn: boolean

mock.module('../../../packages/adapter-antfly/src/server', () => ({
  findAntflyBinary: () => {
    // Pop the next queued value; if the queue is empty, repeat the last
    // one. Lets tests set [null, '/path/to/binary'] to mean "missing on
    // first call, installed on second" without manual timing tricks.
    if (findBinaryQueue.length === 0) return null
    if (findBinaryQueue.length === 1) return findBinaryQueue[0]
    return findBinaryQueue.shift()!
  },
  isAntflyInstalled: () => findBinaryQueue[0] !== null,
  isAntflyRunning: () => false,
  startAntflyServer: () => Promise.resolve(false),
  stopAntflyServer: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('fs', () => {
  return {
    ...actualFs,
    existsSync: (p: unknown) => {
      const path = String(p)
      if (path === '/opt/homebrew/bin/brew' || path === '/usr/local/bin/brew') {
        return brewExists
      }
      return actualFs.existsSync(p as never)
    },
  }
})

mock.module('child_process', () => ({
  spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    lastSpawnArgs = { cmd, args, opts }
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter | null
      stderr: EventEmitter | null
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    // Async emit so .on('close', ...) is registered before it fires
    setImmediate(() => {
      if (spawnError) {
        child.emit('error', spawnError)
        return
      }
      if (spawnStdout) child.stdout?.emit('data', Buffer.from(spawnStdout))
      child.stderr?.emit('data', Buffer.from(spawnStderr))
      child.emit('close', spawnExitCode)
    })
    return child
  },
}))

describe('Antfly search setup component', () => {
  let dependencyComponent: ReturnType<typeof import('../../../packages/adapter-antfly/src/setup').createAntflySearchSetup>['dependency']

  beforeEach(async () => {
    findBinaryQueue = [null]
    brewExists = true
    spawnExitCode = 0
    spawnError = null
    spawnStdout = ''
    spawnStderr = ''
    lastSpawnArgs = null
    askYesNoReturn = true
    vi.resetModules()
    const mod = await import('../../../packages/adapter-antfly/src/setup')
    dependencyComponent = mod.createAntflySearchSetup().dependency
  })

  afterEach(() => {
    lastSpawnArgs = null
  })

  const optsAutoYes = {
    interactive: false,
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
    askYesNo: () => Promise.resolve(askYesNoReturn),
  }
  const optsInteractive = {
    interactive: true,
    autoApprove: false,
    json: false,
    checkOnly: false,
    force: false,
    askYesNo: () => Promise.resolve(askYesNoReturn),
  }
  const optsNonInteractiveNoYes = {
    interactive: false,
    autoApprove: false,
    json: false,
    checkOnly: false,
    force: false,
    askYesNo: () => Promise.resolve(askYesNoReturn),
  }

  describe('check()', () => {
    it('reports ok when the antfly binary is found', async () => {
      findBinaryQueue = ['/opt/homebrew/bin/antfly']
      const result = await dependencyComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.binary).toBe('/opt/homebrew/bin/antfly')
    })

    it('reports missing when the binary is not found', async () => {
      findBinaryQueue = [null]
      const result = await dependencyComponent.check()
      expect(result.status).toBe('missing')
      expect(result.remediation).toContain('bakin install search')
    })
  })

  describe('install()', () => {
    it('is a noop when antfly is already installed', async () => {
      findBinaryQueue = ['/opt/homebrew/bin/antfly']
      const result = await dependencyComponent.install(optsAutoYes)
      expect(result.status).toBe('noop')
      expect(lastSpawnArgs).toBeNull()
    })

    it('fails cleanly when Homebrew is missing', async () => {
      findBinaryQueue = [null]
      brewExists = false
      const result = await dependencyComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('Homebrew not found')
      expect(lastSpawnArgs).toBeNull()
    })

    it('runs brew install with the correct argument shape', async () => {
      // First findBinary call (pre-spawn) returns null → missing.
      // Second (post-spawn verification) returns the installed path.
      findBinaryQueue = [null, '/opt/homebrew/bin/antfly']
      brewExists = true
      const result = await dependencyComponent.install(optsAutoYes)

      expect(lastSpawnArgs).not.toBeNull()
      expect(lastSpawnArgs!.cmd).toBe('/opt/homebrew/bin/brew')
      expect(lastSpawnArgs!.args).toEqual(['install', 'antflydb/antfly/antfly'])
      // Never uses shell: true — that's a hard rule in the spec
      expect(lastSpawnArgs!.opts).not.toHaveProperty('shell', true)
      expect(lastSpawnArgs!.opts.env).toEqual(expect.objectContaining({
        HOMEBREW_NO_AUTO_UPDATE: '1',
        HOMEBREW_NO_ENV_HINTS: '1',
      }))
      expect(result.status).toBe('installed')
      expect(result.message).toContain('/opt/homebrew/bin/antfly')
    })

    it('keeps stdin interactive while capturing Homebrew output', async () => {
      findBinaryQueue = [null, '/opt/homebrew/bin/antfly']
      brewExists = true

      const result = await dependencyComponent.install(optsInteractive)

      expect(lastSpawnArgs).not.toBeNull()
      expect(lastSpawnArgs!.opts).toEqual(expect.objectContaining({
        stdio: ['inherit', 'pipe', 'pipe'],
      }))
      expect(result.status).toBe('installed')
    })

    it('reports failed when brew exits non-zero', async () => {
      findBinaryQueue = [null]
      spawnExitCode = 1
      spawnStderr = 'Error: Xcode is outdated.\nPlease update Xcode or Command Line Tools.\n'
      const result = await dependencyComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('Homebrew could not install Antfly with exit code 1')
      expect(result.message).toContain('update Xcode or Command Line Tools')
      expect(String(result.error)).toContain('Xcode is outdated')
    })

    it('accepts a non-zero brew exit when the antfly binary is discoverable afterward', async () => {
      findBinaryQueue = [null, '/opt/homebrew/bin/antfly']
      spawnExitCode = 1
      spawnStderr = 'Warning: Your Xcode is outdated.\n'
      const result = await dependencyComponent.install(optsAutoYes)
      expect(result.status).toBe('installed')
      expect(result.message).toContain('/opt/homebrew/bin/antfly')
      expect(result.message).toContain('Homebrew returned code 1')
    })

    it('reports failed when brew succeeds but binary is still missing', async () => {
      findBinaryQueue = [null]
      spawnExitCode = 0
      // Never flip findBinaryQueue — simulates brew silently doing nothing
      const result = await dependencyComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('still not discoverable')
    })

    it('skips install when user declines the prompt', async () => {
      findBinaryQueue = [null]
      askYesNoReturn = false
      const result = await dependencyComponent.install(optsInteractive)
      expect(result.status).toBe('skipped')
      expect(lastSpawnArgs).toBeNull()
    })

    it('skips install in non-interactive mode without --yes', async () => {
      findBinaryQueue = [null]
      const result = await dependencyComponent.install(optsNonInteractiveNoYes)
      expect(result.status).toBe('skipped')
      expect(result.message).toContain('Non-interactive')
      expect(lastSpawnArgs).toBeNull()
    })

    it('reports failed when spawn emits an error event', async () => {
      findBinaryQueue = [null]
      spawnError = new Error('ENOENT')
      const result = await dependencyComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('ENOENT')
    })
  })
})
