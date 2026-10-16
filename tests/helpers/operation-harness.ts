/**
 * Run code inside a real operation (in-memory resources — no lock files), the
 * way an installer that takes `op` is called in production. Resolves with the
 * function's value (and the terminal view); rejects with the function's own
 * error so `expect(...).rejects` keeps working.
 */
import {
  createMemoryResourceAcquirer,
  createOperationRegistry,
  type OperationContext,
  type OperationPlan,
  type OperationView,
} from '@bakin/core/operations'

export interface WithOperationOptions {
  plan: OperationPlan
  resources?: string[]
}

/** Never rejects: the function's value or error, plus the terminal view either way. */
export async function settleOperation<T>(opts: WithOperationOptions, fn: (op: OperationContext) => Promise<T>): Promise<{ value?: T; error?: unknown; view: OperationView }> {
  const registry = createOperationRegistry({
    bootId: () => 'test-boot',
    publish: () => {},
    quietCheckIntervalMs: 0,
    acquireResources: createMemoryResourceAcquirer(1),
  })
  let value: T | undefined
  let error: unknown
  try {
    const { operationId } = await registry.start({
      kind: 'test',
      owner: 'core',
      origin: 'system',
      title: 'Test operation',
      fingerprint: `test:${Math.random()}`,
      resources: opts.resources ?? [],
      plan: opts.plan,
      run: async (op) => {
        try {
          value = await fn(op)
        } catch (err) {
          error = err
          throw err
        }
        return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null }
      },
    })
    const view = await registry.await(operationId)
    return { ...(error === undefined ? { value } : { error }), view }
  } finally {
    registry.dispose()
  }
}

export async function withOperationView<T>(opts: WithOperationOptions, fn: (op: OperationContext) => Promise<T>): Promise<{ value: T; view: OperationView }> {
  const settled = await settleOperation(opts, fn)
  if ('error' in settled) throw settled.error
  return { value: settled.value as T, view: settled.view }
}

export async function withOperation<T>(opts: WithOperationOptions, fn: (op: OperationContext) => Promise<T>): Promise<T> {
  return (await withOperationView(opts, fn)).value
}
