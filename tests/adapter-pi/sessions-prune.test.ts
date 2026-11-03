/**
 * Pi `sessions.pruneStore` (self-healing PR1 slice 1.3c, re-homing row 14):
 * the adapter's own session cleanup — old top-level session JSONL files are
 * deleted, recent ones and any thread with a turn in flight are kept, and
 * the thread map forgets files that are gone.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-pi-sessions-prune-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = pathJoin(testDir, 'pi')
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'

mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }) }))
mock.module('@bakin/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../packages/adapter-pi/src/registry', () => ({
  readRegistry: () => ({ agents: [{ id: 'main' }] }),
}))

import { createSessionsSurface, withThreadLock } from '../../packages/adapter-pi/src/sessions'
import { getAgentSessionsDir } from '../../packages/adapter-pi/src/home'

const AGENT = 'main'
const DAY = 24 * 60 * 60 * 1000
const dir = () => getAgentSessionsDir(AGENT)

function session(name: string, ageDays: number): string {
  const abs = pathJoin(dir(), name)
  writeFileSync(abs, `${JSON.stringify({ type: 'session', id: name })}\n${'x'.repeat(1000)}\n`)
  const when = new Date(Date.now() - ageDays * DAY)
  utimesSync(abs, when, when)
  return abs
}

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => { rmSync(dir(), { recursive: true, force: true }); mkdirSync(dir(), { recursive: true }) })

describe('pi sessions.pruneStore', () => {
  it('deletes top-level session files older than the cutoff, keeps recent ones, and reports what it freed', async () => {
    const old = session('old.jsonl', 45)
    const recent = session('recent.jsonl', 2)
    writeFileSync(pathJoin(dir(), 'bakin-threads.json'), JSON.stringify({ version: 1, threads: {
      'task:a:d1': { sessionId: 'old', file: old, createdAt: 'x', updatedAt: 'x' },
      'task:b:d1': { sessionId: 'recent', file: recent, createdAt: 'x', updatedAt: 'x' },
    } }))
    const result = await createSessionsSurface().pruneStore!(AGENT, { olderThanMs: 30 * DAY })
    expect(result).toMatchObject({ agentId: AGENT, removedFiles: 1, skippedInFlight: 0 })
    expect(result.freedBytes).toBeGreaterThan(1000)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
    const map = JSON.parse(readFileSync(pathJoin(dir(), 'bakin-threads.json'), 'utf-8')) as { threads: Record<string, unknown> }
    expect(Object.keys(map.threads)).toEqual(['task:b:d1'])
  })

  it('never deletes the session of a thread with a turn in flight, and a dry run deletes nothing', async () => {
    const busy = session('busy.jsonl', 45)
    const idle = session('idle.jsonl', 45)
    writeFileSync(pathJoin(dir(), 'bakin-threads.json'), JSON.stringify({ version: 1, threads: {
      'task:busy:d1': { sessionId: 'busy', file: busy, createdAt: 'x', updatedAt: 'x' },
    } }))
    let release!: () => void
    const turn = withThreadLock(AGENT, 'task:busy:d1', () => new Promise<void>((resolve) => { release = resolve }))
    const surface = createSessionsSurface()
    const dry = await surface.pruneStore!(AGENT, { olderThanMs: 30 * DAY, dryRun: true })
    expect(dry).toMatchObject({ removedFiles: 1, skippedInFlight: 1 })
    expect(existsSync(idle)).toBe(true)
    const real = await surface.pruneStore!(AGENT, { olderThanMs: 30 * DAY })
    expect(real).toMatchObject({ removedFiles: 1, skippedInFlight: 1 })
    expect(existsSync(busy)).toBe(true)
    expect(existsSync(idle)).toBe(false)
    release()
    await turn
    expect((await surface.pruneStore!(AGENT, { olderThanMs: 30 * DAY })).removedFiles).toBe(1)
  })
})
