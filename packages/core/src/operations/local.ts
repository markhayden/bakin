/**
 * `runLocal` — the in-process way to run an operation (#895). Same registry,
 * same resources, same views and events as the HTTP path; it simply waits for
 * the terminal view instead of answering 202. Used by in-process callers
 * (onboarding components until PR6, the CLI's in-process mode, approvals and
 * escalation) and by the in-PR callers of `op`-taking helpers.
 *
 * Inside an existing holder of a resource (an outer operation, or `holdNow`),
 * the declared resource is already held by the call chain, so `runLocal` is
 * reentrant and never waits on itself.
 */
import type { OperationView } from '@makinbakin/sdk/types'
import type { OperationRegistry, StartOperationInput } from './registry'

/** Validation failures reject; every other ending resolves with the terminal view. */
export async function runLocal<B>(registry: OperationRegistry, input: StartOperationInput<B>): Promise<OperationView<B>> {
  const { operationId } = await registry.start(input)
  return (await registry.await(operationId)) as OperationView<B>
}
