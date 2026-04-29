/**
 * Ambient declaration for the `vi` compatibility shim exposed on globalThis
 * by tests/setup.ts. Lets tests call `vi.useFakeTimers()` etc. without an
 * explicit import, matching vitest's runtime semantics.
 *
 * The types are deliberately permissive — this is test-runner glue, not
 * production code, and tightening type safety here forces per-test rewrites
 * that don't change behavior.
 */
declare const vi: {
  fn: (...args: any[]) => any
  spyOn: (...args: any[]) => any
  mock: (...args: any[]) => any
  doMock: (...args: any[]) => any
  unmock: (...args: any[]) => any
  mocked: <T>(x: T) => any
  hoisted: <T>(fn: () => T) => T
  importActual: <T = any>(path: string) => Promise<T>
  clearAllMocks: () => void
  restoreAllMocks: () => void
  resetModules: () => void
  useFakeTimers: () => void
  useRealTimers: () => void
  setSystemTime: (d: Date | number) => void
  advanceTimersByTime: (ms: number) => void
  advanceTimersByTimeAsync: (ms: number) => Promise<void>
  runAllTimersAsync: () => Promise<void>
  stubGlobal: (key: string, value: unknown) => void
  unstubAllGlobals: () => void
  waitFor: <T>(fn: () => T | Promise<T>, opts?: { timeout?: number; interval?: number }) => Promise<T>
}
