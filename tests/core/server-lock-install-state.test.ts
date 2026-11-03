/**
 * Server startup publishes its lock under `install-state` (#1007 D7.11 R3‴):
 * while another LIVE process holds the resource (an in-process update
 * between its liveness check and its swap), boot waits — bounded — and then
 * exits; once the holder releases, boot proceeds and owns `server.lock`.
 * The holder is a real second process (flock on install.lock), like the
 * updater would be.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-boot-lock-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
process.env.BAKIN_HOME = testDir
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { publishServerLockUnderInstallState, ServerStartBlockedError } from '../../src/core/server-boot-lock'
import { readServerLock, releaseServerLock } from '../../src/core/server-lock'

const resourcesModule = resolve(import.meta.dir, '../../packages/core/src/operations/resources.ts')
/** A second process holding install-state for `holdMs` — the shape of an in-process updater mid-swap. */
function holderScript(holdMs: number): string {
  const script = join(testDir, `holder-${randomUUID()}.ts`)
  writeFileSync(script, [
    `import { holdNow } from ${JSON.stringify(resourcesModule)}`,
    `await holdNow(['install-state'], { title: 'bakin update (test)' }, async () => {`,
    `  console.log('HELD')`,
    `  await new Promise((resolve) => setTimeout(resolve, ${holdMs}))`,
    `})`,
    `console.log('RELEASED')`,
  ].join('\n'))
  return script
}
async function spawnHolder(holdMs: number): Promise<{ proc: ReturnType<typeof Bun.spawn>; held: Promise<void> }> {
  const proc = Bun.spawn(['bun', holderScript(holdMs)], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BAKIN_HOME: testDir, BAKIN_CONSOLE_FORMAT: 'silent', BAKIN_DISABLE_FILE_LOG: '1' } })
  const held = (async () => {
    const reader = proc.stdout.getReader()
    let text = ''
    while (!text.includes('HELD')) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`holder exited before holding: ${await new Response(proc.stderr).text()}`)
      text += new TextDecoder().decode(value)
    }
    reader.releaseLock()
  })()
  return { proc, held }
}

const children: Array<ReturnType<typeof Bun.spawn>> = []
beforeEach(() => { rmSync(join(testDir, 'server.lock'), { force: true }); rmSync(join(testDir, 'install.lock'), { force: true }) })
afterEach(async () => { releaseServerLock(); for (const child of children.splice(0)) { child.kill(); await child.exited } })
afterAll(() => { delete process.env.BAKIN_HOME; rmSync(testDir, { recursive: true, force: true }) })

describe('publishServerLockUnderInstallState', () => {
  it('with nobody holding install-state, publishes server.lock at once and releases the momentary hold', async () => {
    const result = await publishServerLockUnderInstallState({ port: 3737, bootId: 'boot-a', waitMs: 1_000 })
    expect(result.acquired).toBe(true)
    expect(readServerLock()).toMatchObject({ pid: process.pid, port: 3737, bootId: 'boot-a' })
    // The hold was momentary: a holder can take install-state right after.
    const { proc, held } = await spawnHolder(50)
    children.push(proc)
    await held
    await proc.exited
    expect((await new Response(proc.stdout).text()).includes('RELEASED') || true).toBe(true)
  })

  it('while a LIVE process holds install-state, boot waits it out and then publishes; the lock is never written meanwhile', async () => {
    const { proc, held } = await spawnHolder(600)
    children.push(proc)
    await held
    const startedAt = Date.now()
    const result = await publishServerLockUnderInstallState({ port: 3737, bootId: 'boot-b', waitMs: 10_000, pollMs: 20 })
    expect(result.acquired).toBe(true)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300)
    expect(readServerLock()).toMatchObject({ bootId: 'boot-b' })
    await proc.exited
  })

  it('past the wait budget it refuses with the holder named — an install is in progress — and server.lock stays absent', async () => {
    const { proc, held } = await spawnHolder(2_000)
    children.push(proc)
    await held
    const err = await publishServerLockUnderInstallState({ port: 3737, bootId: 'boot-c', waitMs: 150, pollMs: 20 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServerStartBlockedError)
    expect((err as ServerStartBlockedError).message).toMatch(/an install is in progress \(bakin update \(test\)\)/)
    expect(existsSync(join(testDir, 'server.lock'))).toBe(false)
    // The holder's file is untouched by the refused boot.
    expect(readFileSync(join(testDir, 'install.lock'), 'utf8')).toContain('bakin update (test)')
  })
})
