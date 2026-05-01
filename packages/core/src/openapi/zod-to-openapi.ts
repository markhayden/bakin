/**
 * Wraps `z.toJSONSchema` for embedding in OpenAPI 3.1 documents.
 *
 * Targets `openapi-3.1` so emitted schemas omit the JSON Schema `$schema`
 * draft link (which would clutter the OpenAPI document).
 */

import { z } from 'zod'

export type OpenApiSchema = Record<string, unknown>

export function zodToOpenApi(schema: z.ZodType<unknown>): OpenApiSchema {
  return z.toJSONSchema(schema, { target: 'openapi-3.1' }) as OpenApiSchema
}

/**
 * Convert a route path with `:param` placeholders to OpenAPI's `{param}`.
 * Idempotent — paths already in OpenAPI form pass through.
 */
export function normalizeOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_][\w]*)/g, '{$1}')
}
