/**
 * Local lifecycle verbs act on THIS home's server only (Codex review, #986).
 * `bakin stop` signals the pid in this home's live server.lock — and only
 * while that pid still runs a Bakin server command (a recycled pid is never
 * signaled). Bakin servers the lock does not name (another home's, or one
 * that lost its lock) are REPORTED, never signaled.
 *
 * Safety: process discovery (`ps`/`pgrep`) is faked, and `process.kill`
 * forwards ONLY to the two idle children this file spawned — any other
 * signal is recorded as a forbidden attempt and never sent, so even a
 * regression to a machine-wide kill cannot touch a real server.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-lifecycle-scope-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, home: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media'), antfly: join(testDir, 'antfly'), logs: join(testDir, 'logs') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

// Stand-ins for two homes' servers: idle processes we own.
const spawnIdle = () => Bun.spawn(['bun', '-e', 'setInterval(() => {}, 1000)'], { stdout: 'ignore', stderr: 'ignore' })
const ours = spawnIdle()
const otherHome = spawnIdle()
let oursExited = false
let otherExited = false
void ours.exited.then(() => { oursExited = true })
void otherHome.exited.then(() => { otherExited = true })
const OWNED = new Set([ours.pid, otherHome.pid])

// Fake discovery: which pids "run a Bakin server command", and what pgrep sees.
let serverCommands = new Map<number, string>()
mock.module('child_process', () => ({
  execFileSync: (cmd: string, args: string[]) => {
    if (cmd === 'ps') return serverCommands.get(Number(args.at(-1))) ?? ''
    if (cmd === 'pgrep') {
      const pids = [...serverCommands.keys()]
      if (pids.length === 0) throw new Error('pgrep: no match')
      return pids.join('\n')
    }
    throw new Error(`unexpected execFileSync(${cmd})`)
  },
}))

const realKill = process.kill.bind(process)
const forbidden: Array<{ pid: number; signal: unknown }> = []
const signaled: number[] = []
let killSpy: ReturnType<typeof spyOn>

import { waitUntil } from '../helpers/wait'
import { run } from '../../src/cli/commands/lifecycle'

beforeEach(() => {
  forbidden.length = 0
  signaled.length = 0
  killSpy = spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    if (signal === 0) return realKill(pid, 0)
    if (!OWNED.has(pid)) { forbidden.push({ pid, signal }); return true }
    signaled.push(pid)
    return realKill(pid, signal as NodeJS.Signals)
  }) as typeof process.kill)
})
afterEach(() => {
  killSpy.mockRestore()
  rmSync(join(testDir, 'server.lock'), { force: true })
})
afterAll(() => {
  for (const p of [ours, otherHome]) { try { p.kill() } catch { /* already gone */ } }
  rmSync(testDir, { recursive: true, force: true })
})

async function stopOutput(): Promise<string> {
  const log = mock()
  const origLog = console.log
  console.log = log
  try {
    await run(['stop'])
  } finally {
    console.log = origLog
  }
  return log.mock.calls.flat().join('\n')
}

const writeLock = (pid: number) => writeFileSync(join(testDir, 'server.lock'), JSON.stringify({ pid, port: 3797, startedAt: Date.now(), bootId: 'b' }))

describe('bakin stop', () => {
  it('a lock pid that no longer runs a Bakin server (recycled) is never signaled', async () => {
    serverCommands = new Map([[otherHome.pid, 'bun run server.ts serve']])
    writeLock(ours.pid) // alive, but `ps` shows no Bakin server command for it
    const out = await stopOutput()
    expect(signaled).toEqual([])
    expect(forbidden).toEqual([])
    expect(out).toContain('No running Bakin process found')
    expect(out).toContain(`pid ${otherHome.pid}`) // reported, not signaled
  })

  it('no lock: other Bakin servers are reported, never signaled', async () => {
    serverCommands = new Map([[otherHome.pid, 'bun run server.ts serve']])
    const out = await stopOutput()
    expect(signaled).toEqual([])
    expect(forbidden).toEqual([])
    expect(out).toContain('Not signaled')
  })

  it('signals only the verified pid in this home\'s server.lock — another home\'s server keeps running', async () => {
    serverCommands = new Map([[ours.pid, 'bun run server.ts serve'], [otherHome.pid, 'bun run server.ts serve']])
    writeLock(ours.pid)
    const out = await stopOutput()
    expect(signaled).toEqual([ours.pid])
    expect(forbidden).toEqual([])
    await waitUntil(() => oursExited, { label: 'this home\'s server exited' })
    expect(otherExited).toBe(false)
    expect(out).toContain('Bakin stopped')
  })
})
