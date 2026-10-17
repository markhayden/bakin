/**
 * Browser-side fakes for converted routes (#895): a route that used to answer
 * its body now answers 202 `{ operationId, bootId }`, and `useOperation`
 * reads the operation from `GET /api/operations/:id`. A test registers the
 * finished view (carrying the old body as `result`) and serves both.
 */
import type { OperationView } from '@makinbakin/sdk/types'

export const TEST_BOOT_ID = 'boot-test'

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

/** A settled operation whose `result` is what the route used to answer. */
export function finishedOperation(
  id: string,
  result: { httpStatus: number; body: unknown },
  over: Partial<OperationView> = {},
): OperationView {
  const now = new Date().toISOString()
  const ok = result.httpStatus < 400
  return {
    id,
    children: [],
    rev: 5,
    bootId: TEST_BOOT_ID,
    kind: 'install',
    owner: 'core',
    origin: 'web',
    title: 'Test operation',
    fingerprint: `test:${id}`,
    resources: ['install-state'],
    status: ok ? 'succeeded' : 'failed',
    plan: { stages: [{ id: 'run', kind: 'installing', label: 'Run' }], pointOfNoReturn: null },
    stages: [{ id: 'run', kind: 'installing', label: 'Run', status: ok ? 'done' : 'failed', startedAt: now, endedAt: now }],
    cancellable: false,
    startedAt: now,
    lastProgressAt: now,
    lastLivenessAt: now,
    endedAt: now,
    outcome: { code: ok ? 'ok' : 'failed' },
    result,
    log: [],
    ...over,
  }
}

/** The 202 a converted route answers. */
export function operationStarted(id: string): Response {
  return json({ operationId: id, bootId: TEST_BOOT_ID }, 202)
}

/** Serves `GET /api/operations/:id` (and cancel) from `operations`; null for any other path. */
export function operationResponse(path: string, operations: ReadonlyMap<string, OperationView>): Response | null {
  const match = /\/api\/operations\/([^/?]+)(\/cancel)?/.exec(path)
  if (!match) return null
  const view = operations.get(decodeURIComponent(match[1]!))
  if (!view) return json({ bootId: TEST_BOOT_ID, error: 'not_found' }, 404)
  if (match[2]) return json({ bootId: TEST_BOOT_ID, status: 'already_finished' }, 409)
  return json({ bootId: TEST_BOOT_ID, operation: view, children: [] })
}
