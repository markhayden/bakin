/**
 * Shared error envelope and global response builders for the dispatcher.
 *
 * The dispatcher emits these automatically:
 *   - 400 on params/query/body parse failure (when any are declared)
 *   - 415 on body content-type mismatch (when body is declared)
 *
 * Routes don't repeat them in their `responses` map; OpenAPI emission picks
 * them up from `globalErrorResponses` based on the route's input declarations.
 */

import { z } from 'zod'
import { zodToOpenApi, type OpenApiSchema } from './zod-to-openapi'

export const errorEnvelope = z.object({
  error: z.string(),
  issues: z.array(z.unknown()).optional(),
})

export type ErrorEnvelope = z.infer<typeof errorEnvelope>

let cachedEnvelopeSchema: OpenApiSchema | null = null

function envelopeSchema(): OpenApiSchema {
  if (cachedEnvelopeSchema === null) {
    cachedEnvelopeSchema = zodToOpenApi(errorEnvelope)
  }
  return cachedEnvelopeSchema
}

export interface GlobalErrorOptions {
  /** True when `params`, `query`, or `body` is declared. */
  hasInput: boolean
  /** True when `body` is declared. */
  hasBody: boolean
}

/**
 * Returns the global error responses (`400`/`415`) appropriate for a route
 * given its declared inputs. Empty object when nothing applies.
 */
export function globalErrorResponses(opts: GlobalErrorOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (opts.hasInput) {
    out['400'] = {
      description: 'Invalid input — params, query, or body did not match the declared schema.',
      content: {
        'application/json': { schema: envelopeSchema() },
      },
    }
  }
  if (opts.hasBody) {
    out['415'] = {
      description: 'Unsupported Media Type — body content type does not match the declared content type.',
      content: {
        'application/json': { schema: envelopeSchema() },
      },
    }
  }
  return out
}

/** Build a JSON error response body. */
export function errorResponseBody(error: string, issues?: unknown[]): ErrorEnvelope {
  return issues === undefined ? { error } : { error, issues }
}
