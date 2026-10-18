/**
 * Resource ownership for tests that call core writers directly (#895):
 * production callers run them inside an operation that declares the
 * resource (or holdNow); the writers assert it.
 */
import { holdNow } from '../../packages/core/src/operations'

/** Run `fn` holding `resources` (install-state by default), the way an operation does. */
export function owning<T>(fn: () => Promise<T>, resources: string[] = ['install-state']): Promise<T> {
  return holdNow(resources, { title: 'test' }, fn)
}

/** `fn`, called as an owner of install-state. */
export function owned<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args) => owning(() => fn(...args))
}
