/**
 * Install-state ownership for tests that call the core install writers
 * directly (#895): production callers run them inside an operation that
 * declares install-state (or holdNow); the writers assert it.
 */
import { holdNow } from '../../packages/core/src/operations'

/** Run `fn` holding install-state, the way an install operation does. */
export function owning<T>(fn: () => Promise<T>): Promise<T> {
  return holdNow(['install-state'], { title: 'test' }, fn)
}

/** `fn`, called as an owner of install-state. */
export function owned<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args) => owning(() => fn(...args))
}
