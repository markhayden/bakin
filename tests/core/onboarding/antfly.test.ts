/**
 * Tests for the antfly onboarding component.
 *
 * Strategy:
 *   - Mock antfly-server so `findBinary()` returns a test-controlled value
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

// Per-test state for the mocks. Must be `let` so the mock closures can
// read the current value on each call. `findBinaryQueue` is a queue so
// the install() code path can see different values on successive calls
// (before spawn = missing, after spawn = installed, etc.).
let findBinaryQueue: Array<string | null>
let brewExists: boolean
let spawnExitCode: number | null
let spawnError: Error | null
let lastSpawnArgs: { cmd: string; args: string[]; opts: Record<string, unknown> } | null
let askYesNoReturn: boolean

mock.module('../../../src/core/antfly-server', () => ({
  findBinary: () => {
    // Pop the next queued value; if the queue is empty, repeat the last
    // one. Lets tests set [null, '/path/to/binary'] to mean "missing on
    // first call, installed on second" without manual timing tricks.
    if (findBinaryQueue.length === 0) return null
    if (findBinaryQueue.length === 1) return findBinaryQueue[0]
    return findBinaryQueue.shift()!
  },
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('fs', async () => {
  const actual = await import('fs')
  return {
    ...actual,
    existsSync: (p: unknown) => {
      const path = String(p)
      if (path === '/opt/homebrew/bin/brew' || path === '/usr/local/bin/brew') {
        return brewExists
      }
      return actual.existsSync(p as never)
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
      child.stderr?.emit('data', Buffer.from(''))
      child.emit('close', spawnExitCode)
    })
    return child
  },
}))

mock.module('../../../src/core/onboarding/prompts', () => ({
  askYesNo: () => Promise.resolve(askYesNoReturn),
  readLine: () => Promise.resolve(''),
}))

describe('onboarding antfly component', () => {
  let antflyComponent: typeof import('../../../src/core/onboarding/antfly').antflyComponent

  beforeEach(async () => {
    findBinaryQueue = [null]
    brewExists = true
    spawnExitCode = 0
    spawnError = null
    lastSpawnArgs = null
    askYesNoReturn = true
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/antfly')
    antflyComponent = mod.antflyComponent
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
  }
  const optsInteractive = {
    interactive: true,
    autoApprove: false,
    json: false,
    checkOnly: false,
    force: false,
  }
  const optsNonInteractiveNoYes = {
    interactive: false,
    autoApprove: false,
    json: false,
    checkOnly: false,
    force: false,
  }

  describe('check()', () => {
    it('reports ok when the antfly binary is found', async () => {
      findBinaryQueue = ['/opt/homebrew/bin/antfly']
      const result = await antflyComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.binary).toBe('/opt/homebrew/bin/antfly')
    })

    it('reports missing when the binary is not found', async () => {
      findBinaryQueue = [null]
      const result = await antflyComponent.check()
      expect(result.status).toBe('missing')
      expect(result.remediation).toContain('bakin install antfly')
    })
  })

  describe('install()', () => {
    it('is a noop when antfly is already installed', async () => {
      findBinaryQueue = ['/opt/homebrew/bin/antfly']
      const result = await antflyComponent.install(optsAutoYes)
      expect(result.status).toBe('noop')
      expect(lastSpawnArgs).toBeNull()
    })

    it('fails cleanly when Homebrew is missing', async () => {
      findBinaryQueue = [null]
      brewExists = false
      const result = await antflyComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('Homebrew not found')
      expect(lastSpawnArgs).toBeNull()
    })

    it('runs brew install --cask with the correct argument shape', async () => {
      // First findBinary call (pre-spawn) returns null → missing.
      // Second (post-spawn verification) returns the installed path.
      findBinaryQueue = [null, '/opt/homebrew/bin/antfly']
      brewExists = true
      const result = await antflyComponent.install(optsAutoYes)

      expect(lastSpawnArgs).not.toBeNull()
      expect(lastSpawnArgs!.cmd).toBe('/opt/homebrew/bin/brew')
      expect(lastSpawnArgs!.args).toEqual(['install', '--cask', 'antflydb/antfly/antfly'])
      // Never uses shell: true — that's a hard rule in the spec
      expect(lastSpawnArgs!.opts).not.toHaveProperty('shell', true)
      expect(result.status).toBe('installed')
      expect(result.message).toContain('/opt/homebrew/bin/antfly')
    })

    it('reports failed when brew exits non-zero', async () => {
      findBinaryQueue = [null]
      spawnExitCode = 1
      const result = await antflyComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('exited with code 1')
    })

    it('reports failed when brew succeeds but binary is still missing', async () => {
      findBinaryQueue = [null]
      spawnExitCode = 0
      // Never flip findBinaryReturn — simulates brew silently doing nothing
      const result = await antflyComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('still not discoverable')
    })

    it('skips install when user declines the prompt', async () => {
      findBinaryQueue = [null]
      askYesNoReturn = false
      const result = await antflyComponent.install(optsInteractive)
      expect(result.status).toBe('skipped')
      expect(lastSpawnArgs).toBeNull()
    })

    it('skips install in non-interactive mode without --yes', async () => {
      findBinaryQueue = [null]
      const result = await antflyComponent.install(optsNonInteractiveNoYes)
      expect(result.status).toBe('skipped')
      expect(result.message).toContain('Non-interactive')
      expect(lastSpawnArgs).toBeNull()
    })

    it('reports failed when spawn emits an error event', async () => {
      findBinaryQueue = [null]
      spawnError = new Error('ENOENT')
      const result = await antflyComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('ENOENT')
    })
  })
})
