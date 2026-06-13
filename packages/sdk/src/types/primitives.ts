// Part of the @makinbakin/sdk/types contract — see ./index.ts for the
// module's self-containment + two-tier rationale.
/** HTTP method literal used in route and contribution definitions. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Visibility tier for a documented contract (route, hook, tool, etc.). */
export type ContractVisibility = 'public' | 'internal' | 'experimental'

/** Stability tier for a documented contract. */
export type ContractStability = 'stable' | 'beta' | 'experimental' | 'deprecated'

/** Minimal interface a validation schema must satisfy (Zod-compatible). */
export interface SchemaLike<T = unknown> {
  parse(data: unknown): T
  safeParse?(data: unknown): { success: true; data: T } | { success: false; error: unknown }
}

/** Pointer to a symbol's source file location, used in generated docs. */
export interface SourceLocation {
  file: string
  symbol?: string
  line?: number
}

/** Reference example for a documented contract (request/response or code snippet). */
export interface DocsExample {
  title: string
  description?: string
  code?: string
  request?: unknown
  response?: unknown
  test?: 'automated' | 'schema' | 'illustrative'
  reason?: string
}

// ---------------------------------------------------------------------------
// Manifest contract
// ---------------------------------------------------------------------------
