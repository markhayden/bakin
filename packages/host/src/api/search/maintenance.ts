/**
 * `POST /api/reindex` and `POST /api/search/reset` — search maintenance as
 * operations (#895): 202 `{ operationId, bootId }` (200 `attached` for an
 * identical live request); the result body is the reindex report or the
 * reset result. Reset refusals keep their 409 `{ ok: false, message }`.
 */
import { operationOriginFromRequest } from '@bakin/core/operations'
import { reindexOperation, searchResetOperation } from '@/core/search-operations'
import { startOperationResponse } from '../operations'

/** `?table=` narrows to one table; `?force=1` mints fresh generations (default is repair). */
export async function reindex(req: Request, url: URL): Promise<Response> {
  return startOperationResponse(reindexOperation({
    table: url.searchParams.get('table') || undefined,
    force: url.searchParams.get('force') === '1',
    origin: operationOriginFromRequest(req),
  }))
}

export async function reset(req: Request): Promise<Response> {
  return startOperationResponse(searchResetOperation(operationOriginFromRequest(req)))
}
