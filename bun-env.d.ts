/**
 * Minimal type declarations for Bun built-in modules Bakin uses.
 *
 * We avoid importing the full `bun-types` (or `@types/bun`) package because
 * it globally augments `typeof fetch` with Bun-specific methods
 * (`preconnect`, `preload`, etc.) which breaks our Vitest mock assertions
 * that assert `MockInstance<...> as typeof fetch`.
 *
 * Declare only the Bun module surfaces we actually use here. When a new
 * Bun module gets adopted (e.g. `bun:jsc`, `bun:test`), add its module
 * declaration to this file rather than pulling in bun-types wholesale.
 */

declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string, options?: { readonly?: boolean; create?: boolean })
    prepare<Row = unknown, Params = unknown[]>(sql: string): Statement<Row, Params>
    exec(sql: string): void
    transaction<F extends (...args: unknown[]) => unknown>(fn: F): F
    close(): void
  }

  export interface Statement<Row = unknown, Params = unknown[]> {
    get(...params: Params extends unknown[] ? Params : never[]): Row | undefined
    all(...params: Params extends unknown[] ? Params : never[]): Row[]
    run(...params: Params extends unknown[] ? Params : never[]): { changes: number; lastInsertRowid: number | bigint }
    finalize(): void
  }
}
