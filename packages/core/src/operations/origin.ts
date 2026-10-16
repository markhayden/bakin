import type { OperationOrigin } from '@makinbakin/sdk/types'

/**
 * Who started an HTTP request. The CLI marks its requests with
 * `X-Bakin-Origin: cli`; everything else arriving over HTTP is the browser.
 * `discord` and `system` origins are in-process and never come from a header.
 */
export function operationOriginFromRequest(req: Request): OperationOrigin {
  return req.headers.get('x-bakin-origin') === 'cli' ? 'cli' : 'web'
}
