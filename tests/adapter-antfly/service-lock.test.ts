import { afterAll, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const root = mkdtempSync(join(tmpdir(), 'bakin-service-lock-'))
const paths = () => ({ getContentDir: () => root, getBakinPaths: () => ({ home: root, db: join(root, 'bakin.db') }) })
mock.module('../../src/core/content-dir', paths)
mock.module('../../packages/core/src/content-dir', paths)
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => root, getOpenClawPath: (...p: string[]) => join(root, ...p), resetOpenClawHome: () => {} }))
const { withServiceLock, serviceLockBusy } = await import('../../packages/adapter-antfly/src/service-lock')
afterAll(() => rmSync(root, { recursive: true, force: true }))

it('excludes independent operations but allows nesting; releases after failure', async () => {
  const path = join(root, 'unit.lock')
  let release!: () => void
  let entered!: () => void
  const ready = new Promise<void>((r) => { entered = r })
  const blocked = new Promise<void>((r) => { release = r })
  const first = withServiceLock(path, async () => {
    expect(serviceLockBusy(path)).toBe(false)
    await withServiceLock(path, async () => {})
    entered()
    await blocked
    throw new Error('test operation failed')
  })
  await ready
  expect(serviceLockBusy(path)).toBe(true)
  await expect(withServiceLock(path, async () => {})).rejects.toThrow('in progress')
  release()
  await expect(first).rejects.toThrow('test operation failed')
  expect(existsSync(path)).toBe(false)
  await withServiceLock(path, async () => {})
})

it('never reclaims an empty or malformed lock', async () => {
  const path = join(root, 'unknown.lock')
  for (const body of ['', 'not json']) {
    writeFileSync(path, body)
    expect(serviceLockBusy(path)).toBe(true)
    await expect(withServiceLock(path, async () => {})).rejects.toThrow('in progress')
    expect(existsSync(path)).toBe(true)
  }
})
