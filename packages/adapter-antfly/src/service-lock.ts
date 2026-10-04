/** One operation across all Bakin homes sharing an OS user's service unit. */
import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { canonicalPath } from './service-ownership'

const operation = new AsyncLocalStorage<{ path: string; token: string; active: boolean }>()

export function serviceLockBusy(path: string): boolean {
  const key = canonicalPath(path)
  const held = operation.getStore()
  if (held?.active && held.path === key) return false
  try {
    lstatSync(key)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

export async function withServiceLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const key = canonicalPath(path)
  const held = operation.getStore()
  if (held?.active && held.path === key) return fn()
  mkdirSync(dirname(key), { recursive: true })
  let fd: number
  try {
    fd = openSync(key, 'wx', 0o600)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    throw new Error(`Search service change in progress (${key}). Retry after it finishes. If an operation crashed, stop all service-changing processes before removing this lock.`)
  }
  const state = { path: key, token: randomUUID(), active: true }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token: state.token, startedAt: new Date().toISOString() }))
    return await operation.run(state, fn)
  } finally {
    state.active = false
    closeSync(fd)
    // Never remove a replacement lock, including after manual intervention.
    try {
      if (JSON.parse(readFileSync(key, 'utf8')).token === state.token) unlinkSync(key)
    } catch { /* An unreadable/empty lock stays occupied; diagnostics explain recovery. */ }
  }
}
