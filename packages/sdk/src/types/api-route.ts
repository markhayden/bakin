/**
 * The canonical declarative route type — the PUBLISHED declaration.
 *
 * This is a LEAF module: it imports only sibling SDK type modules (plus zod
 * types), never `@bakin/core`. That direction matters — core's
 * `plugin-types.ts` imports `@makinbakin/sdk/types`, so anything here that
 * reached back into core would close a package import cycle (the ratchet in
 * scripts/check-cycles.ts caught exactly that when `types/index.ts`
 * re-exported these through `../routing`).
 *
 * The route CONTEXT stays tier-specific and lives with each tier:
 * `APIRoute<C>` is generic and unconstrained here (`C = unknown`);
 * `@bakin/core/routing` re-exports it aliased with the rich core-tier
 * `RouteContext` default, and `@makinbakin/sdk/routing` re-exports that
 * alias — so route authors always see the contextful form, while this
 * module stays self-contained.
 */

import type { z } from 'zod'
import type {
  ContractStability,
  ContractVisibility,
  DocsExample,
  HttpMethod,
  SourceLocation,
} from './primitives'

export type HttpStatus =
  | 200 | 201 | 202 | 204
  | 301 | 302 | 304
  | 400 | 401 | 403 | 404 | 409 | 410 | 415 | 422 | 429
  | 500 | 502 | 503 | 504

/** Producer-assigned usage classification; consumers must never infer this from route names. */
export type ActivityClass = 'user' | 'system' | 'routine'

// ---------------------------------------------------------------------------
// Body / response specs
// ---------------------------------------------------------------------------

export interface JsonBodySpec<B = unknown> {
  contentType: 'application/json'
  schema: z.ZodType<B>
}

export interface MultipartBodySpec<B = unknown> {
  contentType: 'multipart/form-data'
  schema?: z.ZodType<B>
}

export interface RawBodySpec<B = unknown> {
  contentType: '*/*'
  schema?: z.ZodType<B>
}

export interface NoBodySpec {
  contentType: 'none'
}

/**
 * `body` declaration:
 *   - `z.ZodType` shorthand → JSON body validated against the schema.
 *   - explicit JSON spec → same, content-type stated.
 *   - multipart / raw → handler reads `req.formData()` / `req.body` itself.
 *   - none → dispatcher rejects non-empty bodies with 415.
 *
 * Omit the field entirely on routes that don't consume a body. Unknown
 * `contentType` values are rejected loudly at definition/registration time.
 */
export type BodySpec<B = unknown> =
  | z.ZodType<B>
  | JsonBodySpec<B>
  | MultipartBodySpec<B>
  | RawBodySpec<B>
  | NoBodySpec

export interface JsonResponseSpec {
  contentType: 'application/json'
  schema: z.ZodType
}

export interface NoContentResponseSpec {
  contentType: 'none'
}

export interface NonJsonResponseSpec {
  contentType:
    | 'text/event-stream'
    | 'text/html'
    | 'text/plain'
    | 'application/octet-stream'
    | 'image/png'
    | 'image/jpeg'
    | 'image/svg+xml'
    | (string & Record<never, never>)
  schema?: z.ZodType
}

export type ResponseSpec =
  | z.ZodType
  | JsonResponseSpec
  | NoContentResponseSpec
  | NonJsonResponseSpec

// ---------------------------------------------------------------------------
// Parsed input — conditional intersection so undeclared keys are absent
// ---------------------------------------------------------------------------

/** Helper: `{ body: B }` if B is declared (non-undefined), else no fields. */
type Field<K extends string, T> = [T] extends [undefined] ? unknown : { [P in K]: T }
type Normalize<T> = { [K in keyof T]: T[K] }

export type ParsedInput<P, Q, B> =
  Normalize<
    & Field<'params', P>
    & Field<'query', Q>
    & Field<'body', B>
  >

// ---------------------------------------------------------------------------
// APIRoute — the ONE declarative route declaration
// ---------------------------------------------------------------------------

export interface APIRoute<
  C = unknown,
  P = undefined,
  Q = undefined,
  B = undefined,
> {
  path: string
  method: HttpMethod
  summary?: string
  description?: string

  params?: z.ZodType<P>
  query?: z.ZodType<Q>
  body?: P extends never ? never : BodySpec<B>

  responses?: Partial<Record<HttpStatus, ResponseSpec>>

  visibility?: ContractVisibility
  stability?: ContractStability
  permissions?: string[]
  examples?: DocsExample[]
  operationId?: string
  tags?: string[]
  source?: SourceLocation
  /** Override the REST request boundary's explicit foreground classification. */
  activityClass?: ActivityClass

  handler: (
    req: Request,
    ctx: C,
    parsed: ParsedInput<P, Q, B>,
  ) => Response | Promise<Response>
}
