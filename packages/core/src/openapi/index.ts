/**
 * `@bakin/core/openapi` — Zod→OpenAPI conversion + Operation builder.
 */

export { zodToOpenApi, normalizeOpenApiPath } from './zod-to-openapi'
export type { OpenApiSchema } from './zod-to-openapi'

export { errorEnvelope, errorResponseBody, globalErrorResponses } from './errors'
export type { ErrorEnvelope, GlobalErrorOptions } from './errors'

export { buildOperation } from './operation'
export type {
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  BuildOperationContext,
} from './operation'
