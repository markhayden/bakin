/**
 * acquireModelsLock under REAL concurrency (#898 E review): separate
 * processes race for the machine-wide models lock (an exclusive-create file,
 * never auto-reclaimed). Exactly one may win a free lock; a leftover lock —
 * even a dead holder's — is never taken automatically.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

const dir = join(tmpdir(), `bakin-test-models-lock-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const modelsRoot = join(dir, 'inference', 'models')
const lockPath = join(dir, 'inference', '.models.bakin-pull.lock')
const winners = join(dir, 'winners')
const modulePath = resolve(import.meta.dir, '../../packages/adapter-antfly/src/pull-progress.ts')

// Each racer: try once; a winner records itself and HOLDS long enough that
// every other racer's attempt overlaps it.
const racer = `
import { acquireModelsLock } from ${JSON.stringify(modulePath)}
import { writeFileSync } from 'fs'
const lock = acquireModelsLock(${JSON.stringify(modelsRoot)})
if ('release' in lock) {
  writeFileSync(${JSON.stringify(winners)} + '/' + process.pid, '')
  await Bun.sleep(1500)
  lock.release()
}
`

async function race(n: number): Promise<void> {
  const script = join(dir, 'racer.ts')
  writeFileSync(script, racer)
  const procs = Array.from({ length: n }, () => Bun.spawn(['bun', script], { stdout: 'ignore', stderr: 'pipe' }))
  const codes = await Promise.all(procs.map((p) => p.exited))
  expect(codes.every((code) => code === 0)).toBe(true)
}

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(modelsRoot, { recursive: true })
  mkdirSync(winners, { recursive: true })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('acquireModelsLock across processes', () => {
  it('exactly one of many simultaneous racers acquires a free lock', async () => {
    await race(8)
    expect(readdirSync(winners)).toHaveLength(1)
    // Released: a new holder can take it at once.
    const { acquireModelsLock } = await import(modulePath)
    const again = acquireModelsLock(modelsRoot)
    expect('release' in again).toBe(true)
    if ('release' in again) again.release()
  }, 30_000)

  it('a leftover lock — even one naming a dead pid — is never reclaimed: no racer wins', async () => {
    writeFileSync(lockPath, '999999999')
    await race(8)
    expect(readdirSync(winners)).toHaveLength(0)
    const { acquireModelsLock } = await import(modulePath)
    expect(acquireModelsLock(modelsRoot)).toMatchObject({ heldBy: 999999999, path: lockPath })
  }, 30_000)
})
