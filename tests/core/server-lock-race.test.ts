/**
 * #898 K — the server singleton lock under REAL concurrency: separate
 * processes race to start against a stale lock (dead pid) and a corrupt one.
 * Exactly one may win; a live lock is never swept away.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

const home = join(tmpdir(), `bakin-test-server-lock-race-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const winners = join(home, 'winners')
const modulePath = resolve(import.meta.dir, '../../src/core/server-lock.ts')

const racer = `
import { acquireServerLock } from ${JSON.stringify(modulePath)}
import { writeFileSync } from 'fs'
const r = acquireServerLock(3737, 'boot-' + process.pid)
if (r.acquired) {
  writeFileSync(${JSON.stringify(winners)} + '/' + process.pid, '')
  await Bun.sleep(1500) // hold while every other racer tries
}
`

async function race(n: number): Promise<void> {
  const script = join(home, 'racer.ts')
  writeFileSync(script, racer)
  const procs = Array.from({ length: n }, () => Bun.spawn(['bun', script], { stdout: 'ignore', stderr: 'pipe', env: { ...process.env, BAKIN_HOME: home, BAKIN_CONSOLE_FORMAT: 'silent', BAKIN_DISABLE_FILE_LOG: '1' } }))
  const codes = await Promise.all(procs.map((p) => p.exited))
  expect(codes.every((c) => c === 0)).toBe(true)
}

beforeEach(() => {
  rmSync(home, { recursive: true, force: true })
  mkdirSync(winners, { recursive: true })
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('acquireServerLock across processes', () => {
  it('exactly one of many starters wins a STALE lock — concurrent sweepers never both own it', async () => {
    writeFileSync(join(home, 'server.lock'), JSON.stringify({ pid: 999999999, port: 3737, startedAt: 0, bootId: 'dead' }))
    await race(8)
    expect(readdirSync(winners)).toHaveLength(1)
    expect(readdirSync(home).filter((n) => n.startsWith('server.lock.'))).toEqual([]) // no temp/claim leftovers
  }, 30_000)

  it('exactly one wins over a CORRUPT lock', async () => {
    writeFileSync(join(home, 'server.lock'), '{"pid": 12')
    await race(8)
    expect(readdirSync(winners)).toHaveLength(1)
  }, 30_000)

  it('fails closed on a sweep marker a DEAD starter left — never reclaims it, never touches the lock', async () => {
    const stale = JSON.stringify({ pid: 999999999, port: 3737, startedAt: 0, bootId: 'dead' })
    writeFileSync(join(home, 'server.lock'), stale)
    writeFileSync(join(home, 'server.lock.sweep'), JSON.stringify({ pid: 999999998, at: 0 }))
    const script = join(home, 'one.ts')
    writeFileSync(script, `import { acquireServerLock } from ${JSON.stringify(modulePath)}\ntry { acquireServerLock(3737, 'b'); console.log('ACQUIRED') } catch (err) { console.log(String(err)) }\n`)
    const proc = Bun.spawn(['bun', script], { stdout: 'pipe', stderr: 'ignore', env: { ...process.env, BAKIN_HOME: home, BAKIN_CONSOLE_FORMAT: 'silent', BAKIN_DISABLE_FILE_LOG: '1' } })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    expect(out).toContain('server.lock.sweep')
    expect(out).not.toContain('ACQUIRED')
    expect(readFileSync(join(home, 'server.lock'), 'utf-8')).toBe(stale)
  }, 30_000)

  it('starters racing a LIVE holder all refuse and leave its lock byte for byte', async () => {
    const holder = Bun.spawn(['sleep', '30'])
    try {
      const live = JSON.stringify({ pid: holder.pid, port: 3737, startedAt: 1, bootId: 'live' })
      writeFileSync(join(home, 'server.lock'), live)
      await race(8)
      expect(readdirSync(winners)).toHaveLength(0)
      expect(readFileSync(join(home, 'server.lock'), 'utf-8')).toBe(live)
      expect(readdirSync(home).filter((n) => n.startsWith('server.lock.'))).toEqual([])
    } finally {
      holder.kill()
    }
  }, 30_000)
})
